import assert from "node:assert/strict";
import { buildCompanyAiPersonalAssetContext } from "../lib/company-ai-personal-assets.ts";

const tenantId = "tenant-test";
const actorId = "actor-andrea";
const membershipId = "membership-andrea";
const now = Date.parse("2026-10-12T12:00:00.000Z");
const assignment = (id, assetId, payload, status = "ACTIVE") => ({
  id,
  tenantId,
  jobId: assetId,
  domain: "assets",
  recordType: "ASSET_ASSIGNMENT",
  title: `Assignment ${id}`,
  status,
  payloadJson: JSON.stringify({ assetId, assigneeActorId: actorId, assignmentKind: "LONG_TERM", startsAt: "2026-10-01T08:00:00.000Z", assigneeName: "Andrea Barba", ...payload }),
});
const asset = (id, canonicalCode, title, payload = {}) => ({
  id,
  canonicalCode,
  title,
  detail: `${title} detail`,
  status: "AVAILABLE",
  payloadJson: JSON.stringify(payload),
});

const context = buildCompanyAiPersonalAssetContext({
  tenantId,
  actorId,
  membershipId,
  now,
  assignments: [
    assignment("assignment-van", "asset-van", { entityType: "VEHICLE" }),
    assignment("assignment-equipment", "asset-bobcat", { assigneeActorId: "", assigneeMembershipId: membershipId, entityType: "ASSET" }),
    assignment("assignment-other-person", "asset-other", { assigneeActorId: "actor-other", assigneeMembershipId: "membership-other" }),
    assignment("assignment-returned", "asset-returned", {}, "RETURNED"),
    assignment("assignment-orphan", "asset-not-in-catalog", {}),
    { ...assignment("assignment-wrong-domain", "asset-wrong-domain", {}), domain: "planning" },
    { ...assignment("assignment-other-tenant", "asset-van", {}), tenantId: "tenant-other" },
  ],
  assets: [
    asset("asset-van", "VEH-0001", "VEH-0001", { title: "Ford Transit Custom", detail: "Iveco Daily" }),
    asset("asset-bobcat", "AST-0002", "Bobcat E17"),
    asset("asset-other", "AST-0003", "Asset di un'altra persona"),
    asset("asset-returned", "AST-0004", "Asset restituito"),
  ],
});

assert.deepEqual(context.map((record) => record.id), ["VEH-0001", "AST-0002"]);
assert.equal(context[0].title, "Ford Transit Custom");
assert.equal(context[0].detail, "Iveco Daily");
assert.equal(context[0].assignment.kind, "LONG_TERM");
assert.equal(context[0].assignment.status, "ACTIVE");
assert.equal(context[0].assignment.entityType, "VEHICLE");
assert.equal(context[1].assignment.assignee, "Andrea Barba");

const scheduled = buildCompanyAiPersonalAssetContext({
  tenantId,
  actorId,
  membershipId,
  now,
  assignments: [assignment("assignment-future", "asset-future", { startsAt: "2026-10-14T08:00:00.000Z" }, "SCHEDULED")],
  assets: [asset("asset-future", "AST-0005", "Asset pianificato")],
});
assert.equal(scheduled[0]?.assignment.status, "SCHEDULED");

console.log("Company AI personal asset context: PASS");
