import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { geoLocations, s04Records, tenantWarehouses } from "@/db/schema";
import { getAuthorityContext, hasCapability, publicAuthorityContext } from "@/lib/authority-context";
import { auditLocationAccess, coordinateFromLocation } from "@/lib/location-intelligence/repository";
import { canReadAllLocations, rowMatchesContext } from "@/lib/operational-scope";
import { weatherProvider } from "@/lib/weather-provider";

export const dynamic = "force-dynamic";

function weatherAccessCapability(context: Awaited<ReturnType<typeof getAuthorityContext>>) {
  if (!context) return null;
  return ["location.read.current", "location.read.history", "location.view.fleet", "location.manage.geofences"]
    .find((capability) => hasCapability(context, capability)) ?? null;
}

function bounded(value: string | null, max = 160) {
  return (value ?? "").trim().slice(0, max);
}

async function visibleEntity(context: NonNullable<Awaited<ReturnType<typeof getAuthorityContext>>>, entityType: string, entityId: string) {
  if (canReadAllLocations(context)) return true;
  if (entityType === "MAGAZZINO" && hasCapability(context, "warehouse.read")) return true;

  const rows = await getDb().select().from(s04Records).where(and(
    eq(s04Records.tenantId, context.tenantId),
    inArray(s04Records.module, ["operations", "warehouse"]),
  )).limit(800);
  return rows.some((row) => (row.id === entityId || row.canonicalCode === entityId) && rowMatchesContext(row, context));
}

async function resolveLocation(context: NonNullable<Awaited<ReturnType<typeof getAuthorityContext>>>, locationId: string) {
  const db = getDb();
  const [location] = await db.select().from(geoLocations).where(and(
    eq(geoLocations.tenantId, context.tenantId),
    eq(geoLocations.id, locationId),
    eq(geoLocations.status, "ACTIVE"),
  )).limit(1);
  if (location) {
    if (!(await visibleEntity(context, location.entityType, location.entityId))) return null;
    return {
      id: location.id,
      entityType: location.entityType,
      entityId: location.entityId,
      address: location.formattedAddress,
      coordinates: coordinateFromLocation(location),
    };
  }

  if (!locationId.startsWith("warehouse-location:")) return null;
  const warehouseId = locationId.slice("warehouse-location:".length).trim();
  if (!warehouseId || !hasCapability(context, "warehouse.read")) return null;
  const [warehouse] = await db.select().from(tenantWarehouses).where(and(
    eq(tenantWarehouses.tenantId, context.tenantId),
    eq(tenantWarehouses.id, warehouseId),
    eq(tenantWarehouses.status, "active"),
  )).limit(1);
  if (!warehouse) return null;
  return {
    id: locationId,
    entityType: "MAGAZZINO",
    entityId: warehouse.id,
    address: warehouse.locationLabel,
    coordinates: { latitude: warehouse.latitudeE6 / 1_000_000, longitude: warehouse.longitudeE6 / 1_000_000 },
  };
}

export async function GET(request: Request) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "command.read")) return Response.json({ error: "forbidden", capability: "command.read" }, { status: 403 });
  const capability = weatherAccessCapability(context);
  if (!capability) return Response.json({ error: "forbidden", capability: "location.read.current" }, { status: 403 });

  const locationId = bounded(new URL(request.url).searchParams.get("locationId"));
  if (!locationId) return Response.json({ error: "weather_location_required" }, { status: 400 });

  try {
    const location = await resolveLocation(context, locationId);
    if (!location) return Response.json({ error: "weather_location_not_found" }, { status: 404 });
    const { latitude, longitude } = location.coordinates;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return Response.json({ error: "weather_location_coordinates_invalid" }, { status: 422 });
    }

    const snapshot = await weatherProvider().getForecast({ latitude, longitude });
    await auditLocationAccess({
      context,
      capability,
      action: "READ_LOCATION_WEATHER",
      resourceType: "WEATHER_FORECAST",
      resourceId: location.id,
      purpose: "Lettura server-side delle condizioni meteo per una sede operativa autorizzata.",
      metadata: { provider: snapshot.provider, entityType: location.entityType, entityId: location.entityId },
    });

    return Response.json({
      ...snapshot,
      context: publicAuthorityContext(context),
      provider: {
        id: snapshot.provider,
        status: "READY",
        source: "api.weatherapi.com",
        attribution: "WeatherAPI.com",
      },
      location,
      readback: { status: "verified", scope: "tenant", checkedAt: new Date().toISOString() },
    }, { headers: { "cache-control": "private, max-age=300, stale-while-revalidate=600" } });
  } catch (error) {
    if (error instanceof Error && error.message === "weatherapi_not_configured") {
      return Response.json({ error: "weather_provider_not_configured", provider: "WEATHERAPI" }, { status: 503 });
    }
    if (error instanceof Error && error.message.startsWith("weatherapi_")) {
      return Response.json({ error: "weather_provider_unavailable", provider: "WEATHERAPI" }, { status: 503 });
    }
    return Response.json({ error: "weather_readback_unavailable" }, { status: 503 });
  }
}
