import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { s06Events, s06Outbox, s06Reconciliations } from "@/db/schema";
import {
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
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });

  let payload: Record<string, unknown>;
  try {
    const parsed = (await request.json()) as unknown;
    if (!isRecord(parsed)) return Response.json({ error: "invalid_json" }, { status: 400 });
    payload = parsed;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const eventType = safeText(payload.eventType).slice(0, 80);
  const bodyIdempotencyKey = safeText(payload.idempotencyKey);
  const headerIdempotencyKey = safeText(request.headers.get("x-idempotency-key"));
  if (bodyIdempotencyKey && headerIdempotencyKey && bodyIdempotencyKey !== headerIdempotencyKey) {
    return Response.json({ error: "idempotency_key_mismatch" }, { status: 400 });
  }
  const rawIdempotencyKey = bodyIdempotencyKey || headerIdempotencyKey;
  const idempotencyKey = rawIdempotencyKey.slice(0, 160);
  const isPwaDiagnosticSignal = eventType === "pwa.diagnostics.signal";
  const isAuditNote = eventType === "command.audit.note";
  if (!isPwaDiagnosticSignal && !isAuditNote) {
    return Response.json({ error: "unsupported_manual_event_type" }, { status: 400 });
  }
  const denied = s06AccessDenied(context, isPwaDiagnosticSignal ? "diagnostic" : "write");
  if (denied) return denied;
  if (isPwaDiagnosticSignal && rawIdempotencyKey.length > 80) {
    return Response.json({ error: "pwa_idempotency_key_too_long" }, { status: 400 });
  }
  if (isAuditNote && rawIdempotencyKey.length > 115) {
    return Response.json({ error: "audit_note_idempotency_key_too_long" }, { status: 400 });
  }
  // Only the two bounded event types below can enter through this API. Their
  // identities are server-owned so a caller cannot impersonate a canonical
  // attendance, warehouse, mission or other business aggregate.
  const submittedPayload = isRecord(payload.payload) ? payload.payload : {};
  let eventPayload: Record<string, unknown>;
  if (isPwaDiagnosticSignal) {
    eventPayload = { signal: "pwa-mobile-control", build: safeText(submittedPayload.build, "unknown").slice(0, 120) };
  } else {
    const note = safeText(submittedPayload.note);
    const reference = safeText(submittedPayload.reference);
    if (!note) return Response.json({ error: "audit_note_required" }, { status: 400 });
    if (note.length > 2_000) return Response.json({ error: "audit_note_too_long" }, { status: 400 });
    if (reference.length > 120) return Response.json({ error: "audit_reference_too_long" }, { status: 400 });
    eventPayload = { note, ...(reference ? { reference } : {}) };
  }
  const eventSource = isPwaDiagnosticSignal ? "sites-pwa-diagnostics" : "sites-command-audit";
  // Keep this payload marker stable so queued PWA keys from earlier builds replay cleanly.
  const serializedPayload = JSON.stringify({ ...eventPayload, source: "sites-s06-adapter" });
  const aggregateType = isPwaDiagnosticSignal ? "pwa_diagnostics" : "command_audit_note";
  const aggregateId = isPwaDiagnosticSignal ? `signal:${idempotencyKey}` : `note:${idempotencyKey}`;
  const aggregateVersion = 1;

  if (idempotencyKey.length < 4) {
    return Response.json({ error: "idempotency_key_required" }, { status: 400 });
  }
  if (rawIdempotencyKey.length > 160) {
    return Response.json({ error: "idempotency_key_too_long" }, { status: 400 });
  }
  if (serializedPayload.length > 12_000) return Response.json({ error: "payload_too_large" }, { status: 400 });

  const now = new Date().toISOString();
  const eventId = crypto.randomUUID();
  const correlationId = `${isPwaDiagnosticSignal ? "pwa" : "audit"}:${idempotencyKey}`;

  try {
    const db = getDb();
    const existing = await db.select().from(s06Events).where(and(
      eq(s06Events.tenantId, context!.tenantId),
      eq(s06Events.idempotencyKey, idempotencyKey),
    )).limit(1);
    if (existing[0]) {
      if (existing[0].eventType !== eventType || existing[0].aggregateType !== aggregateType || existing[0].aggregateId !== aggregateId || existing[0].aggregateVersion !== aggregateVersion || existing[0].payloadJson !== serializedPayload) {
        return Response.json({ error: "s06_idempotency_key_conflict" }, { status: 409 });
      }
      return Response.json({
        created: { eventId: existing[0].eventId, eventType: existing[0].eventType, status: existing[0].status },
        readback: { status: "ok", checkedAt: existing[0].createdAt },
        idempotent: true,
      }, { headers: { "cache-control": "no-store" } });
    }

    const eventValues = {
      eventId,
      tenantId: context!.tenantId,
      eventType,
      schemaVersion: "1",
      actorType: "human",
      actorId: context!.actorId,
      source: eventSource,
      occurredAt: now,
      observedAt: now,
      aggregateType,
      aggregateId,
      aggregateVersion,
      payloadJson: serializedPayload,
      correlationId,
      causationId: null,
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

    return Response.json({
      created: { eventId: event.eventId, eventType: event.eventType, status: event.status },
      readback: { status: "ok", checkedAt: event.createdAt },
      idempotent: false,
    }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = s06Error(error);
    if (message === "s06_duplicate_event") {
      return Response.json({ error: message, detail: "idempotency_key_or_aggregate_version_already_used" }, { status: 409 });
    }
    return Response.json({ error: message }, { status: 503 });
  }
}
