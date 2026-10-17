import { env } from "cloudflare:workers";

type StaticAssetBinding = {
  fetch(input: Request | string | URL, init?: RequestInit): Promise<Response>;
};

/**
 * Re-exposes a bundled static asset through an app route. Responses returned
 * by the asset binding can have immutable headers; cloning them prevents the
 * framework dispatcher from throwing while it applies its route headers.
 */
export async function staticAssetResponse(request: Request, pathname: string) {
  const assetUrl = new URL(pathname, request.url);
  const assets = (env as unknown as { ASSETS?: StaticAssetBinding }).ASSETS;
  const forwardedHeaders = new Headers();
  for (const name of ["cookie", "oai-sites-authorization"] as const) {
    const value = request.headers.get(name);
    if (value) forwardedHeaders.set(name, value);
  }
  const source = assets
    ? await assets.fetch(new Request(assetUrl, { method: "GET" }))
    : await fetch(assetUrl, { headers: forwardedHeaders });
  const headers = new Headers(source.headers);
  headers.set("cache-control", "public, max-age=86400, stale-while-revalidate=604800");
  return new Response(source.body, {
    status: source.status,
    statusText: source.statusText,
    headers,
  });
}
