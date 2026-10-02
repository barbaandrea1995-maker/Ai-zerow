import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { jobJourneyRecords, s04Records } from "@/db/schema";
import { getAuthorityContext, hasCapability, publicAuthorityContext } from "@/lib/authority-context";
import { parseJobPayload } from "@/lib/operations-contract";

export const dynamic = "force-dynamic";

function parseJson(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function firstSlotValue(payload: Record<string, unknown>, key: "startsAt" | "endsAt") {
  if (typeof payload[key] === "string" && payload[key]) return payload[key];
  const slots = Array.isArray(payload.slots) ? payload.slots : [];
  const first = slots[0];
  return first && typeof first === "object" && !Array.isArray(first) && typeof (first as Record<string, unknown>)[key] === "string"
    ? (first as Record<string, unknown>)[key]
    : null;
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
    const [jobs, plans] = await Promise.all([
      db.select().from(s04Records).where(and(
        eq(s04Records.tenantId, context.tenantId),
        inArray(s04Records.module, allowedModules),
      )).orderBy(desc(s04Records.updatedAt)).limit(500),
      db.select().from(jobJourneyRecords).where(and(
        eq(jobJourneyRecords.tenantId, context.tenantId),
        eq(jobJourneyRecords.domain, "planning"),
      )).orderBy(desc(jobJourneyRecords.updatedAt)).limit(500),
    ]);
    const allowedJobIds = new Set(jobs.filter((job) => job.recordType !== "adapter-contract").map((job) => job.id));
    const visiblePlans = plans.filter((plan) => allowedJobIds.has(plan.jobId));
    const jobById = new Map(jobs.map((job) => [job.id, job]));
    const jobViews = jobs.filter((job) => job.recordType !== "adapter-contract").map((job) => {
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
      return {
        id: plan.id,
        jobId: plan.jobId,
        jobTitle: jobById.get(plan.jobId)?.title ?? "Commessa non disponibile",
        title: plan.title,
        status: plan.status,
        version: plan.version,
        activityType: payload.activityType ?? "WORK",
        startsAt: firstSlotValue(payload, "startsAt"),
        endsAt: firstSlotValue(payload, "endsAt"),
        resourceCount: Array.isArray(payload.resources) ? payload.resources.length : 0,
        feasible: evaluation?.feasible !== false,
        updatedAt: plan.updatedAt,
      };
    });
    return Response.json({
      context: publicAuthorityContext(context),
      jobs: jobViews,
      plans: planViews,
      summary: {
        jobs: jobViews.length,
        plans: planViews.length,
        published: planViews.filter((plan) => plan.status === "PUBLISHED").length,
        conflicted: planViews.filter((plan) => !plan.feasible).length,
      },
      readback: { status: "verified", scope: "tenant", checkedAt: new Date().toISOString() },
    }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return Response.json({ error: "planning_readback_unavailable" }, { status: 503 });
  }
}
