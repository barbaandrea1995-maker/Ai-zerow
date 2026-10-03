# AI-ZEROW COMMAND — W12 Company AI, Tool Gateway & Approval checkpoint

**Data:** 3 ottobre 2026  
**Stato:** TECHNICAL PASS · PRIVATE OWNER-ONLY RELEASE  
**Release line:** Commercial v1 RC2.9-AUDIT-1 technical candidate · non certificato commerciale

## Esito

`/governance` è stato riallineato alla shell Command e ora espone il control plane Company AI completo nel perimetro Sites/D1. La schermata separa readiness locale, knowledge, scope, proposta, approval, tool boundary e readback. Non introduce esecuzione simulata né cambia i contratti di auth, tenant o dominio.

La pubblicazione resta privata e owner-only. Il checkpoint chiude la superficie di governance e i readback disponibili; non chiude i gate provider, runtime autenticati o sign-off commerciale.

## Contratto collegato

- `GET /api/governance/ai-readiness` resta capability-gated su `governance.read` e mostra gate, authority, runtime metadata, ledger, registry provider e blocchi commerciali.
- `GET /api/company-ai/knowledge` alimenta il registry ricercabile del pack tariffario, con part index, breadcrumbs, score, versione e contratto reference-only.
- `GET /api/operations` fornisce solo le commesse leggibili nel tenant corrente per lo scope inspector; un 403 non viene trasformato in dati demo.
- `GET /api/company-ai/scope?jobId=...` rilegge il binding della commessa, il knowledge pack e il context derivato; lo scope UI mostra sezione, raggruppamento e sottogruppo, senza scendere a una voce tariffaria come nodo di scope.
- `GET /api/command/overview` alimenta il ledger S07; `POST /api/command/approval` registra approve/reject solo con `approvals.review`, con eventi, outbox e reconciliation già governati dal contratto S07.

## Superficie UI/UX

- hero ultra-carbon con stato `NO-GO`, provider boundary e accesso diretto a Command;
- sidebar collassabile e header Command con ricerca centrale, refresh, notifiche, profilo/authority e icona ZEROW ufficiale;
- KPI per gate locali, ledger, knowledge entries, scope selezionato e `direct write BLOCKED`;
- cinque viste collegate: Readiness, Knowledge pack, Scope bindings, Approval ledger e Tool gateway;
- ricerca globale locale per filtrare gate, ledger e tool; ricerca knowledge server-side con filtro per parte;
- scope inspector con commesse reali, readback, contesto tariffario, provenance e human confirmation;
- approval ledger con azioni umane approve/reject, conferma esplicita e refresh del readback;
- tool gateway con capability, modalità `READ`, `REFERENCE`, `PROPOSAL`, `APPROVAL`, `EXECUTION` e stato `EXTERNAL_DEFERRED` dove l’executor non è osservato;
- mobile navigation funzionante, pulsante back verso Command, refresh e toast di errore leggibili.

## Invarianti mantenute

- `directWrite: false` resta visibile e verificabile;
- tenant, ruolo e capability non sono scelti dal client o dal prompt;
- nessun secret o valore di `OPENAI_API_KEY` viene restituito al browser;
- il knowledge pack è contesto di riferimento, non autorità di business;
- una decisione approval non viene presentata come esecuzione esterna riuscita;
- provider, consumer, mappe, GPS, OCR/malware e runtime live restano `NOT RUN`, `DEFERRED` o `EXTERNAL` quando manca evidenza.

## Verifiche eseguite

| Controllo | Esito |
|---|---|
| TypeScript | PASS |
| ESLint | PASS · 7 warning legacy `<img>` fuori dal modulo |
| build Vinext | PASS · 755 moduli client, 924 server, 752 RSC, 2635 client, 989 SSR |
| audit release surface | PASS_WITH_EXTERNAL_GATES · 31 page routes, 67 API routes, 43 endpoint references, nessun endpoint irrisolto |
| verify commercial static contract | PASS |
| `git diff --check` | PASS |
| runtime HTTP smoke locale | NOT RUN se il sandbox continua a bloccare `127.0.0.1:5173`/`::1:5173` con `EPERM` |
| browser/device certification | NOT RUN · sessione autenticata e harness device non disponibili |

## Gate ancora aperti

- richiesta OpenAI live autenticata con request id redatto e readback provider;
- consumer/worker ed executor esterni con retry, delivery e reconciliation canonici;
- provider mappe/GPS e telematica reale;
- OCR/malware provider, privacy/retention, osservabilità/SLO e restore rehearsal esterni;
- sessione Neon/Auth reale, browser/device/offline certification e sign-off umano security/privacy/commerciale.

## Decisione checkpoint

`W12 SITES TECHNICAL PASS` nel perimetro owner-only privato. La control deck è pubblicata per validazione del prodotto, ma la piattaforma resta `COMMERCIAL NO-GO` finché i gate esterni e umani sopra non risultano verificati.
