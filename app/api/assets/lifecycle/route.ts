import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { jobJourneyRecords, s04Records, s06Events, s06Outbox, s06Reconciliations } from "@/db/schema";
import { getAuthorityContext, hasCapability, publicAuthorityContext, type AuthorityContext } from "@/lib/authority-context";
import { recordForResponse } from "@/lib/s04-adapter";
import { canReadAllAssets, canReadAllMissions, parseScopePayload, rowMatchesContext } from "@/lib/operational-scope";

export const dynamic = "force-dynamic";

type JsonObject = Record<string, unknown>;
type AssetLifecycleStatus = "AVAILABLE" | "MAINTENANCE" | "BLOCKED";
type AssetMovementState = "RESERVED" | "IN_TRANSIT" | "AWAITING_RECEIPT" | "DELIVERED";
type AssetMovement = {
  state: AssetMovementState;
  missionId: string;
  missionTitle: string;
  plannedAt: string;
  driverName: string;
  vehicleName: string;
  location: string;
  receivedBy: string;
  updatedAt: string;
  operationalAssignee: JsonObject | null;
};

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

function cargoIds(payload: JsonObject) {
  const directIds = Array.isArray(payload.cargoAssetIds)
    ? payload.cargoAssetIds.filter((value): value is string => typeof value === "string")
    : [];
  const snapshot = isRecord(payload.resourceSnapshot) ? payload.resourceSnapshot : {};
  const snapshotIds = Array.isArray(snapshot.cargoAssets)
    ? snapshot.cargoAssets.flatMap((entry) => isRecord(entry) && typeof entry.id === "string" ? [entry.id] : [])
    : [];
  return [...new Set([...directIds, bounded(payload.cargoAssetId, 160), ...snapshotIds].filter(Boolean))];
}

function movementEvent(payload: JsonObject, assetId: string) {
  const timeline = Array.isArray(payload.operationalTimeline) ? payload.operationalTimeline : [];
  return [...timeline].reverse().find((entry) => {
    if (!isRecord(entry)) return false;
    const ids = Array.isArray(entry.assetIds) ? entry.assetIds : [];
    return entry.assetId === assetId || ids.includes(assetId);
  }) as JsonObject | undefined;
}

function missionMovement(row: typeof jobJourneyRecords.$inferSelect, payload: JsonObject, assetId: string): AssetMovement | null {
  if (row.status === "CANCELLED" || !cargoIds(payload).includes(assetId)) return null;
  const custodyMap = isRecord(payload.cargoCustody) ? payload.cargoCustody : {};
  const custody = isRecord(custodyMap[assetId]) ? custodyMap[assetId] as JsonObject : {};
  const event = movementEvent(payload, assetId) ?? {};
  const eventType = bounded(event.type, 40).toUpperCase();
  const proofEntries = Array.isArray(payload.proofOfDeliveries) ? payload.proofOfDeliveries : [];
  const proofMatchesAsset = (entry: unknown) => {
    if (!isRecord(entry)) return false;
    const ids = Array.isArray(entry.assetIds) ? entry.assetIds : [];
    return entry.assetId === assetId || ids.includes(assetId);
  };
  const proof = [...proofEntries].reverse().find(proofMatchesAsset);
  const legacyProof = proofMatchesAsset(payload.proofOfDelivery) ? payload.proofOfDelivery : null;
  const proofEntry = isRecord(proof) ? proof : isRecord(legacyProof) ? legacyProof : {};
  const custodyState = bounded(custody.state, 32).toUpperCase();
  const state: AssetMovementState | null = custodyState === "IN_TRANSIT" || eventType === "LOAD_CONFIRMED"
    ? "IN_TRANSIT"
    : custodyState === "AWAITING_RECEIPT" || eventType === "UNLOAD_CONFIRMED"
      ? "AWAITING_RECEIPT"
      : custodyState === "DELIVERED" || eventType === "DELIVERY_CONFIRMED" || (row.status !== "PLANNED" && (proofEntry.assetId === assetId || (Array.isArray(proofEntry.assetIds) && proofEntry.assetIds.includes(assetId))))
        ? "DELIVERED"
        : ["PLANNED", "DISPATCHED", "PARTIAL_DELIVERY"].includes(row.status)
          ? "RESERVED"
          : null;
  if (!state) return null;
  const snapshot = isRecord(payload.resourceSnapshot) ? payload.resourceSnapshot : {};
  const driver = isRecord(snapshot.driver) ? snapshot.driver : {};
  const vehicle = isRecord(snapshot.vehicle) ? snapshot.vehicle : {};
  const cargo = Array.isArray(snapshot.cargoAssets)
    ? snapshot.cargoAssets.find((entry) => isRecord(entry) && entry.id === assetId)
    : null;
  const cargoAssignee = isRecord(cargo) && isRecord(cargo.operationalAssignee)
    ? cargo.operationalAssignee
    : isRecord(custody.operationalAssignee) ? custody.operationalAssignee : null;
  return {
    state,
    missionId: row.id,
    missionTitle: row.title,
    plannedAt: bounded(payload.plannedAt, 40),
    driverName: bounded(custody.driverName, 160, bounded(driver.label, 160)),
    vehicleName: bounded(custody.vehicleName, 160, bounded(vehicle.label, 160)),
    location: bounded(custody.location, 240, bounded(event.destination, 240, bounded(event.location, 240, bounded(payload.dropoff, 240, bounded(payload.pickup, 240))))),
    receivedBy: bounded(custody.receivedBy, 160, bounded(proofEntry.recipient, 160)),
    updatedAt: bounded(custody.updatedAt, 40, bounded(event.recordedAt, 40, row.updatedAt)),
    operationalAssignee: cargoAssignee,
  };
}

function missionMovementVisibleToActor(
  row: typeof jobJourneyRecords.$inferSelect,
  payload: JsonObject,
  context: AuthorityContext,
) {
  if (rowMatchesContext(row, context)) return true;
  const snapshot = isRecord(payload.resourceSnapshot) ? payload.resourceSnapshot : {};
  const cargoSnapshots = Array.isArray(snapshot.cargoAssets) ? snapshot.cargoAssets : [];
  const assignees = [
    ...(Array.isArray(payload.cargoOperationalAssignees) ? payload.cargoOperationalAssignees : []),
    ...cargoSnapshots.flatMap((entry) => isRecord(entry) && isRecord(entry.operationalAssignee) ? [entry.operationalAssignee] : []),
  ];
  return assignees.some((value) => isRecord(value)
    && ((typeof value.actorId === "string" && value.actorId === context.actorId)
      || (typeof value.membershipId === "string" && value.membershipId === context.membershipId)));
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
    const canReadAllMissionMovement = canReadAllMissions(context);
    const missionRows = await db.select().from(jobJourneyRecords).where(and(
        eq(jobJourneyRecords.tenantId, context.tenantId),
        eq(jobJourneyRecords.domain, "mission"),
        eq(jobJourneyRecords.recordType, "TRANSPORT"),
      )).orderBy(desc(jobJourneyRecords.updatedAt)).limit(2_000);
    const physicalMovementByAsset = new Map<string, AssetMovement>();
    const reservedMovementByAsset = new Map<string, AssetMovement>();
    const deliveredMovementByAsset = new Map<string, AssetMovement>();
    for (const mission of missionRows) {
      const missionPayload = parseJson(mission.payloadJson);
      if (!canReadAllMissionMovement && !missionMovementVisibleToActor(mission, missionPayload, context)) continue;
      for (const cargoId of cargoIds(missionPayload)) {
        const movement = missionMovement(mission, missionPayload, cargoId);
        if (!movement) continue;
        if (movement.state === "DELIVERED") {
          if (!deliveredMovementByAsset.has(cargoId)) deliveredMovementByAsset.set(cargoId, movement);
        } else if (movement.state === "RESERVED") {
          if (!reservedMovementByAsset.has(cargoId)) reservedMovementByAsset.set(cargoId, movement);
        } else if (!physicalMovementByAsset.has(cargoId)) {
          physicalMovementByAsset.set(cargoId, movement);
        }
      }
    }
    const movementByAsset = new Map([...deliveredMovementByAsset, ...reservedMovementByAsset, ...physicalMovementByAsset]);
    const assets = visibleRows.filter((row) => row.module === "assets").map((row) => {
      const payload = parseJson(row.payloadJson);
      return {
        ...recordForResponse(row),
        lifecycle: { status: bounded(payload.lifecycleStatus, 24, "AVAILABLE"), maintenance: isRecord(payload.maintenance) ? payload.maintenance : null },
        ...(movementByAsset.has(row.id) || (row.canonicalCode && movementByAsset.has(row.canonicalCode))
          ? { movement: movementByAsset.get(row.id) ?? (row.canonicalCode ? movementByAsset.get(row.canonicalCode) : undefined) }
          : {}),
      };
    });
    return Response.json({ context: publicAuthorityContext(context), assets, readback: { status: "verified", scope: "tenant", missionMovement: canReadAllMissionMovement ? "tenant" : "actor_scope", checkedAt: new Date().toISOString() } }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return Response.json({ error: "asset_lifecycle_readback_unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "asset.write") && !hasCapability(context, "asset.lifecycle.write")) {
    return Response.json({ error: "forbidden", capability: "asset.lifecycle.write" }, { status: 403 });
  }
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
      at: now,
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
