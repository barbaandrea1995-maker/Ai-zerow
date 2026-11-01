import { NextResponse } from "next/server";
import { neonAuth } from "@/lib/neon-auth/server";

export const dynamic = "force-dynamic";

type AuthRouteContext = { params: Promise<{ path: string[] }> };
type AuthRouteHandler = (
  request: Request,
  context: AuthRouteContext,
) => Response | Promise<Response>;

const handlers = neonAuth?.handler() as Partial<Record<
  "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  AuthRouteHandler
>> | undefined;

function unavailable() {
  return NextResponse.json(
    {
      ok: false,
      code: "neon_auth_not_configured",
    },
    { status: 503 },
  );
}

function providerUnavailable() {
  return NextResponse.json(
    {
      ok: false,
      code: "neon_auth_provider_unavailable",
    },
    {
      status: 503,
      headers: { "cache-control": "private, no-store" },
    },
  );
}

function guarded(handler: AuthRouteHandler | undefined): AuthRouteHandler {
  if (!handler) return unavailable;
  return async (request, context) => {
    try {
      const response = await handler(request, context);
      return response.status >= 500 ? providerUnavailable() : response;
    } catch {
      return providerUnavailable();
    }
  };
}

export const GET = guarded(handlers?.GET);
export const POST = guarded(handlers?.POST);
export const PUT = guarded(handlers?.PUT);
export const PATCH = guarded(handlers?.PATCH);
export const DELETE = guarded(handlers?.DELETE);

