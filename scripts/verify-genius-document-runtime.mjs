import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const baseUrl = (process.env.ZEROW_RUNTIME_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const actorId = process.env.ZEROW_TEST_ACTOR_ID || "e2e-owner";
const actorEmail = process.env.ZEROW_TEST_ACTOR_EMAIL || `${actorId}@example.invalid`;
const authHeaders = {
  "oai-authenticated-user-id": actorId,
  "oai-authenticated-user-email": actorEmail,
};

async function jsonResponse(path, options = {}, expected = [200]) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...authHeaders, ...(options.headers || {}) },
  });
  const raw = await response.text();
  let payload;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`${options.method || "GET"} ${path} returned non-JSON (${response.status}): ${raw.slice(0, 240)}`);
  }
  assert(expected.includes(response.status), `${options.method || "GET"} ${path}: expected ${expected.join("/ ")}, received ${response.status} (${JSON.stringify(payload).slice(0, 500)})`);
  return { response, payload };
}

const operations = await jsonResponse("/api/operations");
const jobs = (operations.payload.records || []).filter((record) => record.recordType === "job");
assert(jobs.length >= 2, "runtime verification needs two canonical jobs to test deduplicated cross-job linking");

const runId = randomUUID();
const pdfBytes = new TextEncoder().encode([
  "%PDF-1.4",
  "% AI-ZEROW Genius graphical intake runtime fixture",
  `1 0 obj << /Type /Catalog /Run (${runId}) >> endobj`,
  "trailer << /Root 1 0 R >>",
  "%%EOF",
].join("\n"));
const fileName = `genius-runtime-${runId}.pdf`;

function uploadForm(jobId, idempotencyKey) {
  const form = new FormData();
  form.append("file", new File([pdfBytes], fileName, { type: "application/pdf" }));
  form.append("category", "TECHNICAL_DOCUMENT");
  form.append("jobId", jobId);
  form.append("idempotencyKey", idempotencyKey);
  return form;
}

const firstKey = `genius-runtime-first-${runId}`;
const first = await jsonResponse("/api/finance/documents", {
  method: "POST",
  body: uploadForm(jobs[0].id, firstKey),
}, [201]);
const documentId = first.payload.document?.id;
assert(documentId, "canonical intake must return a persistent finance document ID");
assert.equal(first.payload.idempotent, false);
assert.equal(first.payload.readback?.status, "verified");
assert.equal(first.payload.document.jobId, jobs[0].id);
assert.equal(first.payload.document.scanStatus, "NOT_RUN");
assert.equal(first.payload.document.status, "QUARANTINED");
assert.equal(first.payload.document.downloadable, false);
assert.equal(first.payload.document.latestExtraction, null);
assert.equal(first.payload.document.latestReview, null);
assert.equal(first.payload.document.economicEntry, null);

const replay = await jsonResponse("/api/finance/documents", {
  method: "POST",
  body: uploadForm(jobs[0].id, firstKey),
});
assert.equal(replay.payload.idempotent, true, "upload retry must resolve to the original document");
assert.equal(replay.payload.document.id, documentId, "upload retry must not duplicate the original");

const duplicate = await jsonResponse("/api/finance/documents", {
  method: "POST",
  body: uploadForm(jobs[1].id, `genius-runtime-second-${runId}`),
});
assert.equal(duplicate.payload.duplicate, true, "the same original must be reused across verified job links");
assert.equal(duplicate.payload.document.id, documentId, "cross-job linking must not duplicate the stored file");
const linkedJobIds = new Set((duplicate.payload.document.jobs || []).map((job) => job.id));
assert(linkedJobIds.has(jobs[0].id) && linkedJobIds.has(jobs[1].id), "deduplicated original must read back both confirmed job links");

const catalog = await jsonResponse(`/api/finance/documents?jobId=${encodeURIComponent(jobs[1].id)}`);
const catalogDocument = (catalog.payload.documents || []).find((document) => document.id === documentId);
assert(catalogDocument, "the second job dossier must read the deduplicated document through its confirmed link");
assert.equal(catalogDocument.economicEntry, null, "graphical intake must not create an economic fact");
assert.equal(catalogDocument.latestReview, null, "graphical intake must remain unreviewed until an authorized human acts");

const heldDownload = await jsonResponse(`/api/documents/${encodeURIComponent(documentId)}`, {}, [423]);
assert.equal(heldDownload.payload.error, "document_security_hold");
assert.equal(heldDownload.payload.scanStatus, "NOT_RUN");

console.log(JSON.stringify({
  status: "PASS",
  documentId,
  jobs: [jobs[0].id, jobs[1].id],
  checks: [
    "r2_original_persisted",
    "server_hash_and_readback",
    "idempotent_upload_retry",
    "deduplicated_cross_job_link",
    "dossier_filter_readback",
    "no_automatic_ai_review",
    "no_automatic_finance_entry",
    "download_held_until_security_readback",
  ],
}));
