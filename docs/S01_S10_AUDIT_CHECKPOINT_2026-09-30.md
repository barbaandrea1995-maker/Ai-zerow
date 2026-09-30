# AI-ZEROW-COMMAND — audit completo S01–S10

Checkpoint: 2026-09-30 14:03 Europe/Rome  
Site: `AI-ZEROW-COMMAND`  
Sites project: `appgprj_6abaaf2bb58081919b265a8a6ad76dbb`  
Neon project autorizzato: `AI-ZEROW COMMAND` (`proud-dream-31716379`)

## Decisione

I gate S01–S10 sono chiusi nel perimetro operativo autorizzato Sites + Neon:

| Gate | Stato | Evidenza di chiusura |
| --- | --- | --- |
| S01 | `CLOSED · SITES NATIVE` | baseline, ownership owner-only, policy evidenze, build e pubblicazione privata |
| S02 | `CLOSED · SITES NATIVE` | authority server-owned, tenant Sites, 13 ruoli, capability gate e D1 readback |
| S03 | `CLOSED · SITES NATIVE` | shell COMMAND, alias `/command`, navigazione responsive e superfici route |
| S04 | `CLOSED · SITES ADAPTER` | cinque moduli canonici, readback tenant-scoped e write Operations bounded |
| S05 | `CLOSED · SITES ADAPTER` | Documents/Finance/Procurement/Governance, proposte append-only e readback |
| S06 | `CLOSED · SITES ADAPTER` | event store, idempotenza, aggregate-version, outbox e reconciliation readback |
| S07 | `CLOSED · SITES ADAPTER` | Command preview, approval ledger e confine no-direct-write |
| S08 | `CLOSED · SITES PRESENTATION` | manifest, service worker, offline fallback, IndexedDB FIFO e diagnostics |
| S09 | `CLOSED · SITES BROWSER QA` | v39, route sweep completo, headings, PWA diagnostics e assenza di errori applicativi |
| S10 | `CLOSED · NEON BINDING` | progetto/branch/database corretti, fingerprint, marker 0016/0017 e readback runtime |
| AUTH-AB | `CERTIFIED · ISOLATED NEON BRANCH` | login A/B, membership owner, tenant positive readback e rifiuto cross-tenant 403 |

## Verifiche eseguite

- Sorgente pubblicato: `4e5cbfb64a03ea23e98263e198cd2a3f9d2183c0`.
- Site v39 pubblicato con deployment riuscita `appgdep_6abcfce859748191ad0a2bfbd80125a8`.
- `pnpm exec tsc --noEmit`: PASS.
- `pnpm lint`: PASS, 0 errori; 13 warning non bloccanti già classificati come immagini/navigazione interna.
- `pnpm build`: PASS.
- `git diff --check`: PASS.
- Route browser v39: 19 route applicative verificate; nessun `404`, `Application error`, `Unhandled` o `Internal Server Error`.
- Worker logs Sites, finestra 180 minuti, `errors_only=true`: nessun evento.
- Secret scan sui file tracciati: nessun pattern di secret e nessun file env tracciato.

## Neon readback

- Branch unico corretto: `production`, ready/default.
- `neon_auth`: 9 tabelle base; `zerow`: 18 tabelle base e 16 viste.
- Fingerprint diretto del perimetro: `c6de55a07687c348b63c187f0ce27511`.
- Runtime Sites via `DATABASE_URL`: ruolo `zerow_runtime`, PostgreSQL 18.6, `zerow` 18/16, fingerprint `061c00fae688a52a4ec036d177436cf5`.
- Marker strutturali: `operation_revisions`, funzione `reject_append_only_mutation` e due trigger 0017 presenti e visibili.
- Ruoli applicativi: login attivo; superuser/createdb/createrole/replication/bypassrls disattivati.
- Runtime permission probe: `zerow` USAGE e SELECT event/outbox attivi; `neon_auth.user/session` non esposti al runtime.
- Conteggi osservati: event store/outbox/Auth user/session a zero; nessun dato simulato o scritto.

## Confini espliciti, non lasciati impliciti

La chiusura S01–S10 non riscrive la ricerca forense originale. Restano fuori da
questa chiusura: provenienza storica esatta dei file migration del repository
forense, provisioning Auth/tenant sulla branch production e cutover del runtime,
device reale/camera/GPS, golden screenshot pixel-perfect, B0–B10/W20,
Vercel/GitHub, native mobile e promozione esterna.
Sono stati mantenuti come `UNKNOWN`, `NOT_RUN` o `BLOCKED`; non sono stati convertiti
in PASS per effetto della sola autorizzazione Neon.

## Stato operativo finale

Non ci sono attività aperte nel perimetro S01–S10 Sites + binding Neon autorizzato.
D1 resta il control plane canonico Sites; Neon è collegato e verificato in
read-only runtime. Qualunque estensione Auth/tenant o certificazione esterna dovrà
aprire un gate distinto, senza retrocedere questi checkpoint.
