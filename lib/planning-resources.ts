import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { jobJourneyRecords, s04Records, tenantMemberships } from "@/db/schema";
import type { PlanningResource, PlanningResourceKind } from "@/lib/planning-contract";

export type PlanningAvailabilityWindow = {
  startsAt: string;
  endsAt: string;
};

export type PlanningResourceConflict = PlanningAvailabilityWindow & {
  recordId: string;
  title: string;
  status: string;
};

export type PlanningResourceOption = {
  id: string;
  code: string | null;
  label: string;
  kind: PlanningResourceKind;
  status: string;
  assignable: boolean;
  capacity: number;
  qualifications: string[];
  updatedAt: string;
  availableForWindow: boolean;
  availabilityConflict?: PlanningResourceConflict;
};

export class PlanningResourceError extends Error {
  code: "planning_resource_ids_required" | "planning_resource_not_found" | "planning_resource_unavailable";

  constructor(code: PlanningResourceError["code"], detail?: string) {
    super(detail ?? code);
    this.name = "PlanningResourceError";
    this.code = code;
  }
}

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

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    : [];
}

function finiteCapacity(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(100, parsed) : 1;
}

function resourceKind(row: typeof s04Records.$inferSelect): PlanningResourceKind | null {
  if (row.module === "workforce") return row.recordType.toLowerCase().includes("team") ? "team" : "person";
  if (row.module === "assets") return row.recordType.toLowerCase().includes("vehicle") ? "vehicle" : "asset";
  return null;
}

function optionForRow(
  row: typeof s04Records.$inferSelect,
  conflict?: PlanningResourceConflict,
  activeMembershipIds?: Set<string>,
): PlanningResourceOption | null {
  const kind = resourceKind(row);
  if (!kind) return null;
  const payload = parsePayload(row.payloadJson);
  const status = text(payload.lifecycleStatus, row.status || "AVAILABLE").toUpperCase();
  const assignable = kind === "person"
    ? status !== "INACTIVE" && status !== "SUSPENDED"
    : kind === "team"
      ? status !== "INACTIVE" && status !== "SUSPENDED" && stringList(payload.memberMembershipIds).some((id) => activeMembershipIds?.has(id))
    : ["AVAILABLE", "ACTIVE", "OPERATIVO", "ONLINE", "IN PRESIDIO"].includes(status);
  const qualifications = Array.isArray(payload.qualifications)
    ? payload.qualifications.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, 32)
    : [];
  return {
    id: row.id,
    code: row.canonicalCode,
    label: row.title,
    kind,
    status,
    assignable,
    capacity: finiteCapacity(payload.capacity),
    qualifications,
    updatedAt: row.updatedAt,
    availableForWindow: assignable && !conflict,
    ...(conflict ? { availabilityConflict: conflict } : {}),
  };
}

function intervalFromPayload(payload: Record<string, unknown>) {
  const startsAt = text(payload.startsAt);
  const endsAt = text(payload.endsAt);
  if (startsAt && endsAt) return { startsAt, endsAt };
  const slots = Array.isArray(payload.slots) ? payload.slots : [];
  const first = slots.find((item) => item && typeof item === "object" && !Array.isArray(item)) as Record<string, unknown> | undefined;
  return {
    startsAt: text(first?.startsAt),
    endsAt: text(first?.endsAt),
  };
}

function resourceIdsFromPayload(payload: Record<string, unknown>) {
  const fromTopLevel = Array.isArray(payload.resourceIds) ? payload.resourceIds : [];
  const fromResources = Array.isArray(payload.resources)
    ? payload.resources.map((item) => item && typeof item === "object" && !Array.isArray(item) ? (item as Record<string, unknown>).id : null)
    : [];
  return [...new Set([...fromTopLevel, ...fromResources]
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean))];
}

function overlaps(left: PlanningAvailabilityWindow, right: PlanningAvailabilityWindow) {
  const leftStart = Date.parse(left.startsAt);
  const leftEnd = Date.parse(left.endsAt);
  const rightStart = Date.parse(right.startsAt);
  const rightEnd = Date.parse(right.endsAt);
  return Number.isFinite(leftStart) && Number.isFinite(leftEnd)
    && Number.isFinite(rightStart) && Number.isFinite(rightEnd)
    && leftStart < rightEnd && rightStart < leftEnd;
}

async function activePlanningAssignments(tenantId: string, excludedId?: string) {
  const rows = await getDb().select().from(jobJourneyRecords).where(and(
    eq(jobJourneyRecords.tenantId, tenantId),
    eq(jobJourneyRecords.domain, "planning"),
    inArray(jobJourneyRecords.status, ["DRAFT", "PUBLISHED"]),
  )).orderBy(desc(jobJourneyRecords.updatedAt)).limit(500);

  return rows
    .filter((row) => row.id !== excludedId)
    .flatMap((row) => {
      const payload = parsePayload(row.payloadJson);
      const interval = intervalFromPayload(payload);
      if (!interval.startsAt || !interval.endsAt) return [];
      return resourceIdsFromPayload(payload).map((resourceId) => ({
        resourceId,
        recordId: row.id,
        title: row.title,
        status: row.status,
        ...interval,
      }));
    });
}

export async function getPlanningResourceOptions(
  tenantId: string,
  window?: PlanningAvailabilityWindow,
  excludedPlanId?: string,
) {
  const [rows, assignments, activeMembershipRows] = await Promise.all([
    getDb().select().from(s04Records)
    .where(eq(s04Records.tenantId, tenantId))
    .orderBy(desc(s04Records.updatedAt))
    .limit(500),
    window ? activePlanningAssignments(tenantId, excludedPlanId) : Promise.resolve([]),
    getDb().select({ id: tenantMemberships.id }).from(tenantMemberships).where(and(
      eq(tenantMemberships.tenantId, tenantId),
      eq(tenantMemberships.status, "active"),
    )),
  ]);
  const activeMembershipIds = new Set(activeMembershipRows.map((membership) => membership.id));
  const conflictsByResource = new Map<string, PlanningResourceConflict>();
  if (window) {
    for (const assignment of assignments) {
      if (!conflictsByResource.has(assignment.resourceId) && overlaps(window, assignment)) {
        conflictsByResource.set(assignment.resourceId, {
          startsAt: assignment.startsAt,
          endsAt: assignment.endsAt,
          recordId: assignment.recordId,
          title: assignment.title,
          status: assignment.status,
        });
      }
    }
  }
  return rows.map((row) => optionForRow(row, conflictsByResource.get(row.id), activeMembershipIds))
    .filter((item): item is PlanningResourceOption => Boolean(item));
}

export function planningResourceForOption(option: PlanningResourceOption): PlanningResource {
  return {
    id: option.id,
    kind: option.kind,
    label: option.code && option.code !== option.label ? `${option.code} · ${option.label}` : option.label,
    capacity: option.capacity,
    qualifications: option.qualifications,
    unavailable: [],
  };
}

export async function resolvePlanningResources(tenantId: string, value: unknown) {
  const resourceIds = Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))].slice(0, 64)
    : [];
  if (!resourceIds.length) throw new PlanningResourceError("planning_resource_ids_required");

  const options = await getPlanningResourceOptions(tenantId);
  const byId = new Map(options.map((option) => [option.id, option]));
  const resolved: PlanningResource[] = [];
  for (const resourceId of resourceIds) {
    const option = byId.get(resourceId);
    if (!option) throw new PlanningResourceError("planning_resource_not_found", resourceId);
    if (!option.assignable) throw new PlanningResourceError("planning_resource_unavailable", option.label);
    resolved.push(planningResourceForOption(option));
  }
  return resolved;
}
