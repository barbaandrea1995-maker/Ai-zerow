export const MAX_OPERATIONAL_DOCUMENT_BYTES = 20 * 1024 * 1024;

export const OPERATIONAL_DOCUMENT_CATEGORIES = [
  { value: "COMMESSA", label: "Documentazione commessa" },
  { value: "PREVENTIVO", label: "Preventivo" },
  { value: "CONTRATTO", label: "Contratto" },
  { value: "TECNICO", label: "Documentazione tecnica" },
  { value: "POD", label: "Prova di consegna" },
  { value: "AUTORIZZAZIONE", label: "Autorizzazione" },
  { value: "FOTO", label: "Fotografia" },
  { value: "ALTRO", label: "Altro" },
] as const;

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  txt: "text/plain",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
};

export const ALLOWED_OPERATIONAL_DOCUMENT_MIMES = new Set(Object.values(MIME_BY_EXTENSION));

export function safeDocumentFileName(value: string) {
  const leaf = value.split(/[\\/]/).pop()?.trim() || "documento";
  return leaf.replace(/[\u0000-\u001f\u007f]/g, "").replace(/[^\p{L}\p{N}._()\- ]/gu, "_").slice(0, 180) || "documento";
}

export function operationalDocumentMime(fileName: string, declaredMime: string) {
  const extension = fileName.toLowerCase().split(".").pop() ?? "";
  const inferred = MIME_BY_EXTENSION[extension];
  const declared = declaredMime.trim().toLowerCase();
  if (!declared || declared === "application/octet-stream") return inferred ?? null;
  if (!ALLOWED_OPERATIONAL_DOCUMENT_MIMES.has(declared)) return null;
  if (inferred && inferred !== declared) return null;
  return declared;
}

function startsWith(bytes: Uint8Array, signature: number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

function containsNull(bytes: Uint8Array) {
  return bytes.some((byte) => byte === 0);
}

/** Basic file-signature validation. This is not and must not be labelled malware scanning. */
export function matchesOperationalDocumentSignature(mimeType: string, buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer.slice(0, 512));
  if (mimeType === "application/pdf") return startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
  if (mimeType === "image/jpeg") return startsWith(bytes, [0xff, 0xd8, 0xff]);
  if (mimeType === "image/png") return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (mimeType === "image/webp") {
    return startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  }
  if (mimeType === "image/heic" || mimeType === "image/heif") {
    return String.fromCharCode(...bytes.slice(4, 12)).includes("ftyp");
  }
  if (mimeType === "application/msword" || mimeType === "application/vnd.ms-excel") {
    return startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  }
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    || mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) {
    return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]);
  }
  if (mimeType === "text/plain" || mimeType === "text/csv") return !containsNull(bytes);
  return false;
}

export async function sha256Hex(buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
