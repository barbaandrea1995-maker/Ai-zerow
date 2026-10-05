import { env } from "cloudflare:workers";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  operationalDocuments,
  s04Records,
  s06Events,
  s06Outbox,
  s06Reconciliations,
} from "@/db/schema";
import { getAuthorityContext, hasCapability } from "@/lib/authority-context";
import { canReadAllOperations, rowMatchesContext, teamScopeTokens } from "@/lib/operational-scope";
import { documentCanDownload } from "@/lib/document-security";
import {
  matchesOperationalDocumentSignature,
  MAX_OPERATIONAL_DOCUMENT_BYTES,
  operationalDocumentMime,
  safeDocumentFileName,
  sha256Hex,
} from "@/lib/document-contract";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ jobId: string }> };

function boundedText(value: FormDataEntryValue | null, max: number, fallback = "") {
  return typeof value === "string" ? value.trim().slice(0, max) : fallback;
}

async function routeJobId(routeContext: RouteContext) {
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
    eq(s04Records.tenantId, tenantId), eq(s04Records.module, "operations"), eq(s04Records.id, reference),
  )).limit(1);
  if (byId) return byId;
  const [byCode] = await db.select().from(s04Records).where(and(
    eq(s04Records.tenantId, tenantId), eq(s04Records.module, "operations"), eq(s04Records.canonicalCode, reference),
  )).limit(1);
  return byCode ?? null;
}

async function canAccessJob(context: NonNullable<Awaited<ReturnType<typeof getAuthorityContext>>>, job: typeof s04Records.$inferSelect) {
  if (canReadAllOperations(context)) return true;
  const workforceRows = await getDb().select().from(s04Records).where(and(
    eq(s04Records.tenantId, context.tenantId),
    eq(s04Records.module, "workforce"),
  )).limit(500);
  return rowMatchesContext(job, context, teamScopeTokens(workforceRows, context));
}

function responseDocument(row: typeof operationalDocuments.$inferSelect) {
  return {
    id: row.id,
    jobId: row.jobId,
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
  };
}

export async function GET(_request: Request, routeContext: RouteContext) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "documents.read")) {
    return Response.json({ error: "forbidden", capability: "documents.read" }, { status: 403 });
  }
  const reference = await routeJobId(routeContext);
  if (!reference) return Response.json({ error: "invalid_job_id" }, { status: 400 });
  try {
    const job = await findJob(context.tenantId, reference);
    if (!job) return Response.json({ error: "job_not_found" }, { status: 404 });
    if (!(await canAccessJob(context, job))) return Response.json({ error: "job_not_found" }, { status: 404 });
    const rows = await getDb().select().from(operationalDocuments).where(and(
      eq(operationalDocuments.tenantId, context.tenantId),
      eq(operationalDocuments.jobId, job.id),
    )).orderBy(desc(operationalDocuments.createdAt)).limit(250);
    return Response.json({ documents: rows.map(responseDocument) }, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch {
    return Response.json({ error: "document_readback_unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request, routeContext: RouteContext) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "documents.write")) {
    return Response.json({ error: "forbidden", capability: "documents.write" }, { status: 403 });
  }
  if (!env.BUCKET) return Response.json({ error: "object_storage_not_configured" }, { status: 503 });
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_OPERATIONAL_DOCUMENT_BYTES + 1_048_576) {
    return Response.json({ error: "file_too_large", maxBytes: MAX_OPERATIONAL_DOCUMENT_BYTES }, { status: 413 });
  }
  const reference = await routeJobId(routeContext);
  if (!reference) return Response.json({ error: "invalid_job_id" }, { status: 400 });

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "invalid_multipart_form" }, { status: 400 });
  }
  const candidate = formData.get("file");
  if (!(candidate instanceof File)) return Response.json({ error: "file_required" }, { status: 400 });
  if (candidate.size < 1) return Response.json({ error: "empty_file" }, { status: 400 });
  if (candidate.size > MAX_OPERATIONAL_DOCUMENT_BYTES) {
    return Response.json({ error: "file_too_large", maxBytes: MAX_OPERATIONAL_DOCUMENT_BYTES }, { status: 413 });
  }
  const fileName = safeDocumentFileName(candidate.name);
  const mimeType = operationalDocumentMime(fileName, candidate.type);
  if (!mimeType) return Response.json({ error: "unsupported_or_mismatched_file_type" }, { status: 415 });
  const category = boundedText(formData.get("category"), 80, "COMMESSA").toUpperCase();
  const idempotencyKey = boundedText(formData.get("idempotencyKey"), 160);
  if (idempotencyKey.length < 8) return Response.json({ error: "idempotency_key_required" }, { status: 400 });

  let objectKey = "";
  try {
    const db = getDb();
    const job = await findJob(context.tenantId, reference);
    if (!job) return Response.json({ error: "job_not_found" }, { status: 404 });
    if (!(await canAccessJob(context, job))) return Response.json({ error: "job_not_found" }, { status: 404 });
    const [existingEvent] = await db.select().from(s06Events).where(and(
      eq(s06Events.tenantId, context.tenantId), eq(s06Events.idempotencyKey, idempotencyKey),
    )).limit(1);
    if (existingEvent) {
      if (existingEvent.aggregateType !== "operational.document") {
        return Response.json({ error: "document_idempotency_key_conflict" }, { status: 409 });
      }
      const [existing] = await db.select().from(operationalDocuments).where(and(
        eq(operationalDocuments.tenantId, context.tenantId), eq(operationalDocuments.id, existingEvent.aggregateId),
      )).limit(1);
      if (!existing || existing.jobId !== job.id) return Response.json({ error: "document_idempotency_readback_unavailable" }, { status: 503 });
      return Response.json({ document: responseDocument(existing), idempotent: true, eventId: existingEvent.eventId }, {
        headers: { "cache-control": "private, no-store" },
      });
    }

    const buffer = await candidate.arrayBuffer();
    if (!matchesOperationalDocumentSignature(mimeType, buffer)) {
      return Response.json({ error: "file_signature_mismatch" }, { status: 415 });
    }
    const sha256 = await sha256Hex(buffer);
    const [duplicate] = await db.select().from(operationalDocuments).where(and(
      eq(operationalDocuments.tenantId, context.tenantId),
      eq(operationalDocuments.jobId, job.id),
      eq(operationalDocuments.sha256, sha256),
    )).limit(1);
    if (duplicate) {
      return Response.json({ document: responseDocument(duplicate), duplicate: true, idempotent: true }, {
        headers: { "cache-control": "private, no-store" },
      });
    }

    const tenantDigest = (await sha256Hex(new TextEncoder().encode(context.tenantId).buffer)).slice(0, 24);
    const documentId = crypto.randomUUID();
    objectKey = `tenants/${tenantDigest}/jobs/${job.id}/documents/${documentId}/${encodeURIComponent(fileName)}`;
    await env.BUCKET.put(objectKey, buffer, {
      httpMetadata: { contentType: mimeType, contentDisposition: `attachment; filename="${fileName.replace(/["\\]/g, "_")}"` },
      customMetadata: { tenant: tenantDigest, jobId: job.id, documentId, sha256 },
      onlyIf: { etagDoesNotMatch: "*" },
    });

    const now = new Date().toISOString();
    const eventId = crypto.randomUUID();
    await db.batch([
      db.insert(operationalDocuments).values({
        id: documentId,
        tenantId: context.tenantId,
        jobId: job.id,
        category,
        fileName,
        mimeType,
        sizeBytes: candidate.size,
        sha256,
        objectKey,
        storageStatus: "STORED",
        scanStatus: "NOT_RUN",
        provenance: "USER_UPLOAD_SERVER_HASHED",
        status: "AVAILABLE_UNSCANNED",
        version: 1,
        idempotencyKey,
        createdBy: context.actorId,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(s06Events).values({
        eventId,
        tenantId: context.tenantId,
        eventType: "documents.operational.uploaded",
        schemaVersion: "1",
        actorType: "human",
        actorId: context.actorId,
        source: "sites-documents",
        occurredAt: now,
        observedAt: now,
        aggregateType: "operational.document",
        aggregateId: documentId,
        aggregateVersion: 1,
        payloadJson: JSON.stringify({ jobId: job.id, category, fileName, mimeType, sizeBytes: candidate.size, sha256, scanStatus: "NOT_RUN" }),
        correlationId: crypto.randomUUID(),
        causationId: null,
        idempotencyKey,
        status: "COMMITTED_SITES_READBACK",
        createdAt: now,
      }),
      db.insert(s06Outbox).values({
        id: crypto.randomUUID(), tenantId: context.tenantId, eventId,
        topic: "zerow.documents.operational.uploaded", status: "PENDING_EXTERNAL_CONSUMER",
        attempts: 0, createdAt: now, updatedAt: now,
      }),
      db.insert(s06Reconciliations).values({
        id: crypto.randomUUID(), tenantId: context.tenantId,
        aggregateType: "operational.document", aggregateId: documentId,
        expectedVersion: 1, observedVersion: 1, status: "OBJECT_AND_METADATA_VERIFIED",
        detail: "Oggetto R2 e metadata D1 persistiti; scansione malware non configurata e dichiarata NOT_RUN.",
        createdAt: now, updatedAt: now,
      }),
    ]);
    const [created] = await db.select().from(operationalDocuments).where(and(
      eq(operationalDocuments.tenantId, context.tenantId), eq(operationalDocuments.id, documentId),
    )).limit(1);
    if (!created) throw new Error("document_readback_unavailable");
    return Response.json({ document: responseDocument(created), idempotent: false, eventId }, {
      status: 201,
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    if (objectKey && env.BUCKET) {
      try { await env.BUCKET.delete(objectKey); } catch { /* best-effort orphan cleanup */ }
    }
    const message = error instanceof Error ? error.message : "";
    if (/unique|constraint|precondition/i.test(message)) return Response.json({ error: "document_conflict" }, { status: 409 });
    return Response.json({ error: "document_upload_unavailable" }, { status: 503 });
  }
}
