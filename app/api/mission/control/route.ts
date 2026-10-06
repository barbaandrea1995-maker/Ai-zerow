import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { geofences, geoLocations, jobJourneyRecords, routePlans, routeStops, s04Records, s06Events, s06Outbox, s06Reconciliations } from "@/db/schema";
import { getAuthorityContext, hasCapability, publicAuthorityContext } from "@/lib/authority-context";
import { assertMissionResourceSelection, MissionResourceError } from "@/lib/mission-resources";
import { geofenceForResponse, locationForResponse } from "@/lib/location-intelligence/repository";
import { buildMissionRouteProjection, MissionRouteError, routeSummaryForPayload, type MissionStopInput } from "@/lib/location-intelligence/route-planner";
import { parseJobPayload } from "@/lib/operations-contract";
import { buildMissionReportReadback } from "@/lib/mission-contract";
import { allocateServerName } from "@/lib/server-naming";
import { isTransportMode, transportModesForProfile, type TransportMode } from "@/lib/tenant-operating-model";
import {
  canReadAllLocations,
  canReadAllMissions,
  canReadAllOperations,
  rowMatchesContext,
} from "@/lib/operational-scope";

export const dynamic = "force-dynamic";

function parseJson(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

function boundedText(value: unknown, max: number, fallback = "") {
  return typeof value === "string" ? value.trim().slice(0, max) : fallback;
}

function validDateTime(value: string) {
  return value.length >= 10 && Number.isFinite(Date.parse(value));
}

function locationReferences(value: unknown, output = new Set<string>(), depth = 0) {
  if (depth > 5 || !value || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    for (const item of value) locationReferences(item, output, depth + 1);
    return output;
  }
  for (const [key, child] of Object.entries(value)) {
    if (["locationId", "geoLocationId", "originEntityId", "destinationEntityId", "pickupEntityId", "dropoffEntityId"].includes(key)) {
      if (typeof child === "string" && child.trim()) output.add(child.trim());
    }
    if (["route", "stops", "routeReadback", "origin", "destination"].includes(key)) locationReferences(child, output, depth + 1);
  }
  return output;
}

function missionResponse(row: typeof jobJourneyRecords.$inferSelect, job: typeof s04Records.$inferSelect | null, idempotent: boolean) {
  return {
    context: null,
    jobId: row.jobId,
    missionId: row.id,
    record: {
      id: row.id,
      jobId: row.jobId,
      title: row.title,
      status: row.status,
      version: row.version,
      payload: parseJson(row.payloadJson),
    },
    job: job ? {
      id: job.id,
      code: job.canonicalCode,
      title: parseJobPayload(job.payloadJson).title || job.title,
      module: job.module,
    } : null,
    idempotent,
  };
}

export async function GET() {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "mission.read")) {
    return Response.json({ error: "forbidden", capability: "mission.read" }, { status: 403 });
  }
  try {
    const db = getDb();
    const [missions, operationJobs, materialRequestRows, locations, geofenceRows] = await Promise.all([
      db.select().from(jobJourneyRecords).where(and(
        eq(jobJourneyRecords.tenantId, context.tenantId),
        eq(jobJourneyRecords.domain, "mission"),
      )).orderBy(desc(jobJourneyRecords.updatedAt)).limit(500),
      db.select().from(s04Records).where(and(
        eq(s04Records.tenantId, context.tenantId),
        eq(s04Records.module, "operations"),
      )).orderBy(desc(s04Records.updatedAt)).limit(500),
      context.operatingDomains.includes("warehouse") && hasCapability(context, "mission.write")
        ? db.select().from(jobJourneyRecords).where(and(
          eq(jobJourneyRecords.tenantId, context.tenantId),
          eq(jobJourneyRecords.domain, "warehouse"),
          eq(jobJourneyRecords.recordType, "MATERIAL_REQUEST"),
          inArray(jobJourneyRecords.status, ["REQUESTED", "APPROVED", "FULFILLED", "REJECTED"]),
        )).orderBy(desc(jobJourneyRecords.updatedAt)).limit(500)
        : Promise.resolve([]),
      db.select().from(geoLocations).where(and(eq(geoLocations.tenantId, context.tenantId), eq(geoLocations.status, "ACTIVE"))).limit(500),
      db.select().from(geofences).where(and(eq(geofences.tenantId, context.tenantId), eq(geofences.status, "ACTIVE"))).limit(500),
    ]);
    const allOperationsVisible = canReadAllOperations(context);
    const allMissionsVisible = canReadAllMissions(context);
    const requestJobIds = new Set(materialRequestRows.map((request) => request.jobId));
    const visibleOperationJobs = operationJobs.filter((job) =>
      allOperationsVisible || requestJobIds.has(job.id) || rowMatchesContext(job, context),
    );
    const visibleJobIds = new Set(visibleOperationJobs.map((job) => job.id));
    const visibleMissionRows = missions.filter((mission) =>
      allMissionsVisible || visibleJobIds.has(mission.jobId) || rowMatchesContext(mission, context),
    );
    const visibleMaterialRequestRows = materialRequestRows.filter((request) =>
      allMissionsVisible || visibleJobIds.has(request.jobId) || rowMatchesContext(request, context),
    );
    const visibleLocationIds = new Set<string>();
    for (const mission of visibleMissionRows) locationReferences(parseJson(mission.payloadJson), visibleLocationIds);
    for (const job of visibleOperationJobs) locationReferences(parseJson(job.payloadJson), visibleLocationIds);
    const visibleLocations = canReadAllLocations(context)
      ? locations
      : locations.filter((location) => visibleLocationIds.has(location.id) || visibleLocationIds.has(location.entityId));
    const visibleGeofences = canReadAllLocations(context)
      ? geofenceRows
      : geofenceRows.filter((fence) => visibleLocations.some((location) => location.id === fence.locationId));
    const jobIds = [...new Set([
      ...visibleMissionRows.map((mission) => mission.jobId),
      ...visibleMaterialRequestRows.map((request) => request.jobId),
    ])];
    const jobs = jobIds.length ? await db.select().from(s04Records).where(and(
      eq(s04Records.tenantId, context.tenantId),
      inArray(s04Records.module, ["operations", "mission"]),
      inArray(s04Records.id, jobIds),
    )) : [];
    const jobById = new Map(jobs.map((job) => [job.id, job]));
    const routePlanRows = visibleMissionRows.length
      ? await db.select().from(routePlans).where(and(eq(routePlans.tenantId, context.tenantId), inArray(routePlans.missionId, visibleMissionRows.map((mission) => mission.id)))).limit(500)
      : [];
    const routeStopRows = routePlanRows.length
      ? await db.select().from(routeStops).where(and(eq(routeStops.tenantId, context.tenantId), inArray(routeStops.routePlanId, routePlanRows.map((plan) => plan.id)))).orderBy(routeStops.sequence).limit(1_000)
      : [];
    const routeStopsByPlan = new Map<string, typeof routeStops.$inferSelect[]>();
    for (const stop of routeStopRows) routeStopsByPlan.set(stop.routePlanId, [...(routeStopsByPlan.get(stop.routePlanId) ?? []), stop]);
    const routePlanByMission = new Map(routePlanRows.map((plan) => [plan.missionId ?? "", plan]));
    const records = visibleMissionRows.map((mission) => {
      const job = jobById.get(mission.jobId);
      const jobPayload = job ? parseJobPayload(job.payloadJson) : null;
      const routePlan = routePlanByMission.get(mission.id);
      const storedPayload = parseJson(mission.payloadJson);
      const routeReadback = routePlan ? {
        id: routePlan.id,
        status: routePlan.status,
        plannedStartAt: routePlan.plannedStartAt,
        startedAt: routePlan.startedAt,
        endedAt: routePlan.endedAt,
        stops: (routeStopsByPlan.get(routePlan.id) ?? []).map((stop) => ({
          id: stop.id,
          sequence: stop.sequence,
          locationId: stop.locationId,
          status: stop.status,
          deliveryStatus: stop.deliveryStatus,
          arrivedAt: stop.arrivedAt,
          departedAt: stop.departedAt,
          metadata: parseJson(stop.evidenceJson),
        })),
      } : null;
      const effectivePayload = { ...storedPayload, routeReadback };
      return {
        id: mission.id,
        jobId: mission.jobId,
        jobCode: job?.canonicalCode ?? null,
        jobTitle: jobPayload?.title ?? (job?.module === "mission" ? "Trasporto autonomo" : "Commessa"),
        jobModule: job?.module ?? "mission",
        title: mission.title,
        status: mission.status,
        version: mission.version,
        payload: {
          ...effectivePayload,
          missionReport: buildMissionReportReadback(effectivePayload),
        },
        createdAt: mission.createdAt,
        updatedAt: mission.updatedAt,
      };
    });
    const materialRequests = visibleMaterialRequestRows.map((request) => {
      const requestPayload = parseJson(request.payloadJson);
      const job = jobById.get(request.jobId);
      const jobPayload = job ? parseJobPayload(job.payloadJson) : null;
      return {
        id: request.id,
        jobId: request.jobId,
        jobCode: job?.canonicalCode ?? null,
        jobTitle: jobPayload?.title ?? "Commessa",
        title: request.title,
        status: request.status,
        version: request.version,
        payload: requestPayload,
        scheduledMissionId: boundedText(requestPayload.missionId, 120) || null,
        createdAt: request.createdAt,
        updatedAt: request.updatedAt,
      };
    });
    const jobView = (job: typeof s04Records.$inferSelect) => {
      const jobPayload = parseJobPayload(job.payloadJson);
      return {
        id: job.id,
        code: job.canonicalCode,
        title: jobPayload?.title || job.title,
        client: jobPayload?.clientName || jobPayload?.client || null,
        location: jobPayload?.worksite || jobPayload?.location || null,
        status: jobPayload?.statusCode || job.status,
      };
    };

    return Response.json({
      context: publicAuthorityContext(context),
      jobs: visibleOperationJobs.filter((job) => job.recordType !== "adapter-contract").map(jobView),
      missions: records,
      materialRequests,
      locations: visibleLocations.map((location) => ({
        ...locationForResponse(location),
        tenantId: undefined,
        geofence: visibleGeofences.find((fence) => fence.locationId === location.id) ? geofenceForResponse(visibleGeofences.find((fence) => fence.locationId === location.id)!) : null,
      })),
      summary: {
        total: records.length,
        planned: records.filter((record) => record.status === "PLANNED").length,
        dispatched: records.filter((record) => record.status === "DISPATCHED").length,
        delivered: records.filter((record) => record.status === "DELIVERED").length,
        toSchedule: materialRequests.filter((request) => request.status === "APPROVED" && !request.scheduledMissionId).length,
      },
    }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return Response.json({ error: "mission_control_unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "mission.manage")) {
    return Response.json({ error: "forbidden", capability: "mission.manage" }, { status: 403 });
  }
  if (!hasCapability(context, "mission.resources.read")) {
    return Response.json({ error: "mission_resource_registry_access_required" }, { status: 403 });
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > 65_536) return Response.json({ error: "payload_too_large" }, { status: 413 });

  let input: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 65_536) return Response.json({ error: "payload_too_large" }, { status: 413 });
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return Response.json({ error: "invalid_json" }, { status: 400 });
    input = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  if (boundedText(input.action, 40) !== "mission_create") return Response.json({ error: "unsupported_mission_action" }, { status: 400 });
  const idempotencyKey = boundedText(input.idempotencyKey, 160);
  const title = boundedText(input.title, 160, "Missione di trasporto");
  const pickup = boundedText(input.pickup, 240);
  const dropoff = boundedText(input.dropoff, 240);
  const plannedAt = boundedText(input.plannedAt, 40);
  const plannedEndAt = boundedText(input.plannedEndAt, 40);
  const driverId = boundedText(input.driverId, 120);
  const vehicleId = boundedText(input.vehicleId, 120);
  const cargoAssetId = boundedText(input.cargoAssetId, 120);
  const materialRequestId = boundedText(input.materialRequestId, 120);
  const routeInputStops = input.routeStops ?? input.stops;
  const requestedTransportMode = boundedText(input.transportMode, 48);
  const transportMode: TransportMode = isTransportMode(requestedTransportMode)
    ? requestedTransportMode
    : cargoAssetId ? "ASSET_TRANSFER" : "WAREHOUSE_TO_RECIPIENT";
  if (!idempotencyKey) return Response.json({ error: "idempotency_key_required" }, { status: 400 });
  if (!pickup || !dropoff || !validDateTime(plannedAt)) return Response.json({ error: "mission_route_and_valid_date_required" }, { status: 400 });
  if (!driverId || !vehicleId) return Response.json({ error: "mission_driver_and_vehicle_required" }, { status: 400 });
  if (!context.operatingTransportModes.includes(transportMode)) {
    return Response.json({ error: "transport_mode_not_enabled", transportMode, enabledModes: context.operatingTransportModes.length ? context.operatingTransportModes : transportModesForProfile(context.operatingProfile) }, { status: 403 });
  }
  if (transportMode === "ASSET_TRANSFER" && !cargoAssetId) {
    return Response.json({ error: "cargo_asset_required_for_asset_transfer" }, { status: 400 });
  }
  if (transportMode === "WAREHOUSE_TO_JOB") {
    return Response.json({ error: "warehouse_to_job_requires_commessa" }, { status: 400 });
  }
  if (Object.prototype.hasOwnProperty.call(input, "driver") || Object.prototype.hasOwnProperty.call(input, "vehicle")) {
    return Response.json({ error: "mission_free_text_resources_not_allowed" }, { status: 400 });
  }

  try {
    const resources = await assertMissionResourceSelection({
      tenantId: context.tenantId,
      driverId,
      vehicleId,
      cargoAssetId: cargoAssetId || undefined,
      transportMode,
      plannedAt,
      plannedEndAt: plannedEndAt || undefined,
    });
    const db = getDb();
    const [existingEvent] = await db.select().from(s06Events).where(and(
      eq(s06Events.tenantId, context.tenantId),
      eq(s06Events.idempotencyKey, idempotencyKey),
    )).limit(1);
    if (existingEvent) {
      if (existingEvent.aggregateType !== "job.journey.mission") return Response.json({ error: "mission_idempotency_key_conflict" }, { status: 409 });
      const [existingRecord] = await db.select().from(jobJourneyRecords).where(and(
        eq(jobJourneyRecords.tenantId, context.tenantId),
        eq(jobJourneyRecords.id, existingEvent.aggregateId),
      )).limit(1);
      if (!existingRecord) return Response.json({ error: "mission_readback_unavailable" }, { status: 503 });
      const [existingJob] = await db.select().from(s04Records).where(and(
        eq(s04Records.tenantId, context.tenantId),
        eq(s04Records.id, existingRecord.jobId),
        eq(s04Records.module, "mission"),
      )).limit(1);
      if (!existingJob) return Response.json({ error: "mission_idempotency_key_conflict" }, { status: 409 });
      return Response.json({ ...missionResponse(existingRecord, existingJob ?? null, true), context: publicAuthorityContext(context) }, { headers: { "cache-control": "private, no-store" } });
    }

    const now = new Date().toISOString();
    const jobId = crypto.randomUUID();
    const missionId = crypto.randomUUID();
    const eventId = crypto.randomUUID();
    const routeFallbackStops: MissionStopInput[] = [];
    const originEntityId = boundedText(input.originEntityId ?? input.pickupEntityId, 160);
    const originEntityType = boundedText(input.originEntityType ?? input.pickupEntityType, 48).toUpperCase();
    const destinationEntityId = boundedText(input.destinationEntityId ?? input.dropoffEntityId, 160);
    const destinationEntityType = boundedText(input.destinationEntityType ?? input.dropoffEntityType, 48).toUpperCase();
    if (originEntityId && originEntityType) routeFallbackStops.push({ kind: "PICKUP", entityType: originEntityType, entityId: originEntityId, label: pickup, cargoActions: [{ action: "LOAD", assetId: cargoAssetId || null }] });
    if (destinationEntityId && destinationEntityType) routeFallbackStops.push({ kind: "DELIVERY", entityType: destinationEntityType, entityId: destinationEntityId, label: dropoff, cargoActions: [{ action: "UNLOAD", assetId: cargoAssetId || null }] });
    let routeProjection: Awaited<ReturnType<typeof buildMissionRouteProjection>> = null;
    try {
      routeProjection = await buildMissionRouteProjection({
        tenantId: context.tenantId,
        missionId,
        jobId,
        driverId: resources.driver.id,
        vehicleId: resources.vehicle.id,
        plannedStartAt: resources.window.startsAt,
        createdBy: context.actorId,
        stops: routeInputStops,
        fallbackStops: routeFallbackStops,
        cargoAssetId: resources.cargoAsset?.id ?? null,
        materialRequestId: materialRequestId || null,
      });
    } catch (error) {
      if (error instanceof MissionRouteError) return Response.json({ error: error.code, details: error.details }, { status: 409 });
      throw error;
    }
    const naming = await allocateServerName({ tenantId: context.tenantId, module: "mission", description: title });
    const jobPayload = {
      title,
      description: `Trasporto autonomo: ${pickup} → ${dropoff}`,
      client: "",
      location: pickup,
      category: "TRASPORTO",
      priority: "STANDARD",
      dueDate: resources.window.endsAt,
      statusCode: "PLANNED",
      version: 1,
      workItems: [],
      progress: 0,
      activities: [],
      evidence: [],
      assignment: null,
      source: "mission-standalone",
    };
    const payload = {
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
      route: routeSummaryForPayload(routeProjection),
      standalone: true,
    };

    const statements = [
      db.insert(s04Records).values({
        id: jobId,
        tenantId: context.tenantId,
        module: "mission",
        canonicalCode: naming?.canonicalCode ?? null,
        recordType: "transport-job",
        title,
        detail: `Trasporto autonomo · ${pickup} → ${dropoff}`,
        meta: "MISSION / STANDALONE",
        status: "PLANNED",
        tone: "lime",
        progress: 0,
        payloadJson: JSON.stringify(jobPayload),
        createdBy: context.actorId,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(jobJourneyRecords).values({
        id: missionId,
        tenantId: context.tenantId,
        jobId,
        domain: "mission",
        recordType: "TRANSPORT",
        title,
        status: "PLANNED",
        version: 1,
        payloadJson: JSON.stringify(payload),
        idempotencyKey,
        createdBy: context.actorId,
        updatedBy: context.actorId,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(s06Events).values({
        eventId,
        tenantId: context.tenantId,
        eventType: "mission.transport.created",
        schemaVersion: "1",
        actorType: "human",
        actorId: context.actorId,
        source: "sites-mission-control",
        occurredAt: now,
        observedAt: now,
        aggregateType: "job.journey.mission",
        aggregateId: missionId,
        aggregateVersion: 1,
        payloadJson: JSON.stringify({ action: "mission_create", jobId, domain: "mission", recordType: "TRANSPORT", recordId: missionId, status: "PLANNED", version: 1, standalone: true }),
        correlationId: crypto.randomUUID(),
        causationId: null,
        idempotencyKey,
        status: "COMMITTED_SITES_READBACK",
        createdAt: now,
      }),
      db.insert(s06Outbox).values({ id: crypto.randomUUID(), tenantId: context.tenantId, eventId, topic: "zerow.mission.transport.created", status: "PENDING_EXTERNAL_CONSUMER", attempts: 0, createdAt: now, updatedAt: now }),
      db.insert(s06Reconciliations).values({ id: crypto.randomUUID(), tenantId: context.tenantId, aggregateType: "job.journey.mission", aggregateId: missionId, expectedVersion: 1, observedVersion: 1, status: "SITES_READBACK_VERIFIED", detail: "Missione autonoma persistita con risorse reali, finestra temporale e readback D1.", createdAt: now, updatedAt: now }),
    ] as unknown as never[];
    if (routeProjection) {
      for (const temporary of routeProjection.temporaryLocations) {
        statements.push(db.insert(geoLocations).values(temporary.location) as never);
        statements.push(db.insert(geofences).values(temporary.geofence) as never);
      }
      statements.push(db.insert(routePlans).values(routeProjection.plan) as never);
      for (const stop of routeProjection.stops) statements.push(db.insert(routeStops).values(stop) as never);
    }
    const results = await db.batch(statements as [never, ...never[]]);
    if (!results[0] || !results[1]) return Response.json({ error: "mission_readback_unavailable" }, { status: 503 });
    const [createdJob] = await db.select().from(s04Records).where(and(eq(s04Records.tenantId, context.tenantId), eq(s04Records.id, jobId))).limit(1);
    const [createdRecord] = await db.select().from(jobJourneyRecords).where(and(eq(jobJourneyRecords.tenantId, context.tenantId), eq(jobJourneyRecords.id, missionId))).limit(1);
    if (!createdRecord) return Response.json({ error: "mission_readback_unavailable" }, { status: 503 });
    return Response.json({ ...missionResponse(createdRecord, createdJob ?? null, false), context: publicAuthorityContext(context), eventId }, { status: 201, headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof MissionResourceError) {
      return Response.json({ error: error.code, details: error.details ?? null }, { status: error.code === "mission_resource_conflict" ? 409 : 400 });
    }
    const message = error instanceof Error ? error.message : "";
    if (/unique|constraint/i.test(message)) return Response.json({ error: "mission_idempotency_or_code_conflict" }, { status: 409 });
    return Response.json({ error: "mission_create_unavailable" }, { status: 503 });
  }
}
