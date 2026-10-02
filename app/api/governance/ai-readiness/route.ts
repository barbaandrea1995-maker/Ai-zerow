import {
  getAuthorityContext,
  hasCapability,
} from "@/lib/authority-context";
import { getCompanyAiRuntimeStatus } from "@/lib/company-ai-openai";
import { getExternalAdapter, getExternalSnapshot } from "@/lib/external-adapter";
import { getS07Ledger } from "@/lib/s07-adapter";

export const dynamic = "force-dynamic";

type ReadinessStatus = "READY" | "NOT_RUN" | "NOT_CONFIGURED" | "BLOCKED";

function gate(
  id: string,
  label: string,
  status: ReadinessStatus,
  detail: string,
  evidence: string,
  nextAction: string,
) {
  return { id, label, status, detail, evidence, nextAction };
}

export async function GET() {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "governance.read")) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const runtime = getCompanyAiRuntimeStatus();
  let ledgerCount = 0;
  let ledgerStatus: ReadinessStatus = "BLOCKED";
  let ledgerCheckedAt: string | null = null;
  try {
    const rows = await getS07Ledger(context.tenantId);
    ledgerCount = rows.length;
    ledgerStatus = "READY";
    ledgerCheckedAt = new Date().toISOString();
  } catch {
    ledgerStatus = "BLOCKED";
  }

  let externalReadback = "NOT_RUN" as ReadinessStatus;
  let persistedExternalChecks = 0;
  let latestOpenAiHealth: { result: string; checkedAt: string; evidence: string } | null = null;
  try {
    const snapshot = await getExternalSnapshot(context.tenantId);
    externalReadback = "READY";
    persistedExternalChecks = snapshot.readback.persistedChecks;
    const health = snapshot.checks.find(
      (check) => check.adapterKey === "openai-runtime" && check.checkType === "health",
    );
    if (health) {
      latestOpenAiHealth = {
        result: health.result,
        checkedAt: health.checkedAt,
        evidence: health.evidence,
      };
    }
  } catch {
    externalReadback = "BLOCKED";
  }

  const openAiAdapter = getExternalAdapter("openai-runtime");
  const gates = [
    gate(
      "tenant-authority",
      "Tenant e capability",
      "READY",
      "Il contesto viene risolto server-side prima di costruire il prompt.",
      `${context.role} · ${context.resourceScope} scope · ${context.identityProvider}`,
      "Nessuna azione richiesta",
    ),
    gate(
      "context-filtering",
      "Contesto filtrato",
      "READY",
      "Company AI riceve solo record e knowledge autorizzati dal dominio.",
      "Capability filter + citation allowlist",
      "Mantenere il filtro per ogni nuovo tool",
    ),
    gate(
      "structured-output",
      "Output strutturato",
      "READY",
      "Intake e Command usano schema strutturato e normalizzazione server-side.",
      "Responses API · schema strict · normalizzazione",
      "Aggiungere un nuovo schema solo con verifier",
    ),
    gate(
      "quota-payload",
      "Quota e payload guard",
      "READY",
      "Limiti di richiesta e quota tenant/actor sono applicati prima del provider.",
      "Rate limit atomico · payload limit",
      "Monitorare i limiti dopo il runtime live",
    ),
    gate(
      "no-direct-write",
      "Confine di scrittura",
      "READY",
      "L’AI prepara preview e proposte; non scrive direttamente nei domini.",
      "directWrite=false · approval boundary",
      "Collegare solo tool tipizzati e approvati",
    ),
    gate(
      "ledger-readback",
      "Ledger e readback",
      ledgerStatus,
      ledgerStatus === "READY"
        ? "Le preview Company AI vengono conservate nel ledger S07 e rileggibili per tenant."
        : "Il ledger S07 non è leggibile nel runtime corrente.",
      ledgerStatus === "READY" ? `${ledgerCount} entry recenti · D1 readback` : "s07_ai_ledger non verificato",
      ledgerStatus === "READY" ? "Nessuna azione richiesta" : "Ripristinare lo store D1 prima della certificazione",
    ),
    gate(
      "openai-binding",
      "Binding OpenAI",
      runtime.configured ? "READY" : "NOT_CONFIGURED",
      runtime.configured
        ? "Il runtime dichiara un binding server-side senza esportarne il valore."
        : "Nel runtime corrente non è disponibile un binding server-side utilizzabile.",
      runtime.configured ? "Secret presente · valore non esposto" : "Binding non osservato",
      runtime.configured ? "Eseguire richiesta live autenticata" : "Configurare OPENAI_API_KEY nel runtime Site",
    ),
    gate(
      "openai-live-request",
      "Richiesta OpenAI live",
      "NOT_RUN",
      "La presenza della chiave non certifica una chiamata autenticata né il readback del provider.",
      latestOpenAiHealth
        ? `Evidenza registrata: ${latestOpenAiHealth.result} · ${latestOpenAiHealth.checkedAt}`
        : "Nessuna evidenza health provider nel tenant",
      "Eseguire la prova live su runtime pubblicato e registrare request id/redacted evidence",
    ),
    gate(
      "external-readback",
      "Registry provider",
      externalReadback,
      externalReadback === "READY"
        ? "Il registro degli adapter è leggibile senza persistere segreti."
        : "Il registro degli adapter non è verificabile nel runtime corrente.",
      externalReadback === "READY"
        ? `${persistedExternalChecks} evidenze persistite · ${openAiAdapter?.status ?? "NOT_RUN"} catalog status`
        : "external registry readback non disponibile",
      externalReadback === "READY" ? "Mantenere evidenze append-only" : "Ripristinare il readback D1",
    ),
  ];

  return Response.json({
    contract: {
      tranche: "W12",
      source: "sites-d1-governed-ai-control-plane",
      directWrite: false,
      approval: "human approval required for actions",
      secrets: "metadata only; secret values never returned",
      commercialStatus: "NO_GO",
    },
    authority: {
      role: context.role,
      identityProvider: context.identityProvider,
      tenantScope: context.resourceScope,
      governanceRead: hasCapability(context, "governance.read"),
      commandRead: hasCapability(context, "command.read"),
      approvalsReview: hasCapability(context, "approvals.review"),
    },
    runtime,
    gates,
    ledger: {
      count: ledgerCount,
      status: ledgerStatus,
      checkedAt: ledgerCheckedAt,
    },
    external: {
      status: externalReadback,
      persistedChecks: persistedExternalChecks,
      openAiAdapterStatus: openAiAdapter?.status ?? "NOT_RUN",
      latestOpenAiHealth,
    },
    blockers: [
      "OpenAI live request e provider evidence non eseguite",
      "Malware scanner provider-backed non certificato",
      "Sessione Neon reale, consumer esterni e device certification non eseguiti",
      "Sign-off umano security/privacy/commerciale ancora aperto",
    ],
    readback: { status: "ok", checkedAt: new Date().toISOString() },
  }, { headers: { "cache-control": "private, no-store" } });
}
