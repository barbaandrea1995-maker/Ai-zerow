import { and, desc, eq, exists, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  geofences,
  geoLocations,
  inventoryItems,
  inventoryMovements,
  jobJourneyRecords,
  operationalDocuments,
  routePlans,
  routeStops,
  s04Records,
  s06Events,
  s06Outbox,
  s06Reconciliations,
  tenantWarehouses,
  tenantMemberships,
} from "@/db/schema";
import { getAuthorityContext, hasCapability, publicAuthorityContext, type AuthorityContext } from "@/lib/authority-context";
import { normalizeAuthorityRoles } from "@/lib/authority-catalog";
import { documentCanDownload } from "@/lib/document-security";
import { INVENTORY_UNIT_CATALOG, inventoryMovementForResponse, inventoryUnitForCode, milliToQuantity, quantityToMilli } from "@/lib/inventory-contract";
import { OPERATIONAL_DOCUMENT_CATEGORIES } from "@/lib/document-contract";
import { assertMissionResourceSelection, MissionResourceError } from "@/lib/mission-resources";
import { parseJobPayload } from "@/lib/operations-contract";
import { buildMissionReportReadback } from "@/lib/mission-contract";
import { buildMissionWarehouseReadback, missionMaterialLines, type MissionWarehouseReadback } from "@/lib/mission-inventory-contract";
import { buildMissionRouteProjection, MissionRouteError, routeSummaryForPayload, type MissionStopInput } from "@/lib/location-intelligence/route-planner";
import { normalizeMissionException, storedMissionException, type MissionExceptionType } from "@/lib/mission-exception-contract";
import { missionPodEvidenceComplete, normalizeMissionPodEvidence, storedMissionPodEvidence } from "@/lib/mission-pod-contract";
import { isTransportMode, type TransportMode } from "@/lib/tenant-operating-model";
import { tenantWarehouseAccess, warehouseIdIsAllowed } from "@/lib/warehouse-access";
import { canReadAllMissions, canReadAllOperations, rowMatchesContext, teamScopeTokens } from "@/lib/operational-scope";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ jobId: string }> };
type JsonObject = Record<string, unknown>;
type JourneyDomain = "planning" | "field" | "warehouse" | "mission";
type JourneyBatchItem = {
  _prepare(): {
    getQuery(): { sql: string; params: unknown[] };
    mapResult(result: unknown, isFromBatch?: boolean): unknown;
  };
};
const FIELD_ACTIVITY_ROLES = new Set(["owner", "admin", "manager", "technical", "field_supervisor", "worker", "driver", "maintenance"]);
const FIELD_SUPERVISOR_ROLES = new Set(["owner", "admin", "manager", "technical", "field_supervisor"]);

/**
 * Drizzle's D1 batch adapter assumes every item with bound parameters exposes
 * an internal `.stmt`. `db.run(sql\`...\`)` is a SQLiteRaw item and has no such
 * property, so a mixed batch throws before D1 receives any statement. Prepare
 * every item through the native D1 binding instead, then preserve Drizzle's
 * result mapping. D1 still executes the batch atomically and in order.
 */
async function runJourneyBatch(db: ReturnType<typeof getDb>, items: readonly unknown[]) {
  const prepared = items.map((item) => (item as JourneyBatchItem)._prepare());
  const statements = prepared.map((query) => {
    const built = query.getQuery();
    return db.$client.prepare(built.sql).bind(...built.params);
  });
  const results = await db.$client.batch(statements);
  return results.map((result, index) => prepared[index].mapResult(result, true));
}

const DOMAIN_READ_CAPABILITY: Record<JourneyDomain | "documents", string> = {
  planning: "planning.read",
  field: "field.read",
  warehouse: "warehouse.read",
  mission: "mission.read",
  documents: "documents.read",
};

const ACTION_CAPABILITY = {
  planning_create: "planning.write",
  planning_publish: "planning.write",
  field_open: "field.write",
  field_close: "field.write",
  material_request: "warehouse.request",
  material_review: "warehouse.review",
  mission_create: "mission.manage",
  mission_dispatch: "mission.execute",
  mission_load: "mission.delivery.execute",
  mission_unload: "mission.delivery.execute",
  mission_deliver: "mission.execute",
  mission_exception: "mission.delivery.execute",
  mission_resume: "mission.manage",
  mission_verify_pod: "mission.manage",
  mission_reconcile: "mission.manage",
  mission_report_save: "mission.report.write",
  mission_report_submit: "mission.report.write",
  mission_report_review: "mission.report.review",
  mission_close: "mission.manage",
} as const;

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function boundedText(value: unknown, max: number, fallback = "") {
  return typeof value === "string" ? value.trim().slice(0, max) : fallback;
}

function validDateTime(value: string) {
  return value.length >= 10 && Number.isFinite(Date.parse(value));
}

function routeStopKind(row: typeof routeStops.$inferSelect) {
  const metadata = parseJson(row.evidenceJson);
  return boundedText(metadata.kind, 32).toUpperCase();
}

function routeStopCompleted(row: typeof routeStops.$inferSelect) {
  return row.status === "COMPLETED" || row.deliveryStatus === "CONFIRMED";
}

function routeStopPhysicallyClosed(row: typeof routeStops.$inferSelect) {
  return row.status === "DEPARTED" || Boolean(row.departedAt);
}

function currentRouteStop(rows: Array<typeof routeStops.$inferSelect>) {
  return rows.find((row) => !routeStopPhysicallyClosed(row)) ?? null;
}

function routeStopCargoActions(row: typeof routeStops.$inferSelect) {
  const metadata = parseJson(row.evidenceJson);
  return Array.isArray(metadata.cargoActions)
    ? metadata.cargoActions.flatMap((entry) => {
        if (typeof entry === "string") return [entry.trim().toUpperCase()];
        if (!isRecord(entry)) return [];
        const action = boundedText(entry.action ?? entry.type, 24).toUpperCase();
        return action ? [action] : [];
      })
    : [];
}

function routeStopCargoAssetIds(row: typeof routeStops.$inferSelect) {
  const metadata = parseJson(row.evidenceJson);
  return Array.from(new Set(Array.isArray(metadata.cargoActions)
    ? metadata.cargoActions.flatMap((entry) => {
        if (!isRecord(entry)) return [];
        const assetId = boundedText(entry.assetId, 160);
        return assetId ? [assetId] : [];
      })
    : []));
}

function requestedCargoAssetIds(input: JsonObject, payload: JsonObject = {}) {
  const ids = Array.isArray(input.assetIds)
    ? input.assetIds.flatMap((value) => {
        const id = boundedText(value, 160);
        return id ? [id] : [];
      })
    : [];
  const inputSingle = boundedText(input.assetId, 160);
  if (ids.length || inputSingle) return [...new Set([...ids, ...(inputSingle ? [inputSingle] : [])])];
  const payloadIds = Array.isArray(payload.cargoAssetIds)
    ? payload.cargoAssetIds.flatMap((value) => {
        const id = boundedText(value, 160);
        return id ? [id] : [];
      })
    : [];
  const payloadSingle = boundedText(payload.cargoAssetId, 160);
  return [...new Set([...payloadIds, ...(payloadSingle ? [payloadSingle] : [])])];
}

function routeStopHasExplicitCargoActions(row: typeof routeStops.$inferSelect) {
  return Array.isArray(parseJson(row.evidenceJson).cargoActions);
}

function routeStopSupportsAction(row: typeof routeStops.$inferSelect, action: "mission_load" | "mission_unload") {
  const actions = routeStopCargoActions(row);
  if (actions.length) {
    return action === "mission_load"
      ? actions.some((item) => ["LOAD", "TRANSFER"].includes(item))
      : actions.some((item) => ["UNLOAD", "RETURN", "TRANSFER"].includes(item));
  }
  const kind = routeStopKind(row);
  return action === "mission_load"
    ? ["PICKUP", "TRANSFER"].includes(kind)
    : ["DELIVERY", "TRANSFER", "RETURN"].includes(kind);
}

function routeStopArrivalConfirmed(row: typeof routeStops.$inferSelect) {
  return ["ARRIVED", "IN_PROGRESS", "LOADED", "UNLOADED"].includes(row.status);
}

function deliveryProofEntries(payload: JsonObject) {
  const entries = Array.isArray(payload.proofOfDeliveries)
    ? payload.proofOfDeliveries.filter((entry): entry is JsonObject => isRecord(entry))
    : [];
  if (entries.length) return entries;
  const legacy = isRecord(payload.proofOfDelivery) ? payload.proofOfDelivery : null;
  return legacy ? [legacy] : [];
}

function upsertDeliveryProof(payload: JsonObject, entry: JsonObject) {
  const entries = deliveryProofEntries(payload);
  const stopId = boundedText(entry.stopId, 160);
  const next = stopId
    ? [...entries.filter((candidate) => boundedText(candidate.stopId, 160) !== stopId), entry]
    : [...entries, entry];
  return next.slice(-100);
}

async function verifiedMissionPodDocument(tenantId: string, jobId: string, documentId: string) {
  const normalizedId = boundedText(documentId, 160);
  if (!normalizedId) return { error: "pod_document_required" as const };
  const [document] = await getDb().select().from(operationalDocuments).where(and(
    eq(operationalDocuments.tenantId, tenantId),
    eq(operationalDocuments.jobId, jobId),
    eq(operationalDocuments.id, normalizedId),
  )).limit(1);
  if (!document) return { error: "pod_document_not_found" as const };
  if (!documentCanDownload(document.scanStatus, document.status)) return { error: "pod_document_not_verified" as const };
  return { document };
}

function parseJson(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function operationalAssigneeForCargo(payload: JsonObject, assetId: string) {
  const snapshot = isRecord(payload.resourceSnapshot) ? payload.resourceSnapshot : {};
  const entries = Array.isArray(snapshot.cargoAssets) ? snapshot.cargoAssets : [];
  const cargoSnapshot = entries.find((entry) => isRecord(entry) && boundedText(entry.id, 160) === assetId);
  if (isRecord(cargoSnapshot) && isRecord(cargoSnapshot.operationalAssignee)) return cargoSnapshot.operationalAssignee;
  return null;
}

function updateCargoCustody(
  payload: JsonObject,
  assetIds: string[],
  state: "IN_TRANSIT" | "AWAITING_RECEIPT" | "DELIVERED",
  details: JsonObject,
) {
  const current = isRecord(payload.cargoCustody) ? payload.cargoCustody : {};
  return assetIds.reduce<JsonObject>((next, assetId) => ({
    ...next,
    [assetId]: {
      ...(isRecord(current[assetId]) ? current[assetId] : {}),
      state,
      operationalAssignee: operationalAssigneeForCargo(payload, assetId),
      assetId,
      ...details,
    },
  }), { ...current });
}

async function fieldWorkforceOptions(context: AuthorityContext) {
  const canReadRegistry = hasCapability(context, "workforce.registry.read")
    || hasCapability(context, "workforce.read.all")
    || hasCapability(context, "workforce.manage");
  if (!canReadRegistry) return { people: [], supervisors: [], teams: [] };
  const [memberships, workforceRows] = await Promise.all([
    getDb().select({ id: tenantMemberships.id, actorId: tenantMemberships.actorId, displayName: tenantMemberships.displayName, role: tenantMemberships.role, rolesJson: tenantMemberships.rolesJson })
      .from(tenantMemberships).where(and(eq(tenantMemberships.tenantId, context.tenantId), eq(tenantMemberships.status, "active"))),
    getDb().select().from(s04Records).where(and(eq(s04Records.tenantId, context.tenantId), eq(s04Records.module, "workforce"))).limit(500),
  ]);
  const rolesByMembershipId = new Map(memberships.map((membership) => [
    membership.id,
    normalizeAuthorityRoles(membership.rolesJson, membership.role),
  ]));
  const people = memberships.flatMap((membership) => {
    const roles = normalizeAuthorityRoles(membership.rolesJson, membership.role);
    return roles.some((role) => FIELD_ACTIVITY_ROLES.has(role)) ? [{ id: membership.id, label: membership.displayName }] : [];
  });
  const supervisors = memberships.flatMap((membership) => {
    const roles = normalizeAuthorityRoles(membership.rolesJson, membership.role);
    return roles.some((role) => FIELD_SUPERVISOR_ROLES.has(role)) ? [{ id: membership.id, label: membership.displayName }] : [];
  });
  const teams = workforceRows.flatMap((row) => {
    const data = parseJson(row.payloadJson);
    const kind = boundedText(data.entityType ?? data.resourceKind ?? data.kind, 40, row.recordType).toLowerCase();
    const status = boundedText(data.statusCode ?? data.status, 32, row.status).toUpperCase();
    const memberIds = stringIds(data.memberMembershipIds).filter((id) => (rolesByMembershipId.get(id) ?? [])
      .some((role) => FIELD_ACTIVITY_ROLES.has(role)));
    return kind === "team" && memberIds.length && !["INACTIVE", "SUSPENDED", "ARCHIVED", "CANCELLED"].includes(status)
      ? [{ id: row.id, label: row.title }]
      : [];
  });
  return { people, supervisors, teams };
}

async function materialCatalogOptions(context: AuthorityContext) {
  if (!hasCapability(context, "warehouse.request")) return [];
  const rows = await getDb().select({
    id: inventoryItems.id,
    sku: inventoryItems.sku,
    name: inventoryItems.name,
    unit: inventoryItems.unit,
    status: inventoryItems.status,
  }).from(inventoryItems).where(eq(inventoryItems.tenantId, context.tenantId))
    .orderBy(inventoryItems.name).limit(2_000);
  const catalog = new Map<string, { id: string; sku: string; name: string; unit: string; unitLabel: string }>();
  for (const item of rows) {
    if (["ARCHIVED", "INACTIVE", "DISABLED", "CANCELLED"].includes(item.status.toUpperCase())) continue;
    const unit = inventoryUnitForCode(item.unit);
    const name = item.name.trim();
    if (!unit || !name) continue;
    const sku = item.sku.trim();
    const key = sku
      ? `sku:${sku.toLocaleUpperCase("it-IT")}::${name.toLocaleLowerCase("it-IT")}::${unit.code}`
      : `name:${name.toLocaleLowerCase("it-IT")}::${unit.code}`;
    if (!catalog.has(key)) catalog.set(key, {
      id: item.id,
      sku,
      name,
      unit: unit.code,
      unitLabel: unit.label,
    });
  }
  return [...catalog.values()];
}

function stringIds(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))]
    : [];
}

function planningResourceIds(payload: JsonObject) {
  const ids = stringIds(payload.resourceIds);
  const resources = Array.isArray(payload.resources) ? payload.resources : [];
  for (const resource of resources) {
    if (isRecord(resource)) ids.push(...stringIds([resource.id]));
  }
  const slots = Array.isArray(payload.slots) ? payload.slots : [];
  for (const slot of slots) {
    if (isRecord(slot)) ids.push(...stringIds(slot.resourceIds));
  }
  return new Set(ids);
}

function planningWindow(payload: JsonObject) {
  const startsAt = boundedText(payload.startsAt, 40);
  const endsAt = boundedText(payload.endsAt, 40);
  if (validDateTime(startsAt) && validDateTime(endsAt) && Date.parse(endsAt) > Date.parse(startsAt)) return { startsAt, endsAt };
  const firstSlot = Array.isArray(payload.slots) ? payload.slots.find((slot) => isRecord(slot)) : null;
  if (!isRecord(firstSlot)) return null;
  const slotStartsAt = boundedText(firstSlot.startsAt, 40);
  const slotEndsAt = boundedText(firstSlot.endsAt, 40);
  return validDateTime(slotStartsAt) && validDateTime(slotEndsAt) && Date.parse(slotEndsAt) > Date.parse(slotStartsAt)
    ? { startsAt: slotStartsAt, endsAt: slotEndsAt }
    : null;
}

async function readBoundedJson(request: Request, maxBytes = 65_536) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) return { error: "payload_too_large" as const };
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) return { error: "payload_too_large" as const };
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? { value: parsed } : { error: "invalid_json" as const };
  } catch {
    return { error: "invalid_json" as const };
  }
}

async function requestedJobId(routeContext: RouteContext) {
  try {
    const value = decodeURIComponent((await routeContext.params).jobId).trim();
    return value && value.length <= 160 ? value : null;
  } catch {
    return null;
  }
}

async function findJob(tenantId: string, reference: string) {
  const db = getDb();
  const base = and(eq(s04Records.tenantId, tenantId), inArray(s04Records.module, ["operations", "mission"]));
  const [byId] = await db.select().from(s04Records)
    .where(and(base, eq(s04Records.id, reference))).limit(1);
  if (byId) return byId;
  const [byCode] = await db.select().from(s04Records)
    .where(and(base, eq(s04Records.canonicalCode, reference))).limit(1);
  return byCode ?? null;
}

async function canAccessJourneyJob(context: AuthorityContext, job: typeof s04Records.$inferSelect) {
  if (canReadAllOperations(context) || canReadAllMissions(context)) return true;
  const db = getDb();
  const workforceRows = await db.select().from(s04Records).where(and(
    eq(s04Records.tenantId, context.tenantId),
    eq(s04Records.module, "workforce"),
  )).limit(500);
  if (rowMatchesContext(job, context, teamScopeTokens(workforceRows, context))) return true;
  const missionRows = await db.select().from(jobJourneyRecords).where(and(
    eq(jobJourneyRecords.tenantId, context.tenantId),
    eq(jobJourneyRecords.jobId, job.id),
    eq(jobJourneyRecords.domain, "mission"),
  )).limit(100);
  return missionRows.some((row) => rowMatchesContext(row, context));
}

async function canRecordAssignedMissionAction(context: AuthorityContext, row: typeof jobJourneyRecords.$inferSelect) {
  if (hasCapability(context, "mission.manage")) return true;
  if (!hasCapability(context, "mission.delivery.execute")) return false;
  const payload = parseJson(row.payloadJson);
  const driverId = boundedText(payload.driverId, 160);
  if (!driverId) return false;
  const [driver] = await getDb().select().from(s04Records).where(and(
    eq(s04Records.tenantId, context.tenantId),
    eq(s04Records.module, "workforce"),
    eq(s04Records.id, driverId),
  )).limit(1);
  if (!driver) return false;
  const driverPayload = parseJson(driver.payloadJson);
  return boundedText(driverPayload.actorId, 200) === context.actorId
    || boundedText(driverPayload.authorityMembershipId, 200) === context.membershipId;
}

async function canWriteAssignedMissionReport(context: AuthorityContext, row: typeof jobJourneyRecords.$inferSelect) {
  if (hasCapability(context, "mission.manage")) return true;
  if (!hasCapability(context, "mission.report.write")) return false;
  const payload = parseJson(row.payloadJson);
  const driverId = boundedText(payload.driverId, 160);
  if (!driverId) return false;
  const [driver] = await getDb().select().from(s04Records).where(and(
    eq(s04Records.tenantId, context.tenantId),
    eq(s04Records.module, "workforce"),
    eq(s04Records.id, driverId),
  )).limit(1);
  if (!driver) return false;
  const driverPayload = parseJson(driver.payloadJson);
  return boundedText(driverPayload.actorId, 200) === context.actorId
    || boundedText(driverPayload.authorityMembershipId, 200) === context.membershipId;
}

function recordForResponse(row: typeof jobJourneyRecords.$inferSelect) {
  return {
    id: row.id,
    jobId: row.jobId,
    domain: row.domain,
    recordType: row.recordType,
    title: row.title,
    status: row.status,
    version: row.version,
    payload: parseJson(row.payloadJson),
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function documentForResponse(row: typeof operationalDocuments.$inferSelect) {
  return {
    id: row.id,
    jobId: row.jobId,
    category: row.category,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    storageStatus: row.storageStatus,
    scanStatus: row.scanStatus,
    provenance: row.provenance,
    status: row.status,
    version: row.version,
    downloadable: documentCanDownload(row.scanStatus, row.status),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    downloadUrl: `/api/documents/${encodeURIComponent(row.id)}`,
  };
}

function actionAccess(context: AuthorityContext) {
  const access: Record<string, boolean> = {
    ...Object.fromEntries(Object.entries(ACTION_CAPABILITY).map(([action, capability]) => [
      action,
      hasCapability(context, capability),
    ])),
    mission_report_review: hasCapability(context, "mission.report.review"),
    document_upload: hasCapability(context, "documents.write"),
    document_security: hasCapability(context, "documents.write"),
  };
  access.mission_create = hasCapability(context, "mission.manage")
    && hasCapability(context, "mission.resources.read");
  return access;
}

async function journeyReadback(context: AuthorityContext, job: typeof s04Records.$inferSelect) {
  const db = getDb();
  const [records, documents, rawMovements, warehouseAccess] = await Promise.all([
    db.select().from(jobJourneyRecords).where(and(
      eq(jobJourneyRecords.tenantId, context.tenantId),
      eq(jobJourneyRecords.jobId, job.id),
    )).orderBy(desc(jobJourneyRecords.updatedAt)).limit(500),
    hasCapability(context, DOMAIN_READ_CAPABILITY.documents)
      ? db.select().from(operationalDocuments).where(and(
        eq(operationalDocuments.tenantId, context.tenantId),
        eq(operationalDocuments.jobId, job.id),
      )).orderBy(desc(operationalDocuments.createdAt)).limit(250)
      : Promise.resolve([]),
    hasCapability(context, DOMAIN_READ_CAPABILITY.warehouse)
      ? db.select().from(inventoryMovements).where(and(
        eq(inventoryMovements.tenantId, context.tenantId),
        eq(inventoryMovements.jobId, job.id),
      )).orderBy(desc(inventoryMovements.createdAt)).limit(250)
      : Promise.resolve([]),
    hasCapability(context, DOMAIN_READ_CAPABILITY.warehouse)
      ? tenantWarehouseAccess(context)
      : Promise.resolve(null),
  ]);

  const visibleRecords = records.filter((record) => {
    const domain = record.domain as JourneyDomain;
    return domain in DOMAIN_READ_CAPABILITY && hasCapability(context, DOMAIN_READ_CAPABILITY[domain]);
  });
  const queriedItemIds = [...new Set(rawMovements.map((movement) => movement.itemId))];
  const queriedItems = queriedItemIds.length
    ? await db.select().from(inventoryItems).where(and(
      eq(inventoryItems.tenantId, context.tenantId),
      inArray(inventoryItems.id, queriedItemIds),
    ))
    : [];
  const queriedItemById = new Map(queriedItems.map((item) => [item.id, item]));
  const movements = rawMovements.filter((movement) => {
    const warehouseId = queriedItemById.get(movement.itemId)?.warehouseId;
    return Boolean(warehouseId && warehouseAccess && warehouseIdIsAllowed(warehouseAccess, warehouseId));
  });
  const items = queriedItems.filter((item) => Boolean(item.warehouseId && warehouseAccess && warehouseIdIsAllowed(warehouseAccess, item.warehouseId)));
  const itemById = new Map(items.map((item) => [item.id, item]));
  const grouped = (domain: JourneyDomain) => visibleRecords
    .filter((record) => record.domain === domain)
    .map(recordForResponse);
  const section = (domain: JourneyDomain) => {
    const allowed = hasCapability(context, DOMAIN_READ_CAPABILITY[domain]);
    const domainRecords = allowed ? grouped(domain) : [];
    return { access: allowed ? "granted" : "restricted", count: domainRecords.length, records: domainRecords };
  };
  const payload = parseJobPayload(job.payloadJson);
  const [workforce, materialCatalog] = await Promise.all([
    hasCapability(context, "field.write")
      ? fieldWorkforceOptions(context)
      : Promise.resolve({ people: [], supervisors: [], teams: [] }),
    materialCatalogOptions(context),
  ]);
  const missionReports = visibleRecords
    .filter((record) => record.domain === "mission" && record.recordType === "TRANSPORT")
    .map((record) => {
      const missionPayload = parseJson(record.payloadJson);
      const warehouseReadback = buildMissionWarehouseReadback(
        missionPayload,
        movements.filter((movement) => movement.jobId === job.id && movement.missionId === record.id).map((movement) => ({
          itemId: movement.itemId,
          movementType: movement.movementType,
          quantityMilli: movement.quantityMilli,
          createdAt: movement.createdAt,
        })),
        items,
      );
      return {
        missionId: record.id,
        status: record.status,
        warehouseReadback,
        readback: buildMissionReportReadback({ ...missionPayload, warehouseReadback }),
      };
    });
  const missionMaterialRequests = hasCapability(context, ACTION_CAPABILITY.mission_create)
    && hasCapability(context, "mission.resources.read")
    ? records.flatMap((record) => {
      if (record.domain !== "warehouse" || record.recordType !== "MATERIAL_REQUEST" || record.status !== "APPROVED") return [];
      const requestPayload = parseJson(record.payloadJson);
      if (boundedText(requestPayload.missionId, 120)) return [];
      const warehouse = isRecord(requestPayload.warehouse) ? requestPayload.warehouse : null;
      return [{
        id: record.id,
        title: record.title,
        deliveryPoint: boundedText(requestPayload.deliveryPoint, 240),
        warehouseLocation: boundedText(warehouse?.locationLabel, 240),
      }];
    })
    : [];

  return {
    context: publicAuthorityContext(context),
    job: {
      id: job.id,
      code: job.canonicalCode,
      title: payload.title,
      client: payload.clientName || payload.client,
      location: payload.worksite || payload.location,
      status: payload.statusCode,
      version: payload.version,
    },
    sections: {
      planning: section("planning"),
      field: section("field"),
      warehouse: {
        ...section("warehouse"),
        movements: hasCapability(context, DOMAIN_READ_CAPABILITY.warehouse)
          ? movements.map((movement) => ({
            ...inventoryMovementForResponse(movement),
            item: itemById.get(movement.itemId)
              ? { sku: itemById.get(movement.itemId)!.sku, name: itemById.get(movement.itemId)!.name, unit: itemById.get(movement.itemId)!.unit }
              : null,
          }))
          : [],
      },
      mission: section("mission"),
      documents: {
        access: hasCapability(context, DOMAIN_READ_CAPABILITY.documents) ? "granted" : "restricted",
        count: documents.length,
        records: documents.map(documentForResponse),
      },
    },
    missionReports,
    can: actionAccess(context),
    options: {
      documentCategories: OPERATIONAL_DOCUMENT_CATEGORIES,
      inventoryUnits: INVENTORY_UNIT_CATALOG,
      materialCatalog,
      workforce,
      missionMaterialRequests,
      catalogAuthority: {
        documentCategories: "SERVER_CONTRACT",
        inventoryUnits: "SERVER_CONTRACT",
        materialCatalog: "TENANT_INVENTORY_ITEM_CATALOG",
        workforce: "TENANT_AUTHORITY_REGISTRY",
        missionMaterialRequests: "TENANT_JOURNEY_REGISTRY",
      },
    },
    readback: { status: "verified", scope: "tenant", checkedAt: new Date().toISOString() },
  };
}

function normalizeLines(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) return null;
  const lines = value.map((candidate, index) => {
    if (!isRecord(candidate)) return null;
    const itemId = boundedText(candidate.itemId, 120);
    const description = boundedText(candidate.description ?? candidate.name, 200);
    const unit = inventoryUnitForCode(candidate.unit)?.code ?? "";
    const quantityMilli = quantityToMilli(candidate.quantity);
    if ((!itemId && description.length < 2) || !unit || quantityMilli === null) return null;
    return {
      id: boundedText(candidate.id, 80, `line-${index + 1}`),
      itemId: itemId || null,
      description,
      unit,
      quantity: milliToQuantity(quantityMilli),
    };
  });
  return lines.every(Boolean) ? lines as NonNullable<(typeof lines)[number]>[] : null;
}

function normalizeMaterialRequestSelections(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) return null;
  const lines = value.map((candidate, index) => {
    if (!isRecord(candidate)) return null;
    const itemId = boundedText(candidate.itemId, 120);
    const quantityMilli = quantityToMilli(candidate.quantity);
    if (!itemId || quantityMilli === null) return null;
    return {
      id: boundedText(candidate.id, 80, `line-${index + 1}`),
      itemId,
      quantityMilli,
    };
  });
  if (!lines.every(Boolean)) return null;
  const selections = lines as NonNullable<(typeof lines)[number]>[];
  if (new Set(selections.map((line) => line.id)).size !== selections.length
    || new Set(selections.map((line) => line.itemId)).size !== selections.length) return null;
  return selections;
}

class MissionInventoryError extends Error {
  code: string;
  details: unknown;

  constructor(code: string, details: unknown = null) {
    super(code);
    this.code = code;
    this.details = details;
  }
}

type MissionInventoryEffect = "LOAD" | "DELIVER";

type RouteStopMaterialAction = {
  itemId: string;
  materialRequestId: string;
  quantityMilli: number | null;
};

function routeStopMaterialActionEntries(row: typeof routeStops.$inferSelect, effect: MissionInventoryEffect): RouteStopMaterialAction[] {
  const metadata = parseJson(row.evidenceJson);
  if (!Array.isArray(metadata.cargoActions)) return [];
  const allowed = effect === "LOAD" ? ["LOAD", "TRANSFER"] : ["UNLOAD", "RETURN", "TRANSFER"];
  return metadata.cargoActions.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const action = boundedText(entry.action ?? entry.type, 24).toUpperCase();
    if (!allowed.includes(action)) return [];
    const itemId = boundedText(entry.itemId, 160);
    const materialRequestId = boundedText(entry.materialRequestId, 160);
    if (!itemId && !materialRequestId) return [];
    const hasQuantity = entry.quantity !== undefined && entry.quantity !== null && String(entry.quantity).trim() !== "";
    const quantityMilli = quantityToMilli(entry.quantity);
    if (hasQuantity && quantityMilli === null) throw new MissionInventoryError("mission_material_quantity_invalid", { itemId: itemId || null, quantity: entry.quantity });
    return [{ itemId, materialRequestId, quantityMilli }];
  });
}

function missionMaterialLinesForRouteStop(
  payload: JsonObject,
  routeStop: typeof routeStops.$inferSelect,
  effect: MissionInventoryEffect,
) {
  const sourceLines = missionMaterialLines(payload);
  if (!routeStopHasExplicitCargoActions(routeStop)) return sourceLines;
  const actions = routeStopMaterialActionEntries(routeStop, effect);
  if (!actions.length) return [];
  const itemActions = actions.filter((entry) => entry.itemId);
  if (!itemActions.length) return sourceLines;

  const quantityByItem = new Map<string, number | null>();
  for (const action of itemActions) {
    const current = quantityByItem.get(action.itemId);
    if (current === undefined) {
      quantityByItem.set(action.itemId, action.quantityMilli);
    } else if (current === null || action.quantityMilli === null) {
      quantityByItem.set(action.itemId, null);
    } else {
      quantityByItem.set(action.itemId, current + action.quantityMilli);
    }
  }

  return sourceLines.flatMap((line) => {
    if (!line.itemId || !quantityByItem.has(line.itemId)) return [];
    const scopedQuantity = quantityByItem.get(line.itemId);
    return [{ ...line, quantityMilli: scopedQuantity && scopedQuantity > 0 ? scopedQuantity : line.quantityMilli }];
  });
}

async function readMissionWarehouseReadback(
  tenantId: string,
  jobId: string,
  payload: JsonObject,
  missionId: string,
  checkedAt = new Date().toISOString(),
): Promise<MissionWarehouseReadback> {
  const lines = missionMaterialLines(payload);
  const itemIds = [...new Set(lines.flatMap((line) => line.itemId ? [line.itemId] : []))];
  const db = getDb();
  const [movements, items] = itemIds.length
    ? await Promise.all([
      db.select().from(inventoryMovements).where(and(
        eq(inventoryMovements.tenantId, tenantId),
        eq(inventoryMovements.jobId, jobId),
        eq(inventoryMovements.missionId, missionId),
        inArray(inventoryMovements.itemId, itemIds),
      )).orderBy(inventoryMovements.createdAt).limit(500),
      db.select({ id: inventoryItems.id, sku: inventoryItems.sku, name: inventoryItems.name, unit: inventoryItems.unit, warehouseId: inventoryItems.warehouseId })
        .from(inventoryItems)
        .where(and(eq(inventoryItems.tenantId, tenantId), inArray(inventoryItems.id, itemIds))),
    ])
    : [[], []];
  return buildMissionWarehouseReadback(payload, movements.map((movement) => ({
    itemId: movement.itemId,
    movementType: movement.movementType,
    quantityMilli: movement.quantityMilli,
    createdAt: movement.createdAt,
  })), items, checkedAt);
}

async function prepareMissionInventoryEffects({
  tenantId,
  jobId,
  missionId,
  payload,
  routeStop,
  effect,
  actorId,
  idempotencyKey,
  note,
  now,
}: {
  tenantId: string;
  jobId: string;
  missionId: string;
  payload: JsonObject;
  routeStop: typeof routeStops.$inferSelect;
  effect: MissionInventoryEffect;
  actorId: string;
  idempotencyKey: string;
  note: string;
  now: string;
}) {
  const plannedMaterialActions = routeStopMaterialActionEntries(routeStop, effect);
  const allSourceLines = missionMaterialLines(payload);
  const sourceItemIds = new Set(allSourceLines.flatMap((line) => line.itemId ? [line.itemId] : []));
  const unknownItemIds = [...new Set(plannedMaterialActions.flatMap((action) => action.itemId && !sourceItemIds.has(action.itemId) ? [action.itemId] : []))];
  if (unknownItemIds.length) {
    throw new MissionInventoryError("mission_material_line_not_reconcilable", { itemIds: unknownItemIds });
  }
  const sourceLines = missionMaterialLinesForRouteStop(payload, routeStop, effect);
  if (!sourceLines.length) {
    if (routeStopHasExplicitCargoActions(routeStop) && plannedMaterialActions.length === 0) {
      return { statements: [] as never[], lineCount: 0 };
    }
    if (boundedText(payload.materialRequestId, 120)) throw new MissionInventoryError("mission_material_lines_required");
    return { statements: [] as never[], lineCount: 0 };
  }
  const snapshot = payload.materialRequestSnapshot && typeof payload.materialRequestSnapshot === "object" && !Array.isArray(payload.materialRequestSnapshot)
    ? payload.materialRequestSnapshot as JsonObject
    : {};
  const warehouseValue = snapshot.warehouse && typeof snapshot.warehouse === "object" && !Array.isArray(snapshot.warehouse)
    ? snapshot.warehouse as JsonObject
    : {};
  const warehouseId = boundedText(warehouseValue.id, 120);
  if (!warehouseId) throw new MissionInventoryError("mission_source_warehouse_required");
  const quantityByItem = new Map<string, { itemId: string; quantityMilli: number; lineId: string; description: string }>();
  for (const line of sourceLines) {
    if (!line.itemId || line.quantityMilli <= 0) throw new MissionInventoryError("mission_material_line_not_reconcilable", { lineId: line.lineId, description: line.description });
    const current = quantityByItem.get(line.itemId);
    quantityByItem.set(line.itemId, current
      ? { ...current, quantityMilli: current.quantityMilli + line.quantityMilli }
      : { itemId: line.itemId, quantityMilli: line.quantityMilli, lineId: line.lineId, description: line.description });
  }
  const itemIds = [...quantityByItem.keys()];
  const db = getDb();
  const [items, movements] = await Promise.all([
    db.select().from(inventoryItems).where(and(eq(inventoryItems.tenantId, tenantId), inArray(inventoryItems.id, itemIds))),
    db.select().from(inventoryMovements).where(and(
      eq(inventoryMovements.tenantId, tenantId),
      eq(inventoryMovements.jobId, jobId),
      eq(inventoryMovements.missionId, missionId),
      inArray(inventoryMovements.itemId, itemIds),
    )),
  ]);
  const itemById = new Map(items.map((item) => [item.id, item]));
  const statements: never[] = [];
  for (const line of quantityByItem.values()) {
    const item = itemById.get(line.itemId);
    if (!item) throw new MissionInventoryError("mission_inventory_item_not_found", { itemId: line.itemId });
    if (item.warehouseId !== warehouseId) throw new MissionInventoryError("mission_inventory_warehouse_mismatch", { itemId: item.id, warehouseId });
    const linked = movements.filter((movement) => movement.itemId === item.id);
    const moved = (type: string) => linked
      .filter((movement) => movement.movementType === type)
      .reduce((total, movement) => total + Math.max(0, movement.quantityMilli), 0);
    const picked = moved("PICK");
    const completed = moved(effect);
    if (completed >= line.quantityMilli) throw new MissionInventoryError(effect === "LOAD" ? "mission_material_already_loaded" : "mission_material_already_delivered", { itemId: item.id });
    if (effect === "LOAD" && completed + line.quantityMilli > picked) {
      throw new MissionInventoryError("mission_material_pick_required", { itemId: item.id, requiredMilli: line.quantityMilli, pickedMilli: picked });
    }
    if (effect === "DELIVER" && completed + line.quantityMilli > moved("LOAD")) {
      throw new MissionInventoryError("mission_material_load_required", { itemId: item.id, requiredMilli: line.quantityMilli, loadedMilli: moved("LOAD") });
    }
    const nextVersion = item.version + 1;
    const sideKey = `${idempotencyKey}:warehouse-${effect.toLowerCase()}-${item.id}`.slice(0, 160);
    const eventId = crypto.randomUUID();
    const movementId = crypto.randomUUID();
    const eventType = `warehouse.inventory.${effect.toLowerCase()}`;
    statements.push(db.update(inventoryItems).set({
      version: nextVersion,
      updatedAt: now,
    }).where(and(
      eq(inventoryItems.tenantId, tenantId),
      eq(inventoryItems.id, item.id),
      eq(inventoryItems.version, item.version),
    )) as never);
    statements.push(db.insert(inventoryMovements).values({
      id: movementId,
      tenantId,
      itemId: item.id,
      jobId,
      missionId,
      movementType: effect,
      quantityMilli: line.quantityMilli,
      beforeOnHandMilli: item.onHandMilli,
      afterOnHandMilli: item.onHandMilli,
      beforeReservedMilli: item.reservedMilli,
      afterReservedMilli: item.reservedMilli,
      note: note || `${effect === "LOAD" ? "Carico" : "Scarico / consegna"} missione · ${line.description}`,
      idempotencyKey: sideKey,
      actorId,
      createdAt: now,
    }) as never);
    statements.push(db.insert(s06Events).values({
      eventId,
      tenantId,
      eventType,
      schemaVersion: "1",
      actorType: "human",
      actorId,
      source: "sites-mission-control",
      occurredAt: now,
      observedAt: now,
      aggregateType: "inventory.item",
      aggregateId: item.id,
      aggregateVersion: nextVersion,
      payloadJson: JSON.stringify({ action: effect, itemId: item.id, jobId, missionId, warehouseId, quantityMilli: line.quantityMilli, version: nextVersion }),
      correlationId: crypto.randomUUID(),
      causationId: null,
      idempotencyKey: sideKey,
      status: "COMMITTED_SITES_READBACK",
      createdAt: now,
    }) as never);
    statements.push(db.insert(s06Outbox).values({
      id: crypto.randomUUID(), tenantId, eventId,
      topic: `zerow.${eventType}`, status: "PENDING_EXTERNAL_CONSUMER", attempts: 0,
      createdAt: now, updatedAt: now,
    }) as never);
    statements.push(db.insert(s06Reconciliations).values({
      id: crypto.randomUUID(), tenantId,
      aggregateType: "inventory.item", aggregateId: item.id,
      expectedVersion: nextVersion, observedVersion: nextVersion,
      status: "SITES_READBACK_VERIFIED",
      detail: `${effect === "LOAD" ? "Carico missione" : "Scarico / consegna"} collegato alla journey e al magazzino sorgente.`,
      createdAt: now, updatedAt: now,
    }) as never);
  }
  return { statements, lineCount: quantityByItem.size };
}

export async function GET(_request: Request, routeContext: RouteContext) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "operations.read")) {
    return Response.json({ error: "forbidden", capability: "operations.read" }, { status: 403 });
  }
  const reference = await requestedJobId(routeContext);
  if (!reference) return Response.json({ error: "invalid_job_id" }, { status: 400 });
  try {
    const job = await findJob(context.tenantId, reference);
    if (!job) return Response.json({ error: "job_not_found" }, { status: 404 });
    if (!(await canAccessJourneyJob(context, job))) return Response.json({ error: "job_not_found" }, { status: 404 });
    return Response.json(await journeyReadback(context, job), {
      headers: { "cache-control": "private, no-store" },
    });
  } catch {
    return Response.json({ error: "job_journey_readback_unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request, routeContext: RouteContext) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const reference = await requestedJobId(routeContext);
  if (!reference) return Response.json({ error: "invalid_job_id" }, { status: 400 });
  const parsed = await readBoundedJson(request);
  if ("error" in parsed) {
    return Response.json({ error: parsed.error }, { status: parsed.error === "payload_too_large" ? 413 : 400 });
  }
  const input = parsed.value;
  const action = boundedText(input.action, 48).toLowerCase() as keyof typeof ACTION_CAPABILITY;
  if (!(action in ACTION_CAPABILITY)) {
    return Response.json({ error: "unsupported_journey_action", allowed: Object.keys(ACTION_CAPABILITY) }, { status: 400 });
  }
  const capability = ACTION_CAPABILITY[action];
  const managementReportBypass = ["mission_report_save", "mission_report_submit"].includes(action)
    && hasCapability(context, "mission.manage");
  const managementExceptionBypass = action === "mission_exception" && hasCapability(context, "mission.manage");
  if (!hasCapability(context, capability) && !managementReportBypass && !managementExceptionBypass) {
    return Response.json({ error: "forbidden", capability }, { status: 403 });
  }
  if (action === "mission_create" && !hasCapability(context, "mission.resources.read")) {
    return Response.json({ error: "mission_resource_registry_access_required" }, { status: 403 });
  }
  const idempotencyKey = boundedText(input.idempotencyKey, 160);
  if (typeof input.idempotencyKey === "string" && input.idempotencyKey.trim().length > 160) {
    return Response.json({ error: "idempotency_key_too_long" }, { status: 400 });
  }
  if (idempotencyKey.length < 8) return Response.json({ error: "idempotency_key_required" }, { status: 400 });

  let processingStage = "resolve_job";
  try {
    const db = getDb();
    const job = await findJob(context.tenantId, reference);
    if (!job) return Response.json({ error: "job_not_found" }, { status: 404 });
    if (!(await canAccessJourneyJob(context, job))) return Response.json({ error: "job_not_found" }, { status: 404 });
    if (action === "planning_create" || action === "planning_publish") {
      return Response.json({
        error: "planning_module_required",
        href: `/planning?jobId=${encodeURIComponent(job.id)}${action === "planning_create" ? "&create=1" : ""}`,
      }, { status: 409 });
    }
    if (action === "mission_create" && job.recordType === "adapter-contract") {
      return Response.json({ error: "operational_job_required" }, { status: 409 });
    }
    const [existingEvent] = await db.select().from(s06Events).where(and(
      eq(s06Events.tenantId, context.tenantId),
      eq(s06Events.idempotencyKey, idempotencyKey),
    )).limit(1);
    if (existingEvent) {
      if (!existingEvent.aggregateType.startsWith("job.journey.")) {
        return Response.json({ error: "journey_idempotency_key_conflict" }, { status: 409 });
      }
      const [record] = await db.select().from(jobJourneyRecords).where(and(
        eq(jobJourneyRecords.tenantId, context.tenantId),
        eq(jobJourneyRecords.id, existingEvent.aggregateId),
        eq(jobJourneyRecords.jobId, job.id),
      )).limit(1);
      if (!record) return Response.json({ error: "journey_idempotency_readback_unavailable" }, { status: 503 });
      return Response.json({
        ...(await journeyReadback(context, job)),
        mutation: { action, record: recordForResponse(record), eventId: existingEvent.eventId, idempotent: true },
      }, { headers: { "cache-control": "private, no-store" } });
    }

    const now = new Date().toISOString();
    const correlationId = boundedText(input.correlationId, 120) || crypto.randomUUID();
    let domain: JourneyDomain;
    let recordType: string;
    let title: string;
    let status = "";
    let payload: JsonObject;
    let existing: typeof jobJourneyRecords.$inferSelect | null = null;
    let materialRequest: typeof jobJourneyRecords.$inferSelect | null = null;
    let routeProjection: Awaited<ReturnType<typeof buildMissionRouteProjection>> = null;
    let routeInputStops: unknown = null;
    const routeFallbackStops: MissionStopInput[] = [];
    let eventType = "";
    let missionActionStopId = "";
    let missionActionRoutePlanId = "";
    let missionActionEvent: JsonObject | null = null;
    let missionInventoryStatements: unknown[] = [];
    const inventoryReservationUpdateIndexes: number[] = [];
    const inventoryReservationGuards: Array<{ itemId: string; version: number; reservedMilli: number; quantityMilli: number; sideKey: string; eventId: string }> = [];

    if (action === "field_open") {
      domain = "field";
      recordType = "FIELD_SESSION";
      title = boundedText(input.title, 160, "Sessione di cantiere");
      status = "OPEN";
      if (Object.prototype.hasOwnProperty.call(input, "startedAt")) {
        return Response.json({ error: "field_start_time_is_server_owned" }, { status: 400 });
      }
      const teamId = boundedText(input.teamId, 160);
      const supervisorMembershipId = boundedText(input.supervisorMembershipId, 160);
      if (boundedText(input.team, 160) || boundedText(input.supervisor, 160)) {
        return Response.json({ error: "field_assignment_must_use_server_registry" }, { status: 400 });
      }
      const workforce = await fieldWorkforceOptions(context);
      const team = teamId ? workforce.teams.find((item) => item.id === teamId) : null;
      const supervisor = supervisorMembershipId ? workforce.supervisors.find((item) => item.id === supervisorMembershipId) : null;
      if (teamId && !team) return Response.json({ error: "field_team_not_assignable" }, { status: 409 });
      if (supervisorMembershipId && !supervisor) return Response.json({ error: "field_supervisor_not_assignable" }, { status: 409 });
      payload = {
        startedAt: now,
        team: team?.label ?? "",
        ...(team ? { teamId: team.id } : {}),
        supervisor: supervisor?.label ?? "",
        ...(supervisor ? { supervisorMembershipId: supervisor.id } : {}),
        notes: boundedText(input.notes, 2_000),
      };
      eventType = "field.session.opened";
    } else if (action === "material_request") {
      domain = "warehouse";
      recordType = "MATERIAL_REQUEST";
      title = boundedText(input.title, 160, "Richiesta materiali");
      const selections = normalizeMaterialRequestSelections(input.lines);
      if (!selections) return Response.json({ error: "material_catalog_item_required", maxLines: 50 }, { status: 400 });
      const serverCatalog = await materialCatalogOptions(context);
      const catalogById = new Map(serverCatalog.map((item) => [item.id, item]));
      if (selections.some((line) => !catalogById.has(line.itemId))) {
        return Response.json({ error: "material_catalog_selection_unavailable" }, { status: 409 });
      }
      const selectedItemIds = selections.map((line) => line.itemId);
      const selectedItems = await db.select({
        id: inventoryItems.id,
        sku: inventoryItems.sku,
        name: inventoryItems.name,
        unit: inventoryItems.unit,
        status: inventoryItems.status,
      }).from(inventoryItems).where(and(
        eq(inventoryItems.tenantId, context.tenantId),
        inArray(inventoryItems.id, selectedItemIds),
      ));
      const selectedItemById = new Map(selectedItems.map((item) => [item.id, item]));
      if (selectedItemById.size !== selectedItemIds.length) {
        return Response.json({ error: "material_catalog_selection_unavailable" }, { status: 409 });
      }
      const lines = selections.map((selection) => {
        const item = selectedItemById.get(selection.itemId);
        const unit = item ? inventoryUnitForCode(item.unit) : null;
        if (!item || ["ARCHIVED", "INACTIVE", "DISABLED", "CANCELLED"].includes(item.status.toUpperCase()) || !unit) return null;
        return {
          id: selection.id,
          itemId: item.id,
          description: item.name,
          sku: item.sku,
          unit: unit.code,
          quantity: milliToQuantity(selection.quantityMilli),
        };
      });
      if (lines.some((line) => !line)) {
        return Response.json({ error: "material_catalog_selection_unavailable" }, { status: 409 });
      }
      const canonicalLines = lines as NonNullable<(typeof lines)[number]>[];
      const jobPayload = parseJobPayload(job.payloadJson);
      const canonicalDeliveryPoint = boundedText(jobPayload.worksite || jobPayload.location, 240);
      if (!canonicalDeliveryPoint) return Response.json({ error: "job_canonical_location_required" }, { status: 422 });
      const neededAt = boundedText(input.neededAt, 40);
      if (neededAt && !validDateTime(neededAt)) return Response.json({ error: "valid_material_needed_at_required" }, { status: 400 });
      status = "REQUESTED";
      payload = {
        neededAt,
        deliveryPoint: canonicalDeliveryPoint,
        deliveryPointSource: "JOB_CANONICAL_LOCATION",
        deliveryInstructions: boundedText(input.deliveryInstructions, 500),
        notes: boundedText(input.notes, 2_000),
        catalogSource: "TENANT_INVENTORY_ITEM_CATALOG",
        lines: canonicalLines,
        requestedLines: canonicalLines,
      };
      eventType = "warehouse.material_request.created";
    } else if (action === "mission_create") {
      domain = "mission";
      recordType = "TRANSPORT";
      title = boundedText(input.title, 160, "Missione di trasporto");
      const planningPlanId = boundedText(input.planningPlanId, 120);
      let planningPlan: typeof jobJourneyRecords.$inferSelect | null = null;
      let planningPlanPayload: JsonObject = {};
      if (planningPlanId) {
        const [candidatePlan] = await db.select().from(jobJourneyRecords).where(and(
          eq(jobJourneyRecords.tenantId, context.tenantId),
          eq(jobJourneyRecords.jobId, job.id),
          eq(jobJourneyRecords.id, planningPlanId),
          eq(jobJourneyRecords.domain, "planning"),
        )).limit(1);
        if (!candidatePlan) return Response.json({ error: "planning_plan_not_found" }, { status: 404 });
        if (candidatePlan.status !== "PUBLISHED") return Response.json({ error: "published_transport_plan_required", status: candidatePlan.status }, { status: 409 });
        planningPlanPayload = parseJson(candidatePlan.payloadJson);
        if (boundedText(planningPlanPayload.activityType, 24).toUpperCase() !== "TRANSPORT") {
          return Response.json({ error: "transport_planning_plan_required" }, { status: 409 });
        }
        const linkedMissionRows = await db.select({ id: jobJourneyRecords.id, payloadJson: jobJourneyRecords.payloadJson }).from(jobJourneyRecords).where(and(
          eq(jobJourneyRecords.tenantId, context.tenantId),
          eq(jobJourneyRecords.jobId, job.id),
          eq(jobJourneyRecords.domain, "mission"),
        )).orderBy(desc(jobJourneyRecords.updatedAt)).limit(250);
        const linkedMission = linkedMissionRows.find((row) => boundedText(parseJson(row.payloadJson).planningPlanId, 120) === planningPlanId);
        if (linkedMission) return Response.json({ error: "planning_plan_already_linked", missionId: linkedMission.id }, { status: 409 });
        planningPlan = candidatePlan;
      }
      let pickup = boundedText(input.pickup, 240);
      let dropoff = boundedText(input.dropoff, 240);
      const plannedAt = boundedText(input.plannedAt, 40);
      const plannedEndAtInput = boundedText(input.plannedEndAt, 40);
      const driverId = boundedText(input.driverId, 120);
      const vehicleId = boundedText(input.vehicleId, 120);
      const cargoAssetId = boundedText(input.cargoAssetId, 120);
      const cargoAssetIds = [...new Set([
        ...(Array.isArray(input.cargoAssetIds) ? input.cargoAssetIds.flatMap((value) => {
          const id = boundedText(value, 120);
          return id ? [id] : [];
        }) : []),
        ...(cargoAssetId ? [cargoAssetId] : []),
      ])];
      const materialRequestId = boundedText(input.materialRequestId, 120);
      routeInputStops = input.routeStops ?? input.stops;
      const requestedTransportMode = boundedText(input.transportMode, 48);
      const transportMode: TransportMode = isTransportMode(requestedTransportMode)
        ? requestedTransportMode
        : cargoAssetIds.length ? "ASSET_TRANSFER" : "WAREHOUSE_TO_JOB";
      if (materialRequestId) {
        if (transportMode !== "WAREHOUSE_TO_JOB") {
          return Response.json({ error: "material_request_requires_warehouse_to_job" }, { status: 409 });
        }
        const [requestRow] = await db.select().from(jobJourneyRecords).where(and(
          eq(jobJourneyRecords.tenantId, context.tenantId),
          eq(jobJourneyRecords.jobId, job.id),
          eq(jobJourneyRecords.id, materialRequestId),
          eq(jobJourneyRecords.domain, "warehouse"),
          eq(jobJourneyRecords.recordType, "MATERIAL_REQUEST"),
        )).limit(1);
        if (!requestRow) return Response.json({ error: "material_request_not_found" }, { status: 404 });
        if (requestRow.status !== "APPROVED") return Response.json({ error: "approved_material_request_required" }, { status: 409 });
        const requestPayload = parseJson(requestRow.payloadJson);
        if (boundedText(requestPayload.missionId, 120)) return Response.json({ error: "material_request_already_scheduled" }, { status: 409 });
        const warehouse = isRecord(requestPayload.warehouse) ? requestPayload.warehouse : null;
        const warehouseLocation = boundedText(warehouse?.locationLabel, 240);
        if (!warehouseLocation) return Response.json({ error: "fulfillment_warehouse_location_required" }, { status: 422 });
        pickup = warehouseLocation;
        materialRequest = requestRow;
        // The approved request owns origin, destination and material lines. The client may
        // display them, but the route projection is rebuilt from canonical server records.
        routeInputStops = undefined;
      }
      if (transportMode === "WAREHOUSE_TO_JOB" && !materialRequestId) {
        return Response.json({ error: "approved_material_request_required" }, { status: 409 });
      }
      if (transportMode === "WAREHOUSE_TO_JOB") {
        const jobPayload = parseJobPayload(job.payloadJson);
        const canonicalDropoff = boundedText(jobPayload.worksite || jobPayload.location, 240);
        if (!canonicalDropoff) return Response.json({ error: "job_canonical_location_required" }, { status: 422 });
        dropoff = canonicalDropoff;
      }
      if (!pickup || !dropoff || !validDateTime(plannedAt)) return Response.json({ error: "mission_route_and_valid_date_required" }, { status: 400 });
      if (!driverId || !vehicleId) return Response.json({ error: "mission_driver_and_vehicle_required" }, { status: 400 });
      if (!context.operatingTransportModes.includes(transportMode)) {
        return Response.json({ error: "transport_mode_not_enabled", transportMode, enabledModes: context.operatingTransportModes }, { status: 403 });
      }
      if (transportMode === "ASSET_TRANSFER" && !cargoAssetIds.length) {
        return Response.json({ error: "cargo_asset_required_for_asset_transfer" }, { status: 400 });
      }
      if (Object.prototype.hasOwnProperty.call(input, "driver") || Object.prototype.hasOwnProperty.call(input, "vehicle")) {
        return Response.json({ error: "mission_free_text_resources_not_allowed" }, { status: 400 });
      }
      let resources: Awaited<ReturnType<typeof assertMissionResourceSelection>>;
      try {
        resources = await assertMissionResourceSelection({
          tenantId: context.tenantId,
          driverId,
          vehicleId,
          cargoAssetId: cargoAssetId || undefined,
          cargoAssetIds,
          transportMode,
          plannedAt,
          plannedEndAt: plannedEndAtInput || undefined,
        });
      } catch (error) {
        if (error instanceof MissionResourceError) {
          return Response.json({ error: error.code, details: error.details ?? null }, { status: error.code === "mission_resource_conflict" ? 409 : 400 });
        }
        throw error;
      }
      if (planningPlan) {
        const planResourceIds = planningResourceIds(planningPlanPayload);
        const selectedResourceIds = [resources.driver.id, resources.vehicle.id, ...resources.cargoAssets.map((asset) => asset.id)];
        const missingResourceIds = selectedResourceIds.filter((resourceId) => !planResourceIds.has(resourceId));
        if (missingResourceIds.length) {
          return Response.json({ error: "mission_plan_resource_mismatch", planningPlanId: planningPlan.id, missingResourceIds }, { status: 409 });
        }
        const planWindow = planningWindow(planningPlanPayload);
        if (planWindow && (Date.parse(resources.window.startsAt) < Date.parse(planWindow.startsAt) || Date.parse(resources.window.endsAt) > Date.parse(planWindow.endsAt))) {
          return Response.json({ error: "mission_window_outside_planning_plan", planningPlanId: planningPlan.id, planWindow, missionWindow: resources.window }, { status: 409 });
        }
      }
      status = "PLANNED";
      payload = {
        pickup,
        dropoff,
        plannedAt: resources.window.startsAt,
        plannedEndAt: resources.window.endsAt,
        driverId: resources.driver.id,
        vehicleId: resources.vehicle.id,
        cargoAssetId: resources.cargoAsset?.id ?? null,
        cargoAssetIds: resources.cargoAssets.map((asset) => asset.id),
        cargoOperationalAssignees: resources.cargoOperationalAssignees,
        transportMode,
        resourceIds: [resources.driver.id, resources.vehicle.id, ...resources.cargoAssets.map((asset) => asset.id)],
        planningPlanId: planningPlan?.id ?? null,
        planningPlanSnapshot: planningPlan ? { id: planningPlan.id, title: planningPlan.title, version: planningPlan.version, status: planningPlan.status } : null,
        materialRequestId: materialRequest?.id ?? null,
        materialRequestSnapshot: materialRequest
          ? (() => {
            const requestPayload = parseJson(materialRequest.payloadJson);
            return {
              id: materialRequest.id,
              title: materialRequest.title,
              lines: Array.isArray(requestPayload.lines) ? requestPayload.lines : [],
              deliveryPoint: boundedText(requestPayload.deliveryPoint, 240),
              warehouse: isRecord(requestPayload.warehouse) ? requestPayload.warehouse : null,
            };
          })()
          : null,
        resourceSnapshot: {
          driver: { id: resources.driver.id, code: resources.driver.code, label: resources.driver.label, actorId: resources.driver.actorId, membershipId: resources.driver.membershipId },
          vehicle: {
            id: resources.vehicle.id,
            code: resources.vehicle.code,
            label: resources.vehicle.label,
            entityType: "VEHICLE",
            usageMode: resources.vehicle.usageMode,
            transportCapabilities: resources.vehicle.transportCapabilities,
            maxPayloadKg: resources.vehicle.maxPayloadKg,
            operationalAssignee: resources.vehicle.custody ? {
              actorId: resources.vehicle.custody.assigneeActorId,
              membershipId: resources.vehicle.custody.assigneeMembershipId,
              name: resources.vehicle.custody.assigneeName,
              assignmentId: resources.vehicle.custody.assignmentId,
              assignmentKind: resources.vehicle.custody.assignmentKind,
            } : null,
          },
          cargoAsset: resources.cargoAsset
            ? { id: resources.cargoAsset.id, code: resources.cargoAsset.code, label: resources.cargoAsset.label, entityType: "CARGO", weightKg: resources.cargoAsset.weightKg }
            : null,
          cargoAssets: resources.cargoAssets.map((asset) => ({
            id: asset.id,
            code: asset.code,
            label: asset.label,
            entityType: "CARGO",
            weightKg: asset.weightKg,
            operationalAssignee: asset.custody ? {
              actorId: asset.custody.assigneeActorId,
              membershipId: asset.custody.assigneeMembershipId,
              name: asset.custody.assigneeName,
              assignmentId: asset.custody.assignmentId,
              assignmentKind: asset.custody.assignmentKind,
            } : null,
          })),
          capacityCheck: { maxPayloadKg: resources.vehicle.maxPayloadKg, knownCargoWeightKg: resources.capacity.knownWeightKg, unknownCargoCount: resources.capacity.unknownCargoCount },
        },
        notes: boundedText(input.notes, 2_000),
      };
      const requestPayload = materialRequest ? parseJson(materialRequest.payloadJson) : {};
      const requestWarehouse = isRecord(requestPayload.warehouse) ? requestPayload.warehouse : null;
      const originWarehouseId = boundedText(requestPayload.warehouseId, 120) || boundedText(requestWarehouse?.id, 120);
      const destinationEntityId = boundedText(input.destinationEntityId ?? input.dropoffEntityId, 160);
      const destinationEntityType = boundedText(input.destinationEntityType ?? input.dropoffEntityType, 48).toUpperCase();
      const requestMaterialActions = Array.isArray(requestPayload.lines)
        ? requestPayload.lines.flatMap((line) => {
          if (!isRecord(line)) return [];
          const itemId = boundedText(line.itemId, 160);
          if (!itemId) return [];
          return [{
            itemId,
            quantity: typeof line.quantity === "number" || typeof line.quantity === "string" ? String(line.quantity).slice(0, 32) : null,
            materialRequestId: materialRequest?.id ?? null,
          }];
        })
        : [];
      const cargoActionsForStop = (action: string) => {
        const actions: Array<Record<string, unknown>> = requestMaterialActions.map((line) => ({ action, ...line, assetId: null }));
        for (const assetId of cargoAssetIds) actions.push({ action, materialRequestId: materialRequest?.id ?? null, assetId });
        if (!actions.length) actions.push({ action, materialRequestId: materialRequest?.id ?? null, assetId: null });
        return actions;
      };
      if (originWarehouseId) {
        routeFallbackStops.push({
          kind: "PICKUP",
          entityType: "MAGAZZINO",
          entityId: originWarehouseId,
          label: boundedText(requestWarehouse?.locationLabel, 240) || pickup,
          cargoActions: cargoActionsForStop("LOAD"),
        });
      }
      if (destinationEntityId && destinationEntityType) {
        routeFallbackStops.push({ kind: "DELIVERY", entityType: destinationEntityType, entityId: destinationEntityId, label: dropoff, cargoActions: cargoActionsForStop("UNLOAD") });
      } else if (transportMode === "WAREHOUSE_TO_JOB" || transportMode === "ASSET_TRANSFER") {
        routeFallbackStops.push({ kind: "DELIVERY", entityType: "CANTIERE", entityId: job.id, label: dropoff, cargoActions: cargoActionsForStop("UNLOAD") });
      }
      eventType = "mission.transport.created";
    } else {
      const recordId = boundedText(input.recordId, 120);
      const expectedVersion = typeof input.expectedVersion === "number" && Number.isInteger(input.expectedVersion)
        ? input.expectedVersion
        : null;
      if (!recordId || expectedVersion === null || expectedVersion < 1) {
        return Response.json({ error: "record_id_and_expected_version_required" }, { status: 400 });
      }
      const [row] = await db.select().from(jobJourneyRecords).where(and(
        eq(jobJourneyRecords.tenantId, context.tenantId),
        eq(jobJourneyRecords.jobId, job.id),
        eq(jobJourneyRecords.id, recordId),
      )).limit(1);
      if (!row) return Response.json({ error: "journey_record_not_found" }, { status: 404 });
      if (row.version !== expectedVersion) {
        return Response.json({ error: "version_conflict", expectedVersion, currentVersion: row.version }, { status: 409 });
      }
      existing = row;
      domain = row.domain as JourneyDomain;
      recordType = row.recordType;
      title = row.title;
      payload = parseJson(row.payloadJson);

      if (["mission_dispatch", "mission_load", "mission_unload", "mission_deliver", "mission_exception"].includes(action) && !(await canRecordAssignedMissionAction(context, row))) {
        return Response.json({ error: "assigned_delivery_driver_required" }, { status: 403 });
      }
      if (["mission_report_save", "mission_report_submit"].includes(action) && !(await canWriteAssignedMissionReport(context, row))) {
        return Response.json({ error: "assigned_delivery_driver_report_required" }, { status: 403 });
      }

      if (action === "field_close") {
        if (domain !== "field" || row.status !== "OPEN") return Response.json({ error: "invalid_field_transition" }, { status: 409 });
        if (Object.prototype.hasOwnProperty.call(input, "endedAt")) {
          return Response.json({ error: "field_end_time_is_server_owned" }, { status: 400 });
        }
        const summary = boundedText(input.summary, 4_000);
        if (summary.length < 4) return Response.json({ error: "field_close_summary_required" }, { status: 400 });
        status = "CLOSED";
        payload = { ...payload, endedAt: now, summary };
        eventType = "field.session.closed";
      } else if (action === "material_review") {
        processingStage = "material_review_preflight";
        if (domain !== "warehouse" || row.recordType !== "MATERIAL_REQUEST" || row.status !== "REQUESTED") {
          return Response.json({ error: "invalid_material_request_transition" }, { status: 409 });
        }
        const decision = boundedText(input.decision, 16).toUpperCase();
        if (decision !== "APPROVED" && decision !== "MODIFIED" && decision !== "REJECTED") return Response.json({ error: "approval_decision_required" }, { status: 400 });
        status = decision === "MODIFIED" ? "APPROVED" : decision;
        const reviewNote = boundedText(input.note, 2_000);
        if (decision === "REJECTED") {
          if (reviewNote.length < 4) return Response.json({ error: "material_rejection_reason_required" }, { status: 400 });
          payload = {
            ...payload,
            reviewedAt: now,
            reviewedBy: context.actorId,
            reviewOutcome: "REJECTED",
            reviewNote,
          };
        } else {
          const warehouseId = boundedText(input.warehouseId, 120);
          if (!warehouseId) return Response.json({ error: "warehouse_required_for_approval" }, { status: 400 });
          const access = await tenantWarehouseAccess(context);
          if (!warehouseIdIsAllowed(access, warehouseId)) {
            return Response.json({ error: "warehouse_assignment_required" }, { status: 403 });
          }
          const [warehouse] = await db.select().from(tenantWarehouses).where(and(
            eq(tenantWarehouses.tenantId, context.tenantId),
            eq(tenantWarehouses.id, warehouseId),
            eq(tenantWarehouses.status, "active"),
          )).limit(1);
          if (!warehouse) return Response.json({ error: "warehouse_not_found" }, { status: 404 });
          const originalLines = normalizeLines(payload.requestedLines ?? payload.lines);
          // Even an unchanged approval must map each requested description to a
          // canonical item in the selected depot before stock can be reserved.
          const reviewedLines = normalizeLines(input.lines);
          if (!originalLines || !reviewedLines) return Response.json({ error: "valid_material_lines_required", maxLines: 50 }, { status: 400 });
          const originalLineIds = originalLines.map((line) => line.id);
          const reviewedLineIds = reviewedLines.map((line) => line.id);
          if (new Set(originalLineIds).size !== originalLineIds.length
            || new Set(reviewedLineIds).size !== reviewedLineIds.length
            || originalLineIds.length !== reviewedLineIds.length
            || originalLineIds.some((lineId) => !reviewedLineIds.includes(lineId))) {
            return Response.json({ error: "material_review_must_preserve_requested_lines" }, { status: 409 });
          }
          if (reviewedLines.some((line) => !line.itemId)) {
            return Response.json({ error: "material_catalog_item_required", message: "Associa ogni riga a un materiale del registro del magazzino selezionato." }, { status: 422 });
          }
          const reviewedItemIds = [...new Set(reviewedLines.flatMap((line) => line.itemId ? [line.itemId] : []))];
          const reviewedItems = reviewedItemIds.length
            ? await db.select().from(inventoryItems).where(and(
              eq(inventoryItems.tenantId, context.tenantId),
              eq(inventoryItems.warehouseId, warehouse.id),
              inArray(inventoryItems.id, reviewedItemIds),
            ))
            : [];
          const originalItemIds = [...new Set(originalLines.flatMap((line) => line.itemId ? [line.itemId] : []))];
          const originalItems = originalItemIds.length
            ? await db.select({ id: inventoryItems.id, name: inventoryItems.name, sku: inventoryItems.sku }).from(inventoryItems).where(and(
              eq(inventoryItems.tenantId, context.tenantId),
              inArray(inventoryItems.id, originalItemIds),
            ))
            : [];
          const originalItemById = new Map(originalItems.map((item) => [item.id, item]));
          const reviewedItemById = new Map(reviewedItems.map((item) => [item.id, item]));
          if (reviewedItemById.size !== reviewedItemIds.length) {
            return Response.json({ error: "inventory_item_not_in_selected_warehouse", warehouseId: warehouse.id }, { status: 409 });
          }
          const canonicalLines = reviewedLines.map((line) => {
            const item = line.itemId ? reviewedItemById.get(line.itemId) : null;
            if (!item || item.unit !== line.unit) return null;
            return { ...line, description: item.name, sku: item.sku, unit: item.unit };
          });
          if (canonicalLines.some((line) => !line)) {
            return Response.json({ error: "inventory_unit_mismatch", message: "L’unità richiesta deve coincidere con quella del materiale registrato." }, { status: 409 });
          }
          const verifiedLines = canonicalLines as NonNullable<(typeof canonicalLines)[number]>[];
          const requestByLineId = new Map(originalLines.map((line) => [line.id, line]));
          if (verifiedLines.some((line) => requestByLineId.get(line.id)?.unit !== line.unit)) {
            return Response.json({ error: "material_unit_change_not_supported", message: "L’unità di misura richiesta deve restare invariata." }, { status: 409 });
          }
          const fulfilledMaterialChanged = verifiedLines.length !== originalLines.length || verifiedLines.some((line) => {
            const requested = requestByLineId.get(line.id);
            if (!requested || requested.quantity !== line.quantity) return true;
            const originalItem = requested.itemId ? originalItemById.get(requested.itemId) : null;
            const requestedMaterial = (originalItem?.name ?? requested.description).trim().toLocaleLowerCase("it-IT");
            const fulfilledMaterial = line.description.trim().toLocaleLowerCase("it-IT");
            const requestedSku = originalItem?.sku.trim().toLocaleUpperCase("it-IT") ?? "";
            const fulfilledSku = reviewedItemById.get(line.itemId!)?.sku.trim().toLocaleUpperCase("it-IT") ?? "";
            const materialChanged = requestedSku && fulfilledSku
              ? requestedSku !== fulfilledSku
              : requestedMaterial !== fulfilledMaterial;
            return materialChanged;
          });
          if (decision === "APPROVED" && fulfilledMaterialChanged) {
            return Response.json({ error: "material_change_requires_modified_decision" }, { status: 409 });
          }
          if (decision === "MODIFIED" && reviewNote.length < 4) {
            return Response.json({ error: "material_modification_reason_required" }, { status: 400 });
          }
          const reservationByItem = new Map<string, { item: typeof inventoryItems.$inferSelect; quantityMilli: number }>();
          for (const line of verifiedLines) {
            const item = reviewedItemById.get(line.itemId!)!;
            const quantityMilli = quantityToMilli(line.quantity);
            if (quantityMilli === null) return Response.json({ error: "valid_material_lines_required" }, { status: 400 });
            const current = reservationByItem.get(item.id);
            reservationByItem.set(item.id, {
              item,
              quantityMilli: (current?.quantityMilli ?? 0) + quantityMilli,
            });
          }
          const insufficient = [...reservationByItem.values()].flatMap(({ item, quantityMilli }) => {
            const availableMilli = item.onHandMilli - item.reservedMilli;
            return availableMilli < quantityMilli
              ? [{ itemId: item.id, sku: item.sku, name: item.name, available: milliToQuantity(Math.max(0, availableMilli)), requested: milliToQuantity(quantityMilli), unit: item.unit }]
              : [];
          });
          if (insufficient.length) {
            return Response.json({ error: "insufficient_available_stock", items: insufficient, message: "Riduci le quantità, scegli un sostituto disponibile oppure respingi la richiesta." }, { status: 422 });
          }
          for (const { item, quantityMilli } of reservationByItem.values()) {
            const nextVersion = item.version + 1;
            const nextReserved = item.reservedMilli + quantityMilli;
            const nextStatus = item.onHandMilli === 0
              ? "OUT_OF_STOCK"
              : item.onHandMilli - nextReserved < item.minStockMilli ? "LOW_STOCK" : "ACTIVE";
            const sideKey = `material-request:${row.id}:reserve:${item.id}`.slice(0, 160);
            const inventoryEventId = crypto.randomUUID();
            inventoryReservationUpdateIndexes.push(missionInventoryStatements.length);
            inventoryReservationGuards.push({ itemId: item.id, version: nextVersion, reservedMilli: nextReserved, quantityMilli, sideKey, eventId: inventoryEventId });
            missionInventoryStatements.push(db.update(inventoryItems).set({
              reservedMilli: nextReserved,
              status: nextStatus,
              version: nextVersion,
              updatedAt: now,
            }).where(and(
              eq(inventoryItems.tenantId, context.tenantId),
              eq(inventoryItems.id, item.id),
              eq(inventoryItems.version, item.version),
              eq(inventoryItems.warehouseId, warehouse.id),
              exists(db.select({ id: jobJourneyRecords.id }).from(jobJourneyRecords).where(and(
                eq(jobJourneyRecords.tenantId, context.tenantId),
                eq(jobJourneyRecords.id, row.id),
                eq(jobJourneyRecords.version, row.version),
                eq(jobJourneyRecords.status, "REQUESTED"),
              ))),
              sql`${inventoryItems.onHandMilli} - ${inventoryItems.reservedMilli} >= ${quantityMilli}`,
            )).returning() as never);
            const movementId = crypto.randomUUID();
            missionInventoryStatements.push(db.run(sql`
              INSERT INTO inventory_movements
                (id, tenant_id, item_id, job_id, mission_id, movement_type, quantity_milli,
                 before_on_hand_milli, after_on_hand_milli, before_reserved_milli, after_reserved_milli,
                 note, idempotency_key, actor_id, created_at)
              SELECT ${movementId}, ${context.tenantId}, ${item.id}, ${job.id}, NULL, 'RESERVE', ${quantityMilli},
                ${item.onHandMilli}, ${item.onHandMilli}, ${item.reservedMilli}, ${nextReserved},
                ${`Prenotazione richiesta ${row.id} · ${title}`}, ${sideKey}, ${context.actorId}, ${now}
              WHERE changes() = 1
            `) as never);
            missionInventoryStatements.push(db.run(sql`
              INSERT INTO s06_events
                (event_id, tenant_id, event_type, schema_version, actor_type, actor_id, source,
                 occurred_at, observed_at, aggregate_type, aggregate_id, aggregate_version, payload_json,
                 correlation_id, causation_id, idempotency_key, status, created_at)
              SELECT ${inventoryEventId}, ${context.tenantId}, 'warehouse.inventory.reserve', '1', 'human', ${context.actorId},
                'sites-warehouse-request-review', ${now}, ${now}, 'inventory.item', ${item.id}, ${nextVersion},
                ${JSON.stringify({ action: "RESERVE", itemId: item.id, jobId: job.id, materialRequestId: row.id, warehouseId: warehouse.id, quantityMilli, version: nextVersion })},
                ${correlationId}, NULL, ${sideKey}, 'COMMITTED_SITES_READBACK', ${now}
              WHERE EXISTS (SELECT 1 FROM inventory_movements WHERE tenant_id = ${context.tenantId} AND idempotency_key = ${sideKey})
            `) as never);
            missionInventoryStatements.push(db.run(sql`
              INSERT INTO s06_outbox (id, tenant_id, event_id, topic, status, attempts, created_at, updated_at)
              SELECT ${crypto.randomUUID()}, ${context.tenantId}, ${inventoryEventId}, 'zerow.warehouse.inventory.reserve',
                'PENDING_EXTERNAL_CONSUMER', 0, ${now}, ${now}
              WHERE EXISTS (SELECT 1 FROM s06_events WHERE tenant_id = ${context.tenantId} AND event_id = ${inventoryEventId})
            `) as never);
            missionInventoryStatements.push(db.run(sql`
              INSERT INTO s06_reconciliations
                (id, tenant_id, aggregate_type, aggregate_id, expected_version, observed_version, status, detail, created_at, updated_at)
              SELECT ${crypto.randomUUID()}, ${context.tenantId}, 'inventory.item', ${item.id}, ${nextVersion}, ${nextVersion},
                'SITES_READBACK_VERIFIED', ${`Riserva della richiesta materiali ${row.id} registrata nel ledger del deposito ${warehouse.code}.`}, ${now}, ${now}
              WHERE EXISTS (SELECT 1 FROM s06_events WHERE tenant_id = ${context.tenantId} AND event_id = ${inventoryEventId})
            `) as never);
          }
          payload = {
            ...payload,
            requestedLines: originalLines,
            lines: verifiedLines,
            reviewedAt: now,
            reviewedBy: context.actorId,
            reviewOutcome: decision,
            reviewNote,
            warehouseId: warehouse.id,
            warehouse: {
              id: warehouse.id,
              code: warehouse.code,
              name: warehouse.name,
              locationLabel: warehouse.locationLabel,
            },
            stockReservation: {
              status: "RESERVED",
              reservedAt: now,
              reservedBy: context.actorId,
              items: [...reservationByItem.values()].map(({ item, quantityMilli }) => ({ itemId: item.id, sku: item.sku, name: item.name, quantity: milliToQuantity(quantityMilli), unit: item.unit })),
            },
          };
        }
        eventType = `warehouse.material_request.${decision.toLowerCase()}`;
      } else if (action === "mission_exception") {
        if (domain !== "mission" || row.recordType !== "TRANSPORT") {
          return Response.json({ error: "invalid_mission_exception_target" }, { status: 409 });
        }
        const exceptionResult = normalizeMissionException({
          exceptionType: input.exceptionType,
          note: input.note,
          reference: input.reference,
          stopId: input.stopId,
        }, now, context.actorId);
        if (!exceptionResult.exception) {
          return Response.json({
            error: exceptionResult.error,
            allowed: ["DELAYED", "BLOCKED", "VEHICLE_FAULT", "PARTIAL_DELIVERY", "REFUSED", "LOST", "RECONCILE_REQUIRED", "CANCELLED"],
            message: exceptionResult.error === "mission_exception_note_required"
              ? "Descrivi l’anomalia: il testo viene registrato nel diario operativo."
              : "Seleziona un tipo di eccezione missione valido.",
          }, { status: 400 });
        }
        const missionException = exceptionResult.exception;
        const previousException = storedMissionException(payload.missionException);
        if (previousException?.recoveryStatus === "OPEN") {
          return Response.json({ error: "mission_exception_already_open", type: previousException.type }, { status: 409 });
        }
        if (["CANCELLED", "RECONCILE_REQUIRED"].includes(missionException.type) && !hasCapability(context, "mission.manage")) {
          return Response.json({ error: "mission_exception_manager_required", type: missionException.type }, { status: 403 });
        }
        const allowedExceptionStates: Record<MissionExceptionType, string[]> = {
          DELAYED: ["PLANNED", "DISPATCHED"],
          BLOCKED: ["DISPATCHED"],
          VEHICLE_FAULT: ["DISPATCHED"],
          PARTIAL_DELIVERY: ["DISPATCHED"],
          REFUSED: ["DISPATCHED"],
          LOST: ["DISPATCHED"],
          RECONCILE_REQUIRED: ["POD_VERIFIED", "RECONCILED"],
          CANCELLED: ["PLANNED", "DISPATCHED", "DELAYED", "BLOCKED", "VEHICLE_FAULT", "PARTIAL_DELIVERY", "REFUSED", "LOST"],
        };
        if (!allowedExceptionStates[missionException.type].includes(row.status)) {
          return Response.json({ error: "mission_exception_not_allowed_in_state", type: missionException.type, currentStatus: row.status }, { status: 409 });
        }
        if (missionException.stopId) {
          const route = isRecord(payload.route) ? payload.route : {};
          const routePlanId = boundedText(route.routePlanId, 160);
          if (routePlanId) {
            const [stop] = await db.select().from(routeStops).where(and(
              eq(routeStops.tenantId, context.tenantId),
              eq(routeStops.routePlanId, routePlanId),
              eq(routeStops.id, missionException.stopId),
            )).limit(1);
            if (!stop) return Response.json({ error: "mission_exception_stop_not_found" }, { status: 404 });
          }
        }
        const timeline = Array.isArray(payload.operationalTimeline)
          ? payload.operationalTimeline.filter((entry): entry is JsonObject => isRecord(entry))
          : [];
        const exceptionEvent = {
          id: crypto.randomUUID(),
          type: `MISSION_EXCEPTION_${missionException.type}`,
          recordedAt: now,
          occurredAt: now,
          recordedBy: context.actorId,
          exceptionType: missionException.type,
          stopId: missionException.stopId,
          reference: missionException.reference,
          note: missionException.note,
          source: "mission-driver-action",
        };
        missionActionEvent = exceptionEvent;
        status = missionException.type;
        const history = Array.isArray(payload.missionExceptionHistory)
          ? payload.missionExceptionHistory.filter((entry): entry is JsonObject => isRecord(entry))
          : [];
        payload = {
          ...payload,
          missionException,
          missionExceptionHistory: [...history, missionException].slice(-50),
          operationalTimeline: [...timeline, exceptionEvent].slice(-500),
          lastOperationalEvent: exceptionEvent,
        };
        eventType = `mission.transport.exception.${missionException.type.toLowerCase()}`;
      } else if (action === "mission_resume") {
        if (domain !== "mission" || row.recordType !== "TRANSPORT") {
          return Response.json({ error: "invalid_mission_resume_target" }, { status: 409 });
        }
        const openException = storedMissionException(payload.missionException);
        if (!openException || openException.recoveryStatus !== "OPEN") {
          return Response.json({ error: "mission_open_exception_required" }, { status: 409 });
        }
        if (!["DELAYED", "BLOCKED", "VEHICLE_FAULT", "PARTIAL_DELIVERY", "REFUSED", "LOST"].includes(openException.type)) {
          return Response.json({ error: "mission_exception_not_resumable", type: openException.type }, { status: 409 });
        }
        const resolutionNote = boundedText(input.note, 2_000) || "Ripresa autorizzata dal responsabile missioni.";
        const resolvedException = {
          ...openException,
          recoveryStatus: "RESOLVED" as const,
          resolvedAt: now,
          resolvedBy: context.actorId,
          resolutionNote,
        };
        const timeline = Array.isArray(payload.operationalTimeline)
          ? payload.operationalTimeline.filter((entry): entry is JsonObject => isRecord(entry))
          : [];
        const resumeEvent = {
          id: crypto.randomUUID(),
          type: "MISSION_RESUMED",
          recordedAt: now,
          occurredAt: now,
          recordedBy: context.actorId,
          resolvedExceptionType: openException.type,
          note: resolutionNote,
          source: "mission-management",
        };
        missionActionEvent = resumeEvent;
        status = "DISPATCHED";
        payload = {
          ...payload,
          missionException: resolvedException,
          operationalTimeline: [...timeline, resumeEvent].slice(-500),
          lastOperationalEvent: resumeEvent,
        };
        eventType = "mission.transport.resumed";
      } else if (action === "mission_dispatch") {
        if (domain !== "mission" || row.recordType !== "TRANSPORT" || row.status !== "PLANNED") {
          return Response.json({ error: "invalid_mission_transition" }, { status: 409 });
        }
        status = "DISPATCHED";
        const timeline = Array.isArray(payload.operationalTimeline)
          ? payload.operationalTimeline.filter((entry): entry is JsonObject => isRecord(entry))
          : [];
        const dispatchEvent = {
          id: crypto.randomUUID(),
          type: "MISSION_DISPATCHED",
          recordedAt: now,
          occurredAt: now,
          recordedBy: context.actorId,
          source: "mission-driver-action",
        };
        missionActionEvent = dispatchEvent;
        payload = {
          ...payload,
          dispatchedAt: now,
          dispatchedBy: context.actorId,
          clientObservedDispatchAt: validDateTime(boundedText(input.dispatchedAt, 40)) ? boundedText(input.dispatchedAt, 40) : null,
          operationalTimeline: [...timeline, dispatchEvent].slice(-500),
          lastOperationalEvent: dispatchEvent,
        };
        eventType = "mission.transport.dispatched";
      } else if (action === "mission_load" || action === "mission_unload") {
        if (domain !== "mission" || row.recordType !== "TRANSPORT" || !["PLANNED", "DISPATCHED", "PARTIAL_DELIVERY"].includes(row.status)) {
          return Response.json({ error: "invalid_mission_loading_transition" }, { status: 409 });
        }
        if (action === "mission_unload" && !["DISPATCHED", "PARTIAL_DELIVERY"].includes(row.status)) {
          return Response.json({ error: "mission_must_be_in_transit_before_unload" }, { status: 409 });
        }
        const route = isRecord(payload.route) ? payload.route : {};
        missionActionRoutePlanId = boundedText(route.routePlanId, 160);
        if (!missionActionRoutePlanId) {
          return Response.json({ error: "mission_route_required_for_cargo_action", message: "Il carico e lo scarico richiedono una tappa server-side con geofence." }, { status: 409 });
        }
        missionActionStopId = boundedText(input.stopId, 160);
        const missionRouteStops = await db.select().from(routeStops).where(and(
          eq(routeStops.tenantId, context.tenantId),
          eq(routeStops.routePlanId, missionActionRoutePlanId),
        )).orderBy(routeStops.sequence).limit(100);
        if (!missionRouteStops.length) return Response.json({ error: "mission_route_not_available" }, { status: 409 });
        if (!missionActionStopId) return Response.json({ error: "mission_stop_required" }, { status: 400 });
        const selectedStop = missionRouteStops.find((stop) => stop.id === missionActionStopId);
        if (!selectedStop) return Response.json({ error: "mission_stop_not_found" }, { status: 404 });
        const activeStop = currentRouteStop(missionRouteStops);
        if (!activeStop) return Response.json({ error: "mission_route_complete" }, { status: 409 });
        if (selectedStop.id !== activeStop.id) {
          return Response.json({ error: "mission_stop_not_current", stopId: selectedStop.id, currentStopId: activeStop.id, currentSequence: activeStop.sequence }, { status: 409 });
        }
        if (routeStopCompleted(selectedStop)) {
          return Response.json({ error: "mission_stop_already_completed", stopId: selectedStop.id }, { status: 409 });
        }
        if (!routeStopSupportsAction(selectedStop, action)) {
          return Response.json({ error: "mission_stop_action_not_allowed", stopId: selectedStop.id, action, cargoActions: routeStopCargoActions(selectedStop) }, { status: 409 });
        }
        if (!routeStopArrivalConfirmed(selectedStop)) {
          return Response.json({ error: "mission_stop_arrival_required", stopId: selectedStop.id, message: "La tappa deve risultare agganciata dalla geofence prima di registrare il carico o lo scarico." }, { status: 409 });
        }
        if (action === "mission_load" && selectedStop.status === "LOADED") {
          return Response.json({ error: "mission_stop_already_loaded", stopId: selectedStop.id }, { status: 409 });
        }
        if (action === "mission_unload" && selectedStop.status === "UNLOADED") {
          return Response.json({ error: "mission_stop_already_unloaded", stopId: selectedStop.id }, { status: 409 });
        }
        const plannedAssetIds = routeStopCargoAssetIds(selectedStop);
        const requestedAssetIds = requestedCargoAssetIds(input, payload);
        const actionAssetIds = plannedAssetIds.length ? (requestedAssetIds.length ? requestedAssetIds : plannedAssetIds) : requestedAssetIds;
        if (plannedAssetIds.some((assetId) => !actionAssetIds.includes(assetId)) || actionAssetIds.some((assetId) => !plannedAssetIds.includes(assetId))) {
          return Response.json({ error: "mission_stop_asset_set_incomplete", stopId: selectedStop.id, plannedAssetIds, requestedAssetIds: actionAssetIds }, { status: 409 });
        }
        const actionAssetId = actionAssetIds[0] ?? null;
        const resourceSnapshot = isRecord(payload.resourceSnapshot) ? payload.resourceSnapshot : {};
        const driverSnapshot = isRecord(resourceSnapshot.driver) ? resourceSnapshot.driver : {};
        const vehicleSnapshot = isRecord(resourceSnapshot.vehicle) ? resourceSnapshot.vehicle : {};
        const isLoadAction = action === "mission_load";
        const operationalAssignees = actionAssetIds.flatMap((assetId) => {
          const assignee = operationalAssigneeForCargo(payload, assetId);
          return assignee ? [{ assetId, assignee }] : [];
        });
        const custodyTransfer = {
          state: isLoadAction ? "IN_TRANSIT" : "AWAITING_RECEIPT",
          assetIds: actionAssetIds,
          operationalAssignees,
          temporaryCustodian: isLoadAction ? { actorId: boundedText(driverSnapshot.actorId, 160), resourceId: boundedText(payload.driverId, 160), name: boundedText(driverSnapshot.label, 160, "Autista missione") } : null,
          transport: { driverId: boundedText(payload.driverId, 160), vehicleId: boundedText(payload.vehicleId, 160), vehicleLabel: boundedText(vehicleSnapshot.label, 160) },
          location: boundedText(selectedStop.label, 240, boundedText(payload.pickup, 240)),
          updatedAt: now,
          updatedBy: context.actorId,
        };
        const timeline = Array.isArray(payload.operationalTimeline)
          ? payload.operationalTimeline.filter((entry): entry is JsonObject => isRecord(entry))
          : [];
        const actionEvent = {
          id: crypto.randomUUID(),
          type: action === "mission_load" ? "LOAD_CONFIRMED" : "UNLOAD_CONFIRMED",
          recordedAt: now,
          occurredAt: now,
          recordedBy: context.actorId,
          stopId: missionActionStopId || null,
          sequence: typeof input.sequence === "number" && Number.isInteger(input.sequence) ? input.sequence : null,
          note: boundedText(input.note, 2_000),
          assetId: actionAssetId,
          assetIds: actionAssetIds,
          custodyTransfer,
          materialItemIds: routeStopMaterialActionEntries(selectedStop, action === "mission_load" ? "LOAD" : "DELIVER")
            .flatMap((entry) => entry.itemId ? [entry.itemId] : []),
          source: "mission-driver-action",
        };
        missionActionEvent = actionEvent;
        const inventoryEffect = await prepareMissionInventoryEffects({
          tenantId: context.tenantId,
          jobId: job.id,
          missionId: row.id,
          payload,
          routeStop: selectedStop,
          effect: action === "mission_load" ? "LOAD" : "DELIVER",
          actorId: context.actorId,
          idempotencyKey,
          note: boundedText(input.note, 2_000),
          now,
        });
        missionInventoryStatements = inventoryEffect.statements;
        status = row.status;
        payload = {
          ...payload,
          cargoCustody: updateCargoCustody(payload, actionAssetIds, isLoadAction ? "IN_TRANSIT" : "AWAITING_RECEIPT", {
            missionId: row.id,
            driverId: boundedText(payload.driverId, 160),
            driverName: boundedText(driverSnapshot.label, 160, "Autista missione"),
            vehicleId: boundedText(payload.vehicleId, 160),
            vehicleName: boundedText(vehicleSnapshot.label, 160),
            temporaryCustodianActorId: isLoadAction ? boundedText(driverSnapshot.actorId, 160) : null,
            temporaryCustodianResourceId: isLoadAction ? boundedText(payload.driverId, 160) : null,
            location: custodyTransfer.location,
            updatedAt: now,
            updatedBy: context.actorId,
          }),
          operationalTimeline: [...timeline, actionEvent].slice(-500),
          lastOperationalEvent: actionEvent,
          ...(action === "mission_load"
            ? { lastLoadAt: now, loadConfirmedAt: now }
            : { lastUnloadAt: now, unloadConfirmedAt: now }),
        };
        eventType = action === "mission_load" ? "mission.transport.loaded" : "mission.transport.unloaded";
      } else if (action === "mission_deliver") {
        if (domain !== "mission" || row.recordType !== "TRANSPORT" || !["DISPATCHED", "PARTIAL_DELIVERY"].includes(row.status)) {
          return Response.json({ error: "invalid_mission_transition" }, { status: 409 });
        }
        const recipient = boundedText(input.recipient, 160);
        if (recipient.length < 2) return Response.json({ error: "proof_of_delivery_recipient_required" }, { status: 400 });
        const evidenceResult = normalizeMissionPodEvidence({
          evidenceType: input.evidenceType,
          evidenceReference: input.evidenceReference,
          documentId: input.documentId,
        }, now, context.actorId);
        if (!evidenceResult.evidence) {
          return Response.json({
            error: evidenceResult.error,
            allowed: evidenceResult.error === "unsupported_mission_pod_evidence" ? ["DDT_SCANNED", "ORDER_MARKED_DELIVERED", "RECIPIENT_SIGNATURE", "DELIVERY_PHOTO", "AUTHORIZED_DRIVER_CONFIRMATION", "BARCODE_OR_QR_CONFIRMATION"] : undefined,
            message: evidenceResult.error === "pod_evidence_document_required"
              ? "Per questa evidenza devi collegare un documento già scansionato e verificato."
              : evidenceResult.error === "pod_evidence_reference_required"
                ? "Inserisci il riferimento della prova: DDT, ordine oppure barcode/QR."
                : "Seleziona una tipologia di evidenza di consegna valida.",
          }, { status: 400 });
        }
        const podEvidence = evidenceResult.evidence;
        if (podEvidence.documentId) {
          const verifiedDocument = await verifiedMissionPodDocument(context.tenantId, job.id, podEvidence.documentId);
          if (verifiedDocument.error) {
            return Response.json({
              error: verifiedDocument.error,
              documentId: podEvidence.documentId,
              message: verifiedDocument.error === "pod_document_not_verified"
                ? "Il documento non è ancora disponibile: completa prima la scansione di sicurezza."
                : "Il documento non appartiene alla commessa corrente o non è stato trovato.",
            }, { status: verifiedDocument.error === "pod_document_not_verified" ? 422 : 404 });
          }
        }
        const route = isRecord(payload.route) ? payload.route : {};
        missionActionRoutePlanId = boundedText(route.routePlanId, 160);
        if (!missionActionRoutePlanId) {
          return Response.json({ error: "mission_route_required_for_delivery", message: "La consegna deve essere collegata a una tappa server-side con geofence." }, { status: 409 });
        }
        missionActionStopId = boundedText(input.stopId, 160);
        let missionRouteStops: (typeof routeStops.$inferSelect)[] = [];
        let selectedMissionStop: typeof routeStops.$inferSelect | null = null;
        missionRouteStops = await db.select().from(routeStops).where(and(
          eq(routeStops.tenantId, context.tenantId),
          eq(routeStops.routePlanId, missionActionRoutePlanId),
        )).orderBy(routeStops.sequence).limit(100);
        if (!missionRouteStops.length) return Response.json({ error: "mission_route_not_available" }, { status: 409 });
        const activeStop = currentRouteStop(missionRouteStops);
        if (!activeStop) return Response.json({ error: "mission_route_complete" }, { status: 409 });
        selectedMissionStop = missionActionStopId
          ? missionRouteStops.find((stop) => stop.id === missionActionStopId) ?? null
          : routeStopKind(activeStop) === "DELIVERY" ? activeStop : missionRouteStops.find((stop) => routeStopKind(stop) === "DELIVERY" && !routeStopCompleted(stop)) ?? null;
        if (!selectedMissionStop) return Response.json({ error: "mission_stop_not_found" }, { status: 404 });
        missionActionStopId = selectedMissionStop.id;
        if (selectedMissionStop.id !== activeStop.id) {
          return Response.json({ error: "mission_stop_not_current", stopId: selectedMissionStop.id, currentStopId: activeStop.id, currentSequence: activeStop.sequence }, { status: 409 });
        }
        if (routeStopKind(selectedMissionStop) !== "DELIVERY") {
          return Response.json({ error: "mission_delivery_stop_required", stopId: selectedMissionStop.id }, { status: 409 });
        }
        if (routeStopCompleted(selectedMissionStop)) {
          return Response.json({ error: "mission_stop_already_completed", stopId: selectedMissionStop.id }, { status: 409 });
        }
        if (!routeStopSupportsAction(selectedMissionStop, "mission_unload")) {
          return Response.json({ error: "mission_stop_action_not_allowed", stopId: selectedMissionStop.id, action: "mission_unload", cargoActions: routeStopCargoActions(selectedMissionStop) }, { status: 409 });
        }
        if (!routeStopArrivalConfirmed(selectedMissionStop)) {
          return Response.json({ error: "mission_stop_arrival_required", stopId: selectedMissionStop.id, message: "La tappa deve risultare agganciata dalla geofence prima della conferma." }, { status: 409 });
        }
        if (selectedMissionStop.status !== "UNLOADED" && selectedMissionStop.deliveryStatus !== "UNLOADED") {
          return Response.json({ error: "mission_stop_unload_required", stopId: selectedMissionStop.id, message: "Registra prima lo scarico della tappa." }, { status: 409 });
        }
        const plannedAssetIds = routeStopCargoAssetIds(selectedMissionStop);
        const requestedAssetIds = requestedCargoAssetIds(input, payload);
        const deliveryAssetIds = plannedAssetIds.length ? (requestedAssetIds.length ? requestedAssetIds : plannedAssetIds) : requestedAssetIds;
        if (plannedAssetIds.some((assetId) => !deliveryAssetIds.includes(assetId)) || deliveryAssetIds.some((assetId) => !plannedAssetIds.includes(assetId))) {
          return Response.json({ error: "mission_stop_asset_set_incomplete", stopId: selectedMissionStop.id, plannedAssetIds, requestedAssetIds: deliveryAssetIds }, { status: 409 });
        }
        const deliveryAssetId = deliveryAssetIds[0] ?? null;
        const warehouseReadback = await readMissionWarehouseReadback(context.tenantId, job.id, payload, row.id);
        if (warehouseReadback.required && warehouseReadback.status !== "DELIVERED") {
          return Response.json({
            error: "mission_material_unload_required",
            warehouseReadback,
            message: "Prima della conferma di consegna devi registrare lo scarico di tutte le righe materiali.",
          }, { status: 422 });
        }
        const resourceSnapshot = isRecord(payload.resourceSnapshot) ? payload.resourceSnapshot : {};
        const driverSnapshot = isRecord(resourceSnapshot.driver) ? resourceSnapshot.driver : {};
        const vehicleSnapshot = isRecord(resourceSnapshot.vehicle) ? resourceSnapshot.vehicle : {};
        const timeline = Array.isArray(payload.operationalTimeline)
          ? payload.operationalTimeline.filter((entry): entry is JsonObject => isRecord(entry))
          : [];
        const deliveryDestination = boundedText(selectedMissionStop.label, 240, boundedText(payload.dropoff, 240));
        const cargoCustody = updateCargoCustody(payload, deliveryAssetIds, "DELIVERED", {
          missionId: row.id,
          driverId: boundedText(payload.driverId, 160),
          vehicleId: boundedText(payload.vehicleId, 160),
          temporaryCustodianActorId: null,
          driverName: boundedText(driverSnapshot.label, 160, "Autista missione"),
          vehicleName: boundedText(vehicleSnapshot.label, 160, "Mezzo missione"),
          location: deliveryDestination,
          deliveredAt: now,
          deliveredBy: context.actorId,
          receivedBy: recipient,
          updatedAt: now,
          updatedBy: context.actorId,
        });
        const deliveryEvent = {
          id: crypto.randomUUID(),
          type: "DELIVERY_CONFIRMED",
          recordedAt: now,
          occurredAt: now,
          recordedBy: context.actorId,
          stopId: missionActionStopId || null,
          sequence: typeof input.sequence === "number" && Number.isInteger(input.sequence) ? input.sequence : null,
          recipient,
          assetId: deliveryAssetId,
          assetIds: deliveryAssetIds,
          destination: deliveryDestination,
          operationalAssignees: deliveryAssetIds.flatMap((assetId) => {
            const assignee = operationalAssigneeForCargo(payload, assetId);
            return assignee ? [{ assetId, assignee }] : [];
          }),
          custodyTransfer: {
            state: "DELIVERED",
            assetIds: deliveryAssetIds,
            operationalAssignees: deliveryAssetIds.flatMap((assetId) => {
              const assignee = operationalAssigneeForCargo(payload, assetId);
              return assignee ? [{ assetId, assignee }] : [];
            }),
            temporaryCustodianActorId: null,
            receivedBy: recipient,
            location: deliveryDestination,
            updatedAt: now,
            updatedBy: context.actorId,
          },
          evidenceType: podEvidence.type,
          evidenceReference: podEvidence.reference,
          documentId: podEvidence.documentId,
          note: boundedText(input.note, 2_000),
          source: "mission-driver-action",
        };
        missionActionEvent = deliveryEvent;
        const deliveryStops = missionRouteStops.filter((stop) => routeStopKind(stop) === "DELIVERY");
        const allDeliveryStopsComplete = deliveryStops.length === 0
          || deliveryStops.every((stop) => stop.id === selectedMissionStop?.id || routeStopCompleted(stop));
        const proofEntry = {
          stopId: missionActionStopId || null,
          sequence: typeof input.sequence === "number" && Number.isInteger(input.sequence) ? input.sequence : null,
          recipient,
          deliveredAt: now,
          recordedAt: now,
          clientObservedAt: validDateTime(boundedText(input.deliveredAt, 40)) ? boundedText(input.deliveredAt, 40) : null,
          assetId: deliveryAssetId,
          assetIds: deliveryAssetIds,
          note: boundedText(input.note, 2_000),
          documentId: podEvidence.documentId,
          evidence: podEvidence,
          recordedBy: context.actorId,
        };
        const proofOfDeliveries = upsertDeliveryProof(payload, proofEntry);
        status = allDeliveryStopsComplete ? "DELIVERED" : row.status === "PARTIAL_DELIVERY" ? "PARTIAL_DELIVERY" : "DISPATCHED";
        payload = {
          ...payload,
          cargoCustody,
          warehouseReadback,
          proofOfDelivery: proofEntry,
          proofOfDeliveries,
          completedDeliveryStops: proofOfDeliveries.filter((entry) => boundedText(entry.stopId, 160)).length,
          remainingDeliveryStops: allDeliveryStopsComplete ? 0 : Math.max(0, deliveryStops.length - proofOfDeliveries.filter((entry) => boundedText(entry.stopId, 160)).length),
          operationalTimeline: [...timeline, deliveryEvent].slice(-500),
          lastOperationalEvent: deliveryEvent,
        };
        eventType = allDeliveryStopsComplete ? "mission.transport.delivered" : "mission.transport.stop_delivered";
      } else if (action === "mission_verify_pod") {
        if (domain !== "mission" || row.recordType !== "TRANSPORT" || row.status !== "DELIVERED") {
          return Response.json({ error: "invalid_pod_verification_transition" }, { status: 409 });
        }
        let proofEntries = deliveryProofEntries(payload);
        const proof = proofEntries.at(-1) ?? {};
        if (!proofEntries.length) return Response.json({ error: "delivery_proof_readback_required" }, { status: 400 });
        const route = isRecord(payload.route) ? payload.route : {};
        const routePlanId = boundedText(route.routePlanId, 160);
        let deliveryStopIds: string[] = [];
        if (routePlanId) {
          const missionRouteStops = await db.select().from(routeStops).where(and(
            eq(routeStops.tenantId, context.tenantId),
            eq(routeStops.routePlanId, routePlanId),
          )).orderBy(routeStops.sequence).limit(100);
          deliveryStopIds = missionRouteStops.filter((stop) => routeStopKind(stop) === "DELIVERY").map((stop) => stop.id);
          const proofStopIds = new Set(proofEntries.map((entry) => boundedText(entry.stopId, 160)).filter(Boolean));
          const missingStopIds = deliveryStopIds.filter((stopId) => !proofStopIds.has(stopId));
          if (missingStopIds.length > 0) {
            return Response.json({ error: "mission_stop_proof_required", missingStopIds, message: "Ogni tappa di consegna deve avere il proprio ricevente e la propria prova prima della verifica POD." }, { status: 422 });
          }
        }
        const missingEvidenceIndexes = proofEntries.flatMap((entry, index) => missionPodEvidenceComplete(entry.evidence) ? [] : [index]);
        if (missingEvidenceIndexes.length > 0) {
          if (missingEvidenceIndexes.length !== 1 || !boundedText(input.evidenceType, 48)) {
            const missingEvidenceStopIds = missingEvidenceIndexes.map((index) => boundedText(proofEntries[index]?.stopId, 160) || `proof-${index + 1}`);
            return Response.json({
              error: "mission_pod_evidence_required",
              missingStopIds: missingEvidenceStopIds,
              message: "Ogni tappa deve avere una prova di consegna tipizzata. Riapri la consegna e registra DDT, firma, foto, QR oppure conferma autista.",
            }, { status: 422 });
          }
          const index = missingEvidenceIndexes[0];
          const legacy = proofEntries[index] ?? {};
          const legacyEvidence = normalizeMissionPodEvidence({
            evidenceType: input.evidenceType,
            evidenceReference: input.evidenceReference,
            documentId: boundedText(input.documentId, 160) || boundedText(legacy.documentId, 160),
          }, now, context.actorId);
          if (!legacyEvidence.evidence) {
            return Response.json({
              error: legacyEvidence.error,
              message: legacyEvidence.error === "pod_evidence_document_required"
                ? "Per questa evidenza devi collegare un documento già scansionato e verificato."
                : "Completa il riferimento richiesto per la prova di consegna.",
            }, { status: 400 });
          }
          proofEntries = proofEntries.map((entry, entryIndex) => entryIndex === index
            ? { ...entry, documentId: legacyEvidence.evidence.documentId, evidence: legacyEvidence.evidence }
            : entry);
        }
        for (const entry of proofEntries) {
          if (typeof entry.recipient !== "string" || entry.recipient.trim().length < 2 || typeof entry.deliveredAt !== "string" || !validDateTime(entry.deliveredAt)) {
            return Response.json({ error: "delivery_proof_readback_required" }, { status: 400 });
          }
          const evidence = storedMissionPodEvidence(entry.evidence);
          if (!evidence) return Response.json({ error: "mission_pod_evidence_required", message: "La prova di consegna non è leggibile o non rispetta il contratto server-side." }, { status: 422 });
          if (evidence.documentId) {
            const verifiedDocument = await verifiedMissionPodDocument(context.tenantId, job.id, evidence.documentId);
            if (verifiedDocument.error) {
              return Response.json({
                error: verifiedDocument.error,
                documentId: evidence.documentId,
                message: verifiedDocument.error === "pod_document_not_verified"
                  ? "Il documento della prova non è ancora stato rilasciato dal controllo di sicurezza."
                  : "Il documento della prova non appartiene alla commessa corrente.",
              }, { status: verifiedDocument.error === "pod_document_not_verified" ? 422 : 404 });
            }
          }
        }
        const verifiedProofEntries: JsonObject[] = proofEntries.map((entry) => ({ ...entry, verifiedAt: now, verifiedBy: context.actorId }));
        const verifiedEvidenceDocuments = verifiedProofEntries.flatMap((entry) => {
          const evidence = storedMissionPodEvidence(entry.evidence);
          return evidence?.documentId ? [evidence.documentId] : [];
        });
        status = "POD_VERIFIED";
        payload = {
          ...payload,
          proofOfDelivery: verifiedProofEntries.at(-1) ?? { ...proof, verifiedAt: now, verifiedBy: context.actorId },
          proofOfDeliveries: verifiedProofEntries,
          podVerifiedAt: now,
          podVerifiedBy: context.actorId,
          podEvidenceDocumentId: verifiedEvidenceDocuments.at(-1) ?? null,
        };
        eventType = "mission.transport.pod_verified";
      } else if (action === "mission_reconcile") {
        if (domain !== "mission" || row.recordType !== "TRANSPORT" || !["POD_VERIFIED", "RECONCILE_REQUIRED"].includes(row.status)) {
          return Response.json({ error: "invalid_mission_reconciliation_transition" }, { status: 409 });
        }
        const reconciliationNote = boundedText(input.note, 2_000);
        if (reconciliationNote.length < 2) return Response.json({ error: "reconciliation_note_required" }, { status: 400 });
        const warehouseReadback = await readMissionWarehouseReadback(context.tenantId, job.id, payload, row.id);
        if (warehouseReadback.required && warehouseReadback.status !== "DELIVERED") {
          return Response.json({
            error: "mission_material_reconciliation_required",
            warehouseReadback,
            message: "La riconciliazione resta bloccata finché il ledger del magazzino non conferma lo scarico.",
          }, { status: 422 });
        }
        status = "RECONCILED";
        const openException = storedMissionException(payload.missionException);
        const resolvedException = openException?.recoveryStatus === "OPEN"
          ? { ...openException, recoveryStatus: "RESOLVED" as const, resolvedAt: now, resolvedBy: context.actorId, resolutionNote: reconciliationNote }
          : openException;
        payload = { ...payload, warehouseReadback, ...(resolvedException ? { missionException: resolvedException } : {}), reconciliation: { reconciledAt: now, reconciledBy: context.actorId, note: reconciliationNote } };
        eventType = "mission.transport.reconciled";
      } else if (action === "mission_report_save" || action === "mission_report_submit") {
        if (domain !== "mission" || row.recordType !== "TRANSPORT" || row.status === "CLOSED") {
          return Response.json({ error: "invalid_mission_report_transition" }, { status: 409 });
        }
        const savedReport = isRecord(payload.missionReport) ? payload.missionReport : {};
        if (boundedText(savedReport.status, 24).toUpperCase() === "APPROVED") {
          return Response.json({ error: "mission_report_already_approved", message: "Il rapportino è già approvato dall’ufficio e non può essere modificato." }, { status: 409 });
        }
        if (boundedText(savedReport.status, 24).toUpperCase() === "SUBMITTED" && !hasCapability(context, "mission.manage")) {
          return Response.json({ error: "mission_report_pending_review", message: "Il rapportino è in revisione: attendi l’ufficio oppure una richiesta di integrazione." }, { status: 409 });
        }
        const reportText = boundedText(input.text, 4_000);
        if (reportText.length < 2) return Response.json({ error: "mission_report_text_required" }, { status: 400 });
        const warehouseReadback = await readMissionWarehouseReadback(context.tenantId, job.id, payload, row.id);
        payload = { ...payload, warehouseReadback };
        const reportReadback = buildMissionReportReadback(payload, { textOverride: reportText });
        if (action === "mission_report_submit" && !reportReadback.completeness.ready) {
          return Response.json({
            error: "mission_report_completeness_unmet",
            completeness: reportReadback.completeness,
            questions: reportReadback.completeness.questions,
            message: "Il rapportino missione resta in bozza: completa le evidenze importanti prima dell’invio in ufficio.",
          }, { status: 422 });
        }
        const reportStatus = action === "mission_report_submit" ? "SUBMITTED" : "DRAFT";
        payload = {
          ...payload,
          missionReport: {
            status: reportStatus,
            text: reportText,
            reviewNote: null,
            reviewedAt: null,
            reviewedBy: null,
            approvedAt: null,
            approvedBy: null,
            ...(action === "mission_report_submit" ? {
              submittedAt: now,
              submittedBy: context.actorId,
              completeness: reportReadback.completeness,
            } : {}),
            updatedAt: now,
            updatedBy: context.actorId,
          },
        };
        status = row.status;
        eventType = action === "mission_report_submit" ? "mission.transport.report_submitted" : "mission.transport.report_saved";
      } else if (action === "mission_report_review") {
        if (domain !== "mission" || row.recordType !== "TRANSPORT" || row.status === "CLOSED") {
          return Response.json({ error: "invalid_mission_report_review_transition" }, { status: 409 });
        }
        const report = isRecord(payload.missionReport) ? payload.missionReport : null;
        if (!report || boundedText(report.status, 24).toUpperCase() !== "SUBMITTED") {
          return Response.json({ error: "mission_report_not_ready_for_review", message: "Il rapportino deve essere inviato dall’autista prima della revisione." }, { status: 409 });
        }
        if (boundedText(report.submittedBy, 160, boundedText(report.updatedBy, 160)) === context.actorId) {
          return Response.json({ error: "mission_report_self_review_forbidden", message: "Chi invia il rapportino non può approvare la propria missione." }, { status: 403 });
        }
        const warehouseReadback = await readMissionWarehouseReadback(context.tenantId, job.id, payload, row.id);
        const reportReadback = buildMissionReportReadback({ ...payload, warehouseReadback });
        if (!reportReadback.completeness.ready) {
          return Response.json({
            error: "mission_report_completeness_unmet",
            completeness: reportReadback.completeness,
            questions: reportReadback.completeness.questions,
            message: "Il rapportino non può essere approvato finché mancano dati importanti.",
          }, { status: 422 });
        }
        const decision = boundedText(input.decision, 32).toUpperCase();
        if (decision !== "APPROVE" && decision !== "REQUEST_CHANGES") {
          return Response.json({ error: "mission_report_review_decision_invalid" }, { status: 400 });
        }
        const reviewNote = boundedText(input.reviewNote ?? input.note, 1_000);
        if (decision === "REQUEST_CHANGES" && reviewNote.length < 8) {
          return Response.json({ error: "mission_report_review_note_required" }, { status: 400 });
        }
        const approved = decision === "APPROVE";
        status = row.status;
        payload = {
          ...payload,
          warehouseReadback,
          missionReport: {
            ...report,
            status: approved ? "APPROVED" : "CHANGES_REQUESTED",
            reviewNote: reviewNote || "Rapportino verificato dall’ufficio.",
            reviewedAt: now,
            reviewedBy: context.actorId,
            updatedAt: now,
            updatedBy: context.actorId,
            ...(approved ? { approvedAt: now, approvedBy: context.actorId } : { approvedAt: null, approvedBy: null }),
          },
        };
        eventType = approved ? "mission.transport.report_approved" : "mission.transport.report_changes_requested";
      } else if (action === "mission_close") {
        if (domain !== "mission" || row.recordType !== "TRANSPORT" || row.status !== "RECONCILED") {
          return Response.json({ error: "invalid_mission_close_transition" }, { status: 409 });
        }
        const warehouseReadback = await readMissionWarehouseReadback(context.tenantId, job.id, payload, row.id);
        if (warehouseReadback.required && warehouseReadback.status !== "DELIVERED") {
          return Response.json({
            error: "mission_material_reconciliation_required",
            warehouseReadback,
            message: "La missione non può essere chiusa: il registro del magazzino non è riconciliato.",
          }, { status: 422 });
        }
        payload = { ...payload, warehouseReadback };
        const reportReadback = buildMissionReportReadback(payload);
        const savedReport = isRecord(payload.missionReport) ? payload.missionReport : {};
        if (!["SUBMITTED", "APPROVED"].includes(boundedText(savedReport.status, 24).toUpperCase()) || !reportReadback.completeness.ready) {
          return Response.json({
            error: "mission_report_required_before_close",
            completeness: reportReadback.completeness,
            questions: reportReadback.completeness.questions,
            message: "La missione non può essere chiusa senza rapportino missione inviato e completo.",
          }, { status: 422 });
        }
        status = "CLOSED";
        payload = {
          ...payload,
          closedAt: now,
          closedBy: context.actorId,
          missionReport: { ...savedReport, closedReadbackAt: now },
        };
        eventType = "mission.transport.closed";
      }
    }

    if (!status || !eventType) return Response.json({ error: "unsupported_journey_transition" }, { status: 409 });
    const recordId = existing?.id ?? crypto.randomUUID();
    if (action === "mission_create" && !existing) {
      try {
        routeProjection = await buildMissionRouteProjection({
          tenantId: context.tenantId,
          missionId: recordId,
          jobId: job.id,
          driverId: boundedText(payload.driverId, 120),
          vehicleId: boundedText(payload.vehicleId, 120),
          plannedStartAt: boundedText(payload.plannedAt, 40),
          createdBy: context.actorId,
          stops: routeInputStops,
          fallbackStops: routeFallbackStops,
          cargoAssetId: boundedText(payload.cargoAssetId, 120) || null,
          cargoAssetIds: Array.isArray(payload.cargoAssetIds) ? payload.cargoAssetIds.filter((value): value is string => typeof value === "string") : [],
          materialRequestId: materialRequest?.id ?? null,
        });
      } catch (error) {
        if (error instanceof MissionRouteError) return Response.json({ error: error.code, details: error.details }, { status: 409 });
        throw error;
      }
      payload = { ...payload, route: routeSummaryForPayload(routeProjection) };
    }
    const nextVersion = existing ? existing.version + 1 : 1;
    const eventId = crypto.randomUUID();
    const eventPayload = JSON.stringify({
      action,
      jobId: job.id,
      domain,
      recordType,
      recordId,
      status,
      version: nextVersion,
      materialRequestId: materialRequest?.id ?? null,
      planningPlanId: boundedText(payload.planningPlanId, 120) || null,
      ...(missionActionEvent ? { operationalEvent: missionActionEvent } : {}),
      ...(action === "mission_report_review" && isRecord(payload.missionReport)
        ? {
            reviewStatus: boundedText(payload.missionReport.status, 24).toUpperCase(),
            reviewNoteProvided: Boolean(boundedText(payload.missionReport.reviewNote, 1_000)),
          }
        : {}),
    });
    const mutation = existing
      ? db.update(jobJourneyRecords).set({
        status,
        version: nextVersion,
        payloadJson: JSON.stringify(payload),
        updatedBy: context.actorId,
        updatedAt: now,
      }).where(and(
        eq(jobJourneyRecords.tenantId, context.tenantId),
        eq(jobJourneyRecords.jobId, job.id),
        eq(jobJourneyRecords.id, recordId),
        eq(jobJourneyRecords.version, existing.version),
        ...inventoryReservationGuards.map(({ sideKey }) => exists(db.select({ id: inventoryMovements.id }).from(inventoryMovements).where(and(
          eq(inventoryMovements.tenantId, context.tenantId),
          eq(inventoryMovements.idempotencyKey, sideKey),
        )))),
      )).returning()
      : db.insert(jobJourneyRecords).values({
        id: recordId,
        tenantId: context.tenantId,
        jobId: job.id,
        domain,
        recordType,
        title,
        status,
        version: 1,
        payloadJson: JSON.stringify(payload),
        idempotencyKey,
        createdBy: context.actorId,
        updatedBy: context.actorId,
        createdAt: now,
        updatedAt: now,
      }).returning();

    const eventWrite = action === "material_review"
      ? db.run(sql`
        INSERT INTO s06_events
          (event_id, tenant_id, event_type, schema_version, actor_type, actor_id, source,
           occurred_at, observed_at, aggregate_type, aggregate_id, aggregate_version, payload_json,
           correlation_id, causation_id, idempotency_key, status, created_at)
        SELECT ${eventId}, ${context.tenantId}, ${eventType}, '1', 'human', ${context.actorId}, 'sites-job-journey',
          ${now}, ${now}, ${`job.journey.${domain}`}, ${recordId}, ${nextVersion}, ${eventPayload},
          ${correlationId}, NULL, ${idempotencyKey}, 'COMMITTED_SITES_READBACK', ${now}
        WHERE EXISTS (SELECT 1 FROM job_journey_records WHERE tenant_id = ${context.tenantId} AND id = ${recordId} AND version = ${nextVersion} AND status = ${status})
      `)
      : db.insert(s06Events).values({
        eventId,
        tenantId: context.tenantId,
        eventType,
        schemaVersion: "1",
        actorType: "human",
        actorId: context.actorId,
        source: "sites-job-journey",
        occurredAt: now,
        observedAt: now,
        aggregateType: `job.journey.${domain}`,
        aggregateId: recordId,
        aggregateVersion: nextVersion,
        payloadJson: eventPayload,
        correlationId,
        causationId: null,
        idempotencyKey,
        status: "COMMITTED_SITES_READBACK",
        createdAt: now,
      });
    const outboxWrite = action === "material_review"
      ? db.run(sql`
        INSERT INTO s06_outbox (id, tenant_id, event_id, topic, status, attempts, created_at, updated_at)
        SELECT ${crypto.randomUUID()}, ${context.tenantId}, ${eventId}, ${`zerow.${eventType}`}, 'PENDING_EXTERNAL_CONSUMER', 0, ${now}, ${now}
        WHERE EXISTS (SELECT 1 FROM s06_events WHERE tenant_id = ${context.tenantId} AND event_id = ${eventId})
      `)
      : db.insert(s06Outbox).values({
        id: crypto.randomUUID(), tenantId: context.tenantId, eventId,
        topic: `zerow.${eventType}`, status: "PENDING_EXTERNAL_CONSUMER",
        attempts: 0, createdAt: now, updatedAt: now,
      });
    const reconciliationWrite = action === "material_review"
      ? db.run(sql`
        INSERT INTO s06_reconciliations
          (id, tenant_id, aggregate_type, aggregate_id, expected_version, observed_version, status, detail, created_at, updated_at)
        SELECT ${crypto.randomUUID()}, ${context.tenantId}, ${`job.journey.${domain}`}, ${recordId}, ${nextVersion}, ${nextVersion},
          'SITES_READBACK_VERIFIED', 'Passaggio della journey persistito con controllo versione e outbox.', ${now}, ${now}
        WHERE EXISTS (SELECT 1 FROM s06_events WHERE tenant_id = ${context.tenantId} AND event_id = ${eventId})
      `)
      : db.insert(s06Reconciliations).values({
        id: crypto.randomUUID(), tenantId: context.tenantId,
        aggregateType: `job.journey.${domain}`, aggregateId: recordId,
        expectedVersion: nextVersion, observedVersion: nextVersion,
        status: "SITES_READBACK_VERIFIED",
        detail: "Passaggio della journey persistito con controllo versione e outbox.",
        createdAt: now, updatedAt: now,
      });
    const statements = [
      ...missionInventoryStatements,
      mutation,
      eventWrite,
      outboxWrite,
      reconciliationWrite,
    ] as unknown as never[];
    const missionInventoryStatementOffset = 0;
    if (routeProjection) {
      for (const temporary of routeProjection.temporaryLocations) {
        statements.push(db.insert(geoLocations).values(temporary.location) as never);
        statements.push(db.insert(geofences).values(temporary.geofence) as never);
      }
      statements.push(db.insert(routePlans).values(routeProjection.plan) as never);
      for (const stop of routeProjection.stops) statements.push(db.insert(routeStops).values(stop) as never);
    }
    if (existing && action === "mission_dispatch") {
      const route = isRecord(payload.route) ? payload.route : {};
      const routePlanId = boundedText(route.routePlanId, 160);
      if (routePlanId) {
        statements.push(db.update(routePlans).set({ status: "DISPATCHED", startedAt: now, updatedAt: now }).where(and(eq(routePlans.tenantId, context.tenantId), eq(routePlans.id, routePlanId))) as never);
      }
    }
    if (existing && missionActionRoutePlanId && missionActionStopId && ["mission_load", "mission_unload", "mission_deliver"].includes(action)) {
      const isDelivery = action === "mission_deliver";
      const routeStopUpdate: Partial<typeof routeStops.$inferInsert> = {
        status: isDelivery ? "COMPLETED" : action === "mission_load" ? "LOADED" : "UNLOADED",
        deliveryStatus: isDelivery ? "CONFIRMED" : action === "mission_load" ? "LOADED" : "UNLOADED",
        updatedAt: now,
      };
      statements.push(db.update(routeStops).set(routeStopUpdate).where(and(
        eq(routeStops.tenantId, context.tenantId),
        eq(routeStops.routePlanId, missionActionRoutePlanId),
        eq(routeStops.id, missionActionStopId),
      )) as never);
    }
    if (existing && action === "mission_close") {
      const route = isRecord(payload.route) ? payload.route : {};
      const routePlanId = boundedText(route.routePlanId, 160);
      if (routePlanId) {
        statements.push(db.update(routePlans).set({ status: "COMPLETED", endedAt: now, updatedAt: now }).where(and(eq(routePlans.tenantId, context.tenantId), eq(routePlans.id, routePlanId))) as never);
      }
      const routeSummaryStops = Array.isArray(route.stops) ? route.stops : [];
      const temporaryLocationIds = routeSummaryStops.flatMap((stop) => {
        if (!isRecord(stop) || stop.temporary !== true) return [];
        const id = boundedText(stop.locationId, 160);
        return id ? [id] : [];
      });
      const temporaryGeofenceIds = routeSummaryStops.flatMap((stop) => {
        if (!isRecord(stop) || stop.temporary !== true) return [];
        const id = boundedText(stop.geofenceId, 160);
        return id ? [id] : [];
      });
      if (temporaryLocationIds.length) {
        statements.push(db.update(geoLocations).set({ status: "EXPIRED", updatedAt: now }).where(and(
          eq(geoLocations.tenantId, context.tenantId),
          inArray(geoLocations.id, temporaryLocationIds),
          eq(geoLocations.status, "TEMPORARY"),
        )) as never);
      }
      if (temporaryGeofenceIds.length) {
        statements.push(db.update(geofences).set({ status: "EXPIRED", updatedAt: now }).where(and(
          eq(geofences.tenantId, context.tenantId),
          inArray(geofences.id, temporaryGeofenceIds),
          eq(geofences.status, "TEMPORARY"),
        )) as never);
      }
    }
    if (materialRequest) {
      const requestPayload = parseJson(materialRequest.payloadJson);
      statements.push(db.update(jobJourneyRecords).set({
        payloadJson: JSON.stringify({
          ...requestPayload,
          missionId: recordId,
          missionScheduledAt: now,
          missionScheduledBy: context.actorId,
        }),
        version: materialRequest.version + 1,
        updatedBy: context.actorId,
        updatedAt: now,
      }).where(and(
        eq(jobJourneyRecords.tenantId, context.tenantId),
        eq(jobJourneyRecords.id, materialRequest.id),
        eq(jobJourneyRecords.status, "APPROVED"),
        eq(jobJourneyRecords.version, materialRequest.version),
      )) as never);
    }
    processingStage = action === "material_review" ? "material_review_batch" : "journey_batch";
    const results = await runJourneyBatch(db, statements) as unknown[];
    processingStage = action === "material_review" ? "material_review_readback" : "journey_readback";
    const reservationConflict = inventoryReservationUpdateIndexes.some((index) => {
      const result = results[missionInventoryStatementOffset + index];
      return !Array.isArray(result) || result.length === 0;
    });
    if (reservationConflict) return Response.json({ error: "inventory_reservation_conflict", message: "Le giacenze sono cambiate durante la revisione. Rileggi il deposito e ripeti la verifica." }, { status: 409 });
    const changed = (results[missionInventoryStatements.length] as (typeof jobJourneyRecords.$inferSelect)[])[0];
    if (!changed) return Response.json({ error: "version_conflict" }, { status: 409 });
    if (materialRequest) {
      const [linkedRequest] = await db.select().from(jobJourneyRecords).where(and(
        eq(jobJourneyRecords.tenantId, context.tenantId),
        eq(jobJourneyRecords.id, materialRequest.id),
      )).limit(1);
      if (!linkedRequest || boundedText(parseJson(linkedRequest.payloadJson).missionId, 120) !== recordId) {
        return Response.json({ error: "material_request_link_unavailable" }, { status: 503 });
      }
    }
    if (action === "material_review") {
      const reservationKeys = inventoryReservationGuards.map(({ sideKey }) => sideKey);
      const expectedItemIds = inventoryReservationGuards.map(({ itemId }) => itemId);
      const [verifiedRecordRows, verifiedItems, verifiedMovements, verifiedEvents, verifiedOutbox, verifiedReconciliations] = await Promise.all([
        db.select().from(jobJourneyRecords).where(and(
          eq(jobJourneyRecords.tenantId, context.tenantId),
          eq(jobJourneyRecords.jobId, job.id),
          eq(jobJourneyRecords.id, recordId),
          eq(jobJourneyRecords.version, nextVersion),
          eq(jobJourneyRecords.status, status),
        )).limit(1),
        db.select().from(inventoryItems).where(and(
          eq(inventoryItems.tenantId, context.tenantId),
          inArray(inventoryItems.id, expectedItemIds),
        )),
        db.select().from(inventoryMovements).where(and(
          eq(inventoryMovements.tenantId, context.tenantId),
          inArray(inventoryMovements.idempotencyKey, reservationKeys),
        )),
        db.select().from(s06Events).where(and(
          eq(s06Events.tenantId, context.tenantId),
          inArray(s06Events.idempotencyKey, [idempotencyKey, ...reservationKeys]),
        )),
        db.select().from(s06Outbox).where(and(
          eq(s06Outbox.tenantId, context.tenantId),
          inArray(s06Outbox.eventId, [eventId, ...inventoryReservationGuards.map((guard) => guard.eventId)]),
        )),
        db.select().from(s06Reconciliations).where(and(
          eq(s06Reconciliations.tenantId, context.tenantId),
          inArray(s06Reconciliations.aggregateId, [recordId, ...expectedItemIds]),
        )),
      ]);
      const verifiedRecord = verifiedRecordRows[0];
      const reviewedPayload = verifiedRecord ? parseJson(verifiedRecord.payloadJson) : {};
      const stockReservation = isRecord(reviewedPayload.stockReservation) ? reviewedPayload.stockReservation : {};
      const itemById = new Map(verifiedItems.map((item) => [item.id, item]));
      const movementByKey = new Map(verifiedMovements.map((movement) => [movement.idempotencyKey, movement]));
      const eventByKey = new Map(verifiedEvents.map((event) => [event.idempotencyKey, event]));
      const outboxEventIds = new Set(verifiedOutbox.map((entry) => entry.eventId));
      const reconciliationKeys = new Set(verifiedReconciliations.map((entry) => `${entry.aggregateType}:${entry.aggregateId}:${entry.expectedVersion}:${entry.status}`));
      const reservationRequired = status === "APPROVED";
      const reservationReadbackComplete = inventoryReservationGuards.every((guard) => {
        const item = itemById.get(guard.itemId);
        const movement = movementByKey.get(guard.sideKey);
        const event = eventByKey.get(guard.sideKey);
        return Boolean(item
          && item.version === guard.version
          && item.reservedMilli === guard.reservedMilli
          && movement
          && movement.movementType === "RESERVE"
          && movement.quantityMilli === guard.quantityMilli
          && event
          && event.eventType === "warehouse.inventory.reserve"
          && event.aggregateId === guard.itemId
          && outboxEventIds.has(event.eventId)
          && reconciliationKeys.has(`inventory.item:${guard.itemId}:${guard.version}:SITES_READBACK_VERIFIED`));
      });
      const requestEvent = eventByKey.get(idempotencyKey);
      const reviewReadbackComplete = Boolean(verifiedRecord
        && (!reservationRequired || (stockReservation.status === "RESERVED" && reservationReadbackComplete))
        && requestEvent
        && requestEvent.eventId === eventId
        && outboxEventIds.has(eventId)
        && reconciliationKeys.has(`job.journey.warehouse:${recordId}:${nextVersion}:SITES_READBACK_VERIFIED`));
      if (!reviewReadbackComplete) {
        console.error("material_review_readback_incomplete", {
          stage: processingStage,
          recordFound: Boolean(verifiedRecord),
          reservationCount: inventoryReservationGuards.length,
          movementCount: verifiedMovements.length,
          eventCount: verifiedEvents.length,
          outboxCount: verifiedOutbox.length,
        });
        return Response.json({ error: "material_review_readback_unavailable", message: "La revisione non è stata confermata dal registro. Aggiorna la richiesta prima di riprovare." }, { status: 503 });
      }
      return Response.json({
        readback: { status: "verified", scope: "tenant", checkedAt: new Date().toISOString() },
        mutation: { action, record: recordForResponse(verifiedRecord!), eventId, idempotent: false },
      }, {
        status: existing ? 200 : 201,
        headers: { "cache-control": "private, no-store" },
      });
    }
    return Response.json({
      ...(await journeyReadback(context, job)),
      mutation: { action, record: recordForResponse(changed), eventId, idempotent: false },
    }, {
      status: existing ? 200 : 201,
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof MissionInventoryError) {
      return Response.json({ error: error.code, details: error.details }, { status: 422 });
    }
    const message = error instanceof Error ? error.message : "";
    if (/unique|constraint/i.test(message)) return Response.json({ error: "journey_idempotency_or_version_conflict" }, { status: 409 });
    const errorWithCode = error instanceof Error ? error as Error & { code?: unknown } : null;
    console.error("job_journey_write_failed", {
      action,
      stage: processingStage,
      errorName: error instanceof Error ? error.name : "unknown",
      errorCode: typeof errorWithCode?.code === "string" ? errorWithCode.code.slice(0, 80) : null,
    });
    return Response.json({ error: "job_journey_write_unavailable" }, { status: 503 });
  }
}
