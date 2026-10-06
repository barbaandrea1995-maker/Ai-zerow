export const MISSION_POD_EVIDENCE_TYPES = [
  "DDT_SCANNED",
  "ORDER_MARKED_DELIVERED",
  "RECIPIENT_SIGNATURE",
  "DELIVERY_PHOTO",
  "AUTHORIZED_DRIVER_CONFIRMATION",
  "BARCODE_OR_QR_CONFIRMATION",
] as const;

export type MissionPodEvidenceType = (typeof MISSION_POD_EVIDENCE_TYPES)[number];

export type MissionPodEvidence = {
  type: MissionPodEvidenceType;
  reference: string | null;
  documentId: string | null;
  capturedAt: string;
  capturedBy: string;
};

export const MISSION_POD_EVIDENCE_LABELS: Record<MissionPodEvidenceType, string> = {
  DDT_SCANNED: "DDT scansionato",
  ORDER_MARKED_DELIVERED: "Ordine segnato consegnato",
  RECIPIENT_SIGNATURE: "Firma del ricevente",
  DELIVERY_PHOTO: "Foto della consegna",
  AUTHORIZED_DRIVER_CONFIRMATION: "Conferma autista autorizzato",
  BARCODE_OR_QR_CONFIRMATION: "Barcode / QR verificato",
};

const DOCUMENT_EVIDENCE_TYPES: readonly MissionPodEvidenceType[] = [
  "DDT_SCANNED",
  "RECIPIENT_SIGNATURE",
  "DELIVERY_PHOTO",
];

const REFERENCE_EVIDENCE_TYPES: readonly MissionPodEvidenceType[] = [
  "DDT_SCANNED",
  "ORDER_MARKED_DELIVERED",
  "BARCODE_OR_QR_CONFIRMATION",
];

type EvidenceInput = {
  evidenceType?: unknown;
  evidenceReference?: unknown;
  documentId?: unknown;
};

export type MissionPodEvidenceResult =
  | { evidence: MissionPodEvidence; error?: never }
  | { evidence?: never; error: "unsupported_mission_pod_evidence" | "pod_evidence_reference_required" | "pod_evidence_document_required" | "pod_evidence_timestamp_invalid" | "pod_evidence_actor_required" };

function boundedText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function missionPodEvidenceLabel(value: unknown) {
  const type = typeof value === "string" ? value.trim().toUpperCase() as MissionPodEvidenceType : null;
  return type && type in MISSION_POD_EVIDENCE_LABELS ? MISSION_POD_EVIDENCE_LABELS[type] : "Evidenza non riconosciuta";
}

export function missionPodEvidenceRequiresDocument(value: unknown): value is MissionPodEvidenceType {
  return typeof value === "string" && DOCUMENT_EVIDENCE_TYPES.includes(value as MissionPodEvidenceType);
}

export function missionPodEvidenceRequiresReference(value: unknown): value is MissionPodEvidenceType {
  return typeof value === "string" && REFERENCE_EVIDENCE_TYPES.includes(value as MissionPodEvidenceType);
}

export function normalizeMissionPodEvidence(input: EvidenceInput, capturedAt: string, capturedBy: string): MissionPodEvidenceResult {
  const rawType = boundedText(input.evidenceType, 48).toUpperCase();
  if (!(MISSION_POD_EVIDENCE_TYPES as readonly string[]).includes(rawType)) {
    return { error: "unsupported_mission_pod_evidence" };
  }
  if (!capturedAt || !Number.isFinite(Date.parse(capturedAt))) {
    return { error: "pod_evidence_timestamp_invalid" };
  }
  if (!capturedBy.trim()) {
    return { error: "pod_evidence_actor_required" };
  }
  const type = rawType as MissionPodEvidenceType;
  const reference = boundedText(input.evidenceReference, 240);
  const documentId = boundedText(input.documentId, 160);
  if (missionPodEvidenceRequiresReference(type) && !reference) {
    return { error: "pod_evidence_reference_required" };
  }
  if (missionPodEvidenceRequiresDocument(type) && !documentId) {
    return { error: "pod_evidence_document_required" };
  }
  return {
    evidence: {
      type,
      reference: reference || null,
      documentId: documentId || null,
      capturedAt,
      capturedBy: capturedBy.trim().slice(0, 200),
    },
  };
}

export function storedMissionPodEvidence(value: unknown): MissionPodEvidence | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const normalized = normalizeMissionPodEvidence({
    evidenceType: record.type,
    evidenceReference: record.reference,
    documentId: record.documentId,
  }, boundedText(record.capturedAt, 40), boundedText(record.capturedBy, 200));
  return normalized.evidence ?? null;
}

export function missionPodEvidenceComplete(value: unknown) {
  const evidence = storedMissionPodEvidence(value);
  return Boolean(evidence);
}
