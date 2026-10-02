export const DOCUMENT_SECURITY_ACTIONS = [
  "queue_scan",
  "manual_review",
  "quarantine",
  "provider_result",
  "release",
] as const;

export type DocumentSecurityAction = (typeof DOCUMENT_SECURITY_ACTIONS)[number];
export type DocumentProviderResult = "CLEAN" | "INFECTED";

export class DocumentSecurityTransitionError extends Error {
  public readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export type DocumentSecurityTransition = {
  scanStatus: string;
  documentStatus: string;
  detail: string;
};

export function transitionDocumentSecurity({
  scanStatus,
  documentStatus,
  action,
  providerResult,
}: {
  scanStatus: string;
  documentStatus: string;
  action: DocumentSecurityAction;
  providerResult?: DocumentProviderResult;
}): DocumentSecurityTransition {
  const currentScan = scanStatus.trim().toUpperCase();
  const currentDocument = documentStatus.trim().toUpperCase();

  if (action === "queue_scan") {
    if (!["NOT_RUN", "MANUAL_REVIEW"].includes(currentScan) || currentDocument === "BLOCKED_MALWARE") {
      throw new DocumentSecurityTransitionError("document_scan_queue_not_allowed");
    }
    return {
      scanStatus: "PENDING_PROVIDER",
      documentStatus: "QUARANTINED_PENDING_SCAN",
      detail: "Documento messo in quarantena in attesa di malware scan provider-backed.",
    };
  }

  if (action === "manual_review") {
    if (["INFECTED_PROVIDER", "QUARANTINED"].includes(currentScan)) {
      throw new DocumentSecurityTransitionError("document_manual_review_not_allowed");
    }
    return {
      scanStatus: "MANUAL_REVIEW",
      documentStatus: "QUARANTINED_REVIEW",
      detail: "Documento isolato per revisione umana; nessuna pulizia è stata dichiarata.",
    };
  }

  if (action === "quarantine") {
    if (currentScan === "INFECTED_PROVIDER") {
      return {
        scanStatus: currentScan,
        documentStatus: "BLOCKED_MALWARE",
        detail: "Documento già classificato infetto e mantenuto bloccato.",
      };
    }
    return {
      scanStatus: "QUARANTINED",
      documentStatus: "QUARANTINED",
      detail: "Documento isolato manualmente; nessuna scansione positiva è stata dichiarata.",
    };
  }

  if (action === "provider_result") {
    if (currentScan !== "PENDING_PROVIDER") {
      throw new DocumentSecurityTransitionError("document_provider_result_requires_pending_scan");
    }
    if (providerResult === "CLEAN") {
      return {
        scanStatus: "CLEAN_PROVIDER",
        documentStatus: "AVAILABLE_CLEAN",
        detail: "Malware scan provider-backed concluso con esito CLEAN.",
      };
    }
    if (providerResult === "INFECTED") {
      return {
        scanStatus: "INFECTED_PROVIDER",
        documentStatus: "BLOCKED_MALWARE",
        detail: "Malware scan provider-backed concluso con esito INFECTED; download bloccato.",
      };
    }
    throw new DocumentSecurityTransitionError("provider_result_required");
  }

  if (currentScan !== "CLEAN_PROVIDER") {
    throw new DocumentSecurityTransitionError("document_release_requires_provider_clean");
  }
  return {
    scanStatus: "CLEAN_PROVIDER",
    documentStatus: "AVAILABLE_CLEAN",
    detail: "Documento rilasciato dopo evidenza provider-backed CLEAN.",
  };
}

export function documentCanDownload(scanStatus: string, documentStatus: string) {
  return scanStatus.trim().toUpperCase() === "CLEAN_PROVIDER"
    && documentStatus.trim().toUpperCase() === "AVAILABLE_CLEAN";
}
