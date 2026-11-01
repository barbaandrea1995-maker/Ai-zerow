import {
  getAuthorityContext,
  hasCapability,
} from "@/lib/authority-context";
import { getSystemAlignmentReport } from "@/lib/system-alignment.server";

export const dynamic = "force-dynamic";

export async function GET() {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "governance.read") || !hasCapability(context, "tenant.manage")) {
    return Response.json({ error: "forbidden", capability: "tenant.manage" }, { status: 403 });
  }

  try {
    const report = await getSystemAlignmentReport(context.tenantId);
    return Response.json({
      ...report,
      authority: {
        selectedTenantId: context.tenantId,
        identityProvider: context.identityProvider,
        role: context.role,
        tenantScopeVerified: true,
      },
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unexpected_error";
    const storeUnavailable = message.includes("no such table") || message.includes("D1") || message.includes("DB");
    return Response.json({
      error: storeUnavailable ? "integrity_store_unavailable" : "integrity_readback_failed",
    }, { status: 503 });
  }
}
