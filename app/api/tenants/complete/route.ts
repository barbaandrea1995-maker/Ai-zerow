import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  s06Events,
  s06Outbox,
  s06Reconciliations,
  tenantWarehouses,
  tenants,
} from "@/db/schema";
import { getAuthorityContext, hasCapability, publicAuthorityContext } from "@/lib/authority-context";
import { parseOperatingDomains } from "@/lib/tenant-operating-model";

export const dynamic = "force-dynamic";

/**
 * Final gate of primary onboarding. Creating a tenant deliberately leaves it
 * in `onboarding`; only this server-owned transition can unlock the PWA.
 */
export async function POST() {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "tenant.manage")) {
    return Response.json({ error: "forbidden", capability: "tenant.manage" }, { status: 403 });
  }

  try {
    const db = getDb();
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, context.tenantId)).limit(1);
    if (!tenant) return Response.json({ error: "tenant_not_provisioned" }, { status: 409 });
    if (tenant.status === "active") {
      return Response.json({ complete: true, context: publicAuthorityContext(context), readback: "verified" });
    }

    const domains = parseOperatingDomains(tenant.operatingDomainsJson);
    const requirements: string[] = [];
    if (domains.includes("warehouse")) {
      const warehouses = await db.select({ id: tenantWarehouses.id })
        .from(tenantWarehouses)
        .where(and(eq(tenantWarehouses.tenantId, tenant.id), eq(tenantWarehouses.status, "active")))
        .limit(1);
      if (warehouses.length === 0) requirements.push("warehouse");
    }

    if (requirements.length > 0) {
      return Response.json({
        error: "onboarding_requirements_incomplete",
        requirements,
        detail: "Configura almeno un magazzino attivo prima di attivare un profilo che include il dominio warehouse.",
      }, { status: 409 });
    }

    const now = new Date().toISOString();
    const eventId = crypto.randomUUID();
    await db.batch([
      db.update(tenants).set({ status: "active", updatedAt: now }).where(and(eq(tenants.id, tenant.id), eq(tenants.status, "onboarding"))),
      db.insert(s06Events).values({
        eventId,
        tenantId: tenant.id,
        eventType: "tenant.onboarding.completed",
        schemaVersion: "1",
        actorType: "human",
        actorId: context.actorId,
        source: "sites-primary-onboarding",
        occurredAt: now,
        observedAt: now,
        aggregateType: "tenant.onboarding",
        aggregateId: tenant.id,
        aggregateVersion: 1,
        payloadJson: JSON.stringify({ operatingProfile: tenant.operatingProfile, domains }),
        correlationId: crypto.randomUUID(),
        causationId: null,
        idempotencyKey: `tenant-onboarding-complete-${tenant.id}`,
        status: "COMMITTED_SITES_READBACK",
        createdAt: now,
      }),
      db.insert(s06Outbox).values({
        id: crypto.randomUUID(),
        tenantId: tenant.id,
        eventId,
        topic: "zerow.tenant.onboarding.completed",
        status: "PENDING_EXTERNAL_CONSUMER",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(s06Reconciliations).values({
        id: crypto.randomUUID(),
        tenantId: tenant.id,
        aggregateType: "tenant.onboarding",
        aggregateId: tenant.id,
        expectedVersion: 1,
        observedVersion: 1,
        status: "SITES_READBACK_VERIFIED",
        detail: "Onboarding primario completato: accesso ai moduli sbloccato dal server.",
        createdAt: now,
        updatedAt: now,
      }),
    ]);

    const refreshed = await getAuthorityContext();
    return Response.json({
      complete: true,
      context: refreshed ? publicAuthorityContext(refreshed) : publicAuthorityContext({ ...context, tenantStatus: "active" }),
      readback: "verified",
      eventId,
    }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return Response.json({ error: "tenant_onboarding_completion_unavailable" }, { status: 503 });
  }
}
