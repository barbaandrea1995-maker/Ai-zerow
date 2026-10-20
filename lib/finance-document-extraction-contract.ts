export const FINANCE_EXTRACTED_DOCUMENT_TYPES = [
  "SUPPLIER_INVOICE",
  "CUSTOMER_INVOICE",
  "SUPPLIER_CREDIT_NOTE",
  "CUSTOMER_CREDIT_NOTE",
  "DELIVERY_NOTE",
  "PURCHASE_ORDER",
  "PAYMENT_EVIDENCE",
  "QUOTE_CONTRACT",
  "WORK_REPORT",
  "TECHNICAL_DOCUMENT",
  "OTHER",
] as const;

export type FinanceExtractedDocumentType = (typeof FINANCE_EXTRACTED_DOCUMENT_TYPES)[number];
export type FinanceEvidenceSource = {
  id: string;
  pageNumber: number | null;
  confidence: number | null;
  text: string;
};

export type FinanceEvidenceField = {
  value: string;
  evidence: FinanceEvidenceSource[];
};

export type FinanceDocumentProposal = {
  schemaVersion: "finance-document-extraction-v1";
  status: "PROPOSED" | "REVIEW_REQUIRED";
  documentType: FinanceEvidenceField;
  counterpartyName: FinanceEvidenceField;
  counterpartyTaxId: FinanceEvidenceField;
  documentNumber: FinanceEvidenceField;
  documentDate: FinanceEvidenceField;
  dueDate: FinanceEvidenceField;
  currencyCode: FinanceEvidenceField;
  netAmount: FinanceEvidenceField;
  vatAmount: FinanceEvidenceField;
  grossAmount: FinanceEvidenceField;
  lineItems: Array<{
    description: FinanceEvidenceField;
    quantity: FinanceEvidenceField;
    unit: FinanceEvidenceField;
    unitNetAmount: FinanceEvidenceField;
    vatRate: FinanceEvidenceField;
    netAmount: FinanceEvidenceField;
    grossAmount: FinanceEvidenceField;
  }>;
  possibleJobIds: string[];
  checks: {
    flags: string[];
    totalsReconcile: boolean | null;
    sourceWasTruncated: boolean;
  };
};

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength)
    : "";
}

function finiteConfidence(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const normalized = value > 1 ? value / 100 : value;
  return Math.max(0, Math.min(1, normalized));
}

function pageNumber(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const page = value as JsonRecord;
  if (typeof page.pageNumber === "number" && Number.isInteger(page.pageNumber) && page.pageNumber > 0) return page.pageNumber;
  if (typeof page.pageIndex === "number" && Number.isInteger(page.pageIndex) && page.pageIndex >= 0) return page.pageIndex + 1;
  return null;
}

/** Convert Nutrient spatial output into small, source-addressable text blocks. */
export function normalizeNutrientSpatialOutput(
  payload: unknown,
  limits: { maxElements?: number; maxChars?: number } = {},
): { sources: FinanceEvidenceSource[]; truncated: boolean } {
  const maxElements = limits.maxElements ?? 360;
  const maxChars = limits.maxChars ?? 42_000;
  const root = record(payload);
  const rawOutput = root.output;
  const output = record(root.output);
  const spatial = record(output.spatial);
  const rawElements = Array.isArray(rawOutput)
    ? rawOutput
    : Array.isArray(output.elements)
    ? output.elements
    : Array.isArray(spatial.elements)
      ? spatial.elements
      : Array.isArray(root.elements)
        ? root.elements
        : [];
  const candidates: Array<{ text: string; pageNumber: number | null; confidence: number | null; readingOrder: number }> = [];

  const add = (text: unknown, page: number | null, confidence: unknown, readingOrder = Number.MAX_SAFE_INTEGER) => {
    const normalized = cleanText(text, 1_500);
    if (!normalized) return;
    candidates.push({ text: normalized, pageNumber: page, confidence: finiteConfidence(confidence), readingOrder });
  };

  for (const raw of rawElements) {
    const element = record(raw);
    const page = pageNumber(element.page);
    const order = typeof element.readingOrder === "number" && Number.isFinite(element.readingOrder)
      ? element.readingOrder
      : Number.MAX_SAFE_INTEGER;
    const baseConfidence = element.confidence;
    const elementType = cleanText(element.type, 48).toLowerCase();

    if (Array.isArray(element.pairs)) {
      for (const pairValue of element.pairs) {
        const pair = record(pairValue);
        const key = record(pair.key);
        const value = record(pair.value);
        const pairText = [cleanText(key.value, 400), cleanText(value.value, 700)].filter(Boolean).join(": ");
        add(pairText, page, value.confidence ?? pair.relationshipConfidence ?? baseConfidence, order);
      }
      continue;
    }

    if (Array.isArray(element.cells)) {
      for (const cellValue of element.cells) {
        const cell = record(cellValue);
        add(cell.text, page, cell.confidence ?? baseConfidence, order + (typeof cell.row === "number" ? cell.row / 100 : 0));
      }
      continue;
    }

    const text = element.text ?? element.content ?? element.value;
    if (typeof text === "string") add(text, page, baseConfidence, order);
    else if (elementType === "paragraph" && Array.isArray(element.words)) {
      add(element.words.map((word) => cleanText(record(word).text, 120)).filter(Boolean).join(" "), page, baseConfidence, order);
    }
  }

  candidates.sort((a, b) => a.readingOrder - b.readingOrder);
  const sources: FinanceEvidenceSource[] = [];
  let chars = 0;
  let truncated = candidates.length > maxElements;
  for (const item of candidates.slice(0, maxElements)) {
    if (chars >= maxChars) {
      truncated = true;
      break;
    }
    const text = item.text.slice(0, maxChars - chars);
    if (text.length < item.text.length) truncated = true;
    sources.push({
      id: `NTR-${String(sources.length + 1).padStart(4, "0")}`,
      pageNumber: item.pageNumber,
      confidence: item.confidence,
      text,
    });
    chars += text.length;
  }
  return { sources, truncated };
}

function evidenceIds(value: unknown, allowed: Map<string, FinanceEvidenceSource>) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === "string" && allowed.has(id)))].slice(0, 3);
}

function normalizeAmount(value: string) {
  const normalized = value.replace(/\s/g, "").replace(",", ".");
  return /^-?\d{1,13}(?:\.\d{1,2})?$/.test(normalized) ? normalized : "";
}

function amountInCents(value: string): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}

function normalizeDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : "";
}

function field(
  rawValue: unknown,
  rawEvidenceIds: unknown,
  sources: Map<string, FinanceEvidenceSource>,
  kind: "text" | "amount" | "date" | "currency" = "text",
): FinanceEvidenceField {
  const rawText = cleanText(rawValue, 500);
  const ids = evidenceIds(rawEvidenceIds, sources);
  let value = rawText;
  if (kind === "amount") value = normalizeAmount(value);
  if (kind === "date") value = normalizeDate(value);
  if (kind === "currency") value = /^[A-Z]{3}$/.test(value.toUpperCase()) ? value.toUpperCase() : "";
  if (!ids.length) value = "";
  return { value, evidence: ids.map((id) => sources.get(id)!).filter(Boolean) };
}

function rawField(raw: JsonRecord) {
  return record(raw);
}

export function buildFinanceDocumentProposal({
  raw,
  sources,
  uploadedCategory,
  jobs,
  sourceWasTruncated,
}: {
  raw: unknown;
  sources: FinanceEvidenceSource[];
  uploadedCategory: string;
  jobs: Array<{ id: string; code: string | null; title: string }>;
  sourceWasTruncated: boolean;
}): FinanceDocumentProposal {
  const value = record(raw);
  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  const typedField = (name: string, kind: "text" | "amount" | "date" | "currency" = "text") => {
    const item = rawField(record(value[name]));
    return field(item.value, item.evidenceIds, sourceMap, kind);
  };
  const rawType = cleanText(record(value.documentType).value, 40).toUpperCase();
  const documentType = (FINANCE_EXTRACTED_DOCUMENT_TYPES as readonly string[]).includes(rawType) ? rawType as FinanceExtractedDocumentType : "OTHER";
  const normalizedDocumentType = field(documentType, record(value.documentType).evidenceIds, sourceMap);
  const proposal = {
    schemaVersion: "finance-document-extraction-v1" as const,
    status: "PROPOSED" as FinanceDocumentProposal["status"],
    documentType: normalizedDocumentType,
    counterpartyName: typedField("counterpartyName"),
    counterpartyTaxId: typedField("counterpartyTaxId"),
    documentNumber: typedField("documentNumber"),
    documentDate: typedField("documentDate", "date"),
    dueDate: typedField("dueDate", "date"),
    currencyCode: typedField("currencyCode", "currency"),
    netAmount: typedField("netAmount", "amount"),
    vatAmount: typedField("vatAmount", "amount"),
    grossAmount: typedField("grossAmount", "amount"),
    lineItems: (Array.isArray(value.lineItems) ? value.lineItems : []).slice(0, 40).map((lineValue) => {
      const line = record(lineValue);
      const lineField = (name: string, kind: "text" | "amount" = "text") => {
        const item = record(line[name]);
        return field(item.value, item.evidenceIds, sourceMap, kind);
      };
      return {
        description: lineField("description"),
        quantity: lineField("quantity", "amount"),
        unit: lineField("unit"),
        unitNetAmount: lineField("unitNetAmount", "amount"),
        vatRate: lineField("vatRate", "amount"),
        netAmount: lineField("netAmount", "amount"),
        grossAmount: lineField("grossAmount", "amount"),
      };
    }).filter((line) => line.description.value),
    possibleJobIds: [] as string[],
    checks: {
      flags: [] as string[],
      totalsReconcile: null as boolean | null,
      sourceWasTruncated,
    },
  };

  const sourceText = sources.map((source) => source.text.toLocaleLowerCase("it-IT")).join(" ");
  const validJobs = new Map(jobs.map((job) => [job.id, job]));
  const rawJobIds = Array.isArray(value.possibleJobIds) ? value.possibleJobIds : [];
  proposal.possibleJobIds = [...new Set(rawJobIds.flatMap((id) => {
    if (typeof id !== "string") return [];
    const job = validJobs.get(id);
    if (!job) return [];
    const explicitCode = job.code && sourceText.includes(job.code.toLocaleLowerCase("it-IT"));
    const explicitTitle = job.title.trim().length >= 8 && sourceText.includes(job.title.toLocaleLowerCase("it-IT"));
    return explicitCode || explicitTitle ? [job.id] : [];
  }))].slice(0, 5);

  const categoryMatches = uploadedCategory === "OTHER" || uploadedCategory === documentType;
  if (!categoryMatches) proposal.checks.flags.push("DOCUMENT_TYPE_DIFFERS_FROM_SELECTED_CATEGORY");
  if (sourceWasTruncated) proposal.checks.flags.push("SOURCE_TEXT_TRUNCATED_REVIEW_ALL_PAGES");
  if (["SUPPLIER_INVOICE", "CUSTOMER_INVOICE", "SUPPLIER_CREDIT_NOTE", "CUSTOMER_CREDIT_NOTE"].includes(documentType)) {
    if (!proposal.counterpartyName.value) proposal.checks.flags.push("COUNTERPARTY_MISSING");
    if (!proposal.documentNumber.value) proposal.checks.flags.push("DOCUMENT_NUMBER_MISSING");
    if (!proposal.documentDate.value) proposal.checks.flags.push("DOCUMENT_DATE_MISSING");
    if (!proposal.currencyCode.value) proposal.checks.flags.push("CURRENCY_MISSING");
    if (!proposal.grossAmount.value) proposal.checks.flags.push("GROSS_AMOUNT_MISSING");
  } else if (["PAYMENT_EVIDENCE", "QUOTE_CONTRACT", "PURCHASE_ORDER"].includes(documentType)) {
    if (!proposal.counterpartyName.value) proposal.checks.flags.push("COUNTERPARTY_MISSING");
    if (!proposal.documentDate.value) proposal.checks.flags.push("DOCUMENT_DATE_MISSING");
    if (!proposal.grossAmount.value) proposal.checks.flags.push("GROSS_AMOUNT_MISSING");
  } else if (documentType === "DELIVERY_NOTE") {
    if (!proposal.documentNumber.value) proposal.checks.flags.push("DOCUMENT_NUMBER_MISSING");
    if (!proposal.documentDate.value) proposal.checks.flags.push("DOCUMENT_DATE_MISSING");
  }

  const netCents = amountInCents(proposal.netAmount.value);
  const vatCents = amountInCents(proposal.vatAmount.value);
  const grossCents = amountInCents(proposal.grossAmount.value);
  if (netCents !== null && vatCents !== null && grossCents !== null) {
    proposal.checks.totalsReconcile = Math.abs(netCents + vatCents - grossCents) <= 2;
    if (!proposal.checks.totalsReconcile) proposal.checks.flags.push("NET_VAT_GROSS_TOTAL_MISMATCH");
  }
  if (!proposal.documentType.evidence.length) proposal.checks.flags.push("DOCUMENT_TYPE_UNGROUNDED");
  proposal.status = proposal.checks.flags.length ? "REVIEW_REQUIRED" : "PROPOSED";
  return proposal;
}
