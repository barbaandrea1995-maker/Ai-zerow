CREATE TABLE IF NOT EXISTS `job_stock_balances` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`register_id` text NOT NULL,
	`job_id` text NOT NULL,
	`inventory_item_id` text NOT NULL,
	`sku` text NOT NULL,
	`name` text NOT NULL,
	`unit` text NOT NULL,
	`on_hand_milli` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `job_stock_balances_tenant_job_item_uq` ON `job_stock_balances` (`tenant_id`,`job_id`,`inventory_item_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `job_stock_balances_tenant_register_idx` ON `job_stock_balances` (`tenant_id`,`register_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `job_stock_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`register_id` text NOT NULL,
	`job_id` text NOT NULL,
	`inventory_item_id` text NOT NULL,
	`warehouse_id` text,
	`mission_id` text,
	`movement_type` text NOT NULL,
	`quantity_milli` integer NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`idempotency_key` text NOT NULL,
	`actor_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `job_stock_movements_tenant_idempotency_uq` ON `job_stock_movements` (`tenant_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `job_stock_movements_tenant_job_created_idx` ON `job_stock_movements` (`tenant_id`,`job_id`,`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `job_stock_movements_tenant_item_created_idx` ON `job_stock_movements` (`tenant_id`,`inventory_item_id`,`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `job_stock_registers` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`job_id` text NOT NULL,
	`job_code` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`opened_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`closed_at` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `job_stock_registers_tenant_job_uq` ON `job_stock_registers` (`tenant_id`,`job_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `job_stock_registers_tenant_status_idx` ON `job_stock_registers` (`tenant_id`,`status`,`updated_at`);--> statement-breakpoint
INSERT OR IGNORE INTO `job_stock_registers`
  (`id`, `tenant_id`, `job_id`, `job_code`, `status`, `version`, `opened_at`, `closed_at`, `created_by`, `created_at`, `updated_at`)
SELECT
  'job-stock:' || `id`, `tenant_id`, `id`, `canonical_code`, 'ACTIVE', 1,
  `created_at`, NULL, `created_by`, `created_at`, `updated_at`
FROM `s04_records`
WHERE `module` = 'operations' AND `record_type` = 'job';--> statement-breakpoint
INSERT OR IGNORE INTO `job_stock_movements`
  (`id`, `tenant_id`, `register_id`, `job_id`, `inventory_item_id`, `warehouse_id`, `mission_id`,
   `movement_type`, `quantity_milli`, `source_type`, `source_id`, `note`, `idempotency_key`, `actor_id`, `created_at`)
SELECT
  'job-stock-movement:legacy:' || movement.`id`, movement.`tenant_id`, 'job-stock:' || movement.`job_id`, movement.`job_id`,
  movement.`item_id`, item.`warehouse_id`, NULL, 'TRANSFER_IN', movement.`quantity_milli`, 'DIRECT_PICKUP', movement.`id`,
  'Rilettura ritiro diretto precedente · ' || item.`name`, 'job-stock:legacy:' || movement.`id`, movement.`actor_id`, movement.`created_at`
FROM `inventory_movements` AS movement
INNER JOIN `inventory_items` AS item
  ON item.`tenant_id` = movement.`tenant_id` AND item.`id` = movement.`item_id`
INNER JOIN `job_journey_records` AS pickup
  ON pickup.`tenant_id` = movement.`tenant_id`
  AND pickup.`job_id` = movement.`job_id`
  AND pickup.`record_type` = 'MATERIAL_PICKUP'
  AND json_extract(pickup.`payload_json`, '$.movementId') = movement.`id`
WHERE movement.`job_id` IS NOT NULL
  AND movement.`mission_id` IS NULL
  AND movement.`movement_type` = 'PICK'
  AND movement.`quantity_milli` > 0;--> statement-breakpoint
INSERT OR IGNORE INTO `job_stock_movements`
  (`id`, `tenant_id`, `register_id`, `job_id`, `inventory_item_id`, `warehouse_id`, `mission_id`,
   `movement_type`, `quantity_milli`, `source_type`, `source_id`, `note`, `idempotency_key`, `actor_id`, `created_at`)
SELECT
  'job-stock-movement:legacy:' || movement.`id`, movement.`tenant_id`, 'job-stock:' || movement.`job_id`, movement.`job_id`,
  movement.`item_id`, item.`warehouse_id`, movement.`mission_id`, 'TRANSFER_IN', movement.`quantity_milli`, 'MISSION_DELIVERY', movement.`id`,
  'Rilettura consegna missione precedente · ' || item.`name`, 'job-stock:legacy:' || movement.`id`, movement.`actor_id`, movement.`created_at`
FROM `inventory_movements` AS movement
INNER JOIN `inventory_items` AS item
  ON item.`tenant_id` = movement.`tenant_id` AND item.`id` = movement.`item_id`
INNER JOIN `job_journey_records` AS mission
  ON mission.`tenant_id` = movement.`tenant_id`
  AND mission.`job_id` = movement.`job_id`
  AND mission.`id` = movement.`mission_id`
  AND mission.`record_type` = 'TRANSPORT'
WHERE movement.`job_id` IS NOT NULL
  AND movement.`mission_id` IS NOT NULL
  AND movement.`movement_type` = 'DELIVER'
  AND movement.`quantity_milli` > 0
  AND json_extract(mission.`payload_json`, '$.transportMode') = 'WAREHOUSE_TO_JOB';--> statement-breakpoint
INSERT OR IGNORE INTO `job_stock_balances`
  (`id`, `tenant_id`, `register_id`, `job_id`, `inventory_item_id`, `sku`, `name`, `unit`,
   `on_hand_milli`, `version`, `created_at`, `updated_at`)
SELECT
  'job-stock-balance:' || movement.`job_id` || ':' || movement.`inventory_item_id`, movement.`tenant_id`, movement.`register_id`,
  movement.`job_id`, movement.`inventory_item_id`, item.`sku`, item.`name`, item.`unit`, SUM(movement.`quantity_milli`),
  COUNT(*), MIN(movement.`created_at`), MAX(movement.`created_at`)
FROM `job_stock_movements` AS movement
INNER JOIN `inventory_items` AS item
  ON item.`tenant_id` = movement.`tenant_id` AND item.`id` = movement.`inventory_item_id`
GROUP BY movement.`tenant_id`, movement.`register_id`, movement.`job_id`, movement.`inventory_item_id`, item.`sku`, item.`name`, item.`unit`;
