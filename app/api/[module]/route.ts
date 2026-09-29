import { getDb } from "@/db";
import { s04Records } from "@/db/schema";
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
  const tone = typeof payload.tone === "string" && VALID_TONES.has(payload.tone) ? payload.tone : "lime";
  const progress = typeof payload.progress === "number" && Number.isFinite(payload.progress)
    ? Math.max(0, Math.min(100, Math.round(payload.progress)))
    : 0;
  const recordType = typeof payload.recordType === "string" && payload.recordType.trim().length > 0
    ? payload.recordType.trim().slice(0, 48)
    : "read-model";

  if (title.length < 2 || title.length > 120) {
    return Response.json({ error: "title_must_be_2_to_120_characters" }, { status: 400 });
  }
  if (detail.length > 240 || meta.length > 120 || status.length > 80) {
    return Response.json({ error: "field_length_exceeded" }, { status: 400 });
  }

  try {
    assertS04Tenant(context!, context!.tenantId);
    const now = new Date().toISOString();
    const id = `${moduleKey.toUpperCase()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const db = getDb();
    const [row] = await db.insert(s04Records).values({
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
      payloadJson: JSON.stringify({ ...payload, source: "sites-s04-adapter", createdAt: now }),
      createdBy: context!.actorId,
      createdAt: now,
      updatedAt: now,
    }).returning();

    const records = await getS04ReadModel(moduleKey, context!.tenantId);
    return Response.json({
      ...s04Envelope(context!, moduleKey, records.map(recordForResponse)),
      created: recordForResponse(row),
    }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: adapterError(error), module: moduleKey }, { status: 503 });
  }
}
