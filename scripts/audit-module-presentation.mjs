import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const headingSurfaces = [
  "app/operations/page.tsx",
  "app/onboarding/page.tsx",
  "components/planning-control.tsx",
  "components/attendance-overview.tsx",
  "components/asset-control.tsx",
  "components/documents-control-deck.tsx",
  "components/pwa-mobile-control.tsx",
  "components/security-privacy-control.tsx",
  "components/warehouse-control.tsx",
  "components/w10-workflow-control.tsx",
  "components/workforce-control.tsx",
  "components/events-control-page.tsx",
  "components/communications-control.tsx",
  "components/external-integrations-control.tsx",
  "components/mission-command-deck.tsx",
  "components/operational-ai-control.tsx",
];

const sources = await Promise.all(headingSurfaces.map(async (file) => [
  file,
  await fs.readFile(path.join(root, file), "utf8"),
]));
for (const [file, contents] of sources) {
  assert(contents.includes("zw-module-heading"), `${file} must use the shared compact module heading`);
  assert(!contents.includes("zw-module-hero"), `${file} must not reintroduce a non-central hero`);
  assert(!contents.includes("zw-command-hero"), `${file} must not reuse Centrale's branded hero`);
}

const css = await fs.readFile(path.join(root, "app/globals.css"), "utf8");
assert(css.includes(".zw-module-heading h1"), "Shared heading typography must be centralized");
assert(css.includes("font-size: clamp(1.6rem, 2.8vw, 2rem) !important"), "Module titles must stay compact and consistent");
assert(css.includes(".zw-operational-home__summary h1"), "Role-based Home must use a compact summary title");

const commandHero = await fs.readFile(path.join(root, "components/command-hero.tsx"), "utf8");
assert(commandHero.includes('className="zw-command-hero zw-page-enter"'), "Centrale must retain its distinctive hero");

console.log(JSON.stringify({
  status: "PASS",
  compactModuleHeadings: headingSurfaces.length,
  distinctiveCommandHero: "components/command-hero.tsx",
  roleHome: "compact summary",
  checks: ["shared module typography", "no module hero", "no reused command artwork", "central hero retained"],
}, null, 2));
