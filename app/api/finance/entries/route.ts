import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  financeDocumentReviews,
  financeDocuments,
  financeEntries,
  financeEntryAllocations,
  financeEntryRelations,
  financeReconciliationIssues,
  s06Events,
  s06Outbox,
  s06Reconciliations,
  w10Workflows,
} from "@/db/schema";
import { getAuthorityContext, hasCapability, publicAuthorityContext } from "@/lib/authority-context";
import {
  buildFinanceProjection,
  financeEntryResponse,
  readFinanceJobs,
  readFinanceLedger,
  resolveFinanceJobs,
} from "@/lib/finance-ledger.server";
import {
  decimalToMinor,
  FINANCE_MANAGEMENT_POLICY,
  isFinanceCostCategory,
  isFinanceDocumentRole,
  isFinanceEntryType,
  isFinanceRelationType,
  isFinanceValuationBasis,
  isIsoCurrency,
  isIsoDate,
} from "@/lib/finance-ledger-contract";

export const dynamic = "force-dynamic";

type JsonObject = Record<string, unknown>;

function objectValue(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function parsedObject(value: string): JsonObject {
  try { return objectValue(JSON.parse(value)); } catch { return {}; }
}

function text(value: unknown, max = 600) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max)
    : "";
}

function integer(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function amountMinor(value: unknown, fallback: unknown = null) {
  const explicit = integer(value);
  if (explicit !== null) return explicit;
  return decimalToMinor(fallback);
}

function parseAllocations(value: unknown) {
  if (!Array.isArray(value)) return [];
  if (value.length > 24) throw new Error("finance_job_allocation_limit");
  const allocations = value.map((candidate) => {
    const row = objectValue(candidate);
    const jobId = text(row.jobId, 160);
    const amount = amountMinor(row.amountMinor, row.amount);
    if (!jobId || amount === null || amount <= 0) throw new Error("finance_allocation_invalid");
    return { jobId, amountMinor: amount };
  });
  if (new Set(allocations.map((allocation) => allocation.jobId)).size !== allocations.length) throw new Error("finance_allocation_duplicate_job");
  return allocations;
}

function requiredPrepareCapability(entryType: string) {
  if (entryType === "COMMITMENT") return "finance.commitments.manage";
  if (entryType === "PAYMENT" || entryType === "RECEIPT") return "finance.payments.record";
  return "finance.entries.prepare";
}

function statusForError(code: string) {
  if (code === "finance_entry_not_found" || code === "finance_job_not_found" || code === "finance_related_entry_not_found" || code === "finance_issue_not_found" || code === "finance_procurement_workflow_not_found") return 404;
  if (code.includes("version_conflict") || code.includes("maker_checker") || code.includes("not_confirmable") || code.includes("blocking_issue") || code.includes("already_applied") || code.includes("source_changed") || code.includes("requires_relation")) return 409;
  if (code.includes("unavailable")) return 503;
  return 400;
}

function eventStatements({
  tenantId,
  actorId,
  eventId,
  eventType,
  aggregateId,
  aggregateVersion,
  idempotencyKey,
  payload,
  now,
  detail,
  aggregateType = "finance.entry",
}: {
  tenantId: string;
  actorId: string;
  eventId: string;
  eventType: string;
  aggregateId: string;
  aggregateVersion: number;
  idempotencyKey: string;
  payload: JsonObject;
  now: string;
  detail: string;
  aggregateType?: string;
}) {
  const db = getDb();
  return [
    db.insert(s06Events).values({
      eventId,
      tenantId,
      eventType,
      schemaVersion: "1",
      actorType: "human",
      actorId,
      source: "sites-finance-ledger",
      occurredAt: now,
      observedAt: now,
      aggregateType,
      aggregateId,
      aggregateVersion,
      payloadJson: JSON.stringify(payload),
      correlationId: crypto.randomUUID(),
      causationId: null,
      idempotencyKey,
      status: "COMMITTED_SITES_READBACK",
      createdAt: now,
    }),
    db.insert(s06Outbox).values({ id: crypto.randomUUID(), tenantId, eventId, topic: `zerow.${eventType}`, status: "PENDING_EXTERNAL_CONSUMER", attempts: 0, createdAt: now, updatedAt: now }),
    db.insert(s06Reconciliations).values({ id: crypto.randomUUID(), tenantId, aggregateType, aggregateId, expectedVersion: aggregateVersion, observedVersion: aggregateVersion, status: "SITES_READBACK_VERIFIED", detail, createdAt: now, updatedAt: now }),
  ] as const;
}

async function findEntry(tenantId: string, entryId: string) {
  const [entry] = await getDb().select().from(financeEntries).where(and(
    eq(financeEntries.tenantId, tenantId),
    eq(financeEntries.id, entryId),
  )).limit(1);
  return entry ?? null;
}

async function entryReadback(tenantId: string, entryId: string) {
  const db = getDb();
  const entry = await findEntry(tenantId, entryId);
  if (!entry) return null;
  const [allocations, relations] = await Promise.all([
    db.select().from(financeEntryAllocations).where(and(eq(financeEntryAllocations.tenantId, tenantId), eq(financeEntryAllocations.entryId, entryId))),
    db.select().from(financeEntryRelations).where(and(eq(financeEntryRelations.tenantId, tenantId), eq(financeEntryRelations.entryId, entryId))),
  ]);
  return financeEntryResponse(entry, allocations, relations);
}

async function idempotentEntry(tenantId: string, idempotencyKey: string) {
  const [event] = await getDb().select().from(s06Events).where(and(
    eq(s06Events.tenantId, tenantId),
    eq(s06Events.idempotencyKey, idempotencyKey),
  )).limit(1);
  if (!event) return null;
  if (event.aggregateType !== "finance.entry") throw new Error("finance_entry_idempotency_conflict");
  const entry = await entryReadback(tenantId, event.aggregateId);
  if (!entry) throw new Error("finance_entry_readback_unavailable");
  return { event, entry };
}

export async function GET(request: Request) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "finance.read")) return Response.json({ error: "forbidden", capability: "finance.read" }, { status: 403 });
  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId")?.trim() ?? "";
  if (jobId.length > 160) return Response.json({ error: "invalid_job_id" }, { status: 400 });
  try {
    const jobs = await readFinanceJobs(context.tenantId);
    if (jobId && !jobs.some((job) => job.id === jobId)) return Response.json({ error: "finance_job_not_found" }, { status: 404 });
    const ledger = await readFinanceLedger(context.tenantId, jobId);
    return Response.json({
      context: publicAuthorityContext(context),
      jobs,
      selectedJob: jobId ? jobs.find((job) => job.id === jobId) ?? null : null,
      entries: ledger.rows.map((row) => financeEntryResponse(row, ledger.allocations, ledger.relations)),
      projection: buildFinanceProjection({ rows: ledger.rows, allocations: ledger.allocations, relations: ledger.relations, jobId }),
      issues: ledger.issues.map((issue) => ({
        id: issue.id,
        issueCode: issue.issueCode,
        severity: issue.severity,
        subjectType: issue.subjectType,
        subjectId: issue.subjectId,
        relatedEntityType: issue.relatedEntityType,
        relatedEntityId: issue.relatedEntityId,
        status: issue.status,
        detail: parsedObject(issue.detailJson),
        version: issue.version,
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
      })),
      policy: FINANCE_MANAGEMENT_POLICY,
      readback: { status: "SITES_READBACK_VERIFIED", checkedAt: new Date().toISOString() },
    }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return Response.json({ error: "finance_ledger_unavailable" }, { status: 503, headers: { "cache-control": "private, no-store" } });
  }
}

export async function POST(request: Request) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "finance.read")) return Response.json({ error: "forbidden", capability: "finance.read" }, { status: 403 });
  let body: JsonObject;
  try { body = objectValue(await request.json()); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }
  const action = text(body.action, 40).toLowerCase();
  const rawKey = text(body.idempotencyKey, 140);
  if (rawKey.length < 8) return Response.json({ error: "idempotency_key_invalid" }, { status: 400 });
  const idempotencyKey = `finance-entry:${action}:${rawKey}`;

  try {
    if (action === "prepare_from_procurement") {
      if (!hasCapability(context, "finance.commitments.manage")) return Response.json({ error: "forbidden", capability: "finance.commitments.manage" }, { status: 403 });
      const replay = await idempotentEntry(context.tenantId, idempotencyKey);
      if (replay) return Response.json({ entry: replay.entry, idempotent: true, eventId: replay.event.eventId, readback: { status: "verified", version: replay.entry.version } }, { headers: { "cache-control": "private, no-store" } });
      const workflowId = text(body.workflowId, 160);
      const [workflow] = await getDb().select().from(w10Workflows).where(and(
        eq(w10Workflows.tenantId, context.tenantId),
        eq(w10Workflows.id, workflowId),
        eq(w10Workflows.module, "procurement"),
      )).limit(1);
      if (!workflow) throw new Error("finance_procurement_workflow_not_found");
      if (!["APPROVED", "PO_DRAFT", "PO_ISSUED"].includes(workflow.status)) throw new Error("finance_procurement_workflow_not_approved");
      if (!Number.isSafeInteger(workflow.amountMilli) || workflow.amountMilli <= 0 || workflow.amountMilli % 10 !== 0) throw new Error("finance_procurement_amount_not_cent_exact");
      if (!isIsoCurrency(workflow.currency)) throw new Error("finance_currency_required");
      const [existingSource] = await getDb().select().from(financeEntries).where(and(
        eq(financeEntries.tenantId, context.tenantId),
        eq(financeEntries.sourceType, "PROCUREMENT_WORKFLOW"),
        eq(financeEntries.sourceId, workflow.id),
        eq(financeEntries.entryType, "COMMITMENT"),
      )).limit(1);
      if (existingSource) {
        const entry = await entryReadback(context.tenantId, existingSource.id);
        return Response.json({ entry, idempotent: true, sourceAlreadyRegistered: true, readback: { status: "verified", version: existingSource.version } }, { headers: { "cache-control": "private, no-store" } });
      }
      const amount = workflow.amountMilli / 10;
      const jobs = workflow.jobId ? await resolveFinanceJobs(context.tenantId, [workflow.jobId]) : [];
      const entryId = `FIN-ENT-${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      const eventId = crypto.randomUUID();
      const statements = [
        getDb().insert(financeEntries).values({
          id: entryId,
          tenantId: context.tenantId,
          entryType: "COMMITMENT",
          documentRole: "PURCHASE_ORDER",
          category: "MATERIALS",
          description: workflow.title,
          amountMinor: amount,
          effectSign: 1,
          currency: workflow.currency,
          valuationBasis: "EXPLICIT",
          economicDate: now.slice(0, 10),
          dueDate: null,
          counterpartyName: workflow.supplier,
          counterpartyVerification: workflow.supplier ? "WORKFLOW_CONFIRMED" : "UNVERIFIED",
          sourceType: "PROCUREMENT_WORKFLOW",
          sourceId: workflow.id,
          sourceDocumentId: null,
          status: "PENDING_APPROVAL",
          version: 1,
          idempotencyKey,
          preparedBy: context.actorId,
          createdAt: now,
          updatedAt: now,
        }),
        ...jobs.map((job, index) => getDb().insert(financeEntryAllocations).values({
          id: `FIN-ALL-${crypto.randomUUID()}`,
          tenantId: context.tenantId,
          entryId,
          jobId: job.id,
          amountMinor: amount,
          currency: workflow.currency,
          status: "ACTIVE",
          version: 1,
          idempotencyKey: `${idempotencyKey}:allocation:${index}`,
          createdBy: context.actorId,
          createdAt: now,
          updatedAt: now,
        })),
        ...eventStatements({ tenantId: context.tenantId, actorId: context.actorId, eventId, eventType: "finance.commitment.prepared_from_procurement", aggregateId: entryId, aggregateVersion: 1, idempotencyKey, payload: { workflowId: workflow.id, workflowVersion: workflow.version, amountMinor: amount, currency: workflow.currency, jobId: workflow.jobId, status: "PENDING_APPROVAL" }, now, detail: "Impegno preparato dal workflow Acquisti approvato; non è ancora un costo e attende approvazione indipendente." }),
      ];
      await getDb().batch(statements as unknown as Parameters<ReturnType<typeof getDb>["batch"]>[0]);
      const entry = await entryReadback(context.tenantId, entryId);
      if (!entry || entry.status !== "PENDING_APPROVAL") throw new Error("finance_entry_readback_unavailable");
      return Response.json({ entry, idempotent: false, eventId, readback: { status: "verified", version: entry.version } }, { status: 201, headers: { "cache-control": "private, no-store" } });
    }

    if (action === "prepare") {
      const entryType = text(body.entryType, 30).toUpperCase();
      if (!isFinanceEntryType(entryType)) throw new Error("finance_entry_type_invalid");
      const capability = requiredPrepareCapability(entryType);
      if (!hasCapability(context, capability)) return Response.json({ error: "forbidden", capability }, { status: 403 });
      const replay = await idempotentEntry(context.tenantId, idempotencyKey);
      if (replay) return Response.json({ entry: replay.entry, idempotent: true, eventId: replay.event.eventId, readback: { status: "verified", version: replay.entry.version } }, { headers: { "cache-control": "private, no-store" } });

      const description = text(body.description, 600);
      const amount = amountMinor(body.amountMinor, body.amount);
      const currency = text(body.currency, 3).toUpperCase();
      const economicDate = text(body.economicDate, 10);
      const dueDate = text(body.dueDate, 10);
      const category = text(body.category, 40).toUpperCase() || "OTHER";
      const valuationBasis = text(body.valuationBasis, 30).toUpperCase() || "EXPLICIT";
      const documentRoleValue = text(body.documentRole, 40).toUpperCase();
      if (description.length < 2 || amount === null || amount <= 0 || !isIsoCurrency(currency) || !isIsoDate(economicDate)) throw new Error("finance_entry_fields_invalid");
      if (dueDate && !isIsoDate(dueDate)) throw new Error("finance_due_date_invalid");
      if (!isFinanceCostCategory(category) || !isFinanceValuationBasis(valuationBasis)) throw new Error("finance_entry_classification_invalid");
      if (documentRoleValue && !isFinanceDocumentRole(documentRoleValue)) throw new Error("finance_document_role_invalid");
      const allocations = parseAllocations(body.allocations);
      await resolveFinanceJobs(context.tenantId, allocations.map((allocation) => allocation.jobId));
      const allocationTotal = allocations.reduce((sum, allocation) => sum + allocation.amountMinor, 0);
      if (!Number.isSafeInteger(allocationTotal) || (allocations.length > 0 && allocationTotal !== amount)) throw new Error("finance_allocation_total_mismatch");

      const entryId = `FIN-ENT-${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      const eventId = crypto.randomUUID();
      const statements = [
        getDb().insert(financeEntries).values({
          id: entryId,
          tenantId: context.tenantId,
          entryType,
          documentRole: documentRoleValue || null,
          category,
          description,
          amountMinor: amount,
          effectSign: 1,
          currency,
          valuationBasis,
          economicDate,
          dueDate: dueDate || null,
          counterpartyName: text(body.counterpartyName, 240),
          counterpartyTaxId: text(body.counterpartyTaxId, 80),
          counterpartyVerification: body.counterpartyVerified === true ? "HUMAN_CONFIRMED" : "UNVERIFIED",
          documentNumber: text(body.documentNumber, 120),
          sourceType: "MANUAL",
          sourceId: entryId,
          sourceDocumentId: null,
          status: "PENDING_APPROVAL",
          version: 1,
          idempotencyKey,
          preparedBy: context.actorId,
          createdAt: now,
          updatedAt: now,
        }),
        ...allocations.map((allocation, index) => getDb().insert(financeEntryAllocations).values({
          id: `FIN-ALL-${crypto.randomUUID()}`,
          tenantId: context.tenantId,
          entryId,
          jobId: allocation.jobId,
          amountMinor: allocation.amountMinor,
          currency,
          status: "ACTIVE",
          version: 1,
          idempotencyKey: `${idempotencyKey}:allocation:${index}`,
          createdBy: context.actorId,
          createdAt: now,
          updatedAt: now,
        })),
        ...eventStatements({ tenantId: context.tenantId, actorId: context.actorId, eventId, eventType: "finance.entry.prepared", aggregateId: entryId, aggregateVersion: 1, idempotencyKey, payload: { entryType, amountMinor: amount, currency, jobIds: allocations.map((allocation) => allocation.jobId), status: "PENDING_APPROVAL" }, now, detail: "Fatto economico preparato e riletto; escluso dalle proiezioni confermate fino ad approvazione indipendente." }),
      ];
      await getDb().batch(statements as unknown as Parameters<ReturnType<typeof getDb>["batch"]>[0]);
      const entry = await entryReadback(context.tenantId, entryId);
      if (!entry || entry.status !== "PENDING_APPROVAL") throw new Error("finance_entry_readback_unavailable");
      return Response.json({ entry, idempotent: false, eventId, readback: { status: "verified", version: entry.version } }, { status: 201, headers: { "cache-control": "private, no-store" } });
    }

    if (action === "confirm") {
      if (!hasCapability(context, "finance.entries.confirm")) return Response.json({ error: "forbidden", capability: "finance.entries.confirm" }, { status: 403 });
      const replay = await idempotentEntry(context.tenantId, idempotencyKey);
      if (replay) return Response.json({ entry: replay.entry, idempotent: true, eventId: replay.event.eventId, readback: { status: "verified", version: replay.entry.version } }, { headers: { "cache-control": "private, no-store" } });
      const entryId = text(body.entryId, 160);
      const expectedVersion = integer(body.expectedVersion);
      const current = await findEntry(context.tenantId, entryId);
      if (!current) throw new Error("finance_entry_not_found");
      if (current.version !== expectedVersion) throw new Error("finance_entry_version_conflict");
      if (current.status !== "PENDING_APPROVAL") throw new Error("finance_entry_not_confirmable");
      if (current.preparedBy === context.actorId) throw new Error("finance_maker_checker_violation");
      const [blockingIssue] = await getDb().select().from(financeReconciliationIssues).where(and(
        eq(financeReconciliationIssues.tenantId, context.tenantId),
        eq(financeReconciliationIssues.subjectType, "FINANCE_ENTRY"),
        eq(financeReconciliationIssues.subjectId, current.id),
        eq(financeReconciliationIssues.status, "OPEN"),
        eq(financeReconciliationIssues.severity, "BLOCKING"),
      )).limit(1);
      if (blockingIssue) throw new Error("finance_entry_blocking_issue");
      const allocations = await getDb().select().from(financeEntryAllocations).where(and(
        eq(financeEntryAllocations.tenantId, context.tenantId),
        eq(financeEntryAllocations.entryId, current.id),
        eq(financeEntryAllocations.status, "ACTIVE"),
      ));
      const allocationTotal = allocations.reduce((sum, allocation) => sum + allocation.amountMinor, 0);
      if (allocations.some((allocation) => allocation.currency !== current.currency) || (allocations.length > 0 && allocationTotal !== current.amountMinor)) throw new Error("finance_allocation_total_mismatch");
      if (!current.economicDate || !isIsoDate(current.economicDate)) throw new Error("finance_economic_date_required");
      if (current.sourceType === "DOCUMENT_REVIEW") {
        const [review] = await getDb().select().from(financeDocumentReviews).where(and(eq(financeDocumentReviews.tenantId, context.tenantId), eq(financeDocumentReviews.id, current.sourceId))).limit(1);
        const [document] = current.sourceDocumentId ? await getDb().select().from(financeDocuments).where(and(eq(financeDocuments.tenantId, context.tenantId), eq(financeDocuments.id, current.sourceDocumentId))).limit(1) : [];
        if (!review || review.status !== "CONFIRMED" || !document || review.sourceSha256 !== document.sha256 || review.sourceDocumentVersion !== document.version) throw new Error("finance_entry_source_changed");
      }
      const now = new Date().toISOString();
      const nextVersion = current.version + 1;
      const eventId = crypto.randomUUID();
      await getDb().batch([
        getDb().update(financeEntries).set({ status: "CONFIRMED", version: nextVersion, confirmedBy: context.actorId, confirmedAt: now, updatedAt: now }).where(and(eq(financeEntries.tenantId, context.tenantId), eq(financeEntries.id, current.id), eq(financeEntries.version, current.version), eq(financeEntries.status, "PENDING_APPROVAL"))),
        ...(["PAYMENT", "RECEIPT"].includes(current.entryType) ? [getDb().insert(financeReconciliationIssues).values({
          id: `FIN-ISS-${crypto.randomUUID()}`,
          tenantId: context.tenantId,
          issueCode: "UNLINKED_CASH_MOVEMENT",
          severity: "WARNING",
          subjectType: "FINANCE_ENTRY",
          subjectId: current.id,
          relatedEntityType: null,
          relatedEntityId: null,
          status: "OPEN",
          detailJson: JSON.stringify({ entryType: current.entryType, amountMinor: current.amountMinor, currency: current.currency, requiredRelation: "SETTLES" }),
          version: 1,
          idempotencyKey: `${idempotencyKey}:unlinked-cash`,
          createdBy: context.actorId,
          createdAt: now,
          updatedAt: now,
        })] : []),
        ...eventStatements({ tenantId: context.tenantId, actorId: context.actorId, eventId, eventType: "finance.entry.confirmed", aggregateId: current.id, aggregateVersion: nextVersion, idempotencyKey, payload: { entryType: current.entryType, amountMinor: current.amountMinor, currency: current.currency, preparedBy: current.preparedBy, confirmedBy: context.actorId }, now, detail: "Fatto economico confermato da un attore distinto dal preparatore e riletto nel registro Finance." }),
      ] as unknown as Parameters<ReturnType<typeof getDb>["batch"]>[0]);
      const entry = await entryReadback(context.tenantId, current.id);
      if (!entry || entry.status !== "CONFIRMED" || entry.version !== nextVersion) throw new Error("finance_entry_readback_unavailable");
      return Response.json({ entry, idempotent: false, eventId, readback: { status: "verified", version: entry.version } }, { headers: { "cache-control": "private, no-store" } });
    }

    if (action === "reverse") {
      if (!hasCapability(context, "finance.entries.confirm")) return Response.json({ error: "forbidden", capability: "finance.entries.confirm" }, { status: 403 });
      const replay = await idempotentEntry(context.tenantId, idempotencyKey);
      if (replay) return Response.json({ entry: replay.entry, idempotent: true, eventId: replay.event.eventId, readback: { status: "verified", version: replay.entry.version } }, { headers: { "cache-control": "private, no-store" } });
      const entryId = text(body.entryId, 160);
      const expectedVersion = integer(body.expectedVersion);
      const reason = text(body.reason, 800);
      const current = await findEntry(context.tenantId, entryId);
      if (!current) throw new Error("finance_entry_not_found");
      if (current.version !== expectedVersion) throw new Error("finance_entry_version_conflict");
      if (current.status !== "CONFIRMED" || reason.length < 4) throw new Error("finance_entry_not_reversible");
      const now = new Date().toISOString();
      const nextVersion = current.version + 1;
      const eventId = crypto.randomUUID();
      await getDb().batch([
        getDb().update(financeEntries).set({ status: "REVERSED", version: nextVersion, reversedBy: context.actorId, reversedAt: now, reversalReason: reason, updatedAt: now }).where(and(eq(financeEntries.tenantId, context.tenantId), eq(financeEntries.id, current.id), eq(financeEntries.version, current.version), eq(financeEntries.status, "CONFIRMED"))),
        ...eventStatements({ tenantId: context.tenantId, actorId: context.actorId, eventId, eventType: "finance.entry.reversed", aggregateId: current.id, aggregateVersion: nextVersion, idempotencyKey, payload: { previousStatus: current.status, reason }, now, detail: "Registrazione stornata esplicitamente; originale, autore e motivazione restano leggibili." }),
      ] as unknown as Parameters<ReturnType<typeof getDb>["batch"]>[0]);
      const entry = await entryReadback(context.tenantId, current.id);
      if (!entry || entry.status !== "REVERSED") throw new Error("finance_entry_readback_unavailable");
      return Response.json({ entry, idempotent: false, eventId, readback: { status: "verified", version: entry.version } }, { headers: { "cache-control": "private, no-store" } });
    }

    if (action === "relate") {
      if (!hasCapability(context, "finance.reconcile")) return Response.json({ error: "forbidden", capability: "finance.reconcile" }, { status: 403 });
      const entryId = text(body.entryId, 160);
      const relationType = text(body.relationType, 50).toUpperCase();
      const relatedEntityType = text(body.relatedEntityType, 50).toUpperCase();
      const relatedEntityId = text(body.relatedEntityId, 160);
      if (!isFinanceRelationType(relationType) || !relatedEntityType || !relatedEntityId) throw new Error("finance_relation_invalid");
      const source = await findEntry(context.tenantId, entryId);
      if (!source) throw new Error("finance_entry_not_found");
      let relatedAmount = amountMinor(body.amountMinor, body.amount);
      let resolvesCashIssue = false;
      let purchaseOrderDifference: { invoiceAmountMinor: number; commitmentAmountMinor: number; matchedAmountMinor: number } | null = null;
      let related: typeof financeEntries.$inferSelect | null = null;
      if (relatedEntityType === "FINANCE_ENTRY") {
        related = await findEntry(context.tenantId, relatedEntityId);
        if (!related) throw new Error("finance_related_entry_not_found");
      } else if (relatedEntityType === "W10_PROCUREMENT") {
        const [workflow] = await getDb().select().from(w10Workflows).where(and(
          eq(w10Workflows.tenantId, context.tenantId),
          eq(w10Workflows.id, relatedEntityId),
          eq(w10Workflows.module, "procurement"),
        )).limit(1);
        if (!workflow) throw new Error("finance_procurement_workflow_not_found");
      } else if (!['FINANCE_DOCUMENT', 'DELIVERY_NOTE'].includes(relatedEntityType)) {
        throw new Error("finance_related_entity_type_invalid");
      }
      if (relationType === "SETTLES") {
        if (!related || source.status !== "CONFIRMED" || related.status !== "CONFIRMED" || !["PAYMENT", "RECEIPT"].includes(source.entryType) || !["SUPPLIER_INVOICE", "CUSTOMER_INVOICE"].includes(related.documentRole ?? "") || source.currency !== related.currency) throw new Error("finance_settlement_relation_invalid");
        if ((source.entryType === "PAYMENT") !== (related.documentRole === "SUPPLIER_INVOICE")) throw new Error("finance_settlement_direction_invalid");
        if (relatedAmount === null || relatedAmount <= 0) throw new Error("finance_settlement_amount_invalid");
        const existingRelations = await getDb().select().from(financeEntryRelations).where(and(eq(financeEntryRelations.tenantId, context.tenantId), eq(financeEntryRelations.relationType, "SETTLES"), eq(financeEntryRelations.status, "CONFIRMED")));
        const sourceApplied = existingRelations.filter((relation) => relation.entryId === source.id).reduce((sum, relation) => sum + (relation.amountMinor ?? 0), 0);
        const targetApplied = existingRelations.filter((relation) => relation.relatedEntityType === "FINANCE_ENTRY" && relation.relatedEntityId === related!.id).reduce((sum, relation) => sum + (relation.amountMinor ?? 0), 0);
        if (sourceApplied + relatedAmount > source.amountMinor || targetApplied + relatedAmount > related.amountMinor) throw new Error("finance_settlement_already_applied");
        resolvesCashIssue = sourceApplied + relatedAmount === source.amountMinor;
      } else if (relationType === "MATCHES_PURCHASE_ORDER") {
        if (!related || source.status !== "CONFIRMED" || related.status !== "CONFIRMED" || source.entryType !== "EXPENSE" || source.documentRole !== "SUPPLIER_INVOICE" || related.entryType !== "COMMITMENT" || source.currency !== related.currency) throw new Error("finance_purchase_order_match_invalid");
        if (relatedAmount === null || relatedAmount <= 0) throw new Error("finance_relation_amount_invalid");
        const existingRelations = await getDb().select().from(financeEntryRelations).where(and(eq(financeEntryRelations.tenantId, context.tenantId), eq(financeEntryRelations.relationType, "MATCHES_PURCHASE_ORDER"), eq(financeEntryRelations.status, "CONFIRMED")));
        const invoiceApplied = existingRelations.filter((relation) => relation.entryId === source.id).reduce((sum, relation) => sum + (relation.amountMinor ?? 0), 0);
        const commitmentApplied = existingRelations.filter((relation) => relation.relatedEntityType === "FINANCE_ENTRY" && relation.relatedEntityId === related!.id).reduce((sum, relation) => sum + (relation.amountMinor ?? 0), 0);
        if (invoiceApplied + relatedAmount > source.amountMinor || commitmentApplied + relatedAmount > related.amountMinor) throw new Error("finance_purchase_order_match_already_applied");
        if (source.amountMinor !== related.amountMinor || relatedAmount !== source.amountMinor || relatedAmount !== related.amountMinor) {
          purchaseOrderDifference = { invoiceAmountMinor: source.amountMinor, commitmentAmountMinor: related.amountMinor, matchedAmountMinor: relatedAmount };
        }
      } else if (relationType === "ADJUSTS") {
        if (!related || !["PENDING_APPROVAL", "CONFIRMED"].includes(source.status) || related.status !== "CONFIRMED" || source.documentRole !== "CREDIT_NOTE" || source.effectSign !== -1 || related.effectSign !== 1 || source.entryType !== related.entryType || source.currency !== related.currency) throw new Error("finance_credit_note_relation_invalid");
        if (relatedAmount === null || relatedAmount <= 0 || relatedAmount > source.amountMinor || relatedAmount > related.amountMinor) throw new Error("finance_relation_amount_invalid");
      } else {
        relatedAmount = relatedAmount && relatedAmount > 0 ? relatedAmount : null;
      }
      const [existing] = await getDb().select().from(financeEntryRelations).where(and(
        eq(financeEntryRelations.tenantId, context.tenantId),
        eq(financeEntryRelations.entryId, entryId),
        eq(financeEntryRelations.relationType, relationType),
        eq(financeEntryRelations.relatedEntityType, relatedEntityType),
        eq(financeEntryRelations.relatedEntityId, relatedEntityId),
      )).limit(1);
      if (existing) return Response.json({ relation: existing, idempotent: true, readback: { status: "verified", version: existing.version } }, { headers: { "cache-control": "private, no-store" } });
      const now = new Date().toISOString();
      const relationId = `FIN-REL-${crypto.randomUUID()}`;
      const eventId = crypto.randomUUID();
      const [creditIssue] = relationType === "ADJUSTS" ? await getDb().select().from(financeReconciliationIssues).where(and(
        eq(financeReconciliationIssues.tenantId, context.tenantId),
        eq(financeReconciliationIssues.subjectType, "FINANCE_ENTRY"),
        eq(financeReconciliationIssues.subjectId, source.id),
        eq(financeReconciliationIssues.issueCode, "CREDIT_NOTE_ORIGINAL_REQUIRED"),
        eq(financeReconciliationIssues.status, "OPEN"),
      )).limit(1) : [];
      const [cashIssue] = relationType === "SETTLES" && resolvesCashIssue ? await getDb().select().from(financeReconciliationIssues).where(and(
        eq(financeReconciliationIssues.tenantId, context.tenantId),
        eq(financeReconciliationIssues.subjectType, "FINANCE_ENTRY"),
        eq(financeReconciliationIssues.subjectId, source.id),
        eq(financeReconciliationIssues.issueCode, "UNLINKED_CASH_MOVEMENT"),
        eq(financeReconciliationIssues.status, "OPEN"),
      )).limit(1) : [];
      const relationIssue = creditIssue ?? cashIssue;
      await getDb().batch([
        getDb().insert(financeEntryRelations).values({ id: relationId, tenantId: context.tenantId, entryId, relationType, relatedEntityType, relatedEntityId, amountMinor: relatedAmount, currency: relatedAmount ? source.currency : null, status: "CONFIRMED", version: 1, idempotencyKey, createdBy: context.actorId, createdAt: now, updatedAt: now }),
        ...(purchaseOrderDifference ? [getDb().insert(financeReconciliationIssues).values({
          id: `FIN-ISS-${crypto.randomUUID()}`,
          tenantId: context.tenantId,
          issueCode: "ORDER_INVOICE_AMOUNT_DIFFERENCE",
          severity: "WARNING",
          subjectType: "FINANCE_ENTRY",
          subjectId: source.id,
          relatedEntityType: "FINANCE_ENTRY",
          relatedEntityId,
          status: "OPEN",
          detailJson: JSON.stringify(purchaseOrderDifference),
          version: 1,
          idempotencyKey: `${idempotencyKey}:amount-difference`,
          createdBy: context.actorId,
          createdAt: now,
          updatedAt: now,
        })] : []),
        ...(relationIssue ? [getDb().update(financeReconciliationIssues).set({ status: "RESOLVED", version: relationIssue.version + 1, resolvedBy: context.actorId, resolvedAt: now, detailJson: JSON.stringify({ ...parsedObject(relationIssue.detailJson), resolution: relationType === "ADJUSTS" ? "Nota di credito collegata esplicitamente alla registrazione originaria." : "Movimento di cassa collegato esplicitamente alla fattura.", relationId }), updatedAt: now }).where(and(eq(financeReconciliationIssues.tenantId, context.tenantId), eq(financeReconciliationIssues.id, relationIssue.id), eq(financeReconciliationIssues.version, relationIssue.version), eq(financeReconciliationIssues.status, "OPEN")))] : []),
        ...eventStatements({ tenantId: context.tenantId, actorId: context.actorId, eventId, eventType: "finance.entry.relation.confirmed", aggregateType: "finance.entry.relation", aggregateId: relationId, aggregateVersion: 1, idempotencyKey, payload: { relationId, sourceEntryId: entryId, relationType, relatedEntityType, relatedEntityId, amountMinor: relatedAmount }, now, detail: "Relazione di riconciliazione registrata senza modificare i fatti collegati." }),
      ] as unknown as Parameters<ReturnType<typeof getDb>["batch"]>[0]);
      const [relation] = await getDb().select().from(financeEntryRelations).where(and(eq(financeEntryRelations.tenantId, context.tenantId), eq(financeEntryRelations.id, relationId))).limit(1);
      if (!relation) throw new Error("finance_relation_readback_unavailable");
      return Response.json({ relation, idempotent: false, eventId, readback: { status: "verified", version: relation.version } }, { status: 201, headers: { "cache-control": "private, no-store" } });
    }

    if (action === "resolve_issue") {
      if (!hasCapability(context, "finance.reconcile")) return Response.json({ error: "forbidden", capability: "finance.reconcile" }, { status: 403 });
      const [priorEvent] = await getDb().select().from(s06Events).where(and(eq(s06Events.tenantId, context.tenantId), eq(s06Events.idempotencyKey, idempotencyKey))).limit(1);
      if (priorEvent) {
        if (priorEvent.aggregateType !== "finance.reconciliation.issue") throw new Error("finance_issue_idempotency_conflict");
        const [priorIssue] = await getDb().select().from(financeReconciliationIssues).where(and(eq(financeReconciliationIssues.tenantId, context.tenantId), eq(financeReconciliationIssues.id, priorEvent.aggregateId))).limit(1);
        if (!priorIssue) throw new Error("finance_issue_readback_unavailable");
        return Response.json({ issue: priorIssue, idempotent: true, eventId: priorEvent.eventId, readback: { status: "verified", version: priorIssue.version } }, { headers: { "cache-control": "private, no-store" } });
      }
      const issueId = text(body.issueId, 160);
      const expectedVersion = integer(body.expectedVersion);
      const resolution = text(body.resolution, 800);
      const [issue] = await getDb().select().from(financeReconciliationIssues).where(and(eq(financeReconciliationIssues.tenantId, context.tenantId), eq(financeReconciliationIssues.id, issueId))).limit(1);
      if (!issue) throw new Error("finance_issue_not_found");
      if (issue.version !== expectedVersion || issue.status !== "OPEN") throw new Error("finance_issue_version_conflict");
      if (["CREDIT_NOTE_ORIGINAL_REQUIRED", "UNLINKED_CASH_MOVEMENT"].includes(issue.issueCode)) throw new Error("finance_issue_requires_relation");
      if (resolution.length < 4) throw new Error("finance_issue_resolution_required");
      const now = new Date().toISOString();
      const nextVersion = issue.version + 1;
      const eventId = crypto.randomUUID();
      await getDb().batch([
        getDb().update(financeReconciliationIssues).set({ status: "RESOLVED", version: nextVersion, resolvedBy: context.actorId, resolvedAt: now, detailJson: JSON.stringify({ ...parsedObject(issue.detailJson), resolution }), updatedAt: now }).where(and(eq(financeReconciliationIssues.tenantId, context.tenantId), eq(financeReconciliationIssues.id, issue.id), eq(financeReconciliationIssues.version, issue.version), eq(financeReconciliationIssues.status, "OPEN"))),
        ...eventStatements({ tenantId: context.tenantId, actorId: context.actorId, eventId, eventType: "finance.reconciliation.issue.resolved", aggregateType: "finance.reconciliation.issue", aggregateId: issue.id, aggregateVersion: nextVersion, idempotencyKey, payload: { issueCode: issue.issueCode, resolution }, now, detail: "Segnalazione di riconciliazione risolta esplicitamente e riletta." }),
      ] as unknown as Parameters<ReturnType<typeof getDb>["batch"]>[0]);
      const [readback] = await getDb().select().from(financeReconciliationIssues).where(and(eq(financeReconciliationIssues.tenantId, context.tenantId), eq(financeReconciliationIssues.id, issue.id))).limit(1);
      if (!readback || readback.status !== "RESOLVED") throw new Error("finance_issue_readback_unavailable");
      return Response.json({ issue: readback, idempotent: false, eventId, readback: { status: "verified", version: readback.version } }, { headers: { "cache-control": "private, no-store" } });
    }

    return Response.json({ error: "finance_entry_action_invalid" }, { status: 400 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "finance_entry_write_unavailable";
    if (/UNIQUE|constraint/i.test(code)) return Response.json({ error: "finance_entry_conflict" }, { status: 409 });
    return Response.json({ error: code }, { status: statusForError(code), headers: { "cache-control": "private, no-store" } });
  }
}
