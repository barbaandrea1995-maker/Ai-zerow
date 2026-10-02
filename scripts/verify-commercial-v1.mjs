import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { AUTHORITY_ROLES, ROLE_CAPABILITIES } from "../lib/authority-catalog.ts";
import {
  COMMAND_WIDGET_CATALOG,
  defaultCommandWidgetLayout,
  getAllowedCommandNavigation,
  sanitizeCommandWidgetLayout,
} from "../lib/command-dashboard.ts";
import { RELEASE_BUILD_ID } from "../lib/release.ts";
import { evaluatePlanning, normalizePlanningResource, normalizePlanningSlot } from "../lib/planning-contract.ts";
import { documentCanDownload, transitionDocumentSecurity } from "../lib/document-security.ts";
import { transitionOutbox } from "../lib/outbox-contract.ts";
import { transitionW10Workflow, w10ExternalStatus, w10Progress } from "../lib/w10-contract.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
assert.equal(packageJson.scripts["verify:runtime"], "node scripts/verify-runtime-smoke.mjs", "Runtime smoke verification must remain runnable from the package scripts");
const runtimeSmoke = await readFile(join(root, "scripts", "verify-runtime-smoke.mjs"), "utf8");
assert(runtimeSmoke.includes("protected_api_fail_closed") && runtimeSmoke.includes("service_worker_build_binding"), "Runtime smoke must cover auth boundaries and PWA build binding");

assert.equal(AUTHORITY_ROLES.length, 13, "The canonical role catalog must contain 13 roles");
assert.equal(new Set(AUTHORITY_ROLES).size, AUTHORITY_ROLES.length, "Role IDs must be unique");
assert.equal(new Set(COMMAND_WIDGET_CATALOG.map((widget) => widget.id)).size, COMMAND_WIDGET_CATALOG.length, "Widget IDs must be unique");
assert(COMMAND_WIDGET_CATALOG.some((widget) => widget.id === "finance-procurement" && widget.requiredCapabilities.includes("finance.read") && widget.requiredCapabilities.includes("procurement.read")), "W10 Command widget must require both Finance and Procurement read capabilities");

const planningResource = normalizePlanningResource({ id: "team-alpha", kind: "team", label: "Team Alpha", capacity: 1, qualifications: ["idraulica"] });
const planningSlot = normalizePlanningSlot({ id: "slot-a", startsAt: "2026-10-03T08:00:00Z", endsAt: "2026-10-03T12:00:00Z", resourceIds: ["team-alpha"], requiredQualifications: ["idraulica"] });
assert(planningResource && planningSlot, "Planning fixtures must normalize");
const planningPass = evaluatePlanning([planningSlot], [planningResource]);
assert(planningPass.feasible, "A qualified resource must produce a feasible planning slot");
const planningConflict = evaluatePlanning([
  planningSlot,
  { ...planningSlot, id: "slot-b", startsAt: "2026-10-03T10:00:00Z", endsAt: "2026-10-03T13:00:00Z" },
], [planningResource]);
assert(planningConflict.conflicts.some((conflict) => conflict.code === "RESOURCE_OVERLAP"), "Planning must detect overlapping resource usage");

const outboxRetry = transitionOutbox({ status: "PENDING_EXTERNAL_CONSUMER", attempts: 0, action: "retry" });
assert.equal(outboxRetry.nextStatus, "PENDING_EXTERNAL_CONSUMER", "Outbox retry must remain pending until an external consumer proves delivery");
assert.equal(outboxRetry.nextAttempts, 1, "Outbox retry must increment attempts");
assert.equal(transitionOutbox({ status: "PENDING_EXTERNAL_CONSUMER", attempts: 4, action: "retry" }).nextStatus, "DEAD_LETTERED", "Outbox retry budget must terminate in DLQ");
assert.throws(() => transitionOutbox({ status: "DELIVERED", attempts: 1, action: "retry" }), /outbox_terminal_status/, "Delivered outbox rows must not be replayed by Sites");

const documentPending = transitionDocumentSecurity({
  scanStatus: "NOT_RUN",
  documentStatus: "AVAILABLE_UNSCANNED",
  action: "queue_scan",
});
const documentClean = transitionDocumentSecurity({
  scanStatus: documentPending.scanStatus,
  documentStatus: documentPending.documentStatus,
  action: "provider_result",
  providerResult: "CLEAN",
});
assert.equal(documentClean.documentStatus, "AVAILABLE_CLEAN", "Only provider CLEAN may release a document");
assert(!documentCanDownload("NOT_RUN", "AVAILABLE_UNSCANNED"), "Unscanned documents must remain blocked");
assert(documentCanDownload("CLEAN_PROVIDER", "AVAILABLE_CLEAN"), "Provider-clean documents must be downloadable");
assert.throws(() => transitionDocumentSecurity({
  scanStatus: "NOT_RUN",
  documentStatus: "AVAILABLE_UNSCANNED",
  action: "release",
}), /document_release_requires_provider_clean/, "Manual release must not bypass provider evidence");

const procurementReview = transitionW10Workflow({ module: "procurement", status: "REQUESTED", action: "submit_review" });
assert.equal(procurementReview.nextStatus, "REVIEW", "Procurement must move into review before approval");
const procurementApproval = transitionW10Workflow({ module: "procurement", status: "REVIEW", action: "approve" });
assert(procurementApproval.requiresApproval, "Procurement approval must require approvals.review");
const procurementExternalIssue = transitionW10Workflow({ module: "procurement", status: "PO_DRAFT", action: "external_issue" });
assert(procurementExternalIssue.externalOnly, "Provider-backed PO issue must remain external-only");
assert.equal(w10Progress("procurement", "PO_DRAFT"), 50, "Procurement progress must be derived from the governed state machine");
assert.equal(w10ExternalStatus("PO_DRAFT"), "SITES_READY", "PO draft must remain a Sites-local state");
assert.equal(w10ExternalStatus("PO_ISSUED"), "EXTERNAL_DEFERRED", "Provider-backed PO issue must remain visibly deferred");
assert.throws(() => transitionW10Workflow({ module: "finance", status: "PROPOSED", action: "reconcile" }), /w10_invalid_transition/, "Finance must not skip review and approval");

assert(ROLE_CAPABILITIES.owner.includes("tenant.manage"), "Owner must retain tenant management");
assert(ROLE_CAPABILITIES.owner.includes("authority.manage"), "Owner must retain authority management");
assert(!ROLE_CAPABILITIES.worker.includes("command.read"), "Worker must not see the executive Command dashboard");
assert(!ROLE_CAPABILITIES.auditor.includes("command.customize"), "Auditor must not persist dashboard changes");
assert(ROLE_CAPABILITIES.warehouse_operator.includes("warehouse.write"), "Warehouse operator must retain warehouse writes");
assert(!ROLE_CAPABILITIES.warehouse_operator.includes("finance.read"), "Warehouse operator must not inherit finance visibility");
assert(ROLE_CAPABILITIES.worker.includes("warehouse.request"), "Field workers must be able to request materials");
assert(!ROLE_CAPABILITIES.worker.includes("warehouse.write"), "Field workers must not mutate stock balances");

const workerNavigation = getAllowedCommandNavigation(ROLE_CAPABILITIES.worker).map((item) => item.id);
assert(!workerNavigation.includes("command"), "Worker navigation must hide Command");
assert(workerNavigation.includes("operations"), "Worker navigation must expose authorized operations");

const managerDefaults = defaultCommandWidgetLayout(ROLE_CAPABILITIES.manager);
const maliciousLayout = sanitizeCommandWidgetLayout([
  { id: "kpi-jobs", size: "full", visible: true },
  { id: "unknown-admin-widget", size: "full", visible: true },
  { id: "kpi-jobs", size: "compact", visible: false },
], ROLE_CAPABILITIES.manager);
assert.equal(maliciousLayout.filter((item) => item.id === "kpi-jobs").length, 1, "Duplicate widgets must collapse");
assert(!maliciousLayout.some((item) => item.id === "unknown-admin-widget"), "Unknown widgets must be rejected");
assert.equal(maliciousLayout.find((item) => item.id === "kpi-jobs")?.size, "compact", "Invalid size must fall back to the catalog default");
assert.equal(maliciousLayout.length, managerDefaults.length, "Missing authorized widgets must be restored from the server catalog");

const guardFiles = {
  operations: "operations.read",
  workforce: "workforce.read",
  assets: "asset.read",
  warehouse: "warehouse.read",
  mission: "mission.read",
  finance: "finance.read",
  procurement: "procurement.read",
  documents: "documents.read",
  governance: "governance.read",
  communications: "communication.read",
  events: "events.read",
  externals: "external_adapters.read",
  release: "governance.read",
  onboarding: "authority.read",
  qr: "qr.read",
  settings: "settings.read",
};

for (const [route, capability] of Object.entries(guardFiles)) {
  const path = join(root, "app", route, "layout.tsx");
  await access(path);
  const source = await readFile(path, "utf8");
  assert(source.includes(`requirePageCapability("${capability}")`), `${route} must require ${capability}`);
}

const migration = await readFile(join(root, "drizzle", "0010_command_dashboard_preferences.sql"), "utf8");
assert(migration.includes("command_dashboard_preferences_tenant_actor_uq"), "Widget preferences need a tenant + actor unique index");

const rateLimitMigration = await readFile(join(root, "drizzle", "0011_ai_rate_limit_windows.sql"), "utf8");
assert(rateLimitMigration.includes("ai_rate_limit_windows_scope_uq"), "AI quota needs an atomic tenant + actor + action + window key");

const authorityMigration = await readFile(join(root, "drizzle", "0012_authority_membership_lifecycle.sql"), "utf8");
assert(authorityMigration.includes("tenant_invitations_token_uq"), "Authority invitations need one-time token uniqueness");
assert(authorityMigration.includes("version"), "Membership lifecycle must use optimistic versions");

const journeyMigration = await readFile(join(root, "drizzle", "0013_commercial_job_journey.sql"), "utf8");
for (const table of ["job_journey_records", "inventory_items", "inventory_movements", "operational_documents"]) {
  assert(journeyMigration.includes(`CREATE TABLE \`${table}\``), `Commercial journey migration must create ${table}`);
}
assert(journeyMigration.includes("inventory_items_tenant_sku_uq"), "Inventory SKUs must be tenant-unique");
assert(journeyMigration.includes("operational_documents_tenant_job_hash_uq"), "Documents must deduplicate by tenant, job and hash");

const w10Migration = await readFile(join(root, "drizzle", "0014_w10_workflows.sql"), "utf8");
assert(w10Migration.includes("CREATE TABLE `w10_workflows`"), "W10 must persist governed workflow records");
assert(w10Migration.includes("w10_workflows_tenant_idempotency_uq"), "W10 workflow creation must be idempotent per tenant");
assert(w10Migration.includes("w10_workflows_tenant_module_status_idx"), "W10 workflow status readback must be indexed");

const rateLimitAdapter = await readFile(join(root, "lib", "ai-rate-limit.ts"), "utf8");
assert(rateLimitAdapter.includes("requestCount} + 1"), "AI quota increments must be atomic");
assert(rateLimitAdapter.includes(".returning({ requestCount"), "AI quota enforcement must use the atomic returned count");
assert(rateLimitAdapter.includes("company_ai_rate_limit_exceeded"), "AI quota must expose a stable 429 contract");

const authorityContext = await readFile(join(root, "lib", "authority-context.ts"), "utf8");
assert(authorityContext.includes("canBootstrapSitesOwner"), "Sites owner bootstrap must be explicitly gated");
assert(authorityContext.includes("eq(tenants.id, SITES_TENANT_ID)"), "Sites owner bootstrap must close after canonical tenant provisioning");
assert(
  authorityContext.indexOf("const neonIdentity = await getNeonAuthIdentity()") < authorityContext.indexOf("const sitesUser = await getChatGPTUser()"),
  "Protected authority must resolve the authenticated Neon identity before the Sites fallback",
);

const pageAccess = await readFile(join(root, "lib", "page-access.ts"), "utf8");
assert(
  pageAccess.includes('identity.status === "error"') &&
    pageAccess.includes('context.identityProvider !== "neon"') &&
    pageAccess.includes('context.identityProvider !== "sites"'),
  "Page access must fail closed on configured Neon auth failures",
);
assert(pageAccess.includes('context.identityProvider !== "sites"'), "Sites page fallback must require a server-derived Sites identity");
for (const page of ["app/page.tsx", "app/command/page.tsx", "app/settings/page.tsx"]) {
  const source = await readFile(join(root, page), "utf8");
  assert(source.includes("requirePage"), `${page} must use the shared fail-closed page gate`);
  assert(!source.includes("getNeonAuthIdentity"), `${page} must not bypass the shared Sites/Neon page gate`);
}

const operationsLayout = await readFile(join(root, "app", "operations", "layout.tsx"), "utf8");
assert(operationsLayout.includes("AuthorityAccessProvider"), "Operations must receive server-derived capability context");
assert(operationsLayout.includes("role={authority.role}"), "Operations must expose the canonical role without hardcoding owner");

const operationsPage = await readFile(join(root, "app", "operations", "page.tsx"), "utf8");
assert(operationsPage.includes('authority.capabilities.has("operations.write")'), "Operations write controls must derive from operations.write");
assert(operationsPage.includes("visibleNavItems"), "Operations navigation must hide unauthorized modules");
assert(operationsPage.includes("canWriteOperations && newJobOpen"), "Read-only roles must not mount the new-job intake");

const jobWorkspace = await readFile(join(root, "components", "operations-job-workspace.tsx"), "utf8");
assert(jobWorkspace.includes("canWriteOperations"), "Job workspace mutation controls must be capability-aware");

const mobileNavigation = await readFile(join(root, "components", "command-mobile-nav.tsx"), "utf8");
assert(mobileNavigation.includes("canOpenCommand"), "Mobile navigation must hide Command-only destinations from field roles");

const preferencesRoute = await readFile(join(root, "app", "api", "command", "preferences", "route.ts"), "utf8");
assert(preferencesRoute.includes("context.tenantId"), "Preference writes must derive tenant from authority context");
assert(preferencesRoute.includes("context.actorId"), "Preference writes must derive actor from authority context");
assert(preferencesRoute.includes('hasCapability(context, "command.customize")'), "Preference writes must require command.customize");

const commandRoute = await readFile(join(root, "app", "api", "command", "ask", "route.ts"), "utf8");
assert(commandRoute.includes("askCompanyAiWithOpenAi"), "Command must call the governed OpenAI adapter");
assert(commandRoute.includes("directWrite: false"), "Command AI must retain the no-direct-write boundary");
assert(commandRoute.includes("consumeCompanyAiRateLimit"), "Command AI must enforce its server-side quota");
assert(commandRoute.includes("payload_too_large"), "Command AI must reject oversized payloads");
const commandDashboardRoute = await readFile(join(root, "app", "api", "command", "dashboard", "route.ts"), "utf8");
assert(commandDashboardRoute.includes("w10Workflows") && commandDashboardRoute.includes("finance.read") && commandDashboardRoute.includes("procurement.read"), "Command dashboard must expose W10 only when both read capabilities exist");
const commandSurface = await readFile(join(root, "components", "command-surface.tsx"), "utf8");
assert(commandSurface.includes("W10CommandPanel") && commandSurface.includes("finance-procurement"), "Command must render the capability-filtered W10 widget");
const commandReadinessRoute = await readFile(join(root, "app", "api", "command", "readiness", "route.ts"), "utf8");
assert(commandReadinessRoute.includes('hasCapability(context, "command.read")') && commandReadinessRoute.includes("getS07Ledger"), "Command readiness must be server-side and ledger-backed");
assert(commandReadinessRoute.includes('commercialStatus: "NO_GO"') && commandReadinessRoute.includes('openAiLive: "NOT_RUN"'), "Command readiness must keep live and commercial status explicit");
assert(commandSurface.includes("CommandReadinessPanel") && commandSurface.includes("command-readiness"), "Command must surface the W12 readiness widget");

const intakeRoute = await readFile(join(root, "app", "api", "operations", "intake", "route.ts"), "utf8");
assert(intakeRoute.includes("consumeCompanyAiRateLimit"), "Commessa intake must enforce its server-side quota");

const openAiAdapter = await readFile(join(root, "lib", "company-ai-openai.ts"), "utf8");
assert(openAiAdapter.includes("authorizedRecordIds"), "Model citations must be filtered against authorized records");
assert(openAiAdapter.includes("process.env[name]") && openAiAdapter.includes("cloudflare:workers"), "The OpenAI key must remain server-side");
assert(openAiAdapter.includes("getCompanyAiRuntimeStatus") && openAiAdapter.includes('liveRequest: "NOT_RUN"'), "OpenAI runtime metadata must not be confused with live evidence");
const aiReadinessRoute = await readFile(join(root, "app", "api", "governance", "ai-readiness", "route.ts"), "utf8");
assert(aiReadinessRoute.includes('hasCapability(context, "governance.read")'), "AI readiness must require governance.read");
assert(aiReadinessRoute.includes("getExternalSnapshot") && aiReadinessRoute.includes("getS07Ledger"), "AI readiness must combine provider evidence and Company AI ledger readback");
assert(aiReadinessRoute.includes('directWrite: false') && aiReadinessRoute.includes('commercialStatus: "NO_GO"'), "AI readiness must preserve no-direct-write and commercial gate semantics");
const aiGovernance = await readFile(join(root, "components", "company-ai-governance.tsx"), "utf8");
assert(aiGovernance.includes("/api/governance/ai-readiness") && aiGovernance.includes("COMMERCIAL NO-GO"), "Governance must expose the W12 readiness control plane");
assert(aiGovernance.includes("/governance/security"), "W12 governance must link to the W16 security control plane");
const securityContract = await readFile(join(root, "lib", "security-governance.ts"), "utf8");
assert(securityContract.includes("document-fail-closed") && securityContract.includes("PENDING_REVIEW") && securityContract.includes("PASS_LOCAL"), "W16 contract must keep fail-closed, human review and restore evidence explicit");
const securityReadinessRoute = await readFile(join(root, "app", "api", "governance", "security-readiness", "route.ts"), "utf8");
assert(securityReadinessRoute.includes('hasCapability(context, "governance.read")') && securityReadinessRoute.includes("buildSecurityControlCatalog"), "W16 readiness must be tenant-scoped and capability-gated");
assert(securityReadinessRoute.includes("MALWARE_SCAN_WEBHOOK_TOKEN") && securityReadinessRoute.includes('commercialStatus: "NO_GO"'), "W16 readiness must expose provider metadata without changing the commercial gate");
const securityPage = await readFile(join(root, "app", "governance", "security", "page.tsx"), "utf8");
const securitySurface = await readFile(join(root, "components", "security-privacy-control.tsx"), "utf8");
assert(securityPage.includes("SecurityPrivacyControl") && securitySurface.includes("/api/governance/security-readiness"), "W16 must have a readable security/privacy surface");
const releaseReadinessRoute = await readFile(join(root, "app", "api", "release", "readiness", "route.ts"), "utf8");
assert(releaseReadinessRoute.includes('hasCapability(context, "governance.read")') && releaseReadinessRoute.includes("buildReleaseGateCatalog"), "W17 release readiness must be tenant-scoped and capability-gated");
assert(releaseReadinessRoute.includes('promotionAllowed: summary.promotionAllowed') && releaseReadinessRoute.includes('tranche: "W17"'), "W17 release readiness must expose the promotion boundary");
const releaseContract = await readFile(join(root, "lib", "release-readiness.ts"), "utf8");
assert(releaseContract.includes("openai-live") && releaseContract.includes("commercial-signoff") && releaseContract.includes("restore-rehearsal"), "W17 release contract must aggregate provider, human and restore gates");
const releasePage = await readFile(join(root, "app", "release", "page.tsx"), "utf8");
const releaseSurface = await readFile(join(root, "components", "release-certification-center.tsx"), "utf8");
assert(releasePage.includes("ReleaseCertificationCenter") && releaseSurface.includes("/api/release/readiness") && releaseSurface.includes("COMMERCIAL NO-GO"), "W17 must have a readable release certification surface");
const releaseBuildRoute = await readFile(join(root, "app", "api", "release", "build", "route.ts"), "utf8");
assert(releaseBuildRoute.includes('tranche: "W17"') && releaseBuildRoute.includes('promotionAllowed: false') && releaseBuildRoute.includes('commercialStatus: "NO_GO"'), "Release identity must remain local and non-promotable");

const membershipRoute = await readFile(join(root, "app", "api", "authority", "memberships", "route.ts"), "utf8");
assert(membershipRoute.includes("createInvitationToken"), "Authority management must issue cryptographic invitations");
assert(membershipRoute.includes("last_active_owner"), "Authority management must protect the last active owner");

const invitationRoute = await readFile(join(root, "app", "api", "authority", "invitations", "accept", "route.ts"), "utf8");
assert(invitationRoute.includes("hashInvitationToken"), "Invitation acceptance must compare token digests");
assert(invitationRoute.includes("normalizedIdentityEmail !== normalizeAuthorityEmail(invitation.email)"), "Invitation acceptance must bind the authenticated email");

const inventoryRoute = await readFile(join(root, "app", "api", "warehouse", "inventory", "route.ts"), "utf8");
assert(inventoryRoute.includes('hasCapability(context, "warehouse.write")'), "Stock mutation must require warehouse.write");
assert(inventoryRoute.includes("inventory_invariant_violation"), "Stock mutation must enforce balance invariants");
assert(inventoryRoute.includes("expected_version_required"), "Stock mutation must require optimistic versions");
assert(inventoryRoute.includes("mission_not_loadable"), "Material loading must reject missions outside the planned state");

const journeyRoute = await readFile(join(root, "app", "api", "operations", "jobs", "[jobId]", "journey", "route.ts"), "utf8");
assert(journeyRoute.includes("ACTION_CAPABILITY"), "Journey actions must be capability-gated");
assert(journeyRoute.includes("planning_end_must_follow_start"), "Planning must validate temporal order");
assert(journeyRoute.includes("proof_of_delivery_recipient_required"), "Delivery must require POD identity");
assert(journeyRoute.includes("mission_verify_pod"), "Mission journey must verify POD before reconciliation");
assert(journeyRoute.includes("mission_reconcile"), "Mission journey must reconcile before close");
assert(journeyRoute.includes("mission_close"), "Mission journey must expose a governed close state");

const planningRoute = await readFile(join(root, "app", "api", "operations", "jobs", "[jobId]", "planning", "route.ts"), "utf8");
assert(planningRoute.includes('hasCapability(context, "planning.write")'), "Advanced planning mutations must require planning.write");
assert(planningRoute.includes('action === "what_if"'), "Planning must expose an isolated what-if path");
assert(planningRoute.includes("planning_conflicts"), "Planning must reject unresolved capacity conflicts");
assert(planningRoute.includes("planning.plan.revised"), "Planning must preserve revision events");
const planningContract = await readFile(join(root, "lib", "planning-contract.ts"), "utf8");
assert(planningContract.includes("QUALIFICATION_MISSING"), "Planning must validate resource qualifications");
assert(planningContract.includes("CAPACITY_EXCEEDED"), "Planning must validate resource capacity");
const planningOptionsRoute = await readFile(join(root, "app", "api", "operations", "jobs", "[jobId]", "planning", "resource-options", "route.ts"), "utf8");
assert(planningOptionsRoute.includes('hasCapability(context, "planning.read")'), "Planning resource options must require planning.read");
assert(planningOptionsRoute.includes("unavailableAssets"), "Planning resource options must expose unavailable assets");

const attendanceRoute = await readFile(join(root, "app", "api", "operations", "jobs", "[jobId]", "attendance", "route.ts"), "utf8");
assert(attendanceRoute.includes('tracking: "ON_DUTY_ONLY"'), "Attendance must declare on-duty tracking policy");
assert(attendanceRoute.includes("correction_approve"), "Attendance must support governed corrections");
assert(attendanceRoute.includes("idempotency_key_required"), "Attendance replay must require idempotency");
assert(attendanceRoute.includes("4_DECIMAL_PLACES"), "Attendance location must be precision-limited");

const assetLifecycleRoute = await readFile(join(root, "app", "api", "assets", "lifecycle", "route.ts"), "utf8");
assert(assetLifecycleRoute.includes('hasCapability(context, "asset.write")'), "Asset lifecycle mutations must require asset.write");
assert(assetLifecycleRoute.includes("invalid_asset_lifecycle_transition"), "Asset lifecycle must enforce state transitions");
assert(assetLifecycleRoute.includes("availabilityGuard"), "Unavailable assets must be guarded from assignment");

const documentRoute = await readFile(join(root, "app", "api", "operations", "jobs", "[jobId]", "documents", "route.ts"), "utf8");
assert(documentRoute.includes("MAX_OPERATIONAL_DOCUMENT_BYTES"), "Document upload must enforce the 20 MB contract");
assert(documentRoute.includes("matchesOperationalDocumentSignature"), "Document upload must validate file signatures");
assert(documentRoute.includes('scanStatus: "NOT_RUN"'), "Document upload must not claim an unavailable malware scan");
const documentSecurity = await readFile(join(root, "app", "api", "documents", "[documentId]", "security", "route.ts"), "utf8");
assert(documentSecurity.includes("malware_scan_provider_not_configured"), "Document security must remain explicit when no provider is configured");
assert(documentSecurity.includes("provider_result"), "Document security must expose provider result readback");
assert(documentSecurity.includes("provider_sha256_mismatch"), "Document provider callbacks must be bound to the stored file hash");
const documentSecurityContract = await readFile(join(root, "lib", "document-security.ts"), "utf8");
assert(documentSecurityContract.includes("document_release_requires_provider_clean"), "Documents must not be released without provider clean evidence");
const outboxContract = await readFile(join(root, "lib", "outbox-contract.ts"), "utf8");
assert(outboxContract.includes("DEAD_LETTERED"), "Outbox must have a dead-letter state");
assert(outboxContract.includes("OUTBOX_MAX_ATTEMPTS"), "Outbox retry budget must be bounded");
const outboxRoute = await readFile(join(root, "app", "api", "events", "outbox", "route.ts"), "utf8");
assert(outboxRoute.includes("transitionOutbox"), "Outbox route must use the governed state machine");
const cloudflareEnv = await readFile(join(root, "cloudflare-env.d.ts"), "utf8");
assert(cloudflareEnv.includes("OPENAI_API_KEY"), "OpenAI runtime secret must be declared as a Site binding");
const externalAdapters = await readFile(join(root, "lib", "external-adapter.ts"), "utf8");
assert(externalAdapters.includes('key: "openai-runtime"') && externalAdapters.includes('status: "NOT_RUN"'), "OpenAI external adapter must distinguish local binding from live certification");
const communicationsLayout = await readFile(join(root, "app", "communications", "layout.tsx"), "utf8");
assert(communicationsLayout.includes('requirePageCapability("communication.read")'), "Communications must be capability-gated");
assert(journeyRoute.includes('document_security: hasCapability(context, "documents.write")'), "Document security controls must be capability-gated in the journey readback");
const eventsControl = await readFile(join(root, "components", "events-control-page.tsx"), "utf8");
assert(eventsControl.includes("/api/events/outbox"), "Events Authority must expose outbox controls");
const journeyControl = await readFile(join(root, "components", "job-commercial-journey.tsx"), "utf8");
assert(journeyControl.includes("mutateDocumentSecurity"), "Job journey must expose document security controls");
const w10Route = await readFile(join(root, "app", "api", "workflows", "[module]", "route.ts"), "utf8");
assert(w10Route.includes("expectedVersion"), "W10 transitions must enforce optimistic versions");
assert(w10Route.includes("approvals.review"), "W10 approval transitions must use the authority capability");
assert(w10Route.includes("external_executor_deferred"), "W10 must not simulate provider-backed execution");
assert(w10Route.includes("s06Outbox") && w10Route.includes("s06Reconciliations"), "W10 transitions must emit outbox and reconciliation readback");
const w10Control = await readFile(join(root, "components", "w10-workflow-control.tsx"), "utf8");
assert(w10Control.includes("/api/${module}/workflow"), "W10 UI must use the governed workflow endpoint");
assert(w10Control.includes("externalActions"), "W10 UI must visibly hold provider-backed actions");
for (const page of ["app/finance/page.tsx", "app/procurement/page.tsx"]) {
  const source = await readFile(join(root, page), "utf8");
  assert(source.includes("W10WorkflowControl"), `${page} must use the W10 governed surface`);
}

const hosting = JSON.parse(await readFile(join(root, ".openai", "hosting.json"), "utf8"));
assert.equal(hosting.r2, "BUCKET", "Commercial documents require the R2 binding");

const releaseManifest = JSON.parse(await readFile(join(root, "docs", "COMMERCIAL_V1_RC2_9_LOCAL_BUILD_MANIFEST.json"), "utf8"));
assert.equal(releaseManifest.buildId, RELEASE_BUILD_ID, "Runtime and RC2.9 manifest must share one build ID");
assert.equal(releaseManifest.promotion.allowed, false, "RC2.9 must remain blocked from deployment");
assert.equal(releaseManifest.rollback.d1RestoreRehearsal, "PASS_LOCAL", "RC2.9 must record the D1 restore rehearsal");
assert.equal(releaseManifest.rollback.r2RestoreRehearsal, "PASS_LOCAL", "RC2.9 must record the R2 restore rehearsal");
assert.equal(releaseManifest.releaseCenter.tranche, "W17", "RC2.9 manifest must bind the W17 release center");
assert.equal(releaseManifest.verification.runtimeHttpSmoke.local, "PASS_LOCAL_AUTH_PWA_AND_NO_GO_BOUNDARY", "RC2.9 must record the local runtime smoke evidence");
assert.equal(releaseManifest.verification.runtimeHttpSmoke.publishedEdge, "PASS_OWNER_ONLY_EDGE", "RC2.9 must record the published owner-only edge evidence");
const serviceWorker = await readFile(join(root, "public", "sw.js"), "utf8");
assert(serviceWorker.includes(RELEASE_BUILD_ID), "The service worker cache must use the current RC build ID");

console.log(JSON.stringify({
  status: "PASS",
  roles: AUTHORITY_ROLES.length,
  widgets: COMMAND_WIDGET_CATALOG.length,
  guardedRoutes: Object.keys(guardFiles).length,
  migrations: 5,
  aiGuards: ["payload_limit", "rate_limit", "citation_allowlist", "no_direct_write"],
  commercialJourney: ["planning", "field", "inventory", "mission", "documents", "communications", "procurement", "finance"],
  localHardening: ["openai_site_binding", "company_ai_readiness_control_plane", "security_privacy_dr_readiness", "release_certification_center", "runtime_http_smoke", "outbox_retry_dlq", "document_security_hold", "mission_pod_reconciliation", "w10_workflow_approval_reconcile"],
  checks: "commercial-v1-static-contract",
}));
