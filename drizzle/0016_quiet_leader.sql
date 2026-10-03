CREATE TABLE `tenant_warehouses` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`location_label` text NOT NULL,
	`latitude_e6` integer NOT NULL,
	`longitude_e6` integer NOT NULL,
	`geofence_radius_meters` integer DEFAULT 100 NOT NULL,
	`location_source` text DEFAULT 'manual' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenant_warehouses_tenant_code_uq` ON `tenant_warehouses` (`tenant_id`,`code`);--> statement-breakpoint
CREATE INDEX `tenant_warehouses_tenant_status_idx` ON `tenant_warehouses` (`tenant_id`,`status`,`updated_at`);--> statement-breakpoint
ALTER TABLE `inventory_items` ADD `warehouse_id` text;--> statement-breakpoint
CREATE INDEX `inventory_items_tenant_warehouse_idx` ON `inventory_items` (`tenant_id`,`warehouse_id`,`updated_at`);--> statement-breakpoint
ALTER TABLE `tenant_invitations` ADD `roles_json` text DEFAULT '["member"]' NOT NULL;--> statement-breakpoint
ALTER TABLE `tenant_memberships` ADD `roles_json` text DEFAULT '["member"]' NOT NULL;--> statement-breakpoint
UPDATE `tenant_memberships` SET `roles_json` = '["' || `role` || '"]' WHERE `roles_json` = '["member"]';
