import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registry = JSON.parse(await fs.readFile(path.join(root, "config/commercial-modules.json"), "utf8"));
const navigationSource = await fs.readFile(path.join(root, "lib/command-dashboard.ts"), "utf8");

async function exists(relative) {
  return fs.access(path.join(root, relative)).then(() => true).catch(() => false);
}

async function source(relative) {
  return fs.readFile(path.join(root, relative), "utf8");
}

const seenIds = new Set();
const seenRoutes = new Set();
const modules = [];

for (const entry of registry) {
  assert(!seenIds.has(entry.id), `Duplicate commercial module id: ${entry.id}`);
  assert(!seenRoutes.has(entry.route), `Duplicate commercial module route: ${entry.route}`);
  seenIds.add(entry.id);
  seenRoutes.add(entry.route);

  const pageExists = await exists(entry.page);
  const surfaceSources = await Promise.all(entry.surface.map(source));
  const pageSource = await source(entry.page);
  const combined = [pageSource, ...surfaceSources].join("\n");
  const routePattern = new RegExp(`id:\\s*"${entry.id}"[\\s\\S]{0,180}?path:\\s*"${entry.route.replaceAll("/", "\\/")}"`);
  const hasCanonicalNavigation = routePattern.test(navigationSource);
  const hasOfficialMark = combined.includes("ai-zerow-icon");
  const hasCarbonSurface = /carbon-card|zw-command-ultra|authority-page|login-surface/.test(combined);
  const hasRefresh = /RefreshCw|Aggiorna|window\.location\.reload/.test(combined);
  const hasBack = /ArrowLeft|Torna indietro|router\.back\(\)|history\.back/.test(combined);
  const hasMobileContract = combined.includes("CommandMobileNav") || combined.includes("zw-mobile-nav");
  const shellMode = combined.includes("zw-app-shell") ? "CANONICAL" : "LEGACY_CSS_BRIDGED";

  modules.push({
    order: entry.order,
    id: entry.id,
    route: entry.route,
    pageExists,
    navigation: hasCanonicalNavigation ? "PASS" : entry.navigation === false ? "SECONDARY_SURFACE" : "FAIL",
    officialMark: hasOfficialMark ? "PASS" : "FAIL",
    carbonSurface: hasCarbonSurface ? "PASS" : "FAIL",
    refresh: hasRefresh ? "LOCAL" : "GLOBAL_FALLBACK",
    back: hasBack ? "LOCAL" : "GLOBAL_FALLBACK",
    mobile: hasMobileContract ? "OPERATIONAL_NAV" : "DESKTOP_OR_GLOBAL_SHELL",
    shell: shellMode,
  });
}

assert.equal(registry.length, 21, "Commercial registry must cover all commercial and account surfaces");
assert(modules.every((item) => item.pageExists), "Every commercial module must have a route page");
assert(modules.filter((item) => registry.find((entry) => entry.id === item.id)?.navigation !== false).every((item) => item.navigation === "PASS"), "Every primary module must be represented in canonical navigation");
assert(modules.every((item) => item.officialMark === "PASS"), "Every commercial module must use the official ZEROW mark");
assert(modules.every((item) => item.carbonSurface === "PASS"), "Every commercial module must use the shared carbon surface vocabulary");

const localRefresh = modules.filter((item) => item.refresh === "LOCAL").length;
const localBack = modules.filter((item) => item.back === "LOCAL").length;
const operationalNav = modules.filter((item) => item.mobile === "OPERATIONAL_NAV").length;

console.log(JSON.stringify({
  status: "PASS_WITH_RUNTIME_GATES",
  registry: { modules: modules.length, canonicalRoutes: [...seenRoutes] },
  alignment: { localRefresh, localBack, globalFallbackContract: true, operationalNav },
  modules,
  gates: {
    authenticatedBrowser: "NOT_RUN",
    devicePwa: "NOT_RUN",
    providerBackedMapGpsAi: "EXTERNAL_GATE",
  },
}, null, 2));
