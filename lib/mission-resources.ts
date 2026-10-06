import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { jobJourneyRecords, s04Records } from "@/db/schema";
import { assetTransportCapabilities, assetUsageMode, vehicleCanTransport, type AssetUsageMode, type TransportCapability } from "@/lib/asset-contract";

export type MissionResourceKind = "driver" | "vehicle" | "cargo";
export type MissionAvailability = "READY" | "DATE_REQUIRED" | "NO_RESOURCES";

export type MissionResource = {
  id: string;
  code: string | null;
  label: string;
  model: string | null;
  registration: string | null;
  serialNumber: string | null;
  kind: MissionResourceKind;
  actorId: string | null;
  membershipId: string | null;
  status: string;
  available: boolean;
  conflict: { recordId: string; title: string; startsAt: string; endsAt: string } | null;
  custody: { assignmentId: string; assigneeName: string; assigneeActorId: string; assigneeMembershipId: string; startsAt: string; endsAt: string | null } | null;
  qualifications: string[];
  usageMode: AssetUsageMode | null;
  transportCapabilities: TransportCapability[];
  deliveryEligible: boolean;
  eligibilityReason: string | null;
  updatedAt: string;
};

type JsonObject = Record<string, unknown>;

export class MissionResourceError extends Error {
  constructor(
    public readonly code:
      | "driver_not_found"
      | "vehicle_not_found"
      | "cargo_asset_not_found"
      | "driver_unavailable"
      | "vehicle_unavailable"
      | "cargo_asset_unavailable"
      | "mission_resource_conflict"
      | "vehicle_assigned_to_other_driver"
      | "delivery_driver_capability_required"
      | "vehicle_transport_profile_required"
      | "mission_window_invalid",
    public readonly details?: Record<string, unknown>,
  ) {
    super(code);
    this.name = "MissionResourceError";
  }
}

function parseJson(value: string): JsonObject {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as JsonObject
      : {};
  } catch {
    return {};
  }
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function upper(value: unknown) {
  return stringValue(value).toUpperCase();
}

function resourceKind(row: typeof s04Records.$inferSelect, payload: JsonObject): MissionResourceKind | null {
  const explicit = upper(payload.entityType || payload.resourceKind || payload.kind);
  const recordType = upper(row.recordType);

  if (row.module === "workforce" && (explicit === "DRIVER" || recordType === "DRIVER")) return "driver";
  if (row.module === "assets" && (explicit === "VEHICLE" || recordType === "VEHICLE")) return "vehicle";
  if (row.module === "assets" && (explicit === "ASSET" || explicit === "EQUIPMENT" || recordType === "ASSET" || recordType === "EQUIPMENT")) return "cargo";
  return null;
}

function lifecycleStatus(row: typeof s04Records.$inferSelect, payload: JsonObject) {
  return upper(payload.lifecycleStatus || payload.availabilityStatus || row.status || "UNKNOWN");
}

function lifecycleAvailable(status: string) {
  return ["AVAILABLE", "ACTIVE", "OPERATIVO", "ONLINE", "IN PRESIDIO"].includes(status);
}

function qualifications(payload: JsonObject) {
  return Array.isArray(payload.qualifications)
    ? payload.qualifications.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, 20)
    : [];
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    : [];
}

function deliveryDriverEligible(payload: JsonObject) {
  const roles = stringList(payload.authorityRoles || payload.roles).map((role) => role.toLowerCase());
  const capabilities = stringList(payload.capabilities);
  return payload.deliveryDriver === true
    || roles.includes("delivery_driver")
    || capabilities.includes("mission.delivery.execute");
}

function requiresDeliveryDriver(transportMode?: string) {
  return ["ASSET_TRANSFER", "WAREHOUSE_TO_RECIPIENT", "WAREHOUSE_TO_JOB", "RETURN_TO_WAREHOUSE", "WAREHOUSE_TRANSFER"].includes(upper(transportMode));
}

function resourceFromRow(row: typeof s04Records.$inferSelect, kind: MissionResourceKind): MissionResource {
  const payload = parseJson(row.payloadJson);
  const status = lifecycleStatus(row, payload);
  const label = stringValue(payload.title || payload.description || payload.name || row.detail || row.title) || row.title;
  const usageMode = kind === "vehicle" || kind === "cargo" ? assetUsageMode(payload) : null;
  const transportCapabilities = kind === "vehicle" || kind === "cargo" ? assetTransportCapabilities(payload) : [];
  const deliveryEligible = kind === "driver" ? deliveryDriverEligible(payload) : kind === "vehicle" ? vehicleCanTransport(payload) : true;
  return {
    id: row.id,
    code: row.canonicalCode,
    label,
    model: stringValue(payload.model) || null,
    registration: stringValue(payload.registration) || null,
    serialNumber: stringValue(payload.serialNumber || payload.serial) || null,
    kind,
    actorId: stringValue(payload.actorId) || null,
    membershipId: stringValue(payload.authorityMembershipId || payload.membershipId) || null,
    status,
    available: lifecycleAvailable(status),
    conflict: null,
    custody: null,
    qualifications: qualifications(payload),
    usageMode,
    transportCapabilities,
    deliveryEligible,
    eligibilityReason: kind === "vehicle" && !deliveryEligible ? "vehicle_transport_profile_required" : null,
    updatedAt: row.updatedAt,
  };
}

function validDate(value: string) {
  return value.length >= 10 && Number.isFinite(Date.parse(value));
}

export function normalizedMissionWindow(plannedAt: string, plannedEndAt?: string) {
  if (!validDate(plannedAt)) throw new MissionResourceError("mission_window_invalid");
  const start = Date.parse(plannedAt);
  const end = plannedEndAt && validDate(plannedEndAt)
    ? Date.parse(plannedEndAt)
    : start + 2 * 60 * 60 * 1000;
  if (end <= start) throw new MissionResourceError("mission_window_invalid");
  return {
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(end).toISOString(),
  };
}

function overlaps(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number) {
  return leftStart < rightEnd && rightStart < leftEnd;
}

function referencesForRecord(payload: JsonObject) {
  const ids = [payload.driverId, payload.vehicleId, payload.cargoAssetId]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());
  if (Array.isArray(payload.resourceIds)) {
    ids.push(...payload.resourceIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => value.trim()));
  }
  return [...new Set(ids)];
}

async function activeAssignments(tenantId: string, excludeRecordId?: string) {
  const rows = await getDb().select().from(jobJourneyRecords).where(and(
    eq(jobJourneyRecords.tenantId, tenantId),
    inArray(jobJourneyRecords.domain, ["mission", "planning"]),
  )).orderBy(desc(jobJourneyRecords.updatedAt)).limit(1000);

  return rows.flatMap((row) => {
    if (row.id === excludeRecordId) return [];
    if (["DELIVERED", "POD_VERIFIED", "RECONCILED", "CLOSED", "CANCELLED", "REJECTED"].includes(row.status.toUpperCase())) return [];
    const payload = parseJson(row.payloadJson);
    const startValue = stringValue(payload.plannedAt || payload.startsAt);
    if (!validDate(startValue)) return [];
    let window: { startsAt: string; endsAt: string };
    try {
      window = normalizedMissionWindow(startValue, stringValue(payload.plannedEndAt || payload.endsAt) || undefined);
    } catch {
      return [];
    }
    const references = referencesForRecord(payload);
    if (!references.length) return [];
    return [{
      recordId: row.id,
      title: row.title,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      references,
    }];
  });
}

async function activeAssetCustody(tenantId: string) {
  const rows = await getDb().select().from(jobJourneyRecords).where(and(
    eq(jobJourneyRecords.tenantId, tenantId),
    eq(jobJourneyRecords.domain, "assets"),
    eq(jobJourneyRecords.recordType, "ASSET_ASSIGNMENT"),
    inArray(jobJourneyRecords.status, ["ACTIVE", "SCHEDULED"]),
  )).orderBy(desc(jobJourneyRecords.updatedAt)).limit(1000);
  return rows.flatMap((row) => {
    const payload = parseJson(row.payloadJson);
    const assetId = stringValue(payload.assetId, row.jobId);
    const startsAt = stringValue(payload.startsAt);
    const endsAt = stringValue(payload.endsAt) || null;
    if (!assetId || !validDate(startsAt)) return [];
    return [{
      assignmentId: row.id,
      assetId,
      assigneeName: stringValue(payload.assigneeName, "Persona assegnata"),
      assigneeActorId: stringValue(payload.assigneeActorId),
      assigneeMembershipId: stringValue(payload.assigneeMembershipId),
      startsAt: new Date(Date.parse(startsAt)).toISOString(),
      endsAt: endsAt && validDate(endsAt) ? new Date(Date.parse(endsAt)).toISOString() : null,
    }];
  });
}

export async function getMissionResourceCatalog(args: {
  tenantId: string;
  plannedAt?: string;
  plannedEndAt?: string;
  excludeRecordId?: string;
  transportMode?: string;
}) {
  const rows = await getDb().select().from(s04Records).where(eq(s04Records.tenantId, args.tenantId)).orderBy(desc(s04Records.updatedAt)).limit(1000);
  const resources = rows.flatMap((row) => {
    const kind = resourceKind(row, parseJson(row.payloadJson));
    return kind ? [resourceFromRow(row, kind)] : [];
  });
  const window = args.plannedAt ? normalizedMissionWindow(args.plannedAt, args.plannedEndAt) : null;
  const [assignments, custodyRows] = window
    ? await Promise.all([activeAssignments(args.tenantId, args.excludeRecordId), activeAssetCustody(args.tenantId)])
    : [[], []];
  const withAvailability = resources.map((resource) => {
    const conflict = window
      ? assignments.find((assignment) => assignment.references.includes(resource.id) && overlaps(
        Date.parse(window.startsAt),
        Date.parse(window.endsAt),
        Date.parse(assignment.startsAt),
        Date.parse(assignment.endsAt),
      ))
        : undefined;
    const custody = window && resource.kind !== "driver"
      ? custodyRows.find((assignment) => assignment.assetId === resource.id && overlaps(
        Date.parse(window.startsAt),
        Date.parse(window.endsAt),
        Date.parse(assignment.startsAt),
        assignment.endsAt ? Date.parse(assignment.endsAt) : Number.POSITIVE_INFINITY,
      ))
      : undefined;
    const cargoCustodyConflict = resource.kind === "cargo" && custody
      ? { recordId: custody.assignmentId, title: `Assegnata a ${custody.assigneeName}`, startsAt: custody.startsAt, endsAt: custody.endsAt ?? window?.endsAt ?? custody.startsAt }
      : null;
    const capabilityBlocked = resource.kind === "vehicle"
      ? !resource.deliveryEligible
      : resource.kind === "driver" && requiresDeliveryDriver(args.transportMode)
        ? !resource.deliveryEligible
        : false;
    const eligibilityReason = capabilityBlocked
      ? resource.kind === "driver" ? "delivery_driver_capability_required" : "vehicle_transport_profile_required"
      : resource.eligibilityReason;
    return {
      ...resource,
      available: resource.available && !capabilityBlocked && !conflict && !cargoCustodyConflict,
      conflict: conflict
        ? { recordId: conflict.recordId, title: conflict.title, startsAt: conflict.startsAt, endsAt: conflict.endsAt }
        : cargoCustodyConflict,
      eligibilityReason,
      custody: custody ?? null,
    } satisfies MissionResource;
  });

  const drivers = withAvailability.filter((resource) => resource.kind === "driver");
  const vehicles = withAvailability.filter((resource) => resource.kind === "vehicle");
  const cargoAssets = withAvailability.filter((resource) => resource.kind === "cargo");
  const hasAvailableRequired = drivers.some((resource) => resource.available) && vehicles.some((resource) => resource.available);
  const availability: MissionAvailability = !window
    ? "DATE_REQUIRED"
    : hasAvailableRequired
      ? "READY"
      : "NO_RESOURCES";

  return {
    availability,
    window,
    drivers,
    vehicles,
    cargoAssets,
    totals: {
      drivers: drivers.length,
      vehicles: vehicles.length,
      cargoAssets: cargoAssets.length,
      availableDrivers: drivers.filter((resource) => resource.available).length,
      availableVehicles: vehicles.filter((resource) => resource.available).length,
      availableCargoAssets: cargoAssets.filter((resource) => resource.available).length,
    },
  };
}

export async function assertMissionResourceSelection(args: {
  tenantId: string;
  driverId: string;
  vehicleId: string;
  cargoAssetId?: string;
  transportMode?: string;
  plannedAt: string;
  plannedEndAt?: string;
  excludeRecordId?: string;
}) {
  const catalog = await getMissionResourceCatalog(args);
  const driver = catalog.drivers.find((resource) => resource.id === args.driverId);
  const vehicle = catalog.vehicles.find((resource) => resource.id === args.vehicleId);
  const cargoAsset = args.cargoAssetId ? catalog.cargoAssets.find((resource) => resource.id === args.cargoAssetId) : null;

  if (!driver) throw new MissionResourceError("driver_not_found");
  if (!vehicle) throw new MissionResourceError("vehicle_not_found");
  if (args.cargoAssetId && !cargoAsset) throw new MissionResourceError("cargo_asset_not_found");
  if (requiresDeliveryDriver(args.transportMode) && !driver.deliveryEligible) {
    throw new MissionResourceError("delivery_driver_capability_required", { resourceId: driver.id });
  }
  if (!vehicle.deliveryEligible) {
    throw new MissionResourceError("vehicle_transport_profile_required", { resourceId: vehicle.id, usageMode: vehicle.usageMode });
  }
  if (!driver.available) throw new MissionResourceError(driver.conflict ? "mission_resource_conflict" : "driver_unavailable", { resourceId: driver.id, conflict: driver.conflict });
  if (vehicle.custody && vehicle.custody.assigneeActorId !== driver.actorId && vehicle.custody.assigneeMembershipId !== driver.membershipId) {
    throw new MissionResourceError("vehicle_assigned_to_other_driver", {
      resourceId: vehicle.id,
      assignedTo: vehicle.custody.assigneeName,
      assignmentId: vehicle.custody.assignmentId,
    });
  }
  if (!vehicle.available) throw new MissionResourceError(vehicle.conflict ? "mission_resource_conflict" : "vehicle_unavailable", { resourceId: vehicle.id, conflict: vehicle.conflict });
  if (cargoAsset && !cargoAsset.available) throw new MissionResourceError(cargoAsset.conflict ? "mission_resource_conflict" : "cargo_asset_unavailable", { resourceId: cargoAsset.id, conflict: cargoAsset.conflict });

  return { driver, vehicle, cargoAsset, window: catalog.window! };
}
