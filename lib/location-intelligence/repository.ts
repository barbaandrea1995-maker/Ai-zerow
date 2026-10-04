import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  geofences,
  geoLocations,
  locationAccessAudit,
  locationEvents,
  trackingSessions,
} from "@/db/schema";
import type { AuthorityContext } from "@/lib/authority-context";
import type {
  Coordinate,
  GeofenceDefinition,
  GeofenceEngineState,
  LocationEntityType,
} from "@/lib/location-intelligence/types";

export function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function parseJsonArray(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function coordinateFromLocation(row: typeof geoLocations.$inferSelect): Coordinate {
  return { latitude: row.latitudeE6 / 1_000_000, longitude: row.longitudeE6 / 1_000_000 };
}

export function geofenceForEngine(row: typeof geofences.$inferSelect): GeofenceDefinition | null {
  const center = row.centerLatitudeE6 !== null && row.centerLongitudeE6 !== null
    ? { latitude: row.centerLatitudeE6 / 1_000_000, longitude: row.centerLongitudeE6 / 1_000_000 }
    : null;
  const polygon = parseJsonArray(row.polygonJson).flatMap((point): Coordinate[] => {
    if (!point || typeof point !== "object" || Array.isArray(point)) return [];
    const candidate = point as Record<string, unknown>;
    const latitude = Number(candidate.latitude ?? candidate.lat);
    const longitude = Number(candidate.longitude ?? candidate.lon ?? candidate.lng);
    return Number.isFinite(latitude) && Number.isFinite(longitude)
      ? [{ latitude, longitude }]
      : [];
  });
  if (row.shapeType === "CIRCLE" && (!center || !row.radiusMeters)) return null;
  if (row.shapeType === "POLYGON" && polygon.length < 3) return null;
  return {
    id: row.id,
    locationId: row.locationId,
    entityType: row.entityType,
    entityId: row.entityId,
    name: row.name,
    shapeType: row.shapeType as "CIRCLE" | "POLYGON",
    center,
    radiusMeters: row.radiusMeters,
    polygon,
  };
}

export function locationForResponse(row: typeof geoLocations.$inferSelect) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    entityType: row.entityType,
    entityId: row.entityId,
    formattedAddress: row.formattedAddress,
    address: {
      street: row.street,
      streetNumber: row.streetNumber,
      city: row.city,
      province: row.province,
      postalCode: row.postalCode,
      country: row.country,
    },
    coordinates: coordinateFromLocation(row),
    provider: row.provider,
    providerPlaceId: row.providerPlaceId,
    geocodeConfidence: row.geocodeConfidenceMilli / 1_000,
    verifiedByUser: Boolean(row.verifiedByUser),
    verifiedAt: row.verifiedAt,
    status: row.status,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function geofenceForResponse(row: typeof geofences.$inferSelect) {
  return {
    id: row.id,
    locationId: row.locationId,
    entityType: row.entityType,
    entityId: row.entityId,
    name: row.name,
    shapeType: row.shapeType,
    center: row.centerLatitudeE6 !== null && row.centerLongitudeE6 !== null
      ? { latitude: row.centerLatitudeE6 / 1_000_000, longitude: row.centerLongitudeE6 / 1_000_000 }
      : null,
    radiusMeters: row.radiusMeters,
    polygon: parseJsonArray(row.polygonJson),
    status: row.status,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function sessionForResponse(row: typeof trackingSessions.$inferSelect) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    employeeId: row.employeeId,
    vehicleId: row.vehicleId,
    trackingDeviceId: row.trackingDeviceId,
    shiftId: row.shiftId,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    trackingSource: row.trackingSource,
    status: row.status,
    policySnapshotId: row.policySnapshotId,
    failureReason: row.failureReason || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function eventForResponse(row: typeof locationEvents.$inferSelect) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    eventType: row.eventType,
    occurredAt: row.occurredAt,
    trackingSessionId: row.trackingSessionId,
    employeeId: row.employeeId,
    vehicleId: row.vehicleId,
    locationId: row.locationId,
    geofenceId: row.geofenceId,
    source: row.source,
    confidence: row.confidenceMilli / 1_000,
    evidence: parseJsonObject(row.evidenceJson),
    correlationId: row.correlationId,
    createdAt: row.createdAt,
  };
}

export const DEFAULT_GEOFENCE_RADIUS_METERS: Record<string, number> = {
  COMMESSA: 80,
  MAGAZZINO: 120,
  CLIENTE: 60,
  FORNITORE: 80,
  DESTINATARIO: 60,
};

export function defaultGeofenceRadius(entityType: LocationEntityType | string) {
  return DEFAULT_GEOFENCE_RADIUS_METERS[entityType] ?? 80;
}

export function parseEngineState(value: string): Record<string, GeofenceEngineState> {
  const object = parseJsonObject(value);
  return Object.fromEntries(Object.entries(object).flatMap(([key, state]) => {
    if (!state || typeof state !== "object" || Array.isArray(state)) return [];
    const candidate = state as Record<string, unknown>;
    const current = candidate.state;
    const candidateSamples = Number(candidate.candidateSamples);
    if (!(["OUTSIDE", "CANDIDATE_ENTER", "INSIDE", "CANDIDATE_EXIT"] as string[]).includes(String(current))) return [];
    return [[key, {
      state: current as GeofenceEngineState["state"],
      candidateSince: typeof candidate.candidateSince === "string" ? candidate.candidateSince : undefined,
      candidateSamples: Number.isFinite(candidateSamples) ? Math.max(0, Math.floor(candidateSamples)) : 0,
      lastRecordedAt: typeof candidate.lastRecordedAt === "string" ? candidate.lastRecordedAt : undefined,
      lastDistanceM: typeof candidate.lastDistanceM === "number" ? candidate.lastDistanceM : null,
    } satisfies GeofenceEngineState]];
  }));
}

export async function auditLocationAccess({
  context,
  capability,
  action,
  resourceType,
  resourceId = "",
  purpose,
  outcome = "ALLOWED",
  metadata = {},
}: {
  context: AuthorityContext;
  capability: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  purpose: string;
  outcome?: string;
  metadata?: Record<string, unknown>;
}) {
  await getDb().insert(locationAccessAudit).values({
    id: crypto.randomUUID(),
    tenantId: context.tenantId,
    actorId: context.actorId,
    capability,
    action,
    resourceType,
    resourceId: resourceId.slice(0, 160),
    purpose: purpose.slice(0, 240),
    outcome: outcome.slice(0, 40),
    metadataJson: JSON.stringify(metadata).slice(0, 4_000),
    createdAt: new Date().toISOString(),
  });
}

export async function latestActiveSession({ tenantId, employeeId, vehicleId }: { tenantId: string; employeeId?: string; vehicleId?: string }) {
  const filters = [eq(trackingSessions.tenantId, tenantId), eq(trackingSessions.status, "ACTIVE")];
  if (employeeId) filters.push(eq(trackingSessions.employeeId, employeeId));
  if (vehicleId) filters.push(eq(trackingSessions.vehicleId, vehicleId));
  const [row] = await getDb().select().from(trackingSessions)
    .where(and(...filters))
    .orderBy(desc(trackingSessions.startedAt))
    .limit(1);
  return row ?? null;
}
