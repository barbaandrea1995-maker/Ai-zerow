import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { assetCustodyLocations, geoLocations, jobJourneyRecords, s04Records, s06Events, s06Outbox, s06Reconciliations, tenantWarehouses } from "@/db/schema";
import { getAuthorityContext, hasCapability } from "@/lib/authority-context";
import { canReadAllAssets, rowMatchesContext } from "@/lib/operational-scope";
import { recordForResponse } from "@/lib/s04-adapter";
import {
  isAssetUsageMode,
  isTransportCapability,
  normalizeTransportCapabilities,
  type AssetUsageMode,
  type TransportCapability,
} from "@/lib/asset-contract";

export const dynamic = "force-dynamic";

type JsonObject = Record<string, unknown>;

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function bounded(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function parseJson(value: string): JsonObject {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function requestBody(request: Request) {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 32_768) return { error: "payload_too_large" as const };
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? { value: parsed } : { error: "invalid_json" as const };
  } catch {
    return { error: "invalid_json" as const };
  }
}

async function assetForTenant(tenantId: string, id: string) {
  const [row] = await getDb().select().from(s04Records).where(and(
    eq(s04Records.tenantId, tenantId),
    eq(s04Records.module, "assets"),
    eq(s04Records.id, id),
  )).limit(1);
  return row ?? null;
}

async function assetInWriterScope(asset: NonNullable<Awaited<ReturnType<typeof assetForTenant>>>, context: NonNullable<Awaited<ReturnType<typeof getAuthorityContext>>>) {
  if (canReadAllAssets(context) || rowMatchesContext(asset, context)) return true;
  const assignments = await getDb().select().from(jobJourneyRecords).where(and(
    eq(jobJourneyRecords.tenantId, context.tenantId),
    eq(jobJourneyRecords.domain, "assets"),
    eq(jobJourneyRecords.recordType, "ASSET_ASSIGNMENT"),
    eq(jobJourneyRecords.jobId, asset.id),
  )).limit(1_000);
  return assignments.some((row) => rowMatchesContext(row, context));
}

export async function POST(request: Request) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "asset.write")) {
    return Response.json({ error: "forbidden", capability: "asset.write" }, { status: 403 });
  }

  const parsed = await requestBody(request);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: parsed.error === "payload_too_large" ? 413 : 400 });
  const input = parsed.value;
  const assetId = bounded(input.assetId, 160);
  const expectedUpdatedAt = bounded(input.expectedUpdatedAt, 40);
  const idempotencyKey = bounded(input.idempotencyKey, 160);
  const title = bounded(input.title, 120);
  const entityType = bounded(input.entityType, 24).toLowerCase();
  const usageMode = bounded(input.usageMode, 24).toUpperCase();
  const brand = bounded(input.brand, 80);
  const model = bounded(input.model, 100);
  const registration = bounded(input.registration, 40);
  const serialNumber = bounded(input.serialNumber, 120);
  const warehouseId = bounded(input.warehouseId, 160);
  const notes = bounded(input.notes, 2_000);
  const capacityValue = input.capacity === "" || input.capacity === null || input.capacity === undefined ? null : Number(input.capacity);
  const maxPayloadValue = input.maxPayloadKg === "" || input.maxPayloadKg === null || input.maxPayloadKg === undefined ? null : Number(input.maxPayloadKg);
  const weightValue = input.weightKg === "" || input.weightKg === null || input.weightKg === undefined ? null : Number(input.weightKg);
  const transportable = typeof input.transportable === "boolean" ? input.transportable : true;
  if (input.transportable !== undefined && typeof input.transportable !== "boolean") return Response.json({ error: "asset_transportable_flag_invalid" }, { status: 400 });
  if (input.pairedCargoAssetIds !== undefined && (!Array.isArray(input.pairedCargoAssetIds) || input.pairedCargoAssetIds.some((value) => typeof value !== "string"))) {
    return Response.json({ error: "asset_pair_list_invalid" }, { status: 400 });
  }
  const pairedCargoAssetIds = Array.isArray(input.pairedCargoAssetIds)
    ? [...new Set(input.pairedCargoAssetIds.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean))]
    : [];

  if (!assetId || !expectedUpdatedAt || !Number.isFinite(Date.parse(expectedUpdatedAt))) return Response.json({ error: "asset_and_version_required" }, { status: 400 });
  if (idempotencyKey.length < 8) return Response.json({ error: "idempotency_key_required" }, { status: 400 });
  if (title.length < 2) return Response.json({ error: "asset_title_required" }, { status: 400 });
  if (!("asset vehicle equipment".split(" ").includes(entityType))) return Response.json({ error: "unknown_asset_entity_type" }, { status: 400 });
  if (!isAssetUsageMode(usageMode)) return Response.json({ error: "unknown_asset_usage_mode" }, { status: 400 });
  if (entityType !== "vehicle" && usageMode !== "OPERATIONAL") return Response.json({ error: "non_vehicle_transport_usage_invalid" }, { status: 400 });
  if (capacityValue !== null && (!Number.isFinite(capacityValue) || capacityValue < 0 || capacityValue > 10_000_000)) return Response.json({ error: "asset_capacity_invalid" }, { status: 400 });
  if (maxPayloadValue !== null && (!Number.isFinite(maxPayloadValue) || maxPayloadValue <= 0 || maxPayloadValue > 100_000)) return Response.json({ error: "asset_payload_capacity_invalid" }, { status: 400 });
  if (weightValue !== null && (!Number.isFinite(weightValue) || weightValue <= 0 || weightValue > 1_000_000)) return Response.json({ error: "asset_weight_invalid" }, { status: 400 });
  if (pairedCargoAssetIds.length > 50) return Response.json({ error: "asset_pair_limit_exceeded" }, { status: 400 });
  if (entityType !== "vehicle" && pairedCargoAssetIds.length) return Response.json({ error: "vehicle_only_asset_pairing" }, { status: 400 });

  const requestedCapabilities = Array.isArray(input.transportCapabilities) ? input.transportCapabilities : [];
  if (requestedCapabilities.some((value) => !isTransportCapability(value))) return Response.json({ error: "unknown_asset_transport_capability" }, { status: 400 });
  if (usageMode !== "OPERATIONAL" && requestedCapabilities.length === 0) return Response.json({ error: "transport_capability_required" }, { status: 400 });
  const transportCapabilities = usageMode === "OPERATIONAL"
    ? []
    : normalizeTransportCapabilities(requestedCapabilities, usageMode as AssetUsageMode, entityType) as TransportCapability[];
  if (usageMode !== "OPERATIONAL" && transportCapabilities.length === 0) return Response.json({ error: "transport_capability_required" }, { status: 400 });

  try {
    const db = getDb();
    const asset = await assetForTenant(context.tenantId, assetId);
    if (!asset) return Response.json({ error: "asset_not_found" }, { status: 404 });
    if (!(await assetInWriterScope(asset, context))) return Response.json({ error: "asset_scope_forbidden" }, { status: 403 });

    const [warehouse] = warehouseId ? await db.select().from(tenantWarehouses).where(and(
      eq(tenantWarehouses.tenantId, context.tenantId),
      eq(tenantWarehouses.id, warehouseId),
      eq(tenantWarehouses.status, "active"),
    )).limit(1) : [];
    if (warehouseId && !warehouse) return Response.json({ error: "asset_warehouse_not_found" }, { status: 400 });
    const [warehouseLocation] = warehouse ? await db.select().from(geoLocations).where(and(
      eq(geoLocations.tenantId, context.tenantId),
      eq(geoLocations.entityType, "MAGAZZINO"),
      eq(geoLocations.entityId, warehouse.id),
      eq(geoLocations.status, "ACTIVE"),
    )).limit(1) : [];
    if (warehouse && !warehouseLocation) return Response.json({ error: "asset_warehouse_location_not_canonical" }, { status: 409 });

    const pairRows = pairedCargoAssetIds.length
      ? await db.select().from(s04Records).where(and(
        eq(s04Records.tenantId, context.tenantId),
        eq(s04Records.module, "assets"),
        inArray(s04Records.id, pairedCargoAssetIds),
      ))
      : [];
    if (pairRows.length !== pairedCargoAssetIds.length) return Response.json({ error: "paired_asset_not_found" }, { status: 400 });
    for (const pair of pairRows) {
      if (!(await assetInWriterScope(pair, context))) return Response.json({ error: "asset_scope_forbidden" }, { status: 403 });
      const pairPayload = parseJson(pair.payloadJson);
      const pairType = bounded(pairPayload.entityType || pairPayload.resourceKind || pairPayload.kind, 24).toUpperCase();
      const pairIsCargo = pairType === "ASSET" || pairType === "EQUIPMENT"
        || (!pairType && ["ASSET", "EQUIPMENT"].includes(pair.recordType.toUpperCase()));
      if (pair.id === asset.id || !pairIsCargo || pairPayload.transportable === false) {
        return Response.json({ error: "paired_asset_must_be_cargo" }, { status: 400 });
      }
    }

    const [existingEvent] = await db.select().from(s06Events).where(and(
      eq(s06Events.tenantId, context.tenantId),
      eq(s06Events.idempotencyKey, idempotencyKey),
    )).limit(1);
    if (existingEvent) {
      if (existingEvent.eventType !== "asset.profile.updated" || existingEvent.aggregateId !== asset.id) {
        return Response.json({ error: "asset_profile_idempotency_conflict" }, { status: 409 });
      }
      const current = await assetForTenant(context.tenantId, asset.id);
      if (!current) return Response.json({ error: "asset_profile_readback_unavailable" }, { status: 503 });
      return Response.json({ asset: recordForResponse(current), eventId: existingEvent.eventId, idempotent: true, readback: "verified" }, { headers: { "cache-control": "private, no-store" } });
    }

    if (asset.updatedAt !== expectedUpdatedAt) return Response.json({ error: "version_conflict" }, { status: 409 });
    const currentPayload = parseJson(asset.payloadJson);
    const currentProfileVersion = typeof currentPayload.profileVersion === "number" && Number.isInteger(currentPayload.profileVersion)
      ? currentPayload.profileVersion
      : 0;
    const profileVersion = currentProfileVersion + 1;
    const now = new Date().toISOString();
    const assetProfile = { usageMode, transportCapabilities, maxPayloadKg: entityType === "vehicle" ? maxPayloadValue : null };
    const nextPayload: JsonObject = {
      ...currentPayload,
      title,
      description: title,
      entityType,
      usageMode,
      operationalProfile: usageMode,
      transportCapabilities,
      assetProfile,
      transportable: entityType === "vehicle" ? false : transportable,
      weightKg: entityType === "vehicle" ? null : weightValue,
      maxPayloadKg: entityType === "vehicle" ? maxPayloadValue : null,
      pairedCargoAssetIds: entityType === "vehicle" ? pairedCargoAssetIds : [],
      brand,
      model,
      registration,
      serialNumber,
      warehouseId: warehouse?.id ?? null,
      locationId: warehouseLocation?.id ?? null,
      location: warehouse?.name ?? "",
      capacity: capacityValue,
      notes,
      profileVersion,
      profileUpdatedAt: now,
      profileUpdatedBy: context.actorId,
    };
    const [updated] = await db.update(s04Records).set({
      detail: title,
      meta: `${entityType.toUpperCase()} · ${usageMode}`,
      payloadJson: JSON.stringify(nextPayload),
      updatedAt: now,
    }).where(and(
      eq(s04Records.tenantId, context.tenantId),
      eq(s04Records.id, asset.id),
      eq(s04Records.updatedAt, expectedUpdatedAt),
    )).returning();
    if (!updated) return Response.json({ error: "version_conflict" }, { status: 409 });

    const eventId = crypto.randomUUID();
    await db.batch([
      db.insert(s06Events).values({
        eventId,
        tenantId: context.tenantId,
        eventType: "asset.profile.updated",
        schemaVersion: "1",
        actorType: "human",
        actorId: context.actorId,
        source: "sites-asset-profile",
        occurredAt: now,
        observedAt: now,
        aggregateType: "asset",
        aggregateId: asset.id,
        aggregateVersion: profileVersion,
        payloadJson: JSON.stringify({ entityType, usageMode, transportCapabilities, pairedCargoAssetIds: entityType === "vehicle" ? pairedCargoAssetIds : [], maxPayloadKg: entityType === "vehicle" ? maxPayloadValue : null, profileVersion, physicalCustody: { status: warehouse ? "AT_WAREHOUSE" : "UNKNOWN", warehouseId: warehouse?.id ?? null, locationId: warehouseLocation?.id ?? null } }),
        correlationId: crypto.randomUUID(),
        causationId: null,
        idempotencyKey,
        status: "COMMITTED_SITES_READBACK",
        createdAt: now,
      }),
      db.insert(s06Outbox).values({
        id: crypto.randomUUID(), tenantId: context.tenantId, eventId,
        topic: "zerow.asset.profile.updated", status: "PENDING_EXTERNAL_CONSUMER",
        attempts: 0, createdAt: now, updatedAt: now,
      }),
      db.insert(s06Reconciliations).values({
        id: crypto.randomUUID(), tenantId: context.tenantId,
        aggregateType: "asset", aggregateId: asset.id,
        expectedVersion: profileVersion, observedVersion: profileVersion,
        status: "SITES_READBACK_VERIFIED",
        detail: "Profilo asset aggiornato dal catalogo server-side con controllo versione.",
        createdAt: now, updatedAt: now,
      }),
      db.insert(assetCustodyLocations).values({
        id: `ASSET-CUSTODY-${asset.id}`,
        tenantId: context.tenantId,
        assetId: asset.id,
        warehouseId: warehouse?.id ?? null,
        locationId: warehouseLocation?.id ?? null,
        status: warehouse ? "AT_WAREHOUSE" : "UNKNOWN",
        source: "ASSET_PROFILE",
        version: 1,
        effectiveAt: now,
        createdBy: context.actorId,
        createdAt: now,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: [assetCustodyLocations.tenantId, assetCustodyLocations.assetId],
        set: {
          warehouseId: warehouse?.id ?? null,
          locationId: warehouseLocation?.id ?? null,
          status: warehouse ? "AT_WAREHOUSE" : "UNKNOWN",
          source: "ASSET_PROFILE",
          version: sql`${assetCustodyLocations.version} + 1`,
          effectiveAt: now,
          updatedAt: now,
        },
      }),
    ]);
    const readback = await assetForTenant(context.tenantId, asset.id);
    const [custodyReadback] = await db.select().from(assetCustodyLocations).where(and(
      eq(assetCustodyLocations.tenantId, context.tenantId),
      eq(assetCustodyLocations.assetId, asset.id),
    )).limit(1);
    if (!readback || readback.updatedAt !== now || parseJson(readback.payloadJson).profileVersion !== profileVersion
      || !custodyReadback || custodyReadback.warehouseId !== (warehouse?.id ?? null)) {
      return Response.json({ error: "asset_profile_readback_unavailable" }, { status: 503 });
    }
    return Response.json({ asset: recordForResponse(readback), eventId, idempotent: false, readback: "verified" }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/unique|constraint/i.test(message)) return Response.json({ error: "asset_profile_idempotency_conflict" }, { status: 409 });
    return Response.json({ error: "asset_profile_write_unavailable" }, { status: 503 });
  }
}
