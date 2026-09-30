# AI-ZEROW-COMMAND — S10 Neon readback checkpoint

## Esito

`PARTIALLY_VERIFIED · DIRECT + SITES RUNTIME READBACK`

Recorded: `2026-09-30` (`Europe/Rome`). This checkpoint uses only the
authorized Neon project for AI-ZEROW-COMMAND; the forensic source project
`misty-lake-05077523` / `ZEROW-DEV` was not queried or modified.

## Binding verificato

- Neon project: `AI-ZEROW COMMAND` (`proud-dream-31716379`)
- Branch: `production` (`br-cool-king-zauea5pa`), ready and default
- Database: `neondb`
- Read-write endpoint: `ep-aged-flower-zakdq2d8`, region `aws-eu-west-2`
- Neon Auth: Better Auth presente sulla stessa branch
- Trusted origin: `https://ai-zerow-command.barba-andrea-1995.chatgpt.site`

## Readback osservato

- `neon_auth`: 9 tabelle base
- `zerow`: 18 tabelle base e 16 viste
- Column fingerprint del perimetro `zerow` + `neon_auth`: `c6de55a07687c348b63c187f0ce27511`
- `zerow.event_store`: 0 righe
- `zerow.outbox`: 0 righe
- `neon_auth.user`: 0 righe
- `neon_auth.session`: 0 righe
- Marker strutturali verificati nel progetto corretto: `zerow.operation_revisions`,
  `zerow.reject_append_only_mutation()` e i trigger
  `company_timeline_append_only_mutation` / `company_projection_append_only_mutation`
- `operation_revisions` espone 19 colonne attese; i trigger 0017 sono attivi su
  `zerow.company_timeline_entries` e `zerow.company_projection_revisions`
- `zerow_app` e `zerow_runtime`: login attivo, superuser/createdb/createrole/replication/bypassrls disattivati
- Uso schema `zerow`: concesso a entrambi i ruoli applicativi

## Sites runtime readback

La deployment Sites con source SHA `406f545ea050ff8f152adfe0c86593e0f76fd37f`
espone il readback owner-only in `/s10/readback` e `/api/neon/readback`. Il driver
HTTP Neon usa `DATABASE_URL` come binding secret e forza transazioni `READ ONLY`;
non esegue scritture né sostituisce il readback D1 canonico.

- Runtime role: `zerow_runtime`; database: `neondb`; PostgreSQL `18.6`
- Schema visibile al ruolo runtime: `zerow` con 18 tabelle base e 16 viste
- Fingerprint runtime visibile: 564 colonne, `061c00fae688a52a4ec036d177436cf5`
- `zerow.event_store`: 0 righe; `zerow.outbox`: 0 righe
- Gap espliciti: `neon_auth.user` e `neon_auth.session` non leggibili dal ruolo
  runtime (`insufficient_privilege`); non vengono stimati né simulati
- Marker runtime: `operation_revisions`, funzione di blocco e due trigger 0017
  risultano visibili anche al readback; la pagina non li interpreta come un
  migration ledger inventato

## Gate ancora aperto

La ricerca originale identifica `db/migrations/0016_operation_reconciliation.sql` e
`db/migrations/0017_append_only_upsert_compatibility.sql`, mentre il relativo
progetto forense è diverso. Nel progetto autorizzato la presenza strutturale dei
marker 0016/0017 è ora verificata; resta però non provata la provenienza esatta
da quei file/SHA e non esiste un migration ledger formale da interrogare. I campi
`schema_version` e `aggregate_version` di `zerow.event_store` sono versioni di
dominio/evento, non un migration ledger.

Il Site conserva `DATABASE_URL` come secret e gli endpoint Neon Auth corretti nella
revision runtime 3. Il percorso Sites read-only è ora verificato sul deployment
SHA indicato sopra, ma D1 resta il readback canonico. Non è stato eseguito alcun
cutover automatico né alcuna scrittura su Neon.

## Decisione

S10 resta `AUTHORIZED + DEFERRED`, non `READY`. Il binding runtime read-only è
`PARTIALLY_VERIFIED`; restano da definire il read scope least-privilege per
`neon_auth`, la provenienza esatta dei marker e le fixture Auth/tenant con casi
negativi cross-tenant.
