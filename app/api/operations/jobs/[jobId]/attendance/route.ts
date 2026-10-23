import { and, desc, eq, inArray } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { getDb } from "@/db";
import { jobJourneyRecords, locationEvents, s04Records, s06Events, s06Outbox, s06Reconciliations, trackingSessions } from "@/db/schema";
import { getAuthorityContext, hasCapability, publicAuthorityContext } from "@/lib/authority-context";
import { attendanceScopeTokens } from "@/lib/attendance-scope";
import { canWriteOperationsRapportino } from "@/lib/operations-permissions";
import {
  evaluateAttendanceGeofence,
  persistedOperationalContext,
  resolveAttendanceOperationalContext,
} from "@/lib/location-intelligence/attendance-policy";
import { sessionForResponse } from "@/lib/location-intelligence/repository";
import { canReadAllMissions, canReadAllOperations, rowMatchesContext } from "@/lib/operational-scope";

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
  const base = and(eq(s04Records.tenantId, tenantId), inArray(s04Records.module, ["operations", "mission"]));
  const [byId] = await getDb().select().from(s04Records).where(and(base, eq(s04Records.id, reference))).limit(1);
  if (byId) return byId;
  const [byCode] = await getDb().select().from(s04Records).where(and(base, eq(s04Records.canonicalCode, reference))).limit(1);
  return byCode ?? null;
}

async function canAccessJob(context: NonNullable<Awaited<ReturnType<typeof getAuthorityContext>>>, job: typeof s04Records.$inferSelect) {
  if (job.module === "mission" ? canReadAllMissions(context) : canReadAllOperations(context)) return true;
  const workforceRows = await getDb().select().from(s04Records).where(and(
    eq(s04Records.tenantId, context.tenantId),
    eq(s04Records.module, "workforce"),
  )).limit(500);
  const scopeTokens = attendanceScopeTokens(context, workforceRows);
  if (rowMatchesContext(job, context, scopeTokens)) return true;
  // A delivery driver is assigned on the mission journey record. The
  // operational job can therefore be visible to that driver even when the
  // parent commessa has no direct assignment field.
  const missionRows = await getDb().select().from(jobJourneyRecords).where(and(
    eq(jobJourneyRecords.tenantId, context.tenantId),
    eq(jobJourneyRecords.jobId, job.id),
    eq(jobJourneyRecords.domain, "mission"),
    eq(jobJourneyRecords.recordType, "TRANSPORT"),
  )).limit(100);
  return missionRows.some((row) => rowMatchesContext(row, context, scopeTokens));
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
    if (!(await canAccessJob(context, job))) return Response.json({ error: "job_not_found" }, { status: 404 });
    const allRecords = await getDb().select().from(jobJourneyRecords).where(and(
      eq(jobJourneyRecords.tenantId, context.tenantId),
      eq(jobJourneyRecords.jobId, job.id),
      eq(jobJourneyRecords.domain, "field"),
      eq(jobJourneyRecords.recordType, "ATTENDANCE"),
    )).orderBy(desc(jobJourneyRecords.updatedAt)).limit(100);
    const canApprove = hasAttendanceCapability(context, "attendance.approve");
    const workerFor = (row: typeof jobJourneyRecords.$inferSelect) => bounded(parseJson(row.payloadJson).workerId, 120, row.createdBy);
    const records = allRecords.filter((row) => canApprove || workerFor(row) === context.actorId);
    const currentRecord = allRecords.find((row) => workerFor(row) === context.actorId) ?? null;
    const canOpenReport = canWriteOperationsRapportino(context.capabilities);
    return Response.json({
      context: { ...publicAuthorityContext(context), canOpenReport, canApprove },
      contract: {
        source: "sites-d1-field-attendance",
        tracking: "ATTENDANCE_GATED_ON_DUTY_ONLY",
        location: "REQUIRED_FOR_ENTRY_EXIT_ROUNDED_4DP",
        fieldGeofence: "ENTRY_AND_EXIT_REQUIRE_INSIDE",
        driverTracking: "START_ON_VALID_ENTRY_END_ON_VALID_EXIT",
        offline: "idempotency_key_required",
        externalExecutor: "deferred",
      },
      records: records.map(attendanceForResponse),
      currentRecord: currentRecord ? attendanceForResponse(currentRecord) : null,
      readback: { status: "verified", scope: "tenant", checkedAt: new Date().toISOString() },
    }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return Response.json({ error: "attendance_readback_unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request, routeContext: RouteContext) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  let failureStage = "route_start";
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
    failureStage = "find_job";
    const db = getDb();
    const job = await findJob(context.tenantId, reference);
    if (!job) return Response.json({ error: "job_not_found" }, { status: 404 });
    if (!(await canAccessJob(context, job))) return Response.json({ error: "job_not_found" }, { status: 404 });
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
      return Response.json({ attendance: attendanceForResponse(record), eventId: existingEvent.eventId, idempotent: true, readback: { status: "verified", scope: "tenant", version: record.version } }, { headers: { "cache-control": "private, no-store" } });
    }

    failureStage = "read_latest_attendance";
    const targetWorkerId = action === "correction_approve"
      ? bounded(input.workerId, 120)
      : context.actorId;
    if (!targetWorkerId) return Response.json({ error: "attendance_worker_required" }, { status: 400 });
    if (action === "correction_approve" && targetWorkerId === context.actorId) {
      return Response.json({ error: "attendance_correction_self_approval_forbidden" }, { status: 403 });
    }
    const attendanceRows = await db.select().from(jobJourneyRecords).where(and(
      eq(jobJourneyRecords.tenantId, context.tenantId),
      eq(jobJourneyRecords.jobId, job.id),
      eq(jobJourneyRecords.domain, "field"),
      eq(jobJourneyRecords.recordType, "ATTENDANCE"),
    )).orderBy(desc(jobJourneyRecords.updatedAt)).limit(500);
    const latest = attendanceRows.find((row) => bounded(parseJson(row.payloadJson).workerId, 120, row.createdBy) === targetWorkerId);
    const now = new Date().toISOString();
    const clientObservedAt = bounded(input.clientObservedAt ?? input.at, 40);
    const correctionAt = bounded(input.correctionAt, 40);
    const correctionAtIsValid = Boolean(correctionAt && Number.isFinite(Date.parse(correctionAt)));
    const expectedVersion = typeof input.expectedVersion === "number" ? Math.floor(input.expectedVersion) : null;
    const previousStatus = latest?.status as AttendanceStatus | undefined;
    const validTransitions: Record<keyof typeof ACTIONS, AttendanceStatus[]> = {
      check_in: ["CHECKED_OUT", "APPROVED", undefined as never],
      pause: ["CHECKED_IN"],
      resume: ["PAUSED"],
      check_out: ["CHECKED_IN", "PAUSED"],
      // A forgotten exit is requested while the shift is still open. The
      // request intentionally bypasses the live geofence check, but it does
      // not close the attendance until an authorised approver confirms it.
      correction_request: ["CHECKED_IN", "PAUSED"],
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

    if (action === "correction_request") {
      const correctionNote = bounded(input.correctionNote ?? input.note, 2_000);
      if (correctionNote.length < 8) return Response.json({ error: "correction_note_required" }, { status: 400 });
    }

    const currentPayload = latest ? parseJson(latest.payloadJson) : {};
    const storedOperational = isRecord(currentPayload.operationalContext) ? currentPayload.operationalContext : {};
    const preferredMissionId = action === "check_in"
      ? undefined
      : bounded(storedOperational.missionId, 120) || undefined;
    failureStage = "resolve_operational_context";
    const location = sanitizeLocation(input.location);
    const operational = await resolveAttendanceOperationalContext({ context, job, preferredMissionId });
    const requiresLocation = action === "check_in" || action === "check_out";
    if (requiresLocation && !location) {
      return Response.json({ error: "location_required_for_attendance", reason: "timestamp_and_geolocation_are_required_for_entry_and_exit" }, { status: 400 });
    }
    const attendanceGeofence = evaluateAttendanceGeofence(location, action === "check_in"
      ? operational.checkInGeofence
      : action === "check_out"
        ? operational.checkOutGeofence ?? operational.jobGeofence
        : operational.jobGeofence);
    if ((action === "check_in" || action === "check_out") && ["FIELD", "DRIVER"].includes(operational.mode) && attendanceGeofence.status !== "INSIDE") {
      return Response.json({
        error: operational.mode === "DRIVER" ? "driver_attendance_geofence_required" : "attendance_geofence_required",
        reason: operational.mode === "DRIVER" ? "driver_attendance_requires_inside_origin_or_destination_geofence" : "field_attendance_requires_inside_job_geofence",
        geofence: attendanceGeofence,
      }, { status: 409 });
    }
    if (action === "check_in" && operational.mode === "DRIVER" && operational.trackingError) {
      return Response.json({ error: operational.trackingError, reason: "driver_check_in_requires_an_active_vehicle_tracking_binding", missionId: operational.mission?.id ?? null, vehicleId: operational.vehicleId }, { status: 409 });
    }
    const locationWithGeofence = location ? { ...location, geofence: attendanceGeofence } : null;

    const transitions = Array.isArray(currentPayload.transitions) ? currentPayload.transitions.filter(isRecord).slice(-49) : [];
    const previousCorrection = [...transitions].reverse().find((item) => item.action === "correction_request");
    const requestedCorrectionAt = previousCorrection && typeof previousCorrection.correctionAt === "string"
      ? previousCorrection.correctionAt
      : "";
    const effectiveCorrectionAt = action === "correction_request" && correctionAtIsValid
      ? correctionAt
      : action === "correction_approve" && Number.isFinite(Date.parse(requestedCorrectionAt))
        ? requestedCorrectionAt
        : null;
    const aggregateId = latest?.id ?? crypto.randomUUID();
    let activeTrackingSession: typeof trackingSessions.$inferSelect | null = null;
    let trackingSessionId: string | null = null;
    let trackingOperation: "start" | "pause" | "resume" | "close" | null = null;
    failureStage = "resolve_tracking_context";
    const targetIsDriver = action === "correction_approve"
      ? bounded(storedOperational.mode, 16).toUpperCase() === "DRIVER"
      : operational.mode === "DRIVER";
    if (targetIsDriver) {
      const trackingEmployeeId = action === "correction_approve" ? targetWorkerId : context.actorId;
      const sessionRows = await db.select().from(trackingSessions).where(and(
        eq(trackingSessions.tenantId, context.tenantId),
        eq(trackingSessions.employeeId, trackingEmployeeId),
        inArray(trackingSessions.status, ["ACTIVE", "PAUSED"]),
      )).orderBy(desc(trackingSessions.startedAt)).limit(5);
      activeTrackingSession = sessionRows[0] ?? null;
      if (action === "check_in") {
        if (activeTrackingSession) return Response.json({ error: "driver_tracking_session_already_active", sessionId: activeTrackingSession.id }, { status: 409 });
        trackingOperation = "start";
        trackingSessionId = `TRACKING-SESSION-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
      } else if (action === "correction_approve") {
        if (activeTrackingSession) {
          trackingOperation = "close";
          trackingSessionId = activeTrackingSession.id;
        }
      } else if (action === "pause" || action === "resume" || action === "check_out") {
        if (!activeTrackingSession) return Response.json({ error: "driver_tracking_session_not_open", reason: "driver_tracking_is_opened_by_check_in_and_closed_by_check_out" }, { status: 409 });
        if (action === "pause" && activeTrackingSession.status !== "ACTIVE") return Response.json({ error: "driver_tracking_session_not_active" }, { status: 409 });
        if (action === "resume" && activeTrackingSession.status !== "PAUSED") return Response.json({ error: "driver_tracking_session_not_paused" }, { status: 409 });
        trackingOperation = action === "check_out" ? "close" : action;
        trackingSessionId = activeTrackingSession.id;
      }
    }
    const eventMissionId = action === "correction_approve"
      ? bounded(storedOperational.missionId, 120) || null
      : operational.mission?.id ?? null;
    const eventVehicleId = action === "correction_approve"
      ? activeTrackingSession?.vehicleId ?? (bounded(storedOperational.vehicleId, 120) || null)
      : operational.vehicleId;
    const eventTrackingDeviceId = action === "correction_approve"
      ? activeTrackingSession?.trackingDeviceId ?? (bounded(storedOperational.trackingDeviceId, 120) || null)
      : operational.trackingDeviceId;
    const eventTrackingSource = action === "correction_approve"
      ? activeTrackingSession?.trackingSource ?? (bounded(storedOperational.trackingSource, 40) || null)
      : operational.trackingSource;

    const workerId = targetWorkerId;
    const transition = {
      action,
      recordedAt: now,
      clientObservedAt: Number.isFinite(Date.parse(clientObservedAt)) ? clientObservedAt : null,
      by: context.actorId,
      note: bounded(input.note, 1_000),
      correctionAt: effectiveCorrectionAt,
      location: locationWithGeofence,
      dutyMode: targetIsDriver ? "DRIVER" : operational.mode,
      missionId: eventMissionId,
      vehicleId: eventVehicleId,
      trackingSessionId,
    };
    const trackingState = targetIsDriver
      ? {
        mode: "DRIVER",
        status: trackingOperation === "start" ? "STARTED" : trackingOperation === "pause" ? "PAUSED" : trackingOperation === "resume" ? "ACTIVE" : trackingOperation === "close" ? "CLOSED" : bounded(isRecord(currentPayload.tracking) ? currentPayload.tracking.status : "", 24, "DEGRADED"),
        sessionId: trackingSessionId,
        missionId: eventMissionId,
        vehicleId: eventVehicleId,
        trackingDeviceId: eventTrackingDeviceId,
        source: eventTrackingSource,
        updatedAt: now,
      }
      : { mode: "FIELD", status: "NOT_REQUIRED", sessionId: null, updatedAt: now };
    const payload = {
      ...currentPayload,
      workerId,
      teamId: bounded(input.teamId, 120),
      privacy: { mode: "ON_DUTY_ONLY", locationOptional: false, precision: "4_DECIMAL_PLACES", retentionClass: "OPERATIONAL" },
      operationalContext: action === "correction_approve" && Object.keys(storedOperational).length
        ? storedOperational
        : persistedOperationalContext(operational),
      tracking: trackingOperation === null && action !== "correction_request" && action !== "correction_approve"
        ? currentPayload.tracking ?? trackingState
        : trackingState,
      transitions: [...transitions, transition],
      lastTransition: transition,
      status: actionContract.next,
      correctionNote: action === "correction_request" ? bounded(input.correctionNote ?? input.note, 2_000) : bounded(currentPayload.correctionNote, 2_000),
    } satisfies JsonObject;
    const eventId = crypto.randomUUID();
    const nextVersion = (latest?.version ?? 0) + 1;
    failureStage = "build_attendance_statements";
    const attendanceStatements: BatchItem<"sqlite">[] = latest
      ? [
        db.update(jobJourneyRecords).set({ status: actionContract.next, version: nextVersion, payloadJson: JSON.stringify(payload), updatedBy: context.actorId, updatedAt: now }).where(and(eq(jobJourneyRecords.tenantId, context.tenantId), eq(jobJourneyRecords.id, latest.id), eq(jobJourneyRecords.version, latest.version))).returning(),
        db.insert(s06Events).values({ eventId, tenantId: context.tenantId, eventType: `field.attendance.${action}`, schemaVersion: "1", actorType: "human", actorId: context.actorId, source: "sites-field-attendance", occurredAt: transition.recordedAt, observedAt: now, aggregateType: "job.journey.attendance", aggregateId, aggregateVersion: nextVersion, payloadJson: JSON.stringify(transition), correlationId: crypto.randomUUID(), causationId: null, idempotencyKey, status: "COMMITTED_SITES_READBACK", createdAt: now }),
        db.insert(s06Outbox).values({ id: crypto.randomUUID(), tenantId: context.tenantId, eventId, topic: `zerow.field.attendance.${action}`, status: "PENDING_EXTERNAL_CONSUMER", attempts: 0, createdAt: now, updatedAt: now }),
        db.insert(s06Reconciliations).values({ id: crypto.randomUUID(), tenantId: context.tenantId, aggregateType: "job.journey.attendance", aggregateId, expectedVersion: nextVersion, observedVersion: nextVersion, status: "SITES_READBACK_VERIFIED", detail: "Attendance aggiornata con transizione versionata e policy on-duty.", createdAt: now, updatedAt: now }),
      ]
      : [
        db.insert(jobJourneyRecords).values({ id: aggregateId, tenantId: context.tenantId, jobId: job.id, domain: "field", recordType: "ATTENDANCE", title: "Presenza operativa", status: actionContract.next, version: 1, payloadJson: JSON.stringify(payload), idempotencyKey, createdBy: context.actorId, updatedBy: context.actorId, createdAt: now, updatedAt: now }),
        db.insert(s06Events).values({ eventId, tenantId: context.tenantId, eventType: `field.attendance.${action}`, schemaVersion: "1", actorType: "human", actorId: context.actorId, source: "sites-field-attendance", occurredAt: transition.recordedAt, observedAt: now, aggregateType: "job.journey.attendance", aggregateId, aggregateVersion: 1, payloadJson: JSON.stringify(transition), correlationId: crypto.randomUUID(), causationId: null, idempotencyKey, status: "COMMITTED_SITES_READBACK", createdAt: now }),
        db.insert(s06Outbox).values({ id: crypto.randomUUID(), tenantId: context.tenantId, eventId, topic: `zerow.field.attendance.${action}`, status: "PENDING_EXTERNAL_CONSUMER", attempts: 0, createdAt: now, updatedAt: now }),
        db.insert(s06Reconciliations).values({ id: crypto.randomUUID(), tenantId: context.tenantId, aggregateType: "job.journey.attendance", aggregateId, expectedVersion: 1, observedVersion: 1, status: "SITES_READBACK_VERIFIED", detail: "Check-in attendance persistito con policy on-duty.", createdAt: now, updatedAt: now }),
      ];
    const trackingStatements: BatchItem<"sqlite">[] = [];
    if (trackingOperation === "start" && trackingSessionId && operational.trackingDeviceId && operational.vehicleId && operational.trackingSource) {
      const trackingEventId = crypto.randomUUID();
      const evidence = {
        attendanceId: aggregateId,
        jobId: job.id,
        missionId: operational.mission?.id ?? null,
        transportMode: operational.mission?.transportMode ?? null,
        policy: "AFTER_VALID_ATTENDANCE_CHECK_IN",
        policySnapshotId: `policy:${context.tenantId}:attendance-driver-v1`,
        trackingSource: operational.trackingSource,
        trackingDeviceId: operational.trackingDeviceId,
        vehicleId: operational.vehicleId,
        bindingId: operational.bindingId,
        origin: operational.origin ? { entityType: operational.origin.entityType, entityId: operational.origin.entityId, geofenceId: operational.origin.geofence?.id ?? null } : null,
        destination: operational.destination ? { entityType: operational.destination.entityType, entityId: operational.destination.entityId, geofenceId: operational.destination.geofence?.id ?? null } : null,
      };
      trackingStatements.push(
        db.insert(trackingSessions).values({ id: trackingSessionId, tenantId: context.tenantId, employeeId: context.actorId, vehicleId: operational.vehicleId, trackingDeviceId: operational.trackingDeviceId, shiftId: `ATTENDANCE-${aggregateId}`, startedAt: now, endedAt: null, trackingSource: operational.trackingSource, status: "ACTIVE", createdBy: context.actorId, policySnapshotId: `policy:${context.tenantId}:attendance-driver-v1`, engineStateJson: JSON.stringify({ __operationalContext: persistedOperationalContext(operational) }), failureReason: "", createdAt: now, updatedAt: now }),
        db.insert(locationEvents).values({ id: crypto.randomUUID(), tenantId: context.tenantId, eventType: "TRACKING_SESSION_STARTED", occurredAt: now, trackingSessionId, employeeId: context.actorId, vehicleId: operational.vehicleId, locationId: attendanceGeofence.locationId, geofenceId: attendanceGeofence.geofenceId, source: "ZEROW_ATTENDANCE_GATE", confidenceMilli: attendanceGeofence.status === "INSIDE" ? 1000 : 700, evidenceJson: JSON.stringify(evidence), correlationId: crypto.randomUUID(), dedupeKey: `tracking-session-started:${trackingSessionId}`, createdAt: now }),
        db.insert(s06Events).values({ eventId: trackingEventId, tenantId: context.tenantId, eventType: "location.tracking_session.started", schemaVersion: "1", actorType: "human", actorId: context.actorId, source: "sites-location-intelligence", occurredAt: now, observedAt: now, aggregateType: "tracking.session", aggregateId: trackingSessionId, aggregateVersion: 1, payloadJson: JSON.stringify(evidence), correlationId: crypto.randomUUID(), causationId: null, idempotencyKey: `${idempotencyKey}:tracking`, status: "COMMITTED_SITES_READBACK", createdAt: now }),
        db.insert(s06Outbox).values({ id: crypto.randomUUID(), tenantId: context.tenantId, eventId: trackingEventId, topic: "zerow.location.tracking_session.started", status: "PENDING_EXTERNAL_CONSUMER", attempts: 0, createdAt: now, updatedAt: now }),
        db.insert(s06Reconciliations).values({ id: crypto.randomUUID(), tenantId: context.tenantId, aggregateType: "tracking.session", aggregateId: trackingSessionId, expectedVersion: 1, observedVersion: 1, status: "SITES_READBACK_VERIFIED", detail: "Tracking aperto dal server esclusivamente dopo una timbratura di ingresso valida.", createdAt: now, updatedAt: now }),
      );
    } else if (trackingOperation && activeTrackingSession) {
      const nextTrackingStatus = trackingOperation === "close" ? "CLOSED" : trackingOperation === "pause" ? "PAUSED" : "ACTIVE";
      const trackingEventId = crypto.randomUUID();
      const correctionApproval = action === "correction_approve";
      const evidence = {
        attendanceId: aggregateId,
        jobId: job.id,
        missionId: eventMissionId,
        action: trackingOperation,
        previousStatus: activeTrackingSession.status,
        nextStatus: nextTrackingStatus,
        policy: correctionApproval ? "MANUAL_EXIT_CORRECTION_APPROVED" : "ATTENDANCE_BOUND",
        correctedExitAt: correctionApproval ? effectiveCorrectionAt : null,
      };
      trackingStatements.push(
        db.update(trackingSessions).set({ status: nextTrackingStatus, endedAt: trackingOperation === "close" ? now : activeTrackingSession.endedAt, updatedAt: now }).where(and(eq(trackingSessions.tenantId, context.tenantId), eq(trackingSessions.id, activeTrackingSession.id), eq(trackingSessions.status, activeTrackingSession.status))),
        ...(trackingOperation === "close" ? [db.insert(locationEvents).values({ id: crypto.randomUUID(), tenantId: context.tenantId, eventType: "TRACKING_SESSION_ENDED", occurredAt: now, trackingSessionId: activeTrackingSession.id, employeeId: activeTrackingSession.employeeId, vehicleId: activeTrackingSession.vehicleId, locationId: correctionApproval ? null : attendanceGeofence.locationId, geofenceId: correctionApproval ? null : attendanceGeofence.geofenceId, source: "ZEROW_ATTENDANCE_GATE", confidenceMilli: correctionApproval ? 0 : attendanceGeofence.status === "INSIDE" ? 1000 : 700, evidenceJson: JSON.stringify(evidence), correlationId: crypto.randomUUID(), dedupeKey: `tracking-session-ended:${activeTrackingSession.id}:${aggregateId}`, createdAt: now })] : []),
        db.insert(s06Events).values({ eventId: trackingEventId, tenantId: context.tenantId, eventType: `location.tracking_session.${trackingOperation}`, schemaVersion: "1", actorType: "human", actorId: context.actorId, source: "sites-location-intelligence", occurredAt: now, observedAt: now, aggregateType: "tracking.session", aggregateId: activeTrackingSession.id, aggregateVersion: Date.now(), payloadJson: JSON.stringify(evidence), correlationId: crypto.randomUUID(), causationId: null, idempotencyKey: `${idempotencyKey}:tracking`, status: "COMMITTED_SITES_READBACK", createdAt: now }),
        db.insert(s06Outbox).values({ id: crypto.randomUUID(), tenantId: context.tenantId, eventId: trackingEventId, topic: `zerow.location.tracking_session.${trackingOperation}`, status: "PENDING_EXTERNAL_CONSUMER", attempts: 0, createdAt: now, updatedAt: now }),
        db.insert(s06Reconciliations).values({ id: crypto.randomUUID(), tenantId: context.tenantId, aggregateType: "tracking.session", aggregateId: activeTrackingSession.id, expectedVersion: Date.now(), observedVersion: Date.now(), status: "SITES_READBACK_VERIFIED", detail: "Stato tracking riallineato alla transizione di presenza.", createdAt: now, updatedAt: now }),
      );
    }
    failureStage = "commit_attendance_batch";
    const results = await db.batch([...attendanceStatements, ...trackingStatements] as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
    failureStage = "read_attendance_back";
    const updated = latest ? (results[0] as unknown as (typeof jobJourneyRecords.$inferSelect)[])[0] : (await db.select().from(jobJourneyRecords).where(eq(jobJourneyRecords.id, aggregateId)).limit(1))[0];
    if (!updated) return Response.json({ error: "attendance_readback_unavailable" }, { status: 503 });
    const [trackingReadback] = trackingSessionId
      ? await db.select().from(trackingSessions).where(and(eq(trackingSessions.tenantId, context.tenantId), eq(trackingSessions.id, trackingSessionId))).limit(1)
      : [];
    return Response.json({ attendance: attendanceForResponse(updated), tracking: trackingReadback ? sessionForResponse(trackingReadback) : { status: operational.mode === "DRIVER" ? trackingState.status : "NOT_REQUIRED", sessionId: null }, eventId, idempotent: false, readback: "verified" }, { status: latest ? 200 : 201, headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    console.error("attendance_write_failed", { stage: failureStage, action, message: message.slice(0, 240) });
    if (/unique|constraint/i.test(message)) return Response.json({ error: "attendance_idempotency_or_version_conflict" }, { status: 409 });
    return Response.json({ error: "attendance_write_unavailable" }, { status: 503 });
  }
}
