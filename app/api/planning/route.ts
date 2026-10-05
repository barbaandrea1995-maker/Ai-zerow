import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { jobJourneyRecords, s04Records } from "@/db/schema";
import { getAuthorityContext, hasCapability, publicAuthorityContext } from "@/lib/authority-context";
import { parseJobPayload } from "@/lib/operations-contract";
import { canReadAllOperations, rowMatchesContext, teamScopeTokens } from "@/lib/operational-scope";

export const dynamic = "force-dynamic";

function parseJson(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function firstSlotValue(payload: Record<string, unknown>, key: "startsAt" | "endsAt"): string | null {
  if (typeof payload[key] === "string" && payload[key]) return payload[key];
  const slots = Array.isArray(payload.slots) ? payload.slots : [];
  const first = slots[0];
  if (!first || typeof first !== "object" || Array.isArray(first)) return null;
  const value = (first as Record<string, unknown>)[key];
  return typeof value === "string" && value ? value : null;
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
      summary: { jobs: 0, plans: 0, published: 0, conflicted: 0 },
      readback: { status: "verified", scope: "tenant", checkedAt: new Date().toISOString() },
    }, { headers: { "cache-control": "private, no-store" } });
  }

  try {
    const db = getDb();
    const [jobs, plans, workforceRows] = await Promise.all([
      db.select().from(s04Records).where(and(
        eq(s04Records.tenantId, context.tenantId),
        inArray(s04Records.module, allowedModules),
      )).orderBy(desc(s04Records.updatedAt)).limit(500),
      db.select().from(jobJourneyRecords).where(and(
        eq(jobJourneyRecords.tenantId, context.tenantId),
        eq(jobJourneyRecords.domain, "planning"),
      )).orderBy(desc(jobJourneyRecords.updatedAt)).limit(500),
      db.select().from(s04Records).where(and(
        eq(s04Records.tenantId, context.tenantId),
        eq(s04Records.module, "workforce"),
      )).limit(500),
    ]);
    const scopeTokens = teamScopeTokens(workforceRows, context);
    const broadRead = canReadAllOperations(context);
    const visibleJobs = jobs.filter((job) => job.recordType !== "adapter-contract" && (broadRead || rowMatchesContext(job, context, scopeTokens)));
    const allowedJobIds = new Set(visibleJobs.map((job) => job.id));
    const visiblePlans = plans.filter((plan) => allowedJobIds.has(plan.jobId) || broadRead || rowMatchesContext(plan, context, scopeTokens));
    const jobById = new Map(visibleJobs.map((job) => [job.id, job]));
    const jobViews = visibleJobs.map((job) => {
      const payload = parseJobPayload(job.payloadJson);
      return {
        id: job.id,
        code: job.canonicalCode,
        title: payload.title || job.title,
        module: job.module,
        status: payload.statusCode || job.status,
        location: payload.worksite || payload.location || job.detail,
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
        resourceCount: resources.length,
        resourceLabels: resources.map((resource) => typeof resource.label === "string" ? resource.label : "Risorsa").slice(0, 16),
        conflictCount: evaluation && Array.isArray(evaluation.conflicts) ? evaluation.conflicts.length : 0,
        feasible: evaluation?.feasible !== false,
        updatedAt: plan.updatedAt,
      };
    });
    const todayPlans = planViews.filter((plan) => currentDayOverlap(plan.startsAt, plan.endsAt));
    return Response.json({
      context: publicAuthorityContext(context),
      jobs: jobViews,
      plans: planViews,
      summary: {
        jobs: jobViews.length,
        plans: planViews.length,
        today: todayPlans.length,
        drafts: planViews.filter((plan) => plan.status === "DRAFT").length,
        published: planViews.filter((plan) => plan.status === "PUBLISHED").length,
        conflicted: planViews.filter((plan) => !plan.feasible).length,
        scopeLinked: planViews.filter((plan) => Boolean(plan.scopeSubgroupTitle)).length,
        assignedResources: planViews.reduce((total, plan) => total + plan.resourceCount, 0),
      },
      readback: { status: "verified", scope: "tenant", checkedAt: new Date().toISOString() },
    }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return Response.json({ error: "planning_readback_unavailable" }, { status: 503 });
  }
}
