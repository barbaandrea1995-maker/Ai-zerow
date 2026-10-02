import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { s06Events, s06Outbox, s06Reconciliations } from "@/db/schema";
import {
  getAuthorityContext,
  hasCapability,
  publicAuthorityContext,
  type AuthorityContext,
} from "@/lib/authority-context";

function canUseEventSurface(context: AuthorityContext, operation: "read" | "write") {
  return hasCapability(context, operation === "write" ? "events.write" : "events.read");
}

export function s06AccessDenied(context: AuthorityContext | null, operation: "read" | "write"): Response | null {
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!canUseEventSurface(context, operation)) return Response.json({ error: "forbidden", operation }, { status: 403 });
  return null;
}

export function s06Error(error: unknown): string {
  const message = error instanceof Error ? error.message : "unexpected_error";
  if (message.includes("no such table") || /s06_(events|outbox|reconciliations)/.test(message)) {
    return "s06_adapter_store_unavailable";
  }
  if (message.includes("UNIQUE") || message.includes("unique")) return "s06_duplicate_event";
  return "s06_adapter_readback_failed";
}

function parsePayload(payloadJson: string) {
  try {
    const parsed = JSON.parse(payloadJson) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function eventForResponse(row: typeof s06Events.$inferSelect) {
  return {
    eventId: row.eventId,
    eventType: row.eventType,
    schemaVersion: row.schemaVersion,
    actorType: row.actorType,
    actorId: row.actorId,
    source: row.source,
    occurredAt: row.occurredAt,
    observedAt: row.observedAt,
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    aggregateVersion: row.aggregateVersion,
    payload: parsePayload(row.payloadJson),
    correlationId: row.correlationId,
    causationId: row.causationId,
    idempotencyKey: row.idempotencyKey,
    status: row.status,
    createdAt: row.createdAt,
  };
}

export function outboxForResponse(row: typeof s06Outbox.$inferSelect) {
  return {
    id: row.id,
    eventId: row.eventId,
    topic: row.topic,
    status: row.status,
    attempts: row.attempts,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function reconciliationForResponse(row: typeof s06Reconciliations.$inferSelect) {
  return {
    id: row.id,
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    expectedVersion: row.expectedVersion,
    observedVersion: row.observedVersion,
    status: row.status,
    detail: row.detail,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getS06Snapshot(tenantId: string) {
  const db = getDb();
  const [events, outbox, reconciliations] = await Promise.all([
    db.select().from(s06Events).where(eq(s06Events.tenantId, tenantId)).orderBy(desc(s06Events.createdAt)).limit(40),
    db.select().from(s06Outbox).where(eq(s06Outbox.tenantId, tenantId)).orderBy(desc(s06Outbox.updatedAt)).limit(40),
    db.select().from(s06Reconciliations).where(eq(s06Reconciliations.tenantId, tenantId)).orderBy(desc(s06Reconciliations.updatedAt)).limit(40),
  ]);
  return { events, outbox, reconciliations };
}

export async function getS06Context() {
  return getAuthorityContext();
}

export function s06Envelope(context: AuthorityContext, snapshot: Awaited<ReturnType<typeof getS06Snapshot>>) {
  return {
    context: publicAuthorityContext(context),
    contract: {
      tranche: "S06",
      source: "sites-d1-event-outbox-adapter",
      appendOnly: true,
      idempotency: "tenant-plus-idempotency-key",
      aggregateVersion: "unique-per-tenant-aggregate-version",
      externalConsumer: "deferred",
      readback: "sites-d1-verified",
    },
    events: snapshot.events.map(eventForResponse),
    outbox: snapshot.outbox.map(outboxForResponse),
    reconciliations: snapshot.reconciliations.map(reconciliationForResponse),
    readback: {
      status: "ok",
      counts: {
        events: snapshot.events.length,
        outbox: snapshot.outbox.length,
        reconciliations: snapshot.reconciliations.length,
      },
      checkedAt: new Date().toISOString(),
    },
  };
}
