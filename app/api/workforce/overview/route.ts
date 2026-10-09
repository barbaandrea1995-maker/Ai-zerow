import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { jobJourneyRecords, s04Records, tenantMemberships, tenantWarehouses } from "@/db/schema";
import { getAuthorityContext, hasCapability, publicAuthorityContext } from "@/lib/authority-context";
import { isAuthorityRole, normalizeAuthorityRoles, ROLE_METADATA } from "@/lib/authority-catalog";
import { parseJobPayload } from "@/lib/operations-contract";
import { getMissionResourceCatalog } from "@/lib/mission-resources";

export const dynamic = "force-dynamic";

type JsonObject = Record<string, unknown>;

function parseJson(value: string): JsonObject {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as JsonObject : {};
  } catch {
    return {};
  }
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function statusOf(row: typeof s04Records.$inferSelect, payload: JsonObject) {
  return text(payload.lifecycleStatus || payload.availabilityStatus || row.status || "UNKNOWN").toUpperCase();
}

function isAvailable(status: string) {
  return ["AVAILABLE", "ACTIVE", "OPERATIVO", "ONLINE", "IN PRESIDIO"].includes(status);
}

function roleLabel(role: string) {
  return isAuthorityRole(role) ? ROLE_METADATA[role].label : role;
}

function firstSlotValue(payload: JsonObject, key: "startsAt" | "endsAt") {
  if (typeof payload[key] === "string" && payload[key]) return payload[key] as string;
  const slots = Array.isArray(payload.slots) ? payload.slots : [];
  const first = slots[0];
  return first && typeof first === "object" && !Array.isArray(first) && typeof (first as JsonObject)[key] === "string"
    ? (first as JsonObject)[key] as string
    : null;
}

function locationStatus(payload: JsonObject) {
  const transition = payload.lastTransition;
  if (!transition || typeof transition !== "object" || Array.isArray(transition)) return "NO_LOCATION";
  const location = (transition as JsonObject).location;
  if (!location || typeof location !== "object" || Array.isArray(location)) return "NO_LOCATION";
  const geofence = (location as JsonObject).geofence;
  if (!geofence || typeof geofence !== "object" || Array.isArray(geofence)) return "NO_GEOFENCE";
  return text((geofence as JsonObject).status, "NO_GEOFENCE");
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

const workforceEntityTypes = new Set(["person", "worker", "operator", "driver", "team"]);

export async function GET() {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "workforce.read") && !hasCapability(context, "field.read")) {
    return Response.json({ error: "forbidden", capability: "workforce.read" }, { status: 403 });
  }

  const canSeeRegistry = hasCapability(context, "workforce.read.all")
    || hasCapability(context, "workforce.registry.read")
    || hasCapability(context, "workforce.manage")
    || hasCapability(context, "authority.read");
  const allowedModules = [
    ...(hasCapability(context, "operations.read") ? ["operations" as const] : []),
    ...(hasCapability(context, "mission.read") ? ["mission" as const] : []),
  ];

  try {
    const db = getDb();
    const [membershipRows, workforceRows, jobs, warehouses, plans, attendance, missionCatalog] = await Promise.all([
      canSeeRegistry
        ? db.select().from(tenantMemberships).where(eq(tenantMemberships.tenantId, context.tenantId)).orderBy(desc(tenantMemberships.updatedAt)).limit(500)
        : Promise.resolve([]),
      db.select().from(s04Records).where(and(
        eq(s04Records.tenantId, context.tenantId),
        eq(s04Records.module, "workforce"),
      )).orderBy(desc(s04Records.updatedAt)).limit(500),
      allowedModules.length
        ? db.select().from(s04Records).where(and(
          eq(s04Records.tenantId, context.tenantId),
          inArray(s04Records.module, allowedModules),
        )).limit(500)
        : Promise.resolve([]),
      hasCapability(context, "warehouse.read")
        ? db.select().from(tenantWarehouses).where(eq(tenantWarehouses.tenantId, context.tenantId)).limit(500)
        : Promise.resolve([]),
      db.select().from(jobJourneyRecords).where(and(
        eq(jobJourneyRecords.tenantId, context.tenantId),
        eq(jobJourneyRecords.domain, "planning"),
      )).orderBy(desc(jobJourneyRecords.updatedAt)).limit(500),
      db.select().from(jobJourneyRecords).where(and(
        eq(jobJourneyRecords.tenantId, context.tenantId),
        inArray(jobJourneyRecords.domain, ["field", "warehouse"]),
        eq(jobJourneyRecords.recordType, "ATTENDANCE"),
      )).orderBy(desc(jobJourneyRecords.updatedAt)).limit(500),
      getMissionResourceCatalog({ tenantId: context.tenantId }),
    ]);

    const visibleMembershipRows = canSeeRegistry ? membershipRows : [{
      id: context.membershipId,
      actorId: context.actorId,
      actorEmail: context.actorEmail,
      displayName: context.actorName,
      role: context.role,
      roles: context.roles,
      status: "active",
      updatedAt: new Date().toISOString(),
    }];
    const members = visibleMembershipRows.map((membership) => {
      const roleSource = "rolesJson" in membership ? membership.rolesJson : membership.roles;
      const roles = normalizeAuthorityRoles(roleSource, membership.role);
      return {
        id: membership.id,
        name: membership.displayName,
        email: canSeeRegistry ? membership.actorEmail : undefined,
        role: roles[0] ?? membership.role,
        roleLabel: roleLabel(roles[0] ?? membership.role),
        roles,
        rolesLabel: roles.map(roleLabel),
        status: membership.status,
        updatedAt: membership.updatedAt,
      };
    });

    const scopedWorkforceRows = canSeeRegistry
      ? workforceRows
      : workforceRows.filter((row) => {
        const payload = parseJson(row.payloadJson);
        const teamMembershipIds = Array.isArray(payload.memberMembershipIds)
          ? payload.memberMembershipIds.filter((value): value is string => typeof value === "string")
          : [];
        return text(payload.authorityMembershipId || payload.membershipId) === context.membershipId
          || text(payload.actorId) === context.actorId
          || teamMembershipIds.includes(context.membershipId);
      });
    const resources = scopedWorkforceRows.flatMap((row) => {
      const payload = parseJson(row.payloadJson);
      const entityType = text(payload.entityType || payload.resourceKind || payload.kind, row.recordType).toLowerCase();
      if (!workforceEntityTypes.has(entityType)) return [];
      const status = statusOf(row, payload);
      const qualifications = Array.isArray(payload.qualifications)
        ? payload.qualifications.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, 24)
        : [];
      const missionDriver = missionCatalog.drivers.find((driver) => driver.id === row.id);
      const memberMembershipIds = Array.isArray(payload.memberMembershipIds)
        ? payload.memberMembershipIds.filter((item): item is string => typeof item === "string")
          .filter((membershipId) => canSeeRegistry || members.some((member) => member.id === membershipId))
          .slice(0, 100)
        : [];
      const memberNames = memberMembershipIds
        .map((membershipId) => members.find((member) => member.id === membershipId)?.name)
        .filter((name): name is string => Boolean(name))
        .slice(0, 20);
      return [{
        id: row.id,
        code: row.canonicalCode,
        label: row.title,
        entityType,
        status,
        available: missionDriver ? missionDriver.available : isAvailable(status),
        conflict: missionDriver?.conflict ?? null,
        qualifications,
        authorityMembershipId: text(payload.authorityMembershipId || payload.membershipId, "") || null,
        memberMembershipIds,
        memberNames,
        updatedAt: row.updatedAt,
      }];
    });

    const allowedJobIds = new Set(jobs.filter((job) => job.recordType !== "adapter-contract").map((job) => job.id));
    const jobById = new Map(jobs.map((job) => [job.id, job]));
    const visiblePlans = plans.filter((plan) => allowedJobIds.has(plan.jobId));
    const planViews = visiblePlans.map((plan) => {
      const payload = parseJson(plan.payloadJson);
      const startsAt = firstSlotValue(payload, "startsAt");
      const endsAt = firstSlotValue(payload, "endsAt");
      const resourceIds = Array.isArray(payload.resourceIds)
        ? payload.resourceIds.filter((item): item is string => typeof item === "string")
        : Array.isArray(payload.resources)
          ? payload.resources.map((item) => item && typeof item === "object" && !Array.isArray(item) ? text((item as JsonObject).id) : "").filter(Boolean)
          : [];
      return {
        id: plan.id,
        jobId: plan.jobId,
        jobTitle: jobById.get(plan.jobId)?.title ?? "Perimetro operativo",
        jobCode: jobById.get(plan.jobId)?.canonicalCode ?? null,
        title: plan.title,
        status: plan.status,
        activityType: text(payload.activityType, "WORK"),
        startsAt,
        endsAt,
        resourceIds,
        resourceCount: resourceIds.length,
        feasible: payload.evaluation && typeof payload.evaluation === "object" && !Array.isArray(payload.evaluation)
          ? (payload.evaluation as JsonObject).feasible !== false
          : true,
        updatedAt: plan.updatedAt,
      };
    });

    const scopedPlanViews = canSeeRegistry
      ? planViews
      : planViews.filter((plan) => plan.resourceIds.some((resourceId) => resources.some((resource) => resource.id === resourceId)));
    const attendanceJobById = new Map(jobs.map((job) => [job.id, job]));
    const attendanceWarehouseById = new Map(warehouses.map((warehouse) => [warehouse.id, warehouse]));
    const attendanceViews = attendance.filter((row) => attendanceJobById.has(row.jobId) || attendanceWarehouseById.has(row.jobId)).map((row) => {
      const payload = parseJson(row.payloadJson);
      const job = attendanceJobById.get(row.jobId);
      const warehouse = attendanceWarehouseById.get(row.jobId);
      const jobPayload = job ? parseJobPayload(job.payloadJson) : null;
      const transition = payload.lastTransition && typeof payload.lastTransition === "object" && !Array.isArray(payload.lastTransition)
        ? payload.lastTransition as JsonObject
        : {};
      return {
        id: row.id,
        jobId: row.jobId,
        jobTitle: jobPayload?.title || job?.title || warehouse?.name || "Perimetro operativo",
        workerId: text(payload.workerId, "") || null,
        status: row.status,
        recordedAt: text(transition.recordedAt, "") || null,
        geofenceStatus: locationStatus(payload),
        updatedAt: row.updatedAt,
      };
    }).filter((record) => canSeeRegistry || record.workerId === context.actorId);

    const today = startOfToday();
    const plannedToday = scopedPlanViews.filter((plan) => {
      const time = plan.startsAt ? Date.parse(plan.startsAt) : Number.NaN;
      return Number.isFinite(time) && time >= today && time < today + 86_400_000;
    }).length;

    return Response.json({
      context: publicAuthorityContext(context),
      members,
      resources,
      plans: scopedPlanViews,
      attendance: attendanceViews,
      summary: {
        activePeople: members.filter((member) => member.status === "active").length,
        drivers: members.filter((member) => member.roles?.some((role) => role === "driver" || role === "delivery_driver")).length,
        teams: resources.filter((resource) => resource.entityType === "team").length,
        availableDrivers: resources.filter((resource) => resource.entityType === "driver" && resource.available).length,
        availableResources: resources.filter((resource) => resource.available).length,
        plannedToday,
        plans: scopedPlanViews.length,
        inService: attendanceViews.filter((record) => record.status === "CHECKED_IN").length,
        geofenceInside: attendanceViews.filter((record) => record.geofenceStatus === "INSIDE").length,
      },
      registration: {
        owner: "AUTHORITY",
        route: "/onboarding",
        workforceCreation: "BLOCKED",
        driverProvisioning: "ACTIVE_MEMBERSHIP_ACCEPTANCE",
      },
      contract: {
        source: "sites-d1-workforce-overview",
        scope: "tenant",
        selection: "server-readback-only",
        tracking: "ON_DUTY_ONLY",
      },
      readback: { status: "verified", scope: "tenant", checkedAt: new Date().toISOString() },
    }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return Response.json({ error: "workforce_overview_unavailable" }, { status: 503 });
  }
}
