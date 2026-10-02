# AI-ZEROW COMMAND — Commercial v1 RC2.3 local checkpoint

**Data:** 2 ottobre 2026  
**Stato:** CANDIDATO LOCALE NON PUBBLICATO — NON CERTIFICATO COMMERCIALE  
**Parent locale:** `commercial-v1-rc2-2-local-2026-10-02`  
**Commit codice candidato:** `b95c14f`  
**Runtime pubblicato invariato:** Sites v84, deployment `appgdep_6abf3110bcb48191adf6a5b3fe432d84`  
**Build ID:** `ai-zerow-commercial-v1-rc2-3-local-r2026-10-02`  
**Deploy:** non eseguito per rispettare il gate di certificazione commerciale.

## Chiusure locali aggiunte

- Company AI risolve `OPENAI_API_KEY` e `OPENAI_MODEL` dal binding runtime Site, con fallback solo server-side per lo sviluppo locale; nessun segreto entra nel client.
- Outbox S06: retry limitato, dead-letter, requeue e block sono transizioni governate, idempotenti e non dichiarano mai una consegna esterna riuscita.
- Document security: quarantena, revisione manuale e callback provider `CLEAN/INFECTED`; il download è fail-closed fino a evidenza provider-backed CLEAN.
- Journey trasporti: `DELIVERED → POD_VERIFIED → RECONCILED → CLOSED`, con capability e optimistic version.
- Communications: pagina e route tenant-scoped, capability-gated e limitate al confine proposal/readback S05.
- Shell e menu aggiornati senza modificare contratti di autenticazione, tenant o routing esistenti.

## Evidenza eseguita

| Controllo | Esito |
|---|---|
| TypeScript | PASS |
| ESLint | PASS; 8 warning preesistenti su `<img>` |
| Contract verifier | PASS |
| Production build | PASS; route Communications, document security e outbox incluse |
| `git diff --check` | PASS |
| Browser/device certification | NOT RUN; CLI browser non disponibile nel workspace |
| Runtime live OpenAI | NOT RUN; richiede sessione Neon autenticata e runtime pubblicato |

## Gate ancora aperti

Il candidato resta `NO-GO` per la promozione commerciale finché non esistono evidenze esterne reali per:

1. chiamata Company AI/OpenAI live con sessione Neon autenticata;
2. malware scanner provider-backed, token webhook, retention e prova CLEAN/INFECTED;
3. invito Neon accettato da un secondo account/mailbox e test negativo cross-tenant;
4. consumer esterni, routing/telematica, accounting/payment, OCR e telephony;
5. certificazione browser/device PWA e percorso offline su dispositivi reali;
6. DPIA, retention, DPA, incident response, SLO/RPO/RTO e sign-off umano security/privacy/commerciale.

Il checkpoint è tecnico e locale. Non crea una nuova versione Sites e non autorizza il deploy.
