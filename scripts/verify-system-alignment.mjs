import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSystemAlignmentReport } from "../lib/system-alignment.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const legacyId = "sites:legacy";
const targetId = "tenant:operating";

function snapshot(overrides = {}) {
  return {
    tenants: [], memberships: [], warehouses: [], records: [], journeys: [], inventoryItems: [], inventoryMovements: [],
    qrs: [], locations: [], assetCustody: [], geofences: [], routePlans: [], routeStops: [], events: [], outbox: [], reconciliations: [],
    aiLedger: [], documents: [], domainRecords: [], workflows: [], trackingSessions: [], companyAiScopes: [],
    resolverProbe: { rawAssetCodeSupported: true, mixedCaseEntityIdPreserved: true }, truncated: false, ...overrides,
  };
}

function tenant(id, complete) {
  return {
    id, slug: id.replaceAll(":", "-"), name: complete ? "Edilizia Multiservizi" : "EMS Edilizia Multiservizi SRLS", status: "active",
    legalForm: complete ? "SRLS" : "OTHER", vatNumber: complete ? "18225551003" : null, taxCode: complete ? "18225551003" : null,
    registeredAddress: complete ? "Via Sciacca 6" : null, registeredCity: complete ? "Pomezia" : null,
    businessEmail: complete ? "azienda@example.test" : null, businessPhone: complete ? "0000000000" : null,
    operatingTransportModesJson: complete ? "[\"WAREHOUSE_TO_JOB\"]" : "[]",
  };
}

const report = buildSystemAlignmentReport(snapshot({
  tenants: [tenant(legacyId, false), tenant(targetId, true)],
  memberships: [
    { id: "legacy-sites", tenantId: legacyId, identityProvider: "sites", actorEmail: "owner@example.test", displayName: "Owner", role: "owner", rolesJson: "[\"owner\"]", status: "active" },
    { id: "legacy-neon", tenantId: legacyId, identityProvider: "neon", actorEmail: "owner@example.test", displayName: "Owner", role: "owner", rolesJson: "[\"owner\"]", status: "active" },
    { id: "target-neon", tenantId: targetId, identityProvider: "neon", actorEmail: "target@example.test", displayName: "Owner operativo", role: "owner", rolesJson: "[\"owner\"]", status: "active" },
  ],
  warehouses: [
    { id: "wh-legacy", tenantId: legacyId, code: "WH-0001", name: "Deposito legacy", status: "active" },
    { id: "wh-target", tenantId: targetId, code: "WH-0001", name: "Deposito operativo", status: "active" },
  ],
  records: [
    { id: "job-legacy", tenantId: legacyId, module: "operations", canonicalCode: "COMM-0001", recordType: "job", title: "Commessa legacy", status: "ACTIVE", payloadJson: "{}" },
    { id: "asset-legacy", tenantId: legacyId, module: "assets", canonicalCode: "ASSET-0001", recordType: "asset-register", title: "Asset legacy", status: "AVAILABLE", payloadJson: "{\"location\":\"Magazzino\"}" },
    { id: "job-target", tenantId: targetId, module: "operations", canonicalCode: "COMM-0001", recordType: "job", title: "Commessa operativa", status: "ACTIVE", payloadJson: "{}" },
    { id: "asset-target", tenantId: targetId, module: "assets", canonicalCode: "ASSET-0001", recordType: "asset-register", title: "Mezzo operativo", status: "AVAILABLE", payloadJson: "{}" },
  ],
  journeys: [{ id: "mission-1", tenantId: targetId, jobId: "job-target", domain: "mission", recordType: "TRANSPORT", status: "DISPATCHED", payloadJson: "{}" }],
  inventoryItems: [
    { id: "item-legacy", tenantId: legacyId, warehouseId: "wh-legacy", sku: "MAT-001", qrCode: "AZ1|MATERIAL|MAT-001", onHandMilli: 1000, reservedMilli: 0, status: "ACTIVE" },
    { id: "item-target", tenantId: targetId, warehouseId: "wh-target", sku: "MAT-002", qrCode: "AZ1|MATERIAL|MAT-002", onHandMilli: 1000, reservedMilli: 0, status: "ACTIVE" },
  ],
  qrs: [
    { id: "qr-legacy-wrong", tenantId: legacyId, entityType: "warehouse", entityId: "MAT-001", payload: "AZ1|WAREHOUSE|MAT-001" },
    { id: "qr-target-asset", tenantId: targetId, entityType: "asset", entityId: "ASSET-0001", payload: "AZ1|ASSET|ASSET-0001" },
    { id: "qr-target-material", tenantId: targetId, entityType: "material", entityId: "MAT-002", payload: "AZ1|MATERIAL|MAT-002" },
  ],
  locations: [
    { id: "geo-job", tenantId: targetId, entityType: "CANTIERE", entityId: "job-target", status: "ACTIVE" },
    { id: "geo-wh", tenantId: targetId, entityType: "MAGAZZINO", entityId: "wh-target", status: "ACTIVE" },
  ],
  geofences: [
    { id: "fence-job", tenantId: targetId, locationId: "geo-job", entityType: "CANTIERE", entityId: "job-target", status: "ACTIVE" },
    { id: "fence-wh", tenantId: targetId, locationId: "geo-wh", entityType: "MAGAZZINO", entityId: "wh-target", status: "ACTIVE" },
  ],
  routePlans: [{ id: "route-1", tenantId: targetId, missionId: "mission-1", jobId: "job-target", driverId: "driver-1", vehicleId: "asset-target", status: "DISPATCHED" }],
  routeStops: [
    { id: "stop-1", tenantId: targetId, routePlanId: "route-1", locationId: "geo-wh", sequence: 1 },
    { id: "stop-2", tenantId: targetId, routePlanId: "route-1", locationId: "geo-job", sequence: 2 },
  ],
  events: [{ eventId: "event-1", tenantId: targetId, aggregateType: "mission", aggregateId: "mission-1", aggregateVersion: 1 }],
  outbox: [{ id: "outbox-1", tenantId: targetId, eventId: "event-1", status: "PENDING_EXTERNAL_CONSUMER" }],
  reconciliations: [{ id: "reconciliation-1", tenantId: targetId, aggregateType: "mission", aggregateId: "mission-1", expectedVersion: 1, observedVersion: 1, status: "SITES_READBACK_VERIFIED" }],
  resolverProbe: { rawAssetCodeSupported: false, mixedCaseEntityIdPreserved: false },
}));

assert.equal(report.contract.mode, "READ_ONLY_DRY_RUN");
assert.equal(report.contract.writeOperations, 0);
assert.equal(report.summary.tenantRoots, 2);
assert.equal(report.summary.recommendedTargetTenantId, targetId);
assert.equal(report.gates.find((gate) => gate.id === "canonical-places")?.status, "BLOCKED");
assert.equal(report.gates.find((gate) => gate.id === "qr-registry")?.status, "BLOCKED");
assert.equal(report.gates.find((gate) => gate.id === "identity-membership")?.status, "REVIEW");
assert.equal(report.gates.find((gate) => gate.id === "mission-route")?.status, "READY");
assert(report.dryRun.conflicts.some((conflict) => conflict.registry === "WAREHOUSE_CODE" && conflict.key === "WH-0001"));
assert(report.dryRun.conflicts.some((conflict) => conflict.registry === "S04_CANONICAL_CODE" && conflict.key === "assets:ASSET-0001"));

const routeSource = await fs.readFile(path.join(root, "app/api/governance/alignment/route.ts"), "utf8");
const serverSource = await fs.readFile(path.join(root, "lib/system-alignment.server.ts"), "utf8");
assert(!/export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)/.test(routeSource), "Alignment API must remain GET-only");
assert(!/\.\s*(insert|update|delete)\s*\(/.test(serverSource), "Alignment readback must not mutate D1");

console.log(JSON.stringify({
  status: "PASS", contract: report.contract.version, targetRecommendation: report.summary.recommendedTargetTenantId,
  blockedGates: report.summary.blockedGates, reviewGates: report.summary.reviewGates, conflicts: report.summary.conflicts,
  checks: ["read_only_contract", "target_scoring", "canonical_places", "qr_registry", "identity_review", "route_integrity", "collision_manifest"],
}, null, 2));
