import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { s04Records, s06Events, s06Outbox, s06Reconciliations } from "@/db/schema";
import {
  adapterError,
  assertS04Tenant,
  getS04Context,
  getS04ReadModel,
  isS04Module,
  recordForResponse,
  s04AccessDenied,
  s04Envelope,
  type S04Module,
} from "@/lib/s04-adapter";
import { allocateServerName, CanonicalCodeConflictError } from "@/lib/server-naming";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ module: string }> };

const VALID_TONES = new Set(["lime", "cyan", "amber", "red"]);

function invalidModuleResponse() {
  return Response.json({ error: "unknown_s04_module" }, { status: 404 });
}

async function resolveModule(context: RouteContext): Promise<S04Module | null> {
  const { module } = await context.params;
  return isS04Module(module) ? module : null;
}

export async function GET(_request: Request, routeContext: RouteContext) {
  const moduleKey = await resolveModule(routeContext);
  if (!moduleKey) return invalidModuleResponse();

  const context = await getS04Context();
  const denied = s04AccessDenied(context, moduleKey, "read");
  if (denied) return denied;

  try {
    const rows = await getS04ReadModel(moduleKey, context!.tenantId);
    return Response.json(s04Envelope(context!, moduleKey, rows.map(recordForResponse)), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return Response.json({ error: adapterError(error), module: moduleKey }, { status: 503 });
  }
}

export async function POST(request: Request, routeContext: RouteContext) {
  const moduleKey = await resolveModule(routeContext);
  if (!moduleKey) return invalidModuleResponse();

  const context = await getS04Context();
  const denied = s04AccessDenied(context, moduleKey, "write");
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
  const meta = typeof payload.meta === "string" ? payload.meta.trim() : "";
  const status = typeof payload.status === "string" ? payload.status.trim() : "READ MODEL";
  const entityType = typeof payload.entityType === "string" ? payload.entityType.trim().toLowerCase() : undefined;
  const rawBarcode = typeof payload.barcode === "string" ? payload.barcode.trim() : "";
  const barcode = rawBarcode.slice(0, 120);
  const tone = typeof payload.tone === "string" && VALID_TONES.has(payload.tone) ? payload.tone : "lime";
  const progress = typeof payload.progress === "number" && Number.isFinite(payload.progress)
    ? Math.max(0, Math.min(100, Math.round(payload.progress)))
    : 0;
  const recordType = typeof payload.recordType === "string" && payload.recordType.trim().length > 0
    ? payload.recordType.trim().slice(0, 48)
    : "read-model";
  const requestedIdempotencyKey = typeof payload.idempotencyKey === "string" ? payload.idempotencyKey.trim().slice(0, 160) : "";

  if (title.length < 2 || title.length > 120) {
    return Response.json({ error: "title_must_be_2_to_120_characters" }, { status: 400 });
  }
  if (detail.length > 240 || meta.length > 120 || status.length > 80) {
    return Response.json({ error: "field_length_exceeded" }, { status: 400 });
  }
  if (rawBarcode.length > 120) {
    return Response.json({ error: "barcode_too_long" }, { status: 400 });
  }
  if (typeof payload.idempotencyKey === "string" && payload.idempotencyKey.trim().length > 160) {
    return Response.json({ error: "idempotency_key_too_long" }, { status: 400 });
  }
  if (moduleKey === "assets" && entityType && !["asset", "vehicle", "equipment"].includes(entityType)) {
    return Response.json({ error: "unknown_asset_entity_type" }, { status: 400 });
  }

  try {
    assertS04Tenant(context!, context!.tenantId);
    const now = new Date().toISOString();
    const idempotencyKey = requestedIdempotencyKey || `s04:${moduleKey}:${crypto.randomUUID()}`;
    const db = getDb();
    const existingEvent = await db.select().from(s06Events).where(and(
      eq(s06Events.tenantId, context!.tenantId),
      eq(s06Events.idempotencyKey, idempotencyKey),
    )).limit(1);
    if (existingEvent[0]) {
      if (existingEvent[0].aggregateType !== `s04.${moduleKey}`) {
        return Response.json({ error: "s04_idempotency_key_conflict" }, { status: 409 });
      }
      const [existingRecord] = await db.select().from(s04Records).where(and(
        eq(s04Records.tenantId, context!.tenantId),
        eq(s04Records.id, existingEvent[0].aggregateId),
      )).limit(1);
      if (!existingRecord) return Response.json({ error: "s04_idempotency_readback_unavailable" }, { status: 503 });
      const records = await getS04ReadModel(moduleKey, context!.tenantId);
      return Response.json({
        ...s04Envelope(context!, moduleKey, records.map(recordForResponse)),
        created: recordForResponse(existingRecord),
        idempotent: true,
      }, { headers: { "cache-control": "no-store" } });
    }
    const naming = moduleKey === "operations" || moduleKey === "assets" || moduleKey === "warehouse"
      ? await allocateServerName({
        tenantId: context!.tenantId,
        module: moduleKey,
        entityType,
        description: title,
        barcode: barcode || undefined,
      })
      : null;
    const storedTitle = naming?.source === "server" ? naming.canonicalCode : title;
    const storedDetail = naming?.source === "server" && !detail ? title : detail;
    const id = `${moduleKey.toUpperCase()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const eventId = crypto.randomUUID();
    const aggregateType = `s04.${moduleKey}`;
    const serializedPayload = JSON.stringify({
      ...payload,
      title,
      entityType,
      barcode: barcode || undefined,
      idempotencyKey,
      naming,
      source: "sites-s04-adapter",
      createdAt: now,
    });
    if (serializedPayload.length > 12_000) return Response.json({ error: "payload_too_large" }, { status: 400 });

    await db.batch([
      db.insert(s04Records).values({
        id,
        tenantId: context!.tenantId,
        module: moduleKey,
        canonicalCode: naming?.canonicalCode ?? null,
        recordType,
        title: storedTitle,
        detail: storedDetail,
        meta,
        status,
        tone,
        progress,
        payloadJson: serializedPayload,
        createdBy: context!.actorId,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(s06Events).values({
        eventId,
        tenantId: context!.tenantId,
        eventType: `${moduleKey}.record.created`,
        schemaVersion: "1",
        actorType: "human",
        actorId: context!.actorId,
        source: "sites-command",
        occurredAt: now,
        observedAt: now,
        aggregateType,
        aggregateId: id,
        aggregateVersion: 1,
        payloadJson: JSON.stringify({ module: moduleKey, recordType, canonicalCode: naming?.canonicalCode ?? null, source: "sites-s04-adapter" }),
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
        topic: `zerow.${moduleKey}.record.created`,
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
        detail: "Record S04 e relativo evento persistiti nello stesso commit D1; adapter canonico esterno differito.",
        createdAt: now,
        updatedAt: now,
      }),
    ]);

    const [row] = await db.select().from(s04Records).where(and(
      eq(s04Records.tenantId, context!.tenantId),
      eq(s04Records.id, id),
    )).limit(1);
    if (!row) return Response.json({ error: "s04_readback_unavailable" }, { status: 503 });

    const records = await getS04ReadModel(moduleKey, context!.tenantId);
    return Response.json({
      ...s04Envelope(context!, moduleKey, records.map(recordForResponse)),
      created: recordForResponse(row),
      idempotent: false,
    }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof CanonicalCodeConflictError) {
      return Response.json({ error: error.code }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE") || message.includes("unique")) {
      return Response.json({ error: "s04_idempotency_or_version_conflict" }, { status: 409 });
    }
    return Response.json({ error: adapterError(error), module: moduleKey }, { status: 503 });
  }
}
