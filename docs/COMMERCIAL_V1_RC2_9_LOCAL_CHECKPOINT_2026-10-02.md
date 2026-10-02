# AI-ZEROW COMMAND — Commercial v1 RC2.9 local checkpoint

**Data:** 2 ottobre 2026  
**Stato:** CANDIDATO LOCALE NON PUBBLICATO — NON CERTIFICATO COMMERCIALE  
**Workstream:** W17 Release & Certification Center  
**Parent locale:** `commercial-v1-rc2-8-local-2026-10-02`  
**Runtime pubblicato invariato:** Sites v84, deployment `appgdep_6abf3110bcb48191adf6a5b3fe432d84`  
**Build ID:** `ai-zerow-commercial-v1-rc2-9-local-r2026-10-02`  
**Commit codice candidato:** `64ec4d017b92ca95b0aa97a0eed97e3752cb1ed4`  
**Deploy:** non eseguito per rispettare il gate di certificazione commerciale.

## Chiusure locali aggiunte

- Nuovo Release & Certification Center in `/release`, protetto da `governance.read` e collegato ai control plane W12 e W16.
- Nuovo readback `GET /api/release/readiness`, tenant-scoped, senza segreti e senza scritture dirette.
- Catalogo W17 aggregato per Company AI, OpenAI live, security/privacy, document fail-closed, malware provider, workflow W10, executor esterni, restore, osservabilità, authority, device certification, DPIA e sign-off.
- Decisione unica `GO/NO_GO` con `promotionAllowed: false` finché ogni gate aperto non ha evidenza runtime o approvazione umana.
- API build aggiornata a W17 e identità RC2.9 condivisa con service worker e manifest.
- Runtime pubblicato congelato a v84; nessuna pubblicazione Sites eseguita.

## Evidenza eseguita

| Controllo | Esito |
|---|---|
| TypeScript | PASS |
| ESLint | PASS; 8 warning preesistenti su `<img>` |
| Production build | PASS |
| Contract verifier + state fixtures | PASS |
| W17 release readiness contract | PASS LOCALE; decisione NO-GO |
| W12/W16 aggregation | PASS LOCALE; provider e human gates separati |
| D1/R2 restore rehearsal | PASS_LOCAL |
| Browser/device certification | NOT RUN; harness browser/device non disponibile nel workspace |
| Runtime live OpenAI | NOT RUN; richiede sessione autenticata e runtime pubblicato |

## Gate ancora aperti

Il candidato resta `NO-GO` per la promozione commerciale finché non esistono evidenze reali per OpenAI live, malware scanner provider-backed, osservabilità/SLO/RPO/RTO, DPIA/retention/DPA, invito Neon reale, consumer/esecutori esterni, certificazione browser/device e sign-off umano security/privacy/commerciale.

Il checkpoint è tecnico e locale. Non crea una nuova versione Sites, non modifica il runtime v84 e non autorizza il deploy.
