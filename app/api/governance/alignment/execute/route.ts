import { getAuthorityContext, hasCapability } from "@/lib/authority-context";

export const dynamic = "force-dynamic";

/**
 * The former endpoint executed a bounded, one-off production reconciliation.
 * That operation is complete and must not remain callable in a commercial
 * multi-tenant runtime. Keep a governed tombstone so stale clients fail closed
 * without exposing the historical manifest or accepting service bypass headers.
 */
async function retired() {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "tenant.manage")) {
    return Response.json({ error: "forbidden", capability: "tenant.manage" }, { status: 403 });
  }
  return Response.json({
    error: "tenant_alignment_execution_retired",
    detail: "Il riallineamento storico è concluso. Usa il controllo di integrità read-only del tenant corrente.",
    replacement: "/api/governance/alignment",
  }, {
    status: 410,
    headers: { "cache-control": "private, no-store", deprecation: "true" },
  });
}

export const GET = retired;
export const POST = retired;
