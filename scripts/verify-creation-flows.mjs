import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";

const baseUrl = (process.env.ZEROW_RUNTIME_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const OWNER = "e2e-owner";
const RUN_ID = randomUUID().slice(0, 8);

function authHeaders(actorId = OWNER) {
  return {
    "content-type": "application/json",
    "oai-authenticated-user-id": actorId,
    "oai-authenticated-user-email": `${actorId}@example.invalid`,
  };
}

async function requestJson(path, { actorId = OWNER, method = "GET", body, expected = [200] } = {}) {
  const requestBody = body === undefined ? undefined : JSON.stringify(body);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: authHeaders(actorId),
      body: requestBody,
    });
    const raw = await response.text();
    if (response.status === 503 && /worker restarted mid-request/i.test(raw) && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 150));
      continue;
    }
    let payload;
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      throw new Error(`${method} ${path} returned non-JSON (${response.status}): ${raw.slice(0, 240)}`);
    }
    assert(expected.includes(response.status), `${method} ${path}: expected ${expected.join("/")}, received ${response.status} (${JSON.stringify(payload).slice(0, 500)})`);
    return { status: response.status, payload };
  }
  throw new Error(`${method} ${path} exhausted transient worker-restart retries`);
}

function recordName(record) {
  return String(record?.payload?.title || record?.payload?.description || record?.detail || record?.title || "");
}

const warehouseRead = await requestJson("/api/authority/warehouses");
assert.equal(warehouseRead.payload.readback?.status, "verified", "warehouse catalog must expose verified readback");
const warehouse = (warehouseRead.payload.warehouses || []).find((entry) => entry.status?.toLowerCase() === "active");
assert(warehouse, "an active server-side warehouse is required for creation tests");
assert.equal(warehouse.locationSource, "GEOAPIFY", "warehouse location must retain the canonical provider");
assert(Number.isFinite(warehouse.coordinates?.latitude) && Number.isFinite(warehouse.coordinates?.longitude), "warehouse must expose server coordinates");
assert(warehouse.geofence?.radiusMeters >= 25, "warehouse must expose a valid geofence");

const missingWarehouseLocation = await requestJson("/api/authority/warehouses", {
  method: "POST",
  body: { name: "Deposito verifica" },
  expected: [400],
});
assert.equal(missingWarehouseLocation.payload.error, "warehouse_location_required");

const invalidWarehouseRadius = await requestJson("/api/authority/warehouses", {
  method: "POST",
  body: {
    name: "Deposito verifica",
    locationQuery: "Piazza del Colosseo, Roma",
    locationProvider: "GEOAPIFY",
    providerPlaceId: "verification-only",
    geofenceRadiusMeters: 10,
  },
  expected: [400],
});
assert.equal(invalidWarehouseRadius.payload.error, "geofence_radius_must_be_25_to_5000_meters");

const warehouseRoleDenied = await requestJson("/api/authority/warehouses", {
  actorId: "e2e-worker",
  method: "POST",
  body: { name: "Deposito non autorizzato" },
  expected: [401, 403],
});
assert(["unauthenticated", "forbidden"].includes(warehouseRoleDenied.payload.error), "unknown or unauthorized actors must fail closed on warehouse registration");

const assetRoleDenied = await requestJson("/api/assets", {
  actorId: "e2e-worker",
  method: "POST",
  body: { title: "Risorsa non autorizzata", entityType: "asset" },
  expected: [401, 403],
});
assert(["unauthenticated", "forbidden"].includes(assetRoleDenied.payload.error), "unknown or unauthorized actors must fail closed on asset registration");

const invalidCargoProfile = await requestJson("/api/assets", {
  method: "POST",
  body: {
    title: "Escavatore classificato male",
    entityType: "equipment",
    usageMode: "TRANSPORT",
    transportCapabilities: ["ASSETS"],
  },
  expected: [400],
});
assert.equal(invalidCargoProfile.payload.error, "non_vehicle_transport_usage_invalid");

const missingVehicleCapability = await requestJson("/api/assets", {
  method: "POST",
  body: {
    title: "Mezzo senza abilitazioni",
    entityType: "vehicle",
    usageMode: "TRANSPORT",
    transportCapabilities: [],
  },
  expected: [400],
});
assert.equal(missingVehicleCapability.payload.error, "transport_capability_required");

const unknownWarehouse = await requestJson("/api/assets", {
  method: "POST",
  body: {
    title: "Asset con deposito inesistente",
    entityType: "asset",
    usageMode: "OPERATIONAL",
    transportCapabilities: [],
    warehouseId: "warehouse-does-not-exist",
  },
  expected: [400],
});
assert.equal(unknownWarehouse.payload.error, "asset_warehouse_not_found");

const vehicleBody = {
  title: `Furgone verifica creazione ${RUN_ID}`,
  detail: `Furgone verifica creazione ${RUN_ID}`,
  meta: "Mezzo di trasporto verificato",
  status: "AVAILABLE",
  recordType: "asset-register",
  entityType: "vehicle",
  usageMode: "TRANSPORT",
  operationalProfile: "TRANSPORT",
  transportCapabilities: ["MATERIALS", "ASSETS"],
  brand: "Iveco",
  model: "Daily Test",
  registration: `VFY-${RUN_ID.toUpperCase()}`,
  warehouseId: warehouse.id,
  capacity: 1,
  maxPayloadKg: 3500,
  transportable: false,
  lifecycleStatus: "AVAILABLE",
  availabilityGuard: "ASSIGNABLE",
  idempotencyKey: `verify-create-vehicle-${RUN_ID}`,
};
const cargoBody = {
  title: `Mini escavatore verifica creazione ${RUN_ID}`,
  detail: `Mini escavatore verifica creazione ${RUN_ID}`,
  meta: "Asset operativo verificato",
  status: "AVAILABLE",
  recordType: "asset-register",
  entityType: "equipment",
  usageMode: "OPERATIONAL",
  operationalProfile: "OPERATIONAL",
  transportCapabilities: [],
  brand: "Wacker Neuson",
  model: "E17 Test",
  serialNumber: `VERIFY-E17-${RUN_ID.toUpperCase()}`,
  warehouseId: warehouse.id,
  capacity: 1,
  weightKg: 1800,
  transportable: true,
  lifecycleStatus: "AVAILABLE",
  availabilityGuard: "ASSIGNABLE",
  idempotencyKey: `verify-create-cargo-${RUN_ID}`,
};

const vehicleCreate = await requestJson("/api/assets", { method: "POST", body: vehicleBody, expected: [200, 201] });
const cargoCreate = await requestJson("/api/assets", { method: "POST", body: cargoBody, expected: [200, 201] });
const vehicle = vehicleCreate.payload.created;
const cargo = cargoCreate.payload.created;
assert(vehicle?.id && cargo?.id, "asset creation must return both canonical records");
assert.match(vehicle.canonicalCode || "", /^MEZZI-/i, "vehicle must receive a recognizable vehicle code");
assert.match(cargo.canonicalCode || "", /^(ASSET|ATT|ATTREZZATURE)-/i, "cargo must receive a recognizable asset/equipment code");
assert.equal(vehicle.payload?.entityType, "vehicle");
assert.equal(vehicle.payload?.transportable, false, "a vehicle must never be transportable cargo");
assert.equal(cargo.payload?.entityType, "equipment");
assert.equal(cargo.payload?.usageMode, "OPERATIONAL");
assert.equal(cargo.payload?.transportable, true);
assert.equal(vehicle.payload?.physicalCustody?.warehouseId, warehouse.id, "vehicle custody must be written during creation");
assert.equal(cargo.payload?.physicalCustody?.warehouseId, warehouse.id, "cargo custody must be written during creation");
assert.equal(vehicle.payload?.physicalCustody?.source, "ASSET_REGISTRATION");

const vehicleReplay = await requestJson("/api/assets", { method: "POST", body: vehicleBody, expected: [200] });
assert.equal(vehicleReplay.payload.idempotent, true, "asset create replay must return the same record");
assert.equal(vehicleReplay.payload.created?.id, vehicle.id, "asset create replay must not duplicate the vehicle");

let assetsRead = await requestJson("/api/assets");
let currentVehicle = assetsRead.payload.records.find((record) => record.id === vehicle.id);
let currentCargo = assetsRead.payload.records.find((record) => record.id === cargo.id);
assert(currentVehicle && currentCargo, "created assets must be visible in the tenant catalog");
assert.equal(recordName(currentVehicle), vehicleBody.title, "catalog must show a recognizable vehicle name");
assert.equal(recordName(currentCargo), cargoBody.title, "catalog must show a recognizable cargo name");

const cargoProfileBody = {
  assetId: currentCargo.id,
  expectedUpdatedAt: currentCargo.updatedAt,
  idempotencyKey: `verify-create-cargo-profile-${RUN_ID}`,
  title: cargoBody.title,
  entityType: "equipment",
  usageMode: "OPERATIONAL",
  transportCapabilities: [],
  brand: cargoBody.brand,
  model: cargoBody.model,
  registration: "",
  serialNumber: cargoBody.serialNumber,
  warehouseId: warehouse.id,
  capacity: 1,
  maxPayloadKg: "",
  weightKg: 1800,
  transportable: true,
  pairedCargoAssetIds: [],
  notes: "Verifica form profilo asset",
};
const cargoProfile = await requestJson("/api/assets/profile", { method: "POST", body: cargoProfileBody, expected: [200] });
assert.equal(cargoProfile.payload.readback, "verified");

assetsRead = await requestJson("/api/assets");
currentVehicle = assetsRead.payload.records.find((record) => record.id === vehicle.id);
currentCargo = assetsRead.payload.records.find((record) => record.id === cargo.id);

const vehicleProfileBody = {
  assetId: currentVehicle.id,
  expectedUpdatedAt: currentVehicle.updatedAt,
  idempotencyKey: `verify-create-vehicle-profile-${RUN_ID}`,
  title: vehicleBody.title,
  entityType: "vehicle",
  usageMode: "TRANSPORT",
  transportCapabilities: ["MATERIALS", "ASSETS"],
  brand: vehicleBody.brand,
  model: vehicleBody.model,
  registration: vehicleBody.registration,
  serialNumber: "",
  warehouseId: warehouse.id,
  capacity: 1,
  maxPayloadKg: 3500,
  weightKg: "",
  transportable: false,
  pairedCargoAssetIds: [currentCargo.id],
  notes: "Verifica form profilo mezzo",
};
const vehicleProfile = await requestJson("/api/assets/profile", { method: "POST", body: vehicleProfileBody, expected: [200] });
assert.equal(vehicleProfile.payload.readback, "verified");

const profileMisclassification = await requestJson("/api/assets/profile", {
  method: "POST",
  body: { ...cargoProfileBody, idempotencyKey: `verify-invalid-cargo-profile-${RUN_ID}`, usageMode: "DUAL_USE", transportCapabilities: ["ASSETS"] },
  expected: [400],
});
assert.equal(profileMisclassification.payload.error, "non_vehicle_transport_usage_invalid");

const staleProfile = await requestJson("/api/assets/profile", {
  method: "POST",
  body: { ...vehicleProfileBody, expectedUpdatedAt: "2000-01-01T00:00:00.000Z", idempotencyKey: `verify-stale-vehicle-profile-${RUN_ID}` },
  expected: [409],
});
assert.equal(staleProfile.payload.error, "version_conflict");

const missionControlBefore = await requestJson("/api/mission/control");
const origin = (missionControlBefore.payload.locations || []).find((location) => location.entityType === "MAGAZZINO");
const destination = (missionControlBefore.payload.locations || []).find((location) => location.id !== origin?.id && location.geofence);
assert(origin?.id && destination?.id, "mission creation needs two canonical geofenced places");

const slotStart = Date.UTC(2040, 0, 1) + randomInt(0, 100_000) * 3 * 60 * 60 * 1_000;
const plannedAt = new Date(slotStart).toISOString();
const plannedEndAt = new Date(slotStart + 2 * 60 * 60 * 1_000).toISOString();
const resources = await requestJson(`/api/mission/resources?plannedAt=${encodeURIComponent(plannedAt)}&plannedEndAt=${encodeURIComponent(plannedEndAt)}&transportMode=ASSET_TRANSFER`);
const missionVehicle = resources.payload.catalog?.vehicles?.find((entry) => entry.id === vehicle.id);
const missionCargo = resources.payload.catalog?.cargoAssets?.find((entry) => entry.id === cargo.id);
const driver = resources.payload.catalog?.drivers?.find((entry) => entry.actorId === OWNER) || resources.payload.catalog?.drivers?.find((entry) => entry.deliveryEligible);
assert(missionVehicle, "created vehicle must be offered only in the vehicle catalog");
assert(missionCargo, "created equipment must be offered only in the cargo catalog");
assert(driver, "a delivery driver must be available in the Authority registry");
assert(!resources.payload.catalog.cargoAssets.some((entry) => entry.id === vehicle.id), "vehicle must never leak into cargo choices");
assert(!resources.payload.catalog.vehicles.some((entry) => entry.id === cargo.id), "cargo must never leak into vehicle choices");
assert(missionVehicle.pairedCargoAssetIds.includes(cargo.id), "paired cargo must be proposed with its vehicle");
assert.equal(missionVehicle.maxPayloadKg, 3500);
assert.equal(missionCargo.weightKg, 1800);

const missionTitle = `Verifica creazione missione server-side ${RUN_ID}`;
const missionBody = {
  action: "mission_create",
  idempotencyKey: `verify-create-mission-${RUN_ID}`,
  title: missionTitle,
  pickup: origin.formattedAddress,
  dropoff: destination.formattedAddress,
  plannedAt,
  plannedEndAt,
  driverId: driver.id,
  vehicleId: vehicle.id,
  cargoAssetId: cargo.id,
  cargoAssetIds: [cargo.id],
  transportMode: "ASSET_TRANSFER",
  routeStops: [
    { kind: "PICKUP", locationId: origin.id, label: origin.formattedAddress, cargoActions: [{ action: "LOAD", assetId: cargo.id }] },
    { kind: "DELIVERY", locationId: destination.id, label: destination.formattedAddress, cargoActions: [{ action: "UNLOAD", assetId: cargo.id }] },
  ],
  notes: "Verifica integrata creazione missione",
};

const simulation = await requestJson("/api/mission/resources/simulate", {
  method: "POST",
  body: { driverId: driver.id, vehicleId: vehicle.id, cargoAssetIds: [cargo.id], transportMode: "ASSET_TRANSFER", plannedAt, plannedEndAt },
});
assert.equal(simulation.payload.simulationOnly, true);
assert.equal(simulation.payload.writesPerformed, false);
assert.equal(simulation.payload.validation?.result, "PASSED");

const missionCreate = await requestJson("/api/mission/control", { method: "POST", body: missionBody, expected: [200, 201] });
assert.equal(missionCreate.payload.readback?.status, "verified", "mission create must expose verified readback");
assert.equal(missionCreate.payload.mutation?.action, "mission_create");
assert(missionCreate.payload.mutation?.record?.id, "mission create must expose the record through the UI contract");
assert.equal(missionCreate.payload.record?.id, missionCreate.payload.mutation.record.id, "legacy and UI record identifiers must agree");
assert.equal(missionCreate.payload.missionId, missionCreate.payload.mutation.record.id);

const missionReplay = await requestJson("/api/mission/control", { method: "POST", body: missionBody, expected: [200] });
assert.equal(missionReplay.payload.idempotent, true, "mission replay must resolve before self-conflict checks");
assert.equal(missionReplay.payload.missionId, missionCreate.payload.missionId, "mission replay must not duplicate the mission");

const overlap = await requestJson("/api/mission/control", {
  method: "POST",
  body: { ...missionBody, idempotencyKey: `verify-create-mission-overlap-${RUN_ID}`, title: `${missionTitle} · conflitto` },
  expected: [409],
});
assert.equal(overlap.payload.error, "mission_resource_conflict");

const missionRoleDenied = await requestJson("/api/mission/control", {
  actorId: "e2e-driver",
  method: "POST",
  body: missionBody,
  expected: [401, 403],
});
assert(["unauthenticated", "forbidden"].includes(missionRoleDenied.payload.error), "unknown or execution-only actors must fail closed on mission scheduling");

const missionControlAfter = await requestJson("/api/mission/control");
const mission = (missionControlAfter.payload.missions || []).find((entry) => entry.id === missionCreate.payload.missionId);
assert(mission, "created mission must be visible in the mission register");
assert.equal(mission.payload?.resourceSnapshot?.vehicle?.entityType, "VEHICLE");
assert.equal(mission.payload?.resourceSnapshot?.vehicle?.id, vehicle.id);
assert.equal(mission.payload?.resourceSnapshot?.cargoAsset?.id, cargo.id);
assert.equal(mission.payload?.route?.stops?.length, 2, "mission must persist pickup and delivery stops");
assert(mission.payload.route.stops.some((stop) => stop.kind === "PICKUP"));
assert(mission.payload.route.stops.some((stop) => stop.kind === "DELIVERY"));

console.log("PASS creation-flow verification");
console.log(`Warehouse: ${warehouse.code} · ${warehouse.name} · geofence ${warehouse.geofence.radiusMeters} m`);
console.log(`Vehicle: ${vehicle.canonicalCode} · ${recordName(currentVehicle)} · transport only`);
console.log(`Cargo: ${cargo.canonicalCode} · ${recordName(currentCargo)} · operational/transportable`);
console.log(`Mission: ${missionCreate.payload.missionId} · readback verified · idempotent replay verified`);
