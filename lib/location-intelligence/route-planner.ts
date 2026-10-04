import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { geoLocations, geofences, routePlans, routeStops } from "@/db/schema";
import { geofenceForEngine, parseJsonObject } from "@/lib/location-intelligence/repository";

export type MissionStopKind = "PICKUP" | "DELIVERY" | "TRANSFER" | "RETURN";

export type MissionStopInput = {
  kind?: unknown;
  label?: unknown;
  locationId?: unknown;
  entityType?: unknown;
  entityId?: unknown;
  expectedArrivalAt?: unknown;
  expectedDepartureAt?: unknown;
  cargoActions?: unknown;
  deliveryEvidenceRequired?: unknown;
};

export type MissionRouteProjection = {
  plan: typeof routePlans.$inferInsert;
  stops: Array<typeof routeStops.$inferInsert>;
  summary: Array<{
    id: string;
    sequence: number;
    kind: MissionStopKind;
    label: string;
    locationId: string;
    entityType: string;
    entityId: string;
    geofenceId: string;
    cargoActions: Array<Record<string, unknown>>;
    deliveryEvidenceRequired: boolean;
  }>;
};

export class MissionRouteError extends Error {
  constructor(public readonly code: string, public readonly details: Record<string, unknown> = {}) {
    super(code);
  }
}

function text(value: unknown, max = 240) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stopKind(value: unknown, index: number, total: number): MissionStopKind {
  const normalized = text(value, 24).toUpperCase();
  if (["PICKUP", "DELIVERY", "TRANSFER", "RETURN"].includes(normalized)) return normalized as MissionStopKind;
  return index === 0 ? "PICKUP" : index === total - 1 ? "DELIVERY" : "TRANSFER";
}

function actions(value: unknown) {
  if (!Array.isArray(value)) return [] as Array<Record<string, unknown>>;
  return value.slice(0, 12).flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const action = text(entry.action ?? entry.type, 24).toUpperCase();
    if (!["LOAD", "UNLOAD", "TRANSFER", "RETURN"].includes(action)) return [];
    return [{
      action,
      assetId: text(entry.assetId, 120) || null,
      itemId: text(entry.itemId, 120) || null,
      materialRequestId: text(entry.materialRequestId, 120) || null,
      quantity: typeof entry.quantity === "number" || typeof entry.quantity === "string" ? String(entry.quantity).slice(0, 32) : null,
    }];
  });
}

function defaultActions(kind: MissionStopKind, cargoAssetId: string, materialRequestId: string) {
  const action = kind === "PICKUP" ? "LOAD" : kind === "DELIVERY" ? "UNLOAD" : kind === "RETURN" ? "RETURN" : "TRANSFER";
  return [{
    action,
    assetId: cargoAssetId || null,
    itemId: null,
    materialRequestId: materialRequestId || null,
    quantity: null,
  }];
}

function routeStopMetadata(summary: MissionRouteProjection["summary"][number]) {
  return JSON.stringify({
    routeStopVersion: 1,
    kind: summary.kind,
    label: summary.label,
    entityType: summary.entityType,
    entityId: summary.entityId,
    geofenceId: summary.geofenceId,
    cargoActions: summary.cargoActions,
    deliveryEvidenceRequired: summary.deliveryEvidenceRequired,
    attachment: "PENDING",
    gpsIsOperationalEvidenceOnly: true,
  });
}

async function findLocation(tenantId: string, input: MissionStopInput) {
  const db = getDb();
  const locationId = text(input.locationId, 160);
  const entityType = text(input.entityType, 48).toUpperCase();
  const entityId = text(input.entityId, 160);
  if (locationId) {
    const [row] = await db.select().from(geoLocations).where(and(
      eq(geoLocations.tenantId, tenantId),
      eq(geoLocations.id, locationId),
      eq(geoLocations.status, "ACTIVE"),
    )).limit(1);
    return row ?? null;
  }
  if (!entityType || !entityId) return null;
  const [row] = await db.select().from(geoLocations).where(and(
    eq(geoLocations.tenantId, tenantId),
    eq(geoLocations.entityType, entityType),
    eq(geoLocations.entityId, entityId),
    eq(geoLocations.status, "ACTIVE"),
  )).limit(1);
  return row ?? null;
}

async function findGeofence(tenantId: string, locationId: string) {
  const [row] = await getDb().select().from(geofences).where(and(
    eq(geofences.tenantId, tenantId),
    eq(geofences.locationId, locationId),
    eq(geofences.status, "ACTIVE"),
  )).orderBy(desc(geofences.updatedAt)).limit(1);
  return row ? geofenceForEngine(row) : null;
}

export async function buildMissionRouteProjection({
  tenantId,
  missionId,
  jobId,
  driverId,
  vehicleId,
  plannedStartAt,
  createdBy,
  stops,
  fallbackStops,
  cargoAssetId,
  materialRequestId,
}: {
  tenantId: string;
  missionId: string;
  jobId: string | null;
  driverId: string;
  vehicleId: string;
  plannedStartAt: string;
  createdBy: string;
  stops: unknown;
  fallbackStops: MissionStopInput[];
  cargoAssetId?: string | null;
  materialRequestId?: string | null;
}): Promise<MissionRouteProjection | null> {
  const rawStops = Array.isArray(stops) && stops.length ? stops : fallbackStops;
  if (!rawStops.length) return null;
  if (rawStops.length < 2) throw new MissionRouteError("mission_route_min_stops", { minStops: 2 });
  if (rawStops.length > 12) throw new MissionRouteError("mission_route_stop_limit", { maxStops: 12 });

  const normalizedCargoAssetId = text(cargoAssetId, 160);
  const normalizedMaterialRequestId = text(materialRequestId, 160);

  const summary: MissionRouteProjection["summary"] = [];
  for (let index = 0; index < rawStops.length; index += 1) {
    const input = isRecord(rawStops[index]) ? rawStops[index] as MissionStopInput : {};
    const location = await findLocation(tenantId, input);
    if (!location) {
      throw new MissionRouteError("mission_route_location_required", { sequence: index + 1 });
    }
    const geofence = await findGeofence(tenantId, location.id);
    if (!geofence) {
      throw new MissionRouteError("mission_route_geofence_required", { sequence: index + 1, locationId: location.id });
    }
    const kind = stopKind(input.kind, index, rawStops.length);
    const label = text(input.label, 240) || location.formattedAddress || `${location.entityType} ${location.entityId}`;
    const normalizedActions = actions(input.cargoActions);
    summary.push({
      id: `ROUTE-STOP-${missionId}-${String(index + 1).padStart(2, "0")}`,
      sequence: index + 1,
      kind,
      label,
      locationId: location.id,
      entityType: location.entityType,
      entityId: location.entityId,
      geofenceId: geofence.id,
      cargoActions: normalizedActions.length ? normalizedActions : defaultActions(kind, normalizedCargoAssetId, normalizedMaterialRequestId),
      deliveryEvidenceRequired: input.deliveryEvidenceRequired !== false && kind === "DELIVERY",
    });
  }

  const now = new Date().toISOString();
  const planId = `ROUTE-PLAN-${missionId}`;
  return {
    plan: {
      id: planId,
      tenantId,
      missionId,
      jobId,
      driverId,
      vehicleId,
      status: "PLANNED",
      plannedStartAt,
      startedAt: null,
      endedAt: null,
      createdBy,
      createdAt: now,
      updatedAt: now,
    },
    stops: summary.map((item) => ({
      id: item.id,
      tenantId,
      routePlanId: planId,
      sequence: item.sequence,
      locationId: item.locationId,
      expectedArrivalAt: null,
      expectedDepartureAt: null,
      status: "PLANNED",
      deliveryStatus: "PLANNED",
      arrivedAt: null,
      departedAt: null,
      evidenceJson: routeStopMetadata(item),
      createdAt: now,
      updatedAt: now,
    })),
    summary,
  };
}

export function routeSummaryForPayload(projection: MissionRouteProjection | null) {
  if (!projection) return { status: "NOT_CONFIGURED", routePlanId: null, stops: [] };
  return {
    status: "PLANNED",
    routePlanId: projection.plan.id,
    stops: projection.summary.map((stop) => ({
      id: stop.id,
      sequence: stop.sequence,
      kind: stop.kind,
      label: stop.label,
      locationId: stop.locationId,
      entityType: stop.entityType,
      entityId: stop.entityId,
      geofenceId: stop.geofenceId,
      cargoActions: stop.cargoActions,
      deliveryEvidenceRequired: stop.deliveryEvidenceRequired,
      status: "PLANNED",
      deliveryStatus: "PLANNED",
    })),
  };
}

export function routeStopMetadataForResponse(value: string) {
  return parseJsonObject(value);
}
