import { getDb } from "@/db";

const FINANCE_DOCUMENT_SCHEMA_DDL = [
  `CREATE TABLE IF NOT EXISTS finance_documents (
    id text PRIMARY KEY NOT NULL,
    tenant_id text NOT NULL,
    job_id text,
    category text NOT NULL,
    file_name text NOT NULL,
    mime_type text NOT NULL,
    size_bytes integer NOT NULL,
    sha256 text NOT NULL,
    object_key text NOT NULL,
    storage_status text DEFAULT 'STORED' NOT NULL,
    scan_status text DEFAULT 'NOT_RUN' NOT NULL,
    provenance text NOT NULL,
    status text DEFAULT 'QUARANTINED' NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    idempotency_key text NOT NULL,
    created_by text NOT NULL,
    created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS finance_documents_tenant_hash_uq ON finance_documents (tenant_id, sha256)",
  "CREATE UNIQUE INDEX IF NOT EXISTS finance_documents_tenant_idempotency_uq ON finance_documents (tenant_id, idempotency_key)",
  "CREATE INDEX IF NOT EXISTS finance_documents_tenant_created_idx ON finance_documents (tenant_id, created_at)",
  "CREATE INDEX IF NOT EXISTS finance_documents_tenant_job_created_idx ON finance_documents (tenant_id, job_id, created_at)",
  `CREATE TABLE IF NOT EXISTS finance_document_extractions (
    id text PRIMARY KEY NOT NULL,
    tenant_id text NOT NULL,
    document_id text NOT NULL,
    source_sha256 text NOT NULL,
    source_document_version integer NOT NULL,
    status text DEFAULT 'PROCESSING' NOT NULL,
    extraction_json text,
    provider_metadata_json text DEFAULT '{}' NOT NULL,
    failure_code text,
    version integer DEFAULT 1 NOT NULL,
    idempotency_key text NOT NULL,
    created_by text NOT NULL,
    created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS finance_document_extractions_tenant_idempotency_uq ON finance_document_extractions (tenant_id, idempotency_key)",
  "CREATE INDEX IF NOT EXISTS finance_document_extractions_tenant_document_created_idx ON finance_document_extractions (tenant_id, document_id, created_at)",
  "CREATE INDEX IF NOT EXISTS finance_document_extractions_tenant_status_created_idx ON finance_document_extractions (tenant_id, status, created_at)",
  "CREATE UNIQUE INDEX IF NOT EXISTS finance_document_extractions_active_source_uq ON finance_document_extractions (tenant_id, document_id, source_sha256) WHERE status IN ('PROCESSING', 'PROPOSED', 'REVIEW_REQUIRED')",
] as const;

let schemaReady: Promise<void> | null = null;

/** Sites can publish Worker code separately from D1 migrations. */
export function ensureFinanceDocumentSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const db = getDb();
      await db.$client.batch(FINANCE_DOCUMENT_SCHEMA_DDL.map((statement) => db.$client.prepare(statement)));
    })().catch((error: unknown) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}
