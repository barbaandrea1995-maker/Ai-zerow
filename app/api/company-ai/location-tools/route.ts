import { getAuthorityContext } from "@/lib/authority-context";
import { getCompanyAiLocationTool, isCompanyAiLocationTool } from "@/lib/location-intelligence/company-ai-tools";

export const dynamic = "force-dynamic";

type JsonObject = Record<string, unknown>;

export async function POST(request: Request) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  let payload: JsonObject;
  try {
    const parsed = await request.json() as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return Response.json({ error: "invalid_json" }, { status: 400 });
    payload = parsed as JsonObject;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const tool = typeof payload.tool === "string" ? payload.tool : "";
  if (!isCompanyAiLocationTool(tool)) return Response.json({ error: "unknown_location_tool" }, { status: 400 });
  const args = payload.args && typeof payload.args === "object" && !Array.isArray(payload.args) ? payload.args as JsonObject : {};
  try {
    return Response.json({ context: { tenantId: context.tenantId, role: context.role, rawLocationSamples: "DENY_BY_DEFAULT" }, ...(await getCompanyAiLocationTool({ context, tool, args })) }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return Response.json({ error: "company_ai_location_tool_unavailable", tool }, { status: 503 });
  }
}
