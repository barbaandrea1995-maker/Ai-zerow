import { NextResponse } from "next/server";
import {
  type AuthorityMembershipRow,
  getAccessibleTenantDirectory,
  getSelectedTenantId,
  TENANT_SELECTION_COOKIE,
} from "@/lib/authority-context";
import { isAuthorityRole } from "@/lib/authority-catalog";

export const dynamic = "force-dynamic";

function tenantView(row: AuthorityMembershipRow) {
  return {
    id: row.tenantId,
    slug: row.slug,
    name: row.name,
    status: row.tenantStatus,
    membershipId: row.membershipId,
    role: row.membershipRole,
    membershipStatus: row.membershipStatus,
  };
}

export async function GET() {
  const directory = await getAccessibleTenantDirectory();
  if (!directory) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  if (!directory.storeAvailable) {
    return NextResponse.json({ ok: false, error: "tenant_store_unavailable" }, { status: 503 });
  }

  const tenants = directory.rows.filter((row) => isAuthorityRole(row.membershipRole));
  if (tenants.length === 0) {
    return NextResponse.json({ ok: false, error: "tenant_membership_required" }, { status: 403 });
  }

  const selectedCookie = await getSelectedTenantId();
  const selected = tenants.find((tenant) => tenant.tenantId === selectedCookie) ?? tenants[0];

  return NextResponse.json({
    ok: true,
    identityProvider: directory.identity.identityProvider,
    selectedTenantId: selected.tenantId,
    tenants: tenants.map(tenantView),
    authorization: "d1_server_side_membership",
  });
}

export async function POST(request: Request) {
  const directory = await getAccessibleTenantDirectory();
  if (!directory) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  if (!directory.storeAvailable) {
    return NextResponse.json({ ok: false, error: "tenant_store_unavailable" }, { status: 503 });
  }

  let payload: { tenantId?: unknown };
  try {
    payload = (await request.json()) as { tenantId?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const tenantId = typeof payload.tenantId === "string" ? payload.tenantId.trim() : "";
  const selected = directory.rows.find(
    (row) => row.tenantId === tenantId && isAuthorityRole(row.membershipRole),
  );

  if (!selected) {
    return NextResponse.json(
      {
        ok: false,
        error: "cross_tenant_access_denied",
        authorization: "d1_server_side_membership",
        clientSuppliedTenantAccepted: false,
      },
      { status: 403 },
    );
  }

  const response = NextResponse.json({
    ok: true,
    selectedTenant: tenantView(selected),
    authorization: "d1_server_side_membership",
    clientSuppliedTenantAccepted: true,
  });

  response.cookies.set({
    name: TENANT_SELECTION_COOKIE,
    value: selected.tenantId,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return response;
}
