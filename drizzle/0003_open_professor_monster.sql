CREATE TABLE `qr_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`format` text DEFAULT 'QR' NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`label` text NOT NULL,
	`payload` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_scanned_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `qr_codes_tenant_payload_uq` ON `qr_codes` (`tenant_id`,`payload`);--> statement-breakpoint
CREATE INDEX `qr_codes_tenant_entity_updated_idx` ON `qr_codes` (`tenant_id`,`entity_type`,`entity_id`,`updated_at`);