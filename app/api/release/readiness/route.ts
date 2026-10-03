import { env } from "cloudflare:workers";
import { getAuthorityContext, hasCapability } from "@/lib/authority-context";
import { companyAiLiveRequestFromCheck, getCompanyAiRuntimeStatus } from "@/lib/company-ai-openai";
import { getExternalSnapshot } from "@/lib/external-adapter";
import { PREVIOUS_PUBLISHED_SITES_VERSION, RELEASE_BUILD_ID, RELEASE_BUILD_LABEL, RELEASE_PUBLICATION_STATUS } from "@/lib/release";
import { buildReleaseGateCatalog, releaseOverallStatus } from "@/lib/release-readiness";
import { buildSecurityControlCatalog } from "@/lib/security-governance";
import { getS07Ledger } from "@/lib/s07-adapter";

export const dynamic = "force-dynamic";

function malwareTokenConfigured() {
  const bound = typeof env.MALWARE_SCAN_WEBHOOK_TOKEN === "string" ? env.MALWARE_SCAN_WEBHOOK_TOKEN.trim() : "";
  return Boolean(bound || process.env.MALWARE_SCAN_WEBHOOK_TOKEN?.trim());
}

export async function GET() {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "governance.read")) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  let ledgerStatus: "READY" | "BLOCKED" = "BLOCKED";
  let ledgerCount = 0;
  try {
    ledgerCount = (await getS07Ledger(context.tenantId)).length;
    ledgerStatus = "READY";
  } catch {
    ledgerStatus = "BLOCKED";
  }

  let externalReadbackStatus: "READY" | "BLOCKED" = "BLOCKED";
  let externalSnapshot: Awaited<ReturnType<typeof getExternalSnapshot>> | null = null;
  try {
    externalSnapshot = await getExternalSnapshot(context.tenantId);
    externalReadbackStatus = "READY";
  } catch {
    externalReadbackStatus = "BLOCKED";
  }

  const openAiHealth = externalSnapshot?.checks.find(
    (check) => check.adapterKey === "openai-runtime" && check.checkType === "health" && check.source === "sites-openai-live-check",
  );
  const runtime = getCompanyAiRuntimeStatus(companyAiLiveRequestFromCheck(openAiHealth?.result));
  const securityControls = buildSecurityControlCatalog({
    ledgerStatus,
    externalReadbackStatus,
    malwareTokenConfigured: malwareTokenConfigured(),
  });
  const gates = buildReleaseGateCatalog({
    ledgerStatus,
    externalReadbackStatus,
    externalSummary: externalSnapshot?.summary ?? { ready: 0, deferred: 0, blocked: 0, notRun: 0, total: 0 },
    externalAdapters: externalSnapshot?.adapters ?? [],
    securityControls,
    runtime,
  });
  const summary = releaseOverallStatus(gates);

  return Response.json({
    contract: {
      tranche: "W17",
      source: "sites-d1-release-certification-center",
      certification: "LOCAL_TECHNICAL_ONLY",
      commercialStatus: summary.commercialStatus,
      promotionAllowed: summary.promotionAllowed,
      secrets: "metadata only; secret values never returned",
      directWrite: false,
    },
    build: {
      id: RELEASE_BUILD_ID,
      label: RELEASE_BUILD_LABEL,
      runtimePublication: RELEASE_PUBLICATION_STATUS,
      previousPublishedSitesVersion: PREVIOUS_PUBLISHED_SITES_VERSION,
      lastPublishedRuntimeStatus: "TECHNICAL_CANDIDATE_NO_GO",
    },
    authority: {
      role: context.role,
      identityProvider: context.identityProvider,
      tenantScope: context.resourceScope,
      governanceRead: hasCapability(context, "governance.read"),
    },
    summary,
    gates,
    blockers: gates.filter((gate) => gate.status !== "READY").map((gate) => gate.id),
    evidence: {
      ledger: { status: ledgerStatus, count: ledgerCount },
      externalRegistry: {
        status: externalReadbackStatus,
        persistedChecks: externalSnapshot?.readback.persistedChecks ?? 0,
        summary: externalSnapshot?.summary ?? null,
      },
      restore: { d1: "PASS_LOCAL", r2: "PASS_LOCAL" },
    },
    readback: { status: "ok", checkedAt: new Date().toISOString() },
  }, { headers: { "cache-control": "private, no-store" } });
}
