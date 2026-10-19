import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { s06Events, s06Outbox, s06Reconciliations, s07AiLedger } from "@/db/schema";
import { companyAiRateLimit, companyAiRateLimitResponse, consumeCompanyAiRateLimit } from "@/lib/ai-rate-limit";
import { analyzeCompanyAiMacroScopeWithOpenAi } from "@/lib/company-ai-openai";
import { getCompanyAiMacroScopeCatalog } from "@/lib/company-ai-macro-scope";
import { getS07Context, s07AccessDenied } from "@/lib/s07-adapter";

export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseObject(value: string | null | undefined) {
  if (!value) return {} as Record<string, unknown>;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {} as Record<string, unknown>;
  }
}

function previewResponse(row: typeof s07AiLedger.$inferSelect, payload: Record<string, unknown>, idempotent: boolean) {
  return Response.json({
    previewId: row.id,
    scopeV2: payload.scopeV2,
    catalog: payload.catalog,
    runtime: payload.runtime,
    aiRuntime: payload.aiRuntime,
    directWrite: false,
    readback: { status: "SITES_LEDGER_VERIFIED", checkedAt: row.createdAt },
    idempotent,
  }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const context = await getS07Context();
  const denied = s07AccessDenied(context, "write");
  if (denied) return denied;

  let input: Record<string, unknown>;
  try {
    const parsed = await request.json() as unknown;
    if (!isRecord(parsed)) return Response.json({ error: "invalid_json" }, { status: 400 });
    input = parsed;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const description = typeof input.description === "string" ? input.description : "";
  if (description.length > 2_000) return Response.json({ error: "description_too_long" }, { status: 413 });
  if (description.trim().length < 2) return Response.json({ error: "scope_description_required" }, { status: 400 });
  const idempotencyKey = typeof input.idempotencyKey === "string" ? input.idempotencyKey.trim() : "";
  if (idempotencyKey.length > 160) return Response.json({ error: "idempotency_key_too_long" }, { status: 400 });

  const rateLimit = await consumeCompanyAiRateLimit({
    tenantId: context!.tenantId,
    actorId: context!.actorId,
    action: "intake",
    limit: companyAiRateLimit("intake"),
  });
  if (!rateLimit.allowed) return companyAiRateLimitResponse(rateLimit);

  const db = getDb();
  const requestKey = idempotencyKey || `s07:macro-scope:${crypto.randomUUID()}`;
  try {
    const [existingEvent] = await db.select().from(s06Events).where(and(
      eq(s06Events.tenantId, context!.tenantId),
      eq(s06Events.idempotencyKey, requestKey),
    )).limit(1);
    if (existingEvent) {
      if (existingEvent.aggregateType !== "s07.intake.preview") {
        return Response.json({ error: "company_ai_scope_idempotency_conflict" }, { status: 409 });
      }
      const [existingPreview] = await db.select().from(s07AiLedger).where(and(
        eq(s07AiLedger.tenantId, context!.tenantId),
        eq(s07AiLedger.id, existingEvent.aggregateId),
      )).limit(1);
      if (!existingPreview) return Response.json({ error: "company_ai_scope_preview_readback_unavailable" }, { status: 503 });
      const stored = parseObject(existingPreview.payloadJson);
      const priorScope = isRecord(stored.scopeV2) ? stored.scopeV2 : {};
      if (priorScope.descriptionOriginal !== description) {
        return Response.json({ error: "company_ai_scope_idempotency_conflict" }, { status: 409 });
      }
      return previewResponse(existingPreview, stored, true);
    }

    const catalog = getCompanyAiMacroScopeCatalog(context!.tenantId);
    const outcome = await analyzeCompanyAiMacroScopeWithOpenAi({ description, catalog });
    const previewId = crypto.randomUUID();
    const eventId = crypto.randomUUID();
    const now = new Date().toISOString();
    const runtime = outcome.status === "used" ? "openai-macro-scope-v2" : "macro-scope-v2-validated-fallback";
    const payload = {
      source: "company-ai-macro-scope-v2",
      catalogVersion: catalog.version,
      scopeV2: outcome.proposal,
      catalog,
      runtime,
      aiRuntime: {
        provider: "openai",
        status: outcome.status,
        model: outcome.model,
        requestId: outcome.requestId ?? null,
      },
      idempotencyKey: requestKey,
    };
    const payloadJson = JSON.stringify(payload);
    if (payloadJson.length > 40_000) return Response.json({ error: "company_ai_scope_preview_too_large" }, { status: 413 });

    await db.batch([
      db.insert(s07AiLedger).values({
        id: previewId,
        tenantId: context!.tenantId,
        entryType: "commessa_intake_preview",
        actionType: "operations.commessa_macro_scope_v2",
        command: "Analizza lo scope della commessa con Company AI",
        status: "PREVIEW_ONLY",
        approvalRequired: 1,
        relatedActionId: null,
        payloadJson,
        requestedBy: context!.actorId,
        approvedBy: null,
        readbackJson: JSON.stringify({ status: "SITES_LEDGER_VERIFIED", checkedAt: now }),
        createdAt: now,
      }),
      db.insert(s06Events).values({
        eventId,
        tenantId: context!.tenantId,
        eventType: "company_ai.macro_scope.previewed",
        schemaVersion: "2",
        actorType: "human",
        actorId: context!.actorId,
        source: "sites-command",
        occurredAt: now,
        observedAt: now,
        aggregateType: "s07.intake.preview",
        aggregateId: previewId,
        aggregateVersion: 1,
        payloadJson: JSON.stringify({
          catalogVersion: catalog.version,
          descriptionLength: description.length,
          groupsProposed: outcome.proposal.groupsProposed,
          activitiesProposed: outcome.proposal.activitiesProposed.length,
          scopeStatus: "DA_CONFERMARE",
          aiStatus: outcome.status,
        }),
        correlationId: crypto.randomUUID(),
        causationId: null,
        idempotencyKey: requestKey,
        status: "COMMITTED_SITES_READBACK",
        createdAt: now,
      }),
      db.insert(s06Outbox).values({
        id: crypto.randomUUID(),
        tenantId: context!.tenantId,
        eventId,
        topic: "zerow.company_ai.macro_scope.previewed",
        status: "PENDING_EXTERNAL_CONSUMER",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(s06Reconciliations).values({
        id: crypto.randomUUID(),
        tenantId: context!.tenantId,
        aggregateType: "s07.intake.preview",
        aggregateId: previewId,
        expectedVersion: 1,
        observedVersion: 1,
        status: "SITES_READBACK_VERIFIED",
        detail: "Proposta Company AI Macro Scope V2 salvata nel ledger S07 con evento S06; nessuna commessa o attività di pianificazione scritta.",
        createdAt: now,
        updatedAt: now,
      }),
    ]);

    const [readback] = await db.select().from(s07AiLedger).where(and(
      eq(s07AiLedger.tenantId, context!.tenantId),
      eq(s07AiLedger.id, previewId),
    )).limit(1);
    if (!readback) return Response.json({ error: "company_ai_scope_preview_readback_unavailable" }, { status: 503 });
    return previewResponse(readback, payload, false);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.toLowerCase().includes("unique")) return Response.json({ error: "company_ai_scope_idempotency_conflict" }, { status: 409 });
    return Response.json({ error: "company_ai_scope_preview_unavailable" }, { status: 503 });
  }
}
