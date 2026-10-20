function gone() {
  return Response.json({
    error: "deprecated_document_analysis_route",
    replacement: "/api/finance/documents/{documentId}/analyze",
    detail: "L’analisi Finance richiede documento persistente, consenso esplicito e capability finance.documents.intake.",
  }, { status: 410, headers: { "cache-control": "private, no-store", deprecation: "true" } });
}

export const GET = gone;
export const POST = gone;
