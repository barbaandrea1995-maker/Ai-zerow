import { env } from "cloudflare:workers";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import {
  financeDocumentExtractions,
  financeDocuments,
  s04Records,
  s06Events,
  s06Outbox,
  s06Reconciliations,
} from "@/db/schema";
import { getAuthorityContext, hasCapability } from "@/lib/authority-context";
import { CompanyAiFinanceExtractionError, isOpenAiFinanceExtractionConfigured, proposeFinanceDocumentExtraction } from "@/lib/company-ai-finance-document.server";
import { buildFinanceDocumentProposal } from "@/lib/finance-document-extraction-contract";
import { ensureFinanceDocumentSchema } from "@/lib/finance-document-schema.server";
import { safeDocumentFileName, sha256Hex } from "@/lib/document-contract";
import { documentCanDownload } from "@/lib/document-security";
import { isNutrientFinanceExtractionConfigured, NutrientFinanceExtractionError, parseFinanceDocumentWithNutrient } from "@/lib/nutrient-finance-document.server";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ documentId: string }> };
type ExtractionRow = typeof financeDocumentExtractions.$inferSelect;

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseObject(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function extractionResponse(row: ExtractionRow) {
  return {
    id: row.id,
    documentId: row.documentId,
    sourceSha256: row.sourceSha256,
    sourceDocumentVersion: row.sourceDocumentVersion,
    status: row.status,
    proposal: row.extractionJson ? parseObject(row.extractionJson) : null,
    providers: parseObject(row.providerMetadataJson),
    failureCode: row.failureCode,
    version: row.version,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function findByIdempotency(tenantId: string, idempotencyKey: string) {
  const [row] = await getDb().select().from(financeDocumentExtractions).where(and(
    eq(financeDocumentExtractions.tenantId, tenantId),
    eq(financeDocumentExtractions.idempotencyKey, idempotencyKey),
  )).limit(1);
  return row ?? null;
}

function eventRows({
  tenantId,
  extractionId,
  version,
  actorId,
  status,
  idempotencyKey,
  payload,
  detail,
  now,
}: {
  tenantId: string;
  extractionId: string;
  version: number;
  actorId: string;
  status: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  detail: string;
  now: string;
}) {
  const eventId = crypto.randomUUID();
  return {
    eventId,
    event: getDb().insert(s06Events).values({
      eventId,
      tenantId,
      eventType: `finance.documents.ai_extraction.${status.toLowerCase()}`,
      schemaVersion: "1",
      actorType: "human",
      actorId,
      source: "company-ai-finance-document-analysis",
      occurredAt: now,
      observedAt: now,
      aggregateType: "finance.document.extraction",
      aggregateId: extractionId,
      aggregateVersion: version,
      payloadJson: JSON.stringify(payload),
      correlationId: crypto.randomUUID(),
      causationId: null,
      idempotencyKey,
      status: "COMMITTED_SITES_READBACK",
      createdAt: now,
    }),
    outbox: getDb().insert(s06Outbox).values({
      id: crypto.randomUUID(),
      tenantId,
      eventId,
      topic: `zerow.finance.documents.ai_extraction.${status.toLowerCase()}`,
      status: "PENDING_EXTERNAL_CONSUMER",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    }),
    reconciliation: getDb().insert(s06Reconciliations).values({
      id: crypto.randomUUID(),
      tenantId,
      aggregateType: "finance.document.extraction",
      aggregateId: extractionId,
      expectedVersion: version - 1,
      observedVersion: version,
      status,
      detail,
      createdAt: now,
      updatedAt: now,
    }),
  };
}

function safeProviderFailure(error: unknown) {
  if (error instanceof NutrientFinanceExtractionError || error instanceof CompanyAiFinanceExtractionError) return error.code;
  return "finance_document_ai_provider_unavailable";
}

async function jobCatalog(tenantId: string) {
  const rows = await getDb().select().from(s04Records).where(and(
    eq(s04Records.tenantId, tenantId),
    eq(s04Records.module, "operations"),
    eq(s04Records.recordType, "job"),
  )).orderBy(desc(s04Records.updatedAt)).limit(160);
  return rows.map((row) => {
    const payload = parseObject(row.payloadJson);
    return {
      id: row.id,
      code: row.canonicalCode || null,
      title: text(payload.title) || row.title,
    };
  });
}

export async function POST(request: Request, routeContext: RouteContext) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "finance.write")) {
    return Response.json({ error: "forbidden", capability: "finance.write" }, { status: 403 });
  }

  let documentId = "";
  try {
    documentId = decodeURIComponent((await routeContext.params).documentId).trim();
  } catch {
    return Response.json({ error: "invalid_document_id" }, { status: 400 });
  }
  if (!documentId || documentId.length > 120) return Response.json({ error: "invalid_document_id" }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return Response.json({ error: "invalid_json" }, { status: 400 });
    body = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (body.externalProcessingConsent !== true) {
    return Response.json({ error: "external_processing_consent_required" }, { status: 400 });
  }
  const rawKey = text(body.idempotencyKey);
  if (rawKey.length < 8 || rawKey.length > 140) return Response.json({ error: "idempotency_key_invalid" }, { status: 400 });
  const idempotencyKey = `finance-document-analysis:${rawKey}`;

  if (!env.BUCKET) return Response.json({ error: "object_storage_not_configured" }, { status: 503 });
  if (!isNutrientFinanceExtractionConfigured()) return Response.json({ error: "nutrient_not_configured" }, { status: 503 });
  if (!isOpenAiFinanceExtractionConfigured()) return Response.json({ error: "openai_not_configured" }, { status: 503 });

  try {
    await ensureFinanceDocumentSchema();
    const db = getDb();
    const [document] = await db.select().from(financeDocuments).where(and(
      eq(financeDocuments.tenantId, context.tenantId),
      eq(financeDocuments.id, documentId),
    )).limit(1);
    if (!document) return Response.json({ error: "finance_document_not_found" }, { status: 404 });

    const idempotent = await findByIdempotency(context.tenantId, idempotencyKey);
    if (idempotent) {
      if (idempotent.documentId !== document.id || idempotent.sourceSha256 !== document.sha256) {
        return Response.json({ error: "finance_document_analysis_idempotency_conflict" }, { status: 409 });
      }
      return Response.json({ extraction: extractionResponse(idempotent), idempotent: true, readback: { status: "verified", version: idempotent.version } }, {
        status: idempotent.status === "PROCESSING" ? 202 : idempotent.status === "FAILED" ? 502 : 200,
        headers: { "cache-control": "private, no-store" },
      });
    }

    const [previousProposal] = await db.select().from(financeDocumentExtractions).where(and(
      eq(financeDocumentExtractions.tenantId, context.tenantId),
      eq(financeDocumentExtractions.documentId, document.id),
      eq(financeDocumentExtractions.sourceSha256, document.sha256),
      inArray(financeDocumentExtractions.status, ["PROCESSING", "PROPOSED", "REVIEW_REQUIRED"]),
    )).orderBy(desc(financeDocumentExtractions.createdAt)).limit(1);
    if (previousProposal) {
      return Response.json({ extraction: extractionResponse(previousProposal), existingProposal: true, readback: { status: "verified", version: previousProposal.version } }, {
        status: previousProposal.status === "PROCESSING" ? 202 : 200,
        headers: { "cache-control": "private, no-store" },
      });
    }

    const object = await env.BUCKET.get(document.objectKey);
    if (!object || object.size !== document.sizeBytes) return Response.json({ error: "finance_document_object_unavailable" }, { status: 503 });
    const bytes = await object.arrayBuffer();
    const actualHash = await sha256Hex(bytes);
    if (actualHash !== document.sha256) return Response.json({ error: "finance_document_hash_mismatch" }, { status: 409 });

    const extractionId = `FIN-EXT-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const requestEvent = eventRows({
      tenantId: context.tenantId,
      extractionId,
      version: 1,
      actorId: context.actorId,
      status: "REQUESTED",
      idempotencyKey: `${idempotencyKey}:requested`,
      payload: {
        documentId: document.id,
        sourceSha256: document.sha256,
        sourceDocumentVersion: document.version,
        consent: { userInitiated: true, providers: ["nutrient", "openai"] },
      },
      detail: "Analisi richiesta dall’utente. Il file originale mantiene invariati quarantena e stato download.",
      now,
    });
    try {
      await db.batch([
        db.insert(financeDocumentExtractions).values({
          id: extractionId,
          tenantId: context.tenantId,
          documentId: document.id,
          sourceSha256: document.sha256,
          sourceDocumentVersion: document.version,
          status: "PROCESSING",
          extractionJson: null,
          providerMetadataJson: "{}",
          failureCode: null,
          version: 1,
          idempotencyKey,
          createdBy: context.actorId,
          createdAt: now,
          updatedAt: now,
        }),
        requestEvent.event,
        requestEvent.outbox,
        requestEvent.reconciliation,
      ]);
    } catch {
      const replay = await findByIdempotency(context.tenantId, idempotencyKey);
      if (replay) return Response.json({ extraction: extractionResponse(replay), idempotent: true, readback: { status: "verified", version: replay.version } }, { status: 202, headers: { "cache-control": "private, no-store" } });
      const concurrent = await db.select().from(financeDocumentExtractions).where(and(
        eq(financeDocumentExtractions.tenantId, context.tenantId),
        eq(financeDocumentExtractions.documentId, document.id),
        eq(financeDocumentExtractions.sourceSha256, document.sha256),
        inArray(financeDocumentExtractions.status, ["PROCESSING", "PROPOSED", "REVIEW_REQUIRED"]),
      )).orderBy(desc(financeDocumentExtractions.createdAt)).limit(1);
      if (concurrent[0]) return Response.json({ extraction: extractionResponse(concurrent[0]), existingProposal: true, readback: { status: "verified", version: concurrent[0].version } }, { status: 202, headers: { "cache-control": "private, no-store" } });
      throw new Error("finance_document_analysis_reservation_failed");
    }

    const jobs = await jobCatalog(context.tenantId);
    let providerMetadata: Record<string, unknown> = {};
    try {
      const nutrient = await parseFinanceDocumentWithNutrient({
        fileName: safeDocumentFileName(document.fileName),
        mimeType: document.mimeType,
        bytes,
      });
      providerMetadata = {
        nutrient: {
          provider: "nutrient",
          operation: "extraction/parse",
          mode: nutrient.mode,
          requestId: nutrient.requestId,
          pagesProcessed: nutrient.pagesProcessed,
          creditsUsed: nutrient.creditsUsed,
        },
      };
      const companyAi = await proposeFinanceDocumentExtraction({
        documentCategory: document.category,
        linkedJobId: document.jobId,
        sources: nutrient.sources,
        jobs,
      });
      providerMetadata = {
        ...providerMetadata,
        companyAi: { provider: "openai", model: companyAi.model, requestId: companyAi.requestId },
      };
      const proposal = buildFinanceDocumentProposal({
        raw: companyAi.raw,
        sources: nutrient.sources,
        uploadedCategory: document.category,
        jobs,
        sourceWasTruncated: nutrient.truncated || companyAi.sourceWasTruncated,
      });
      providerMetadata.companyAi = {
        ...(providerMetadata.companyAi as Record<string, unknown>),
        sourceElementsSent: companyAi.sourceElementsSent,
        sourceTextTruncated: nutrient.truncated || companyAi.sourceWasTruncated,
      };
      const status = proposal.status;
      const nextVersion = 2;
      const completedAt = new Date().toISOString();
      const resultEvent = eventRows({
        tenantId: context.tenantId,
        extractionId,
        version: nextVersion,
        actorId: context.actorId,
        status: status === "PROPOSED" ? "PROPOSED" : "REVIEW_REQUIRED",
        idempotencyKey: `${idempotencyKey}:proposal`,
        payload: {
          documentId: document.id,
          sourceSha256: document.sha256,
          sourceDocumentVersion: document.version,
          proposalStatus: status,
          providerMetadata,
          createsFinanceEntry: false,
        },
        detail: "Proposta strutturata con evidenze Nutrient e Company AI; nessun costo, ricavo o incasso registrato.",
        now: completedAt,
      });
      await db.batch([
        db.update(financeDocumentExtractions).set({
          status,
          extractionJson: JSON.stringify(proposal),
          providerMetadataJson: JSON.stringify(providerMetadata),
          failureCode: null,
          version: nextVersion,
          updatedAt: completedAt,
        }).where(and(
          eq(financeDocumentExtractions.tenantId, context.tenantId),
          eq(financeDocumentExtractions.id, extractionId),
          eq(financeDocumentExtractions.version, 1),
          eq(financeDocumentExtractions.status, "PROCESSING"),
        )),
        resultEvent.event,
        resultEvent.outbox,
        resultEvent.reconciliation,
      ]);

      const [readback] = await db.select().from(financeDocumentExtractions).where(and(
        eq(financeDocumentExtractions.tenantId, context.tenantId),
        eq(financeDocumentExtractions.id, extractionId),
      )).limit(1);
      if (!readback || readback.status !== status || readback.sourceSha256 !== document.sha256 || readback.version !== nextVersion) {
        return Response.json({ error: "finance_document_extraction_readback_unavailable" }, { status: 503 });
      }
      return Response.json({
        extraction: extractionResponse(readback),
        readback: { status: "verified", scope: "tenant", version: readback.version, sourceSha256: readback.sourceSha256 },
        documentSecurity: {
          scanStatus: document.scanStatus,
          status: document.status,
          downloadable: documentCanDownload(document.scanStatus, document.status),
        },
        ledgerWrite: false,
      }, { status: 201, headers: { "cache-control": "private, no-store" } });
    } catch (error) {
      const failureCode = safeProviderFailure(error);
      const completedAt = new Date().toISOString();
      const nextVersion = 2;
      const failureEvent = eventRows({
        tenantId: context.tenantId,
        extractionId,
        version: nextVersion,
        actorId: context.actorId,
        status: "FAILED",
        idempotencyKey: `${idempotencyKey}:failed`,
        payload: {
          documentId: document.id,
          sourceSha256: document.sha256,
          sourceDocumentVersion: document.version,
          failureCode,
          providerMetadata,
        },
        detail: "Analisi non completata. Il documento resta archiviato; non è stata creata alcuna scrittura Finance.",
        now: completedAt,
      });
      await db.batch([
        db.update(financeDocumentExtractions).set({
          status: "FAILED",
          extractionJson: null,
          providerMetadataJson: JSON.stringify(providerMetadata),
          failureCode,
          version: nextVersion,
          updatedAt: completedAt,
        }).where(and(
          eq(financeDocumentExtractions.tenantId, context.tenantId),
          eq(financeDocumentExtractions.id, extractionId),
          eq(financeDocumentExtractions.version, 1),
          eq(financeDocumentExtractions.status, "PROCESSING"),
        )),
        failureEvent.event,
        failureEvent.outbox,
        failureEvent.reconciliation,
      ]);
      return Response.json({ error: failureCode, extractionId, readback: { status: "failed", version: nextVersion } }, {
        status: 502,
        headers: { "cache-control": "private, no-store" },
      });
    }
  } catch {
    return Response.json({ error: "finance_document_analysis_unavailable" }, { status: 503 });
  }
}
