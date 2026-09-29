import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { s07AiLedger } from "@/db/schema";
import {
  getS07Context,
  getS07Ledger,
  s07AccessDenied,
  s07Envelope,
  s07Error,
} from "@/lib/s07-adapter";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const context = await getS07Context();
  const denied = s07AccessDenied(context, "approve");
  if (denied) return denied;

  let payload: { actionId?: unknown; decision?: unknown; note?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const actionId = typeof payload.actionId === "string" ? payload.actionId.trim() : "";
  const decision = typeof payload.decision === "string" ? payload.decision.trim().toLowerCase() : "";
  const note = typeof payload.note === "string" ? payload.note.trim().slice(0, 240) : "";
  if (!actionId || (decision !== "approved" && decision !== "rejected")) {
    return Response.json({ error: "action_id_and_approval_decision_required" }, { status: 400 });
  }

  try {
    const db = getDb();
    const [original] = await db.select().from(s07AiLedger).where(and(
      eq(s07AiLedger.id, actionId),
      eq(s07AiLedger.tenantId, context!.tenantId),
    )).limit(1);
    if (!original) return Response.json({ error: "command_action_not_found" }, { status: 404 });
    if (original.entryType !== "command_preview") return Response.json({ error: "command_action_not_approvable" }, { status: 409 });

    const now = new Date().toISOString();
    const [entry] = await db.insert(s07AiLedger).values({
      id: crypto.randomUUID(),
      tenantId: context!.tenantId,
      entryType: "approval_decision",
      actionType: "approval.decision",
      command: original.command,
      status: decision === "approved" ? "APPROVED_PENDING_EXTERNAL_EXECUTION" : "REJECTED",
      approvalRequired: 0,
      relatedActionId: original.id,
      payloadJson: JSON.stringify({ source: "sites-s07-adapter", decision, note }),
      requestedBy: original.requestedBy,
      approvedBy: context!.actorId,
      readbackJson: JSON.stringify({
        status: "SITES_LEDGER_VERIFIED",
        directWrite: false,
        externalExecution: "deferred",
        checkedAt: now,
      }),
      createdAt: now,
    }).returning();
    const rows = await getS07Ledger(context!.tenantId);
    return Response.json({ ...s07Envelope(context!, rows), decision: {
      id: entry.id,
      actionId: original.id,
      status: entry.status,
      directWrite: false,
    } }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: s07Error(error) }, { status: 503 });
  }
}
