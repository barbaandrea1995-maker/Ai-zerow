import { and, desc, eq, exists, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { geofences, inventoryItems, inventoryMovements, jobJourneyRecords, jobStockBalances, jobStockMovements, jobStockRegisters, s04Records, s06Events, s06Outbox, s06Reconciliations, tenantWarehouses } from "@/db/schema";
import { getAuthorityContext, hasCapability } from "@/lib/authority-context";
import { isActorAssignedToJob } from "@/lib/attendance-scope";
import { milliToQuantity, quantityToMilli } from "@/lib/inventory-contract";
import { materialFulfillmentLines } from "@/lib/material-fulfillment";
import { evaluateAttendanceGeofence } from "@/lib/location-intelligence/attendance-policy";
import { geofenceForEngine } from "@/lib/location-intelligence/repository";
import { ensureJobStockSchema } from "@/lib/job-stock-schema.server";

export const dynamic = "force-dynamic";

type JsonObject = Record<string, unknown>;
type RouteContext = { params: Promise<{ jobId: string }> };
type JourneyBatchItem = {
  _prepare(): {
    getQuery(): { sql: string; params: unknown[] };
    mapResult(result: unknown, isFromBatch?: boolean): unknown;
  };
};

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function boundedText(value: unknown, max: number, fallback = "") {
  return typeof value === "string" ? value.trim().slice(0, max) : fallback;
}

function parseJson(value: string): JsonObject {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function sanitizeLocation(value: unknown) {
  if (!isRecord(value)) return null;
  const lat = Number(value.lat);
  const lon = Number(value.lon);
  const accuracyM = Number(value.accuracyM);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return {
    lat: Math.round(lat * 100_000) / 100_000,
    lon: Math.round(lon * 100_000) / 100_000,
    accuracyM: Number.isFinite(accuracyM) && accuracyM >= 0 ? Math.min(10_000, Math.round(accuracyM * 10) / 10) : null,
    policy: "ON_DEMAND_PICKUP_ONLY",
    precision: "5_DECIMAL_PLACES",
  };
}

function itemStatus(onHandMilli: number, reservedMilli: number, minimumMilli: number) {
  if (onHandMilli <= 0) return "OUT_OF_STOCK";
  return onHandMilli - reservedMilli < minimumMilli ? "LOW_STOCK" : "ACTIVE";
}

async function runBatch(db: ReturnType<typeof getDb>, items: readonly unknown[]) {
  const prepared = items.map((item) => (item as JourneyBatchItem)._prepare());
  const statements = prepared.map((query) => {
    const built = query.getQuery();
    return db.$client.prepare(built.sql).bind(...built.params);
  });
  const results = await db.$client.batch(statements);
  return results.map((result, index) => prepared[index].mapResult(result, true));
}

function responseRecord(row: typeof jobJourneyRecords.$inferSelect) {
  return { id: row.id, jobId: row.jobId, status: row.status, version: row.version, payload: parseJson(row.payloadJson), createdAt: row.createdAt };
}

export async function POST(request: Request, routeContext: RouteContext) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "warehouse.self_pickup")) {
    return Response.json({ error: "forbidden", capability: "warehouse.self_pickup" }, { status: 403 });
  }
  const { jobId: jobReference } = await routeContext.params;
  if (!jobReference || jobReference.length > 160) return Response.json({ error: "invalid_job_id" }, { status: 400 });
  let input: JsonObject;
  try {
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > 12_000) return Response.json({ error: "payload_too_large" }, { status: 413 });
    const parsed = await request.json() as unknown;
    if (!isRecord(parsed)) return Response.json({ error: "invalid_json" }, { status: 400 });
    input = parsed;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const requestId = boundedText(input.requestId, 160);
  const lineId = boundedText(input.lineId, 80);
  const itemId = boundedText(input.itemId, 120);
  if (typeof input.idempotencyKey === "string" && input.idempotencyKey.trim().length > 120) {
    return Response.json({ error: "material_pickup_idempotency_key_invalid" }, { status: 400 });
  }
  const idempotencyKey = boundedText(input.idempotencyKey, 120);
  const quantityMilli = quantityToMilli(input.quantity);
  if (!requestId || !lineId || !itemId || quantityMilli === null) return Response.json({ error: "material_pickup_fields_required" }, { status: 400 });
  if (idempotencyKey.length < 8 || !/^[a-zA-Z0-9:_-]+$/.test(idempotencyKey)) return Response.json({ error: "material_pickup_idempotency_key_required" }, { status: 400 });
  const location = sanitizeLocation(input.location);
  if (!location) return Response.json({ error: "location_required_for_material_pickup" }, { status: 400 });

  try {
    await ensureJobStockSchema();
    const db = getDb();
    const [job] = await db.select().from(s04Records).where(and(
      eq(s04Records.tenantId, context.tenantId),
      eq(s04Records.id, jobReference),
      eq(s04Records.module, "operations"),
    )).limit(1);
    if (!job || job.recordType === "adapter-contract") return Response.json({ error: "job_not_found" }, { status: 404 });
    const jobStockRegisterId = `job-stock:${job.id}`;
    const [planningRows, workforceRows, missionRows, requestRow, stockRegisterRows] = await Promise.all([
      db.select().from(jobJourneyRecords).where(and(
        eq(jobJourneyRecords.tenantId, context.tenantId),
        eq(jobJourneyRecords.jobId, job.id),
        eq(jobJourneyRecords.domain, "planning"),
      )).orderBy(desc(jobJourneyRecords.updatedAt)).limit(500),
      db.select().from(s04Records).where(and(
        eq(s04Records.tenantId, context.tenantId),
        eq(s04Records.module, "workforce"),
      )).limit(500),
      db.select().from(jobJourneyRecords).where(and(
        eq(jobJourneyRecords.tenantId, context.tenantId),
        eq(jobJourneyRecords.jobId, job.id),
        eq(jobJourneyRecords.domain, "mission"),
        eq(jobJourneyRecords.recordType, "TRANSPORT"),
        inArray(jobJourneyRecords.status, ["PLANNED", "DISPATCHED"]),
      )).orderBy(desc(jobJourneyRecords.updatedAt)).limit(500),
      db.select().from(jobJourneyRecords).where(and(
        eq(jobJourneyRecords.tenantId, context.tenantId),
        eq(jobJourneyRecords.jobId, job.id),
        eq(jobJourneyRecords.id, requestId),
        eq(jobJourneyRecords.domain, "warehouse"),
        eq(jobJourneyRecords.recordType, "MATERIAL_REQUEST"),
      )).limit(1),
      db.select().from(jobStockRegisters).where(and(
        eq(jobStockRegisters.tenantId, context.tenantId),
        eq(jobStockRegisters.jobId, job.id),
        eq(jobStockRegisters.id, jobStockRegisterId),
        eq(jobStockRegisters.status, "ACTIVE"),
      )).limit(1),
    ]);
    if (!isActorAssignedToJob({ context, job, planningRows, workforceRows, missionRows })) {
      return Response.json({ error: "commessa_assignment_required_for_material_pickup" }, { status: 403 });
    }
    const requestRecord = requestRow[0];
    if (!requestRecord || requestRecord.status !== "APPROVED") return Response.json({ error: "approved_material_request_required" }, { status: 409 });
    const stockRegister = stockRegisterRows[0];
    if (!stockRegister) return Response.json({ error: "job_stock_register_not_provisioned" }, { status: 409 });
    const requestPayload = parseJson(requestRecord.payloadJson);
    const fulfillmentLines = materialFulfillmentLines(requestPayload);
    const fulfillment = fulfillmentLines?.find((line) => line.lineId === lineId && line.itemId === itemId);
    if (!fulfillment || fulfillment.directPickupMilli <= 0) {
      return Response.json({ error: "direct_pickup_not_allocated_for_line" }, { status: 409 });
    }

    const movementKey = `material-pickup:${idempotencyKey}`.slice(0, 160);
    const recordKey = `material-pickup-record:${idempotencyKey}`.slice(0, 160);
    const [existingEvent] = await db.select().from(s06Events).where(and(
      eq(s06Events.tenantId, context.tenantId),
      eq(s06Events.idempotencyKey, idempotencyKey),
    )).limit(1);
    if (existingEvent) {
      if (existingEvent.aggregateType !== "warehouse.material_pickup") return Response.json({ error: "material_pickup_idempotency_conflict" }, { status: 409 });
      const [existingPickup] = await db.select().from(jobJourneyRecords).where(and(
        eq(jobJourneyRecords.tenantId, context.tenantId),
        eq(jobJourneyRecords.jobId, job.id),
        eq(jobJourneyRecords.id, existingEvent.aggregateId),
        eq(jobJourneyRecords.recordType, "MATERIAL_PICKUP"),
      )).limit(1);
      const [existingMovement] = await db.select().from(inventoryMovements).where(and(
        eq(inventoryMovements.tenantId, context.tenantId),
        eq(inventoryMovements.idempotencyKey, movementKey),
      )).limit(1);
      const previousPayload = existingPickup ? parseJson(existingPickup.payloadJson) : {};
      if (!existingPickup || !existingMovement) return Response.json({ error: "material_pickup_idempotency_readback_unavailable" }, { status: 503 });
      const [existingJobStockMovement] = await db.select().from(jobStockMovements).where(and(
        eq(jobStockMovements.tenantId, context.tenantId),
        eq(jobStockMovements.registerId, stockRegister.id),
        eq(jobStockMovements.sourceType, "DIRECT_PICKUP"),
        eq(jobStockMovements.sourceId, existingMovement.id),
      )).limit(1);
      const [existingJobStockBalance] = await db.select().from(jobStockBalances).where(and(
        eq(jobStockBalances.tenantId, context.tenantId),
        eq(jobStockBalances.jobId, job.id),
        eq(jobStockBalances.inventoryItemId, itemId),
      )).limit(1);
      if (previousPayload.requestId !== requestRecord.id
        || previousPayload.lineId !== lineId
        || previousPayload.itemId !== itemId
        || Number(previousPayload.quantityMilli) !== quantityMilli
        || previousPayload.pickedBy !== context.actorId
        || existingEvent.aggregateId !== existingPickup.id
        || existingMovement.jobId !== job.id
        || existingMovement.itemId !== itemId
        || existingMovement.movementType !== "PICK"
        || existingMovement.missionId !== null
        || existingMovement.quantityMilli !== quantityMilli
        || existingMovement.actorId !== context.actorId
        || !existingJobStockMovement
        || existingJobStockMovement.quantityMilli !== quantityMilli
        || existingJobStockMovement.actorId !== context.actorId
        || !existingJobStockBalance) {
        return Response.json({ error: "material_pickup_idempotency_payload_conflict" }, { status: 409 });
      }
      return Response.json({
        pickup: responseRecord(existingPickup),
        movementId: existingMovement.id,
        eventId: existingEvent.eventId,
        jobStock: {
          registerId: stockRegister.id,
          movementId: existingJobStockMovement.id,
          balance: { itemId, onHandQuantity: milliToQuantity(existingJobStockBalance.onHandMilli), version: existingJobStockBalance.version },
        },
        idempotent: true,
        readback: { status: "verified" },
      }, { headers: { "cache-control": "private, no-store" } });
    }

    const warehouseValue = isRecord(requestPayload.warehouse) ? requestPayload.warehouse : {};
    const warehouseId = boundedText(requestPayload.warehouseId, 120) || boundedText(warehouseValue.id, 120);
    if (!warehouseId) return Response.json({ error: "fulfillment_warehouse_required" }, { status: 409 });
    const [warehouse, item] = await Promise.all([
      db.select().from(tenantWarehouses).where(and(
        eq(tenantWarehouses.tenantId, context.tenantId),
        eq(tenantWarehouses.id, warehouseId),
        eq(tenantWarehouses.status, "active"),
      )).limit(1),
      db.select().from(inventoryItems).where(and(
        eq(inventoryItems.tenantId, context.tenantId),
        eq(inventoryItems.id, itemId),
        eq(inventoryItems.warehouseId, warehouseId),
      )).limit(1),
    ]);
    const canonicalWarehouse = warehouse[0];
    const currentItem = item[0];
    if (!canonicalWarehouse) return Response.json({ error: "fulfillment_warehouse_not_found" }, { status: 409 });
    if (!currentItem) return Response.json({ error: "material_inventory_item_not_found" }, { status: 404 });

    const requestWarehouseRecord = await db.select().from(geofences).where(and(
      eq(geofences.tenantId, context.tenantId),
      eq(geofences.entityType, "MAGAZZINO"),
      eq(geofences.entityId, warehouseId),
      eq(geofences.status, "ACTIVE"),
    )).limit(1);
    const geofence = requestWarehouseRecord[0]
      ? geofenceForEngine(requestWarehouseRecord[0])
      : {
        id: `WAREHOUSE-GEOFENCE-${warehouseId}`,
        locationId: `WAREHOUSE-LOCATION-${warehouseId}`,
        entityType: "MAGAZZINO",
        entityId: warehouseId,
        name: canonicalWarehouse.name,
        shapeType: "CIRCLE" as const,
        center: { latitude: canonicalWarehouse.latitudeE6 / 1_000_000, longitude: canonicalWarehouse.longitudeE6 / 1_000_000 },
        radiusMeters: canonicalWarehouse.geofenceRadiusMeters,
        polygon: [],
      };
    const geofenceResult = evaluateAttendanceGeofence(location, geofence);
    if (geofenceResult.status !== "INSIDE") {
      return Response.json({ error: "warehouse_geofence_required", reason: "material_pickup_requires_inside_warehouse_geofence", geofence: geofenceResult }, { status: 409 });
    }

    const pickedReadback = await db.$client.prepare(`
      SELECT COALESCE(SUM(CAST(json_extract(payload_json, '$.quantityMilli') AS INTEGER)), 0) AS picked_milli
      FROM job_journey_records
      WHERE tenant_id = ? AND job_id = ? AND domain = 'warehouse' AND record_type = 'MATERIAL_PICKUP'
        AND json_extract(payload_json, '$.requestId') = ? AND json_extract(payload_json, '$.lineId') = ?
    `).bind(context.tenantId, job.id, requestRecord.id, fulfillment.lineId).first<{ picked_milli: number }>();
    const pickedMilli = Number(pickedReadback?.picked_milli ?? 0);
    if (!Number.isSafeInteger(pickedMilli) || pickedMilli < 0) return Response.json({ error: "material_pickup_ledger_readback_unavailable" }, { status: 503 });
    const remainingMilli = fulfillment.directPickupMilli - pickedMilli;
    if (remainingMilli <= 0) return Response.json({ error: "direct_pickup_already_complete" }, { status: 409 });
    if (quantityMilli > remainingMilli) return Response.json({ error: "pickup_exceeds_direct_allocation", remaining: milliToQuantity(remainingMilli) }, { status: 422 });
    if (currentItem.onHandMilli < quantityMilli || currentItem.reservedMilli < quantityMilli) {
      return Response.json({ error: "insufficient_reserved_physical_stock" }, { status: 409 });
    }

    const now = new Date().toISOString();
    const nextItemVersion = currentItem.version + 1;
    const nextJobStockRegisterVersion = stockRegister.version + 1;
    const nextOnHand = currentItem.onHandMilli - quantityMilli;
    const nextReserved = currentItem.reservedMilli - quantityMilli;
    const status = itemStatus(nextOnHand, nextReserved, currentItem.minStockMilli);
    const pickupRecordId = crypto.randomUUID();
    const movementId = crypto.randomUUID();
    const jobStockMovementId = crypto.randomUUID();
    const inventoryEventId = crypto.randomUUID();
    const pickupEventId = crypto.randomUUID();
    const jobStockEventId = crypto.randomUUID();
    const jobStockMovementKey = `job-stock:material-pickup:${idempotencyKey}`.slice(0, 160);
    const jobStockEventKey = `job-stock:event:${idempotencyKey}`.slice(0, 160);
    const locationEvidence = { ...location, geofence: geofenceResult };
    const directRemainingAfter = remainingMilli - quantityMilli;
    const pickupPayload = {
      requestId: requestRecord.id,
      lineId: fulfillment.lineId,
      itemId,
      item: { sku: currentItem.sku, name: currentItem.name, unit: currentItem.unit },
      warehouseId,
      quantityMilli,
      fulfillmentMode: "DIRECT_PICKUP",
      pickedBy: context.actorId,
      recordedAt: now,
      location: locationEvidence,
      stock: { onHandBeforeMilli: currentItem.onHandMilli, onHandAfterMilli: nextOnHand, reservedBeforeMilli: currentItem.reservedMilli, reservedAfterMilli: nextReserved },
      remainingDirectAllocationMilli: directRemainingAfter,
      movementId,
      jobStockMovementId,
    };
    const inventoryEventPayload = JSON.stringify({
      action: "PICK",
      fulfillmentMode: "DIRECT_PICKUP",
      itemId,
      jobId: job.id,
      requestId: requestRecord.id,
      pickupRecordId,
      warehouseId,
      quantityMilli,
      actorId: context.actorId,
      geofence: geofenceResult,
      version: nextItemVersion,
    });
    const jobStockEventPayload = JSON.stringify({
      action: "TRANSFER_IN",
      sourceType: "DIRECT_PICKUP",
      registerId: stockRegister.id,
      jobId: job.id,
      requestId: requestRecord.id,
      pickupRecordId,
      inventoryMovementId: movementId,
      jobStockMovementId,
      itemId,
      warehouseId,
      quantityMilli,
      actorId: context.actorId,
      version: 1,
      registerVersion: nextJobStockRegisterVersion,
    });
    const correlationId = crypto.randomUUID();
    const results = await runBatch(db, [
      db.update(inventoryItems).set({
        onHandMilli: nextOnHand,
        reservedMilli: nextReserved,
        status,
        version: nextItemVersion,
        updatedAt: now,
      }).where(and(
        eq(inventoryItems.tenantId, context.tenantId),
        eq(inventoryItems.id, itemId),
        eq(inventoryItems.warehouseId, warehouseId),
        eq(inventoryItems.version, currentItem.version),
        sql`${inventoryItems.onHandMilli} >= ${quantityMilli}`,
        sql`${inventoryItems.reservedMilli} >= ${quantityMilli}`,
        exists(db.select({ id: jobJourneyRecords.id }).from(jobJourneyRecords).where(and(
          eq(jobJourneyRecords.tenantId, context.tenantId),
          eq(jobJourneyRecords.id, requestRecord.id),
          eq(jobJourneyRecords.status, "APPROVED"),
        ))),
      )).returning() as never,
      db.run(sql`
        INSERT INTO inventory_movements
          (id, tenant_id, item_id, job_id, mission_id, movement_type, quantity_milli,
           before_on_hand_milli, after_on_hand_milli, before_reserved_milli, after_reserved_milli,
           note, idempotency_key, actor_id, created_at)
        SELECT ${movementId}, ${context.tenantId}, ${itemId}, ${job.id}, NULL, 'PICK', ${quantityMilli},
          ${currentItem.onHandMilli}, ${nextOnHand}, ${currentItem.reservedMilli}, ${nextReserved},
          ${`Ritiro diretto richiesta ${requestRecord.id} · ${currentItem.name}`}, ${movementKey}, ${context.actorId}, ${now}
        WHERE changes() = 1
      `) as never,
      db.run(sql`
        INSERT INTO job_journey_records
          (id, tenant_id, job_id, domain, record_type, title, status, version, payload_json,
           idempotency_key, created_by, updated_by, created_at, updated_at)
        SELECT ${pickupRecordId}, ${context.tenantId}, ${job.id}, 'warehouse', 'MATERIAL_PICKUP',
          ${`Ritiro materiali · ${currentItem.name}`}, ${directRemainingAfter === 0 ? "PICKED_UP" : "PARTIAL_PICKUP"}, 1,
          ${JSON.stringify(pickupPayload)}, ${recordKey}, ${context.actorId}, ${context.actorId}, ${now}, ${now}
        WHERE EXISTS (SELECT 1 FROM inventory_movements WHERE tenant_id = ${context.tenantId} AND idempotency_key = ${movementKey})
      `) as never,
      db.run(sql`
        INSERT INTO job_stock_movements
          (id, tenant_id, register_id, job_id, inventory_item_id, warehouse_id, mission_id,
           movement_type, quantity_milli, source_type, source_id, note, idempotency_key, actor_id, created_at)
        SELECT ${jobStockMovementId}, ${context.tenantId}, ${stockRegister.id}, ${job.id}, ${itemId}, ${warehouseId}, NULL,
          'TRANSFER_IN', ${quantityMilli}, 'DIRECT_PICKUP', ${movementId},
          ${`Carico in commessa da ritiro diretto · ${requestRecord.id} · ${currentItem.name}`},
          ${jobStockMovementKey}, ${context.actorId}, ${now}
        WHERE EXISTS (
          SELECT 1 FROM inventory_movements
          WHERE tenant_id = ${context.tenantId} AND id = ${movementId} AND idempotency_key = ${movementKey}
        ) AND EXISTS (
          SELECT 1 FROM job_stock_registers
          WHERE tenant_id = ${context.tenantId} AND id = ${stockRegister.id} AND job_id = ${job.id} AND status = 'ACTIVE'
        )
      `) as never,
      db.run(sql`
        INSERT INTO job_stock_balances
          (id, tenant_id, register_id, job_id, inventory_item_id, sku, name, unit,
           on_hand_milli, version, created_at, updated_at)
        SELECT ${`job-stock-balance:${job.id}:${itemId}`}, ${context.tenantId}, ${stockRegister.id}, ${job.id}, ${itemId},
          ${currentItem.sku}, ${currentItem.name}, ${currentItem.unit}, ${quantityMilli}, 1, ${now}, ${now}
        WHERE EXISTS (
          SELECT 1 FROM job_stock_movements
          WHERE tenant_id = ${context.tenantId} AND id = ${jobStockMovementId} AND idempotency_key = ${jobStockMovementKey}
        )
        ON CONFLICT(tenant_id, job_id, inventory_item_id) DO UPDATE SET
          register_id = excluded.register_id,
          sku = excluded.sku,
          name = excluded.name,
          unit = excluded.unit,
          on_hand_milli = job_stock_balances.on_hand_milli + excluded.on_hand_milli,
          version = job_stock_balances.version + 1,
          updated_at = excluded.updated_at
      `) as never,
      db.run(sql`
        INSERT INTO s06_events
          (event_id, tenant_id, event_type, schema_version, actor_type, actor_id, source,
           occurred_at, observed_at, aggregate_type, aggregate_id, aggregate_version, payload_json,
           correlation_id, causation_id, idempotency_key, status, created_at)
        SELECT ${jobStockEventId}, ${context.tenantId}, 'warehouse.job_stock.received', '1', 'human', ${context.actorId},
          'sites-warehouse-direct-pickup', ${now}, ${now}, 'job.stock.movement', ${jobStockMovementId}, 1,
          ${jobStockEventPayload}, ${correlationId}, ${inventoryEventId}, ${jobStockEventKey}, 'COMMITTED_SITES_READBACK', ${now}
        WHERE EXISTS (
          SELECT 1 FROM job_stock_movements
          WHERE tenant_id = ${context.tenantId} AND id = ${jobStockMovementId} AND idempotency_key = ${jobStockMovementKey}
        ) AND EXISTS (
          SELECT 1 FROM job_stock_balances
          WHERE tenant_id = ${context.tenantId} AND job_id = ${job.id} AND inventory_item_id = ${itemId}
        )
      `) as never,
      db.run(sql`
        INSERT INTO s06_outbox (id, tenant_id, event_id, topic, status, attempts, created_at, updated_at)
        SELECT ${crypto.randomUUID()}, ${context.tenantId}, ${jobStockEventId}, 'zerow.warehouse.job_stock.received',
          'PENDING_EXTERNAL_CONSUMER', 0, ${now}, ${now}
        WHERE EXISTS (SELECT 1 FROM s06_events WHERE tenant_id = ${context.tenantId} AND event_id = ${jobStockEventId})
      `) as never,
      db.run(sql`
        INSERT INTO s06_reconciliations
          (id, tenant_id, aggregate_type, aggregate_id, expected_version, observed_version, status, detail, created_at, updated_at)
        SELECT ${crypto.randomUUID()}, ${context.tenantId}, 'job.stock.movement', ${jobStockMovementId}, 1, 1,
          'SITES_READBACK_VERIFIED', 'Materiale ritirato dal deposito e accreditato al registro scorte della commessa.', ${now}, ${now}
        WHERE EXISTS (SELECT 1 FROM s06_events WHERE tenant_id = ${context.tenantId} AND event_id = ${jobStockEventId})
      `) as never,
      db.run(sql`
        INSERT INTO s06_events
          (event_id, tenant_id, event_type, schema_version, actor_type, actor_id, source,
           occurred_at, observed_at, aggregate_type, aggregate_id, aggregate_version, payload_json,
           correlation_id, causation_id, idempotency_key, status, created_at)
        SELECT ${inventoryEventId}, ${context.tenantId}, 'warehouse.inventory.pick', '1', 'human', ${context.actorId},
          'sites-warehouse-direct-pickup', ${now}, ${now}, 'inventory.item', ${itemId}, ${nextItemVersion},
          ${inventoryEventPayload}, ${correlationId}, NULL, ${movementKey}, 'COMMITTED_SITES_READBACK', ${now}
        WHERE EXISTS (SELECT 1 FROM inventory_movements WHERE tenant_id = ${context.tenantId} AND idempotency_key = ${movementKey})
      `) as never,
      db.run(sql`
        INSERT INTO s06_outbox (id, tenant_id, event_id, topic, status, attempts, created_at, updated_at)
        SELECT ${crypto.randomUUID()}, ${context.tenantId}, ${inventoryEventId}, 'zerow.warehouse.inventory.pick',
          'PENDING_EXTERNAL_CONSUMER', 0, ${now}, ${now}
        WHERE EXISTS (SELECT 1 FROM s06_events WHERE tenant_id = ${context.tenantId} AND event_id = ${inventoryEventId})
      `) as never,
      db.run(sql`
        INSERT INTO s06_reconciliations
          (id, tenant_id, aggregate_type, aggregate_id, expected_version, observed_version, status, detail, created_at, updated_at)
        SELECT ${crypto.randomUUID()}, ${context.tenantId}, 'inventory.item', ${itemId}, ${nextItemVersion}, ${nextItemVersion},
          'SITES_READBACK_VERIFIED', 'Ritiro diretto da richiesta approvata: saldo fisico e prenotazione scalati insieme.', ${now}, ${now}
        WHERE EXISTS (SELECT 1 FROM s06_events WHERE tenant_id = ${context.tenantId} AND event_id = ${inventoryEventId})
      `) as never,
      db.run(sql`
        INSERT INTO s06_events
          (event_id, tenant_id, event_type, schema_version, actor_type, actor_id, source,
           occurred_at, observed_at, aggregate_type, aggregate_id, aggregate_version, payload_json,
           correlation_id, causation_id, idempotency_key, status, created_at)
        SELECT ${pickupEventId}, ${context.tenantId}, 'warehouse.material_pickup.recorded', '1', 'human', ${context.actorId},
          'sites-warehouse-direct-pickup', ${now}, ${now}, 'warehouse.material_pickup', ${pickupRecordId}, 1,
          ${JSON.stringify({ requestId: requestRecord.id, jobId: job.id, lineId, itemId, warehouseId, quantityMilli, movementId, jobStockMovementId, geofence: geofenceResult })},
          ${correlationId}, ${inventoryEventId}, ${idempotencyKey}, 'COMMITTED_SITES_READBACK', ${now}
        WHERE EXISTS (SELECT 1 FROM job_journey_records WHERE tenant_id = ${context.tenantId} AND id = ${pickupRecordId} AND idempotency_key = ${recordKey})
      `) as never,
      db.run(sql`
        INSERT INTO s06_outbox (id, tenant_id, event_id, topic, status, attempts, created_at, updated_at)
        SELECT ${crypto.randomUUID()}, ${context.tenantId}, ${pickupEventId}, 'zerow.warehouse.material_pickup.recorded',
          'PENDING_EXTERNAL_CONSUMER', 0, ${now}, ${now}
        WHERE EXISTS (SELECT 1 FROM s06_events WHERE tenant_id = ${context.tenantId} AND event_id = ${pickupEventId})
      `) as never,
      db.run(sql`
        INSERT INTO s06_reconciliations
          (id, tenant_id, aggregate_type, aggregate_id, expected_version, observed_version, status, detail, created_at, updated_at)
        SELECT ${crypto.randomUUID()}, ${context.tenantId}, 'warehouse.material_pickup', ${pickupRecordId}, 1, 1,
          'SITES_READBACK_VERIFIED', 'Ritiro geolocalizzato collegato a richiesta approvata, operatore assegnato e movimento di magazzino.', ${now}, ${now}
        WHERE EXISTS (SELECT 1 FROM s06_events WHERE tenant_id = ${context.tenantId} AND event_id = ${pickupEventId})
      `) as never,
      // Keep this mutation after the raw INSERT that relies on SQLite's
      // changes() value from the inventory update. A stale register forces a
      // NOT NULL violation and rolls the entire D1 batch back atomically.
      db.update(jobStockRegisters).set({
        version: sql`CASE WHEN ${jobStockRegisters.version} = ${stockRegister.version} AND ${jobStockRegisters.status} = 'ACTIVE' THEN ${jobStockRegisters.version} + 1 ELSE NULL END`,
        updatedAt: now,
      }).where(and(
        eq(jobStockRegisters.tenantId, context.tenantId),
        eq(jobStockRegisters.id, stockRegister.id),
      )).returning() as never,
    ]);
    const updatedItem = (results[0] as (typeof inventoryItems.$inferSelect)[])[0];
    if (!updatedItem) return Response.json({ error: "material_pickup_stock_or_request_conflict" }, { status: 409 });

    const [pickupReadback, movementReadback, jobStockRegisterReadback, jobStockMovementReadback, jobStockBalanceReadback, inventoryEventReadback, pickupEventReadback, jobStockEventReadback, outboxReadback, reconciliationReadback] = await Promise.all([
      db.select().from(jobJourneyRecords).where(and(eq(jobJourneyRecords.tenantId, context.tenantId), eq(jobJourneyRecords.id, pickupRecordId))).limit(1),
      db.select().from(inventoryMovements).where(and(eq(inventoryMovements.tenantId, context.tenantId), eq(inventoryMovements.idempotencyKey, movementKey))).limit(1),
      db.select().from(jobStockRegisters).where(and(eq(jobStockRegisters.tenantId, context.tenantId), eq(jobStockRegisters.id, stockRegister.id))).limit(1),
      db.select().from(jobStockMovements).where(and(eq(jobStockMovements.tenantId, context.tenantId), eq(jobStockMovements.idempotencyKey, jobStockMovementKey))).limit(1),
      db.select().from(jobStockBalances).where(and(
        eq(jobStockBalances.tenantId, context.tenantId),
        eq(jobStockBalances.jobId, job.id),
        eq(jobStockBalances.inventoryItemId, itemId),
      )).limit(1),
      db.select().from(s06Events).where(and(eq(s06Events.tenantId, context.tenantId), eq(s06Events.eventId, inventoryEventId))).limit(1),
      db.select().from(s06Events).where(and(eq(s06Events.tenantId, context.tenantId), eq(s06Events.eventId, pickupEventId))).limit(1),
      db.select().from(s06Events).where(and(eq(s06Events.tenantId, context.tenantId), eq(s06Events.eventId, jobStockEventId))).limit(1),
      db.select().from(s06Outbox).where(and(eq(s06Outbox.tenantId, context.tenantId), inArray(s06Outbox.eventId, [inventoryEventId, pickupEventId, jobStockEventId]))),
      db.select().from(s06Reconciliations).where(and(eq(s06Reconciliations.tenantId, context.tenantId), inArray(s06Reconciliations.aggregateId, [itemId, pickupRecordId, jobStockMovementId]))),
    ]);
    const reconciled = new Set(reconciliationReadback.map((entry) => `${entry.aggregateType}:${entry.aggregateId}:${entry.status}`));
    const verified = Boolean(pickupReadback[0]
      && movementReadback[0]?.movementType === "PICK"
      && movementReadback[0]?.missionId === null
      && movementReadback[0]?.quantityMilli === quantityMilli
      && jobStockRegisterReadback[0]?.version === nextJobStockRegisterVersion
      && jobStockMovementReadback[0]?.registerId === stockRegister.id
      && jobStockMovementReadback[0]?.movementType === "TRANSFER_IN"
      && jobStockMovementReadback[0]?.sourceType === "DIRECT_PICKUP"
      && jobStockMovementReadback[0]?.sourceId === movementReadback[0]?.id
      && jobStockMovementReadback[0]?.quantityMilli === quantityMilli
      && jobStockBalanceReadback[0]?.registerId === stockRegister.id
      && (jobStockBalanceReadback[0]?.onHandMilli ?? -1) >= quantityMilli
      && inventoryEventReadback[0]
      && pickupEventReadback[0]
      && jobStockEventReadback[0]
      && outboxReadback.some((entry) => entry.eventId === inventoryEventId)
      && outboxReadback.some((entry) => entry.eventId === pickupEventId)
      && outboxReadback.some((entry) => entry.eventId === jobStockEventId)
      && reconciled.has(`inventory.item:${itemId}:SITES_READBACK_VERIFIED`)
      && reconciled.has(`warehouse.material_pickup:${pickupRecordId}:SITES_READBACK_VERIFIED`)
      && reconciled.has(`job.stock.movement:${jobStockMovementId}:SITES_READBACK_VERIFIED`));
    if (!verified) return Response.json({ error: "material_pickup_readback_unavailable" }, { status: 503 });

    return Response.json({
      pickup: responseRecord(pickupReadback[0]!),
      movementId: movementReadback[0]!.id,
      eventId: pickupEventId,
      geofence: geofenceResult,
      remainingDirectQuantity: milliToQuantity(directRemainingAfter),
      jobStock: {
        registerId: stockRegister.id,
        registerVersion: jobStockRegisterReadback[0]!.version,
        movementId: jobStockMovementReadback[0]!.id,
        balance: {
          itemId,
          sku: jobStockBalanceReadback[0]!.sku,
          name: jobStockBalanceReadback[0]!.name,
          unit: jobStockBalanceReadback[0]!.unit,
          onHandQuantity: milliToQuantity(jobStockBalanceReadback[0]!.onHandMilli),
          version: jobStockBalanceReadback[0]!.version,
        },
      },
      readback: { status: "verified", scope: "tenant", checkedAt: now },
    }, { status: 201, headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/unique|constraint/i.test(message)) return Response.json({ error: "material_pickup_idempotency_or_version_conflict" }, { status: 409 });
    return Response.json({ error: "material_pickup_write_unavailable" }, { status: 503 });
  }
}
