export type MissionDriverIdentity = {
  actorId: string | null;
  membershipId: string | null;
};

export type MissionCustodyIdentity = {
  assigneeActorId: string;
  assigneeMembershipId: string;
};

export function sameCustodian(custody: MissionCustodyIdentity, driver: MissionDriverIdentity) {
  return Boolean(
    (driver.actorId && custody.assigneeActorId && driver.actorId === custody.assigneeActorId)
    || (driver.membershipId && custody.assigneeMembershipId && driver.membershipId === custody.assigneeMembershipId),
  );
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
  const knownWeightKg = cargoWeightsKg.reduce((sum, weight) => sum + (weight ?? 0), 0);
  const unknownCargoCount = cargoWeightsKg.filter((weight) => weight === null).length;
  const exceeds = maxPayloadKg !== null && knownWeightKg > maxPayloadKg;
  return { knownWeightKg, unknownCargoCount, exceeds };
}
