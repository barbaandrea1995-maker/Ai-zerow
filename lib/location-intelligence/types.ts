export const LOCATION_ENTITY_TYPES = [
  "COMMESSA",
  "MAGAZZINO",
  "CLIENTE",
  "FORNITORE",
  "DESTINATARIO",
  "SEDE_AZIENDALE",
  "CANTIERE",
  "PUNTO_DI_CARICO",
  "PUNTO_DI_SCARICO",
  "CUSTOM_LOCATION",
] as const;

export type LocationEntityType = (typeof LOCATION_ENTITY_TYPES)[number];

export const GEOFENCE_SHAPES = ["CIRCLE", "POLYGON"] as const;
export type GeofenceShape = (typeof GEOFENCE_SHAPES)[number];

export const TRACKING_SOURCES = [
  "VEHICLE_GPS",
  "NATIVE_MOBILE_APP",
  "PWA_GEOLOCATION",
  "EXTERNAL_FLEET_PROVIDER",
] as const;
export type TrackingSource = (typeof TRACKING_SOURCES)[number];

export const TRACKING_SESSION_STATUSES = ["PENDING", "ACTIVE", "PAUSED", "CLOSED", "FAILED"] as const;
export type TrackingSessionStatus = (typeof TRACKING_SESSION_STATUSES)[number];

export const LOCATION_EVENT_TYPES = [
  "TRACKING_SESSION_STARTED",
  "TRACKING_SESSION_ENDED",
  "GEOFENCE_ENTER_CANDIDATE",
  "GEOFENCE_ENTER_CONFIRMED",
  "GEOFENCE_EXIT_CONFIRMED",
  "STOP_STARTED",
  "STOP_ENDED",
  "WAREHOUSE_ARRIVAL",
  "WAREHOUSE_DEPARTURE",
  "SITE_ARRIVAL",
  "SITE_DEPARTURE",
  "CUSTOMER_ARRIVAL",
  "CUSTOMER_DEPARTURE",
  "SUPPLIER_ARRIVAL",
  "SUPPLIER_DEPARTURE",
  "ROUTE_STARTED",
  "ROUTE_ENDED",
  "UNPLANNED_STOP",
  "DELIVERY_PROBABLE",
  "DELIVERY_CONFIRMED",
] as const;
export type LocationEventType = (typeof LOCATION_EVENT_TYPES)[number];

export { MISSION_POD_EVIDENCE_TYPES as DELIVERY_EVIDENCE_TYPES };
export type DeliveryEvidenceType = MissionPodEvidenceType;

export type Coordinate = { latitude: number; longitude: number };
export type PolygonPoint = Coordinate;

export type GeofenceDefinition = {
  id: string;
  locationId: string;
  entityType: LocationEntityType | string;
  entityId: string;
  name: string;
  shapeType: GeofenceShape;
  center?: Coordinate | null;
  radiusMeters?: number | null;
  polygon?: PolygonPoint[];
};

export type GeofenceEngineStateName = "OUTSIDE" | "CANDIDATE_ENTER" | "INSIDE" | "CANDIDATE_EXIT";

export type GeofenceEngineState = {
  state: GeofenceEngineStateName;
  candidateSince?: string;
  candidateSamples: number;
  lastRecordedAt?: string;
  lastDistanceM?: number | null;
};

export type DerivedEventDraft = {
  eventType: LocationEventType;
  occurredAt: string;
  locationId?: string | null;
  geofenceId?: string | null;
  confidence: number;
  evidence: Record<string, unknown>;
  dedupeKey: string;
};

export function isLocationEntityType(value: unknown): value is LocationEntityType {
  return typeof value === "string" && (LOCATION_ENTITY_TYPES as readonly string[]).includes(value);
}

export function isGeofenceShape(value: unknown): value is GeofenceShape {
  return typeof value === "string" && (GEOFENCE_SHAPES as readonly string[]).includes(value);
}

export function isTrackingSource(value: unknown): value is TrackingSource {
  return typeof value === "string" && (TRACKING_SOURCES as readonly string[]).includes(value);
}
import { MISSION_POD_EVIDENCE_TYPES, type MissionPodEvidenceType } from "../mission-pod-contract";
