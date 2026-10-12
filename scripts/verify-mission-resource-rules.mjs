import assert from "node:assert/strict";
import { evaluateCargoCapacity, missionResourceKind, requiredVehicleCapabilities, sameCustodian } from "../lib/mission-resource-rules.ts";

assert.equal(missionResourceKind("assets", "VEHICLE", "ASSET"), "vehicle", "explicit vehicle profile must classify the van as a carrier");
assert.equal(missionResourceKind("assets", "ASSET", "VEHICLE"), "cargo", "explicit cargo profile must win over a stale legacy record type");
assert.equal(missionResourceKind("assets", "EQUIPMENT", "ASSET"), "cargo");
assert.equal(missionResourceKind("assets", "VEHICLE", "VEHICLE"), "vehicle");
assert.equal(missionResourceKind("workforce", "DRIVER", "PERSON"), "driver");
assert.equal(missionResourceKind("assets", "WAREHOUSE", "WAREHOUSE"), null);

assert.equal(sameCustodian({ assigneeActorId: "actor-1", assigneeMembershipId: "member-1" }, { actorId: "actor-1", membershipId: "member-2" }), true);
assert.equal(sameCustodian({ assigneeActorId: "", assigneeMembershipId: "member-1" }, { actorId: null, membershipId: "member-2" }), false);
assert.deepEqual(requiredVehicleCapabilities("WAREHOUSE_TO_JOB", 0), ["MATERIALS"]);
assert.deepEqual(requiredVehicleCapabilities("ASSET_TRANSFER", 1), ["ASSETS"]);
assert.deepEqual(requiredVehicleCapabilities("CUSTOM", 1), ["ASSETS"]);

assert.deepEqual(evaluateCargoCapacity(1_500, [800, 400, null]), { knownWeightKg: 1_200, unknownCargoCount: 1, exceeds: false });
assert.deepEqual(evaluateCargoCapacity(1_000, [800, 400]), { knownWeightKg: 1_200, unknownCargoCount: 0, exceeds: true });
assert.deepEqual(evaluateCargoCapacity(null, [800, null]), { knownWeightKg: 800, unknownCargoCount: 1, exceeds: false });

console.log("Mission resource classification, custody, capability and capacity rules: PASS");
