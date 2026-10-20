import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { financeDocuments, operationalDocuments, s04Records } from "@/db/schema";
import { getAuthorityContext, hasCapability } from "@/lib/authority-context";
import { documentCanDownload } from "@/lib/document-security";
import { ensureFinanceDocumentSchema } from "@/lib/finance-document-schema.server";
import { canReadAllOperations, rowMatchesContext, teamScopeTokens } from "@/lib/operational-scope";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ documentId: string }> };

async function canAccessDocument(context: NonNullable<Awaited<ReturnType<typeof getAuthorityContext>>>, jobId: string) {
  if (canReadAllOperations(context)) return true;
  const [job] = await getDb().select().from(s04Records).where(and(
    eq(s04Records.tenantId, context.tenantId),
    eq(s04Records.module, "operations"),
    eq(s04Records.id, jobId),
  )).limit(1);
  if (!job) return false;
  const workforceRows = await getDb().select().from(s04Records).where(and(
    eq(s04Records.tenantId, context.tenantId),
    eq(s04Records.module, "workforce"),
  )).limit(500);
  return rowMatchesContext(job, context, teamScopeTokens(workforceRows, context));
}

function contentDisposition(fileName: string) {
  const ascii = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function GET(_request: Request, routeContext: RouteContext) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!env.BUCKET) return Response.json({ error: "object_storage_not_configured" }, { status: 503 });
  let documentId = "";
  try {
    documentId = decodeURIComponent((await routeContext.params).documentId).trim();
  } catch {
    return Response.json({ error: "invalid_document_id" }, { status: 400 });
  }
  if (!documentId || documentId.length > 120) return Response.json({ error: "invalid_document_id" }, { status: 400 });

  try {
    await ensureFinanceDocumentSchema();
    const [financeDocument] = await getDb().select().from(financeDocuments).where(and(
      eq(financeDocuments.tenantId, context.tenantId),
      eq(financeDocuments.id, documentId),
    )).limit(1);
    if (financeDocument) {
      if (!hasCapability(context, "finance.read")) {
        return Response.json({ error: "forbidden", capability: "finance.read" }, { status: 403 });
      }
      if (!documentCanDownload(financeDocument.scanStatus, financeDocument.status)) {
        return Response.json({ error: "document_security_hold", scanStatus: financeDocument.scanStatus, status: financeDocument.status }, {
          status: 423,
          headers: { "cache-control": "private, no-store", "x-zerow-scan-status": financeDocument.scanStatus },
        });
      }
      const object = await env.BUCKET.get(financeDocument.objectKey);
      if (!object) return Response.json({ error: "document_object_not_found" }, { status: 404 });
      return new Response(object.body, {
        headers: {
          "content-type": financeDocument.mimeType,
          "content-length": String(financeDocument.sizeBytes),
          "content-disposition": contentDisposition(financeDocument.fileName),
          "cache-control": "private, no-store, max-age=0",
          "content-security-policy": "sandbox",
          "x-content-type-options": "nosniff",
          "x-zerow-document-sha256": financeDocument.sha256,
          "x-zerow-scan-status": financeDocument.scanStatus,
        },
      });
    }

    if (!hasCapability(context, "documents.read")) {
      return Response.json({ error: "forbidden", capability: "documents.read" }, { status: 403 });
    }
    const [document] = await getDb().select().from(operationalDocuments).where(and(
      eq(operationalDocuments.tenantId, context.tenantId),
      eq(operationalDocuments.id, documentId),
    )).limit(1);
    if (!document) return Response.json({ error: "document_not_found" }, { status: 404 });
    if (!(await canAccessDocument(context, document.jobId))) return Response.json({ error: "document_not_found" }, { status: 404 });
    if (!documentCanDownload(document.scanStatus, document.status)) {
      return Response.json({ error: "document_security_hold", scanStatus: document.scanStatus, status: document.status }, {
        status: 423,
        headers: { "cache-control": "private, no-store", "x-zerow-scan-status": document.scanStatus },
      });
    }
    const object = await env.BUCKET.get(document.objectKey);
    if (!object) return Response.json({ error: "document_object_not_found" }, { status: 404 });
    return new Response(object.body, {
      headers: {
        "content-type": document.mimeType,
        "content-length": String(document.sizeBytes),
        "content-disposition": contentDisposition(document.fileName),
        "cache-control": "private, no-store, max-age=0",
        "content-security-policy": "sandbox",
        "x-content-type-options": "nosniff",
        "x-zerow-document-sha256": document.sha256,
        "x-zerow-scan-status": document.scanStatus,
      },
    });
  } catch {
    return Response.json({ error: "document_download_unavailable" }, { status: 503 });
  }
}
