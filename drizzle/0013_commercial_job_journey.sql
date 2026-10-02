CREATE TABLE `inventory_items` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`sku` text NOT NULL,
	`name` text NOT NULL,
	`unit` text NOT NULL,
	`location` text DEFAULT 'MAGAZZINO' NOT NULL,
	`on_hand_milli` integer DEFAULT 0 NOT NULL,
	`reserved_milli` integer DEFAULT 0 NOT NULL,
	`min_stock_milli` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_items_tenant_sku_uq` ON `inventory_items` (`tenant_id`,`sku`);--> statement-breakpoint
CREATE INDEX `inventory_items_tenant_status_idx` ON `inventory_items` (`tenant_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `inventory_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`item_id` text NOT NULL,
	`job_id` text,
	`mission_id` text,
	`movement_type` text NOT NULL,
	`quantity_milli` integer NOT NULL,
	`before_on_hand_milli` integer NOT NULL,
	`after_on_hand_milli` integer NOT NULL,
	`before_reserved_milli` integer NOT NULL,
	`after_reserved_milli` integer NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`idempotency_key` text NOT NULL,
	`actor_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_movements_tenant_idempotency_uq` ON `inventory_movements` (`tenant_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `inventory_movements_tenant_item_created_idx` ON `inventory_movements` (`tenant_id`,`item_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `inventory_movements_tenant_job_created_idx` ON `inventory_movements` (`tenant_id`,`job_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `job_journey_records` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`job_id` text NOT NULL,
	`domain` text NOT NULL,
	`record_type` text NOT NULL,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_journey_records_tenant_idempotency_uq` ON `job_journey_records` (`tenant_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `job_journey_records_tenant_job_domain_idx` ON `job_journey_records` (`tenant_id`,`job_id`,`domain`,`updated_at`);--> statement-breakpoint
CREATE INDEX `job_journey_records_tenant_domain_status_idx` ON `job_journey_records` (`tenant_id`,`domain`,`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `operational_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`job_id` text NOT NULL,
	`category` text NOT NULL,
	`file_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`object_key` text NOT NULL,
	`storage_status` text DEFAULT 'STORED' NOT NULL,
	`scan_status` text DEFAULT 'NOT_RUN' NOT NULL,
	`provenance` text NOT NULL,
	`status` text DEFAULT 'REGISTERED' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `operational_documents_tenant_job_hash_uq` ON `operational_documents` (`tenant_id`,`job_id`,`sha256`);--> statement-breakpoint
CREATE UNIQUE INDEX `operational_documents_tenant_idempotency_uq` ON `operational_documents` (`tenant_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `operational_documents_tenant_job_created_idx` ON `operational_documents` (`tenant_id`,`job_id`,`created_at`);
