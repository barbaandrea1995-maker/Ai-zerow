import { getAuthorityContext, hasCapability } from "@/lib/authority-context";

async function gone() {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "finance.documents.intake")) {
    return Response.json({ error: "forbidden", capability: "finance.documents.intake" }, { status: 403 });
  }
  return Response.json({
    error: "deprecated_document_analysis_route",
    replacement: "/api/finance/documents/{documentId}/analyze",
    detail: "L’analisi Finance richiede documento persistente, consenso esplicito e capability finance.documents.intake.",
  }, { status: 410, headers: { "cache-control": "private, no-store", deprecation: "true" } });
}

export const GET = gone;
export const POST = gone;
