import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { jobJourneyRecords, s04Records } from "@/db/schema";

export type MissionResourceKind = "driver" | "vehicle" | "cargo";
export type MissionAvailability = "READY" | "DATE_REQUIRED" | "NO_RESOURCES";

export type MissionResource = {
  id: string;
  code: string | null;
  label: string;
  kind: MissionResourceKind;
  status: string;
  available: boolean;
  conflict: { recordId: string; title: string; startsAt: string; endsAt: string } | null;
  qualifications: string[];
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

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
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

function resourceFromRow(row: typeof s04Records.$inferSelect, kind: MissionResourceKind): MissionResource {
  const payload = parseJson(row.payloadJson);
  const status = lifecycleStatus(row, payload);
  return {
    id: row.id,
    code: row.canonicalCode,
    label: row.title,
    kind,
    status,
    available: lifecycleAvailable(status),
    conflict: null,
    qualifications: qualifications(payload),
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

export async function getMissionResourceCatalog(args: {
  tenantId: string;
  plannedAt?: string;
  plannedEndAt?: string;
  excludeRecordId?: string;
}) {
  const rows = await getDb().select().from(s04Records).where(eq(s04Records.tenantId, args.tenantId)).orderBy(desc(s04Records.updatedAt)).limit(1000);
  const resources = rows.flatMap((row) => {
    const kind = resourceKind(row, parseJson(row.payloadJson));
    return kind ? [resourceFromRow(row, kind)] : [];
  });
  const window = args.plannedAt ? normalizedMissionWindow(args.plannedAt, args.plannedEndAt) : null;
  const assignments = window ? await activeAssignments(args.tenantId, args.excludeRecordId) : [];
  const withAvailability = resources.map((resource) => {
    const conflict = window
      ? assignments.find((assignment) => assignment.references.includes(resource.id) && overlaps(
        Date.parse(window.startsAt),
        Date.parse(window.endsAt),
        Date.parse(assignment.startsAt),
        Date.parse(assignment.endsAt),
      ))
      : undefined;
    return {
      ...resource,
      available: resource.available && !conflict,
      conflict: conflict
        ? { recordId: conflict.recordId, title: conflict.title, startsAt: conflict.startsAt, endsAt: conflict.endsAt }
        : null,
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
  if (!driver.available) throw new MissionResourceError(driver.conflict ? "mission_resource_conflict" : "driver_unavailable", { resourceId: driver.id, conflict: driver.conflict });
  if (!vehicle.available) throw new MissionResourceError(vehicle.conflict ? "mission_resource_conflict" : "vehicle_unavailable", { resourceId: vehicle.id, conflict: vehicle.conflict });
  if (cargoAsset && !cargoAsset.available) throw new MissionResourceError(cargoAsset.conflict ? "mission_resource_conflict" : "cargo_asset_unavailable", { resourceId: cargoAsset.id, conflict: cargoAsset.conflict });

  return { driver, vehicle, cargoAsset, window: catalog.window! };
}
