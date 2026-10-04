import { and, desc, eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { getDb } from "@/db";
import { jobJourneyRecords, locationEvents, s06Events, s06Outbox, s06Reconciliations, trackingDevices, trackingSessions, vehicleDeviceBindings } from "@/db/schema";
import { getAuthorityContext, hasCapability, publicAuthorityContext } from "@/lib/authority-context";
import { auditLocationAccess, parseJsonObject, sessionForResponse } from "@/lib/location-intelligence/repository";
import { isTrackingSource } from "@/lib/location-intelligence/types";

export const dynamic = "force-dynamic";

type JsonObject = Record<string, unknown>;

function bounded(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function responseHeaders() {
  return { "cache-control": "private, no-store" };
}

function canManageOther(context: Awaited<ReturnType<typeof getAuthorityContext>>) {
  return Boolean(context && (hasCapability(context, "workforce.manage") || hasCapability(context, "location.manage.tracking.devices")));
}

export async function GET() {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const capability = hasCapability(context, "location.read.history")
    ? "location.read.history"
    : hasCapability(context, "location.read.current") ? "location.read.current" : null;
  if (!capability) return Response.json({ error: "forbidden", capability: "location.read.current" }, { status: 403 });
  try {
    const db = getDb();
    const rows = await db.select().from(trackingSessions)
      .where(eq(trackingSessions.tenantId, context.tenantId))
      .orderBy(desc(trackingSessions.startedAt))
      .limit(300);
    const visible = canManageOther(context) ? rows : rows.filter((row) => row.employeeId === context.actorId);
    await auditLocationAccess({ context, capability, action: "READ", resourceType: "TRACKING_SESSIONS", purpose: "Consultazione delle sessioni di tracking autorizzate.", metadata: { returned: visible.length, filteredToActor: !canManageOther(context) } });
    return Response.json({ context: publicAuthorityContext(context), sessions: visible.map(sessionForResponse), readback: { status: "verified", scope: "tenant", checkedAt: new Date().toISOString() } }, { headers: responseHeaders() });
  } catch {
    return Response.json({ error: "tracking_session_readback_unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  let input: JsonObject;
  try {
    const parsed = await request.json() as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return Response.json({ error: "invalid_json" }, { status: 400 });
    input = parsed as JsonObject;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const action = bounded(input.action, 20).toLowerCase();
  if (action !== "start" && action !== "close" && action !== "pause") return Response.json({ error: "unsupported_tracking_session_action", allowed: ["start", "pause", "close"] }, { status: 400 });
  const idempotencyKey = bounded(input.idempotencyKey, 160);
  if (idempotencyKey.length < 8) return Response.json({ error: "idempotency_key_required" }, { status: 400 });

  const db = getDb();
  const now = new Date().toISOString();
  try {
    if (action === "start") {
      const [existingEvent] = await db.select().from(s06Events).where(and(eq(s06Events.tenantId, context.tenantId), eq(s06Events.idempotencyKey, idempotencyKey))).limit(1);
      if (existingEvent) {
        if (existingEvent.aggregateType !== "tracking.session") return Response.json({ error: "tracking_session_idempotency_conflict" }, { status: 409 });
        const [existingSession] = await db.select().from(trackingSessions).where(and(eq(trackingSessions.tenantId, context.tenantId), eq(trackingSessions.id, existingEvent.aggregateId))).limit(1);
        if (!existingSession) return Response.json({ error: "tracking_session_readback_unavailable" }, { status: 503 });
        return Response.json({ context: publicAuthorityContext(context), session: sessionForResponse(existingSession), eventId: existingEvent.eventId, idempotent: true }, { headers: responseHeaders() });
      }
      const employeeId = bounded(input.employeeId, 160) || context.actorId;
      if (employeeId !== context.actorId && !canManageOther(context)) return Response.json({ error: "employee_scope_forbidden" }, { status: 403 });
      if (!hasCapability(context, "attendance.self") && !canManageOther(context)) return Response.json({ error: "forbidden", capability: "attendance.self" }, { status: 403 });
      if (input.policyAccepted !== true) return Response.json({ error: "tracking_policy_confirmation_required" }, { status: 400 });
      const attendanceId = bounded(input.attendanceId, 160);
      if (!attendanceId) return Response.json({ error: "valid_attendance_check_in_required" }, { status: 409 });
      const [attendance] = await db.select().from(jobJourneyRecords).where(and(
        eq(jobJourneyRecords.tenantId, context.tenantId),
        eq(jobJourneyRecords.id, attendanceId),
        eq(jobJourneyRecords.domain, "field"),
        eq(jobJourneyRecords.recordType, "ATTENDANCE"),
      )).limit(1);
      if (!attendance || !["CHECKED_IN", "PAUSED"].includes(attendance.status)) return Response.json({ error: "valid_attendance_check_in_required" }, { status: 409 });
      const attendancePayload = parseJsonObject(attendance.payloadJson);
      const attendanceContext = attendancePayload.operationalContext && typeof attendancePayload.operationalContext === "object" && !Array.isArray(attendancePayload.operationalContext)
        ? attendancePayload.operationalContext as JsonObject
        : {};
      if (bounded(attendancePayload.workerId, 160) !== employeeId || bounded(attendanceContext.mode, 32).toUpperCase() !== "DRIVER") {
        return Response.json({ error: "tracking_requires_driver_attendance" }, { status: 409 });
      }
      const linkedSessionId = bounded(attendancePayload.tracking && typeof attendancePayload.tracking === "object" && !Array.isArray(attendancePayload.tracking)
        ? (attendancePayload.tracking as JsonObject).sessionId
        : "", 160);
      if (linkedSessionId) {
        const [linkedSession] = await db.select().from(trackingSessions).where(and(eq(trackingSessions.tenantId, context.tenantId), eq(trackingSessions.id, linkedSessionId))).limit(1);
        if (linkedSession) return Response.json({ context: publicAuthorityContext(context), session: sessionForResponse(linkedSession), idempotent: true, source: "attendance_check_in_gate" }, { headers: responseHeaders() });
      }
      const shiftId = bounded(input.shiftId, 160);
      const vehicleId = bounded(input.vehicleId, 160);
      const trackingDeviceId = bounded(input.trackingDeviceId, 160);
      const policySnapshotId = bounded(input.policySnapshotId, 160) || `policy:${context.tenantId}:on-duty-v1`;
      const trackingSource = bounded(input.trackingSource, 40).toUpperCase();
      if (!shiftId || !vehicleId || !trackingDeviceId) return Response.json({ error: "shift_vehicle_tracking_device_required" }, { status: 400 });
      if (!isTrackingSource(trackingSource)) return Response.json({ error: "unsupported_tracking_source" }, { status: 400 });
      const [device] = await db.select().from(trackingDevices).where(and(eq(trackingDevices.tenantId, context.tenantId), eq(trackingDevices.id, trackingDeviceId), eq(trackingDevices.status, "ACTIVE"))).limit(1);
      if (!device) return Response.json({ error: "tracking_device_not_found" }, { status: 404 });
      const [binding] = await db.select().from(vehicleDeviceBindings).where(and(eq(vehicleDeviceBindings.tenantId, context.tenantId), eq(vehicleDeviceBindings.vehicleId, vehicleId), eq(vehicleDeviceBindings.deviceId, trackingDeviceId), eq(vehicleDeviceBindings.status, "ACTIVE"))).limit(1);
      if (!binding) return Response.json({ error: "vehicle_tracking_device_not_bound" }, { status: 409 });
      const active = await db.select().from(trackingSessions).where(and(eq(trackingSessions.tenantId, context.tenantId), eq(trackingSessions.status, "ACTIVE"))).limit(500);
      if (active.some((row) => row.employeeId === employeeId)) return Response.json({ error: "employee_tracking_session_already_active" }, { status: 409 });
      if (active.some((row) => row.vehicleId === vehicleId)) return Response.json({ error: "vehicle_tracking_session_already_active" }, { status: 409 });

      const id = `TRACKING-SESSION-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
      const eventId = crypto.randomUUID();
      const evidence = JSON.stringify({ policySnapshotId, policyAccepted: true, trackingSource, bindingId: binding.id });
      await db.batch([
        db.insert(trackingSessions).values({ id, tenantId: context.tenantId, employeeId, vehicleId, trackingDeviceId, shiftId, startedAt: now, endedAt: null, trackingSource, status: "ACTIVE", createdBy: context.actorId, policySnapshotId, engineStateJson: "{}", failureReason: "", createdAt: now, updatedAt: now }),
        db.insert(locationEvents).values({ id: crypto.randomUUID(), tenantId: context.tenantId, eventType: "TRACKING_SESSION_STARTED", occurredAt: now, trackingSessionId: id, employeeId, vehicleId, locationId: null, geofenceId: null, source: "ZEROW_SERVER_SESSION", confidenceMilli: 1000, evidenceJson: evidence, correlationId: crypto.randomUUID(), dedupeKey: `tracking-session-started:${id}`, createdAt: now }),
        db.insert(s06Events).values({ eventId, tenantId: context.tenantId, eventType: "location.tracking_session.started", schemaVersion: "1", actorType: "human", actorId: context.actorId, source: "sites-location-intelligence", occurredAt: now, observedAt: now, aggregateType: "tracking.session", aggregateId: id, aggregateVersion: 1, payloadJson: evidence, correlationId: crypto.randomUUID(), causationId: null, idempotencyKey, status: "COMMITTED_SITES_READBACK", createdAt: now }),
        db.insert(s06Outbox).values({ id: crypto.randomUUID(), tenantId: context.tenantId, eventId, topic: "zerow.location.tracking_session.started", status: "PENDING_EXTERNAL_CONSUMER", attempts: 0, createdAt: now, updatedAt: now }),
        db.insert(s06Reconciliations).values({ id: crypto.randomUUID(), tenantId: context.tenantId, aggregateType: "tracking.session", aggregateId: id, expectedVersion: 1, observedVersion: 1, status: "SITES_READBACK_VERIFIED", detail: "Tracking session aperta solo dentro turno/policy autorizzati e con mezzo-device associati.", createdAt: now, updatedAt: now }),
      ]);
      const [created] = await db.select().from(trackingSessions).where(and(eq(trackingSessions.tenantId, context.tenantId), eq(trackingSessions.id, id))).limit(1);
      if (!created) return Response.json({ error: "tracking_session_readback_unavailable" }, { status: 503 });
      return Response.json({ context: publicAuthorityContext(context), session: sessionForResponse(created), eventId, readback: "verified" }, { status: 201, headers: responseHeaders() });
    }

    const sessionId = bounded(input.sessionId, 160);
    if (!sessionId) return Response.json({ error: "tracking_session_id_required" }, { status: 400 });
    const [session] = await db.select().from(trackingSessions).where(and(eq(trackingSessions.tenantId, context.tenantId), eq(trackingSessions.id, sessionId))).limit(1);
    if (!session) return Response.json({ error: "tracking_session_not_found" }, { status: 404 });
    const own = session.employeeId === context.actorId;
    if (!own && !canManageOther(context)) return Response.json({ error: "tracking_session_scope_forbidden" }, { status: 403 });
    const [existingEvent] = await db.select().from(s06Events).where(and(eq(s06Events.tenantId, context.tenantId), eq(s06Events.idempotencyKey, idempotencyKey))).limit(1);
    if (existingEvent) {
      if (existingEvent.aggregateType !== "tracking.session") return Response.json({ error: "tracking_session_idempotency_conflict" }, { status: 409 });
      const [existingSession] = await db.select().from(trackingSessions).where(and(eq(trackingSessions.tenantId, context.tenantId), eq(trackingSessions.id, existingEvent.aggregateId))).limit(1);
      if (!existingSession) return Response.json({ error: "tracking_session_readback_unavailable" }, { status: 503 });
      return Response.json({ context: publicAuthorityContext(context), session: sessionForResponse(existingSession), eventId: existingEvent.eventId, idempotent: true }, { headers: responseHeaders() });
    }
    if (session.status !== "ACTIVE" && !(action === "pause" && session.status === "PAUSED") && !(action === "close" && session.status === "PAUSED")) return Response.json({ error: "tracking_session_not_open", status: session.status }, { status: 409 });
    const nextStatus = action === "close" ? "CLOSED" : session.status === "PAUSED" ? "ACTIVE" : "PAUSED";
    const eventType = action === "close" ? "TRACKING_SESSION_ENDED" : undefined;
    const eventId = crypto.randomUUID();
    const update = db.update(trackingSessions).set({ status: nextStatus, endedAt: action === "close" ? now : session.endedAt, updatedAt: now }).where(and(eq(trackingSessions.tenantId, context.tenantId), eq(trackingSessions.id, sessionId), eq(trackingSessions.status, session.status)));
    const statements: BatchItem<"sqlite">[] = [update];
    if (eventType) statements.push(db.insert(locationEvents).values({ id: crypto.randomUUID(), tenantId: context.tenantId, eventType, occurredAt: now, trackingSessionId: session.id, employeeId: session.employeeId, vehicleId: session.vehicleId, locationId: null, geofenceId: null, source: "ZEROW_SERVER_SESSION", confidenceMilli: 1000, evidenceJson: JSON.stringify({ action, reason: bounded(input.reason, 240) }), correlationId: crypto.randomUUID(), dedupeKey: `tracking-session-ended:${session.id}:${now}`, createdAt: now }));
    statements.push(db.insert(s06Events).values({ eventId, tenantId: context.tenantId, eventType: `location.tracking_session.${action}`, schemaVersion: "1", actorType: "human", actorId: context.actorId, source: "sites-location-intelligence", occurredAt: now, observedAt: now, aggregateType: "tracking.session", aggregateId: session.id, aggregateVersion: Date.now(), payloadJson: JSON.stringify({ action, previousStatus: session.status, nextStatus, reason: bounded(input.reason, 240) }), correlationId: crypto.randomUUID(), causationId: null, idempotencyKey, status: "COMMITTED_SITES_READBACK", createdAt: now }));
    await db.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
    const [updated] = await db.select().from(trackingSessions).where(and(eq(trackingSessions.tenantId, context.tenantId), eq(trackingSessions.id, sessionId))).limit(1);
    if (!updated) return Response.json({ error: "tracking_session_readback_unavailable" }, { status: 503 });
    return Response.json({ context: publicAuthorityContext(context), session: sessionForResponse(updated), eventId, readback: "verified" }, { headers: responseHeaders() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/unique|constraint/i.test(message)) return Response.json({ error: "tracking_session_conflict" }, { status: 409 });
    return Response.json({ error: "tracking_session_write_unavailable" }, { status: 503 });
  }
}
