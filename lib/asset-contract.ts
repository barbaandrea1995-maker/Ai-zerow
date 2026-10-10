/**
 * Canonical asset usage contract shared by registration, assignments and
 * mission resource validation.
 *
 * Asset records are intentionally kept in the existing S04 payload envelope
 * for now. These helpers give that payload one stable vocabulary so modules
 * do not invent their own meanings for "operativo" and "trasporto".
 */

export const ASSET_USAGE_MODES = ["OPERATIONAL", "TRANSPORT", "DUAL_USE"] as const;
export type AssetUsageMode = typeof ASSET_USAGE_MODES[number];

export const TRANSPORT_CAPABILITIES = ["MATERIALS", "ASSETS", "PEOPLE"] as const;
export type TransportCapability = typeof TRANSPORT_CAPABILITIES[number];

export type AssetAssignmentStatus = "ACTIVE" | "SCHEDULED" | "RETURNED" | "CANCELLED";

type JsonObject = Record<string, unknown>;

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function upper(value: unknown) {
  return stringValue(value).toUpperCase();
}

/** A planned end is an expected return time, not proof of a hand-back. Once
 * custody starts, the asset remains assigned until an explicit return event. */
export function assetAssignmentStatus(status: unknown, startsAt: unknown, now = Date.now()): AssetAssignmentStatus {
  const normalized = upper(status);
  if (normalized === "RETURNED" || normalized === "CANCELLED") return normalized;
  const start = typeof startsAt === "string" ? Date.parse(startsAt) : Number.NaN;
  if (normalized === "ACTIVE" || (Number.isFinite(start) && start <= now)) return "ACTIVE";
  return "SCHEDULED";
}

export function assetAssignmentCustodyEnd(
  status: unknown,
  assignmentKind: unknown,
  startsAt: unknown,
  plannedEndAt: unknown,
  now = Date.now(),
) {
  if (upper(assignmentKind) === "LONG_TERM" || assetAssignmentStatus(status, startsAt, now) === "ACTIVE") return null;
  return stringValue(plannedEndAt) || null;
}

function entityTypeOf(payload: JsonObject) {
  return upper(payload.entityType || payload.resourceKind || payload.kind);
}

export function isAssetUsageMode(value: unknown): value is AssetUsageMode {
  return typeof value === "string" && (ASSET_USAGE_MODES as readonly string[]).includes(value.toUpperCase());
}

/**
 * Legacy records did not have a usage profile. Existing vehicles remain
 * usable until an administrator explicitly changes their profile; new
 * registrations always persist an explicit value from the form.
 */
export function normalizeAssetUsageMode(value: unknown, entityType?: unknown): AssetUsageMode {
  const candidate = upper(value);
  if ((ASSET_USAGE_MODES as readonly string[]).includes(candidate)) return candidate as AssetUsageMode;
  return upper(entityType) === "VEHICLE" ? "DUAL_USE" : "OPERATIONAL";
}

export function isTransportCapability(value: unknown): value is TransportCapability {
  return typeof value === "string" && (TRANSPORT_CAPABILITIES as readonly string[]).includes(value.toUpperCase());
}

export function normalizeTransportCapabilities(
  value: unknown,
  usageMode: AssetUsageMode,
  entityType?: unknown,
): TransportCapability[] {
  const values = Array.isArray(value) ? value : [];
  const normalized = Array.from(new Set(values
    .filter(isTransportCapability)
    .map((item) => item.toUpperCase() as TransportCapability)));
  if (normalized.length > 0) return normalized;
  if (usageMode === "OPERATIONAL") return [];

  // Safe compatibility defaults for existing vehicles and the registration
  // form: a transport-enabled carrier can move material and equipment. People
  // transport remains an explicit choice.
  return upper(entityType) === "VEHICLE"
    ? ["MATERIALS", "ASSETS"]
    : ["ASSETS"];
}

export function assetUsageMode(payload: JsonObject): AssetUsageMode {
  const profile = payload.assetProfile && typeof payload.assetProfile === "object" && !Array.isArray(payload.assetProfile)
    ? payload.assetProfile as JsonObject
    : {};
  return normalizeAssetUsageMode(
    payload.usageMode || payload.operationalProfile || profile.usageMode,
    payload.entityType,
  );
}

export function assetTransportCapabilities(payload: JsonObject): TransportCapability[] {
  const profile = payload.assetProfile && typeof payload.assetProfile === "object" && !Array.isArray(payload.assetProfile)
    ? payload.assetProfile as JsonObject
    : {};
  const mode = assetUsageMode(payload);
  return normalizeTransportCapabilities(
    payload.transportCapabilities || profile.transportCapabilities,
    mode,
    payload.entityType,
  );
}

export function vehicleCanTransport(payload: JsonObject) {
  const entityType = entityTypeOf(payload);
  if (entityType !== "VEHICLE") return false;
  return ["TRANSPORT", "DUAL_USE"].includes(assetUsageMode(payload));
}

export function assetUsageLabel(value: unknown) {
  switch (normalizeAssetUsageMode(value)) {
    case "TRANSPORT": return "Trasporto";
    case "DUAL_USE": return "Doppio uso";
    default: return "Operativo";
  }
}
