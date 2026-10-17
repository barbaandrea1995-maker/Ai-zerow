import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const appRoot = path.join(projectRoot, "app");
const baseUrl = (process.env.ZEROW_RUNTIME_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const authenticated = process.env.ZEROW_TEST_AUTHENTICATED === "1";

const authHeaders = authenticated
  ? {
      "oai-authenticated-user-id": process.env.ZEROW_TEST_ACTOR_ID || "e2e-owner",
      "oai-authenticated-user-email": process.env.ZEROW_TEST_ACTOR_EMAIL || "e2e-owner@example.invalid",
      "oai-authenticated-user-full-name": encodeURIComponent(process.env.ZEROW_TEST_ACTOR_NAME || "E2E Owner"),
      "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
    }
  : {};

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else files.push(absolute);
  }
  return files;
}

function materializeSegment(segment) {
  const parameter = segment.replace(/^\[+|\]+$/g, "").replace(/^\.\.\./, "");
  if (!segment.startsWith("[")) return segment.startsWith("(") ? "" : segment;
  if (parameter === "z" || parameter === "x" || parameter === "y") return "0";
  if (parameter === "path") return "session";
  if (parameter === "module") return "unknown-module";
  return "unknown";
}

function routeFor(file, marker) {
  const directory = path.dirname(path.relative(appRoot, file));
  const segments = directory === "." ? [] : directory.split(path.sep);
  const materialized = segments.map(materializeSegment).filter(Boolean);
  if (marker === "api" && materialized[0] !== "api") return null;
  return `/${materialized.join("/")}`.replace(/\/$/, "") || "/";
}

function methodsFor(source) {
  const methods = new Set();
  const patterns = [
    /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g,
    /export\s+const\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) methods.add(match[1]);
  }
  for (const block of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const method of block[1].match(/\b(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g) ?? []) {
      methods.add(method);
    }
  }
  return [...methods];
}

async function request(route, method = "GET", attempt = 0) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${baseUrl}${route}`, {
      method,
      redirect: "manual",
      signal: controller.signal,
      headers: {
        ...authHeaders,
        ...(method === "GET" || method === "HEAD" ? {} : { "content-type": "application/json" }),
      },
      ...(method === "GET" || method === "HEAD" ? {} : { body: "{}" }),
    });
    const text = method === "HEAD" ? "" : await response.text();
    if (
      response.status === 503
      && text.includes("Your worker restarted mid-request")
      && attempt < 3
    ) {
      return request(route, method, attempt + 1);
    }
    return {
      route,
      method,
      status: response.status,
      contentType: response.headers.get("content-type") || "",
      location: response.headers.get("location"),
      controlledError: response.status < 400 || response.status === 404
        ? null
        : (() => {
            try {
              const payload = JSON.parse(text);
              const code = payload?.error ?? payload?.code ?? payload?.status ?? payload?.result;
              return typeof code === "string" ? code : null;
            } catch {
              return null;
            }
          })(),
      bodyLength: text.length,
      runtimeRetries: attempt,
    };
  } catch (error) {
    return {
      route,
      method,
      status: 0,
      error: error instanceof Error ? error.message : "request_failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function pooled(items, worker, concurrency = 6) {
  const results = new Array(items.length);
  let cursor = 0;
  async function next() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => next()));
  return results;
}

const files = await walk(appRoot);
const pageRoutes = files
  .filter((file) => file.endsWith(`${path.sep}page.tsx`))
  .map((file) => routeFor(file, "page"))
  .filter(Boolean)
  .sort();

const apiCases = [];
for (const file of files.filter((item) => item.endsWith(`${path.sep}route.ts`) && item.includes(`${path.sep}api${path.sep}`))) {
  const route = routeFor(file, "api");
  const source = await readFile(file, "utf8");
  const methods = methodsFor(source);
  for (const method of methods.length ? methods : ["GET"]) apiCases.push({ route, method });
}
apiCases.sort((left, right) => `${left.route}:${left.method}`.localeCompare(`${right.route}:${right.method}`));

const pages = await pooled(pageRoutes, (route) => request(route));
const apis = await pooled(apiCases, ({ route, method }) => request(route, method));
const pwa = await pooled([
  "/manifest.webmanifest",
  "/sw.js",
  "/pwa/icon-180",
  "/pwa/icon-192",
  "/pwa/icon-512",
  "/favicon.ico",
  "/apple-touch-icon.png",
  "/apple-touch-icon-precomposed.png",
], (route) => request(route));

const transportFailures = [...pages, ...apis, ...pwa].filter((item) => item.status === 0);
const serverErrors = [...pages, ...apis, ...pwa].filter((item) => item.status === 500 || item.status > 503);
const uncontrolledErrors = [...apis].filter((item) => item.status >= 400 && item.status !== 404 && !item.controlledError);
const degraded = [...apis].filter((item) => item.status === 503);
const missingPwa = pwa.filter((item) => item.status === 404);

assert.deepEqual(transportFailures, [], `HTTP transport failures: ${JSON.stringify(transportFailures)}`);
assert.deepEqual(serverErrors, [], `Unhandled/server errors: ${JSON.stringify(serverErrors)}`);
assert.deepEqual(uncontrolledErrors, [], `API errors must expose a bounded error code: ${JSON.stringify(uncontrolledErrors)}`);
assert.deepEqual(missingPwa, [], `PWA/browser identity resources missing: ${JSON.stringify(missingPwa)}`);

function statusCounts(rows) {
  return rows.reduce((counts, row) => {
    counts[row.status] = (counts[row.status] || 0) + 1;
    return counts;
  }, {});
}

console.log(JSON.stringify({
  status: "PASS",
  mode: authenticated ? "authenticated_sites_local" : "unauthenticated",
  baseUrl,
  coverage: {
    pages: pageRoutes.length,
    apiRoutes: new Set(apiCases.map((item) => item.route)).size,
    apiMethodCases: apiCases.length,
    pwaAndBrowserResources: pwa.length,
  },
  statusCounts: {
    pages: statusCounts(pages),
    apis: statusCounts(apis),
    pwa: statusCounts(pwa),
  },
  runtimeRetries: [...pages, ...apis, ...pwa].reduce((total, item) => total + (item.runtimeRetries || 0), 0),
  controlledDegradation: degraded.map(({ route, method, controlledError }) => ({ route, method, error: controlledError })),
}, null, 2));
