import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Canonical Cloudflare/D1 tenant directory. The Sites project tenant keeps
 * the existing read-model rows addressable while giving the application a
 * durable tenant record for membership and provisioning flows.
 */
export const tenants = sqliteTable("tenants", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"),
  operatingProfile: text("operating_profile").notNull().default("FULL_OPERATIONS"),
  operatingDomainsJson: text("operating_domains_json").notNull().default('["operations","warehouse","transport"]'),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  slugUnique: uniqueIndex("tenants_slug_uq").on(table.slug),
  statusIdx: index("tenants_status_idx").on(table.status),
  operatingProfileIdx: index("tenants_operating_profile_idx").on(table.operatingProfile, table.status),
}));

/**
 * Sites identity → D1 tenant membership projection. Identity values are
 * sourced from the server auth headers; the browser never supplies actorId.
 */
export const tenantMemberships = sqliteTable("tenant_memberships", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  identityProvider: text("identity_provider").notNull().default("sites"),
  actorId: text("actor_id").notNull(),
  actorEmail: text("actor_email").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role").notNull().default("owner"),
  status: text("status").notNull().default("active"),
  version: integer("version").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  tenantActorUnique: uniqueIndex("tenant_memberships_tenant_provider_actor_uq").on(table.tenantId, table.identityProvider, table.actorId),
  actorStatusIdx: index("tenant_memberships_actor_status_idx").on(table.actorId, table.status),
  tenantStatusIdx: index("tenant_memberships_tenant_status_idx").on(table.tenantId, table.status),
}));

/**
 * One-time tenant invitations. Only the SHA-256 token digest is persisted;
 * the raw token is returned once to an authorized administrator and must be
 * presented by an authenticated Neon identity with the same email address.
 */
export const tenantInvitations = sqliteTable("tenant_invitations", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  email: text("email").notNull(),
  role: text("role").notNull(),
  tokenHash: text("token_hash").notNull(),
  status: text("status").notNull().default("pending"),
  version: integer("version").notNull().default(1),
  expiresAt: text("expires_at").notNull(),
  invitedBy: text("invited_by").notNull(),
  acceptedBy: text("accepted_by"),
  acceptedAt: text("accepted_at"),
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  tokenUnique: uniqueIndex("tenant_invitations_token_uq").on(table.tokenHash),
  tenantIdempotencyUnique: uniqueIndex("tenant_invitations_tenant_idempotency_uq").on(table.tenantId, table.idempotencyKey),
  tenantEmailStatusIdx: index("tenant_invitations_tenant_email_status_idx").on(table.tenantId, table.email, table.status, table.updatedAt),
}));

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
 * Tenant-scoped counters used by the server-side naming policy. The counter
 * is advanced with one atomic SQLite upsert, so concurrent creates cannot
 * receive the same sequence number.
 */
export const entityCodeCounters = sqliteTable("entity_code_counters", {
  tenantId: text("tenant_id").notNull(),
  namespace: text("namespace").notNull(),
  lastValue: integer("last_value").notNull().default(0),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  tenantNamespacePk: primaryKey({ columns: [table.tenantId, table.namespace] }),
}));

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
  canonicalCode: text("canonical_code"),
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
}, (table) => ({
  tenantModuleCodeUnique: uniqueIndex("s04_records_tenant_module_code_uq").on(table.tenantId, table.module, table.canonicalCode),
}));

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
 * Sites-native W10 workflow records. These rows model the approval and
 * reconciliation state without pretending to be the canonical accounting or
 * supplier executor. Every transition is also written to the S06 event and
 * outbox surfaces by the workflow route.
 */
export const w10Workflows = sqliteTable("w10_workflows", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  module: text("module").notNull(),
  recordType: text("record_type").notNull(),
  title: text("title").notNull(),
  detail: text("detail").notNull(),
  status: text("status").notNull(),
  amountMilli: integer("amount_milli").notNull().default(0),
  currency: text("currency").notNull().default("EUR"),
  jobId: text("job_id"),
  supplier: text("supplier").notNull().default(""),
  linesJson: text("lines_json").notNull().default("[]"),
  payloadJson: text("payload_json").notNull().default("{}"),
  version: integer("version").notNull().default(1),
  idempotencyKey: text("idempotency_key").notNull(),
  createdBy: text("created_by").notNull(),
  updatedBy: text("updated_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  tenantIdempotencyUnique: uniqueIndex("w10_workflows_tenant_idempotency_uq").on(table.tenantId, table.idempotencyKey),
  tenantModuleUpdatedIdx: index("w10_workflows_tenant_module_updated_idx").on(table.tenantId, table.module, table.updatedAt),
  tenantModuleStatusIdx: index("w10_workflows_tenant_module_status_idx").on(table.tenantId, table.module, table.status, table.updatedAt),
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
 * Fixed-window quota for provider-backed AI requests. The composite key is
 * server-owned, so neither tenant nor actor can be forged by the browser.
 * Old windows are removed opportunistically by the rate-limit adapter.
 */
export const aiRateLimitWindows = sqliteTable("ai_rate_limit_windows", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(),
  windowStart: text("window_start").notNull(),
  requestCount: integer("request_count").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  tenantActorActionWindowUnique: uniqueIndex("ai_rate_limit_windows_scope_uq").on(
    table.tenantId,
    table.actorId,
    table.action,
    table.windowStart,
  ),
  tenantUpdatedIdx: index("ai_rate_limit_windows_tenant_updated_idx").on(table.tenantId, table.updatedAt),
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

/**
 * Human-authored scope links between a commessa and a Company AI knowledge
 * pack. The selected knowledge entries are kept as immutable pack references;
 * a new save creates a new version instead of overwriting the previous scope.
 */
export const companyAiJobScopes = sqliteTable("company_ai_job_scopes", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  jobId: text("job_id").notNull(),
  jobCode: text("job_code").notNull(),
  knowledgePackId: text("knowledge_pack_id").notNull(),
  knowledgePackVersion: text("knowledge_pack_version").notNull(),
  scopeLevel: text("scope_level").notNull().default("SUBGROUP"),
  scopeSectionId: text("scope_section_id").notNull().default(""),
  scopeGroupId: text("scope_group_id").notNull().default(""),
  scopeSubgroupId: text("scope_subgroup_id").notNull().default(""),
  scopeText: text("scope_text").notNull().default(""),
  /** Derived Company AI context only; never a user-selected scope level. */
  knowledgeEntryIdsJson: text("knowledge_entry_ids_json").notNull().default("[]"),
  assumptionsJson: text("assumptions_json").notNull().default("[]"),
  exclusionsJson: text("exclusions_json").notNull().default("[]"),
  status: text("status").notNull().default("DRAFT"),
  source: text("source").notNull().default("human-authored"),
  version: integer("version").notNull().default(1),
  idempotencyKey: text("idempotency_key").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  tenantJobVersionUnique: uniqueIndex("company_ai_job_scopes_tenant_job_version_uq").on(table.tenantId, table.jobId, table.version),
  tenantIdempotencyUnique: uniqueIndex("company_ai_job_scopes_tenant_idempotency_uq").on(table.tenantId, table.idempotencyKey),
  tenantJobUpdatedIdx: index("company_ai_job_scopes_tenant_job_updated_idx").on(table.tenantId, table.jobId, table.updatedAt),
}));

/**
 * Personal Command layout. Preferences are scoped by both tenant and the
 * server-derived actor identity; the browser can never select either key.
 */
export const commandDashboardPreferences = sqliteTable("command_dashboard_preferences", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  actorId: text("actor_id").notNull(),
  schemaVersion: integer("schema_version").notNull().default(1),
  layoutJson: text("layout_json").notNull().default("[]"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  tenantActorUnique: uniqueIndex("command_dashboard_preferences_tenant_actor_uq").on(table.tenantId, table.actorId),
  tenantUpdatedIdx: index("command_dashboard_preferences_tenant_updated_idx").on(table.tenantId, table.updatedAt),
}));

/**
 * Versioned records that close the commercial job journey without flattening
 * planning, field, warehouse, mission and document states into the commessa.
 */
export const jobJourneyRecords = sqliteTable("job_journey_records", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  jobId: text("job_id").notNull(),
  domain: text("domain").notNull(),
  recordType: text("record_type").notNull(),
  title: text("title").notNull(),
  status: text("status").notNull(),
  version: integer("version").notNull().default(1),
  payloadJson: text("payload_json").notNull().default("{}"),
  idempotencyKey: text("idempotency_key").notNull(),
  createdBy: text("created_by").notNull(),
  updatedBy: text("updated_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  tenantIdempotencyUnique: uniqueIndex("job_journey_records_tenant_idempotency_uq").on(table.tenantId, table.idempotencyKey),
  tenantJobDomainIdx: index("job_journey_records_tenant_job_domain_idx").on(table.tenantId, table.jobId, table.domain, table.updatedAt),
  tenantDomainStatusIdx: index("job_journey_records_tenant_domain_status_idx").on(table.tenantId, table.domain, table.status, table.updatedAt),
}));

/**
 * Canonical local inventory balance. Quantities are stored as thousandths of
 * the declared unit to avoid floating point drift in reservations/movements.
 */
export const inventoryItems = sqliteTable("inventory_items", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  sku: text("sku").notNull(),
  name: text("name").notNull(),
  unit: text("unit").notNull(),
  location: text("location").notNull().default("MAGAZZINO"),
  onHandMilli: integer("on_hand_milli").notNull().default(0),
  reservedMilli: integer("reserved_milli").notNull().default(0),
  minStockMilli: integer("min_stock_milli").notNull().default(0),
  status: text("status").notNull().default("ACTIVE"),
  version: integer("version").notNull().default(1),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  tenantSkuUnique: uniqueIndex("inventory_items_tenant_sku_uq").on(table.tenantId, table.sku),
  tenantStatusIdx: index("inventory_items_tenant_status_idx").on(table.tenantId, table.status, table.updatedAt),
}));

/** Append-only stock ledger with before/after balances and idempotency. */
export const inventoryMovements = sqliteTable("inventory_movements", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  itemId: text("item_id").notNull(),
  jobId: text("job_id"),
  missionId: text("mission_id"),
  movementType: text("movement_type").notNull(),
  quantityMilli: integer("quantity_milli").notNull(),
  beforeOnHandMilli: integer("before_on_hand_milli").notNull(),
  afterOnHandMilli: integer("after_on_hand_milli").notNull(),
  beforeReservedMilli: integer("before_reserved_milli").notNull(),
  afterReservedMilli: integer("after_reserved_milli").notNull(),
  note: text("note").notNull().default(""),
  idempotencyKey: text("idempotency_key").notNull(),
  actorId: text("actor_id").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  tenantIdempotencyUnique: uniqueIndex("inventory_movements_tenant_idempotency_uq").on(table.tenantId, table.idempotencyKey),
  tenantItemCreatedIdx: index("inventory_movements_tenant_item_created_idx").on(table.tenantId, table.itemId, table.createdAt),
  tenantJobCreatedIdx: index("inventory_movements_tenant_job_created_idx").on(table.tenantId, table.jobId, table.createdAt),
}));

/**
 * Document provenance and security state. Binary storage remains provider
 * backed; a metadata-only record can never be presented as a clean upload.
 */
export const operationalDocuments = sqliteTable("operational_documents", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  jobId: text("job_id").notNull(),
  category: text("category").notNull(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  objectKey: text("object_key").notNull(),
  storageStatus: text("storage_status").notNull().default("STORED"),
  scanStatus: text("scan_status").notNull().default("NOT_RUN"),
  provenance: text("provenance").notNull(),
  status: text("status").notNull().default("REGISTERED"),
  version: integer("version").notNull().default(1),
  idempotencyKey: text("idempotency_key").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  tenantJobHashUnique: uniqueIndex("operational_documents_tenant_job_hash_uq").on(table.tenantId, table.jobId, table.sha256),
  tenantIdempotencyUnique: uniqueIndex("operational_documents_tenant_idempotency_uq").on(table.tenantId, table.idempotencyKey),
  tenantJobCreatedIdx: index("operational_documents_tenant_job_created_idx").on(table.tenantId, table.jobId, table.createdAt),
}));
