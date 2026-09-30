import { NextResponse } from "next/server";
import { neonAuth } from "@/lib/neon-auth/server";

export const dynamic = "force-dynamic";

const handlers = neonAuth?.handler();

function unavailable() {
  return NextResponse.json(
    {
      ok: false,
      code: "neon_auth_not_configured",
    },
    { status: 503 },
  );
}

export const GET = handlers?.GET ?? unavailable;
export const POST = handlers?.POST ?? unavailable;
export const PUT = handlers?.PUT ?? unavailable;
export const PATCH = handlers?.PATCH ?? unavailable;
export const DELETE = handlers?.DELETE ?? unavailable;

