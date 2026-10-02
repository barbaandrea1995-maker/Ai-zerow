# AI-ZEROW COMMAND — Commercial v1 RC2.9 local checkpoint

**Data:** 2 ottobre 2026  
**Stato:** EVIDENZA RUNTIME LOCALE SU BASE TECNICA PUBBLICATA — NON CERTIFICATO COMMERCIALE
**Workstream:** W17 Release & Certification Center
**Parent locale:** `commercial-v1-rc2-8-local-2026-10-02`
**Runtime pubblicato:** Sites v86 owner-only, deployment `appgdep_6abf743f4e908191bc2297ec522864e6`
**Build ID:** `ai-zerow-commercial-v1-rc2-9-local-r2026-10-02`
**Commit codice pubblicato:** `f9a15b1a64f91cc8d7c18d764556466fd3618712`
**Checkpoint locale aggiuntivo:** tag `commercial-v1-rc2-9-runtime-smoke-2026-10-02`, commit `f8f5b6a`.
**Deploy:** nessun nuovo deploy; la pubblicazione tecnica precedente resta v86 e la promozione commerciale resta bloccata.

## Chiusure locali aggiunte

- Nuovo Release & Certification Center in `/release`, protetto da `governance.read` e collegato ai control plane W12 e W16.
- Nuovo readback `GET /api/release/readiness`, tenant-scoped, senza segreti e senza scritture dirette.
- Catalogo W17 aggregato per Company AI, OpenAI live, security/privacy, document fail-closed, malware provider, workflow W10, executor esterni, restore, osservabilità, authority, device certification, DPIA e sign-off.
- Decisione unica `GO/NO_GO` con `promotionAllowed: false` finché ogni gate aperto non ha evidenza runtime o approvazione umana.
- API build aggiornata a W17 e identità RC2.9 condivisa con service worker e manifest.
- Runtime pubblicato su Sites v86 owner-only; il precedente tentativo v85 è stato superseded dalla pubblicazione corretta del readback RC2.9.
- Aggiunto `pnpm verify:runtime`: smoke locale su auth redirect, API protette, manifest PWA, service worker e boundary `NO_GO`; lo stesso harness ha verificato sull’URL pubblicato il rifiuto edge owner-only non autenticato.

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
| Local runtime HTTP smoke | PASS_LOCAL; auth redirect, protected API fail-closed, PWA manifest/service worker binding and NO_GO release boundary |
| Published Sites edge smoke | PASS_OWNER_ONLY_EDGE; unauthenticated production requests rejected by the owner-only boundary |
| Browser/device certification | NOT RUN; harness browser/device non disponibile nel workspace |
| Pubblicazione Sites | PASS_TECHNICAL_SITES_V86; audience owner-only |
| Runtime live OpenAI | NOT RUN; richiede sessione autenticata e prova provider |

## Gate ancora aperti

Il candidato resta `NO-GO` per la promozione commerciale finché non esistono evidenze reali per OpenAI live, malware scanner provider-backed, osservabilità/SLO/RPO/RTO, DPIA/retention/DPA, invito Neon reale, consumer/esecutori esterni, certificazione browser/device e sign-off umano security/privacy/commerciale.

Il checkpoint registra una pubblicazione tecnica riuscita, ma non certifica la commerciabilità. Non autorizza la promozione commerciale finché i gate esterni e umani restano aperti.
