import type { AuthorityContext } from "@/lib/authority-context";

type JsonObject = Record<string, unknown>;

export type ScopeRow = {
  id?: string | null;
  canonicalCode?: string | null;
  title?: string | null;
  module?: string | null;
  recordType?: string | null;
  payloadJson?: string | null;
};

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function parseScopePayload(value: unknown): JsonObject {
  if (isObject(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return isObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function token(value: unknown) {
  return typeof value === "string" ? value.trim().toLocaleUpperCase("it-IT") : "";
}

function addValue(target: Set<string>, value: unknown) {
  if (typeof value === "string") {
    const normalized = token(value);
    if (normalized) target.add(normalized);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) addValue(target, item);
  }
}

/**
 * Only assignment/resource fields participate in operational scope matching.
 * Free-form titles, notes and descriptions are deliberately ignored so a
 * worker cannot become visible on a record merely because their name occurs
 * in a note or a customer description.
 */
const SCOPE_KEYS = new Set([
  "actorId",
  "employeeId",
  "workerId",
  "assignedActorId",
  "assigneeActorId",
  "responsibleActorId",
  "membershipId",
  "assignedMembershipId",
  "authorityMembershipId",
  "driverId",
  "assignedDriverId",
  "vehicleId",
  "assignedVehicleId",
  "teamId",
  "team",
  "responsible",
  "responsibleId",
  "resourceId",
  "resourceIds",
  "assignedResourceIds",
  "memberActorIds",
  "memberMembershipIds",
  "assigneeIds",
]);

function collectScopeValues(value: unknown, output: Set<string>, depth = 0) {
  if (depth > 5 || !isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (SCOPE_KEYS.has(key)) addValue(output, child);
    if (["assignment", "resources", "resourceSnapshot", "driver", "vehicle", "team", "assignee", "route", "stops", "routeReadback"].includes(key)) {
      if (Array.isArray(child)) {
        for (const item of child) collectScopeValues(item, output, depth + 1);
      } else {
        collectScopeValues(child, output, depth + 1);
      }
    }
  }
}

export function contextScopeTokens(context: AuthorityContext, extraTokens: readonly string[] = []) {
  const values = new Set<string>();
  addValue(values, [
    context.actorId,
    context.actorEmail,
    context.actorName,
    context.membershipId,
    `AUTH-DRIVER-${context.actorId}`,
    ...extraTokens,
  ]);
  return values;
}

export function teamScopeTokens(
  rows: readonly ScopeRow[],
  context: AuthorityContext,
) {
  const values: string[] = [];
  for (const row of rows) {
    if (row.module !== "workforce" || row.recordType?.toLocaleLowerCase() !== "team") continue;
    const payload = parseScopePayload(row.payloadJson);
    const members = new Set<string>();
    addValue(members, payload.memberMembershipIds);
    addValue(members, payload.memberActorIds);
    if (!members.has(token(context.membershipId)) && !members.has(token(context.actorId))) continue;
    values.push(row.id ?? "", row.canonicalCode ?? "", row.title ?? "");
  }
  return values.filter(Boolean);
}

export function payloadMatchesContext(
  payload: unknown,
  context: AuthorityContext,
  extraTokens: readonly string[] = [],
) {
  const values = new Set<string>();
  collectScopeValues(parseScopePayload(payload), values);
  if (!values.size) return false;
  const actorTokens = contextScopeTokens(context, extraTokens);
  return [...values].some((value) => actorTokens.has(value));
}

export function rowMatchesContext(
  row: ScopeRow,
  context: AuthorityContext,
  extraTokens: readonly string[] = [],
) {
  return payloadMatchesContext(row.payloadJson, context, extraTokens);
}

/** Full tenant operational readers are explicit roles, not an accidental side
 * effect of having a read capability on one module. */
export function canReadAllOperations(context: AuthorityContext) {
  return context.roles.some((role) => ["owner", "admin", "manager", "office", "technical", "auditor"].includes(role))
    || context.capabilities.includes("workforce.read.all");
}

export function canReadAllMissions(context: AuthorityContext) {
  return context.roles.some((role) => ["owner", "admin", "manager", "office", "warehouse_manager", "auditor"].includes(role))
    || context.capabilities.includes("mission.manage");
}

export function canReadAllLocations(context: AuthorityContext) {
  return context.roles.some((role) => ["owner", "admin", "manager", "office", "technical", "auditor"].includes(role))
    || context.capabilities.includes("location.audit.read");
}

export function visibleEntityKeys(
  rows: readonly ScopeRow[],
  context: AuthorityContext,
  extraTokens: readonly string[] = [],
) {
  const visible = new Set<string>();
  for (const row of rows) {
    if (row.id && rowMatchesContext(row, context, extraTokens)) visible.add(row.id);
    if (row.canonicalCode && rowMatchesContext(row, context, extraTokens)) visible.add(row.canonicalCode);
  }
  return visible;
}
