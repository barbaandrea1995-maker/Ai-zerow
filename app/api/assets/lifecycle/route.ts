import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { jobJourneyRecords, s04Records, s06Events, s06Outbox, s06Reconciliations } from "@/db/schema";
import { getAuthorityContext, hasCapability, publicAuthorityContext } from "@/lib/authority-context";
import { recordForResponse } from "@/lib/s04-adapter";
import { canReadAllAssets, parseScopePayload, rowMatchesContext } from "@/lib/operational-scope";

export const dynamic = "force-dynamic";

type JsonObject = Record<string, unknown>;
type AssetLifecycleStatus = "AVAILABLE" | "MAINTENANCE" | "BLOCKED";

const ACTIONS = {
  maintenance_open: { next: "MAINTENANCE" as AssetLifecycleStatus, allowed: ["AVAILABLE"] },
  maintenance_close: { next: "AVAILABLE" as AssetLifecycleStatus, allowed: ["MAINTENANCE"] },
  block: { next: "BLOCKED" as AssetLifecycleStatus, allowed: ["AVAILABLE", "MAINTENANCE"] },
  release: { next: "AVAILABLE" as AssetLifecycleStatus, allowed: ["BLOCKED"] },
} as const;

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function bounded(value: unknown, max: number, fallback = "") {
  return typeof value === "string" ? value.trim().slice(0, max) : fallback;
}

function parseJson(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function readJson(request: Request) {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 32_768) return { error: "payload_too_large" as const };
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? { value: parsed } : { error: "invalid_json" as const };
  } catch {
    return { error: "invalid_json" as const };
  }
}

async function findAsset(tenantId: string, reference: string) {
  const base = and(eq(s04Records.tenantId, tenantId), eq(s04Records.module, "assets"));
  const [byId] = await getDb().select().from(s04Records).where(and(base, eq(s04Records.id, reference))).limit(1);
  if (byId) return byId;
  const [byCode] = await getDb().select().from(s04Records).where(and(base, eq(s04Records.canonicalCode, reference))).limit(1);
  return byCode ?? null;
}

export async function GET(request: Request) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "asset.read")) return Response.json({ error: "forbidden", capability: "asset.read" }, { status: 403 });
  const assetId = bounded(new URL(request.url).searchParams.get("assetId"), 160);
  try {
    const db = getDb();
    const rows = assetId
      ? [await findAsset(context.tenantId, assetId)].filter((row): row is NonNullable<typeof row> => Boolean(row))
      : await db.select().from(s04Records).where(and(eq(s04Records.tenantId, context.tenantId), eq(s04Records.module, "assets"))).orderBy(desc(s04Records.updatedAt)).limit(500);
    const assignments = canReadAllAssets(context)
      ? []
      : await db.select().from(jobJourneyRecords).where(and(
        eq(jobJourneyRecords.tenantId, context.tenantId),
        eq(jobJourneyRecords.domain, "assets"),
        eq(jobJourneyRecords.recordType, "ASSET_ASSIGNMENT"),
      )).limit(1_000);
    const assignedAssetIds = new Set(assignments.filter((row) => rowMatchesContext(row, context)).flatMap((row) => {
      const payload = parseScopePayload(row.payloadJson);
      return [row.jobId, typeof payload.assetId === "string" ? payload.assetId : ""].filter(Boolean);
    }));
    const visibleRows = canReadAllAssets(context)
      ? rows
      : rows.filter((row) => rowMatchesContext(row, context) || assignedAssetIds.has(row.id) || (row.canonicalCode ? assignedAssetIds.has(row.canonicalCode) : false));
    const assets = visibleRows.filter((row) => row.module === "assets").map((row) => {
      const payload = parseJson(row.payloadJson);
      return { ...recordForResponse(row), lifecycle: { status: bounded(payload.lifecycleStatus, 24, "AVAILABLE"), maintenance: isRecord(payload.maintenance) ? payload.maintenance : null } };
    });
    return Response.json({ context: publicAuthorityContext(context), assets, readback: { status: "verified", scope: "tenant", checkedAt: new Date().toISOString() } }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return Response.json({ error: "asset_lifecycle_readback_unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "asset.write")) return Response.json({ error: "forbidden", capability: "asset.write" }, { status: 403 });
  const parsed = await readJson(request);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: parsed.error === "payload_too_large" ? 413 : 400 });
  const input = parsed.value;
  const action = bounded(input.action, 32).toLowerCase() as keyof typeof ACTIONS;
  if (!(action in ACTIONS)) return Response.json({ error: "unsupported_asset_lifecycle_action", allowed: Object.keys(ACTIONS) }, { status: 400 });
  const assetId = bounded(input.assetId, 160);
  const idempotencyKey = bounded(input.idempotencyKey, 160);
  if (!assetId) return Response.json({ error: "asset_id_required" }, { status: 400 });
  if (idempotencyKey.length < 8) return Response.json({ error: "idempotency_key_required" }, { status: 400 });

  try {
    const db = getDb();
    const asset = await findAsset(context.tenantId, assetId);
    if (!asset) return Response.json({ error: "asset_not_found" }, { status: 404 });
    if (!canReadAllAssets(context) && !rowMatchesContext(asset, context)) {
      const assignments = await db.select().from(jobJourneyRecords).where(and(
        eq(jobJourneyRecords.tenantId, context.tenantId),
        eq(jobJourneyRecords.domain, "assets"),
        eq(jobJourneyRecords.recordType, "ASSET_ASSIGNMENT"),
        eq(jobJourneyRecords.jobId, asset.id),
      )).limit(1_000);
      if (!assignments.some((row) => rowMatchesContext(row, context))) return Response.json({ error: "asset_scope_forbidden" }, { status: 403 });
    }
    const [existingEvent] = await db.select().from(s06Events).where(and(eq(s06Events.tenantId, context.tenantId), eq(s06Events.idempotencyKey, idempotencyKey))).limit(1);
    if (existingEvent) {
      const existing = await findAsset(context.tenantId, asset.id);
      return existing
        ? Response.json({ asset: recordForResponse(existing), idempotent: true, eventId: existingEvent.eventId }, { headers: { "cache-control": "private, no-store" } })
        : Response.json({ error: "asset_idempotency_readback_unavailable" }, { status: 503 });
    }
    const currentPayload = parseJson(asset.payloadJson);
    const currentStatus = bounded(currentPayload.lifecycleStatus, 24, "AVAILABLE") as AssetLifecycleStatus;
    const allowedStatuses = ACTIONS[action].allowed as readonly AssetLifecycleStatus[];
    if (!allowedStatuses.includes(currentStatus)) return Response.json({ error: "invalid_asset_lifecycle_transition", from: currentStatus, action }, { status: 409 });
    const now = new Date().toISOString();
    const transition = {
      action,
      at: bounded(input.at, 40, now),
      by: context.actorId,
      note: bounded(input.note, 2_000),
      reason: bounded(input.reason, 240),
    };
    if (!Number.isFinite(Date.parse(transition.at))) return Response.json({ error: "valid_transition_timestamp_required" }, { status: 400 });
    const history = Array.isArray(currentPayload.lifecycleHistory) ? currentPayload.lifecycleHistory.filter(isRecord).slice(-49) : [];
    const currentLifecycleVersion = typeof currentPayload.lifecycleVersion === "number" && Number.isInteger(currentPayload.lifecycleVersion)
      ? currentPayload.lifecycleVersion
      : history.length;
    const nextAggregateVersion = currentLifecycleVersion + 1;
    const nextPayload = {
      ...currentPayload,
      lifecycleStatus: ACTIONS[action].next,
      lifecycleVersion: nextAggregateVersion,
      lifecycleHistory: [...history, transition],
      maintenance: action === "maintenance_open"
        ? { status: "OPEN", openedAt: transition.at, openedBy: context.actorId, reason: transition.reason || transition.note }
        : action === "maintenance_close"
          ? { status: "CLOSED", closedAt: transition.at, closedBy: context.actorId, note: transition.note }
          : currentPayload.maintenance ?? null,
      availabilityGuard: ACTIONS[action].next === "AVAILABLE" ? "ASSIGNABLE" : "NOT_ASSIGNABLE",
    } satisfies JsonObject;
    const updatedRows = await db.update(s04Records).set({ status: ACTIONS[action].next, payloadJson: JSON.stringify(nextPayload), updatedAt: now }).where(and(
      eq(s04Records.id, asset.id),
      eq(s04Records.tenantId, context.tenantId),
      eq(s04Records.updatedAt, asset.updatedAt),
    )).returning();
    if (!updatedRows[0]) return Response.json({ error: "version_conflict" }, { status: 409 });
    const eventId = crypto.randomUUID();
    await db.batch([
      db.insert(s06Events).values({ eventId, tenantId: context.tenantId, eventType: `asset.lifecycle.${action}`, schemaVersion: "1", actorType: "human", actorId: context.actorId, source: "sites-asset-lifecycle", occurredAt: transition.at, observedAt: now, aggregateType: "asset", aggregateId: asset.id, aggregateVersion: nextAggregateVersion, payloadJson: JSON.stringify({ ...transition, status: ACTIONS[action].next }), correlationId: crypto.randomUUID(), causationId: null, idempotencyKey, status: "COMMITTED_SITES_READBACK", createdAt: now }),
      db.insert(s06Outbox).values({ id: crypto.randomUUID(), tenantId: context.tenantId, eventId, topic: `zerow.asset.lifecycle.${action}`, status: "PENDING_EXTERNAL_CONSUMER", attempts: 0, createdAt: now, updatedAt: now }),
      db.insert(s06Reconciliations).values({ id: crypto.randomUUID(), tenantId: context.tenantId, aggregateType: "asset", aggregateId: asset.id, expectedVersion: nextAggregateVersion, observedVersion: nextAggregateVersion, status: "SITES_READBACK_VERIFIED", detail: "Asset lifecycle aggiornato con guard di assegnabilità.", createdAt: now, updatedAt: now }),
    ]);
    return Response.json({ asset: recordForResponse(updatedRows[0]), lifecycle: { status: ACTIONS[action].next, assignable: ACTIONS[action].next === "AVAILABLE" }, eventId, idempotent: false, readback: "verified" }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/unique|constraint/i.test(message)) return Response.json({ error: "asset_lifecycle_idempotency_or_version_conflict" }, { status: 409 });
    return Response.json({ error: "asset_lifecycle_write_unavailable" }, { status: 503 });
  }
}
