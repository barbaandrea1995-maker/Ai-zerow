import type { inventoryItems, inventoryMovements, tenantWarehouses } from "@/db/schema";

/** Server-owned unit catalog. New material records may only use these codes. */
export const INVENTORY_UNIT_CATALOG = [
  { code: "PZ", label: "Pezzi", symbol: "pz", decimals: 0 },
  { code: "M", label: "Metri", symbol: "m", decimals: 3 },
  { code: "CM", label: "Centimetri", symbol: "cm", decimals: 1 },
  { code: "MQ", label: "Metri quadrati", symbol: "m²", decimals: 3 },
  { code: "MC", label: "Metri cubi", symbol: "m³", decimals: 3 },
  { code: "KG", label: "Chilogrammi", symbol: "kg", decimals: 3 },
  { code: "G", label: "Grammi", symbol: "g", decimals: 0 },
  { code: "L", label: "Litri", symbol: "l", decimals: 3 },
  { code: "ML", label: "Millilitri", symbol: "ml", decimals: 0 },
  { code: "H", label: "Ore", symbol: "h", decimals: 3 },
  { code: "SET", label: "Set", symbol: "set", decimals: 0 },
  { code: "BOX", label: "Scatole", symbol: "box", decimals: 0 },
] as const;

export type InventoryUnitCode = (typeof INVENTORY_UNIT_CATALOG)[number]["code"];

export function inventoryUnitForCode(value: unknown) {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  return INVENTORY_UNIT_CATALOG.find((unit) => unit.code === normalized) ?? null;
}

export function warehouseForResponse(row: typeof tenantWarehouses.$inferSelect) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    locationLabel: row.locationLabel,
    coordinates: {
      latitude: row.latitudeE6 / 1_000_000,
      longitude: row.longitudeE6 / 1_000_000,
    },
    geofence: {
      radiusMeters: row.geofenceRadiusMeters,
      status: "configured",
    },
    locationSource: row.locationSource,
    locationStatus: "SERVER_VALIDATED_COORDINATES" as const,
    status: row.status,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

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
    warehouseId: row.warehouseId,
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

export function replenishmentProposalForItem(row: typeof inventoryItems.$inferSelect) {
  const availableMilli = Math.max(0, row.onHandMilli - row.reservedMilli);
  if (availableMilli >= row.minStockMilli || row.status === "ARCHIVED") return null;
  const targetMilli = Math.max(row.minStockMilli * 2, row.minStockMilli + 1_000);
  return {
    itemId: row.id,
    sku: row.sku,
    name: row.name,
    unit: row.unit,
    warehouseId: row.warehouseId,
    location: row.location,
    available: milliToQuantity(availableMilli),
    minimum: milliToQuantity(row.minStockMilli),
    suggestedQuantity: milliToQuantity(Math.max(0, targetMilli - availableMilli)),
    status: "PROPOSAL_ONLY" as const,
    reason: "available_below_minimum",
  };
}
