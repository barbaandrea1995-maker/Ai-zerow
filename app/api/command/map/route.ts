import { and, asc, desc, eq, gt, inArray, max, or } from "drizzle-orm";
import { getDb } from "@/db";
import {
  geofences,
  geoLocations,
  jobJourneyRecords,
  locationEvents,
  locationSamples,
  routePlans,
  routeStops,
  s04Records,
  tenantMemberships,
  tenantWarehouses,
  trackingDevices,
  trackingSessions,
} from "@/db/schema";
import { getAuthorityContext, hasCapability, publicAuthorityContext } from "@/lib/authority-context";
import { auditLocationAccess, eventForResponse } from "@/lib/location-intelligence/repository";
import { storedMissionException } from "@/lib/mission-exception-contract";
import { getLocationProviderStatus } from "@/lib/location-intelligence/providers";
import { recordForResponse } from "@/lib/s04-adapter";
import { canReadAllLocations, rowMatchesContext, teamScopeTokens } from "@/lib/operational-scope";

export const dynamic = "force-dynamic";

const MAP_READ_PAGE_SIZE = 500;
const MAP_READ_BATCH_SIZE = 100;

async function readAllById<T extends { id: string }>(fetchPage: (afterId?: string) => Promise<T[]>) {
  const rows: T[] = [];
  let afterId: string | undefined;
  while (true) {
    const page = await fetchPage(afterId);
    rows.push(...page);
    if (page.length < MAP_READ_PAGE_SIZE) return rows;
    const lastId = page[page.length - 1]?.id;
    if (!lastId || lastId === afterId) throw new Error("command_map_readback_page_cursor_stalled");
    afterId = lastId;
  }
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

async function readInBatches<T, R>(items: T[], size: number, readBatch: (batch: T[]) => Promise<R[]>) {
  const batches = chunks(items, size);
  const results: R[] = [];
  for (let index = 0; index < batches.length; index += 8) {
    const pages = await Promise.all(batches.slice(index, index + 8).map(readBatch));
    results.push(...pages.flat());
  }
  return results;
}

function roundedCoordinate(valueE6: number) {
  return Math.round((valueE6 / 1_000_000) * 10_000) / 10_000;
}

function payloadText(payload: Record<string, unknown>, key: string) {
  return typeof payload[key] === "string" ? String(payload[key]).trim() : "";
}

function parseJson(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function locationLabel(entityType: string, entityId: string, records: Map<string, ReturnType<typeof recordForResponse>>, warehouseById: Map<string, typeof tenantWarehouses.$inferSelect>) {
  const record = records.get(entityId);
  if (record) {
    const title = payloadText(record.payload, "title") || record.title;
    return title || record.canonicalCode || entityId;
  }
  const warehouse = warehouseById.get(entityId);
  if (warehouse) return warehouse.name;
  return entityType === "MAGAZZINO" ? `Magazzino ${entityId}` : entityId;
}

function assetLabel(vehicleId: string, records: Map<string, ReturnType<typeof recordForResponse>>) {
  const record = records.get(vehicleId);
  if (!record) return `Mezzo ${vehicleId}`;
  return payloadText(record.payload, "title") || record.title || record.canonicalCode || `Mezzo ${vehicleId}`;
}

function locationPresentation(
  entityType: string,
  entityId: string,
  records: Map<string, ReturnType<typeof recordForResponse>>,
  warehouseById: Map<string, typeof tenantWarehouses.$inferSelect>,
) {
  const record = records.get(entityId);
  const warehouse = warehouseById.get(entityId);
  const payload = record?.payload ?? {};
  const isWarehouse = entityType === "MAGAZZINO";
  return {
    code: record?.canonicalCode || warehouse?.code || null,
    description: payloadText(payload, "description") || record?.detail || (warehouse ? `Sede operativa di ${warehouse.name}` : "Sede operativa"),
    client: payloadText(payload, "clientName") || payloadText(payload, "client") || null,
    category: payloadText(payload, "category") || (isWarehouse ? "Deposito e movimentazione" : null),
    openingType: payloadText(payload, "openingType") || null,
    jobType: payloadText(payload, "jobType") || null,
    specialization: payloadText(payload, "specialization") || null,
    dueDate: payloadText(payload, "dueDate") || null,
    priority: payloadText(payload, "priority") || null,
    operationalStatus: record?.status || warehouse?.status || null,
    progress: record?.progress ?? null,
    geofenceRadiusMeters: warehouse?.geofenceRadiusMeters ?? null,
    locationSource: warehouse?.locationSource || null,
  };
}

function sampleState(recordedAt: string) {
  const timestamp = Date.parse(recordedAt);
  if (!Number.isFinite(timestamp)) return "UNKNOWN" as const;
  const ageSeconds = Math.max(0, (Date.now() - timestamp) / 1_000);
  if (ageSeconds <= 5 * 60) return "LIVE" as const;
  if (ageSeconds <= 30 * 60) return "RECENT" as const;
  return "STALE" as const;
}

function terminalStatus(value: string | null | undefined) {
  return ["CLOSED", "COMPLETED", "CANCELLED", "CANCELED", "EXPIRED", "ARCHIVED"].includes(String(value ?? "").toUpperCase());
}

export async function GET() {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "command.read")) return Response.json({ error: "forbidden", capability: "command.read" }, { status: 403 });

  const canReadCurrent = hasCapability(context, "location.read.current")
    || hasCapability(context, "location.read.history")
    || hasCapability(context, "location.view.fleet")
    || hasCapability(context, "location.manage.geofences");
  if (!canReadCurrent) return Response.json({ error: "forbidden", capability: "location.read.current" }, { status: 403 });

  const canViewFleet = hasCapability(context, "location.view.fleet") || hasCapability(context, "location.audit.read");
  const canReadMissions = hasCapability(context, "mission.read");
  const capability = ([
    "location.view.fleet",
    "location.audit.read",
    "location.read.current",
    "location.read.history",
    "location.manage.geofences",
  ] as const).find((candidate) => hasCapability(context, candidate)) ?? "location.read.current";

  try {
    const db = getDb();
    const [locationRows, fenceRows, warehouseRows, catalogRows, eventRows, sessionRows, missionRows] = await Promise.all([
      readAllById((afterId) => db.select().from(geoLocations).where(afterId
        ? and(eq(geoLocations.tenantId, context.tenantId), eq(geoLocations.status, "ACTIVE"), gt(geoLocations.id, afterId))
        : and(eq(geoLocations.tenantId, context.tenantId), eq(geoLocations.status, "ACTIVE")))
        .orderBy(asc(geoLocations.id)).limit(MAP_READ_PAGE_SIZE)),
      readAllById((afterId) => db.select().from(geofences).where(afterId
        ? and(eq(geofences.tenantId, context.tenantId), eq(geofences.status, "ACTIVE"), gt(geofences.id, afterId))
        : and(eq(geofences.tenantId, context.tenantId), eq(geofences.status, "ACTIVE")))
        .orderBy(asc(geofences.id)).limit(MAP_READ_PAGE_SIZE)),
      readAllById((afterId) => db.select().from(tenantWarehouses).where(afterId
        ? and(eq(tenantWarehouses.tenantId, context.tenantId), eq(tenantWarehouses.status, "active"), gt(tenantWarehouses.id, afterId))
        : and(eq(tenantWarehouses.tenantId, context.tenantId), eq(tenantWarehouses.status, "active")))
        .orderBy(asc(tenantWarehouses.id)).limit(MAP_READ_PAGE_SIZE)),
      readAllById((afterId) => db.select().from(s04Records).where(afterId
        ? and(eq(s04Records.tenantId, context.tenantId), inArray(s04Records.module, ["operations", "assets", "warehouse"]), gt(s04Records.id, afterId))
        : and(eq(s04Records.tenantId, context.tenantId), inArray(s04Records.module, ["operations", "assets", "warehouse"])))
        .orderBy(asc(s04Records.id)).limit(MAP_READ_PAGE_SIZE)),
      db.select().from(locationEvents)
        .where(and(
          eq(locationEvents.tenantId, context.tenantId),
          ...(canViewFleet ? [] : [eq(locationEvents.employeeId, context.actorId)]),
        ))
        .orderBy(desc(locationEvents.occurredAt))
        .limit(500),
      readAllById((afterId) => db.select().from(trackingSessions).where(afterId
        ? and(
          eq(trackingSessions.tenantId, context.tenantId),
          eq(trackingSessions.status, "ACTIVE"),
          ...(canViewFleet ? [] : [eq(trackingSessions.employeeId, context.actorId)]),
          gt(trackingSessions.id, afterId),
        )
        : and(
          eq(trackingSessions.tenantId, context.tenantId),
          eq(trackingSessions.status, "ACTIVE"),
          ...(canViewFleet ? [] : [eq(trackingSessions.employeeId, context.actorId)]),
        )).orderBy(asc(trackingSessions.id)).limit(MAP_READ_PAGE_SIZE)),
      canReadMissions
        ? readAllById((afterId) => db.select().from(jobJourneyRecords).where(afterId
          ? and(eq(jobJourneyRecords.tenantId, context.tenantId), eq(jobJourneyRecords.domain, "mission"), gt(jobJourneyRecords.id, afterId))
          : and(eq(jobJourneyRecords.tenantId, context.tenantId), eq(jobJourneyRecords.domain, "mission")))
          .orderBy(asc(jobJourneyRecords.id)).limit(MAP_READ_PAGE_SIZE))
        : Promise.resolve([]),
    ]);
    locationRows.sort((left, right) => left.entityType.localeCompare(right.entityType) || left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id));
    fenceRows.sort((left, right) => left.entityType.localeCompare(right.entityType) || left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id));
    warehouseRows.sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
    catalogRows.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
    sessionRows.sort((left, right) => right.startedAt.localeCompare(left.startedAt) || left.id.localeCompare(right.id));
    missionRows.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));

    const allLocationsVisible = canReadAllLocations(context);
    const scopeTokens = teamScopeTokens(catalogRows, context);
    const visibleCatalogRows = allLocationsVisible
      ? catalogRows
      : catalogRows.filter((row) => rowMatchesContext(row, context, scopeTokens));
    const visibleCatalogIds = new Set(visibleCatalogRows.flatMap((row) => [row.id, row.canonicalCode].filter(Boolean)));
    const visibleMissionRows = canReadMissions
      ? missionRows.filter((mission) => canViewFleet || visibleCatalogIds.has(mission.jobId))
      : [];

    // Mission routes are read only through the already-authorized mission set.
    // Temporary delivery places are projected separately below; they never
    // enter the canonical `locations` collection.
    const operationalMissions = visibleMissionRows.filter((mission) => !terminalStatus(mission.status));
    const routePlanRows = operationalMissions.length
      ? await readInBatches(operationalMissions.map((mission) => mission.id), MAP_READ_BATCH_SIZE, (batch) => db.select().from(routePlans).where(and(
        eq(routePlans.tenantId, context.tenantId),
        inArray(routePlans.missionId, batch),
      )).orderBy(asc(routePlans.id)))
      : [];
    const operationalRoutePlans = routePlanRows.filter((plan) => !terminalStatus(plan.status));
    const routeStopRows = operationalRoutePlans.length
      ? await readInBatches(operationalRoutePlans.map((plan) => plan.id), MAP_READ_BATCH_SIZE, (batch) => db.select().from(routeStops).where(and(
        eq(routeStops.tenantId, context.tenantId),
        inArray(routeStops.routePlanId, batch),
      )).orderBy(asc(routeStops.sequence)))
      : [];
    const temporaryLocationIds = [...new Set(routeStopRows.map((stop) => stop.locationId).filter(Boolean))];
    const temporaryLocationRows = temporaryLocationIds.length
      ? await readInBatches(temporaryLocationIds, MAP_READ_BATCH_SIZE, (batch) => db.select().from(geoLocations).where(and(
        eq(geoLocations.tenantId, context.tenantId),
        eq(geoLocations.status, "TEMPORARY"),
        inArray(geoLocations.id, batch),
      )))
      : [];
    const temporaryLocationIdSet = new Set(temporaryLocationRows.map((location) => location.id));
    const temporaryFenceRows = temporaryLocationRows.length
      ? await readInBatches(temporaryLocationRows.map((location) => location.id), MAP_READ_BATCH_SIZE, (batch) => db.select().from(geofences).where(and(
        eq(geofences.tenantId, context.tenantId),
        eq(geofences.status, "TEMPORARY"),
        inArray(geofences.locationId, batch),
      )))
      : [];
    const temporaryLocationById = new Map(temporaryLocationRows.map((location) => [location.id, location] as const));
    const temporaryFenceByLocationId = new Map(temporaryFenceRows.map((fence) => [fence.locationId, fence] as const));
    const missionById = new Map(visibleMissionRows.map((mission) => [mission.id, mission] as const));
    const routePlanById = new Map(operationalRoutePlans.map((plan) => [plan.id, plan] as const));
    const routePlanByMissionId = new Map(operationalRoutePlans.flatMap((plan) => plan.missionId ? [[plan.missionId, plan] as const] : []));
    const stopsByRoutePlan = new Map<string, typeof routeStops.$inferSelect[]>();
    for (const stop of routeStopRows) stopsByRoutePlan.set(stop.routePlanId, [...(stopsByRoutePlan.get(stop.routePlanId) ?? []), stop]);
    const temporaryStops = routeStopRows.flatMap((stop) => {
      if (!temporaryLocationIdSet.has(stop.locationId)) return [];
      const plan = routePlanById.get(stop.routePlanId);
      const mission = plan?.missionId ? missionById.get(plan.missionId) : null;
      const location = temporaryLocationById.get(stop.locationId);
      if (!plan || !mission || !location) return [];
      const metadata = parseJson(stop.evidenceJson);
      const job = visibleCatalogRows.find((row) => row.id === mission.jobId);
      return [{
        id: stop.id,
        routePlanId: plan.id,
        missionId: mission.id,
        missionTitle: mission.title,
        jobTitle: job?.title ?? null,
        missionStatus: mission.status,
        routeStatus: plan.status,
        sequence: stop.sequence,
        kind: payloadText(metadata, "kind").toUpperCase() || "STOP",
        label: payloadText(metadata, "label") || location.formattedAddress || `Tappa ${stop.sequence}`,
        address: location.formattedAddress,
        locationId: location.id,
        coordinates: { latitude: roundedCoordinate(location.latitudeE6), longitude: roundedCoordinate(location.longitudeE6) },
        status: stop.status,
        deliveryStatus: stop.deliveryStatus,
        expectedArrivalAt: stop.expectedArrivalAt,
        arrivedAt: stop.arrivedAt,
        departedAt: stop.departedAt,
        geofenceId: payloadText(metadata, "geofenceId") || temporaryFenceByLocationId.get(location.id)?.id || null,
        geofenceRadiusMeters: temporaryFenceByLocationId.get(location.id)?.radiusMeters ?? null,
        temporary: true as const,
      }];
    });
    const eventLocationIds = new Set(eventRows.map((event) => event.locationId).filter((value): value is string => Boolean(value)));
    const visibleLocationRows = allLocationsVisible
      ? locationRows
      : locationRows.filter((location) =>
        visibleCatalogIds.has(location.entityId)
        || eventLocationIds.has(location.id)
        || (location.entityType === "MAGAZZINO" && hasCapability(context, "warehouse.read")),
      );
    const visibleFenceRows = allLocationsVisible
      ? fenceRows
      : fenceRows.filter((fence) => visibleLocationRows.some((location) => location.id === fence.locationId));
    const visibleGeofenceRows = [...visibleFenceRows, ...temporaryFenceRows];
    const records = new Map(visibleCatalogRows.map((row) => {
      const parsed = recordForResponse(row);
      return [parsed.id, parsed] as const;
    }));
    const warehouseById = new Map(warehouseRows.map((warehouse) => [warehouse.id, warehouse] as const));
    const knownLocationEntities = new Set(visibleLocationRows.map((location) => `${location.entityType}:${location.entityId}`));
    const missionExceptions = visibleMissionRows.flatMap((mission) => {
      const exception = storedMissionException(parseJson(mission.payloadJson).missionException);
      if (!exception) return [];
      const linkedRecord = visibleCatalogRows.find((row) => row.id === mission.jobId);
      return [{
        missionId: mission.id,
        jobId: mission.jobId,
        title: mission.title,
        jobTitle: linkedRecord?.title ?? null,
        missionStatus: mission.status,
        type: exception.type,
        note: exception.note,
        reference: exception.reference,
        stopId: exception.stopId,
        recoveryStatus: exception.recoveryStatus,
        reportedAt: exception.reportedAt,
        reportedBy: exception.reportedBy,
        resolvedAt: exception.resolvedAt ?? null,
        resolvedBy: exception.resolvedBy ?? null,
        resolutionNote: exception.resolutionNote ?? null,
        updatedAt: mission.updatedAt,
      }];
    });

    const locations = visibleLocationRows.map((location) => ({
      ...locationPresentation(location.entityType, location.entityId, records, warehouseById),
      id: location.id,
      entityType: location.entityType,
      entityId: location.entityId,
      label: locationLabel(location.entityType, location.entityId, records, warehouseById),
      address: location.formattedAddress,
      coordinates: { latitude: roundedCoordinate(location.latitudeE6), longitude: roundedCoordinate(location.longitudeE6) },
      provider: location.provider,
      verified: Boolean(location.verifiedByUser),
      status: location.status,
      updatedAt: location.updatedAt,
    }));

    const warehouseLocations = warehouseRows.flatMap((warehouse) => {
      if (knownLocationEntities.has(`MAGAZZINO:${warehouse.id}`)) return [];
      return [{
        ...locationPresentation("MAGAZZINO", warehouse.id, records, warehouseById),
        id: `warehouse-location:${warehouse.id}`,
        entityType: "MAGAZZINO",
        entityId: warehouse.id,
        label: warehouse.name,
        address: warehouse.locationLabel,
        coordinates: { latitude: roundedCoordinate(warehouse.latitudeE6), longitude: roundedCoordinate(warehouse.longitudeE6) },
        provider: warehouse.locationSource.toUpperCase() === "GEOAPIFY" ? "GEOAPIFY" : "SERVER_VALIDATED",
        verified: true,
        status: warehouse.status,
        updatedAt: warehouse.updatedAt,
      }];
    });

    const mergedLocations = [...locations, ...warehouseLocations];
    const latestSessionByVehicle = new Map<string, typeof trackingSessions.$inferSelect>();
    for (const session of sessionRows) if (!latestSessionByVehicle.has(session.vehicleId)) latestSessionByVehicle.set(session.vehicleId, session);
    const currentSessions = [...latestSessionByVehicle.values()];
    const sampleSessions = chunks(currentSessions.map((session) => session.id), MAP_READ_BATCH_SIZE);
    const latestRecordedAtBySession = new Map<string, { vehicleId: string; recordedAt: string }>();
    for (const sessionBatch of sampleSessions) {
      if (sessionBatch.length === 0) continue;
      const latestTimes = await db.select({
        trackingSessionId: locationSamples.trackingSessionId,
        vehicleId: locationSamples.vehicleId,
        recordedAt: max(locationSamples.recordedAt),
      }).from(locationSamples).where(and(
        eq(locationSamples.tenantId, context.tenantId),
        inArray(locationSamples.trackingSessionId, sessionBatch),
      )).groupBy(locationSamples.trackingSessionId, locationSamples.vehicleId);
      for (const row of latestTimes) {
        if (!row.recordedAt || !row.trackingSessionId) continue;
        latestRecordedAtBySession.set(row.trackingSessionId, { vehicleId: row.vehicleId, recordedAt: row.recordedAt });
      }
    }
    const latestSamplePairs = [...latestRecordedAtBySession].map(([trackingSessionId, sample]) => ({ trackingSessionId, ...sample }));
    const sampleRows = await readInBatches(latestSamplePairs, MAP_READ_BATCH_SIZE, (sampleBatch) => db.select().from(locationSamples).where(and(
        eq(locationSamples.tenantId, context.tenantId),
        or(...sampleBatch.map((sample) => and(
          eq(locationSamples.trackingSessionId, sample.trackingSessionId),
          eq(locationSamples.vehicleId, sample.vehicleId),
          eq(locationSamples.recordedAt, sample.recordedAt),
        ))),
      )).orderBy(desc(locationSamples.recordedAt), desc(locationSamples.id)));

    const deviceIds = [...new Set(sampleRows.map((sample) => sample.trackingDeviceId).filter(Boolean))];
    const devices = deviceIds.length
      ? await readInBatches(deviceIds, MAP_READ_BATCH_SIZE, (batch) => db.select().from(trackingDevices)
        .where(and(eq(trackingDevices.tenantId, context.tenantId), inArray(trackingDevices.id, batch))))
      : [];
    const deviceById = new Map(devices.map((device) => [device.id, device] as const));
    const sessionByVehicle = latestSessionByVehicle;
    const driverIds = [...new Set(currentSessions.map((session) => session.employeeId))];
    const driverRows = driverIds.length
      ? await readInBatches(driverIds, MAP_READ_BATCH_SIZE, (batch) => db.select().from(tenantMemberships).where(and(
        eq(tenantMemberships.tenantId, context.tenantId),
        eq(tenantMemberships.status, "active"),
        inArray(tenantMemberships.actorId, batch),
      )))
      : [];
    const driverNameById = new Map(driverRows.map((driver) => [driver.actorId, driver.displayName] as const));
    const latestByVehicle = new Map<string, typeof sampleRows[number]>();
    for (const sample of sampleRows) if (!latestByVehicle.has(sample.vehicleId)) latestByVehicle.set(sample.vehicleId, sample);

    const vehicles = [...latestByVehicle.values()].map((sample) => {
      const session = sessionByVehicle.get(sample.vehicleId);
      const device = deviceById.get(sample.trackingDeviceId);
      const sessionState = session ? parseJson(session.engineStateJson) : {};
      const operationalContext = sessionState.__operationalContext && typeof sessionState.__operationalContext === "object" && !Array.isArray(sessionState.__operationalContext)
        ? sessionState.__operationalContext as Record<string, unknown>
        : {};
      const missionId = payloadText(operationalContext, "missionId");
      const mission = missionId ? missionById.get(missionId) : null;
      const plan = missionId ? routePlanByMissionId.get(missionId) : null;
      const currentStop = plan
        ? (stopsByRoutePlan.get(plan.id) ?? []).find((stop) => !["COMPLETED", "DEPARTED"].includes(stop.status.toUpperCase()))
        : null;
      const currentStopMetadata = currentStop ? parseJson(currentStop.evidenceJson) : {};
      return {
        id: sample.vehicleId,
        label: assetLabel(sample.vehicleId, records),
        coordinates: { latitude: roundedCoordinate(sample.latitudeE6), longitude: roundedCoordinate(sample.longitudeE6) },
        recordedAt: sample.recordedAt,
        state: sampleState(sample.recordedAt),
        accuracyM: sample.accuracyM,
        speedKmh: sample.speedKmh,
        heading: sample.heading,
        trackingSessionId: sample.trackingSessionId,
        employeeId: session?.employeeId ?? null,
        driverName: session ? driverNameById.get(session.employeeId) ?? null : null,
        missionId: mission?.id ?? null,
        missionTitle: mission?.title ?? null,
        nextStop: currentStop ? {
          sequence: currentStop.sequence,
          label: payloadText(currentStopMetadata, "label") || null,
          kind: payloadText(currentStopMetadata, "kind").toUpperCase() || null,
          status: currentStop.status,
          deliveryStatus: currentStop.deliveryStatus,
        } : null,
        trackingDeviceId: sample.trackingDeviceId,
        deviceLabel: device?.label ?? sample.trackingDeviceId,
        provider: sample.provider,
      };
    });

    const latestEventByLocation = new Map<string, typeof eventRows[number]>();
    for (const event of eventRows) if (event.locationId && !latestEventByLocation.has(event.locationId)) latestEventByLocation.set(event.locationId, event);
    const latestEventByVehicle = new Map<string, typeof eventRows[number]>();
    for (const event of eventRows) if (event.vehicleId && !latestEventByVehicle.has(event.vehicleId)) latestEventByVehicle.set(event.vehicleId, event);

    await auditLocationAccess({
      context,
      capability,
      action: "READ_CURRENT_MAP",
      resourceType: "COMMAND_OPERATIONAL_MAP",
      purpose: "Visualizzazione della mappa operativa con sedi canoniche, tracking da sessioni attive e tappe temporanee delle missioni autorizzate.",
      metadata: { locationCount: mergedLocations.length, vehicleCount: vehicles.length, temporaryPlaceCount: temporaryStops.length, missionExceptionCount: missionExceptions.length, fleetVisible: canViewFleet },
    });

    return Response.json({
      context: publicAuthorityContext(context),
      provider: getLocationProviderStatus(),
      locations: mergedLocations.map((location) => ({
        ...location,
        latestEvent: latestEventByLocation.get(location.id) ? eventForResponse(latestEventByLocation.get(location.id)!) : null,
      })),
      temporaryPlaces: temporaryStops,
      geofences: visibleGeofenceRows.map((fence) => ({
        id: fence.id,
        locationId: fence.locationId,
        entityType: fence.entityType,
        entityId: fence.entityId,
        name: fence.name,
        shapeType: fence.shapeType,
        version: fence.version,
        center: fence.centerLatitudeE6 !== null && fence.centerLongitudeE6 !== null
          ? { latitude: roundedCoordinate(fence.centerLatitudeE6), longitude: roundedCoordinate(fence.centerLongitudeE6) }
          : null,
        radiusMeters: fence.radiusMeters,
        polygon: (() => {
          try { return JSON.parse(fence.polygonJson) as unknown; } catch { return []; }
        })(),
        temporary: temporaryLocationIdSet.has(fence.locationId),
        routeStopId: temporaryStops.find((stop) => stop.locationId === fence.locationId)?.id ?? null,
      })),
      vehicles: vehicles.map((vehicle) => ({ ...vehicle, latestEvent: latestEventByVehicle.get(vehicle.id) ? eventForResponse(latestEventByVehicle.get(vehicle.id)!) : null })),
      activeSessions: sessionRows.map((session) => ({ id: session.id, employeeId: session.employeeId, vehicleId: session.vehicleId, trackingDeviceId: session.trackingDeviceId, startedAt: session.startedAt, source: session.trackingSource })),
      missionExceptions,
      derivedEvents: eventRows.slice(0, 80).map(eventForResponse),
      rawSamples: "CURRENT_POSITION_ONLY",
      readback: { status: "verified", scope: "tenant", checkedAt: new Date().toISOString() },
    }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return Response.json({ error: "command_map_readback_unavailable" }, { status: 503 });
  }
}
