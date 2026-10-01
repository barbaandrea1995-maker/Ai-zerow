import { and, desc, eq, or } from "drizzle-orm";
import { getDb } from "@/db";
import { companyAiJobScopes, s04Records, s06Events, s06Outbox, s06Reconciliations, s07AiLedger } from "@/db/schema";
import {
  getAuthorityContext,
  hasCapability,
  publicAuthorityContext,
} from "@/lib/authority-context";
import {
  COMPANY_AI_KNOWLEDGE_PACK_ID,
  getCompanyAiKnowledgePackSummary,
  resolveCompanyAiKnowledgeEntries,
  toCompanyAiKnowledgeHint,
} from "@/lib/company-ai-knowledge";

export const dynamic = "force-dynamic";

const SCOPE_STATUSES = new Set(["DRAFT", "PROPOSED", "CONFIRMED", "SUPERSEDED"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function bounded(value: unknown, max: number, fallback = "") {
  return text(value, fallback).slice(0, max);
}

function stringArray(value: unknown, maxItems: number, maxLength: number) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean).map((item) => item.slice(0, maxLength)))].slice(0, maxItems);
}

function parseStringArray(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return stringArray(parsed, 80, 240);
  } catch {
    return [];
  }
}

function scopeForResponse(row: typeof companyAiJobScopes.$inferSelect) {
  return {
    id: row.id,
    jobId: row.jobId,
    jobCode: row.jobCode,
    knowledgePackId: row.knowledgePackId,
    knowledgePackVersion: row.knowledgePackVersion,
    scopeText: row.scopeText,
    knowledgeEntryIds: parseStringArray(row.knowledgeEntryIdsJson),
    assumptions: parseStringArray(row.assumptionsJson),
    exclusions: parseStringArray(row.exclusionsJson),
    status: row.status,
    source: row.source,
    version: row.version,
    idempotencyKey: row.idempotencyKey,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function denied(context: Awaited<ReturnType<typeof getAuthorityContext>>, capability: string) {
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, capability)) return Response.json({ error: "forbidden", capability }, { status: 403 });
  return null;
}

async function findJob(jobRef: string, tenantId: string) {
  const rows = await getDb()
    .select({ id: s04Records.id, canonicalCode: s04Records.canonicalCode, title: s04Records.title })
    .from(s04Records)
    .where(and(eq(s04Records.tenantId, tenantId), eq(s04Records.module, "operations"), or(eq(s04Records.id, jobRef), eq(s04Records.canonicalCode, jobRef))))
    .limit(1);
  return rows[0] ?? null;
}

async function responseForScope(context: NonNullable<Awaited<ReturnType<typeof getAuthorityContext>>>, scope: typeof companyAiJobScopes.$inferSelect, status = 200) {
  const selected = resolveCompanyAiKnowledgeEntries(parseStringArray(scope.knowledgeEntryIdsJson)).map(toCompanyAiKnowledgeHint);
  return Response.json({
    context: publicAuthorityContext(context),
    contract: { route: "/api/company-ai/scope", source: "company-ai-scope-link", directWrite: false, readback: "sites-d1-verified" },
    pack: getCompanyAiKnowledgePackSummary(),
    scope: scopeForResponse(scope),
    knowledgeEntries: selected,
    readback: { status: "SCOPE_LINK_VERIFIED", checkedAt: new Date().toISOString() },
  }, { status, headers: { "cache-control": "no-store" } });
}

export async function GET(request: Request) {
  const context = await getAuthorityContext();
  const access = denied(context, "operations.read");
  if (access) return access;
  const jobRef = new URL(request.url).searchParams.get("jobId")?.trim() ?? "";
  if (!jobRef) return Response.json({ error: "job_id_required" }, { status: 400 });

  try {
    const job = await findJob(jobRef, context!.tenantId);
    if (!job) return Response.json({ error: "job_not_found" }, { status: 404 });
    const rows = await getDb().select().from(companyAiJobScopes)
      .where(and(eq(companyAiJobScopes.tenantId, context!.tenantId), eq(companyAiJobScopes.jobId, job.id)))
      .orderBy(desc(companyAiJobScopes.version));
    return Response.json({
      context: publicAuthorityContext(context!),
      contract: { route: "/api/company-ai/scope", source: "company-ai-scope-link", directWrite: false, readback: "sites-d1-verified" },
      pack: getCompanyAiKnowledgePackSummary(),
      job: { id: job.id, canonicalCode: job.canonicalCode, title: job.title },
      scopes: rows.map(scopeForResponse),
      latest: rows[0] ? scopeForResponse(rows[0]) : null,
      readback: { status: "SCOPE_READBACK_VERIFIED", count: rows.length, checkedAt: new Date().toISOString() },
    }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "company_ai_scope_readback_unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const context = await getAuthorityContext();
  const access = denied(context, "operations.write");
  if (access) return access;

  let input: Record<string, unknown>;
  try {
    const parsed = await request.json() as unknown;
    if (!isRecord(parsed)) return Response.json({ error: "invalid_json" }, { status: 400 });
    input = parsed;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const jobRef = bounded(input.jobId, 160);
  const packId = bounded(input.knowledgePackId, 120, COMPANY_AI_KNOWLEDGE_PACK_ID);
  const pack = getCompanyAiKnowledgePackSummary();
  const packVersion = bounded(input.knowledgePackVersion, 32, pack.version);
  const scopeText = bounded(input.scopeText, 6_000);
  const requestedEntryIds = stringArray(input.knowledgeEntryIds, 80, 180);
  const entries = resolveCompanyAiKnowledgeEntries(requestedEntryIds);
  const status = bounded(input.status, 24, "DRAFT").toUpperCase();
  const assumptions = stringArray(input.assumptions, 40, 240);
  const exclusions = stringArray(input.exclusions, 40, 240);
  const idempotencyKey = bounded(input.idempotencyKey, 160) || `company-ai-scope:${crypto.randomUUID()}`;

  if (!jobRef) return Response.json({ error: "job_id_required" }, { status: 400 });
  if (packId !== pack.id) return Response.json({ error: "unknown_knowledge_pack", knowledgePackId: packId }, { status: 400 });
  if (packVersion !== pack.version) return Response.json({ error: "knowledge_pack_version_mismatch", expected: pack.version }, { status: 409 });
  if (!scopeText && !requestedEntryIds.length) return Response.json({ error: "scope_or_knowledge_entries_required" }, { status: 400 });
  if (entries.length !== requestedEntryIds.length) return Response.json({ error: "unknown_knowledge_entry" }, { status: 400 });
  if (!SCOPE_STATUSES.has(status)) return Response.json({ error: "unknown_scope_status" }, { status: 400 });

  try {
    const db = getDb();
    const job = await findJob(jobRef, context!.tenantId);
    if (!job) return Response.json({ error: "job_not_found" }, { status: 404 });

    const existingEvent = await db.select().from(s06Events)
      .where(and(eq(s06Events.tenantId, context!.tenantId), eq(s06Events.idempotencyKey, idempotencyKey)))
      .limit(1);
    if (existingEvent[0]) {
      const existingScope = await db.select().from(companyAiJobScopes).where(and(eq(companyAiJobScopes.tenantId, context!.tenantId), eq(companyAiJobScopes.id, existingEvent[0].aggregateId))).limit(1);
      if (existingScope[0]) return responseForScope(context!, existingScope[0]);
    }

    const latest = await db.select({ version: companyAiJobScopes.version }).from(companyAiJobScopes)
      .where(and(eq(companyAiJobScopes.tenantId, context!.tenantId), eq(companyAiJobScopes.jobId, job.id)))
      .orderBy(desc(companyAiJobScopes.version)).limit(1);
    const version = (latest[0]?.version ?? 0) + 1;
    const now = new Date().toISOString();
    const scopeId = `COMPANY-AI-SCOPE-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const eventId = crypto.randomUUID();
    const jobCode = job.canonicalCode ?? job.id;
    const entryIdsJson = JSON.stringify(entries.map((entry) => entry.id));
    const eventPayload = JSON.stringify({ action: "link", aggregate: "company_ai_scope", jobId: job.id, jobCode, knowledgePackId: pack.id, knowledgePackVersion: pack.version, knowledgeEntryCount: entries.length, version, status });

    await db.batch([
      db.insert(companyAiJobScopes).values({
        id: scopeId,
        tenantId: context!.tenantId,
        jobId: job.id,
        jobCode,
        knowledgePackId: pack.id,
        knowledgePackVersion: pack.version,
        scopeText,
        knowledgeEntryIdsJson: entryIdsJson,
        assumptionsJson: JSON.stringify(assumptions),
        exclusionsJson: JSON.stringify(exclusions),
        status,
        source: "human-authored",
        version,
        idempotencyKey,
        createdBy: context!.actorId,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(s06Events).values({
        eventId,
        tenantId: context!.tenantId,
        eventType: "company_ai.scope.linked",
        schemaVersion: "1",
        actorType: "human",
        actorId: context!.actorId,
        source: "sites-command",
        occurredAt: now,
        observedAt: now,
        aggregateType: "company_ai_scope",
        aggregateId: scopeId,
        aggregateVersion: version,
        payloadJson: eventPayload,
        correlationId: crypto.randomUUID(),
        causationId: null,
        idempotencyKey,
        status: "COMMITTED_SITES_READBACK",
        createdAt: now,
      }),
      db.insert(s06Outbox).values({
        id: crypto.randomUUID(),
        tenantId: context!.tenantId,
        eventId,
        topic: "zerow.company-ai.scope.linked",
        status: "PENDING_EXTERNAL_CONSUMER",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(s06Reconciliations).values({
        id: crypto.randomUUID(),
        tenantId: context!.tenantId,
        aggregateType: "company_ai_scope",
        aggregateId: scopeId,
        expectedVersion: version,
        observedVersion: version,
        status: "SITES_READBACK_VERIFIED",
        detail: "Scope Company AI collegato alla commessa su D1; consumer canonico esterno ancora differito.",
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(s07AiLedger).values({
        id: crypto.randomUUID(),
        tenantId: context!.tenantId,
        entryType: "knowledge_scope_link",
        actionType: "company_ai.scope.link",
        command: `Collega il knowledge pack ${pack.id} alla commessa ${jobCode}`,
        status: status === "CONFIRMED" ? "CONFIRMED" : "DRAFT",
        approvalRequired: 0,
        relatedActionId: scopeId,
        payloadJson: JSON.stringify({ source: "human-authored", jobId: job.id, jobCode, knowledgePackId: pack.id, knowledgePackVersion: pack.version, knowledgeEntryIds: entries.map((entry) => entry.id), version, status }),
        requestedBy: context!.actorId,
        approvedBy: status === "CONFIRMED" ? context!.actorId : null,
        readbackJson: JSON.stringify({ status: "SITES_LEDGER_VERIFIED", checkedAt: now }),
        createdAt: now,
      }),
    ]);

    const [created] = await db.select().from(companyAiJobScopes).where(and(eq(companyAiJobScopes.tenantId, context!.tenantId), eq(companyAiJobScopes.id, scopeId))).limit(1);
    if (!created) return Response.json({ error: "company_ai_scope_readback_unavailable" }, { status: 503 });
    return responseForScope(context!, created, 201);
  } catch {
    return Response.json({ error: "company_ai_scope_write_unavailable" }, { status: 503 });
  }
}
