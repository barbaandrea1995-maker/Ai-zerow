import { mkdirSync } from "node:fs";
import os from "node:os";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const runtimeRoot = process.env.SITES_RUNTIME_ROOT || path.join(projectRoot, ".sites-runtime");

process.env.CLOUDFLARE_CF_FETCH_ENABLED ||= "false";
process.env.WRANGLER_SEND_METRICS ||= "false";
process.env.WRANGLER_WRITE_LOGS ||= "false";
process.env.WRANGLER_LOG_PATH ||= path.join(runtimeRoot, "wrangler/logs");
process.env.WRANGLER_REGISTRY_PATH ||= path.join(runtimeRoot, "wrangler/dev-registry");
process.env.MINIFLARE_REGISTRY_PATH ||= path.join(runtimeRoot, "wrangler/registry");
process.env.XDG_CONFIG_HOME ||= path.join(runtimeRoot, "config");

// Some restricted CI/container runtimes deny uv_interface_addresses even
// though loopback sockets are available. Wrangler probes network interfaces
// before honouring --ip, so keep local smoke tests usable with a loopback-only
// fallback. Normal developer and production runtimes retain the native result.
try {
  os.networkInterfaces();
} catch {
  os.networkInterfaces = () => ({
    lo: [{ address: "127.0.0.1", netmask: "255.0.0.0", family: "IPv4", mac: "00:00:00:00:00:00", internal: true, cidr: "127.0.0.1/8" }],
  });
  syncBuiltinESMExports();
}

process.chdir(projectRoot);
for (const directory of [
  path.dirname(process.env.WRANGLER_LOG_PATH),
  process.env.WRANGLER_REGISTRY_PATH,
  process.env.MINIFLARE_REGISTRY_PATH,
  process.env.XDG_CONFIG_HOME,
]) {
  mkdirSync(directory, { recursive: true });
}
