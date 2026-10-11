import { getAuthorityContext, hasCapability, publicAuthorityContext } from "@/lib/authority-context";
import { getLocationProviderStatus } from "@/lib/location-intelligence/providers";

export const dynamic = "force-dynamic";

export async function GET() {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });

  const canReadCommand = hasCapability(context, "command.read");
  const canReadLocation = hasCapability(context, "location.read.current")
    || hasCapability(context, "location.read.history")
    || hasCapability(context, "location.view.fleet")
    || hasCapability(context, "location.manage.geofences");
  if (!canReadCommand || !canReadLocation) {
    return Response.json({ error: "forbidden", capability: "command.read + location.read.current" }, { status: 403 });
  }

  const geocoding = getLocationProviderStatus().geocoding;
  return Response.json({
    context: publicAuthorityContext(context),
    provider: geocoding.provider,
    configured: geocoding.configured,
    status: geocoding.configured ? "READY" : "NOT_CONFIGURED",
    tileUrl: geocoding.configured ? "/api/location/tiles/{z}/{x}/{y}" : null,
    attribution: "Powered by Geoapify · © OpenMapTiles · © OpenStreetMap contributors",
    baseMap: "GEOAPIFY_OSM_BRIGHT",
    readback: { status: "verified", scope: "tenant", checkedAt: new Date().toISOString() },
  }, { headers: { "cache-control": "private, no-store" } });
}
