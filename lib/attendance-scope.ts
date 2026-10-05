import type { AuthorityContext } from "@/lib/authority-context";
import {
  contextScopeTokens,
  parseScopePayload,
  rowMatchesContext,
  teamScopeTokens,
  type ScopeRow,
} from "@/lib/operational-scope";

type WarehouseRow = { id: string; status: string };
type AttendanceScopeRow = ScopeRow & { jobId?: string | null };

export type AttendanceServiceMode = "FIELD" | "DRIVER" | "WAREHOUSE" | "SUPERVISOR";

export type AttendanceTarget = {
  id: string;
  kind: "FIELD" | "DRIVER" | "WAREHOUSE";
  jobId: string | null;
  missionId: string | null;
  warehouseId: string | null;
  code: string | null;
  title: string;
  detail: string;
  location: string | null;
  activityLabel: string | null;
  startsAt: string | null;
  endsAt: string | null;
  stopCount: number;
  status: string;
  assignmentSource: "COMMESSA" | "PIANIFICAZIONE" | "MISSIONE" | "MAGAZZINO";
  geofencePolicy: "SERVER_VALIDATED";
  trackingPolicy: "NO_CONTINUOUS_TRACKING" | "CHECK_IN_STARTS_TRACKING" | "TIMESTAMP_AND_GEOFENCE";
};

export type WarehouseScope = {
  mode: "ALL" | "ASSIGNED" | "NONE";
  warehouseIds: string[];
};

function isActiveStatus(value: unknown) {
  const status = String(value ?? "").toUpperCase();
  return !["INACTIVE", "DISABLED", "REVOKED", "ARCHIVED", "CANCELLED"].includes(status);
}

function values(value: unknown, max = 100) {
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, max);
}

function collectWarehouseIds(value: unknown, output = new Set<string>(), depth = 0) {
  if (depth > 5 || !value || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    for (const item of value) collectWarehouseIds(item, output, depth + 1);
    return output;
  }
  for (const [key, child] of Object.entries(value)) {
    if (["warehouseId", "warehouseIds", "assignedWarehouseId", "assignedWarehouseIds"].includes(key)) {
      for (const id of values(child)) output.add(id);
    }
    if (["assignment", "scope", "warehouse", "perimeter", "resourceSnapshot"].includes(key)) {
      collectWarehouseIds(child, output, depth + 1);
    }
  }
  return output;
}

function isWarehouseAssignment(row: ScopeRow) {
  const type = String(row.recordType ?? "").toLowerCase();
  return type === "warehouse_assignment" || type === "warehouse_assignments" || type === "warehouse-scope";
}

function assignmentRows(rows: readonly ScopeRow[]) {
  return rows.filter((row) => isWarehouseAssignment(row) && isActiveStatus(row.status));
}

export function canReadAllWarehouses(context: AuthorityContext) {
  return context.roles.some((role) => ["owner", "admin", "manager", "office", "auditor"].includes(role))
    || context.capabilities.includes("tenant.manage")
    || context.capabilities.includes("warehouse.manage");
}

export function warehouseScope(
  context: AuthorityContext,
  warehouses: readonly WarehouseRow[],
  workforceRows: readonly ScopeRow[],
): WarehouseScope {
  const activeIds = new Set(warehouses.filter((warehouse) => String(warehouse.status).toLowerCase() === "active").map((warehouse) => warehouse.id));
  if (canReadAllWarehouses(context)) return { mode: "ALL", warehouseIds: [...activeIds] };

  const actorTokens = contextScopeTokens(context);
  const scopedIds = new Set<string>();
  for (const row of assignmentRows(workforceRows)) {
    const payload = parseScopePayload(row.payloadJson);
    if (!rowMatchesContext(row, context) && !["actorId", "membershipId", "assignedActorId", "assignedMembershipId"].some((key) => actorTokens.has(String(payload[key] ?? "").trim().toUpperCase()))) continue;
    for (const id of collectWarehouseIds(payload)) {
      if (activeIds.has(id)) scopedIds.add(id);
    }
  }
  return { mode: scopedIds.size ? "ASSIGNED" : "NONE", warehouseIds: [...scopedIds] };
}

export function warehouseIsInScope(scope: WarehouseScope, warehouseId: string) {
  return scope.mode === "ALL" || scope.warehouseIds.includes(warehouseId);
}

function actorResourceIds(context: AuthorityContext, workforceRows: readonly ScopeRow[]) {
  const ids = new Set<string>();
  for (const row of workforceRows) {
    const payload = parseScopePayload(row.payloadJson);
    if (String(payload.actorId ?? "") === context.actorId || String(payload.membershipId ?? payload.authorityMembershipId ?? "") === context.membershipId) {
      if (row.id) ids.add(row.id);
      if (row.canonicalCode) ids.add(row.canonicalCode);
    }
  }
  return ids;
}

function firstSlotValue(payload: Record<string, unknown>, key: "startsAt" | "endsAt") {
  if (typeof payload[key] === "string" && payload[key]) return payload[key];
  const slots = Array.isArray(payload.slots) ? payload.slots : [];
  const first = slots[0];
  if (!first || typeof first !== "object" || Array.isArray(first)) return null;
  const value = (first as Record<string, unknown>)[key];
  return typeof value === "string" && value ? value : null;
}

function plannedResourceIds(payload: Record<string, unknown>) {
  const ids = new Set<string>();
  const resources = Array.isArray(payload.resources) ? payload.resources : [];
  for (const resource of resources) {
    if (!resource || typeof resource !== "object" || Array.isArray(resource)) continue;
    const item = resource as Record<string, unknown>;
    for (const key of ["id", "resourceId", "actorId", "membershipId"]) {
      for (const id of values(item[key])) ids.add(id);
    }
  }
  for (const key of ["resourceIds", "assignedResourceIds"]) for (const id of values(payload[key])) ids.add(id);
  return ids;
}

function activityLabel(payload: Record<string, unknown>) {
  const activities = Array.isArray(payload.activities) ? payload.activities : [];
  const first = activities[0];
  if (!first || typeof first !== "object" || Array.isArray(first)) return null;
  const value = (first as Record<string, unknown>).title;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function text(payload: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/**
 * Resolves attendance targets from server-side assignments only. The browser
 * receives these targets as readback and cannot turn an arbitrary job or
 * warehouse into a timbratura destination.
 */
export function resolveAttendanceTargets(args: {
  context: AuthorityContext;
  jobs: readonly AttendanceScopeRow[];
  planningRows: readonly AttendanceScopeRow[];
  missionRows: readonly AttendanceScopeRow[];
  warehouses: readonly (WarehouseRow & { code: string; name: string; locationLabel: string })[];
  workforceRows: readonly ScopeRow[];
}): { targets: AttendanceTarget[]; warehouseScope: WarehouseScope; serviceMode: AttendanceServiceMode } {
  const { context, jobs, planningRows, missionRows, warehouses, workforceRows } = args;
  const scopeTokens = teamScopeTokens(workforceRows, context);
  const resourceIds = actorResourceIds(context, workforceRows);
  const assignmentTokens = [...scopeTokens, ...resourceIds];
  const scope = warehouseScope(context, warehouses, workforceRows);
  const targets: AttendanceTarget[] = [];
  const missionByJob = new Map<string, ScopeRow[]>();
  for (const row of missionRows) missionByJob.set(row.jobId ?? "", [...(missionByJob.get(row.jobId ?? "") ?? []), row]);

  for (const job of jobs) {
    if (String(job.recordType ?? "").toLowerCase() === "adapter-contract") continue;
    const payload = parseScopePayload(job.payloadJson);
    const operationAssigned = rowMatchesContext(job, context, assignmentTokens)
      || planningRows.some((plan) => {
        if (plan.jobId !== job.id || !isActiveStatus(plan.status)) return false;
        const planPayload = parseScopePayload(plan.payloadJson);
        const resources = plannedResourceIds(planPayload);
        return [...resources].some((id) => assignmentTokens.map((value) => value.toUpperCase()).includes(id.toUpperCase()))
          || rowMatchesContext(plan, context, assignmentTokens);
      });
    const matchingMissions = (missionByJob.get(job.id) ?? []).filter((mission) => {
      if (!isActiveStatus(mission.status)) return false;
      return rowMatchesContext(mission, context, assignmentTokens);
    });
    const driverMission = matchingMissions[0];

    if (operationAssigned && !driverMission) {
      const firstPlan = planningRows.find((plan) => plan.jobId === job.id && isActiveStatus(plan.status) && (
        rowMatchesContext(plan, context, assignmentTokens)
      ));
      const planPayload = firstPlan ? parseScopePayload(firstPlan.payloadJson) : {};
      const title = text(payload, "title") ?? job.title;
      targets.push({
        id: `field:${job.id}`,
        kind: "FIELD",
        jobId: job.id,
        missionId: null,
        warehouseId: null,
        code: job.canonicalCode ?? null,
        title,
        detail: text(payload, "description", "client") ?? job.detail,
        location: text(payload, "worksite", "location") ?? text(planPayload, "location"),
        activityLabel: activityLabel(payload) ?? text(planPayload, "title"),
        startsAt: firstPlan ? firstSlotValue(planPayload, "startsAt") : null,
        endsAt: firstPlan ? firstSlotValue(planPayload, "endsAt") : null,
        stopCount: 0,
        status: String(payload.statusCode ?? job.status),
        assignmentSource: firstPlan ? "PIANIFICAZIONE" : "COMMESSA",
        geofencePolicy: "SERVER_VALIDATED",
        trackingPolicy: "TIMESTAMP_AND_GEOFENCE",
      });
    }

    if (driverMission) {
      const missionPayload = parseScopePayload(driverMission.payloadJson);
      const route = missionPayload.route && typeof missionPayload.route === "object" && !Array.isArray(missionPayload.route)
        ? missionPayload.route as Record<string, unknown>
        : {};
      const stops = Array.isArray(route.stops) ? route.stops : [];
      const title = text(payload, "title") ?? job.title;
      targets.push({
        id: `driver:${driverMission.id}`,
        kind: "DRIVER",
        jobId: job.id,
        missionId: driverMission.id,
        warehouseId: text(missionPayload, "warehouseId", "originWarehouseId"),
        code: job.canonicalCode ?? null,
        title: text(missionPayload, "title") ?? title,
        detail: `${text(missionPayload, "pickup", "origin") ?? "Partenza da definire"} → ${text(missionPayload, "dropoff", "destination") ?? "Destinazione da definire"}`,
        location: text(missionPayload, "pickup", "origin"),
        activityLabel: text(missionPayload, "transportMode") ?? "Missione di consegna",
        startsAt: text(missionPayload, "plannedAt", "startsAt"),
        endsAt: text(missionPayload, "plannedEndAt", "endsAt"),
        stopCount: stops.length,
        status: driverMission.status,
        assignmentSource: "MISSIONE",
        geofencePolicy: "SERVER_VALIDATED",
        trackingPolicy: "CHECK_IN_STARTS_TRACKING",
      });
    }
  }

  const hasWarehouseRole = context.roles.some((role) => ["warehouse_manager", "warehouse_operator"].includes(role))
    || context.capabilities.includes("warehouse.write")
    || context.capabilities.includes("warehouse.register");
  if (hasWarehouseRole) {
    for (const warehouse of warehouses) {
      if (!warehouseIsInScope(scope, warehouse.id)) continue;
      targets.push({
        id: `warehouse:${warehouse.id}`,
        kind: "WAREHOUSE",
        jobId: null,
        missionId: null,
        warehouseId: warehouse.id,
        code: warehouse.code,
        title: warehouse.name,
        detail: warehouse.locationLabel,
        location: warehouse.locationLabel,
        activityLabel: "Servizio di magazzino",
        startsAt: null,
        endsAt: null,
        stopCount: 0,
        status: "AVAILABLE",
        assignmentSource: "MAGAZZINO",
        geofencePolicy: "SERVER_VALIDATED",
        trackingPolicy: "NO_CONTINUOUS_TRACKING",
      });
    }
  }

  const hasDriver = targets.some((target) => target.kind === "DRIVER");
  const hasWarehouse = targets.some((target) => target.kind === "WAREHOUSE");
  const hasField = targets.some((target) => target.kind === "FIELD");
  const serviceMode: AttendanceServiceMode = hasDriver ? "DRIVER" : hasWarehouse ? "WAREHOUSE" : hasField ? "FIELD" : "SUPERVISOR";
  return { targets, warehouseScope: scope, serviceMode };
}

export function attendanceScopeTokens(context: AuthorityContext, workforceRows: readonly ScopeRow[]) {
  return [...teamScopeTokens(workforceRows, context), ...actorResourceIds(context, workforceRows)];
}
