import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { s06Events, s06Outbox, s06Reconciliations } from "@/db/schema";
import {
  getS06Context,
  getS06Snapshot,
  outboxForResponse,
  s06AccessDenied,
  s06Envelope,
  s06Error,
} from "@/lib/s06-adapter";
import { OUTBOX_ACTIONS, OutboxTransitionError, transitionOutbox, type OutboxAction } from "@/lib/outbox-contract";

export const dynamic = "force-dynamic";

export async function GET() {
  const context = await getS06Context();
  const denied = s06AccessDenied(context, "read");
  if (denied) return denied;
  try {
    const snapshot = await getS06Snapshot(context!.tenantId);
    return Response.json({ ...s06Envelope(context!, snapshot), surface: "outbox" }, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return Response.json({ error: s06Error(error) }, { status: 503 });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export async function POST(request: Request) {
  const context = await getS06Context();
  const denied = s06AccessDenied(context, "write");
  if (denied) return denied;

  let payload: Record<string, unknown>;
  try {
    const parsed = await request.json() as unknown;
    if (!isRecord(parsed)) return Response.json({ error: "invalid_json" }, { status: 400 });
    payload = parsed;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const outboxId = typeof payload.outboxId === "string" ? payload.outboxId.trim().slice(0, 120) : "";
  const action = typeof payload.action === "string" ? payload.action.trim().toLowerCase() : "";
  const note = typeof payload.note === "string" ? payload.note.trim().slice(0, 240) : "";
  const idempotencyKey = typeof payload.idempotencyKey === "string" ? payload.idempotencyKey.trim().slice(0, 160) : `s06:outbox:${crypto.randomUUID()}`;
  if (!outboxId || !OUTBOX_ACTIONS.includes(action as OutboxAction)) {
    return Response.json({ error: "outbox_id_and_valid_action_required", actions: OUTBOX_ACTIONS }, { status: 400 });
  }
  if (typeof payload.idempotencyKey === "string" && payload.idempotencyKey.trim().length > 160) {
    return Response.json({ error: "idempotency_key_too_long" }, { status: 400 });
  }

  try {
    const db = getDb();
    const existingAction = await db.select().from(s06Events).where(and(
      eq(s06Events.tenantId, context!.tenantId),
      eq(s06Events.idempotencyKey, idempotencyKey),
    )).limit(1);
    if (existingAction[0]) {
      if (existingAction[0].aggregateType !== "s06.outbox.action") {
        return Response.json({ error: "outbox_idempotency_key_conflict" }, { status: 409 });
      }
      const snapshot = await getS06Snapshot(context!.tenantId);
      return Response.json({ ...s06Envelope(context!, snapshot), action: eventForOutboxAction(existingAction[0]), idempotent: true }, {
        headers: { "cache-control": "no-store" },
      });
    }

    const [current] = await db.select().from(s06Outbox).where(and(
      eq(s06Outbox.tenantId, context!.tenantId),
      eq(s06Outbox.id, outboxId),
    )).limit(1);
    if (!current) return Response.json({ error: "outbox_not_found" }, { status: 404 });

    const transition = transitionOutbox({ status: current.status, attempts: current.attempts, action: action as OutboxAction });
    const now = new Date().toISOString();
    const actionId = crypto.randomUUID();
    const eventId = crypto.randomUUID();
    const detail = note ? `${transition.detail} Note: ${note}` : transition.detail;
    await db.batch([
      db.update(s06Outbox).set({
        status: transition.nextStatus,
        attempts: transition.nextAttempts,
        lastError: transition.nextStatus === "BLOCKED_EXTERNAL_CONSUMER" || transition.nextStatus === "DEAD_LETTERED" ? detail : null,
        updatedAt: now,
      }).where(and(eq(s06Outbox.tenantId, context!.tenantId), eq(s06Outbox.id, current.id))),
      db.insert(s06Events).values({
        eventId,
        tenantId: context!.tenantId,
        eventType: "s06.outbox.state_changed",
        schemaVersion: "1",
        actorType: "human",
        actorId: context!.actorId,
        source: "sites-s06-outbox-control",
        occurredAt: now,
        observedAt: now,
        aggregateType: "s06.outbox.action",
        aggregateId: actionId,
        aggregateVersion: 1,
        payloadJson: JSON.stringify({ outboxId: current.id, eventId: current.eventId, action, previousStatus: current.status, nextStatus: transition.nextStatus, attempts: transition.nextAttempts, detail }),
        correlationId: crypto.randomUUID(),
        causationId: current.eventId,
        idempotencyKey,
        status: "COMMITTED_SITES_READBACK",
        createdAt: now,
      }),
      db.insert(s06Reconciliations).values({
        id: crypto.randomUUID(),
        tenantId: context!.tenantId,
        aggregateType: "s06.outbox",
        aggregateId: current.id,
        expectedVersion: current.attempts,
        observedVersion: transition.nextAttempts,
        status: transition.nextStatus === "DEAD_LETTERED" ? "DLQ_RECORDED" : "OUTBOX_STATE_READBACK",
        detail,
        createdAt: now,
        updatedAt: now,
      }),
    ]);

    const [updated] = await db.select().from(s06Outbox).where(and(
      eq(s06Outbox.tenantId, context!.tenantId),
      eq(s06Outbox.id, current.id),
    )).limit(1);
    if (!updated) return Response.json({ error: "outbox_readback_unavailable" }, { status: 503 });
    const snapshot = await getS06Snapshot(context!.tenantId);
    return Response.json({
      ...s06Envelope(context!, snapshot),
      action: { id: actionId, outbox: outboxForResponse(updated), action, detail },
      idempotent: false,
    }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof OutboxTransitionError) return Response.json({ error: error.code }, { status: 409 });
    return Response.json({ error: s06Error(error) }, { status: 503 });
  }
}

function eventForOutboxAction(row: typeof s06Events.$inferSelect) {
  try {
    const payload = JSON.parse(row.payloadJson) as Record<string, unknown>;
    return { id: row.aggregateId, action: payload.action ?? "unknown", outboxId: payload.outboxId ?? null, detail: payload.detail ?? "", idempotent: true };
  } catch {
    return { id: row.aggregateId, action: "unknown", outboxId: null, detail: "", idempotent: true };
  }
}
