import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { financeDocuments, jobJourneyRecords, operationalDocuments, s04Records } from "@/db/schema";
import { getAuthorityContext, hasCapability, publicAuthorityContext } from "@/lib/authority-context";
import { recordForResponse } from "@/lib/s04-adapter";
import { documentCanDownload } from "@/lib/document-security";
import { ensureFinanceDocumentSchema } from "@/lib/finance-document-schema.server";
import { ALLOWED_OPERATIONAL_DOCUMENT_MIMES, MAX_OPERATIONAL_DOCUMENT_BYTES } from "@/lib/document-contract";
import { FINANCE_DOCUMENT_CATEGORIES, MAX_FINANCE_DOCUMENT_BYTES } from "@/lib/finance-document-contract";
import { canReadAllOperations, rowMatchesContext, teamScopeTokens } from "@/lib/operational-scope";

export const dynamic = "force-dynamic";

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function jobResponse(row: typeof s04Records.$inferSelect) {
  const record = recordForResponse(row);
  return {
    id: record.id,
    code: record.canonicalCode ?? null,
    title: record.title,
    client: text(record.payload.client ?? record.payload.customer ?? record.payload.committente, "Cliente da verificare") || null,
    location: text(record.payload.location ?? record.payload.address ?? record.payload.cantiere, record.meta) || null,
    status: record.status,
  };
}

function documentResponse(row: typeof operationalDocuments.$inferSelect, jobs: Map<string, ReturnType<typeof jobResponse>>) {
  const job = jobs.get(row.jobId);
  return {
    id: row.id,
    domain: "operations" as const,
    jobId: row.jobId,
    job: job ?? null,
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
    downloadUrl: "/api/documents/" + encodeURIComponent(row.id),
  };
}

function financeDocumentResponse(row: typeof financeDocuments.$inferSelect, jobs: Map<string, ReturnType<typeof jobResponse>>) {
  return {
    id: row.id,
    domain: "finance" as const,
    jobId: row.jobId,
    job: row.jobId ? jobs.get(row.jobId) ?? null : null,
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
    downloadUrl: "/api/documents/" + encodeURIComponent(row.id),
  };
}

export async function GET() {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "documents.read")) {
    return Response.json({ error: "forbidden", capability: "documents.read" }, { status: 403 });
  }

  try {
    const db = getDb();
    const canReadFinance = hasCapability(context, "finance.read");
    if (canReadFinance) await ensureFinanceDocumentSchema();
    const [documentRows, jobRows, workforceRows, missionRows, financeRows] = await Promise.all([
      db.select().from(operationalDocuments)
        .where(eq(operationalDocuments.tenantId, context.tenantId))
        .orderBy(desc(operationalDocuments.createdAt))
        .limit(500),
      db.select().from(s04Records)
        .where(eq(s04Records.tenantId, context.tenantId))
        .orderBy(desc(s04Records.updatedAt))
        .limit(500),
      db.select().from(s04Records)
        .where(and(eq(s04Records.tenantId, context.tenantId), eq(s04Records.module, "workforce")))
        .limit(500),
      db.select().from(jobJourneyRecords)
        .where(and(eq(jobJourneyRecords.tenantId, context.tenantId), eq(jobJourneyRecords.domain, "mission")))
        .limit(1_000),
      canReadFinance
        ? db.select().from(financeDocuments).where(eq(financeDocuments.tenantId, context.tenantId)).orderBy(desc(financeDocuments.createdAt)).limit(500)
        : Promise.resolve([] as (typeof financeDocuments.$inferSelect)[]),
    ]);
    const scopeTokens = teamScopeTokens(workforceRows, context);
    const broadRead = canReadAllOperations(context);
    const visibleMissionJobIds = new Set(missionRows.filter((row) => rowMatchesContext(row, context, scopeTokens)).map((row) => row.jobId));
    const visibleJobRows = jobRows.filter((row) => row.module === "operations" && (broadRead || rowMatchesContext(row, context, scopeTokens) || visibleMissionJobIds.has(row.id)));
    const visibleJobIds = new Set(visibleJobRows.map((row) => row.id));
    const visibleDocumentRows = documentRows.filter((row) => visibleJobIds.has(row.jobId));
    const jobs = visibleJobRows.map(jobResponse);
    const jobsById = new Map(jobs.map((job) => [job.id, job]));
    const financeJobsById = new Map(jobRows.filter((row) => row.module === "operations" && row.recordType === "job").map((row) => {
      const job = jobResponse(row);
      return [job.id, job] as const;
    }));
    const documents = [
      ...visibleDocumentRows.map((row) => documentResponse(row, jobsById)),
      ...financeRows.map((row) => financeDocumentResponse(row, financeJobsById)),
    ].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const pending = documents.filter((document) => ["PENDING_PROVIDER", "MANUAL_REVIEW"].includes(document.scanStatus)).length;
    const blocked = documents.filter((document) => ["BLOCKED_MALWARE", "QUARANTINED", "QUARANTINED_PENDING_SCAN", "QUARANTINED_REVIEW"].includes(document.status)).length;
    const unscanned = documents.filter((document) => document.scanStatus === "NOT_RUN" || document.status === "AVAILABLE_UNSCANNED").length;
    const clean = documents.filter((document) => document.downloadable).length;
    const linkedJobIds = new Set(documents.flatMap((document) => document.jobId ? [document.jobId] : []));

    return Response.json({
      context: publicAuthorityContext(context),
      documents,
      jobs,
      summary: {
        total: documents.length,
        clean,
        pending,
        blocked,
        unscanned,
        linkedJobs: linkedJobIds.size,
      },
      contract: {
        module: "documents",
        route: "/api/documents/catalog",
        source: canReadFinance ? "sites-d1-operational+finance-documents-r2" : "sites-d1-operational-documents-r2",
        authority: "server-context",
        uploadRoute: "/api/operations/jobs/:jobId/documents",
        financeUploadRoute: canReadFinance ? "/api/finance/documents" : null,
        maxBytes: MAX_OPERATIONAL_DOCUMENT_BYTES,
        financeMaxBytes: canReadFinance ? MAX_FINANCE_DOCUMENT_BYTES : null,
        maxFileSizeLabel: "20 MB",
        allowedMimes: [...ALLOWED_OPERATIONAL_DOCUMENT_MIMES],
        financeCategories: canReadFinance ? FINANCE_DOCUMENT_CATEGORIES : [],
        security: "signature-check-only-until-provider-backed-clean",
        directWrite: false,
        extraction: "NOT_RUN_UNLESS_BOUND_TO_COMPANY_AI_INTAKE",
      },
      readback: {
        status: "verified",
        tenantId: context.tenantId,
        documentCount: documents.length,
        jobCount: jobs.length,
        checkedAt: new Date().toISOString(),
      },
    }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return Response.json({ error: "document_catalog_readback_unavailable" }, { status: 503 });
  }
}
