export const FINANCE_ENTRY_TYPES = ["EXPENSE", "REVENUE", "COMMITMENT", "PAYMENT", "RECEIPT"] as const;
export const FINANCE_ENTRY_STATUSES = ["PENDING_APPROVAL", "CONFIRMED", "REVERSED"] as const;
export const FINANCE_ECONOMIC_TREATMENTS = ["DOCUMENT_ONLY", ...FINANCE_ENTRY_TYPES] as const;
export const FINANCE_DOCUMENT_ROLES = [
  "SUPPLIER_INVOICE",
  "CUSTOMER_INVOICE",
  "DELIVERY_NOTE",
  "PURCHASE_ORDER",
  "CREDIT_NOTE",
  "PAYMENT_EVIDENCE",
  "CONTRACT",
  "OTHER",
] as const;
export const FINANCE_COST_CATEGORIES = [
  "LABOR",
  "MATERIALS",
  "VEHICLES",
  "SUBCONTRACTS",
  "TRANSPORT",
  "RENTALS",
  "GENERAL",
  "OTHER",
] as const;
export const FINANCE_VALUATION_BASES = ["NET", "GROSS", "DOCUMENT_TOTAL", "EXPLICIT"] as const;
export const FINANCE_RELATION_TYPES = [
  "SETTLES",
  "MATCHES_PURCHASE_ORDER",
  "DOCUMENTS_DELIVERY",
  "ADJUSTS",
  "SUPERSEDES",
] as const;

export type FinanceEntryType = (typeof FINANCE_ENTRY_TYPES)[number];
export type FinanceEntryStatus = (typeof FINANCE_ENTRY_STATUSES)[number];
export type FinanceEconomicTreatment = (typeof FINANCE_ECONOMIC_TREATMENTS)[number];
export type FinanceDocumentRole = (typeof FINANCE_DOCUMENT_ROLES)[number];
export type FinanceCostCategory = (typeof FINANCE_COST_CATEGORIES)[number];
export type FinanceValuationBasis = (typeof FINANCE_VALUATION_BASES)[number];
export type FinanceRelationType = (typeof FINANCE_RELATION_TYPES)[number];

export const FINANCE_MANAGEMENT_POLICY = {
  schemaVersion: "finance-job-economics-v1",
  moneyScale: "minor-unit",
  invoiceRecognition: "human-selected-and-confirmed",
  defaultInvoiceValuationBasis: null,
  mixedCurrencyAggregation: false,
  documentProposalCreatesEntry: false,
  ddtCreatesEconomicEntry: false,
  warehouseMovementCreatesEconomicEntry: false,
  makerCheckerRequired: true,
} as const;

export function isFinanceEntryType(value: string): value is FinanceEntryType {
  return (FINANCE_ENTRY_TYPES as readonly string[]).includes(value);
}

export function isFinanceEconomicTreatment(value: string): value is FinanceEconomicTreatment {
  return (FINANCE_ECONOMIC_TREATMENTS as readonly string[]).includes(value);
}

export function isFinanceDocumentRole(value: string): value is FinanceDocumentRole {
  return (FINANCE_DOCUMENT_ROLES as readonly string[]).includes(value);
}

export function isFinanceCostCategory(value: string): value is FinanceCostCategory {
  return (FINANCE_COST_CATEGORIES as readonly string[]).includes(value);
}

export function isFinanceValuationBasis(value: string): value is FinanceValuationBasis {
  return (FINANCE_VALUATION_BASES as readonly string[]).includes(value);
}

export function isFinanceRelationType(value: string): value is FinanceRelationType {
  return (FINANCE_RELATION_TYPES as readonly string[]).includes(value);
}

export function isIsoCurrency(value: string) {
  return /^[A-Z]{3}$/.test(value);
}

export function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function decimalToMinor(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d{1,13}(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, decimal = ""] = normalized.split(".");
  const minor = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  return Number.isSafeInteger(minor) && minor >= 0 && minor <= 900_000_000_000_000 ? minor : null;
}

export function minorToDecimal(amountMinor: number | null) {
  return amountMinor === null || !Number.isSafeInteger(amountMinor) ? "" : (amountMinor / 100).toFixed(2);
}

export function documentRoleForClassification(classification: string): FinanceDocumentRole {
  if (classification === "SUPPLIER_INVOICE") return "SUPPLIER_INVOICE";
  if (classification === "CUSTOMER_INVOICE") return "CUSTOMER_INVOICE";
  if (classification === "SUPPLIER_CREDIT_NOTE" || classification === "CUSTOMER_CREDIT_NOTE") return "CREDIT_NOTE";
  if (classification === "DELIVERY_NOTE") return "DELIVERY_NOTE";
  if (classification === "PURCHASE_ORDER") return "PURCHASE_ORDER";
  if (classification === "PAYMENT_EVIDENCE") return "PAYMENT_EVIDENCE";
  if (classification === "QUOTE_CONTRACT") return "CONTRACT";
  return "OTHER";
}

export function allowedTreatmentsForClassification(classification: string): FinanceEconomicTreatment[] {
  if (classification === "SUPPLIER_INVOICE") return ["DOCUMENT_ONLY", "EXPENSE"];
  if (classification === "CUSTOMER_INVOICE") return ["DOCUMENT_ONLY", "REVENUE"];
  if (classification === "SUPPLIER_CREDIT_NOTE") return ["DOCUMENT_ONLY", "EXPENSE"];
  if (classification === "CUSTOMER_CREDIT_NOTE") return ["DOCUMENT_ONLY", "REVENUE"];
  if (classification === "PURCHASE_ORDER") return ["DOCUMENT_ONLY", "COMMITMENT"];
  if (classification === "PAYMENT_EVIDENCE") return ["DOCUMENT_ONLY", "PAYMENT", "RECEIPT"];
  return ["DOCUMENT_ONLY"];
}

export function effectSignForClassification(classification: string): 1 | -1 {
  return classification === "SUPPLIER_CREDIT_NOTE" || classification === "CUSTOMER_CREDIT_NOTE" ? -1 : 1;
}
