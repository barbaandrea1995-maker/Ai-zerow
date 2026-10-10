# AI-ZEROW COMMAND — Modulo 8 / Mission Control

**Data:** 3 ottobre 2026  
**Perimetro:** W08 / missioni, trasporti, asset in consegna, partenza, POD e riconciliazione  
**Baseline visiva:** COMMAND ultra-carbon / neon lime  
**Stato:** TECHNICAL PASS — pubblicazione privata owner-only

## Decisione di dominio

Mission è l'orchestratore del trasporto, non il registro di autisti, mezzi,
asset, stock o documenti. La missione consuma risorse dai registri canonici,
salva gli ID tenant-scoped e uno snapshot storico, poi conserva la journey
append-only con versione, eventi, outbox e reconciliation.

La catena operativa è:

    Authority → Workforce/Asset → Planning/Warehouse → Mission
      → dispatch → delivery/POD → POD verified → reconciliation → close

Un tenant può operare come solo trasporto, solo magazzino, magazzino +
trasporto oppure azienda completa. Il perimetro e le modalità di trasporto
arrivano dal profilo operativo tenant e non dal client.

## Riallineamento eseguito

- /mission ora usa la shell Command condivisa: sidebar collassabile, logo
  ZEROW ufficiale, ricerca centrale, tenant switcher, stato D1, back, refresh,
  comunicazioni capability-filtered e profilo.
- Il control deck espone KPI per totale, pianificate, in viaggio, POD,
  riconciliate e chiuse.
- Il registro supporta ricerca, filtro stato, selezione missione e inspector
  con tratta, finestra, modalità, snapshot di autista/mezzo/asset e versione.
- La creazione distingue commessa reale e missione autonoma. Una missione
  WAREHOUSE_TO_JOB richiede una commessa; una ASSET_TRANSFER richiede
  l'asset reale da consegnare.
- Autista, mezzo e asset vengono scelti esclusivamente da
  MissionResourceFields, che legge il catalogo tenant-scoped e filtra lifecycle
  e conflitti sulla finestra temporale. Non esiste testo libero per le risorse.
- La UI accompagna la state machine locale:
  PLANNED → DISPATCHED → DELIVERED → POD_VERIFIED → RECONCILED → CLOSED.
- I collegamenti portano a Commessa, Planning, Magazzino, Documenti e Command
  map surface senza duplicare i rispettivi registri.
- La route surface è volutamente schematica e dichiara GPS UNKNOWN: nessuna
  posizione o telemetria viene mostrata come live senza provider verificato.

## Contratti mantenuti

- GET /api/mission/control è tenant-scoped e capability-gated.
- POST /api/mission/control crea missioni autonome con risorse verificate e
  codice server-side.
- POST /api/operations/jobs/:jobId/journey crea missioni collegate e gestisce
  dispatch, delivery, POD verification, reconciliation e close.
- Ogni write richiede idempotencyKey; le transizioni richiedono recordId e
  expectedVersion.
- Il server rifiuta autista/mezzo in testo libero, risorse non operative,
  risorse occupate nella finestra, asset inesistenti e asset transfer senza
  asset selezionato.
- Il tenant, l'attore, le capability, la disponibilità e lo stato ufficiale
  non sono determinati dal client.

## Verifiche

- TypeScript: PASS.
- ESLint: PASS; restano solo 8 warning legacy sulle immagini di superfici
  precedenti.
- Build Sites/Vinext: PASS.
- Verifica contratto commerciale: PASS.
- Audit superficie: PASS_WITH_EXTERNAL_GATES; 67 API route, nessun endpoint
  irrisolto, nessun gap di navigazione e nessun pulsante Command attivo non
  collegato.
- git diff --check: PASS.
- Runtime browser autenticato, GPS/provider mappa, upload POD provider-backed,
  offline/replay e device certification: non certificati in questo ambiente.

## Gate ancora espliciti

Routing reale, telematica GPS, map provider, allegati POD sottoposti a security
hold, sincronizzazione offline, tracking continuo privacy-scoped e
certificazione browser/device restano gate separati. Il checkpoint certifica la
superficie Sites/D1 e i vincoli server-side, non un provider esterno assente.

## Pubblicazione

- Site: https://ai-zerow-command.barba-andrea-1995.chatgpt.site
- Accesso: custom owner-only invariato.
- Versione: latest private Sites publication verificata dopo il checkpoint.

## Riallineamento Missioni — 10 ottobre 2026

- La conferma consegna compare solo quando l’autista è sulla tappa corrente,
  la geofence l’ha agganciata e lo scarico è stato registrato. Rimossi i CTA
  generici che aprivano il POD prima di questi passaggi.
- Le azioni di carico/scarico sono mostrate solo a chi possiede
  `mission.delivery.execute`; la revisione rapportino segue
  `mission.report.review`, come il server.
- Company AI verifica gli eventi richiesti per ogni tappa: un trasferimento
  richiede carico e scarico, un rientro lo scarico, ogni consegna la propria
  conferma e prova POD.
- La scheda tratta legge lo stato tracking del readback missione e rinvia a
  Control per posizione e geofence. Non dichiara più indisponibile un provider
  senza consultare lo stato della missione.
- ESLint: PASS, 0 errori e 7 warning preesistenti sulle immagini. Build
  Sites/Vinext: PASS. `git diff --check`: PASS. Smoke autenticato browser e
  certificazione device non eseguiti in questo passaggio.
