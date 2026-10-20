import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  financeDocumentExtractions,
  financeDocumentLinks,
  financeDocumentReviews,
  financeDocuments,
  financeEntries,
  financeEntryAllocations,
  financeReconciliationIssues,
  s06Events,
  s06Outbox,
  s06Reconciliations,
} from "@/db/schema";
import { getAuthorityContext, hasCapability } from "@/lib/authority-context";
import { FINANCE_EXTRACTED_DOCUMENT_TYPES } from "@/lib/finance-document-extraction-contract";
import {
  allowedTreatmentsForClassification,
  decimalToMinor,
  documentRoleForClassification,
  effectSignForClassification,
  isFinanceCostCategory,
  isFinanceEconomicTreatment,
  isFinanceValuationBasis,
  isIsoCurrency,
  isIsoDate,
  minorToDecimal,
} from "@/lib/finance-ledger-contract";
import { financeEntryResponse, resolveFinanceJobs } from "@/lib/finance-ledger.server";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ documentId: string }> };
type JsonObject = Record<string, unknown>;

function text(value: unknown, max = 500) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max)
    : "";
}

function integer(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function objectValue(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function reviewedField(value: unknown, kind: "text" | "date" | "currency" | "amount" = "text") {
  const normalized = text(value, kind === "text" ? 600 : 40);
  if (!normalized) return "";
  if (kind === "date") return isIsoDate(normalized) ? normalized : "";
  if (kind === "currency") return isIsoCurrency(normalized.toUpperCase()) ? normalized.toUpperCase() : "";
  if (kind === "amount") {
    const minor = decimalToMinor(normalized);
    return minor === null ? "" : minorToDecimal(minor);
  }
  return normalized;
}

function parseReviewedFields(value: unknown) {
  const fields = objectValue(value);
  return {
    counterpartyName: reviewedField(fields.counterpartyName),
    counterpartyTaxId: reviewedField(fields.counterpartyTaxId),
    documentNumber: reviewedField(fields.documentNumber),
    documentDate: reviewedField(fields.documentDate, "date"),
    dueDate: reviewedField(fields.dueDate, "date"),
    currencyCode: reviewedField(fields.currencyCode, "currency"),
    netAmount: reviewedField(fields.netAmount, "amount"),
    vatAmount: reviewedField(fields.vatAmount, "amount"),
    grossAmount: reviewedField(fields.grossAmount, "amount"),
    economicAmount: reviewedField(fields.economicAmount, "amount"),
    description: reviewedField(fields.description),
  };
}

function selectedAmountMinor(fields: ReturnType<typeof parseReviewedFields>, basis: string) {
  if (basis === "NET") return decimalToMinor(fields.netAmount);
  if (basis === "GROSS" || basis === "DOCUMENT_TOTAL") return decimalToMinor(fields.grossAmount);
  return decimalToMinor(fields.economicAmount);
}

function parseAllocations(value: unknown) {
  if (!Array.isArray(value)) return [];
  if (value.length > 24) throw new Error("finance_job_allocation_limit");
  return value.map((candidate) => {
    const row = objectValue(candidate);
    const jobId = text(row.jobId, 160);
    const amountMinor = integer(row.amountMinor) ?? decimalToMinor(row.amount);
    if (!jobId || amountMinor === null || amountMinor <= 0) throw new Error("finance_allocation_invalid");
    return { jobId, amountMinor };
  });
}

function parseJobIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  const jobIds = [...new Set(value.map((candidate) => text(candidate, 160)).filter(Boolean))];
  if (jobIds.length > 24) throw new Error("finance_job_link_limit");
  return jobIds;
}

async function replay(tenantId: string, idempotencyKey: string) {
  const db = getDb();
  const [event] = await db.select().from(s06Events).where(and(
    eq(s06Events.tenantId, tenantId),
    eq(s06Events.idempotencyKey, idempotencyKey),
  )).limit(1);
  if (!event) return null;
  if (event.aggregateType !== "finance.document.review") throw new Error("finance_review_idempotency_conflict");
  const [review] = await db.select().from(financeDocumentReviews).where(and(
    eq(financeDocumentReviews.tenantId, tenantId),
    eq(financeDocumentReviews.id, event.aggregateId),
  )).limit(1);
  if (!review) throw new Error("finance_review_readback_unavailable");
  const [entry] = await db.select().from(financeEntries).where(and(
    eq(financeEntries.tenantId, tenantId),
    eq(financeEntries.sourceType, "DOCUMENT_REVIEW"),
    eq(financeEntries.sourceId, review.id),
  )).limit(1);
  const allocations = entry ? await db.select().from(financeEntryAllocations).where(and(
    eq(financeEntryAllocations.tenantId, tenantId),
    eq(financeEntryAllocations.entryId, entry.id),
  )) : [];
  return { review, entry: entry ? financeEntryResponse(entry, allocations) : null, eventId: event.eventId };
}

export async function POST(request: Request, routeContext: RouteContext) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "finance.documents.review")) {
    return Response.json({ error: "forbidden", capability: "finance.documents.review" }, { status: 403 });
  }

  let documentId = "";
  try { documentId = decodeURIComponent((await routeContext.params).documentId).trim(); } catch { /* validated below */ }
  if (!documentId || documentId.length > 160) return Response.json({ error: "invalid_document_id" }, { status: 400 });

  let body: JsonObject;
  try { body = objectValue(await request.json()); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }
  const rawKey = text(body.idempotencyKey, 140);
  if (rawKey.length < 8) return Response.json({ error: "idempotency_key_invalid" }, { status: 400 });
  const idempotencyKey = `finance-document-review:${rawKey}`;

  try {
    const existing = await replay(context.tenantId, idempotencyKey);
    if (existing) return Response.json({ ...existing, idempotent: true, readback: { status: "verified", version: existing.review.version } }, { headers: { "cache-control": "private, no-store" } });

    const db = getDb();
    const [document] = await db.select().from(financeDocuments).where(and(
      eq(financeDocuments.tenantId, context.tenantId),
      eq(financeDocuments.id, documentId),
    )).limit(1);
    if (!document) return Response.json({ error: "finance_document_not_found" }, { status: 404 });

    const expectedDocumentVersion = integer(body.expectedDocumentVersion);
    if (expectedDocumentVersion !== document.version) return Response.json({ error: "version_conflict", resource: "document", currentVersion: document.version }, { status: 409 });
    const extractionId = text(body.extractionId, 160);
    const [extraction] = await db.select().from(financeDocumentExtractions).where(and(
      eq(financeDocumentExtractions.tenantId, context.tenantId),
      eq(financeDocumentExtractions.documentId, document.id),
      eq(financeDocumentExtractions.id, extractionId),
    )).orderBy(desc(financeDocumentExtractions.createdAt)).limit(1);
    if (!extraction || !["PROPOSED", "REVIEW_REQUIRED"].includes(extraction.status)) {
      return Response.json({ error: "finance_document_proposal_not_reviewable" }, { status: 409 });
    }
    const expectedExtractionVersion = integer(body.expectedExtractionVersion);
    if (expectedExtractionVersion !== extraction.version) return Response.json({ error: "version_conflict", resource: "extraction", currentVersion: extraction.version }, { status: 409 });
    if (extraction.sourceSha256 !== document.sha256 || extraction.sourceDocumentVersion !== document.version) {
      return Response.json({ error: "finance_document_source_changed" }, { status: 409 });
    }

    const decision = text(body.decision, 20).toUpperCase();
    if (decision !== "CONFIRM" && decision !== "REJECT") return Response.json({ error: "finance_review_decision_invalid" }, { status: 400 });
    const classification = text(body.classification, 50).toUpperCase();
    if (!(FINANCE_EXTRACTED_DOCUMENT_TYPES as readonly string[]).includes(classification)) {
      return Response.json({ error: "finance_document_classification_invalid" }, { status: 400 });
    }
    const economicTreatment = text(body.economicTreatment, 40).toUpperCase();
    if (!isFinanceEconomicTreatment(economicTreatment) || !allowedTreatmentsForClassification(classification).includes(economicTreatment)) {
      return Response.json({ error: "finance_economic_treatment_invalid", allowed: allowedTreatmentsForClassification(classification) }, { status: 400 });
    }
    const fields = parseReviewedFields(body.fields);
    const reviewNote = text(body.reviewNote, 800);
    const categoryCandidate = text(body.costCategory, 40).toUpperCase() || "OTHER";
    if (!isFinanceCostCategory(categoryCandidate)) return Response.json({ error: "finance_cost_category_invalid" }, { status: 400 });
    const valuationBasis = text(body.valuationBasis, 30).toUpperCase() || "EXPLICIT";
    if (!isFinanceValuationBasis(valuationBasis)) return Response.json({ error: "finance_valuation_basis_invalid" }, { status: 400 });
    const allocations = parseAllocations(body.allocations);
    const requestedJobIds = parseJobIds(body.jobIds);
    const jobs = await resolveFinanceJobs(context.tenantId, [...requestedJobIds, ...allocations.map((allocation) => allocation.jobId)]);
    if (new Set(allocations.map((allocation) => allocation.jobId)).size !== allocations.length) {
      return Response.json({ error: "finance_allocation_duplicate_job" }, { status: 400 });
    }

    const createsEntry = decision === "CONFIRM" && economicTreatment !== "DOCUMENT_ONLY";
    const [existingDocumentEntry] = createsEntry ? await db.select().from(financeEntries).where(and(
      eq(financeEntries.tenantId, context.tenantId),
      eq(financeEntries.sourceDocumentId, document.id),
    )).orderBy(desc(financeEntries.updatedAt)).limit(1) : [];
    if (existingDocumentEntry && existingDocumentEntry.status !== "REVERSED") {
      return Response.json({ error: "finance_document_economic_entry_exists", entryId: existingDocumentEntry.id, status: existingDocumentEntry.status }, { status: 409 });
    }
    const amountMinor = createsEntry ? selectedAmountMinor(fields, valuationBasis) : null;
    if (createsEntry && (amountMinor === null || amountMinor <= 0)) return Response.json({ error: "finance_economic_amount_required" }, { status: 400 });
    if (createsEntry && !fields.currencyCode) return Response.json({ error: "finance_currency_required" }, { status: 400 });
    if (createsEntry && !fields.documentDate) return Response.json({ error: "finance_economic_date_required" }, { status: 400 });
    const allocationTotal = allocations.reduce((sum, allocation) => sum + allocation.amountMinor, 0);
    if (!Number.isSafeInteger(allocationTotal) || (allocations.length > 0 && allocationTotal !== amountMinor)) {
      return Response.json({ error: "finance_allocation_total_mismatch", expectedAmountMinor: amountMinor, actualAmountMinor: allocationTotal }, { status: 422 });
    }

    const reviewId = `FIN-REV-${crypto.randomUUID()}`;
    const entryId = createsEntry ? `FIN-ENT-${crypto.randomUUID()}` : null;
    const now = new Date().toISOString();
    const eventId = crypto.randomUUID();
    const reviewStatus = decision === "CONFIRM" ? "CONFIRMED" : "REJECTED";
    const documentRole = documentRoleForClassification(classification);
    const effectSign = effectSignForClassification(classification);
    const reviewedFieldsJson = JSON.stringify({ ...fields, allocations, jobIds: jobs.map((job) => job.id) });

    const duplicate = createsEntry && fields.documentNumber
      ? (await db.select().from(financeEntries).where(eq(financeEntries.tenantId, context.tenantId)).limit(2_000)).find((candidate) =>
        candidate.status !== "REVERSED"
        && candidate.documentRole === documentRole
        && candidate.documentNumber.toLocaleUpperCase("it-IT") === fields.documentNumber.toLocaleUpperCase("it-IT")
        && (fields.counterpartyTaxId
          ? candidate.counterpartyTaxId.toLocaleUpperCase("it-IT") === fields.counterpartyTaxId.toLocaleUpperCase("it-IT")
          : candidate.counterpartyName.toLocaleUpperCase("it-IT") === fields.counterpartyName.toLocaleUpperCase("it-IT")),
      ) ?? null
      : null;

    const reviewInsert = db.insert(financeDocumentReviews).values({
      id: reviewId,
      tenantId: context.tenantId,
      documentId: document.id,
      extractionId: extraction.id,
      sourceSha256: document.sha256,
      sourceDocumentVersion: document.version,
      extractionVersion: extraction.version,
      classification,
      reviewedFieldsJson,
      economicTreatment,
      status: reviewStatus,
      reviewNote,
      version: 1,
      idempotencyKey,
      reviewedBy: context.actorId,
      createdAt: now,
    });
    const eventInsert = db.insert(s06Events).values({
      eventId,
      tenantId: context.tenantId,
      eventType: decision === "CONFIRM" ? "finance.document.review.confirmed" : "finance.document.review.rejected",
      schemaVersion: "1",
      actorType: "human",
      actorId: context.actorId,
      source: "sites-finance-document-review",
      occurredAt: now,
      observedAt: now,
      aggregateType: "finance.document.review",
      aggregateId: reviewId,
      aggregateVersion: 1,
      payloadJson: JSON.stringify({ documentId: document.id, extractionId: extraction.id, classification, economicTreatment, entryId, jobIds: jobs.map((job) => job.id), duplicateCandidateId: duplicate?.id ?? null }),
      correlationId: crypto.randomUUID(),
      causationId: extraction.id,
      idempotencyKey,
      status: "COMMITTED_SITES_READBACK",
      createdAt: now,
    });
    const statements = [
      reviewInsert,
      ...jobs.map((job, index) => db.insert(financeDocumentLinks).values({
        id: `FIN-LNK-${crypto.randomUUID()}`,
        tenantId: context.tenantId,
        documentId: document.id,
        entityType: "JOB",
        entityId: job.id,
        status: "CONFIRMED",
        source: "HUMAN_REVIEW",
        version: 1,
        idempotencyKey: `${idempotencyKey}:job:${index}`,
        createdBy: context.actorId,
        confirmedBy: context.actorId,
        createdAt: now,
        updatedAt: now,
      }).onConflictDoNothing()),
      ...(createsEntry && entryId && amountMinor !== null ? [db.insert(financeEntries).values({
        id: entryId,
        tenantId: context.tenantId,
        entryType: economicTreatment,
        documentRole,
        category: categoryCandidate,
        description: fields.description || `${classification.replaceAll("_", " ")} ${fields.documentNumber}`.trim(),
        amountMinor,
        effectSign,
        netAmountMinor: decimalToMinor(fields.netAmount),
        taxAmountMinor: decimalToMinor(fields.vatAmount),
        grossAmountMinor: decimalToMinor(fields.grossAmount),
        currency: fields.currencyCode,
        valuationBasis,
        economicDate: fields.documentDate,
        dueDate: fields.dueDate || null,
        counterpartyName: fields.counterpartyName,
        counterpartyTaxId: fields.counterpartyTaxId,
        counterpartyVerification: fields.counterpartyName ? "HUMAN_CONFIRMED" : "UNVERIFIED",
        documentNumber: fields.documentNumber,
        sourceType: "DOCUMENT_REVIEW",
        sourceId: reviewId,
        sourceDocumentId: document.id,
        status: "PENDING_APPROVAL",
        version: 1,
        idempotencyKey: `${idempotencyKey}:entry`,
        preparedBy: context.actorId,
        createdAt: now,
        updatedAt: now,
      })] : []),
      ...(entryId ? allocations.map((allocation, index) => db.insert(financeEntryAllocations).values({
        id: `FIN-ALL-${crypto.randomUUID()}`,
        tenantId: context.tenantId,
        entryId,
        jobId: allocation.jobId,
        amountMinor: allocation.amountMinor,
        currency: fields.currencyCode,
        status: "ACTIVE",
        version: 1,
        idempotencyKey: `${idempotencyKey}:allocation:${index}`,
        createdBy: context.actorId,
        createdAt: now,
        updatedAt: now,
      })) : []),
      ...(duplicate && entryId ? [db.insert(financeReconciliationIssues).values({
        id: `FIN-ISS-${crypto.randomUUID()}`,
        tenantId: context.tenantId,
        issueCode: "POSSIBLE_DUPLICATE_DOCUMENT_NUMBER",
        severity: "BLOCKING",
        subjectType: "FINANCE_ENTRY",
        subjectId: entryId,
        relatedEntityType: "FINANCE_ENTRY",
        relatedEntityId: duplicate.id,
        status: "OPEN",
        detailJson: JSON.stringify({ documentNumber: fields.documentNumber, documentRole, counterpartyName: fields.counterpartyName, counterpartyTaxId: fields.counterpartyTaxId }),
        version: 1,
        idempotencyKey: `${idempotencyKey}:duplicate`,
        createdBy: context.actorId,
        createdAt: now,
        updatedAt: now,
      })] : []),
      ...(effectSign === -1 && entryId ? [db.insert(financeReconciliationIssues).values({
        id: `FIN-ISS-${crypto.randomUUID()}`,
        tenantId: context.tenantId,
        issueCode: "CREDIT_NOTE_ORIGINAL_REQUIRED",
        severity: "BLOCKING",
        subjectType: "FINANCE_ENTRY",
        subjectId: entryId,
        relatedEntityType: null,
        relatedEntityId: null,
        status: "OPEN",
        detailJson: JSON.stringify({ classification, documentNumber: fields.documentNumber, requiredRelation: "ADJUSTS" }),
        version: 1,
        idempotencyKey: `${idempotencyKey}:credit-note-origin`,
        createdBy: context.actorId,
        createdAt: now,
        updatedAt: now,
      })] : []),
      eventInsert,
      db.insert(s06Outbox).values({ id: crypto.randomUUID(), tenantId: context.tenantId, eventId, topic: "zerow.finance.document.reviewed", status: "PENDING_EXTERNAL_CONSUMER", attempts: 0, createdAt: now, updatedAt: now }),
      db.insert(s06Reconciliations).values({ id: crypto.randomUUID(), tenantId: context.tenantId, aggregateType: "finance.document.review", aggregateId: reviewId, expectedVersion: 1, observedVersion: 1, status: "SITES_READBACK_VERIFIED", detail: createsEntry ? "Revisione riletta; fatto economico preparato in attesa di approvazione indipendente." : "Revisione documentale riletta; nessun fatto economico creato.", createdAt: now, updatedAt: now }),
    ];
    await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);

    const result = await replay(context.tenantId, idempotencyKey);
    if (!result || result.review.sourceSha256 !== document.sha256 || (createsEntry && !result.entry)) {
      return Response.json({ error: "finance_review_readback_unavailable" }, { status: 503 });
    }
    return Response.json({ ...result, idempotent: false, duplicateWarning: duplicate ? { code: "POSSIBLE_DUPLICATE_DOCUMENT_NUMBER", relatedEntryId: duplicate.id } : null, readback: { status: "verified", version: result.review.version } }, { status: 201, headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "finance_review_unavailable";
    if (code === "finance_job_not_found") return Response.json({ error: code }, { status: 404 });
    if (["finance_job_allocation_limit", "finance_job_link_limit", "finance_allocation_invalid", "finance_allocation_total_mismatch", "finance_economic_amount_required", "finance_currency_required", "finance_economic_date_required"].includes(code)) return Response.json({ error: code }, { status: 422 });
    if (/idempotency_conflict|UNIQUE|constraint/i.test(code)) return Response.json({ error: "finance_review_conflict" }, { status: 409 });
    return Response.json({ error: "finance_review_unavailable" }, { status: 503 });
  }
}
