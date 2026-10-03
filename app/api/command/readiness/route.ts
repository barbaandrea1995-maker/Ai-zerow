import { getAuthorityContext, hasCapability } from "@/lib/authority-context";
import { companyAiLiveRequestFromCheck, getCompanyAiRuntimeStatus } from "@/lib/company-ai-openai";
import { getExternalSnapshot } from "@/lib/external-adapter";
import { getS07Ledger } from "@/lib/s07-adapter";

export const dynamic = "force-dynamic";

export async function GET() {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "command.read")) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  let openAiLive: ReturnType<typeof companyAiLiveRequestFromCheck> = "NOT_RUN";
  try {
    const snapshot = await getExternalSnapshot(context.tenantId);
    const health = snapshot.checks.find(
      (check) => check.adapterKey === "openai-runtime" && check.checkType === "health" && check.source === "sites-openai-live-check",
    );
    openAiLive = companyAiLiveRequestFromCheck(health?.result);
  } catch {
    openAiLive = "NOT_RUN";
  }
  const runtime = getCompanyAiRuntimeStatus(openAiLive);
  let ledgerCount = 0;
  let ledgerStatus: "READY" | "BLOCKED" = "BLOCKED";
  try {
    ledgerCount = (await getS07Ledger(context.tenantId)).length;
    ledgerStatus = "READY";
  } catch {
    ledgerStatus = "BLOCKED";
  }

  const localGateTotal = 6;
  const localGateReady = ledgerStatus === "READY" ? localGateTotal : localGateTotal - 1;
  return Response.json({
    contract: {
      tranche: "W12",
      directWrite: false,
      commercialStatus: "NO_GO",
    },
    summary: {
      localGateReady,
      localGateTotal,
      ledgerCount,
      ledgerStatus,
      openAiLive,
    },
    runtime: {
      configured: runtime.configured,
      model: runtime.model,
      liveRequest: runtime.liveRequest,
      directWrite: runtime.directWrite,
    },
    governanceRead: hasCapability(context, "governance.read"),
    readback: { status: "ok", checkedAt: new Date().toISOString() },
  }, { headers: { "cache-control": "private, no-store" } });
}
