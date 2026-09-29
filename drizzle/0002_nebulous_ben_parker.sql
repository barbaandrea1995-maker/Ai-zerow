CREATE TABLE `s05_records` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`module` text NOT NULL,
	`record_type` text DEFAULT 'proposal' NOT NULL,
	`title` text NOT NULL,
	`detail` text NOT NULL,
	`meta` text NOT NULL,
	`status` text NOT NULL,
	`tone` text DEFAULT 'lime' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `s05_records_tenant_module_updated_idx` ON `s05_records` (`tenant_id`,`module`,`updated_at`);--> statement-breakpoint
CREATE TABLE `s06_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`event_type` text NOT NULL,
	`schema_version` text DEFAULT '1' NOT NULL,
	`actor_type` text DEFAULT 'human' NOT NULL,
	`actor_id` text NOT NULL,
	`source` text DEFAULT 'sites-command' NOT NULL,
	`occurred_at` text NOT NULL,
	`observed_at` text NOT NULL,
	`aggregate_type` text NOT NULL,
	`aggregate_id` text NOT NULL,
	`aggregate_version` integer NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`correlation_id` text NOT NULL,
	`causation_id` text,
	`idempotency_key` text NOT NULL,
	`status` text DEFAULT 'COMMITTED' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `s06_events_tenant_idempotency_uq` ON `s06_events` (`tenant_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `s06_events_aggregate_version_uq` ON `s06_events` (`tenant_id`,`aggregate_type`,`aggregate_id`,`aggregate_version`);--> statement-breakpoint
CREATE INDEX `s06_events_tenant_occurred_idx` ON `s06_events` (`tenant_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `s06_events_tenant_aggregate_idx` ON `s06_events` (`tenant_id`,`aggregate_type`,`aggregate_id`,`aggregate_version`);--> statement-breakpoint
CREATE TABLE `s06_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`event_id` text NOT NULL,
	`topic` text NOT NULL,
	`status` text DEFAULT 'PENDING_EXTERNAL_CONSUMER' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `s06_outbox_tenant_event_uq` ON `s06_outbox` (`tenant_id`,`event_id`);--> statement-breakpoint
CREATE INDEX `s06_outbox_tenant_status_idx` ON `s06_outbox` (`tenant_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `s06_reconciliations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`aggregate_type` text NOT NULL,
	`aggregate_id` text NOT NULL,
	`expected_version` integer NOT NULL,
	`observed_version` integer NOT NULL,
	`status` text NOT NULL,
	`detail` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `s06_reconciliations_tenant_aggregate_idx` ON `s06_reconciliations` (`tenant_id`,`aggregate_type`,`aggregate_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `s07_ai_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`entry_type` text NOT NULL,
	`action_type` text NOT NULL,
	`command` text NOT NULL,
	`status` text NOT NULL,
	`approval_required` integer DEFAULT 0 NOT NULL,
	`related_action_id` text,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`requested_by` text NOT NULL,
	`approved_by` text,
	`readback_json` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `s07_ai_ledger_tenant_created_idx` ON `s07_ai_ledger` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `s07_ai_ledger_related_action_idx` ON `s07_ai_ledger` (`tenant_id`,`related_action_id`);--> statement-breakpoint

INSERT INTO `s05_records` (`id`, `tenant_id`, `module`, `record_type`, `title`, `detail`, `meta`, `status`, `tone`, `progress`, `payload_json`, `created_by`)
VALUES
('DOC-001', 'sites:appgprj_6abaaf2bb58081919b265a8a6ad76dbb', 'documents', 'read-model', 'Contratto manutenzione #4587', 'Catalogato e collegato alla commessa operativa', 'PDF · Via Roma · 12 pagine', 'CATALOGATO', 'lime', 92, '{"source":"sites-s05-seed"}', 'sites-s05-seed'),
('DOC-002', 'sites:appgprj_6abaaf2bb58081919b265a8a6ad76dbb', 'documents', 'proposal', 'Confronto preventivi Q3', 'Tre offerte pronte per analisi comparativa', '3 fornitori · 18 voci', 'IN REVIEW', 'cyan', 64, '{"source":"sites-s05-seed"}', 'sites-s05-seed'),
('DOC-003', 'sites:appgprj_6abaaf2bb58081919b265a8a6ad76dbb', 'documents', 'adapter-contract', 'Storage documentale', 'Upload, OCR e file provenance richiedono adapter', 'external boundary', 'ADAPTER', 'amber', 38, '{"source":"sites-s05-seed"}', 'sites-s05-seed'),
('FIN-001', 'sites:appgprj_6abaaf2bb58081919b265a8a6ad76dbb', 'finance', 'read-model', 'Costi commessa #4587', 'Consuntivo aggiornato dal read model Sites', '€ 18.420 · mese corrente', 'OPEN', 'lime', 78, '{"source":"sites-s05-seed"}', 'sites-s05-seed'),
('FIN-002', 'sites:appgprj_6abaaf2bb58081919b265a8a6ad76dbb', 'finance', 'proposal', 'Forecast operativo Q3', 'Scenario di spesa pronto per revisione', '3 scenari · +8%', 'IN REVIEW', 'cyan', 56, '{"source":"sites-s05-seed"}', 'sites-s05-seed'),
('FIN-003', 'sites:appgprj_6abaaf2bb58081919b265a8a6ad76dbb', 'finance', 'adapter-contract', 'Ledger contabile canonico', 'Scrittura contabile reale richiede servizio finance', 'external boundary', 'ADAPTER', 'amber', 32, '{"source":"sites-s05-seed"}', 'sites-s05-seed'),
('PO-001', 'sites:appgprj_6abaaf2bb58081919b265a8a6ad76dbb', 'procurement', 'proposal', 'Richiesta acquisto #PO-1042', 'Materiali per il presidio Team Alpha', '12 righe · € 4.860', 'PENDING APPROVAL', 'amber', 48, '{"source":"sites-s05-seed"}', 'sites-s05-seed'),
('PO-002', 'sites:appgprj_6abaaf2bb58081919b265a8a6ad76dbb', 'procurement', 'read-model', 'Ordini in transito', '18 ordini con consegna entro 48 ore', 'warehouse · 18 ordini', 'TRACKING', 'cyan', 72, '{"source":"sites-s05-seed"}', 'sites-s05-seed'),
('PO-003', 'sites:appgprj_6abaaf2bb58081919b265a8a6ad76dbb', 'procurement', 'adapter-contract', 'Executor purchase order', 'Invio a fornitore e conferma richiedono adapter', 'external boundary', 'ADAPTER', 'amber', 28, '{"source":"sites-s05-seed"}', 'sites-s05-seed'),
('GOV-001', 'sites:appgprj_6abaaf2bb58081919b265a8a6ad76dbb', 'governance', 'workflow-proposal', 'Policy accessi operativi', 'Workflow di revisione ruoli e permessi', 'owner review · 6 step', 'IN REVIEW', 'lime', 66, '{"source":"sites-s05-seed"}', 'sites-s05-seed'),
('GOV-002', 'sites:appgprj_6abaaf2bb58081919b265a8a6ad76dbb', 'governance', 'read-model', 'Audit boundary Sites', 'Readback di accessi e decisioni locali', 'append-only · tenant', 'ACTIVE', 'cyan', 84, '{"source":"sites-s05-seed"}', 'sites-s05-seed'),
('GOV-003', 'sites:appgprj_6abaaf2bb58081919b265a8a6ad76dbb', 'governance', 'adapter-contract', 'Policy engine canonico', 'Policy evaluation esterna ancora differita', 'external boundary', 'ADAPTER', 'amber', 24, '{"source":"sites-s05-seed"}', 'sites-s05-seed');--> statement-breakpoint

INSERT INTO `s06_events` (`event_id`, `tenant_id`, `event_type`, `schema_version`, `actor_type`, `actor_id`, `source`, `occurred_at`, `observed_at`, `aggregate_type`, `aggregate_id`, `aggregate_version`, `payload_json`, `correlation_id`, `idempotency_key`, `status`)
VALUES
('evt-sites-001', 'sites:appgprj_6abaaf2bb58081919b265a8a6ad76dbb', 'operation.created', '1', 'system', 'sites-s06-seed', 'sites-seed', '2026-09-29T00:00:00.000Z', '2026-09-29T00:00:00.000Z', 'operations', 'OP-4587', 1, '{"source":"sites-s06-seed"}', 'corr-sites-001', 'seed:operation-created:1', 'COMMITTED_SITES_READBACK'),
('evt-sites-002', 'sites:appgprj_6abaaf2bb58081919b265a8a6ad76dbb', 'approval.requested', '1', 'system', 'sites-s06-seed', 'sites-seed', '2026-09-29T00:01:00.000Z', '2026-09-29T00:01:00.000Z', 'procurement', 'PO-001', 1, '{"source":"sites-s06-seed"}', 'corr-sites-002', 'seed:approval-requested:1', 'COMMITTED_SITES_READBACK');--> statement-breakpoint

INSERT INTO `s06_outbox` (`id`, `tenant_id`, `event_id`, `topic`, `status`, `attempts`)
VALUES
('outbox-sites-001', 'sites:appgprj_6abaaf2bb58081919b265a8a6ad76dbb', 'evt-sites-001', 'zerow.operation.created', 'PENDING_EXTERNAL_CONSUMER', 0),
('outbox-sites-002', 'sites:appgprj_6abaaf2bb58081919b265a8a6ad76dbb', 'evt-sites-002', 'zerow.approval.requested', 'PENDING_EXTERNAL_CONSUMER', 0);--> statement-breakpoint

INSERT INTO `s06_reconciliations` (`id`, `tenant_id`, `aggregate_type`, `aggregate_id`, `expected_version`, `observed_version`, `status`, `detail`)
VALUES
('recon-sites-001', 'sites:appgprj_6abaaf2bb58081919b265a8a6ad76dbb', 'operations', 'OP-4587', 1, 1, 'SITES_READBACK_VERIFIED', 'Seed readback presente nel D1 Sites; consumer esterno differito.'),
('recon-sites-002', 'sites:appgprj_6abaaf2bb58081919b265a8a6ad76dbb', 'procurement', 'PO-001', 1, 1, 'SITES_READBACK_VERIFIED', 'Seed readback presente nel D1 Sites; consumer esterno differito.');--> statement-breakpoint

INSERT INTO `s07_ai_ledger` (`id`, `tenant_id`, `entry_type`, `action_type`, `command`, `status`, `approval_required`, `payload_json`, `requested_by`, `readback_json`)
VALUES
('ai-sites-001', 'sites:appgprj_6abaaf2bb58081919b265a8a6ad76dbb', 'command_preview', 'query', 'Quali lavori sono in corso?', 'PREVIEW_ONLY', 0, '{"source":"sites-s07-seed","directWrite":false}', 'sites-s07-seed', '{"status":"SITES_LEDGER_VERIFIED"}'),
('ai-sites-002', 'sites:appgprj_6abaaf2bb58081919b265a8a6ad76dbb', 'command_preview', 'procurement.request', 'Prepara richiesta acquisto materiali', 'PENDING_APPROVAL', 1, '{"source":"sites-s07-seed","directWrite":false}', 'sites-s07-seed', '{"status":"SITES_LEDGER_VERIFIED"}');
