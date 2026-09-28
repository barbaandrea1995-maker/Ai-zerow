import { sql } from "drizzle-orm";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";

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
