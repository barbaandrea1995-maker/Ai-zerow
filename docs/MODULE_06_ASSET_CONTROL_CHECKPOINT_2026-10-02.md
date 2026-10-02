# AI-ZEROW COMMAND — Modulo 6 / Asset, mezzi, attrezzature e manutenzione

**Data:** 2 ottobre 2026  
**Perimetro:** W06 / registro asset, flotta, attrezzature, lifecycle e manutenzione  
**Baseline visiva:** COMMAND ultra-carbon / neon lime  
**Stato:** TECHNICAL PASS — pubblicazione privata owner-only

## Decisione di dominio

W06 è il registro canonico delle risorse fisiche. Distingue asset, vehicle ed
equipment, assegna un codice server-side tenant-scoped e conserva l’identità
tecnica nel payload dell’asset. Non registra persone o autisti: Authority e
Workforce restano i registri autorizzativi; Planning e Mission consumano
risorse tramite riferimenti reali.

La catena operativa è:

    registrazione → codice canonico → lifecycle → guard assegnabilità
    → Planning/Mission → manutenzione/blocco → evento e reconciliation

## Riallineamento eseguito

- /assets ora usa una superficie Command dedicata, con sidebar collassabile,
  header coerente, ricerca, tenant switcher, back, refresh e capability filter.
- Il registro mostra KPI per disponibilità, manutenzione, blocco e mezzi.
- I filtri distinguono tipologia (asset, vehicle, equipment) e lifecycle.
- Il dettaglio tecnico mostra marca, modello, seriale, targa/identificativo,
  ubicazione, capacità e barcode.
- La registrazione guidata permette di inserire i dati tecnici senza chiedere
  testo libero per autisti o persone; il codice resta assegnato dal server.
- L’inspector collega la risorsa a Planning, Mission e QR/Barcode.
- Il board manutenzione evidenzia le risorse non assegnabili.
- Company AI è esposta come analisi read-only; non può bloccare o rilasciare
  direttamente un asset.

## Contratti mantenuti

- GET /api/assets/lifecycle legge soltanto il tenant corrente e restituisce
  contesto autorizzativo, asset e readback verificato.
- POST /api/assets conserva il contratto S04 di registrazione e assegna il
  codice canonico server-side.
- POST /api/assets/lifecycle richiede asset.write, assetId, idempotencyKey e
  motivazione per manutenzione/blocco.
- Le transizioni sono controllate server-side:
  AVAILABLE → MAINTENANCE/BLOCKED, MAINTENANCE → AVAILABLE/BLOCKED,
  BLOCKED → AVAILABLE.
- Ogni transizione usa optimistic versioning e produce evento, outbox e
  reconciliation D1.
- AVAILABLE equivale a ASSIGNABLE; manutenzione e blocco producono
  NOT_ASSIGNABLE.
- Tenant, ruolo, capability, identità e stato ufficiale non sono determinati
  dal client.

## Verifiche locali

- TypeScript: PASS.
- ESLint: PASS; restano solo warning legacy sulle immagini in superfici
  precedenti.
- Build Sites/Vinext: PASS.
- Verifica contratto commerciale: PASS.
- Audit superficie: PASS_WITH_EXTERNAL_GATES; nessun endpoint irrisolto e
  nessun gap di navigazione.
- git diff --check: PASS.
- Smoke browser/device autenticato e runtime locale: non certificati in questo
  ambiente; il container non consente l’apertura della porta locale con EPERM.

## Gate ancora espliciti

Telemetria continua, tracker GPS reale, provider mappe/routing, certificazioni,
documenti manutentivi provider-backed, offline/replay e device certification
restano gate separati. Questo checkpoint certifica la superficie Sites/D1 e i
confini server-side implementati, non un provider esterno non ancora collegato.

## Pubblicazione

- Site: https://ai-zerow-command.barba-andrea-1995.chatgpt.site
- Accesso: custom owner-only invariato.
- Versione: latest private Sites publication verificata dopo questo checkpoint.
