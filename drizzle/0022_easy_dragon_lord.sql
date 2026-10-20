CREATE TABLE IF NOT EXISTS `asset_custody_locations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`warehouse_id` text,
	`location_id` text,
	`status` text DEFAULT 'UNKNOWN' NOT NULL,
	`source` text DEFAULT 'ASSET_PROFILE' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`effective_at` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`warehouse_id`) REFERENCES `tenant_warehouses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `asset_custody_locations_tenant_asset_uq` ON `asset_custody_locations` (`tenant_id`,`asset_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `asset_custody_locations_tenant_warehouse_status_idx` ON `asset_custody_locations` (`tenant_id`,`warehouse_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `qr_code_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`alias_payload` text NOT NULL,
	`canonical_payload` text NOT NULL,
	`source_tenant_id` text,
	`reason` text NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `qr_code_aliases_tenant_alias_uq` ON `qr_code_aliases` (`tenant_id`,`alias_payload`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `qr_code_aliases_tenant_canonical_idx` ON `qr_code_aliases` (`tenant_id`,`canonical_payload`,`status`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tenant_alignment_links` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`source_tenant_id` text NOT NULL,
	`source_registry` text NOT NULL,
	`source_id` text NOT NULL,
	`target_tenant_id` text NOT NULL,
	`target_registry` text NOT NULL,
	`target_id` text,
	`resolution` text NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `tenant_alignment_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `tenant_alignment_links_source_uq` ON `tenant_alignment_links` (`source_tenant_id`,`source_registry`,`source_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `tenant_alignment_links_run_idx` ON `tenant_alignment_links` (`run_id`,`source_registry`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `tenant_alignment_links_target_idx` ON `tenant_alignment_links` (`target_tenant_id`,`target_registry`,`target_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tenant_alignment_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`source_tenant_id` text NOT NULL,
	`target_tenant_id` text NOT NULL,
	`contract_version` text NOT NULL,
	`manifest_hash` text NOT NULL,
	`status` text DEFAULT 'APPROVED' NOT NULL,
	`dry_run_json` text DEFAULT '{}' NOT NULL,
	`result_json` text DEFAULT '{}' NOT NULL,
	`approved_by` text NOT NULL,
	`approval_source` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`source_tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `tenant_alignment_runs_source_target_contract_uq` ON `tenant_alignment_runs` (`source_tenant_id`,`target_tenant_id`,`contract_version`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `tenant_alignment_runs_target_status_idx` ON `tenant_alignment_runs` (`target_tenant_id`,`status`,`updated_at`);
