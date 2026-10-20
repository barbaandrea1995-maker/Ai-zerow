import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  TENANT_ALIGNMENT_CONTRACT_VERSION,
  TENANT_ALIGNMENT_MANIFEST,
  TENANT_ALIGNMENT_RUN_ID,
  TENANT_ALIGNMENT_SOURCE_ID,
  TENANT_ALIGNMENT_TARGET_ID,
  isExactTenantAlignmentApproval,
  tenantAlignmentManifestHash,
} from "../lib/tenant-alignment-contract.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestHash = await tenantAlignmentManifestHash();

assert.match(manifestHash, /^[a-f0-9]{64}$/);
assert.equal(await tenantAlignmentManifestHash(), manifestHash, "manifest hash must be deterministic");
assert.equal(TENANT_ALIGNMENT_MANIFEST.archivePolicy.deleteSourceRows, false);
assert.equal(TENANT_ALIGNMENT_MANIFEST.approval.rolesAreUnioned, false);
assert.equal(TENANT_ALIGNMENT_MANIFEST.collisions.length, 7);
assert(TENANT_ALIGNMENT_MANIFEST.copyPolicy.retainUnderSource.includes("s06-history"));

const approval = {
  contractVersion: TENANT_ALIGNMENT_CONTRACT_VERSION,
  runId: TENANT_ALIGNMENT_RUN_ID,
  sourceTenantId: TENANT_ALIGNMENT_SOURCE_ID,
  targetTenantId: TENANT_ALIGNMENT_TARGET_ID,
  manifestHash,
};
assert.equal(isExactTenantAlignmentApproval(approval, manifestHash), true);
assert.equal(isExactTenantAlignmentApproval({ ...approval, targetTenantId: TENANT_ALIGNMENT_SOURCE_ID }, manifestHash), false);
assert.equal(isExactTenantAlignmentApproval({ ...approval, manifestHash: "0".repeat(64) }, manifestHash), false);

const migration = await fs.readFile(path.join(root, "drizzle", "0022_easy_dragon_lord.sql"), "utf8");
for (const table of ["asset_custody_locations", "qr_code_aliases", "tenant_alignment_runs", "tenant_alignment_links"]) {
  assert(migration.includes(`CREATE TABLE \`${table}\``), `migration missing ${table}`);
}
assert(!/^\s*(INSERT|UPDATE|DELETE)\b/im.test(migration), "migration must remain schema-only");

const executor = await fs.readFile(path.join(root, "lib", "tenant-alignment-executor.server.ts"), "utf8");
assert(executor.includes("db.batch"), "executor must use one D1 batch");
assert(executor.includes("...links.map((link)"), "provenance links must stay below the D1 per-statement variable ceiling");
assert(executor.includes("CREATE TABLE IF NOT EXISTS tenant_alignment_runs"), "runtime must bootstrap additive alignment registries when Sites has not applied D1 migrations");
assert(executor.includes("await ensureTenantAlignmentSchema()"), "dry-run and execution must install the bounded additive schema first");
assert(executor.includes('status: "archived"'), "source tenant must be archived");
assert(executor.includes('status: "removed"'), "source memberships must be removed from authority");
assert(!/db\.delete\s*\(/.test(executor), "alignment must not delete source rows");
assert(executor.includes("TARGET_PREFERENCE_PRESERVED"), "target preference must win when already present");
assert(executor.includes("preferenceWasCopied"), "applied readback must retain the actual preference collision result");
assert(executor.includes("MATCH_PERSON_ROLE_NOT_UNIONED"), "identity link must preserve role separation");

const qrAdapter = await fs.readFile(path.join(root, "lib", "qr-adapter.ts"), "utf8");
const qrRoute = await fs.readFile(path.join(root, "app", "api", "qr", "route.ts"), "utf8");
assert(qrAdapter.indexOf("parsePayload(raw)") < qrAdapter.indexOf("raw.toUpperCase()"), "canonical payload must be parsed before shortcut normalization");
assert(qrAdapter.includes("ASSET|MEZZI"), "raw canonical asset and vehicle codes must resolve");
assert(qrAdapter.includes('directoryMatch("commessa", value)'), "COMM prefix must be preserved");
assert(qrRoute.includes("getQrAlias"), "QR route must resolve approved aliases");
assert(!qrRoute.includes("payload.entityId.trim().toUpperCase()"), "QR POST must preserve case-sensitive entity IDs");

const executeRoute = await fs.readFile(path.join(root, "app", "api", "governance", "alignment", "execute", "route.ts"), "utf8");
assert(executeRoute.includes("isExactTenantAlignmentApproval"));
assert(executeRoute.includes("owner-private-service-boundary"));
assert(executeRoute.includes("site_owner_required"));

const assetRoute = await fs.readFile(path.join(root, "app", "api", "[module]", "route.ts"), "utf8");
const assetProfileRoute = await fs.readFile(path.join(root, "app", "api", "assets", "profile", "route.ts"), "utf8");
const assetProfileDialog = await fs.readFile(path.join(root, "components", "asset-profile-dialog.tsx"), "utf8");
assert(assetRoute.includes("physicalCustody"));
assert(assetProfileRoute.includes("assetCustodyLocations"));
assert(assetProfileRoute.includes("asset_warehouse_location_not_canonical"));
assert(assetProfileDialog.includes("registro server-side"));
assert(!assetProfileDialog.includes("setLocation(event.target.value)"), "asset location must not remain free text");

console.log(JSON.stringify({
  status: "PASS",
  contract: TENANT_ALIGNMENT_CONTRACT_VERSION,
  manifestHash,
  checks: [
    "immutable_manifest",
    "exact_approval_envelope",
    "schema_only_migration",
    "bounded_runtime_schema_bootstrap",
    "single_batch_executor",
    "logical_rollback",
    "role_separation",
    "qr_case_preservation",
    "asset_custody_registry",
  ],
}, null, 2));
