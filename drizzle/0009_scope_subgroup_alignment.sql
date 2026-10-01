ALTER TABLE `company_ai_job_scopes` ADD `scope_level` text DEFAULT 'SUBGROUP' NOT NULL;--> statement-breakpoint
ALTER TABLE `company_ai_job_scopes` ADD `scope_section_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `company_ai_job_scopes` ADD `scope_group_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `company_ai_job_scopes` ADD `scope_subgroup_id` text DEFAULT '' NOT NULL;