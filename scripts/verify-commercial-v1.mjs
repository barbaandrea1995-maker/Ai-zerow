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

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

assert.equal(AUTHORITY_ROLES.length, 13, "The canonical role catalog must contain 13 roles");
assert.equal(new Set(AUTHORITY_ROLES).size, AUTHORITY_ROLES.length, "Role IDs must be unique");
assert.equal(new Set(COMMAND_WIDGET_CATALOG.map((widget) => widget.id)).size, COMMAND_WIDGET_CATALOG.length, "Widget IDs must be unique");

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
  events: "events.read",
  externals: "external_adapters.read",
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
  pageAccess.includes('identity.status !== "authenticated"') &&
    pageAccess.includes('identity.status !== "not_configured"'),
  "Page access must fail closed on configured Neon auth failures",
);
assert(pageAccess.includes('context?.identityProvider !== "sites"'), "Sites page fallback must require a server-derived Sites identity");
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

const intakeRoute = await readFile(join(root, "app", "api", "operations", "intake", "route.ts"), "utf8");
assert(intakeRoute.includes("consumeCompanyAiRateLimit"), "Commessa intake must enforce its server-side quota");

const openAiAdapter = await readFile(join(root, "lib", "company-ai-openai.ts"), "utf8");
assert(openAiAdapter.includes("authorizedRecordIds"), "Model citations must be filtered against authorized records");
assert(openAiAdapter.includes("process.env.OPENAI_API_KEY"), "The OpenAI key must remain server-side");

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

const documentRoute = await readFile(join(root, "app", "api", "operations", "jobs", "[jobId]", "documents", "route.ts"), "utf8");
assert(documentRoute.includes("MAX_OPERATIONAL_DOCUMENT_BYTES"), "Document upload must enforce the 20 MB contract");
assert(documentRoute.includes("matchesOperationalDocumentSignature"), "Document upload must validate file signatures");
assert(documentRoute.includes('scanStatus: "NOT_RUN"'), "Document upload must not claim an unavailable malware scan");

const hosting = JSON.parse(await readFile(join(root, ".openai", "hosting.json"), "utf8"));
assert.equal(hosting.r2, "BUCKET", "Commercial documents require the R2 binding");

const releaseManifest = JSON.parse(await readFile(join(root, "docs", "COMMERCIAL_V1_RC2_BUILD_MANIFEST.json"), "utf8"));
assert.equal(releaseManifest.buildId, RELEASE_BUILD_ID, "Runtime and RC2 manifest must share one build ID");
assert.equal(releaseManifest.promotion.allowed, false, "RC2 must remain blocked from deployment");
assert.equal(releaseManifest.rollback.d1RestoreRehearsal, "PASS_LOCAL", "RC2 must record the D1 restore rehearsal");
assert.equal(releaseManifest.rollback.r2RestoreRehearsal, "PASS_LOCAL", "RC2 must record the R2 restore rehearsal");
const serviceWorker = await readFile(join(root, "public", "sw.js"), "utf8");
assert(serviceWorker.includes(RELEASE_BUILD_ID), "The service worker cache must use the RC2 build ID");

console.log(JSON.stringify({
  status: "PASS",
  roles: AUTHORITY_ROLES.length,
  widgets: COMMAND_WIDGET_CATALOG.length,
  guardedRoutes: Object.keys(guardFiles).length,
  migrations: 4,
  aiGuards: ["payload_limit", "rate_limit", "citation_allowlist", "no_direct_write"],
  commercialJourney: ["planning", "field", "inventory", "mission", "documents"],
  checks: "commercial-v1-static-contract",
}));
