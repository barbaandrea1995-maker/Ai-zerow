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

function asBoolean(value: unknown): boolean {
  return value === true || value === "true";
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
    const privilegeGaps: string[] = [];
    const readOnlyQuery = async (label: string, statement: string): Promise<unknown> => {
      try {
        const [rows] = await sql.transaction(
          (transaction) => [transaction.query(statement)],
          { readOnly: true },
        );
        return rows;
      } catch (error) {
        const code = classifyNeonError(error);
        console.error("neon_readback_failed", `${code}_${label}`);
        throw new NeonReadbackError(`${code}_${label}`);
      }
    };

    const runtimeRows = await readOnlyQuery(
      "runtime",
      "SELECT current_database() AS database_name, current_user AS current_role, current_setting('server_version') AS postgres_version",
    );
    const relationRows = await readOnlyQuery(
      "relations",
      "SELECT table_schema, count(*) FILTER (WHERE table_type = 'BASE TABLE')::int AS base_tables, count(*) FILTER (WHERE table_type = 'VIEW')::int AS views, count(*)::int AS relations FROM information_schema.tables WHERE table_schema IN ('zerow', 'neon_auth') GROUP BY table_schema ORDER BY table_schema",
    );
    const fingerprintRows = await readOnlyQuery(
      "fingerprint",
      "WITH columns AS (SELECT table_schema, table_name, ordinal_position, column_name, data_type, is_nullable, COALESCE(character_maximum_length::text, '') AS character_maximum_length, COALESCE(numeric_precision::text, '') AS numeric_precision, COALESCE(numeric_scale::text, '') AS numeric_scale, COALESCE(datetime_precision::text, '') AS datetime_precision FROM information_schema.columns WHERE table_schema IN ('zerow', 'neon_auth')) SELECT count(*)::int AS column_count, md5(string_agg(concat_ws('|', table_schema, table_name, ordinal_position, column_name, data_type, is_nullable, character_maximum_length, numeric_precision, numeric_scale, datetime_precision), E'\\n' ORDER BY table_schema, table_name, ordinal_position)) AS fingerprint FROM columns",
    );
    const markerRows = await readOnlyQuery(
      "markers",
      "SELECT table_schema, table_name, table_type FROM information_schema.tables WHERE table_schema IN ('zerow', 'neon_auth') AND (lower(table_name) LIKE '%migration%' OR lower(table_name) LIKE '%schema%' OR lower(table_name) LIKE '%version%' OR lower(table_name) LIKE '%marker%' OR lower(table_name) LIKE '%ledger%') ORDER BY table_schema, table_name",
    );
    const migrationMarkerRows = await readOnlyQuery(
      "migration_markers",
      "SELECT to_regclass('zerow.operation_revisions')::text AS operation_revisions, EXISTS (SELECT 1 FROM pg_proc AS p JOIN pg_namespace AS n ON n.oid = p.pronamespace WHERE n.nspname = 'zerow' AND p.proname = 'reject_append_only_mutation') AS reject_append_only_mutation, EXISTS (SELECT 1 FROM pg_trigger AS t JOIN pg_class AS c ON c.oid = t.tgrelid JOIN pg_namespace AS n ON n.oid = c.relnamespace WHERE n.nspname = 'zerow' AND t.tgname = 'company_timeline_append_only_mutation' AND NOT t.tgisinternal) AS company_timeline_append_only_mutation, EXISTS (SELECT 1 FROM pg_trigger AS t JOIN pg_class AS c ON c.oid = t.tgrelid JOIN pg_namespace AS n ON n.oid = c.relnamespace WHERE n.nspname = 'zerow' AND t.tgname = 'company_projection_append_only_mutation' AND NOT t.tgisinternal) AS company_projection_append_only_mutation",
    );
    const permissionRows = await readOnlyQuery(
      "permissions",
      "SELECT current_user AS runtime_role, has_schema_privilege(current_user, 'zerow', 'USAGE') AS zerow_schema_usage, has_schema_privilege(current_user, 'neon_auth', 'USAGE') AS neon_auth_schema_usage, has_table_privilege(current_user, 'zerow.event_store', 'SELECT') AS event_store_select, has_table_privilege(current_user, 'zerow.outbox', 'SELECT') AS outbox_select, has_table_privilege(current_user, 'neon_auth.user', 'SELECT') AS auth_user_select, has_table_privilege(current_user, 'neon_auth.session', 'SELECT') AS auth_session_select",
    );
    const readModelCount = async (label: string, statement: string): Promise<number | null> => {
      try {
        const rows = await readOnlyQuery(label, statement);
        return asNumber(asRows(rows)[0]?.row_count);
      } catch (error) {
        if (error instanceof NeonReadbackError && error.code.includes("neon_sql_42501")) {
          privilegeGaps.push(label);
          return null;
        }
        throw error;
      }
    };
    const readModels = {
      eventStoreRows: await readModelCount(
        "event_store",
        "SELECT count(*)::int AS row_count FROM zerow.event_store",
      ),
      outboxRows: await readModelCount(
        "outbox",
        "SELECT count(*)::int AS row_count FROM zerow.outbox",
      ),
      authUserRows: await readModelCount(
        "auth_user",
        "SELECT count(*)::int AS row_count FROM neon_auth.\"user\"",
      ),
      authSessionRows: await readModelCount(
        "auth_session",
        "SELECT count(*)::int AS row_count FROM neon_auth.session",
      ),
    };

    const runtime = asRows(runtimeRows)[0] ?? {};
    const fingerprint = asRows(fingerprintRows)[0] ?? {};
    const migrationMarkers = asRows(migrationMarkerRows)[0] ?? {};
    const permissions = asRows(permissionRows)[0] ?? {};

    return {
      status: privilegeGaps.length ? "partial" as const : "ok" as const,
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
      permissions: {
        runtimeRole: asString(permissions.runtime_role),
        zerowSchemaUsage: asBoolean(permissions.zerow_schema_usage),
        neonAuthSchemaUsage: asBoolean(permissions.neon_auth_schema_usage),
        eventStoreSelect: asBoolean(permissions.event_store_select),
        outboxSelect: asBoolean(permissions.outbox_select),
        authUserSelect: asBoolean(permissions.auth_user_select),
        authSessionSelect: asBoolean(permissions.auth_session_select),
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
      migrationMarkers: {
        operationRevisions: asString(migrationMarkers.operation_revisions),
        rejectAppendOnlyMutation: asBoolean(migrationMarkers.reject_append_only_mutation),
        companyTimelineAppendOnlyMutation: asBoolean(migrationMarkers.company_timeline_append_only_mutation),
        companyProjectionAppendOnlyMutation: asBoolean(migrationMarkers.company_projection_append_only_mutation),
      },
      privilegeGaps,
      readModels,
    };
  } catch (error) {
    if (error instanceof NeonReadbackError) throw error;
    const code = classifyNeonError(error);
    console.error("neon_readback_failed", code);
    throw new NeonReadbackError(code);
  }
}
