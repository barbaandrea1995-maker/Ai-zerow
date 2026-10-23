import type { CompanyAiMacroScopeConfirmation, CompanyAiMacroScopeId } from "@/lib/company-ai-macro-scope";
import type { JobCommercialTerms } from "@/lib/job-commercial-terms";

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
  ownerResourceId?: string;
  ownerResourceKind?: "person" | "team";
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
  /** V2 scope provenance; these items never become planned JobActivity rows. */
  macroGroupIds?: CompanyAiMacroScopeId[];
  macroGroupLabels?: string[];
  evidence?: string;
  proposalStatus?: "CONFERMATA";
  scope?: {
    sectionId: string;
    sectionTitle: string;
    groupId: string;
    groupTitle: string;
    subgroupId: string;
    subgroupTitle: string;
    source: "human-authored" | "company-ai-proposal-confirmed";
  };
};

export type JobAssignment = {
  responsible: string;
  team: string;
  role: string;
  roleCode?: string;
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
  commercialTerms?: JobCommercialTerms;
  scopeV2?: CompanyAiMacroScopeConfirmation;
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

const JOB_TRANSITION_ORDER: Record<JobStatusCode, readonly JobStatusCode[]> = {
  DRAFT: ["PROPOSED", "CANCELLED"],
  PROPOSED: ["APPROVED", "DRAFT", "CANCELLED"],
  APPROVED: ["PLANNED", "CANCELLED"],
  PLANNED: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["COMPLETED", "BLOCKED", "PLANNED"],
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

export function normalizeRapportinoAnswers(value: unknown): [string, string, string] | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  return value.map((answer) => text(answer).slice(0, 2_000)) as [string, string, string];
}

export function composeRapportinoNarrative(answers: readonly string[]) {
  const sections = [
    ["ATTIVITÀ SVOLTE ED ESITO", answers[0]],
    ["CRITICITÀ E SICUREZZA", answers[1]],
    ["PROSSIMI PASSI E RICHIESTE", answers[2]],
  ] as const;
  return sections
    .filter(([, answer]) => text(answer).length > 0)
    .map(([title, answer]) => `${title}:\n${text(answer)}`)
    .join("\n\n");
}

export function italyDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function persistedRapportinoDate(reportValue: unknown) {
  const report = isRecord(reportValue) ? reportValue : {};
  const persistedDate = text(report.reportDate);
  if (/^\d{4}-\d{2}-\d{2}$/.test(persistedDate)) return persistedDate;
  const anchor = [report.createdAt, report.submittedAt, report.updatedAt]
    .find((value) => typeof value === "string" && Number.isFinite(Date.parse(value)));
  return typeof anchor === "string" ? italyDateKey(new Date(anchor)) : "";
}

export function activeRapportinoDate(reportValue: unknown, now = new Date()) {
  const report = isRecord(reportValue) ? reportValue : {};
  const today = italyDateKey(now);
  const persistedDate = persistedRapportinoDate(report);
  if (persistedDate && persistedDate < today) return today;
  return persistedDate || today;
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
    ...(text(value.ownerResourceId) ? { ownerResourceId: text(value.ownerResourceId).slice(0, 160) } : {}),
    ...(value.ownerResourceKind === "person" || value.ownerResourceKind === "team" ? { ownerResourceKind: value.ownerResourceKind } : {}),
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
  const scopeValue = isRecord(value.scope) ? value.scope : null;
  const scope = scopeValue && ["sectionId", "sectionTitle", "groupId", "groupTitle", "subgroupId", "subgroupTitle"].every((key) => text(scopeValue[key]).length > 0)
    ? {
      sectionId: text(scopeValue.sectionId).slice(0, 80),
      sectionTitle: text(scopeValue.sectionTitle).slice(0, 120),
      groupId: text(scopeValue.groupId).slice(0, 120),
      groupTitle: text(scopeValue.groupTitle).slice(0, 160),
      subgroupId: text(scopeValue.subgroupId).slice(0, 160),
      subgroupTitle: text(scopeValue.subgroupTitle).slice(0, 180),
      source: scopeValue.source === "company-ai-proposal-confirmed" ? "company-ai-proposal-confirmed" as const : "human-authored" as const,
    }
    : undefined;
  const macroGroupIds = Array.isArray(value.macroGroupIds)
    ? [...new Set(value.macroGroupIds.filter((id): id is string => typeof id === "string").map((id) => id.slice(0, 80)))]
    : [];
  const macroGroupLabels = Array.isArray(value.macroGroupLabels)
    ? [...new Set(value.macroGroupLabels.filter((label): label is string => typeof label === "string").map((label) => label.slice(0, 120)))]
    : [];
  return {
    id: text(value.id, `work-${index + 1}`).slice(0, 80),
    label: label.slice(0, 180),
    detail: text(value.detail, label).slice(0, 520),
    quantity: text(value.quantity).slice(0, 40),
    unit: text(value.unit).slice(0, 24),
    confidence: Number.isFinite(confidenceValue) ? Math.max(0, Math.min(1, confidenceValue)) : 0.7,
    source: text(value.source, "commessa-intake").slice(0, 120),
    ...(macroGroupIds.length ? { macroGroupIds: macroGroupIds as CompanyAiMacroScopeId[] } : {}),
    ...(macroGroupLabels.length ? { macroGroupLabels } : {}),
    ...(typeof value.evidence === "string" && value.evidence.trim() ? { evidence: value.evidence.trim().slice(0, 240) } : {}),
    ...(value.proposalStatus === "CONFERMATA" ? { proposalStatus: "CONFERMATA" as const } : {}),
    ...(scope ? { scope } : {}),
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
  reportDate?: string;
  dayAlreadyApproved?: boolean;
  attendance?: RapportinoContextRecord[];
  assignment?: RapportinoContextRecord[];
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
  reportId: string;
  answers: string[];
  status: "EMPTY" | "DRAFT" | "SUBMITTED" | "APPROVED" | "CHANGES_REQUESTED";
  reportDate: string;
  dayAlreadyApproved: boolean;
  draft: string;
  narrative: string;
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
      const time = text(record.meta);
      return `- ${text(record.title, "Record operativo")}${detail ? ` · ${detail}` : ""}${status ? ` · ${status}` : ""}${time ? ` · ${time}` : ""}`;
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
  options: { textOverride?: string; narrativeOverride?: string; answersOverride?: unknown } = {},
): RapportinoReadback {
  const report = isRecord(payload.rapportino) ? payload.rapportino : null;
  const attendance = uniqueReportRecords(context.attendance);
  const assignments = uniqueReportRecords(context.assignment);
  const resources = uniqueReportRecords(context.resources);
  const materials = uniqueReportRecords(context.materials);
  const field = uniqueReportRecords(context.field);
  const savedText = text(options.textOverride ?? report?.text);
  const savedNarrative = text(options.narrativeOverride ?? report?.narrative);
  const answers = normalizeRapportinoAnswers(options.answersOverride ?? report?.answers);
  const hasDedicatedNarrative = Boolean(options.narrativeOverride !== undefined || savedNarrative);
  const narrative = answers ? composeRapportinoNarrative(answers) : savedNarrative || savedText;
  const hasPlaceholder = /\[(?:da completare|da confermare|da indicare|da descrivere)\]/i.test(narrative);
  const narrativeComplete = narrative.length >= 40 && !hasPlaceholder;
  const doneActivities = payload.activities.filter((activity) => activity.state === "done").length;
  const openActivities = payload.activities.length - doneActivities;
  const attendanceClosed = attendance.length > 0 && attendance.every((record) => ["CHECKED_OUT", "APPROVED", "CLOSED"].includes(text(record.status).toUpperCase()));
  const assignmentLabel = payload.assignment
    ? [payload.assignment.responsible, payload.assignment.team].filter(Boolean).join(" · ")
    : reportRecordsSummary(assignments, "Da assegnare");
  const assignmentKnown = Boolean(payload.assignment || assignments.length);
  const reportDate = /^\d{4}-\d{2}-\d{2}$/.test(text(context.reportDate))
    ? text(context.reportDate)
    : italyDateKey();
  const status = reportStatus(report?.status);

  const missing: string[] = [];
  const questions: string[] = [];
  if (text(payload.title).length < 2) {
    missing.push("job");
    questions.push("La commessa non ha un titolo valido: completa i dati prima di inviare il rapportino.");
  }
  const normalizedLocation = text(payload.location).toLocaleLowerCase("it-IT");
  const worksiteLocation = isRecord(payload.worksiteLocation) ? payload.worksiteLocation : {};
  const worksiteVerified = worksiteLocation.status === "SERVER_VERIFIED"
    && Boolean(text(worksiteLocation.providerPlaceId) && text(worksiteLocation.geoLocationId) && text(worksiteLocation.geofenceId));
  if (normalizedLocation.length < 2 || ["ubicazione da definire", "luogo da definire"].includes(normalizedLocation) || !worksiteVerified) {
    missing.push("worksite");
    questions.push("Il luogo non ha più una geocodifica e una geofence attive coerenti: verifica l’indirizzo della commessa.");
  }
  if (!assignmentKnown) {
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
  if (!narrativeComplete) {
    missing.push("narrative");
    questions.push(payload.activities.length
      ? "Racconta l’esito del turno, le criticità emerse e i prossimi passi."
      : "Quali attività sono state svolte? Aggiungi esito, eventuali criticità e prossimi passi.");
  }

  const fields: RapportinoField[] = [
    { key: "job", label: "Commessa", value: text(payload.title, "Da completare"), status: text(payload.title).length >= 2 ? "known" : "missing", source: "Anagrafica commessa" },
    { key: "worksite", label: "Luogo", value: text(payload.location, "Da verificare"), status: worksiteVerified ? "known" : "missing", source: "Geocodifica e geofence server-side" },
    { key: "assignment", label: "Responsabile / squadra", value: assignmentLabel, status: assignmentKnown ? "known" : "missing", source: "Assegnazione operativa" },
    { key: "activities", label: "Attività", value: payload.activities.length ? `${doneActivities}/${payload.activities.length} completate · ${openActivities} ancora aperte` : narrativeComplete ? "Descritte dal responsabile" : "Da descrivere nel rapportino", status: payload.activities.length || narrativeComplete ? "known" : "missing", source: payload.activities.length ? "Attività della commessa" : "Racconto del responsabile" },
    { key: "attendance", label: "Presenze e timbrature", value: attendance.length ? `${attendance.length} record · ${attendanceClosed ? "tutte le uscite registrate" : "una o più uscite da registrare"}` : "Da registrare", status: attendanceClosed ? "known" : "missing", source: "Presenze / geofence" },
    { key: "resources", label: "Persone, mezzi e asset", value: reportRecordsSummary(resources, assignmentKnown ? assignmentLabel : "Nessuna risorsa collegata"), status: resources.length ? "known" : "optional", source: "Planning / Asset" },
    { key: "materials", label: "Materiali", value: reportRecordsSummary(materials, "Nessun movimento collegato"), status: materials.length ? "known" : "optional", source: "Magazzino" },
    { key: "evidence", label: "Evidenze", value: `${payload.evidence.length + field.length} record verificabili`, status: payload.evidence.length || field.length ? "known" : "optional", source: "Field / documenti" },
    { key: "narrative", label: "Consuntivo", value: narrativeComplete ? "Pronto per l’invio" : "Da completare", status: narrativeComplete ? "known" : "missing", source: "Company AI · risposta responsabile" },
  ];

  const generatedDraft = [
    `RAPPORTINO COMMESSA · ${new Date(`${reportDate}T12:00:00.000Z`).toLocaleDateString("it-IT", { timeZone: "Europe/Rome" })}`,
    `Commessa: ${text(payload.title, "[da completare]")}`,
    `Luogo: ${text(payload.location, "[da confermare]")}`,
    `Responsabile / squadra: ${assignmentLabel}`,
    "",
    "ATTIVITÀ E RESIDUI",
    reportRecordLines(payload.activities.map((activity) => ({ title: activity.title, detail: activity.detail, status: activity.state, meta: activity.updatedAt })), "Nessuna attività pianificata a sistema"),
    "",
    "PRESENZE E RISORSE",
    reportRecordLines(attendance, "Nessuna timbratura collegata"),
    reportRecordLines(resources, "Nessuna risorsa collegata"),
    "",
    "MATERIALI",
    reportRecordLines(materials, "Nessun movimento materiale collegato"),
    "",
    "EVIDENZE",
    reportRecordLines([
      ...payload.evidence.map((item) => ({ title: item.title, detail: item.detail, status: item.kind })),
      ...field,
    ], "Nessuna evidenza aggiunta"),
    "",
    "RACCONTO DEL RESPONSABILE",
    narrative || "In attesa del racconto del responsabile.",
  ].join("\n");
  const reviewStatus: RapportinoReview["status"] = status === "APPROVED"
    ? "APPROVED"
    : status === "CHANGES_REQUESTED"
      ? "CHANGES_REQUESTED"
      : "PENDING";

  return {
    reportId: text(report?.reportId),
    answers: answers ?? [],
    status,
    reportDate,
    dayAlreadyApproved: context.dayAlreadyApproved === true,
    draft: options.narrativeOverride !== undefined
      ? generatedDraft
      : ["SUBMITTED", "APPROVED"].includes(status) && savedText
      ? savedText
      : hasDedicatedNarrative ? generatedDraft : savedText || generatedDraft,
    narrative,
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

export function jobCompletionRequirements(payload: JobPayload, reportDate = activeRapportinoDate(payload.rapportino)): JobCompletionRequirement[] {
  const rapportino = isRecord(payload.rapportino)
    && text(payload.rapportino.text).length >= 2
    && persistedRapportinoDate(payload.rapportino) === reportDate
    && (["SUBMITTED", "APPROVED"].includes(text(payload.rapportino.status).toUpperCase()) || !("status" in payload.rapportino));
  const activitiesComplete = payload.activities.length > 0 && payload.activities.every((activity) => activity.state === "done");
  const assignmentComplete = Boolean(payload.assignment && (text(payload.assignment.responsible) || text(payload.assignment.team)));
  const location = text(payload.location);
  const workPackages = Array.isArray(payload.workItems) ? payload.workItems : [];
  return [
    { key: "title", label: "Nome commessa", complete: text(payload.title).length >= 2, detail: "Identità della commessa" },
    { key: "classification", label: "Profilo del lavoro", complete: text(payload.openingType).length >= 2 && (workPackages.length > 0 || text(payload.description).length >= 2), detail: "Tipologia e lavorazioni descritte; la classificazione tecnica può essere proposta da Company AI" },
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
  const scopeV2 = isRecord(parsed.scopeV2) ? parsed.scopeV2 as unknown as CompanyAiMacroScopeConfirmation : undefined;
  const rawAssignment = isRecord(parsed.assignment) ? parsed.assignment : null;
  const assignment = rawAssignment && (text(rawAssignment.responsible) || text(rawAssignment.team))
    ? {
      responsible: text(rawAssignment.responsible, "Da assegnare"),
      team: text(rawAssignment.team, "Da assegnare"),
      role: text(rawAssignment.role, "Responsabile operativo"),
      ...(text(rawAssignment.roleCode) ? { roleCode: text(rawAssignment.roleCode).slice(0, 80) } : {}),
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
    description: typeof scopeV2?.descriptionOriginal === "string" ? scopeV2.descriptionOriginal : text(parsed.description),
    client: text(parsed.client),
    location: text(parsed.location),
    category: text(parsed.category, "Operations"),
    priority: parsed.priority === "HIGH" || parsed.priority === "LOW" ? parsed.priority : "STANDARD",
    dueDate: text(parsed.dueDate, text(parsed.due, "—")),
    statusCode: normalizeJobStatus(parsed.statusCode ?? parsed.status),
    version: Math.max(1, Math.floor(Number(parsed.version) || 1)),
    workItems,
    ...(scopeV2 ? { scopeV2 } : {}),
    activities,
    evidence,
    assignment,
  };
}

export function canTransitionJob(from: JobStatusCode, to: JobStatusCode): boolean {
  return from === to || JOB_TRANSITIONS[from].includes(to);
}

export function jobStatusTransitions(from: JobStatusCode): JobStatusCode[] {
  const order = JOB_TRANSITION_ORDER[from];
  return [...JOB_TRANSITIONS[from]].sort((left, right) => order.indexOf(left) - order.indexOf(right));
}

export function validJobStatuses() {
  return [...JOB_STATUS_CODES];
}
