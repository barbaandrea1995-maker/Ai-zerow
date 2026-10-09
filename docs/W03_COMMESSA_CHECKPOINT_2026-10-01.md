# AI-ZEROW-COMMAND — W03 Commessa checkpoint

**Data:** 1 ottobre 2026  
**Baseline di partenza:** `baseline-ai-zerow-sites-v65-2026-10-01`  
**Stato:** IMPLEMENTED — Sites bounded tranche  
**Confine:** Sites/D1 tenant-scoped; nessuna certificazione esterna implicita.

## Cosa è stato chiuso

- `POST /api/operations` crea una commessa con codice server-side progressivo (`COMM-0001`, …).
- La commessa salva titolo, descrizione, cliente, ubicazione, categoria, priorità, scadenza e stato.
- La creazione è tenant-scoped, autorizzata da `operations.write` e accompagnata da evento, outbox e reconciliation readback.
- L’idempotency key impedisce la doppia creazione della stessa richiesta.
- `GET /api/operations` restituisce il registro tenant-scoped con il payload W03.
- `GET /api/operations/jobs/:jobId` restituisce Job Workspace, versione, journey e sezioni cross-domain senza lookup non autorizzati.
- `PATCH /api/operations/jobs/:jobId` supporta:
  - transizioni di stato controllate;
  - aggiornamento avanzamento;
  - aggiunta e completamento attività;
  - assegnazione responsabile/squadra;
  - registrazione evidenze;
  - salvataggio rapportino;
  - modifica della scheda commessa;
  - optimistic version check e idempotenza.
- Ogni mutazione aggiorna la versione, scrive evento/outbox/reconciliation e restituisce readback verificato.
- La UI Operations e il Job Workspace mostrano gli stati `BOZZA`, `PROPOSTA`, `APPROVATA`, `PIANIFICATA`, `IN CORSO`, `BLOCCATA`, `COMPLETATA` e `CHIUSA` con azioni coerenti.
- La UI mantiene la shell, la palette, i moduli, le card e il linguaggio visuale della baseline v65.

## Riallineamento compilazione e chiusura — fotografie di riferimento

- La nuova commessa parte da una scelta esplicita: `Crea da preventivo con Company AI` oppure `Compila manualmente`.
- Entrambi i percorsi usano la stessa scheda canonica con i due soli tipi `Nuova commessa` e `Pronto intervento`.
- La classificazione segue `tipo → sezione → raggruppamento → sottogruppo`; lo scope si arresta al sottogruppo.
- Le singole voci tariffarie restano contesto Company AI e non diventano categorie della commessa.
- Company AI produce una preview governata, propone i campi con fonte e confidenza, registra la preview nel ledger S07 e non scrive la commessa senza conferma umana.
- La scheda resta modificabile e viene salvata inizialmente come `BOZZA`; il 100% dell’avanzamento non cambia automaticamente lo stato.
- Il passaggio a `COMPLETATA` è rifiutato server-side finché non risultano completi contesto, luogo, assegnazione, attività, evidenza, rapportino e avanzamento.

## Flusso verificabile

```text
crea commessa
→ apri workspace
→ modifica scheda
→ invia in proposta / approva / pianifica / avvia
→ aggiungi attività
→ assegna responsabile e squadra
→ aggiorna avanzamento
→ registra evidenza
→ completa attività
→ salva rapportino
→ verifica requisiti di completamento
→ completa e chiudi
→ rileggi versione, eventi e stato
```

## Gate tecnici passati

- TypeScript: pass.
- ESLint sui file W03: pass; resta un warning preesistente nella navigazione legacy della pagina Operations.
- Build Sites/Vinext: pass.
- Route prodotte: `/api/operations` e `/api/operations/jobs/:jobId` incluse nell’artefatto.
- `git diff --check`: pass.

## Confini ancora aperti

W03 non dichiara completati i servizi esterni di planning, workforce, FIELD, asset, warehouse, mission, documents o finance. Le sezioni cross-domain restano `EMPTY` o `DEFERRED` quando non esiste un record adapter-backed verificato. Il prossimo verticale è W04 Planning, già compatibile con il contratto `jobId`, versione e assignment introdotto qui.

## Avanzamento rapportino giornaliero Company AI — 9 ottobre 2026

- Il responsabile apre il colloquio Company AI dopo la timbratura di uscita dalla scheda Presenze assegnata oppure dalla scheda della commessa.
- Il colloquio raccoglie tre contributi umani: attività ed esito, criticità e sicurezza, prossimi passi e richieste. Le risposte vengono salvate come bozza a ogni passaggio e il responsabile può riprendere dalla prima risposta mancante.
- Le domande sono generate server-side tramite il provider OpenAI già configurato, con contesto ristretto ai riepiloghi della giornata, alle attività della commessa e alle risposte precedenti. In caso di provider non configurato, errore o rate limit si usano le domande standard.
- Il modello non riceve coordinate GPS grezze e non scrive su commessa, presenze, materiali o asset. Il server compone il rapportino usando i registri verificati e le risposte del responsabile.
- L’invio resta bloccato finché non sono presenti le tre risposte, un’uscita valida, l’assegnazione e il luogo verificato con geofence. Le precondizioni per portare la commessa a `COMPLETATA` restano controllate server-side.
- `npm run build` e `git diff --check`: pass locale. Non è stato eseguito uno smoke autenticato del nuovo endpoint; il secret OpenAI è configurato su Sites, ma questa specifica interazione live resta da verificare dopo la pubblicazione.
- Stato della tranche: implementata e compilata localmente, non pubblicata. Il workflow Sites richiesto non è disponibile nel workspace corrente, quindi il codice non è stato caricato sulla PWA.
