import * as XLSX from "xlsx";
import {
  MAX_OPERATIONAL_DOCUMENT_BYTES,
  matchesOperationalDocumentSignature,
  operationalDocumentMime,
} from "@/lib/document-contract";

const EXCEL_MIMES = new Set([
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const MAX_SHEETS = 24;

function normalizeSpreadsheetText(value: string, maxChars: number) {
  return value
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim()
    .slice(0, maxChars);
}

function isFileLike(value: unknown): value is File {
  return Boolean(value && typeof value === "object" && typeof (value as { arrayBuffer?: unknown }).arrayBuffer === "function");
}

/**
 * Reads an Excel workbook as inert tabular text. SheetJS only parses the
 * workbook; formulas/macros are never executed. The result is sent to
 * Company AI as document data, never as instructions.
 */
export async function extractCompanyAiSpreadsheetText(file: unknown, maxChars: number) {
  if (!isFileLike(file)) throw new Error("spreadsheet_file_required");
  if (file.size > MAX_OPERATIONAL_DOCUMENT_BYTES) throw new Error("spreadsheet_file_too_large");

  const mimeType = operationalDocumentMime(file.name, file.type);
  if (!mimeType || !EXCEL_MIMES.has(mimeType)) throw new Error("spreadsheet_format_not_supported");

  const buffer = await file.arrayBuffer();
  if (!matchesOperationalDocumentSignature(mimeType, buffer)) throw new Error("spreadsheet_signature_invalid");

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(new Uint8Array(buffer), {
      type: "array",
      cellDates: true,
      cellNF: false,
      cellText: true,
      dense: true,
      WTF: false,
    });
  } catch {
    throw new Error("spreadsheet_not_readable");
  }

  const sections = workbook.SheetNames.slice(0, MAX_SHEETS).flatMap((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return [];
    const rows = XLSX.utils.sheet_to_csv(sheet, {
      blankrows: false,
      FS: "\t",
      RS: "\n",
    }).trim();
    return rows ? [`FOGLIO: ${sheetName}\n${rows}`] : [];
  });

  const text = normalizeSpreadsheetText(sections.join("\n\n"), maxChars);
  if (text.length < 2) throw new Error("spreadsheet_empty");
  return { text, mimeType, sheetCount: sections.length };
}
