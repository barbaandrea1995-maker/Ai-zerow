import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { AUTHORITY_ROLES, ROLE_CAPABILITIES, ROLE_METADATA } from "../lib/authority-catalog.ts";
import { COMMAND_NAVIGATION, COMMAND_WIDGET_CATALOG } from "../lib/command-dashboard.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registry = JSON.parse(await fs.readFile(path.join(root, "config/commercial-modules.json"), "utf8"));
const knownCapabilities = new Set(Object.values(ROLE_CAPABILITIES).flat());
const knownRoles = new Set(AUTHORITY_ROLES);

async function walk(directory, predicate) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (["node_modules", ".next", "dist"].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute, predicate));
    else if (predicate(absolute)) files.push(absolute);
  }
  return files;
}

async function exists(relative) {
  return fs.access(path.join(root, relative)).then(() => true).catch(() => false);
}

function stringLiteral(node) {
  return ts.isStringLiteralLike(node) ? node.text : null;
}

function collectStringLiterals(node) {
  const values = [];
  const visit = (candidate) => {
    const value = stringLiteral(candidate);
    if (value !== null) values.push(value);
    ts.forEachChild(candidate, visit);
  };
  visit(node);
  return values;
}

function capabilityLike(value) {
  return /^[a-z][a-z0-9_]*(?:\.[a-z0-9_-]+)+$/.test(value);
}

function pageCapabilityGuards(source, file) {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const guards = new Set();
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callName = ts.isIdentifier(node.expression)
        ? node.expression.text
        : ts.isPropertyAccessExpression(node.expression)
          ? node.expression.name.text
          : "";
      if (callName === "requirePageCapability" || callName === "hasCapability") {
        const value = stringLiteral(node.arguments[callName === "hasCapability" ? 1 : 0]);
        if (value) guards.add(value);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return guards;
}

const sourceFiles = [
  ...(await walk(path.join(root, "app"), (file) => /\.(ts|tsx)$/.test(file))),
  ...(await walk(path.join(root, "components"), (file) => /\.(ts|tsx)$/.test(file))),
  ...(await walk(path.join(root, "lib"), (file) => /\.(ts|tsx)$/.test(file))),
];

const usedCapabilities = new Map();
const usedRoleLiterals = new Map();
const capabilityProperties = new Set(["capability", "requiredCapability", "requiredCapabilities", "anyCapabilities"]);

function remember(map, value, file) {
  if (!map.has(value)) map.set(value, new Set());
  map.get(value).add(path.relative(root, file).replaceAll(path.sep, "/"));
}

for (const file of sourceFiles) {
  const source = await fs.readFile(file, "utf8");
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callName = ts.isIdentifier(node.expression)
        ? node.expression.text
        : ts.isPropertyAccessExpression(node.expression)
          ? node.expression.name.text
          : "";
      const argumentIndex = callName === "hasCapability" ? 1 : callName === "requirePageCapability" ? 0 : -1;
      if (argumentIndex >= 0) {
        const value = stringLiteral(node.arguments[argumentIndex]);
        if (value && capabilityLike(value)) remember(usedCapabilities, value, file);
      }
      if (callName === "includes" && ts.isPropertyAccessExpression(node.expression)) {
        const target = node.expression.expression.getText(sourceFile);
        const value = stringLiteral(node.arguments[0]);
        if (value && capabilityLike(value) && /(?:^|\.)capabilities$/.test(target)) remember(usedCapabilities, value, file);
        if (value && /(?:^|\.)roles$/.test(target)) remember(usedRoleLiterals, value, file);
      }
    }
    if (ts.isPropertyAssignment(node)) {
      const name = ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name) ? node.name.text : "";
      if (capabilityProperties.has(name)) {
        for (const value of collectStringLiterals(node.initializer)) {
          if (capabilityLike(value)) remember(usedCapabilities, value, file);
        }
      }
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && /_ROLES$/.test(node.name.text)) {
      for (const value of collectStringLiterals(node.initializer ?? node)) {
        if (/^[a-z][a-z0-9_]+$/.test(value)) remember(usedRoleLiterals, value, file);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

const unknownCapabilities = [...usedCapabilities].filter(([capability]) => !knownCapabilities.has(capability));
const unknownRoles = [...usedRoleLiterals].filter(([role]) => !knownRoles.has(role));
assert.deepEqual(unknownCapabilities, [], `Unknown capability references: ${JSON.stringify(unknownCapabilities)}`);
assert.deepEqual(unknownRoles, [], `Unknown role references: ${JSON.stringify(unknownRoles)}`);

assert.deepEqual([...Object.keys(ROLE_METADATA)].sort(), [...AUTHORITY_ROLES].sort(), "Every authority role must have metadata");
for (const role of AUTHORITY_ROLES) {
  assert(ROLE_CAPABILITIES[role].length > 0, `Role ${role} must grant at least one capability`);
  assert.equal(new Set(ROLE_CAPABILITIES[role]).size, ROLE_CAPABILITIES[role].length, `Role ${role} contains duplicate capabilities`);
}

for (const [write, read] of [
  ["operations.write", "operations.read"], ["workforce.write", "workforce.read"], ["field.write", "field.read"],
  ["warehouse.write", "warehouse.read"], ["mission.write", "mission.read"], ["documents.write", "documents.read"],
  ["planning.write", "planning.read"], ["asset.write", "asset.read"], ["finance.write", "finance.read"],
  ["procurement.write", "procurement.read"], ["communication.send", "communication.read"], ["qr.write", "qr.read"],
]) {
  for (const role of AUTHORITY_ROLES) {
    if (ROLE_CAPABILITIES[role].includes(write)) assert(ROLE_CAPABILITIES[role].includes(read), `${role}: ${write} requires ${read}`);
  }
}

const registryIds = new Set();
const registryRoutes = new Set();
for (const moduleEntry of registry) {
  assert(!registryIds.has(moduleEntry.id), `Duplicate commercial module id: ${moduleEntry.id}`);
  assert(!registryRoutes.has(moduleEntry.route), `Duplicate commercial module route: ${moduleEntry.route}`);
  registryIds.add(moduleEntry.id);
  registryRoutes.add(moduleEntry.route);
  assert(knownCapabilities.has(moduleEntry.capability), `${moduleEntry.id}: unknown registry capability ${moduleEntry.capability}`);
  assert(await exists(moduleEntry.page), `${moduleEntry.id}: page does not exist (${moduleEntry.page})`);
  for (const surface of moduleEntry.surface) assert(await exists(surface), `${moduleEntry.id}: surface does not exist (${surface})`);
  const firstSegment = moduleEntry.route.split("/").filter(Boolean)[0];
  const layout = firstSegment ? `app/${firstSegment}/layout.tsx` : "app/layout.tsx";
  const guardSources = [moduleEntry.page, ...(await exists(layout) ? [layout] : [])];
  const guardSets = await Promise.all(guardSources.map(async (file) => pageCapabilityGuards(await fs.readFile(path.join(root, file), "utf8"), file)));
  assert(guardSets.some((guards) => guards.has(moduleEntry.capability)), `${moduleEntry.id}: page/layout must enforce ${JSON.stringify(moduleEntry.capability)} through requirePageCapability or an explicit server context check`);
}

for (const item of COMMAND_NAVIGATION) {
  assert(knownCapabilities.has(item.requiredCapability), `${item.id}: unknown navigation capability ${item.requiredCapability}`);
  assert(registryRoutes.has(item.path), `${item.id}: navigation route missing from commercial registry (${item.path})`);
}
for (const widget of COMMAND_WIDGET_CATALOG) {
  for (const capability of [...widget.requiredCapabilities, ...("anyCapabilities" in widget ? widget.anyCapabilities : [])]) {
    assert(knownCapabilities.has(capability), `${widget.id}: unknown widget capability ${capability}`);
  }
}
const primaryRegistryRoutes = new Set(registry.filter((module) => module.navigation !== false).map((module) => module.route));
assert.deepEqual([...primaryRegistryRoutes].sort(), COMMAND_NAVIGATION.map((item) => item.path).sort(), "Commercial registry and command navigation must cover the same primary modules");

const apiFiles = await walk(path.join(root, "app/api"), (file) => file.endsWith("/route.ts"));
const publicApiFiles = new Set([
  "app/api/auth/[...path]/route.ts",
  "app/api/release/build/route.ts",
  "app/api/location/webhooks/traccar/route.ts",
]);
const authorityProviders = /getAuthorityContext|getSitesAuthorityContext|getAuthenticatedIdentity|getAccessibleTenantDirectory|getNeonAuthContext|getNeonAuthIdentity|getS04Context|getS05Context|getS06Context|getS07Context|getExternalContext|getQrContext/;
const unguardedApiRoutes = [];
const unscopedDatabaseRoutes = [];
for (const file of apiFiles) {
  const relative = path.relative(root, file).replaceAll(path.sep, "/");
  const source = await fs.readFile(file, "utf8");
  const delegatesToGuardedRoute = /from\s+["']@\/app\/api\//.test(source) && /export\s+(?:\{|const\s+(?:GET|POST|PUT|PATCH|DELETE))/.test(source);
  const webhookGuard = relative === "app/api/location/webhooks/traccar/route.ts" && /signature|secret|timingSafeEqual/i.test(source);
  if (!publicApiFiles.has(relative) && !delegatesToGuardedRoute && !authorityProviders.test(source)) unguardedApiRoutes.push(relative);
  if (source.includes("getDb(") && !/(?:tenantId|tenant_id)/.test(source) && !webhookGuard) unscopedDatabaseRoutes.push(relative);
}
assert.deepEqual(unguardedApiRoutes, [], `API routes without an authority boundary: ${unguardedApiRoutes.join(", ")}`);
assert.deepEqual(unscopedDatabaseRoutes, [], `Database API routes without tenant scoping: ${unscopedDatabaseRoutes.join(", ")}`);

const schemaSource = await fs.readFile(path.join(root, "db/schema.ts"), "utf8");
const tenantScopedRegistries = [
  "accessProfiles", "commandDashboardPreferences", "companyAiJobScopes", "deliveryEvents", "geoLocations", "geofences",
  "inventoryItems", "inventoryMovements", "jobJourneyRecords", "locationAccessAudit", "locationEvents", "locationSamples",
  "financeDocuments", "operationalDocuments", "qrCodes", "routePlans", "routeStops", "s04Records", "s05Records", "s06Events", "s06Outbox",
  "s06Reconciliations", "s07AiLedger", "tenantInvitations", "tenantMemberships", "tenantWarehouses", "trackingDevices",
  "trackingProviders", "trackingSessions", "vehicleDeviceBindings", "w10Workflows",
];
for (const name of tenantScopedRegistries) {
  const start = schemaSource.indexOf(`export const ${name} =`);
  assert(start >= 0, `Missing server-side registry schema: ${name}`);
  const next = schemaSource.indexOf("\nexport const ", start + 1);
  const block = schemaSource.slice(start, next >= 0 ? next : undefined);
  assert(block.includes('tenantId: text("tenant_id")'), `${name}: server-side registry must be tenant-scoped`);
}

console.log(JSON.stringify({
  status: "PASS",
  modules: registry.length,
  roles: AUTHORITY_ROLES.length,
  catalogCapabilities: knownCapabilities.size,
  referencedCapabilities: usedCapabilities.size,
  referencedRoles: usedRoleLiterals.size,
  apiRoutes: apiFiles.length,
  tenantScopedRegistries: tenantScopedRegistries.length,
  checks: [
    "role_catalog", "capability_references", "write_implies_read", "module_registry", "page_guards",
    "command_navigation", "widget_capabilities", "api_authority_boundaries", "api_tenant_scoping", "server_registry_tenant_keys",
  ],
}, null, 2));
