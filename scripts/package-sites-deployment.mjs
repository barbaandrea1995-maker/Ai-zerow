import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hostingPath = join(root, ".openai", "hosting.json");
assert.ok(existsSync(hostingPath), "Missing .openai/hosting.json");
const hosting = JSON.parse(await readFile(hostingPath, "utf8"));
assert.equal(typeof hosting.project_id, "string", "Missing Sites project_id");

for (const relativePath of [
  "dist/server/index.js",
  "dist/server/wrangler.json",
  "dist/server/_next/static",
  "dist/client",
  "public",
]) {
  assert.ok(existsSync(join(root, relativePath)), `Missing built deployment input: ${relativePath}`);
}

const commitSha = process.argv[2] ?? "";
assert.match(commitSha, /^[0-9a-f]{40}$/, "Pass the full source commit SHA as the first argument");
const archivePath = resolve(process.argv[3] || `/tmp/ai-zerow-${hosting.project_id}-${commitSha.slice(0, 8)}.tar.gz`);
execFileSync("tar", [
  "-czf",
  archivePath,
  ".openai/hosting.json",
  "dist/server",
  "dist/client",
  "public",
], { cwd: root, stdio: "inherit" });

console.log(JSON.stringify({ archivePath, commitSha, sizeBytes: statSync(archivePath).size }));
