import { getAuthorityContext, hasCapability, publicAuthorityContext } from "@/lib/authority-context";
import { getMapboxClientToken } from "@/lib/location-intelligence/providers";

export const dynamic = "force-dynamic";

const browserMapStyle = {
  version: 8,
  sources: {
    "zerow-open-map": {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "zerow-open-map", type: "raster", source: "zerow-open-map", paint: { "raster-opacity": 0.78 } }],
} as const;

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

  const token = getMapboxClientToken();
  return Response.json({
    context: publicAuthorityContext(context),
    provider: "MAPBOX",
    configured: Boolean(token),
    status: token ? "READY" : "CLIENT_TOKEN_REQUIRED",
    token: token || null,
    style: browserMapStyle,
    baseMap: "OPEN_STREET_MAP",
    readback: { status: "verified", scope: "tenant", checkedAt: new Date().toISOString() },
  }, { headers: { "cache-control": "private, no-store" } });
}
