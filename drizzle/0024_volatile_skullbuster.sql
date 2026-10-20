CREATE TABLE IF NOT EXISTS `finance_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`job_id` text,
	`category` text NOT NULL,
	`file_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`object_key` text NOT NULL,
	`storage_status` text DEFAULT 'STORED' NOT NULL,
	`scan_status` text DEFAULT 'NOT_RUN' NOT NULL,
	`provenance` text NOT NULL,
	`status` text DEFAULT 'QUARANTINED' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `finance_documents_tenant_hash_uq` ON `finance_documents` (`tenant_id`,`sha256`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `finance_documents_tenant_idempotency_uq` ON `finance_documents` (`tenant_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `finance_documents_tenant_created_idx` ON `finance_documents` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `finance_documents_tenant_job_created_idx` ON `finance_documents` (`tenant_id`,`job_id`,`created_at`);
