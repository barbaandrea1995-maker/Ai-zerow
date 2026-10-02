import assert from "node:assert/strict";

const baseUrl = (process.env.ZEROW_RUNTIME_URL || process.argv[2] || "http://localhost:5173").replace(/\/$/, "");
const expectOwnerOnlyEdge = process.env.ZEROW_EXPECT_OWNER_ONLY === "1";

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    redirect: "manual",
    ...options,
  });
  return {
    response,
    text: await response.text(),
  };
}

function header(response, name) {
  return response.headers.get(name) || "";
}

const root = await request("/");
if (expectOwnerOnlyEdge) {
  assert.equal(root.response.status, 401, "Owner-only production Sites must reject unauthenticated edge requests");
  const protectedPaths = ["/login", "/release", "/api/release/readiness", "/api/command/overview", "/api/release/build"];
  const results = await Promise.all(protectedPaths.map((path) => request(path)));
  for (const [index, result] of results.entries()) {
    assert.equal(result.response.status, 401, `${protectedPaths[index]} must remain owner-only at the edge`);
  }
  console.log(JSON.stringify({
    status: "PASS",
    baseUrl,
    mode: "owner_only_edge",
    checks: ["owner_only_root", "owner_only_login", "owner_only_release", "owner_only_protected_apis"],
  }));
  process.exit(0);
}
assert([307, 308].includes(root.response.status), `Root must redirect to auth, got ${root.response.status}`);
assert(header(root.response, "location").endsWith("/login"), "Root must redirect to /login");

const login = await request("/login");
assert.equal(login.response.status, 200, "Login page must render");
assert(login.text.includes("auth-email"), "Login page must expose the email control");
assert(login.text.includes("AI-ZEROW"), "Login page must expose the product identity");

const release = await request("/release");
assert([307, 308].includes(release.response.status), `Release must be protected, got ${release.response.status}`);
assert(header(release.response, "location").endsWith("/login"), "Release must redirect unauthenticated visitors");

for (const path of ["/api/release/readiness", "/api/command/overview"]) {
  const protectedApi = await request(path);
  assert.equal(protectedApi.response.status, 401, `${path} must fail closed without a session`);
}

const build = await request("/api/release/build");
assert.equal(build.response.status, 200, "Release identity endpoint must be public and readable");
const buildPayload = JSON.parse(build.text);
assert.equal(buildPayload.commercialStatus, "NO_GO", "Uncertified builds must remain NO_GO");
assert.equal(buildPayload.promotionAllowed, false, "Uncertified builds must not be promotable");
assert(String(buildPayload.buildId).startsWith("ai-zerow-commercial-v1-rc2-9"), "Runtime must expose the RC2.9 build identity");

const manifest = await request("/manifest.webmanifest");
assert.equal(manifest.response.status, 200, "PWA manifest must be served");
const manifestPayload = JSON.parse(manifest.text);
assert.equal(manifestPayload.name, "AI-ZEROW COMMAND", "PWA manifest must identify the product");
assert.equal(manifestPayload.start_url, "/command", "PWA must start at Command");
assert.equal(manifestPayload.display, "standalone", "PWA must use standalone display mode");

const serviceWorker = await request("/sw.js");
assert.equal(serviceWorker.response.status, 200, "Service worker must be served");
assert(serviceWorker.text.includes(buildPayload.buildId), "Service worker cache must match the runtime build identity");

console.log(JSON.stringify({
  status: "PASS",
  baseUrl,
  checks: [
    "auth_redirect",
    "login_render",
    "protected_release_route",
    "protected_api_fail_closed",
    "release_identity_no_go",
    "pwa_manifest",
    "service_worker_build_binding",
  ],
  buildId: buildPayload.buildId,
}));
