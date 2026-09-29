CREATE TABLE `s04_records` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`module` text NOT NULL,
	`record_type` text DEFAULT 'read-model' NOT NULL,
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

INSERT INTO `s04_records` (`id`, `tenant_id`, `module`, `record_type`, `title`, `detail`, `meta`, `status`, `tone`, `progress`, `payload_json`, `created_by`)
VALUES
('WF-021', 'sites:appgprj_6abaaf2bb58081919b265a8a6ad76dbb', 'workforce', 'read-model', 'Team Alpha', 'Turno mattina · Milano', '8 operatori', 'IN PRESIDIO', 'lime', 92, '{"source":"sites-s04-seed"}', 'sites-s04-seed'),
('WF-018', 'sites:appgprj_6abaaf2bb58081919b265a8a6ad76dbb', 'workforce', 'read-model', 'Team Beta', 'Turno pomeriggio · Sesto', '6 operatori', 'PIANIFICATO', 'cyan', 64, '{"source":"sites-s04-seed"}', 'sites-s04-seed'),
('WF-014', 'sites:appgprj_6abaaf2bb58081919b265a8a6ad76dbb', 'workforce', 'read-model', 'Luca Bianchi', 'Tecnico · qualifica HSE', 'Ultimo accesso 08:42', 'ONLINE', 'lime', 86, '{"source":"sites-s04-seed"}', 'sites-s04-seed'),
('WF-009', 'sites:appgprj_6abaaf2bb58081919b265a8a6ad76dbb', 'workforce', 'adapter-contract', 'Copertura qualifiche', 'Verifica rinnovi e scadenze', '4 profili da verificare', 'ADAPTER', 'amber', 38, '{"source":"sites-s04-seed"}', 'sites-s04-seed'),
('MAT-320', 'sites:appgprj_6abaaf2bb58081919b265a8a6ad76dbb', 'warehouse', 'read-model', 'Filtri idraulici', 'Magazzino Nord · scaffale B-04', '24 pezzi', 'DISPONIBILE', 'lime', 86, '{"source":"sites-s04-seed"}', 'sites-s04-seed'),
('MAT-118', 'sites:appgprj_6abaaf2bb58081919b265a8a6ad76dbb', 'warehouse', 'read-model', 'Kit sicurezza', 'Magazzino Centrale · scaffale A-12', '8 kit', 'SOTTO SOGLIA', 'amber', 32, '{"source":"sites-s04-seed"}', 'sites-s04-seed'),
('REQ-4587', 'sites:appgprj_6abaaf2bb58081919b265a8a6ad76dbb', 'warehouse', 'read-model', 'Richiesta commessa #4587', 'Via Roma · Team Alpha', 'Consegna oggi 14:00', 'IN PREPARAZIONE', 'cyan', 58, '{"source":"sites-s04-seed"}', 'sites-s04-seed'),
('SCAN-044', 'sites:appgprj_6abaaf2bb58081919b265a8a6ad76dbb', 'warehouse', 'adapter-contract', 'Riconciliazione scansioni', 'Ultimo batch da confermare', '6 elementi', 'ADAPTER', 'amber', 24, '{"source":"sites-s04-seed"}', 'sites-s04-seed'),
('MS-204', 'sites:appgprj_6abaaf2bb58081919b265a8a6ad76dbb', 'mission', 'read-model', 'Trasporto asset A-021', 'Milano → Bergamo · Team Alpha', 'ETA 14:20', 'IN TRANSITO', 'lime', 72, '{"source":"sites-s04-seed"}', 'sites-s04-seed'),
('MS-198', 'sites:appgprj_6abaaf2bb58081919b265a8a6ad76dbb', 'mission', 'read-model', 'Consegna materiali #4587', 'Magazzino Nord → Via Roma', 'Partenza 13:00', 'ASSEGNATA', 'cyan', 48, '{"source":"sites-s04-seed"}', 'sites-s04-seed'),
('MS-187', 'sites:appgprj_6abaaf2bb58081919b265a8a6ad76dbb', 'mission', 'read-model', 'Evidenza di consegna', 'Missione completata · firma raccolta', 'Ieri · 17:05', 'COMPLETATA', 'lime', 100, '{"source":"sites-s04-seed"}', 'sites-s04-seed'),
('MS-176', 'sites:appgprj_6abaaf2bb58081919b265a8a6ad76dbb', 'mission', 'adapter-contract', 'Riconciliazione missione', 'Differenza quantità da verificare', '2 evidenze mancanti', 'ADAPTER', 'amber', 26, '{"source":"sites-s04-seed"}', 'sites-s04-seed'),
('A-021', 'sites:appgprj_6abaaf2bb58081919b265a8a6ad76dbb', 'assets', 'read-model', 'Escavatore CAT 320', 'Team Alpha · matricola 320-21', 'Ultimo check 08:12', 'OPERATIVO', 'lime', 88, '{"source":"sites-s04-seed"}', 'sites-s04-seed'),
('A-109', 'sites:appgprj_6abaaf2bb58081919b265a8a6ad76dbb', 'assets', 'read-model', 'Furgone Fiat Ducato', 'Team Beta · Milano', 'Disponibile fino 18:00', 'OPERATIVO', 'lime', 74, '{"source":"sites-s04-seed"}', 'sites-s04-seed'),
('A-332', 'sites:appgprj_6abaaf2bb58081919b265a8a6ad76dbb', 'assets', 'read-model', 'Piattaforma aerea', 'Team Gamma · officina Nord', 'Rientro previsto domani', 'MANUTENZIONE', 'amber', 42, '{"source":"sites-s04-seed"}', 'sites-s04-seed'),
('A-447', 'sites:appgprj_6abaaf2bb58081919b265a8a6ad76dbb', 'assets', 'adapter-contract', 'Generatore 50kW', 'HQ · capacità disponibile', 'Ultima telemetria 09:04', 'ADAPTER', 'cyan', 66, '{"source":"sites-s04-seed"}', 'sites-s04-seed'),
('OP-4587', 'sites:appgprj_6abaaf2bb58081919b265a8a6ad76dbb', 'operations', 'read-model', 'Manutenzione impianto', 'Via Roma, Milano · Team Alpha', 'Oggi · 16:30', 'IN CORSO', 'lime', 68, '{"source":"sites-s04-seed"}', 'sites-s04-seed'),
('OP-4586', 'sites:appgprj_6abaaf2bb58081919b265a8a6ad76dbb', 'operations', 'read-model', 'Controllo sicurezza', 'Corso Italia, Milano · Team Beta', 'Oggi · 18:00', 'IN CORSO', 'cyan', 45, '{"source":"sites-s04-seed"}', 'sites-s04-seed'),
('OP-4585', 'sites:appgprj_6abaaf2bb58081919b265a8a6ad76dbb', 'operations', 'read-model', 'Installazione', 'Via Dante, Milano · Team Gamma', 'Domani · 07:30', 'PIANIFICATA', 'cyan', 6, '{"source":"sites-s04-seed"}', 'sites-s04-seed'),
('OP-4584', 'sites:appgprj_6abaaf2bb58081919b265a8a6ad76dbb', 'operations', 'adapter-contract', 'Ispezione periodica', 'Zona Industriale · Team Alpha', 'Ieri · 17:00', 'COMPLETATA', 'lime', 100, '{"source":"sites-s04-seed"}', 'sites-s04-seed');
