type RequestErrorContext = {
  routerKind?: string;
  routePath?: string;
  routeType?: string;
  renderSource?: string;
  revalidateReason?: string;
};

type RequestInfo = {
  path?: string;
  method?: string;
};

function errorField(error: unknown, key: "name" | "message" | "digest") {
  if (!error || typeof error !== "object") return "";
  const value = Reflect.get(error, key);
  return typeof value === "string" ? value.slice(0, 240) : "";
}

export async function register() {
  // The hook is intentionally side-effect free. Runtime errors are emitted by
  // onRequestError below with bounded, non-header metadata.
}

export async function onRequestError(
  error: unknown,
  request: RequestInfo,
  context: RequestErrorContext,
) {
  console.error(JSON.stringify({
    event: "zerow.server_request_error",
    method: (request.method ?? "GET").slice(0, 12),
    path: (request.path ?? context.routePath ?? "unknown").slice(0, 240),
    routeType: (context.routeType ?? "unknown").slice(0, 32),
    errorName: errorField(error, "name") || "Error",
    errorMessage: errorField(error, "message") || "server_render_failed",
    digest: errorField(error, "digest") || null,
  }));
}
