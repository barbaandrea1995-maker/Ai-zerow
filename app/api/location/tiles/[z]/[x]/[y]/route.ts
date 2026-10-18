import { getAuthorityContext, hasCapability } from "@/lib/authority-context";
import { e2eGeoapifyFixtureEnabled, geoapifyTileUrl } from "@/lib/location-intelligence/providers";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ z: string; x: string; y: string }> };

function tileCoordinate(value: string) {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export async function GET(_request: Request, { params }: RouteContext) {
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

  const raw = await params;
  const z = tileCoordinate(raw.z);
  const x = tileCoordinate(raw.x);
  const y = tileCoordinate(raw.y);
  if (z === null || x === null || y === null || z > 20 || x >= 2 ** z || y >= 2 ** z) {
    return Response.json({ error: "invalid_map_tile" }, { status: 400 });
  }

  const url = geoapifyTileUrl(z, x, y);
  if (!url && e2eGeoapifyFixtureEnabled()) {
    // Deterministic local-only basemap tile. The explicit E2E binding is never
    // set by the product, so production continues to fail closed when the
    // provider key is missing.
    const grid = z >= 10 ? 64 : 128;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" fill="#e9efe5"/><path d="M0 ${grid}H256M0 ${grid * 2}H256M${grid} 0V256M${grid * 2} 0V256" stroke="#c8d1c1" stroke-width="2"/><path d="M-24 232L232-24M24 280L280 24" stroke="#fff" stroke-width="9" opacity=".9"/><path d="M-24 232L232-24M24 280L280 24" stroke="#c9b98b" stroke-width="2" opacity=".8"/><circle cx="128" cy="128" r="4" fill="#8fcf28"/></svg>`;
    return new Response(svg, {
      status: 200,
      headers: {
        "cache-control": "private, max-age=3600",
        "content-type": "image/svg+xml; charset=utf-8",
        "x-content-type-options": "nosniff",
      },
    });
  }
  if (!url) return Response.json({ error: "geoapify_not_configured" }, { status: 503 });
  try {
    const upstream = await fetch(url, { headers: { accept: "image/png,image/*;q=0.8" } });
    if (!upstream.ok || !upstream.body) {
      return Response.json({ error: "geoapify_tile_unavailable" }, { status: upstream.status === 429 ? 429 : 502 });
    }
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "cache-control": "private, max-age=3600, stale-while-revalidate=86400",
        "content-type": upstream.headers.get("content-type") || "image/png",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "geoapify_tile_unavailable" }, { status: 502 });
  }
}
