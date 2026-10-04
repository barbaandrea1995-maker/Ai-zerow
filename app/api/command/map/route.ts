import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import {
  geofences,
  geoLocations,
  locationEvents,
  locationSamples,
  s04Records,
  tenantWarehouses,
  trackingDevices,
  trackingSessions,
} from "@/db/schema";
import { getAuthorityContext, hasCapability, publicAuthorityContext } from "@/lib/authority-context";
import { auditLocationAccess, eventForResponse } from "@/lib/location-intelligence/repository";
import { getLocationProviderStatus } from "@/lib/location-intelligence/providers";
import { recordForResponse } from "@/lib/s04-adapter";

export const dynamic = "force-dynamic";

function roundedCoordinate(valueE6: number) {
  return Math.round((valueE6 / 1_000_000) * 10_000) / 10_000;
}

function payloadText(payload: Record<string, unknown>, key: string) {
  return typeof payload[key] === "string" ? String(payload[key]).trim() : "";
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

function sampleState(recordedAt: string) {
  const timestamp = Date.parse(recordedAt);
  if (!Number.isFinite(timestamp)) return "UNKNOWN" as const;
  const ageSeconds = Math.max(0, (Date.now() - timestamp) / 1_000);
  if (ageSeconds <= 5 * 60) return "LIVE" as const;
  if (ageSeconds <= 30 * 60) return "RECENT" as const;
  return "STALE" as const;
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
  const capability = canViewFleet ? "location.view.fleet" : "location.read.current";

  try {
    const db = getDb();
    const [locationRows, fenceRows, warehouseRows, catalogRows, eventRows, sessionRows] = await Promise.all([
      db.select().from(geoLocations)
        .where(and(eq(geoLocations.tenantId, context.tenantId), eq(geoLocations.status, "ACTIVE")))
        .orderBy(asc(geoLocations.entityType), asc(geoLocations.updatedAt))
        .limit(500),
      db.select().from(geofences)
        .where(and(eq(geofences.tenantId, context.tenantId), eq(geofences.status, "ACTIVE")))
        .orderBy(asc(geofences.entityType), asc(geofences.updatedAt))
        .limit(500),
      db.select().from(tenantWarehouses)
        .where(and(eq(tenantWarehouses.tenantId, context.tenantId), eq(tenantWarehouses.status, "active")))
        .orderBy(asc(tenantWarehouses.name))
        .limit(200),
      db.select().from(s04Records)
        .where(and(eq(s04Records.tenantId, context.tenantId), inArray(s04Records.module, ["operations", "assets"])))
        .orderBy(desc(s04Records.updatedAt))
        .limit(800),
      db.select().from(locationEvents)
        .where(and(
          eq(locationEvents.tenantId, context.tenantId),
          ...(canViewFleet ? [] : [eq(locationEvents.employeeId, context.actorId)]),
        ))
        .orderBy(desc(locationEvents.occurredAt))
        .limit(500),
      db.select().from(trackingSessions)
        .where(and(
          eq(trackingSessions.tenantId, context.tenantId),
          eq(trackingSessions.status, "ACTIVE"),
          ...(canViewFleet ? [] : [eq(trackingSessions.employeeId, context.actorId)]),
        ))
        .orderBy(desc(trackingSessions.startedAt))
        .limit(500),
    ]);

    const records = new Map(catalogRows.map((row) => {
      const parsed = recordForResponse(row);
      return [parsed.id, parsed] as const;
    }));
    const warehouseById = new Map(warehouseRows.map((warehouse) => [warehouse.id, warehouse] as const));
    const knownLocationEntities = new Set(locationRows.map((location) => `${location.entityType}:${location.entityId}`));

    const locations = locationRows.map((location) => ({
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
        id: `warehouse-location:${warehouse.id}`,
        entityType: "MAGAZZINO",
        entityId: warehouse.id,
        label: warehouse.name,
        address: warehouse.locationLabel,
        coordinates: { latitude: roundedCoordinate(warehouse.latitudeE6), longitude: roundedCoordinate(warehouse.longitudeE6) },
        provider: warehouse.locationSource === "mapbox" ? "MAPBOX" : "SERVER_VALIDATED",
        verified: true,
        status: warehouse.status,
        updatedAt: warehouse.updatedAt,
      }];
    });

    const mergedLocations = [...locations, ...warehouseLocations];
    const visibleSessionIds = new Set(sessionRows.map((session) => session.id));
    const sampleFilters = [
      eq(locationSamples.tenantId, context.tenantId),
      ...(canViewFleet ? [] : visibleSessionIds.size ? [inArray(locationSamples.trackingSessionId, [...visibleSessionIds])] : [eq(locationSamples.trackingSessionId, "__NO_VISIBLE_SESSION__")]),
    ];
    const sampleRows = await db.select().from(locationSamples)
      .where(and(...sampleFilters))
      .orderBy(desc(locationSamples.recordedAt))
      .limit(1_000);

    const deviceIds = [...new Set(sampleRows.map((sample) => sample.trackingDeviceId).filter(Boolean))];
    const devices = deviceIds.length
      ? await db.select().from(trackingDevices).where(and(eq(trackingDevices.tenantId, context.tenantId), inArray(trackingDevices.id, deviceIds))).limit(500)
      : [];
    const deviceById = new Map(devices.map((device) => [device.id, device] as const));
    const sessionByVehicle = new Map(sessionRows.map((session) => [session.vehicleId, session] as const));
    const latestByVehicle = new Map<string, typeof sampleRows[number]>();
    for (const sample of sampleRows) if (!latestByVehicle.has(sample.vehicleId)) latestByVehicle.set(sample.vehicleId, sample);

    const vehicles = [...latestByVehicle.values()].map((sample) => {
      const session = sessionByVehicle.get(sample.vehicleId);
      const device = deviceById.get(sample.trackingDeviceId);
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
      purpose: "Visualizzazione della mappa operativa con sedi canoniche e ultima posizione GPS autorizzata.",
      metadata: { locationCount: mergedLocations.length, vehicleCount: vehicles.length, fleetVisible: canViewFleet },
    });

    return Response.json({
      context: publicAuthorityContext(context),
      provider: getLocationProviderStatus(),
      locations: mergedLocations.map((location) => ({
        ...location,
        latestEvent: latestEventByLocation.get(location.id) ? eventForResponse(latestEventByLocation.get(location.id)!) : null,
      })),
      geofences: fenceRows.map((fence) => ({
        id: fence.id,
        locationId: fence.locationId,
        entityType: fence.entityType,
        entityId: fence.entityId,
        name: fence.name,
        shapeType: fence.shapeType,
        center: fence.centerLatitudeE6 !== null && fence.centerLongitudeE6 !== null
          ? { latitude: roundedCoordinate(fence.centerLatitudeE6), longitude: roundedCoordinate(fence.centerLongitudeE6) }
          : null,
        radiusMeters: fence.radiusMeters,
        polygon: (() => {
          try { return JSON.parse(fence.polygonJson) as unknown; } catch { return []; }
        })(),
      })),
      vehicles: vehicles.map((vehicle) => ({ ...vehicle, latestEvent: latestEventByVehicle.get(vehicle.id) ? eventForResponse(latestEventByVehicle.get(vehicle.id)!) : null })),
      activeSessions: sessionRows.map((session) => ({ id: session.id, employeeId: session.employeeId, vehicleId: session.vehicleId, trackingDeviceId: session.trackingDeviceId, startedAt: session.startedAt, source: session.trackingSource })),
      derivedEvents: eventRows.slice(0, 80).map(eventForResponse),
      rawSamples: "CURRENT_POSITION_ONLY",
      readback: { status: "verified", scope: "tenant", checkedAt: new Date().toISOString() },
    }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return Response.json({ error: "command_map_readback_unavailable" }, { status: 503 });
  }
}
