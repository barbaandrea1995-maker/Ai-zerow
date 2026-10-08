import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { jobJourneyRecords, s04Records, s06Events, s06Outbox, s06Reconciliations } from "@/db/schema";
import {
  getAuthorityContext,
  hasCapability,
  publicAuthorityContext,
} from "@/lib/authority-context";
import { recordForResponse } from "@/lib/s04-adapter";
import {
  canTransitionJob,
  clampJobProgress,
  buildRapportinoReadback,
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
import { COMMESSA_TYPES, resolveCompanyAiScopeSelection } from "@/lib/company-ai-scope";
import { canReadAllOperations, rowMatchesContext, teamScopeTokens } from "@/lib/operational-scope";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ jobId: string }> };
type JsonObject = Record<string, unknown>;
type WorkspaceSectionStatus = "readback" | "empty" | "deferred";

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

function reportContextFromVisibleRecords(input: {
  attendance: ReportSourceRecord[];
  resources: ReportSourceRecord[];
  materials: ReportSourceRecord[];
  field: ReportSourceRecord[];
}): RapportinoContext {
  return {
    attendance: input.attendance,
    resources: input.resources,
    materials: input.materials,
    field: input.field,
  };
}

function reportContextFromJourneyAndRelated(
  journeyRows: (typeof jobJourneyRecords.$inferSelect)[],
  related: ReturnType<typeof relatedRecords>,
): RapportinoContext {
  const journeyRecords = journeyRows.map(journeyWorkspaceRecord);
  return reportContextFromVisibleRecords({
    attendance: journeyRows
      .filter((row) => row.domain === "field" && row.recordType.toUpperCase() === "ATTENDANCE")
      .map(journeyWorkspaceRecord),
    resources: [
      ...journeyRecords.filter((record) => ["plan", "asset_assignment"].includes(record.recordType)),
      ...related.filter((record) => ["assets", "workforce", "mission", "planning"].includes(record.module)),
    ],
    materials: [
      ...journeyRecords.filter((record) => ["material_request", "material_movement"].includes(record.recordType)),
      ...related.filter((record) => record.module === "warehouse"),
    ],
    field: [
      ...journeyRows
        .filter((row) => row.domain === "field" && row.recordType.toUpperCase() !== "ATTENDANCE")
        .map(journeyWorkspaceRecord),
    ],
  });
}

function rapportinoSectionRecord(jobKey: string, readback: RapportinoReadback) {
  const statusLabel = readback.status === "SUBMITTED" ? "INVIATO IN UFFICIO" : "BOZZA";
  return {
    id: `${jobKey}:rapportino`,
    module: "operations" as const,
    recordType: "rapportino",
    title: "Rapportino giornaliero",
    detail: readback.completeness.ready
      ? "Controllo Company AI superato"
      : `${readback.completeness.missing.length} dati da completare`,
    meta: statusLabel,
    status: readback.status,
    tone: readback.completeness.ready ? "lime" as const : "amber" as const,
    progress: readback.completeness.ready ? 100 : 0,
    payload: { status: readback.status, missing: readback.completeness.missing },
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
  const activities = activityRecords(jobKey, payload.activities);
  const evidence = evidenceRecords(jobKey, payload.evidence);
  const assignment = payload.assignment ? assignmentRecord(jobKey, payload.assignment) : null;
  const visibleAssignment = assignment && !isWarehouseStaffRecord(assignment) ? assignment : null;
  const job = {
    ...baseJob,
    title: payload.title || baseJob.title,
    detail: payload.location || baseJob.detail,
    meta: payload.dueDate || baseJob.meta,
    status: jobStatusLabel(payload.statusCode),
    progress,
    payload: { ...payload, progress },
  };
  const jobVariants = new Set(keyVariants(requestedJobId));
  const related = relatedRecords(rows, jobVariants);
  const journeyRows = await getDb().select().from(jobJourneyRecords).where(and(
    eq(jobJourneyRecords.tenantId, context.tenantId),
    eq(jobJourneyRecords.jobId, jobRow.id),
  )).orderBy(desc(jobJourneyRecords.updatedAt)).limit(500);
  const journeyRecords = journeyRows.map(journeyWorkspaceRecord);
  const planningJourney = journeyRecords.filter((record) => record.recordType === "plan");
  const attendanceJourney = journeyRecords.filter((record) => record.recordType === "attendance");
  const byModule = (module: string) => related.filter((record) => record.module === module);
  const canReadPlanning = hasCapability(context, "planning.read") || hasCapability(context, "workforce.read");
  const canReadWorkforce = hasCapability(context, "workforce.read");
  const canReadMission = hasCapability(context, "mission.read");
  const canReadAssets = hasCapability(context, "asset.read");
  const canReadWarehouse = hasCapability(context, "warehouse.read") || hasCapability(context, "warehouse.request");
  const canReadField = hasCapability(context, "field.read") || hasCapability(context, "attendance.read") || hasCapability(context, "attendance.self");
  const planningRecords = canReadPlanning
    ? [
      ...(visibleAssignment ? [visibleAssignment] : []),
      ...planningJourney,
      ...(canReadWorkforce ? byModule("workforce").filter((record) => !isWarehouseStaffRecord(record)) : []),
      ...(canReadMission ? byModule("mission") : []),
    ]
    : [];
  const resourceRecords = canReadAssets ? byModule("assets") : [];
  const materialRecords = canReadWarehouse ? byModule("warehouse") : [];
  const fieldRecords = canReadField ? [...evidence, ...attendanceJourney] : [];
  const rapportino = buildRapportinoReadback(payload, reportContextFromVisibleRecords({
    attendance: canReadField ? attendanceJourney : [],
    resources: [
      ...(canReadPlanning ? planningRecords : []),
      ...(canReadAssets ? resourceRecords : []),
    ],
    materials: canReadWarehouse ? materialRecords : [],
    field: canReadField ? fieldRecords.filter((record) => record.recordType !== "attendance" && record.recordType !== "evidence") : [],
  }));
  const completionRequirements = jobCompletionRequirements(payload);

  return {
    context: publicAuthorityContext(context),
    job,
    workspace: {
      source: "sites-d1-w03-commessa-read-write",
      authority: "server-context",
      completion: {
        ready: completionRequirements.every((requirement) => requirement.complete),
        requirements: completionRequirements,
      },
      rapportino,
      requestedJobId,
      sections: {
        activities: section(activities.length ? "readback" : "empty", activities),
        planning: section(planningRecords.length ? "readback" : "empty", planningRecords),
        resources: section(canReadAssets ? (resourceRecords.length ? "readback" : "empty") : "deferred", resourceRecords),
        materials: section(canReadWarehouse ? (materialRecords.length ? "readback" : "empty") : "deferred", materialRecords),
        field: section(fieldRecords.length ? "readback" : "deferred", fieldRecords),
        rapportino: section(
          rapportino.status === "EMPTY" ? "empty" : "readback",
          rapportino.status === "EMPTY" ? [] : [rapportinoSectionRecord(jobKey, rapportino)],
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

export async function PATCH(request: Request, routeContext: RouteContext) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const canWriteOperations = hasCapability(context, "operations.write");
  const canWriteField = hasCapability(context, "field.write");
  if (!canWriteOperations && !canWriteField) {
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
  if (!canWriteOperations && (!canWriteField || !reportActions.has(action))) {
    return Response.json({ error: "forbidden", capability: "field.write", action }, { status: 403 });
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
      return Response.json({
        ...(await workspaceResponse(context, jobRow, rows, requestedJobId)),
        idempotent: true,
        mutation: { action, eventId: existing[0].eventId, readback: "verified" },
      }, { headers: { "cache-control": "no-store" } });
    }

    const current = parseJobPayload(jobRow.payloadJson);
    const expectedVersion = typeof input.expectedVersion === "number" ? Math.floor(input.expectedVersion) : null;
    if (expectedVersion !== null && expectedVersion !== current.version) {
      return Response.json({ error: "version_conflict", expectedVersion, currentVersion: current.version }, { status: 409 });
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
      rapportinoContext = reportContextFromJourneyAndRelated(journeyRows, related);
    }

    const next: JobPayload = { ...current, version: current.version + 1 };
    const now = new Date().toISOString();
    let eventType = "operations.job.updated";
    let change: JsonObject = {};

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
      change = { progress: next.progress };
    } else if (action === "add_activity") {
      const title = boundedText(input.title, 160);
      if (title.length < 2) return Response.json({ error: "activity_title_required" }, { status: 400 });
      const activity: JobActivity = {
        id: `activity-${crypto.randomUUID().slice(0, 8)}`,
        title,
        detail: boundedText(input.detail, 280, "Attività operativa"),
        state: input.state === "active" || input.state === "done" || input.state === "blocked" ? input.state : "queued",
        owner: boundedText(input.owner, 120, "Da assegnare"),
        dueDate: boundedText(input.dueDate, 40, "—"),
        progress: clampJobProgress(input.progress),
        createdAt: now,
        updatedAt: now,
      };
      next.activities = [...current.activities, activity];
      eventType = "operations.job.activity_added";
      change = { activityId: activity.id, title: activity.title };
    } else if (action === "complete_activity") {
      const activityId = boundedText(input.activityId, 120);
      const activity = current.activities.find((item) => item.id === activityId);
      if (!activity) return Response.json({ error: "activity_not_found" }, { status: 404 });
      next.activities = current.activities.map((item) => item.id === activityId ? { ...item, state: "done", progress: 100, updatedAt: now } : item);
      eventType = "operations.job.activity_completed";
      change = { activityId };
    } else if (action === "assign") {
      const responsible = boundedText(input.responsible, 120);
      const team = boundedText(input.team, 120);
      if (!responsible && !team) return Response.json({ error: "responsible_or_team_required" }, { status: 400 });
      next.assignment = {
        responsible: responsible || "Da assegnare",
        team: team || "Da assegnare",
        role: boundedText(input.role, 120, "Responsabile operativo"),
        assignedAt: now,
        assignedBy: context.actorId,
        ...(boundedText(input.responsibleActorId ?? input.responsibleId, 160) ? { responsibleActorId: boundedText(input.responsibleActorId ?? input.responsibleId, 160) } : {}),
        ...(boundedText(input.responsibleMembershipId ?? input.membershipId, 160) ? { responsibleMembershipId: boundedText(input.responsibleMembershipId ?? input.membershipId, 160) } : {}),
        ...(boundedText(input.teamId, 160) ? { teamId: boundedText(input.teamId, 160) } : {}),
      };
      eventType = "operations.job.assigned";
      change = { responsible: next.assignment.responsible, team: next.assignment.team };
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
      change = { evidenceId: evidence.id, kind: evidence.kind };
    } else if (action === "save_rapportino") {
      const text = boundedText(input.text, 4_000);
      if (text.length < 2) return Response.json({ error: "rapportino_text_required" }, { status: 400 });
      next.rapportino = { status: "DRAFT", text, updatedAt: now, updatedBy: context.actorId };
      eventType = "operations.job.rapportino_saved";
      change = { status: "DRAFT" };
    } else if (action === "submit_rapportino") {
      const reportText = boundedText(input.text, 4_000);
      if (reportText.length < 2) return Response.json({ error: "rapportino_text_required" }, { status: 400 });
      const reportReadback = buildRapportinoReadback(current, rapportinoContext ?? {}, { textOverride: reportText });
      if (!reportReadback.completeness.ready) {
        return Response.json({
          error: "rapportino_completeness_unmet",
          completeness: reportReadback.completeness,
          questions: reportReadback.completeness.questions,
          message: "Il rapportino resta in bozza: Company AI deve ricevere tutti i dati importanti prima dell’invio in ufficio.",
        }, { status: 422 });
      }
      next.rapportino = {
        status: "SUBMITTED",
        text: reportText,
        submittedAt: now,
        submittedBy: context.actorId,
        updatedAt: now,
        updatedBy: context.actorId,
        completeness: reportReadback.completeness,
      };
      eventType = "operations.job.rapportino_submitted";
      change = { status: "SUBMITTED", missing: 0 };
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
      if (typeof fields.clientEmail === "string") next.clientEmail = boundedText(fields.clientEmail, 160);
      if (typeof fields.clientReference === "string") next.clientReference = boundedText(fields.clientReference, 160);
      if (typeof fields.clientAddress === "string") next.clientAddress = boundedText(fields.clientAddress, 240);
      if (typeof fields.location === "string") next.location = boundedText(fields.location, 240);
      if (typeof fields.worksite === "string") {
        next.worksite = boundedText(fields.worksite, 240);
        next.location = boundedText(fields.worksite, 240);
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
      if (typeof fields.category === "string") next.category = boundedText(fields.category, 80);
      if (typeof fields.dueDate === "string") next.dueDate = boundedText(fields.dueDate, 40);
      if (fields.priority === "HIGH" || fields.priority === "STANDARD" || fields.priority === "LOW") next.priority = fields.priority;
      eventType = "operations.job.details_updated";
      change = { fields: Object.keys(fields).filter((key) => ["title", "description", "client", "location", "category", "dueDate", "priority"].includes(key)) };
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

    const updatedRows = await db.batch([
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
    ]);

    const updated = (updatedRows[0] as (typeof s04Records.$inferSelect)[])[0];
    if (!updated) return Response.json({ error: "version_conflict", currentVersion: current.version }, { status: 409 });

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
