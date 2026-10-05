DROP INDEX `inventory_items_tenant_sku_uq`;--> statement-breakpoint
DROP INDEX `inventory_items_tenant_barcode_uq`;--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_items_tenant_warehouse_sku_uq` ON `inventory_items` (`tenant_id`,`warehouse_id`,`sku`);--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_items_tenant_warehouse_barcode_uq` ON `inventory_items` (`tenant_id`,`warehouse_id`,`barcode`);