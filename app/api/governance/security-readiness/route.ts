import { env } from "cloudflare:workers";
import { getAuthorityContext, hasCapability } from "@/lib/authority-context";
import { getExternalSnapshot } from "@/lib/external-adapter";
import { buildSecurityControlCatalog, securityOverallStatus } from "@/lib/security-governance";
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
  let persistedExternalChecks = 0;
  try {
    const snapshot = await getExternalSnapshot(context.tenantId);
    externalReadbackStatus = "READY";
    persistedExternalChecks = snapshot.readback.persistedChecks;
  } catch {
    externalReadbackStatus = "BLOCKED";
  }

  const controls = buildSecurityControlCatalog({
    ledgerStatus,
    externalReadbackStatus,
    malwareTokenConfigured: malwareTokenConfigured(),
  });

  return Response.json({
    contract: {
      tranche: "W16",
      source: "sites-d1-security-privacy-control-plane",
      secrets: "metadata only; secret values never returned",
      directWrite: false,
      commercialStatus: "NO_GO",
    },
    authority: {
      role: context.role,
      identityProvider: context.identityProvider,
      tenantScope: context.resourceScope,
      governanceRead: hasCapability(context, "governance.read"),
      authorityManage: hasCapability(context, "authority.manage"),
    },
    controls,
    summary: securityOverallStatus(controls),
    evidence: {
      ledger: { status: ledgerStatus, count: ledgerCount },
      externalRegistry: { status: externalReadbackStatus, persistedChecks: persistedExternalChecks },
      restore: { d1: "PASS_LOCAL", r2: "PASS_LOCAL" },
    },
    readback: { status: "ok", checkedAt: new Date().toISOString() },
  }, { headers: { "cache-control": "private, no-store" } });
}
