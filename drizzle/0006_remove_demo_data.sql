-- Remove only the seeded and QA-only rows from the Sites tenant.
-- Real tenant, membership and owner-created operational rows are preserved.
DELETE FROM `s06_outbox`
WHERE `event_id` IN (
  'evt-sites-001',
  'evt-sites-002',
  '21210e39-31d4-44cc-bd72-fb018fd267c9',
  'c6c35005-3bce-4623-b8cd-97b0d6519f7f'
);
--> statement-breakpoint
DELETE FROM `s06_reconciliations`
WHERE `id` IN (
  'recon-sites-001',
  'recon-sites-002',
  '4ad3c594-210a-49f9-9a81-f80c7d93a7dc',
  '5386ead6-00b3-4683-baac-f76ec76a58f2'
);
--> statement-breakpoint
DELETE FROM `s06_events`
WHERE `event_id` IN (
  'evt-sites-001',
  'evt-sites-002',
  '21210e39-31d4-44cc-bd72-fb018fd267c9',
  'c6c35005-3bce-4623-b8cd-97b0d6519f7f'
);
--> statement-breakpoint
DELETE FROM `s07_ai_ledger`
WHERE `id` IN ('ai-sites-001', 'ai-sites-002');
--> statement-breakpoint
DELETE FROM `s05_records`
WHERE `tenant_id` = 'sites:appgprj_6abaaf2bb58081919b265a8a6ad76dbb'
  AND `created_by` = 'sites-s05-seed';
--> statement-breakpoint
DELETE FROM `s04_records`
WHERE `tenant_id` = 'sites:appgprj_6abaaf2bb58081919b265a8a6ad76dbb'
  AND `created_by` = 'sites-s04-seed';
--> statement-breakpoint
DELETE FROM `qr_codes`
WHERE `id` = 'ASSET-QR-C940D6F8';
