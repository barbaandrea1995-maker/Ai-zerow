import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

const PROJECT_ID = "appgprj_6abaaf2bb58081919b265a8a6ad76dbb";
const RESET_PREFIX = "tenants/";
const RESET_CONFIRMATION = "ERASE_ALL_LIVE_APPLICATION_DATA";
const MAX_OBJECTS = 10_000;
const TECHNICAL_TABLES = new Set(["_cf_KV", "__drizzle_migrations", "d1_migrations"]);

const RESET_TABLES = [
  "access_profiles",
  "ai_rate_limit_windows",
  "asset_custody_locations",
  "command_dashboard_preferences",
  "company_ai_job_scopes",
  "delivery_events",
  "entity_code_counters",
  "finance_document_extractions",
  "finance_document_links",
  "finance_document_reviews",
  "finance_documents",
  "finance_entries",
  "finance_entry_allocations",
  "finance_entry_relations",
  "finance_reconciliation_issues",
  "geo_locations",
  "geofences",
  "inventory_items",
  "inventory_movements",
  "job_journey_records",
  "location_access_audit",
  "location_events",
  "location_samples",
  "operational_documents",
  "qr_code_aliases",
  "qr_codes",
  "route_plans",
  "route_stops",
  "s04_records",
  "s05_records",
  "s06_events",
  "s06_outbox",
  "s06_reconciliations",
  "s07_ai_ledger",
  "tenant_alignment_links",
  "tenant_alignment_runs",
  "tenant_invitations",
  "tenant_memberships",
  "tenant_warehouses",
  "tenants",
  "tracking_devices",
  "tracking_providers",
  "tracking_sessions",
  "vehicle_device_bindings",
  "w10_workflows",
] as const;

// Children and audit/read-model rows are removed before the tenant roots.
const DELETE_ORDER = [
  "finance_entry_relations",
  "finance_entry_allocations",
  "finance_reconciliation_issues",
  "finance_entries",
  "finance_document_links",
  "finance_document_reviews",
  "finance_document_extractions",
  "finance_documents",
  "operational_documents",
  "delivery_events",
  "route_stops",
  "route_plans",
  "location_events",
  "location_samples",
  "tracking_sessions",
  "vehicle_device_bindings",
  "tracking_devices",
  "tracking_providers",
  "asset_custody_locations",
  "geofences",
  "geo_locations",
  "location_access_audit",
  "qr_code_aliases",
  "qr_codes",
  "inventory_movements",
  "inventory_items",
  "job_journey_records",
  "company_ai_job_scopes",
  "command_dashboard_preferences",
  "w10_workflows",
  "s07_ai_ledger",
  "s06_outbox",
  "s06_reconciliations",
  "s06_events",
  "s05_records",
  "s04_records",
  "tenant_alignment_links",
  "tenant_alignment_runs",
  "entity_code_counters",
  "ai_rate_limit_windows",
  "access_profiles",
  "tenant_invitations",
  "tenant_memberships",
  "tenant_warehouses",
  "tenants",
] as const;

type Runtime = {
  DB?: D1Database;
  BUCKET?: R2Bucket;
  LIVE_FACTORY_RESET_TOKEN?: string;
};

type ResetPayload = {
  action?: unknown;
  confirmation?: unknown;
  manifestHash?: unknown;
  projectId?: unknown;
};

type Snapshot = {
  projectId: string;
  schemaVersion: "live-factory-reset-v1";
  tables: Record<string, number>;
  totalRows: number;
  objects: { prefix: string; count: number; keysHash: string };
};

function runtime(): Runtime {
  return env as unknown as Runtime;
}

function response(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function tokenMatches(request: Request, expected: string) {
  const supplied = request.headers.get("x-zerow-factory-reset-token") ?? "";
  if (!supplied || !expected || supplied.length > 512 || expected.length > 512) return false;
  const [suppliedHash, expectedHash] = await Promise.all([sha256(supplied), sha256(expected)]);
  let difference = suppliedHash.length ^ expectedHash.length;
  for (let index = 0; index < Math.max(suppliedHash.length, expectedHash.length); index += 1) {
    difference |= (suppliedHash.charCodeAt(index) || 0) ^ (expectedHash.charCodeAt(index) || 0);
  }
  return difference === 0;
}

async function assertExpectedSchema(db: D1Database) {
  const result = await db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'd1_migrations' ORDER BY name",
  ).all<{ name: string }>();
  const actual = result.results.map((row) => row.name).filter((name) => !TECHNICAL_TABLES.has(name)).sort();
  const expected = [...RESET_TABLES].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    const expectedSet = new Set<string>(expected);
    const actualSet = new Set<string>(actual);
    const missing = expected.filter((name) => !actualSet.has(name));
    const unexpected = actual.filter((name) => !expectedSet.has(name));
    throw new Error(`live_schema_does_not_match_reset_manifest:${JSON.stringify({ missing, unexpected })}`);
  }
}

async function listTenantObjects(bucket: R2Bucket) {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: RESET_PREFIX, cursor, limit: 1_000 });
    keys.push(...page.objects.map((object) => object.key));
    if (keys.length > MAX_OBJECTS) throw new Error("object_reset_limit_exceeded");
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return keys.sort();
}

async function currentSnapshot(db: D1Database, bucket: R2Bucket) {
  await assertExpectedSchema(db);
  const results = await db.batch(
    RESET_TABLES.map((table) => db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`)),
  );
  const tables: Record<string, number> = {};
  RESET_TABLES.forEach((table, index) => {
    const first = results[index]?.results?.[0] as { count?: unknown } | undefined;
    const count = Number(first?.count ?? 0);
    if (!Number.isSafeInteger(count) || count < 0) throw new Error("invalid_live_row_count");
    tables[table] = count;
  });
  const keys = await listTenantObjects(bucket);
  const snapshot: Snapshot = {
    projectId: PROJECT_ID,
    schemaVersion: "live-factory-reset-v1",
    tables,
    totalRows: Object.values(tables).reduce((sum, count) => sum + count, 0),
    objects: {
      prefix: RESET_PREFIX,
      count: keys.length,
      keysHash: await sha256(keys.join("\n")),
    },
  };
  return { snapshot, keys, manifestHash: await sha256(JSON.stringify(snapshot)) };
}

async function deleteObjects(bucket: R2Bucket, keys: string[]) {
  for (let index = 0; index < keys.length; index += 1_000) {
    await bucket.delete(keys.slice(index, index + 1_000));
  }
}

export async function POST(request: Request) {
  const bound = runtime();
  const token = bound.LIVE_FACTORY_RESET_TOKEN?.trim() || process.env.LIVE_FACTORY_RESET_TOKEN?.trim() || "";
  if (!token || !(await tokenMatches(request, token))) return response({ error: "not_found" }, 404);
  if (!bound.DB || !bound.BUCKET) return response({ error: "live_storage_unavailable" }, 503);

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 4_096) return response({ error: "payload_too_large" }, 413);
  let payload: ResetPayload;
  try {
    payload = JSON.parse(raw) as ResetPayload;
  } catch {
    return response({ error: "invalid_json" }, 400);
  }
  if (payload.projectId !== PROJECT_ID) return response({ error: "project_mismatch" }, 409);

  try {
    const before = await currentSnapshot(bound.DB, bound.BUCKET);
    if (payload.action === "PREVIEW") {
      return response({
        reset: "preview_only",
        manifestHash: before.manifestHash,
        snapshot: before.snapshot,
      });
    }
    if (payload.action !== "EXECUTE" || payload.confirmation !== RESET_CONFIRMATION) {
      return response({ error: "exact_reset_confirmation_required" }, 409);
    }
    if (payload.manifestHash !== before.manifestHash) {
      return response({
        error: "live_state_changed",
        manifestHash: before.manifestHash,
        snapshot: before.snapshot,
      }, 409);
    }

    await deleteObjects(bound.BUCKET, before.keys);
    await bound.DB.batch(DELETE_ORDER.map((table) => bound.DB!.prepare(`DELETE FROM "${table}"`)));

    const after = await currentSnapshot(bound.DB, bound.BUCKET);
    if (after.snapshot.totalRows !== 0 || after.snapshot.objects.count !== 0) {
      return response({
        error: "factory_reset_readback_failed",
        before: before.snapshot,
        after: after.snapshot,
      }, 503);
    }

    return response({
      reset: "completed",
      before: before.snapshot,
      after: after.snapshot,
      readback: "verified_empty",
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "factory_reset_failed";
    return response({ error: code }, 503);
  }
}
