/**
 * Re-exposes a bundled static asset through an app route. Responses returned
 * by the asset binding can have immutable headers; cloning them prevents the
 * framework dispatcher from throwing while it applies its route headers.
 */
export async function staticAssetResponse(request: Request, pathname: string) {
  const source = await fetch(new URL(pathname, request.url));
  const headers = new Headers(source.headers);
  headers.set("cache-control", "public, max-age=86400, stale-while-revalidate=604800");
  return new Response(source.body, {
    status: source.status,
    statusText: source.statusText,
    headers,
  });
}
