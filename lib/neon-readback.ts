import { neon } from "@neondatabase/serverless";
import { env } from "cloudflare:workers";

type NeonRow = Record<string, unknown>;

type SitesRuntimeEnv = {
  DATABASE_URL?: string;
};

const PROJECT_ID = "proud-dream-31716379";
const BRANCH_ID = "br-cool-king-zauea5pa";
const DATABASE_NAME = "neondb";
const ENDPOINT_ID = "ep-aged-flower-zakdq2d8";

export class NeonReadbackError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

function classifyNeonError(error: unknown): string {
  if (error && typeof error === "object") {
    const candidate = error as { code?: unknown; name?: unknown; message?: unknown };
    if (typeof candidate.code === "string" && /^[0-9A-Z]{5}$/.test(candidate.code)) {
      return `neon_sql_${candidate.code.toLowerCase()}`;
    }
    if (candidate.name === "NeonDbError") return "neon_sql_error";
    if (typeof candidate.message === "string") {
      if (candidate.message.includes("connection string")) return "neon_binding_invalid";
      if (candidate.message.includes("Error connecting") || candidate.message.includes("fetch")) {
        return "neon_transport_error";
      }
    }
  }
  return "neon_runtime_readback_failed";
}

function asRows(value: unknown): NeonRow[] {
  return Array.isArray(value) ? value as NeonRow[] : [];
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getRuntimeEnv(): SitesRuntimeEnv {
  return env as unknown as SitesRuntimeEnv;
}

/**
 * Read-only S10 proof from the authorized Neon project.
 *
 * This deliberately exposes no connection string and performs no mutation.
 * The transaction is marked READ ONLY at the Neon HTTP driver boundary.
 */
export async function getNeonReadback() {
  const connectionString = getRuntimeEnv().DATABASE_URL?.trim();
  if (!connectionString) {
    throw new NeonReadbackError("neon_runtime_binding_missing");
  }

  try {
    const sql = neon(connectionString, { readOnly: true });
    const [runtimeRows, relationRows, fingerprintRows, markerRows, readModelRows] = await sql.transaction(
      (transaction) => [
        transaction.query(
          "SELECT current_database() AS database_name, current_user AS current_role, current_setting('server_version') AS postgres_version",
        ),
        transaction.query(
          "SELECT table_schema, count(*) FILTER (WHERE table_type = 'BASE TABLE')::int AS base_tables, count(*) FILTER (WHERE table_type = 'VIEW')::int AS views, count(*)::int AS relations FROM information_schema.tables WHERE table_schema IN ('zerow', 'neon_auth') GROUP BY table_schema ORDER BY table_schema",
        ),
        transaction.query(
          "WITH columns AS (SELECT table_schema, table_name, ordinal_position, column_name, data_type, is_nullable, COALESCE(character_maximum_length::text, '') AS character_maximum_length, COALESCE(numeric_precision::text, '') AS numeric_precision, COALESCE(numeric_scale::text, '') AS numeric_scale, COALESCE(datetime_precision::text, '') AS datetime_precision FROM information_schema.columns WHERE table_schema IN ('zerow', 'neon_auth')) SELECT count(*)::int AS column_count, md5(string_agg(concat_ws('|', table_schema, table_name, ordinal_position, column_name, data_type, is_nullable, character_maximum_length, numeric_precision, numeric_scale, datetime_precision), E'\\n' ORDER BY table_schema, table_name, ordinal_position)) AS fingerprint FROM columns",
        ),
        transaction.query(
          "SELECT table_schema, table_name, table_type FROM information_schema.tables WHERE table_schema IN ('zerow', 'neon_auth') AND (lower(table_name) LIKE '%migration%' OR lower(table_name) LIKE '%schema%' OR lower(table_name) LIKE '%version%' OR lower(table_name) LIKE '%marker%' OR lower(table_name) LIKE '%ledger%') ORDER BY table_schema, table_name",
        ),
        transaction.query(
          "SELECT (SELECT count(*)::int FROM zerow.event_store) AS event_store_rows, (SELECT count(*)::int FROM zerow.outbox) AS outbox_rows, (SELECT count(*)::int FROM neon_auth.\"user\") AS auth_user_rows, (SELECT count(*)::int FROM neon_auth.session) AS auth_session_rows",
        ),
      ],
      { readOnly: true },
    );

    const runtime = asRows(runtimeRows)[0] ?? {};
    const fingerprint = asRows(fingerprintRows)[0] ?? {};
    const readModels = asRows(readModelRows)[0] ?? {};

    return {
      status: "ok" as const,
      checkedAt: new Date().toISOString(),
      contract: {
        provider: "Neon",
        projectId: PROJECT_ID,
        branchId: BRANCH_ID,
        database: DATABASE_NAME,
        endpointId: ENDPOINT_ID,
        source: "sites-neon-readonly-http",
        mode: "read-only",
        directExternalWrite: false,
        canonicalControlPlane: "sites-d1",
      },
      runtime: {
        databaseName: asString(runtime.database_name),
        currentRole: asString(runtime.current_role),
        postgresVersion: asString(runtime.postgres_version),
      },
      schema: asRows(relationRows).map((row) => ({
        schema: asString(row.table_schema),
        baseTables: asNumber(row.base_tables),
        views: asNumber(row.views),
        relations: asNumber(row.relations),
      })),
      schemaFingerprint: {
        columnCount: asNumber(fingerprint.column_count),
        fingerprint: asString(fingerprint.fingerprint),
      },
      markerCandidates: asRows(markerRows).map((row) => ({
        schema: asString(row.table_schema),
        name: asString(row.table_name),
        type: asString(row.table_type),
      })),
      readModels: {
        eventStoreRows: asNumber(readModels.event_store_rows),
        outboxRows: asNumber(readModels.outbox_rows),
        authUserRows: asNumber(readModels.auth_user_rows),
        authSessionRows: asNumber(readModels.auth_session_rows),
      },
    };
  } catch (error) {
    if (error instanceof NeonReadbackError) throw error;
    const code = classifyNeonError(error);
    console.error("neon_readback_failed", code);
    throw new NeonReadbackError(code);
  }
}
