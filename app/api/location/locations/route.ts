import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  geofences,
  geoLocations,
  s06Events,
  s06Outbox,
  s06Reconciliations,
  s04Records,
  tenantWarehouses,
} from "@/db/schema";
import { getAuthorityContext, hasCapability, publicAuthorityContext } from "@/lib/authority-context";
import { auditLocationAccess, defaultGeofenceRadius, geofenceForResponse, locationForResponse } from "@/lib/location-intelligence/repository";
import { getLocationProviderStatus } from "@/lib/location-intelligence/providers";
import { isGeofenceShape, isLocationEntityType } from "@/lib/location-intelligence/types";
import { normalizeCoordinate } from "@/lib/location-intelligence/geometry";

export const dynamic = "force-dynamic";

type JsonObject = Record<string, unknown>;

function bounded(value: unknown, max: number, fallback = "") {
  return typeof value === "string" ? value.trim().slice(0, max) : fallback;
}

function objectValue(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function polygonValue(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const coordinate = normalizeCoordinate(item);
    return coordinate ? [coordinate] : [];
  }).slice(0, 100);
}

function responseHeaders() {
  return { "cache-control": "private, no-store" };
}

export async function GET() {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const capability = hasCapability(context, "location.read.history")
    ? "location.read.history"
    : hasCapability(context, "location.read.current")
      ? "location.read.current"
      : hasCapability(context, "location.manage.geofences")
        ? "location.manage.geofences"
        : null;
  if (!capability) return Response.json({ error: "forbidden", capability: "location.read.current" }, { status: 403 });

  try {
    const db = getDb();
    const [locations, fences] = await Promise.all([
      db.select().from(geoLocations)
        .where(eq(geoLocations.tenantId, context.tenantId))
        .orderBy(asc(geoLocations.entityType), asc(geoLocations.updatedAt))
        .limit(500),
      db.select().from(geofences)
        .where(eq(geofences.tenantId, context.tenantId))
        .orderBy(asc(geofences.entityType), asc(geofences.updatedAt))
        .limit(500),
    ]);
    await auditLocationAccess({
      context,
      capability,
      action: "READ",
      resourceType: "GEO_LOCATIONS",
      purpose: "Visualizzazione delle sedi e dei perimetri operativi autorizzati.",
      metadata: { locationCount: locations.length, geofenceCount: fences.length },
    });
    return Response.json({
      context: publicAuthorityContext(context),
      locations: locations.map(locationForResponse),
      geofences: fences.map(geofenceForResponse),
      providers: getLocationProviderStatus(),
      readback: { status: "verified", scope: "tenant", checkedAt: new Date().toISOString() },
    }, { headers: responseHeaders() });
  } catch {
    return Response.json({ error: "location_readback_unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "location.manage.geofences")) {
    return Response.json({ error: "forbidden", capability: "location.manage.geofences" }, { status: 403 });
  }

  let input: JsonObject;
  try {
    const parsed = await request.json() as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return Response.json({ error: "invalid_json" }, { status: 400 });
    input = parsed as JsonObject;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const entityType = bounded(input.entityType, 40).toUpperCase();
  const entityId = bounded(input.entityId, 160);
  const address = objectValue(input.address);
  const coordinates = normalizeCoordinate(input.coordinates ?? input);
  const verifiedByUser = input.verifiedByUser === true || input.confirmed === true;
  const provider = bounded(input.provider, 32).toUpperCase() || "MANUAL";
  const providerPlaceId = bounded(input.providerPlaceId, 160);
  const formattedAddress = bounded(input.formattedAddress ?? input.addressText ?? input.locationLabel, 240);
  const idempotencyKey = bounded(input.idempotencyKey, 160) || `location:create:${crypto.randomUUID()}`;
  const shapeType = bounded(input.shapeType, 16).toUpperCase() || "CIRCLE";
  const polygon = polygonValue(input.polygon);
  const radiusValue = Number(input.radiusMeters ?? defaultGeofenceRadius(entityType));
  const name = bounded(input.name, 160) || `${entityType} · ${entityId}`;

  if (!isLocationEntityType(entityType)) return Response.json({ error: "unsupported_location_entity" }, { status: 400 });
  if (!entityId) return Response.json({ error: "location_entity_id_required" }, { status: 400 });
  if (!coordinates) return Response.json({ error: "confirmed_coordinates_required" }, { status: 400 });
  if (!verifiedByUser) return Response.json({ error: "location_user_confirmation_required" }, { status: 400 });
  if (!isGeofenceShape(shapeType)) return Response.json({ error: "unsupported_geofence_shape" }, { status: 400 });
  if (!(provider === "MANUAL" || provider === "MAPBOX" || provider === "NATIVE_DEVICE")) return Response.json({ error: "unsupported_location_provider" }, { status: 400 });
  if (shapeType === "CIRCLE" && (!Number.isInteger(radiusValue) || radiusValue < 20 || radiusValue > 5_000)) {
    return Response.json({ error: "geofence_radius_must_be_20_to_5000_meters" }, { status: 400 });
  }
  if (shapeType === "POLYGON" && polygon.length < 3) return Response.json({ error: "polygon_requires_three_points" }, { status: 400 });

  const now = new Date().toISOString();
  const locationId = `GEO-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
  const geofenceId = `GEOFENCE-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
  const eventId = crypto.randomUUID();
  const eventPayload = JSON.stringify({
    locationId,
    geofenceId,
    entityType,
    entityId,
    provider,
    verifiedByUser,
    shapeType,
    radiusMeters: shapeType === "CIRCLE" ? radiusValue : null,
  });

  try {
    const db = getDb();
    if (entityType === "MAGAZZINO") {
      const [warehouse] = await db.select({ id: tenantWarehouses.id }).from(tenantWarehouses).where(and(eq(tenantWarehouses.tenantId, context.tenantId), eq(tenantWarehouses.id, entityId))).limit(1);
      if (!warehouse) return Response.json({ error: "warehouse_location_entity_not_found" }, { status: 404 });
    }
    if (entityType === "COMMESSA" || entityType === "CANTIERE") {
      const [job] = await db.select({ id: s04Records.id }).from(s04Records).where(and(eq(s04Records.tenantId, context.tenantId), eq(s04Records.module, "operations"), eq(s04Records.id, entityId))).limit(1);
      if (!job) return Response.json({ error: "job_location_entity_not_found" }, { status: 404 });
    }
    const [sameKey, sameEntity] = await Promise.all([
      db.select().from(geoLocations).where(and(eq(geoLocations.tenantId, context.tenantId), eq(geoLocations.idempotencyKey, idempotencyKey))).limit(1),
      db.select().from(geoLocations).where(and(eq(geoLocations.tenantId, context.tenantId), eq(geoLocations.entityType, entityType), eq(geoLocations.entityId, entityId))).limit(1),
    ]);
    if (sameKey[0]) {
      const [existingFence] = await db.select().from(geofences).where(and(eq(geofences.tenantId, context.tenantId), eq(geofences.locationId, sameKey[0].id))).limit(1);
      return Response.json({ context: publicAuthorityContext(context), location: locationForResponse(sameKey[0]), geofence: existingFence ? geofenceForResponse(existingFence) : null, idempotent: true }, { headers: responseHeaders() });
    }
    if (sameEntity[0]) return Response.json({ error: "location_entity_already_configured", locationId: sameEntity[0].id }, { status: 409 });

    await db.batch([
      db.insert(geoLocations).values({
        id: locationId,
        tenantId: context.tenantId,
        entityType,
        entityId,
        formattedAddress,
        street: bounded(address.street, 160),
        streetNumber: bounded(address.streetNumber, 24),
        city: bounded(address.city, 120),
        province: bounded(address.province, 120),
        postalCode: bounded(address.postalCode, 24),
        country: bounded(address.country, 64, "IT"),
        latitudeE6: Math.round(coordinates.latitude * 1_000_000),
        longitudeE6: Math.round(coordinates.longitude * 1_000_000),
        provider,
        providerPlaceId: providerPlaceId || null,
        geocodeConfidenceMilli: Math.round(Math.min(1, Math.max(0, Number(input.confidence ?? 0))) * 1_000),
        verifiedByUser: 1,
        verifiedAt: now,
        status: "ACTIVE",
        version: 1,
        idempotencyKey,
        createdBy: context.actorId,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(geofences).values({
        id: geofenceId,
        tenantId: context.tenantId,
        locationId,
        entityType,
        entityId,
        name,
        shapeType,
        centerLatitudeE6: Math.round(coordinates.latitude * 1_000_000),
        centerLongitudeE6: Math.round(coordinates.longitude * 1_000_000),
        radiusMeters: shapeType === "CIRCLE" ? radiusValue : null,
        polygonJson: JSON.stringify(polygon),
        status: "ACTIVE",
        version: 1,
        createdBy: context.actorId,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(s06Events).values({
        eventId,
        tenantId: context.tenantId,
        eventType: "location.location.created",
        schemaVersion: "1",
        actorType: "human",
        actorId: context.actorId,
        source: "sites-location-intelligence",
        occurredAt: now,
        observedAt: now,
        aggregateType: "geo.location",
        aggregateId: locationId,
        aggregateVersion: 1,
        payloadJson: eventPayload,
        correlationId: crypto.randomUUID(),
        causationId: null,
        idempotencyKey,
        status: "COMMITTED_SITES_READBACK",
        createdAt: now,
      }),
      db.insert(s06Outbox).values({
        id: crypto.randomUUID(),
        tenantId: context.tenantId,
        eventId,
        topic: "zerow.location.location.created",
        status: "PENDING_EXTERNAL_CONSUMER",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(s06Reconciliations).values({
        id: crypto.randomUUID(),
        tenantId: context.tenantId,
        aggregateType: "geo.location",
        aggregateId: locationId,
        expectedVersion: 1,
        observedVersion: 1,
        status: "SITES_READBACK_VERIFIED",
        detail: "Location e geofence salvate con conferma umana; proiezione PostGIS resta un adapter separato.",
        createdAt: now,
        updatedAt: now,
      }),
    ]);
    const [location] = await db.select().from(geoLocations).where(and(eq(geoLocations.tenantId, context.tenantId), eq(geoLocations.id, locationId))).limit(1);
    const [geofence] = await db.select().from(geofences).where(and(eq(geofences.tenantId, context.tenantId), eq(geofences.id, geofenceId))).limit(1);
    if (!location || !geofence) return Response.json({ error: "location_readback_unavailable" }, { status: 503 });
    return Response.json({
      context: publicAuthorityContext(context),
      location: locationForResponse(location),
      geofence: geofenceForResponse(geofence),
      providerStatus: getLocationProviderStatus(),
      eventId,
      readback: { status: "verified", scope: "tenant", checkedAt: new Date().toISOString() },
    }, { status: 201, headers: responseHeaders() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/unique|constraint/i.test(message)) return Response.json({ error: "location_idempotency_or_entity_conflict" }, { status: 409 });
    return Response.json({ error: "location_write_unavailable" }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "location.manage.geofences")) {
    return Response.json({ error: "forbidden", capability: "location.manage.geofences" }, { status: 403 });
  }

  let input: JsonObject;
  try {
    const parsed = await request.json() as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return Response.json({ error: "invalid_json" }, { status: 400 });
    input = parsed as JsonObject;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const geofenceId = bounded(input.geofenceId, 160);
  const entityType = bounded(input.entityType, 40).toUpperCase();
  const entityId = bounded(input.entityId, 160);
  const radiusMeters = Number(input.radiusMeters);
  const expectedVersion = input.expectedVersion === undefined ? null : Number(input.expectedVersion);
  const idempotencyKey = bounded(input.idempotencyKey, 160);

  if (!geofenceId && (!isLocationEntityType(entityType) || !entityId)) {
    return Response.json({ error: "geofence_target_required" }, { status: 400 });
  }
  if (!Number.isInteger(radiusMeters) || radiusMeters < 20 || radiusMeters > 5_000) {
    return Response.json({ error: "geofence_radius_must_be_20_to_5000_meters" }, { status: 400 });
  }
  if (expectedVersion !== null && (!Number.isInteger(expectedVersion) || expectedVersion < 1)) {
    return Response.json({ error: "geofence_expected_version_invalid" }, { status: 400 });
  }
  if (idempotencyKey.length < 4) return Response.json({ error: "idempotency_key_required" }, { status: 400 });

  try {
    const db = getDb();
    const [existingFence] = await db.select().from(geofences).where(
      geofenceId
        ? and(eq(geofences.tenantId, context.tenantId), eq(geofences.id, geofenceId))
        : and(eq(geofences.tenantId, context.tenantId), eq(geofences.entityType, entityType), eq(geofences.entityId, entityId), eq(geofences.status, "ACTIVE")),
    ).limit(1);

    if (!existingFence) return Response.json({ error: "geofence_not_found" }, { status: 404 });
    if (existingFence.shapeType !== "CIRCLE") return Response.json({ error: "only_circle_geofence_can_change_radius" }, { status: 409 });

    const [existingEvent] = await db.select().from(s06Events).where(and(
      eq(s06Events.tenantId, context.tenantId),
      eq(s06Events.idempotencyKey, idempotencyKey),
    )).limit(1);
    if (existingEvent) {
      const [readback] = await db.select().from(geofences).where(and(eq(geofences.tenantId, context.tenantId), eq(geofences.id, existingFence.id))).limit(1);
      return Response.json({
        context: publicAuthorityContext(context),
        geofence: readback ? geofenceForResponse(readback) : null,
        eventId: existingEvent.eventId,
        idempotent: true,
        readback: { status: "verified", scope: "tenant", checkedAt: new Date().toISOString() },
      }, { headers: responseHeaders() });
    }
    if (expectedVersion !== null && expectedVersion !== existingFence.version) {
      return Response.json({ error: "geofence_version_conflict", expectedVersion, currentVersion: existingFence.version }, { status: 409 });
    }

    const now = new Date().toISOString();
    const nextVersion = existingFence.version + 1;
    const eventId = crypto.randomUUID();
    const correlationId = crypto.randomUUID();
    const eventPayload = JSON.stringify({
      action: "update_radius",
      geofenceId: existingFence.id,
      locationId: existingFence.locationId,
      entityType: existingFence.entityType,
      entityId: existingFence.entityId,
      previousRadiusMeters: existingFence.radiusMeters,
      radiusMeters,
      version: nextVersion,
    });

    const updatedRows = await db.batch([
      db.update(geofences)
        .set({ radiusMeters, version: nextVersion, updatedAt: now })
        .where(and(
          eq(geofences.id, existingFence.id),
          eq(geofences.tenantId, context.tenantId),
          eq(geofences.version, existingFence.version),
          eq(geofences.status, "ACTIVE"),
        ))
        .returning(),
      db.insert(s06Events).values({
        eventId,
        tenantId: context.tenantId,
        eventType: "location.geofence.updated",
        schemaVersion: "1",
        actorType: "human",
        actorId: context.actorId,
        source: "sites-location-intelligence",
        occurredAt: now,
        observedAt: now,
        aggregateType: "geo.geofence",
        aggregateId: existingFence.id,
        aggregateVersion: nextVersion,
        payloadJson: eventPayload,
        correlationId,
        causationId: null,
        idempotencyKey,
        status: "COMMITTED_SITES_READBACK",
        createdAt: now,
      }),
      db.insert(s06Outbox).values({
        id: crypto.randomUUID(),
        tenantId: context.tenantId,
        eventId,
        topic: "zerow.location.geofence.updated",
        status: "PENDING_EXTERNAL_CONSUMER",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(s06Reconciliations).values({
        id: crypto.randomUUID(),
        tenantId: context.tenantId,
        aggregateType: "geo.geofence",
        aggregateId: existingFence.id,
        expectedVersion: nextVersion,
        observedVersion: nextVersion,
        status: "SITES_READBACK_VERIFIED",
        detail: "Raggio geofence aggiornato con capability location.manage.geofences e rilettura server-side.",
        createdAt: now,
        updatedAt: now,
      }),
    ]);

    const updated = (updatedRows[0] as (typeof geofences.$inferSelect)[])[0];
    if (!updated) return Response.json({ error: "geofence_version_conflict", currentVersion: existingFence.version }, { status: 409 });

    await auditLocationAccess({
      context,
      capability: "location.manage.geofences",
      action: "UPDATE_GEOFENCE_RADIUS",
      resourceType: "GEOFENCE",
      resourceId: existingFence.id,
      purpose: "Aggiornamento autorizzato del raggio operativo della sede.",
      metadata: { entityType: existingFence.entityType, entityId: existingFence.entityId, previousRadiusMeters: existingFence.radiusMeters, radiusMeters, version: nextVersion },
    });

    return Response.json({
      context: publicAuthorityContext(context),
      geofence: geofenceForResponse(updated),
      eventId,
      idempotent: false,
      readback: { status: "verified", scope: "tenant", checkedAt: new Date().toISOString() },
    }, { headers: responseHeaders() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/unique|constraint/i.test(message)) return Response.json({ error: "geofence_idempotency_or_version_conflict" }, { status: 409 });
    return Response.json({ error: "geofence_update_unavailable" }, { status: 503 });
  }
}
