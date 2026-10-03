import { getAuthorityContext, hasCapability } from "@/lib/authority-context";
import {
  companyAiRateLimit,
  companyAiRateLimitResponse,
  consumeCompanyAiRateLimit,
} from "@/lib/ai-rate-limit";
import { askCompanyAiWithOpenAi } from "@/lib/company-ai-openai";
import {
  appendExternalCheck,
  externalError,
} from "@/lib/external-adapter";

export const dynamic = "force-dynamic";

/**
 * Runs a deliberately minimal provider check. It never sends operational
 * records, never returns model output or credentials, and only persists
 * redacted evidence in the tenant-scoped external registry.
 */
export async function POST() {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "tenant.manage")) {
    return Response.json({ error: "forbidden", capability: "tenant.manage" }, { status: 403 });
  }

  const rateLimit = await consumeCompanyAiRateLimit({
    tenantId: context.tenantId,
    actorId: context.actorId,
    action: "release-check",
    limit: companyAiRateLimit("release-check"),
  });
  if (!rateLimit.allowed) return companyAiRateLimitResponse(rateLimit);

  const checkedAt = new Date().toISOString();
  const outcome = await askCompanyAiWithOpenAi({
    prompt: "Verifica tecnica runtime: rispondi con una breve conferma che la richiesta e stata ricevuta.",
    actionType: "release_check",
    approvalRequired: false,
    operationalContext: [],
    knowledgeContext: [],
  });
  const providerWorked = outcome.status === "used" && Boolean(outcome.result);
  const result = providerWorked ? "DECLARATIVE_PASS" : outcome.status === "not_configured" ? "NOT_RUN" : "BLOCKED";
  const detail = providerWorked
    ? "Richiesta OpenAI live completata dal runtime server-side; output non persistito."
    : outcome.status === "not_configured"
      ? "OPENAI_API_KEY non disponibile nel runtime server-side; nessuna chiamata eseguita."
      : "Il runtime server-side non ha ottenuto una risposta OpenAI valida.";
  const evidence = [
    `model=${outcome.model}`,
    `status=${outcome.status}`,
    `request_id_present=${Boolean(outcome.requestId)}`,
    `checked_at=${checkedAt}`,
  ].join(" · ");

  try {
    const persisted = await appendExternalCheck(
      context,
      {
        adapterKey: "openai-runtime",
        checkType: "health",
        result,
        detail,
        evidence,
      },
      { source: "sites-openai-live-check" },
    );

    return Response.json({
      status: outcome.status,
      result,
      provider: "openai",
      model: outcome.model,
      requestIdPresent: Boolean(outcome.requestId),
      outputPersisted: false,
      directWrite: false,
      checkedAt,
      readback: persisted.created,
      snapshot: persisted.snapshot,
    }, {
      status: providerWorked ? 200 : 503,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return Response.json({ error: externalError(error), status: outcome.status }, { status: 503 });
  }
}
