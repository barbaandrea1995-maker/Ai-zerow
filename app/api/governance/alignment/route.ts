import {
  getAuthorityContext,
  getSitesAuthorityContext,
  hasCapability,
} from "@/lib/authority-context";
import { getSystemAlignmentReport } from "@/lib/system-alignment.server";
import {
  TENANT_ALIGNMENT_ACTORS,
  TENANT_ALIGNMENT_SOURCE_ID,
  TENANT_ALIGNMENT_TARGET_ID,
} from "@/lib/tenant-alignment-contract";

export const dynamic = "force-dynamic";

export async function GET() {
  const [context, sitesContext] = await Promise.all([
    getAuthorityContext(),
    getSitesAuthorityContext(),
  ]);
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "governance.read") || !hasCapability(context, "tenant.manage")) {
    return Response.json({ error: "forbidden", capability: "tenant.manage" }, { status: 403 });
  }
  const ownsSiteRoot = sitesContext?.identityProvider === "sites"
    && sitesContext.actorId === TENANT_ALIGNMENT_ACTORS.sitesOwner
    && [TENANT_ALIGNMENT_SOURCE_ID, TENANT_ALIGNMENT_TARGET_ID].includes(sitesContext.tenantId as typeof TENANT_ALIGNMENT_SOURCE_ID | typeof TENANT_ALIGNMENT_TARGET_ID)
    && sitesContext.roles.includes("owner")
    && hasCapability(sitesContext, "tenant.manage");
  if (!ownsSiteRoot) {
    return Response.json({ error: "site_root_owner_required" }, { status: 403 });
  }

  try {
    const report = await getSystemAlignmentReport();
    return Response.json({
      ...report,
      authority: {
        selectedTenantId: context.tenantId,
        identityProvider: context.identityProvider,
        role: context.role,
        siteRootVerified: true,
      },
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unexpected_error";
    const storeUnavailable = message.includes("no such table") || message.includes("D1") || message.includes("DB");
    return Response.json({
      error: storeUnavailable ? "alignment_store_unavailable" : "alignment_readback_failed",
    }, { status: 503 });
  }
}
