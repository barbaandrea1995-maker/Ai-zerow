import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

const db = new DatabaseSync(":memory:");
try {
  db.exec("PRAGMA foreign_keys = OFF");
  for (let pass = 1; pass <= 2; pass += 1) {
    for (const { sql } of migrations) db.exec(sql.replaceAll("--> statement-breakpoint", "\n"));
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
  ];
  const existing = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'index')").all().map((row) => row.name),
  );
  for (const name of expectedObjects) assert(existing.has(name), `missing schema object after replay: ${name}`);
} finally {
  db.close();
}

console.log(JSON.stringify({
  status: "PASS",
  migrations: migrationFiles,
  checks: ["all_schema_ddl_is_idempotent", "runtime_first_replay_safe", "expected_objects_present"],
}, null, 2));
