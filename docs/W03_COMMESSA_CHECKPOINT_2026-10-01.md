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

