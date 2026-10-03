ALTER TABLE `inventory_items` ADD `storage_shelf` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `inventory_items` ADD `barcode` text;--> statement-breakpoint
ALTER TABLE `inventory_items` ADD `qr_code` text;--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_items_tenant_barcode_uq` ON `inventory_items` (`tenant_id`,`barcode`);--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_items_tenant_qr_code_uq` ON `inventory_items` (`tenant_id`,`qr_code`);