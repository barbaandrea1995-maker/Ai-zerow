import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { operationalDocuments } from "@/db/schema";
import { getAuthorityContext, hasCapability } from "@/lib/authority-context";
import { documentCanDownload } from "@/lib/document-security";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ documentId: string }> };

function contentDisposition(fileName: string) {
  const ascii = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function GET(_request: Request, routeContext: RouteContext) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "documents.read")) {
    return Response.json({ error: "forbidden", capability: "documents.read" }, { status: 403 });
  }
  if (!env.BUCKET) return Response.json({ error: "object_storage_not_configured" }, { status: 503 });
  let documentId = "";
  try {
    documentId = decodeURIComponent((await routeContext.params).documentId).trim();
  } catch {
    return Response.json({ error: "invalid_document_id" }, { status: 400 });
  }
  if (!documentId || documentId.length > 120) return Response.json({ error: "invalid_document_id" }, { status: 400 });

  try {
    const [document] = await getDb().select().from(operationalDocuments).where(and(
      eq(operationalDocuments.tenantId, context.tenantId),
      eq(operationalDocuments.id, documentId),
    )).limit(1);
    if (!document) return Response.json({ error: "document_not_found" }, { status: 404 });
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
