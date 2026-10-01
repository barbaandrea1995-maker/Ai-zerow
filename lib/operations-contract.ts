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

export type JobAssignment = {
  responsible: string;
  team: string;
  role: string;
  assignedAt: string;
  assignedBy: string;
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

export function jobCompletionRequirements(payload: JobPayload): JobCompletionRequirement[] {
  const rapportino = isRecord(payload.rapportino) && text(payload.rapportino.text).length >= 2;
  const activitiesComplete = payload.activities.length > 0 && payload.activities.every((activity) => activity.state === "done");
  const assignmentComplete = Boolean(payload.assignment && (text(payload.assignment.responsible) || text(payload.assignment.team)));
  const location = text(payload.location);
  return [
    { key: "title", label: "Nome commessa", complete: text(payload.title).length >= 2, detail: "Identità della commessa" },
    { key: "classification", label: "Classificazione", complete: text(payload.openingType).length >= 2 && text(payload.jobType).length >= 2 && text(payload.specialization).length >= 2, detail: "Tipo di apertura, tipo e specializzazione" },
    { key: "description", label: "Contesto operativo", complete: text(payload.description).length >= 2, detail: "Obiettivo e perimetro dell’intervento" },
    { key: "worksite", label: "Luogo di intervento", complete: location.length >= 2 && location.toLowerCase() !== "ubicazione da definire", detail: "Cantiere o sede dell’intervento" },
    { key: "assignment", label: "Assegnazione", complete: assignmentComplete, detail: "Responsabile o squadra operativa" },
    { key: "activities", label: "Attività completate", complete: activitiesComplete, detail: payload.activities.length ? "Tutte le attività devono essere chiuse" : "Inserisci almeno un’attività operativa" },
    { key: "evidence", label: "Evidenza operativa", complete: payload.evidence.length > 0, detail: "Almeno una evidenza verificabile" },
    { key: "rapportino", label: "Rapportino", complete: rapportino, detail: "Rapportino salvato con il consuntivo" },
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
