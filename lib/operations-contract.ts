export const JOB_STATUS_CODES = [
  "DRAFT",
  "PROPOSED",
  "APPROVED",
  "PLANNED",
  "ACTIVE",
  "BLOCKED",
  "COMPLETED",
  "CLOSED",
  "CANCELLED",
] as const;

export type JobStatusCode = (typeof JOB_STATUS_CODES)[number];

export type JobActivityState = "queued" | "active" | "done" | "blocked";

export type JobActivity = {
  id: string;
  title: string;
  detail: string;
  state: JobActivityState;
  owner: string;
  dueDate: string;
  progress: number;
  createdAt: string;
  updatedAt: string;
};

export type JobEvidence = {
  id: string;
  kind: "note" | "photo" | "file" | "voice";
  title: string;
  detail: string;
  createdAt: string;
  createdBy: string;
};

export type JobWorkItem = {
  id: string;
  label: string;
  detail: string;
  quantity: string;
  unit: string;
  confidence: number;
  source: string;
};

export type JobAssignment = {
  responsible: string;
  team: string;
  role: string;
  assignedAt: string;
  assignedBy: string;
  responsibleActorId?: string;
  responsibleMembershipId?: string;
  teamId?: string;
};

export type JobPayload = {
  title: string;
  description: string;
  client: string;
  location: string;
  category: string;
  priority: "HIGH" | "STANDARD" | "LOW";
  dueDate: string;
  statusCode: JobStatusCode;
  version: number;
  workItems: JobWorkItem[];
  progress?: number;
  activities: JobActivity[];
  evidence: JobEvidence[];
  assignment: JobAssignment | null;
  [key: string]: unknown;
};

const STATUS_ALIASES: Record<string, JobStatusCode> = {
  BOZZA: "DRAFT",
  DRAFT: "DRAFT",
  PROPOSTA: "PROPOSED",
  PROPOSED: "PROPOSED",
  APPROVATA: "APPROVED",
  APPROVED: "APPROVED",
  PIANIFICATA: "PLANNED",
  PLANNED: "PLANNED",
  "IN CORSO": "ACTIVE",
  IN_CORSO: "ACTIVE",
  ACTIVE: "ACTIVE",
  BLOCCATA: "BLOCKED",
  BLOCKED: "BLOCKED",
  COMPLETATA: "COMPLETED",
  COMPLETED: "COMPLETED",
  CHIUSA: "CLOSED",
  CLOSED: "CLOSED",
  ANNULLATA: "CANCELLED",
  CANCELLED: "CANCELLED",
};

export const JOB_STATUS_LABELS: Record<JobStatusCode, string> = {
  DRAFT: "BOZZA",
  PROPOSED: "PROPOSTA",
  APPROVED: "APPROVATA",
  PLANNED: "PIANIFICATA",
  ACTIVE: "IN CORSO",
  BLOCKED: "BLOCCATA",
  COMPLETED: "COMPLETATA",
  CLOSED: "CHIUSA",
  CANCELLED: "ANNULLATA",
};

const JOB_TRANSITIONS: Record<JobStatusCode, JobStatusCode[]> = {
  DRAFT: ["PROPOSED", "CANCELLED"],
  PROPOSED: ["APPROVED", "DRAFT", "CANCELLED"],
  APPROVED: ["PLANNED", "CANCELLED"],
  PLANNED: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["BLOCKED", "COMPLETED", "PLANNED"],
  BLOCKED: ["ACTIVE", "CANCELLED"],
  COMPLETED: ["CLOSED", "ACTIVE"],
  CLOSED: [],
  CANCELLED: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function progress(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(100, Math.round(numeric))) : 0;
}

function activityState(value: unknown): JobActivityState {
  return value === "active" || value === "done" || value === "blocked" ? value : "queued";
}

function activityFromUnknown(value: unknown, index: number): JobActivity | null {
  if (!isRecord(value)) return null;
  const title = text(value.title, text(value.label));
  if (!title) return null;
  const now = new Date().toISOString();
  return {
    id: text(value.id, `activity-${index + 1}`),
    title: title.slice(0, 160),
    detail: text(value.detail, "Attività operativa" ).slice(0, 280),
    state: activityState(value.state),
    owner: text(value.owner, "Da assegnare").slice(0, 120),
    dueDate: text(value.dueDate, "—").slice(0, 40),
    progress: progress(value.progress),
    createdAt: text(value.createdAt, now),
    updatedAt: text(value.updatedAt, now),
  };
}

function workItemFromUnknown(value: unknown, index: number): JobWorkItem | null {
  if (!isRecord(value)) return null;
  const label = text(value.label, text(value.detail));
  if (!label) return null;
  const confidenceValue = typeof value.confidence === "number" ? value.confidence : Number(value.confidence);
  return {
    id: text(value.id, `work-${index + 1}`).slice(0, 80),
    label: label.slice(0, 180),
    detail: text(value.detail, label).slice(0, 520),
    quantity: text(value.quantity).slice(0, 40),
    unit: text(value.unit).slice(0, 24),
    confidence: Number.isFinite(confidenceValue) ? Math.max(0, Math.min(1, confidenceValue)) : 0.7,
    source: text(value.source, "commessa-intake").slice(0, 120),
  };
}

export function normalizeJobStatus(value: unknown): JobStatusCode {
  const key = text(value, "PLANNED").toUpperCase().replace(/[-\s]+/g, "_");
  return STATUS_ALIASES[key] ?? "PLANNED";
}

export function jobStatusLabel(value: unknown): string {
  return JOB_STATUS_LABELS[normalizeJobStatus(value)];
}

export function clampJobProgress(value: unknown): number {
  return progress(value);
}

export type JobCompletionRequirement = {
  key: string;
  label: string;
  complete: boolean;
  detail: string;
};

export type RapportinoContextRecord = {
  title: string;
  detail?: string;
  status?: string;
  meta?: string;
};

export type RapportinoContext = {
  attendance?: RapportinoContextRecord[];
  resources?: RapportinoContextRecord[];
  materials?: RapportinoContextRecord[];
  field?: RapportinoContextRecord[];
};

export type RapportinoField = {
  key: string;
  label: string;
  value: string;
  status: "known" | "missing" | "optional";
  source: string;
};

export type RapportinoCompleteness = {
  ready: boolean;
  missing: string[];
  questions: string[];
};

export type RapportinoReview = {
  status: "PENDING" | "APPROVED" | "CHANGES_REQUESTED";
  note: string;
  reviewedAt: string;
  reviewedBy: string;
};

export type RapportinoReadback = {
  status: "EMPTY" | "DRAFT" | "SUBMITTED" | "APPROVED" | "CHANGES_REQUESTED";
  draft: string;
  fields: RapportinoField[];
  completeness: RapportinoCompleteness;
  review: RapportinoReview;
};

function uniqueReportRecords(records: RapportinoContextRecord[] = []) {
  const seen = new Set<string>();
  return records.filter((record) => {
    const key = `${text(record.title).toLocaleLowerCase("it-IT")}::${text(record.detail).toLocaleLowerCase("it-IT")}::${text(record.meta)}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 80);
}

function reportRecordsSummary(records: RapportinoContextRecord[], emptyLabel: string) {
  if (!records.length) return emptyLabel;
  return records
    .slice(0, 8)
    .map((record) => text(record.title, "Record operativo"))
    .join(", ");
}

function reportRecordLines(records: RapportinoContextRecord[], emptyLabel: string) {
  if (!records.length) return `- ${emptyLabel}`;
  return records
    .slice(0, 12)
    .map((record) => {
      const detail = text(record.detail);
      const status = text(record.status);
      return `- ${text(record.title, "Record operativo")}${detail ? ` · ${detail}` : ""}${status ? ` · ${status}` : ""}`;
    })
    .join("\n");
}

function reportStatus(value: unknown): RapportinoReadback["status"] {
  const normalized = text(value).toUpperCase();
  if (normalized === "APPROVED") return "APPROVED";
  if (normalized === "CHANGES_REQUESTED") return "CHANGES_REQUESTED";
  if (normalized === "SUBMITTED") return "SUBMITTED";
  if (normalized === "DRAFT") return "DRAFT";
  return "EMPTY";
}

export function buildRapportinoReadback(
  payload: JobPayload,
  context: RapportinoContext = {},
  options: { textOverride?: string } = {},
): RapportinoReadback {
  const report = isRecord(payload.rapportino) ? payload.rapportino : null;
  const attendance = uniqueReportRecords(context.attendance);
  const resources = uniqueReportRecords(context.resources);
  const materials = uniqueReportRecords(context.materials);
  const field = uniqueReportRecords(context.field);
  const savedText = text(options.textOverride ?? report?.text);
  const hasPlaceholder = /\[(?:da completare|da confermare|da indicare|da descrivere)\]/i.test(savedText);
  const narrativeComplete = savedText.length >= 40 && !hasPlaceholder;
  const doneActivities = payload.activities.filter((activity) => activity.state === "done").length;
  const openActivities = payload.activities.length - doneActivities;
  const attendanceClosed = attendance.some((record) => ["CHECKED_OUT", "APPROVED", "CLOSED"].includes(text(record.status).toUpperCase()));
  const assignmentLabel = payload.assignment
    ? [payload.assignment.responsible, payload.assignment.team].filter(Boolean).join(" · ")
    : "Da assegnare";

  const missing: string[] = [];
  const questions: string[] = [];
  if (!payload.activities.length) {
    missing.push("activities");
    questions.push("Quali attività sono state svolte durante il turno?");
  } else if (openActivities > 0) {
    missing.push("activities_status");
    questions.push("Ci sono attività ancora aperte: conferma cosa resta da fare o chiudi le attività completate.");
  }
  if (!payload.assignment) {
    missing.push("assignment");
    questions.push("Chi è il responsabile della squadra o dell’attività?");
  }
  if (!attendance.length) {
    missing.push("attendance");
    questions.push("Non trovo una timbratura collegata: verifica presenza e turno prima di inviare il rapportino.");
  } else if (!attendanceClosed) {
    missing.push("attendance_exit");
    questions.push("La presenza risulta ancora aperta: registra l’uscita prima di inviare il rapportino.");
  }
  if (!payload.evidence.length && !field.length) {
    missing.push("evidence");
    questions.push("Aggiungi almeno un’evidenza verificabile: nota, foto, file o rilievo operativo.");
  }
  if (!narrativeComplete) {
    missing.push("narrative");
    questions.push("Completa il consuntivo con attività svolte, criticità, materiali e prossimi passi.");
  }

  const fields: RapportinoField[] = [
    { key: "job", label: "Commessa", value: text(payload.title, "Da completare"), status: text(payload.title).length >= 2 ? "known" : "missing", source: "Anagrafica commessa" },
    { key: "worksite", label: "Luogo", value: text(payload.location, "Da verificare"), status: text(payload.location).length >= 2 ? "known" : "missing", source: "Location server-side" },
    { key: "assignment", label: "Responsabile / squadra", value: assignmentLabel, status: payload.assignment ? "known" : "missing", source: "Assegnazione operativa" },
    { key: "activities", label: "Attività", value: payload.activities.length ? `${doneActivities}/${payload.activities.length} completate` : "Nessuna attività registrata", status: payload.activities.length && openActivities === 0 ? "known" : "missing", source: "Attività della commessa" },
    { key: "attendance", label: "Presenze e timbrature", value: attendance.length ? `${attendance.length} record · ${attendanceClosed ? "uscita registrata" : "uscita da registrare"}` : "Da registrare", status: attendanceClosed ? "known" : "missing", source: "Presenze / geofence" },
    { key: "resources", label: "Persone, mezzi e asset", value: reportRecordsSummary(resources, "Nessuna risorsa collegata"), status: resources.length ? "known" : "optional", source: "Planning / Asset" },
    { key: "materials", label: "Materiali", value: reportRecordsSummary(materials, "Nessun movimento collegato"), status: materials.length ? "known" : "optional", source: "Magazzino" },
    { key: "evidence", label: "Evidenze", value: `${payload.evidence.length + field.length} record verificabili`, status: payload.evidence.length || field.length ? "known" : "missing", source: "Field / documenti" },
    { key: "narrative", label: "Consuntivo", value: narrativeComplete ? "Pronto per l’invio" : "Da completare", status: narrativeComplete ? "known" : "missing", source: "Company AI · risposta responsabile" },
  ];

  const generatedDraft = [
    `RAPPORTINO COMMESSA · ${new Date().toISOString().slice(0, 10)}`,
    `Commessa: ${text(payload.title, "[da completare]")}`,
    `Luogo: ${text(payload.location, "[da confermare]")}`,
    `Responsabile / squadra: ${assignmentLabel}`,
    "",
    "ATTIVITÀ",
    reportRecordsSummary(payload.activities.map((activity) => ({ title: activity.title, detail: activity.detail, status: activity.state })), "[da completare]"),
    "",
    "PRESENZE E RISORSE",
    reportRecordLines(attendance, "Presenza da verificare"),
    reportRecordLines(resources, "Nessuna risorsa collegata"),
    "",
    "MATERIALI",
    reportRecordLines(materials, "Nessun movimento materiale collegato"),
    "",
    "EVIDENZE",
    reportRecordLines([
      ...payload.evidence.map((item) => ({ title: item.title, detail: item.detail, status: item.kind })),
      ...field,
    ], "[da indicare]"),
    "",
    "CRITICITÀ / NOTE",
    "[da descrivere]",
    "",
    "PROSSIMI PASSI",
    "[da descrivere]",
  ].join("\n");
  const status = reportStatus(report?.status);
  const reviewStatus: RapportinoReview["status"] = status === "APPROVED"
    ? "APPROVED"
    : status === "CHANGES_REQUESTED"
      ? "CHANGES_REQUESTED"
      : "PENDING";

  return {
    status,
    draft: savedText || generatedDraft,
    fields,
    completeness: { ready: missing.length === 0, missing, questions },
    review: {
      status: reviewStatus,
      note: text(report?.reviewNote),
      reviewedAt: text(report?.reviewedAt),
      reviewedBy: text(report?.reviewedBy),
    },
  };
}

export function jobCompletionRequirements(payload: JobPayload): JobCompletionRequirement[] {
  const rapportino = isRecord(payload.rapportino)
    && text(payload.rapportino.text).length >= 2
    && (["SUBMITTED", "APPROVED"].includes(text(payload.rapportino.status).toUpperCase()) || !("status" in payload.rapportino));
  const activitiesComplete = payload.activities.length > 0 && payload.activities.every((activity) => activity.state === "done");
  const assignmentComplete = Boolean(payload.assignment && (text(payload.assignment.responsible) || text(payload.assignment.team)));
  const location = text(payload.location);
  const scope = isRecord(payload.scope) ? payload.scope : null;
  const scopeSubgroup = text(payload.scopeSubgroupId, text(scope?.subgroupId));
  const scopeComplete = scopeSubgroup.length >= 2 || (text(payload.jobType).length >= 2 && text(payload.specialization).length >= 2);
  return [
    { key: "title", label: "Nome commessa", complete: text(payload.title).length >= 2, detail: "Identità della commessa" },
    { key: "classification", label: "Scope operativo", complete: text(payload.openingType).length >= 2 && scopeComplete, detail: "Tipo commessa, sezione, raggruppamento e sottogruppo" },
    { key: "description", label: "Contesto operativo", complete: text(payload.description).length >= 2, detail: "Obiettivo e perimetro dell’intervento" },
    { key: "worksite", label: "Luogo di intervento", complete: location.length >= 2 && location.toLowerCase() !== "ubicazione da definire", detail: "Cantiere o sede dell’intervento" },
    { key: "assignment", label: "Assegnazione", complete: assignmentComplete, detail: "Responsabile o squadra operativa" },
    { key: "activities", label: "Attività completate", complete: activitiesComplete, detail: payload.activities.length ? "Tutte le attività devono essere chiuse" : "Inserisci almeno un’attività operativa" },
    { key: "evidence", label: "Evidenza operativa", complete: payload.evidence.length > 0, detail: "Almeno una evidenza verificabile" },
    { key: "rapportino", label: "Rapportino inviato", complete: rapportino, detail: "Il consuntivo deve essere verificato e inviato in ufficio" },
    { key: "progress", label: "Avanzamento", complete: clampJobProgress(payload.progress) >= 100, detail: "Porta l’avanzamento al 100% manualmente" },
  ];
}

export function parseJobPayload(payloadJson: string): JobPayload {
  let parsed: Record<string, unknown> = {};
  try {
    const value = JSON.parse(payloadJson) as unknown;
    if (isRecord(value)) parsed = value;
  } catch {
    parsed = {};
  }

  const activities = Array.isArray(parsed.activities)
    ? parsed.activities.map(activityFromUnknown).filter((item): item is JobActivity => Boolean(item))
    : [];
  const workItems = Array.isArray(parsed.workItems)
    ? parsed.workItems.map(workItemFromUnknown).filter((item): item is JobWorkItem => Boolean(item)).slice(0, 24)
    : [];
  const evidence = Array.isArray(parsed.evidence)
    ? parsed.evidence.filter(isRecord).map((item, index) => {
      const kind: JobEvidence["kind"] = item.kind === "photo" || item.kind === "file" || item.kind === "voice" ? item.kind : "note";
      return {
        id: text(item.id, `evidence-${index + 1}`),
        kind,
        title: text(item.title, "Evidenza operativa"),
        detail: text(item.detail),
        createdAt: text(item.createdAt, new Date().toISOString()),
        createdBy: text(item.createdBy, "server-readback"),
      };
    })
    : [];
  const rawAssignment = isRecord(parsed.assignment) ? parsed.assignment : null;
  const assignment = rawAssignment && (text(rawAssignment.responsible) || text(rawAssignment.team))
    ? {
      responsible: text(rawAssignment.responsible, "Da assegnare"),
      team: text(rawAssignment.team, "Da assegnare"),
      role: text(rawAssignment.role, "Responsabile operativo"),
      assignedAt: text(rawAssignment.assignedAt, new Date().toISOString()),
      assignedBy: text(rawAssignment.assignedBy, "server-readback"),
      ...(text(rawAssignment.responsibleActorId, text(rawAssignment.responsibleId)) ? { responsibleActorId: text(rawAssignment.responsibleActorId, text(rawAssignment.responsibleId)) } : {}),
      ...(text(rawAssignment.responsibleMembershipId, text(rawAssignment.membershipId)) ? { responsibleMembershipId: text(rawAssignment.responsibleMembershipId, text(rawAssignment.membershipId)) } : {}),
      ...(text(rawAssignment.teamId) ? { teamId: text(rawAssignment.teamId) } : {}),
    }
    : null;

  return {
    ...parsed,
    title: text(parsed.title),
    description: text(parsed.description),
    client: text(parsed.client),
    location: text(parsed.location),
    category: text(parsed.category, "Operations"),
    priority: parsed.priority === "HIGH" || parsed.priority === "LOW" ? parsed.priority : "STANDARD",
    dueDate: text(parsed.dueDate, text(parsed.due, "—")),
    statusCode: normalizeJobStatus(parsed.statusCode ?? parsed.status),
    version: Math.max(1, Math.floor(Number(parsed.version) || 1)),
    workItems,
    activities,
    evidence,
    assignment,
  };
}

export function canTransitionJob(from: JobStatusCode, to: JobStatusCode): boolean {
  return from === to || JOB_TRANSITIONS[from].includes(to);
}

export function validJobStatuses() {
  return [...JOB_STATUS_CODES];
}
