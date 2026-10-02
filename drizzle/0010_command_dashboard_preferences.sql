CREATE TABLE `command_dashboard_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`layout_json` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `command_dashboard_preferences_tenant_actor_uq` ON `command_dashboard_preferences` (`tenant_id`,`actor_id`);--> statement-breakpoint
CREATE INDEX `command_dashboard_preferences_tenant_updated_idx` ON `command_dashboard_preferences` (`tenant_id`,`updated_at`);
