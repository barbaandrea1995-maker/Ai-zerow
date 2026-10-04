import type {
  Coordinate,
  DerivedEventDraft,
  GeofenceDefinition,
  GeofenceEngineState,
} from "@/lib/location-intelligence/types";

const EARTH_RADIUS_METERS = 6_371_000;
const DEFAULT_MIN_SAMPLES = 2;
const DEFAULT_MAX_ACCURACY_METERS = 50;
const DEFAULT_ENTRY_DWELL_SECONDS = 90;
const DEFAULT_EXIT_DISTANCE_FACTOR = 1.25;

export function normalizeCoordinate(value: unknown): Coordinate | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const latitude = Number(candidate.latitude ?? candidate.lat);
  const longitude = Number(candidate.longitude ?? candidate.lon ?? candidate.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return {
    latitude: Math.round(latitude * 1_000_000) / 1_000_000,
    longitude: Math.round(longitude * 1_000_000) / 1_000_000,
  };
}

export function distanceMeters(left: Coordinate, right: Coordinate) {
  const toRadians = (value: number) => value * Math.PI / 180;
  const deltaLatitude = toRadians(right.latitude - left.latitude);
  const deltaLongitude = toRadians(right.longitude - left.longitude);
  const latitude1 = toRadians(left.latitude);
  const latitude2 = toRadians(right.latitude);
  const a = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(deltaLongitude / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function pointOnSegment(point: Coordinate, start: Coordinate, end: Coordinate) {
  const cross = (point.longitude - start.longitude) * (end.latitude - start.latitude)
    - (point.latitude - start.latitude) * (end.longitude - start.longitude);
  if (Math.abs(cross) > 1e-10) return false;
  return point.longitude >= Math.min(start.longitude, end.longitude) - 1e-10
    && point.longitude <= Math.max(start.longitude, end.longitude) + 1e-10
    && point.latitude >= Math.min(start.latitude, end.latitude) - 1e-10
    && point.latitude <= Math.max(start.latitude, end.latitude) + 1e-10;
}

export function pointInPolygon(point: Coordinate, polygon: Coordinate[]) {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const current = polygon[index];
    const prior = polygon[previous];
    if (pointOnSegment(point, prior, current)) return true;
    const intersects = ((current.latitude > point.latitude) !== (prior.latitude > point.latitude))
      && (point.longitude < (prior.longitude - current.longitude)
        * (point.latitude - current.latitude)
        / (prior.latitude - current.latitude)
        + current.longitude);
    if (intersects) inside = !inside;
  }
  return inside;
}

function candidateState(state: GeofenceEngineState | undefined): GeofenceEngineState {
  return state ?? { state: "OUTSIDE", candidateSamples: 0 };
}

function secondsBetween(start: string | undefined, end: string) {
  if (!start) return 0;
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0;
  return Math.max(0, (endMs - startMs) / 1_000);
}

export function evaluateGeofenceSample({
  sample,
  geofence,
  previous,
  minimumConsistentSamples = DEFAULT_MIN_SAMPLES,
  maximumAccuracyMeters = DEFAULT_MAX_ACCURACY_METERS,
  entryDwellSeconds = DEFAULT_ENTRY_DWELL_SECONDS,
  exitDistanceFactor = DEFAULT_EXIT_DISTANCE_FACTOR,
}: {
  sample: Coordinate & { accuracyMeters?: number | null; recordedAt: string; sampleId: string };
  geofence: GeofenceDefinition;
  previous?: GeofenceEngineState;
  minimumConsistentSamples?: number;
  maximumAccuracyMeters?: number;
  entryDwellSeconds?: number;
  exitDistanceFactor?: number;
}): { state: GeofenceEngineState; inside: boolean; distanceMeters: number | null; events: DerivedEventDraft[] } {
  const center = geofence.center ?? null;
  const polygon = geofence.polygon ?? [];
  const distance = center ? Math.round(distanceMeters(sample, center)) : null;
  const inside = geofence.shapeType === "POLYGON"
    ? pointInPolygon(sample, polygon)
    : Boolean(center && geofence.radiusMeters && distance !== null && distance <= geofence.radiusMeters);
  const accurate = (sample.accuracyMeters ?? Number.POSITIVE_INFINITY) <= maximumAccuracyMeters;
  const prior = candidateState(previous);
  const evidenceBase = {
    sampleId: sample.sampleId,
    accuracyMeters: sample.accuracyMeters ?? null,
    distanceMeters: distance,
    maximumAccuracyMeters,
    rule: "ZEROW_LOCATION_EVENT_ENGINE_V1",
  };
  const events: DerivedEventDraft[] = [];

  if (inside) {
    if (prior.state === "INSIDE") {
      return {
        state: { ...prior, lastRecordedAt: sample.recordedAt, lastDistanceM: distance },
        inside,
        distanceMeters: distance,
        events,
      };
    }
    const candidateSince = prior.state === "CANDIDATE_ENTER" ? prior.candidateSince : sample.recordedAt;
    const candidateSamples = prior.state === "CANDIDATE_ENTER" ? prior.candidateSamples + 1 : 1;
    const canConfirm = accurate
      && candidateSamples >= minimumConsistentSamples
      && secondsBetween(candidateSince, sample.recordedAt) >= entryDwellSeconds;
    if (canConfirm) {
      events.push({
        eventType: "GEOFENCE_ENTER_CONFIRMED",
        occurredAt: sample.recordedAt,
        locationId: geofence.locationId,
        geofenceId: geofence.id,
        confidence: geofence.shapeType === "CIRCLE" ? 0.98 : 0.95,
        evidence: { ...evidenceBase, candidateSamples, dwellSeconds: secondsBetween(candidateSince, sample.recordedAt) },
        dedupeKey: `geofence-enter-confirmed:${geofence.id}:${sample.recordedAt}`,
      });
      return {
        state: { state: "INSIDE", candidateSamples: 0, lastRecordedAt: sample.recordedAt, lastDistanceM: distance },
        inside,
        distanceMeters: distance,
        events,
      };
    }
    events.push({
      eventType: "GEOFENCE_ENTER_CANDIDATE",
      occurredAt: sample.recordedAt,
      locationId: geofence.locationId,
      geofenceId: geofence.id,
      confidence: accurate ? 0.65 : 0.35,
      evidence: { ...evidenceBase, candidateSamples, dwellSeconds: secondsBetween(candidateSince, sample.recordedAt), confirmed: false },
      dedupeKey: `geofence-enter-candidate:${geofence.id}:${sample.recordedAt}`,
    });
    return {
      state: { state: "CANDIDATE_ENTER", candidateSince, candidateSamples, lastRecordedAt: sample.recordedAt, lastDistanceM: distance },
      inside,
      distanceMeters: distance,
      events,
    };
  }

  if (prior.state !== "INSIDE" && prior.state !== "CANDIDATE_EXIT") {
    return {
      state: { state: "OUTSIDE", candidateSamples: 0, lastRecordedAt: sample.recordedAt, lastDistanceM: distance },
      inside,
      distanceMeters: distance,
      events,
    };
  }

  const outsideBeyondHysteresis = geofence.shapeType === "POLYGON"
    ? !inside
    : Boolean(distance !== null && geofence.radiusMeters && distance >= geofence.radiusMeters * exitDistanceFactor);
  if (!outsideBeyondHysteresis || !accurate) {
    return {
      state: { ...prior, lastRecordedAt: sample.recordedAt, lastDistanceM: distance },
      inside,
      distanceMeters: distance,
      events,
    };
  }
  const candidateSince = prior.state === "CANDIDATE_EXIT" ? prior.candidateSince : sample.recordedAt;
  const candidateSamples = prior.state === "CANDIDATE_EXIT" ? prior.candidateSamples + 1 : 1;
  if (candidateSamples >= minimumConsistentSamples) {
    events.push({
      eventType: "GEOFENCE_EXIT_CONFIRMED",
      occurredAt: sample.recordedAt,
      locationId: geofence.locationId,
      geofenceId: geofence.id,
      confidence: geofence.shapeType === "CIRCLE" ? 0.98 : 0.95,
      evidence: { ...evidenceBase, candidateSamples, exitDistanceFactor },
      dedupeKey: `geofence-exit-confirmed:${geofence.id}:${sample.recordedAt}`,
    });
    return {
      state: { state: "OUTSIDE", candidateSamples: 0, lastRecordedAt: sample.recordedAt, lastDistanceM: distance },
      inside,
      distanceMeters: distance,
      events,
    };
  }
  return {
    state: { state: "CANDIDATE_EXIT", candidateSince, candidateSamples, lastRecordedAt: sample.recordedAt, lastDistanceM: distance },
    inside,
    distanceMeters: distance,
    events,
  };
}
