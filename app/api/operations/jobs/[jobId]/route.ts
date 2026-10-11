import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { getDb } from "@/db";
import { geofences, geoLocations, jobJourneyRecords, s04Records, s06Events, s06Outbox, s06Reconciliations, tenantMemberships } from "@/db/schema";
import {
  getAuthorityContext,
  hasCapability,
  publicAuthorityContext,
} from "@/lib/authority-context";
import { recordForResponse } from "@/lib/s04-adapter";
import {
  canTransitionJob,
  clampJobProgress,
  JOB_STATUS_CODES,
  activeRapportinoDate,
  buildRapportinoReadback,
  composeRapportinoNarrative,
  italyDateKey,
  normalizeRapportinoAnswers,
  persistedRapportinoDate,
  jobCompletionRequirements,
  jobStatusLabel,
  normalizeJobStatus,
  parseJobPayload,
  type JobActivity,
  type JobEvidence,
  type JobPayload,
  type RapportinoContext,
  type RapportinoReadback,
} from "@/lib/operations-contract";
import { normalizeAuthorityRoles } from "@/lib/authority-catalog";
import { COMPANY_AI_SCOPE_TAXONOMY, COMMESSA_TYPES, resolveCompanyAiScopeSelection } from "@/lib/company-ai-scope";
import { geocodeWithMapbox } from "@/lib/location-intelligence/providers";
import { defaultGeofenceRadius } from "@/lib/location-intelligence/repository";
import type { GeocodeCandidate } from "@/lib/location-intelligence/provider-types";
import { canReadAllOperations, rowMatchesContext, teamScopeTokens } from "@/lib/operational-scope";
import { generateCompanyAiRapportinoQuestion } from "@/lib/company-ai-openai";
import {
  companyAiRateLimit,
  companyAiRateLimitResponse,
  consumeCompanyAiRateLimit,
} from "@/lib/ai-rate-limit";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ jobId: string }> };
type JsonObject = Record<string, unknown>;
type WorkspaceSectionStatus = "readback" | "empty" | "deferred";

const COMMESSA_ACTIVITY_ROLES = new Set([
  "owner", "admin", "manager", "office", "technical", "field_supervisor", "worker", "driver", "maintenance",
]);
const ASSIGNMENT_ROLE_OPTIONS = [
  { value: "RESPONSABILE_OPERATIVO", label: "Responsabile operativo", target: "person", allowedRoles: ["owner", "admin", "manager", "office", "technical", "field_supervisor"] },
  { value: "CAPOSQUADRA", label: "Caposquadra", target: "person", allowedRoles: ["owner", "admin", "manager", "field_supervisor"] },
  { value: "RESPONSABILE_CANTIERE", label: "Responsabile di cantiere", target: "person", allowedRoles: ["owner", "admin", "manager", "technical", "field_supervisor"] },
  { value: "REFERENTE_TECNICO", label: "Referente tecnico", target: "person", allowedRoles: ["owner", "admin", "manager", "office", "technical"] },
  { value: "SQUADRA_OPERATIVA", label: "Squadra operativa", target: "team", allowedRoles: [] },
] as const;

function eligibleAssignmentRoleCodes(roles: readonly string[]) {
  return ASSIGNMENT_ROLE_OPTIONS.flatMap((option) => option.target === "person"
    && option.allowedRoles.some((role) => roles.includes(role))
    ? [option.value]
    : []);
}
const STATUS_ACTION_LABELS: Record<string, string> = {
  PROPOSED: "Invia in proposta",
  APPROVED: "Approva commessa",
  PLANNED: "Pianifica commessa",
  ACTIVE: "Avvia commessa",
  BLOCKED: "Segna come bloccata",
  COMPLETED: "Verifica completamento",
  CLOSED: "Chiudi commessa",
  CANCELLED: "Annulla commessa",
};
const STATUS_TRANSITION_PRIORITY = ["PROPOSED", "APPROVED", "PLANNED", "ACTIVE", "COMPLETED", "CLOSED", "BLOCKED", "CANCELLED"];

function workforceEntityType(row: typeof s04Records.$inferSelect) {
  const payload = parsePayload(row.payloadJson);
  return safeText(payload.entityType ?? payload.resourceKind ?? payload.kind, row.recordType).toLowerCase();
}

async function assignmentOptions(
  context: NonNullable<Awaited<ReturnType<typeof getAuthorityContext>>>,
  rows: (typeof s04Records.$inferSelect)[],
) {
  const registryReadable = hasCapability(context, "workforce.registry.read")
    || hasCapability(context, "workforce.read.all")
    || hasCapability(context, "workforce.manage");
  if (!registryReadable) return { people: [], teams: [] };

  const memberships = await getDb().select({
    id: tenantMemberships.id,
    actorId: tenantMemberships.actorId,
    displayName: tenantMemberships.displayName,
    role: tenantMemberships.role,
    rolesJson: tenantMemberships.rolesJson,
  }).from(tenantMemberships).where(and(
    eq(tenantMemberships.tenantId, context.tenantId),
    eq(tenantMemberships.status, "active"),
  ));
  const membershipRoles = new Map(memberships.map((membership) => [
    membership.id,
    normalizeAuthorityRoles(membership.rolesJson, membership.role),
  ]));
  const people = memberships.flatMap((membership) => {
    const roles = normalizeAuthorityRoles(membership.rolesJson, membership.role);
    if (!roles.some((role) => COMMESSA_ACTIVITY_ROLES.has(role))) return [];
    return [{
      id: membership.id,
      actorId: membership.actorId,
      label: membership.displayName,
      role: roles[0] ?? membership.role,
      roles,
      eligibleRoleCodes: eligibleAssignmentRoleCodes(roles),
    }];
  });
  const activeMembershipIds = new Set(memberships.map((membership) => membership.id));
  const teams = rows.flatMap((row) => {
    if (row.module !== "workforce" || workforceEntityType(row) !== "team") return [];
    const payload = parsePayload(row.payloadJson);
    const rawMembers = Array.isArray(payload.memberMembershipIds)
      ? payload.memberMembershipIds.filter((value): value is string => typeof value === "string")
      : [];
    const memberMembershipIds = [...new Set(rawMembers.filter((id) => activeMembershipIds.has(id)
      && (membershipRoles.get(id) ?? []).some((role) => COMMESSA_ACTIVITY_ROLES.has(role))))];
    const status = safeText(payload.statusCode ?? payload.status, row.status).toUpperCase();
    if (!memberMembershipIds.length || ["INACTIVE", "SUSPENDED", "ARCHIVED", "CANCELLED"].includes(status)) return [];
    return [{ id: row.id, label: row.title, memberMembershipIds, eligibleRoleCodes: ["SQUADRA_OPERATIVA"] }];
  });
  return { people, teams };
}

function parsePayload(payloadJson: string): JsonObject {
  try {
    const parsed = JSON.parse(payloadJson) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as JsonObject
      : {};
  } catch {
    return {};
  }
}

function safeText(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function boundedText(value: unknown, max: number, fallback = "") {
  return safeText(value, fallback).slice(0, max);
}

function validDateOnly(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`));
}

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function keyVariants(value: unknown): string[] {
  if (typeof value !== "string") return [];
  const normalized = value.trim().toUpperCase();
  if (!normalized) return [];

  const variants = new Set([normalized]);
  if (normalized.startsWith("#")) variants.add(normalized.slice(1));
  if (normalized.startsWith("OP-")) variants.add(normalized.slice(3));
  if (normalized.startsWith("OPERATIONS-")) variants.add(normalized.slice("OPERATIONS-".length));
  return [...variants].filter(Boolean);
}

function referencesJob(row: typeof s04Records.$inferSelect, jobVariants: Set<string>): boolean {
  const payload = parsePayload(row.payloadJson);
  const references = [
    row.id,
    row.canonicalCode,
    payload.jobId,
    payload.job_id,
    payload.commessaId,
    payload.commessa_id,
    payload.workOrderId,
    payload.work_order_id,
  ];

  return references.some((reference) => keyVariants(reference).some((key) => jobVariants.has(key)));
}

function relatedRecords(rows: (typeof s04Records.$inferSelect)[], jobVariants: Set<string>) {
  return rows
    .filter((row) => row.module !== "operations" && referencesJob(row, jobVariants))
    .map(recordForResponse);
}

function isWarehouseRoleText(value: unknown) {
  return typeof value === "string" && /magazzin|warehouse|deposito/i.test(value);
}

/**
 * A commessa shows its execution team, not the people who govern or operate
 * a warehouse. Warehouse ownership stays visible in the materials flow,
 * where it can be linked to stock requests without polluting the job team.
 */
function isWarehouseStaffRecord(record: ReturnType<typeof recordForResponse>) {
  return [
    record.recordType,
    record.title,
    record.detail,
    record.meta,
    record.payload.role,
    record.payload.authorityRole,
    record.payload.profile,
    record.payload.kind,
  ].some(isWarehouseRoleText);
}

function section(status: WorkspaceSectionStatus, records: ReturnType<typeof recordForResponse>[]) {
  return { status, count: records.length, records };
}

function activityRecords(jobId: string, activities: JobActivity[]) {
  return activities.map((activity) => ({
    id: `${jobId}:${activity.id}`,
    module: "operations" as const,
    recordType: "activity",
    title: activity.title,
    detail: activity.detail,
    meta: activity.dueDate,
    status: activity.state.toUpperCase(),
    tone: activity.state === "blocked" ? "amber" as const : activity.state === "done" ? "lime" as const : "cyan" as const,
    progress: activity.progress,
    payload: activity as unknown as Record<string, unknown>,
    createdAt: activity.createdAt,
    updatedAt: activity.updatedAt,
  }));
}

function evidenceRecords(jobId: string, evidence: JobEvidence[]) {
  return evidence.map((item) => ({
    id: `${jobId}:${item.id}`,
    module: "operations" as const,
    recordType: "evidence",
    title: item.title,
    detail: item.detail,
    meta: item.kind.toUpperCase(),
    status: "VERIFIED_SITES_READBACK",
    tone: "lime" as const,
    progress: 100,
    payload: item as unknown as Record<string, unknown>,
    createdAt: item.createdAt,
    updatedAt: item.createdAt,
  }));
}

function assignmentRecord(jobId: string, assignment: NonNullable<JobPayload["assignment"]>) {
  return {
    id: `${jobId}:assignment`,
    module: "operations" as const,
    recordType: "assignment",
    title: assignment.responsible || assignment.team,
    detail: `${assignment.role} · ${assignment.team}`,
    meta: assignment.assignedAt,
    status: "ASSIGNED",
    tone: "cyan" as const,
    progress: 100,
    payload: assignment as unknown as Record<string, unknown>,
    createdAt: assignment.assignedAt,
    updatedAt: assignment.assignedAt,
  };
}

function journeyWorkspaceRecord(row: typeof jobJourneyRecords.$inferSelect) {
  const payload = parsePayload(row.payloadJson);
  const tone = row.status === "BLOCKED" || row.status === "CORRECTION_REQUESTED"
    ? "amber" as const
    : row.status === "COMPLETED" || row.status === "APPROVED" || row.status === "CLOSED"
      ? "lime" as const
      : "cyan" as const;
  return {
    id: row.id,
    module: "operations" as const,
    recordType: row.recordType.toLowerCase(),
    title: row.title,
    detail: typeof payload.notes === "string" ? payload.notes : `${row.domain} · ${row.status}`,
    meta: row.updatedAt,
    status: row.status,
    tone,
    progress: row.status === "PUBLISHED" || row.status === "APPROVED" || row.status === "CLOSED" ? 100 : 0,
    payload,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

type ReportSourceRecord = {
  title: string;
  detail?: string;
  status?: string;
  meta?: string;
};

function reportAttendanceRecords(
  rows: (typeof jobJourneyRecords.$inferSelect)[],
  reportDate: string,
): ReportSourceRecord[] {
  return rows
    .filter((row) => row.domain === "field" && row.recordType.toUpperCase() === "ATTENDANCE")
    .flatMap((row) => {
      const payload = parsePayload(row.payloadJson);
      const transitions = Array.isArray(payload.transitions) ? payload.transitions.filter(isRecord) : [];
      let shiftDate = "";
      const reportTransitions = transitions.flatMap((transition) => {
        const action = safeText(transition.action).toLowerCase();
        const occurredAt = ["correction_request", "correction_approve"].includes(action)
          ? safeText(transition.correctionAt) || safeText(transition.recordedAt)
          : safeText(transition.recordedAt);
        const eventDate = occurredAt && Number.isFinite(Date.parse(occurredAt))
          ? italyDateKey(new Date(occurredAt))
          : "";
        if (action === "check_in" && eventDate) shiftDate = eventDate;
        const ownerDate = shiftDate || eventDate;
        return ownerDate === reportDate ? [{ transition, action, occurredAt }] : [];
      }).slice(-12);
      if (!reportTransitions.length && (transitions.length > 0 || italyDateKey(new Date(row.updatedAt)) !== reportDate)) return [];
      const statusByAction: Record<string, string> = {
        check_in: "CHECKED_IN",
        pause: "PAUSED",
        resume: "CHECKED_IN",
        check_out: "CHECKED_OUT",
        correction_request: "CORRECTION_REQUESTED",
        correction_approve: "APPROVED",
      };
      const lastAction = reportTransitions.at(-1)?.action;
      const timeline = reportTransitions.map(({ transition, action, occurredAt }) => {
        const label = action.replaceAll("_", " ").toLocaleUpperCase("it-IT");
        const time = occurredAt && Number.isFinite(Date.parse(occurredAt))
          ? new Date(occurredAt).toLocaleString("it-IT", { timeZone: "Europe/Rome", dateStyle: "short", timeStyle: "short" })
          : "orario non disponibile";
        const location = isRecord(transition.location) && isRecord(transition.location.geofence)
          ? safeText(transition.location.geofence.name)
          : "";
        return `${label || "EVENTO"} ${time}${location ? ` · ${location}` : ""}`;
      });
      const workerId = boundedText(payload.workerId, 80, row.createdBy);
      return [{
        title: `Presenza · ${workerId}`,
        detail: timeline.join("; ") || `Stato storico · ${row.status}`,
        status: lastAction ? statusByAction[lastAction] ?? row.status : row.status,
        meta: reportDate,
      }];
    });
}

function reportRecordOnDate(
  record: { payload: JsonObject; createdAt?: string; updatedAt?: string; status?: string; recordType?: string },
  reportDate: string,
) {
  const payload = record.payload;
  const dayOf = (value: unknown) => {
    if (typeof value !== "string" || !value.trim()) return "";
    const raw = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    return Number.isFinite(Date.parse(raw)) ? italyDateKey(new Date(raw)) : "";
  };
  const rangeContainsDate = (startValue: unknown, endValue: unknown, openEnded = false) => {
    const startDate = dayOf(startValue);
    const endDate = dayOf(endValue);
    if (!startDate) return "";
    if (endDate) return startDate <= reportDate && reportDate <= endDate ? reportDate : "NO_MATCH";
    if (openEnded && ["ACTIVE", "ASSIGNED", "IN_USE", "ALLOCATED", "SCHEDULED"].includes((record.status ?? "").toUpperCase())) {
      return reportDate >= startDate ? reportDate : "NO_MATCH";
    }
    return startDate === reportDate ? reportDate : "NO_MATCH";
  };

  const slots = Array.isArray(payload.slots) ? payload.slots.filter(isRecord) : [];
  if (slots.length) {
    return slots.some((slot) => rangeContainsDate(slot.startsAt, slot.endsAt) === reportDate);
  }
  const scheduledStart = payload.startsAt ?? payload.startAt;
  if (dayOf(scheduledStart)) {
    const isAssetAssignment = (record.recordType ?? "").toUpperCase() === "ASSET_ASSIGNMENT";
    const assignmentStatus = (record.status ?? "").toUpperCase();
    const actualClose = payload.returnedAt ?? payload.cancelledAt;
    const assignmentStarted = dayOf(scheduledStart) <= reportDate;
    const assetCustodyStillOpen = isAssetAssignment
      && ["ACTIVE", "ASSIGNED", "IN_USE", "ALLOCATED", "SCHEDULED"].includes(assignmentStatus)
      && !actualClose
      && assignmentStarted;
    const scheduledEnd = actualClose ?? (assetCustodyStillOpen ? undefined : payload.endsAt ?? payload.endAt);
    return rangeContainsDate(scheduledStart, scheduledEnd, assetCustodyStillOpen) === reportDate;
  }
  const assignedStart = payload.assignedAt ?? payload.validFrom ?? payload.effectiveFrom;
  if (dayOf(assignedStart)) {
    return rangeContainsDate(assignedStart, payload.endsAt ?? payload.endAt ?? payload.validUntil ?? payload.returnedAt ?? payload.cancelledAt, true) === reportDate;
  }
  const eventTime = payload.occurredAt
    ?? payload.recordedAt
    ?? payload.startedAt
    ?? payload.movedAt
    ?? payload.deliveredAt
    ?? payload.completedAt
    ?? payload.createdAt
    ?? record.createdAt;
  if (dayOf(eventTime)) return dayOf(eventTime) === reportDate;
  return dayOf(record.updatedAt) === reportDate;
}

function reportContextFromVisibleRecords(input: {
  reportDate: string;
  dayAlreadyApproved?: boolean;
  attendance: ReportSourceRecord[];
  assignment: ReportSourceRecord[];
  resources: ReportSourceRecord[];
  materials: ReportSourceRecord[];
  field: ReportSourceRecord[];
}): RapportinoContext {
  return {
    reportDate: input.reportDate,
    dayAlreadyApproved: input.dayAlreadyApproved,
    attendance: input.attendance,
    assignment: input.assignment,
    resources: input.resources,
    materials: input.materials,
    field: input.field,
  };
}

function reportContextFromJourneyAndRelated(
  journeyRows: (typeof jobJourneyRecords.$inferSelect)[],
  related: ReturnType<typeof relatedRecords>,
  reportDate: string,
): RapportinoContext {
  const journeyRecords = journeyRows.map(journeyWorkspaceRecord);
  const dailyJourneyRecords = journeyRecords.filter((record) => reportRecordOnDate(record, reportDate));
  const dailyRelated = related.filter((record) => reportRecordOnDate(record, reportDate));
  return reportContextFromVisibleRecords({
    reportDate,
    attendance: reportAttendanceRecords(journeyRows, reportDate),
    assignment: [
      ...dailyJourneyRecords.filter((record) => record.recordType === "plan" && !isWarehouseStaffRecord(record)),
      ...dailyRelated.filter((record) => ["workforce", "mission", "planning"].includes(record.module) && !isWarehouseStaffRecord(record)),
    ],
    resources: [
      ...dailyJourneyRecords.filter((record) => ["plan", "asset_assignment"].includes(record.recordType) && !isWarehouseStaffRecord(record)),
      ...dailyRelated.filter((record) => ["assets", "workforce", "mission", "planning"].includes(record.module) && !isWarehouseStaffRecord(record)),
    ],
    materials: [
      ...dailyJourneyRecords.filter((record) => ["material_request", "material_movement"].includes(record.recordType)),
      ...dailyRelated.filter((record) => record.module === "warehouse"),
    ],
    field: [
      ...journeyRows
        .filter((row) => row.domain === "field" && row.recordType.toUpperCase() !== "ATTENDANCE" && reportRecordOnDate(journeyWorkspaceRecord(row), reportDate))
        .map(journeyWorkspaceRecord),
    ],
  });
}

function rapportinoSectionRecord(jobKey: string, readback: RapportinoReadback, detailsVisible = true) {
  const statusLabel = readback.status === "APPROVED"
    ? "APPROVATO DALL’UFFICIO"
    : readback.status === "CHANGES_REQUESTED"
      ? "INTEGRAZIONE RICHIESTA"
      : readback.status === "SUBMITTED"
        ? "INVIATO IN UFFICIO"
        : "BOZZA";
  return {
    id: `${jobKey}:rapportino`,
    module: "operations" as const,
    recordType: "rapportino",
    title: "Rapportino giornaliero",
    detail: !detailsVisible
      ? "Stato del rapportino"
      : readback.completeness.ready
        ? "Controllo Company AI superato"
        : `${readback.completeness.missing.length} dati da completare`,
    meta: statusLabel,
    status: readback.status,
    tone: readback.status === "CHANGES_REQUESTED" || !readback.completeness.ready ? "amber" as const : "lime" as const,
    progress: detailsVisible && readback.completeness.ready ? 100 : 0,
    payload: detailsVisible
      ? { status: readback.status, missing: readback.completeness.missing }
      : { status: readback.status },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function workspaceResponse(
  context: NonNullable<Awaited<ReturnType<typeof getAuthorityContext>>>,
  jobRow: typeof s04Records.$inferSelect,
  rows: (typeof s04Records.$inferSelect)[],
  requestedJobId: string,
) {
  const baseJob = recordForResponse(jobRow);
  const payload = parseJobPayload(jobRow.payloadJson);
  const progress = clampJobProgress(payload.progress ?? jobRow.progress);
  const jobKey = jobRow.canonicalCode ?? jobRow.id;
  const canWriteOperations = hasCapability(context, "operations.write");
  const canReadAssignmentRegistry = hasCapability(context, "workforce.registry.read")
    || hasCapability(context, "workforce.read.all")
    || hasCapability(context, "workforce.manage");
  const assignments = canWriteOperations && canReadAssignmentRegistry
    ? await assignmentOptions(context, rows)
    : { people: [], teams: [] };
  const statusCode = normalizeJobStatus(payload.statusCode ?? jobRow.status);
  const statusTransitions = canWriteOperations
    ? JOB_STATUS_CODES
      .filter((candidate) => candidate !== statusCode && canTransitionJob(statusCode, candidate))
      .sort((left, right) => STATUS_TRANSITION_PRIORITY.indexOf(left) - STATUS_TRANSITION_PRIORITY.indexOf(right))
      .map((candidate) => ({ statusCode: candidate, label: jobStatusLabel(candidate), actionLabel: STATUS_ACTION_LABELS[candidate] ?? `Aggiorna stato · ${jobStatusLabel(candidate)}` }))
    : [];
  const canReadRapportinoDetails = hasCapability(context, "operations.write")
    || hasCapability(context, "operations.rapportino.write")
    || hasCapability(context, "operations.rapportino.review")
    || (hasCapability(context, "field.write") && hasCapability(context, "workforce.registry.read"));
  const activities = activityRecords(jobKey, payload.activities);
  const evidence = evidenceRecords(jobKey, payload.evidence);
  const assignment = payload.assignment ? assignmentRecord(jobKey, payload.assignment) : null;
  const visibleAssignment = assignment && !isWarehouseStaffRecord(assignment) ? assignment : null;
  const reportPayload: JobPayload = visibleAssignment ? payload : { ...payload, assignment: null };
  const clientPayload = canReadRapportinoDetails || !isRecord(payload.rapportino)
    ? reportPayload
    : { ...reportPayload, rapportino: { status: safeText(payload.rapportino.status).toUpperCase() } };
  const job = {
    ...baseJob,
    title: payload.title || baseJob.title,
    detail: payload.location || baseJob.detail,
    meta: payload.dueDate || baseJob.meta,
    status: jobStatusLabel(payload.statusCode),
    progress,
    payload: { ...clientPayload, progress },
  };
  const jobVariants = new Set(keyVariants(requestedJobId));
  const related = relatedRecords(rows, jobVariants);
  const journeyRows = await getDb().select().from(jobJourneyRecords).where(and(
    eq(jobJourneyRecords.tenantId, context.tenantId),
    eq(jobJourneyRecords.jobId, jobRow.id),
  )).orderBy(desc(jobJourneyRecords.updatedAt)).limit(500);
  const canReadRapportinoHistory = canReadRapportinoDetails;
  const reportEvents = canReadRapportinoHistory ? await getDb().select().from(s06Events).where(and(
    eq(s06Events.tenantId, context.tenantId),
    eq(s06Events.aggregateType, "commessa"),
    eq(s06Events.aggregateId, jobKey),
    inArray(s06Events.eventType, [
      "operations.job.rapportino_saved",
      "operations.job.rapportino_submitted",
      "operations.job.rapportino_approved",
      "operations.job.rapportino_changes_requested",
    ]),
  )).orderBy(desc(s06Events.occurredAt)).limit(500) : [];
  const seenReportIds = new Set<string>();
  const rapportinoHistory = reportEvents.flatMap((event) => {
    const eventPayload = parsePayload(event.payloadJson);
    const change = isRecord(eventPayload.change) ? eventPayload.change : {};
    const snapshot = isRecord(change.reportSnapshot) ? change.reportSnapshot : null;
    const reportId = boundedText(snapshot?.reportId, 80);
    if (!snapshot || !reportId || seenReportIds.has(reportId)) return [];
    seenReportIds.add(reportId);
    return [{
      reportId,
      status: boundedText(snapshot.status, 32).toUpperCase(),
      reportDate: boundedText(snapshot.reportDate, 10),
      answers: normalizeRapportinoAnswers(snapshot.answers) ?? undefined,
      text: boundedText(snapshot.text, 5_000),
      narrative: boundedText(snapshot.narrative, 4_000),
      note: boundedText(snapshot.reviewNote, 1_000),
      at: boundedText(snapshot.updatedAt, 40, event.occurredAt),
      submittedBy: boundedText(snapshot.submittedBy, 160),
      reviewedBy: boundedText(snapshot.reviewedBy, 160),
    }];
  });
  const journeyRecords = journeyRows.map(journeyWorkspaceRecord);
  const planningJourney = journeyRecords.filter((record) => record.recordType === "plan" && !isWarehouseStaffRecord(record));
  const allAttendanceJourneyRows = journeyRows.filter((row) => row.domain === "field" && row.recordType.toUpperCase() === "ATTENDANCE");
  const canReadAttendanceRoster = hasCapability(context, "attendance.read")
    || hasCapability(context, "attendance.approve")
    || hasCapability(context, "workforce.read.all")
    || canReadRapportinoDetails;
  const visibleAttendanceIds = new Set(allAttendanceJourneyRows
    .filter((row) => canReadAttendanceRoster || boundedText(parsePayload(row.payloadJson).workerId, 120, row.createdBy) === context.actorId)
    .map((row) => row.id));
  const attendanceJourney = journeyRecords.filter((record) => record.recordType === "attendance" && visibleAttendanceIds.has(record.id));
  const byModule = (module: string) => related.filter((record) => record.module === module);
  const canReadPlanning = hasCapability(context, "planning.read") || hasCapability(context, "workforce.read");
  const canReadWorkforce = hasCapability(context, "workforce.read");
  const canReadMission = hasCapability(context, "mission.read");
  const canReadAssets = hasCapability(context, "asset.read");
  const canReadWarehouse = hasCapability(context, "warehouse.read") || hasCapability(context, "warehouse.request");
  const canReadField = hasCapability(context, "field.read")
    || hasCapability(context, "attendance.read")
    || hasCapability(context, "attendance.self")
    || canReadRapportinoDetails;
  const planningRecords = canReadPlanning
    ? [
      ...(visibleAssignment ? [visibleAssignment] : []),
      ...planningJourney,
      ...(canReadWorkforce ? byModule("workforce").filter((record) => !isWarehouseStaffRecord(record)) : []),
      ...(canReadMission ? byModule("mission").filter((record) => !isWarehouseStaffRecord(record)) : []),
    ]
    : [];
  const resourceRecords = canReadAssets ? byModule("assets") : [];
  const materialRecords = canReadWarehouse ? byModule("warehouse") : [];
  const fieldRecords = canReadField ? [...evidence, ...attendanceJourney] : [];
  const reportDate = activeRapportinoDate(reportPayload.rapportino);
  const reportIsApproved = isRecord(reportPayload.rapportino)
    && safeText(reportPayload.rapportino.status).toUpperCase() === "APPROVED";
  const priorReportDate = persistedRapportinoDate(reportPayload.rapportino);
  const dayAlreadyApproved = reportIsApproved
    && priorReportDate === italyDateKey();
  const startsNewReportDay = Boolean(priorReportDate) && priorReportDate < reportDate;
  const reportPayloadForReadback: JobPayload = {
    ...reportPayload,
    ...(startsNewReportDay ? { rapportino: null } : {}),
    evidence: reportPayload.evidence.filter((item) => Number.isFinite(Date.parse(item.createdAt))
      && italyDateKey(new Date(item.createdAt)) === reportDate),
  };
  const reportReadback = buildRapportinoReadback(reportPayloadForReadback, reportContextFromVisibleRecords({
    reportDate,
    dayAlreadyApproved,
    attendance: canReadField
      ? reportAttendanceRecords(allAttendanceJourneyRows.filter((row) => visibleAttendanceIds.has(row.id)), reportDate)
      : [],
    assignment: [
      ...(canReadPlanning ? planningJourney.filter((record) => reportRecordOnDate(record, reportDate)) : []),
      ...(canReadWorkforce ? byModule("workforce").filter((record) => !isWarehouseStaffRecord(record) && reportRecordOnDate(record, reportDate)) : []),
      ...(canReadMission ? byModule("mission").filter((record) => !isWarehouseStaffRecord(record) && reportRecordOnDate(record, reportDate)) : []),
    ],
    resources: [
      ...(canReadPlanning ? planningRecords.filter((record) => reportRecordOnDate(record, reportDate)) : []),
      ...(canReadAssets ? resourceRecords.filter((record) => reportRecordOnDate(record, reportDate)) : []),
    ],
    materials: canReadWarehouse ? materialRecords.filter((record) => reportRecordOnDate(record, reportDate)) : [],
    field: canReadField ? fieldRecords.filter((record) => record.recordType !== "attendance" && record.recordType !== "evidence" && reportRecordOnDate(record, reportDate)) : [],
  }));
  const rapportino: RapportinoReadback = reportReadback;
  const rapportinoForViewer: RapportinoReadback = canReadRapportinoDetails ? rapportino : {
    ...rapportino,
    answers: [],
    draft: "",
    narrative: "",
    fields: [],
    completeness: { ready: false, missing: [], questions: [] },
    review: { ...rapportino.review, note: "", reviewedAt: "", reviewedBy: "" },
  };
  const completionRequirements = jobCompletionRequirements(payload);

  return {
    context: publicAuthorityContext(context),
    job,
    workspace: {
      source: "sites-d1-w03-commessa-read-write",
      authority: "server-context",
      options: canWriteOperations ? {
        commercial: {
          openingTypes: COMMESSA_TYPES,
          priorities: [
            { value: "HIGH", label: "Alta" },
            { value: "STANDARD", label: "Standard" },
            { value: "LOW", label: "Bassa" },
          ],
          scopeSections: COMPANY_AI_SCOPE_TAXONOMY.map((section) => ({
            id: section.id,
            title: section.title,
            groups: section.groups.map((group) => ({
              id: group.id,
              title: group.title,
              subgroups: group.subgroups.map((subgroup) => ({ id: subgroup.id, title: subgroup.title })),
            })),
          })),
        },
        assignment: {
          people: assignments.people,
          teams: assignments.teams.map(({ id, label, eligibleRoleCodes }) => ({ id, label, eligibleRoleCodes })),
          roles: ASSIGNMENT_ROLE_OPTIONS.map(({ value, label, target }) => ({ value, label, target })),
        },
      } : undefined,
      statusTransitions,
      completion: {
        ready: completionRequirements.every((requirement) => requirement.complete),
        requirements: completionRequirements,
      },
      rapportino: rapportinoForViewer,
      rapportinoHistory,
      requestedJobId,
      sections: {
        activities: section(activities.length ? "readback" : "empty", activities),
        planning: section(planningRecords.length ? "readback" : "empty", planningRecords),
        resources: section(canReadAssets ? (resourceRecords.length ? "readback" : "empty") : "deferred", resourceRecords),
        materials: section(canReadWarehouse ? (materialRecords.length ? "readback" : "empty") : "deferred", materialRecords),
        field: section(fieldRecords.length ? "readback" : "deferred", fieldRecords),
        rapportino: section(
          rapportino.status === "EMPTY" ? "empty" : "readback",
          rapportino.status === "EMPTY" ? [] : [rapportinoSectionRecord(jobKey, rapportino, canReadRapportinoDetails)],
        ),
        control: section("readback", []),
        evidence: section(evidence.length ? "readback" : "empty", evidence),
      },
      journey: [
        { key: "job", label: "Job", status: "readback" },
        { key: "activity", label: "Activity", status: activities.length ? "readback" : "empty" },
        { key: "planning", label: "Planning", status: planningRecords.length ? "readback" : "empty" },
        { key: "assignment", label: "Assignment", status: visibleAssignment ? "readback" : "empty" },
        { key: "attendance", label: "Attendance", status: attendanceJourney.length ? "readback" : "empty" },
        { key: "work-context", label: "Work context", status: "deferred" },
        { key: "field", label: "Field", status: fieldRecords.length ? "readback" : "deferred" },
        { key: "rapportino", label: "Rapportino", status: payload.rapportino ? "readback" : "deferred" },
        { key: "control", label: "Controllo", status: "readback" },
      ],
    },
    readback: {
      status: "ok",
      scope: "tenant",
      tenantId: context.tenantId,
      version: payload.version,
      checkedAt: new Date().toISOString(),
    },
  };
}

async function findJob(
  context: NonNullable<Awaited<ReturnType<typeof getAuthorityContext>>>,
  requestedJobId: string,
) {
  const jobVariants = new Set(keyVariants(requestedJobId));
  const rows = await getDb()
    .select()
    .from(s04Records)
    .where(eq(s04Records.tenantId, context.tenantId));
  const jobRow = rows.find((row) => row.module === "operations" && referencesJob(row, jobVariants));
  return { rows, jobRow };
}

function canReadJob(
  context: NonNullable<Awaited<ReturnType<typeof getAuthorityContext>>>,
  jobRow: typeof s04Records.$inferSelect,
  rows: (typeof s04Records.$inferSelect)[],
) {
  if (canReadAllOperations(context)) return true;
  return rowMatchesContext(jobRow, context, teamScopeTokens(rows, context));
}

export async function GET(_request: Request, routeContext: RouteContext) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "operations.read")) {
    return Response.json({ error: "forbidden", capability: "operations.read" }, { status: 403 });
  }

  let requestedJobId = "";
  try {
    requestedJobId = decodeURIComponent((await routeContext.params).jobId).trim();
  } catch {
    return Response.json({ error: "invalid_job_id" }, { status: 400 });
  }
  if (!requestedJobId || requestedJobId.length > 160) {
    return Response.json({ error: "invalid_job_id" }, { status: 400 });
  }

  try {
    const { rows, jobRow } = await findJob(context, requestedJobId);
    if (!jobRow) {
      return Response.json({ error: "job_not_found", requestedJobId, readback: { status: "empty", scope: "tenant" } }, { status: 404 });
    }
    if (!canReadJob(context, jobRow, rows)) {
      return Response.json({ error: "job_not_found", requestedJobId, readback: { status: "empty", scope: "assigned" } }, { status: 404 });
    }
    return Response.json(await workspaceResponse(context, jobRow, rows, requestedJobId), {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return Response.json({ error: "operations_workspace_readback_failed" }, { status: 503 });
  }
}

const RAPPORTINO_INTERVIEW_STAGES = [
  {
    title: "Attività svolte ed esito",
    goal: "Raccogliere lavorazioni svolte e risultato osservato dal responsabile.",
    fallback: "Quali lavori avete completato oggi e qual è stato il risultato?",
  },
  {
    title: "Criticità e sicurezza",
    goal: "Raccogliere problemi, ritardi, rischi, incidenti o mancanze di materiali; se assenti, consentire una conferma esplicita.",
    fallback: "Ci sono stati problemi, ritardi, rischi o materiali mancanti? Se no, scrivi “Nessuna”.",
  },
  {
    title: "Prossimi passi e richieste",
    goal: "Raccogliere attività residue e informazioni o decisioni utili al prossimo turno e all’ufficio.",
    fallback: "Cosa resta da fare o deve sapere l’ufficio per il prossimo turno? Se nulla, scrivi “Nessuno”.",
  },
] as const;

export async function POST(request: Request, routeContext: RouteContext) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const canWriteRapportino = hasCapability(context, "operations.write")
    || hasCapability(context, "operations.rapportino.write")
    || (hasCapability(context, "field.write") && hasCapability(context, "workforce.registry.read"));
  if (!canWriteRapportino) {
    return Response.json({ error: "forbidden", capability: "operations.rapportino.write" }, { status: 403 });
  }

  let requestedJobId = "";
  try {
    requestedJobId = decodeURIComponent((await routeContext.params).jobId).trim();
  } catch {
    return Response.json({ error: "invalid_job_id" }, { status: 400 });
  }
  if (!requestedJobId || requestedJobId.length > 160) {
    return Response.json({ error: "invalid_job_id" }, { status: 400 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 8_192) {
    return Response.json({ error: "payload_too_large" }, { status: 413 });
  }
  let input: JsonObject;
  try {
    const value = await request.json() as unknown;
    if (!isRecord(value) || JSON.stringify(value).length > 8_192) {
      return Response.json({ error: "invalid_or_oversized_payload" }, { status: 400 });
    }
    input = value;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  if (input.action !== "rapportino_interview_question") {
    return Response.json({ error: "unsupported_rapportino_interview_action" }, { status: 400 });
  }
  const step = typeof input.step === "number" ? Math.floor(input.step) : -1;
  if (step < 0 || step >= RAPPORTINO_INTERVIEW_STAGES.length) {
    return Response.json({ error: "rapportino_interview_step_invalid" }, { status: 400 });
  }
  const answers = normalizeRapportinoAnswers(input.answers);
  if (!answers || answers.slice(0, step).some((answer) => answer.length < 2)) {
    return Response.json({ error: "rapportino_interview_answers_incomplete" }, { status: 422 });
  }

  try {
    const { rows, jobRow } = await findJob(context, requestedJobId);
    if (!jobRow || !canReadJob(context, jobRow, rows)) {
      return Response.json({ error: "job_not_found" }, { status: 404 });
    }
    const workspace = await workspaceResponse(context, jobRow, rows, requestedJobId);
    const report = workspace.workspace.rapportino;
    if (report.status === "SUBMITTED" || report.dayAlreadyApproved) {
      return Response.json({ error: "rapportino_locked" }, { status: 409 });
    }

    const rateLimit = await consumeCompanyAiRateLimit({
      tenantId: context.tenantId,
      actorId: context.actorId,
      action: "rapportino",
      limit: companyAiRateLimit("rapportino"),
    });
    if (!rateLimit.allowed) return companyAiRateLimitResponse(rateLimit);

    const stage = RAPPORTINO_INTERVIEW_STAGES[step];
    const allowedFactKeys = new Set(["activities", "attendance", "resources", "materials", "evidence"]);
    const knownFacts = report.fields
      .filter((field) => allowedFactKeys.has(field.key))
      .map((field) => ({ label: field.label, value: field.value, source: field.source }));
    const jobPayload = parseJobPayload(jobRow.payloadJson);
    knownFacts.push(...jobPayload.activities.slice(0, 5).map((activity) => ({
      label: `Attività pianificata · ${activity.title}`,
      value: `${activity.state.toLocaleUpperCase("it-IT")}${activity.detail ? ` · ${activity.detail}` : ""}`.slice(0, 360),
      source: "Piano della commessa",
    })));

    const outcome = await generateCompanyAiRapportinoQuestion({
      stage: stage.title,
      goal: stage.goal,
      fallbackQuestion: stage.fallback,
      knownFacts,
      previousAnswers: answers.slice(0, step),
    });
    return Response.json({
      question: outcome.result?.question ?? stage.fallback,
      ai: {
        provider: "openai",
        status: outcome.status,
        model: outcome.model,
        requestId: outcome.result?.requestId ?? null,
        directWrite: false,
      },
      reportDate: report.reportDate,
      readback: { status: "verified", scope: "tenant" },
    }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return Response.json({ error: "rapportino_interview_unavailable" }, { status: 503 });
  }
}

export async function PATCH(request: Request, routeContext: RouteContext) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const canWriteOperations = hasCapability(context, "operations.write");
  const canWriteField = hasCapability(context, "field.write");
  const canReviewRapportino = hasCapability(context, "operations.rapportino.review");
  if (!canWriteOperations && !canWriteField && !canReviewRapportino) {
    return Response.json({ error: "forbidden", capability: "operations.write" }, { status: 403 });
  }

  let requestedJobId = "";
  try {
    requestedJobId = decodeURIComponent((await routeContext.params).jobId).trim();
  } catch {
    return Response.json({ error: "invalid_job_id" }, { status: 400 });
  }

  let input: JsonObject;
  try {
    const parsed = await request.json() as unknown;
    if (!isRecord(parsed)) return Response.json({ error: "invalid_json" }, { status: 400 });
    input = parsed;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const action = boundedText(input.action, 48, "update_job").toLowerCase();
  const reportActions = new Set(["save_rapportino", "submit_rapportino"]);
  const canWriteRapportinoAction = reportActions.has(action) || action === "resubmit_rapportino";
  const canWriteRapportino = canWriteOperations
    || hasCapability(context, "operations.rapportino.write")
    || (canWriteField && hasCapability(context, "workforce.registry.read"));
  if (action === "review_rapportino" && !canReviewRapportino) {
    return Response.json({ error: "forbidden", capability: "operations.rapportino.review", action }, { status: 403 });
  }
  if (!canWriteOperations && action !== "review_rapportino" && (!canWriteRapportino || !canWriteRapportinoAction)) {
    return Response.json({ error: "forbidden", requiredCapabilities: ["field.write", "workforce.read"], action }, { status: 403 });
  }
  const idempotencyKey = boundedText(input.idempotencyKey, 160);
  if (typeof input.idempotencyKey === "string" && input.idempotencyKey.trim().length > 160) {
    return Response.json({ error: "idempotency_key_too_long" }, { status: 400 });
  }
  if (idempotencyKey.length < 4) return Response.json({ error: "idempotency_key_required" }, { status: 400 });

  try {
    const { rows, jobRow } = await findJob(context, requestedJobId);
    if (!jobRow) return Response.json({ error: "job_not_found", requestedJobId }, { status: 404 });
    if (!canReadJob(context, jobRow, rows)) return Response.json({ error: "job_not_found", requestedJobId }, { status: 404 });

    const db = getDb();
    const existing = await db.select().from(s06Events).where(and(
      eq(s06Events.tenantId, context.tenantId),
      eq(s06Events.idempotencyKey, idempotencyKey),
    )).limit(1);
    if (existing[0]) {
      const aggregateId = jobRow.canonicalCode ?? jobRow.id;
      if (existing[0].aggregateType !== "commessa" || existing[0].aggregateId !== aggregateId) {
        return Response.json({ error: "operations_idempotency_key_conflict" }, { status: 409 });
      }
      const existingPayload = parsePayload(existing[0].payloadJson);
      if (safeText(existingPayload.action) !== action) {
        return Response.json({ error: "operations_idempotency_key_conflict" }, { status: 409 });
      }
      return Response.json({
        ...(await workspaceResponse(context, jobRow, rows, requestedJobId)),
        idempotent: true,
        mutation: { action, eventId: existing[0].eventId, version: existing[0].aggregateVersion, readback: "verified" },
      }, { headers: { "cache-control": "no-store" } });
    }

    const current = parseJobPayload(jobRow.payloadJson);
    const expectedVersion = typeof input.expectedVersion === "number" ? Math.floor(input.expectedVersion) : null;
    if (expectedVersion !== null && expectedVersion !== current.version) {
      return Response.json({ error: "version_conflict", expectedVersion, currentVersion: current.version }, { status: 409 });
    }
    const reportStatus = isRecord(current.rapportino) ? safeText(current.rapportino.status).toUpperCase() : "";
    if (reportActions.has(action)
      && reportStatus === "APPROVED"
      && persistedRapportinoDate(current.rapportino) === italyDateKey()) {
      return Response.json({
        error: "rapportino_day_already_approved",
        message: "Il rapportino di questa giornata è già stato approvato dall’ufficio.",
      }, { status: 409 });
    }
    if (reportActions.has(action)
      && reportStatus === "SUBMITTED"
      && persistedRapportinoDate(current.rapportino) === italyDateKey()) {
      return Response.json({
        error: "rapportino_locked",
        status: reportStatus,
        message: "Il rapportino è già stato inviato e attende la revisione dell’ufficio.",
      }, { status: 409 });
    }
    if (reportActions.has(action)
      && ["DRAFT", "CHANGES_REQUESTED"].includes(reportStatus)
      && isRecord(current.rapportino)
      && persistedRapportinoDate(current.rapportino) === italyDateKey()) {
      const reportOwner = safeText(current.rapportino.submittedBy, safeText(current.rapportino.updatedBy));
      if (reportOwner && reportOwner !== context.actorId) {
        return Response.json({ error: "rapportino_owned_by_another_responsible", message: "La bozza appartiene al responsabile che l’ha avviata." }, { status: 403 });
      }
    }

    let rapportinoContext: RapportinoContext | undefined;
    if (action === "submit_rapportino") {
      const jobVariants = new Set([
        ...keyVariants(requestedJobId),
        ...keyVariants(jobRow.id),
        ...keyVariants(jobRow.canonicalCode ?? ""),
      ]);
      const related = relatedRecords(rows, jobVariants);
      const journeyRows = await db.select().from(jobJourneyRecords).where(and(
        eq(jobJourneyRecords.tenantId, context.tenantId),
        eq(jobJourneyRecords.jobId, jobRow.id),
      )).orderBy(desc(jobJourneyRecords.updatedAt)).limit(500);
      rapportinoContext = reportContextFromJourneyAndRelated(
        journeyRows,
        related,
        activeRapportinoDate(current.rapportino),
      );
    }

    const next: JobPayload = { ...current, version: current.version + 1 };
    const now = new Date().toISOString();
    let eventType = "operations.job.updated";
    let change: JsonObject = {};
    let worksiteMutation: {
      candidate: GeocodeCandidate;
      geoLocationId: string;
      geofenceId: string;
      geoLocation: typeof geoLocations.$inferSelect;
      geofence: typeof geofences.$inferSelect;
      staleGeofences: (typeof geofences.$inferSelect)[];
    } | null = null;

    if (action === "set_status") {
      const nextStatus = normalizeJobStatus(input.statusCode ?? input.status);
      if (!canTransitionJob(current.statusCode, nextStatus)) {
        return Response.json({ error: "invalid_status_transition", from: current.statusCode, to: nextStatus }, { status: 409 });
      }
      if (nextStatus === "COMPLETED") {
        const requirements = jobCompletionRequirements(current);
        if (requirements.some((requirement) => !requirement.complete)) {
          return Response.json({
            error: "completion_requirements_unmet",
            requirements,
            message: "La commessa resta aperta: completa i requisiti prima del passaggio a COMPLETATA.",
          }, { status: 422 });
        }
      }
      next.statusCode = nextStatus;
      eventType = "operations.job.status_changed";
      change = { from: current.statusCode, to: nextStatus };
    } else if (action === "set_progress") {
      const rawProgress = input.progress;
      if (typeof rawProgress !== "number" || !Number.isFinite(rawProgress) || rawProgress < 0 || rawProgress > 100) {
        return Response.json({ error: "progress_must_be_between_0_and_100" }, { status: 400 });
      }
      next.progress = clampJobProgress(rawProgress);
      eventType = "operations.job.progress_changed";
      change = { from: current.progress ?? jobRow.progress, to: next.progress };
    } else if (action === "add_activity") {
      const title = boundedText(input.title, 160);
      if (title.length < 2) return Response.json({ error: "activity_title_required" }, { status: 400 });
      const ownerMembershipId = boundedText(input.ownerMembershipId, 160);
      const ownerTeamId = boundedText(input.ownerTeamId, 160);
      if (ownerMembershipId && ownerTeamId) return Response.json({ error: "activity_owner_selection_invalid" }, { status: 400 });
      let activityOwner = { label: "Da assegnare", id: "", kind: "" as "" | "person" | "team" };
      if (ownerMembershipId || ownerTeamId) {
        const options = await assignmentOptions(context, rows);
        const person = ownerMembershipId ? options.people.find((item) => item.id === ownerMembershipId) : null;
        const selectedTeam = ownerTeamId ? options.teams.find((item) => item.id === ownerTeamId) : null;
        if (ownerMembershipId && !person) return Response.json({ error: "activity_owner_not_assignable" }, { status: 409 });
        if (ownerTeamId && !selectedTeam) return Response.json({ error: "activity_owner_not_assignable" }, { status: 409 });
        if (person) activityOwner = { label: person.label, id: person.id, kind: "person" };
        if (selectedTeam) activityOwner = { label: selectedTeam.label, id: selectedTeam.id, kind: "team" };
      }
      const activityDueDate = boundedText(input.dueDate, 10);
      if (activityDueDate && !validDateOnly(activityDueDate)) {
        return Response.json({ error: "activity_due_date_invalid" }, { status: 400 });
      }
      const activity: JobActivity = {
        id: `activity-${crypto.randomUUID().slice(0, 8)}`,
        title,
        detail: boundedText(input.detail, 280, "Attività operativa"),
        state: input.state === "active" || input.state === "done" || input.state === "blocked" ? input.state : "queued",
        owner: activityOwner.label,
        ...(activityOwner.id && activityOwner.kind ? { ownerResourceId: activityOwner.id, ownerResourceKind: activityOwner.kind } : {}),
        dueDate: activityDueDate || "—",
        progress: clampJobProgress(input.progress),
        createdAt: now,
        updatedAt: now,
      };
      next.activities = [...current.activities, activity];
      eventType = "operations.job.activity_added";
      change = {
        activityId: activity.id,
        title: activity.title,
        detail: activity.detail,
        ownerResourceId: activity.ownerResourceId ?? null,
        ownerResourceKind: activity.ownerResourceKind ?? null,
        dueDate: activity.dueDate,
      };
    } else if (action === "complete_activity") {
      const activityId = boundedText(input.activityId, 120);
      const activity = current.activities.find((item) => item.id === activityId);
      if (!activity) return Response.json({ error: "activity_not_found" }, { status: 404 });
      next.activities = current.activities.map((item) => item.id === activityId ? { ...item, state: "done", progress: 100, updatedAt: now } : item);
      eventType = "operations.job.activity_completed";
      change = { activityId, from: activity.state, to: "done" };
    } else if (action === "assign") {
      const responsibleMembershipId = boundedText(input.responsibleMembershipId, 160);
      const teamId = boundedText(input.teamId, 160);
      if ((!responsibleMembershipId && !teamId) || (responsibleMembershipId && teamId)) {
        return Response.json({ error: "responsible_or_team_required" }, { status: 400 });
      }
      const options = await assignmentOptions(context, rows);
      const responsibleOption = responsibleMembershipId
        ? options.people.find((item) => item.id === responsibleMembershipId)
        : null;
      const teamOption = teamId ? options.teams.find((item) => item.id === teamId) : null;
      if (responsibleMembershipId && !responsibleOption) return Response.json({ error: "assignment_person_not_assignable" }, { status: 409 });
      if (teamId && !teamOption) return Response.json({ error: "assignment_team_not_assignable" }, { status: 409 });
      const roleCode = boundedText(input.role, 80);
      const roleOption = ASSIGNMENT_ROLE_OPTIONS.find((option) => option.value === roleCode);
      if (!roleOption) return Response.json({ error: "assignment_role_invalid", allowed: ASSIGNMENT_ROLE_OPTIONS.map(({ value, label, target }) => ({ value, label, target })) }, { status: 400 });
      if (responsibleOption && !responsibleOption.eligibleRoleCodes.includes(roleOption.value)) {
        return Response.json({ error: "assignment_role_not_allowed_for_person", role: roleOption.value }, { status: 409 });
      }
      if (teamOption && !teamOption.eligibleRoleCodes.includes(roleOption.value)) {
        return Response.json({ error: "assignment_role_not_allowed_for_team", role: roleOption.value }, { status: 409 });
      }
      const responsible = responsibleOption?.label ?? "Da assegnare";
      const team = teamOption?.label ?? "Da assegnare";
      next.assignment = {
        responsible,
        team,
        role: roleOption.label,
        roleCode: roleOption.value,
        assignedAt: now,
        assignedBy: context.actorId,
        ...(responsibleOption ? { responsibleActorId: responsibleOption.actorId, responsibleMembershipId: responsibleOption.id } : {}),
        ...(teamOption ? { teamId: teamOption.id } : {}),
      };
      eventType = "operations.job.assigned";
      change = {
        responsibleMembershipId: responsibleOption?.id ?? null,
        teamId: teamOption?.id ?? null,
        roleCode: next.assignment.roleCode,
      };
    } else if (action === "add_evidence") {
      const title = boundedText(input.title, 160, "Evidenza operativa");
      const evidence: JobEvidence = {
        id: `evidence-${crypto.randomUUID().slice(0, 8)}`,
        kind: input.kind === "photo" || input.kind === "file" || input.kind === "voice" ? input.kind : "note",
        title,
        detail: boundedText(input.detail, 2_000),
        createdAt: now,
        createdBy: context.actorId,
      };
      next.evidence = [...current.evidence, evidence];
      eventType = "operations.job.evidence_added";
      change = { evidenceId: evidence.id, kind: evidence.kind, title: evidence.title, detail: evidence.detail };
    } else if (action === "save_rapportino") {
      const answers = normalizeRapportinoAnswers(input.answers);
      const narrative = answers
        ? boundedText(composeRapportinoNarrative(answers), 4_000)
        : boundedText(input.narrative ?? input.text, 4_000);
      if (narrative.length < 2) return Response.json({ error: "rapportino_text_required" }, { status: 400 });
      const priorReport = isRecord(current.rapportino) ? current.rapportino : {};
      const reportDate = activeRapportinoDate(priorReport, new Date(now));
      const reportId = persistedRapportinoDate(priorReport) !== reportDate
        ? `RAPPORTINO-${crypto.randomUUID().slice(0, 12).toUpperCase()}`
        : boundedText(priorReport.reportId, 80) || `RAPPORTINO-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
      const savedReport: JsonObject = {
        status: "DRAFT",
        reportId,
        reportDate,
        text: narrative,
        narrative,
        ...(answers ? { answers } : {}),
        reviewNote: safeText(priorReport.status).toUpperCase() === "APPROVED" ? "" : safeText(priorReport.reviewNote),
        updatedAt: now,
        updatedBy: context.actorId,
      };
      next.rapportino = savedReport;
      eventType = "operations.job.rapportino_saved";
      change = { status: "DRAFT", reportSnapshot: savedReport };
    } else if (action === "submit_rapportino") {
      const answers = normalizeRapportinoAnswers(input.answers);
      if (!answers || answers.some((answer) => answer.length < 2)) {
        return Response.json({
          error: "rapportino_answers_incomplete",
          questions: ["Completa tutte e tre le risposte: attività ed esito, criticità e prossimi passi."],
        }, { status: 422 });
      }
      const narrative = boundedText(composeRapportinoNarrative(answers), 4_000);
      if (narrative.length < 40) {
        return Response.json({ error: "rapportino_answers_incomplete", questions: ["Aggiungi qualche dettaglio alle risposte prima di inviare il rapportino."] }, { status: 422 });
      }
      if (narrative.length < 2) return Response.json({ error: "rapportino_text_required" }, { status: 400 });
      const reportReadback = buildRapportinoReadback(current, rapportinoContext ?? {}, { narrativeOverride: narrative, answersOverride: answers });
      if (!reportReadback.completeness.ready) {
        return Response.json({
          error: "rapportino_completeness_unmet",
          completeness: reportReadback.completeness,
          questions: reportReadback.completeness.questions,
          message: "Il rapportino resta in bozza: Company AI deve ricevere tutti i dati importanti prima dell’invio in ufficio.",
        }, { status: 422 });
      }
      const priorReport = isRecord(current.rapportino) ? current.rapportino : {};
      const reportId = persistedRapportinoDate(priorReport) !== reportReadback.reportDate
        ? `RAPPORTINO-${crypto.randomUUID().slice(0, 12).toUpperCase()}`
        : boundedText(priorReport.reportId, 80) || `RAPPORTINO-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
      next.rapportino = {
        status: "SUBMITTED",
        reportId,
        reportDate: reportReadback.reportDate,
        text: reportReadback.draft,
        narrative,
        answers,
        submittedAt: now,
        submittedBy: context.actorId,
        updatedAt: now,
        updatedBy: context.actorId,
        completeness: reportReadback.completeness,
      };
      eventType = "operations.job.rapportino_submitted";
      change = {
        status: "SUBMITTED",
        missing: 0,
        reportSnapshot: {
          ...(next.rapportino as JsonObject),
          text: boundedText(reportReadback.draft, 5_000),
          narrative: boundedText(narrative, 4_000),
        },
      };
    } else if (action === "resubmit_rapportino") {
      const reportId = boundedText(input.reportId, 80);
      const answers = normalizeRapportinoAnswers(input.answers);
      const narrative = answers ? boundedText(composeRapportinoNarrative(answers), 4_000) : "";
      if (!reportId || !answers || answers.some((answer) => answer.length < 2) || narrative.length < 40) {
        return Response.json({ error: "rapportino_answers_incomplete", questions: ["Completa tutte le risposte richieste per reinviare il rapportino storico."] }, { status: 422 });
      }
      const jobKey = jobRow.canonicalCode ?? jobRow.id;
      const priorReportEvents = await db.select().from(s06Events).where(and(
        eq(s06Events.tenantId, context.tenantId),
        eq(s06Events.aggregateType, "commessa"),
        eq(s06Events.aggregateId, jobKey),
        inArray(s06Events.eventType, [
          "operations.job.rapportino_saved",
          "operations.job.rapportino_submitted",
          "operations.job.rapportino_approved",
          "operations.job.rapportino_changes_requested",
        ]),
      )).orderBy(desc(s06Events.occurredAt)).limit(500);
      const report = priorReportEvents.map((event) => {
        const eventPayload = parsePayload(event.payloadJson);
        const change = isRecord(eventPayload.change) ? eventPayload.change : {};
        return isRecord(change.reportSnapshot) ? change.reportSnapshot : null;
      }).find((snapshot) => safeText(snapshot?.reportId) === reportId) ?? null;
      if (!report || !["DRAFT", "CHANGES_REQUESTED"].includes(safeText(report.status).toUpperCase())) {
        return Response.json({ error: "historical_rapportino_not_open_for_revision" }, { status: 409 });
      }
      const reportDate = persistedRapportinoDate(report);
      const jobVariants = new Set([
        ...keyVariants(requestedJobId),
        ...keyVariants(jobRow.id),
        ...keyVariants(jobRow.canonicalCode ?? ""),
      ]);
      const related = relatedRecords(rows, jobVariants);
      const journeyRows = await db.select().from(jobJourneyRecords).where(and(
        eq(jobJourneyRecords.tenantId, context.tenantId),
        eq(jobJourneyRecords.jobId, jobRow.id),
      )).orderBy(desc(jobJourneyRecords.updatedAt)).limit(500);
      const historicalPayload: JobPayload = {
        ...current,
        rapportino: report,
        evidence: current.evidence.filter((item) => Number.isFinite(Date.parse(item.createdAt))
          && italyDateKey(new Date(item.createdAt)) === reportDate),
      };
      const reportReadback = buildRapportinoReadback(
        historicalPayload,
        reportContextFromJourneyAndRelated(journeyRows, related, reportDate),
        { narrativeOverride: narrative, answersOverride: answers },
      );
      if (!reportReadback.completeness.ready) {
        return Response.json({
          error: "rapportino_completeness_unmet",
          completeness: reportReadback.completeness,
          questions: reportReadback.completeness.questions,
          message: "La revisione resta in bozza: completa i dati richiesti prima di reinviare il rapportino storico.",
        }, { status: 422 });
      }
      const revisedReport = {
        ...report,
        status: "SUBMITTED",
        reportDate,
        text: boundedText(reportReadback.draft, 5_000),
        narrative,
        answers,
        reviewNote: "",
        submittedAt: now,
        submittedBy: context.actorId,
        updatedAt: now,
        updatedBy: context.actorId,
        completeness: reportReadback.completeness,
      };
      eventType = "operations.job.rapportino_submitted";
      change = { status: "SUBMITTED", reportId, missing: 0, reportSnapshot: revisedReport };
    } else if (action === "review_rapportino") {
      const targetReportId = boundedText(input.reportId, 80);
      let report: Record<string, unknown> | null = isRecord(current.rapportino) ? current.rapportino : null;
      if (targetReportId && safeText(report?.reportId) !== targetReportId) {
        const jobKey = jobRow.canonicalCode ?? jobRow.id;
        const priorReportEvents = await db.select().from(s06Events).where(and(
          eq(s06Events.tenantId, context.tenantId),
          eq(s06Events.aggregateType, "commessa"),
          eq(s06Events.aggregateId, jobKey),
          inArray(s06Events.eventType, [
            "operations.job.rapportino_saved",
            "operations.job.rapportino_submitted",
            "operations.job.rapportino_approved",
            "operations.job.rapportino_changes_requested",
          ]),
        )).orderBy(desc(s06Events.occurredAt)).limit(500);
        report = priorReportEvents.map((event) => {
          const eventPayload = parsePayload(event.payloadJson);
          const change = isRecord(eventPayload.change) ? eventPayload.change : {};
          return isRecord(change.reportSnapshot) ? change.reportSnapshot : null;
        }).find((snapshot) => safeText(snapshot?.reportId) === targetReportId) ?? null;
      }
      if (!report || safeText(report.status).toUpperCase() !== "SUBMITTED") {
        return Response.json({ error: "rapportino_not_ready_for_review" }, { status: 409 });
      }
      if (safeText(report.submittedBy, safeText(report.updatedBy)) === context.actorId) {
        return Response.json({ error: "rapportino_self_review_forbidden", message: "Chi invia il rapportino non può approvare la propria giornata." }, { status: 403 });
      }
      const decision = boundedText(input.decision, 32).toUpperCase();
      if (decision !== "APPROVE" && decision !== "REQUEST_CHANGES") {
        return Response.json({ error: "rapportino_review_decision_invalid" }, { status: 400 });
      }
      const reviewNote = boundedText(input.reviewNote ?? input.note, 1_000);
      if (decision === "REQUEST_CHANGES" && reviewNote.length < 8) {
        return Response.json({ error: "rapportino_review_note_required" }, { status: 400 });
      }
      const approved = decision === "APPROVE";
      const reviewedReport = {
        ...report,
        status: approved ? "APPROVED" : "CHANGES_REQUESTED",
        reviewNote: reviewNote || "Rapportino verificato dall’ufficio.",
        reviewedAt: now,
        reviewedBy: context.actorId,
        updatedAt: now,
        updatedBy: context.actorId,
        ...(approved ? { approvedAt: now, approvedBy: context.actorId } : { approvedAt: null, approvedBy: null }),
      };
      if (safeText(current.rapportino && isRecord(current.rapportino) ? current.rapportino.reportId : "") === safeText(report.reportId)) {
        next.rapportino = reviewedReport;
      }
      eventType = approved ? "operations.job.rapportino_approved" : "operations.job.rapportino_changes_requested";
      change = {
        status: approved ? "APPROVED" : "CHANGES_REQUESTED",
        reportId: safeText(report.reportId),
        reportSnapshot: reviewedReport,
        reviewNote: Boolean(reviewNote),
      };
    } else if (action === "update_job") {
      const fields = isRecord(input.fields) ? input.fields : input;
      if (typeof fields.title === "string") {
        const title = boundedText(fields.title, 120);
        if (title.length < 2) return Response.json({ error: "title_must_be_2_to_120_characters" }, { status: 400 });
        next.title = title;
      }
      if (typeof fields.description === "string") next.description = boundedText(fields.description, 2_000);
      if (typeof fields.client === "string") next.client = boundedText(fields.client, 160);
      if (typeof fields.clientName === "string") next.clientName = boundedText(fields.clientName, 160);
      if (typeof fields.clientTaxId === "string") next.clientTaxId = boundedText(fields.clientTaxId, 80);
      if (typeof fields.clientContact === "string") next.clientContact = boundedText(fields.clientContact, 120);
      if (typeof fields.clientPhone === "string") next.clientPhone = boundedText(fields.clientPhone, 80);
      if (typeof fields.clientEmail === "string") {
        const clientEmail = boundedText(fields.clientEmail, 160).toLowerCase();
        if (clientEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail)) {
          return Response.json({ error: "client_email_invalid" }, { status: 400 });
        }
        next.clientEmail = clientEmail;
      }
      if (typeof fields.clientReference === "string") next.clientReference = boundedText(fields.clientReference, 160);
      if (typeof fields.clientAddress === "string") next.clientAddress = boundedText(fields.clientAddress, 240);
      const requestedWorksite = typeof fields.worksite === "string" ? boundedText(fields.worksite, 320) : typeof fields.location === "string" ? boundedText(fields.location, 320) : "";
      if (requestedWorksite && requestedWorksite !== current.location) {
        const candidateInput = isRecord(fields.worksiteLocation) ? fields.worksiteLocation : null;
        const providerPlaceId = boundedText(candidateInput?.providerPlaceId, 160);
        if (!providerPlaceId) {
          return Response.json({ error: "worksite_location_confirmation_required", message: "Riconosci e seleziona dal risultato server-side il nuovo indirizzo prima di salvare." }, { status: 409 });
        }
        const geocode = await geocodeWithMapbox(requestedWorksite);
        if (geocode.status === "not_configured") return Response.json({ error: "worksite_geocoder_not_configured", provider: "MAPBOX" }, { status: 503 });
        if (geocode.status === "unavailable") return Response.json({ error: "worksite_geocoder_unavailable", provider: "MAPBOX" }, { status: 503 });
        const candidate = geocode.candidates.find((item) => item.provider === "MAPBOX" && item.providerPlaceId === providerPlaceId);
        if (!candidate) return Response.json({ error: "worksite_location_candidate_mismatch", provider: "MAPBOX" }, { status: 409 });

        const db = getDb();
        const [geoLocation] = await db.select().from(geoLocations).where(and(
          eq(geoLocations.tenantId, context.tenantId),
          eq(geoLocations.entityId, jobRow.id),
          or(eq(geoLocations.entityType, "CANTIERE"), eq(geoLocations.entityType, "COMMESSA")),
        )).limit(1);
        const existingGeofences = await db.select().from(geofences).where(and(
          eq(geofences.tenantId, context.tenantId),
          eq(geofences.entityId, jobRow.id),
        )).limit(20);
        if (!geoLocation) return Response.json({ error: "worksite_location_integrity_incomplete", message: "La commessa non ha una location canonica da aggiornare. Completa prima la registrazione del luogo." }, { status: 409 });
        const geoLocationId = geoLocation?.id || boundedText(current.worksiteGeoLocationId, 100) || `GEO-CANTIERE-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
        const geofence = existingGeofences.find((item) => item.locationId === geoLocationId) ?? null;
        if (!geofence) return Response.json({ error: "worksite_geofence_integrity_incomplete", message: "La commessa non ha una geofence canonica da aggiornare. Completa prima la configurazione del perimetro." }, { status: 409 });
        const geofenceId = geofence?.id || boundedText(current.worksiteGeofenceId, 100) || `GEOFENCE-CANTIERE-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
        const radius = geofence?.radiusMeters ?? defaultGeofenceRadius("CANTIERE");
        const persistedWorksiteLocation = {
          provider: candidate.provider,
          providerPlaceId: candidate.providerPlaceId,
          formattedAddress: candidate.formattedAddress,
          address: { street: candidate.street, streetNumber: candidate.streetNumber, city: candidate.city, province: candidate.province, postalCode: candidate.postalCode, country: candidate.country },
          coordinates: { latitude: candidate.latitude, longitude: candidate.longitude },
          confidence: candidate.confidence,
          status: "SERVER_VERIFIED",
          geoLocationId,
          geofenceId,
          geofence: { shapeType: "CIRCLE", radiusMeters: radius },
          verifiedAt: now,
        };
        next.location = candidate.formattedAddress;
        next.worksite = candidate.formattedAddress;
        next.worksiteLocation = persistedWorksiteLocation;
        next.worksiteGeoLocationId = geoLocationId;
        next.worksiteGeofenceId = geofenceId;
        next.worksiteGeocodeStatus = "CONFIRMED";
        worksiteMutation = { candidate, geoLocationId, geofenceId, geoLocation, geofence, staleGeofences: existingGeofences.filter((item) => item.status === "ACTIVE" && item.id !== geofenceId) };
      } else if (requestedWorksite) {
        next.location = current.location;
        next.worksite = current.location;
      }
      if (typeof fields.accessNotes === "string") next.accessNotes = boundedText(fields.accessNotes, 2_000);
      if (typeof fields.cig === "string") next.cig = boundedText(fields.cig, 80);
      if (typeof fields.cup === "string") next.cup = boundedText(fields.cup, 80);
      if (typeof fields.openingType === "string") {
        const openingType = boundedText(fields.openingType, 80).toUpperCase();
        if (!COMMESSA_TYPES.some((option) => option.value === openingType)) return Response.json({ error: "invalid_commessa_type" }, { status: 400 });
        next.openingType = openingType;
      }
      if (typeof fields.jobType === "string") next.jobType = boundedText(fields.jobType, 120);
      if (typeof fields.specialization === "string") next.specialization = boundedText(fields.specialization, 120);
      const scopeFields = isRecord(fields.scope) ? fields.scope : fields;
      const hasScopeInput = isRecord(fields.scope) || ["scopeSectionId", "scopeGroupId", "scopeSubgroupId"].some((key) => key in fields);
      if (hasScopeInput) {
        const scopeSelection = resolveCompanyAiScopeSelection({
          sectionId: boundedText(scopeFields.scopeSectionId ?? scopeFields.sectionId, 80),
          groupId: boundedText(scopeFields.scopeGroupId ?? scopeFields.groupId, 120),
          subgroupId: boundedText(scopeFields.scopeSubgroupId ?? scopeFields.subgroupId, 160),
        });
        if (!scopeSelection) return Response.json({ error: "scope_must_end_at_subgroup" }, { status: 400 });
        next.scopeLevel = scopeSelection.level;
        next.scopeSectionId = scopeSelection.sectionId;
        next.scopeGroupId = scopeSelection.groupId;
        next.scopeSubgroupId = scopeSelection.subgroupId;
        next.scope = { ...scopeSelection, source: "human-authored" };
        next.category = scopeSelection.sectionTitle;
        next.jobType = scopeSelection.groupTitle;
        next.specialization = scopeSelection.subgroupTitle;
      }
      if (typeof fields.category === "string") {
        const category = boundedText(fields.category, 80);
        if (category && !COMPANY_AI_SCOPE_TAXONOMY.some((section) => section.title === category)) {
          return Response.json({ error: "category_must_match_server_scope_catalog" }, { status: 400 });
        }
        next.category = category;
      }
      if (typeof fields.dueDate === "string") {
        const dueDate = boundedText(fields.dueDate, 40);
        if (dueDate && dueDate !== "—" && !Number.isFinite(Date.parse(dueDate))) {
          return Response.json({ error: "due_date_invalid" }, { status: 400 });
        }
        next.dueDate = dueDate;
      }
      if (typeof fields.priority === "string") {
        if (!["HIGH", "STANDARD", "LOW"].includes(fields.priority)) {
          return Response.json({ error: "priority_invalid", allowed: ["HIGH", "STANDARD", "LOW"] }, { status: 400 });
        }
        next.priority = fields.priority as JobPayload["priority"];
      }
      eventType = "operations.job.details_updated";
      const commercialFieldNames = new Set([
        "title", "description", "client", "clientName", "clientTaxId", "clientContact", "clientPhone",
        "clientEmail", "clientReference", "clientAddress", "location", "worksite", "worksiteLocation",
        "category", "openingType", "jobType", "specialization", "scope", "scopeSectionId", "scopeGroupId",
        "scopeSubgroupId", "dueDate", "priority", "accessNotes", "cig", "cup",
      ]);
      const changedFields = Object.keys(fields).filter((key) => commercialFieldNames.has(key)
        && JSON.stringify(current[key]) !== JSON.stringify(next[key]));
      const auditValue = (key: string, source: JobPayload) => {
        if (key === "worksiteLocation") return safeText(source.location);
        if (key === "scope") {
          const scope = isRecord(source.scope) ? source.scope : {};
          return { sectionId: safeText(scope.sectionId), groupId: safeText(scope.groupId), subgroupId: safeText(scope.subgroupId) };
        }
        return source[key] ?? null;
      };
      change = {
        fields: changedFields,
        before: Object.fromEntries(changedFields.map((key) => [key, auditValue(key, current)])),
        after: Object.fromEntries(changedFields.map((key) => [key, auditValue(key, next)])),
      };
    } else {
      return Response.json({ error: "unknown_job_action" }, { status: 400 });
    }

    next.progress = clampJobProgress(next.progress ?? jobRow.progress);
    const serializedPayload = JSON.stringify(next);
    const eventId = crypto.randomUUID();
    const correlationId = boundedText(input.correlationId, 120) || crypto.randomUUID();
    const aggregateId = jobRow.canonicalCode ?? jobRow.id;
    const eventPayload = JSON.stringify({
      action,
      change,
      before: { statusCode: current.statusCode, progress: current.progress ?? jobRow.progress, version: current.version },
      after: { statusCode: next.statusCode, progress: next.progress, version: next.version },
      source: "sites-w03-operations",
    });
    if (eventPayload.length > 12_000 || serializedPayload.length > 48_000) {
      return Response.json({ error: "job_payload_too_large" }, { status: 413 });
    }

    const statementBatch: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] = [
      db.update(s04Records)
        .set({
          detail: next.location,
          meta: next.dueDate,
          status: jobStatusLabel(next.statusCode),
          progress: next.progress,
          payloadJson: serializedPayload,
          updatedAt: now,
        })
        .where(and(
          eq(s04Records.id, jobRow.id),
          eq(s04Records.tenantId, context.tenantId),
          eq(s04Records.updatedAt, jobRow.updatedAt),
        ))
        .returning(),
      db.insert(s06Events).values({
        eventId,
        tenantId: context.tenantId,
        eventType,
        schemaVersion: "1",
        actorType: "human",
        actorId: context.actorId,
        source: "sites-command",
        occurredAt: now,
        observedAt: now,
        aggregateType: "commessa",
        aggregateId,
        aggregateVersion: next.version,
        payloadJson: eventPayload,
        correlationId,
        causationId: null,
        idempotencyKey,
        status: "COMMITTED_SITES_READBACK",
        createdAt: now,
      }),
      db.insert(s06Outbox).values({
        id: crypto.randomUUID(),
        tenantId: context.tenantId,
        eventId,
        topic: `zerow.${eventType}`,
        status: "PENDING_EXTERNAL_CONSUMER",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(s06Reconciliations).values({
        id: crypto.randomUUID(),
        tenantId: context.tenantId,
        aggregateType: "commessa",
        aggregateId,
        expectedVersion: next.version,
        observedVersion: next.version,
        status: "SITES_READBACK_VERIFIED",
        detail: "Mutazione commessa riletta su D1; consumer canonico esterno ancora differito.",
        createdAt: now,
        updatedAt: now,
      }),
    ];
    if (worksiteMutation) {
      const { candidate, geoLocationId, geofenceId, geoLocation, geofence, staleGeofences } = worksiteMutation;
      const worksiteCommitCondition = sql`EXISTS (
        SELECT 1 FROM s04_records
        WHERE s04_records.id = ${jobRow.id}
          AND s04_records.tenant_id = ${context.tenantId}
          AND s04_records.updated_at = ${now}
          AND s04_records.payload_json = ${serializedPayload}
      )`;
      const geoValues = {
        formattedAddress: candidate.formattedAddress,
        street: candidate.street,
        streetNumber: candidate.streetNumber,
        city: candidate.city,
        province: candidate.province,
        postalCode: candidate.postalCode,
        country: candidate.country,
        latitudeE6: Math.round(candidate.latitude * 1_000_000),
        longitudeE6: Math.round(candidate.longitude * 1_000_000),
        provider: candidate.provider,
        providerPlaceId: candidate.providerPlaceId,
        geocodeConfidenceMilli: Math.round(Math.min(1, Math.max(0, candidate.confidence)) * 1_000),
        verifiedByUser: 1,
        verifiedAt: now,
        status: "ACTIVE",
        version: (geoLocation?.version ?? 0) + 1,
        updatedAt: now,
      };
      statementBatch.push(db.update(geoLocations).set(geoValues).where(and(
        eq(geoLocations.tenantId, context.tenantId),
        eq(geoLocations.id, geoLocationId),
        worksiteCommitCondition,
      )));
      for (const stale of staleGeofences) {
        statementBatch.push(db.update(geofences).set({ status: "INACTIVE", updatedAt: now }).where(and(
          eq(geofences.tenantId, context.tenantId),
          eq(geofences.id, stale.id),
          worksiteCommitCondition,
        )));
      }
      const geofenceValues = {
        locationId: geoLocationId,
        entityType: "CANTIERE",
        entityId: jobRow.id,
        name: `${jobRow.canonicalCode ?? jobRow.id} · Cantiere`,
        shapeType: "CIRCLE",
        centerLatitudeE6: Math.round(candidate.latitude * 1_000_000),
        centerLongitudeE6: Math.round(candidate.longitude * 1_000_000),
        radiusMeters: geofence?.radiusMeters ?? defaultGeofenceRadius("CANTIERE"),
        polygonJson: "[]",
        status: "ACTIVE",
        version: (geofence?.version ?? 0) + 1,
        updatedAt: now,
      };
      statementBatch.push(db.update(geofences).set(geofenceValues).where(and(
        eq(geofences.tenantId, context.tenantId),
        eq(geofences.id, geofenceId),
        worksiteCommitCondition,
      )));
    }
    const updatedRows = await db.batch(statementBatch);

    const updated = (updatedRows[0] as (typeof s04Records.$inferSelect)[])[0];
    if (!updated) return Response.json({ error: "version_conflict", currentVersion: current.version }, { status: 409 });

    if (worksiteMutation) {
      const { candidate, geoLocationId, geofenceId, staleGeofences } = worksiteMutation;
      const [locationReadback] = await db.select().from(geoLocations).where(and(
        eq(geoLocations.tenantId, context.tenantId),
        eq(geoLocations.id, geoLocationId),
      )).limit(1);
      const activeGeofences = await db.select().from(geofences).where(and(
        eq(geofences.tenantId, context.tenantId),
        eq(geofences.entityId, jobRow.id),
        eq(geofences.status, "ACTIVE"),
      ));
      const activeGeofence = activeGeofences.find((item) => item.id === geofenceId);
      const staleStillActive = staleGeofences.some((stale) => activeGeofences.some((item) => item.id === stale.id));
      const expectedLatitude = Math.round(candidate.latitude * 1_000_000);
      const expectedLongitude = Math.round(candidate.longitude * 1_000_000);
      const locationVerified = Boolean(locationReadback
        && locationReadback.status === "ACTIVE"
        && locationReadback.provider === candidate.provider
        && locationReadback.providerPlaceId === candidate.providerPlaceId
        && locationReadback.formattedAddress === candidate.formattedAddress
        && locationReadback.latitudeE6 === expectedLatitude
        && locationReadback.longitudeE6 === expectedLongitude);
      const geofenceVerified = Boolean(activeGeofence
        && activeGeofence.locationId === geoLocationId
        && activeGeofence.centerLatitudeE6 === expectedLatitude
        && activeGeofence.centerLongitudeE6 === expectedLongitude);
      if (!locationVerified || !geofenceVerified || staleStillActive || activeGeofences.length !== 1) {
        return Response.json({ error: "worksite_location_readback_failed", eventId, readback: { status: "unverified" } }, { status: 503 });
      }
    }

    const refreshed = await findJob(context, requestedJobId);
    return Response.json({
      ...(await workspaceResponse(context, refreshed.jobRow ?? updated, refreshed.rows, requestedJobId)),
      idempotent: false,
      mutation: { action, eventId, version: next.version, readback: "verified" },
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "operations_workspace_write_failed";
    if (message.includes("UNIQUE") || message.includes("unique")) {
      return Response.json({ error: "idempotency_or_version_conflict" }, { status: 409 });
    }
    return Response.json({ error: "operations_workspace_write_failed" }, { status: 503 });
  }
}
