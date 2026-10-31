import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const baseUrl = (process.env.ZEROW_RUNTIME_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const OWNER = process.env.ZEROW_TEST_ACTOR_ID || "e2e-owner";
const RUN_ID = randomUUID().slice(0, 8);

function authHeaders(actorId = OWNER) {
  return {
    "content-type": "application/json",
    "oai-authenticated-user-id": actorId,
    "oai-authenticated-user-email": `${actorId}@example.invalid`,
  };
}

async function requestJson(path, { actorId = OWNER, method = "GET", body, expected = [200], headers = {} } = {}) {
  const requestBody = body === undefined ? undefined : JSON.stringify(body);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { ...authHeaders(actorId), ...headers },
      body: requestBody,
    });
    const raw = await response.text();
    if (response.status === 503 && /worker restarted mid-request/i.test(raw) && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 150));
      continue;
    }
    let payload;
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      throw new Error(`${method} ${path} returned non-JSON (${response.status}): ${raw.slice(0, 240)}`);
    }
    assert(expected.includes(response.status), `${method} ${path}: expected ${expected.join("/")}, received ${response.status} (${JSON.stringify(payload).slice(0, 500)})`);
    return { status: response.status, payload, headers: response.headers };
  }
  throw new Error(`${method} ${path} exhausted transient worker-restart retries`);
}

async function requestForm(path, formFactory, { expected = [200], actorId = OWNER } = {}) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const headers = authHeaders(actorId);
    delete headers["content-type"];
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers,
      body: formFactory(),
    });
    const raw = await response.text();
    if (response.status === 503 && /worker restarted mid-request/i.test(raw) && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 150));
      continue;
    }
    let payload;
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      throw new Error(`POST ${path} returned non-JSON (${response.status}): ${raw.slice(0, 240)}`);
    }
    assert(expected.includes(response.status), `POST ${path}: expected ${expected.join("/")}, received ${response.status} (${JSON.stringify(payload).slice(0, 500)})`);
    return { status: response.status, payload };
  }
  throw new Error(`POST ${path} exhausted transient worker-restart retries`);
}

async function requestText(path, expected = [200]) {
  const response = await fetch(`${baseUrl}${path}`);
  const raw = await response.text();
  assert(expected.includes(response.status), `GET ${path}: expected ${expected.join("/")}, received ${response.status}`);
  return { status: response.status, raw, headers: response.headers };
}

function assertReadback(payload, label, accepted = ["ok", "verified"]) {
  assert(accepted.includes(String(payload?.readback?.status || "").toLowerCase()), `${label} must expose a verified server readback`);
}

const operations = await requestJson("/api/operations");
const job = (operations.payload.records || []).find((record) => record.recordType !== "adapter-contract");
assert(job?.id, "office-module verification requires a canonical commessa");

// Documenti: object storage, metadata, malware hold and idempotent replay.
const documentKey = `office-document-${RUN_ID}`;
const documentBytes = new TextEncoder().encode(`%PDF-1.4\n% Company AI office verification ${RUN_ID}\n1 0 obj\n<<>>\nendobj\n%%EOF\n`);
const makeDocumentForm = () => {
  const form = new FormData();
  form.set("file", new File([documentBytes], `verifica-office-${RUN_ID}.pdf`, { type: "application/pdf" }));
  form.set("category", "COMMESSA");
  form.set("idempotencyKey", documentKey);
  return form;
};
const uploaded = await requestForm(`/api/operations/jobs/${encodeURIComponent(job.id)}/documents`, makeDocumentForm, { expected: [201] });
const document = uploaded.payload.document;
assert(document?.id && document.storageStatus === "STORED", "document upload must persist object and metadata");
assert.equal(document.scanStatus, "NOT_RUN");
assert.equal(document.downloadable, false, "an unscanned document must remain blocked");
assertReadback(uploaded.payload, "document upload");
const uploadReplay = await requestForm(`/api/operations/jobs/${encodeURIComponent(job.id)}/documents`, makeDocumentForm);
assert.equal(uploadReplay.payload.idempotent, true);
assert.equal(uploadReplay.payload.document?.id, document.id, "document replay must not create a duplicate");
const jobDocuments = await requestJson(`/api/operations/jobs/${encodeURIComponent(job.id)}/documents`);
assert(jobDocuments.payload.documents?.some((entry) => entry.id === document.id), "document must be readable from the commessa dossier");
const documentSecurity = await requestJson(`/api/documents/${encodeURIComponent(document.id)}/security`);
assert.equal(documentSecurity.payload.contract?.cleanEvidenceRequired, true);
const queueScan = await requestJson(`/api/documents/${encodeURIComponent(document.id)}/security`, {
  method: "POST",
  body: { action: "queue_scan", idempotencyKey: `office-document-scan-${RUN_ID}` },
  expected: [201],
});
assert.equal(queueScan.payload.document?.scanStatus, "PENDING_PROVIDER");
assert.equal(queueScan.payload.document?.downloadable, false);
const heldDownload = await requestJson(`/api/documents/${encodeURIComponent(document.id)}`, { expected: [423] });
assert.equal(heldDownload.payload.error, "document_security_hold");
const absentScanner = await requestJson(`/api/documents/${encodeURIComponent(document.id)}/security`, {
  actorId: "provider-without-secret",
  method: "POST",
  body: { action: "provider_result", result: "CLEAN", sha256: document.sha256, idempotencyKey: `office-document-result-${RUN_ID}` },
  expected: [503],
});
assert.equal(absentScanner.payload.error, "malware_scan_provider_not_configured");

// Comunicazioni: messaggio tenant e proposta voce restano nel boundary governato.
const communicationBody = {
  title: `Avviso operativo ${RUN_ID}`,
  detail: "Verifica server-side del canale comunicazioni aziendale.",
  recordType: "TEAM_BROADCAST",
  channel: "IN_APP",
  audienceType: "TENANT",
  requiresAcknowledgement: false,
  idempotencyKey: `office-communication-${RUN_ID}`,
};
const communication = await requestJson("/api/communications", { method: "POST", body: communicationBody, expected: [201] });
assert(communication.payload.created?.id, "communication must receive a server identity");
const communicationReplay = await requestJson("/api/communications", { method: "POST", body: communicationBody });
assert.equal(communicationReplay.payload.idempotent, true);
assert.equal(communicationReplay.payload.created?.id, communication.payload.created.id);
const voiceProposal = await requestJson("/api/communications", {
  method: "POST",
  body: {
    title: `Proposta vocale ${RUN_ID}`,
    detail: "Richiesta di contatto soggetta a consenso e provider esterno.",
    recordType: "VOICE_PROPOSAL",
    channel: "VOICE",
    audienceType: "ROLE",
    audienceRef: "delivery_driver",
    requiresAcknowledgement: true,
    idempotencyKey: `office-voice-${RUN_ID}`,
  },
  expected: [201],
});
assert.equal(voiceProposal.payload.created?.payload?.providerStatus, "EXTERNAL_DEFERRED");
assert.equal(voiceProposal.payload.created?.payload?.directWrite, false);

// Preferenze Command e Company AI: contesto server, preview e approvazione senza scrittura diretta.
const preferences = await requestJson("/api/command/preferences");
assert(Array.isArray(preferences.payload.layout) && preferences.payload.layout.length > 0, "Command must expose a role-filtered widget layout");
const savedPreferences = await requestJson("/api/command/preferences", {
  method: "PUT",
  body: { layout: [...preferences.payload.layout].reverse() },
});
assert(savedPreferences.payload.savedAt, "Command preferences must persist server-side");
const preferenceReadback = await requestJson("/api/command/preferences");
assert.deepEqual(preferenceReadback.payload.layout, savedPreferences.payload.layout);

const assetQuery = {
  prompt: "Quali mezzi e asset sono assegnati a me?",
  actionType: "query",
  idempotencyKey: `office-ai-query-${RUN_ID}`,
};
const aiQuery = await requestJson("/api/command/ask", { method: "POST", body: assetQuery, expected: [201] });
assert.equal(aiQuery.payload.result?.directWrite, false);
assert(Array.isArray(aiQuery.payload.result?.personalAssetRecordIds), "Company AI must expose the personal asset registry context");
const aiQueryReplay = await requestJson("/api/command/ask", { method: "POST", body: assetQuery });
assert.equal(aiQueryReplay.payload.idempotent, true);
assert.equal(aiQueryReplay.payload.result?.actionId, aiQuery.payload.result?.actionId);
const actionPreview = await requestJson("/api/command/ask", {
  method: "POST",
  body: {
    prompt: "Prepara una proposta di aggiornamento della commessa, senza eseguirla.",
    actionType: "update",
    idempotencyKey: `office-ai-action-${RUN_ID}`,
  },
  expected: [201],
});
assert.equal(actionPreview.payload.result?.approvalRequired, true);
assert.equal(actionPreview.payload.result?.status, "PENDING_APPROVAL");
const approval = await requestJson("/api/command/approval", {
  method: "POST",
  body: { actionId: actionPreview.payload.result.actionId, decision: "approved", note: `Verifica ${RUN_ID}` },
  expected: [201],
});
assert.equal(approval.payload.decision?.status, "APPROVED_PENDING_EXTERNAL_EXECUTION");
assert.equal(approval.payload.decision?.directWrite, false);
const approvalReplay = await requestJson("/api/command/approval", {
  method: "POST",
  body: { actionId: actionPreview.payload.result.actionId, decision: "approved", note: `Verifica ${RUN_ID}` },
});
assert.equal(approvalReplay.payload.idempotent, true);

const scopeBody = {
  jobId: job.id,
  scope: {
    sectionId: "B",
    groupId: "B-SUPERFICI",
    subgroupId: "B-SUPERFICI-MARCIAPIEDI",
  },
  status: "CONFIRMED",
  scopeText: "Verifica marciapiedi e aree accessorie della commessa.",
  assumptions: ["Accesso al cantiere confermato"],
  exclusions: ["Lavorazioni elettriche"],
  idempotencyKey: `office-ai-scope-${RUN_ID}`,
};
const aiScope = await requestJson("/api/company-ai/scope", { method: "POST", body: scopeBody, expected: [201] });
assert.equal(aiScope.payload.readback?.status, "SCOPE_LINK_VERIFIED");
assert.equal(aiScope.payload.scope?.jobId, job.id);
const aiScopeReplay = await requestJson("/api/company-ai/scope", { method: "POST", body: scopeBody });
assert.equal(aiScopeReplay.payload.scope?.id, aiScope.payload.scope.id);
const scopes = await requestJson(`/api/company-ai/scope?jobId=${encodeURIComponent(job.id)}`);
assert(scopes.payload.scopes?.some((entry) => entry.id === aiScope.payload.scope.id));

// Finanza e acquisti: versioni, approvazioni e confine con gli executor esterni.
const financeCreate = await requestJson("/api/finance/workflow", {
  method: "POST",
  body: {
    action: "create",
    title: `Voce finanziaria ${RUN_ID}`,
    detail: "Verifica workflow finanziario collegato alla commessa.",
    amountMilli: 125000,
    currency: "EUR",
    jobId: job.id,
    idempotencyKey: `office-finance-create-${RUN_ID}`,
  },
  expected: [201],
});
let finance = financeCreate.payload.created;
assert.equal(finance.status, "PROPOSED");
for (const [index, action] of ["submit_review", "approve", "reconcile"].entries()) {
  const transition = await requestJson("/api/finance/workflow", {
    method: "POST",
    body: { action, id: finance.id, expectedVersion: finance.version, evidence: `Verifica ${RUN_ID}`, idempotencyKey: `office-finance-${action}-${RUN_ID}` },
  });
  finance = transition.payload.updated;
  assert.equal(finance.version, index + 2);
}
assert.equal(finance.status, "RECONCILED");
const financeReadback = await requestJson("/api/finance/workflow");
assert(financeReadback.payload.workflows?.some((entry) => entry.id === finance.id && entry.status === "RECONCILED"));

const procurementCreate = await requestJson("/api/procurement/workflow", {
  method: "POST",
  body: {
    action: "create",
    title: `Richiesta acquisto ${RUN_ID}`,
    detail: "Verifica ordine collegato alla commessa.",
    supplier: "Fornitore di verifica",
    amountMilli: 100000,
    currency: "EUR",
    jobId: job.id,
    lines: [{ description: "Materiale di verifica", quantity: 2, unit: "pz", unitAmountMilli: 50000 }],
    idempotencyKey: `office-procurement-create-${RUN_ID}`,
  },
  expected: [201],
});
let procurement = procurementCreate.payload.created;
assert.equal(procurement.status, "NEED");
for (const action of ["request", "submit_review", "approve", "prepare_po"]) {
  const transition = await requestJson("/api/procurement/workflow", {
    method: "POST",
    body: { action, id: procurement.id, expectedVersion: procurement.version, evidence: `Verifica ${RUN_ID}`, idempotencyKey: `office-procurement-${action}-${RUN_ID}` },
  });
  procurement = transition.payload.updated;
}
assert.equal(procurement.status, "PO_DRAFT");
const externalIssue = await requestJson("/api/procurement/workflow", {
  method: "POST",
  body: { action: "external_issue", id: procurement.id, expectedVersion: procurement.version, idempotencyKey: `office-procurement-external-${RUN_ID}` },
  expected: [409],
});
assert.equal(externalIssue.payload.error, "external_executor_deferred");
const procurementReadback = await requestJson("/api/procurement/workflow");
assert(procurementReadback.payload.workflows?.some((entry) => entry.id === procurement.id && entry.status === "PO_DRAFT"));

// Governance, eventi e integrazioni: append-only, outbox e readiness esplicita.
const governanceBody = {
  title: `Verifica governance ${RUN_ID}`,
  detail: "Proposta di controllo senza mutazioni implicite.",
  recordType: "workflow-proposal",
  status: "DRAFT",
  idempotencyKey: `office-governance-${RUN_ID}`,
};
const governance = await requestJson("/api/governance/workflows", { method: "POST", body: governanceBody, expected: [201] });
assert(governance.payload.created?.id);
const governanceReplay = await requestJson("/api/governance/workflows", { method: "POST", body: governanceBody });
assert.equal(governanceReplay.payload.idempotent, true);

const auditNoteBody = {
  eventType: "command.audit.note",
  idempotencyKey: `office-audit-${RUN_ID}`,
  payload: { note: "Verifica completa moduli ufficio", reference: job.id },
};
const auditNote = await requestJson("/api/events", { method: "POST", body: auditNoteBody, expected: [201] });
assert.equal(auditNote.payload.readback?.status, "ok");
const auditReplay = await requestJson("/api/events", { method: "POST", body: auditNoteBody });
assert.equal(auditReplay.payload.idempotent, true);
const pwaSignal = await requestJson("/api/events", {
  method: "POST",
  body: { eventType: "pwa.diagnostics.signal", idempotencyKey: `pwa-${RUN_ID}`, payload: { build: `office-${RUN_ID}` } },
  expected: [201],
});
assert.equal(pwaSignal.payload.readback?.status, "ok");

const externalCheck = await requestJson("/api/externals", {
  method: "POST",
  body: {
    adapterKey: "canonical-domain-services",
    checkType: "contract",
    result: "NOT_RUN",
    detail: "Verifica contratto del dominio canonico.",
    evidence: `E2E ${RUN_ID}: nessun executor esterno simulato.`,
  },
  expected: [201],
});
assert(externalCheck.payload.created?.id, "integration evidence must be persisted");
assert.equal(externalCheck.payload.created?.result, "NOT_RUN");

const [events, outbox, reconciliation, externals, aiReadiness, securityReadiness, alignment, releaseReadiness, releaseBuild] = await Promise.all([
  requestJson("/api/events"),
  requestJson("/api/events/outbox"),
  requestJson("/api/events/reconciliation"),
  requestJson("/api/externals"),
  requestJson("/api/governance/ai-readiness"),
  requestJson("/api/governance/security-readiness"),
  requestJson("/api/governance/alignment", { expected: [200, 403] }),
  requestJson("/api/release/readiness"),
  requestJson("/api/release/build"),
]);
assertReadback(events.payload, "events");
assertReadback(outbox.payload, "event outbox");
assertReadback(reconciliation.payload, "event reconciliation");
assert(externals.payload.checks?.some((entry) => entry.id === externalCheck.payload.created.id), "external check must be visible in the tenant registry");
assert.equal(aiReadiness.payload.contract?.directWrite, false);
assert.equal(securityReadiness.payload.contract?.directWrite, false);
if (alignment.status === 200) {
  assert(alignment.payload.contract || alignment.payload.readback, "governance alignment must expose its contract/readback");
} else {
  assert.equal(alignment.payload.error, "site_root_owner_required", "platform alignment must remain restricted to the Site root owner");
}
assert.equal(releaseReadiness.payload.contract?.commercialStatus, "NO_GO", "release endpoint must not hide unresolved external gates");
assert(releaseBuild.payload.buildId, "release build identity must be readable");

// QR, meteo and installable PWA surfaces.
const qr = await requestJson("/api/qr", {
  method: "POST",
  body: { entityType: "commessa", entityId: job.id, format: "QR", label: `Commessa verifica ${RUN_ID}` },
  expected: [200, 201],
});
assert(qr.payload.created?.payload, "QR creation must return a canonical payload");
const qrReadback = await requestJson(`/api/qr?code=${encodeURIComponent(qr.payload.created.payload)}`);
assert.equal(qrReadback.payload.resolved?.entityType, "commessa");
assert.equal(qrReadback.payload.resolved?.entityId, job.canonicalCode || job.id);

const warehouses = await requestJson("/api/authority/warehouses");
const warehouse = warehouses.payload.warehouses?.find((entry) => String(entry.status).toLowerCase() === "active");
assert(warehouse?.id, "weather verification requires an active server-side warehouse");
const weather = await requestJson(`/api/weather?locationId=${encodeURIComponent(`warehouse-location:${warehouse.id}`)}`, { expected: [200, 503] });
if (weather.status === 200) {
  assert.equal(weather.payload.provider?.source, "api.weatherapi.com");
  assert.equal(weather.payload.location?.entityId, warehouse.id);
} else {
  assert.equal(weather.payload.error, "weather_provider_not_configured", "weather must fail closed when its server secret is absent");
}

const manifest = await requestText("/manifest.webmanifest");
assert.match(manifest.raw, /Company AI|AI-ZEROW/i);
const serviceWorker = await requestText("/sw.js");
assert.match(serviceWorker.raw, /fetch|install/i);

// Negative capability checks prove these writes are server-authorized, not UI-only.
const workerFinance = await requestJson("/api/finance/workflow", { actorId: "e2e-worker", expected: [401, 403] });
assert(["unauthenticated", "forbidden"].includes(workerFinance.payload.error), "unknown or unauthorized actors must fail closed on Finance workflow writes");
const driverGovernance = await requestJson("/api/governance/workflows", { actorId: "e2e-driver", method: "POST", body: governanceBody, expected: [401, 403] });
assert(["unauthenticated", "forbidden"].includes(driverGovernance.payload.error), "unknown or unauthorized actors must fail closed on Governance workflow writes");

console.log("PASS office-module flow verification");
console.log(`Commessa: ${job.canonicalCode || job.id}`);
console.log(`Document: ${document.id} · ${queueScan.payload.document.scanStatus}`);
console.log(`Communication: ${communication.payload.created.id} · voice ${voiceProposal.payload.created.id}`);
console.log(`Company AI: ${aiQuery.payload.result.actionId} · approval ${approval.payload.decision.status}`);
console.log(`Finance: ${finance.id} · ${finance.status}`);
console.log(`Procurement: ${procurement.id} · ${procurement.status} · external deferred`);
console.log(`Governance/event/integration: ${governance.payload.created.id} · ${auditNote.payload.created.eventId} · ${externalCheck.payload.created.id}`);
console.log(`Weather: ${weather.status === 200 ? "provider readback" : "controlled server-side gate"}`);
