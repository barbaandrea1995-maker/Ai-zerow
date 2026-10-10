import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  inventoryItems,
  inventoryMovements,
  jobJourneyRecords,
  qrCodes,
  s04Records,
  s06Events,
  s06Outbox,
  s06Reconciliations,
  tenantWarehouses,
} from "@/db/schema";
import { getAuthorityContext, hasCapability, publicAuthorityContext } from "@/lib/authority-context";
import {
  inventoryItemForResponse,
  inventoryMovementForResponse,
  inventoryUnitForCode,
  quantityToMilli,
  replenishmentProposalForItem,
  type InventoryMovementType,
  warehouseForResponse,
} from "@/lib/inventory-contract";
import { allocateServerName, CanonicalCodeConflictError } from "@/lib/server-naming";
import { tenantWarehouseAccess, warehouseIdIsAllowed } from "@/lib/warehouse-access";

export const dynamic = "force-dynamic";

type JsonObject = Record<string, unknown>;

const MUTATION_ACTIONS = {
  receive: "RECEIVE",
  pick: "PICK",
  adjust: "ADJUST",
} as const satisfies Record<string, InventoryMovementType>;

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function boundedText(value: unknown, max: number, fallback = "") {
  return typeof value === "string" ? value.trim().slice(0, max) : fallback;
}

function parseObject(value: string): JsonObject {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function readBoundedJson(request: Request, maxBytes = 32_768) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) return { error: "payload_too_large" as const };
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) return { error: "payload_too_large" as const };
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? { value: parsed } : { error: "invalid_json" as const };
  } catch {
    return { error: "invalid_json" as const };
  }
}

function itemStatus(onHandMilli: number, reservedMilli: number, minStockMilli: number) {
  const available = onHandMilli - reservedMilli;
  if (onHandMilli === 0) return "OUT_OF_STOCK";
  if (available < minStockMilli) return "LOW_STOCK";
  return "ACTIVE";
}

function normalizedIdentifier(value: unknown) {
  return boundedText(value, 180).toUpperCase();
}

async function findItemByIdentifier(tenantId: string, value: unknown, warehouseId?: string, allowedWarehouseIds?: string[] | null) {
  const raw = boundedText(value, 180);
  const normalized = raw.toUpperCase();
  if (!raw) return null;
  const warehouseCondition = warehouseId ? eq(inventoryItems.warehouseId, warehouseId) : undefined;
  const scopeCondition = allowedWarehouseIds === undefined || allowedWarehouseIds === null
    ? undefined
    : allowedWarehouseIds.length
      ? inArray(inventoryItems.warehouseId, allowedWarehouseIds)
      : eq(inventoryItems.warehouseId, "__NO_ASSIGNED_WAREHOUSE__");
  const [item] = await getDb().select().from(inventoryItems).where(and(
    eq(inventoryItems.tenantId, tenantId),
    ...(warehouseCondition ? [warehouseCondition] : []),
    ...(scopeCondition ? [scopeCondition] : []),
    or(
      eq(inventoryItems.id, raw),
      eq(inventoryItems.id, normalized),
      eq(inventoryItems.sku, normalized),
      eq(inventoryItems.barcode, raw),
      eq(inventoryItems.barcode, normalized),
      eq(inventoryItems.qrCode, raw),
      eq(inventoryItems.qrCode, normalized),
    ),
  )).limit(1);
  return item ?? null;
}

async function inventoryReadback(tenantId: string, filters: { itemId?: string; jobId?: string; warehouseId?: string; allowedWarehouseIds?: string[] | null } = {}) {
  const db = getDb();
  const itemConditions = [eq(inventoryItems.tenantId, tenantId)];
  if (filters.itemId) itemConditions.push(eq(inventoryItems.id, filters.itemId));
  if (filters.warehouseId) itemConditions.push(eq(inventoryItems.warehouseId, filters.warehouseId));
  if (filters.allowedWarehouseIds !== undefined && filters.allowedWarehouseIds !== null) {
    itemConditions.push(filters.allowedWarehouseIds.length
      ? inArray(inventoryItems.warehouseId, filters.allowedWarehouseIds)
      : eq(inventoryItems.warehouseId, "__NO_ASSIGNED_WAREHOUSE__"));
  }
  const [items, warehouses] = await Promise.all([
    db.select().from(inventoryItems)
      .where(and(...itemConditions))
      .orderBy(desc(inventoryItems.updatedAt))
      .limit(500),
    db.select().from(tenantWarehouses)
      .where(and(
        eq(tenantWarehouses.tenantId, tenantId),
        ...(filters.warehouseId ? [eq(tenantWarehouses.id, filters.warehouseId)] : []),
      ...(filters.allowedWarehouseIds === undefined || filters.allowedWarehouseIds === null
        ? []
        : filters.allowedWarehouseIds.length
          ? [inArray(tenantWarehouses.id, filters.allowedWarehouseIds)]
          : [eq(tenantWarehouses.id, "__NO_ASSIGNED_WAREHOUSE__")]),
      ))
      .orderBy(tenantWarehouses.name),
  ]);
  const movementConditions = [eq(inventoryMovements.tenantId, tenantId)];
  if (filters.itemId) movementConditions.push(eq(inventoryMovements.itemId, filters.itemId));
  if (filters.jobId) movementConditions.push(eq(inventoryMovements.jobId, filters.jobId));
  const itemIds = items.map((item) => item.id);
  if (itemIds.length) movementConditions.push(inArray(inventoryMovements.itemId, itemIds));
  const movements = itemIds.length
    ? await db.select().from(inventoryMovements)
      .where(and(...movementConditions))
      .orderBy(desc(inventoryMovements.createdAt))
      .limit(250)
    : [];
  const warehouseById = new Map(warehouses.map((warehouse) => [warehouse.id, warehouse]));
  const itemById = new Map(items.map((item) => [item.id, item]));
  const movementResponses = movements.map((movement) => {
    const item = itemById.get(movement.itemId);
    const warehouse = item?.warehouseId ? warehouseById.get(item.warehouseId) : null;
    return {
      ...inventoryMovementForResponse(movement),
      warehouseId: item?.warehouseId ?? null,
      warehouse: warehouse ? {
        id: warehouse.id,
        code: warehouse.code,
        name: warehouse.name,
        locationLabel: warehouse.locationLabel,
      } : null,
    };
  });
  return {
    scope: filters.warehouseId
      ? { type: "WAREHOUSE" as const, warehouseId: filters.warehouseId }
      : { type: "TENANT_CONSOLIDATED" as const },
    warehouses: warehouses.map(warehouseForResponse),
    items: items.map((item) => inventoryItemForResponse(item, item.warehouseId ? warehouseById.get(item.warehouseId) ?? null : null)),
    movements: movementResponses,
    replenishment: items.map(replenishmentProposalForItem).filter((item): item is NonNullable<typeof item> => Boolean(item)),
    summary: {
      itemCount: items.length,
      lowStockCount: items.filter((item) => itemStatus(item.onHandMilli, item.reservedMilli, item.minStockMilli) !== "ACTIVE").length,
      movementCount: movements.length,
    },
  };
}

async function requireJob(tenantId: string, jobId: string) {
  const db = getDb();
  const [job] = await db.select({ id: s04Records.id, code: s04Records.canonicalCode })
    .from(s04Records)
    .where(and(
      eq(s04Records.tenantId, tenantId),
      eq(s04Records.module, "operations"),
      eq(s04Records.id, jobId),
    ))
    .limit(1);
  if (job) return job;
  const [jobByCode] = await db.select({ id: s04Records.id, code: s04Records.canonicalCode })
    .from(s04Records)
    .where(and(
      eq(s04Records.tenantId, tenantId),
      eq(s04Records.module, "operations"),
      eq(s04Records.canonicalCode, jobId),
    ))
    .limit(1);
  return jobByCode ?? null;
}

async function requireMission(tenantId: string, jobId: string, missionId: string) {
  const [mission] = await getDb().select({ id: jobJourneyRecords.id, status: jobJourneyRecords.status, payloadJson: jobJourneyRecords.payloadJson })
    .from(jobJourneyRecords)
    .where(and(
      eq(jobJourneyRecords.tenantId, tenantId),
      eq(jobJourneyRecords.jobId, jobId),
      eq(jobJourneyRecords.id, missionId),
      eq(jobJourneyRecords.domain, "mission"),
    ))
    .limit(1);
  return mission ?? null;
}

export async function GET(request: Request) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "warehouse.read")) {
    return Response.json({ error: "forbidden", capability: "warehouse.read" }, { status: 403 });
  }

  const url = new URL(request.url);
  const itemId = boundedText(url.searchParams.get("itemId"), 120);
  const jobId = boundedText(url.searchParams.get("jobId"), 160);
  const identifier = boundedText(url.searchParams.get("identifier"), 180);
  const warehouseId = boundedText(url.searchParams.get("warehouseId"), 120);
  try {
    const access = await tenantWarehouseAccess(context);
    if (warehouseId && !warehouseIdIsAllowed(access, warehouseId)) {
      return Response.json({ error: "warehouse_assignment_required" }, { status: 403 });
    }
    let resolvedWarehouse: typeof tenantWarehouses.$inferSelect | null = null;
    if (warehouseId) {
      const [warehouse] = await getDb().select().from(tenantWarehouses).where(and(
        eq(tenantWarehouses.tenantId, context.tenantId),
        eq(tenantWarehouses.id, warehouseId),
        eq(tenantWarehouses.status, "active"),
      )).limit(1);
      if (!warehouse) return Response.json({ error: "warehouse_not_found_or_inactive" }, { status: 404 });
      resolvedWarehouse = warehouse;
    }
    const resolvedItem = identifier ? await findItemByIdentifier(context.tenantId, identifier, warehouseId || undefined, access.allowedWarehouseIds) : null;
    if (identifier && !resolvedItem) {
      return Response.json({ error: warehouseId ? "inventory_identifier_not_in_selected_warehouse" : "inventory_identifier_not_found" }, { status: 404 });
    }
    return Response.json({
      context: publicAuthorityContext(context),
      ...(await inventoryReadback(context.tenantId, { itemId: itemId || resolvedItem?.id || undefined, jobId: jobId || undefined, warehouseId: warehouseId || undefined, allowedWarehouseIds: access.allowedWarehouseIds })),
      resolvedItem: resolvedItem ? inventoryItemForResponse(resolvedItem, resolvedWarehouse) : null,
      warehouseScope: access.scope,
      readback: { status: "verified", scope: warehouseId ? "warehouse" : access.scope.mode.toLowerCase(), warehouseId: warehouseId || undefined, checkedAt: new Date().toISOString() },
    }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return Response.json({ error: "inventory_readback_unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "warehouse.write")) {
    return Response.json({ error: "forbidden", capability: "warehouse.write" }, { status: 403 });
  }

  const parsed = await readBoundedJson(request);
  if ("error" in parsed) {
    return Response.json({ error: parsed.error }, { status: parsed.error === "payload_too_large" ? 413 : 400 });
  }
  const input = parsed.value;
  const action = boundedText(input.action, 32).toLowerCase();
  const requestedWarehouseId = boundedText(input.warehouseId, 120);
  const idempotencyKey = boundedText(input.idempotencyKey, 160);
  if (typeof input.idempotencyKey === "string" && input.idempotencyKey.trim().length > 160) {
    return Response.json({ error: "idempotency_key_too_long" }, { status: 400 });
  }
  if (idempotencyKey.length < 8) return Response.json({ error: "idempotency_key_required" }, { status: 400 });
  if (action === "load") {
    return Response.json({ error: "mission_loading_requires_geofence", message: "Conferma il carico dalla tappa attiva nel modulo Missioni." }, { status: 409 });
  }
  if (action === "adjust" && !hasCapability(context, "warehouse.register")) {
    return Response.json({ error: "forbidden", capability: "warehouse.register" }, { status: 403 });
  }
  if (action === "register_item" && !hasCapability(context, "warehouse.register")) {
    return Response.json({ error: "forbidden", capability: "warehouse.register" }, { status: 403 });
  }

  try {
    const db = getDb();
    const access = await tenantWarehouseAccess(context);
    if (!requestedWarehouseId) return Response.json({ error: "warehouse_required_for_movement" }, { status: 400 });
    if (!warehouseIdIsAllowed(access, requestedWarehouseId)) {
      return Response.json({ error: "warehouse_assignment_required" }, { status: 403 });
    }
    if (!access.warehouses.some((warehouse) => warehouse.id === requestedWarehouseId)) {
      return Response.json({ error: "warehouse_not_found_or_inactive" }, { status: 404 });
    }
    const [existingEvent] = await db.select().from(s06Events).where(and(
      eq(s06Events.tenantId, context.tenantId),
      eq(s06Events.idempotencyKey, idempotencyKey),
    )).limit(1);
    if (existingEvent) {
      if (existingEvent.aggregateType !== "inventory.item") {
        return Response.json({ error: "inventory_idempotency_key_conflict" }, { status: 409 });
      }
      const [movement] = await db.select().from(inventoryMovements).where(and(
        eq(inventoryMovements.tenantId, context.tenantId),
        eq(inventoryMovements.idempotencyKey, idempotencyKey),
      )).limit(1);
      if (!movement) return Response.json({ error: "inventory_idempotency_readback_unavailable" }, { status: 503 });
      return Response.json({
        ...(await inventoryReadback(context.tenantId, { itemId: movement.itemId, warehouseId: requestedWarehouseId, allowedWarehouseIds: access.allowedWarehouseIds })),
        movement: inventoryMovementForResponse(movement),
        idempotent: true,
        eventId: existingEvent.eventId,
      }, { headers: { "cache-control": "private, no-store" } });
    }

    const now = new Date().toISOString();
    const eventId = crypto.randomUUID();
    const movementId = crypto.randomUUID();

    if (action === "register_item") {
      const name = boundedText(input.name, 160);
      const unit = inventoryUnitForCode(input.unit);
      const warehouseId = boundedText(input.warehouseId, 120);
      const barcode = normalizedIdentifier(input.barcode);
      const storageShelf = boundedText(input.shelf, 120);
      const openingMilli = quantityToMilli(input.openingQuantity ?? 0, { allowZero: true });
      const minStockMilli = quantityToMilli(input.minStock ?? 0, { allowZero: true });
      if (name.length < 2) return Response.json({ error: "item_name_required" }, { status: 400 });
      if (!unit) return Response.json({ error: "unit_must_be_selected_from_catalog" }, { status: 400 });
      if (!warehouseId) return Response.json({ error: "warehouse_required" }, { status: 400 });
      if (openingMilli === null || minStockMilli === null) return Response.json({ error: "invalid_stock_quantity" }, { status: 400 });
      if (barcode && !/^[A-Z0-9][A-Z0-9._:/-]{1,179}$/.test(barcode)) {
        return Response.json({ error: "invalid_barcode" }, { status: 400 });
      }
      const [warehouse] = await db.select().from(tenantWarehouses).where(and(
        eq(tenantWarehouses.tenantId, context.tenantId),
        eq(tenantWarehouses.id, warehouseId),
        eq(tenantWarehouses.status, "active"),
      )).limit(1);
      if (!warehouse) return Response.json({ error: "warehouse_not_found_or_inactive" }, { status: 404 });

      const naming = await allocateServerName({
        tenantId: context.tenantId,
        module: "warehouse",
        entityType: "material",
        description: name,
      });
      const sku = naming?.canonicalCode;
      if (!sku) return Response.json({ error: "sku_unavailable" }, { status: 503 });
      const qrCode = barcode ? null : `AZ1|MATERIAL|${sku}`;
      const itemId = crypto.randomUUID();
      const status = itemStatus(openingMilli, 0, minStockMilli);
      const eventPayload = JSON.stringify({ action, sku, name, unit: unit.code, warehouseId, warehouseCode: warehouse.code, shelf: storageShelf || null, barcode: barcode || null, qrCode, openingQuantityMilli: openingMilli, version: 1 });

      await db.batch([
        db.insert(inventoryItems).values({
          id: itemId,
          tenantId: context.tenantId,
          sku,
          name,
          unit: unit.code,
          warehouseId,
          location: warehouse.code,
          storageShelf,
          barcode: barcode || null,
          qrCode,
          onHandMilli: openingMilli,
          reservedMilli: 0,
          minStockMilli,
          status,
          version: 1,
          createdBy: context.actorId,
          createdAt: now,
          updatedAt: now,
        }),
        db.insert(inventoryMovements).values({
          id: movementId,
          tenantId: context.tenantId,
          itemId,
          movementType: "REGISTER",
          quantityMilli: openingMilli,
          beforeOnHandMilli: 0,
          afterOnHandMilli: openingMilli,
          beforeReservedMilli: 0,
          afterReservedMilli: 0,
          note: boundedText(input.note, 500, "Registrazione materiale"),
          idempotencyKey,
          actorId: context.actorId,
          createdAt: now,
        }),
        ...(qrCode ? [db.insert(qrCodes).values({
          id: `MATERIAL-QR-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
          tenantId: context.tenantId,
          format: "QR",
          entityType: "material",
          entityId: sku,
          label: name,
          payload: qrCode,
          createdBy: context.actorId,
          createdAt: now,
          updatedAt: now,
          lastScannedAt: null,
        })] : []),
        db.insert(s06Events).values({
          eventId,
          tenantId: context.tenantId,
          eventType: "warehouse.inventory.item_registered",
          schemaVersion: "1",
          actorType: "human",
          actorId: context.actorId,
          source: "sites-warehouse",
          occurredAt: now,
          observedAt: now,
          aggregateType: "inventory.item",
          aggregateId: itemId,
          aggregateVersion: 1,
          payloadJson: eventPayload,
          correlationId: crypto.randomUUID(),
          causationId: null,
          idempotencyKey,
          status: "COMMITTED_SITES_READBACK",
          createdAt: now,
        }),
        db.insert(s06Outbox).values({
          id: crypto.randomUUID(), tenantId: context.tenantId, eventId,
          topic: "zerow.warehouse.inventory.item_registered", status: "PENDING_EXTERNAL_CONSUMER",
          attempts: 0, createdAt: now, updatedAt: now,
        }),
        db.insert(s06Reconciliations).values({
          id: crypto.randomUUID(), tenantId: context.tenantId,
          aggregateType: "inventory.item", aggregateId: itemId,
          expectedVersion: 1, observedVersion: 1, status: "SITES_READBACK_VERIFIED",
          detail: "Anagrafica e saldo iniziale persistiti con ledger append-only.",
          createdAt: now, updatedAt: now,
        }),
      ]);

      const readback = await inventoryReadback(context.tenantId, { itemId, warehouseId, allowedWarehouseIds: access.allowedWarehouseIds });
      return Response.json({ ...readback, movement: readback.movements[0], idempotent: false, eventId }, {
        status: 201,
        headers: { "cache-control": "private, no-store" },
      });
    }

    if (!Object.prototype.hasOwnProperty.call(MUTATION_ACTIONS, action)) {
      return Response.json({ error: "unsupported_inventory_action", allowed: ["register_item", ...Object.keys(MUTATION_ACTIONS)] }, { status: 400 });
    }
    const movementType = MUTATION_ACTIONS[action as keyof typeof MUTATION_ACTIONS];
    const submittedItemId = boundedText(input.itemId, 120);
    const identifier = boundedText(input.identifier, 180);
    if (!requestedWarehouseId) return Response.json({ error: "warehouse_required_for_movement" }, { status: 400 });
    const resolvedByIdentifier = identifier ? await findItemByIdentifier(context.tenantId, identifier, requestedWarehouseId, access.allowedWarehouseIds) : null;
    if (identifier && !resolvedByIdentifier) return Response.json({ error: "inventory_identifier_not_in_selected_warehouse" }, { status: 404 });
    if (submittedItemId && resolvedByIdentifier && submittedItemId !== resolvedByIdentifier.id) {
      return Response.json({ error: "inventory_identifier_item_mismatch" }, { status: 409 });
    }
    const itemId = submittedItemId || resolvedByIdentifier?.id || "";
    const jobReference = boundedText(input.jobId, 160);
    const missionId = boundedText(input.missionId, 160);
    const expectedVersion = typeof input.expectedVersion === "number" && Number.isInteger(input.expectedVersion)
      ? input.expectedVersion
      : null;
    if (!itemId) return Response.json({ error: "item_id_required" }, { status: 400 });
    if (expectedVersion === null || expectedVersion < 1) return Response.json({ error: "expected_version_required" }, { status: 400 });

    const quantityMilli = quantityToMilli(input.quantity, { allowNegative: movementType === "ADJUST" });
    if (quantityMilli === null) return Response.json({ error: "valid_quantity_required" }, { status: 400 });
    const movementNote = boundedText(input.note, 500);
    if (movementNote.length < 3) return Response.json({ error: "inventory_movement_note_required" }, { status: 400 });
    const needsJob = movementType === "PICK";
    if (needsJob && !jobReference) return Response.json({ error: "job_id_required" }, { status: 400 });
    const job = jobReference ? await requireJob(context.tenantId, jobReference) : null;
    if (jobReference && !job) return Response.json({ error: "job_not_found" }, { status: 404 });
    const canonicalJobId = job?.id ?? null;
    const [current] = await db.select().from(inventoryItems).where(and(
      eq(inventoryItems.tenantId, context.tenantId),
      eq(inventoryItems.id, itemId),
    )).limit(1);
    if (!current) return Response.json({ error: "inventory_item_not_found" }, { status: 404 });
    if (current.warehouseId !== requestedWarehouseId) {
      return Response.json({ error: "inventory_item_belongs_to_other_warehouse" }, { status: 409 });
    }
    if (current.version !== expectedVersion) {
      return Response.json({ error: "version_conflict", expectedVersion, currentVersion: current.version }, { status: 409 });
    }

    if (movementType === "PICK") {
      if (!missionId) return Response.json({ error: "mission_id_required", message: "Il prelievo deve riferirsi alla missione che evaderà la richiesta approvata." }, { status: 400 });
      const mission = canonicalJobId ? await requireMission(context.tenantId, canonicalJobId, missionId) : null;
      if (!mission) return Response.json({ error: "mission_not_found" }, { status: 404 });
      if (mission.status !== "PLANNED") return Response.json({ error: "mission_not_loadable", status: mission.status }, { status: 409 });
      const missionPayload = parseObject(mission.payloadJson);
      const materialRequestId = boundedText(missionPayload.materialRequestId, 120);
      if (!materialRequestId) return Response.json({ error: "approved_material_request_required_for_pick" }, { status: 409 });
      const [materialRequest] = await db.select().from(jobJourneyRecords).where(and(
        eq(jobJourneyRecords.tenantId, context.tenantId),
        eq(jobJourneyRecords.jobId, canonicalJobId!),
        eq(jobJourneyRecords.id, materialRequestId),
        eq(jobJourneyRecords.domain, "warehouse"),
        eq(jobJourneyRecords.recordType, "MATERIAL_REQUEST"),
        eq(jobJourneyRecords.status, "APPROVED"),
      )).limit(1);
      if (!materialRequest) return Response.json({ error: "approved_material_request_required_for_pick" }, { status: 409 });
      const requestPayload = parseObject(materialRequest.payloadJson);
      if (boundedText(requestPayload.missionId, 120) !== missionId) {
        return Response.json({ error: "material_request_mission_mismatch" }, { status: 409 });
      }
      const requestWarehouse = isRecord(requestPayload.warehouse) ? requestPayload.warehouse : {};
      const requestWarehouseId = boundedText(requestPayload.warehouseId, 120) || boundedText(requestWarehouse.id, 120);
      if (requestWarehouseId !== current.warehouseId || current.warehouseId !== requestedWarehouseId) {
        return Response.json({ error: "material_request_warehouse_mismatch" }, { status: 409 });
      }
      const requestedMilli = Array.isArray(requestPayload.lines)
        ? requestPayload.lines.reduce((total, line) => {
          if (!isRecord(line) || boundedText(line.itemId, 120) !== itemId) return total;
          const lineMilli = quantityToMilli(line.quantity);
          return lineMilli === null ? total : total + lineMilli;
        }, 0)
        : 0;
      if (requestedMilli <= 0) return Response.json({ error: "item_not_in_approved_material_request" }, { status: 409 });
      const alreadyPicked = await db.select().from(inventoryMovements).where(and(
        eq(inventoryMovements.tenantId, context.tenantId),
        eq(inventoryMovements.itemId, itemId),
        eq(inventoryMovements.jobId, canonicalJobId!),
        eq(inventoryMovements.missionId, missionId),
        eq(inventoryMovements.movementType, "PICK"),
      ));
      const pickedMilli = alreadyPicked.reduce((total, movement) => total + Math.max(0, movement.quantityMilli), 0);
      if (pickedMilli + quantityMilli > requestedMilli) {
        return Response.json({ error: "pick_exceeds_approved_request", requested: requestedMilli, alreadyPicked: pickedMilli }, { status: 422 });
      }
    }

    let nextOnHand = current.onHandMilli;
    let nextReserved = current.reservedMilli;
    if (movementType === "RECEIVE") nextOnHand += quantityMilli;
    else if (movementType === "PICK") {
      if (current.reservedMilli < quantityMilli) return Response.json({ error: "insufficient_reserved_stock" }, { status: 422 });
      if (current.onHandMilli < quantityMilli) return Response.json({ error: "insufficient_physical_stock" }, { status: 422 });
      nextOnHand -= quantityMilli;
      nextReserved -= quantityMilli;
    } else if (movementType === "ADJUST") nextOnHand += quantityMilli;

    if (nextOnHand < 0 || nextReserved < 0 || nextReserved > nextOnHand) {
      return Response.json({ error: "inventory_invariant_violation" }, { status: 422 });
    }
    const nextVersion = current.version + 1;
    const status = itemStatus(nextOnHand, nextReserved, current.minStockMilli);
    const eventType = `warehouse.inventory.${movementType.toLowerCase()}`;
    const eventPayload = JSON.stringify({
      action,
      movementType,
      itemId,
      identifier: identifier || null,
      sku: current.sku,
      quantityMilli,
      jobId: canonicalJobId,
      missionId: missionId || null,
      warehouseId: current.warehouseId,
      before: { onHandMilli: current.onHandMilli, reservedMilli: current.reservedMilli },
      after: { onHandMilli: nextOnHand, reservedMilli: nextReserved },
      version: nextVersion,
    });

    const results = await db.batch([
      db.update(inventoryItems).set({
        onHandMilli: nextOnHand,
        reservedMilli: nextReserved,
        status,
        version: nextVersion,
        updatedAt: now,
      }).where(and(
        eq(inventoryItems.tenantId, context.tenantId),
        eq(inventoryItems.id, itemId),
        eq(inventoryItems.version, expectedVersion),
        eq(inventoryItems.warehouseId, requestedWarehouseId),
      )).returning(),
      db.run(sql`        INSERT INTO inventory_movements
          (id, tenant_id, item_id, job_id, mission_id, movement_type, quantity_milli,
           before_on_hand_milli, after_on_hand_milli, before_reserved_milli, after_reserved_milli,
           note, idempotency_key, actor_id, created_at)
        SELECT ${movementId}, ${context.tenantId}, ${itemId}, ${canonicalJobId}, ${missionId || null}, ${movementType}, ${quantityMilli},
          ${current.onHandMilli}, ${nextOnHand}, ${current.reservedMilli}, ${nextReserved},
          ${movementNote}, ${idempotencyKey}, ${context.actorId}, ${now}
        WHERE changes() = 1
      `),
      db.run(sql`        INSERT INTO s06_events
          (event_id, tenant_id, event_type, schema_version, actor_type, actor_id, source,
           occurred_at, observed_at, aggregate_type, aggregate_id, aggregate_version, payload_json,
           correlation_id, causation_id, idempotency_key, status, created_at)
        SELECT ${eventId}, ${context.tenantId}, ${eventType}, '1', 'human', ${context.actorId}, 'sites-warehouse',
          ${now}, ${now}, 'inventory.item', ${itemId}, ${nextVersion}, ${eventPayload},
          ${crypto.randomUUID()}, NULL, ${idempotencyKey}, 'COMMITTED_SITES_READBACK', ${now}
        WHERE EXISTS (SELECT 1 FROM inventory_movements WHERE tenant_id = ${context.tenantId} AND idempotency_key = ${idempotencyKey})
      `),
      db.run(sql`        INSERT INTO s06_outbox (id, tenant_id, event_id, topic, status, attempts, created_at, updated_at)
        SELECT ${crypto.randomUUID()}, ${context.tenantId}, ${eventId}, ${`zerow.${eventType}`}, 'PENDING_EXTERNAL_CONSUMER', 0, ${now}, ${now}
        WHERE EXISTS (SELECT 1 FROM s06_events WHERE tenant_id = ${context.tenantId} AND event_id = ${eventId})
      `),
      db.run(sql`        INSERT INTO s06_reconciliations
          (id, tenant_id, aggregate_type, aggregate_id, expected_version, observed_version, status, detail, created_at, updated_at)
        SELECT ${crypto.randomUUID()}, ${context.tenantId}, 'inventory.item', ${itemId}, ${nextVersion}, ${nextVersion},
          'SITES_READBACK_VERIFIED', 'Movimento e saldo magazzino riletti su D1; outbox esterna in attesa consumer.', ${now}, ${now}
        WHERE EXISTS (SELECT 1 FROM s06_events WHERE tenant_id = ${context.tenantId} AND event_id = ${eventId})
      `),
    ]);
    const updated = (results[0] as (typeof inventoryItems.$inferSelect)[])[0];
    if (!updated) return Response.json({ error: "version_conflict", currentVersion: current.version }, { status: 409 });

    const [committedMovement, committedEvent] = await Promise.all([
      db.select().from(inventoryMovements).where(and(
        eq(inventoryMovements.tenantId, context.tenantId),
        eq(inventoryMovements.idempotencyKey, idempotencyKey),
      )).limit(1),
      db.select({ eventId: s06Events.eventId }).from(s06Events).where(and(
        eq(s06Events.tenantId, context.tenantId),
        eq(s06Events.eventId, eventId),
      )).limit(1),
    ]);
    if (!committedMovement[0] || !committedEvent[0]) {
      return Response.json({ error: "inventory_movement_readback_unavailable" }, { status: 503 });
    }

    const readback = await inventoryReadback(context.tenantId, { itemId, warehouseId: requestedWarehouseId, allowedWarehouseIds: access.allowedWarehouseIds });
    return Response.json({ ...readback, movement: inventoryMovementForResponse(committedMovement[0]), idempotent: false, eventId }, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof CanonicalCodeConflictError) return Response.json({ error: error.code }, { status: 409 });
    const message = error instanceof Error ? error.message : "";
    if (/inventory_items_tenant_warehouse_barcode_uq|inventory_items_tenant_barcode_uq/.test(message)) return Response.json({ error: "inventory_barcode_already_registered_in_warehouse" }, { status: 409 });
    if (/inventory_items_tenant_qr_code_uq/.test(message)) return Response.json({ error: "inventory_qr_already_registered" }, { status: 409 });
    if (/unique|constraint/i.test(message)) return Response.json({ error: "inventory_idempotency_or_version_conflict" }, { status: 409 });
    return Response.json({ error: "inventory_write_unavailable" }, { status: 503 });
  }
}
