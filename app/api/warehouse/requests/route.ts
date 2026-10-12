import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { inventoryMovements, jobJourneyRecords, s04Records } from "@/db/schema";
import { getAuthorityContext, hasCapability, publicAuthorityContext } from "@/lib/authority-context";
import { tenantWarehouseAccess, warehouseIdIsAllowed } from "@/lib/warehouse-access";

export const dynamic = "force-dynamic";

type JsonObject = Record<string, unknown>;

function parsePayload(value: string): JsonObject {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as JsonObject : {};
  } catch {
    return {};
  }
}

export async function GET() {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const canReview = hasCapability(context, "warehouse.review");
  const canFulfill = hasCapability(context, "warehouse.write");
  if (!canReview && !canFulfill) {
    return Response.json({ error: "forbidden", requiredCapabilities: ["warehouse.review", "warehouse.write"], match: "any" }, { status: 403 });
  }
  try {
    const db = getDb();
    const [rows, access] = await Promise.all([
      db.select().from(jobJourneyRecords).where(and(
        eq(jobJourneyRecords.tenantId, context.tenantId),
        eq(jobJourneyRecords.domain, "warehouse"),
        eq(jobJourneyRecords.recordType, "MATERIAL_REQUEST"),
        inArray(jobJourneyRecords.status, ["REQUESTED", "APPROVED"]),
      )).orderBy(desc(jobJourneyRecords.createdAt)).limit(250),
      tenantWarehouseAccess(context),
    ]);
    const visibleRows = rows.filter((row) => {
      if (row.status === "REQUESTED") return canReview;
      const requestPayload = parsePayload(row.payloadJson);
      const warehouse = requestPayload.warehouse && typeof requestPayload.warehouse === "object" && !Array.isArray(requestPayload.warehouse)
        ? requestPayload.warehouse as JsonObject
        : {};
      const warehouseId = typeof requestPayload.warehouseId === "string" ? requestPayload.warehouseId : typeof warehouse.id === "string" ? warehouse.id : "";
      return canFulfill && warehouseId && warehouseIdIsAllowed(access, warehouseId);
    });
    const linkedMissionIds = [...new Set(visibleRows.flatMap((row) => {
      const id = parsePayload(row.payloadJson).missionId;
      return typeof id === "string" && id ? [id] : [];
    }))];
    const missions = linkedMissionIds.length
      ? await db.select().from(jobJourneyRecords).where(and(
        eq(jobJourneyRecords.tenantId, context.tenantId),
        eq(jobJourneyRecords.domain, "mission"),
        eq(jobJourneyRecords.recordType, "TRANSPORT"),
        inArray(jobJourneyRecords.id, linkedMissionIds),
      ))
      : [];
    const missionById = new Map(missions.map((mission) => [mission.id, mission]));
    const requestsWithMission = visibleRows.filter((row) => {
      if (row.status === "REQUESTED") return true;
      const missionId = parsePayload(row.payloadJson).missionId;
      return typeof missionId !== "string" || !missionId || missionById.has(missionId);
    });
    const jobIds = [...new Set(requestsWithMission.map((row) => row.jobId))];
    const jobs = jobIds.length
      ? await db.select().from(s04Records).where(and(
        eq(s04Records.tenantId, context.tenantId),
        eq(s04Records.module, "operations"),
        inArray(s04Records.id, jobIds),
      ))
      : [];
    const jobById = new Map(jobs.map((job) => [job.id, job]));
    const approvedMissionIds = requestsWithMission.flatMap((row) => {
      const requestPayload = parsePayload(row.payloadJson);
      return row.status === "APPROVED" && typeof requestPayload.missionId === "string" ? [requestPayload.missionId] : [];
    });
    const approvedItemIds = [...new Set(requestsWithMission.flatMap((row) => {
      if (row.status !== "APPROVED") return [];
      const requestPayload = parsePayload(row.payloadJson);
      return Array.isArray(requestPayload.lines) ? requestPayload.lines.flatMap((line) => {
        if (!line || typeof line !== "object" || Array.isArray(line)) return [];
        const itemId = (line as JsonObject).itemId;
        return typeof itemId === "string" && itemId ? [itemId] : [];
      }) : [];
    }))];
    const stockMovements = approvedMissionIds.length && approvedItemIds.length
      ? await db.select().from(inventoryMovements).where(and(
        eq(inventoryMovements.tenantId, context.tenantId),
        inArray(inventoryMovements.missionId, approvedMissionIds),
        inArray(inventoryMovements.itemId, approvedItemIds),
        eq(inventoryMovements.movementType, "PICK"),
      )).orderBy(inventoryMovements.createdAt).limit(1_000)
      : [];
    return Response.json({
      context: publicAuthorityContext(context),
      requests: requestsWithMission.map((row) => {
        const job = jobById.get(row.jobId);
        const jobPayload = job ? parsePayload(job.payloadJson) : {};
        const requestPayload = parsePayload(row.payloadJson);
        const missionId = typeof requestPayload.missionId === "string" ? requestPayload.missionId : null;
        const mission = missionId ? missionById.get(missionId) : null;
        return {
          id: row.id,
          jobId: row.jobId,
          jobCode: job?.canonicalCode ?? null,
          jobTitle: typeof jobPayload.title === "string" && jobPayload.title.trim() ? jobPayload.title : job?.title ?? "Commessa",
          title: row.title,
          status: row.status,
          version: row.version,
          payload: requestPayload,
          mission: mission ? { id: mission.id, title: mission.title, status: mission.status } : null,
          stockMovements: stockMovements.filter((movement) => movement.missionId === missionId).map((movement) => ({
            itemId: movement.itemId,
            missionId: movement.missionId,
            movementType: movement.movementType,
            quantity: movement.quantityMilli / 1_000,
          })),
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        };
      }),
      warehouseScope: access.scope,
      summary: {
        pending: requestsWithMission.filter((row) => row.status === "REQUESTED").length,
        scheduled: requestsWithMission.filter((row) => row.status === "APPROVED").length,
        assignedWarehouses: access.warehouses.length,
      },
      readback: { status: "verified", scope: "tenant-requests-and-assigned-warehouses", checkedAt: new Date().toISOString() },
    }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return Response.json({ error: "warehouse_requests_readback_unavailable" }, { status: 503 });
  }
}
