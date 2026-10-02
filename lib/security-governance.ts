export type SecurityControlStatus = "READY" | "PARTIAL" | "NOT_RUN" | "BLOCKED" | "PENDING_REVIEW";
export type SecurityControlDomain = "security" | "privacy" | "resilience" | "provider" | "release";

export type SecurityControl = {
  id: string;
  domain: SecurityControlDomain;
  label: string;
  status: SecurityControlStatus;
  detail: string;
  evidence: string;
  nextAction: string;
};

export function buildSecurityControlCatalog({
  ledgerStatus,
  externalReadbackStatus,
  malwareTokenConfigured,
}: {
  ledgerStatus: "READY" | "BLOCKED";
  externalReadbackStatus: "READY" | "BLOCKED";
  malwareTokenConfigured: boolean;
}): SecurityControl[] {
  return [
    {
      id: "tenant-isolation",
      domain: "security",
      label: "Isolamento tenant",
      status: "READY",
      detail: "Tenant, ruolo e capability sono risolti server-side e non arrivano dal prompt o dal body client.",
      evidence: "AuthorityContext · tenant-scoped queries",
      nextAction: "Mantenere il controllo su ogni nuovo endpoint",
    },
    {
      id: "capability-enforcement",
      domain: "security",
      label: "Capability enforcement",
      status: "READY",
      detail: "Le superfici e le API applicano il minimo privilegio; i ruoli non autorizzati non ricevono il modulo.",
      evidence: "RBAC 13 ruoli · deny-by-default route guards",
      nextAction: "Aggiungere una fixture negativa per ogni nuova capability",
    },
    {
      id: "payload-guards",
      domain: "security",
      label: "Payload e rate guard",
      status: "READY",
      detail: "Limiti dimensione, idempotenza, versioni ottimistiche e quota Company AI sono applicati prima della scrittura.",
      evidence: "413 payload · 429 quota · expectedVersion",
      nextAction: "Osservare i limiti dopo il runtime live",
    },
    {
      id: "secret-boundary",
      domain: "security",
      label: "Confine segreti",
      status: "READY",
      detail: "Le chiavi provider restano binding server-side: non vengono persistite, restituite al client o inserite nel ledger.",
      evidence: "metadata-only runtime readback",
      nextAction: "Verificare redazione nei log del runtime pubblicato",
    },
    {
      id: "document-fail-closed",
      domain: "security",
      label: "Documenti fail-closed",
      status: "READY",
      detail: "Il download resta bloccato finché non esiste evidenza provider CLEAN vincolata allo SHA-256 del file.",
      evidence: "security state machine · SHA-256 binding",
      nextAction: "Eseguire il provider malware reale",
    },
    {
      id: "privacy-on-duty",
      domain: "privacy",
      label: "Privacy tracking on-duty",
      status: "READY",
      detail: "La posizione operativa è prevista solo nel contesto di servizio e con precisione limitata.",
      evidence: "ON_DUTY_ONLY · 4_DECIMAL_PLACES",
      nextAction: "Approvare retention e informativa prima del go-live",
    },
    {
      id: "append-only-audit",
      domain: "security",
      label: "Audit append-only",
      status: ledgerStatus,
      detail: ledgerStatus === "READY"
        ? "Eventi, outbox, reconciliation e Company AI ledger sono rileggibili per tenant."
        : "Il readback del ledger non è disponibile nel runtime corrente.",
      evidence: ledgerStatus === "READY" ? "S06/S07 D1 readback" : "ledger readback unavailable",
      nextAction: ledgerStatus === "READY" ? "Nessuna azione locale" : "Ripristinare lo store D1",
    },
    {
      id: "restore-rehearsal",
      domain: "resilience",
      label: "Restore rehearsal",
      status: "READY",
      detail: "Il checkpoint locale registra il ripristino D1 e R2 con conteggi e hash coerenti.",
      evidence: "D1 PASS_LOCAL · R2 PASS_LOCAL",
      nextAction: "Ripetere sul runtime autorizzato prima della promozione",
    },
    {
      id: "external-registry",
      domain: "provider",
      label: "Registry adapter",
      status: externalReadbackStatus,
      detail: externalReadbackStatus === "READY"
        ? "I confini provider sono dichiarati e leggibili senza persistere credenziali."
        : "Il registry provider non è leggibile nel runtime corrente.",
      evidence: externalReadbackStatus === "READY" ? "S10–S14 declarative registry" : "external registry unavailable",
      nextAction: externalReadbackStatus === "READY" ? "Mantenere evidenze append-only" : "Ripristinare il readback D1",
    },
    {
      id: "malware-provider",
      domain: "provider",
      label: "Malware scanner provider",
      status: "NOT_RUN",
      detail: malwareTokenConfigured
        ? "Il binding tecnico è osservato, ma manca una prova callback CLEAN/INFECTED su file reale."
        : "Il provider non è configurato; i documenti restano in quarantena o revisione.",
      evidence: malwareTokenConfigured ? "token metadata only · no callback evidence" : "MALWARE_SCAN_WEBHOOK_TOKEN non osservato",
      nextAction: "Configurare provider, callback autenticata e test hash mismatch",
    },
    {
      id: "observability-slo",
      domain: "resilience",
      label: "Observability e SLO",
      status: "NOT_RUN",
      detail: "Metriche, tracing redatto, error budget e SLO/RPO/RTO formali non sono certificati dal runtime corrente.",
      evidence: "provider observability not run",
      nextAction: "Collegare monitoraggio autorizzato e produrre evidenza",
    },
    {
      id: "dpia-retention",
      domain: "privacy",
      label: "DPIA e retention",
      status: "PENDING_REVIEW",
      detail: "Minimizzazione, tempi di conservazione, DSAR e valutazione d’impatto richiedono approvazione umana documentata.",
      evidence: "policy draft · human review pending",
      nextAction: "Approvare DPIA, DPA, retention e incident response",
    },
    {
      id: "commercial-signoff",
      domain: "release",
      label: "Sign-off commerciale",
      status: "PENDING_REVIEW",
      detail: "La readiness tecnica locale non equivale a certificazione commerciale o autorizzazione al deploy.",
      evidence: "RC2.9 local candidate · promotion false",
      nextAction: "Chiudere tutti i gate esterni e ottenere approvazione esplicita",
    },
  ];
}

export function securityOverallStatus(controls: SecurityControl[]) {
  const ready = controls.filter((control) => control.status === "READY").length;
  const open = controls.length - ready;
  const provider = controls.filter((control) => control.domain === "provider" && control.status !== "READY").length;
  const review = controls.filter((control) => control.status === "PENDING_REVIEW").length;
  return {
    status: open === 0 ? "READY" as const : "PARTIAL" as const,
    commercialStatus: open === 0 ? "GO" as const : "NO_GO" as const,
    ready,
    open,
    provider,
    review,
    total: controls.length,
  };
}
