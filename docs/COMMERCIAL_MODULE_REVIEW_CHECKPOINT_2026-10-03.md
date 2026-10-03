# AI-ZEROW COMMAND — Revisione totale moduli / checkpoint 2026-10-03

## Obiettivo

Riallineare l'intera piattaforma dal primo all'ultimo modulo a livello commerciale, mantenendo invariati stack, autenticazione, isolamento tenant, contratti API, persistenza e regole di dominio. La revisione procede modulo per modulo e usa Command come fonte visiva e di interazione.

## Baseline verificata

- Site attivo: AI-ZEROW-COMMAND, pubblicazione privata owner-only.
- Versione pubblicata riletta: Sites v122.
- Commit pubblicato: `ab6c383763159881a03489fdba1f3b1ced37096e`.
- Route pagina: 31.
- Layout: 21, di cui 20 protetti.
- API route: 71.
- Navigazione Command: 18 voci.
- Endpoint referenziati dalla UI: 46; irrisolti: 0.
- Pulsanti analizzati: 520; binding sospetti: 0.
- `tsc --noEmit`: PASS.
- `verify:commercial`: PASS.
- `audit:release`: PASS_WITH_EXTERNAL_GATES.
- `audit:e2e`: PASS_WITH_AUTHENTICATED_GATE.

La base è quindi utilizzabile per la revisione; non è ancora una certificazione commerciale finale perché mancano prove autenticata E2E, browser/device e provider reali.

## Risultati dello studio

### Gap trasversali da chiudere prima della rifinitura modulo-per-modulo

1. **Shell duplicata:** sidebar, topbar, tenant switcher, ricerca, refresh, indietro, notifiche e profilo sono replicati in molte superfici con piccole differenze di markup, label, icone, spaziatura e comportamento.
2. **Gerarchia visuale non ancora uniforme:** Command usa il sistema ultra-carbon più completo; onboarding, impostazioni e alcune superfici legacy usano varianti proprie o override CSS strutturali.
3. **Controlli globali sovrapposti:** la rail globale di indietro/aggiorna/Command convive con azioni locali nei moduli; va mantenuta una sola gerarchia chiara per desktop e mobile.
4. **Responsive da rendere deterministico:** la navigazione bottom è correttamente limitata ai ruoli operativi, ma la shell desktop/tablet/mobile deve condividere lo stesso contratto di visibilità e lo stesso stato attivo.
5. **Stati commerciali da uniformare:** loading, empty, error, partial/readback, permission denied, approval required e provider unavailable devono avere la stessa grammatica visiva e lo stesso linguaggio.
6. **Provider non ancora certificati:** mappe reali, GPS/telematica, OpenAI live, OCR/malware, executor finance/procurement, comunicazioni/voice, osservabilità e device PWA restano gate espliciti.

## Metodo di revisione per ogni modulo

Ogni modulo viene chiuso solo dopo tre passaggi separati:

### A. Commercial UI/UX

- shell condivisa e responsive;
- palette/tokens Command, carbonio, lime e stati semantici;
- header, breadcrumb, titolo, KPI, filtri, contenuto principale e inspector;
- CTA primaria, azioni secondarie, back e refresh;
- modali/drawer centrati, non ingranditi automaticamente e navigabili da tastiera;
- loading, empty, error e permission state;
- mobile operativo coerente e target touch minimo 44 px;
- nessun testo tecnico inutile o stato inventato.

### B. Logica e collegamenti

- contesto tenant/ruolo/capability derivato dal server;
- cataloghi e disponibilità server-side;
- create/update/transition con idempotenza e versione;
- readback dopo ogni write;
- eventi, outbox, reconciliation e provenance;
- collegamenti espliciti verso i moduli upstream/downstream;
- nessun pulsante visualmente attivo senza handler, route o submit verificabile.

### C. Certificazione

- typecheck, lint, build e schema/migration check;
- audit route/API/pulsanti;
- smoke HTTP fail-closed;
- sessione autenticata con almeno Owner/Admin e ruolo operativo;
- isolamento tenant A/B;
- readback D1/Neon e verifica degli eventi;
- browser desktop/tablet/mobile e device PWA;
- provider smoke test e failure-mode test;
- checkpoint con stato `READY`, `PARTIAL`, `NOT_RUN` o `BLOCKED`.

## Ordine di avanzamento

| Ordine | Modulo | Focus della revisione | Stato attuale |
|---:|---|---|---|
| 01 | Command | shell canonica, widget, KPI, meteo/promemoria, map/AI states | Technical pass; visual source |
| 02 | Authority / Onboarding | profilo operativo tenant, ruoli multipli, capability, warehouse setup | Technical pass; provider/auth gate |
| 03 | Operations / Commesse | intake manuale/AI, preventivo DOCX, scope sottogruppo, workspace | Local core closed; provider gate |
| 04 | Pianificazione | attività giornaliera, capacity, conflitti, assegnazioni disponibili | Local advanced pass |
| 05 | Workforce / Presenze | squadre, turni, timestamp, geofence e GPS on-duty | Partial; device/provider gate |
| 06 | Asset / Mezzi | lifecycle, assegnabilità, manutenzione, handoff mission | Technical pass |
| 07 | Warehouse | catalogo, materiale senza barcode, QR, barcode, stock e movimenti | Technical pass; latest tranche |
| 08 | Mission / Trasporti | autista/mezzo/asset disponibili, dispatch, consegna, POD | Technical pass; GPS/map gate |
| 09 | Documents | catalogo, upload, provenance, sicurezza e documenti commessa | Technical pass; security provider gate |
| 10 | Finance / Procurement | workflow, approvazioni, ordini e ricezione | Technical pass; executor gate |
| 11 | Events / Twin / Timeline | ledger, outbox, retry, reconciliation e read model | Technical pass; consumer gate |
| 12 | Company AI / Governance | knowledge, scope, tool gateway, approval, readback | Technical pass; OpenAI live gate |
| 13 | Communications / Voice | avvisi, broadcast, acknowledgement e voice boundary | Technical pass; provider gate |
| 14 | Integrations / Adapters | registry, health, capability e promotion | Technical pass; provider gate |
| 15 | PWA / Mobile / Offline | shell operativa, queue, replay e install/device behavior | Technical pass; device gate |
| 16 | Security / Privacy / DR | audit, retention, restore, osservabilità e release no-go | Technical pass; provider/human gate |
| 17 | Release / GA | certificazione, evidenze, sign-off e promozione commerciale | No-go fino alla chiusura dei gate |

## Tranche di implementazione

### T01 — Shell commerciale condivisa

Estrarre e rendere canonici `CommandShell`, `CommandSidebar`, `CommandTopbar`, `ModuleHeader`, `ModuleActionRail`, `StatusBadge`, `ReadbackState` e `ResponsiveModuleLayout`. Command resta la fonte visiva; i moduli ricevono solo configurazione e contenuto di dominio.

### T02 — Command e Authority

Chiudere il contratto della shell, widget, KPI, meteo/promemoria, notifiche, personalizzazione e onboarding con profili operativi configurabili e ruoli multipli.

### T03 — Operations → Planning → Workforce/Presenze

Rendere lineare il percorso commessa → attività → squadra/persona → timbratura/evidenza, senza duplicare cataloghi o stato lato client.

### T04 — Asset → Warehouse → Mission

Rendere lineare il percorso asset/materiale → disponibilità → assegnazione → trasporto/consegna, con autista e mezzo selezionabili solo da risorse reali disponibili.

### T05 — Documents → Finance/Procurement → Events

Uniformare gli inspector, le approvazioni, i documenti di evidenza, gli eventi e il readback operativo.

### T06 — Company AI → Communications → Integrations

Collegare provider solo sui confini già dichiarati, con capability, approval, timeout, fallback e audit; nessun provider può diventare fonte autoritativa del dominio.

### T07 — PWA → Security/Privacy/DR → Release

Chiudere device, offline, osservabilità, restore, privacy, sicurezza e release evidence.

## Regola provider

I provider vengono collegati dopo la revisione UI/UX e dei contratti locali, in questo ordine:

1. OpenAI live per Company AI, con structured output, citazioni, rate limit, no-direct-write e readback.
2. Mappe/GPS/telematica per Mission, Presenze e Command.
3. OCR e malware scanning per Documents.
4. Executor finance/procurement e ricezione provider-backed.
5. Comunicazioni, voice, webhook firmati e acknowledgement.
6. Observability, alerting, backup/restore e device certification.

Ogni provider resta `NOT_RUN` o `DEFERRED` finché non esistono credenziali, contratto, ambiente, test positivo e test di errore. Non viene promosso a `READY` sulla sola presenza dell'adapter.

## Checkpoint di partenza

Questo documento è il checkpoint `REVISION-TOTAL-01`. La prossima tranche di lavoro è **T01 — Shell commerciale condivisa**, con audit visuale di Command come riferimento e senza modificare i contratti di dominio.

## T01 — stato eseguito

La prima tranche della revisione è stata applicata e verificata localmente:

- `/command` è ora il percorso canonico del control deck; i link legacy che puntavano a `/` sono stati riallineati.
- `COMMAND_NAVIGATION` è la fonte unica per il percorso e la capability di navigazione del Command; la superficie Command deriva da quel catalogo invece di duplicarlo.
- Le superfici W13, Company AI, Adapter ed Event Authority ricevono la stessa base `zw-app-shell` / `zw-command-ultra` e la stessa illuminazione carbon/lime.
- Authority, Security, Settings e Command espongono back/refresh locali; gli altri moduli mantengono la rail globale come fallback verificabile.
- È stato aggiunto il registro canonico [`config/commercial-modules.json`](../config/commercial-modules.json) per 19 superfici commerciali/account e lo script `pnpm run audit:ui`.
- L’audit UI verifica per modulo route, capability navigation, marchio ZEROW ufficiale, vocabolario carbon, back/refresh, comportamento mobile e stato dei gate runtime.

Evidence T01: `audit:ui` PASS_WITH_RUNTIME_GATES (19 superfici; 19 refresh locali, 19 back locali, fallback globale attivo), `audit:release` PASS_WITH_EXTERNAL_GATES, `audit:e2e` PASS_WITH_AUTHENTICATED_GATE (520 controlli, 0 sospetti), `verify:commercial` PASS, `tsc --noEmit` PASS, build PASS, lint PASS con 6 warning preesistenti di ottimizzazione `<img>`.

Stato T01: `PUBLISHED_PRIVATE / NOT_CERTIFIED_RUNTIME`. La tranche è pubblicata su Sites v122 con audience custom owner-only. Il browser autenticato, il device PWA e i provider esterni restano gate espliciti; la revisione non li considera chiusi sulla sola presenza del codice.

## Criterio di completamento

La roadmap sarà chiusa solo quando ogni modulo avrà:

- UI coerente e responsive;
- collegamenti funzionali verificati;
- permessi e tenant verificati server-side;
- readback e audit evidence;
- test E2E autenticato e cross-tenant;
- provider certificati oppure una decisione esplicita di esclusione;
- checkpoint aggiornato e release manifest;
- sign-off commerciale senza stati `NOT_RUN`, `BLOCKED` o `NO_GO` non dichiarati.
