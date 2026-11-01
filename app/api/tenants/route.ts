import { and, asc, eq, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { tenantMemberships, tenants } from "@/db/schema";
import {
  type IdentityProvider,
  getAuthenticatedIdentity,
  getAuthorityContext,
  hasCapability,
  publicAuthorityContext,
  SITES_TENANT_ID,
} from "@/lib/authority-context";
import {
  DEFAULT_OPERATING_PROFILE,
  domainsForProfile,
  isOperatingProfileId,
  resolveTransportModesForProfile,
  OPERATING_PROFILE_CATALOG,
  profileForDomains,
  type OperatingProfileId,
} from "@/lib/tenant-operating-model";
import { normalizeAuthorityRoles } from "@/lib/authority-catalog";
import { companyProfileFromTenant, normalizeCompanyProfile, validateCompanyProfile } from "@/lib/company-profile";

export const dynamic = "force-dynamic";

type TenantPayload = {
  tenantId?: unknown;
  name?: unknown;
  slug?: unknown;
  operatingProfile?: unknown;
  operatingDomains?: unknown;
  transportModes?: unknown;
  companyProfile?: unknown;
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
      membershipRolesJson: tenantMemberships.rolesJson,
      membershipStatus: tenantMemberships.status,
      tenantId: tenants.id,
      slug: tenants.slug,
      name: tenants.name,
      tenantStatus: tenants.status,
      operatingProfile: tenants.operatingProfile,
      operatingDomainsJson: tenants.operatingDomainsJson,
      operatingTransportModesJson: tenants.operatingTransportModesJson,
      legalForm: tenants.legalForm,
      vatNumber: tenants.vatNumber,
      taxCode: tenants.taxCode,
      reaNumber: tenants.reaNumber,
      registeredAddress: tenants.registeredAddress,
      registeredPostalCode: tenants.registeredPostalCode,
      registeredCity: tenants.registeredCity,
      registeredProvince: tenants.registeredProvince,
      registeredCountry: tenants.registeredCountry,
      businessEmail: tenants.businessEmail,
      businessPhone: tenants.businessPhone,
      pecEmail: tenants.pecEmail,
      sdiCode: tenants.sdiCode,
      website: tenants.website,
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
        or(eq(tenants.status, "active"), eq(tenants.status, "onboarding")),
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
    roles: normalizeAuthorityRoles(row.membershipRolesJson, row.membershipRole),
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
    companyProfile: companyProfileFromTenant(row),
  };
}

async function requireOwner() {
  const context = await getAuthorityContext();
  if (context && hasCapability(context, "tenant.manage")) {
    return { context, identity: null, initialSetup: false, response: null };
  }

  // A freshly registered Neon account has no membership yet. This is the
  // only state in which the browser may start primary onboarding without an
  // existing tenant owner context.
  const identity = await getAuthenticatedIdentity();
  if (identity) {
    try {
      const rows = await tenantRows(identity.identityProvider, identity.actorId);
      if (rows.length === 0) {
        return { context: null, identity, initialSetup: true, response: null };
      }
    } catch (error) {
      // A missing/unavailable tenant registry is an infrastructure boundary,
      // not an unhandled application error. Fail closed and return a bounded
      // server-side code so onboarding can show a retryable state.
      return {
        context: null,
        identity: null,
        initialSetup: false,
        response: Response.json({ error: errorCode(error) }, { status: 503 }),
      };
    }
  }

  if (!context) {
    return {
      context: null,
      identity: null,
      initialSetup: false,
      response: Response.json({ error: "unauthenticated" }, { status: 401 }),
    };
  }

  return {
    context: null,
    identity: null,
    initialSetup: false,
    response: Response.json({ error: "forbidden" }, { status: 403 }),
  };
}

export async function GET() {
  const gate = await requireOwner();
  if (gate.response) return gate.response;

  if (gate.initialSetup) {
    return Response.json({
      context: null,
      canonicalTenantId: null,
      provisioned: false,
      setupRequired: true,
      identity: gate.identity ? { displayName: gate.identity.actorName, email: gate.identity.actorEmail } : null,
      tenants: [],
    }, { headers: { "cache-control": "private, no-store" } });
  }

  const ownerContext = gate.context!;

  try {
    const rows = await tenantRows(ownerContext.identityProvider, ownerContext.actorId);
    return Response.json({
      context: publicAuthorityContext(ownerContext),
      canonicalTenantId: ownerContext.tenantId,
      provisioned: rows.length > 0,
      setupRequired: ownerContext.tenantStatus === "onboarding",
      tenants: rows.map(toTenantView),
    });
  } catch (error) {
    return Response.json({ error: errorCode(error) }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const gate = await requireOwner();
  if (gate.response) return gate.response;
  const context = gate.context;

  let payload: TenantPayload = {};
  try {
    payload = (await request.json()) as TenantPayload;
  } catch {
    return Response.json({ error: "tenant_registration_payload_required" }, { status: 400 });
  }

  const requestedTenantId = typeof payload.tenantId === "string" ? payload.tenantId.trim() : "";
  if (requestedTenantId) {
    if (!context) return Response.json({ error: "tenant_selection_requires_membership" }, { status: 403 });
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
  const operatingTransportModes = resolveTransportModesForProfile(payload.transportModes, operatingProfile);
  const companyProfile = normalizeCompanyProfile(payload.companyProfile);
  const companyProfileError = validateCompanyProfile(companyProfile);
  if (companyProfileError) {
    return Response.json({ error: "company_profile_invalid", field: companyProfileError.field, detail: companyProfileError.detail }, { status: 400 });
  }

  try {
    const db = getDb();
    const actor = context ?? gate.identity;
    if (!actor) return Response.json({ error: "authenticated_identity_required" }, { status: 401 });
    const existing = await tenantRows(actor.identityProvider, actor.actorId);
    const accessibleTenant = existing.find((row) => row.slug === slug);
    if (accessibleTenant) {
      const response = NextResponse.json({
        context: context ? publicAuthorityContext(context) : null,
        canonicalTenantId: accessibleTenant.tenantId,
        provisioned: true,
        setupRequired: accessibleTenant.tenantStatus === "onboarding",
        created: false,
        selectedTenant: toTenantView(accessibleTenant),
        tenants: existing.map(toTenantView),
        readback: "verified",
      });
      response.cookies.set({ name: "zerow_tenant_id", value: accessibleTenant.tenantId, httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
      return response;
    }

    const [claimedSlug] = await db.select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, slug))
      .limit(1);
    if (claimedSlug) {
      return Response.json({ error: "tenant_slug_already_exists" }, { status: 409 });
    }

    const now = new Date().toISOString();
    const tenantId = existing.length === 0 && actor.identityProvider === "sites" && actor.actorId === context?.actorId && context?.tenantId === SITES_TENANT_ID
      ? context!.tenantId
      : `tenant:${crypto.randomUUID()}`;
    await db.batch([
      db.insert(tenants).values({
        id: tenantId,
        slug,
        name,
        legalForm: companyProfile.legalForm,
        vatNumber: companyProfile.vatNumber,
        taxCode: companyProfile.taxCode,
        reaNumber: companyProfile.reaNumber || null,
        registeredAddress: companyProfile.registeredAddress,
        registeredPostalCode: companyProfile.registeredPostalCode,
        registeredCity: companyProfile.registeredCity,
        registeredProvince: companyProfile.registeredProvince,
        registeredCountry: companyProfile.registeredCountry,
        businessEmail: companyProfile.businessEmail,
        businessPhone: companyProfile.businessPhone,
        pecEmail: companyProfile.pecEmail || null,
        sdiCode: companyProfile.sdiCode || null,
        website: companyProfile.website || null,
        status: "onboarding",
        operatingProfile,
        operatingDomainsJson: JSON.stringify(operatingDomains),
        operatingTransportModesJson: JSON.stringify(operatingTransportModes),
        createdBy: actor.actorId,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(tenantMemberships).values({
        id: `tenant-owner:${tenantId}:${actor.identityProvider}:${actor.actorId}`,
        tenantId,
        identityProvider: actor.identityProvider,
        actorId: actor.actorId,
        actorEmail: actor.actorEmail,
        displayName: actor.actorName,
        role: "owner",
        rolesJson: '["owner"]',
        status: "active",
        createdAt: now,
        updatedAt: now,
      }),
    ] as const);

    const rows = await tenantRows(actor.identityProvider, actor.actorId);
    const createdTenant = rows.find((row) => row.tenantId === tenantId);
    if (!createdTenant || createdTenant.membershipRole !== "owner" || createdTenant.membershipStatus !== "active") {
      return Response.json({ error: "tenant_readback_unavailable" }, { status: 503 });
    }
    const createdContext = await getAuthorityContext();
    const response = NextResponse.json(
      {
        context: createdContext ? publicAuthorityContext(createdContext) : null,
        canonicalTenantId: tenantId,
        provisioned: true,
        setupRequired: createdTenant.tenantStatus === "onboarding",
        created: true,
        selectedTenant: toTenantView(createdTenant),
        tenants: rows.map(toTenantView),
        readback: "verified",
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
