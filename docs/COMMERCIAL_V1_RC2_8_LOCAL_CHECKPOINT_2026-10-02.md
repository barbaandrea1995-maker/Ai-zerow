# AI-ZEROW COMMAND — Commercial v1 RC2.8 local checkpoint

**Data:** 2 ottobre 2026  
**Stato:** CANDIDATO LOCALE NON PUBBLICATO — NON CERTIFICATO COMMERCIALE  
**Parent locale:** `commercial-v1-rc2-7-local-2026-10-02`  
**Runtime pubblicato invariato:** Sites v84, deployment `appgdep_6abf3110bcb48191adf6a5b3fe432d84`  
**Build ID:** `ai-zerow-commercial-v1-rc2-8-local-r2026-10-02`  
**Commit codice candidato:** `96127931ca11a06cd4da295b9bf918bf515baf72`  
**Deploy:** non eseguito per rispettare il gate di certificazione commerciale.

## Chiusure locali aggiunte

- Nuovo control plane W16 in `/governance/security`, protetto dal layout `governance.read` e collegato alla Governance Company AI.
- Nuovo readback `GET /api/governance/security-readiness`, tenant-scoped e senza restituzione di segreti.
- Catalogo esplicito per isolamento tenant, capability enforcement, payload/rate guard, confine segreti, documenti fail-closed, tracking on-duty, audit append-only e restore D1/R2.
- Gate separati per malware provider, observability/SLO, DPIA/retention e sign-off commerciale; gli stati restano `NOT_RUN` o `PENDING_REVIEW` quando manca evidenza esterna o umana.
- Filtro interattivo per dominio Security, Privacy, Resilience, Provider e Release.

## Evidenza eseguita

| Controllo | Esito |
|---|---|
| TypeScript | PASS |
| ESLint | PASS; 8 warning preesistenti su `<img>` |
| Contract verifier + state fixtures | PASS |
| Production build | PASS |
| `git diff --check` | PASS |
| W16 security/privacy readiness | PASS LOCALE; provider e human gates separati |
| D1/R2 restore rehearsal | PASS_LOCAL |
| Browser/device certification | NOT RUN; CLI browser non disponibile nel workspace |
| Runtime live OpenAI | NOT RUN; richiede sessione autenticata e runtime pubblicato |

## Gate ancora aperti

Il candidato resta `NO-GO` per la promozione commerciale finché non esistono evidenze reali per OpenAI live, malware scanner provider-backed, osservabilità/SLO/RPO/RTO, DPIA/retention/DPA, invito Neon reale, consumer/esecutori esterni, certificazione browser/device e sign-off umano security/privacy/commerciale.

Il checkpoint è tecnico e locale. Non crea una nuova versione Sites e non autorizza il deploy.
