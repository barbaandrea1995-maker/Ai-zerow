import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { jobJourneyRecords, s04Records, tenantWarehouses } from "@/db/schema";
import { getAuthorityContext, hasCapability, publicAuthorityContext } from "@/lib/authority-context";
import { resolveAttendanceTargets } from "@/lib/attendance-scope";
import { materialFulfillmentLines } from "@/lib/material-fulfillment";
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
    const [jobs, warehouses, attendance, planningRows, missionRows, workforceRows] = await Promise.all([
      allowedModules.length
        ? db.select().from(s04Records).where(and(eq(s04Records.tenantId, context.tenantId), inArray(s04Records.module, allowedModules))).limit(500)
        : Promise.resolve([]),
      hasCapability(context, "warehouse.read")
        ? db.select().from(tenantWarehouses).where(eq(tenantWarehouses.tenantId, context.tenantId)).limit(500)
        : Promise.resolve([]),
      db.select().from(jobJourneyRecords).where(and(
        eq(jobJourneyRecords.tenantId, context.tenantId),
        inArray(jobJourneyRecords.domain, ["field", "warehouse"]),
        eq(jobJourneyRecords.recordType, "ATTENDANCE"),
      )).orderBy(desc(jobJourneyRecords.updatedAt)).limit(500),
      db.select().from(jobJourneyRecords).where(and(
        eq(jobJourneyRecords.tenantId, context.tenantId),
        eq(jobJourneyRecords.domain, "planning"),
      )).orderBy(desc(jobJourneyRecords.updatedAt)).limit(500),
      db.select().from(jobJourneyRecords).where(and(
        eq(jobJourneyRecords.tenantId, context.tenantId),
        eq(jobJourneyRecords.domain, "mission"),
        eq(jobJourneyRecords.recordType, "TRANSPORT"),
        inArray(jobJourneyRecords.status, ["PLANNED", "DISPATCHED"]),
      )).orderBy(desc(jobJourneyRecords.updatedAt)).limit(500),
      db.select().from(s04Records).where(and(
        eq(s04Records.tenantId, context.tenantId),
        eq(s04Records.module, "workforce"),
      )).limit(500),
    ]);
    const scope = resolveAttendanceTargets({
      context,
      jobs,
      planningRows,
      missionRows,
      warehouses,
      workforceRows,
    });
    const jobById = new Map(jobs.map((job) => [job.id, job]));
    const warehouseById = new Map(warehouses.map((warehouse) => [warehouse.id, warehouse]));
    const canSeeAllAttendance = hasCapability(context, "workforce.read.all")
      || hasCapability(context, "workforce.manage");
    const canReadScopedAttendance = hasCapability(context, "attendance.read")
      || hasCapability(context, "attendance.manage")
      || hasCapability(context, "attendance.approve");
    const targetJobIds = new Set(scope.targets.map((target) => target.jobId).filter((id): id is string => Boolean(id)));
    const directRequestRows = hasCapability(context, "warehouse.self_pickup") && targetJobIds.size
      ? await db.select().from(jobJourneyRecords).where(and(
        eq(jobJourneyRecords.tenantId, context.tenantId),
        inArray(jobJourneyRecords.jobId, [...targetJobIds]),
        eq(jobJourneyRecords.domain, "warehouse"),
        eq(jobJourneyRecords.recordType, "MATERIAL_REQUEST"),
        eq(jobJourneyRecords.status, "APPROVED"),
      )).orderBy(desc(jobJourneyRecords.updatedAt)).limit(500)
      : [];
    const directPickupTotals = hasCapability(context, "warehouse.self_pickup") && targetJobIds.size
      ? await db.$client.prepare(`
        SELECT json_extract(payload_json, '$.requestId') AS requestId,
          json_extract(payload_json, '$.lineId') AS lineId,
          COALESCE(SUM(CAST(json_extract(payload_json, '$.quantityMilli') AS INTEGER)), 0) AS pickedMilli
        FROM job_journey_records
        WHERE tenant_id = ? AND job_id IN (${[...targetJobIds].map(() => "?").join(",")})
          AND domain = 'warehouse' AND record_type = 'MATERIAL_PICKUP'
        GROUP BY requestId, lineId
      `).bind(context.tenantId, ...targetJobIds).all<{ requestId: string | null; lineId: string | null; pickedMilli: number }>()
      : { results: [] as { requestId: string | null; lineId: string | null; pickedMilli: number }[] };
    const pickupTotals = new Map<string, number>();
    for (const row of directPickupTotals.results) {
      const pickedMilli = Number(row.pickedMilli);
      if (!row.requestId || !row.lineId || !Number.isSafeInteger(pickedMilli) || pickedMilli < 0) {
        return Response.json({ error: "material_pickup_ledger_readback_unavailable" }, { status: 503 });
      }
      pickupTotals.set(`${row.requestId}:${row.lineId}`, pickedMilli);
    }
    const directPickupsByJob = new Map<string, NonNullable<(typeof scope.targets)[number]["materialPickups"]>>();
    for (const requestRow of directRequestRows) {
      const requestPayload = parseJson(requestRow.payloadJson);
      const planLines = materialFulfillmentLines(requestPayload);
      if (!planLines) continue;
      const warehouseValue = requestPayload.warehouse && typeof requestPayload.warehouse === "object" && !Array.isArray(requestPayload.warehouse)
        ? requestPayload.warehouse as Record<string, unknown>
        : {};
      const warehouseId = typeof requestPayload.warehouseId === "string" ? requestPayload.warehouseId : typeof warehouseValue.id === "string" ? warehouseValue.id : "";
      const warehouse = warehouseById.get(warehouseId);
      if (!warehouse || warehouse.status !== "active") continue;
      for (const line of planLines) {
        if (!line.itemId || line.directPickupMilli <= 0) continue;
        const picked = pickupTotals.get(`${requestRow.id}:${line.lineId}`) ?? 0;
        const remaining = Math.max(0, line.directPickupMilli - picked);
        if (!remaining) continue;
        const current = directPickupsByJob.get(requestRow.jobId) ?? [];
        current.push({
          requestId: requestRow.id,
          title: requestRow.title,
          warehouseId,
          warehouseName: warehouse.name,
          warehouseLocation: warehouse.locationLabel,
          lineId: line.lineId,
          itemId: line.itemId,
          description: line.description,
          sku: line.sku,
          unit: line.unit,
          directQuantityMilli: line.directPickupMilli,
          pickedQuantityMilli: picked,
          remainingQuantityMilli: remaining,
        });
        directPickupsByJob.set(requestRow.jobId, current);
      }
    }
    const attendanceTargets = scope.targets.map((target) => ({
      ...target,
      ...(target.jobId && directPickupsByJob.has(target.jobId) ? { materialPickups: directPickupsByJob.get(target.jobId) } : {}),
    }));
    const records = attendance.filter((row) => jobById.has(row.jobId) || warehouseById.has(row.jobId)).map((row) => {
      const payload = parseJson(row.payloadJson);
      const job = jobById.get(row.jobId);
      const warehouse = warehouseById.get(row.jobId);
      const jobPayload = job ? parseJobPayload(job.payloadJson) : null;
      const lastTransition = payload.lastTransition && typeof payload.lastTransition === "object" && !Array.isArray(payload.lastTransition)
        ? payload.lastTransition as Record<string, unknown>
        : {};
      return {
        id: row.id,
        jobId: row.jobId,
        jobCode: job?.canonicalCode ?? warehouse?.code ?? null,
        jobTitle: jobPayload?.title || job?.title || warehouse?.name || "Perimetro operativo",
        jobModule: warehouse ? "warehouse" : job?.module ?? "operations",
        status: row.status,
        version: row.version,
        workerId: typeof payload.workerId === "string" ? payload.workerId : null,
        recordedAt: typeof lastTransition.recordedAt === "string" ? lastTransition.recordedAt : null,
        clientObservedAt: typeof lastTransition.clientObservedAt === "string" ? lastTransition.clientObservedAt : null,
        geofenceStatus: recordLocationStatus(payload),
        updatedAt: row.updatedAt,
      };
    }).filter((record) => {
      if (canSeeAllAttendance || record.workerId === context.actorId) return true;
      if (!canReadScopedAttendance) return false;
      if (jobById.has(record.jobId) && targetJobIds.has(record.jobId)) return true;
      if (record.jobModule === "warehouse" && scope.warehouseScope.warehouseIds.includes(record.jobId)) return true;
      return false;
    });
    return Response.json({
      context: publicAuthorityContext(context),
      contract: {
        source: "sites-d1-workforce-attendance-readback",
        duty: "ON_DUTY_ONLY",
        tracking: "DRIVER_CHECK_IN_GATED_AND_VISIBLE_IN_COMMAND",
        timestamp: "SERVER_AUTHORITY",
        assignment: "SERVER_SIDE_ONLY",
        geofence: "ENTRY_AND_EXIT_REQUIRE_INSIDE_ASSIGNED_PERIMETER",
      },
      serviceMode: scope.serviceMode,
      targets: attendanceTargets,
      warehouseScope: scope.warehouseScope,
      assignmentReadback: { status: "verified", source: "tenant-assignment-readback" },
      records,
      summary: {
        total: records.length,
        checkedIn: records.filter((record) => record.status === "CHECKED_IN").length,
        paused: records.filter((record) => record.status === "PAUSED").length,
        checkedOut: records.filter((record) => record.status === "CHECKED_OUT" || record.status === "APPROVED").length,
        geofenceInside: records.filter((record) => record.geofenceStatus === "INSIDE").length,
        geofenceOutside: records.filter((record) => record.geofenceStatus === "OUTSIDE").length,
        geofenceUncertain: records.filter((record) => record.geofenceStatus === "UNCERTAIN").length,
        gpsObserved: records.filter((record) => record.geofenceStatus !== "NO_LOCATION").length,
        noLocation: records.filter((record) => record.geofenceStatus === "NO_LOCATION").length,
      },
      readback: { status: "verified", scope: "tenant", checkedAt: new Date().toISOString() },
    }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return Response.json({ error: "attendance_overview_unavailable" }, { status: 503 });
  }
}
