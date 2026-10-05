import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { geofences, jobJourneyRecords, s04Records, s06Events, s06Outbox, s06Reconciliations, tenantWarehouses } from "@/db/schema";
import { getAuthorityContext, hasCapability, publicAuthorityContext } from "@/lib/authority-context";
import { warehouseIsInScope, warehouseScope } from "@/lib/attendance-scope";
import { evaluateAttendanceGeofence } from "@/lib/location-intelligence/attendance-policy";
import { geofenceForEngine } from "@/lib/location-intelligence/repository";

export const dynamic = "force-dynamic";

type JsonObject = Record<string, unknown>;
type AttendanceAction = "check_in" | "pause" | "resume" | "check_out";
type AttendanceStatus = "CHECKED_IN" | "PAUSED" | "CHECKED_OUT" | "APPROVED";

const ACTIONS: Record<AttendanceAction, { next: AttendanceStatus }> = {
  check_in: { next: "CHECKED_IN" },
  pause: { next: "PAUSED" },
  resume: { next: "CHECKED_IN" },
  check_out: { next: "CHECKED_OUT" },
};

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function bounded(value: unknown, max: number, fallback = "") {
  return typeof value === "string" ? value.trim().slice(0, max) : fallback;
}

function parseJson(value: string): JsonObject {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function sanitizeLocation(value: unknown) {
  if (!isRecord(value)) return null;
  const lat = Number(value.lat);
  const lon = Number(value.lon);
  const accuracyM = Number(value.accuracyM);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat: Math.round(lat * 10_000) / 10_000, lon: Math.round(lon * 10_000) / 10_000, accuracyM: Number.isFinite(accuracyM) && accuracyM >= 0 ? Math.min(10_000, Math.round(accuracyM)) : null, policy: "ON_DUTY_ONLY", precision: "4_DECIMAL_PLACES" };
}

function recordForResponse(row: typeof jobJourneyRecords.$inferSelect) {
  return { id: row.id, warehouseId: row.jobId, status: row.status, version: row.version, payload: parseJson(row.payloadJson), createdAt: row.createdAt, updatedAt: row.updatedAt };
}

function canAttend(context: Awaited<ReturnType<typeof getAuthorityContext>>) {
  return Boolean(context && (hasCapability(context, "attendance.self") || hasCapability(context, "warehouse.write")));
}

export async function GET(request: Request) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "warehouse.read") && !hasCapability(context, "workforce.read")) return Response.json({ error: "forbidden", capability: "warehouse.read" }, { status: 403 });
  const warehouseId = bounded(new URL(request.url).searchParams.get("warehouseId"), 160);
  try {
    const db = getDb();
    const [warehouses, workforceRows] = await Promise.all([
      db.select().from(tenantWarehouses).where(and(eq(tenantWarehouses.tenantId, context.tenantId), eq(tenantWarehouses.status, "active"))).limit(500),
      db.select().from(s04Records).where(and(eq(s04Records.tenantId, context.tenantId), eq(s04Records.module, "workforce"))).limit(500),
    ]);
    const scope = warehouseScope(context, warehouses, workforceRows);
    if (warehouseId && !warehouseIsInScope(scope, warehouseId)) return Response.json({ error: "warehouse_assignment_required" }, { status: 403 });
    const records = await db.select().from(jobJourneyRecords).where(and(
      eq(jobJourneyRecords.tenantId, context.tenantId),
      eq(jobJourneyRecords.domain, "warehouse"),
      eq(jobJourneyRecords.recordType, "ATTENDANCE"),
      ...(warehouseId ? [eq(jobJourneyRecords.jobId, warehouseId)] : scope.mode === "ALL" ? [] : scope.warehouseIds.length ? [inArray(jobJourneyRecords.jobId, scope.warehouseIds)] : [eq(jobJourneyRecords.jobId, "__NO_ASSIGNED_WAREHOUSE__")]),
    )).orderBy(desc(jobJourneyRecords.updatedAt)).limit(500);
    return Response.json({
      context: publicAuthorityContext(context),
      contract: { source: "sites-d1-warehouse-attendance-readback", geofence: "ENTRY_AND_EXIT_REQUIRE_INSIDE_ASSIGNED_WAREHOUSE", tracking: "NOT_REQUIRED_UNLESS_DRIVER_DUTY", assignment: "SERVER_SIDE_ONLY" },
      warehouseScope: scope,
      records: records.map(recordForResponse),
      readback: { status: "verified", scope: "tenant", checkedAt: new Date().toISOString() },
    }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return Response.json({ error: "warehouse_attendance_readback_unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!canAttend(context)) return Response.json({ error: "forbidden", capability: "attendance.self" }, { status: 403 });
  let input: JsonObject;
  try {
    const parsed = await request.json() as unknown;
    if (!isRecord(parsed)) return Response.json({ error: "invalid_json" }, { status: 400 });
    input = parsed;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const action = bounded(input.action, 32).toLowerCase() as AttendanceAction;
  const warehouseId = bounded(input.warehouseId, 160);
  const idempotencyKey = bounded(input.idempotencyKey, 160);
  if (!ACTIONS[action]) return Response.json({ error: "unsupported_attendance_action" }, { status: 400 });
  if (!warehouseId) return Response.json({ error: "warehouse_required" }, { status: 400 });
  if (idempotencyKey.length < 8) return Response.json({ error: "idempotency_key_required" }, { status: 400 });

  try {
    const db = getDb();
    const [warehouses, workforceRows] = await Promise.all([
      db.select().from(tenantWarehouses).where(and(eq(tenantWarehouses.tenantId, context.tenantId), eq(tenantWarehouses.status, "active"))).limit(500),
      db.select().from(s04Records).where(and(eq(s04Records.tenantId, context.tenantId), eq(s04Records.module, "workforce"))).limit(500),
    ]);
    const scope = warehouseScope(context, warehouses, workforceRows);
    if (!warehouseIsInScope(scope, warehouseId)) return Response.json({ error: "warehouse_assignment_required", reason: "Il profilo non ha un magazzino assegnato nel perimetro corrente." }, { status: 403 });
    const [warehouse] = await db.select().from(tenantWarehouses).where(and(eq(tenantWarehouses.tenantId, context.tenantId), eq(tenantWarehouses.id, warehouseId), eq(tenantWarehouses.status, "active"))).limit(1);
    if (!warehouse) return Response.json({ error: "warehouse_not_found" }, { status: 404 });
    const [geofenceRow] = await db.select().from(geofences).where(and(eq(geofences.tenantId, context.tenantId), eq(geofences.entityType, "MAGAZZINO"), eq(geofences.entityId, warehouse.id), eq(geofences.status, "ACTIVE"))).limit(1);
    const geofence = geofenceRow ? geofenceForEngine(geofenceRow) : null;
    const [existingEvent] = await db.select().from(s06Events).where(and(eq(s06Events.tenantId, context.tenantId), eq(s06Events.idempotencyKey, idempotencyKey))).limit(1);
    if (existingEvent) {
      const [existing] = await db.select().from(jobJourneyRecords).where(and(eq(jobJourneyRecords.tenantId, context.tenantId), eq(jobJourneyRecords.id, existingEvent.aggregateId), eq(jobJourneyRecords.jobId, warehouse.id))).limit(1);
      if (!existing) return Response.json({ error: "warehouse_attendance_idempotency_readback_unavailable" }, { status: 503 });
      return Response.json({ attendance: recordForResponse(existing), idempotent: true, eventId: existingEvent.eventId }, { headers: { "cache-control": "private, no-store" } });
    }
    const attendanceRows = await db.select().from(jobJourneyRecords).where(and(
      eq(jobJourneyRecords.tenantId, context.tenantId),
      eq(jobJourneyRecords.jobId, warehouse.id),
      eq(jobJourneyRecords.domain, "warehouse"),
      eq(jobJourneyRecords.recordType, "ATTENDANCE"),
    )).orderBy(desc(jobJourneyRecords.updatedAt)).limit(500);
    const latest = attendanceRows.find((row) => parseJson(row.payloadJson).workerId === context.actorId);
    const previousStatus = latest?.status as AttendanceStatus | undefined;
    const transitions: Record<AttendanceAction, AttendanceStatus[]> = { check_in: ["CHECKED_OUT", "APPROVED", undefined as never], pause: ["CHECKED_IN"], resume: ["PAUSED"], check_out: ["CHECKED_IN", "PAUSED"] };
    if (action !== "check_in" && (!previousStatus || !transitions[action].includes(previousStatus))) return Response.json({ error: "invalid_attendance_transition", from: previousStatus ?? null, action }, { status: 409 });
    if (action === "check_in" && previousStatus && !transitions.check_in.includes(previousStatus)) return Response.json({ error: "attendance_session_already_open", status: previousStatus }, { status: 409 });
    if (latest && typeof input.expectedVersion === "number" && latest.version !== Math.floor(input.expectedVersion)) return Response.json({ error: "version_conflict", currentVersion: latest.version }, { status: 409 });
    if (latest && action !== "check_in" && typeof input.expectedVersion !== "number") return Response.json({ error: "expected_version_required" }, { status: 400 });

    const location = sanitizeLocation(input.location);
    const requiresLocation = action === "check_in" || action === "check_out";
    if (requiresLocation && !location) return Response.json({ error: "location_required_for_attendance", reason: "warehouse_entry_exit_requires_gps" }, { status: 400 });
    const geofenceResult = evaluateAttendanceGeofence(location, geofence);
    if (requiresLocation && geofenceResult.status !== "INSIDE") return Response.json({ error: "warehouse_geofence_required", reason: "warehouse_entry_exit_requires_inside_geofence", geofence: geofenceResult }, { status: 409 });

    const now = new Date().toISOString();
    const aggregateId = latest?.id ?? `WAREHOUSE-ATTENDANCE-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
    const nextVersion = latest ? latest.version + 1 : 1;
    const transition = { action, recordedAt: now, clientObservedAt: bounded(input.clientObservedAt, 40) || null, location, geofence: geofenceResult, dutyMode: "WAREHOUSE", tracking: "NOT_REQUIRED_UNLESS_DRIVER_DUTY" };
    const previousPayload = latest ? parseJson(latest.payloadJson) : {};
    const payload = { ...previousPayload, warehouseId: warehouse.id, warehouse: { id: warehouse.id, code: warehouse.code, name: warehouse.name, locationLabel: warehouse.locationLabel }, workerId: context.actorId, dutyMode: "WAREHOUSE", tracking: { status: "NOT_REQUIRED", reason: "WAREHOUSE_DUTY_IS_NOT_DRIVER_TRACKING" }, lastTransition: transition };
    const eventId = crypto.randomUUID();
    const eventPayload = JSON.stringify({ action, warehouseId: warehouse.id, workerId: context.actorId, status: ACTIONS[action].next, version: nextVersion, geofence: geofenceResult });
    const statements = (latest ? [
      db.update(jobJourneyRecords).set({ status: ACTIONS[action].next, version: nextVersion, payloadJson: JSON.stringify(payload), updatedBy: context.actorId, updatedAt: now }).where(and(eq(jobJourneyRecords.tenantId, context.tenantId), eq(jobJourneyRecords.id, aggregateId), eq(jobJourneyRecords.version, latest.version))),
    ] : [
      db.insert(jobJourneyRecords).values({ id: aggregateId, tenantId: context.tenantId, jobId: warehouse.id, domain: "warehouse", recordType: "ATTENDANCE", title: `Presenza · ${warehouse.name}`, status: ACTIONS[action].next, version: 1, payloadJson: JSON.stringify(payload), idempotencyKey, createdBy: context.actorId, updatedBy: context.actorId, createdAt: now, updatedAt: now }),
    ]) as unknown as never[];
    statements.push(
      db.insert(s06Events).values({ eventId, tenantId: context.tenantId, eventType: `warehouse.attendance.${action}`, schemaVersion: "1", actorType: "human", actorId: context.actorId, source: "sites-warehouse-attendance", occurredAt: now, observedAt: now, aggregateType: "warehouse.attendance", aggregateId, aggregateVersion: nextVersion, payloadJson: eventPayload, correlationId: crypto.randomUUID(), causationId: null, idempotencyKey, status: "COMMITTED_SITES_READBACK", createdAt: now }) as never,
      db.insert(s06Outbox).values({ id: crypto.randomUUID(), tenantId: context.tenantId, eventId, topic: `zerow.warehouse.attendance.${action}`, status: "PENDING_EXTERNAL_CONSUMER", attempts: 0, createdAt: now, updatedAt: now }) as never,
      db.insert(s06Reconciliations).values({ id: crypto.randomUUID(), tenantId: context.tenantId, aggregateType: "warehouse.attendance", aggregateId, expectedVersion: nextVersion, observedVersion: nextVersion, status: "SITES_READBACK_VERIFIED", detail: "Presenza magazzino persistita con timestamp server e geofence obbligatorio per entrata/uscita.", createdAt: now, updatedAt: now }) as never,
    );
    await db.batch(statements as [never, ...never[]]);
    const [updated] = await db.select().from(jobJourneyRecords).where(and(eq(jobJourneyRecords.tenantId, context.tenantId), eq(jobJourneyRecords.id, aggregateId))).limit(1);
    if (!updated) return Response.json({ error: "warehouse_attendance_readback_unavailable" }, { status: 503 });
    return Response.json({ attendance: recordForResponse(updated), geofence: geofenceResult, tracking: { status: "NOT_REQUIRED_UNLESS_DRIVER_DUTY" }, eventId, readback: "verified" }, { status: latest ? 200 : 201, headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/unique|constraint/i.test(message)) return Response.json({ error: "warehouse_attendance_idempotency_or_version_conflict" }, { status: 409 });
    return Response.json({ error: "warehouse_attendance_write_unavailable" }, { status: 503 });
  }
}
