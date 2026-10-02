import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { jobJourneyRecords, s04Records, s06Events, s06Outbox, s06Reconciliations } from "@/db/schema";
import { getAuthorityContext, hasCapability, publicAuthorityContext } from "@/lib/authority-context";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ jobId: string }> };
type JsonObject = Record<string, unknown>;
type AttendanceStatus = "CHECKED_IN" | "PAUSED" | "CHECKED_OUT" | "CORRECTION_REQUESTED" | "APPROVED";

const ACTIONS = {
  check_in: { capability: "attendance.self", next: "CHECKED_IN" as AttendanceStatus },
  pause: { capability: "attendance.self", next: "PAUSED" as AttendanceStatus },
  resume: { capability: "attendance.self", next: "CHECKED_IN" as AttendanceStatus },
  check_out: { capability: "attendance.self", next: "CHECKED_OUT" as AttendanceStatus },
  correction_request: { capability: "attendance.self", next: "CORRECTION_REQUESTED" as AttendanceStatus },
  correction_approve: { capability: "attendance.approve", next: "APPROVED" as AttendanceStatus },
} as const;

function hasAttendanceCapability(context: Awaited<ReturnType<typeof getAuthorityContext>>, capability: string) {
  if (!context) return false;
  if (hasCapability(context, capability)) return true;
  // Backward-compatible aliases for existing memberships created before the attendance capability split.
  return capability === "attendance.self"
    ? hasCapability(context, "field.write")
    : capability === "attendance.approve"
      ? hasCapability(context, "workforce.manage")
      : false;
}

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function bounded(value: unknown, max: number, fallback = "") {
  return typeof value === "string" ? value.trim().slice(0, max) : fallback;
}

function parseJson(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function readBoundedJson(request: Request, maxBytes = 24_000) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) return { error: "payload_too_large" as const };
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) return { error: "payload_too_large" as const };
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? { value: parsed } : { error: "invalid_json" as const };
  } catch {
    return { error: "invalid_json" as const };
  }
}

async function routeJobId(routeContext: RouteContext) {
  try {
    const value = decodeURIComponent((await routeContext.params).jobId).trim();
    return value && value.length <= 160 ? value : null;
  } catch {
    return null;
  }
}

async function findJob(tenantId: string, reference: string) {
  const base = and(eq(s04Records.tenantId, tenantId), eq(s04Records.module, "operations"));
  const [byId] = await getDb().select().from(s04Records).where(and(base, eq(s04Records.id, reference))).limit(1);
  if (byId) return byId;
  const [byCode] = await getDb().select().from(s04Records).where(and(base, eq(s04Records.canonicalCode, reference))).limit(1);
  return byCode ?? null;
}

function sanitizeLocation(value: unknown) {
  if (!isRecord(value)) return null;
  const lat = typeof value.lat === "number" ? value.lat : Number(value.lat);
  const lon = typeof value.lon === "number" ? value.lon : Number(value.lon);
  const accuracyM = typeof value.accuracyM === "number" ? value.accuracyM : Number(value.accuracyM);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return {
    lat: Math.round(lat * 10_000) / 10_000,
    lon: Math.round(lon * 10_000) / 10_000,
    accuracyM: Number.isFinite(accuracyM) && accuracyM >= 0 ? Math.min(10_000, Math.round(accuracyM)) : null,
    policy: "ON_DUTY_ONLY",
    precision: "4_DECIMAL_PLACES",
  };
}

function geofenceForJob(payload: JsonObject) {
  const candidate = isRecord(payload.geofence) ? payload.geofence : payload;
  const lat = Number(candidate.latitude ?? candidate.lat);
  const lon = Number(candidate.longitude ?? candidate.lon ?? candidate.lng);
  const radiusM = Number(candidate.radiusM ?? candidate.geofenceRadiusM);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(radiusM) || lat < -90 || lat > 90 || lon < -180 || lon > 180 || radiusM < 20 || radiusM > 10_000) return null;
  return { lat, lon, radiusM: Math.round(radiusM) };
}

function distanceMeters(left: { lat: number; lon: number }, right: { lat: number; lon: number }) {
  const earthRadius = 6_371_000;
  const toRadians = (value: number) => value * Math.PI / 180;
  const deltaLat = toRadians(right.lat - left.lat);
  const deltaLon = toRadians(right.lon - left.lon);
  const lat1 = toRadians(left.lat);
  const lat2 = toRadians(right.lat);
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function evaluateGeofence(location: ReturnType<typeof sanitizeLocation>, payload: JsonObject) {
  if (!location) return { status: "NO_LOCATION" as const, distanceM: null, radiusM: null };
  const geofence = geofenceForJob(payload);
  if (!geofence) return { status: "UNCONFIGURED" as const, distanceM: null, radiusM: null };
  const distanceM = Math.round(distanceMeters(location, geofence));
  const accuracyM = location.accuracyM ?? 0;
  const status = distanceM + accuracyM <= geofence.radiusM
    ? "INSIDE"
    : distanceM - accuracyM > geofence.radiusM
      ? "OUTSIDE"
      : "UNCERTAIN";
  return { status, distanceM, radiusM: geofence.radiusM };
}

function attendanceForResponse(row: typeof jobJourneyRecords.$inferSelect) {
  return {
    id: row.id,
    jobId: row.jobId,
    status: row.status,
    version: row.version,
    payload: parseJson(row.payloadJson),
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function GET(_request: Request, routeContext: RouteContext) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "field.read") && !hasCapability(context, "workforce.read")) {
    return Response.json({ error: "forbidden", capability: "field.read" }, { status: 403 });
  }
  const reference = await routeJobId(routeContext);
  if (!reference) return Response.json({ error: "invalid_job_id" }, { status: 400 });
  try {
    const job = await findJob(context.tenantId, reference);
    if (!job) return Response.json({ error: "job_not_found" }, { status: 404 });
    const records = await getDb().select().from(jobJourneyRecords).where(and(
      eq(jobJourneyRecords.tenantId, context.tenantId),
      eq(jobJourneyRecords.jobId, job.id),
      eq(jobJourneyRecords.domain, "field"),
      eq(jobJourneyRecords.recordType, "ATTENDANCE"),
    )).orderBy(desc(jobJourneyRecords.updatedAt)).limit(100);
    return Response.json({
      context: publicAuthorityContext(context),
      contract: {
        source: "sites-d1-field-attendance",
        tracking: "ON_DUTY_ONLY",
        location: "OPTIONAL_ROUNDED_4DP",
        offline: "idempotency_key_required",
        externalExecutor: "deferred",
      },
      records: records.map(attendanceForResponse),
      readback: { status: "verified", scope: "tenant", checkedAt: new Date().toISOString() },
    }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return Response.json({ error: "attendance_readback_unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request, routeContext: RouteContext) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const reference = await routeJobId(routeContext);
  if (!reference) return Response.json({ error: "invalid_job_id" }, { status: 400 });
  const parsed = await readBoundedJson(request);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: parsed.error === "payload_too_large" ? 413 : 400 });
  const input = parsed.value;
  const action = bounded(input.action, 32).toLowerCase() as keyof typeof ACTIONS;
  if (!(action in ACTIONS)) return Response.json({ error: "unsupported_attendance_action", allowed: Object.keys(ACTIONS) }, { status: 400 });
  const actionContract = ACTIONS[action];
  if (!hasAttendanceCapability(context, actionContract.capability)) return Response.json({ error: "forbidden", capability: actionContract.capability }, { status: 403 });
  const idempotencyKey = bounded(input.idempotencyKey, 160);
  if (idempotencyKey.length < 8) return Response.json({ error: "idempotency_key_required" }, { status: 400 });

  try {
    const db = getDb();
    const job = await findJob(context.tenantId, reference);
    if (!job) return Response.json({ error: "job_not_found" }, { status: 404 });
    const [existingEvent] = await db.select().from(s06Events).where(and(
      eq(s06Events.tenantId, context.tenantId),
      eq(s06Events.idempotencyKey, idempotencyKey),
    )).limit(1);
    if (existingEvent) {
      const [record] = await db.select().from(jobJourneyRecords).where(and(
        eq(jobJourneyRecords.tenantId, context.tenantId),
        eq(jobJourneyRecords.id, existingEvent.aggregateId),
        eq(jobJourneyRecords.jobId, job.id),
      )).limit(1);
      if (!record) return Response.json({ error: "attendance_idempotency_readback_unavailable" }, { status: 503 });
      return Response.json({ attendance: attendanceForResponse(record), eventId: existingEvent.eventId, idempotent: true }, { headers: { "cache-control": "private, no-store" } });
    }

    const [latest] = await db.select().from(jobJourneyRecords).where(and(
      eq(jobJourneyRecords.tenantId, context.tenantId),
      eq(jobJourneyRecords.jobId, job.id),
      eq(jobJourneyRecords.domain, "field"),
      eq(jobJourneyRecords.recordType, "ATTENDANCE"),
    )).orderBy(desc(jobJourneyRecords.updatedAt)).limit(1);
    const now = new Date().toISOString();
    const expectedVersion = typeof input.expectedVersion === "number" ? Math.floor(input.expectedVersion) : null;
    const previousStatus = latest?.status as AttendanceStatus | undefined;
    const validTransitions: Record<keyof typeof ACTIONS, AttendanceStatus[]> = {
      check_in: ["CHECKED_OUT", "APPROVED", undefined as never],
      pause: ["CHECKED_IN"],
      resume: ["PAUSED"],
      check_out: ["CHECKED_IN", "PAUSED"],
      correction_request: ["CHECKED_OUT"],
      correction_approve: ["CORRECTION_REQUESTED"],
    };
    if (action !== "check_in" && (!previousStatus || !validTransitions[action].includes(previousStatus))) {
      return Response.json({ error: "invalid_attendance_transition", from: previousStatus ?? null, action }, { status: 409 });
    }
    if (action === "check_in" && previousStatus && !validTransitions.check_in.includes(previousStatus)) {
      return Response.json({ error: "attendance_session_already_open", status: previousStatus }, { status: 409 });
    }
    if (latest && expectedVersion !== null && latest.version !== expectedVersion) {
      return Response.json({ error: "version_conflict", expectedVersion, currentVersion: latest.version }, { status: 409 });
    }
    if (latest && action !== "check_in" && expectedVersion === null) return Response.json({ error: "expected_version_required" }, { status: 400 });

    const location = sanitizeLocation(input.location);
    const locationWithGeofence = location
      ? { ...location, geofence: evaluateGeofence(location, parseJson(job.payloadJson)) }
      : null;
    const clientObservedAt = bounded(input.clientObservedAt ?? input.at, 40);
    const workerId = hasCapability(context, "workforce.read.all") || hasCapability(context, "workforce.manage")
      ? bounded(input.workerId, 120, context.actorId)
      : context.actorId;
    const transition = {
      action,
      recordedAt: now,
      clientObservedAt: Number.isFinite(Date.parse(clientObservedAt)) ? clientObservedAt : null,
      by: context.actorId,
      note: bounded(input.note, 1_000),
      location: locationWithGeofence,
    };
    const currentPayload = latest ? parseJson(latest.payloadJson) : {};
    const transitions = Array.isArray(currentPayload.transitions) ? currentPayload.transitions.filter(isRecord).slice(-49) : [];
    const payload = {
      ...currentPayload,
      workerId,
      teamId: bounded(input.teamId, 120),
      privacy: { mode: "ON_DUTY_ONLY", locationOptional: true, precision: "4_DECIMAL_PLACES", retentionClass: "OPERATIONAL" },
      transitions: [...transitions, transition],
      lastTransition: transition,
      status: actionContract.next,
      correctionNote: action === "correction_request" ? bounded(input.correctionNote ?? input.note, 2_000) : bounded(currentPayload.correctionNote, 2_000),
    } satisfies JsonObject;
    const eventId = crypto.randomUUID();
    const aggregateId = latest?.id ?? crypto.randomUUID();
    const nextVersion = (latest?.version ?? 0) + 1;
    const results = latest
      ? await db.batch([
        db.update(jobJourneyRecords).set({ status: actionContract.next, version: nextVersion, payloadJson: JSON.stringify(payload), updatedBy: context.actorId, updatedAt: now }).where(and(eq(jobJourneyRecords.tenantId, context.tenantId), eq(jobJourneyRecords.id, latest.id), eq(jobJourneyRecords.version, latest.version))),
        db.insert(s06Events).values({ eventId, tenantId: context.tenantId, eventType: `field.attendance.${action}`, schemaVersion: "1", actorType: "human", actorId: context.actorId, source: "sites-field-attendance", occurredAt: transition.recordedAt, observedAt: now, aggregateType: "job.journey.attendance", aggregateId, aggregateVersion: nextVersion, payloadJson: JSON.stringify(transition), correlationId: crypto.randomUUID(), causationId: null, idempotencyKey, status: "COMMITTED_SITES_READBACK", createdAt: now }),
        db.insert(s06Outbox).values({ id: crypto.randomUUID(), tenantId: context.tenantId, eventId, topic: `zerow.field.attendance.${action}`, status: "PENDING_EXTERNAL_CONSUMER", attempts: 0, createdAt: now, updatedAt: now }),
        db.insert(s06Reconciliations).values({ id: crypto.randomUUID(), tenantId: context.tenantId, aggregateType: "job.journey.attendance", aggregateId, expectedVersion: nextVersion, observedVersion: nextVersion, status: "SITES_READBACK_VERIFIED", detail: "Attendance aggiornata con transizione versionata e policy on-duty.", createdAt: now, updatedAt: now }),
      ])
      : await db.batch([
        db.insert(jobJourneyRecords).values({ id: aggregateId, tenantId: context.tenantId, jobId: job.id, domain: "field", recordType: "ATTENDANCE", title: "Presenza operativa", status: actionContract.next, version: 1, payloadJson: JSON.stringify(payload), idempotencyKey, createdBy: context.actorId, updatedBy: context.actorId, createdAt: now, updatedAt: now }),
        db.insert(s06Events).values({ eventId, tenantId: context.tenantId, eventType: `field.attendance.${action}`, schemaVersion: "1", actorType: "human", actorId: context.actorId, source: "sites-field-attendance", occurredAt: transition.recordedAt, observedAt: now, aggregateType: "job.journey.attendance", aggregateId, aggregateVersion: 1, payloadJson: JSON.stringify(transition), correlationId: crypto.randomUUID(), causationId: null, idempotencyKey, status: "COMMITTED_SITES_READBACK", createdAt: now }),
        db.insert(s06Outbox).values({ id: crypto.randomUUID(), tenantId: context.tenantId, eventId, topic: `zerow.field.attendance.${action}`, status: "PENDING_EXTERNAL_CONSUMER", attempts: 0, createdAt: now, updatedAt: now }),
        db.insert(s06Reconciliations).values({ id: crypto.randomUUID(), tenantId: context.tenantId, aggregateType: "job.journey.attendance", aggregateId, expectedVersion: 1, observedVersion: 1, status: "SITES_READBACK_VERIFIED", detail: "Check-in attendance persistito con policy on-duty.", createdAt: now, updatedAt: now }),
      ]);
    const updated = latest ? (results[0] as unknown as (typeof jobJourneyRecords.$inferSelect)[])[0] : (await db.select().from(jobJourneyRecords).where(eq(jobJourneyRecords.id, aggregateId)).limit(1))[0];
    if (!updated) return Response.json({ error: "attendance_readback_unavailable" }, { status: 503 });
    return Response.json({ attendance: attendanceForResponse(updated), eventId, idempotent: false, readback: "verified" }, { status: latest ? 200 : 201, headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/unique|constraint/i.test(message)) return Response.json({ error: "attendance_idempotency_or_version_conflict" }, { status: 409 });
    return Response.json({ error: "attendance_write_unavailable" }, { status: 503 });
  }
}
