import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { getDb } from "@/db";
import { jobJourneyRecords, jobStockBalances, jobStockMovements, jobStockRegisters, s04Records, s06Events, s06Outbox, s06Reconciliations } from "@/db/schema";
import { getAuthorityContext, hasCapability } from "@/lib/authority-context";
import { inventoryUnitForCode, milliToQuantity, quantityToMilli } from "@/lib/inventory-contract";
import { italyDateKey } from "@/lib/operations-contract";
import { canReadAllOperations, rowMatchesContext, teamScopeTokens } from "@/lib/operational-scope";
import { ensureJobStockSchema } from "@/lib/job-stock-schema.server";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ jobId: string }> };
type JsonObject = Record<string, unknown>;

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseJson(value: string): JsonObject {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function boundedText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function reconciliationForResponse(row: typeof jobJourneyRecords.$inferSelect) {
  const payload = parseJson(row.payloadJson);
  return {
    id: row.id,
    status: row.status,
    version: row.version,
    reportDate: boundedText(payload.reportDate, 10),
    confirmedAt: boundedText(payload.confirmedAt, 40),
    confirmedBy: boundedText(payload.confirmedBy, 160),
    lines: Array.isArray(payload.lines) ? payload.lines.filter(isRecord).map((line) => ({
      inventoryItemId: boundedText(line.inventoryItemId, 160),
      sku: boundedText(line.sku, 120),
      name: boundedText(line.name, 240),
      unit: boundedText(line.unit, 24),
      before: milliToQuantity(Number(line.beforeMilli) || 0),
      consumed: milliToQuantity(Number(line.consumedMilli) || 0),
      remaining: milliToQuantity(Number(line.remainingMilli) || 0),
    })) : [],
    createdAt: row.createdAt,
  };
}

async function routeJobReference(routeContext: RouteContext) {
  try {
    const value = decodeURIComponent((await routeContext.params).jobId).trim();
    return value && value.length <= 160 ? value : null;
  } catch {
    return null;
  }
}

async function findJob(tenantId: string, reference: string) {
  const db = getDb();
  const [byId] = await db.select().from(s04Records).where(and(
    eq(s04Records.tenantId, tenantId),
    eq(s04Records.module, "operations"),
    eq(s04Records.recordType, "job"),
    eq(s04Records.id, reference),
  )).limit(1);
  if (byId) return byId;
  const [byCode] = await db.select().from(s04Records).where(and(
    eq(s04Records.tenantId, tenantId),
    eq(s04Records.module, "operations"),
    eq(s04Records.recordType, "job"),
    eq(s04Records.canonicalCode, reference),
  )).limit(1);
  return byCode ?? null;
}

async function canAccessJob(
  context: NonNullable<Awaited<ReturnType<typeof getAuthorityContext>>>,
  job: typeof s04Records.$inferSelect,
) {
  if (canReadAllOperations(context)) return true;
  const workforceRows = await getDb().select().from(s04Records).where(and(
    eq(s04Records.tenantId, context.tenantId),
    eq(s04Records.module, "workforce"),
  )).limit(500);
  return rowMatchesContext(job, context, teamScopeTokens(workforceRows, context));
}

export async function GET(_request: Request, routeContext: RouteContext) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "warehouse.read")) {
    return Response.json({ error: "forbidden", capability: "warehouse.read" }, { status: 403 });
  }
  const reference = await routeJobReference(routeContext);
  if (!reference) return Response.json({ error: "invalid_job_id" }, { status: 400 });

  try {
    await ensureJobStockSchema();
    const db = getDb();
    const job = await findJob(context.tenantId, reference);
    if (!job) return Response.json({ error: "job_not_found" }, { status: 404 });
    if (!(await canAccessJob(context, job))) return Response.json({ error: "job_not_found" }, { status: 404 });

    const [register] = await db.select().from(jobStockRegisters).where(and(
      eq(jobStockRegisters.tenantId, context.tenantId),
      eq(jobStockRegisters.jobId, job.id),
    )).limit(1);
    if (!register) {
      return Response.json({ error: "job_stock_register_not_provisioned" }, {
        status: 409,
        headers: { "cache-control": "private, no-store" },
      });
    }

    const [balances, movements, materialRecords] = await Promise.all([
      db.select().from(jobStockBalances).where(and(
        eq(jobStockBalances.tenantId, context.tenantId),
        eq(jobStockBalances.registerId, register.id),
        eq(jobStockBalances.jobId, job.id),
      )).orderBy(desc(jobStockBalances.updatedAt)).limit(500),
      db.select().from(jobStockMovements).where(and(
        eq(jobStockMovements.tenantId, context.tenantId),
        eq(jobStockMovements.registerId, register.id),
        eq(jobStockMovements.jobId, job.id),
      )).orderBy(desc(jobStockMovements.createdAt)).limit(250),
      db.select().from(jobJourneyRecords).where(and(
        eq(jobJourneyRecords.tenantId, context.tenantId),
        eq(jobJourneyRecords.jobId, job.id),
        eq(jobJourneyRecords.domain, "warehouse"),
        eq(jobJourneyRecords.recordType, "MATERIAL_MOVEMENT"),
      )).orderBy(desc(jobJourneyRecords.createdAt)).limit(100),
    ]);

    const shiftReconciliations = materialRecords.filter((row) => parseJson(row.payloadJson).kind === "SHIFT_RECONCILIATION");
    const reportDate = italyDateKey();
    const todayReconciliation = shiftReconciliations.find((row) => {
      const payload = parseJson(row.payloadJson);
      return boundedText(payload.reportDate, 10) === reportDate
        && Number(payload.registerVersionAfter) === register.version;
    }) ?? null;

    const verified = register.tenantId === context.tenantId
      && register.jobId === job.id
      && balances.every((row) => row.tenantId === context.tenantId && row.registerId === register.id && row.jobId === job.id)
      && movements.every((row) => row.tenantId === context.tenantId && row.registerId === register.id && row.jobId === job.id);
    if (!verified) return Response.json({ error: "job_stock_readback_unavailable" }, { status: 503 });

    return Response.json({
      job: { id: job.id, canonicalCode: job.canonicalCode, title: job.title },
      register: {
        id: register.id,
        jobId: register.jobId,
        jobCode: register.jobCode,
        status: register.status,
        version: register.version,
        openedAt: register.openedAt,
        closedAt: register.closedAt,
      },
      balances: balances.map((row) => ({
        inventoryItemId: row.inventoryItemId,
        sku: row.sku,
        name: row.name,
        unit: row.unit,
        onHand: milliToQuantity(row.onHandMilli),
        version: row.version,
        updatedAt: row.updatedAt,
      })),
      movements: movements.map((row) => ({
        id: row.id,
        inventoryItemId: row.inventoryItemId,
        warehouseId: row.warehouseId,
        missionId: row.missionId,
        movementType: row.movementType,
        quantity: milliToQuantity(row.quantityMilli),
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        note: row.note,
        actorId: row.actorId,
        createdAt: row.createdAt,
      })),
      summary: {
        itemCount: balances.filter((row) => row.onHandMilli !== 0).length,
        positiveItemCount: balances.filter((row) => row.onHandMilli > 0).length,
        movementCount: movements.length,
        hasStock: balances.some((row) => row.onHandMilli > 0),
      },
      reportDate,
      todayReconciliation: todayReconciliation ? reconciliationForResponse(todayReconciliation) : null,
      reconciliations: shiftReconciliations.slice(0, 30).map(reconciliationForResponse),
      readback: { status: "verified", scope: "tenant", registerVersion: register.version },
    }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return Response.json({ error: "job_stock_readback_unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request, routeContext: RouteContext) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "operations.write") && !hasCapability(context, "operations.rapportino.write")) {
    return Response.json({ error: "forbidden", capability: "operations.rapportino.write" }, { status: 403 });
  }
  if (!context.operatingDomains.includes("warehouse")) {
    return Response.json({ error: "warehouse_domain_not_enabled" }, { status: 403 });
  }
  const reference = await routeJobReference(routeContext);
  if (!reference) return Response.json({ error: "invalid_job_id" }, { status: 400 });

  let input: JsonObject;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 32_768) return Response.json({ error: "payload_too_large" }, { status: 413 });
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return Response.json({ error: "invalid_json" }, { status: 400 });
    input = parsed;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  if (boundedText(input.action, 40).toLowerCase() !== "reconcile_shift") {
    return Response.json({ error: "unknown_job_stock_action" }, { status: 400 });
  }
  const idempotencyKey = boundedText(input.idempotencyKey, 120);
  if (idempotencyKey.length < 8 || !/^[a-zA-Z0-9:_-]+$/.test(idempotencyKey)) {
    return Response.json({ error: "job_stock_idempotency_key_required" }, { status: 400 });
  }
  const reportDate = boundedText(input.reportDate, 10) || italyDateKey();
  if (reportDate !== italyDateKey()) {
    return Response.json({ error: "job_stock_reconciliation_current_shift_only", reportDate: italyDateKey() }, { status: 409 });
  }
  if (!Array.isArray(input.lines) || input.lines.length > 100 || input.lines.some((line) => !isRecord(line))) {
    return Response.json({ error: "job_stock_reconciliation_lines_invalid" }, { status: 400 });
  }

  const parsedLines = input.lines.map((line) => {
    const value = line as JsonObject;
    return {
      inventoryItemId: boundedText(value.inventoryItemId, 160),
      expectedVersion: typeof value.expectedVersion === "number" && Number.isInteger(value.expectedVersion) ? value.expectedVersion : 0,
      consumedMilli: quantityToMilli(value.consumed, { allowZero: true }),
    };
  });
  if (parsedLines.some((line) => !line.inventoryItemId || line.expectedVersion < 1 || line.consumedMilli === null)) {
    return Response.json({ error: "job_stock_reconciliation_line_invalid" }, { status: 400 });
  }
  if (new Set(parsedLines.map((line) => line.inventoryItemId)).size !== parsedLines.length) {
    return Response.json({ error: "job_stock_reconciliation_duplicate_item" }, { status: 400 });
  }

  try {
    await ensureJobStockSchema();
    const db = getDb();
    const job = await findJob(context.tenantId, reference);
    if (!job) return Response.json({ error: "job_not_found" }, { status: 404 });
    if (!(await canAccessJob(context, job))) return Response.json({ error: "job_not_found" }, { status: 404 });

    const [register] = await db.select().from(jobStockRegisters).where(and(
      eq(jobStockRegisters.tenantId, context.tenantId),
      eq(jobStockRegisters.jobId, job.id),
      eq(jobStockRegisters.status, "ACTIVE"),
    )).limit(1);
    if (!register) return Response.json({ error: "job_stock_register_not_provisioned" }, { status: 409 });

    const [existingEvent] = await db.select().from(s06Events).where(and(
      eq(s06Events.tenantId, context.tenantId),
      eq(s06Events.idempotencyKey, idempotencyKey),
    )).limit(1);
    if (existingEvent) {
      if (existingEvent.eventType !== "warehouse.job_stock.shift_reconciled" || existingEvent.aggregateId !== register.id) {
        return Response.json({ error: "job_stock_idempotency_conflict" }, { status: 409 });
      }
      const eventPayload = parseJson(existingEvent.payloadJson);
      const reconciliationId = boundedText(eventPayload.reconciliationId, 160);
      const [reconciliation] = reconciliationId ? await db.select().from(jobJourneyRecords).where(and(
        eq(jobJourneyRecords.tenantId, context.tenantId),
        eq(jobJourneyRecords.id, reconciliationId),
        eq(jobJourneyRecords.jobId, job.id),
      )).limit(1) : [];
      if (!reconciliation) return Response.json({ error: "job_stock_reconciliation_readback_unavailable" }, { status: 503 });
      return Response.json({
        reconciliation: reconciliationForResponse(reconciliation),
        eventId: existingEvent.eventId,
        idempotent: true,
        readback: { status: "verified", registerId: register.id, registerVersion: register.version },
      }, { headers: { "cache-control": "private, no-store" } });
    }

    const currentReconciliation = (await db.select().from(jobJourneyRecords).where(and(
      eq(jobJourneyRecords.tenantId, context.tenantId),
      eq(jobJourneyRecords.jobId, job.id),
      eq(jobJourneyRecords.domain, "warehouse"),
      eq(jobJourneyRecords.recordType, "MATERIAL_MOVEMENT"),
    )).orderBy(desc(jobJourneyRecords.createdAt)).limit(100)).find((row) => {
      const payload = parseJson(row.payloadJson);
      return payload.kind === "SHIFT_RECONCILIATION"
        && boundedText(payload.reportDate, 10) === reportDate
        && boundedText(payload.registerId, 160) === register.id
        && Number(payload.registerVersionAfter) === register.version;
    });
    if (currentReconciliation) {
      return Response.json({
        error: "job_stock_shift_already_reconciled",
        reconciliation: reconciliationForResponse(currentReconciliation),
        readback: { status: "verified", registerId: register.id, registerVersion: register.version },
      }, { status: 409, headers: { "cache-control": "private, no-store" } });
    }

    const positiveBalances = await db.select().from(jobStockBalances).where(and(
      eq(jobStockBalances.tenantId, context.tenantId),
      eq(jobStockBalances.registerId, register.id),
      eq(jobStockBalances.jobId, job.id),
      sql`${jobStockBalances.onHandMilli} > 0`,
    )).orderBy(jobStockBalances.inventoryItemId).limit(101);
    if (positiveBalances.length > 100) {
      return Response.json({ error: "job_stock_reconciliation_line_limit_exceeded", limit: 100 }, { status: 409 });
    }
    const requestedIds = new Set(parsedLines.map((line) => line.inventoryItemId));
    if (positiveBalances.length !== parsedLines.length || positiveBalances.some((row) => !requestedIds.has(row.inventoryItemId))) {
      return Response.json({ error: "job_stock_reconciliation_catalog_changed", balances: positiveBalances.map((row) => ({ inventoryItemId: row.inventoryItemId, version: row.version })) }, { status: 409 });
    }

    const inputByItem = new Map(parsedLines.map((line) => [line.inventoryItemId, line] as const));
    const lineSnapshots = positiveBalances.map((balance) => {
      const line = inputByItem.get(balance.inventoryItemId)!;
      if (line.expectedVersion !== balance.version) throw new Error("job_stock_version_conflict");
      if (line.consumedMilli === null || line.consumedMilli > balance.onHandMilli) throw new Error("job_stock_quantity_exceeds_balance");
      const unit = inventoryUnitForCode(balance.unit);
      const precisionScale = unit ? 10 ** (3 - unit.decimals) : 0;
      if (!unit || line.consumedMilli % precisionScale !== 0) throw new Error("job_stock_quantity_precision_invalid");
      return {
        balance,
        consumedMilli: line.consumedMilli,
        remainingMilli: balance.onHandMilli - line.consumedMilli,
      };
    });

    const now = new Date().toISOString();
    const reconciliationId = `job-stock-recon:${job.id}:${reportDate}:v${register.version}`;
    const eventId = crypto.randomUUID();
    const nextRegisterVersion = register.version + 1;
    const payload = {
      kind: "SHIFT_RECONCILIATION",
      registerId: register.id,
      reportDate,
      registerVersionBefore: register.version,
      registerVersionAfter: nextRegisterVersion,
      confirmedAt: now,
      confirmedBy: context.actorId,
      lines: lineSnapshots.map(({ balance, consumedMilli, remainingMilli }) => ({
        inventoryItemId: balance.inventoryItemId,
        sku: balance.sku,
        name: balance.name,
        unit: balance.unit,
        beforeMilli: balance.onHandMilli,
        consumedMilli,
        remainingMilli,
        balanceVersionBefore: balance.version,
        balanceVersionAfter: consumedMilli > 0 ? balance.version + 1 : balance.version,
      })),
    };
    const payloadJson = JSON.stringify(payload);
    if (payloadJson.length > 28_000) return Response.json({ error: "job_stock_reconciliation_payload_too_large" }, { status: 413 });

    const statements: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] = [
      db.update(jobStockRegisters).set({
        version: sql`CASE WHEN ${jobStockRegisters.version} = ${register.version} AND ${jobStockRegisters.status} = 'ACTIVE' THEN ${jobStockRegisters.version} + 1 ELSE NULL END`,
        updatedAt: now,
      }).where(and(
        eq(jobStockRegisters.tenantId, context.tenantId),
        eq(jobStockRegisters.id, register.id),
      )).returning(),
    ];

    lineSnapshots.forEach(({ balance, consumedMilli }, index) => {
      if (consumedMilli <= 0) return;
      statements.push(
        db.update(jobStockBalances).set({
          onHandMilli: sql`CASE WHEN ${jobStockBalances.version} = ${balance.version} AND ${jobStockBalances.onHandMilli} >= ${consumedMilli} THEN ${jobStockBalances.onHandMilli} - ${consumedMilli} ELSE NULL END`,
          version: sql`${jobStockBalances.version} + 1`,
          updatedAt: now,
        }).where(and(
          eq(jobStockBalances.tenantId, context.tenantId),
          eq(jobStockBalances.id, balance.id),
        )).returning(),
        db.insert(jobStockMovements).values({
          id: `JOB-STOCK-MOV-${crypto.randomUUID().slice(0, 12).toUpperCase()}`,
          tenantId: context.tenantId,
          registerId: register.id,
          jobId: job.id,
          inventoryItemId: balance.inventoryItemId,
          warehouseId: null,
          missionId: null,
          movementType: "CONSUME",
          quantityMilli: -consumedMilli,
          sourceType: "SHIFT_RECONCILIATION",
          sourceId: reconciliationId,
          note: `Consumo materiali del turno ${reportDate} · ${balance.name}`,
          idempotencyKey: `job-stock-consume:${reconciliationId}:${index}`,
          actorId: context.actorId,
          createdAt: now,
        }),
      );
    });

    statements.push(
      db.insert(jobJourneyRecords).values({
        id: reconciliationId,
        tenantId: context.tenantId,
        jobId: job.id,
        domain: "warehouse",
        recordType: "MATERIAL_MOVEMENT",
        title: `Consuntivo materiali · ${reportDate}`,
        status: "CONFIRMED",
        version: 1,
        payloadJson,
        idempotencyKey: `job-stock-reconciliation:${idempotencyKey}`,
        createdBy: context.actorId,
        updatedBy: context.actorId,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(s06Events).values({
        eventId,
        tenantId: context.tenantId,
        eventType: "warehouse.job_stock.shift_reconciled",
        schemaVersion: "1",
        actorType: "human",
        actorId: context.actorId,
        source: "sites-job-stock",
        occurredAt: now,
        observedAt: now,
        aggregateType: "job_stock_register",
        aggregateId: register.id,
        aggregateVersion: nextRegisterVersion,
        payloadJson: JSON.stringify({ reconciliationId, reportDate, lineCount: lineSnapshots.length, consumedLineCount: lineSnapshots.filter((line) => line.consumedMilli > 0).length }),
        correlationId: crypto.randomUUID(),
        causationId: null,
        idempotencyKey,
        status: "COMMITTED_SITES_READBACK",
        createdAt: now,
      }),
      db.insert(s06Outbox).values({
        id: crypto.randomUUID(),
        tenantId: context.tenantId,
        eventId,
        topic: "zerow.warehouse.job_stock.shift_reconciled",
        status: "PENDING_EXTERNAL_CONSUMER",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(s06Reconciliations).values({
        id: crypto.randomUUID(),
        tenantId: context.tenantId,
        aggregateType: "job_stock_register",
        aggregateId: register.id,
        expectedVersion: nextRegisterVersion,
        observedVersion: nextRegisterVersion,
        status: "SITES_READBACK_VERIFIED",
        detail: `Consuntivo materiali turno ${reportDate}: giacenze residue confermate dal responsabile.`,
        createdAt: now,
        updatedAt: now,
      }),
    );

    await db.batch(statements);

    const balanceIds = lineSnapshots.map(({ balance }) => balance.id);
    const balanceReadbackPromise = balanceIds.length > 0
      ? db.select().from(jobStockBalances).where(and(
          eq(jobStockBalances.tenantId, context.tenantId),
          eq(jobStockBalances.registerId, register.id),
          inArray(jobStockBalances.id, balanceIds),
        )).limit(100)
      : Promise.resolve([] as Array<typeof jobStockBalances.$inferSelect>);
    const [registerReadback, reconciliationReadback, balanceReadback, movementReadback, eventReadback, outboxReadback, auditReadback] = await Promise.all([
      db.select().from(jobStockRegisters).where(and(eq(jobStockRegisters.tenantId, context.tenantId), eq(jobStockRegisters.id, register.id))).limit(1),
      db.select().from(jobJourneyRecords).where(and(eq(jobJourneyRecords.tenantId, context.tenantId), eq(jobJourneyRecords.id, reconciliationId))).limit(1),
      balanceReadbackPromise,
      db.select().from(jobStockMovements).where(and(eq(jobStockMovements.tenantId, context.tenantId), eq(jobStockMovements.sourceId, reconciliationId))).limit(100),
      db.select().from(s06Events).where(and(eq(s06Events.tenantId, context.tenantId), eq(s06Events.eventId, eventId))).limit(1),
      db.select().from(s06Outbox).where(and(eq(s06Outbox.tenantId, context.tenantId), eq(s06Outbox.eventId, eventId))).limit(1),
      db.select().from(s06Reconciliations).where(and(
        eq(s06Reconciliations.tenantId, context.tenantId),
        eq(s06Reconciliations.aggregateType, "job_stock_register"),
        eq(s06Reconciliations.aggregateId, register.id),
        eq(s06Reconciliations.observedVersion, nextRegisterVersion),
      )).limit(1),
    ]);
    const balancesByItem = new Map(balanceReadback.map((row) => [row.inventoryItemId, row] as const));
    const verified = registerReadback[0]?.version === nextRegisterVersion
      && Boolean(reconciliationReadback[0])
      && lineSnapshots.every(({ balance, consumedMilli, remainingMilli }) => {
        const current = balancesByItem.get(balance.inventoryItemId);
        return Boolean(current
          && current.onHandMilli === remainingMilli
          && current.version === balance.version + (consumedMilli > 0 ? 1 : 0));
      })
      && movementReadback.length === lineSnapshots.filter((line) => line.consumedMilli > 0).length
      && eventReadback[0]?.eventType === "warehouse.job_stock.shift_reconciled"
      && outboxReadback[0]?.topic === "zerow.warehouse.job_stock.shift_reconciled"
      && auditReadback[0]?.status === "SITES_READBACK_VERIFIED";
    if (!verified) return Response.json({ error: "job_stock_reconciliation_readback_unavailable" }, { status: 503 });

    return Response.json({
      reconciliation: reconciliationForResponse(reconciliationReadback[0]),
      eventId,
      idempotent: false,
      balances: balanceReadback.map((row) => ({ inventoryItemId: row.inventoryItemId, onHand: milliToQuantity(row.onHandMilli), version: row.version })),
      readback: { status: "verified", registerId: register.id, registerVersion: nextRegisterVersion },
    }, { status: 201, headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "job_stock_version_conflict" || /NOT NULL constraint failed: job_stock_(?:balances|registers)/i.test(message)) {
      return Response.json({ error: "job_stock_version_conflict" }, { status: 409 });
    }
    if (message === "job_stock_quantity_exceeds_balance") {
      return Response.json({ error: "job_stock_quantity_exceeds_balance" }, { status: 409 });
    }
    if (message === "job_stock_quantity_precision_invalid") {
      return Response.json({ error: "job_stock_quantity_precision_invalid" }, { status: 400 });
    }
    if (/UNIQUE|unique/i.test(message)) return Response.json({ error: "job_stock_shift_already_reconciled" }, { status: 409 });
    return Response.json({ error: "job_stock_reconciliation_unavailable" }, { status: 503 });
  }
}
