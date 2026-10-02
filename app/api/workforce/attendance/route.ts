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

function recordLocationStatus(payload: Record<string, unknown>) {
  const transition = payload.lastTransition;
  if (!transition || typeof transition !== "object" || Array.isArray(transition)) return "NO_LOCATION";
  const location = (transition as Record<string, unknown>).location;
  if (!location || typeof location !== "object" || Array.isArray(location)) return "NO_LOCATION";
  const geofence = (location as Record<string, unknown>).geofence;
  if (!geofence || typeof geofence !== "object" || Array.isArray(geofence)) return "NO_GEOFENCE";
  return typeof (geofence as Record<string, unknown>).status === "string" ? (geofence as Record<string, unknown>).status as string : "NO_GEOFENCE";
}

export async function GET() {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "workforce.read") && !hasCapability(context, "field.read")) {
    return Response.json({ error: "forbidden", capability: "workforce.read" }, { status: 403 });
  }

  const allowedModules = [
    ...(hasCapability(context, "operations.read") ? ["operations" as const] : []),
    ...(hasCapability(context, "mission.read") ? ["mission" as const] : []),
  ];
  try {
    const db = getDb();
    const [jobs, attendance] = await Promise.all([
      allowedModules.length
        ? db.select().from(s04Records).where(and(eq(s04Records.tenantId, context.tenantId), inArray(s04Records.module, allowedModules))).limit(500)
        : Promise.resolve([]),
      db.select().from(jobJourneyRecords).where(and(
        eq(jobJourneyRecords.tenantId, context.tenantId),
        eq(jobJourneyRecords.domain, "field"),
        eq(jobJourneyRecords.recordType, "ATTENDANCE"),
      )).orderBy(desc(jobJourneyRecords.updatedAt)).limit(500),
    ]);
    const jobById = new Map(jobs.map((job) => [job.id, job]));
    const canSeeAllAttendance = hasCapability(context, "workforce.read.all")
      || hasCapability(context, "workforce.manage")
      || hasCapability(context, "attendance.read")
      || hasCapability(context, "attendance.approve");
    const records = attendance.filter((row) => jobById.has(row.jobId)).map((row) => {
      const payload = parseJson(row.payloadJson);
      const job = jobById.get(row.jobId);
      const jobPayload = job ? parseJobPayload(job.payloadJson) : null;
      const lastTransition = payload.lastTransition && typeof payload.lastTransition === "object" && !Array.isArray(payload.lastTransition)
        ? payload.lastTransition as Record<string, unknown>
        : {};
      return {
        id: row.id,
        jobId: row.jobId,
        jobCode: job?.canonicalCode ?? null,
        jobTitle: jobPayload?.title || job?.title || "Perimetro operativo",
        jobModule: job?.module ?? "operations",
        status: row.status,
        version: row.version,
        workerId: typeof payload.workerId === "string" ? payload.workerId : null,
        recordedAt: typeof lastTransition.recordedAt === "string" ? lastTransition.recordedAt : null,
        clientObservedAt: typeof lastTransition.clientObservedAt === "string" ? lastTransition.clientObservedAt : null,
        geofenceStatus: recordLocationStatus(payload),
        updatedAt: row.updatedAt,
      };
    }).filter((record) => canSeeAllAttendance || record.workerId === context.actorId);
    return Response.json({
      context: publicAuthorityContext(context),
      contract: { source: "sites-d1-workforce-attendance-readback", tracking: "ON_DUTY_ONLY", timestamp: "SERVER_AUTHORITY" },
      records,
      summary: {
        total: records.length,
        checkedIn: records.filter((record) => record.status === "CHECKED_IN").length,
        paused: records.filter((record) => record.status === "PAUSED").length,
        checkedOut: records.filter((record) => record.status === "CHECKED_OUT" || record.status === "APPROVED").length,
        geofenceInside: records.filter((record) => record.geofenceStatus === "INSIDE").length,
        gpsObserved: records.filter((record) => record.geofenceStatus !== "NO_LOCATION").length,
      },
      readback: { status: "verified", scope: "tenant", checkedAt: new Date().toISOString() },
    }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return Response.json({ error: "attendance_overview_unavailable" }, { status: 503 });
  }
}
