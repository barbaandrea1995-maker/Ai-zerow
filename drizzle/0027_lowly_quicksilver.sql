CREATE TABLE IF NOT EXISTS `finance_document_links` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`document_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`status` text DEFAULT 'CONFIRMED' NOT NULL,
	`source` text DEFAULT 'HUMAN_REVIEW' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_by` text NOT NULL,
	`confirmed_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `finance_document_links_tenant_document_entity_uq` ON `finance_document_links` (`tenant_id`,`document_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `finance_document_links_tenant_idempotency_uq` ON `finance_document_links` (`tenant_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `finance_document_links_tenant_document_status_idx` ON `finance_document_links` (`tenant_id`,`document_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `finance_document_links_tenant_entity_status_idx` ON `finance_document_links` (`tenant_id`,`entity_type`,`entity_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `finance_document_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`document_id` text NOT NULL,
	`extraction_id` text NOT NULL,
	`source_sha256` text NOT NULL,
	`source_document_version` integer NOT NULL,
	`extraction_version` integer NOT NULL,
	`classification` text NOT NULL,
	`reviewed_fields_json` text NOT NULL,
	`economic_treatment` text DEFAULT 'DOCUMENT_ONLY' NOT NULL,
	`status` text NOT NULL,
	`review_note` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`idempotency_key` text NOT NULL,
	`reviewed_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `finance_document_reviews_tenant_idempotency_uq` ON `finance_document_reviews` (`tenant_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `finance_document_reviews_tenant_document_created_idx` ON `finance_document_reviews` (`tenant_id`,`document_id`,`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `finance_document_reviews_tenant_extraction_created_idx` ON `finance_document_reviews` (`tenant_id`,`extraction_id`,`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `finance_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`entry_type` text NOT NULL,
	`document_role` text,
	`category` text DEFAULT 'OTHER' NOT NULL,
	`description` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`effect_sign` integer DEFAULT 1 NOT NULL,
	`net_amount_minor` integer,
	`tax_amount_minor` integer,
	`gross_amount_minor` integer,
	`currency` text NOT NULL,
	`valuation_basis` text DEFAULT 'EXPLICIT' NOT NULL,
	`economic_date` text,
	`due_date` text,
	`counterparty_name` text DEFAULT '' NOT NULL,
	`counterparty_tax_id` text DEFAULT '' NOT NULL,
	`counterparty_verification` text DEFAULT 'UNVERIFIED' NOT NULL,
	`document_number` text DEFAULT '' NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`source_document_id` text,
	`status` text DEFAULT 'PENDING_APPROVAL' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`idempotency_key` text NOT NULL,
	`prepared_by` text NOT NULL,
	`confirmed_by` text,
	`confirmed_at` text,
	`reversed_by` text,
	`reversed_at` text,
	`reversal_reason` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `finance_entries_tenant_idempotency_uq` ON `finance_entries` (`tenant_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `finance_entries_tenant_source_type_uq` ON `finance_entries` (`tenant_id`,`source_type`,`source_id`,`entry_type`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `finance_entries_tenant_status_date_idx` ON `finance_entries` (`tenant_id`,`status`,`economic_date`,`updated_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `finance_entries_tenant_document_idx` ON `finance_entries` (`tenant_id`,`source_document_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `finance_entry_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`job_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `finance_entry_allocations_tenant_entry_job_uq` ON `finance_entry_allocations` (`tenant_id`,`entry_id`,`job_id`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `finance_entry_allocations_tenant_idempotency_uq` ON `finance_entry_allocations` (`tenant_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `finance_entry_allocations_tenant_job_status_idx` ON `finance_entry_allocations` (`tenant_id`,`job_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `finance_entry_allocations_tenant_entry_status_idx` ON `finance_entry_allocations` (`tenant_id`,`entry_id`,`status`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `finance_entry_relations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`relation_type` text NOT NULL,
	`related_entity_type` text NOT NULL,
	`related_entity_id` text NOT NULL,
	`amount_minor` integer,
	`currency` text,
	`status` text DEFAULT 'CONFIRMED' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `finance_entry_relations_tenant_relation_uq` ON `finance_entry_relations` (`tenant_id`,`entry_id`,`relation_type`,`related_entity_type`,`related_entity_id`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `finance_entry_relations_tenant_idempotency_uq` ON `finance_entry_relations` (`tenant_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `finance_entry_relations_tenant_related_idx` ON `finance_entry_relations` (`tenant_id`,`related_entity_type`,`related_entity_id`,`status`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `finance_entry_relations_tenant_entry_idx` ON `finance_entry_relations` (`tenant_id`,`entry_id`,`status`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `finance_reconciliation_issues` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`issue_code` text NOT NULL,
	`severity` text DEFAULT 'WARNING' NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`related_entity_type` text,
	`related_entity_id` text,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`detail_json` text DEFAULT '{}' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_by` text NOT NULL,
	`resolved_by` text,
	`resolved_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `finance_reconciliation_issues_tenant_idempotency_uq` ON `finance_reconciliation_issues` (`tenant_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `finance_reconciliation_issues_tenant_subject_status_idx` ON `finance_reconciliation_issues` (`tenant_id`,`subject_type`,`subject_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `finance_reconciliation_issues_tenant_status_severity_idx` ON `finance_reconciliation_issues` (`tenant_id`,`status`,`severity`,`updated_at`);
