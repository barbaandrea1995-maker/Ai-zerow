import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { tenantMemberships } from "@/db/schema";
import {
  getMembershipsForIdentity,
  getSitesAuthorityContext,
  hasCapability,
  type AuthenticatedIdentity,
} from "@/lib/authority-context";
import { getNeonAuthIdentity as readNeonAuthIdentity } from "@/lib/neon-auth/tenant-context";

export const dynamic = "force-dynamic";

type LinkPayload = {
  tenantId?: unknown;
};

function sitesIdentityFromContext(context: NonNullable<Awaited<ReturnType<typeof getSitesAuthorityContext>>>): AuthenticatedIdentity {
  return {
    identityProvider: "sites",
    actorId: context.actorId,
    actorEmail: context.actorEmail,
    actorName: context.actorName,
    sessionId: null,
  };
}

function publicMembership(row: {
  tenantId: string;
  actorEmail: string;
  displayName: string;
  role: string;
  status: string;
}) {
  return {
    tenantId: row.tenantId,
    actorEmail: row.actorEmail,
    displayName: row.displayName,
    role: row.role,
    status: row.status,
  };
}

async function requireLinkGate() {
  const sitesContext = await getSitesAuthorityContext();
  if (!sitesContext) {
    return {
      context: null,
      response: NextResponse.json(
        { ok: false, error: "sites_owner_required" },
        { status: 401 },
      ),
    };
  }

  if (
    sitesContext.identityProvider !== "sites" ||
    sitesContext.role !== "owner" ||
    !hasCapability(sitesContext, "tenant.manage")
  ) {
    return {
      context: null,
      response: NextResponse.json(
        { ok: false, error: "tenant_manage_required" },
        { status: 403 },
      ),
    };
  }

  const neonIdentity = await readNeonAuthIdentity();
  if (neonIdentity.status === "not_configured") {
    return {
      context: null,
      response: NextResponse.json(
        { ok: false, error: "neon_auth_not_configured" },
        { status: 503 },
      ),
    };
  }
  if (neonIdentity.status === "unauthenticated") {
    return {
      context: null,
      response: NextResponse.json(
        { ok: false, error: "neon_identity_required" },
        { status: 401 },
      ),
    };
  }
  if (neonIdentity.status === "error") {
    return {
      context: null,
      response: NextResponse.json(
        { ok: false, error: "neon_auth_context_unavailable" },
        { status: 503 },
      ),
    };
  }

  return { context: { sitesContext, neonIdentity }, response: null };
}

export async function GET() {
  const gate = await requireLinkGate();
  if (gate.response) return gate.response;

  const { sitesContext, neonIdentity } = gate.context!;
  try {
    const sitesIdentity = sitesIdentityFromContext(sitesContext);
    const siteMemberships = await getMembershipsForIdentity(sitesIdentity);
    const targetTenant = siteMemberships.find(
      (row) => row.tenantId === sitesContext.tenantId && row.membershipRole === "owner",
    );
    if (!targetTenant) {
      return NextResponse.json(
        { ok: false, error: "canonical_owner_membership_required" },
        { status: 403 },
      );
    }

    const db = getDb();
    const existing = await db
      .select({
        tenantId: tenantMemberships.tenantId,
        actorEmail: tenantMemberships.actorEmail,
        displayName: tenantMemberships.displayName,
        role: tenantMemberships.role,
        status: tenantMemberships.status,
      })
      .from(tenantMemberships)
      .where(
        and(
          eq(tenantMemberships.tenantId, targetTenant.tenantId),
          eq(tenantMemberships.identityProvider, "neon"),
          eq(tenantMemberships.actorId, neonIdentity.actor.id),
        ),
      )
      .limit(1);

    return NextResponse.json({
      ok: true,
      linked: existing[0]?.status === "active",
      tenantId: targetTenant.tenantId,
      identity: {
        email: neonIdentity.actor.email,
        name: neonIdentity.actor.name || neonIdentity.actor.email,
      },
      membership: existing[0] ? publicMembership(existing[0]) : null,
      authorization: "sites_owner_plus_neon_session",
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "tenant_store_unavailable" },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  const gate = await requireLinkGate();
  if (gate.response) return gate.response;

  const { sitesContext, neonIdentity } = gate.context!;
  let payload: LinkPayload = {};
  try {
    payload = (await request.json()) as LinkPayload;
  } catch {
    // An empty body links the current Neon identity to the current EMS tenant.
  }

  const requestedTenantId =
    typeof payload.tenantId === "string" ? payload.tenantId.trim() : "";
  if (requestedTenantId && requestedTenantId !== sitesContext.tenantId) {
    return NextResponse.json(
      {
        ok: false,
        error: "cross_tenant_access_denied",
        clientSuppliedTenantAccepted: false,
      },
      { status: 403 },
    );
  }

  try {
    const sitesIdentity = sitesIdentityFromContext(sitesContext);
    const siteMemberships = await getMembershipsForIdentity(sitesIdentity);
    const targetTenant = siteMemberships.find(
      (row) => row.tenantId === sitesContext.tenantId && row.membershipRole === "owner",
    );
    if (!targetTenant) {
      return NextResponse.json(
        { ok: false, error: "canonical_owner_membership_required" },
        { status: 403 },
      );
    }

    const db = getDb();
    const existing = await db
      .select({
        tenantId: tenantMemberships.tenantId,
        actorEmail: tenantMemberships.actorEmail,
        displayName: tenantMemberships.displayName,
        role: tenantMemberships.role,
        status: tenantMemberships.status,
      })
      .from(tenantMemberships)
      .where(
        and(
          eq(tenantMemberships.tenantId, targetTenant.tenantId),
          eq(tenantMemberships.identityProvider, "neon"),
          eq(tenantMemberships.actorId, neonIdentity.actor.id),
        ),
      )
      .limit(1);

    if (existing[0]) {
      if (existing[0].status !== "active") {
        return NextResponse.json(
          { ok: false, error: "membership_inactive_requires_admin_review" },
          { status: 409 },
        );
      }

      return NextResponse.json({
        ok: true,
        created: false,
        linked: true,
        tenantId: targetTenant.tenantId,
        membership: publicMembership(existing[0]),
        authorization: "sites_owner_plus_neon_session",
      });
    }

    const now = new Date().toISOString();
    const membership = {
      id: `neon:${targetTenant.tenantId}:${neonIdentity.actor.id}`,
      tenantId: targetTenant.tenantId,
      identityProvider: "neon" as const,
      actorId: neonIdentity.actor.id,
      actorEmail: neonIdentity.actor.email,
      displayName: neonIdentity.actor.name || neonIdentity.actor.email,
      role: "owner" as const,
      status: "active" as const,
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(tenantMemberships).values(membership);

    return NextResponse.json(
      {
        ok: true,
        created: true,
        linked: true,
        tenantId: targetTenant.tenantId,
        membership: publicMembership(membership),
        authorization: "sites_owner_plus_neon_session",
      },
      { status: 201 },
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: "tenant_store_unavailable" },
      { status: 503 },
    );
  }
}
