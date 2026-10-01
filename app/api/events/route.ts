import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { s06Events, s06Outbox, s06Reconciliations } from "@/db/schema";
import {
  eventForResponse,
  getS06Context,
  getS06Snapshot,
  s06AccessDenied,
  s06Envelope,
  s06Error,
} from "@/lib/s06-adapter";

export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function safeText(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

export async function GET() {
  const context = await getS06Context();
  const denied = s06AccessDenied(context, "read");
  if (denied) return denied;
  try {
    return Response.json(s06Envelope(context!, await getS06Snapshot(context!.tenantId)), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return Response.json({ error: s06Error(error) }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const context = await getS06Context();
  const denied = s06AccessDenied(context, "write");
  if (denied) return denied;

  let payload: Record<string, unknown>;
  try {
    const parsed = (await request.json()) as unknown;
    if (!isRecord(parsed)) return Response.json({ error: "invalid_json" }, { status: 400 });
    payload = parsed;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const eventType = safeText(payload.eventType).slice(0, 80);
  const aggregateType = safeText(payload.aggregateType).slice(0, 80);
  const aggregateId = safeText(payload.aggregateId).slice(0, 120);
  const idempotencyKey = safeText(payload.idempotencyKey).slice(0, 160);
  const aggregateVersion = typeof payload.aggregateVersion === "number" && Number.isInteger(payload.aggregateVersion)
    ? payload.aggregateVersion
    : 0;
  const eventPayload = isRecord(payload.payload) ? payload.payload : {};
  const serializedPayload = JSON.stringify({ ...eventPayload, source: "sites-s06-adapter" });

  if (eventType.length < 2 || aggregateType.length < 2 || aggregateId.length < 1 || idempotencyKey.length < 4 || aggregateVersion < 1) {
    return Response.json({ error: "event_type_aggregate_and_positive_version_required" }, { status: 400 });
  }
  if (typeof payload.idempotencyKey === "string" && payload.idempotencyKey.trim().length > 160) {
    return Response.json({ error: "idempotency_key_too_long" }, { status: 400 });
  }
  if (serializedPayload.length > 12_000) return Response.json({ error: "payload_too_large" }, { status: 400 });

  const now = new Date().toISOString();
  const eventId = crypto.randomUUID();
  const correlationId = safeText(payload.correlationId).slice(0, 120) || crypto.randomUUID();

  try {
    const db = getDb();
    const existing = await db.select().from(s06Events).where(and(
      eq(s06Events.tenantId, context!.tenantId),
      eq(s06Events.idempotencyKey, idempotencyKey),
    )).limit(1);
    if (existing[0]) {
      if (existing[0].eventType !== eventType || existing[0].aggregateType !== aggregateType || existing[0].aggregateId !== aggregateId || existing[0].aggregateVersion !== aggregateVersion) {
        return Response.json({ error: "s06_idempotency_key_conflict" }, { status: 409 });
      }
      const snapshot = await getS06Snapshot(context!.tenantId);
      return Response.json({ ...s06Envelope(context!, snapshot), created: eventForResponse(existing[0]), idempotent: true }, {
        headers: { "cache-control": "no-store" },
      });
    }

    const eventValues = {
      eventId,
      tenantId: context!.tenantId,
      eventType,
      schemaVersion: "1",
      actorType: "human",
      actorId: context!.actorId,
      source: "sites-command",
      occurredAt: now,
      observedAt: now,
      aggregateType,
      aggregateId,
      aggregateVersion,
      payloadJson: serializedPayload,
      correlationId,
      causationId: safeText(payload.causationId).slice(0, 120) || null,
      idempotencyKey,
      status: "COMMITTED_SITES_READBACK",
      createdAt: now,
    };

    // Event, outbox and reconciliation are one durable commit. A successful
    // event without its delivery/reconciliation records would create a false
    // S06 readback and leave the aggregate in an unrecoverable half-state.
    await db.batch([
      db.insert(s06Events).values(eventValues),
      db.insert(s06Outbox).values({
        id: crypto.randomUUID(),
        tenantId: context!.tenantId,
        eventId,
        topic: `zerow.${eventType}`,
        status: "PENDING_EXTERNAL_CONSUMER",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(s06Reconciliations).values({
        id: crypto.randomUUID(),
        tenantId: context!.tenantId,
        aggregateType,
        aggregateId,
        expectedVersion: aggregateVersion,
        observedVersion: aggregateVersion,
        status: "SITES_READBACK_VERIFIED",
        detail: "Evento presente nel D1 Sites; consumer canonico esterno ancora differito.",
        createdAt: now,
        updatedAt: now,
      }),
    ]);

    const [event] = await db.select().from(s06Events).where(and(
      eq(s06Events.tenantId, context!.tenantId),
      eq(s06Events.eventId, eventId),
    )).limit(1);
    if (!event) throw new Error("s06_event_readback_missing");

    const snapshot = await getS06Snapshot(context!.tenantId);
    return Response.json({ ...s06Envelope(context!, snapshot), created: eventForResponse(event), idempotent: false }, {
      status: 201,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const message = s06Error(error);
    if (message === "s06_duplicate_event") {
      return Response.json({ error: message, detail: "idempotency_key_or_aggregate_version_already_used" }, { status: 409 });
    }
    return Response.json({ error: message }, { status: 503 });
  }
}
