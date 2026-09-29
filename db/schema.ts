import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
