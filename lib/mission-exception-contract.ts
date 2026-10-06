export const MISSION_EXCEPTION_TYPES = [
  "DELAYED",
  "BLOCKED",
  "VEHICLE_FAULT",
  "PARTIAL_DELIVERY",
  "REFUSED",
  "LOST",
  "RECONCILE_REQUIRED",
  "CANCELLED",
] as const;

export type MissionExceptionType = (typeof MISSION_EXCEPTION_TYPES)[number];
export type MissionExceptionRecoveryStatus = "OPEN" | "RESOLVED";

export type MissionException = {
  type: MissionExceptionType;
  note: string;
  reference: string | null;
  stopId: string | null;
  reportedAt: string;
  reportedBy: string;
  recoveryStatus: MissionExceptionRecoveryStatus;
  resolvedAt?: string;
  resolvedBy?: string;
  resolutionNote?: string;
};

export const MISSION_EXCEPTION_LABELS: Record<MissionExceptionType, string> = {
  DELAYED: "Ritardo operativo",
  BLOCKED: "Missione bloccata",
  VEHICLE_FAULT: "Guasto mezzo",
  PARTIAL_DELIVERY: "Consegna parziale",
  REFUSED: "Consegna rifiutata",
  LOST: "Carico non reperibile",
  RECONCILE_REQUIRED: "Riconciliazione richiesta",
  CANCELLED: "Missione annullata",
};

type ExceptionInput = {
  exceptionType?: unknown;
  note?: unknown;
  reference?: unknown;
  stopId?: unknown;
};

export type MissionExceptionResult =
  | { exception: MissionException; error?: never }
  | { exception?: never; error: "unsupported_mission_exception" | "mission_exception_note_required" | "mission_exception_timestamp_invalid" | "mission_exception_actor_required" };

function boundedText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function missionExceptionLabel(value: unknown) {
  const type = typeof value === "string" ? value.trim().toUpperCase() as MissionExceptionType : null;
  return type && type in MISSION_EXCEPTION_LABELS ? MISSION_EXCEPTION_LABELS[type] : "Eccezione non riconosciuta";
}

export function normalizeMissionException(input: ExceptionInput, reportedAt: string, reportedBy: string): MissionExceptionResult {
  const rawType = boundedText(input.exceptionType, 48).toUpperCase();
  if (!(MISSION_EXCEPTION_TYPES as readonly string[]).includes(rawType)) return { error: "unsupported_mission_exception" };
  if (!reportedAt || !Number.isFinite(Date.parse(reportedAt))) return { error: "mission_exception_timestamp_invalid" };
  if (!reportedBy.trim()) return { error: "mission_exception_actor_required" };
  const note = boundedText(input.note, 2_000);
  if (note.length < 2) return { error: "mission_exception_note_required" };
  return {
    exception: {
      type: rawType as MissionExceptionType,
      note,
      reference: boundedText(input.reference, 240) || null,
      stopId: boundedText(input.stopId, 160) || null,
      reportedAt,
      reportedBy: reportedBy.trim().slice(0, 200),
      recoveryStatus: "OPEN",
    },
  };
}

export function storedMissionException(value: unknown): MissionException | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const normalized = normalizeMissionException({
    exceptionType: record.type,
    note: record.note,
    reference: record.reference,
    stopId: record.stopId,
  }, boundedText(record.reportedAt, 40), boundedText(record.reportedBy, 200));
  if (!normalized.exception) return null;
  const recoveryStatus = boundedText(record.recoveryStatus, 16).toUpperCase();
  return {
    ...normalized.exception,
    recoveryStatus: recoveryStatus === "RESOLVED" ? "RESOLVED" : "OPEN",
    ...(boundedText(record.resolvedAt, 40) ? { resolvedAt: boundedText(record.resolvedAt, 40) } : {}),
    ...(boundedText(record.resolvedBy, 200) ? { resolvedBy: boundedText(record.resolvedBy, 200) } : {}),
    ...(boundedText(record.resolutionNote, 2_000) ? { resolutionNote: boundedText(record.resolutionNote, 2_000) } : {}),
  };
}

export function missionExceptionIsOpen(value: unknown) {
  return storedMissionException(value)?.recoveryStatus === "OPEN";
}
