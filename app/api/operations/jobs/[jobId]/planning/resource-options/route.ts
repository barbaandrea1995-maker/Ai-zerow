import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { jobJourneyRecords, s04Records } from "@/db/schema";
import { getAuthorityContext, hasCapability, publicAuthorityContext } from "@/lib/authority-context";
import { getPlanningResourceOptions, type PlanningAvailabilityWindow } from "@/lib/planning-resources";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ jobId: string }> };

async function routeJobId(routeContext: RouteContext) {
  try {
    const value = decodeURIComponent((await routeContext.params).jobId).trim();
    return value && value.length <= 160 ? value : null;
  } catch {
    return null;
  }
}

async function findJob(tenantId: string, reference: string) {
  const base = and(eq(s04Records.tenantId, tenantId), inArray(s04Records.module, ["operations", "mission"]));
  const [byId] = await getDb().select().from(s04Records).where(and(base, eq(s04Records.id, reference))).limit(1);
  if (byId) return byId;
  const [byCode] = await getDb().select().from(s04Records).where(and(base, eq(s04Records.canonicalCode, reference))).limit(1);
  return byCode ?? null;
}

export async function GET(request: Request, routeContext: RouteContext) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "planning.read")) return Response.json({ error: "forbidden", capability: "planning.read" }, { status: 403 });
  const reference = await routeJobId(routeContext);
  if (!reference) return Response.json({ error: "invalid_job_id" }, { status: 400 });
  try {
    const job = await findJob(context.tenantId, reference);
    if (!job) return Response.json({ error: "job_not_found" }, { status: 404 });
    const url = new URL(request.url);
    const startsAt = url.searchParams.get("startsAt")?.trim() ?? "";
    const endsAt = url.searchParams.get("endsAt")?.trim() ?? "";
    const excludedPlanId = url.searchParams.get("excludePlanId")?.trim() || undefined;
    const hasWindow = Boolean(startsAt || endsAt);
    if (hasWindow && (!startsAt || !endsAt || !Number.isFinite(Date.parse(startsAt)) || !Number.isFinite(Date.parse(endsAt)) || Date.parse(endsAt) <= Date.parse(startsAt))) {
      return Response.json({ error: "invalid_planning_window" }, { status: 400 });
    }
    const window: PlanningAvailabilityWindow | undefined = hasWindow ? { startsAt, endsAt } : undefined;
    const planningOptions = await getPlanningResourceOptions(context.tenantId, window, excludedPlanId);
    const workforce = hasCapability(context, "workforce.read")
      ? planningOptions.filter((item) => item.kind === "person" || item.kind === "team")
      : [];
    const assets = hasCapability(context, "asset.read")
      ? planningOptions.filter((item) => item.kind === "asset" || item.kind === "vehicle")
      : [];
    const plans = hasCapability(context, "planning.read")
      ? await getDb().select().from(jobJourneyRecords).where(and(eq(jobJourneyRecords.tenantId, context.tenantId), eq(jobJourneyRecords.jobId, job.id), eq(jobJourneyRecords.domain, "planning"))).orderBy(desc(jobJourneyRecords.updatedAt)).limit(50)
      : [];
    return Response.json({
      context: publicAuthorityContext(context),
      job: { id: job.id, code: job.canonicalCode, title: job.title },
      options: {
        workforce,
        assets: assets.filter((item) => item.assignable),
        unavailableAssets: assets.filter((item) => !item.assignable),
        unavailableForWindow: planningOptions.filter((item) => item.assignable && !item.availableForWindow),
      },
      existingPlans: plans.map((plan) => ({ id: plan.id, status: plan.status, version: plan.version, title: plan.title, updatedAt: plan.updatedAt })),
      contract: {
        source: "sites-d1-planning-resource-readback",
        writes: "/api/operations/jobs/:jobId/planning",
        assignmentGuard: "server-window-lifecycle-and-tenant-active-plans",
      },
      availability: {
        status: "verified",
        window: window ?? null,
        rule: "DRAFT/PUBLISHED tenant plans are checked for interval overlap before options are returned.",
        checkedAt: new Date().toISOString(),
      },
      readback: { status: "verified", scope: "tenant", checkedAt: new Date().toISOString() },
    }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return Response.json({ error: "planning_resource_options_unavailable" }, { status: 503 });
  }
}
