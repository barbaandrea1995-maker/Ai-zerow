import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function walk(directory, predicate) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === "dist") continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute, predicate));
    else if (predicate(absolute)) files.push(absolute);
  }
  return files;
}

function routePattern(file, baseDirectory) {
  const relative = path.relative(baseDirectory, file).replaceAll(path.sep, "/");
  const segments = relative.split("/");
  segments.pop();
  if (segments.length === 0) return "/";
  return `/${segments.map((segment) => segment
    .replace(/^\[\.\.\.(.+)\]$/, "*$1")
    .replace(/^\[(.+)\]$/, ":$1"))
    .join("/")}`;
}

function routeMatches(callPath, routePath) {
  const callSegments = callPath.split("/").filter(Boolean);
  const routeSegments = routePath.split("/").filter(Boolean);
  if (callSegments.length !== routeSegments.length && !routeSegments.at(-1)?.startsWith("*")) return false;
  return routeSegments.every((segment, index) => segment.startsWith(":") || segment.startsWith("*") || segment === callSegments[index]);
}

function normalizedApiCall(value) {
  const withoutQuery = value.split("?")[0];
  return withoutQuery.replace(/\$\{[^}]+\}/g, ":param");
}

async function read(file) {
  return fs.readFile(file, "utf8");
}

const pageFiles = await walk(path.join(root, "app"), (file) => file.endsWith("/page.tsx"));
const layoutFiles = await walk(path.join(root, "app"), (file) => file.endsWith("/layout.tsx"));
const apiFiles = await walk(path.join(root, "app/api"), (file) => file.endsWith("/route.ts"));
const sourceFiles = [
  ...(await walk(path.join(root, "app"), (file) => file.endsWith(".ts") || file.endsWith(".tsx"))),
  ...(await walk(path.join(root, "components"), (file) => file.endsWith(".ts") || file.endsWith(".tsx"))),
  ...(await walk(path.join(root, "lib"), (file) => file.endsWith(".ts") || file.endsWith(".tsx"))),
];

const pageRoutes = pageFiles.map((file) => routePattern(file, path.join(root, "app"))).sort();
const apiRoutes = apiFiles.map((file) => `/api${routePattern(file, path.join(root, "app/api"))}`).sort();
const routeSource = await read(path.join(root, "lib/command-dashboard.ts"));
const navigation = [...routeSource.matchAll(/\{\s*id:\s*"([^"]+)",\s*path:\s*"([^"]+)",\s*requiredCapability:\s*"([^"]+)"/g)]
  .map((match) => ({ id: match[1], path: match[2], requiredCapability: match[3] }));

const apiCallSet = new Set();
for (const file of sourceFiles) {
  const source = await read(file);
  for (const match of source.matchAll(/[`"'](\/api\/[^`"'\\\s)]+)[`"']/g)) {
    apiCallSet.add(normalizedApiCall(match[1]));
  }
}
const apiCalls = [...apiCallSet].sort();
const dynamicApiCallBindings = {
  "/api/:param/workflow": ["/api/finance/workflow", "/api/procurement/workflow"],
};
const unresolvedApiCalls = apiCalls.filter((call) => {
  if (apiRoutes.some((route) => routeMatches(call, route))) return false;
  const concreteRoutes = dynamicApiCallBindings[call] ?? [];
  return !concreteRoutes.every((route) => apiRoutes.includes(route));
});

const guardedLayouts = [];
for (const file of layoutFiles) {
  const source = await read(file);
  if (source.includes("requirePageCapability") || source.includes("requirePageContext")) guardedLayouts.push(path.relative(root, file));
}

const commandSurface = await read(path.join(root, "components/command-surface.tsx"));
function unboundIconButtons(source, file) {
  return [...source.matchAll(/<IconButton\b([^>]*)>/g)]
    .filter((match) => !match[1].includes("onClick="))
    .map((match) => ({ file, label: match[1].match(/label="([^"]+)"/)?.[1] ?? "unknown" }));
}
const activeUnboundControls = unboundIconButtons(commandSurface, "components/command-surface.tsx");

const allSource = await Promise.all(sourceFiles.map(read)).then((sources) => sources.join("\n"));
const gpsBrowserApi = /navigator\.geolocation|getCurrentPosition|watchPosition/.test(allSource);
const mapProvider = /geoapify|maplibre|leaflet|google\s*maps|googlemaps|maptiler|tomtom/i.test(allSource);
const openAiAdapter = /askCompanyAiWithOpenAi/.test(allSource);
const pwaArtifacts = {
  manifest: await fs.access(path.join(root, "public/manifest.webmanifest")).then(() => true).catch(() => false),
  serviceWorker: await fs.access(path.join(root, "public/sw.js")).then(() => true).catch(() => false),
};

const navigationGaps = navigation.filter((item) => !pageRoutes.some((route) => routeMatches(item.path, route)));
const status = activeUnboundControls.length === 0 && unresolvedApiCalls.length === 0 && navigationGaps.length === 0
  ? "PASS_WITH_EXTERNAL_GATES"
  : "FAIL_LOCAL_SURFACE_CONTRACT";

console.log(JSON.stringify({
  status,
  inventory: {
    pageRoutes: pageRoutes.length,
    layouts: layoutFiles.length,
    guardedLayouts: guardedLayouts.length,
    apiRoutes: apiRoutes.length,
    commandNavigationItems: navigation.length,
  },
  bindings: {
    referencedApiEndpoints: apiCalls.length,
    unresolvedApiEndpoints: unresolvedApiCalls,
    dynamicApiEndpointBindings: dynamicApiCallBindings,
    navigationGaps,
    activeCommandUnboundIconButtons: activeUnboundControls,
  },
  integrations: {
    companyAiOpenAiAdapterPresent: openAiAdapter,
    browserGpsApiDetected: gpsBrowserApi,
    mapProviderDetected: mapProvider,
    mapStatus: mapProvider ? "PROVIDER_CODE_PRESENT_RUNTIME_CHECK_REQUIRED" : "SCHEMATIC_ONLY_PROVIDER_NOT_CONNECTED",
    gpsStatus: gpsBrowserApi ? "BROWSER_API_CODE_PRESENT_PRIVACY_RUNTIME_CHECK_REQUIRED" : "GPS_NOT_CONNECTED",
  },
  pwa: pwaArtifacts,
  evidence: {
    staticContract: "pnpm verify:commercial",
    runtimeSmoke: "pnpm verify:runtime",
    browserDeviceCertification: "NOT_RUN_UNAVAILABLE_HARNESS_OR_AUTHENTICATED_SESSION",
  },
}, null, 2));
