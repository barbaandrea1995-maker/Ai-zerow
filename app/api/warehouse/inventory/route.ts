import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  inventoryItems,
  inventoryMovements,
  jobJourneyRecords,
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
} from "@/lib/inventory-contract";
import { allocateServerName, CanonicalCodeConflictError } from "@/lib/server-naming";

export const dynamic = "force-dynamic";

type JsonObject = Record<string, unknown>;

const MUTATION_ACTIONS = {
  receive: "RECEIVE",
  reserve: "RESERVE",
  release: "RELEASE",
  pick: "PICK",
  load: "LOAD",
  consume: "CONSUME",
  return: "RETURN",
  adjust: "ADJUST",
} as const satisfies Record<string, InventoryMovementType>;

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function boundedText(value: unknown, max: number, fallback = "") {
  return typeof value === "string" ? value.trim().slice(0, max) : fallback;
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

async function inventoryReadback(tenantId: string, filters: { itemId?: string; jobId?: string } = {}) {
  const db = getDb();
  const itemConditions = [eq(inventoryItems.tenantId, tenantId)];
  if (filters.itemId) itemConditions.push(eq(inventoryItems.id, filters.itemId));
  const movementConditions = [eq(inventoryMovements.tenantId, tenantId)];
  if (filters.itemId) movementConditions.push(eq(inventoryMovements.itemId, filters.itemId));
  if (filters.jobId) movementConditions.push(eq(inventoryMovements.jobId, filters.jobId));

  const [items, movements] = await Promise.all([
    db.select().from(inventoryItems)
      .where(and(...itemConditions))
      .orderBy(desc(inventoryItems.updatedAt))
      .limit(500),
    db.select().from(inventoryMovements)
      .where(and(...movementConditions))
      .orderBy(desc(inventoryMovements.createdAt))
      .limit(250),
  ]);
  return {
    items: items.map(inventoryItemForResponse),
    movements: movements.map(inventoryMovementForResponse),
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
  const [mission] = await getDb().select({ id: jobJourneyRecords.id, status: jobJourneyRecords.status })
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
  try {
    return Response.json({
      context: publicAuthorityContext(context),
      ...(await inventoryReadback(context.tenantId, { itemId: itemId || undefined, jobId: jobId || undefined })),
      readback: { status: "verified", scope: "tenant", checkedAt: new Date().toISOString() },
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
  const idempotencyKey = boundedText(input.idempotencyKey, 160);
  if (typeof input.idempotencyKey === "string" && input.idempotencyKey.trim().length > 160) {
    return Response.json({ error: "idempotency_key_too_long" }, { status: 400 });
  }
  if (idempotencyKey.length < 8) return Response.json({ error: "idempotency_key_required" }, { status: 400 });
  if (action === "register_item" && !hasCapability(context, "warehouse.register")) {
    return Response.json({ error: "forbidden", capability: "warehouse.register" }, { status: 403 });
  }

  try {
    const db = getDb();
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
        ...(await inventoryReadback(context.tenantId, { itemId: movement.itemId })),
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
      const requestedSku = boundedText(input.sku, 64).toUpperCase();
      const openingMilli = quantityToMilli(input.openingQuantity ?? 0, { allowZero: true });
      const minStockMilli = quantityToMilli(input.minStock ?? 0, { allowZero: true });
      if (name.length < 2) return Response.json({ error: "item_name_required" }, { status: 400 });
      if (!unit) return Response.json({ error: "unit_must_be_selected_from_catalog" }, { status: 400 });
      if (!warehouseId) return Response.json({ error: "warehouse_required" }, { status: 400 });
      if (openingMilli === null || minStockMilli === null) return Response.json({ error: "invalid_stock_quantity" }, { status: 400 });
      if (requestedSku && !/^[A-Z0-9][A-Z0-9._-]{1,63}$/.test(requestedSku)) {
        return Response.json({ error: "invalid_sku" }, { status: 400 });
      }
      const [warehouse] = await db.select().from(tenantWarehouses).where(and(
        eq(tenantWarehouses.tenantId, context.tenantId),
        eq(tenantWarehouses.id, warehouseId),
        eq(tenantWarehouses.status, "active"),
      )).limit(1);
      if (!warehouse) return Response.json({ error: "warehouse_not_found_or_inactive" }, { status: 404 });

      const naming = requestedSku ? null : await allocateServerName({
        tenantId: context.tenantId,
        module: "warehouse",
        description: name,
      });
      const sku = requestedSku || naming?.canonicalCode;
      if (!sku) return Response.json({ error: "sku_unavailable" }, { status: 503 });
      const itemId = crypto.randomUUID();
      const status = itemStatus(openingMilli, 0, minStockMilli);
      const eventPayload = JSON.stringify({ action, sku, name, unit: unit.code, warehouseId, warehouseCode: warehouse.code, openingQuantityMilli: openingMilli, version: 1 });

      await db.batch([
        db.insert(inventoryItems).values({
          id: itemId,
          tenantId: context.tenantId,
          sku,
          name,
          unit: unit.code,
          warehouseId,
          location: warehouse.code,
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

      const readback = await inventoryReadback(context.tenantId, { itemId });
      return Response.json({ ...readback, movement: readback.movements[0], idempotent: false, eventId }, {
        status: 201,
        headers: { "cache-control": "private, no-store" },
      });
    }

    if (!(action in MUTATION_ACTIONS)) {
      return Response.json({ error: "unsupported_inventory_action", allowed: ["register_item", ...Object.keys(MUTATION_ACTIONS)] }, { status: 400 });
    }
    const movementType = MUTATION_ACTIONS[action as keyof typeof MUTATION_ACTIONS];
    const itemId = boundedText(input.itemId, 120);
    const jobReference = boundedText(input.jobId, 160);
    const missionId = boundedText(input.missionId, 160);
    const expectedVersion = typeof input.expectedVersion === "number" && Number.isInteger(input.expectedVersion)
      ? input.expectedVersion
      : null;
    if (!itemId) return Response.json({ error: "item_id_required" }, { status: 400 });
    if (expectedVersion === null || expectedVersion < 1) return Response.json({ error: "expected_version_required" }, { status: 400 });

    const quantityMilli = quantityToMilli(input.quantity, { allowNegative: movementType === "ADJUST" });
    if (quantityMilli === null) return Response.json({ error: "valid_quantity_required" }, { status: 400 });
    const needsJob = ["RESERVE", "RELEASE", "PICK", "LOAD", "CONSUME", "RETURN"].includes(movementType);
    if (needsJob && !jobReference) return Response.json({ error: "job_id_required" }, { status: 400 });
    const job = jobReference ? await requireJob(context.tenantId, jobReference) : null;
    if (jobReference && !job) return Response.json({ error: "job_not_found" }, { status: 404 });
    const canonicalJobId = job?.id ?? null;
    if (movementType === "LOAD") {
      if (!missionId) return Response.json({ error: "mission_id_required" }, { status: 400 });
      const mission = canonicalJobId ? await requireMission(context.tenantId, canonicalJobId, missionId) : null;
      if (!mission) {
        return Response.json({ error: "mission_not_found" }, { status: 404 });
      }
      if (mission.status !== "PLANNED") return Response.json({ error: "mission_not_loadable", status: mission.status }, { status: 409 });
    }

    const [current] = await db.select().from(inventoryItems).where(and(
      eq(inventoryItems.tenantId, context.tenantId),
      eq(inventoryItems.id, itemId),
    )).limit(1);
    if (!current) return Response.json({ error: "inventory_item_not_found" }, { status: 404 });
    if (current.version !== expectedVersion) {
      return Response.json({ error: "version_conflict", expectedVersion, currentVersion: current.version }, { status: 409 });
    }

    const linkedMovements = canonicalJobId ? await db.select().from(inventoryMovements).where(and(
      eq(inventoryMovements.tenantId, context.tenantId),
      eq(inventoryMovements.itemId, itemId),
      eq(inventoryMovements.jobId, canonicalJobId),
    )) : [];
    const moved = (type: InventoryMovementType) => linkedMovements
      .filter((movement) => movement.movementType === type)
      .reduce((total, movement) => total + Math.abs(movement.quantityMilli), 0);

    let nextOnHand = current.onHandMilli;
    let nextReserved = current.reservedMilli;
    const available = current.onHandMilli - current.reservedMilli;
    if (movementType === "RECEIVE") nextOnHand += quantityMilli;
    else if (movementType === "RESERVE") {
      if (available < quantityMilli) return Response.json({ error: "insufficient_available_stock" }, { status: 422 });
      nextReserved += quantityMilli;
    } else if (movementType === "RELEASE") {
      if (current.reservedMilli < quantityMilli) return Response.json({ error: "insufficient_reserved_stock" }, { status: 422 });
      nextReserved -= quantityMilli;
    } else if (movementType === "PICK") {
      if (current.reservedMilli < quantityMilli) return Response.json({ error: "insufficient_reserved_stock" }, { status: 422 });
      if (current.onHandMilli < quantityMilli) return Response.json({ error: "insufficient_physical_stock" }, { status: 422 });
      nextOnHand -= quantityMilli;
      nextReserved -= quantityMilli;
    } else if (movementType === "LOAD") {
      if (moved("LOAD") + quantityMilli > moved("PICK")) {
        return Response.json({ error: "load_exceeds_picked_stock" }, { status: 422 });
      }
    } else if (movementType === "CONSUME") {
      if (moved("CONSUME") + moved("RETURN") + quantityMilli > moved("PICK")) {
        return Response.json({ error: "consumption_exceeds_picked_stock" }, { status: 422 });
      }
    } else if (movementType === "RETURN") {
      if (moved("RETURN") + moved("CONSUME") + quantityMilli > moved("PICK")) {
        return Response.json({ error: "return_exceeds_unconsumed_stock" }, { status: 422 });
      }
      nextOnHand += quantityMilli;
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
      sku: current.sku,
      quantityMilli,
      jobId: canonicalJobId,
      missionId: missionId || null,
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
      )).returning(),
      db.insert(inventoryMovements).values({
        id: movementId,
        tenantId: context.tenantId,
        itemId,
        jobId: canonicalJobId,
        missionId: missionId || null,
        movementType,
        quantityMilli,
        beforeOnHandMilli: current.onHandMilli,
        afterOnHandMilli: nextOnHand,
        beforeReservedMilli: current.reservedMilli,
        afterReservedMilli: nextReserved,
        note: boundedText(input.note, 500),
        idempotencyKey,
        actorId: context.actorId,
        createdAt: now,
      }),
      db.insert(s06Events).values({
        eventId,
        tenantId: context.tenantId,
        eventType,
        schemaVersion: "1",
        actorType: "human",
        actorId: context.actorId,
        source: "sites-warehouse",
        occurredAt: now,
        observedAt: now,
        aggregateType: "inventory.item",
        aggregateId: itemId,
        aggregateVersion: nextVersion,
        payloadJson: eventPayload,
        correlationId: crypto.randomUUID(),
        causationId: null,
        idempotencyKey,
        status: "COMMITTED_SITES_READBACK",
        createdAt: now,
      }),
      db.insert(s06Outbox).values({
        id: crypto.randomUUID(), tenantId: context.tenantId, eventId,
        topic: `zerow.${eventType}`, status: "PENDING_EXTERNAL_CONSUMER",
        attempts: 0, createdAt: now, updatedAt: now,
      }),
      db.insert(s06Reconciliations).values({
        id: crypto.randomUUID(), tenantId: context.tenantId,
        aggregateType: "inventory.item", aggregateId: itemId,
        expectedVersion: nextVersion, observedVersion: nextVersion,
        status: "SITES_READBACK_VERIFIED",
        detail: "Movimento e saldo magazzino riletti su D1; outbox esterna in attesa consumer.",
        createdAt: now, updatedAt: now,
      }),
    ]);
    const updated = (results[0] as (typeof inventoryItems.$inferSelect)[])[0];
    if (!updated) return Response.json({ error: "version_conflict", currentVersion: current.version }, { status: 409 });

    const readback = await inventoryReadback(context.tenantId, { itemId });
    return Response.json({ ...readback, movement: readback.movements[0], idempotent: false, eventId }, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof CanonicalCodeConflictError) return Response.json({ error: error.code }, { status: 409 });
    const message = error instanceof Error ? error.message : "";
    if (/unique|constraint/i.test(message)) return Response.json({ error: "inventory_idempotency_or_version_conflict" }, { status: 409 });
    return Response.json({ error: "inventory_write_unavailable" }, { status: 503 });
  }
}
