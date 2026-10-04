# AI-ZEROW COMMAND — Location Intelligence checkpoint

Recorded: 2026-10-04 UTC  
Status: `POSTGIS PRODUCTION APPLIED · RUNTIME CONFIGURED · DEPLOYED`

Runtime configuration: Sites revision `6` contiene `DATABASE_URL` e
`LOCATION_DATABASE_URL` come secret server-side, entrambi puntati al branch
Neon `production` tramite endpoint pooled. I valori non sono presenti nel
repository e non vengono esposti nei readback. La revisione è stata applicata
al Worker con il deploy privato della versione Location Intelligence.

## Decision boundary

La specifica `ZEROW_LOCATION_INTELLIGENCE_ENGINE v1.0.0` è stata introdotta
senza sostituire l’architettura Sites/D1 esistente. D1 espone ora il contratto
locale tenant-scoped e readback; la migrazione PostgreSQL/PostGIS è stata
applicata al branch Neon `production` tramite branch temporaneo verificato e
readback finale. Non viene eseguita da una route HTTP.

Il readback Neon ha verificato PostGIS 3.6.4, 12 tabelle Location Intelligence,
12/12 tabelle con RLS e policy tenant e una query spaziale `ST_DWithin`
funzionante. Provider, ruolo runtime, cutover applicativo e GPS grezzo restano
separati: Company AI non riceve campioni o coordinate grezze.

## Gate

| Gate | Stato locale | Limite ancora aperto |
|---|---|---|
| LOC-01 PostGIS foundation | `PRODUCTION READBACK VERIFIED` | ruolo runtime, setter tenant per sessione e cutover applicativo |
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

Deploy privato eseguito con successo dopo build e controlli statici. Il
readback S10 autenticato resta da eseguire con una sessione owner reale.

## Prossimo checkpoint obbligatorio

1. verificare il readback S10 autenticato senza esporre la connection string;
2. configurare Mapbox e Traccar esclusivamente come secret server-side;
3. collegare `Presenze.check_in/check_out` alla apertura/chiusura sessione con
   policy tenant e informativa lavoratori;
4. collegare DDT/POD reale alla tabella di evidenza consegna;
5. configurare il ruolo runtime Neon con setter tenant e readback applicativo;
6. eseguire test autenticati A/B, replay webhook, idempotenza, retention e
   dispositivo reale; solo dopo valutare una pubblicazione autorizzata.
