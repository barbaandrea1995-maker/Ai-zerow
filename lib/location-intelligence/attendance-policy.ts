import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import {
  geofences,
  jobJourneyRecords,
  s04Records,
  trackingDevices,
  vehicleDeviceBindings,
} from "@/db/schema";
import type { AuthorityContext } from "@/lib/authority-context";
import { geofenceForEngine, parseJsonObject } from "@/lib/location-intelligence/repository";
import { distanceMeters, pointInPolygon } from "@/lib/location-intelligence/geometry";
import type { GeofenceDefinition, TrackingSource } from "@/lib/location-intelligence/types";

type JsonObject = Record<string, unknown>;
type JobRow = typeof s04Records.$inferSelect;
export type AttendanceLocation = { lat: number; lon: number; accuracyM: number | null };
export type AttendanceGeofenceStatus = "INSIDE" | "OUTSIDE" | "UNCERTAIN" | "NO_GEOFENCE" | "NO_LOCATION";

export type AttendanceGeofenceResult = {
  status: AttendanceGeofenceStatus;
  geofenceId: string | null;
  locationId: string | null;
  entityType: string | null;
  entityId: string | null;
  name: string | null;
  distanceM: number | null;
  radiusM: number | null;
  accuracyM: number | null;
};

export type OperationalAttachment = {
  label: string;
  entityType: string;
  entityId: string;
  geofence: GeofenceDefinition | null;
};

export type AttendanceOperationalContext = {
  mode: "FIELD" | "DRIVER";
  jobId: string;
  jobGeofence: GeofenceDefinition | null;
  mission: {
    id: string;
    status: string;
    driverId: string;
    vehicleId: string;
    transportMode: string;
    title: string;
  } | null;
  driverId: string | null;
  vehicleId: string | null;
  trackingDeviceId: string | null;
  trackingSource: TrackingSource | null;
  bindingId: string | null;
  trackingError: "vehicle_tracking_device_required" | "vehicle_tracking_device_not_bound" | null;
  origin: OperationalAttachment | null;
  destination: OperationalAttachment | null;
  checkInGeofence: GeofenceDefinition | null;
  checkOutGeofence: GeofenceDefinition | null;
};

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim().slice(0, 240) : fallback;
}

function upper(value: unknown) {
  return stringValue(value, "").toUpperCase();
}

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function legacyJobGeofence(job: JobRow, payload: JsonObject): GeofenceDefinition | null {
  const candidate = isRecord(payload.geofence) ? payload.geofence : payload;
  const latitude = Number(candidate.latitude ?? candidate.lat);
  const longitude = Number(candidate.longitude ?? candidate.lon ?? candidate.lng);
  const radiusMeters = Number(candidate.radiusM ?? candidate.geofenceRadiusM);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(radiusMeters)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 || radiusMeters < 20 || radiusMeters > 10_000) return null;
  return {
    id: `LEGACY-GEOFENCE-${job.id}`,
    locationId: `LEGACY-LOCATION-${job.id}`,
    entityType: "CANTIERE",
    entityId: job.id,
    name: "Geofence commessa",
    shapeType: "CIRCLE",
    center: { latitude, longitude },
    radiusMeters: Math.round(radiusMeters),
    polygon: [],
  };
}

async function geofenceForEntity(tenantId: string, entityType: string, entityId: string) {
  if (!entityId) return null;
  const [row] = await getDb().select().from(geofences).where(and(
    eq(geofences.tenantId, tenantId),
    eq(geofences.entityType, entityType),
    eq(geofences.entityId, entityId),
    eq(geofences.status, "ACTIVE"),
  )).orderBy(desc(geofences.updatedAt)).limit(1);
  return row ? geofenceForEngine(row) : null;
}

async function jobGeofence(tenantId: string, job: JobRow) {
  const rows = await getDb().select().from(geofences).where(and(
    eq(geofences.tenantId, tenantId),
    inArray(geofences.entityType, ["CANTIERE", "COMMESSA"]),
    eq(geofences.entityId, job.id),
    eq(geofences.status, "ACTIVE"),
  )).orderBy(desc(geofences.updatedAt)).limit(2);
  const canonical = rows.map(geofenceForEngine).find((item): item is GeofenceDefinition => Boolean(item));
  return canonical ?? legacyJobGeofence(job, parseJsonObject(job.payloadJson));
}

function attachmentLabel(payload: JsonObject, key: "pickup" | "dropoff", fallback: string) {
  return stringValue(payload[key], fallback);
}

async function resolveAttachment({
  tenantId,
  payload,
  key,
  fallbackEntityType,
  fallbackEntityId,
  fallbackLabel,
}: {
  tenantId: string;
  payload: JsonObject;
  key: "pickup" | "dropoff";
  fallbackEntityType?: string;
  fallbackEntityId?: string;
  fallbackLabel: string;
}): Promise<OperationalAttachment | null> {
  const prefix = key === "pickup" ? "origin" : "destination";
  const explicitEntityId = stringValue(payload[`${prefix}EntityId`] ?? payload[`${key}EntityId`] ?? payload[`${key}LocationId`]);
  const explicitEntityType = upper(payload[`${prefix}EntityType`] ?? payload[`${key}EntityType`]);
  const entityId = explicitEntityId || fallbackEntityId || "";
  const entityType = explicitEntityType || fallbackEntityType || "";
  if (!entityId || !entityType) return null;
  return {
    label: attachmentLabel(payload, key, fallbackLabel),
    entityType,
    entityId,
    geofence: await geofenceForEntity(tenantId, entityType, entityId),
  };
}

export async function resolveAttendanceOperationalContext({
  context,
  job,
}: {
  context: AuthorityContext;
  job: JobRow;
}): Promise<AttendanceOperationalContext> {
  const tenantId = context.tenantId;
  const jobFence = await jobGeofence(tenantId, job);

  const driverResources = await getDb().select().from(s04Records).where(and(
    eq(s04Records.tenantId, tenantId),
    eq(s04Records.module, "workforce"),
    eq(s04Records.recordType, "driver"),
  )).orderBy(desc(s04Records.updatedAt)).limit(500);
  const driverResource = driverResources.find((row) => parseJsonObject(row.payloadJson).actorId === context.actorId);
  const driverId = driverResource?.id ?? null;

  const missionRows = await getDb().select().from(jobJourneyRecords).where(and(
    eq(jobJourneyRecords.tenantId, tenantId),
    eq(jobJourneyRecords.jobId, job.id),
    eq(jobJourneyRecords.domain, "mission"),
    eq(jobJourneyRecords.recordType, "TRANSPORT"),
    inArray(jobJourneyRecords.status, ["PLANNED", "DISPATCHED"]),
  )).orderBy(desc(jobJourneyRecords.updatedAt)).limit(100);
  const missionMatch = missionRows.map((row) => ({ row, payload: parseJsonObject(row.payloadJson) })).find(({ payload: missionPayload }) => {
    const assignedDriverId = stringValue(missionPayload.driverId);
    const assignedActorId = stringValue(missionPayload.driverActorId);
    return Boolean(assignedDriverId && (assignedDriverId === driverId || assignedDriverId === context.actorId))
      || assignedActorId === context.actorId;
  });

  if (!missionMatch) {
    return {
      mode: "FIELD",
      jobId: job.id,
      jobGeofence: jobFence,
      mission: null,
      driverId,
      vehicleId: null,
      trackingDeviceId: null,
      trackingSource: null,
      bindingId: null,
      trackingError: null,
      origin: null,
      destination: null,
      checkInGeofence: jobFence,
      checkOutGeofence: jobFence,
    };
  }

  const missionPayload = missionMatch.payload;
  const transportMode = upper(missionPayload.transportMode) || "TRANSPORT";
  const snapshot = isRecord(missionPayload.materialRequestSnapshot) ? missionPayload.materialRequestSnapshot : {};
  const snapshotWarehouse = isRecord(snapshot.warehouse) ? snapshot.warehouse : {};
  const warehouseId = stringValue(missionPayload.warehouseId)
    || stringValue(missionPayload.originWarehouseId)
    || stringValue(snapshotWarehouse.id);
  const destinationWarehouseId = stringValue(missionPayload.destinationWarehouseId);

  const origin = await resolveAttachment({
    tenantId,
    payload: missionPayload,
    key: "pickup",
    fallbackEntityType: warehouseId ? "MAGAZZINO" : undefined,
    fallbackEntityId: warehouseId,
    fallbackLabel: stringValue(snapshotWarehouse.name, stringValue(missionPayload.pickup, "Punto di partenza")),
  });
  const destination = await resolveAttachment({
    tenantId,
    payload: missionPayload,
    key: "dropoff",
    fallbackEntityType: transportMode === "WAREHOUSE_TO_JOB" || transportMode === "ASSET_TRANSFER"
      ? "CANTIERE"
      : transportMode === "RETURN_TO_WAREHOUSE" || transportMode === "WAREHOUSE_TRANSFER"
        ? "MAGAZZINO"
        : undefined,
    fallbackEntityId: transportMode === "WAREHOUSE_TO_JOB" || transportMode === "ASSET_TRANSFER"
      ? job.id
      : destinationWarehouseId,
    fallbackLabel: stringValue(missionPayload.dropoff, "Destinazione missione"),
  });

  const vehicleId = stringValue(missionPayload.vehicleId) || null;
  let trackingDeviceId: string | null = null;
  let bindingId: string | null = null;
  let trackingSource: TrackingSource | null = null;
  let trackingError: AttendanceOperationalContext["trackingError"] = null;
  if (!vehicleId) {
    trackingError = "vehicle_tracking_device_required";
  } else {
    const [binding] = await getDb().select().from(vehicleDeviceBindings).where(and(
      eq(vehicleDeviceBindings.tenantId, tenantId),
      eq(vehicleDeviceBindings.vehicleId, vehicleId),
      eq(vehicleDeviceBindings.status, "ACTIVE"),
    )).orderBy(desc(vehicleDeviceBindings.effectiveFrom)).limit(1);
    if (!binding) {
      trackingError = "vehicle_tracking_device_not_bound";
    } else {
      const [device] = await getDb().select().from(trackingDevices).where(and(
        eq(trackingDevices.tenantId, tenantId),
        eq(trackingDevices.id, binding.deviceId),
        eq(trackingDevices.status, "ACTIVE"),
      )).limit(1);
      if (!device) {
        trackingError = "vehicle_tracking_device_not_bound";
      } else {
        bindingId = binding.id;
        trackingDeviceId = device.id;
        trackingSource = upper(device.deviceType).includes("MOBILE") ? "NATIVE_MOBILE_APP" : "VEHICLE_GPS";
      }
    }
  }

  return {
    mode: "DRIVER",
    jobId: job.id,
    jobGeofence: jobFence,
    mission: {
      id: missionMatch.row.id,
      status: missionMatch.row.status,
      driverId: stringValue(missionPayload.driverId),
      vehicleId: vehicleId ?? "",
      transportMode,
      title: missionMatch.row.title,
    },
    driverId,
    vehicleId,
    trackingDeviceId,
    trackingSource,
    bindingId,
    trackingError,
    origin,
    destination,
    checkInGeofence: origin?.geofence ?? null,
    checkOutGeofence: destination?.geofence ?? null,
  };
}

export function evaluateAttendanceGeofence(location: AttendanceLocation | null, geofence: GeofenceDefinition | null): AttendanceGeofenceResult {
  if (!location) return { status: "NO_LOCATION", geofenceId: geofence?.id ?? null, locationId: geofence?.locationId ?? null, entityType: geofence?.entityType ?? null, entityId: geofence?.entityId ?? null, name: geofence?.name ?? null, distanceM: null, radiusM: geofence?.radiusMeters ?? null, accuracyM: null };
  if (!geofence) return { status: "NO_GEOFENCE", geofenceId: null, locationId: null, entityType: null, entityId: null, name: null, distanceM: null, radiusM: null, accuracyM: location.accuracyM };

  const coordinate = { latitude: location.lat, longitude: location.lon };
  const distanceM = geofence.center ? Math.round(distanceMeters(coordinate, geofence.center)) : null;
  const accuracyM = location.accuracyM;
  const accuracyUsable = accuracyM !== null && accuracyM <= 50;
  const mathematicallyInside = geofence.shapeType === "POLYGON"
    ? pointInPolygon(coordinate, geofence.polygon ?? [])
    : Boolean(geofence.center && geofence.radiusMeters && distanceM !== null && distanceM <= geofence.radiusMeters);
  const status = !accuracyUsable
    ? "UNCERTAIN"
    : geofence.shapeType === "CIRCLE" && distanceM !== null && geofence.radiusMeters && Math.abs(distanceM - geofence.radiusMeters) <= accuracyM
      ? "UNCERTAIN"
      : mathematicallyInside ? "INSIDE" : "OUTSIDE";
  return {
    status,
    geofenceId: geofence.id,
    locationId: geofence.locationId,
    entityType: geofence.entityType,
    entityId: geofence.entityId,
    name: geofence.name,
    distanceM,
    radiusM: geofence.radiusMeters ?? null,
    accuracyM,
  };
}

export function persistedOperationalContext(value: AttendanceOperationalContext) {
  return {
    mode: value.mode,
    jobId: value.jobId,
    missionId: value.mission?.id ?? null,
    missionStatus: value.mission?.status ?? null,
    transportMode: value.mission?.transportMode ?? null,
    driverId: value.driverId,
    vehicleId: value.vehicleId,
    trackingDeviceId: value.trackingDeviceId,
    trackingSource: value.trackingSource,
    origin: value.origin ? { label: value.origin.label, entityType: value.origin.entityType, entityId: value.origin.entityId, geofenceId: value.origin.geofence?.id ?? null } : null,
    destination: value.destination ? { label: value.destination.label, entityType: value.destination.entityType, entityId: value.destination.entityId, geofenceId: value.destination.geofence?.id ?? null } : null,
  };
}
