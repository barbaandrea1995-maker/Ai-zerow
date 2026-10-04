import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { deliveryEvents, locationEvents, routePlans, routeStops, s06Events, s06Outbox, s06Reconciliations } from "@/db/schema";
import { getAuthorityContext, hasCapability, publicAuthorityContext } from "@/lib/authority-context";
import { auditLocationAccess } from "@/lib/location-intelligence/repository";
import { DELIVERY_EVIDENCE_TYPES } from "@/lib/location-intelligence/types";

export const dynamic = "force-dynamic";

type JsonObject = Record<string, unknown>;

function bounded(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function GET() {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const capability = hasCapability(context, "location.read.history") ? "location.read.history" : hasCapability(context, "mission.read") ? "mission.read" : null;
  if (!capability) return Response.json({ error: "forbidden", capability: "location.read.history" }, { status: 403 });
  try {
    const rows = await getDb().select().from(deliveryEvents).where(eq(deliveryEvents.tenantId, context.tenantId)).orderBy(desc(deliveryEvents.occurredAt)).limit(300);
    await auditLocationAccess({ context, capability, action: "READ", resourceType: "DELIVERY_EVENTS", purpose: "Consultazione delle evidenze di consegna.", metadata: { returned: rows.length } });
    return Response.json({ context: publicAuthorityContext(context), deliveries: rows.map((row) => ({ ...row, tenantId: undefined })), readback: { status: "verified", scope: "tenant", checkedAt: new Date().toISOString() } }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return Response.json({ error: "delivery_readback_unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "mission.write")) return Response.json({ error: "forbidden", capability: "mission.write" }, { status: 403 });
  let input: JsonObject;
  try {
    const parsed = await request.json() as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return Response.json({ error: "invalid_json" }, { status: 400 });
    input = parsed as JsonObject;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const routeStopId = bounded(input.routeStopId, 160);
  const evidenceType = bounded(input.evidenceType, 48).toUpperCase();
  const evidenceReference = bounded(input.evidenceReference ?? input.evidenceId, 240);
  const idempotencyKey = bounded(input.idempotencyKey, 160);
  if (!routeStopId || !evidenceType || idempotencyKey.length < 8) return Response.json({ error: "route_stop_evidence_idempotency_required" }, { status: 400 });
  if (!(DELIVERY_EVIDENCE_TYPES as readonly string[]).includes(evidenceType)) return Response.json({ error: "unsupported_delivery_evidence", allowed: DELIVERY_EVIDENCE_TYPES }, { status: 400 });

  try {
    const db = getDb();
    const [existing] = await db.select().from(deliveryEvents).where(and(eq(deliveryEvents.tenantId, context.tenantId), eq(deliveryEvents.idempotencyKey, idempotencyKey))).limit(1);
    if (existing) return Response.json({ context: publicAuthorityContext(context), delivery: existing, idempotent: true }, { headers: { "cache-control": "private, no-store" } });
    const [stop] = await db.select().from(routeStops).where(and(eq(routeStops.tenantId, context.tenantId), eq(routeStops.id, routeStopId))).limit(1);
    if (!stop) return Response.json({ error: "route_stop_not_found" }, { status: 404 });
    const [plan] = await db.select().from(routePlans).where(and(eq(routePlans.tenantId, context.tenantId), eq(routePlans.id, stop.routePlanId))).limit(1);
    if (!plan) return Response.json({ error: "route_plan_not_found" }, { status: 404 });
    const canConfirmForOthers = hasCapability(context, "workforce.manage") || hasCapability(context, "authority.manage");
    if (!canConfirmForOthers && plan.driverId !== context.actorId) return Response.json({ error: "delivery_scope_forbidden" }, { status: 403 });
    const arrivals = await db.select().from(locationEvents).where(and(
      eq(locationEvents.tenantId, context.tenantId),
      eq(locationEvents.locationId, stop.locationId),
      eq(locationEvents.vehicleId, plan.vehicleId),
      inArray(locationEvents.eventType, ["SITE_ARRIVAL", "CUSTOMER_ARRIVAL", "WAREHOUSE_ARRIVAL", "SUPPLIER_ARRIVAL", "GEOFENCE_ENTER_CONFIRMED"]),
    )).orderBy(desc(locationEvents.occurredAt)).limit(1);
    if (!arrivals[0]) return Response.json({ error: "confirmed_geofence_arrival_required", message: "La presenza GPS non conferma da sola la consegna: prima serve un arrivo geofence confermato sul mezzo pianificato." }, { status: 409 });

    const now = new Date().toISOString();
    const deliveryId = `DELIVERY-EVENT-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
    const locationEventId = `LOCATION-EVENT-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
    const eventId = crypto.randomUUID();
    const evidence = JSON.stringify({ evidenceType, evidenceReference, arrivalEventId: arrivals[0].id, confirmedBy: context.actorId, rule: "GPS_ARRIVAL_NEVER_EQUALS_DELIVERY" });
    await db.batch([
      db.insert(deliveryEvents).values({ id: deliveryId, tenantId: context.tenantId, routeStopId, missionId: plan.missionId, jobId: plan.jobId, eventType: "DELIVERY_CONFIRMED", evidenceType, evidenceReference, occurredAt: bounded(input.occurredAt, 40) || now, confirmedBy: context.actorId, idempotencyKey, createdAt: now }),
      db.insert(locationEvents).values({ id: locationEventId, tenantId: context.tenantId, eventType: "DELIVERY_CONFIRMED", occurredAt: bounded(input.occurredAt, 40) || now, trackingSessionId: arrivals[0].trackingSessionId, employeeId: arrivals[0].employeeId, vehicleId: plan.vehicleId, locationId: stop.locationId, geofenceId: arrivals[0].geofenceId, source: "HUMAN_EVIDENCE_WITH_DETERMINISTIC_ARRIVAL", confidenceMilli: 1000, evidenceJson: evidence, correlationId: crypto.randomUUID(), dedupeKey: `delivery-confirmed:${context.tenantId}:${idempotencyKey}`, createdAt: now }),
      db.update(routeStops).set({ status: "COMPLETED", deliveryStatus: "CONFIRMED", arrivedAt: stop.arrivedAt ?? arrivals[0].occurredAt, departedAt: stop.departedAt, evidenceJson: evidence, updatedAt: now }).where(and(eq(routeStops.tenantId, context.tenantId), eq(routeStops.id, routeStopId))),
      db.insert(s06Events).values({ eventId, tenantId: context.tenantId, eventType: "location.delivery.confirmed", schemaVersion: "1", actorType: "human", actorId: context.actorId, source: "sites-location-intelligence", occurredAt: now, observedAt: now, aggregateType: "delivery.event", aggregateId: deliveryId, aggregateVersion: 1, payloadJson: evidence, correlationId: crypto.randomUUID(), causationId: null, idempotencyKey, status: "COMMITTED_SITES_READBACK", createdAt: now }),
      db.insert(s06Outbox).values({ id: crypto.randomUUID(), tenantId: context.tenantId, eventId, topic: "zerow.location.delivery.confirmed", status: "PENDING_EXTERNAL_CONSUMER", attempts: 0, createdAt: now, updatedAt: now }),
      db.insert(s06Reconciliations).values({ id: crypto.randomUUID(), tenantId: context.tenantId, aggregateType: "delivery.event", aggregateId: deliveryId, expectedVersion: 1, observedVersion: 1, status: "SITES_READBACK_VERIFIED", detail: "Consegna confermata da evidenza umana/operativa e arrivo geofence già confermato; GPS da solo non è stato promosso.", createdAt: now, updatedAt: now }),
    ]);
    const [delivery] = await db.select().from(deliveryEvents).where(and(eq(deliveryEvents.tenantId, context.tenantId), eq(deliveryEvents.id, deliveryId))).limit(1);
    if (!delivery) return Response.json({ error: "delivery_readback_unavailable" }, { status: 503 });
    return Response.json({ context: publicAuthorityContext(context), delivery, arrivalEvidence: { eventId: arrivals[0].id, occurredAt: arrivals[0].occurredAt }, readback: "verified" }, { status: 201, headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/unique|constraint/i.test(message)) return Response.json({ error: "delivery_idempotency_conflict" }, { status: 409 });
    return Response.json({ error: "delivery_write_unavailable" }, { status: 503 });
  }
}
