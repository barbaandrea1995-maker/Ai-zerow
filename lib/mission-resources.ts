import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { jobJourneyRecords, s04Records } from "@/db/schema";
import { assetAssignmentCustodyEnd, assetAssignmentStatus, assetTransportCapabilities, assetUsageMode, vehicleCanTransport, type AssetUsageMode, type TransportCapability } from "@/lib/asset-contract";
import { evaluateCargoCapacity, missionResourceKind, requiredVehicleCapabilities, sameCustodian } from "@/lib/mission-resource-rules";

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
  simulationEligible: boolean;
  conflict: { recordId: string; title: string; startsAt: string; endsAt: string } | null;
  custody: { assignmentId: string; assignmentKind: string; assigneeName: string; assigneeActorId: string; assigneeMembershipId: string; startsAt: string; endsAt: string | null } | null;
  qualifications: string[];
  usageMode: AssetUsageMode | null;
  transportCapabilities: TransportCapability[];
  deliveryEligible: boolean;
  eligibilityReason: string | null;
  cargoLoadable: boolean;
  weightKg: number | null;
  maxPayloadKg: number | null;
  pairedCargoAssetIds: string[];
  updatedAt: string;
};

type JsonObject = Record<string, unknown>;

const RESOURCE_READ_PAGE_SIZE = 500;

async function readAllById<T extends { id: string }>(fetchPage: (afterId?: string) => Promise<T[]>) {
  const rows: T[] = [];
  let afterId: string | undefined;
  while (true) {
    const page = await fetchPage(afterId);
    rows.push(...page);
    if (page.length < RESOURCE_READ_PAGE_SIZE) return rows;
    const lastId = page[page.length - 1]?.id;
    if (!lastId || lastId === afterId) throw new Error("mission_resource_page_cursor_stalled");
    afterId = lastId;
  }
}

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
      | "vehicle_transport_capability_missing"
      | "vehicle_capacity_exceeded"
      | "cargo_asset_not_transportable"
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
  return missionResourceKind(row.module, upper(payload.entityType || payload.resourceKind || payload.kind), row.recordType);
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

function finiteNonNegative(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
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
  const pairedCargoAssetIds = kind === "vehicle" ? [...new Set(stringList(payload.pairedCargoAssetIds).filter((id) => id !== row.id))].slice(0, 50) : [];
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
    simulationEligible: lifecycleAvailable(status),
    conflict: null,
    custody: null,
    qualifications: qualifications(payload),
    usageMode,
    transportCapabilities,
    deliveryEligible,
    eligibilityReason: kind === "vehicle" && !deliveryEligible ? "vehicle_transport_profile_required" : null,
    cargoLoadable: kind === "cargo" && payload.transportable !== false,
    weightKg: kind === "cargo" ? finiteNonNegative(payload.weightKg) : null,
    maxPayloadKg: kind === "vehicle" ? finiteNonNegative(payload.maxPayloadKg) : null,
    pairedCargoAssetIds,
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
  if (Array.isArray(payload.cargoAssetIds)) {
    ids.push(...payload.cargoAssetIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => value.trim()));
  }
  if (Array.isArray(payload.resourceIds)) {
    ids.push(...payload.resourceIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => value.trim()));
  }
  const cargoIds = new Set([
    ...(typeof payload.cargoAssetId === "string" ? [payload.cargoAssetId] : []),
    ...(Array.isArray(payload.cargoAssetIds) ? payload.cargoAssetIds.filter((value): value is string => typeof value === "string") : []),
  ]);
  const deliveredCargoIds = new Set<string>();
  if (isRecord(payload.cargoCustody)) {
    for (const [assetId, custody] of Object.entries(payload.cargoCustody)) {
      if (isRecord(custody) && upper(custody.state) === "DELIVERED") deliveredCargoIds.add(assetId);
    }
  }
  return [...new Set(ids)].filter((id) => !cargoIds.has(id) || !deliveredCargoIds.has(id));
}

async function activeAssignments(tenantId: string, excludeRecordId?: string) {
  const rows = await readAllById((afterId) => getDb().select().from(jobJourneyRecords).where(afterId
    ? and(
      eq(jobJourneyRecords.tenantId, tenantId),
      inArray(jobJourneyRecords.domain, ["mission", "planning"]),
      gt(jobJourneyRecords.id, afterId),
    )
    : and(
      eq(jobJourneyRecords.tenantId, tenantId),
      inArray(jobJourneyRecords.domain, ["mission", "planning"]),
    )).orderBy(asc(jobJourneyRecords.id)).limit(RESOURCE_READ_PAGE_SIZE));

  return rows
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
    .flatMap((row) => {
      const status = row.status.toUpperCase();
      if (row.id === excludeRecordId) return [];
      if (row.domain === "planning" && status !== "PUBLISHED") return [];
      if (["DELIVERED", "POD_VERIFIED", "RECONCILED", "CLOSED", "CANCELLED", "REJECTED"].includes(status)) return [];
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
  const rows = await readAllById((afterId) => getDb().select().from(jobJourneyRecords).where(afterId
    ? and(
      eq(jobJourneyRecords.tenantId, tenantId),
      eq(jobJourneyRecords.domain, "assets"),
      eq(jobJourneyRecords.recordType, "ASSET_ASSIGNMENT"),
      inArray(jobJourneyRecords.status, ["ACTIVE", "SCHEDULED"]),
      gt(jobJourneyRecords.id, afterId),
    )
    : and(
      eq(jobJourneyRecords.tenantId, tenantId),
      eq(jobJourneyRecords.domain, "assets"),
      eq(jobJourneyRecords.recordType, "ASSET_ASSIGNMENT"),
      inArray(jobJourneyRecords.status, ["ACTIVE", "SCHEDULED"]),
    )).orderBy(asc(jobJourneyRecords.id)).limit(RESOURCE_READ_PAGE_SIZE));
  return rows
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
    .flatMap((row) => {
      const payload = parseJson(row.payloadJson);
      const assetId = stringValue(payload.assetId, row.jobId);
      const startsAt = stringValue(payload.startsAt);
      const plannedEndsAt = stringValue(payload.endsAt) || null;
      if (!assetId || !validDate(startsAt)) return [];
      const assignmentKind = stringValue(payload.assignmentKind).toUpperCase() || (plannedEndsAt ? "SHORT_TERM" : "LONG_TERM");
      const status = assetAssignmentStatus(row.status, startsAt);
      const endsAt = assetAssignmentCustodyEnd(status, assignmentKind, startsAt, plannedEndsAt);
      return [{
        assignmentId: row.id,
        assetId,
        assignmentKind,
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
  driverId?: string;
  simulationOnly?: boolean;
}) {
  const rows = await readAllById((afterId) => getDb().select().from(s04Records).where(afterId
    ? and(
      eq(s04Records.tenantId, args.tenantId),
      inArray(s04Records.module, ["assets", "workforce"]),
      gt(s04Records.id, afterId),
    )
    : and(
      eq(s04Records.tenantId, args.tenantId),
      inArray(s04Records.module, ["assets", "workforce"]),
    )).orderBy(asc(s04Records.id)).limit(RESOURCE_READ_PAGE_SIZE));
  const resources = rows
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
    .flatMap((row) => {
    const kind = resourceKind(row, parseJson(row.payloadJson));
    return kind ? [resourceFromRow(row, kind)] : [];
  });
  const window = args.plannedAt ? normalizedMissionWindow(args.plannedAt, args.plannedEndAt) : null;
  const [assignments, custodyRows] = window
    ? await Promise.all([activeAssignments(args.tenantId, args.excludeRecordId), activeAssetCustody(args.tenantId)])
    : [[], []];
  const selectedDriver = resources.find((resource) => resource.id === args.driverId && resource.kind === "driver") ?? null;
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
    const custodyMismatch = resource.kind === "vehicle" && custody && (!selectedDriver || !sameCustodian(custody, selectedDriver))
      ? { recordId: custody.assignmentId, title: `Affidata a ${custody.assigneeName}`, startsAt: custody.startsAt, endsAt: custody.endsAt ?? window?.endsAt ?? custody.startsAt }
      : null;
    const missingModeCapabilities = resource.kind === "vehicle"
      ? requiredVehicleCapabilities(args.transportMode ?? "", 0).filter((capability) => !resource.transportCapabilities.includes(capability as TransportCapability))
      : [];
    const capabilityBlocked = resource.kind === "vehicle"
      ? !resource.deliveryEligible || missingModeCapabilities.length > 0
      : resource.kind === "driver" && requiresDeliveryDriver(args.transportMode)
        ? !resource.deliveryEligible
        : false;
    const eligibilityReason = capabilityBlocked
      ? resource.kind === "driver" ? "delivery_driver_capability_required" : !resource.deliveryEligible ? "vehicle_transport_profile_required" : "vehicle_transport_capability_missing"
      : resource.eligibilityReason;
    const simulationEligible = resource.available && !capabilityBlocked && !conflict;
    return {
      ...resource,
      available: simulationEligible && !custodyMismatch,
      simulationEligible,
      conflict: conflict
        ? { recordId: conflict.recordId, title: conflict.title, startsAt: conflict.startsAt, endsAt: conflict.endsAt }
        : custodyMismatch,
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
      availableCargoAssets: cargoAssets.filter((resource) => resource.available && resource.cargoLoadable).length,
    },
  };
}

export async function assertMissionResourceSelection(args: {
  tenantId: string;
  driverId: string;
  vehicleId: string;
  cargoAssetId?: string;
  cargoAssetIds?: string[];
  transportMode?: string;
  plannedAt: string;
  plannedEndAt?: string;
  excludeRecordId?: string;
  simulationOnly?: boolean;
}) {
  const catalog = await getMissionResourceCatalog(args);
  const driver = catalog.drivers.find((resource) => resource.id === args.driverId);
  const vehicle = catalog.vehicles.find((resource) => resource.id === args.vehicleId);
  const selectedCargoAssetIds = [...new Set([
    ...(Array.isArray(args.cargoAssetIds) ? args.cargoAssetIds.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()) : []),
    ...(args.cargoAssetId ? [args.cargoAssetId] : []),
  ])];
  const cargoAssets = selectedCargoAssetIds.map((id) => catalog.cargoAssets.find((resource) => resource.id === id) ?? null);
  const cargoAsset = cargoAssets[0] ?? null;

  if (!driver) throw new MissionResourceError("driver_not_found");
  if (!vehicle) throw new MissionResourceError("vehicle_not_found");
  if (cargoAssets.some((resource) => !resource)) throw new MissionResourceError("cargo_asset_not_found", { resourceIds: selectedCargoAssetIds });
  if (requiresDeliveryDriver(args.transportMode) && !driver.deliveryEligible) {
    throw new MissionResourceError("delivery_driver_capability_required", { resourceId: driver.id });
  }
  if (!vehicle.deliveryEligible) {
    throw new MissionResourceError("vehicle_transport_profile_required", { resourceId: vehicle.id, usageMode: vehicle.usageMode });
  }
  if (!driver.available) throw new MissionResourceError(driver.conflict ? "mission_resource_conflict" : "driver_unavailable", { resourceId: driver.id, conflict: driver.conflict });
  if (vehicle.custody && !sameCustodian(vehicle.custody, driver)) {
    if (args.simulationOnly) {
      // A dry-run may preview a hypothetical assignment, but it never persists
      // or reserves the resource. Real mission creation remains custody-bound.
    } else {
    throw new MissionResourceError("vehicle_assigned_to_other_driver", {
      resourceId: vehicle.id,
      assignedTo: vehicle.custody.assigneeName,
      assignmentId: vehicle.custody.assignmentId,
    });
    }
  }
  const vehicleReady = args.simulationOnly ? vehicle.simulationEligible : vehicle.available;
  if (!vehicleReady) throw new MissionResourceError(vehicle.conflict ? "mission_resource_conflict" : "vehicle_unavailable", { resourceId: vehicle.id, conflict: vehicle.conflict });
  const requiredCapabilities = requiredVehicleCapabilities(args.transportMode ?? "", selectedCargoAssetIds.length);
  const missingCapabilities = requiredCapabilities.filter((capability) => !vehicle.transportCapabilities.includes(capability as TransportCapability));
  if (missingCapabilities.length) throw new MissionResourceError("vehicle_transport_capability_missing", { resourceId: vehicle.id, missingCapabilities });
  for (const selectedCargoAsset of cargoAssets) {
    if (selectedCargoAsset && !selectedCargoAsset.cargoLoadable) {
      throw new MissionResourceError("cargo_asset_not_transportable", { resourceId: selectedCargoAsset.id });
    }
  }
  for (const selectedCargoAsset of cargoAssets) {
    if (!selectedCargoAsset) continue;
    const cargoReady = args.simulationOnly ? selectedCargoAsset.simulationEligible : selectedCargoAsset.available;
    if (!cargoReady) throw new MissionResourceError(selectedCargoAsset.conflict ? "mission_resource_conflict" : "cargo_asset_unavailable", { resourceId: selectedCargoAsset.id, conflict: selectedCargoAsset.conflict });
  }

  const resolvedCargoAssets = cargoAssets.flatMap((resource) => resource ? [resource] : []);
  const cargoOperationalAssignees = resolvedCargoAssets.flatMap((resource) => resource.custody ? [{
    assetId: resource.id,
    assignmentId: resource.custody.assignmentId,
    actorId: resource.custody.assigneeActorId,
    membershipId: resource.custody.assigneeMembershipId,
    name: resource.custody.assigneeName,
    assignmentKind: resource.custody.assignmentKind,
  }] : []);
  const capacity = evaluateCargoCapacity(vehicle.maxPayloadKg, resolvedCargoAssets.map((resource) => resource.weightKg));
  if (capacity.exceeds) {
    throw new MissionResourceError("vehicle_capacity_exceeded", {
      resourceId: vehicle.id,
      maxPayloadKg: vehicle.maxPayloadKg,
      knownCargoWeightKg: capacity.knownWeightKg,
      unknownCargoCount: capacity.unknownCargoCount,
    });
  }
  const custodyWarnings = [vehicle]
    .filter((resource) => resource.custody && !sameCustodian(resource.custody, driver))
    .map((resource) => ({ resourceId: resource.id, resourceName: resource.label, assignedTo: resource.custody!.assigneeName }));
  return { driver, vehicle, cargoAsset, cargoAssets: resolvedCargoAssets, cargoOperationalAssignees, window: catalog.window!, capacity, custodyWarnings };
}
