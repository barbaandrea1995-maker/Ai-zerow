import { env } from "cloudflare:workers";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { financeDocumentExtractions, financeDocuments, s04Records, s06Events, s06Outbox, s06Reconciliations } from "@/db/schema";
import { getAuthorityContext, hasCapability, publicAuthorityContext } from "@/lib/authority-context";
import { isOpenAiFinanceExtractionConfigured } from "@/lib/company-ai-finance-document.server";
import { documentCanDownload } from "@/lib/document-security";
import { isNutrientFinanceExtractionConfigured } from "@/lib/nutrient-finance-document.server";
import {
  matchesOperationalDocumentSignature,
  operationalDocumentMime,
  safeDocumentFileName,
  sha256Hex,
} from "@/lib/document-contract";
import {
  FINANCE_DOCUMENT_CATEGORIES,
  isFinanceDocumentCategory,
  MAX_FINANCE_DOCUMENT_BYTES,
} from "@/lib/finance-document-contract";

export const dynamic = "force-dynamic";

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function jobResponse(row: typeof s04Records.$inferSelect) {
  const payload = parseObject(row.payloadJson);
  return {
    id: row.id,
    code: row.canonicalCode,
    title: text(payload.title) || row.title,
    client: text(payload.clientName ?? payload.client ?? payload.customer) || null,
    location: text(payload.location ?? payload.address ?? payload.cantiere ?? row.meta) || null,
    status: row.status,
  };
}

function documentResponse(
  row: typeof financeDocuments.$inferSelect,
  jobsById: Map<string, ReturnType<typeof jobResponse>>,
  latestExtraction: typeof financeDocumentExtractions.$inferSelect | null,
) {
  return {
    id: row.id,
    domain: "finance" as const,
    jobId: row.jobId,
    job: row.jobId ? jobsById.get(row.jobId) ?? null : null,
    category: row.category,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    storageStatus: row.storageStatus,
    scanStatus: row.scanStatus,
    provenance: row.provenance,
    status: row.status,
    version: row.version,
    downloadable: documentCanDownload(row.scanStatus, row.status),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    downloadUrl: `/api/documents/${encodeURIComponent(row.id)}`,
    latestExtraction: latestExtraction ? {
      id: latestExtraction.id,
      status: latestExtraction.status,
      proposal: latestExtraction.extractionJson ? parseObject(latestExtraction.extractionJson) : null,
      providers: parseObject(latestExtraction.providerMetadataJson),
      failureCode: latestExtraction.failureCode,
      version: latestExtraction.version,
      createdAt: latestExtraction.createdAt,
    } : null,
  };
}

async function readCatalog(tenantId: string) {
  const db = getDb();
  const [documents, jobRows, extractionRows] = await Promise.all([
    db.select().from(financeDocuments)
      .where(eq(financeDocuments.tenantId, tenantId))
      .orderBy(desc(financeDocuments.createdAt))
      .limit(500),
    db.select().from(s04Records).where(and(
      eq(s04Records.tenantId, tenantId),
      eq(s04Records.module, "operations"),
      eq(s04Records.recordType, "job"),
    )).orderBy(desc(s04Records.updatedAt)).limit(500),
    db.select().from(financeDocumentExtractions)
      .where(eq(financeDocumentExtractions.tenantId, tenantId))
      .orderBy(desc(financeDocumentExtractions.createdAt))
      .limit(1_500),
  ]);
  const jobs = jobRows.map(jobResponse);
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const latestByDocument = new Map<string, typeof financeDocumentExtractions.$inferSelect>();
  for (const row of extractionRows) if (!latestByDocument.has(row.documentId)) latestByDocument.set(row.documentId, row);
  return { documents: documents.map((row) => documentResponse(row, jobsById, latestByDocument.get(row.id) ?? null)), jobs };
}

export async function GET() {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "finance.read")) {
    return Response.json({ error: "forbidden", capability: "finance.read" }, { status: 403 });
  }

  try {
    const catalog = await readCatalog(context.tenantId);
    return Response.json({
      context: publicAuthorityContext(context),
      ...catalog,
      summary: {
        total: catalog.documents.length,
        quarantined: catalog.documents.filter((document) => !document.downloadable).length,
        unscanned: catalog.documents.filter((document) => document.scanStatus === "NOT_RUN").length,
        clean: catalog.documents.filter((document) => document.downloadable).length,
      },
      categories: FINANCE_DOCUMENT_CATEGORIES,
      contract: {
        source: "finance_documents+r2",
        authority: "server-context",
        maxBytes: MAX_FINANCE_DOCUMENT_BYTES,
        scan: "NOT_RUN_UNTIL_PROVIDER_READBACK",
        aiExtraction: {
          status: isNutrientFinanceExtractionConfigured() && isOpenAiFinanceExtractionConfigured() ? "READY" : "PROVIDER_NOT_CONFIGURED",
          providers: { nutrient: isNutrientFinanceExtractionConfigured(), companyAiOpenAi: isOpenAiFinanceExtractionConfigured() },
          explicitUserConsentRequired: true,
          createsFinanceEntries: false,
          doesNotChangeMalwareScanStatus: true,
        },
      },
      readback: { status: "SITES_READBACK_VERIFIED", checkedAt: new Date().toISOString() },
    }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return Response.json({ error: "finance_document_catalog_unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "finance.write")) {
    return Response.json({ error: "forbidden", capability: "finance.write" }, { status: 403 });
  }
  if (!env.BUCKET) return Response.json({ error: "object_storage_not_configured" }, { status: 503 });

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_FINANCE_DOCUMENT_BYTES + 1_048_576) {
    return Response.json({ error: "file_too_large", maxBytes: MAX_FINANCE_DOCUMENT_BYTES }, { status: 413 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "invalid_multipart_form" }, { status: 400 });
  }
  const candidate = formData.get("file");
  if (!(candidate instanceof File)) return Response.json({ error: "file_required" }, { status: 400 });
  if (candidate.size < 1) return Response.json({ error: "empty_file" }, { status: 400 });
  if (candidate.size > MAX_FINANCE_DOCUMENT_BYTES) {
    return Response.json({ error: "file_too_large", maxBytes: MAX_FINANCE_DOCUMENT_BYTES }, { status: 413 });
  }

  const fileName = safeDocumentFileName(candidate.name);
  const mimeType = operationalDocumentMime(fileName, candidate.type);
  if (!mimeType) return Response.json({ error: "unsupported_or_mismatched_file_type" }, { status: 415 });
  const category = text(formData.get("category")).toUpperCase();
  if (!isFinanceDocumentCategory(category)) {
    return Response.json({ error: "finance_document_category_invalid", allowed: FINANCE_DOCUMENT_CATEGORIES }, { status: 400 });
  }
  const rawIdempotencyKey = text(formData.get("idempotencyKey"));
  if (rawIdempotencyKey.length < 8 || rawIdempotencyKey.length > 140) {
    return Response.json({ error: "idempotency_key_invalid" }, { status: 400 });
  }
  const idempotencyKey = `finance-document-upload:${rawIdempotencyKey}`;
  const jobReference = text(formData.get("jobId"));
  if (jobReference.length > 160) return Response.json({ error: "invalid_job_id" }, { status: 400 });

  let objectKey = "";
  let metadataCommitted = false;
  try {
    const db = getDb();
    let job: typeof s04Records.$inferSelect | null = null;
    if (jobReference) {
      const [row] = await db.select().from(s04Records).where(and(
        eq(s04Records.tenantId, context.tenantId),
        eq(s04Records.module, "operations"),
        eq(s04Records.recordType, "job"),
        eq(s04Records.id, jobReference),
      )).limit(1);
      if (!row) return Response.json({ error: "finance_job_not_found" }, { status: 404 });
      job = row;
    }

    const buffer = await candidate.arrayBuffer();
    if (!matchesOperationalDocumentSignature(mimeType, buffer)) {
      return Response.json({ error: "file_signature_mismatch" }, { status: 415 });
    }
    const sha256 = await sha256Hex(buffer);

    const [existingEvent] = await db.select().from(s06Events).where(and(
      eq(s06Events.tenantId, context.tenantId),
      eq(s06Events.idempotencyKey, idempotencyKey),
    )).limit(1);
    if (existingEvent) {
      if (existingEvent.aggregateType !== "finance.document" || existingEvent.eventType !== "finance.documents.uploaded") {
        return Response.json({ error: "finance_document_idempotency_conflict" }, { status: 409 });
      }
      const [existing] = await db.select().from(financeDocuments).where(and(
        eq(financeDocuments.tenantId, context.tenantId),
        eq(financeDocuments.id, existingEvent.aggregateId),
      )).limit(1);
      if (!existing) return Response.json({ error: "finance_document_readback_unavailable" }, { status: 503 });
      if (existing.sha256 !== sha256 || existing.category !== category || existing.jobId !== (job?.id ?? null)) {
        return Response.json({ error: "finance_document_idempotency_payload_conflict" }, { status: 409 });
      }
      const catalog = await readCatalog(context.tenantId);
      const jobsById = new Map(catalog.jobs.map((row) => [row.id, row]));
      return Response.json({ document: documentResponse(existing, jobsById, null), idempotent: true, eventId: existingEvent.eventId, readback: { status: "verified", scope: "tenant", version: existing.version } }, {
        headers: { "cache-control": "private, no-store" },
      });
    }

    const [duplicate] = await db.select().from(financeDocuments).where(and(
      eq(financeDocuments.tenantId, context.tenantId),
      eq(financeDocuments.sha256, sha256),
    )).limit(1);
    if (duplicate) {
      const catalog = await readCatalog(context.tenantId);
      const jobsById = new Map(catalog.jobs.map((row) => [row.id, row]));
      return Response.json({ document: documentResponse(duplicate, jobsById, null), duplicate: true, readback: { status: "verified", scope: "tenant", version: duplicate.version } }, {
        headers: { "cache-control": "private, no-store" },
      });
    }

    const tenantDigest = (await sha256Hex(new TextEncoder().encode(context.tenantId).buffer)).slice(0, 24);
    const documentId = `FIN-DOC-${crypto.randomUUID()}`;
    objectKey = `tenants/${tenantDigest}/finance/documents/${documentId}/${encodeURIComponent(fileName)}`;
    await env.BUCKET.put(objectKey, buffer, {
      httpMetadata: {
        contentType: mimeType,
        contentDisposition: `attachment; filename="${fileName.replace(/["\\]/g, "_")}"`,
      },
      customMetadata: { tenant: tenantDigest, documentId, sha256, category },
      onlyIf: { etagDoesNotMatch: "*" },
    });
    const stored = await env.BUCKET.head(objectKey);
    if (!stored || stored.size !== candidate.size || stored.customMetadata?.sha256 !== sha256 || stored.customMetadata?.documentId !== documentId) {
      throw new Error("finance_document_object_readback_mismatch");
    }

    const now = new Date().toISOString();
    const eventId = crypto.randomUUID();
    await db.batch([
      db.insert(financeDocuments).values({
        id: documentId,
        tenantId: context.tenantId,
        jobId: job?.id ?? null,
        category,
        fileName,
        mimeType,
        sizeBytes: candidate.size,
        sha256,
        objectKey,
        storageStatus: "STORED",
        scanStatus: "NOT_RUN",
        provenance: "USER_UPLOAD_SERVER_HASHED",
        status: "QUARANTINED",
        version: 1,
        idempotencyKey,
        createdBy: context.actorId,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(s06Events).values({
        eventId,
        tenantId: context.tenantId,
        eventType: "finance.documents.uploaded",
        schemaVersion: "1",
        actorType: "human",
        actorId: context.actorId,
        source: "sites-finance-documents",
        occurredAt: now,
        observedAt: now,
        aggregateType: "finance.document",
        aggregateId: documentId,
        aggregateVersion: 1,
        payloadJson: JSON.stringify({ jobId: job?.id ?? null, category, fileName, mimeType, sizeBytes: candidate.size, sha256, scanStatus: "NOT_RUN", status: "QUARANTINED" }),
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
        topic: "zerow.finance.documents.uploaded",
        status: "PENDING_EXTERNAL_CONSUMER",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(s06Reconciliations).values({
        id: crypto.randomUUID(),
        tenantId: context.tenantId,
        aggregateType: "finance.document",
        aggregateId: documentId,
        expectedVersion: 1,
        observedVersion: 1,
        status: "OBJECT_AND_METADATA_VERIFIED_QUARANTINED",
        detail: "Oggetto R2 e metadati Finance riletti; scansione malware NOT_RUN e file mantenuto in quarantena.",
        createdAt: now,
        updatedAt: now,
      }),
    ]);
    metadataCommitted = true;

    const [created] = await db.select().from(financeDocuments).where(and(
      eq(financeDocuments.tenantId, context.tenantId),
      eq(financeDocuments.id, documentId),
    )).limit(1);
    if (!created || created.sha256 !== sha256 || created.version !== 1) throw new Error("finance_document_readback_unavailable");
    const catalog = await readCatalog(context.tenantId);
    const jobsById = new Map(catalog.jobs.map((row) => [row.id, row]));
    return Response.json({
      document: documentResponse(created, jobsById, null),
      idempotent: false,
      eventId,
      readback: { status: "verified", scope: "tenant", version: created.version },
    }, { status: 201, headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (objectKey && env.BUCKET && !metadataCommitted) {
      try { await env.BUCKET.delete(objectKey); } catch { /* best-effort orphan cleanup */ }
    }
    const message = error instanceof Error ? error.message : "";
    if (/unique|constraint|precondition/i.test(message)) return Response.json({ error: "finance_document_conflict" }, { status: 409 });
    return Response.json({ error: "finance_document_upload_unavailable" }, { status: 503 });
  }
}
