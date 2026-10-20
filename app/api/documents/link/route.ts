function gone() {
  return Response.json({
    error: "deprecated_document_link_route",
    replacement: "/api/finance/documents/{documentId}/review",
    detail: "I collegamenti Finance sono verificati dal server e registrati durante la revisione umana.",
  }, { status: 410, headers: { "cache-control": "private, no-store", deprecation: "true" } });
}

export const GET = gone;
export const POST = gone;
