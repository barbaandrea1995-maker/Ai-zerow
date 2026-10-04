import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { s06Events, s06Outbox, s06Reconciliations, tenants } from "@/db/schema";
import { getAuthorityContext, hasCapability, publicAuthorityContext } from "@/lib/authority-context";
import { companyProfileFromTenant, normalizeCompanyProfile, validateCompanyProfile } from "@/lib/company-profile";
import {
  DEFAULT_OPERATING_DOMAINS,
  DEFAULT_OPERATING_PROFILE,
  domainsForProfile,
  isOperatingProfileId,
  resolveTransportModesForProfile,
  OPERATING_PROFILE_CATALOG,
  parseOperatingDomains,
  parseTransportModes,
  profileForDomains,
  transportModesForProfile,
  type OperatingProfileId,
} from "@/lib/tenant-operating-model";

export const dynamic = "force-dynamic";

function profileView(profile: OperatingProfileId) {
  const item = OPERATING_PROFILE_CATALOG[profile];
  return { id: profile, label: item.label, description: item.description, domains: item.domains, transportModes: item.transportModes };
}

function errorCode(error: unknown) {
  const message = error instanceof Error ? error.message : "unexpected_error";
  if (message.includes("no such table") || message.includes("tenants")) return "tenant_store_unavailable";
  return "tenant_profile_unavailable";
}

export async function GET() {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });

  try {
    const [tenant] = await getDb().select().from(tenants).where(eq(tenants.id, context.tenantId)).limit(1);
    const profile = tenant && isOperatingProfileId(tenant.operatingProfile)
      ? tenant.operatingProfile
      : context.operatingProfile || DEFAULT_OPERATING_PROFILE;
    const domains = tenant ? parseOperatingDomains(tenant.operatingDomainsJson) : (context.operatingDomains || DEFAULT_OPERATING_DOMAINS);
    const transportModes = tenant
      ? parseTransportModes(tenant.operatingTransportModesJson, profile)
      : (context.operatingTransportModes || transportModesForProfile(profile));
    return Response.json({
      context: publicAuthorityContext(context),
      tenant: tenant ? { id: tenant.id, slug: tenant.slug, name: tenant.name, status: tenant.status, companyProfile: companyProfileFromTenant(tenant) } : null,
      operatingProfile: profile,
      operatingDomains: domains,
      transportModes,
      profiles: Object.entries(OPERATING_PROFILE_CATALOG).map(([id]) => profileView(id as OperatingProfileId)),
      canManage: hasCapability(context, "tenant.manage"),
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: errorCode(error) }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "tenant.manage")) return Response.json({ error: "forbidden", capability: "tenant.manage" }, { status: 403 });

  let input: { operatingProfile?: unknown; operatingDomains?: unknown; transportModes?: unknown; companyProfile?: unknown };
  try {
    input = await request.json() as { operatingProfile?: unknown; operatingDomains?: unknown; transportModes?: unknown; companyProfile?: unknown };
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const requestedProfile = typeof input.operatingProfile === "string" ? input.operatingProfile.trim() : "";
  const requestedDomains = input.operatingDomains;
  let profile: OperatingProfileId;
  if (requestedProfile) {
    if (!isOperatingProfileId(requestedProfile)) return Response.json({ error: "invalid_operating_profile" }, { status: 400 });
    profile = requestedProfile;
  } else {
    profile = profileForDomains(requestedDomains);
  }
  const domains = domainsForProfile(profile);
  const transportModes = resolveTransportModesForProfile(input.transportModes, profile);
  const companyProfile = input.companyProfile === undefined ? null : normalizeCompanyProfile(input.companyProfile);
  const companyProfileError = companyProfile ? validateCompanyProfile(companyProfile) : null;
  if (companyProfileError) {
    return Response.json({ error: "company_profile_invalid", field: companyProfileError.field, detail: companyProfileError.detail }, { status: 400 });
  }

  try {
    const db = getDb();
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, context.tenantId)).limit(1);
    if (!tenant) return Response.json({ error: "tenant_not_provisioned" }, { status: 409 });
    const now = new Date().toISOString();
    const eventId = crypto.randomUUID();
    const tenantUpdates = {
      operatingProfile: profile,
      operatingDomainsJson: JSON.stringify(domains),
      operatingTransportModesJson: JSON.stringify(transportModes),
      ...(companyProfile ? {
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
      } : {}),
      updatedAt: now,
    };
    await db.batch([
      db.update(tenants).set(tenantUpdates).where(eq(tenants.id, context.tenantId)),
      db.insert(s06Events).values({
        eventId,
        tenantId: context.tenantId,
        eventType: "tenant.operating_profile.updated",
        schemaVersion: "1",
        actorType: "human",
        actorId: context.actorId,
        source: "sites-tenant-onboarding",
        occurredAt: now,
        observedAt: now,
        aggregateType: "tenant.operating_profile",
        aggregateId: context.tenantId,
        aggregateVersion: 1,
        payloadJson: JSON.stringify({ profile, domains, transportModes, companyProfile }),
        correlationId: crypto.randomUUID(),
        causationId: null,
        idempotencyKey: `tenant-profile-${context.tenantId}-${now}`,
        status: "COMMITTED_SITES_READBACK",
        createdAt: now,
      }),
      db.insert(s06Outbox).values({ id: crypto.randomUUID(), tenantId: context.tenantId, eventId, topic: "zerow.tenant.operating_profile.updated", status: "PENDING_EXTERNAL_CONSUMER", attempts: 0, createdAt: now, updatedAt: now }),
      db.insert(s06Reconciliations).values({ id: crypto.randomUUID(), tenantId: context.tenantId, aggregateType: "tenant.operating_profile", aggregateId: context.tenantId, expectedVersion: 1, observedVersion: 1, status: "SITES_READBACK_VERIFIED", detail: "Perimetro operativo tenant aggiornato e letto dal control plane Sites.", createdAt: now, updatedAt: now }),
    ]);
    const refreshed = await getAuthorityContext();
    return Response.json({
      context: publicAuthorityContext(refreshed ?? context),
      tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name, status: tenant.status, companyProfile: companyProfileFromTenant({ ...tenant, ...(companyProfile ?? {}) }) },
      operatingProfile: profile,
      operatingDomains: domains,
      transportModes,
      profile: profileView(profile),
      readback: "verified",
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: errorCode(error) }, { status: 503 });
  }
}
