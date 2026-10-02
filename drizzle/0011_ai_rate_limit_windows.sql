CREATE TABLE `ai_rate_limit_windows` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`window_start` text NOT NULL,
	`request_count` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_rate_limit_windows_scope_uq` ON `ai_rate_limit_windows` (`tenant_id`,`actor_id`,`action`,`window_start`);--> statement-breakpoint
CREATE INDEX `ai_rate_limit_windows_tenant_updated_idx` ON `ai_rate_limit_windows` (`tenant_id`,`updated_at`);
