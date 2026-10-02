import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { s04Records } from "@/db/schema";
import type { PlanningResource, PlanningResourceKind } from "@/lib/planning-contract";

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

function finiteCapacity(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(100, parsed) : 1;
}

function resourceKind(row: typeof s04Records.$inferSelect): PlanningResourceKind | null {
  if (row.module === "workforce") return row.recordType.toLowerCase().includes("team") ? "team" : "person";
  if (row.module === "assets") return row.recordType.toLowerCase().includes("vehicle") ? "vehicle" : "asset";
  return null;
}

function optionForRow(row: typeof s04Records.$inferSelect): PlanningResourceOption | null {
  const kind = resourceKind(row);
  if (!kind) return null;
  const payload = parsePayload(row.payloadJson);
  const status = text(payload.lifecycleStatus, row.status || "AVAILABLE").toUpperCase();
  const assignable = kind === "person" || kind === "team"
    ? status !== "INACTIVE" && status !== "SUSPENDED"
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
  };
}

export async function getPlanningResourceOptions(tenantId: string) {
  const rows = await getDb().select().from(s04Records)
    .where(eq(s04Records.tenantId, tenantId))
    .orderBy(desc(s04Records.updatedAt))
    .limit(500);
  return rows.map(optionForRow).filter((item): item is PlanningResourceOption => Boolean(item));
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
