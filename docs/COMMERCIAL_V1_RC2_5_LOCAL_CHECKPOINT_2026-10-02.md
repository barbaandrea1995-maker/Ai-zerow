# AI-ZEROW COMMAND — Commercial v1 RC2.5 local checkpoint

**Data:** 2 ottobre 2026  
**Stato:** CANDIDATO LOCALE NON PUBBLICATO — NON CERTIFICATO COMMERCIALE  
**Parent locale:** `commercial-v1-rc2-4-local-2026-10-02`  
**Runtime pubblicato invariato:** Sites v84, deployment `appgdep_6abf3110bcb48191adf6a5b3fe432d84`  
**Build ID:** `ai-zerow-commercial-v1-rc2-5-local-r2026-10-02`  
**Deploy:** non eseguito per rispettare il gate di certificazione commerciale.

## Chiusure locali aggiunte

- Finance e Procurement hanno una macchina di stato persistente W10 con versioni ottimistiche e idempotenza.
- Approval e transizioni sono capability-gated; `approvals.review` è richiesto per l’approvazione.
- Ogni creazione/transizione produce evento append-only, outbox e reconciliation tenant-scoped.
- La UI espone stato, progress, azioni disponibili e confine provider; emissione PO, ricezione fisica e contabilizzazione esterna restano bloccate.
- Il verifier include fixture reali per review, approval, external hold e divieto di saltare gli stati Finance.

## Evidenza eseguita

| Controllo | Esito |
|---|---|
| TypeScript | PASS |
| ESLint | PASS; 8 warning preesistenti su `<img>` |
| Contract verifier + state fixtures | PASS |
| Production build | PASS |
| `git diff --check` | PASS |
| Browser/device certification | NOT RUN; CLI browser non disponibile nel workspace |
| Runtime live OpenAI | NOT RUN; richiede sessione Neon autenticata e runtime pubblicato |

## Gate ancora aperti

Il candidato resta `NO-GO` per la promozione commerciale finché non esistono evidenze esterne reali per OpenAI live, malware scanner provider-backed, invito Neon reale, consumer/esecutori esterni, certificazione browser/device e sign-off umano security/privacy/commerciale.

Il checkpoint è tecnico e locale. Non crea una nuova versione Sites e non autorizza il deploy.
