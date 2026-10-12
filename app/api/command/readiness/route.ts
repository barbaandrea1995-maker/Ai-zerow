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
  let openAiCheckedAt: string | null = null;
  try {
    const snapshot = await getExternalSnapshot(context.tenantId);
    const health = snapshot.checks.find(
      (check) => check.adapterKey === "openai-runtime" && check.checkType === "health" && check.source === "sites-openai-live-check",
    );
    openAiLive = companyAiLiveRequestFromCheck(health?.result);
    openAiCheckedAt = health?.checkedAt ?? null;
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

  const checks = [
    { id: "tenant-context", label: "Contesto tenant", status: "VERIFIED", detail: "Identità e perimetro risolti dal server." },
    { id: "command-ledger", label: "Command ledger", status: ledgerStatus, detail: "Readback tenant-scoped del registro Company AI." },
    { id: "openai-probe", label: "Test API OpenAI", status: openAiLive, checkedAt: openAiCheckedAt },
    { id: "domain-write-boundary", label: "Scritture di dominio", status: runtime.directWrite ? "UNSAFE" : "ENFORCED", detail: "Company AI non scrive direttamente nei moduli operativi." },
    { id: "commercial-release", label: "Go-live commerciale", status: "NO_GO", detail: "Stato corrente del gate di rilascio commerciale." },
  ];
  return Response.json({
    contract: {
      tranche: "W12",
      directWrite: false,
      commercialStatus: "NO_GO",
    },
    summary: {
      ledgerCount,
      ledgerStatus,
      openAiLive,
      openAiCheckedAt,
    },
    checks,
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
