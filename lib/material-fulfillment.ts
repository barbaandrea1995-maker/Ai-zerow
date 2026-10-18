import { milliToQuantity, quantityToMilli } from "./inventory-contract.ts";

export type MaterialFulfillmentLine = {
  lineId: string;
  itemId: string | null;
  description: string;
  sku: string;
  unit: string;
  approvedQuantityMilli: number;
  directPickupMilli: number;
  missionDeliveryMilli: number;
};

type JsonObject = Record<string, unknown>;

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function boundedText(value: unknown, max: number, fallback = "") {
  return typeof value === "string" ? value.trim().slice(0, max) : fallback;
}

/**
 * Reads the immutable split attached to an approved material request.
 * Requests created before the split existed remain mission-only, so existing
 * reservations and delivery journeys keep their original meaning.
 */
export function materialFulfillmentLines(payload: JsonObject): MaterialFulfillmentLine[] | null {
  if (!Array.isArray(payload.lines) || payload.lines.length === 0 || payload.lines.length > 50) return null;
  const hasPlan = Object.prototype.hasOwnProperty.call(payload, "fulfillmentPlan");
  const plan = isRecord(payload.fulfillmentPlan) ? payload.fulfillmentPlan : null;
  if (hasPlan && (!plan || plan.version !== 1 || plan.allocationMethod !== "LINE_QUANTITY" || !Array.isArray(plan.lines))) return null;

  const planByLineId = new Map<string, JsonObject>();
  if (plan) {
    for (const value of plan.lines as unknown[]) {
      if (!isRecord(value)) return null;
      const lineId = boundedText(value.lineId, 80);
      if (!lineId || planByLineId.has(lineId)) return null;
      planByLineId.set(lineId, value);
    }
    if (planByLineId.size !== payload.lines.length) return null;
  }

  const result: MaterialFulfillmentLine[] = [];
  for (const [index, value] of payload.lines.entries()) {
    if (!isRecord(value)) return null;
    const lineId = boundedText(value.id, 80, `line-${index + 1}`);
    const itemId = boundedText(value.itemId, 120) || null;
    const approvedQuantityMilli = quantityToMilli(value.quantity);
    if (!lineId || approvedQuantityMilli === null) return null;
    const allocation = planByLineId.get(lineId);
    let directPickupMilli = 0;
    let missionDeliveryMilli = approvedQuantityMilli;
    if (plan) {
      if (!allocation
        || boundedText(allocation.itemId, 120) !== itemId
        || allocation.approvedQuantityMilli !== approvedQuantityMilli
        || !Number.isSafeInteger(allocation.directPickupMilli)
        || !Number.isSafeInteger(allocation.missionDeliveryMilli)) return null;
      directPickupMilli = allocation.directPickupMilli as number;
      missionDeliveryMilli = allocation.missionDeliveryMilli as number;
      if (directPickupMilli < 0
        || missionDeliveryMilli < 0
        || directPickupMilli + missionDeliveryMilli !== approvedQuantityMilli) return null;
    }
    result.push({
      lineId,
      itemId,
      description: boundedText(value.description ?? value.name, 200, "Materiale"),
      sku: boundedText(value.sku, 80),
      unit: boundedText(value.unit, 16, "PZ"),
      approvedQuantityMilli,
      directPickupMilli,
      missionDeliveryMilli,
    });
  }
  return result;
}

export function missionDeliveryLines(payload: JsonObject) {
  const lines = materialFulfillmentLines(payload);
  if (!lines) return null;
  return lines.filter((line) => line.missionDeliveryMilli > 0).map((line) => ({
    id: line.lineId,
    itemId: line.itemId,
    description: line.description,
    sku: line.sku,
    unit: line.unit,
    quantity: milliToQuantity(line.missionDeliveryMilli),
  }));
}
