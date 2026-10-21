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

const perWorkWithFakeTotal = await post({
  ...common,
  description: "Manutenzione valorizzata per singolo intervento",
  commercialTerms: { model: "PER_WORK_ORDER", amount: "14.000,00", basis: "ESTIMATE", currency: "EUR" },
  workItems: [{ label: "Ripristino perdita bagno" }],
});
assert.equal(perWorkWithFakeTotal.status, 400);
assert.equal(perWorkWithFakeTotal.payload.error, "commercial_value_not_allowed_for_model");

const perWorkIntake = await postJson("/api/operations/intake", {
  sourceText: "Contratto di manutenzione della palazzina. Prezzo di 500,00 euro per ogni singolo intervento autorizzato.",
  sourceName: "accordo-manutenzione.txt",
  idempotencyKey: `verify-per-work-intake-${runId}`,
});
assert.equal(perWorkIntake.status, 201, `per-work intake must be classified: ${JSON.stringify(perWorkIntake.payload).slice(0, 500)}`);
assert.equal(perWorkIntake.payload.draft?.commercialModel, "PER_WORK_ORDER");
assert.equal(perWorkIntake.payload.draft?.commercialValueAmount, "", "a per-intervention price must not become the job total");
assert.equal(perWorkIntake.payload.suggestions?.some((item) => item.key === "commercialValueAmount"), false);

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
assert.equal(created.payload.created?.payload?.commercialTerms?.model, "FIXED_TOTAL");
assert.equal(created.payload.commercialTermsReadback?.status, "verified");

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
assert.equal(summary.summary?.commercialTerms?.model, "FIXED_TOTAL");

const perWorkJob = await post({
  title: `Manutenzione per intervento ${runId}`,
  openingType: "MANUTENZIONE",
  description: "Accordo continuativo: ogni lavorazione viene preventivata e approvata separatamente.",
  client: "Cliente manutenzione per intervento",
  worksite: "Via Catullo 93, Pomezia",
  worksiteLocation: locationCandidate,
  commercialTerms: { model: "PER_WORK_ORDER", amount: "", basis: "ESTIMATE", currency: "EUR" },
  workItems: [{ id: "work-1", label: "Interventi richiesti dal cliente", detail: "Interventi richiesti dal cliente" }],
  idempotencyKey: `verify-operations-per-work-${runId}`,
});
assert.equal(perWorkJob.status, 201, `per-work maintenance must be created without a fake total: ${JSON.stringify(perWorkJob.payload).slice(0, 500)}`);
assert.equal(perWorkJob.payload.created?.payload?.commercialTerms?.model, "PER_WORK_ORDER");
assert.equal(perWorkJob.payload.created?.payload?.commercialValue, null);
assert.equal(perWorkJob.payload.commercialTermsReadback?.status, "verified");

const workOrderKey = `verify-work-order-${runId}`;
const workOrder = await postJson(`/api/operations/jobs/${encodeURIComponent(perWorkJob.payload.created.id)}/commercial`, {
  action: "create_work_order",
  title: "Riparazione perdita bagno scala B",
  description: "Ricerca perdita e ripristino concordati con il cliente.",
  amount: "850,00",
  basis: "ESTIMATE",
  idempotencyKey: workOrderKey,
});
assert.equal(workOrder.status, 201, `work order must be persisted: ${JSON.stringify(workOrder.payload).slice(0, 500)}`);
assert.equal(workOrder.payload.workOrderEconomics?.proposedMinor, 85_000);
assert.equal(workOrder.payload.workOrderEconomics?.approvedMinor, null);
assert.equal(workOrder.payload.workOrderEconomics?.counts?.draft, 1);
const createdWorkOrder = workOrder.payload.workOrderEconomics?.workOrders?.[0];
assert(createdWorkOrder?.id, "work order readback must expose the canonical id");

const fractionalWorkOrder = await postJson(`/api/operations/jobs/${encodeURIComponent(perWorkJob.payload.created.id)}/commercial`, {
  action: "create_work_order",
  title: "Importo con frazione di centesimo",
  amount: 8.501,
  basis: "ESTIMATE",
  idempotencyKey: `verify-work-order-fractional-${runId}`,
});
assert.equal(fractionalWorkOrder.status, 400);
assert.equal(fractionalWorkOrder.payload.error, "work_order_value_invalid");

const workOrderReplay = await postJson(`/api/operations/jobs/${encodeURIComponent(perWorkJob.payload.created.id)}/commercial`, {
  action: "create_work_order",
  title: "Riparazione perdita bagno scala B",
  description: "Ricerca perdita e ripristino concordati con il cliente.",
  amount: "850,00",
  basis: "ESTIMATE",
  idempotencyKey: workOrderKey,
});
assert.equal(workOrderReplay.status, 200);
assert.equal(workOrderReplay.payload.mutation?.idempotent, true);
assert.equal(workOrderReplay.payload.workOrderEconomics?.counts?.total, 1, "idempotent retry must not duplicate the work order");

const workOrderConflict = await postJson(`/api/operations/jobs/${encodeURIComponent(perWorkJob.payload.created.id)}/commercial`, {
  action: "create_work_order",
  title: "Richiesta diversa con la stessa chiave",
  amount: "900,00",
  basis: "ESTIMATE",
  idempotencyKey: workOrderKey,
});
assert.equal(workOrderConflict.status, 409);
assert.equal(workOrderConflict.payload.error, "commercial_idempotency_key_conflict");

const approvedWorkOrder = await postJson(`/api/operations/jobs/${encodeURIComponent(perWorkJob.payload.created.id)}/commercial`, {
  action: "set_work_order_status",
  workOrderId: createdWorkOrder.id,
  expectedVersion: createdWorkOrder.version,
  status: "APPROVED",
  idempotencyKey: `verify-work-order-approve-${runId}`,
});
assert.equal(approvedWorkOrder.status, 200);
assert.equal(approvedWorkOrder.payload.workOrderEconomics?.approvedMinor, 85_000);
assert.equal(approvedWorkOrder.payload.workOrderEconomics?.counts?.approved, 1);

const perWorkSummaryResponse = await fetch(`${baseUrl}/api/finance/job-summary?jobId=${encodeURIComponent(perWorkJob.payload.created.id)}`, {
  headers: {
    "oai-authenticated-user-id": "e2e-owner",
    "oai-authenticated-user-email": "e2e-owner@example.invalid",
  },
});
const perWorkSummary = await perWorkSummaryResponse.json();
assert.equal(perWorkSummaryResponse.status, 200);
assert.equal(perWorkSummary.summary?.commercialTerms?.model, "PER_WORK_ORDER");
assert.equal(perWorkSummary.summary?.commercialValue, null, "per-work maintenance must not expose an overall fixed value");
assert.equal(perWorkSummary.summary?.workOrderEconomics?.approvedMinor, 85_000);
assert.equal(perWorkSummary.summary?.economics?.status, "NOT_AVAILABLE", "approving a work value must not invent a confirmed Finance revenue");

console.log("PASS operations-intake server contract");
console.log("Work description, technical scope, fixed and per-work economics, idempotency, approval, verified location and Finance separation passed.");
