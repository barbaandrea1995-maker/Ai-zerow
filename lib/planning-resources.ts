import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { jobJourneyRecords, s04Records, tenantMemberships } from "@/db/schema";
import { normalizeAuthorityRoles } from "@/lib/authority-catalog";
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

export type PlanningAttachedAsset = {
  id: string;
  code: string | null;
  label: string;
  kind: "asset" | "vehicle";
  status: string;
  assignmentId: string;
  startsAt: string;
  endsAt: string | null;
};

type PlanningAssetCustody = PlanningAttachedAsset & {
  assigneeMembershipId: string;
  assigneeActorId: string;
  assigneeName: string;
  assignmentKind: string;
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
  attachedAssets: PlanningAttachedAsset[];
  assignmentCustody?: PlanningAssetCustody;
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
  const recordType = row.recordType.toLowerCase();
  if (row.module === "workforce") {
    if (recordType.includes("warehouse") && (recordType.includes("assignment") || recordType.includes("scope"))) return null;
    return recordType.includes("team") ? "team" : "person";
  }
  if (row.module === "assets") return row.recordType.toLowerCase().includes("vehicle") ? "vehicle" : "asset";
  return null;
}

function assetDisplayLabel(row: typeof s04Records.$inferSelect, payload: Record<string, unknown>) {
  const base = text(payload.description || payload.title, row.title || row.canonicalCode || "Asset");
  const identifiers = [payload.brand, payload.model, payload.registration, payload.serialNumber]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim())
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 4);
  return identifiers.length ? `${base} · ${identifiers.join(" · ")}` : base;
}

function identityValues(row: typeof s04Records.$inferSelect, payload: Record<string, unknown>) {
  return [row.id, text(payload.authorityMembershipId || payload.membershipId), text(payload.actorId)].filter(Boolean);
}

function custodyAppliesToWindow(custody: PlanningAssetCustody, window?: PlanningAvailabilityWindow) {
  const startsAt = Date.parse(custody.startsAt);
  const endsAt = custody.endsAt ? Date.parse(custody.endsAt) : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(startsAt)) return false;
  if (!window) {
    const now = Date.now();
    return startsAt <= now && now < endsAt;
  }
  const windowStart = Date.parse(window.startsAt);
  const windowEnd = Date.parse(window.endsAt);
  return Number.isFinite(windowStart) && Number.isFinite(windowEnd) && windowStart < endsAt && startsAt < windowEnd;
}

function planningRoleEligible(roles: string[]) {
  const warehouseOnly = roles.length > 0 && roles.every((role) => role === "warehouse_manager" || role === "warehouse_operator");
  return !warehouseOnly;
}

function optionForRow(
  row: typeof s04Records.$inferSelect,
  conflict?: PlanningResourceConflict,
  activeMembershipIds?: Set<string>,
  planningMembershipIds?: Set<string>,
  attachedAssets: PlanningAttachedAsset[] = [],
  assignmentCustody?: PlanningAssetCustody,
): PlanningResourceOption | null {
  const kind = resourceKind(row);
  if (!kind) return null;
  const payload = parsePayload(row.payloadJson);
  const status = text(payload.lifecycleStatus, row.status || "AVAILABLE").toUpperCase();
  const membershipId = text(payload.authorityMembershipId || payload.membershipId);
  const assignable = kind === "person"
    ? status !== "INACTIVE" && status !== "SUSPENDED" && (!planningMembershipIds || !membershipId || planningMembershipIds.has(membershipId))
    : kind === "team"
      ? status !== "INACTIVE" && status !== "SUSPENDED" && stringList(payload.memberMembershipIds).some((id) => activeMembershipIds?.has(id) && planningMembershipIds?.has(id))
      : ["AVAILABLE", "ACTIVE", "OPERATIVO", "ONLINE", "IN PRESIDIO"].includes(status);
  const blockedByCustody = Boolean(assignmentCustody);
  const effectiveAssignable = assignable && !blockedByCustody;
  const qualifications = Array.isArray(payload.qualifications)
    ? payload.qualifications.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, 32)
    : [];
  return {
    id: row.id,
    code: row.canonicalCode,
    label: kind === "asset" || kind === "vehicle" ? assetDisplayLabel(row, payload) : row.title,
    kind,
    status,
    assignable: effectiveAssignable,
    capacity: finiteCapacity(payload.capacity),
    qualifications,
    updatedAt: row.updatedAt,
    availableForWindow: effectiveAssignable && !conflict,
    attachedAssets,
    ...(assignmentCustody ? { assignmentCustody } : {}),
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

async function activeAssetCustody(tenantId: string) {
  const rows = await getDb().select().from(jobJourneyRecords).where(and(
    eq(jobJourneyRecords.tenantId, tenantId),
    eq(jobJourneyRecords.domain, "assets"),
    eq(jobJourneyRecords.recordType, "ASSET_ASSIGNMENT"),
    inArray(jobJourneyRecords.status, ["ACTIVE", "SCHEDULED"]),
  )).orderBy(desc(jobJourneyRecords.updatedAt)).limit(1_000);
  return rows.flatMap((row) => {
    const payload = parsePayload(row.payloadJson);
    const assetId = text(payload.assetId, row.jobId);
    const startsAt = text(payload.startsAt);
    const endsAt = text(payload.endsAt) || null;
    const assignmentKind = text(payload.assignmentKind).toUpperCase() || (endsAt ? "SHORT_TERM" : "LONG_TERM");
    if (!assetId || !startsAt || !Number.isFinite(Date.parse(startsAt))) return [];
    return [{
      id: assetId,
      code: text(payload.assetCode) || null,
      label: text(payload.assetTitle, row.title),
      kind: text(payload.entityType).toUpperCase() === "VEHICLE" ? "vehicle" as const : "asset" as const,
      status: "ASSIGNED",
      assignmentId: row.id,
      startsAt: new Date(Date.parse(startsAt)).toISOString(),
      endsAt: endsAt && Number.isFinite(Date.parse(endsAt)) ? new Date(Date.parse(endsAt)).toISOString() : null,
      assigneeMembershipId: text(payload.assigneeMembershipId),
      assigneeActorId: text(payload.assigneeActorId),
      assigneeName: text(payload.assigneeName, "Persona assegnata"),
      assignmentKind,
    } satisfies PlanningAssetCustody];
  });
}

export async function getPlanningResourceOptions(
  tenantId: string,
  window?: PlanningAvailabilityWindow,
  excludedPlanId?: string,
) {
  const [rows, assignments, activeMembershipRows, custodyRows] = await Promise.all([
    getDb().select().from(s04Records)
    .where(eq(s04Records.tenantId, tenantId))
    .orderBy(desc(s04Records.updatedAt))
    .limit(500),
    window ? activePlanningAssignments(tenantId, excludedPlanId) : Promise.resolve([]),
    getDb().select({ id: tenantMemberships.id, role: tenantMemberships.role, rolesJson: tenantMemberships.rolesJson }).from(tenantMemberships).where(and(
      eq(tenantMemberships.tenantId, tenantId),
      eq(tenantMemberships.status, "active"),
    )),
    activeAssetCustody(tenantId),
  ]);
  const activeMembershipIds = new Set(activeMembershipRows.map((membership) => membership.id));
  const planningMembershipIds = new Set(activeMembershipRows.filter((membership) => {
    const roles = normalizeAuthorityRoles(membership.rolesJson, membership.role);
    return planningRoleEligible(roles);
  }).map((membership) => membership.id));
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
  const assetRows = new Map(rows.filter((row) => row.module === "assets").map((row) => [row.id, row]));
  const custodyByAsset = new Map<string, PlanningAssetCustody>();
  const attachedByPerson = new Map<string, PlanningAttachedAsset[]>();
  for (const custody of custodyRows) {
    if (!custodyAppliesToWindow(custody, window)) continue;
    if (!custodyByAsset.has(custody.id)) custodyByAsset.set(custody.id, custody);
    if (custody.assignmentKind !== "LONG_TERM") continue;
    const assetRow = assetRows.get(custody.id);
    const assetPayload = assetRow ? parsePayload(assetRow.payloadJson) : {};
    const attachedAsset: PlanningAttachedAsset = {
      id: custody.id,
      code: assetRow?.canonicalCode ?? custody.code,
      label: assetRow ? assetDisplayLabel(assetRow, assetPayload) : custody.label,
      kind: assetRow?.recordType.toLowerCase().includes("vehicle") || custody.kind === "vehicle" ? "vehicle" : "asset",
      status: text(assetPayload.lifecycleStatus, assetRow?.status || custody.status).toUpperCase(),
      assignmentId: custody.assignmentId,
      startsAt: custody.startsAt,
      endsAt: custody.endsAt,
    };
    for (const identity of [custody.assigneeMembershipId, custody.assigneeActorId].filter(Boolean)) {
      const current = attachedByPerson.get(identity) ?? [];
      if (!current.some((item) => item.id === attachedAsset.id)) current.push(attachedAsset);
      attachedByPerson.set(identity, current);
    }
  }
  return rows.map((row) => {
    const payload = parsePayload(row.payloadJson);
    const kind = resourceKind(row);
    const attachedAssets = kind === "person"
      ? [...new Map(identityValues(row, payload).flatMap((identity) => (attachedByPerson.get(identity) ?? []).map((asset) => [asset.id, asset] as const))).values()]
      : [];
    return optionForRow(row, conflictsByResource.get(row.id), activeMembershipIds, planningMembershipIds, attachedAssets, custodyByAsset.get(row.id));
  })
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

export async function resolvePlanningResources(tenantId: string, value: unknown, window?: PlanningAvailabilityWindow) {
  const resourceIds = Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))].slice(0, 64)
    : [];
  if (!resourceIds.length) throw new PlanningResourceError("planning_resource_ids_required");

  const options = await getPlanningResourceOptions(tenantId, window);
  const byId = new Map(options.map((option) => [option.id, option]));
  const resolved: PlanningResource[] = [];
  const resolvedIds = new Set<string>();
  for (const resourceId of resourceIds) {
    const option = byId.get(resourceId);
    if (!option) throw new PlanningResourceError("planning_resource_not_found", resourceId);
    if (!option.assignable) throw new PlanningResourceError("planning_resource_unavailable", option.label);
    if (!resolvedIds.has(option.id)) {
      resolved.push(planningResourceForOption(option));
      resolvedIds.add(option.id);
    }
    for (const attachedAsset of option.attachedAssets) {
      if (resolvedIds.has(attachedAsset.id)) continue;
      const attachedOption = byId.get(attachedAsset.id);
      if (!attachedOption || attachedOption.availabilityConflict || !["AVAILABLE", "ACTIVE", "OPERATIVO", "ONLINE", "IN PRESIDIO"].includes(attachedOption.status)) {
        throw new PlanningResourceError("planning_resource_unavailable", attachedAsset.label);
      }
      resolved.push(planningResourceForOption(attachedOption));
      resolvedIds.add(attachedAsset.id);
    }
  }
  return resolved;
}
