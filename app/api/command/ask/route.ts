import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { s06Events, s06Outbox, s06Reconciliations, s07AiLedger } from "@/db/schema";
import {
  getS07Context,
  getS07Ledger,
  s07AccessDenied,
  s07Envelope,
  s07Error,
} from "@/lib/s07-adapter";

export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export async function POST(request: Request) {
  const context = await getS07Context();
  const denied = s07AccessDenied(context, "write");
  if (denied) return denied;

  let payload: Record<string, unknown>;
  try {
    const parsed = (await request.json()) as unknown;
    if (!isRecord(parsed)) return Response.json({ error: "invalid_json" }, { status: 400 });
    payload = parsed;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const command = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
  const requestedAction = typeof payload.actionType === "string" ? payload.actionType.trim().slice(0, 64) : "query";
  const actionType = requestedAction || "query";
  const approvalRequired = !["query", "read", "overview"].includes(actionType.toLowerCase());
  const requestedIdempotencyKey = typeof payload.idempotencyKey === "string" ? payload.idempotencyKey.trim().slice(0, 160) : "";
  if (command.length < 2 || command.length > 500) {
    return Response.json({ error: "prompt_must_be_2_to_500_characters" }, { status: 400 });
  }
  if (typeof payload.idempotencyKey === "string" && payload.idempotencyKey.trim().length > 160) {
    return Response.json({ error: "idempotency_key_too_long" }, { status: 400 });
  }

  try {
    const now = new Date().toISOString();
    const idempotencyKey = requestedIdempotencyKey || `s07:preview:${crypto.randomUUID()}`;
    const db = getDb();
    const existingEvent = await db.select().from(s06Events).where(and(
      eq(s06Events.tenantId, context!.tenantId),
      eq(s06Events.idempotencyKey, idempotencyKey),
    )).limit(1);
    if (existingEvent[0]) {
      if (existingEvent[0].aggregateType !== "s07.command.preview") {
        return Response.json({ error: "command_idempotency_key_conflict" }, { status: 409 });
      }
      const [existingRow] = await db.select().from(s07AiLedger).where(and(
        eq(s07AiLedger.tenantId, context!.tenantId),
        eq(s07AiLedger.id, existingEvent[0].aggregateId),
      )).limit(1);
      if (!existingRow) return Response.json({ error: "command_preview_readback_unavailable" }, { status: 503 });
      const rows = await getS07Ledger(context!.tenantId);
      return Response.json({
        ...s07Envelope(context!, rows),
        result: {
          actionId: existingRow.id,
          status: existingRow.status,
          approvalRequired: Boolean(existingRow.approvalRequired),
          directWrite: false,
          message: existingRow.approvalRequired
            ? "Preview già registrata. Serve una decisione di approvazione prima di qualsiasi adapter esterno."
            : "Preview già registrata. Nessuna scrittura è stata eseguita.",
        },
        idempotent: true,
      }, { headers: { "cache-control": "no-store" } });
    }

    const id = crypto.randomUUID();
    const eventId = crypto.randomUUID();
    const requestedPayload = payload.payload && isRecord(payload.payload) ? payload.payload : {};
    const ledgerPayload = {
        source: "sites-s07-adapter",
        directWrite: false,
        runtime: "external-openai-runtime-deferred",
        idempotencyKey,
        requestedPayload,
      };
    const serializedPayload = JSON.stringify(ledgerPayload);
    if (serializedPayload.length > 12_000) return Response.json({ error: "payload_too_large" }, { status: 400 });
    await db.batch([
      db.insert(s07AiLedger).values({
        id,
        tenantId: context!.tenantId,
        entryType: "command_preview",
        actionType,
        command,
        status: approvalRequired ? "PENDING_APPROVAL" : "PREVIEW_ONLY",
        approvalRequired: approvalRequired ? 1 : 0,
        payloadJson: serializedPayload,
        requestedBy: context!.actorId,
        readbackJson: JSON.stringify({ status: "SITES_LEDGER_VERIFIED", checkedAt: now }),
        createdAt: now,
      }),
      db.insert(s06Events).values({
        eventId,
        tenantId: context!.tenantId,
        eventType: "command.preview.created",
        schemaVersion: "1",
        actorType: "human",
        actorId: context!.actorId,
        source: "sites-command",
        occurredAt: now,
        observedAt: now,
        aggregateType: "s07.command.preview",
        aggregateId: id,
        aggregateVersion: 1,
        payloadJson: JSON.stringify({ actionType, approvalRequired, source: "sites-s07-adapter" }),
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
        topic: "zerow.command.preview.created",
        status: "PENDING_EXTERNAL_CONSUMER",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(s06Reconciliations).values({
        id: crypto.randomUUID(),
        tenantId: context!.tenantId,
        aggregateType: "s07.command.preview",
        aggregateId: id,
        expectedVersion: 1,
        observedVersion: 1,
        status: "SITES_READBACK_VERIFIED",
        detail: "Preview Company AI registrata nel ledger e nell'event boundary; runtime OpenAI esterno differito.",
        createdAt: now,
        updatedAt: now,
      }),
    ]);
    const [row] = await db.select().from(s07AiLedger).where(and(
      eq(s07AiLedger.tenantId, context!.tenantId),
      eq(s07AiLedger.id, id),
    )).limit(1);
    if (!row) return Response.json({ error: "command_preview_readback_unavailable" }, { status: 503 });
    const rows = await getS07Ledger(context!.tenantId);
    return Response.json({
      ...s07Envelope(context!, rows),
      result: {
        actionId: id,
        status: row.status,
        approvalRequired,
        directWrite: false,
        message: approvalRequired
          ? "Preview registrata. Serve una decisione di approvazione prima di qualsiasi adapter esterno."
        : "Preview registrata. Il runtime AI esterno non è collegato; nessuna scrittura è stata eseguita.",
      },
      idempotent: false,
    }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE") || message.includes("unique")) {
      return Response.json({ error: "command_idempotency_conflict" }, { status: 409 });
    }
    return Response.json({ error: s07Error(error) }, { status: 503 });
  }
}
