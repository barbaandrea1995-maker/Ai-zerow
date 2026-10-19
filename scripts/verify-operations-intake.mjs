import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const baseUrl = (process.env.ZEROW_RUNTIME_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const runId = randomUUID().slice(0, 8);

async function post(body) {
  const response = await fetch(`${baseUrl}/api/operations`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "oai-authenticated-user-id": "e2e-owner",
      "oai-authenticated-user-email": "e2e-owner@example.invalid",
    },
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  let payload;
  try { payload = raw ? JSON.parse(raw) : {}; } catch { throw new Error(`POST /api/operations returned non-JSON (${response.status})`); }
  return { status: response.status, payload };
}

async function postJson(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "oai-authenticated-user-id": "e2e-owner",
      "oai-authenticated-user-email": "e2e-owner@example.invalid",
    },
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  let payload;
  try { payload = raw ? JSON.parse(raw) : {}; } catch { throw new Error(`POST ${path} returned non-JSON (${response.status})`); }
  return { status: response.status, payload };
}

const common = {
  title: `Verifica intake commessa ${runId}`,
  openingType: "NUOVA_COMMESSA",
  worksite: "Via Roma 10, Pomezia",
  idempotencyKey: `verify-operations-intake-${runId}`,
};

const emptyWork = await post({ ...common, description: "", workItems: [] });
assert.equal(emptyWork.status, 400);
assert.equal(emptyWork.payload.error, "work_description_required");

const invalidItemScope = await post({
  ...common,
  description: "Lavorazioni di manutenzione interna",
  workItems: [{
    id: "work-1",
    label: "Impermeabilizzazione terrazzo",
    detail: "Impermeabilizzazione terrazzo",
    scope: { sectionId: "A", groupId: "A-STRUTTURE", subgroupId: "scope-inesistente" },
  }],
});
assert.equal(invalidItemScope.status, 400);
assert.equal(invalidItemScope.payload.error, "work_item_scope_invalid");

const invalidGlobalScope = await post({
  ...common,
  description: "Lavorazioni di manutenzione interna",
  scope: { sectionId: "A", groupId: "", subgroupId: "" },
  workItems: [{ label: "Ripristino perdita bagno" }],
});
assert.equal(invalidGlobalScope.status, 400);
assert.equal(invalidGlobalScope.payload.error, "scope_must_end_at_subgroup");

const validItalianAmount = await post({
  ...common,
  description: "Lavorazioni diverse di manutenzione interna",
  commercialValue: { amount: "14.000,00", basis: "ESTIMATE" },
  workItems: [{
    id: "work-1",
    label: "Impermeabilizzazione terrazzo",
    detail: "Impermeabilizzazione terrazzo",
    scope: { sectionId: "A", groupId: "A-STRUTTURE", subgroupId: "A-STRUTTURE-COPERTURE" },
  }],
});
assert.equal(validItalianAmount.status, 409);
assert.equal(validItalianAmount.payload.error, "worksite_location_confirmation_required", "valid work scope and Italian amount must reach the verified-site guard");

const fractionalCent = await post({
  ...common,
  description: "Lavorazioni diverse di manutenzione interna",
  commercialValue: { amount: "14.000,001", basis: "ESTIMATE" },
  workItems: [{ label: "Ripristino perdita bagno" }],
});
assert.equal(fractionalCent.status, 400);
assert.equal(fractionalCent.payload.error, "commercial_value_invalid");

const invalidValueBasis = await post({
  ...common,
  description: "Lavorazioni diverse di manutenzione interna",
  commercialValue: { amount: "14.000,00", basis: "PAID" },
  workItems: [{ label: "Ripristino perdita bagno" }],
});
assert.equal(invalidValueBasis.status, 400);
assert.equal(invalidValueBasis.payload.error, "commercial_value_basis_invalid");

const geocode = await postJson("/api/location/geocode", { address: "Via Catullo 93, Pomezia" });
assert.equal(geocode.status, 200, "the isolated runtime must expose its deterministic Geoapify fixture");
const locationCandidate = geocode.payload.candidates?.[0];
assert(locationCandidate?.providerPlaceId, "server geocoding must return the candidate used for commessa creation");

const created = await post({
  title: `Verifica finanziaria commessa ${runId}`,
  openingType: "MANUTENZIONE",
  description: "Manutenzione interna con lavorazioni su copertura e impianto idrico.",
  client: "Cliente verifica intake",
  worksite: "Via Catullo 93, Pomezia",
  worksiteLocation: locationCandidate,
  commercialValue: { amount: "14.000,00", basis: "ESTIMATE" },
  workItems: [
    {
      id: "work-water",
      label: "Riparazione perdita e ripristino linea idrica",
      detail: "Riparazione perdita e ripristino linea idrica",
      scope: { sectionId: "E", groupId: "E-IDRICO", subgroupId: "E-IDRICO-ADDUZIONE" },
    },
    {
      id: "work-roof",
      label: "Impermeabilizzazione terrazzo",
      detail: "Impermeabilizzazione terrazzo",
      scope: { sectionId: "A", groupId: "A-STRUTTURE", subgroupId: "A-STRUTTURE-COPERTURE" },
    },
  ],
  idempotencyKey: `verify-operations-intake-create-${runId}`,
});
assert.equal(created.status, 201, `valid manual intake should create a draft: ${JSON.stringify(created.payload).slice(0, 500)}`);
assert.equal(created.payload.financeValueReadback?.status, "verified", "the value must be written and reread by the server");
assert.equal(created.payload.created?.payload?.category, "Lavorazioni miste", "mixed work packages must not be collapsed into one technical scope");
assert.equal(created.payload.created?.payload?.scope, null, "mixed work packages must leave the aggregate scope empty");
assert.equal(created.payload.created?.payload?.workItems?.length, 2);
assert.equal(created.payload.created?.payload?.commercialValue?.amountMinor, 1_400_000);

const summaryResponse = await fetch(`${baseUrl}/api/finance/job-summary?jobId=${encodeURIComponent(created.payload.created.id)}`, {
  headers: {
    "oai-authenticated-user-id": "e2e-owner",
    "oai-authenticated-user-email": "e2e-owner@example.invalid",
  },
});
const summary = await summaryResponse.json();
assert.equal(summaryResponse.status, 200, "Finance must resolve the created commessa from its server catalog");
assert.equal(summary.selectedJob?.id, created.payload.created.id);
assert.equal(summary.summary?.commercialValue?.amountMinor, 1_400_000);
assert.equal(summary.summary?.commercialValue?.basis, "ESTIMATE");

console.log("PASS operations-intake server contract");
console.log("Work description, optional and per-work scope, Italian euro parsing, verified location, commessa creation and Finance readback passed.");
