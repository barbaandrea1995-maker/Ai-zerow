import { and, desc, eq, inArray } from "drizzle-orm";
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
} from "@/db/schema";
import { getAuthorityContext, hasCapability, publicAuthorityContext, type AuthorityContext } from "@/lib/authority-context";
import { documentCanDownload } from "@/lib/document-security";
import { inventoryMovementForResponse, milliToQuantity, quantityToMilli } from "@/lib/inventory-contract";
import { assertMissionResourceSelection, MissionResourceError } from "@/lib/mission-resources";
import { parseJobPayload } from "@/lib/operations-contract";
import { buildMissionReportReadback } from "@/lib/mission-contract";
import { buildMissionWarehouseReadback, missionMaterialLines, type MissionWarehouseReadback } from "@/lib/mission-inventory-contract";
import { evaluatePlanning, normalizePlanningResource, normalizePlanningSlot, type PlanningResource, type PlanningSlot } from "@/lib/planning-contract";
import { PlanningResourceError as PlanningRegistryError, resolvePlanningResources } from "@/lib/planning-resources";
import { buildMissionRouteProjection, MissionRouteError, routeSummaryForPayload, type MissionStopInput } from "@/lib/location-intelligence/route-planner";
import { normalizeMissionException, storedMissionException, type MissionExceptionType } from "@/lib/mission-exception-contract";
import { missionPodEvidenceComplete, normalizeMissionPodEvidence, storedMissionPodEvidence } from "@/lib/mission-pod-contract";
import { isTransportMode, type TransportMode } from "@/lib/tenant-operating-model";
import { canReadAllMissions, canReadAllOperations, rowMatchesContext, teamScopeTokens } from "@/lib/operational-scope";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ jobId: string }> };
type JsonObject = Record<string, unknown>;
type JourneyDomain = "planning" | "field" | "warehouse" | "mission";

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
  material_review: "warehouse.write",
  material_fulfill: "warehouse.write",
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

function planningData(row: typeof jobJourneyRecords.$inferSelect) {
  const payload = parseJson(row.payloadJson);
  const resources = Array.isArray(payload.resources)
    ? payload.resources.map(normalizePlanningResource).filter((item): item is PlanningResource => Boolean(item))
    : [];
  const slots = Array.isArray(payload.slots)
    ? payload.slots.map(normalizePlanningSlot).filter((item): item is PlanningSlot => Boolean(item))
    : [];
  return { resources, slots };
}

async function activePlanningRows(tenantId: string) {
  return getDb().select().from(jobJourneyRecords).where(and(
    eq(jobJourneyRecords.tenantId, tenantId),
    eq(jobJourneyRecords.domain, "planning"),
    inArray(jobJourneyRecords.status, ["DRAFT", "PUBLISHED"]),
  )).orderBy(desc(jobJourneyRecords.updatedAt)).limit(500);
}

function evaluatePlanningAgainstTenant(candidateSlots: PlanningSlot[], candidateResources: PlanningResource[], existing: (typeof jobJourneyRecords.$inferSelect)[]) {
  const slots = [...candidateSlots];
  const resources = [...candidateResources];
  const resourcesById = new Map(resources.map((resource) => [resource.id, resource]));
  for (const row of existing) {
    const data = planningData(row);
    for (const resource of data.resources) {
      const current = resourcesById.get(resource.id);
      if (!current) {
        resources.push(resource);
        resourcesById.set(resource.id, resource);
      } else if (resource.capacity > current.capacity) {
        current.capacity = resource.capacity;
      }
    }
    slots.push(...data.slots.map((slot) => ({ ...slot, id: `${row.id}:${slot.id}` })));
  }
  return evaluatePlanning(slots, resources);
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
  return {
    ...Object.fromEntries(Object.entries(ACTION_CAPABILITY).map(([action, capability]) => [
      action,
      hasCapability(context, capability),
    ])),
    document_upload: hasCapability(context, "documents.write"),
    document_security: hasCapability(context, "documents.write"),
  };
}

async function journeyReadback(context: AuthorityContext, job: typeof s04Records.$inferSelect) {
  const db = getDb();
  const [records, documents, movements] = await Promise.all([
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
  ]);

  const visibleRecords = records.filter((record) => {
    const domain = record.domain as JourneyDomain;
    return domain in DOMAIN_READ_CAPABILITY && hasCapability(context, DOMAIN_READ_CAPABILITY[domain]);
  });
  const itemIds = [...new Set(movements.map((movement) => movement.itemId))];
  const items = itemIds.length
    ? await db.select().from(inventoryItems).where(and(
      eq(inventoryItems.tenantId, context.tenantId),
      inArray(inventoryItems.id, itemIds),
    ))
    : [];
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
  const missionReports = visibleRecords
    .filter((record) => record.domain === "mission" && record.recordType === "TRANSPORT")
    .map((record) => {
      const missionPayload = parseJson(record.payloadJson);
      const warehouseReadback = buildMissionWarehouseReadback(
        missionPayload,
        movements.filter((movement) => movement.jobId === job.id && (!movement.missionId || movement.missionId === record.id)).map((movement) => ({
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
    readback: { status: "verified", scope: "tenant", checkedAt: new Date().toISOString() },
  };
}

function normalizeLines(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) return null;
  const lines = value.map((candidate, index) => {
    if (!isRecord(candidate)) return null;
    const itemId = boundedText(candidate.itemId, 120);
    const description = boundedText(candidate.description ?? candidate.name, 200);
    const unit = boundedText(candidate.unit, 24);
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

async function inventoryLinesExist(tenantId: string, lines: Array<{ itemId: string | null }>) {
  const referencedIds = lines.flatMap((line) => line.itemId ? [line.itemId] : []);
  if (!referencedIds.length) return true;
  const found = await getDb().select({ id: inventoryItems.id }).from(inventoryItems).where(and(
    eq(inventoryItems.tenantId, tenantId),
    inArray(inventoryItems.id, referencedIds),
  ));
  return new Set(found.map((item) => item.id)).size === new Set(referencedIds).size;
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

async function readMissionWarehouseReadback(
  tenantId: string,
  jobId: string,
  payload: JsonObject,
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
  effect: MissionInventoryEffect;
  actorId: string;
  idempotencyKey: string;
  note: string;
  now: string;
}) {
  const sourceLines = missionMaterialLines(payload);
  if (!sourceLines.length) {
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

  try {
    const db = getDb();
    const job = await findJob(context.tenantId, reference);
    if (!job) return Response.json({ error: "job_not_found" }, { status: 404 });
    if (!(await canAccessJourneyJob(context, job))) return Response.json({ error: "job_not_found" }, { status: 404 });
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
    let missionInventoryStatements: never[] = [];

    if (action === "planning_create") {
      domain = "planning";
      recordType = "PLAN";
      title = boundedText(input.title, 160, "Piano operativo");
      const startsAt = boundedText(input.startsAt, 40);
      const endsAt = boundedText(input.endsAt, 40);
      if (!validDateTime(startsAt) || !validDateTime(endsAt)) return Response.json({ error: "valid_planning_dates_required" }, { status: 400 });
      if (Date.parse(endsAt) <= Date.parse(startsAt)) return Response.json({ error: "planning_end_must_follow_start" }, { status: 400 });
      let canonicalResources: PlanningResource[];
      try {
        canonicalResources = await resolvePlanningResources(context.tenantId, input.resourceIds, { startsAt, endsAt });
      } catch (error) {
        if (error instanceof PlanningRegistryError) return Response.json({ error: error.code, detail: error.message }, { status: error.code === "planning_resource_unavailable" ? 409 : 400 });
        throw error;
      }
      if (canonicalResources.some((resource) => resource.kind === "person" || resource.kind === "team")
        && !hasCapability(context, "workforce.registry.read")
        && !hasCapability(context, "workforce.read.all")) {
        return Response.json({ error: "workforce_registry_access_required" }, { status: 403 });
      }
      if (canonicalResources.some((resource) => resource.kind === "asset" || resource.kind === "vehicle")
        && !hasCapability(context, "asset.read")) {
        return Response.json({ error: "asset_registry_access_required" }, { status: 403 });
      }
      const slot = normalizePlanningSlot({
        id: "slot-1",
        startsAt,
        endsAt,
        resourceIds: canonicalResources.map((resource) => resource.id),
        requiredQualifications: input.requiredQualifications,
        workload: input.workload,
      });
      if (!slot) return Response.json({ error: "valid_planning_resources_required" }, { status: 400 });
      const candidateEvaluation = evaluatePlanning([slot], canonicalResources);
      const tenantEvaluation = evaluatePlanningAgainstTenant([slot], canonicalResources, await activePlanningRows(context.tenantId));
      const evaluation = { ...tenantEvaluation, conflicts: [...candidateEvaluation.conflicts, ...tenantEvaluation.conflicts] };
      if (!evaluation.feasible && input.allowConflicts !== true) return Response.json({ error: "planning_conflicts", status: "CONFLICTED", evaluation }, { status: 409 });
      status = "DRAFT";
      payload = {
        startsAt,
        endsAt,
        activityType: boundedText(input.activityType, 24, "WORK").toUpperCase(),
        scopeSubgroupId: boundedText(input.scopeSubgroupId, 160),
        scopeSubgroupTitle: boundedText(input.scopeSubgroupTitle, 240),
        location: boundedText(input.location, 240),
        priority: boundedText(input.priority, 24, "STANDARD").toUpperCase(),
        resources: canonicalResources,
        resourceIds: slot.resourceIds,
        slots: [slot],
        evaluation,
        notes: boundedText(input.notes, 2_000),
      };
      eventType = "planning.plan.created";
    } else if (action === "field_open") {
      domain = "field";
      recordType = "FIELD_SESSION";
      title = boundedText(input.title, 160, "Sessione di cantiere");
      status = "OPEN";
      const startedAt = boundedText(input.startedAt, 40, now);
      if (!validDateTime(startedAt)) return Response.json({ error: "valid_field_start_required" }, { status: 400 });
      payload = {
        startedAt,
        team: boundedText(input.team, 160),
        supervisor: boundedText(input.supervisor, 160),
        notes: boundedText(input.notes, 2_000),
      };
      eventType = "field.session.opened";
    } else if (action === "material_request") {
      domain = "warehouse";
      recordType = "MATERIAL_REQUEST";
      title = boundedText(input.title, 160, "Richiesta materiali");
      const lines = normalizeLines(input.lines);
      if (!lines) return Response.json({ error: "valid_material_lines_required", maxLines: 50 }, { status: 400 });
      if (!(await inventoryLinesExist(context.tenantId, lines))) {
        return Response.json({ error: "inventory_item_not_found" }, { status: 404 });
      }
      status = "REQUESTED";
      payload = {
        neededAt: boundedText(input.neededAt, 40),
        deliveryPoint: boundedText(input.deliveryPoint, 240),
        notes: boundedText(input.notes, 2_000),
        lines,
        requestedLines: lines,
      };
      eventType = "warehouse.material_request.created";
    } else if (action === "mission_create") {
      domain = "mission";
      recordType = "TRANSPORT";
      title = boundedText(input.title, 160, "Missione di trasporto");
      let pickup = boundedText(input.pickup, 240);
      const dropoff = boundedText(input.dropoff, 240);
      const plannedAt = boundedText(input.plannedAt, 40);
      const plannedEndAtInput = boundedText(input.plannedEndAt, 40);
      const driverId = boundedText(input.driverId, 120);
      const vehicleId = boundedText(input.vehicleId, 120);
      const cargoAssetId = boundedText(input.cargoAssetId, 120);
      const materialRequestId = boundedText(input.materialRequestId, 120);
      routeInputStops = input.routeStops ?? input.stops;
      const requestedTransportMode = boundedText(input.transportMode, 48);
      const transportMode: TransportMode = isTransportMode(requestedTransportMode)
        ? requestedTransportMode
        : cargoAssetId ? "ASSET_TRANSFER" : "WAREHOUSE_TO_JOB";
      if (materialRequestId) {
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
        if (!pickup && warehouse) pickup = boundedText(warehouse.locationLabel, 240);
        materialRequest = requestRow;
      }
      if (transportMode === "WAREHOUSE_TO_JOB" && !materialRequestId) {
        return Response.json({ error: "approved_material_request_required" }, { status: 409 });
      }
      if (!pickup || !dropoff || !validDateTime(plannedAt)) return Response.json({ error: "mission_route_and_valid_date_required" }, { status: 400 });
      if (!driverId || !vehicleId) return Response.json({ error: "mission_driver_and_vehicle_required" }, { status: 400 });
      if (!context.operatingTransportModes.includes(transportMode)) {
        return Response.json({ error: "transport_mode_not_enabled", transportMode, enabledModes: context.operatingTransportModes }, { status: 403 });
      }
      if (transportMode === "ASSET_TRANSFER" && !cargoAssetId) {
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
      status = "PLANNED";
      payload = {
        pickup,
        dropoff,
        plannedAt: resources.window.startsAt,
        plannedEndAt: resources.window.endsAt,
        driverId: resources.driver.id,
        vehicleId: resources.vehicle.id,
        cargoAssetId: resources.cargoAsset?.id ?? null,
        transportMode,
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
          driver: { id: resources.driver.id, code: resources.driver.code, label: resources.driver.label },
          vehicle: { id: resources.vehicle.id, code: resources.vehicle.code, label: resources.vehicle.label },
          cargoAsset: resources.cargoAsset
            ? { id: resources.cargoAsset.id, code: resources.cargoAsset.code, label: resources.cargoAsset.label }
            : null,
        },
        notes: boundedText(input.notes, 2_000),
      };
      const requestPayload = materialRequest ? parseJson(materialRequest.payloadJson) : {};
      const requestWarehouse = isRecord(requestPayload.warehouse) ? requestPayload.warehouse : null;
      const originWarehouseId = boundedText(requestPayload.warehouseId, 120) || boundedText(requestWarehouse?.id, 120);
      const destinationEntityId = boundedText(input.destinationEntityId ?? input.dropoffEntityId, 160);
      const destinationEntityType = boundedText(input.destinationEntityType ?? input.dropoffEntityType, 48).toUpperCase();
      if (originWarehouseId) {
        routeFallbackStops.push({
          kind: "PICKUP",
          entityType: "MAGAZZINO",
          entityId: originWarehouseId,
          label: boundedText(requestWarehouse?.locationLabel, 240) || pickup,
          cargoActions: [{ action: "LOAD", materialRequestId: materialRequest?.id ?? null, assetId: cargoAssetId || null }],
        });
      }
      if (destinationEntityId && destinationEntityType) {
        routeFallbackStops.push({ kind: "DELIVERY", entityType: destinationEntityType, entityId: destinationEntityId, label: dropoff, cargoActions: [{ action: "UNLOAD", materialRequestId: materialRequest?.id ?? null, assetId: cargoAssetId || null }] });
      } else if (transportMode === "WAREHOUSE_TO_JOB" || transportMode === "ASSET_TRANSFER") {
        routeFallbackStops.push({ kind: "DELIVERY", entityType: "CANTIERE", entityId: job.id, label: dropoff, cargoActions: [{ action: "UNLOAD", materialRequestId: materialRequest?.id ?? null, assetId: cargoAssetId || null }] });
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

      if (action === "planning_publish") {
        if (domain !== "planning" || row.status !== "DRAFT") return Response.json({ error: "invalid_planning_transition" }, { status: 409 });
        status = "PUBLISHED";
        payload = { ...payload, publishedAt: now, publishedBy: context.actorId };
        eventType = "planning.plan.published";
      } else if (action === "field_close") {
        if (domain !== "field" || row.status !== "OPEN") return Response.json({ error: "invalid_field_transition" }, { status: 409 });
        status = "CLOSED";
        const endedAt = boundedText(input.endedAt, 40, now);
        if (!validDateTime(endedAt)) return Response.json({ error: "valid_field_end_required" }, { status: 400 });
        payload = { ...payload, endedAt, summary: boundedText(input.summary, 4_000) };
        eventType = "field.session.closed";
      } else if (action === "material_review") {
        if (domain !== "warehouse" || row.recordType !== "MATERIAL_REQUEST" || row.status !== "REQUESTED") {
          return Response.json({ error: "invalid_material_request_transition" }, { status: 409 });
        }
        const decision = boundedText(input.decision, 16).toUpperCase();
        if (decision !== "APPROVED" && decision !== "MODIFIED" && decision !== "REJECTED") return Response.json({ error: "approval_decision_required" }, { status: 400 });
        status = decision === "MODIFIED" ? "APPROVED" : decision;
        if (decision === "REJECTED") {
          payload = {
            ...payload,
            reviewedAt: now,
            reviewedBy: context.actorId,
            reviewOutcome: "REJECTED",
            reviewNote: boundedText(input.note, 2_000),
          };
        } else {
          const warehouseId = boundedText(input.warehouseId, 120);
          if (!warehouseId) return Response.json({ error: "warehouse_required_for_approval" }, { status: 400 });
          const [warehouse] = await db.select().from(tenantWarehouses).where(and(
            eq(tenantWarehouses.tenantId, context.tenantId),
            eq(tenantWarehouses.id, warehouseId),
            eq(tenantWarehouses.status, "active"),
          )).limit(1);
          if (!warehouse) return Response.json({ error: "warehouse_not_found" }, { status: 404 });
          const originalLines = normalizeLines(payload.requestedLines ?? payload.lines);
          const reviewedLines = decision === "MODIFIED" ? normalizeLines(input.lines) : normalizeLines(payload.lines);
          if (!originalLines || !reviewedLines) return Response.json({ error: "valid_material_lines_required", maxLines: 50 }, { status: 400 });
          if (!(await inventoryLinesExist(context.tenantId, reviewedLines))) {
            return Response.json({ error: "inventory_item_not_found" }, { status: 404 });
          }
          payload = {
            ...payload,
            requestedLines: originalLines,
            lines: reviewedLines,
            reviewedAt: now,
            reviewedBy: context.actorId,
            reviewOutcome: decision,
            reviewNote: boundedText(input.note, 2_000),
            warehouseId: warehouse.id,
            warehouse: {
              id: warehouse.id,
              code: warehouse.code,
              name: warehouse.name,
              locationLabel: warehouse.locationLabel,
            },
          };
        }
        eventType = `warehouse.material_request.${decision.toLowerCase()}`;
      } else if (action === "material_fulfill") {
        if (domain !== "warehouse" || row.recordType !== "MATERIAL_REQUEST" || row.status !== "APPROVED") {
          return Response.json({ error: "invalid_material_request_transition" }, { status: 409 });
        }
        const missionId = boundedText(input.missionId, 120) || boundedText(payload.missionId, 120);
        if (!missionId) return Response.json({ error: "material_request_must_be_scheduled_first" }, { status: 409 });
        status = "FULFILLED";
        payload = { ...payload, fulfilledAt: now, fulfilledBy: context.actorId, missionId };
        eventType = "warehouse.material_request.fulfilled";
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
        missionActionStopId = boundedText(input.stopId, 160);
        if (missionActionRoutePlanId) {
          const missionRouteStops = await db.select().from(routeStops).where(and(
            eq(routeStops.tenantId, context.tenantId),
            eq(routeStops.routePlanId, missionActionRoutePlanId),
          )).orderBy(routeStops.sequence).limit(100);
          if (!missionRouteStops.length) return Response.json({ error: "mission_route_not_available" }, { status: 409 });
          if (!missionActionStopId) return Response.json({ error: "mission_stop_required" }, { status: 400 });
          const selectedStop = missionRouteStops.find((stop) => stop.id === missionActionStopId);
          if (!selectedStop) return Response.json({ error: "mission_stop_not_found" }, { status: 404 });
          if (routeStopCompleted(selectedStop)) {
            return Response.json({ error: "mission_stop_already_completed", stopId: selectedStop.id }, { status: 409 });
          }
          if (action === "mission_load" && selectedStop.status === "LOADED") {
            return Response.json({ error: "mission_stop_already_loaded", stopId: selectedStop.id }, { status: 409 });
          }
          if (action === "mission_unload" && selectedStop.status === "UNLOADED") {
            return Response.json({ error: "mission_stop_already_unloaded", stopId: selectedStop.id }, { status: 409 });
          }
        }
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
          assetId: boundedText(input.assetId, 160) || boundedText(payload.cargoAssetId, 160) || null,
          source: "mission-driver-action",
        };
        missionActionEvent = actionEvent;
        const inventoryEffect = await prepareMissionInventoryEffects({
          tenantId: context.tenantId,
          jobId: job.id,
          missionId: row.id,
          payload,
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
        missionActionStopId = boundedText(input.stopId, 160);
        let missionRouteStops: (typeof routeStops.$inferSelect)[] = [];
        let selectedMissionStop: typeof routeStops.$inferSelect | null = null;
        if (missionActionRoutePlanId) {
          missionRouteStops = await db.select().from(routeStops).where(and(
            eq(routeStops.tenantId, context.tenantId),
            eq(routeStops.routePlanId, missionActionRoutePlanId),
          )).orderBy(routeStops.sequence).limit(100);
          if (!missionRouteStops.length) return Response.json({ error: "mission_route_not_available" }, { status: 409 });
          selectedMissionStop = missionActionStopId
            ? missionRouteStops.find((stop) => stop.id === missionActionStopId) ?? null
            : missionRouteStops.find((stop) => routeStopKind(stop) === "DELIVERY" && !routeStopCompleted(stop)) ?? null;
          if (!selectedMissionStop) return Response.json({ error: "mission_stop_not_found" }, { status: 404 });
          missionActionStopId = selectedMissionStop.id;
          if (routeStopKind(selectedMissionStop) !== "DELIVERY") {
            return Response.json({ error: "mission_delivery_stop_required", stopId: selectedMissionStop.id }, { status: 409 });
          }
          if (routeStopCompleted(selectedMissionStop)) {
            return Response.json({ error: "mission_stop_already_completed", stopId: selectedMissionStop.id }, { status: 409 });
          }
          if (selectedMissionStop.status !== "UNLOADED" && selectedMissionStop.deliveryStatus !== "UNLOADED") {
            return Response.json({ error: "mission_stop_unload_required", stopId: selectedMissionStop.id, message: "Registra prima lo scarico della tappa." }, { status: 409 });
          }
        }
        const warehouseReadback = await readMissionWarehouseReadback(context.tenantId, job.id, payload);
        if (warehouseReadback.required && warehouseReadback.status !== "DELIVERED") {
          return Response.json({
            error: "mission_material_unload_required",
            warehouseReadback,
            message: "Prima della conferma di consegna devi registrare lo scarico di tutte le righe materiali.",
          }, { status: 422 });
        }
        const timeline = Array.isArray(payload.operationalTimeline)
          ? payload.operationalTimeline.filter((entry): entry is JsonObject => isRecord(entry))
          : [];
        const deliveryEvent = {
          id: crypto.randomUUID(),
          type: "DELIVERY_CONFIRMED",
          recordedAt: now,
          occurredAt: now,
          recordedBy: context.actorId,
          stopId: missionActionStopId || null,
          sequence: typeof input.sequence === "number" && Number.isInteger(input.sequence) ? input.sequence : null,
          recipient,
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
          note: boundedText(input.note, 2_000),
          documentId: podEvidence.documentId,
          evidence: podEvidence,
          recordedBy: context.actorId,
        };
        const proofOfDeliveries = upsertDeliveryProof(payload, proofEntry);
        status = allDeliveryStopsComplete ? "DELIVERED" : row.status === "PARTIAL_DELIVERY" ? "PARTIAL_DELIVERY" : "DISPATCHED";
        payload = {
          ...payload,
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
        const warehouseReadback = await readMissionWarehouseReadback(context.tenantId, job.id, payload);
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
        const reportText = boundedText(input.text, 4_000);
        if (reportText.length < 2) return Response.json({ error: "mission_report_text_required" }, { status: 400 });
        const warehouseReadback = await readMissionWarehouseReadback(context.tenantId, job.id, payload);
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
      } else if (action === "mission_close") {
        if (domain !== "mission" || row.recordType !== "TRANSPORT" || row.status !== "RECONCILED") {
          return Response.json({ error: "invalid_mission_close_transition" }, { status: 409 });
        }
        const warehouseReadback = await readMissionWarehouseReadback(context.tenantId, job.id, payload);
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
        if (boundedText(savedReport.status, 24).toUpperCase() !== "SUBMITTED" || !reportReadback.completeness.ready) {
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
      ...(missionActionEvent ? { operationalEvent: missionActionEvent } : {}),
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

    const statements = [
      mutation,
      db.insert(s06Events).values({
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
      }),
      db.insert(s06Outbox).values({
        id: crypto.randomUUID(), tenantId: context.tenantId, eventId,
        topic: `zerow.${eventType}`, status: "PENDING_EXTERNAL_CONSUMER",
        attempts: 0, createdAt: now, updatedAt: now,
      }),
      db.insert(s06Reconciliations).values({
        id: crypto.randomUUID(), tenantId: context.tenantId,
        aggregateType: `job.journey.${domain}`, aggregateId: recordId,
        expectedVersion: nextVersion, observedVersion: nextVersion,
        status: "SITES_READBACK_VERIFIED",
        detail: "Passaggio della journey persistito con controllo versione e outbox.",
        createdAt: now, updatedAt: now,
      }),
    ] as unknown as never[];
    statements.push(...missionInventoryStatements);
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
      statements.push(db.update(routeStops).set({
        status: isDelivery ? "COMPLETED" : action === "mission_load" ? "LOADED" : "UNLOADED",
        deliveryStatus: isDelivery ? "CONFIRMED" : action === "mission_load" ? "LOADED" : "UNLOADED",
        arrivedAt: now,
        departedAt: isDelivery ? now : null,
        updatedAt: now,
      }).where(and(
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
        eq(jobJourneyRecords.version, materialRequest.version),
      )) as never);
    }
    const results = await db.batch(statements as [never, ...never[]]);
    const changed = (results[0] as (typeof jobJourneyRecords.$inferSelect)[])[0];
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
    return Response.json({ error: "job_journey_write_unavailable" }, { status: 503 });
  }
}
