PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tenant_memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`identity_provider` text DEFAULT 'sites' NOT NULL,
	`actor_id` text NOT NULL,
	`actor_email` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text DEFAULT 'owner' NOT NULL,
	`roles_json` text DEFAULT '["member"]' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_tenant_memberships`("id", "tenant_id", "identity_provider", "actor_id", "actor_email", "display_name", "role", "roles_json", "status", "version", "created_at", "updated_at") SELECT "id", "tenant_id", "identity_provider", "actor_id", "actor_email", "display_name", "role", "roles_json", "status", "version", "created_at", "updated_at" FROM `tenant_memberships`;--> statement-breakpoint
DROP TABLE `tenant_memberships`;--> statement-breakpoint
ALTER TABLE `__new_tenant_memberships` RENAME TO `tenant_memberships`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `tenant_memberships_tenant_provider_actor_uq` ON `tenant_memberships` (`tenant_id`,`identity_provider`,`actor_id`);--> statement-breakpoint
CREATE INDEX `tenant_memberships_actor_status_idx` ON `tenant_memberships` (`actor_id`,`status`);--> statement-breakpoint
CREATE INDEX `tenant_memberships_tenant_status_idx` ON `tenant_memberships` (`tenant_id`,`status`);