import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Sites-native authority profiles.
 *
 * The tenant and creator are always supplied by the server authority context;
 * the browser can only submit a label and a canonical base role.
 */
export const accessProfiles = sqliteTable("access_profiles", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  label: text("label").notNull(),
  baseRole: text("base_role").notNull(),
  capabilitiesJson: text("capabilities_json").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

/**
 * Sites-side anti-corruption read model for the S04 domain surfaces.
 *
 * This table is deliberately tenant-scoped and stores the normalized fields
 * consumed by the Sites adapter. It is not presented as a replacement for
 * the canonical domain service; the adapter contract keeps that boundary
 * explicit until the external service is connected.
 */
export const s04Records = sqliteTable("s04_records", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  module: text("module").notNull(),
  recordType: text("record_type").notNull().default("read-model"),
  title: text("title").notNull(),
  detail: text("detail").notNull(),
  meta: text("meta").notNull(),
  status: text("status").notNull(),
  tone: text("tone").notNull().default("lime"),
  progress: integer("progress").notNull().default(0),
  payloadJson: text("payload_json").notNull().default("{}"),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

/**
 * Sites-native bounded read/write adapter for S05 domains.
 *
 * Records are append-only proposals/read models. The original domain
 * services (documents, finance, procurement and governance) remain an
 * explicit external boundary; this table is the durable Sites surface used
 * by the UI and its readback contract.
 */
export const s05Records = sqliteTable("s05_records", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  module: text("module").notNull(),
  recordType: text("record_type").notNull().default("proposal"),
  title: text("title").notNull(),
  detail: text("detail").notNull(),
  meta: text("meta").notNull(),
  status: text("status").notNull(),
  tone: text("tone").notNull().default("lime"),
  progress: integer("progress").notNull().default(0),
  payloadJson: text("payload_json").notNull().default("{}"),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  tenantModuleUpdatedIdx: index("s05_records_tenant_module_updated_idx").on(table.tenantId, table.module, table.updatedAt),
}));

/**
 * Sites-side event store. The uniqueness indexes preserve the important
 * idempotency and aggregate-version invariants without pretending to be the
 * canonical external event service.
 */
export const s06Events = sqliteTable("s06_events", {
  eventId: text("event_id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  eventType: text("event_type").notNull(),
  schemaVersion: text("schema_version").notNull().default("1"),
  actorType: text("actor_type").notNull().default("human"),
  actorId: text("actor_id").notNull(),
  source: text("source").notNull().default("sites-command"),
  occurredAt: text("occurred_at").notNull(),
  observedAt: text("observed_at").notNull(),
  aggregateType: text("aggregate_type").notNull(),
  aggregateId: text("aggregate_id").notNull(),
  aggregateVersion: integer("aggregate_version").notNull(),
  payloadJson: text("payload_json").notNull().default("{}"),
  correlationId: text("correlation_id").notNull(),
  causationId: text("causation_id"),
  idempotencyKey: text("idempotency_key").notNull(),
  status: text("status").notNull().default("COMMITTED"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  tenantIdempotencyUnique: uniqueIndex("s06_events_tenant_idempotency_uq").on(table.tenantId, table.idempotencyKey),
  aggregateVersionUnique: uniqueIndex("s06_events_aggregate_version_uq").on(table.tenantId, table.aggregateType, table.aggregateId, table.aggregateVersion),
  tenantOccurredIdx: index("s06_events_tenant_occurred_idx").on(table.tenantId, table.occurredAt),
  tenantAggregateIdx: index("s06_events_tenant_aggregate_idx").on(table.tenantId, table.aggregateType, table.aggregateId, table.aggregateVersion),
}));

export const s06Outbox = sqliteTable("s06_outbox", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  eventId: text("event_id").notNull(),
  topic: text("topic").notNull(),
  status: text("status").notNull().default("PENDING_EXTERNAL_CONSUMER"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  tenantEventUnique: uniqueIndex("s06_outbox_tenant_event_uq").on(table.tenantId, table.eventId),
  tenantStatusIdx: index("s06_outbox_tenant_status_idx").on(table.tenantId, table.status, table.updatedAt),
}));

export const s06Reconciliations = sqliteTable("s06_reconciliations", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  aggregateType: text("aggregate_type").notNull(),
  aggregateId: text("aggregate_id").notNull(),
  expectedVersion: integer("expected_version").notNull(),
  observedVersion: integer("observed_version").notNull(),
  status: text("status").notNull(),
  detail: text("detail").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  tenantAggregateIdx: index("s06_reconciliations_tenant_aggregate_idx").on(table.tenantId, table.aggregateType, table.aggregateId, table.updatedAt),
}));

/**
 * Append-only governed Command/Company AI ledger. A command preview, an
 * approval decision and a readback are separate entries; no direct domain
 * write is performed by this Sites adapter.
 */
export const s07AiLedger = sqliteTable("s07_ai_ledger", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  entryType: text("entry_type").notNull(),
  actionType: text("action_type").notNull(),
  command: text("command").notNull(),
  status: text("status").notNull(),
  approvalRequired: integer("approval_required").notNull().default(0),
  relatedActionId: text("related_action_id"),
  payloadJson: text("payload_json").notNull().default("{}"),
  requestedBy: text("requested_by").notNull(),
  approvedBy: text("approved_by"),
  readbackJson: text("readback_json"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  tenantCreatedIdx: index("s07_ai_ledger_tenant_created_idx").on(table.tenantId, table.createdAt),
  relatedActionIdx: index("s07_ai_ledger_related_action_idx").on(table.tenantId, table.relatedActionId),
}));

/**
 * Sites-native registry for generated operational codes. The payload is a
 * canonical, opaque token that can be decoded locally and resolved against
 * the tenant-scoped record context without a third-party QR service.
 */
export const qrCodes = sqliteTable("qr_codes", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  format: text("format").notNull().default("QR"),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  label: text("label").notNull(),
  payload: text("payload").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  lastScannedAt: text("last_scanned_at"),
}, (table) => ({
  tenantPayloadUnique: uniqueIndex("qr_codes_tenant_payload_uq").on(table.tenantId, table.payload),
  tenantEntityUpdatedIdx: index("qr_codes_tenant_entity_updated_idx").on(table.tenantId, table.entityType, table.entityId, table.updatedAt),
}));
