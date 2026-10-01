import {
  getAuthorityContext,
  hasCapability,
  publicAuthorityContext,
} from "@/lib/authority-context";
import {
  getCompanyAiKnowledgePackSummary,
  searchCompanyAiKnowledge,
} from "@/lib/company-ai-knowledge";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "command.read")) {
    return Response.json({ error: "forbidden", capability: "command.read" }, { status: 403 });
  }

  const searchParams = new URL(request.url).searchParams;
  const query = searchParams.get("q")?.slice(0, 320) ?? "";
  const part = searchParams.get("part")?.slice(0, 12) ?? undefined;
  const limit = Number(searchParams.get("limit") ?? "8");
  const pack = getCompanyAiKnowledgePackSummary();
  const results = searchCompanyAiKnowledge(query, { part, limit });

  return Response.json({
    context: publicAuthorityContext(context),
    contract: {
      route: "/api/company-ai/knowledge",
      source: "company-ai-static-knowledge-pack",
      authority: "tenant-scoped-read",
      referenceOnly: true,
      directWrite: false,
    },
    pack,
    query: { text: query, part: part ?? null, limit: Math.min(24, Math.max(1, Math.round(limit))) },
    results,
    readback: { status: "KNOWLEDGE_PACK_VERIFIED", count: results.length, checkedAt: new Date().toISOString() },
  }, { headers: { "cache-control": "no-store" } });
}
