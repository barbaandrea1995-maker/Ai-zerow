import { getAuthorityContext, hasCapability } from "@/lib/authority-context";
import { companyAiLiveRequestFromCheck, getCompanyAiRuntimeStatus } from "@/lib/company-ai-openai";
import { getExternalSnapshot } from "@/lib/external-adapter";

export const dynamic = "force-dynamic";

export async function GET() {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "command.read")) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  let liveRequest: "NOT_RUN" | "VERIFIED" | "FAILED" = "NOT_RUN";
  try {
    const snapshot = await getExternalSnapshot(context.tenantId);
    const health = snapshot.checks.find(
      (check) => check.adapterKey === "openai-runtime" && check.checkType === "health" && check.source === "sites-openai-live-check",
    );
    liveRequest = companyAiLiveRequestFromCheck(health?.result);
  } catch {
    liveRequest = "NOT_RUN";
  }
  return Response.json(getCompanyAiRuntimeStatus(liveRequest), { headers: { "cache-control": "private, no-store" } });
}
