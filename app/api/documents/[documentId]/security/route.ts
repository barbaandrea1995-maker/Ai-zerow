import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { operationalDocuments, s04Records, s06Events, s06Outbox, s06Reconciliations } from "@/db/schema";
import { getAuthorityContext, hasCapability } from "@/lib/authority-context";
import {
  DOCUMENT_SECURITY_ACTIONS,
  DocumentSecurityTransitionError,
  documentCanDownload,
  transitionDocumentSecurity,
  type DocumentProviderResult,
  type DocumentSecurityAction,
} from "@/lib/document-security";
import { canReadAllOperations, rowMatchesContext, teamScopeTokens } from "@/lib/operational-scope";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ documentId: string }> };

function providerToken() {
  const bound = typeof env.MALWARE_SCAN_WEBHOOK_TOKEN === "string" ? env.MALWARE_SCAN_WEBHOOK_TOKEN.trim() : "";
  if (bound) return bound;
  return process.env.MALWARE_SCAN_WEBHOOK_TOKEN?.trim() ?? "";
}

function responseDocument(row: typeof operationalDocuments.$inferSelect) {
  return {
    id: row.id,
    jobId: row.jobId,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    storageStatus: row.storageStatus,
    scanStatus: row.scanStatus,
    status: row.status,
    version: row.version,
    downloadable: documentCanDownload(row.scanStatus, row.status),
    updatedAt: row.updatedAt,
  };
}

async function documentId(routeContext: RouteContext) {
  try {
    const value = decodeURIComponent((await routeContext.params).documentId).trim();
    return value && value.length <= 120 ? value : null;
  } catch {
    return null;
  }
}

async function findDocument(tenantId: string | null, id: string) {
  const where = tenantId
    ? and(eq(operationalDocuments.tenantId, tenantId), eq(operationalDocuments.id, id))
    : eq(operationalDocuments.id, id);
  const [row] = await getDb().select().from(operationalDocuments).where(where).limit(1);
  return row ?? null;
}

async function canAccessDocument(context: NonNullable<Awaited<ReturnType<typeof getAuthorityContext>>>, document: typeof operationalDocuments.$inferSelect) {
  if (canReadAllOperations(context)) return true;
  const [job] = await getDb().select().from(s04Records).where(and(
    eq(s04Records.tenantId, context.tenantId),
    eq(s04Records.module, "operations"),
    eq(s04Records.id, document.jobId),
  )).limit(1);
  if (!job) return false;
  const workforceRows = await getDb().select().from(s04Records).where(and(
    eq(s04Records.tenantId, context.tenantId),
    eq(s04Records.module, "workforce"),
  )).limit(500);
  return rowMatchesContext(job, context, teamScopeTokens(workforceRows, context));
}

export async function GET(_request: Request, routeContext: RouteContext) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "documents.read")) return Response.json({ error: "forbidden", capability: "documents.read" }, { status: 403 });
  const id = await documentId(routeContext);
  if (!id) return Response.json({ error: "invalid_document_id" }, { status: 400 });
  try {
    const row = await findDocument(context.tenantId, id);
    if (!row) return Response.json({ error: "document_not_found" }, { status: 404 });
    return Response.json({
      document: responseDocument(row),
      contract: {
        source: "sites-d1-document-security-boundary",
        providerConfigured: Boolean(providerToken()),
        cleanEvidenceRequired: true,
        directWrite: false,
      },
    }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return Response.json({ error: "document_security_readback_unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request, routeContext: RouteContext) {
  const context = await getAuthorityContext();
  const id = await documentId(routeContext);
  if (!id) return Response.json({ error: "invalid_document_id" }, { status: 400 });

  let payload: Record<string, unknown>;
  try {
    const parsed = await request.json() as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return Response.json({ error: "invalid_json" }, { status: 400 });
    payload = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const action = typeof payload.action === "string" ? payload.action.trim().toLowerCase() : "";
  const result = typeof payload.result === "string" ? payload.result.trim().toUpperCase() : "";
  const providerSha256 = typeof payload.sha256 === "string" ? payload.sha256.trim().toLowerCase() : "";
  const providerReference = typeof payload.providerReference === "string" ? payload.providerReference.trim().slice(0, 160) : "";
  const idempotencyKey = typeof payload.idempotencyKey === "string" ? payload.idempotencyKey.trim().slice(0, 160) : `document-security:${id}:${crypto.randomUUID()}`;
  if (!DOCUMENT_SECURITY_ACTIONS.includes(action as DocumentSecurityAction)) {
    return Response.json({ error: "invalid_document_security_action", actions: DOCUMENT_SECURITY_ACTIONS }, { status: 400 });
  }
  if (typeof payload.idempotencyKey === "string" && payload.idempotencyKey.trim().length > 160) return Response.json({ error: "idempotency_key_too_long" }, { status: 400 });
  const configuredProviderToken = providerToken();
  const providerAuthorized = action === "provider_result"
    && Boolean(configuredProviderToken)
    && request.headers.get("authorization") === `Bearer ${configuredProviderToken}`;
  if (action !== "provider_result") {
    if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
    if (!hasCapability(context, "documents.write")) return Response.json({ error: "forbidden", capability: "documents.write" }, { status: 403 });
  }
  if (action === "provider_result") {
    if (!configuredProviderToken) return Response.json({ error: "malware_scan_provider_not_configured" }, { status: 503 });
    if (!providerAuthorized) return Response.json({ error: "malware_scan_provider_unauthorized" }, { status: 401 });
    if (result !== "CLEAN" && result !== "INFECTED") return Response.json({ error: "provider_result_required" }, { status: 400 });
    if (!/^[a-f0-9]{64}$/.test(providerSha256)) return Response.json({ error: "provider_sha256_required" }, { status: 400 });
  }

  try {
    const db = getDb();
    const current = await findDocument(context?.tenantId ?? null, id);
    if (!current) return Response.json({ error: "document_not_found" }, { status: 404 });
    if (context && !(await canAccessDocument(context, current))) return Response.json({ error: "document_not_found" }, { status: 404 });
    if (action === "provider_result" && providerSha256 !== current.sha256.toLowerCase()) {
      return Response.json({ error: "provider_sha256_mismatch" }, { status: 409 });
    }
    const tenantId = current.tenantId;
    const existingEvent = await db.select().from(s06Events).where(and(
      eq(s06Events.tenantId, tenantId),
      eq(s06Events.idempotencyKey, idempotencyKey),
    )).limit(1);
    if (existingEvent[0]) {
      if (existingEvent[0].aggregateType !== "operational.document.security") return Response.json({ error: "document_security_idempotency_conflict" }, { status: 409 });
      const existing = await findDocument(tenantId, id);
      if (!existing) return Response.json({ error: "document_security_readback_unavailable" }, { status: 503 });
      return Response.json({ document: responseDocument(existing), eventId: existingEvent[0].eventId, idempotent: true, readback: { status: "verified", scope: "tenant", version: existing.version } }, { headers: { "cache-control": "private, no-store" } });
    }
    const transition = transitionDocumentSecurity({
      scanStatus: current.scanStatus,
      documentStatus: current.status,
      action: action as DocumentSecurityAction,
      providerResult: result as DocumentProviderResult,
    });
    const now = new Date().toISOString();
    const eventId = crypto.randomUUID();
    const nextVersion = current.version + 1;
    const payloadJson = JSON.stringify({
      action,
      result: result || null,
      previousScanStatus: current.scanStatus,
      scanStatus: transition.scanStatus,
      previousDocumentStatus: current.status,
      documentStatus: transition.documentStatus,
      sha256: current.sha256,
      providerReference: providerReference || null,
      source: action === "provider_result" ? "malware-scan-provider-webhook" : "sites-document-security",
    });
    const mutation = db.update(operationalDocuments).set({
      scanStatus: transition.scanStatus,
      status: transition.documentStatus,
      version: nextVersion,
      updatedAt: now,
    }).where(and(
      eq(operationalDocuments.tenantId, tenantId),
      eq(operationalDocuments.id, current.id),
      eq(operationalDocuments.version, current.version),
    )).returning();
    const results = await db.batch([
      mutation,
      db.insert(s06Events).values({
        eventId,
        tenantId,
        eventType: "documents.security.state_changed",
        schemaVersion: "1",
        actorType: action === "provider_result" ? "provider" : "human",
        actorId: action === "provider_result" ? "malware-scan-provider" : context!.actorId,
        source: action === "provider_result" ? "malware-scan-provider" : "sites-document-security",
        occurredAt: now,
        observedAt: now,
        aggregateType: "operational.document.security",
        aggregateId: current.id,
        aggregateVersion: nextVersion,
        payloadJson,
        correlationId: crypto.randomUUID(),
        causationId: null,
        idempotencyKey,
        status: "COMMITTED_SITES_READBACK",
        createdAt: now,
      }),
      db.insert(s06Outbox).values({
        id: crypto.randomUUID(),
        tenantId,
        eventId,
        topic: "zerow.documents.security.state_changed",
        status: "PENDING_EXTERNAL_CONSUMER",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(s06Reconciliations).values({
        id: crypto.randomUUID(),
        tenantId,
        aggregateType: "operational.document.security",
        aggregateId: current.id,
        expectedVersion: current.version,
        observedVersion: nextVersion,
        status: "DOCUMENT_SECURITY_READBACK",
        detail: transition.detail,
        createdAt: now,
        updatedAt: now,
      }),
    ]);
    const changed = (results[0] as (typeof operationalDocuments.$inferSelect)[])[0];
    if (!changed) return Response.json({ error: "document_security_version_conflict" }, { status: 409 });
    const updated = await findDocument(tenantId, id);
    if (!updated || updated.version !== nextVersion) return Response.json({ error: "document_security_readback_unavailable" }, { status: 503 });
    return Response.json({ document: responseDocument(updated), eventId, transition: { action, detail: transition.detail }, idempotent: false, readback: { status: "verified", scope: "tenant", version: updated.version } }, { status: 201, headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof DocumentSecurityTransitionError) return Response.json({ error: error.code }, { status: 409 });
    const message = error instanceof Error ? error.message : "";
    if (/unique|constraint/i.test(message)) return Response.json({ error: "document_security_conflict" }, { status: 409 });
    return Response.json({ error: "document_security_write_unavailable" }, { status: 503 });
  }
}
