CREATE TABLE IF NOT EXISTS `finance_document_extractions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`document_id` text NOT NULL,
	`source_sha256` text NOT NULL,
	`source_document_version` integer NOT NULL,
	`status` text DEFAULT 'PROCESSING' NOT NULL,
	`extraction_json` text,
	`provider_metadata_json` text DEFAULT '{}' NOT NULL,
	`failure_code` text,
	`version` integer DEFAULT 1 NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `finance_document_extractions_tenant_idempotency_uq` ON `finance_document_extractions` (`tenant_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `finance_document_extractions_tenant_document_created_idx` ON `finance_document_extractions` (`tenant_id`,`document_id`,`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `finance_document_extractions_tenant_status_created_idx` ON `finance_document_extractions` (`tenant_id`,`status`,`created_at`);
