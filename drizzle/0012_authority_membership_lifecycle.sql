CREATE TABLE `tenant_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`token_hash` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`expires_at` text NOT NULL,
	`invited_by` text NOT NULL,
	`accepted_by` text,
	`accepted_at` text,
	`idempotency_key` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenant_invitations_token_uq` ON `tenant_invitations` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `tenant_invitations_tenant_idempotency_uq` ON `tenant_invitations` (`tenant_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `tenant_invitations_tenant_email_status_idx` ON `tenant_invitations` (`tenant_id`,`email`,`status`,`updated_at`);--> statement-breakpoint
ALTER TABLE `tenant_memberships` ADD `version` integer DEFAULT 1 NOT NULL;
