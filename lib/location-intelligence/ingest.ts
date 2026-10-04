import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { geofences, locationEvents, locationSamples, routePlans, routeStops, trackingSessions } from "@/db/schema";
import { evaluateGeofenceSample, normalizeCoordinate } from "@/lib/location-intelligence/geometry";
import { eventForResponse, geofenceForEngine, parseEngineState, parseJsonObject } from "@/lib/location-intelligence/repository";
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
  const rawEngineState = parseJsonObject(session.engineStateJson);
  const operationalContext = rawEngineState.__operationalContext && typeof rawEngineState.__operationalContext === "object" && !Array.isArray(rawEngineState.__operationalContext)
    ? rawEngineState.__operationalContext as Record<string, unknown>
    : null;
  const missionId = typeof operationalContext?.missionId === "string" ? operationalContext.missionId : "";
  const [routePlan] = missionId
    ? await db.select().from(routePlans).where(and(eq(routePlans.tenantId, tenantId), eq(routePlans.missionId, missionId))).limit(1)
    : [];
  const routeStopRows = routePlan
    ? await db.select().from(routeStops).where(and(eq(routeStops.tenantId, tenantId), eq(routeStops.routePlanId, routePlan.id))).orderBy(asc(routeStops.sequence)).limit(100)
    : [];
  const expectedGeofenceIds = new Set([
    operationalContext && typeof operationalContext.origin === "object" && operationalContext.origin && !Array.isArray(operationalContext.origin)
      ? (operationalContext.origin as Record<string, unknown>).geofenceId
      : null,
    operationalContext && typeof operationalContext.destination === "object" && operationalContext.destination && !Array.isArray(operationalContext.destination)
      ? (operationalContext.destination as Record<string, unknown>).geofenceId
      : null,
  ].filter((value): value is string => typeof value === "string" && value.length > 0));
  for (const stop of routeStopRows) {
    const metadata = parseJsonObject(stop.evidenceJson);
    if (typeof metadata.geofenceId === "string") expectedGeofenceIds.add(metadata.geofenceId);
  }
  const engineState = parseEngineState(session.engineStateJson);
  const activeRouteStop = routeStopRows.find((stop) => !["DEPARTED", "COMPLETED"].includes(stop.status)) ?? null;
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
    const routeStop = activeRouteStop && activeRouteStop.locationId === row.locationId
      ? (() => {
        const metadata = parseJsonObject(activeRouteStop.evidenceJson);
        return !metadata.geofenceId || metadata.geofenceId === row.id ? activeRouteStop : null;
      })()
      : null;
    const routeMetadata = routeStop ? parseJsonObject(routeStop.evidenceJson) : null;
    const drafts = [...evaluated.events];
    for (const draft of evaluated.events) {
      if (draft.eventType !== "GEOFENCE_ENTER_CONFIRMED" && draft.eventType !== "GEOFENCE_EXIT_CONFIRMED") continue;
      const domainType = domainEventType(row.entityType, draft.eventType === "GEOFENCE_ENTER_CONFIRMED");
      if (domainType) drafts.push({ ...draft, eventType: domainType as LocationEventType, dedupeKey: `${draft.dedupeKey}:${domainType}` });
      if (routeStop) {
        const entering = draft.eventType === "GEOFENCE_ENTER_CONFIRMED";
        drafts.push({
          ...draft,
          eventType: entering ? "STOP_STARTED" : "STOP_ENDED",
          dedupeKey: `${draft.dedupeKey}:route-stop:${routeStop.id}`,
          evidence: {
            ...draft.evidence,
            routePlanId: routePlan?.id ?? null,
            routeStopId: routeStop.id,
            sequence: routeStop.sequence,
            kind: routeMetadata?.kind ?? null,
            attachment: entering ? "ATTACHED" : "DETACHED",
            businessActionRequired: "CARGO_ACTION_REQUIRES_OPERATIONAL_EVIDENCE",
          },
        });
        if (!entering && routeMetadata?.kind === "DELIVERY" && routeStop.deliveryStatus !== "CONFIRMED") {
          drafts.push({
            ...draft,
            eventType: "DELIVERY_PROBABLE",
            dedupeKey: `${draft.dedupeKey}:delivery-probable:${routeStop.id}`,
            evidence: {
              ...draft.evidence,
              routePlanId: routePlan?.id ?? null,
              routeStopId: routeStop.id,
              rule: "GEOFENCE_ENTRY_DWELL_AND_CONFIRMED_DEPARTURE",
              confirmed: false,
            },
          });
        }
      }
    }
    return drafts.map((draft) => ({
      ...draft,
      confidenceMilli: Math.round(draft.confidence * 1_000),
      evidence: {
        ...draft.evidence,
        operationalContext: operationalContext
          ? {
            missionId: operationalContext.missionId ?? null,
            transportMode: operationalContext.transportMode ?? null,
            expectedStop: expectedGeofenceIds.has(draft.geofenceId ?? ""),
            routePlanId: routePlan?.id ?? null,
          }
          : null,
      },
    }));
  });

  const routeTransitions = new Map<string, { enteredAt?: string; exitedAt?: string; evidence: Record<string, unknown> }>();
  for (const draft of derived) {
    if (draft.eventType !== "GEOFENCE_ENTER_CONFIRMED" && draft.eventType !== "GEOFENCE_EXIT_CONFIRMED") continue;
    const stop = activeRouteStop && activeRouteStop.locationId === draft.locationId && parseJsonObject(activeRouteStop.evidenceJson).geofenceId === draft.geofenceId
      ? activeRouteStop
      : null;
    if (!stop) continue;
    const previous = routeTransitions.get(stop.id) ?? { evidence: {} };
    const next = { ...previous, evidence: { ...previous.evidence, lastGpsEvent: draft.eventType, lastObservedAt: draft.occurredAt, geofenceId: draft.geofenceId, locationId: draft.locationId } };
    if (draft.eventType === "GEOFENCE_ENTER_CONFIRMED") next.enteredAt = draft.occurredAt;
    if (draft.eventType === "GEOFENCE_EXIT_CONFIRMED") next.exitedAt = draft.occurredAt;
    routeTransitions.set(stop.id, next);
  }
  const routeStatements = routePlan ? routeStopRows.flatMap((stop) => {
    const transition = routeTransitions.get(stop.id);
    if (!transition) return [];
    const metadata = parseJsonObject(stop.evidenceJson);
    const entering = Boolean(transition.enteredAt);
    const exiting = Boolean(transition.exitedAt);
    const current = parseJsonObject(stop.evidenceJson);
    const evidenceJson = JSON.stringify({
      ...current,
      attachment: exiting ? "DETACHED" : entering ? "ATTACHED" : current.attachment ?? "PENDING",
      gpsEvidence: { ...transition.evidence, routePlanId: routePlan.id, routeStopId: stop.id, operationalOnly: true },
    });
    return [db.update(routeStops).set({
      status: exiting ? "DEPARTED" : entering ? "ARRIVED" : stop.status,
      deliveryStatus: exiting && metadata.kind === "DELIVERY" && stop.deliveryStatus !== "CONFIRMED" ? "PROBABLE" : stop.deliveryStatus,
      arrivedAt: transition.enteredAt ?? stop.arrivedAt,
      departedAt: transition.exitedAt ?? stop.departedAt,
      evidenceJson,
      updatedAt: now,
    }).where(and(eq(routeStops.tenantId, tenantId), eq(routeStops.id, stop.id))) as never];
  }) : [];
  const routeTransition = [...routeTransitions.entries()].at(-1);
  const routeState = routePlan && routeTransition
    ? { routePlanId: routePlan.id, routeStopId: routeTransition[0], attachment: routeTransition[1].exitedAt ? "DETACHED" : "ATTACHED", observedAt: routeTransition[1].exitedAt ?? routeTransition[1].enteredAt ?? now }
    : rawEngineState.__routeState ?? null;
  const routeEnded = Boolean(routePlan && routeTransitions.size > 0 && routeStopRows.every((stop) => {
    const transition = routeTransitions.get(stop.id);
    return stop.status === "DEPARTED" || stop.status === "COMPLETED" || Boolean(transition?.exitedAt);
  }));
  if (routePlan && routeTransitions.size > 0) {
    routeStatements.push(db.update(routePlans).set({
      status: routeEnded ? "COMPLETED" : "IN_PROGRESS",
      startedAt: routePlan.startedAt ?? now,
      endedAt: routeEnded ? now : routePlan.endedAt,
      updatedAt: now,
    }).where(and(eq(routePlans.tenantId, tenantId), eq(routePlans.id, routePlan.id))) as never);
  }

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
    db.update(trackingSessions).set({ engineStateJson: JSON.stringify({ ...engineState, __operationalContext: operationalContext, __routeState: routeState }), updatedAt: now }).where(and(eq(trackingSessions.tenantId, tenantId), eq(trackingSessions.id, session.id), eq(trackingSessions.status, "ACTIVE"))),
    ...routeStatements,
  ] as [never, ...never[]]);
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
