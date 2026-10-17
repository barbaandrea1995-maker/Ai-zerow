import { and, eq, or } from "drizzle-orm";
import { getDb } from "@/db";
import { inventoryItems, qrCodes, s04Records, tenantWarehouses } from "@/db/schema";
import { parseJobPayload } from "@/lib/operations-contract";
import {
  canonicalPayload,
  directoryMatch,
  getQrAlias,
  getQrByPayload,
  getQrContext,
  getQrReadModel,
  inferRawCode,
  isQrEntityType,
  isQrFormat,
  qrAccessDenied,
  qrAdapterError,
  qrEnvelope,
  qrRecordForResponse,
  type QrDirectoryMatch,
  type QrEntityType,
  type QrFormat,
} from "@/lib/qr-adapter";

export const dynamic = "force-dynamic";

function invalidBody() {
  return Response.json({ error: "invalid_json" }, { status: 400 });
}

function objectPayload(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function payloadText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function resolveCatalogEntity(
  tenantId: string,
  entityType: QrEntityType,
  entityId: string,
): Promise<QrDirectoryMatch | null> {
  const db = getDb();
  if (entityType === "asset" || entityType === "commessa") {
    const moduleKey = entityType === "asset" ? "assets" : "operations";
    const [record] = await db.select().from(s04Records).where(and(
      eq(s04Records.tenantId, tenantId),
      eq(s04Records.module, moduleKey),
      or(eq(s04Records.id, entityId), eq(s04Records.canonicalCode, entityId)),
    )).limit(1);
    if (!record) return null;
    const canonicalId = record.canonicalCode?.trim() || record.id;
    const payload = objectPayload(record.payloadJson);
    const job = entityType === "commessa" ? parseJobPayload(record.payloadJson) : null;
    const title = entityType === "commessa"
      ? job?.title || record.detail || canonicalId
      : payloadText(payload.title) || payloadText(payload.description) || record.detail || canonicalId;
    const detail = entityType === "commessa"
      ? job?.description || job?.location || record.detail
      : [payloadText(payload.brand), payloadText(payload.model), payloadText(payload.registration)].filter(Boolean).join(" · ") || record.detail;
    return {
      ...directoryMatch(entityType, canonicalId),
      title,
      detail,
    };
  }

  if (entityType === "material") {
    const [item] = await db.select().from(inventoryItems).where(and(
      eq(inventoryItems.tenantId, tenantId),
      or(
        eq(inventoryItems.id, entityId),
        eq(inventoryItems.sku, entityId),
        eq(inventoryItems.barcode, entityId),
        eq(inventoryItems.qrCode, entityId),
      ),
    )).limit(1);
    if (!item) return null;
    return {
      ...directoryMatch("material", item.sku),
      title: item.name,
      detail: `${item.sku} · ${item.location}`,
    };
  }

  const [warehouse] = await db.select().from(tenantWarehouses).where(and(
    eq(tenantWarehouses.tenantId, tenantId),
    or(eq(tenantWarehouses.id, entityId), eq(tenantWarehouses.code, entityId)),
  )).limit(1);
  if (!warehouse) return null;
  return {
    ...directoryMatch("warehouse", warehouse.code),
    title: warehouse.name,
    detail: `${warehouse.code} · ${warehouse.locationLabel}`,
  };
}

export async function GET(request: Request) {
  const context = await getQrContext();
  const denied = qrAccessDenied(context, "read");
  if (denied) return denied;

  const code = new URL(request.url).searchParams.get("code")?.trim() ?? "";
  try {
    if (!code) {
      const rows = await getQrReadModel(context!.tenantId);
      return Response.json(qrEnvelope(context!, rows.map(qrRecordForResponse)), {
        headers: { "cache-control": "no-store" },
      });
    }

    const alias = await getQrAlias(context!.tenantId, code);
    const resolvedInput = alias?.canonicalPayload ?? code;
    const storedDirect = await getQrByPayload(context!.tenantId, resolvedInput);
    const match = inferRawCode(resolvedInput) ?? (storedDirect ? directoryMatch(
      storedDirect.entityType as QrEntityType,
      storedDirect.entityId,
    ) : null);
    if (!match) {
      return Response.json({ error: "code_not_resolved", code }, { status: 404 });
    }

    const resolvedMatch = await resolveCatalogEntity(context!.tenantId, match.entityType, match.entityId);
    if (!resolvedMatch) {
      return Response.json({ error: "catalog_entity_not_found", entityType: match.entityType, entityId: match.entityId }, { status: 404 });
    }

    const canonical = canonicalPayload(resolvedMatch.entityType, resolvedMatch.entityId);
    const stored = storedDirect ?? await getQrByPayload(context!.tenantId, canonical);
    const [asset] = resolvedMatch.entityType === "asset"
      ? await getDb().select().from(s04Records).where(and(
        eq(s04Records.tenantId, context!.tenantId),
        eq(s04Records.module, "assets"),
        or(eq(s04Records.id, resolvedMatch.entityId), eq(s04Records.canonicalCode, resolvedMatch.entityId)),
      )).limit(1)
      : [];
    const [material] = resolvedMatch.entityType === "material"
      ? await getDb().select().from(inventoryItems).where(and(
        eq(inventoryItems.tenantId, context!.tenantId),
        or(eq(inventoryItems.id, resolvedMatch.entityId), eq(inventoryItems.sku, resolvedMatch.entityId)),
      )).limit(1)
      : [];
    return Response.json({
      ...qrEnvelope(context!, stored ? [qrRecordForResponse(stored)] : []),
      resolved: {
        ...resolvedMatch,
        canonicalPayload: canonical,
        source: alias ? "sites-d1-alias" : stored ? "sites-d1-registry" : "sites-catalog-readback",
      },
      alias: alias ? { payload: alias.aliasPayload, canonicalPayload: alias.canonicalPayload, reason: alias.reason } : null,
      record: stored ? qrRecordForResponse(stored) : null,
      asset: asset ? { id: asset.id, canonicalCode: asset.canonicalCode, title: resolvedMatch.title, detail: resolvedMatch.detail } : null,
      material: material ? { id: material.id, sku: material.sku, name: material.name, unit: material.unit, location: material.location, warehouseId: material.warehouseId } : null,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: qrAdapterError(error), module: "qr-barcode" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const context = await getQrContext();
  const denied = qrAccessDenied(context, "write");
  if (denied) return denied;

  let payload: Record<string, unknown>;
  try {
    const parsed = (await request.json()) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return invalidBody();
    payload = parsed as Record<string, unknown>;
  } catch {
    return invalidBody();
  }

  const entityTypeValue = typeof payload.entityType === "string" ? payload.entityType.trim().toLowerCase() : "";
  const entityId = typeof payload.entityId === "string" ? payload.entityId.trim() : "";
  const formatValue = typeof payload.format === "string" ? payload.format.trim().toUpperCase() : "QR";
  const entityType: QrEntityType = isQrEntityType(entityTypeValue) ? entityTypeValue : "asset";
  const format: QrFormat = isQrFormat(formatValue) ? formatValue : "QR";

  if (!isQrEntityType(entityTypeValue)) {
    return Response.json({ error: "entity_type_must_be_asset_material_warehouse_or_commessa" }, { status: 400 });
  }
  if (!/^[A-Za-z0-9_:#-]{1,80}$/.test(entityId)) {
    return Response.json({ error: "entity_id_invalid" }, { status: 400 });
  }
  if (typeof payload.label === "string" && payload.label.trim().length > 120) {
    return Response.json({ error: "label_too_long" }, { status: 400 });
  }

  let match: QrDirectoryMatch | null;
  try {
    match = await resolveCatalogEntity(context!.tenantId, entityType, entityId);
  } catch (error) {
    return Response.json({ error: qrAdapterError(error), module: "qr-barcode" }, { status: 503 });
  }
  if (!match) {
    return Response.json({ error: "catalog_entity_not_found", entityType, entityId }, { status: 404 });
  }
  const label = typeof payload.label === "string" && payload.label.trim().length > 1
    ? payload.label.trim()
    : match.title;
  const code = canonicalPayload(entityType, match.entityId);
  const now = new Date().toISOString();

  try {
    const db = getDb();
    const existing = await getQrByPayload(context!.tenantId, code);
    let row: typeof qrCodes.$inferSelect;
    let mode: "created" | "updated" = "created";
    if (existing) {
      const [updated] = await db.update(qrCodes)
        .set({ format, label, updatedAt: now })
        .where(eq(qrCodes.id, existing.id))
        .returning();
      row = updated ?? existing;
      mode = "updated";
    } else {
      const [created] = await db.insert(qrCodes).values({
        id: `${entityType.toUpperCase()}-QR-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        tenantId: context!.tenantId,
        format,
        entityType,
        entityId: match.entityId,
        label,
        payload: code,
        createdBy: context!.actorId,
        createdAt: now,
        updatedAt: now,
      }).returning();
      row = created;
    }

    const rows = await getQrReadModel(context!.tenantId);
    return Response.json({
      ...qrEnvelope(context!, rows.map(qrRecordForResponse)),
      created: qrRecordForResponse(row),
      mode,
    }, { status: mode === "created" ? 201 : 200, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: qrAdapterError(error), module: "qr-barcode" }, { status: 503 });
  }
}
