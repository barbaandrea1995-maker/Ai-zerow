# AI-ZEROW COMMAND — Modulo 4 / Pianificazione checkpoint

**Data:** 2 ottobre 2026  
**Perimetro:** `PLANNING` / agenda operativa, attività, turni, risorse e pubblicazione  
**Baseline visiva:** COMMAND ultra-carbon / neon lime  
**Stato:** TECHNICAL PASS — PUBLISHED PRIVATELY · Sites version 93 · owner-only

## Decisione di dominio

Il modulo 4 è la cabina di regia della giornata. Non registra persone, autisti, mezzi o asset: riceve soltanto risorse già autorizzate dai registri Authority, Workforce e Asset.

La catena canonica è:

`Commessa o missione → sottogruppo scope → attività → finestra → risorse reali → verifica capacità → bozza → pubblicazione`

La pubblicazione è consentita solo dopo il nuovo controllo server-side di disponibilità, qualifiche, capacità, sovrapposizioni, versione e concorrenza.

## Riallineamento eseguito

- `/planning` ora usa la stessa shell di Command e Workforce: sidebar collassabile, topbar con logo ZEROW, ricerca centrale, tenant switcher, notifiche, profilo, back e refresh funzionanti.
- La pagina è stata ricostruita come control deck commerciale con KPI, agenda di oggi, registro perimetri, dettaglio del perimetro attivo e stato di readback.
- Sono visibili solo commesse e missioni consentite dalla capability del ruolo e dal tenant corrente.
- Il perimetro dello scope resta bloccato sulla commessa/missione selezionata; la pianificazione non introduce gruppi o sottogruppi liberi.
- La nuova attività seleziona solo persone, squadre, asset e mezzi presenti nel catalogo server e assegnabili nella finestra scelta.
- Aggiunti priorità, qualifiche richieste, luogo operativo e simulazione `what_if` senza persistenza.
- Bozza e pubblicazione restano collegate a `jobJourneyRecords`, eventi S06, outbox e reconciliation esistenti.
- La UI mostra capacità, conflitti, risorse assegnate, scope, attività odierne e piani pubblicati riletti dal server.
- I collegamenti verso Workforce, Presenze, Missioni e Company AI sono espliciti e non duplicano i loro contratti.

## Contratti mantenuti

- `GET /api/planning` resta tenant-scoped e protetto da `planning.read`.
- `POST /api/operations/jobs/:jobId/planning` mantiene `what_if`, `draft`, `revise` e `publish`, con idempotenza e optimistic version.
- `resource-options` resta il solo catalogo per l’assegnazione delle risorse operative.
- Authority governa identità e capability; Workforce governa le risorse autorizzate; Planning governa il piano; Presenze registra l’esecuzione; Missioni governa trasporto e consegna.
- Company AI può analizzare copertura e conflitti, ma non scrive direttamente nel piano.

## Verifiche locali

- TypeScript: **PASS**.
- ESLint: **PASS**, restano solo 8 warning legacy sulle immagini in moduli precedenti.
- Build Sites/Vinext: **PASS**.
- Verifica contratto commerciale: **PASS**.
- Audit superficie: **PASS_WITH_EXTERNAL_GATES**; nessun endpoint irrisolto, nessun gap di navigazione, nessun pulsante Command attivo non collegato.
- Smoke runtime locale: **NON RIPETIBILE IN QUESTA SESSIONE**; il container non consente la connessione alla porta locale (`EPERM`). Non viene dichiarata certificazione runtime browser.
- `git diff --check`: **PASS**.

## Pubblicazione

- Site: [AI-ZEROW COMMAND](https://ai-zerow-command.barba-andrea-1995.chatgpt.site)
- Versione pubblicata: **93**
- Audience: **custom owner-only** invariata

## Gate ancora espliciti

Il modulo è pronto come superficie commerciale Sites/D1 bounded. Map provider, telematica GPS reale, consumer esterni, privacy/retention e certificazione browser/device autenticata restano gate separati; non vengono dichiarati completati da questo checkpoint.
