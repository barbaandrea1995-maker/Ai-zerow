import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { tenantMemberships, tenants } from "@/db/schema";
import {
  getAuthorityContext,
  hasCapability,
  publicAuthorityContext,
} from "@/lib/authority-context";

export const dynamic = "force-dynamic";

const DEFAULT_TENANT_NAME = "EMS EDILIZIA MULTISERVIZI SRLS";
const DEFAULT_TENANT_SLUG = "ems-edilizia-multiservizi";

type TenantPayload = {
  name?: unknown;
  slug?: unknown;
};

function errorCode(error: unknown) {
  const message = error instanceof Error ? error.message : "unexpected_error";
  if (message.includes("no such table") || message.includes("tenant_")) {
    return "tenant_store_unavailable";
  }
  return "tenant_directory_unavailable";
}

function tenantRows(actorId: string) {
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
      createdBy: tenants.createdBy,
      createdAt: tenants.createdAt,
      updatedAt: tenants.updatedAt,
    })
    .from(tenantMemberships)
    .innerJoin(tenants, eq(tenantMemberships.tenantId, tenants.id))
    .where(
      and(
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
    const rows = await tenantRows(context!.actorId);
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
    // An empty body is valid: it provisions the canonical EMS tenant.
  }

  const name = typeof payload.name === "string" && payload.name.trim().length > 0
    ? payload.name.trim()
    : DEFAULT_TENANT_NAME;
  const slug = typeof payload.slug === "string" && payload.slug.trim().length > 0
    ? payload.slug.trim().toLowerCase()
    : DEFAULT_TENANT_SLUG;

  if (name.length < 2 || name.length > 120) {
    return Response.json({ error: "name_must_be_2_to_120_characters" }, { status: 400 });
  }
  if (!/^[a-z0-9][a-z0-9-]{2,62}$/.test(slug)) {
    return Response.json({ error: "slug_must_be_lowercase_kebab_case" }, { status: 400 });
  }

  try {
    const db = getDb();
    const existing = await tenantRows(context!.actorId);
    if (existing.length > 0) {
      return Response.json({
        context: publicAuthorityContext(context!),
        provisioned: true,
        created: false,
        tenants: existing.map(toTenantView),
      });
    }

    const now = new Date().toISOString();
    await db
      .insert(tenants)
      .values({
        id: context!.tenantId,
        slug,
        name,
        status: "active",
        createdBy: context!.actorId,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();

    await db
      .insert(tenantMemberships)
      .values({
        id: `site-owner:${context!.tenantId}:${context!.actorId}`,
        tenantId: context!.tenantId,
        actorId: context!.actorId,
        actorEmail: context!.actorEmail,
        displayName: context!.actorName,
        role: "owner",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();

    const rows = await tenantRows(context!.actorId);
    return Response.json(
      {
        context: publicAuthorityContext(context!),
        canonicalTenantId: context!.tenantId,
        provisioned: rows.length > 0,
        created: true,
        tenants: rows.map(toTenantView),
      },
      { status: 201 },
    );
  } catch (error) {
    return Response.json({ error: errorCode(error) }, { status: 503 });
  }
}
