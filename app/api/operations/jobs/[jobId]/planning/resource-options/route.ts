import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { jobJourneyRecords, s04Records } from "@/db/schema";
import { getAuthorityContext, hasCapability, publicAuthorityContext } from "@/lib/authority-context";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ jobId: string }> };

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function parsePayload(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

async function routeJobId(routeContext: RouteContext) {
  try {
    const value = decodeURIComponent((await routeContext.params).jobId).trim();
    return value && value.length <= 160 ? value : null;
  } catch {
    return null;
  }
}

async function findJob(tenantId: string, reference: string) {
  const base = and(eq(s04Records.tenantId, tenantId), eq(s04Records.module, "operations"));
  const [byId] = await getDb().select().from(s04Records).where(and(base, eq(s04Records.id, reference))).limit(1);
  if (byId) return byId;
  const [byCode] = await getDb().select().from(s04Records).where(and(base, eq(s04Records.canonicalCode, reference))).limit(1);
  return byCode ?? null;
}

function optionForRecord(row: typeof s04Records.$inferSelect, kind: "person" | "team" | "asset" | "vehicle") {
  const payload = parsePayload(row.payloadJson);
  const lifecycleStatus = text(payload.lifecycleStatus, row.status || "AVAILABLE").toUpperCase();
  return {
    id: row.id,
    code: row.canonicalCode,
    label: row.title,
    kind,
    status: lifecycleStatus,
    assignable: kind === "asset" || kind === "vehicle" ? lifecycleStatus === "AVAILABLE" || lifecycleStatus === "ACTIVE" : true,
    qualifications: Array.isArray(payload.qualifications) ? payload.qualifications.filter((item): item is string => typeof item === "string").slice(0, 20) : [],
    updatedAt: row.updatedAt,
  };
}

export async function GET(_request: Request, routeContext: RouteContext) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "planning.read")) return Response.json({ error: "forbidden", capability: "planning.read" }, { status: 403 });
  const reference = await routeJobId(routeContext);
  if (!reference) return Response.json({ error: "invalid_job_id" }, { status: 400 });
  try {
    const job = await findJob(context.tenantId, reference);
    if (!job) return Response.json({ error: "job_not_found" }, { status: 404 });
    const rows = await getDb().select().from(s04Records).where(eq(s04Records.tenantId, context.tenantId)).orderBy(desc(s04Records.updatedAt)).limit(500);
    const workforce = hasCapability(context, "workforce.read")
      ? rows.filter((row) => row.module === "workforce").map((row) => optionForRecord(row, row.recordType.toLowerCase().includes("team") ? "team" : "person"))
      : [];
    const assets = hasCapability(context, "asset.read")
      ? rows.filter((row) => row.module === "assets").map((row) => optionForRecord(row, row.recordType.toLowerCase().includes("vehicle") ? "vehicle" : "asset"))
      : [];
    const plans = hasCapability(context, "planning.read")
      ? await getDb().select().from(jobJourneyRecords).where(and(eq(jobJourneyRecords.tenantId, context.tenantId), eq(jobJourneyRecords.jobId, job.id), eq(jobJourneyRecords.domain, "planning"))).orderBy(desc(jobJourneyRecords.updatedAt)).limit(50)
      : [];
    return Response.json({
      context: publicAuthorityContext(context),
      job: { id: job.id, code: job.canonicalCode, title: job.title },
      options: { workforce, assets: assets.filter((item) => item.assignable), unavailableAssets: assets.filter((item) => !item.assignable) },
      existingPlans: plans.map((plan) => ({ id: plan.id, status: plan.status, version: plan.version, title: plan.title, updatedAt: plan.updatedAt })),
      contract: { source: "sites-d1-planning-resource-readback", writes: "/api/operations/jobs/:jobId/planning", assignmentGuard: "asset.lifecycleStatus" },
      readback: { status: "verified", scope: "tenant", checkedAt: new Date().toISOString() },
    }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return Response.json({ error: "planning_resource_options_unavailable" }, { status: 503 });
  }
}

