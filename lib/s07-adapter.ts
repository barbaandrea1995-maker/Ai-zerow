import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { s07AiLedger } from "@/db/schema";
import {
  getAuthorityContext,
  hasCapability,
  publicAuthorityContext,
  type AuthorityContext,
} from "@/lib/authority-context";

export function s07AccessDenied(context: AuthorityContext | null, operation: "read" | "write" | "approve"): Response | null {
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const capability = operation === "approve" ? "approvals.review" : "command.read";
  if (!hasCapability(context, capability)) return Response.json({ error: "forbidden", operation }, { status: 403 });
  return null;
}

export function s07Error(error: unknown): string {
  const message = error instanceof Error ? error.message : "unexpected_error";
  return message.includes("no such table") || message.includes("s07_ai_ledger")
    ? "s07_ledger_store_unavailable"
    : "s07_ledger_readback_failed";
}

function parsePayload(value: string | null) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function ledgerForResponse(row: typeof s07AiLedger.$inferSelect) {
  return {
    id: row.id,
    entryType: row.entryType,
    actionType: row.actionType,
    command: row.command,
    status: row.status,
    approvalRequired: Boolean(row.approvalRequired),
    relatedActionId: row.relatedActionId,
    payload: parsePayload(row.payloadJson),
    requestedBy: row.requestedBy,
    approvedBy: row.approvedBy,
    readback: parsePayload(row.readbackJson),
    createdAt: row.createdAt,
  };
}

export async function getS07Ledger(tenantId: string) {
  const db = getDb();
  return db.select().from(s07AiLedger).where(eq(s07AiLedger.tenantId, tenantId)).orderBy(desc(s07AiLedger.createdAt)).limit(60);
}

export async function getS07Context() {
  return getAuthorityContext();
}

export function s07Envelope(context: AuthorityContext, rows: Array<typeof s07AiLedger.$inferSelect>) {
  return {
    context: publicAuthorityContext(context),
    contract: {
      tranche: "S07",
      source: "sites-d1-governed-command-adapter",
      runtime: "external-openai-runtime-deferred",
      directWrite: false,
      approval: "append-only-ledger-entry",
      readback: "sites-d1-verified",
    },
    ledger: rows.map(ledgerForResponse),
    readback: { status: "ok", count: rows.length, checkedAt: new Date().toISOString() },
  };
}
