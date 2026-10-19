import assert from "node:assert/strict";
import {
  buildFinanceDocumentProposal,
  normalizeNutrientSpatialOutput,
} from "../lib/finance-document-extraction-contract.ts";

const nutrientResult = normalizeNutrientSpatialOutput({
  requestId: "nutrient-test-request",
  metrics: { pagesProcessed: 1 },
  output: { elements: [
    { type: "paragraph", text: "Fattura fornitore FV-2026-77 · Edilizia Rossi · Commessa COMM-001", page: { pageNumber: 1 }, confidence: 0.98, readingOrder: 0 },
    { type: "paragraph", text: "Data documento 2026-10-18 · Imponibile 1.000,00 EUR", page: { pageNumber: 1 }, confidence: 0.96, readingOrder: 1 },
    { type: "paragraph", text: "IVA 220,00 EUR · Totale documento 1.220,00 EUR", page: { pageNumber: 1 }, confidence: 0.95, readingOrder: 2 },
    { type: "table", page: { pageNumber: 1 }, confidence: 0.94, cells: [
      { row: 1, column: 0, text: "Cemento", confidence: 0.94 },
      { row: 1, column: 1, text: "10 sacchi", confidence: 0.93 },
    ] },
  ] },
});

assert.equal(nutrientResult.sources.length, 5, "Nutrient spatial output should retain body blocks and table cells");
assert.equal(nutrientResult.sources[0].pageNumber, 1);
assert.equal(nutrientResult.sources[0].confidence, 0.98);
assert.equal(nutrientResult.truncated, false);

const cite = (value, ...evidenceIds) => ({ value, evidenceIds });
const validRaw = {
  documentType: cite("SUPPLIER_INVOICE", "NTR-0001"),
  counterpartyName: cite("Edilizia Rossi", "NTR-0001"),
  counterpartyTaxId: cite("", "NTR-0001"),
  documentNumber: cite("FV-2026-77", "NTR-0001"),
  documentDate: cite("2026-10-18", "NTR-0002"),
  dueDate: cite("", "NTR-0002"),
  currencyCode: cite("EUR", "NTR-0002"),
  netAmount: cite("1000.00", "NTR-0002"),
  vatAmount: cite("220.00", "NTR-0003"),
  grossAmount: cite("1220.00", "NTR-0003"),
  lineItems: [{ description: cite("Cemento", "NTR-0004"), quantity: cite("10", "NTR-0005"), unit: cite("sacchi", "NTR-0005"), unitNetAmount: cite("", "NTR-0004"), vatRate: cite("", "NTR-0004"), netAmount: cite("", "NTR-0004"), grossAmount: cite("", "NTR-0004") }],
  possibleJobIds: ["job-1", "foreign-job"],
};
const jobs = [{ id: "job-1", code: "COMM-001", title: "Ristrutturazione interna" }];
const proposal = buildFinanceDocumentProposal({
  raw: validRaw,
  sources: nutrientResult.sources,
  uploadedCategory: "SUPPLIER_INVOICE",
  jobs,
  sourceWasTruncated: false,
});

assert.equal(proposal.status, "PROPOSED");
assert.equal(proposal.checks.totalsReconcile, true);
assert.deepEqual(proposal.checks.flags, []);
assert.deepEqual(proposal.possibleJobIds, ["job-1"], "only explicit, tenant-catalogued commesse may be proposed");
assert.equal(proposal.netAmount.value, "1000.00");
assert.equal(proposal.netAmount.evidence[0].pageNumber, 1);
assert.equal(proposal.lineItems[0].description.value, "Cemento");

const mismatch = buildFinanceDocumentProposal({
  raw: { ...validRaw, grossAmount: cite("1300.00", "NTR-0003"), documentDate: cite("18/10/2026", "NTR-0002") },
  sources: nutrientResult.sources,
  uploadedCategory: "CUSTOMER_INVOICE",
  jobs,
  sourceWasTruncated: true,
});
assert.equal(mismatch.status, "REVIEW_REQUIRED");
assert.equal(mismatch.checks.totalsReconcile, false);
assert(mismatch.checks.flags.includes("DOCUMENT_TYPE_DIFFERS_FROM_SELECTED_CATEGORY"));
assert(mismatch.checks.flags.includes("NET_VAT_GROSS_TOTAL_MISMATCH"));
assert(mismatch.checks.flags.includes("DOCUMENT_DATE_MISSING"));
assert(mismatch.checks.flags.includes("SOURCE_TEXT_TRUNCATED_REVIEW_ALL_PAGES"));

const unsupportedEvidence = buildFinanceDocumentProposal({
  raw: { ...validRaw, grossAmount: cite("999999.00", "made-up-element") },
  sources: nutrientResult.sources,
  uploadedCategory: "SUPPLIER_INVOICE",
  jobs,
  sourceWasTruncated: false,
});
assert.equal(unsupportedEvidence.grossAmount.value, "", "model values without a real Nutrient source must be removed");
assert(unsupportedEvidence.checks.flags.includes("GROSS_AMOUNT_MISSING"));

console.log(JSON.stringify({
  status: "PASS",
  checks: [
    "nutrient_spatial_source_normalization",
    "provider_page_and_confidence_provenance",
    "tenant_catalog_job_validation",
    "financial_total_reconciliation",
    "category_mismatch_review_gate",
    "truncated_source_review_gate",
    "unsupported_model_citation_rejection",
  ],
}));
