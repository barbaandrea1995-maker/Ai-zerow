import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { s06Events, s06Outbox, s06Reconciliations, s07AiLedger } from "@/db/schema";
import { hasCapability } from "@/lib/authority-context";
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
    const parsed = await request.json() as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return Response.json({ error: "invalid_json" }, { status: 400 });
    }
    payload = parsed as typeof payload;
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
    if (original.status !== "PENDING_APPROVAL" || !original.approvalRequired) {
      return Response.json({ error: "command_action_already_resolved" }, { status: 409 });
    }

    const existingDecision = await db.select().from(s07AiLedger).where(and(
      eq(s07AiLedger.tenantId, context!.tenantId),
      eq(s07AiLedger.relatedActionId, original.id),
      eq(s07AiLedger.entryType, "approval_decision"),
    )).limit(1);
    if (existingDecision[0]) {
      let recordedDecision: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(existingDecision[0].payloadJson) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) recordedDecision = parsed as Record<string, unknown>;
      } catch {
        return Response.json({ error: "approval_readback_unavailable" }, { status: 503 });
      }
      if (recordedDecision.decision !== decision || recordedDecision.note !== note) {
        return Response.json({ error: "approval_decision_conflict" }, { status: 409 });
      }
      const decisionReceipt = {
        id: existingDecision[0].id,
        actionId: original.id,
        status: existingDecision[0].status,
        directWrite: false,
      };
      if (hasCapability(context!, "command.read")) {
        const rows = await getS07Ledger(context!.tenantId);
        return Response.json({ ...s07Envelope(context!, rows), decision: decisionReceipt, idempotent: true }, {
          headers: { "cache-control": "no-store" },
        });
      }
      return Response.json({
        decision: decisionReceipt,
        readback: { status: "ok", checkedAt: existingDecision[0].createdAt },
        idempotent: true,
      }, { headers: { "cache-control": "no-store" } });
    }

    const now = new Date().toISOString();
    const decisionId = crypto.randomUUID();
    const eventId = crypto.randomUUID();
    const idempotencyKey = `s07:approval:${original.id}`.slice(0, 160);
    await db.batch([
      db.insert(s07AiLedger).values({
      id: decisionId,
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
      }),
      db.insert(s06Events).values({
        eventId,
        tenantId: context!.tenantId,
        eventType: "command.approval.decided",
        schemaVersion: "1",
        actorType: "human",
        actorId: context!.actorId,
        source: "sites-command",
        occurredAt: now,
        observedAt: now,
        aggregateType: "s07.command",
        aggregateId: original.id,
        aggregateVersion: 1,
        payloadJson: JSON.stringify({ actionId: original.id, decision, source: "sites-s07-adapter" }),
        correlationId: crypto.randomUUID(),
        causationId: null,
        idempotencyKey,
        status: "COMMITTED_SITES_READBACK",
        createdAt: now,
      }),
      db.insert(s06Outbox).values({
        id: crypto.randomUUID(),
        tenantId: context!.tenantId,
        eventId,
        topic: "zerow.command.approval.decided",
        status: "PENDING_EXTERNAL_CONSUMER",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(s06Reconciliations).values({
        id: crypto.randomUUID(),
        tenantId: context!.tenantId,
        aggregateType: "s07.command",
        aggregateId: original.id,
        expectedVersion: 1,
        observedVersion: 1,
        status: "SITES_READBACK_VERIFIED",
        detail: "Decisione di approvazione registrata nel ledger e nell'event boundary; esecuzione esterna differita.",
        createdAt: now,
        updatedAt: now,
      }),
    ]);
    const [entry] = await db.select().from(s07AiLedger).where(and(
      eq(s07AiLedger.tenantId, context!.tenantId),
      eq(s07AiLedger.id, decisionId),
    )).limit(1);
    if (!entry) return Response.json({ error: "approval_readback_unavailable" }, { status: 503 });
    const decisionReceipt = {
      id: entry.id,
      actionId: original.id,
      status: entry.status,
      directWrite: false,
    };
    if (hasCapability(context!, "command.read")) {
      const rows = await getS07Ledger(context!.tenantId);
      return Response.json({ ...s07Envelope(context!, rows), decision: decisionReceipt, idempotent: false }, {
        status: 201,
        headers: { "cache-control": "no-store" },
      });
    }
    return Response.json({
      decision: decisionReceipt,
      readback: { status: "ok", checkedAt: entry.createdAt },
      idempotent: false,
    }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE") || message.includes("unique")) {
      return Response.json({ error: "approval_idempotency_conflict" }, { status: 409 });
    }
    return Response.json({ error: s07Error(error) }, { status: 503 });
  }
}
