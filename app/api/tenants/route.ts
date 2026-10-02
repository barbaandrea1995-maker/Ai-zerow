import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { tenantMemberships, tenants } from "@/db/schema";
import {
  type IdentityProvider,
  getAuthorityContext,
  hasCapability,
  publicAuthorityContext,
  SITES_TENANT_ID,
} from "@/lib/authority-context";
import {
  DEFAULT_OPERATING_PROFILE,
  domainsForProfile,
  isOperatingProfileId,
  normalizeTransportModes,
  OPERATING_PROFILE_CATALOG,
  profileForDomains,
  transportModesForProfile,
  type OperatingProfileId,
} from "@/lib/tenant-operating-model";

export const dynamic = "force-dynamic";

type TenantPayload = {
  tenantId?: unknown;
  name?: unknown;
  slug?: unknown;
  operatingProfile?: unknown;
  operatingDomains?: unknown;
  transportModes?: unknown;
};

function errorCode(error: unknown) {
  const message = error instanceof Error ? error.message : "unexpected_error";
  if (message.includes("no such table") || message.includes("tenant_")) {
    return "tenant_store_unavailable";
  }
  return "tenant_directory_unavailable";
}

function tenantRows(identityProvider: IdentityProvider, actorId: string) {
  const db = getDb();
  return db
    .select({
      membershipId: tenantMemberships.id,
      membershipRole: tenantMemberships.role,
      membershipStatus: tenantMemberships.status,
      tenantId: tenants.id,
      slug: tenants.slug,
      name: tenants.name,
      tenantStatus: tenants.status,
      operatingProfile: tenants.operatingProfile,
      operatingDomainsJson: tenants.operatingDomainsJson,
      operatingTransportModesJson: tenants.operatingTransportModesJson,
      createdBy: tenants.createdBy,
      createdAt: tenants.createdAt,
      updatedAt: tenants.updatedAt,
    })
    .from(tenantMemberships)
    .innerJoin(tenants, eq(tenantMemberships.tenantId, tenants.id))
    .where(
      and(
        eq(tenantMemberships.identityProvider, identityProvider),
        eq(tenantMemberships.actorId, actorId),
        eq(tenantMemberships.status, "active"),
        eq(tenants.status, "active"),
      ),
    )
    .orderBy(asc(tenants.createdAt));
}

function toTenantView(row: Awaited<ReturnType<typeof tenantRows>>[number]) {
  return {
    id: row.tenantId,
    slug: row.slug,
    name: row.name,
    status: row.tenantStatus,
    membershipId: row.membershipId,
    role: row.membershipRole,
    membershipStatus: row.membershipStatus,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    operatingProfile: row.operatingProfile,
    operatingDomains: (() => {
      try {
        const parsed = JSON.parse(row.operatingDomainsJson) as unknown;
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
      } catch {
        return [];
      }
    })(),
    transportModes: (() => {
      try {
        const parsed = JSON.parse(row.operatingTransportModesJson) as unknown;
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
      } catch {
        return [];
      }
    })(),
  };
}

function requireOwner() {
  return getAuthorityContext().then((context) => {
    if (!context) {
      return {
        context: null,
        response: Response.json({ error: "unauthenticated" }, { status: 401 }),
      };
    }
    if (!hasCapability(context, "tenant.manage")) {
      return {
        context: null,
        response: Response.json({ error: "forbidden" }, { status: 403 }),
      };
    }
    return { context, response: null };
  });
}

export async function GET() {
  const { context, response } = await requireOwner();
  if (response) return response;

  try {
    const rows = await tenantRows(context!.identityProvider, context!.actorId);
    return Response.json({
      context: publicAuthorityContext(context!),
      canonicalTenantId: context!.tenantId,
      provisioned: rows.length > 0,
      tenants: rows.map(toTenantView),
    });
  } catch (error) {
    return Response.json({ error: errorCode(error) }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const { context, response } = await requireOwner();
  if (response) return response;

  let payload: TenantPayload = {};
  try {
    payload = (await request.json()) as TenantPayload;
  } catch {
    return Response.json({ error: "tenant_registration_payload_required" }, { status: 400 });
  }

  const requestedTenantId = typeof payload.tenantId === "string" ? payload.tenantId.trim() : "";
  if (requestedTenantId) {
    const rows = await tenantRows(context!.identityProvider, context!.actorId);
    const selected = rows.find((row) => row.tenantId === requestedTenantId);
    if (!selected) return Response.json({ error: "cross_tenant_access_denied" }, { status: 403 });
    const response = NextResponse.json({ context: publicAuthorityContext(context!), selectedTenant: toTenantView(selected), tenants: rows.map(toTenantView) });
    response.cookies.set({ name: "zerow_tenant_id", value: selected.tenantId, httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
    return response;
  }

  const name = typeof payload.name === "string" && payload.name.trim().length > 0
    ? payload.name.trim()
    : "";
  const slug = typeof payload.slug === "string" && payload.slug.trim().length > 0
    ? payload.slug.trim().toLowerCase()
    : "";

  if (name.length < 2 || name.length > 120) {
    return Response.json({ error: "name_must_be_2_to_120_characters" }, { status: 400 });
  }
  if (!/^[a-z0-9][a-z0-9-]{2,62}$/.test(slug)) {
    return Response.json({ error: "slug_must_be_lowercase_kebab_case" }, { status: 400 });
  }

  const requestedProfile = typeof payload.operatingProfile === "string" ? payload.operatingProfile.trim() : "";
  const operatingProfile: OperatingProfileId = requestedProfile
    ? isOperatingProfileId(requestedProfile) ? requestedProfile : DEFAULT_OPERATING_PROFILE
    : profileForDomains(payload.operatingDomains);
  if (requestedProfile && !isOperatingProfileId(requestedProfile)) {
    return Response.json({ error: "invalid_operating_profile", profiles: Object.keys(OPERATING_PROFILE_CATALOG) }, { status: 400 });
  }
  const operatingDomains = domainsForProfile(operatingProfile);
  const requestedTransportModes = normalizeTransportModes(payload.transportModes);
  const operatingTransportModes = requestedTransportModes.length
    ? requestedTransportModes.filter((mode) => transportModesForProfile(operatingProfile).includes(mode))
    : transportModesForProfile(operatingProfile);
  if (requestedTransportModes.length !== operatingTransportModes.length) {
    return Response.json({ error: "transport_mode_not_available_for_profile", transportModes: transportModesForProfile(operatingProfile) }, { status: 400 });
  }

  try {
    const db = getDb();
    const existing = await tenantRows(context!.identityProvider, context!.actorId);
    const now = new Date().toISOString();
    const tenantId = existing.length === 0 && context!.tenantId === SITES_TENANT_ID
      ? context!.tenantId
      : `tenant:${crypto.randomUUID()}`;
    await db
      .insert(tenants)
      .values({
        id: tenantId,
        slug,
        name,
        status: "active",
        operatingProfile,
        operatingDomainsJson: JSON.stringify(operatingDomains),
        operatingTransportModesJson: JSON.stringify(operatingTransportModes),
        createdBy: context!.actorId,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();

    await db
      .insert(tenantMemberships)
      .values({
        id: `tenant-owner:${tenantId}:${context!.identityProvider}:${context!.actorId}`,
        tenantId,
        identityProvider: context!.identityProvider,
        actorId: context!.actorId,
        actorEmail: context!.actorEmail,
        displayName: context!.actorName,
        role: "owner",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();

    const rows = await tenantRows(context!.identityProvider, context!.actorId);
    const response = NextResponse.json(
      {
        context: publicAuthorityContext(context!),
        canonicalTenantId: tenantId,
        provisioned: rows.length > 0,
        created: true,
        tenants: rows.map(toTenantView),
      },
      { status: 201 },
    );
    response.cookies.set({ name: "zerow_tenant_id", value: tenantId, httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
    return response;
  } catch (error) {
    if (error instanceof Error && /unique|constraint/i.test(error.message)) return Response.json({ error: "tenant_slug_already_exists" }, { status: 409 });
    return Response.json({ error: errorCode(error) }, { status: 503 });
  }
}
