import { MAX_OPERATIONAL_DOCUMENT_BYTES } from "@/lib/document-contract";

export const MAX_FINANCE_DOCUMENT_BYTES = MAX_OPERATIONAL_DOCUMENT_BYTES;

export const FINANCE_DOCUMENT_CATEGORIES = [
  { value: "SUPPLIER_INVOICE", label: "Fattura fornitore" },
  { value: "CUSTOMER_INVOICE", label: "Fattura cliente" },
  { value: "DELIVERY_NOTE", label: "DDT / bolla" },
  { value: "PAYMENT_EVIDENCE", label: "Ricevuta / prova di pagamento" },
  { value: "QUOTE_CONTRACT", label: "Preventivo / contratto" },
  { value: "OTHER", label: "Altro documento Finance" },
] as const;

export type FinanceDocumentCategory = (typeof FINANCE_DOCUMENT_CATEGORIES)[number]["value"];

export function isFinanceDocumentCategory(value: string): value is FinanceDocumentCategory {
  return FINANCE_DOCUMENT_CATEGORIES.some((category) => category.value === value);
}
