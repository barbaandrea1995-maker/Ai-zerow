import assert from "node:assert/strict";
import { materialFulfillmentLines, missionDeliveryLines } from "../lib/material-fulfillment.ts";

const mixed = {
  lines: [{ id: "line-a", itemId: "item-1", description: "Cemento", sku: "CEM-1", unit: "KG", quantity: 10 }],
  fulfillmentPlan: {
    version: 1,
    allocationMethod: "LINE_QUANTITY",
    lines: [{ lineId: "line-a", itemId: "item-1", approvedQuantityMilli: 10_000, directPickupMilli: 2_500, missionDeliveryMilli: 7_500 }],
  },
};
const mixedLines = materialFulfillmentLines(mixed);
assert.equal(mixedLines?.[0]?.directPickupMilli, 2_500);
assert.equal(mixedLines?.[0]?.missionDeliveryMilli, 7_500);
assert.equal(mixedLines?.[0]?.directPickupMilli + mixedLines?.[0]?.missionDeliveryMilli, mixedLines?.[0]?.approvedQuantityMilli);
assert.deepEqual(missionDeliveryLines(mixed)?.map((line) => line.quantity), [7.5]);

const directOnly = structuredClone(mixed);
directOnly.fulfillmentPlan.lines[0].directPickupMilli = 10_000;
directOnly.fulfillmentPlan.lines[0].missionDeliveryMilli = 0;
assert.deepEqual(missionDeliveryLines(directOnly), []);

const legacy = { lines: [{ id: "legacy", itemId: "item-2", description: "Tubo", unit: "M", quantity: 4 }] };
assert.equal(materialFulfillmentLines(legacy)?.[0]?.directPickupMilli, 0);
assert.equal(materialFulfillmentLines(legacy)?.[0]?.missionDeliveryMilli, 4_000);

const invalidSplit = structuredClone(mixed);
invalidSplit.fulfillmentPlan.lines[0].missionDeliveryMilli = 7_499;
assert.equal(materialFulfillmentLines(invalidSplit), null, "split must reconcile exactly with approved stock");

const invalidQuantity = structuredClone(mixed);
invalidQuantity.lines[0].quantity = 11;
assert.equal(materialFulfillmentLines(invalidQuantity), null, "allocation cannot be reused after the approved quantity changes");

const duplicatePlan = structuredClone(mixed);
duplicatePlan.fulfillmentPlan.lines.push({ ...duplicatePlan.fulfillmentPlan.lines[0] });
assert.equal(materialFulfillmentLines(duplicatePlan), null, "a request line can have only one allocation entry");

const unsupportedPlan = structuredClone(mixed);
unsupportedPlan.fulfillmentPlan.allocationMethod = "PERCENTAGE";
assert.equal(materialFulfillmentLines(unsupportedPlan), null, "unsupported allocation contracts fail closed");

console.log("Material fulfillment split, legacy compatibility and mission-only quantities: PASS");
