CREATE TABLE `w10_workflows` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`module` text NOT NULL,
	`record_type` text NOT NULL,
	`title` text NOT NULL,
	`detail` text NOT NULL,
	`status` text NOT NULL,
	`amount_milli` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`job_id` text,
	`supplier` text DEFAULT '' NOT NULL,
	`lines_json` text DEFAULT '[]' NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `w10_workflows_tenant_idempotency_uq` ON `w10_workflows` (`tenant_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `w10_workflows_tenant_module_updated_idx` ON `w10_workflows` (`tenant_id`,`module`,`updated_at`);--> statement-breakpoint
CREATE INDEX `w10_workflows_tenant_module_status_idx` ON `w10_workflows` (`tenant_id`,`module`,`status`,`updated_at`);