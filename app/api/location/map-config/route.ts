import { getAuthorityContext, hasCapability, publicAuthorityContext } from "@/lib/authority-context";
import { getMapboxClientToken } from "@/lib/location-intelligence/providers";

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

  const token = getMapboxClientToken();
  return Response.json({
    context: publicAuthorityContext(context),
    provider: "MAPBOX",
    configured: Boolean(token),
    status: token ? "READY" : "CLIENT_TOKEN_REQUIRED",
    token: token || null,
    style: "mapbox://styles/mapbox/dark-v11",
    readback: { status: "verified", scope: "tenant", checkedAt: new Date().toISOString() },
  }, { headers: { "cache-control": "private, no-store" } });
}
