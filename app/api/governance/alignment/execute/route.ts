import { getAuthorityContext, getSitesAuthorityContext, hasCapability } from "@/lib/authority-context";
import {
  TENANT_ALIGNMENT_ACTORS,
  TENANT_ALIGNMENT_CONTRACT_VERSION,
  TENANT_ALIGNMENT_RUN_ID,
  TENANT_ALIGNMENT_SOURCE_ID,
  TENANT_ALIGNMENT_TARGET_ID,
  isExactTenantAlignmentApproval,
  tenantAlignmentManifestHash,
} from "@/lib/tenant-alignment-contract";
import {
  TenantAlignmentBlockedError,
  executeTenantAlignment,
  getTenantAlignmentDryRun,
} from "@/lib/tenant-alignment-executor.server";

export const dynamic = "force-dynamic";

function isBoundedServiceInvocation(request: Request) {
  // The production Site is owner-private. This narrowly scoped service path
  // supports an identity-less SIWC bypass request without turning the route
  // into a generic tenant writer: every identifier is immutable and POST also
  // has to present the exact manifest hash returned by this deployment.
  return request.headers.get("x-zerow-alignment-contract") === TENANT_ALIGNMENT_CONTRACT_VERSION
    && request.headers.get("x-zerow-alignment-run") === TENANT_ALIGNMENT_RUN_ID;
}

async function ownerAuthorized() {
  const [context, sitesContext] = await Promise.all([getAuthorityContext(), getSitesAuthorityContext()]);
  const selectedOwner = Boolean(context?.roles.includes("owner") && hasCapability(context, "tenant.manage"));
  const siteOwner = Boolean(
    sitesContext?.identityProvider === "sites"
    && sitesContext.actorId === TENANT_ALIGNMENT_ACTORS.sitesOwner
    && sitesContext.roles.includes("owner")
    && hasCapability(sitesContext, "tenant.manage")
    && [TENANT_ALIGNMENT_SOURCE_ID, TENANT_ALIGNMENT_TARGET_ID].includes(sitesContext.tenantId as typeof TENANT_ALIGNMENT_SOURCE_ID | typeof TENANT_ALIGNMENT_TARGET_ID),
  );
  return { authorized: selectedOwner && siteOwner, actorId: sitesContext?.actorId ?? context?.actorId ?? null };
}

async function gate(request: Request) {
  if (isBoundedServiceInvocation(request)) return { authorized: true, actorId: TENANT_ALIGNMENT_ACTORS.sitesOwner, service: true };
  const owner = await ownerAuthorized();
  return { ...owner, service: false };
}

export async function GET(request: Request) {
  const checked = await gate(request);
  if (!checked.authorized) return Response.json({ error: "site_owner_required" }, { status: 403 });
  try {
    const dryRun = await getTenantAlignmentDryRun();
    return Response.json({ ...dryRun, authority: checked.service ? "owner-private-service-boundary" : "sites-owner" }, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    console.error("tenant_alignment_dry_run_failed", error);
    return Response.json({ error: "tenant_alignment_dry_run_unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const checked = await gate(request);
  if (!checked.authorized) return Response.json({ error: "site_owner_required" }, { status: 403 });
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 4_096) return Response.json({ error: "payload_too_large" }, { status: 413 });
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const manifestHash = await tenantAlignmentManifestHash();
  if (!isExactTenantAlignmentApproval(input, manifestHash)) {
    return Response.json({ error: "exact_alignment_manifest_required", manifestHash }, { status: 409 });
  }

  try {
    const result = await executeTenantAlignment(checked.actorId ?? TENANT_ALIGNMENT_ACTORS.sitesOwner);
    return Response.json({ ...result, authority: checked.service ? "owner-private-service-boundary" : "sites-owner" }, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof TenantAlignmentBlockedError) {
      return Response.json({ error: "tenant_alignment_blocked", dryRun: error.dryRun }, { status: 409 });
    }
    const diagnostic = error instanceof Error ? error.message.slice(0, 1_000) : "unknown_error";
    console.error(diagnostic, error);
    return Response.json({
      error: "tenant_alignment_execution_failed",
      ...(checked.service ? { diagnostic } : {}),
    }, { status: 503 });
  }
}
