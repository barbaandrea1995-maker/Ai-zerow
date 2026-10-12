import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { jobJourneyRecords, routePlans, routeStops, s04Records } from "@/db/schema";
import { getAuthorityContext, hasCapability, publicAuthorityContext } from "@/lib/authority-context";
import { storedMissionException } from "@/lib/mission-exception-contract";
import { parseJobPayload } from "@/lib/operations-contract";
import { planningCatalog } from "@/lib/planning-catalog";
import { canReadAllOperations, rowMatchesContext, teamScopeTokens } from "@/lib/operational-scope";

export const dynamic = "force-dynamic";

const READ_PAGE_SIZE = 500;
const RELATED_ID_BATCH_SIZE = 100;
const RELATED_ID_BATCH_CONCURRENCY = 8;

async function readAllById<T extends { id: string }>(fetchPage: (afterId?: string) => Promise<T[]>) {
  const rows: T[] = [];
  let afterId: string | undefined;
  while (true) {
    const page = await fetchPage(afterId);
    rows.push(...page);
    if (page.length < READ_PAGE_SIZE) return rows;
    const lastId = page[page.length - 1]?.id;
    if (!lastId || lastId === afterId) throw new Error("planning_readback_page_cursor_stalled");
    afterId = lastId;
  }
}

async function readRelatedById<T extends { id: string }>(
  ids: string[],
  fetchPage: (batch: string[], afterId?: string) => Promise<T[]>,
) {
  const batches: string[][] = [];
  for (let index = 0; index < ids.length; index += RELATED_ID_BATCH_SIZE) {
    batches.push(ids.slice(index, index + RELATED_ID_BATCH_SIZE));
  }
  const rows: T[] = [];
  for (let index = 0; index < batches.length; index += RELATED_ID_BATCH_CONCURRENCY) {
    const batchRows = await Promise.all(batches
      .slice(index, index + RELATED_ID_BATCH_CONCURRENCY)
      .map((batch) => readAllById((afterId) => fetchPage(batch, afterId))));
    rows.push(...batchRows.flat());
  }
  return rows;
}

function parseJson(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

const MISSION_EXCEPTION_STATUSES = new Set([
  "DELAYED",
  "BLOCKED",
  "VEHICLE_FAULT",
  "PARTIAL_DELIVERY",
  "REFUSED",
  "LOST",
  "RECONCILE_REQUIRED",
  "CANCELLED",
]);

function missionExecutionStatus(status: string) {
  if (MISSION_EXCEPTION_STATUSES.has(status)) return "EXCEPTION";
  if (status === "PLANNED") return "MISSION_PLANNED";
  if (status === "DISPATCHED") return "IN_EXECUTION";
  if (status === "DELIVERED") return "DELIVERED_AWAITING_POD";
  if (status === "POD_VERIFIED") return "POD_VERIFIED";
  if (status === "RECONCILED") return "RECONCILED";
  if (status === "CLOSED") return "CLOSED";
  return "UNKNOWN";
}

function missionExceptionReadback(payload: Record<string, unknown>) {
  const exception = storedMissionException(payload.missionException);
  if (!exception) return null;
  return {
    type: exception.type,
    note: exception.note,
    reference: exception.reference,
    stopId: exception.stopId,
    reportedAt: exception.reportedAt,
    reportedBy: exception.reportedBy,
    recoveryStatus: exception.recoveryStatus,
    resolvedAt: exception.resolvedAt ?? null,
    resolvedBy: exception.resolvedBy ?? null,
    resolutionNote: exception.resolutionNote ?? null,
  };
}

function routeProgressForMission(
  missionId: string,
  plans: Array<typeof routePlans.$inferSelect>,
  stops: Array<typeof routeStops.$inferSelect>,
) {
  const plan = plans.find((candidate) => candidate.missionId === missionId);
  if (!plan) return null;
  const routeStopsForMission = stops
    .filter((stop) => stop.routePlanId === plan.id)
    .sort((left, right) => left.sequence - right.sequence);
  const physicallyClosed = (stop: typeof routeStops.$inferSelect) => stop.status === "DEPARTED" || Boolean(stop.departedAt);
  const completed = (stop: typeof routeStops.$inferSelect) => stop.status === "COMPLETED" || stop.deliveryStatus === "CONFIRMED";
  const current = routeStopsForMission.find((stop) => !physicallyClosed(stop)) ?? null;
  const currentMetadata = current ? parseJson(current.evidenceJson) : {};
  return {
    routePlanId: plan.id,
    status: plan.status,
    totalStops: routeStopsForMission.length,
    completedStops: routeStopsForMission.filter(completed).length,
    physicallyClosedStops: routeStopsForMission.filter(physicallyClosed).length,
    currentStopId: current?.id ?? null,
    currentStopSequence: current?.sequence ?? null,
    currentStopLabel: typeof currentMetadata.label === "string" ? currentMetadata.label : null,
    currentStopKind: typeof currentMetadata.kind === "string" ? currentMetadata.kind : null,
  };
}

function firstSlotValue(payload: Record<string, unknown>, key: "startsAt" | "endsAt"): string | null {
  if (typeof payload[key] === "string" && payload[key]) return payload[key];
  const slots = Array.isArray(payload.slots) ? payload.slots : [];
  const first = slots[0];
  if (!first || typeof first !== "object" || Array.isArray(first)) return null;
  const value = (first as Record<string, unknown>)[key];
  return typeof value === "string" && value ? value : null;
}

function validDateValue(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  return Number.isFinite(Date.parse(value)) ? value : null;
}

function deltaMinutes(actualAt: string | null, plannedAt: string | null) {
  if (!actualAt || !plannedAt) return null;
  const actual = Date.parse(actualAt);
  const planned = Date.parse(plannedAt);
  if (!Number.isFinite(actual) || !Number.isFinite(planned)) return null;
  return Math.round((actual - planned) / 60_000);
}

function missionScheduleReadback(
  missionPayload: Record<string, unknown>,
  planningPayload: Record<string, unknown>,
  routePlan: typeof routePlans.$inferSelect | null,
  missionStatus: string,
) {
  const planningStartAt = firstSlotValue(planningPayload, "startsAt");
  const planningEndAt = firstSlotValue(planningPayload, "endsAt");
  const missionStartAt = validDateValue(missionPayload.plannedAt);
  const missionEndAt = validDateValue(missionPayload.plannedEndAt);
  const plannedStartAt = planningStartAt ?? missionStartAt;
  const plannedEndAt = planningEndAt ?? missionEndAt;
  const actualStartAt = validDateValue(routePlan?.startedAt);
  const actualEndAt = validDateValue(routePlan?.endedAt);
  const planningStartMs = planningStartAt ? Date.parse(planningStartAt) : Number.NaN;
  const planningEndMs = planningEndAt ? Date.parse(planningEndAt) : Number.NaN;
  const missionStartMs = missionStartAt ? Date.parse(missionStartAt) : Number.NaN;
  const missionEndMs = missionEndAt ? Date.parse(missionEndAt) : Number.NaN;
  const windowAlignment = Number.isFinite(planningStartMs) && Number.isFinite(planningEndMs) && Number.isFinite(missionStartMs) && Number.isFinite(missionEndMs)
    ? missionStartMs >= planningStartMs && missionEndMs <= planningEndMs ? "ALIGNED" : "OUTSIDE_PLANNING_WINDOW"
    : "UNVERIFIED";
  const startDeltaMinutes = deltaMinutes(actualStartAt, plannedStartAt);
  const endDeltaMinutes = deltaMinutes(actualEndAt, plannedEndAt);
  const toleranceMinutes = 15;
  const closed = missionStatus === "CLOSED" || routePlan?.status === "COMPLETED" || Boolean(actualEndAt);
  let status = "NOT_SCHEDULED";
  if (closed) status = endDeltaMinutes !== null && endDeltaMinutes > toleranceMinutes ? "COMPLETED_LATE" : "COMPLETED";
  else if (actualStartAt) status = startDeltaMinutes !== null && startDeltaMinutes > toleranceMinutes ? "STARTED_LATE" : "IN_PROGRESS";
  else if (plannedEndAt && Date.parse(plannedEndAt) < Date.now()) status = "OVERDUE";
  else if (plannedStartAt) status = "SCHEDULED";

  return {
    status,
    toleranceMinutes,
    plannedStartAt,
    plannedEndAt,
    planningWindow: { startsAt: planningStartAt, endsAt: planningEndAt },
    missionWindow: { startsAt: missionStartAt, endsAt: missionEndAt },
    windowAlignment,
    actualStartAt,
    actualEndAt,
    startDeltaMinutes,
    endDeltaMinutes,
    checkedAt: new Date().toISOString(),
  };
}

function currentDayOverlap(startsAt: string | null, endsAt: string | null) {
  if (!startsAt || !endsAt) return false;
  const starts = Date.parse(startsAt);
  const ends = Date.parse(endsAt);
  if (!Number.isFinite(starts) || !Number.isFinite(ends) || ends <= starts) return false;
  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  return starts < dayEnd.getTime() && ends > dayStart.getTime();
}

const NON_PLANNABLE_JOB_STATUSES = new Set(["COMPLETED", "CLOSED", "CANCELLED"]);

function planningEligibility(status: string, location: string | null) {
  const normalized = status.trim().toUpperCase();
  if (!NON_PLANNABLE_JOB_STATUSES.has(normalized) && location) return { planningEligible: true, planningBlockedReason: null };
  if (!location) return { planningEligible: false, planningBlockedReason: "Registra prima il luogo operativo canonico del perimetro." };
  if (normalized === "COMPLETED") return { planningEligible: false, planningBlockedReason: "Commessa completata: riaprila prima di aggiungere attività." };
  if (normalized === "CANCELLED") return { planningEligible: false, planningBlockedReason: "Perimetro annullato: disponibile solo per consultazione." };
  return { planningEligible: false, planningBlockedReason: "Perimetro chiuso: disponibile solo per consultazione." };
}

export async function GET() {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "planning.read")) return Response.json({ error: "forbidden", capability: "planning.read" }, { status: 403 });

  const allowedModules = [
    ...(hasCapability(context, "operations.read") ? ["operations" as const] : []),
    ...(hasCapability(context, "mission.read") ? ["mission" as const] : []),
  ];
  if (!allowedModules.length) {
    return Response.json({
      context: publicAuthorityContext(context),
      jobs: [],
      plans: [],
      catalogs: { ...planningCatalog(), qualifications: [] },
      summary: { jobs: 0, plans: 0, published: 0, conflicted: 0 },
      readback: { status: "verified", scope: "tenant", checkedAt: new Date().toISOString() },
    }, { headers: { "cache-control": "private, no-store" } });
  }

  try {
    const db = getDb();
    const missionRowsQuery = hasCapability(context, "mission.read")
      ? readAllById((afterId) => db.select().from(jobJourneyRecords).where(afterId
        ? and(
          eq(jobJourneyRecords.tenantId, context.tenantId),
          eq(jobJourneyRecords.domain, "mission"),
          gt(jobJourneyRecords.id, afterId),
        )
        : and(
          eq(jobJourneyRecords.tenantId, context.tenantId),
          eq(jobJourneyRecords.domain, "mission"),
        )).orderBy(asc(jobJourneyRecords.id)).limit(READ_PAGE_SIZE))
      : Promise.resolve([]);
    const [jobs, plans, workforceRows, missionRows] = await Promise.all([
      readAllById((afterId) => db.select().from(s04Records).where(afterId
        ? and(
          eq(s04Records.tenantId, context.tenantId),
          inArray(s04Records.module, allowedModules),
          gt(s04Records.id, afterId),
        )
        : and(
          eq(s04Records.tenantId, context.tenantId),
          inArray(s04Records.module, allowedModules),
        )).orderBy(asc(s04Records.id)).limit(READ_PAGE_SIZE)),
      readAllById((afterId) => db.select().from(jobJourneyRecords).where(afterId
        ? and(
          eq(jobJourneyRecords.tenantId, context.tenantId),
          eq(jobJourneyRecords.domain, "planning"),
          gt(jobJourneyRecords.id, afterId),
        )
        : and(
          eq(jobJourneyRecords.tenantId, context.tenantId),
          eq(jobJourneyRecords.domain, "planning"),
        )).orderBy(asc(jobJourneyRecords.id)).limit(READ_PAGE_SIZE)),
      readAllById((afterId) => db.select().from(s04Records).where(afterId
        ? and(
          eq(s04Records.tenantId, context.tenantId),
          eq(s04Records.module, "workforce"),
          gt(s04Records.id, afterId),
        )
        : and(
          eq(s04Records.tenantId, context.tenantId),
          eq(s04Records.module, "workforce"),
        )).orderBy(asc(s04Records.id)).limit(READ_PAGE_SIZE)),
      missionRowsQuery,
    ]);
    jobs.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
    plans.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
    missionRows.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
    const missionIds = missionRows.map((mission) => mission.id);
    const routePlanRows = missionIds.length
      ? await readRelatedById(missionIds, (batch, afterId) => db.select().from(routePlans).where(afterId
        ? and(
          eq(routePlans.tenantId, context.tenantId),
          inArray(routePlans.missionId, batch),
          gt(routePlans.id, afterId),
        )
        : and(
          eq(routePlans.tenantId, context.tenantId),
          inArray(routePlans.missionId, batch),
        )).orderBy(asc(routePlans.id)).limit(READ_PAGE_SIZE))
      : [];
    const routeStopRows = routePlanRows.length
      ? await readRelatedById(routePlanRows.map((plan) => plan.id), (batch, afterId) => db.select().from(routeStops).where(afterId
        ? and(
          eq(routeStops.tenantId, context.tenantId),
          inArray(routeStops.routePlanId, batch),
          gt(routeStops.id, afterId),
        )
        : and(
          eq(routeStops.tenantId, context.tenantId),
          inArray(routeStops.routePlanId, batch),
        )).orderBy(asc(routeStops.id)).limit(READ_PAGE_SIZE))
      : [];
    routePlanRows.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
    const scopeTokens = teamScopeTokens(workforceRows, context);
    const broadRead = canReadAllOperations(context);
    const visibleJobs = jobs.filter((job) => job.recordType !== "adapter-contract" && (broadRead || rowMatchesContext(job, context, scopeTokens)));
    const allowedJobIds = new Set(visibleJobs.map((job) => job.id));
    const visiblePlans = plans.filter((plan) => allowedJobIds.has(plan.jobId) || broadRead || rowMatchesContext(plan, context, scopeTokens));
    const visiblePlanIds = new Set(visiblePlans.map((plan) => plan.id));
    const planningPayloadById = new Map(visiblePlans.map((plan) => [plan.id, parseJson(plan.payloadJson)]));
    const routePlanByMission = new Map<string, typeof routePlans.$inferSelect>();
    for (const plan of routePlanRows) {
      if (typeof plan.missionId === "string" && !routePlanByMission.has(plan.missionId)) {
        routePlanByMission.set(plan.missionId, plan);
      }
    }
    const linkedMissionByPlan = new Map<string, {
      id: string;
      title: string;
      status: string;
      executionStatus: string;
      routeProgress: ReturnType<typeof routeProgressForMission>;
      schedule: ReturnType<typeof missionScheduleReadback>;
      exception: ReturnType<typeof missionExceptionReadback>;
      version: number;
      updatedAt: string;
    }>();
    for (const mission of missionRows) {
      if (!visiblePlanIds.size) break;
      const missionPayload = parseJson(mission.payloadJson);
      const planningPlanId = typeof missionPayload.planningPlanId === "string" ? missionPayload.planningPlanId : "";
      if (planningPlanId && visiblePlanIds.has(planningPlanId) && !linkedMissionByPlan.has(planningPlanId)) {
        linkedMissionByPlan.set(planningPlanId, {
          id: mission.id,
          title: mission.title,
          status: mission.status,
          executionStatus: missionExecutionStatus(mission.status),
          routeProgress: routeProgressForMission(mission.id, routePlanRows, routeStopRows),
          schedule: missionScheduleReadback(missionPayload, planningPayloadById.get(planningPlanId) ?? {}, routePlanByMission.get(mission.id) ?? null, mission.status),
          exception: missionExceptionReadback(missionPayload),
          version: mission.version,
          updatedAt: mission.updatedAt,
        });
      }
    }
    const jobById = new Map(visibleJobs.map((job) => [job.id, job]));
    const jobViews = visibleJobs.map((job) => {
      const payload = parseJobPayload(job.payloadJson);
      const status = typeof payload.statusCode === "string" && payload.statusCode ? payload.statusCode : job.status;
      const location = [payload.worksite, payload.location, job.detail]
        .find((value): value is string => typeof value === "string" && Boolean(value.trim()))?.trim() ?? null;
      return {
        id: job.id,
        code: job.canonicalCode,
        title: payload.title || job.title,
        module: job.module,
        status,
        ...planningEligibility(status, location),
        location,
        scopeSubgroupId: payload.scopeSubgroupId || null,
        scopeSubgroupTitle: typeof payload.scope === "object" && payload.scope && "subgroupTitle" in payload.scope
          ? String(payload.scope.subgroupTitle ?? "")
          : null,
        updatedAt: job.updatedAt,
      };
    });
    const planViews = visiblePlans.map((plan) => {
      const payload = parseJson(plan.payloadJson);
      const evaluation = payload.evaluation && typeof payload.evaluation === "object" && !Array.isArray(payload.evaluation)
        ? payload.evaluation as Record<string, unknown>
        : null;
      const startsAt = firstSlotValue(payload, "startsAt");
      const endsAt = firstSlotValue(payload, "endsAt");
      const resources = Array.isArray(payload.resources)
        ? payload.resources.filter((resource): resource is Record<string, unknown> => Boolean(resource && typeof resource === "object" && !Array.isArray(resource)))
        : [];
      const firstSlot = Array.isArray(payload.slots) && payload.slots[0] && typeof payload.slots[0] === "object" && !Array.isArray(payload.slots[0])
        ? payload.slots[0] as Record<string, unknown>
        : null;
      const requiredQualifications = firstSlot && Array.isArray(firstSlot.requiredQualifications)
        ? firstSlot.requiredQualifications.filter((value: unknown): value is string => typeof value === "string").slice(0, 12)
        : [];
      return {
        id: plan.id,
        jobId: plan.jobId,
        jobTitle: jobById.get(plan.jobId)?.title ?? "Commessa non disponibile",
        jobModule: jobById.get(plan.jobId)?.module ?? null,
        title: plan.title,
        status: plan.status,
        version: plan.version,
        activityType: payload.activityType ?? "WORK",
        startsAt,
        endsAt,
        location: typeof payload.location === "string" ? payload.location : null,
        scopeSubgroupTitle: typeof payload.scopeSubgroupTitle === "string" ? payload.scopeSubgroupTitle : null,
        priority: typeof payload.priority === "string" ? payload.priority : "STANDARD",
        requiredQualifications,
        resourceIds: Array.isArray(payload.selectedResourceIds)
          ? payload.selectedResourceIds.filter((value: unknown): value is string => typeof value === "string").slice(0, 64)
          : firstSlot && Array.isArray(firstSlot.resourceIds)
            ? firstSlot.resourceIds.filter((value: unknown): value is string => typeof value === "string").slice(0, 64)
            : [],
        notes: typeof payload.notes === "string" ? payload.notes : "",
        resourceCount: resources.length,
        resourceLabels: resources.map((resource) => typeof resource.label === "string" ? resource.label : "Risorsa").slice(0, 16),
        conflictCount: evaluation && Array.isArray(evaluation.conflicts) ? evaluation.conflicts.length : 0,
        conflictDetails: evaluation && Array.isArray(evaluation.conflicts)
          ? evaluation.conflicts
            .map((conflict) => conflict && typeof conflict === "object" && !Array.isArray(conflict) && typeof (conflict as Record<string, unknown>).detail === "string"
              ? String((conflict as Record<string, unknown>).detail)
              : "")
            .filter(Boolean)
            .slice(0, 4)
          : [],
        feasible: evaluation?.feasible !== false,
        linkedMission: linkedMissionByPlan.get(plan.id) ?? null,
        updatedAt: plan.updatedAt,
      };
    });
    const todayPlans = planViews.filter((plan) => plan.status !== "CANCELLED" && currentDayOverlap(plan.startsAt, plan.endsAt));
    const qualifications = [...new Set(workforceRows.flatMap((row) => {
      const payload = parseJson(row.payloadJson);
      return Array.isArray(payload.qualifications)
        ? payload.qualifications.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean)
        : [];
    }))].sort((left, right) => left.localeCompare(right, "it"));
    return Response.json({
      context: publicAuthorityContext(context),
      jobs: jobViews,
      plans: planViews,
      catalogs: { ...planningCatalog(), qualifications },
      summary: {
        jobs: jobViews.length,
        plans: planViews.length,
        today: todayPlans.length,
        drafts: planViews.filter((plan) => plan.status === "DRAFT").length,
        published: planViews.filter((plan) => plan.status === "PUBLISHED").length,
        conflicted: planViews.filter((plan) => !plan.feasible).length,
        scopeLinked: planViews.filter((plan) => Boolean(plan.scopeSubgroupTitle)).length,
        assignedResources: planViews.reduce((total, plan) => total + plan.resourceCount, 0),
        linkedMissions: planViews.filter((plan) => Boolean(plan.linkedMission)).length,
        exceptionsOpen: planViews.filter((plan) => plan.linkedMission?.exception?.recoveryStatus === "OPEN").length,
      },
      readback: { status: "verified", scope: "tenant", checkedAt: new Date().toISOString() },
    }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return Response.json({ error: "planning_readback_unavailable" }, { status: 503 });
  }
}
