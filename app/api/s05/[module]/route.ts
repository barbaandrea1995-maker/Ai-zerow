import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { s05Records, s06Events, s06Outbox, s06Reconciliations } from "@/db/schema";
import {
  getS05Context,
  getS05ReadModel,
  isS05Module,
  recordForResponse,
  s05AccessDenied,
  s05Envelope,
  s05Error,
  type S05Module,
} from "@/lib/s05-adapter";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ module: string }> };
const VALID_TONES = new Set(["lime", "cyan", "amber", "red"]);

async function resolveModule(context: RouteContext): Promise<S05Module | null> {
  const { module } = await context.params;
  return isS05Module(module) ? module : null;
}

function invalidModuleResponse() {
  return Response.json({ error: "unknown_s05_module" }, { status: 404 });
}

export async function GET(_request: Request, routeContext: RouteContext) {
  const moduleKey = await resolveModule(routeContext);
  if (!moduleKey) return invalidModuleResponse();
  const context = await getS05Context();
  const denied = s05AccessDenied(context, moduleKey, "read");
  if (denied) return denied;

  try {
    const rows = await getS05ReadModel(moduleKey, context!.tenantId);
    return Response.json(s05Envelope(context!, moduleKey, rows.map(recordForResponse)), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return Response.json({ error: s05Error(error), module: moduleKey }, { status: 503 });
  }
}

export async function POST(request: Request, routeContext: RouteContext) {
  const moduleKey = await resolveModule(routeContext);
  if (!moduleKey) return invalidModuleResponse();
  const context = await getS05Context();
  const denied = s05AccessDenied(context, moduleKey, "write");
  if (denied) return denied;

  let payload: Record<string, unknown>;
  try {
    const parsed = (await request.json()) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return Response.json({ error: "invalid_json" }, { status: 400 });
    }
    payload = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  const detail = typeof payload.detail === "string" ? payload.detail.trim() : "";
  const meta = typeof payload.meta === "string" ? payload.meta.trim() : "Sites proposal";
  const status = typeof payload.status === "string" ? payload.status.trim().slice(0, 64) : "DRAFT";
  const recordType = typeof payload.recordType === "string" && payload.recordType.trim()
    ? payload.recordType.trim().slice(0, 48)
    : moduleKey === "governance" ? "workflow-proposal" : "proposal";
  const tone = typeof payload.tone === "string" && VALID_TONES.has(payload.tone) ? payload.tone : "lime";
  const progress = typeof payload.progress === "number" && Number.isFinite(payload.progress)
    ? Math.max(0, Math.min(100, Math.round(payload.progress)))
    : 0;
  const requestedIdempotencyKey = typeof payload.idempotencyKey === "string" ? payload.idempotencyKey.trim().slice(0, 160) : "";

  if (title.length < 2 || title.length > 120) {
    return Response.json({ error: "title_must_be_2_to_120_characters" }, { status: 400 });
  }
  if (detail.length > 300 || meta.length > 140 || status.length > 64) {
    return Response.json({ error: "field_length_exceeded" }, { status: 400 });
  }
  if (typeof payload.idempotencyKey === "string" && payload.idempotencyKey.trim().length > 160) {
    return Response.json({ error: "idempotency_key_too_long" }, { status: 400 });
  }

  try {
    const now = new Date().toISOString();
    const idempotencyKey = requestedIdempotencyKey || `s05:${moduleKey}:${crypto.randomUUID()}`;
    const db = getDb();
    const existingEvent = await db.select().from(s06Events).where(and(
      eq(s06Events.tenantId, context!.tenantId),
      eq(s06Events.idempotencyKey, idempotencyKey),
    )).limit(1);
    if (existingEvent[0]) {
      if (existingEvent[0].aggregateType !== `s05.${moduleKey}`) {
        return Response.json({ error: "s05_idempotency_key_conflict" }, { status: 409 });
      }
      const [existingRecord] = await db.select().from(s05Records).where(and(
        eq(s05Records.tenantId, context!.tenantId),
        eq(s05Records.id, existingEvent[0].aggregateId),
      )).limit(1);
      if (!existingRecord) return Response.json({ error: "s05_idempotency_readback_unavailable" }, { status: 503 });
      const rows = await getS05ReadModel(moduleKey, context!.tenantId);
      return Response.json({
        ...s05Envelope(context!, moduleKey, rows.map(recordForResponse)),
        created: recordForResponse(existingRecord),
        idempotent: true,
      }, { headers: { "cache-control": "no-store" } });
    }
    const id = `${moduleKey.toUpperCase()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const eventId = crypto.randomUUID();
    const aggregateType = `s05.${moduleKey}`;
    const safePayload = { ...payload, idempotencyKey, source: "sites-s05-adapter", createdAt: now };
    const serialized = JSON.stringify(safePayload);
    if (serialized.length > 12_000) return Response.json({ error: "payload_too_large" }, { status: 400 });

    await db.batch([
      db.insert(s05Records).values({
        id,
        tenantId: context!.tenantId,
        module: moduleKey,
        recordType,
        title,
        detail,
        meta,
        status,
        tone,
        progress,
        payloadJson: serialized,
        createdBy: context!.actorId,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(s06Events).values({
        eventId,
        tenantId: context!.tenantId,
        eventType: `${moduleKey}.proposal.created`,
        schemaVersion: "1",
        actorType: "human",
        actorId: context!.actorId,
        source: "sites-command",
        occurredAt: now,
        observedAt: now,
        aggregateType,
        aggregateId: id,
        aggregateVersion: 1,
        payloadJson: JSON.stringify({ module: moduleKey, recordType, source: "sites-s05-adapter" }),
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
        topic: `zerow.${moduleKey}.proposal.created`,
        status: "PENDING_EXTERNAL_CONSUMER",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(s06Reconciliations).values({
        id: crypto.randomUUID(),
        tenantId: context!.tenantId,
        aggregateType,
        aggregateId: id,
        expectedVersion: 1,
        observedVersion: 1,
        status: "SITES_READBACK_VERIFIED",
        detail: "Proposta S05, evento e reconciliation persistiti nello stesso commit D1; dominio canonico esterno differito.",
        createdAt: now,
        updatedAt: now,
      }),
    ]);

    const [row] = await db.select().from(s05Records).where(and(
      eq(s05Records.tenantId, context!.tenantId),
      eq(s05Records.id, id),
    )).limit(1);
    if (!row) return Response.json({ error: "s05_readback_unavailable" }, { status: 503 });
    const rows = await getS05ReadModel(moduleKey, context!.tenantId);
    return Response.json({ ...s05Envelope(context!, moduleKey, rows.map(recordForResponse)), created: recordForResponse(row), idempotent: false }, {
      status: 201,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE") || message.includes("unique")) {
      return Response.json({ error: "s05_idempotency_or_version_conflict" }, { status: 409 });
    }
    return Response.json({ error: s05Error(error), module: moduleKey }, { status: 503 });
  }
}
