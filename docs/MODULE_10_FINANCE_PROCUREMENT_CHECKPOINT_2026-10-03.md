# AI-ZEROW COMMAND — W10 Finance & Procurement checkpoint

**Data:** 3 ottobre 2026  
**Stato:** TECHNICAL PASS · PRIVATE OWNER-ONLY RELEASE  
**Release line:** Commercial v1 RC2.9-AUDIT-1 technical candidate, not commercial certification

## Esito

Finance e Procurement avanzano dal workflow generico a un control deck Command coerente con il resto della piattaforma. Le due superfici condividono shell carbon/lime, authority server-side, registro filtrabile, inspector, KPI, ricerca, refresh, ritorno, cross-link operativi e dialog di creazione. La pubblicazione resta privata e owner-only.

Il perimetro chiuso è Sites/D1: proposta, approval, versioning, idempotenza, eventi, outbox e reconciliation. Nessuna azione provider-backed viene presentata come già eseguita.

## Contratto implementato

- `GET /api/finance/workflow` e `GET /api/procurement/workflow` restituiscono workflow tenant-scoped e, quando il ruolo può leggere Operations, il catalogo delle commesse reali.
- La nuova richiesta seleziona una commessa dal catalogo S04; non esiste un campo testo libero per `jobId`.
- Il server risolve l’ID o il codice canonico della commessa nel tenant corrente, scarta i record `adapter-contract` e rifiuta riferimenti inesistenti con `w10_job_not_found`.
- Il workflow conserva il solo `s04_records.id` canonico come relazione cross-modulo; la UI mostra codice, titolo, sede e stato riletti dal server.
- Finance segue `PROPOSED → REVIEW → APPROVED → RECONCILED`.
- Procurement segue `NEED → REQUESTED → REVIEW → APPROVED → PO_DRAFT → provider issue/receipt → RECONCILED`.
- Approval richiede `approvals.review`; le transizioni concorrenti usano `expectedVersion` e ogni mutazione richiede `idempotencyKey`.
- Le transizioni persistono evento, outbox e reconciliation; il readback è la fonte visibile dello stato.
- Le righe procurement espongono descrizione, quantità e unità, senza trasformarle in disponibilità di magazzino o ordine esterno.

## Superficie UI/UX

- sidebar Command collassabile con icona ufficiale ZEROW;
- topbar con ricerca, tenant switcher, stato D1, back, refresh, comunicazioni e profilo;
- hero differenziato per Finance e Procurement, KPI reali e registro ad alta densità;
- inspector con commessa, controparte, importo, versione, stato esterno e timestamp;
- azioni locali collegate al workflow; i passaggi provider-backed sono badge informativi `PROVIDER`, non pulsanti simulati;
- link reali verso Operations, Warehouse e Documents per mantenere il filo commessa → costo/materiale → evidenza;
- mobile responsive coerente con Command; la bottom navigation resta soggetta al profilo operativo e alle capability.

## Verifiche eseguite

| Controllo | Esito |
|---|---|
| TypeScript | PASS |
| lint | PASS · 8 warning legacy `<img>` fuori dal modulo |
| build Vinext | PASS · client/server/RSC/SSR compilati |
| audit release surface | PASS_WITH_EXTERNAL_GATES · endpoint W10 risolti, nessun gap Command attivo |
| verify commercial static contract | PASS |
| git diff check | PASS |
| runtime smoke locale | NOT RUN se il sandbox blocca `127.0.0.1:5173`/`::1:5173` con `EPERM` |
| browser/device certification | NOT RUN: sessione autenticata e harness device non disponibili |

## Gate ancora aperti

- adapter contabile reale e contabilizzazione provider-backed;
- emissione PO, ricezione fisica parziale/totale e pagamento con provider e callback verificati;
- catalogo fornitori, prezzi e documenti fiscali se non forniti da un sistema master;
- consumer outbox, osservabilità/SLO, privacy/retention e replay operativo;
- Company AI/OpenAI live su sessione autenticata e tool execution governata;
- browser/device certification, offline/replay e sign-off umano commerciale.

## Decisione checkpoint

`W10 SITES TECHNICAL PASS` nel perimetro owner-only privato. Finance e Procurement sono pronti per il prossimo gate di integrazione, ma non sono certificati come ERP, contabilità o procurement provider-backed e la roadmap commerciale resta `NO_GO` finché i gate sopra non sono chiusi.

## Collegamento valore commessa — 19 ottobre 2026

- La creazione commessa ammette lavorazioni miste con classificazione Company AI per singola voce; la classificazione complessiva è facoltativa. Tipologia (cantiere, pronto intervento, manutenzione) e classificazione tecnica sono campi distinti.
- Un eventuale valore preventivato o accordato viene scritto come record Finance versionato `JOB_COMMERCIAL_VALUE` nello stesso batch della commessa e letto da `/api/finance/portfolio` con tenant scope.
- La superficie Finanza presenta questi importi come valore atteso/accordato, senza aggregarli a fatture, costi, incassi o saldo.
- Centrale aggiunge `finance-job-kpi`, riservato a `finance.read`: il catalogo S04 delle commesse e il riepilogo sono riletti da `/api/finance/job-summary`; le voci W10 sono separate per stato e valuta. L’indice per tenant/modulo/commessa è nella migrazione `0023_jittery_invaders.sql`.
- Il contratto per fatture, bolle e documenti di cassa è in `docs/COMMESSA_FINANCE_IMPLEMENTATION_CONTRACT_2026-10-19.md`. Archivio e upload Finance sono stati aggiunti nel blocco successivo; scansione provider, estrazione Company AI e registri contabili restano gate futuri.
- Verifica eseguita in questo blocco: TypeScript PASS. Smoke runtime, test browser e deploy non eseguiti.

## Hardening follow-up — 10 ottobre 2026

- La richiesta di acquisto ora accetta più righe materiale (fino a 80), con quantità positive e precisione massima di tre decimali. Il server rifiuta righe incomplete, descrizioni/unità oltre il limite e quantità non rappresentabili invece di trasformarle in zero.
- Le righe create prima della correzione che contengono quantità zero sono mostrate come `quantità da verificare`, senza inventare un valore storico.
- Il catalogo commesse del W10 e il collegamento server-side rispettano lo scope operativo del chiamante; i ruoli standard che leggono Finance/Procurement restano back-office e mantengono il perimetro previsto.
- La capability `approvals.review` è separata dalla lettura Governance: Auditor può consultare evidenze e voci W10 ma non approvarle. L’approvazione resta disponibile a Owner, Amministratore, Manager e Ufficio.
- La risposta UI usa il campo API canonico `recordType`.
- Build Vinext: PASS dopo le modifiche W10 e Authority. Lint e prove runtime non sono state eseguite in questo follow-up.

## Archivio documenti Finance — 19 ottobre 2026

- Aggiunto `finance_documents`, separato dal registro operativo e con `jobId` facoltativo. Il server risolve ogni commessa collegata nel tenant corrente.
- `POST/GET /api/finance/documents` usa `finance.write/read`; upload verificato per MIME, firma, dimensione, SHA-256, idempotenza, deduplica e readback R2, con evento, outbox e reconciliation S06.
- I file sono archiviati in quarantena (`NOT_RUN` / `QUARANTINED`); download e Company AI restano bloccati fino a una scansione provider verificata.
- Il catalogo Documenti include le righe Finance solo con `finance.read`; il download e le transizioni di sicurezza distinguono il perimetro finanziario da `documents.read/write`.
- Finanza mostra l’intake con commessa facoltativa, classi documentali, riepilogo e stato. L’upload non crea scritture di costo, ricavo o cassa.
- Migrazione D1: `0024_volatile_skullbuster.sql`. TypeScript e `git diff --check`: PASS; smoke runtime, test browser e deploy non eseguiti.
