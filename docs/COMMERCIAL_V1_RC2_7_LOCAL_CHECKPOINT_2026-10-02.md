# AI-ZEROW COMMAND — Commercial v1 RC2.7 local checkpoint

**Data:** 2 ottobre 2026  
**Stato:** CANDIDATO LOCALE NON PUBBLICATO — NON CERTIFICATO COMMERCIALE  
**Parent locale:** `commercial-v1-rc2-6-local-2026-10-02`  
**Runtime pubblicato invariato:** Sites v84, deployment `appgdep_6abf3110bcb48191adf6a5b3fe432d84`  
**Build ID:** `ai-zerow-commercial-v1-rc2-7-local-r2026-10-02`  
**Commit codice candidato:** `9c77576b0fa8de5afc34a203baa87c565aee58a2`  
**Deploy:** non eseguito per rispettare il gate di certificazione commerciale.

## Chiusure locali aggiunte

- Company AI ha un endpoint W12 `GET /api/governance/ai-readiness` protetto da `governance.read`, tenant-scoped e senza restituzione di segreti.
- Il control plane separa i contratti locali pronti da binding OpenAI, prova live, registry esterno e sign-off commerciale.
- Ledger S07 e registry adapter vengono riletti dal server; se uno store non è disponibile lo stato resta `BLOCKED` e non vengono creati valori sostitutivi.
- Il confine `directWrite: false`, l’approval boundary, il filtro capability/context e la citation allowlist sono esposti come gate verificabili.
- Il Command espone un widget personalizzabile W12 con gate locali, entry ledger, binding server-side e `OpenAI live: NOT RUN`; per ruoli senza `governance.read` il dettaglio resta nascosto.
- Il runtime metadata helper viene condiviso con `/api/command/ai-status`, così la presenza del binding non viene scambiata per una chiamata live riuscita.

## Evidenza eseguita

| Controllo | Esito |
|---|---|
| TypeScript | PASS |
| ESLint | PASS; 8 warning preesistenti su `<img>` |
| Contract verifier + state fixtures | PASS |
| Production build | PASS |
| `git diff --check` | PASS |
| Company AI readiness contract | PASS LOCALE; no-direct-write e live gate espliciti |
| Browser/device certification | NOT RUN; CLI browser non disponibile nel workspace |
| Runtime live OpenAI | NOT RUN; richiede binding osservabile, sessione autenticata e runtime pubblicato |

## Gate ancora aperti

Il candidato resta `NO-GO` per la promozione commerciale finché non esistono evidenze esterne reali per OpenAI live, malware scanner provider-backed, invito Neon reale, consumer/esecutori esterni, certificazione browser/device e sign-off umano security/privacy/commerciale.

Il checkpoint è tecnico e locale. Non crea una nuova versione Sites e non autorizza il deploy.
