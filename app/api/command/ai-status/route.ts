import { getAuthorityContext, hasCapability } from "@/lib/authority-context";
import { getCompanyAiRuntimeStatus } from "@/lib/company-ai-openai";

export const dynamic = "force-dynamic";

export async function GET() {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "command.read")) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  return Response.json(getCompanyAiRuntimeStatus(), { headers: { "cache-control": "private, no-store" } });
}
