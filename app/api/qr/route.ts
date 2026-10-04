import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { inventoryItems, qrCodes, s04Records } from "@/db/schema";
import {
  canonicalPayload,
  directoryMatch,
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
  type QrEntityType,
  type QrFormat,
} from "@/lib/qr-adapter";

export const dynamic = "force-dynamic";

function invalidBody() {
  return Response.json({ error: "invalid_json" }, { status: 400 });
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

    const storedDirect = await getQrByPayload(context!.tenantId, code);
    const match = inferRawCode(code) ?? (storedDirect ? directoryMatch(
      storedDirect.entityType as QrEntityType,
      storedDirect.entityId,
    ) : null);
    if (!match) {
      return Response.json({ error: "code_not_resolved", code }, { status: 404 });
    }

    const canonical = canonicalPayload(match.entityType, match.entityId);
    const stored = storedDirect ?? await getQrByPayload(context!.tenantId, canonical);
    const [asset] = match.entityType === "asset"
      ? await getDb().select().from(s04Records).where(and(
        eq(s04Records.tenantId, context!.tenantId),
        eq(s04Records.module, "assets"),
        eq(s04Records.canonicalCode, match.entityId),
      )).limit(1)
      : [];
    const [material] = match.entityType === "material"
      ? await getDb().select().from(inventoryItems).where(and(
        eq(inventoryItems.tenantId, context!.tenantId),
        eq(inventoryItems.sku, match.entityId),
      )).limit(1)
      : [];
    return Response.json({
      ...qrEnvelope(context!, stored ? [qrRecordForResponse(stored)] : []),
      resolved: {
        ...match,
        ...(asset ? { title: asset.title, detail: asset.detail } : {}),
        ...(material ? { title: material.name, detail: `${material.sku} · ${material.location}` } : {}),
        canonicalPayload: canonical,
        source: stored ? "sites-d1-registry" : asset ? "sites-asset-readback" : material ? "sites-inventory-readback" : "sites-directory-fallback",
      },
      record: stored ? qrRecordForResponse(stored) : null,
      asset: asset ? { id: asset.id, canonicalCode: asset.canonicalCode, title: asset.title, detail: asset.detail } : null,
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
  const entityId = typeof payload.entityId === "string" ? payload.entityId.trim().toUpperCase() : "";
  const formatValue = typeof payload.format === "string" ? payload.format.trim().toUpperCase() : "QR";
  const entityType: QrEntityType = isQrEntityType(entityTypeValue) ? entityTypeValue : "asset";
  const format: QrFormat = isQrFormat(formatValue) ? formatValue : "QR";

  if (!isQrEntityType(entityTypeValue)) {
    return Response.json({ error: "entity_type_must_be_asset_material_warehouse_or_commessa" }, { status: 400 });
  }
  if (!/^[A-Z0-9_:#-]{1,80}$/.test(entityId)) {
    return Response.json({ error: "entity_id_invalid" }, { status: 400 });
  }
  if (typeof payload.label === "string" && payload.label.trim().length > 120) {
    return Response.json({ error: "label_too_long" }, { status: 400 });
  }

  const match = directoryMatch(entityType, entityId);
  const label = typeof payload.label === "string" && payload.label.trim().length > 1
    ? payload.label.trim()
    : match.title;
  const code = canonicalPayload(entityType, entityId);
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
        entityId,
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
