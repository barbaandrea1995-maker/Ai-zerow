ALTER TABLE `tenants` ADD `legal_form` text DEFAULT 'OTHER' NOT NULL;--> statement-breakpoint
ALTER TABLE `tenants` ADD `vat_number` text;--> statement-breakpoint
ALTER TABLE `tenants` ADD `tax_code` text;--> statement-breakpoint
ALTER TABLE `tenants` ADD `rea_number` text;--> statement-breakpoint
ALTER TABLE `tenants` ADD `registered_address` text;--> statement-breakpoint
ALTER TABLE `tenants` ADD `registered_postal_code` text;--> statement-breakpoint
ALTER TABLE `tenants` ADD `registered_city` text;--> statement-breakpoint
ALTER TABLE `tenants` ADD `registered_province` text;--> statement-breakpoint
ALTER TABLE `tenants` ADD `registered_country` text DEFAULT 'IT' NOT NULL;--> statement-breakpoint
ALTER TABLE `tenants` ADD `business_email` text;--> statement-breakpoint
ALTER TABLE `tenants` ADD `business_phone` text;--> statement-breakpoint
ALTER TABLE `tenants` ADD `pec_email` text;--> statement-breakpoint
ALTER TABLE `tenants` ADD `sdi_code` text;--> statement-breakpoint
ALTER TABLE `tenants` ADD `website` text;--> statement-breakpoint
CREATE INDEX `tenants_vat_number_idx` ON `tenants` (`vat_number`);