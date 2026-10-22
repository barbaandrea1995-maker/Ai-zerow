import { getDb } from "@/db";
import {
  JOB_STOCK_SCHEMA_OBJECTS,
  JOB_STOCK_SCHEMA_SQL,
} from "@/lib/job-stock-schema-contract";

let schemaReady: Promise<void> | null = null;

async function schemaObjectNames() {
  const db = getDb();
  const readback = await db.$client
    .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'index')")
    .all<{ name: string }>();
  return new Set(readback.results.map((row) => row.name));
}

function hasCompleteSchema(names: ReadonlySet<string>) {
  return JOB_STOCK_SCHEMA_OBJECTS.every((name) => names.has(name));
}

async function installJobStockSchema() {
  if (hasCompleteSchema(await schemaObjectNames())) return;

  const db = getDb();
  await db.$client.batch(
    JOB_STOCK_SCHEMA_SQL.map((statement) => db.$client.prepare(statement)),
  );

  if (!hasCompleteSchema(await schemaObjectNames())) {
    throw new Error("job_stock_schema_readback_unavailable");
  }
}

/**
 * Sites publishes the Worker separately from D1. This bounded bootstrap only
 * installs the additive schema from migration 0028 and replays idempotent
 * projections; every stock-dependent mutation awaits it and therefore fails
 * closed if D1 cannot confirm the resulting objects.
 */
export async function ensureJobStockSchema() {
  if (!schemaReady) {
    schemaReady = installJobStockSchema().catch((error: unknown) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

/** Warm the schema during a normal page request without taking unrelated UI down. */
export async function warmJobStockSchema() {
  try {
    await ensureJobStockSchema();
  } catch (error) {
    console.error(
      "job_stock_schema_bootstrap_failed",
      error instanceof Error ? error.message.slice(0, 240) : "unknown_error",
    );
  }
}
