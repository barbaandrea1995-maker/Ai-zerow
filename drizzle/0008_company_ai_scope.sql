CREATE TABLE `company_ai_job_scopes` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`job_id` text NOT NULL,
	`job_code` text NOT NULL,
	`knowledge_pack_id` text NOT NULL,
	`knowledge_pack_version` text NOT NULL,
	`scope_text` text DEFAULT '' NOT NULL,
	`knowledge_entry_ids_json` text DEFAULT '[]' NOT NULL,
	`assumptions_json` text DEFAULT '[]' NOT NULL,
	`exclusions_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`source` text DEFAULT 'human-authored' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `company_ai_job_scopes_tenant_job_version_uq` ON `company_ai_job_scopes` (`tenant_id`,`job_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `company_ai_job_scopes_tenant_idempotency_uq` ON `company_ai_job_scopes` (`tenant_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `company_ai_job_scopes_tenant_job_updated_idx` ON `company_ai_job_scopes` (`tenant_id`,`job_id`,`updated_at`);