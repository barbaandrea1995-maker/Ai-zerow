import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { geofences, locationEvents, locationSamples, trackingSessions } from "@/db/schema";
import { evaluateGeofenceSample, normalizeCoordinate } from "@/lib/location-intelligence/geometry";
import { eventForResponse, geofenceForEngine, parseEngineState } from "@/lib/location-intelligence/repository";
import type { LocationEventType } from "@/lib/location-intelligence/types";
import type { TrackingPosition } from "@/lib/location-intelligence/providers";

export class LocationIngestionError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

function domainEventType(entityType: string, entering: boolean) {
  const suffix = entering ? "ARRIVAL" : "DEPARTURE";
  if (entityType === "MAGAZZINO") return `WAREHOUSE_${suffix}`;
  if (entityType === "COMMESSA" || entityType === "CANTIERE") return `SITE_${suffix}`;
  if (["CLIENTE", "DESTINATARIO", "PUNTO_DI_SCARICO"].includes(entityType)) return `CUSTOMER_${suffix}`;
  if (entityType === "FORNITORE") return `SUPPLIER_${suffix}`;
  return null;
}

export async function ingestLocationPosition({
  tenantId,
  trackingSessionId,
  source,
  position,
}: {
  tenantId: string;
  trackingSessionId: string;
  source: string;
  position: TrackingPosition;
}) {
  const db = getDb();
  const [session] = await db.select().from(trackingSessions).where(and(eq(trackingSessions.tenantId, tenantId), eq(trackingSessions.id, trackingSessionId))).limit(1);
  if (!session) throw new LocationIngestionError("tracking_session_not_found");
  if (session.status !== "ACTIVE") throw new LocationIngestionError("tracking_session_not_active");
  const coordinate = normalizeCoordinate(position);
  const recordedTime = Date.parse(position.recordedAt);
  if (!coordinate || !Number.isFinite(recordedTime)) throw new LocationIngestionError("invalid_location_sample");
  const providerEventId = position.providerEventId?.slice(0, 160) ?? "";
  const dedupeKey = providerEventId
    ? `${source}:event:${providerEventId}`
    : `${source}:sample:${session.id}:${position.recordedAt}:${Math.round(coordinate.latitude * 100000)}:${Math.round(coordinate.longitude * 100000)}`;
  const [existing] = await db.select().from(locationSamples).where(and(eq(locationSamples.tenantId, tenantId), eq(locationSamples.dedupeKey, dedupeKey))).limit(1);
  if (existing) {
    const events = await db.select().from(locationEvents).where(and(eq(locationEvents.tenantId, tenantId), eq(locationEvents.trackingSessionId, session.id), eq(locationEvents.occurredAt, existing.recordedAt))).limit(100);
    return { session, sample: existing, events, idempotent: true };
  }

  const activeGeofences = await db.select().from(geofences).where(and(eq(geofences.tenantId, tenantId), eq(geofences.status, "ACTIVE"))).limit(500);
  const engineState = parseEngineState(session.engineStateJson);
  const sampleId = `LOCATION-SAMPLE-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
  const now = new Date().toISOString();
  const derived = activeGeofences.flatMap((row) => {
    const geofence = geofenceForEngine(row);
    if (!geofence) return [];
    const evaluated = evaluateGeofenceSample({
      sample: { ...coordinate, accuracyMeters: position.accuracyM ?? null, recordedAt: position.recordedAt, sampleId },
      geofence,
      previous: engineState[row.id],
    });
    engineState[row.id] = evaluated.state;
    const drafts = [...evaluated.events];
    for (const draft of evaluated.events) {
      if (draft.eventType !== "GEOFENCE_ENTER_CONFIRMED" && draft.eventType !== "GEOFENCE_EXIT_CONFIRMED") continue;
      const domainType = domainEventType(row.entityType, draft.eventType === "GEOFENCE_ENTER_CONFIRMED");
      if (domainType) drafts.push({ ...draft, eventType: domainType as LocationEventType, dedupeKey: `${draft.dedupeKey}:${domainType}` });
    }
    return drafts.map((draft) => ({ ...draft, confidenceMilli: Math.round(draft.confidence * 1_000) }));
  });

  await db.batch([
    db.insert(locationSamples).values({
      id: sampleId,
      tenantId,
      trackingSessionId: session.id,
      trackingDeviceId: session.trackingDeviceId,
      vehicleId: session.vehicleId,
      recordedAt: position.recordedAt,
      receivedAt: now,
      latitudeE6: Math.round(coordinate.latitude * 1_000_000),
      longitudeE6: Math.round(coordinate.longitude * 1_000_000),
      accuracyM: position.accuracyM ?? null,
      speedKmh: position.speedKmh ?? null,
      heading: position.heading ?? null,
      altitude: position.altitude ?? null,
      provider: source,
      providerEventId: providerEventId || null,
      dedupeKey,
      rawMetadataJson: JSON.stringify({ provider: source, providerEventId: providerEventId || null, accuracyUsedForConfirmation: position.accuracyM !== null && position.accuracyM !== undefined && position.accuracyM <= 50 }),
      createdAt: now,
    }),
    ...derived.map((draft) => db.insert(locationEvents).values({
      id: `LOCATION-EVENT-${crypto.randomUUID().slice(0, 12).toUpperCase()}`,
      tenantId,
      eventType: draft.eventType,
      occurredAt: draft.occurredAt,
      trackingSessionId: session.id,
      employeeId: session.employeeId,
      vehicleId: session.vehicleId,
      locationId: draft.locationId ?? null,
      geofenceId: draft.geofenceId ?? null,
      source: "ZEROW_DETERMINISTIC_LOCATION_ENGINE",
      confidenceMilli: draft.confidenceMilli,
      evidenceJson: JSON.stringify(draft.evidence),
      correlationId: crypto.randomUUID(),
      dedupeKey: `${session.id}:${draft.dedupeKey}`,
      createdAt: now,
    })),
    db.update(trackingSessions).set({ engineStateJson: JSON.stringify(engineState), updatedAt: now }).where(and(eq(trackingSessions.tenantId, tenantId), eq(trackingSessions.id, session.id), eq(trackingSessions.status, "ACTIVE"))),
  ]);
  const events = derived.length
    ? await db.select().from(locationEvents).where(and(eq(locationEvents.tenantId, tenantId), eq(locationEvents.trackingSessionId, session.id), eq(locationEvents.occurredAt, derived[0].occurredAt))).limit(100)
    : [];
  return {
    session,
    sample: {
      id: sampleId,
      tenantId,
      trackingSessionId: session.id,
      recordedAt: position.recordedAt,
      receivedAt: now,
      provider: source,
      accuracyM: position.accuracyM ?? null,
    },
    events,
    idempotent: false,
  };
}

export function eventsForResponse(events: Array<typeof locationEvents.$inferSelect>) {
  return events.map(eventForResponse);
}
