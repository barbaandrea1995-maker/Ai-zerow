import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  JOB_STOCK_SCHEMA_OBJECTS,
  JOB_STOCK_SCHEMA_SQL,
} from "../lib/job-stock-schema-contract.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationFiles = [
  "0022_easy_dragon_lord.sql",
  "0024_volatile_skullbuster.sql",
  "0025_red_thunderbolts.sql",
  "0026_salty_black_tarantula.sql",
  "0027_lowly_quicksilver.sql",
];

const migrations = await Promise.all(
  migrationFiles.map(async (file) => ({
    file,
    sql: await readFile(join(root, "drizzle", file), "utf8"),
  })),
);
const jobStockMigrationFile = "0028_tricky_human_fly.sql";
const jobStockMigration = await readFile(join(root, "drizzle", jobStockMigrationFile), "utf8");

for (const { file, sql } of migrations) {
  for (const statement of sql.split("--> statement-breakpoint")) {
    const ddl = statement.trim();
    if (!ddl) continue;
    assert.match(
      ddl,
      /^CREATE (?:TABLE|(?:UNIQUE )?INDEX) IF NOT EXISTS\b/,
      `${file} contains non-idempotent schema DDL: ${ddl.split("\n", 1)[0]}`,
    );
  }
}

for (const statement of jobStockMigration.split("--> statement-breakpoint")) {
  const sql = statement.trim();
  if (!sql) continue;
  if (/^CREATE\b/.test(sql)) {
    assert.match(sql, /^CREATE (?:TABLE|(?:UNIQUE )?INDEX) IF NOT EXISTS\b/, `${jobStockMigrationFile} contains non-idempotent schema DDL: ${sql.split("\n", 1)[0]}`);
  } else {
    assert.match(sql, /^INSERT OR IGNORE\b/, `${jobStockMigrationFile} contains non-idempotent data backfill: ${sql.split("\n", 1)[0]}`);
  }
}

for (const statement of JOB_STOCK_SCHEMA_SQL) {
  if (/^CREATE\b/.test(statement)) {
    assert.match(statement, /^CREATE (?:TABLE|(?:UNIQUE )?INDEX) IF NOT EXISTS\b/, `runtime job-stock bootstrap contains non-idempotent DDL: ${statement.split("\n", 1)[0]}`);
  } else {
    assert.match(statement, /^INSERT OR IGNORE\b/, `runtime job-stock bootstrap contains non-idempotent backfill: ${statement.split("\n", 1)[0]}`);
  }
}
for (const name of JOB_STOCK_SCHEMA_OBJECTS) {
  assert(jobStockMigration.includes(name), `migration/runtime schema drift: ${name} is absent from ${jobStockMigrationFile}`);
}

const db = new DatabaseSync(":memory:");
try {
  db.exec("PRAGMA foreign_keys = OFF");
  for (let pass = 1; pass <= 2; pass += 1) {
    for (const { sql } of migrations) db.exec(sql.replaceAll("--> statement-breakpoint", "\n"));
  }

  db.exec(`
    CREATE TABLE s04_records (
      id text PRIMARY KEY NOT NULL,
      tenant_id text NOT NULL,
      canonical_code text,
      module text NOT NULL,
      record_type text NOT NULL,
      created_by text NOT NULL,
      created_at text NOT NULL,
      updated_at text NOT NULL
    );
    CREATE TABLE inventory_items (
      id text PRIMARY KEY NOT NULL,
      tenant_id text NOT NULL,
      warehouse_id text NOT NULL,
      sku text NOT NULL,
      name text NOT NULL,
      unit text NOT NULL
    );
    CREATE TABLE inventory_movements (
      id text PRIMARY KEY NOT NULL,
      tenant_id text NOT NULL,
      job_id text,
      item_id text NOT NULL,
      mission_id text,
      movement_type text NOT NULL,
      quantity_milli integer NOT NULL,
      actor_id text NOT NULL,
      created_at text NOT NULL
    );
    CREATE TABLE job_journey_records (
      id text PRIMARY KEY NOT NULL,
      tenant_id text NOT NULL,
      job_id text NOT NULL,
      record_type text NOT NULL,
      payload_json text NOT NULL
    );
    INSERT INTO s04_records VALUES
      ('job-direct', 'tenant-a', 'COMM-0001', 'operations', 'job', 'actor-a', '2026-10-01T08:00:00.000Z', '2026-10-01T08:00:00.000Z'),
      ('job-delivery', 'tenant-a', 'COMM-0002', 'operations', 'job', 'actor-a', '2026-10-01T08:00:00.000Z', '2026-10-01T08:00:00.000Z');
    INSERT INTO inventory_items VALUES
      ('item-direct', 'tenant-a', 'warehouse-a', 'MAT-001', 'Materiale ritiro', 'PZ'),
      ('item-delivery', 'tenant-a', 'warehouse-a', 'MAT-002', 'Materiale consegna', 'PZ');
    INSERT INTO job_journey_records VALUES
      ('pickup-a', 'tenant-a', 'job-direct', 'MATERIAL_PICKUP', '{"movementId":"movement-direct"}'),
      ('mission-a', 'tenant-a', 'job-delivery', 'TRANSPORT', '{"transportMode":"WAREHOUSE_TO_JOB"}');
    INSERT INTO inventory_movements VALUES
      ('movement-direct', 'tenant-a', 'job-direct', 'item-direct', NULL, 'PICK', 2000, 'actor-a', '2026-10-01T09:00:00.000Z'),
      ('movement-delivery', 'tenant-a', 'job-delivery', 'item-delivery', 'mission-a', 'DELIVER', 3000, 'actor-a', '2026-10-01T10:00:00.000Z');
  `);
  for (let pass = 1; pass <= 2; pass += 1) {
    for (const statement of JOB_STOCK_SCHEMA_SQL) db.exec(statement);
  }

  const expectedObjects = [
    "asset_custody_locations",
    "qr_code_aliases",
    "tenant_alignment_links",
    "tenant_alignment_runs",
    "finance_documents",
    "finance_document_extractions",
    "finance_document_extractions_active_source_uq",
    "finance_document_reviews",
    "finance_document_links",
    "finance_entries",
    "finance_entry_allocations",
    "finance_entry_relations",
    "finance_reconciliation_issues",
    ...JOB_STOCK_SCHEMA_OBJECTS,
  ];
  const existing = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'index')").all().map((row) => row.name),
  );
  for (const name of expectedObjects) assert(existing.has(name), `missing schema object after replay: ${name}`);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM job_stock_registers").get().count, 2, "job-stock register backfill must be replay-safe");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM job_stock_movements").get().count, 2, "job-stock movement backfill must be replay-safe");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM job_stock_balances").get().count, 2, "job-stock balance projection must be replay-safe");
  assert.equal(db.prepare("SELECT on_hand_milli FROM job_stock_balances WHERE job_id = 'job-direct'").get().on_hand_milli, 2_000);
  assert.equal(db.prepare("SELECT on_hand_milli FROM job_stock_balances WHERE job_id = 'job-delivery'").get().on_hand_milli, 3_000);
} finally {
  db.close();
}

console.log(JSON.stringify({
  status: "PASS",
  migrations: migrationFiles,
  additiveBackfillMigration: jobStockMigrationFile,
  checks: ["all_schema_ddl_is_idempotent", "runtime_first_replay_safe", "expected_objects_present", "migration_runtime_contract_aligned", "job_stock_backfill_is_idempotent"],
}, null, 2));
