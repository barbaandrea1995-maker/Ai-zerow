import { NextResponse } from "next/server";
import { getNeonAuthContext } from "@/lib/neon-auth/tenant-context";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const contextResult = await getNeonAuthContext();

  if (contextResult.status === "not_configured") {
    return NextResponse.json(
      { ok: false, code: contextResult.code },
      { status: 503 },
    );
  }

  if (contextResult.status === "unauthenticated") {
    return NextResponse.json(
      { ok: false, code: contextResult.code },
      { status: 401 },
    );
  }

  if (contextResult.status === "error") {
    return NextResponse.json(
      { ok: false, code: contextResult.code },
      { status: 502 },
    );
  }

  const requestedTenantId = new URL(request.url).searchParams.get("tenantId");
  if (!requestedTenantId) {
    return NextResponse.json(
      { ok: false, code: "tenant_id_required" },
      { status: 400 },
    );
  }

  const tenant = contextResult.context.tenants.find(
    (candidate) => candidate.id === requestedTenantId,
  );

  if (!tenant) {
    return NextResponse.json(
      {
        ok: false,
        code: "cross_tenant_access_denied",
        authorization: "server_side_membership_check",
      },
      { status: 403 },
    );
  }

  return NextResponse.json({
    ok: true,
    gate: "AUTH-AB",
    actor: contextResult.context.actor,
    selectedTenant: tenant,
    authorization: "server_side_membership_check",
    clientSuppliedTenantAccepted: false,
    sessionIdentifierExposed: false,
  });
}

