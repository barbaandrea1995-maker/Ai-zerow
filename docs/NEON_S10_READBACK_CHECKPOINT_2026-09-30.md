# AI-ZEROW-COMMAND — S10 Neon readback checkpoint

## Esito

`PARTIALLY_VERIFIED · DIRECT NEON READBACK`

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
- `zerow_app` e `zerow_runtime`: login attivo, superuser/createdb/createrole/replication/bypassrls disattivati
- Uso schema `zerow`: concesso a entrambi i ruoli applicativi

## Gate ancora aperto

La ricerca originale identifica `db/migrations/0016_operation_reconciliation.sql` e
`db/migrations/0017_append_only_upsert_compatibility.sql`, ma il relativo progetto
di ricerca è diverso. Nel progetto autorizzato non è stata trovata una relazione
dedicata con nome migration/schema/marker/version che dimostri l'applicazione di
`0016/0017`. I campi `schema_version` e `aggregate_version` di `zerow.event_store`
sono versioni di dominio/evento, non un migration ledger.

Il Site conserva `DATABASE_URL` come secret e gli endpoint Neon Auth corretti nella
revision runtime 3, ma il codice Sites usa ancora D1 come readback canonico. Non
è stato eseguito alcun cutover automatico né alcuna scrittura su Neon.

## Decisione

S10 resta `AUTHORIZED + DEFERRED`, non `READY`. Il prossimo lavoro è implementare
un adapter Neon read-only compatibile con il runtime Sites, collegare la verifica
dei marker a uno SHA di deployment preciso e poi eseguire fixture Auth/tenant e
casi negativi cross-tenant.
