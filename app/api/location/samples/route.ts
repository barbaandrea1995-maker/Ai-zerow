import { getAuthorityContext, hasCapability, publicAuthorityContext } from "@/lib/authority-context";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { trackingSessions } from "@/db/schema";
import { LocationIngestionError, eventsForResponse, ingestLocationPosition } from "@/lib/location-intelligence/ingest";
import { isTrackingSource } from "@/lib/location-intelligence/types";

export const dynamic = "force-dynamic";

type JsonObject = Record<string, unknown>;

function bounded(value: unknown, max: number, fallback = "") {
  return typeof value === "string" ? value.trim().slice(0, max) : fallback;
}

function numberOrNull(value: unknown, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? Math.round(parsed) : null;
}

function responseHeaders() {
  return { "cache-control": "private, no-store" };
}

export async function POST(request: Request) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "location.read.current") && !hasCapability(context, "location.manage.tracking.devices")) {
    return Response.json({ error: "forbidden", capability: "location.read.current" }, { status: 403 });
  }
  let input: JsonObject;
  try {
    const parsed = await request.json() as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return Response.json({ error: "invalid_json" }, { status: 400 });
    input = parsed as JsonObject;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const sessionId = bounded(input.trackingSessionId, 160);
  const source = bounded(input.provider ?? input.trackingSource, 40).toUpperCase() || "NATIVE_DEVICE";
  const recordedAt = bounded(input.recordedAt, 40);
  const recordedTime = Date.parse(recordedAt);
  const coordinates = input.coordinates && typeof input.coordinates === "object" && !Array.isArray(input.coordinates)
    ? input.coordinates as JsonObject
    : input;
  const latitude = Number(coordinates.latitude ?? coordinates.lat);
  const longitude = Number(coordinates.longitude ?? coordinates.lon ?? coordinates.lng);
  const accuracyM = numberOrNull(input.accuracyM ?? input.accuracy, 0, 10_000);
  if (!sessionId) return Response.json({ error: "tracking_session_id_required" }, { status: 400 });
  if (!isTrackingSource(source)) return Response.json({ error: "unsupported_tracking_source" }, { status: 400 });
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return Response.json({ error: "valid_coordinates_required" }, { status: 400 });
  if (!recordedAt || !Number.isFinite(recordedTime)) return Response.json({ error: "recorded_at_required" }, { status: 400 });
  if (recordedTime > Date.now() + 5 * 60_000) return Response.json({ error: "recorded_at_cannot_be_in_future" }, { status: 400 });

  try {
    const [session] = await getDb().select().from(trackingSessions).where(and(eq(trackingSessions.tenantId, context.tenantId), eq(trackingSessions.id, sessionId))).limit(1);
    if (!session) return Response.json({ error: "tracking_session_not_found" }, { status: 404 });
    if (session.employeeId !== context.actorId && !hasCapability(context, "location.manage.tracking.devices")) return Response.json({ error: "tracking_session_scope_forbidden" }, { status: 403 });
    const result = await ingestLocationPosition({
      tenantId: context.tenantId,
      trackingSessionId: sessionId,
      source,
      position: {
        deviceId: sessionId,
        providerEventId: bounded(input.providerEventId, 160) || undefined,
        recordedAt,
        latitude,
        longitude,
        accuracyM,
        speedKmh: numberOrNull(input.speedKmh ?? input.speed, 0, 500),
        heading: numberOrNull(input.heading ?? input.course, 0, 360),
        altitude: numberOrNull(input.altitude, -1_000, 20_000),
        metadata: {},
      },
    });
    return Response.json({
      context: publicAuthorityContext(context),
      sample: { id: result.sample.id, recordedAt: result.sample.recordedAt, receivedAt: result.sample.receivedAt, source, accuracyM, rawCoordinateStored: true },
      derivedEvents: eventsForResponse(result.events),
      idempotent: result.idempotent,
      engine: { deterministic: true, rawGpsIsNotBusinessTruth: true, minimumConsistentSamples: 2, maximumAccuracyMetersForConfirmation: 50, entryDwellSeconds: 90 },
      readback: { status: "verified", scope: "tenant", checkedAt: new Date().toISOString() },
    }, { status: result.idempotent ? 200 : 201, headers: responseHeaders() });
  } catch (error) {
    if (error instanceof LocationIngestionError) return Response.json({ error: error.code }, { status: error.code === "tracking_session_not_found" ? 404 : 409 });
    const message = error instanceof Error ? error.message : "";
    if (/unique|constraint/i.test(message)) return Response.json({ error: "location_sample_duplicate" }, { status: 409 });
    return Response.json({ error: "location_sample_ingestion_unavailable" }, { status: 503 });
  }
}
