import assert from "node:assert/strict";

const baseUrl = (process.env.ZEROW_RUNTIME_URL || "http://127.0.0.1:8787").replace(/\/$/, "");

function authHeaders(actorId, email = `${actorId}@example.invalid`) {
  return {
    "content-type": "application/json",
    "oai-authenticated-user-id": actorId,
    "oai-authenticated-user-email": email,
  };
}

async function requestJson(path, { actorId = "e2e-owner", email, method = "GET", body, expected = [200] } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: authHeaders(actorId, email),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${method} ${path} returned non-JSON (${response.status}): ${text.slice(0, 240)}`);
  }
  assert(expected.includes(response.status), `${method} ${path}: expected ${expected.join("/")}, received ${response.status} (${JSON.stringify(payload).slice(0, 300)})`);
  return { status: response.status, payload };
}

function assertTimestamp(value, label) {
  assert(typeof value === "string" && Number.isFinite(Date.parse(value)), `${label} must contain a valid timestamp`);
}

function assertVerifiedReadback(payload, label) {
  const status = String(payload?.readback?.status || "").toLowerCase();
  assert(["ok", "verified"].includes(status), `${label} must expose a verified server readback`);
}

const ownerRequests = await Promise.all([
  requestJson("/api/authority/memberships"),
  requestJson("/api/authority/warehouses"),
  requestJson("/api/authority/warehouse-assignments"),
  requestJson("/api/assets/assignments"),
  requestJson("/api/mission/resources"),
  requestJson("/api/warehouse/requests"),
  requestJson("/api/mission/control"),
  requestJson("/api/planning"),
  requestJson("/api/workforce/attendance"),
  requestJson("/api/command/map"),
]);

const [
  membershipsResponse,
  warehousesResponse,
  warehouseAssignmentsResponse,
  assetAssignmentsResponse,
  missionResourcesResponse,
  warehouseRequestsResponse,
  missionControlResponse,
  planningResponse,
  attendanceResponse,
  mapResponse,
] = ownerRequests.map((response) => response.payload);

const tenantIds = ownerRequests
  .map((response) => response.payload?.context?.tenantId)
  .filter(Boolean);
assert(tenantIds.length === ownerRequests.length, "every owner endpoint must expose its server authority context");
assert(new Set(tenantIds).size === 1, "all cross-module readbacks must resolve to one tenant root");

assertVerifiedReadback(warehousesResponse, "warehouse catalog");
assertVerifiedReadback(warehouseAssignmentsResponse, "warehouse assignments");
assertVerifiedReadback(assetAssignmentsResponse, "asset assignments");
assertVerifiedReadback(warehouseRequestsResponse, "warehouse requests");
assertVerifiedReadback(planningResponse, "planning");
assertVerifiedReadback(mapResponse, "Control map");

const roleLabels = membershipsResponse.memberships.flatMap((membership) => [
  membership.roleLabel,
  ...(Array.isArray(membership.rolesLabel) ? membership.rolesLabel : []),
]).filter(Boolean);
assert(roleLabels.includes("Titolare"), "owner must be presented as Titolare");
assert(roleLabels.includes("Responsabile magazzino"), "warehouse manager must use the canonical Italian label");
assert(roleLabels.includes("Autista di consegna"), "delivery driver must use the canonical Italian label");
assert(!roleLabels.includes("Owner"), "the English Owner label must not leak into the product UI contract");
assert(!roleLabels.includes("Responsabile magazziniere"), "the deprecated warehouse role label must not be returned");

const warehouses = warehousesResponse.warehouses || [];
const warehouse = warehouses.find((item) => item.status === "ACTIVE" || item.status === "active") || warehouses[0];
assert(warehouse, "at least one server-side warehouse is required");
assert(warehouse.locationSource === "GEOAPIFY", "warehouse coordinates must retain the Geoapify source");
assert(Number.isFinite(warehouse.coordinates?.latitude) && Number.isFinite(warehouse.coordinates?.longitude), "warehouse coordinates must be canonical server data");
assert(warehouse.geofence?.radiusMeters > 0, "warehouse must have its own geofence");
assert(warehouseAssignmentsResponse.assignments.some((assignment) => assignment.warehouseIds?.includes(warehouse.id)), "warehouse must be linked through the authority assignment registry");

const activeLongTermAssignments = (assetAssignmentsResponse.assignments || []).filter((assignment) => assignment.status === "ACTIVE" && assignment.kind === "LONG_TERM");
const assignmentsByGroup = Map.groupBy(activeLongTermAssignments, (assignment) => assignment.assignmentGroupId || assignment.id);
const multiResourceGroup = [...assignmentsByGroup.values()].find((group) => (
  group.some((assignment) => assignment.entityType === "VEHICLE")
  && group.some((assignment) => assignment.entityType === "ASSET")
));
assert(multiResourceGroup, "one long-term assignment group must support both a vehicle and an operational asset");
const vehicleAssignment = multiResourceGroup.find((assignment) => assignment.entityType === "VEHICLE");
const cargoAssignment = multiResourceGroup.find((assignment) => assignment.entityType === "ASSET");
assert(vehicleAssignment.assetId !== cargoAssignment.assetId, "vehicle and cargo asset must remain distinct registry entities");
assert(multiResourceGroup.every((assignment) => assignment.assetIds.includes(vehicleAssignment.assetId) && assignment.assetIds.includes(cargoAssignment.assetId)), "the multi-assignment group must read back all assigned resource IDs");
assert(!/^ASSET[-_ ]?\d+$/i.test(vehicleAssignment.assetTitle), "vehicle cards must show a recognizable title, not only a generic code");
assert(!/^ASSET[-_ ]?\d+$/i.test(cargoAssignment.assetTitle), "asset cards must show a recognizable title, not only a generic code");

const missionCatalog = missionResourcesResponse.catalog;
assert(missionResourcesResponse.contract?.selection === "server_validated_ids_only", "mission resources must be selected from server-validated IDs");
const vehicle = missionCatalog.vehicles.find((item) => item.id === vehicleAssignment.assetId);
const cargoAsset = missionCatalog.cargoAssets.find((item) => item.id === cargoAssignment.assetId);
assert(vehicle, "the assigned transport vehicle must be present in the vehicle catalog");
assert(cargoAsset, "the assigned operational asset must be present in the cargo catalog");
assert(!missionCatalog.cargoAssets.some((item) => item.id === vehicle.id), "a transport vehicle must never be offered as transportable cargo");
assert(!missionCatalog.vehicles.some((item) => item.id === cargoAsset.id), "an operational asset must never be offered as a transport vehicle");
assert(vehicle.kind === "vehicle" && vehicle.usageMode === "TRANSPORT" && vehicle.cargoLoadable === false, "the vehicle must retain its transport semantics");
assert(cargoAsset.kind === "cargo" && cargoAsset.usageMode === "OPERATIONAL" && cargoAsset.cargoLoadable === true, "the operational asset must retain its cargo semantics");
assert(vehicle.transportCapabilities.includes("ASSETS"), "the vehicle must declare asset transport capability");
assert(vehicle.pairedCargoAssetIds.includes(cargoAsset.id), "the paired operational asset must be suggested with its transport vehicle");
assert(vehicle.maxPayloadKg >= cargoAsset.weightKg, "the paired cargo must respect the vehicle payload capacity");

const publishedPlan = (planningResponse.plans || []).find((plan) => (
  plan.status === "PUBLISHED"
  && plan.resourceLabels?.some((label) => label.includes(vehicleAssignment.assetCode))
  && plan.resourceLabels?.some((label) => label.includes(cargoAssignment.assetCode))
));
assert(publishedPlan, "selecting the assigned person must auto-include recognizable long-term resources in planning");
assert(publishedPlan.resourceCount >= publishedPlan.resourceIds.length + 2, "auto-included assets must be counted without requiring manual selection");
assert(publishedPlan.feasible === true && publishedPlan.conflictCount === 0, "the published plan must be server-validated and conflict-free");

const approvedRequest = (warehouseRequestsResponse.requests || []).find((request) => (
  request.status === "APPROVED"
  && request.payload?.stockReservation?.status === "RESERVED"
  && request.payload?.missionId
));
assert(approvedRequest, "an approved material request must reserve real stock and link a mission");
assert(approvedRequest.payload.warehouseId === warehouse.id, "the stock reservation must remain scoped to its warehouse registry");
assert(approvedRequest.payload.lines.every((line) => line.itemId && line.sku && line.quantity > 0), "every approved line must resolve to a real inventory item");
assert(approvedRequest.payload.stockReservation.items.every((item) => item.itemId && item.quantity > 0), "reserved stock must preserve item IDs and quantities");
assert(approvedRequest.mission?.id === approvedRequest.payload.missionId, "warehouse and mission readbacks must expose the same mission ID");

const mission = (missionControlResponse.missions || []).find((item) => item.id === approvedRequest.payload.missionId);
assert(mission, "the mission register must contain the mission generated from the approved request");
assert(mission.payload.materialRequestId === approvedRequest.id, "the mission must retain the originating material request ID");
assert(mission.payload.resourceSnapshot?.vehicle?.id === vehicle.id, "the mission snapshot must reference the canonical transport vehicle");
assert(mission.payload.resourceSnapshot?.vehicle?.entityType === "VEHICLE", "the mission vehicle snapshot must not degrade into a generic asset");
assert(Array.isArray(mission.payload.route?.stops) && mission.payload.route.stops.length >= 2, "the mission must contain pickup and delivery stops");
assert(mission.payload.route.stops.some((stop) => stop.kind === "PICKUP"), "the route must contain a pickup stop");
assert(mission.payload.route.stops.some((stop) => stop.kind === "DELIVERY"), "the route must contain a delivery stop");

const timeline = mission.payload.operationalTimeline || [];
for (const eventType of ["MISSION_DISPATCHED", "LOAD_CONFIRMED", "UNLOAD_CONFIRMED", "DELIVERY_CONFIRMED"]) {
  const event = timeline.find((item) => item.type === eventType);
  assert(event, `${eventType} must be present in the immutable mission timeline`);
  assertTimestamp(event.recordedAt, `${eventType}.recordedAt`);
  assertTimestamp(event.occurredAt, `${eventType}.occurredAt`);
}
assert(mission.payload.warehouseReadback?.status === "DELIVERED", "mission closure must reconcile the warehouse ledger");
assert(mission.payload.warehouseReadback.lines.every((line) => line.required === line.picked && line.required === line.loaded && line.required === line.delivered), "picked, loaded and delivered quantities must reconcile");
assert(mission.payload.proofOfDelivery?.verifiedAt, "proof of delivery must be verified before closure");
assert(mission.payload.reconciliation?.reconciledAt, "mission must have a server reconciliation timestamp");
assert(mission.payload.missionReport?.completeness?.ready === true, "mission report must be complete before closure");
assert(mission.payload.missionReport?.review?.status === "APPROVED", "mission report must be approved before closure");
assert(mission.status === "CLOSED" && mission.payload.routeReadback?.status === "COMPLETED", "mission and route must close together");

const attendanceTargets = attendanceResponse.targets || [];
const fieldTarget = attendanceTargets.find((target) => target.kind === "FIELD" && target.jobId === approvedRequest.jobId);
const warehouseTarget = attendanceTargets.find((target) => target.kind === "WAREHOUSE" && target.warehouseId === warehouse.id);
assert(fieldTarget?.geofencePolicy === "SERVER_VALIDATED", "field attendance must use the server geofence");
assert(fieldTarget?.trackingPolicy === "TIMESTAMP_AND_GEOFENCE", "field attendance must bind timestamps and geofence evidence");
assert(warehouseTarget?.geofencePolicy === "SERVER_VALIDATED", "warehouse attendance must use the warehouse geofence");
assert(warehouseTarget?.trackingPolicy === "NO_CONTINUOUS_TRACKING", "warehouse attendance must not start delivery tracking");
assert(attendanceResponse.records.some((record) => record.jobId === approvedRequest.jobId && record.status === "CHECKED_OUT"), "field check-out must be present in the attendance ledger");
assert(attendanceResponse.records.some((record) => record.jobId === warehouse.id && record.status === "CHECKED_OUT"), "warehouse check-out must be present in its own attendance ledger");

const mapLocations = mapResponse.locations || [];
assert(mapLocations.some((location) => location.entityId === approvedRequest.jobId && location.verified), "Control must display the verified job location");
assert(mapLocations.some((location) => location.entityId === warehouse.id && location.verified), "Control must display the verified warehouse location");
assert((mapResponse.geofences || []).some((geofence) => geofence.entityId === warehouse.id && geofence.radiusMeters > 0), "Control must read the warehouse geofence");
assert(!(mapResponse.activeSessions || []).some((session) => session.missionId === mission.id), "a closed mission must not remain in live tracking");
assert(!(mapResponse.vehicles || []).some((item) => item.id === vehicle.id), "a vehicle from a closed mission must not remain marked live");
for (const place of mapResponse.temporaryPlaces || []) {
  assert(place.temporary === true || place.entityType === "TEMPORARY_PLACE", "temporary delivery places must remain explicitly classified");
  assert(Number.isFinite(place.coordinates?.latitude) && Number.isFinite(place.coordinates?.longitude), "temporary places must have canonical coordinates");
}

const companyAiPayload = {
  prompt: "Quali mezzi e asset sono assegnati a me?",
  actionType: "query",
  idempotencyKey: "e2e-domain-assets-readback-v4",
};
const firstCompanyAi = await requestJson("/api/command/ask", {
  method: "POST",
  body: companyAiPayload,
  expected: [200, 201],
});
const secondCompanyAi = await requestJson("/api/command/ask", {
  method: "POST",
  body: companyAiPayload,
  expected: [200, 201],
});
const personalAssetIds = firstCompanyAi.payload.result?.personalAssetRecordIds || [];
assert(personalAssetIds.includes(vehicleAssignment.assetCode), "Company AI must receive the assigned vehicle from the server registry");
assert(personalAssetIds.includes(cargoAssignment.assetCode), "Company AI must receive the assigned operational asset from the server registry");
assert(firstCompanyAi.payload.result.contextRecordIds.includes(vehicleAssignment.assetCode), "Company AI context must include the vehicle code");
assert(firstCompanyAi.payload.result.contextRecordIds.includes(cargoAssignment.assetCode), "Company AI context must include the asset code");
if (firstCompanyAi.payload.result.aiRuntime?.status !== "used") {
  assert(firstCompanyAi.payload.result.message.includes(vehicleAssignment.assetTitle), "Company AI fallback must name the assigned vehicle, not only its code");
  assert(firstCompanyAi.payload.result.message.includes(cargoAssignment.assetTitle), "Company AI fallback must name the assigned operational asset, not only its code");
}
assert(secondCompanyAi.payload.idempotent === true, "repeating the same Company AI query must be idempotent");
assert(secondCompanyAi.payload.result.actionId === firstCompanyAi.payload.result.actionId, "idempotent Company AI replay must return the same ledger action");

await Promise.all([
  requestJson("/api/authority/warehouse-assignments", { actorId: "e2e-worker", expected: [403] }),
  requestJson("/api/warehouse/requests", { actorId: "e2e-driver", expected: [403] }),
  requestJson("/api/workforce/attendance", { actorId: "e2e-worker" }),
  requestJson("/api/workforce/attendance", { actorId: "e2e-driver" }),
  requestJson("/api/mission/control", { actorId: "e2e-driver" }),
  requestJson("/api/communications", { actorId: "e2e-worker" }),
  requestJson("/api/communications", { actorId: "e2e-driver" }),
]);

console.log("PASS domain-flow verification");
console.log(`Tenant: ${tenantIds[0]}`);
console.log(`Warehouse: ${warehouse.code} · geofence ${warehouse.geofence.radiusMeters} m`);
console.log(`Assigned resources: ${vehicleAssignment.assetTitle} + ${cargoAssignment.assetTitle}`);
console.log(`Planning: ${publishedPlan.title} · ${publishedPlan.resourceCount} resources`);
console.log(`Materials → mission: ${approvedRequest.id} → ${mission.id}`);
console.log(`Mission timeline: ${timeline.map((event) => event.type).join(" → ")}`);
console.log(`Company AI context: ${personalAssetIds.join(", ")}`);
