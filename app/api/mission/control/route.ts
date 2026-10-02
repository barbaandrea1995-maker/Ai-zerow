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
  } catch { return {}; }
}

export async function GET() {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "mission.read")) {
    return Response.json({ error: "forbidden", capability: "mission.read" }, { status: 403 });
  }
  try {
    const db = getDb();
    const [missions, operationJobs] = await Promise.all([
      db.select().from(jobJourneyRecords).where(and(
      eq(jobJourneyRecords.tenantId, context.tenantId),
      eq(jobJourneyRecords.domain, "mission"),
      )).orderBy(desc(jobJourneyRecords.updatedAt)).limit(500),
      db.select().from(s04Records).where(and(
        eq(s04Records.tenantId, context.tenantId),
        eq(s04Records.module, "operations"),
      )).orderBy(desc(s04Records.updatedAt)).limit(500),
    ]);
    const jobIds = [...new Set(missions.map((mission) => mission.jobId))];
    const jobs = jobIds.length ? await db.select().from(s04Records).where(and(
      eq(s04Records.tenantId, context.tenantId),
      eq(s04Records.module, "operations"),
      inArray(s04Records.id, jobIds),
    )) : [];
    const jobById = new Map(jobs.map((job) => [job.id, job]));
    const records = missions.map((mission) => {
      const job = jobById.get(mission.jobId);
      const jobPayload = job ? parseJobPayload(job.payloadJson) : null;
      return {
        id: mission.id,
        jobId: mission.jobId,
        jobCode: job?.canonicalCode ?? null,
        jobTitle: jobPayload?.title ?? "Commessa",
        title: mission.title,
        status: mission.status,
        version: mission.version,
        payload: parseJson(mission.payloadJson),
        createdAt: mission.createdAt,
        updatedAt: mission.updatedAt,
      };
    });
    const jobView = (job: typeof s04Records.$inferSelect) => {
      const jobPayload = parseJobPayload(job.payloadJson);
      return {
        id: job.id,
        code: job.canonicalCode,
        title: jobPayload?.title || job.title,
        client: jobPayload?.clientName || jobPayload?.client || null,
        location: jobPayload?.worksite || jobPayload?.location || null,
        status: jobPayload?.statusCode || job.status,
      };
    };

    return Response.json({
      context: publicAuthorityContext(context),
      jobs: operationJobs.filter((job) => job.recordType !== "adapter-contract").map(jobView),
      missions: records,
      summary: {
        total: records.length,
        planned: records.filter((record) => record.status === "PLANNED").length,
        dispatched: records.filter((record) => record.status === "DISPATCHED").length,
        delivered: records.filter((record) => record.status === "DELIVERED").length,
      },
    }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return Response.json({ error: "mission_control_unavailable" }, { status: 503 });
  }
}
