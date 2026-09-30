DROP INDEX `tenant_memberships_tenant_actor_uq`;--> statement-breakpoint
ALTER TABLE `tenant_memberships` ADD `identity_provider` text DEFAULT 'sites' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `tenant_memberships_tenant_provider_actor_uq` ON `tenant_memberships` (`tenant_id`,`identity_provider`,`actor_id`);