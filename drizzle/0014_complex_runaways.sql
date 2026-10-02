ALTER TABLE `tenants` ADD `operating_profile` text DEFAULT 'FULL_OPERATIONS' NOT NULL;--> statement-breakpoint
ALTER TABLE `tenants` ADD `operating_domains_json` text DEFAULT '["operations","warehouse","transport"]' NOT NULL;--> statement-breakpoint
CREATE INDEX `tenants_operating_profile_idx` ON `tenants` (`operating_profile`,`status`);