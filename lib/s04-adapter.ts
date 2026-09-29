import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { s04Records } from "@/db/schema";
import {
  assertTenantScope,
  getAuthorityContext,
  hasCapability,
  publicAuthorityContext,
  type AuthorityContext,
} from "@/lib/authority-context";

export const S04_MODULES = {
  operations: { read: "operations.read", write: "operations.write" },
  workforce: { read: "workforce.read", write: "workforce.write" },
  warehouse: { read: "warehouse.read", write: "warehouse.write" },
  mission: { read: "mission.read", write: "mission.write" },
  assets: { read: "asset.read", write: "asset.write" },
} as const;

export type S04Module = keyof typeof S04_MODULES;

export type S04Record = {
  id: string;
  module: S04Module;
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

export function isS04Module(value: string): value is S04Module {
  return Object.prototype.hasOwnProperty.call(S04_MODULES, value);
}

export function s04AccessDenied(
  context: AuthorityContext | null,
  module: S04Module,
  operation: "read" | "write",
): Response | null {
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, S04_MODULES[module][operation])) {
    return Response.json({ error: "forbidden", module, operation }, { status: 403 });
  }
  return null;
}

export function adapterError(error: unknown): string {
  const message = error instanceof Error ? error.message : "unexpected_error";
  if (message.includes("no such table") || message.includes("s04_records")) {
    return "s04_adapter_store_unavailable";
  }
  return "s04_adapter_readback_failed";
}

export function recordForResponse(row: typeof s04Records.$inferSelect): S04Record {
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
    module: row.module as S04Module,
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

export async function getS04ReadModel(module: S04Module, tenantId: string) {
  const db = getDb();
  return db
    .select()
    .from(s04Records)
    .where(and(eq(s04Records.module, module), eq(s04Records.tenantId, tenantId)))
    .orderBy(desc(s04Records.updatedAt));
}

export async function getS04Context() {
  return getAuthorityContext();
}

export function s04Envelope(
  context: AuthorityContext,
  module: S04Module,
  records: S04Record[],
) {
  return {
    context: publicAuthorityContext(context),
    contract: {
      module,
      route: `/api/${module}`,
      source: "sites-d1-read-model",
      authority: "server-context",
      canonicalAdapter: "pending-external-domain-service",
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

export function assertS04Tenant(context: AuthorityContext, tenantId: string) {
  assertTenantScope(context, tenantId);
}
