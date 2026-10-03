import type { CompanyAiRuntimeStatus } from "@/lib/company-ai-openai";
import type { SecurityControl, SecurityControlStatus } from "@/lib/security-governance";

export type ReleaseGateStatus = SecurityControlStatus;

export type ReleaseGate = {
  id: string;
  workstream: string;
  label: string;
  status: ReleaseGateStatus;
  detail: string;
  evidence: string;
  nextAction: string;
  href?: string;
};

export type ReleaseReadinessInput = {
  ledgerStatus: "READY" | "BLOCKED";
  externalReadbackStatus: "READY" | "BLOCKED";
  externalSummary: {
    ready: number;
    deferred: number;
    blocked: number;
    notRun: number;
    total: number;
  };
  externalAdapters: Array<{
    key: string;
    effectiveStatus: string;
    lastCheck?: { result?: string } | null;
  }>;
  securityControls: SecurityControl[];
  runtime: CompanyAiRuntimeStatus;
};

export type ReleaseSummary = {
  status: "READY" | "PARTIAL";
  commercialStatus: "GO" | "NO_GO";
  promotionAllowed: boolean;
  ready: number;
  open: number;
  blocked: number;
  notRun: number;
  review: number;
  total: number;
};

function securityStatus(controls: SecurityControl[], id: string): SecurityControlStatus {
  return controls.find((control) => control.id === id)?.status ?? "BLOCKED";
}

function openAiStatus(input: ReleaseReadinessInput): ReleaseGateStatus {
  const adapter = input.externalAdapters.find((item) => item.key === "openai-runtime");
  if (input.runtime.liveRequest === "VERIFIED") return "READY";
  if (input.runtime.liveRequest === "FAILED") return "BLOCKED";
  if (adapter?.effectiveStatus === "BLOCKED") return "BLOCKED";
  return "NOT_RUN";
}

export function buildReleaseGateCatalog(input: ReleaseReadinessInput): ReleaseGate[] {
  const externalExecutorStatus: ReleaseGateStatus = input.externalReadbackStatus === "BLOCKED"
    ? "BLOCKED"
    : input.externalSummary.deferred > 0 || input.externalSummary.notRun > 0
      ? "NOT_RUN"
      : "READY";

  return [
    {
      id: "w12-local-contract",
      workstream: "W12",
      label: "Company AI local contract",
      status: input.ledgerStatus,
      detail: "Authority, contesto filtrato, citation allowlist, quota e no-direct-write sono verificati nel perimetro Sites.",
      evidence: input.ledgerStatus === "READY" ? "S07 ledger tenant-scoped · local readback" : "S07 ledger readback unavailable",
      nextAction: input.ledgerStatus === "READY" ? "Mantenere il confine server-side" : "Ripristinare il readback del ledger",
      href: "/governance",
    },
    {
      id: "openai-live",
      workstream: "W12",
      label: "OpenAI live authenticated",
      status: openAiStatus(input),
      detail: "La presenza di OPENAI_API_KEY non è una prova di richiesta riuscita: serve evidenza live redatta e riletta nel ledger.",
      evidence: input.runtime.configured ? `${input.runtime.model} · binding server-side · live ${input.runtime.liveRequest}` : "binding non osservato",
      nextAction: "Eseguire una richiesta autenticata sul runtime autorizzato e verificare request id/readback",
      href: "/externals",
    },
    {
      id: "w16-security-privacy",
      workstream: "W16",
      label: "Security, privacy e resilienza",
      status: input.securityControls.every((control) => control.status === "READY") ? "READY" : "PARTIAL",
      detail: "Il registro security/privacy separa controlli locali, provider non eseguiti e approvazioni umane.",
      evidence: `${input.securityControls.filter((control) => control.status === "READY").length}/${input.securityControls.length} controlli READY nel catalogo W16`,
      nextAction: "Chiudere provider, DPIA/retention e sign-off senza promuovere automaticamente la UI",
      href: "/governance/security",
    },
    {
      id: "document-fail-closed",
      workstream: "DOCUMENTS",
      label: "Document security fail-closed",
      status: securityStatus(input.securityControls, "document-fail-closed"),
      detail: "Il download dei documenti resta bloccato finché non esiste un risultato provider CLEAN vincolato allo SHA-256.",
      evidence: "SHA-256 binding · state machine locale",
      nextAction: "Conservare il blocco e produrre evidenza malware provider-backed",
      href: "/documents",
    },
    {
      id: "malware-provider",
      workstream: "DOCUMENTS",
      label: "Malware scanner provider",
      status: securityStatus(input.securityControls, "malware-provider"),
      detail: "Il callback reale CLEAN/INFECTED e il test di hash mismatch non sono stati certificati dal runtime.",
      evidence: "provider callback NOT_RUN",
      nextAction: "Configurare il provider autorizzato e verificare callback autenticata",
      href: "/documents",
    },
    {
      id: "w10-local-workflows",
      workstream: "W10",
      label: "Finance e Procurement local workflow",
      status: "READY",
      detail: "State machine, versioni, approval, eventi, outbox e reconciliation locale sono presenti senza simulare emissioni esterne.",
      evidence: "W10 contract · D1 workflow readback · external actions held",
      nextAction: "Lasciare le azioni provider-backed in attesa dell’executor autorizzato",
      href: "/finance",
    },
    {
      id: "external-executors",
      workstream: "ADAPTERS",
      label: "Executor e consumer esterni",
      status: externalExecutorStatus,
      detail: "Consumer eventi, accounting, PO, document storage/OCR e altri adapter restano fuori dalla prova Sites locale.",
      evidence: input.externalReadbackStatus === "READY"
        ? `${input.externalSummary.deferred} deferred · ${input.externalSummary.notRun} not run su ${input.externalSummary.total} adapter`
        : "external registry readback unavailable",
      nextAction: "Collegare un executor autorizzato con readback idempotente e auditabile",
      href: "/externals",
    },
    {
      id: "restore-rehearsal",
      workstream: "RESILIENCE",
      label: "Restore rehearsal D1 + R2",
      status: securityStatus(input.securityControls, "restore-rehearsal"),
      detail: "I checkpoint locali registrano conteggi D1 e hash R2 coerenti dopo il ripristino.",
      evidence: "D1 PASS_LOCAL · R2 PASS_LOCAL",
      nextAction: "Ripetere sul runtime autorizzato con RPO/RTO osservabili",
      href: "/governance/security",
    },
    {
      id: "observability-slo",
      workstream: "RESILIENCE",
      label: "Observability, SLO/RPO/RTO",
      status: securityStatus(input.securityControls, "observability-slo"),
      detail: "Metriche, tracing redatto, error budget e obiettivi operativi non sono certificati dal runtime corrente.",
      evidence: "provider observability NOT_RUN",
      nextAction: "Collegare monitoraggio autorizzato e produrre evidenza di soglie e incident response",
      href: "/pwa/diagnostics",
    },
    {
      id: "neon-invite-acceptance",
      workstream: "AUTHORITY",
      label: "Neon invite acceptance",
      status: "NOT_RUN",
      detail: "La matrice authority è locale e capability-gated; l’accettazione di un invito con sessione Neon reale non è stata eseguita qui.",
      evidence: "Neon provider session required",
      nextAction: "Eseguire il test A/B autorizzato con membership e denial cross-tenant",
      href: "/onboarding",
    },
    {
      id: "browser-device-certification",
      workstream: "CERTIFICATION",
      label: "Browser e device certification",
      status: "NOT_RUN",
      detail: "La build è stata verificata staticamente; la certificazione browser, PWA e device reale non è stata eseguita in questo ambiente.",
      evidence: "browser/device harness NOT_RUN",
      nextAction: "Eseguire smoke test desktop, tablet e PWA su device autorizzati",
      href: "/pwa/diagnostics",
    },
    {
      id: "dpia-retention",
      workstream: "PRIVACY",
      label: "DPIA, DPA e retention",
      status: securityStatus(input.securityControls, "dpia-retention"),
      detail: "Minimizzazione, retention, DSAR, informativa e incident response richiedono revisione umana documentata.",
      evidence: "policy draft · human review pending",
      nextAction: "Approvare DPIA, DPA, retention e procedura incidenti",
      href: "/governance/security",
    },
    {
      id: "commercial-signoff",
      workstream: "RELEASE",
      label: "Sign-off security/privacy/commerciale",
      status: securityStatus(input.securityControls, "commercial-signoff"),
      detail: "Il candidato locale non equivale a una certificazione commerciale né autorizza la pubblicazione.",
      evidence: "local candidate · promotion false",
      nextAction: "Chiudere i gate esterni e ottenere approvazione esplicita",
      href: "/release",
    },
  ];
}

export function releaseOverallStatus(gates: ReleaseGate[]): ReleaseSummary {
  const ready = gates.filter((gate) => gate.status === "READY").length;
  const blocked = gates.filter((gate) => gate.status === "BLOCKED").length;
  const notRun = gates.filter((gate) => gate.status === "NOT_RUN").length;
  const review = gates.filter((gate) => gate.status === "PENDING_REVIEW").length;
  const open = gates.length - ready;
  const commercialStatus = open === 0 ? "GO" as const : "NO_GO" as const;
  return {
    status: open === 0 ? "READY" : "PARTIAL",
    commercialStatus,
    promotionAllowed: commercialStatus === "GO",
    ready,
    open,
    blocked,
    notRun,
    review,
    total: gates.length,
  };
}
