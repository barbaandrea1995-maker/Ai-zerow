import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  s04Records,
  s06Events,
  s06Outbox,
  s06Reconciliations,
  geofences,
  geoLocations,
  tenantWarehouses,
} from "@/db/schema";
import { getAuthorityContext, hasCapability, publicAuthorityContext } from "@/lib/authority-context";
import { warehouseForResponse } from "@/lib/inventory-contract";
import { ACTIVE_GEOCODING_PROVIDER, geocodeAddress } from "@/lib/location-intelligence/providers";
import { allocateServerName } from "@/lib/server-naming";

export const dynamic = "force-dynamic";

type JsonObject = Record<string, unknown>;

function boundedText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function numberValue(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

async function gate(operation: "read" | "manage") {
  const context = await getAuthorityContext();
  if (!context) return { context: null, response: Response.json({ error: "unauthenticated" }, { status: 401 }) };
  // Warehouse configuration is a business-domain action. `tenant.manage`
  // alone is intentionally insufficient because an Owner of an
  // operations-only tenant must not cross the server-side domain boundary.
  const capability = operation === "manage" ? "warehouse.register" : "warehouse.read";
  if (!hasCapability(context, capability)) {
    return { context: null, response: Response.json({ error: "forbidden", capability }, { status: 403 }) };
  }
  return { context, response: null };
}

async function readback(tenantId: string) {
  const rows = await getDb().select().from(tenantWarehouses)
    .where(eq(tenantWarehouses.tenantId, tenantId))
    .orderBy(asc(tenantWarehouses.status), asc(tenantWarehouses.name));
  return {
    warehouses: rows.map(warehouseForResponse),
    readback: { status: "verified", scope: "tenant", checkedAt: new Date().toISOString() },
  };
}

export async function GET() {
  const checked = await gate("read");
  if (checked.response) return checked.response;
  try {
    return Response.json({ context: publicAuthorityContext(checked.context!), ...(await readback(checked.context!.tenantId)) }, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch {
    return Response.json({ error: "warehouse_location_readback_unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const checked = await gate("manage");
  if (checked.response) return checked.response;
  const context = checked.context!;

  let input: JsonObject;
  try {
    const parsed = await request.json() as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return Response.json({ error: "invalid_json" }, { status: 400 });
    }
    input = parsed as JsonObject;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const name = boundedText(input.name, 120);
  const locationQuery = boundedText(input.locationQuery ?? input.locationLabel ?? input.location, 240);
  const provider = boundedText(input.locationProvider ?? input.provider, 32).toUpperCase();
  const providerPlaceId = boundedText(input.providerPlaceId, 160);
  const radius = numberValue(input.geofenceRadiusMeters ?? input.radiusMeters) ?? 100;

  if (name.length < 2) return Response.json({ error: "warehouse_name_required" }, { status: 400 });
  if (locationQuery.length < 5) return Response.json({ error: "warehouse_location_required" }, { status: 400 });
  if (provider !== ACTIVE_GEOCODING_PROVIDER || !providerPlaceId) return Response.json({ error: "warehouse_server_location_required" }, { status: 400 });
  if (!Number.isInteger(radius) || radius < 25 || radius > 5_000) {
    return Response.json({ error: "geofence_radius_must_be_25_to_5000_meters" }, { status: 400 });
  }

  const geocoded = await geocodeAddress(locationQuery);
  if (geocoded.status === "not_configured") return Response.json({ error: "warehouse_geocoder_not_configured" }, { status: 503 });
  if (geocoded.status !== "used") return Response.json({ error: "warehouse_geocoder_unavailable" }, { status: 503 });
  const candidate = geocoded.candidates.find((item) => item.providerPlaceId === providerPlaceId);
  if (!candidate) return Response.json({ error: "warehouse_location_confirmation_expired" }, { status: 409 });

  const locationLabel = candidate.formattedAddress;
  const latitude = candidate.latitude;
  const longitude = candidate.longitude;
  const locationSource = ACTIVE_GEOCODING_PROVIDER;

  const now = new Date().toISOString();
  const warehouseId = crypto.randomUUID();
  const geoLocationId = `GEO-WAREHOUSE-${warehouseId}`;
  const geofenceId = `GEOFENCE-WAREHOUSE-${warehouseId}`;
  const eventId = crypto.randomUUID();
  try {
    const db = getDb();
    const naming = await allocateServerName({
      tenantId: context.tenantId,
      module: "warehouse",
      entityType: "warehouse",
      description: name,
    });
    if (!naming) return Response.json({ error: "warehouse_code_unavailable" }, { status: 503 });

    const payloadJson = JSON.stringify({
      entityType: "warehouse",
      warehouseId,
      code: naming.canonicalCode,
      locationLabel,
      latitude,
      longitude,
      geofenceRadiusMeters: radius,
      locationSource,
      providerPlaceId: candidate.providerPlaceId,
      geocodeConfidence: candidate.confidence,
      locationStatus: "SERVER_VERIFIED_GEOAPIFY_LOCATION",
    });

    await db.batch([
      db.insert(tenantWarehouses).values({
        id: warehouseId,
        tenantId: context.tenantId,
        code: naming.canonicalCode,
        name,
        locationLabel,
        latitudeE6: Math.round(latitude * 1_000_000),
        longitudeE6: Math.round(longitude * 1_000_000),
        geofenceRadiusMeters: radius,
        locationSource,
        status: "active",
        version: 1,
        createdBy: context.actorId,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(geoLocations).values({
        id: geoLocationId,
        tenantId: context.tenantId,
        entityType: "MAGAZZINO",
        entityId: warehouseId,
        formattedAddress: locationLabel,
        street: candidate.street,
        streetNumber: candidate.streetNumber,
        city: candidate.city,
        province: candidate.province,
        postalCode: candidate.postalCode,
        country: candidate.country,
        latitudeE6: Math.round(latitude * 1_000_000),
        longitudeE6: Math.round(longitude * 1_000_000),
        provider: ACTIVE_GEOCODING_PROVIDER,
        providerPlaceId: candidate.providerPlaceId,
        geocodeConfidenceMilli: Math.round(Math.min(1, Math.max(0, candidate.confidence)) * 1_000),
        verifiedByUser: 1,
        verifiedAt: now,
        status: "ACTIVE",
        version: 1,
        idempotencyKey: `warehouse-location:${warehouseId}`,
        createdBy: context.actorId,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(geofences).values({
        id: geofenceId,
        tenantId: context.tenantId,
        locationId: geoLocationId,
        entityType: "MAGAZZINO",
        entityId: warehouseId,
        name,
        shapeType: "CIRCLE",
        centerLatitudeE6: Math.round(latitude * 1_000_000),
        centerLongitudeE6: Math.round(longitude * 1_000_000),
        radiusMeters: radius,
        polygonJson: "[]",
        status: "ACTIVE",
        version: 1,
        createdBy: context.actorId,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(s04Records).values({
        id: `WAREHOUSE-${warehouseId}`,
        tenantId: context.tenantId,
        module: "warehouse",
        canonicalCode: naming.canonicalCode,
        recordType: "WAREHOUSE",
        title: name,
        detail: locationLabel,
        meta: `GEOfENCE ${radius}m · SERVER VALIDATED`,
        status: "ACTIVE",
        tone: "lime",
        progress: 100,
        payloadJson,
        createdBy: context.actorId,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(s06Events).values({
        eventId,
        tenantId: context.tenantId,
        eventType: "warehouse.location.created",
        schemaVersion: "1",
        actorType: "human",
        actorId: context.actorId,
        source: "sites-authority-onboarding",
        occurredAt: now,
        observedAt: now,
        aggregateType: "warehouse.location",
        aggregateId: warehouseId,
        aggregateVersion: 1,
        payloadJson,
        correlationId: crypto.randomUUID(),
        causationId: null,
        idempotencyKey: `warehouse-create:${warehouseId}`,
        status: "COMMITTED_SITES_READBACK",
        createdAt: now,
      }),
      db.insert(s06Outbox).values({
        id: crypto.randomUUID(), tenantId: context.tenantId, eventId,
        topic: "zerow.warehouse.location.created", status: "PENDING_EXTERNAL_CONSUMER",
        attempts: 0, createdAt: now, updatedAt: now,
      }),
      db.insert(s06Reconciliations).values({
        id: crypto.randomUUID(), tenantId: context.tenantId,
        aggregateType: "warehouse.location", aggregateId: warehouseId,
        expectedVersion: 1, observedVersion: 1, status: "SITES_READBACK_VERIFIED",
        detail: "Magazzino tenant persistito con coordinate validate dal server e geofence configurato.",
        createdAt: now, updatedAt: now,
      }),
    ]);

    const rows = await readback(context.tenantId);
    const created = rows.warehouses.find((warehouse) => warehouse.id === warehouseId);
    if (!created) return Response.json({ error: "warehouse_readback_unavailable" }, { status: 503 });
    return Response.json({ context: publicAuthorityContext(context), ...rows, created, eventId }, {
      status: 201,
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/unique|constraint/i.test(message)) return Response.json({ error: "warehouse_code_conflict" }, { status: 409 });
    return Response.json({ error: "warehouse_location_write_unavailable" }, { status: 503 });
  }
}
