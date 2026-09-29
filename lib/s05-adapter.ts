import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { s05Records } from "@/db/schema";
import {
  getAuthorityContext,
  hasCapability,
  publicAuthorityContext,
  type AuthorityContext,
} from "@/lib/authority-context";

export const S05_MODULES = {
  documents: { read: "documents.read", write: "documents.write" },
  finance: { read: "finance.read", write: "finance.write" },
  procurement: { read: "finance.read", write: "procurement.write" },
  governance: { read: "approvals.review", write: "tenant.manage" },
} as const;

export type S05Module = keyof typeof S05_MODULES;

export type S05Record = {
  id: string;
  module: S05Module;
  recordType: string;
  title: string;
  detail: string;
  meta: string;
  status: string;
  tone: "lime" | "cyan" | "amber" | "red";
  progress: number;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export function isS05Module(value: string): value is S05Module {
  return Object.prototype.hasOwnProperty.call(S05_MODULES, value);
}

export function s05AccessDenied(
  context: AuthorityContext | null,
  module: S05Module,
  operation: "read" | "write",
): Response | null {
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, S05_MODULES[module][operation])) {
    return Response.json({ error: "forbidden", module, operation }, { status: 403 });
  }
  return null;
}

export function s05Error(error: unknown): string {
  const message = error instanceof Error ? error.message : "unexpected_error";
  return message.includes("no such table") || message.includes("s05_records")
    ? "s05_adapter_store_unavailable"
    : "s05_adapter_readback_failed";
}

export function recordForResponse(row: typeof s05Records.$inferSelect): S05Record {
  let payload: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.payloadJson) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      payload = parsed as Record<string, unknown>;
    }
  } catch {
    payload = {};
  }

  const tone = row.tone === "cyan" || row.tone === "amber" || row.tone === "red" ? row.tone : "lime";
  return {
    id: row.id,
    module: row.module as S05Module,
    recordType: row.recordType,
    title: row.title,
    detail: row.detail,
    meta: row.meta,
    status: row.status,
    tone,
    progress: Math.max(0, Math.min(100, row.progress)),
    payload,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getS05ReadModel(module: S05Module, tenantId: string) {
  const db = getDb();
  return db
    .select()
    .from(s05Records)
    .where(and(eq(s05Records.module, module), eq(s05Records.tenantId, tenantId)))
    .orderBy(desc(s05Records.updatedAt));
}

export async function getS05Context() {
  return getAuthorityContext();
}

export function s05Envelope(context: AuthorityContext, module: S05Module, records: S05Record[]) {
  return {
    context: publicAuthorityContext(context),
    contract: {
      tranche: "S05",
      module,
      route: `/api/s05/${module}`,
      source: "sites-d1-bounded-adapter",
      authority: "server-context",
      mutation: "append-only-proposal",
      canonicalAdapter: "external-domain-service-deferred",
      readback: "verified-at-request",
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
