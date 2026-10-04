# AI-ZEROW COMMAND — Location Intelligence checkpoint

Recorded: 2026-10-04 UTC  
Status: `POSTGIS PRODUCTION APPLIED · LEAST-PRIVILEGE RUNTIME CONFIGURED · READBACK DEPLOY PENDING`

Runtime configuration: Sites revision `7` contiene `DATABASE_URL` e
`LOCATION_DATABASE_URL` come secret server-side. `LOCATION_DATABASE_URL` usa
il ruolo `zerow_runtime`, limitato a SELECT sulle 12 tabelle Location
Intelligence, con RLS non bypassabile; `DATABASE_URL` resta separato per il
readback S10 owner-only legacy finché non viene certificata la sostituzione.
I valori non sono presenti nel repository e non vengono esposti nei readback.

## Decision boundary

La specifica `ZEROW_LOCATION_INTELLIGENCE_ENGINE v1.0.0` è stata introdotta
senza sostituire l’architettura Sites/D1 esistente. D1 espone ora il contratto
locale tenant-scoped e readback; la migrazione PostgreSQL/PostGIS è stata
applicata al branch Neon `production` tramite branch temporaneo verificato e
readback finale. Non viene eseguita da una route HTTP.

Il readback Neon ha verificato PostGIS 3.6.4, 12 tabelle Location Intelligence,
12/12 tabelle con RLS e policy tenant e una query spaziale `ST_DWithin`
funzionante. Provider, cutover applicativo e GPS grezzo restano separati:
Company AI non riceve campioni o coordinate grezze. Il nuovo readback runtime
PostGIS applica `zerow.tenant_id` nella stessa transazione, restituisce solo
stato/contatori e verifica che il ruolo non disponga di permessi di scrittura.

## Gate

| Gate | Stato locale | Limite ancora aperto |
|---|---|---|
| LOC-01 PostGIS foundation | `PRODUCTION + LEAST-PRIVILEGE ROLE APPLIED` | readback autenticato S10/status, test A/B e cutover applicativo |
| LOC-02 Geocoding | `ADAPTER READY` | `MAPBOX_ACCESS_TOKEN`, chiamata live e conferma su mappa |
| LOC-03 Geofence engine | `LOCAL + POSTGIS SMOKE PASS` | esecuzione con dati reali e test con poligoni reali |
| LOC-04 Tracking provider | `ADAPTER READY` | Traccar URL/token, webhook live, device reale |
| LOC-05 Tracking session | `LOCAL PASS` | collegamento automatico al turno Presenze e policy tenant runtime |
| LOC-06 Event engine | `LOCAL PASS` | burst GPS, worker/retry e osservabilità runtime |
| LOC-07 Delivery intelligence | `LOCAL PASS / DDT ADAPTER OPEN` | correlazione DDT/POD provider-backed e device evidence |
| LOC-08 Company AI tools | `LOCAL PASS` | OpenAI live autenticato e chiamata tool runtime |
| LOC-09 Privacy/security QA | `STATIC PASS / RUNTIME OPEN` | DPIA, retention, DPA, browser/device, E2E auth tenant A/B e sign-off umano |

## Contratti implementati

- location/geofence con coordinate confermate dall’utente e forma `CIRCLE` o
  `POLYGON`;
- registry tenant-scoped di provider, device e binding mezzo-device;
- tracking session vincolata a dipendente, turno, mezzo, device e policy
  confermata; sessione fuori dal perimetro autorizzato rifiutata;
- samples raw append-only con deduplicazione provider/evento;
- macchina deterministica `OUTSIDE → CANDIDATE_ENTER → INSIDE →
  CANDIDATE_EXIT → OUTSIDE`, due campioni coerenti, accuratezza massima 50 m,
  dwell di 90 secondi e isteresi di uscita;
- eventi derivati server-side per ingresso/uscita, magazzino, sito, cliente e
  fornitore;
- consegna `CONFIRMED` solo con evidenza ammessa e arrivo geofence confermato;
  l’arrivo GPS da solo non viene promosso a consegna;
- Company AI tools read-only e auditabili: fleet, veicolo, timeline autista,
  arrivi, partenze, consegne, route status/exception e veicoli in location;
- capability dedicate a localizzazione, default deny per i ruoli operativi non
  autorizzati, isolamento tenant lato server e audit delle letture sensibili;
- integrazione del contesto derivato nel Command AI senza accesso ai raw
  samples e senza scritture di dominio da parte dell’AI.

## Verifiche eseguite

- `pnpm build` — PASS
- `pnpm lint` — PASS, 7 warning `<img>` preesistenti/non bloccanti
- `pnpm verify:commercial` — PASS
- `pnpm audit:ui` — PASS_WITH_RUNTIME_GATES
- `pnpm audit:release` — PASS_WITH_EXTERNAL_GATES
- `pnpm audit:e2e` — PASS_WITH_AUTHENTICATED_GATE; E2E autenticato non eseguito
- Neon production readback — PASS: PostGIS 3.6.4, schema, RLS e query spaziale
- ruolo `zerow_runtime` — PASS statico su grant, `NOINHERIT` e `NOBYPASSRLS`

Il codice del readback runtime è pronto e l’ambiente Sites è alla revisione 7;
serve un nuovo deploy privato per renderlo attivo. Il readback S10 autenticato
resta da eseguire con una sessione owner reale.

## Prossimo checkpoint obbligatorio

1. pubblicare la revisione con il readback PostGIS e verificare `/api/location/status`;
2. verificare il readback S10 autenticato senza esporre la connection string;
3. configurare Mapbox e Traccar esclusivamente come secret server-side;
4. collegare `Presenze.check_in/check_out` alla apertura/chiusura sessione con
   policy tenant e informativa lavoratori;
5. collegare DDT/POD reale alla tabella di evidenza consegna;
6. configurare il ruolo `zerow_app` solo quando esisterà un writer PostGIS
   esplicitamente approvato e coperto da test append-only;
7. eseguire test autenticati A/B, replay webhook, idempotenza, retention e
   dispositivo reale; solo dopo valutare una pubblicazione autorizzata.
