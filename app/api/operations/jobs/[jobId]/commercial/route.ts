import { and, desc, eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { getDb } from "@/db";
import { jobJourneyRecords, s04Records, s06Events, s06Outbox, s06Reconciliations } from "@/db/schema";
import { getAuthorityContext, hasCapability, publicAuthorityContext, type AuthorityContext } from "@/lib/authority-context";
import {
  buildJobWorkOrderEconomics,
  isJobCommercialValueBasis,
  jobCommercialCatalog,
  normalizeJobCommercialTerms,
  type CommercialJourneyRecord,
  type JobWorkOrderStatus,
} from "@/lib/job-commercial-terms";
import { canReadAllOperations, rowMatchesContext, teamScopeTokens } from "@/lib/operational-scope";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ jobId: string }> };
type JsonObject = Record<string, unknown>;

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseObject(value: string): JsonObject {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function boundedText(value: unknown, max: number, fallback = "") {
  return typeof value === "string" ? value.trim().slice(0, max) : fallback;
}

function parseEuroMinor(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0 || value > 1_000_000_000) return null;
    const minor = value * 100;
    return Number.isSafeInteger(minor) ? minor : null;
  }
  if (typeof value !== "string" || !value.trim()) return null;
  let normalized = value.replace(/[€\s]/g, "").trim();
  if (!/^[\d.,]+$/.test(normalized)) return null;
  const comma = normalized.lastIndexOf(",");
  const dot = normalized.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    const decimalMark = comma > dot ? "," : ".";
    const groupingMark = decimalMark === "," ? "." : ",";
    normalized = normalized.split(groupingMark).join("").replace(decimalMark, ".");
  } else if (comma >= 0) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else if (dot >= 0 && /^\d{1,3}(?:\.\d{3})+$/.test(normalized)) {
    normalized = normalized.replace(/\./g, "");
  }
  if (!/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(normalized)) return null;
  const amount = Number(normalized);
  const minor = Math.round(amount * 100);
  return Number.isFinite(amount) && amount > 0 && amount <= 1_000_000_000 && Number.isSafeInteger(minor) ? minor : null;
}

async function requestedJobId(routeContext: RouteContext) {
  try {
    const value = decodeURIComponent((await routeContext.params).jobId).trim();
    return value && value.length <= 160 ? value : null;
  } catch {
    return null;
  }
}

async function readBody(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > 32_768) return { error: "payload_too_large" as const };
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 32_768) return { error: "payload_too_large" as const };
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? { value: parsed } : { error: "invalid_json" as const };
  } catch {
    return { error: "invalid_json" as const };
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

async function canAccessJob(context: AuthorityContext, job: typeof s04Records.$inferSelect) {
  if (canReadAllOperations(context)) return true;
  const workforce = await getDb().select().from(s04Records).where(and(
    eq(s04Records.tenantId, context.tenantId),
    eq(s04Records.module, "workforce"),
  )).limit(500);
  return rowMatchesContext(job, context, teamScopeTokens(workforce, context));
}

async function commercialReadback(context: AuthorityContext, job: typeof s04Records.$inferSelect) {
  const records = await getDb().select().from(jobJourneyRecords).where(and(
    eq(jobJourneyRecords.tenantId, context.tenantId),
    eq(jobJourneyRecords.jobId, job.id),
  )).orderBy(desc(jobJourneyRecords.updatedAt)).limit(1_000);
  const termsRow = records
    .filter((row) => row.domain === "finance" && row.recordType === "JOB_COMMERCIAL_TERMS" && row.status === "ACTIVE")
    .sort((left, right) => right.version - left.version || right.updatedAt.localeCompare(left.updatedAt))[0];
  const legacyRow = records
    .filter((row) => row.domain === "finance" && row.recordType === "JOB_COMMERCIAL_VALUE" && row.status === "ACTIVE")
    .sort((left, right) => right.version - left.version || right.updatedAt.localeCompare(left.updatedAt))[0];
  const jobPayload = parseObject(job.payloadJson);
  const terms = normalizeJobCommercialTerms(
    termsRow ? parseObject(termsRow.payloadJson) : jobPayload.commercialTerms,
    legacyRow ? parseObject(legacyRow.payloadJson) : jobPayload.commercialValue,
  );
  const commercialRecords = records.filter((row) => row.recordType === "JOB_WORK_ORDER" || row.recordType === "JOB_WORK_ORDER_VALUE") as CommercialJourneyRecord[];
  return {
    context: publicAuthorityContext(context),
    job: {
      id: job.id,
      code: job.canonicalCode,
      title: boundedText(jobPayload.title, 160, job.title),
      status: job.status,
    },
    terms,
    workOrderEconomics: buildJobWorkOrderEconomics(commercialRecords),
    can: { write: hasCapability(context, "operations.write") },
    options: {
      ...jobCommercialCatalog(),
      workOrderStatuses: [
        { value: "DRAFT", label: "Bozza" },
        { value: "APPROVED", label: "Approvata" },
        { value: "COMPLETED", label: "Completata" },
        { value: "CANCELLED", label: "Annullata" },
      ],
      catalogAuthority: "SERVER_CONTRACT",
    },
    readback: { status: "verified", checkedAt: new Date().toISOString(), termsRecordId: termsRow?.id ?? null },
  };
}

function workOrderTransition(current: JobWorkOrderStatus, target: JobWorkOrderStatus) {
  const allowed: Record<JobWorkOrderStatus, JobWorkOrderStatus[]> = {
    DRAFT: ["APPROVED", "CANCELLED"],
    APPROVED: ["COMPLETED", "CANCELLED"],
    COMPLETED: [],
    CANCELLED: [],
  };
  return allowed[current].includes(target);
}

function normalizedWorkOrderStatus(value: string): JobWorkOrderStatus {
  if (value === "APPROVED" || value === "COMPLETED" || value === "CANCELLED") return value;
  return "DRAFT";
}

export async function GET(_request: Request, routeContext: RouteContext) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "operations.read")) return Response.json({ error: "forbidden", capability: "operations.read" }, { status: 403 });
  const reference = await requestedJobId(routeContext);
  if (!reference) return Response.json({ error: "invalid_job_id" }, { status: 400 });
  try {
    const job = await findJob(context.tenantId, reference);
    if (!job || !(await canAccessJob(context, job))) return Response.json({ error: "job_not_found" }, { status: 404 });
    return Response.json(await commercialReadback(context, job), { headers: { "cache-control": "private, no-store" } });
  } catch {
    return Response.json({ error: "job_commercial_readback_unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request, routeContext: RouteContext) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "operations.write")) return Response.json({ error: "forbidden", capability: "operations.write" }, { status: 403 });
  const reference = await requestedJobId(routeContext);
  if (!reference) return Response.json({ error: "invalid_job_id" }, { status: 400 });
  const parsed = await readBody(request);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: parsed.error === "payload_too_large" ? 413 : 400 });
  const input = parsed.value;
  const action = boundedText(input.action, 48).toLowerCase();
  if (action !== "create_work_order" && action !== "set_work_order_status") {
    return Response.json({ error: "unsupported_commercial_action", allowed: ["create_work_order", "set_work_order_status"] }, { status: 400 });
  }
  const idempotencyKey = typeof input.idempotencyKey === "string" ? input.idempotencyKey.trim() : "";
  if (idempotencyKey.length < 8 || idempotencyKey.length > 120) {
    return Response.json({ error: "idempotency_key_invalid" }, { status: 400 });
  }

  try {
    const db = getDb();
    const job = await findJob(context.tenantId, reference);
    if (!job || !(await canAccessJob(context, job))) return Response.json({ error: "job_not_found" }, { status: 404 });
    const [existingEvent] = await db.select().from(s06Events).where(and(
      eq(s06Events.tenantId, context.tenantId),
      eq(s06Events.idempotencyKey, idempotencyKey),
    )).limit(1);
    if (existingEvent) {
      const existingPayload = parseObject(existingEvent.payloadJson);
      const expectedEventType = action === "create_work_order"
        ? "operations.job.work_order.created"
        : "operations.job.work_order.status_changed";
      const sameRequest = existingEvent.aggregateType === "job.commercial.work_order"
        && existingEvent.eventType === expectedEventType
        && existingPayload.action === action
        && existingPayload.jobId === job.id
        && (action === "create_work_order"
          ? existingPayload.amountMinor === parseEuroMinor(input.amount) && existingPayload.basis === input.basis && existingPayload.title === boundedText(input.title, 160)
          : existingPayload.workOrderId === boundedText(input.workOrderId, 160)
            && existingPayload.status === boundedText(input.status, 24).toUpperCase()
            && existingPayload.expectedVersion === input.expectedVersion);
      if (!sameRequest) return Response.json({ error: "commercial_idempotency_key_conflict" }, { status: 409 });
      return Response.json({
        ...(await commercialReadback(context, job)),
        mutation: { action, workOrderId: existingEvent.aggregateId, eventId: existingEvent.eventId, idempotent: true },
      }, { headers: { "cache-control": "private, no-store" } });
    }

    const snapshot = await commercialReadback(context, job);
    if (action === "create_work_order") {
      if (snapshot.terms.model !== "PER_WORK_ORDER" && snapshot.terms.model !== "MIXED") {
        return Response.json({ error: "work_order_value_not_allowed_for_commercial_model", model: snapshot.terms.model }, { status: 409 });
      }
      const title = boundedText(input.title, 160);
      const description = boundedText(input.description, 1_200);
      const amountMinor = parseEuroMinor(input.amount);
      const basis = input.basis;
      if (title.length < 2) return Response.json({ error: "work_order_title_required" }, { status: 400 });
      if (amountMinor === null) return Response.json({ error: "work_order_value_invalid" }, { status: 400 });
      if (!isJobCommercialValueBasis(basis)) return Response.json({ error: "commercial_value_basis_invalid" }, { status: 400 });

      const now = new Date().toISOString();
      const workOrderId = `JOB-WORK-ORDER-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
      const valueId = `JOB-WORK-VALUE-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
      const eventId = crypto.randomUUID();
      const payload = { workOrderId, title, description, createdAt: now, source: "human-authored" };
      const valuePayload = { workOrderId, amountMinor, currency: "EUR", basis, effectiveAt: now, source: "human-authored" };
      const statements: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] = [
        db.insert(jobJourneyRecords).values({
          id: workOrderId, tenantId: context.tenantId, jobId: job.id, domain: "operations", recordType: "JOB_WORK_ORDER",
          title, status: "DRAFT", version: 1, payloadJson: JSON.stringify(payload),
          idempotencyKey: `commercial:work-order:${idempotencyKey}`, createdBy: context.actorId, updatedBy: context.actorId, createdAt: now, updatedAt: now,
        }),
        db.insert(jobJourneyRecords).values({
          id: valueId, tenantId: context.tenantId, jobId: job.id, domain: "finance", recordType: "JOB_WORK_ORDER_VALUE",
          title: `Valore · ${title}`, status: "ACTIVE", version: 1, payloadJson: JSON.stringify(valuePayload),
          idempotencyKey: `commercial:work-order-value:${idempotencyKey}`, createdBy: context.actorId, updatedBy: context.actorId, createdAt: now, updatedAt: now,
        }),
        db.insert(s06Events).values({
          eventId, tenantId: context.tenantId, eventType: "operations.job.work_order.created", schemaVersion: "1", actorType: "human", actorId: context.actorId,
          source: "sites-command", occurredAt: now, observedAt: now, aggregateType: "job.commercial.work_order", aggregateId: workOrderId,
          aggregateVersion: 1, payloadJson: JSON.stringify({ action, jobId: job.id, workOrderId, valueId, title, amountMinor, currency: "EUR", basis, status: "DRAFT" }),
          correlationId: crypto.randomUUID(), causationId: null, idempotencyKey, status: "COMMITTED_SITES_READBACK", createdAt: now,
        }),
        db.insert(s06Outbox).values({ id: crypto.randomUUID(), tenantId: context.tenantId, eventId, topic: "zerow.operations.job.work_order.created", status: "PENDING_EXTERNAL_CONSUMER", attempts: 0, createdAt: now, updatedAt: now }),
        db.insert(s06Reconciliations).values({ id: crypto.randomUUID(), tenantId: context.tenantId, aggregateType: "job.commercial.work_order", aggregateId: workOrderId, expectedVersion: 1, observedVersion: 1, status: "SITES_READBACK_VERIFIED", detail: "Lavorazione economica registrata separatamente dai fatti contabili Finance.", createdAt: now, updatedAt: now }),
      ];
      await db.batch(statements);
      const readback = await commercialReadback(context, job);
      if (!readback.workOrderEconomics.workOrders.some((item) => item.id === workOrderId && item.value?.amountMinor === amountMinor)) {
        return Response.json({ error: "work_order_readback_unavailable" }, { status: 503 });
      }
      return Response.json({ ...readback, mutation: { action, workOrderId, eventId, idempotent: false } }, { status: 201, headers: { "cache-control": "private, no-store" } });
    }

    const workOrderId = boundedText(input.workOrderId, 160);
    const expectedVersion = typeof input.expectedVersion === "number" && Number.isInteger(input.expectedVersion) ? input.expectedVersion : null;
    const targetStatus = boundedText(input.status, 24).toUpperCase() as JobWorkOrderStatus;
    if (!workOrderId || expectedVersion === null || expectedVersion < 1) return Response.json({ error: "work_order_version_required" }, { status: 400 });
    if (!["APPROVED", "COMPLETED", "CANCELLED"].includes(targetStatus)) return Response.json({ error: "work_order_status_invalid" }, { status: 400 });
    const [row] = await db.select().from(jobJourneyRecords).where(and(
      eq(jobJourneyRecords.tenantId, context.tenantId),
      eq(jobJourneyRecords.jobId, job.id),
      eq(jobJourneyRecords.id, workOrderId),
      eq(jobJourneyRecords.recordType, "JOB_WORK_ORDER"),
    )).limit(1);
    if (!row) return Response.json({ error: "work_order_not_found" }, { status: 404 });
    if (row.version !== expectedVersion) return Response.json({ error: "version_conflict", expectedVersion, currentVersion: row.version }, { status: 409 });
    const currentStatus = normalizedWorkOrderStatus(row.status);
    if (!workOrderTransition(currentStatus, targetStatus)) return Response.json({ error: "work_order_transition_not_allowed", currentStatus, targetStatus }, { status: 409 });
    const now = new Date().toISOString();
    const nextVersion = row.version + 1;
    const eventId = crypto.randomUUID();
    const nextPayload = { ...parseObject(row.payloadJson), statusChangedAt: now, statusChangedBy: context.actorId };
    const statements: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] = [
      db.update(jobJourneyRecords).set({ status: targetStatus, version: nextVersion, payloadJson: JSON.stringify(nextPayload), updatedBy: context.actorId, updatedAt: now }).where(and(
        eq(jobJourneyRecords.tenantId, context.tenantId), eq(jobJourneyRecords.id, row.id), eq(jobJourneyRecords.version, expectedVersion),
      )),
      db.insert(s06Events).values({
        eventId, tenantId: context.tenantId, eventType: "operations.job.work_order.status_changed", schemaVersion: "1", actorType: "human", actorId: context.actorId,
        source: "sites-command", occurredAt: now, observedAt: now, aggregateType: "job.commercial.work_order", aggregateId: row.id,
        aggregateVersion: nextVersion, payloadJson: JSON.stringify({ action, jobId: job.id, workOrderId: row.id, previousStatus: currentStatus, status: targetStatus, expectedVersion, version: nextVersion }),
        correlationId: crypto.randomUUID(), causationId: null, idempotencyKey, status: "COMMITTED_SITES_READBACK", createdAt: now,
      }),
      db.insert(s06Outbox).values({ id: crypto.randomUUID(), tenantId: context.tenantId, eventId, topic: "zerow.operations.job.work_order.status_changed", status: "PENDING_EXTERNAL_CONSUMER", attempts: 0, createdAt: now, updatedAt: now }),
      db.insert(s06Reconciliations).values({ id: crypto.randomUUID(), tenantId: context.tenantId, aggregateType: "job.commercial.work_order", aggregateId: row.id, expectedVersion: nextVersion, observedVersion: nextVersion, status: "SITES_READBACK_VERIFIED", detail: `Stato lavorazione ${currentStatus} → ${targetStatus}; nessun ricavo o fattura generato automaticamente.`, createdAt: now, updatedAt: now }),
    ];
    await db.batch(statements);
    const readback = await commercialReadback(context, job);
    const changed = readback.workOrderEconomics.workOrders.find((item) => item.id === row.id);
    if (!changed || changed.version !== nextVersion || changed.status !== targetStatus) return Response.json({ error: "work_order_readback_unavailable" }, { status: 503 });
    return Response.json({ ...readback, mutation: { action, workOrderId: row.id, eventId, idempotent: false } }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.toLowerCase().includes("unique")) return Response.json({ error: "commercial_idempotency_or_version_conflict" }, { status: 409 });
    return Response.json({ error: "job_commercial_write_unavailable" }, { status: 503 });
  }
}
