export type MissionDriverIdentity = {
  actorId: string | null;
  membershipId: string | null;
};

export type MissionCustodyIdentity = {
  assigneeActorId: string;
  assigneeMembershipId: string;
};

export type MissionPairableResource = {
  id: string;
  kind: "driver" | "vehicle" | "cargo";
};

export type MissionAssignmentGroupLink = {
  assetId: string;
  assignmentGroupId: string | null;
};

export function sameCustodian(custody: MissionCustodyIdentity, driver: MissionDriverIdentity) {
  return Boolean(
    (driver.actorId && custody.assigneeActorId && driver.actorId === custody.assigneeActorId)
    || (driver.membershipId && custody.assigneeMembershipId && driver.membershipId === custody.assigneeMembershipId),
  );
}

/**
 * A batch assignment links resources for operational readback, but it never
 * changes their catalog identity or custody. Only cargo records from the same
 * server-side group are suggested for a vehicle; drivers and other vehicles
 * can therefore never leak into the cargo selector.
 */
export function pairedCargoIdsFromAssignmentGroups(
  resources: readonly MissionPairableResource[],
  assignments: readonly MissionAssignmentGroupLink[],
) {
  const resourceKindById = new Map(resources.map((resource) => [resource.id, resource.kind]));
  const assetIdsByGroup = new Map<string, Set<string>>();

  for (const assignment of assignments) {
    if (!assignment.assignmentGroupId || !resourceKindById.has(assignment.assetId)) continue;
    const group = assetIdsByGroup.get(assignment.assignmentGroupId) ?? new Set<string>();
    group.add(assignment.assetId);
    assetIdsByGroup.set(assignment.assignmentGroupId, group);
  }

  const cargoIdsByVehicle: Record<string, string[]> = {};
  for (const assetIds of assetIdsByGroup.values()) {
    const vehicleIds = [...assetIds].filter((assetId) => resourceKindById.get(assetId) === "vehicle");
    const cargoIds = [...assetIds].filter((assetId) => resourceKindById.get(assetId) === "cargo");
    if (!vehicleIds.length || !cargoIds.length) continue;
    for (const vehicleId of vehicleIds) {
      cargoIdsByVehicle[vehicleId] = [...new Set([...(cargoIdsByVehicle[vehicleId] ?? []), ...cargoIds])];
    }
  }

  return cargoIdsByVehicle;
}

export function missionResourceKind(module: string, entityType: string, recordType: string) {
  const explicit = entityType.trim().toUpperCase();
  const legacy = recordType.trim().toUpperCase();
  if (module === "workforce" && (explicit === "DRIVER" || legacy === "DRIVER")) return "driver" as const;
  if (module !== "assets") return null;
  if (explicit) {
    if (explicit === "VEHICLE") return "vehicle" as const;
    if (explicit === "ASSET" || explicit === "EQUIPMENT") return "cargo" as const;
    return null;
  }
  if (legacy === "VEHICLE") return "vehicle" as const;
  if (legacy === "ASSET" || legacy === "EQUIPMENT") return "cargo" as const;
  return null;
}

export function requiredVehicleCapabilities(transportMode: string, cargoCount: number) {
  const mode = transportMode.trim().toUpperCase();
  const required = new Set<string>();
  if (["WAREHOUSE_TO_JOB", "WAREHOUSE_TO_RECIPIENT", "RETURN_TO_WAREHOUSE", "WAREHOUSE_TRANSFER"].includes(mode)) {
    required.add("MATERIALS");
  }
  if (mode === "ASSET_TRANSFER" || cargoCount > 0) required.add("ASSETS");
  return [...required];
}

export function evaluateCargoCapacity(maxPayloadKg: number | null, cargoWeightsKg: Array<number | null>) {
  const knownWeightKg = cargoWeightsKg.reduce<number>((sum, weight) => sum + (weight ?? 0), 0);
  const unknownCargoCount = cargoWeightsKg.filter((weight) => weight === null).length;
  const exceeds = maxPayloadKg !== null && knownWeightKg > maxPayloadKg;
  return { knownWeightKg, unknownCargoCount, exceeds };
}
