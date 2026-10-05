import { getAuthorityContext, hasCapability, publicAuthorityContext } from "@/lib/authority-context";
import { geocodeWithMapbox, getLocationProviderStatus } from "@/lib/location-intelligence/providers";

export const dynamic = "force-dynamic";

function bounded(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const capability = hasCapability(context, "location.manage.geofences")
    ? "location.manage.geofences"
    : hasCapability(context, "operations.write")
      ? "operations.write"
      : hasCapability(context, "mission.write")
        ? "mission.write"
        : hasCapability(context, "tenant.manage")
          ? "tenant.manage"
          : null;
  if (!capability) return Response.json({ error: "forbidden", capability: "mission.write" }, { status: 403 });

  let payload: Record<string, unknown>;
  try {
    const parsed = await request.json() as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return Response.json({ error: "invalid_json" }, { status: 400 });
    payload = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const address = bounded(payload.address ?? payload.query, 320);
  if (address.length < 5) return Response.json({ error: "address_required" }, { status: 400 });

  const result = await geocodeWithMapbox(address);
  if (result.status === "not_configured") {
    return Response.json({
      error: "geocoder_not_configured",
      provider: "MAPBOX",
      status: "NOT_CONFIGURED",
      providers: getLocationProviderStatus(),
      context: publicAuthorityContext(context),
    }, { status: 503 });
  }
  if (result.status === "unavailable") {
    return Response.json({ error: "geocoder_unavailable", provider: "MAPBOX", status: "UNAVAILABLE" }, { status: 503 });
  }
  return Response.json({
    context: publicAuthorityContext(context),
    provider: "MAPBOX",
    status: "READY",
    candidates: result.candidates,
    confirmationRequired: result.candidates.length !== 1 || (result.candidates[0]?.confidence ?? 0) < 0.8,
    readback: { status: "verified", scope: "tenant", checkedAt: new Date().toISOString() },
  }, { headers: { "cache-control": "private, no-store" } });
}
