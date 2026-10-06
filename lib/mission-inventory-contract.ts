export type MissionWarehouseStatus =
  | "NOT_REQUIRED"
  | "PENDING_PICK"
  | "PICKED"
  | "LOADED"
  | "DELIVERED"
  | "PARTIAL"
  | "RECONCILE";

export type MissionMaterialLine = {
  lineId: string;
  itemId: string | null;
  description: string;
  unit: string;
  quantityMilli: number;
};

export type MissionWarehouseMovement = {
  itemId: string;
  movementType: string;
  quantityMilli: number;
  createdAt?: string | null;
};

export type MissionWarehouseItem = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  warehouseId: string | null;
};

export type MissionWarehouseLineReadback = {
  lineId: string;
  itemId: string | null;
  sku: string;
  name: string;
  unit: string;
  required: number;
  picked: number;
  loaded: number;
  delivered: number;
  status: Exclude<MissionWarehouseStatus, "NOT_REQUIRED" | "PENDING_PICK" | "PICKED" | "PARTIAL" | "RECONCILE"> | "PENDING_PICK" | "PICKED" | "PARTIAL" | "RECONCILE";
};

export type MissionWarehouseReadback = {
  required: boolean;
  status: MissionWarehouseStatus;
  warehouse: { id: string; name: string; locationLabel: string } | null;
  lines: MissionWarehouseLineReadback[];
  missing: string[];
  checkedAt: string;
};

type JsonObject = Record<string, unknown>;

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function quantityToMilli(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const milli = Math.round(numeric * 1_000);
  return Number.isSafeInteger(milli) && milli > 0 ? milli : null;
}

function quantity(value: number) {
  return Math.round(value) / 1_000;
}

export function missionMaterialLines(payload: JsonObject): MissionMaterialLine[] {
  const snapshot = isRecord(payload.materialRequestSnapshot) ? payload.materialRequestSnapshot : null;
  const rawLines = snapshot && Array.isArray(snapshot.lines) ? snapshot.lines : [];
  const lines = rawLines.flatMap((candidate, index) => {
    if (!isRecord(candidate)) return [];
    const quantityMilli = quantityToMilli(candidate.quantity);
    return [{
      lineId: text(candidate.id, `line-${index + 1}`),
      itemId: text(candidate.itemId) || null,
      description: text(candidate.description ?? candidate.name, "Materiale non descritto"),
      unit: text(candidate.unit, "UNIT"),
      quantityMilli: quantityMilli ?? 0,
    }];
  });
  const merged = new Map<string, MissionMaterialLine>();
  for (const line of lines) {
    const key = line.itemId ?? `invalid:${line.lineId}`;
    const current = merged.get(key);
    merged.set(key, current
      ? { ...current, quantityMilli: current.quantityMilli + line.quantityMilli }
      : line);
  }
  return [...merged.values()];
}

function lineStatus(picked: number, loaded: number, delivered: number, required: number): MissionWarehouseLineReadback["status"] {
  if (required <= 0) return "RECONCILE";
  if (delivered >= required) return "DELIVERED";
  if (loaded >= required) return "LOADED";
  if (picked >= required) return "PICKED";
  if (picked > 0 || loaded > 0 || delivered > 0) return "PARTIAL";
  return "PENDING_PICK";
}

export function buildMissionWarehouseReadback(
  payload: JsonObject,
  movementRows: MissionWarehouseMovement[] = [],
  itemRows: MissionWarehouseItem[] = [],
  checkedAt = new Date().toISOString(),
): MissionWarehouseReadback {
  const snapshot = isRecord(payload.materialRequestSnapshot) ? payload.materialRequestSnapshot : null;
  const requiresWarehouse = Boolean(text(payload.materialRequestId) || snapshot);
  const warehouseValue = snapshot && isRecord(snapshot.warehouse) ? snapshot.warehouse : null;
  const warehouse = warehouseValue && text(warehouseValue.id)
    ? {
      id: text(warehouseValue.id),
      name: text(warehouseValue.name, "Magazzino sorgente"),
      locationLabel: text(warehouseValue.locationLabel, "Ubicazione non indicata"),
    }
    : null;
  if (!requiresWarehouse) {
    return { required: false, status: "NOT_REQUIRED", warehouse: null, lines: [], missing: [], checkedAt };
  }

  const sourceLines = missionMaterialLines(payload);
  const itemById = new Map(itemRows.map((item) => [item.id, item]));
  const missing: string[] = [];
  const lines = sourceLines.map((sourceLine) => {
    const item = sourceLine.itemId ? itemById.get(sourceLine.itemId) : null;
    const rows = sourceLine.itemId ? movementRows.filter((movement) => movement.itemId === sourceLine.itemId) : [];
    const sum = (type: string) => rows
      .filter((movement) => movement.movementType.toUpperCase() === type)
      .reduce((total, movement) => total + Math.max(0, movement.quantityMilli), 0);
    const picked = sum("PICK");
    const loaded = sum("LOAD");
    const delivered = sum("DELIVER");
    const status = item && sourceLine.itemId && sourceLine.quantityMilli > 0
      ? lineStatus(picked, loaded, delivered, sourceLine.quantityMilli)
      : "RECONCILE";
    if (!item || !sourceLine.itemId || sourceLine.quantityMilli <= 0) {
      missing.push(`${sourceLine.description}: riga materiale non riconciliabile con il registro server-side.`);
    } else if (picked < sourceLine.quantityMilli) {
      missing.push(`${item.name}: prelievo incompleto (${quantity(picked)} / ${quantity(sourceLine.quantityMilli)} ${item.unit}).`);
    } else if (loaded < sourceLine.quantityMilli) {
      missing.push(`${item.name}: carico missione non confermato (${quantity(loaded)} / ${quantity(sourceLine.quantityMilli)} ${item.unit}).`);
    } else if (delivered < sourceLine.quantityMilli) {
      missing.push(`${item.name}: scarico/consegna non confermato (${quantity(delivered)} / ${quantity(sourceLine.quantityMilli)} ${item.unit}).`);
    }
    return {
      lineId: sourceLine.lineId,
      itemId: sourceLine.itemId,
      sku: item?.sku ?? "—",
      name: item?.name ?? sourceLine.description,
      unit: item?.unit ?? sourceLine.unit,
      required: quantity(sourceLine.quantityMilli),
      picked: quantity(picked),
      loaded: quantity(loaded),
      delivered: quantity(delivered),
      status,
    };
  });

  if (!sourceLines.length) missing.push("La richiesta materiali non contiene righe riconciliabili.");
  const all = lines.length > 0 && lines.every((line) => line.status === "DELIVERED");
  const allLoaded = lines.length > 0 && lines.every((line) => ["LOADED", "DELIVERED"].includes(line.status));
  const allPicked = lines.length > 0 && lines.every((line) => ["PICKED", "LOADED", "DELIVERED"].includes(line.status));
  const hasProgress = lines.some((line) => line.status !== "PENDING_PICK" && line.status !== "RECONCILE");
  const status: MissionWarehouseStatus = !sourceLines.length || lines.some((line) => line.status === "RECONCILE")
    ? "RECONCILE"
    : all
      ? "DELIVERED"
      : allLoaded
        ? "LOADED"
        : allPicked
          ? "PICKED"
          : hasProgress
            ? "PARTIAL"
            : "PENDING_PICK";

  return { required: true, status, warehouse, lines, missing, checkedAt };
}
