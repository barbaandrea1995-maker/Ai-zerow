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

console.log(JSON.stringify({
  status: "PASS",
  roles: AUTHORITY_ROLES.length,
  widgets: COMMAND_WIDGET_CATALOG.length,
  guardedRoutes: Object.keys(guardFiles).length,
  migrations: 2,
  aiGuards: ["payload_limit", "rate_limit", "citation_allowlist", "no_direct_write"],
  checks: "commercial-v1-static-contract",
}));
