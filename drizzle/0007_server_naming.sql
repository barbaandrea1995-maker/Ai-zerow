CREATE TABLE `entity_code_counters` (
	`tenant_id` text NOT NULL,
	`namespace` text NOT NULL,
	`last_value` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`tenant_id`, `namespace`)
);
--> statement-breakpoint
ALTER TABLE `s04_records` ADD `canonical_code` text;--> statement-breakpoint
CREATE UNIQUE INDEX `s04_records_tenant_module_code_uq` ON `s04_records` (`tenant_id`,`module`,`canonical_code`);