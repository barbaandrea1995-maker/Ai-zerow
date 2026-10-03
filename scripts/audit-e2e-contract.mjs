import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (["node_modules", ".next", "dist", ".wrangler"].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(absolute);
  }
  return files;
}

async function read(relative) {
  return fs.readFile(path.join(root, relative), "utf8");
}

function requireContract(source, pattern, label) {
  assert.match(source, pattern, `Missing contract: ${label}`);
}

const teamRoute = await read("app/api/authority/teams/route.ts");
const onboarding = await read("app/onboarding/page.tsx");
const resourceLibrary = await read("lib/planning-resources.ts");
const resourceRoute = await read("app/api/operations/jobs/[jobId]/planning/resource-options/route.ts");
const resourceFields = await read("components/planning-resource-fields.tsx");
const operationsPlanning = await read("app/operations/page.tsx");
const planningWriteRoute = await read("app/api/operations/jobs/[jobId]/planning/route.ts");
const authorityContext = await read("lib/authority-context.ts");
const authorityCatalog = await read("lib/authority-catalog.ts");

requireContract(teamRoute, /hasCapability\(context, "authority\.read"\)/, "team read capability gate");
requireContract(teamRoute, /hasCapability\(context, "authority\.manage"\)/, "team write capability gate");
requireContract(teamRoute, /eq\(s04Records\.tenantId, tenantId\)/, "team tenant-scoped readback");
requireContract(teamRoute, /eq\(tenantMemberships\.tenantId, context\.tenantId\)/, "team member tenant boundary");
requireContract(teamRoute, /memberIds: invalidMemberIds|team_membership_not_active/, "team active membership validation");
requireContract(teamRoute, /authority\.team\.created/, "team event ledger");
requireContract(teamRoute, /zerow\.authority\.team\.created/, "team outbox publication");
requireContract(teamRoute, /SITES_READBACK_VERIFIED/, "team reconciliation readback");
requireContract(teamRoute, /source: "sites-d1-authority-team-readback"/, "team response readback source");
requireContract(onboarding, /fetch\("\/api\/authority\/teams"/, "team UI server readback");
requireContract(onboarding, /fetch\("\/api\/authority\/teams",\s*\{\s*method: "POST"/, "team UI create action");
requireContract(onboarding, /Crea squadra/, "team create control");
requireContract(onboarding, /teamMemberIds\.length/, "team UI requires real members");

requireContract(resourceLibrary, /jobJourneyRecords/, "planning active plan source");
requireContract(resourceLibrary, /inArray\(jobJourneyRecords\.status, \["DRAFT", "PUBLISHED"\]\)/, "planning active plan status filter");
requireContract(resourceLibrary, /availableForWindow/, "planning server availability field");
requireContract(resourceLibrary, /overlaps\(window, assignment\)/, "planning server interval overlap");
requireContract(resourceRoute, /searchParams\.get\("startsAt"\)/, "planning start window query");
requireContract(resourceRoute, /searchParams\.get\("endsAt"\)/, "planning end window query");
requireContract(resourceRoute, /unavailableForWindow/, "planning unavailable readback");
requireContract(resourceRoute, /server-window-lifecycle-and-tenant-active-plans/, "planning server guard contract");
requireContract(resourceFields, /startsAt: string/, "planning UI start prop");
requireContract(resourceFields, /endsAt: string/, "planning UI end prop");
requireContract(resourceFields, /params\.set\("startsAt"/, "planning UI sends start window");
requireContract(resourceFields, /params\.set\("endsAt"/, "planning UI sends end window");
requireContract(resourceFields, /disabled=\{!available\}/, "planning UI blocks occupied resources");
requireContract(operationsPlanning, /startsAt=\{planningStartsAt\}/, "operations planning passes start window");
requireContract(operationsPlanning, /endsAt=\{planningEndsAt\}/, "operations planning passes end window");
requireContract(operationsPlanning, /resource-options\$\{query \? `\?\$\{query\}` : ""\}/, "operations planning server availability query");
requireContract(planningWriteRoute, /resolvePlanningResources/, "planning server canonical resource resolution");
requireContract(planningWriteRoute, /evaluateAgainstTenant/, "planning server tenant conflict evaluation");

requireContract(authorityContext, /context\.tenantId/, "authority tenant context");
requireContract(authorityContext, /assertTenantScope/, "authority tenant assertion");
requireContract(authorityCatalog, /ROLE_CAPABILITIES/, "canonical capability catalog");

const sourceFiles = [
  ...(await walk(path.join(root, "app"))),
  ...(await walk(path.join(root, "components"))),
];
const buttonInventory = [];
const suspiciousButtons = [];
for (const file of sourceFiles) {
  const source = await fs.readFile(file, "utf8");
  // Do not stop at the `>` in an inline arrow (`onClick={() => ...}`).
  // This is intentionally a conservative inventory scan, not a JSX parser.
  for (const match of source.matchAll(/<(button|Button)\b([\s\S]*?)(?<![=])>/g)) {
    const attributes = match[2];
    const relative = path.relative(root, file);
    const hasClick = /\bonClick\s*=/.test(attributes);
    const isSubmit = /\btype\s*=\s*(?:["']submit["']|\{\s*["']submit["']\s*\})/.test(attributes);
    const isLink = /\bhref\s*=|\basChild\b/.test(attributes);
    const classification = hasClick ? "click-bound" : isSubmit ? "form-bound" : isLink ? "navigation-bound" : "unbound-or-declarative";
    buttonInventory.push({ file: relative, tag: match[1], classification });
    const wrapperBound = /DialogClose\s+asChild|DropdownMenuTrigger\s+asChild|DropdownMenuItem/.test(source);
    if (classification === "unbound-or-declarative" && !wrapperBound) suspiciousButtons.push({ file: relative, tag: match[1] });
  }
}

// Declarative buttons are allowed only when they are part of an explicitly
// inspected static surface. Keep the list visible in CI output instead of
// pretending a source scan is equivalent to an authenticated click test.
const allowedDeclarative = new Set([
  "components/ui/button.tsx",
  "components/ui/dialog.tsx",
  "components/ui/tabs.tsx",
  "components/ui/tooltip.tsx",
  "components/ui/attachment.tsx",
  "components/ui/calendar.tsx",
  "components/ui/combobox.tsx",
  "components/ui/input-group.tsx",
  "components/ui/message-scroller.tsx",
]);
const unexplainedButtons = suspiciousButtons.filter((item) => !allowedDeclarative.has(item.file));

const runtimeUrl = (process.env.ZEROW_RUNTIME_URL || "").replace(/\/$/, "");
let runtime = { status: "NOT_RUN", reason: "ZEROW_RUNTIME_URL not supplied" };
if (runtimeUrl) {
  const paths = ["/", "/api/authority/teams", "/api/operations/jobs/unknown/planning/resource-options"];
  const results = [];
  for (const route of paths) {
    const response = await fetch(`${runtimeUrl}${route}`, { redirect: "manual" });
    results.push({ route, status: response.status });
  }
  assert.equal(results.find((item) => item.route === "/api/authority/teams")?.status, 401, "team API must fail closed without identity");
  assert.equal(results.find((item) => item.route === "/api/operations/jobs/unknown/planning/resource-options")?.status, 401, "planning resource API must fail closed without identity");
  runtime = { status: "PASS", baseUrl: runtimeUrl, unauthenticatedBoundary: results };
}

console.log(JSON.stringify({
  status: unexplainedButtons.length === 0 ? "PASS_WITH_AUTHENTICATED_GATE" : "FAIL_UNBOUND_BUTTON_SURFACE",
  contracts: {
    authorityTeams: "PASS",
    planningAvailability: "PASS",
    tenantAndRoleGuards: "PASS",
    readbackLedger: "PASS",
  },
  interactions: {
    buttonsScanned: buttonInventory.length,
    suspiciousButtons: unexplainedButtons,
    criterion: "click-bound, form-bound or navigation-bound; declarative primitives excluded only when explicitly allow-listed",
  },
  runtime,
  authenticatedE2E: {
    status: "NOT_RUN",
    reason: "Requires a real authenticated owner/member session; source and unauthenticated fail-closed boundaries are verified separately.",
    journeys: [
      "authority team create → D1 s04 → s06 event/outbox/reconciliation → team GET readback",
      "planning window → server resource-options → occupied resource disabled → planning write guard",
      "role capability deny/allow → tenant A/B isolation",
    ],
  },
}, null, 2));
