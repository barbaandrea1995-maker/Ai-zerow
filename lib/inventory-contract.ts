import type { inventoryItems, inventoryMovements } from "@/db/schema";

export const INVENTORY_MOVEMENT_TYPES = [
  "REGISTER",
  "RECEIVE",
  "RESERVE",
  "RELEASE",
  "PICK",
  "LOAD",
  "CONSUME",
  "RETURN",
  "ADJUST",
] as const;

export type InventoryMovementType = (typeof INVENTORY_MOVEMENT_TYPES)[number];

export function quantityToMilli(
  value: unknown,
  { allowNegative = false, allowZero = false } = {},
) {
  const numeric = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(numeric)) return null;
  if (!allowNegative && numeric < 0) return null;
  if (!allowZero && numeric === 0) return null;
  const milli = Math.round(numeric * 1_000);
  if (!Number.isSafeInteger(milli) || Math.abs(milli) > 1_000_000_000_000) return null;
  return milli;
}

export function milliToQuantity(value: number) {
  return Math.round(value) / 1_000;
}

export function inventoryItemForResponse(row: typeof inventoryItems.$inferSelect) {
  const availableMilli = Math.max(0, row.onHandMilli - row.reservedMilli);
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    unit: row.unit,
    location: row.location,
    onHand: milliToQuantity(row.onHandMilli),
    reserved: milliToQuantity(row.reservedMilli),
    available: milliToQuantity(availableMilli),
    minStock: milliToQuantity(row.minStockMilli),
    belowMinimum: availableMilli < row.minStockMilli,
    status: row.status,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function inventoryMovementForResponse(row: typeof inventoryMovements.$inferSelect) {
  return {
    id: row.id,
    itemId: row.itemId,
    jobId: row.jobId,
    missionId: row.missionId,
    movementType: row.movementType,
    quantity: milliToQuantity(row.quantityMilli),
    before: {
      onHand: milliToQuantity(row.beforeOnHandMilli),
      reserved: milliToQuantity(row.beforeReservedMilli),
    },
    after: {
      onHand: milliToQuantity(row.afterOnHandMilli),
      reserved: milliToQuantity(row.afterReservedMilli),
    },
    note: row.note,
    actorId: row.actorId,
    createdAt: row.createdAt,
  };
}
