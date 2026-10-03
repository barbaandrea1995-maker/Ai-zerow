import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import {
  inventoryItems,
  inventoryMovements,
  jobJourneyRecords,
  operationalDocuments,
  s04Records,
  s06Events,
  s06Outbox,
  s06Reconciliations,
} from "@/db/schema";
import { getAuthorityContext, hasCapability, publicAuthorityContext, type AuthorityContext } from "@/lib/authority-context";
import { documentCanDownload } from "@/lib/document-security";
import { inventoryMovementForResponse, milliToQuantity, quantityToMilli } from "@/lib/inventory-contract";
import { assertMissionResourceSelection, MissionResourceError } from "@/lib/mission-resources";
import { parseJobPayload } from "@/lib/operations-contract";
import { evaluatePlanning, normalizePlanningResource, normalizePlanningSlot, type PlanningResource, type PlanningSlot } from "@/lib/planning-contract";
import { PlanningResourceError as PlanningRegistryError, resolvePlanningResources } from "@/lib/planning-resources";
import { isTransportMode, type TransportMode } from "@/lib/tenant-operating-model";

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
  mission_create: "mission.write",
  mission_dispatch: "mission.write",
  mission_deliver: "mission.write",
  mission_verify_pod: "mission.write",
  mission_reconcile: "mission.write",
  mission_close: "mission.write",
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
  if (!hasCapability(context, capability)) {
    return Response.json({ error: "forbidden", capability }, { status: 403 });
  }
  if (action === "mission_create" && (!hasCapability(context, "workforce.registry.read") || !hasCapability(context, "asset.read"))) {
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
    let eventType = "";

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
        canonicalResources = await resolvePlanningResources(context.tenantId, input.resourceIds);
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
      const referencedIds = lines.flatMap((line) => line.itemId ? [line.itemId] : []);
      if (referencedIds.length) {
        const found = await db.select({ id: inventoryItems.id }).from(inventoryItems).where(and(
          eq(inventoryItems.tenantId, context.tenantId),
          inArray(inventoryItems.id, referencedIds),
        ));
        if (new Set(found.map((item) => item.id)).size !== new Set(referencedIds).size) {
          return Response.json({ error: "inventory_item_not_found" }, { status: 404 });
        }
      }
      status = "REQUESTED";
      payload = {
        neededAt: boundedText(input.neededAt, 40),
        deliveryPoint: boundedText(input.deliveryPoint, 240),
        notes: boundedText(input.notes, 2_000),
        lines,
      };
      eventType = "warehouse.material_request.created";
    } else if (action === "mission_create") {
      domain = "mission";
      recordType = "TRANSPORT";
      title = boundedText(input.title, 160, "Missione di trasporto");
      const pickup = boundedText(input.pickup, 240);
      const dropoff = boundedText(input.dropoff, 240);
      const plannedAt = boundedText(input.plannedAt, 40);
      const plannedEndAtInput = boundedText(input.plannedEndAt, 40);
      const driverId = boundedText(input.driverId, 120);
      const vehicleId = boundedText(input.vehicleId, 120);
      const cargoAssetId = boundedText(input.cargoAssetId, 120);
      const requestedTransportMode = boundedText(input.transportMode, 48);
      const transportMode: TransportMode = isTransportMode(requestedTransportMode)
        ? requestedTransportMode
        : cargoAssetId ? "ASSET_TRANSFER" : "WAREHOUSE_TO_JOB";
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
        resourceSnapshot: {
          driver: { id: resources.driver.id, code: resources.driver.code, label: resources.driver.label },
          vehicle: { id: resources.vehicle.id, code: resources.vehicle.code, label: resources.vehicle.label },
          cargoAsset: resources.cargoAsset
            ? { id: resources.cargoAsset.id, code: resources.cargoAsset.code, label: resources.cargoAsset.label }
            : null,
        },
        notes: boundedText(input.notes, 2_000),
      };
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
        if (decision !== "APPROVED" && decision !== "REJECTED") return Response.json({ error: "approval_decision_required" }, { status: 400 });
        status = decision;
        payload = { ...payload, reviewedAt: now, reviewedBy: context.actorId, reviewNote: boundedText(input.note, 2_000) };
        eventType = `warehouse.material_request.${decision.toLowerCase()}`;
      } else if (action === "material_fulfill") {
        if (domain !== "warehouse" || row.recordType !== "MATERIAL_REQUEST" || row.status !== "APPROVED") {
          return Response.json({ error: "invalid_material_request_transition" }, { status: 409 });
        }
        status = "FULFILLED";
        payload = { ...payload, fulfilledAt: now, fulfilledBy: context.actorId, missionId: boundedText(input.missionId, 120) || null };
        eventType = "warehouse.material_request.fulfilled";
      } else if (action === "mission_dispatch") {
        if (domain !== "mission" || row.recordType !== "TRANSPORT" || row.status !== "PLANNED") {
          return Response.json({ error: "invalid_mission_transition" }, { status: 409 });
        }
        status = "DISPATCHED";
        payload = { ...payload, dispatchedAt: boundedText(input.dispatchedAt, 40, now), dispatchedBy: context.actorId };
        eventType = "mission.transport.dispatched";
      } else if (action === "mission_deliver") {
        if (domain !== "mission" || row.recordType !== "TRANSPORT" || row.status !== "DISPATCHED") {
          return Response.json({ error: "invalid_mission_transition" }, { status: 409 });
        }
        const recipient = boundedText(input.recipient, 160);
        if (recipient.length < 2) return Response.json({ error: "proof_of_delivery_recipient_required" }, { status: 400 });
        const deliveredAt = boundedText(input.deliveredAt, 40, now);
        if (!validDateTime(deliveredAt)) return Response.json({ error: "valid_delivery_date_required" }, { status: 400 });
        status = "DELIVERED";
        payload = {
          ...payload,
          proofOfDelivery: {
            recipient,
            deliveredAt,
            note: boundedText(input.note, 2_000),
            documentId: boundedText(input.documentId, 120) || null,
            recordedBy: context.actorId,
          },
        };
        eventType = "mission.transport.delivered";
      } else if (action === "mission_verify_pod") {
        if (domain !== "mission" || row.recordType !== "TRANSPORT" || row.status !== "DELIVERED") {
          return Response.json({ error: "invalid_pod_verification_transition" }, { status: 409 });
        }
        const proof = isRecord(payload.proofOfDelivery) ? payload.proofOfDelivery : {};
        if (typeof proof.recipient !== "string" || proof.recipient.trim().length < 2 || typeof proof.deliveredAt !== "string" || !validDateTime(proof.deliveredAt)) {
          return Response.json({ error: "delivery_proof_readback_required" }, { status: 400 });
        }
        status = "POD_VERIFIED";
        payload = {
          ...payload,
          proofOfDelivery: { ...proof, verifiedAt: now, verifiedBy: context.actorId },
          podEvidenceDocumentId: boundedText(input.documentId, 120) || null,
        };
        eventType = "mission.transport.pod_verified";
      } else if (action === "mission_reconcile") {
        if (domain !== "mission" || row.recordType !== "TRANSPORT" || row.status !== "POD_VERIFIED") {
          return Response.json({ error: "invalid_mission_reconciliation_transition" }, { status: 409 });
        }
        const reconciliationNote = boundedText(input.note, 2_000);
        if (reconciliationNote.length < 2) return Response.json({ error: "reconciliation_note_required" }, { status: 400 });
        status = "RECONCILED";
        payload = { ...payload, reconciliation: { reconciledAt: now, reconciledBy: context.actorId, note: reconciliationNote } };
        eventType = "mission.transport.reconciled";
      } else if (action === "mission_close") {
        if (domain !== "mission" || row.recordType !== "TRANSPORT" || row.status !== "RECONCILED") {
          return Response.json({ error: "invalid_mission_close_transition" }, { status: 409 });
        }
        status = "CLOSED";
        payload = { ...payload, closedAt: now, closedBy: context.actorId };
        eventType = "mission.transport.closed";
      }
    }

    if (!status || !eventType) return Response.json({ error: "unsupported_journey_transition" }, { status: 409 });
    const recordId = existing?.id ?? crypto.randomUUID();
    const nextVersion = existing ? existing.version + 1 : 1;
    const eventId = crypto.randomUUID();
    const eventPayload = JSON.stringify({ action, jobId: job.id, domain, recordType, recordId, status, version: nextVersion });
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

    const results = await db.batch([
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
    ]);
    const changed = (results[0] as (typeof jobJourneyRecords.$inferSelect)[])[0];
    if (!changed) return Response.json({ error: "version_conflict" }, { status: 409 });
    return Response.json({
      ...(await journeyReadback(context, job)),
      mutation: { action, record: recordForResponse(changed), eventId, idempotent: false },
    }, {
      status: existing ? 200 : 201,
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/unique|constraint/i.test(message)) return Response.json({ error: "journey_idempotency_or_version_conflict" }, { status: 409 });
    return Response.json({ error: "job_journey_write_unavailable" }, { status: 503 });
  }
}
