import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const baseUrl = (process.env.ZEROW_RUNTIME_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const OWNER = process.env.ZEROW_PICKUP_ACTOR || "e2e-owner";
const UNASSIGNED_OPERATOR = process.env.ZEROW_UNASSIGNED_PICKUP_ACTOR || "e2e-worker";
const JOB_ID = process.env.ZEROW_PICKUP_JOB_ID || "E2E-JOB-1";
const RUN_ID = randomUUID().replaceAll("-", "").slice(0, 16);
const REQUEST_LINE_ID = `line-${RUN_ID}`;
const DIRECT_QUANTITY = 1;
const MISSION_QUANTITY = 1;
const APPROVED_QUANTITY = DIRECT_QUANTITY + MISSION_QUANTITY;

function authHeaders(actorId) {
  return {
    "content-type": "application/json",
    "oai-authenticated-user-id": actorId,
    "oai-authenticated-user-email": `${actorId}@example.invalid`,
  };
}

async function requestJson(path, { actorId = OWNER, method = "GET", body, expected = [200] } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: authHeaders(actorId),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${method} ${path} returned non-JSON (${response.status}): ${text.slice(0, 240)}`);
  }
  assert(expected.includes(response.status), `${method} ${path}: expected ${expected.join("/")}, received ${response.status} (${JSON.stringify(payload).slice(0, 500)})`);
  return { status: response.status, payload };
}

const [operationsRead, warehousesRead] = await Promise.all([
  requestJson("/api/operations"),
  requestJson("/api/authority/warehouses"),
]);
const job = operationsRead.payload.records?.find((record) => record.id === JOB_ID || record.canonicalCode === JOB_ID);
assert(job, `assigned E2E commessa ${JOB_ID} must exist`);
const assignedActorIds = job.payload?.assignedActorIds ?? [];
assert(assignedActorIds.includes(OWNER), `${OWNER} must be server-assigned to the E2E commessa`);

const warehouse = (warehousesRead.payload.warehouses || []).find((entry) => entry.status?.toLowerCase() === "active");
assert(warehouse?.id && warehouse.coordinates, "an active geofenced server-side warehouse is required");
const inventoryBefore = await requestJson(`/api/warehouse/inventory?warehouseId=${encodeURIComponent(warehouse.id)}`);
const item = (inventoryBefore.payload.items || []).find((candidate) => candidate.status === "ACTIVE" && candidate.available >= APPROVED_QUANTITY);
assert(item, "the assigned warehouse must have an active catalog item with enough unreserved stock");
const beforeOnHand = item.onHand;
const beforeReserved = item.reserved;

const requestWrite = await requestJson(`/api/operations/jobs/${encodeURIComponent(job.id)}/journey`, {
  method: "POST",
  expected: [201],
  body: {
    action: "material_request",
    title: `Verifica ritiro diretto e missione ${RUN_ID}`,
    lines: [{ id: REQUEST_LINE_ID, itemId: item.id, quantity: APPROVED_QUANTITY }],
    idempotencyKey: `verify-pickup-request-${RUN_ID}`,
  },
});
assert.equal(requestWrite.payload.mutation?.action, "material_request");
const requestId = requestWrite.payload.mutation?.record?.id;
assert(requestId, "material request must be assigned a server record ID");

const reviewWrite = await requestJson(`/api/operations/jobs/${encodeURIComponent(job.id)}/journey`, {
  method: "POST",
  expected: [200],
  body: {
    action: "material_review",
    recordId: requestId,
    expectedVersion: requestWrite.payload.mutation.record.version,
    decision: "APPROVED",
    warehouseId: warehouse.id,
    lines: [{
      id: REQUEST_LINE_ID,
      itemId: item.id,
      description: item.name,
      sku: item.sku,
      unit: item.unit,
      quantity: APPROVED_QUANTITY,
      directPickupQuantity: DIRECT_QUANTITY,
    }],
    idempotencyKey: `verify-pickup-review-${RUN_ID}`,
  },
});
assert.equal(reviewWrite.payload.readback?.status, "verified", "approval and stock reservation must be verified server-side");
const approvedRequest = reviewWrite.payload.mutation?.record;
assert.equal(approvedRequest?.status, "APPROVED");
const fulfillment = approvedRequest?.payload?.fulfillmentPlan?.lines?.find((line) => line.lineId === REQUEST_LINE_ID);
assert.equal(fulfillment?.directPickupMilli, DIRECT_QUANTITY * 1_000, "the approved direct-pickup allocation must be recorded");
assert.equal(fulfillment?.missionDeliveryMilli, MISSION_QUANTITY * 1_000, "the remaining allocation must stay eligible for mission delivery");
assert.equal(fulfillment.directPickupMilli + fulfillment.missionDeliveryMilli, fulfillment.approvedQuantityMilli, "both fulfillment paths must reconcile to the approved quantity");

const pickupBody = {
  requestId,
  lineId: REQUEST_LINE_ID,
  itemId: item.id,
  quantity: DIRECT_QUANTITY,
  location: {
    lat: warehouse.coordinates.latitude,
    lon: warehouse.coordinates.longitude,
    accuracyM: 5,
  },
  idempotencyKey: `verify-pickup-record-${RUN_ID}`,
};
const unassignedAttempt = await requestJson(`/api/operations/jobs/${encodeURIComponent(job.id)}/material-pickup`, {
  actorId: UNASSIGNED_OPERATOR,
  method: "POST",
  expected: [403],
  body: { ...pickupBody, idempotencyKey: `verify-pickup-denied-${RUN_ID}` },
});
assert.equal(unassignedAttempt.payload.error, "commessa_assignment_required_for_material_pickup", "having the operator capability alone must not bypass the job assignment");

const pickupWrite = await requestJson(`/api/operations/jobs/${encodeURIComponent(job.id)}/material-pickup`, {
  method: "POST",
  expected: [201],
  body: pickupBody,
});
assert.equal(pickupWrite.payload.readback?.status, "verified", "pickup must reconcile through the server ledger");
assert.equal(pickupWrite.payload.geofence?.status, "INSIDE", "direct pickup must be checked against the canonical warehouse geofence");
assert.equal(pickupWrite.payload.remainingDirectQuantity, 0, "the direct allocation must be completely accounted for");

const pickupReplay = await requestJson(`/api/operations/jobs/${encodeURIComponent(job.id)}/material-pickup`, {
  method: "POST",
  expected: [200],
  body: pickupBody,
});
assert.equal(pickupReplay.payload.idempotent, true, "replaying a pickup must not create another movement");
const conflictingReplay = await requestJson(`/api/operations/jobs/${encodeURIComponent(job.id)}/material-pickup`, {
  method: "POST",
  expected: [409],
  body: { ...pickupBody, quantity: DIRECT_QUANTITY / 2 },
});
assert.equal(conflictingReplay.payload.error, "material_pickup_idempotency_payload_conflict", "an idempotency key cannot be replayed with changed quantity");

const [inventoryAfter, warehouseRequests, missionControl] = await Promise.all([
  requestJson(`/api/warehouse/inventory?warehouseId=${encodeURIComponent(warehouse.id)}`),
  requestJson("/api/warehouse/requests"),
  requestJson("/api/mission/control"),
]);
const itemAfter = inventoryAfter.payload.items?.find((candidate) => candidate.id === item.id);
assert.equal(itemAfter?.onHand, beforeOnHand - DIRECT_QUANTITY, "physical stock must decrease exactly once at direct pickup");
assert.equal(itemAfter?.reserved, beforeReserved + MISSION_QUANTITY, "only the still-pending mission quantity must remain reserved");
const movement = inventoryAfter.payload.movements?.find((candidate) => candidate.id === pickupWrite.payload.movementId);
assert.equal(movement?.movementType, "PICK", "direct pickup must use the warehouse PICK ledger movement");
assert.equal(movement?.missionId, null, "a direct pickup must not be disguised as a mission movement");
assert.equal(movement?.jobId, job.id, "the direct movement must remain linked to its commessa");

const requestReadback = warehouseRequests.payload.requests?.find((record) => record.id === requestId);
assert.equal(requestReadback?.status, "APPROVED");
assert.equal(requestReadback?.mission, null, "the unprogrammed mission share must not create a phantom mission");
assert(requestReadback?.directPickups?.some((record) => record.lineId === REQUEST_LINE_ID && record.quantity === DIRECT_QUANTITY), "the warehouse request readback must expose the operator pickup");
assert(requestReadback?.directPickupTotals?.some((record) => record.lineId === REQUEST_LINE_ID && record.quantity === DIRECT_QUANTITY), "the aggregate pickup ledger must reconcile the line quantity");
assert.equal(requestReadback?.payload?.fulfillmentPlan?.lines?.find((line) => line.lineId === REQUEST_LINE_ID)?.missionDeliveryMilli, MISSION_QUANTITY * 1_000, "the remaining quantity must still be visible for mission scheduling");
assert(!(missionControl.payload.missions || []).some((mission) => mission.payload?.materialRequestId === requestId), "direct pickup must not silently create or link a mission");

console.log("PASS material-pickup end-to-end verification");
console.log(`Commessa: ${job.canonicalCode || job.id} · deposito: ${warehouse.code}`);
console.log(`Richiesta: ${requestId} · ${DIRECT_QUANTITY} ${item.unit} ritirati direttamente · ${MISSION_QUANTITY} ${item.unit} ancora riservati per missione`);
console.log(`Registro: movimento ${movement.id} · geofence ${pickupWrite.payload.geofence.status} · replay idempotente · operatore non assegnato respinto`);
