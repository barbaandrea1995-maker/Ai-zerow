import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { qrCodes } from "@/db/schema";
import {
  getAuthorityContext,
  hasCapability,
  publicAuthorityContext,
  type AuthorityContext,
} from "@/lib/authority-context";

export const QR_CAPABILITIES = {
  read: "qr.read",
  write: "qr.write",
} as const;

export const QR_ENTITY_TYPES = ["asset", "material", "warehouse", "commessa"] as const;
export type QrEntityType = (typeof QR_ENTITY_TYPES)[number];
export type QrFormat = "QR" | "BARCODE";

type DirectoryRecord = {
  title: string;
  detail: string;
  module: "assets" | "warehouse" | "operations";
};

export type QrDirectoryMatch = {
  entityType: QrEntityType;
  entityId: string;
  title: string;
  detail: string;
  module: DirectoryRecord["module"];
};

export type QrRecord = {
  id: string;
  format: QrFormat;
  entityType: QrEntityType;
  entityId: string;
  label: string;
  payload: string;
  createdAt: string;
  updatedAt: string;
  lastScannedAt: string | null;
};

export function isQrEntityType(value: string): value is QrEntityType {
  return (QR_ENTITY_TYPES as readonly string[]).includes(value);
}

export function isQrFormat(value: string): value is QrFormat {
  return value === "QR" || value === "BARCODE";
}

export function canonicalPayload(entityType: QrEntityType, entityId: string): string {
  return `AZ1|${entityType.toUpperCase()}|${entityId}`;
}

export function directoryMatch(entityType: QrEntityType, entityId: string): QrDirectoryMatch {
  const labels: Record<QrEntityType, string> = { asset: "Asset", material: "Materiale", warehouse: "Magazzino", commessa: "Commessa" };
  const moduleKey: DirectoryRecord["module"] = entityType === "asset" ? "assets" : entityType === "commessa" ? "operations" : "warehouse";
  return {
    entityType,
    entityId,
    title: `${labels[entityType]} ${entityId}`,
    detail: "Identificativo ricevuto · verifica nel readback D1",
    module: moduleKey,
  };
}

export function parsePayload(input: string): QrDirectoryMatch | null {
  const value = input.trim();
  const parts = value.split("|");
  if (parts.length !== 3 || parts[0] !== "AZ1") return null;
  const rawType = parts[1].toLowerCase();
  const entityType = rawType === "asset" ? "asset" : rawType === "material" ? "material" : rawType === "warehouse" ? "warehouse" : rawType === "commessa" ? "commessa" : null;
  const entityId = parts[2].trim();
  if (!entityType || !entityId) return null;
  return directoryMatch(entityType, entityId);
}

export function inferRawCode(input: string): QrDirectoryMatch | null {
  const value = input.trim().toUpperCase();
  if (!value) return null;
  const canonical = parsePayload(value);
  if (canonical) return canonical;
  if (/^A-[A-Z0-9-]+$/.test(value)) return directoryMatch("asset", value);
  if (/^(MAT|SKU)-[A-Z0-9-]+$/.test(value)) return directoryMatch("material", value);
  if (/^(REQ|SCAN|WH)-[A-Z0-9-]+$/.test(value)) return directoryMatch("warehouse", value);
  if (/^(#|OP-|JOB-|COMM-)?[0-9]{3,}$/.test(value)) {
    return directoryMatch("commessa", value.replace(/^#|^(OP-|JOB-|COMM-)/, ""));
  }
  return null;
}

export function qrRecordForResponse(row: typeof qrCodes.$inferSelect): QrRecord {
  return {
    id: row.id,
    format: isQrFormat(row.format) ? row.format : "QR",
    entityType: isQrEntityType(row.entityType) ? row.entityType : "asset",
    entityId: row.entityId,
    label: row.label,
    payload: row.payload,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastScannedAt: row.lastScannedAt,
  };
}

export function getQrContext() {
  return getAuthorityContext();
}

export function qrAccessDenied(
  context: AuthorityContext | null,
  operation: "read" | "write",
): Response | null {
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, QR_CAPABILITIES[operation])) {
    return Response.json({ error: "forbidden", module: "qr", operation }, { status: 403 });
  }
  return null;
}

export async function getQrReadModel(tenantId: string) {
  const db = getDb();
  return db
    .select()
    .from(qrCodes)
    .where(eq(qrCodes.tenantId, tenantId))
    .orderBy(desc(qrCodes.updatedAt))
    .limit(24);
}

export async function getQrByPayload(tenantId: string, payload: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(qrCodes)
    .where(and(eq(qrCodes.tenantId, tenantId), eq(qrCodes.payload, payload)))
    .limit(1);
  return row ?? null;
}

export function qrEnvelope(context: AuthorityContext, records: QrRecord[]) {
  return {
    context: publicAuthorityContext(context),
    contract: {
      module: "qr-barcode",
      route: "/api/qr",
      source: "sites-d1-read-model",
      authority: "server-context",
      scanner: "local-camera-or-manual-input",
      generator: "bundled-qrcode-library",
      externalService: false,
    },
    records,
    readback: {
      status: "ok",
      count: records.length,
      tenantId: context.tenantId,
      checkedAt: new Date().toISOString(),
    },
  };
}

export function qrAdapterError(error: unknown): string {
  const message = error instanceof Error ? error.message : "unexpected_error";
  if (message.includes("no such table") || message.includes("qr_codes")) return "qr_store_unavailable";
  return "qr_readback_failed";
}
