# AI-ZEROW COMMAND — Commercial v1 RC2.2 local checkpoint

**Data:** 2 ottobre 2026
**Stato:** CANDIDATO LOCALE NON PUBBLICATO — NON CERTIFICATO COMMERCIALE
**Parent pubblicato:** `commercial-v1-rc2-1-local-2026-10-02` · Sites v84
**Commit codice candidato:** `73417a7`
**Tag previsto:** `commercial-v1-rc2-2-local-2026-10-02`
**Deploy:** non eseguito per rispettare il gate di certificazione commerciale.

## Chiusure locali aggiunte

- Planning avanzato: capacità, conflitti di sovrapposizione, qualifiche, revisioni e simulazione `what_if` senza persistenza.
- Resource options: readback tenant-scoped di persone/team/asset e filtro degli asset non assegnabili.
- FIELD/Attendance: check-in, pausa, ripresa, check-out, correzione e approvazione con optimistic version, idempotenza e policy GPS `ON_DUTY_ONLY` a precisione ridotta.
- Asset lifecycle: manutenzione, blocco, rilascio e guard `ASSIGNABLE/NOT_ASSIGNABLE` con evento e reconciliation.
- Warehouse: proposta di replenishment dichiarata `PROPOSAL_ONLY`, senza creazione automatica di ordini o movimenti.
- Workspace commessa: planning e attendance vengono riletti nel dettaglio commessa e nella journey rail.

## Evidenza eseguita

| Controllo | Esito |
|---|---|
| TypeScript | PASS |
| ESLint | PASS; 8 warning preesistenti su `<img>` |
| Contract verifier | PASS |
| Planning fixtures | PASS; slot valido e overlap rilevato |
| Production build | PASS; route Planning, Attendance, Asset lifecycle e resource-options incluse |
| `git diff --check` | PASS |
| Runtime live | NOT RUN; il candidato non è stato pubblicato |

## Gate ancora aperti

Questi non possono essere trasformati in `PASS` dal codice locale senza evidenza esterna reale:

1. Company AI/OpenAI live con sessione Neon autenticata;
2. malware scanner provider-backed, quarantena e retention;
3. invito Neon accettato da un secondo account/mailbox;
4. consumer esterni, routing/telematica, accounting/payment, OCR e telephony;
5. browser/device certification PWA e test real-device;
6. DPIA, retention, DPA, incident response, SLO/RPO/RTO e sign-off umano.

Il candidato RC2.2 resta quindi `NO-GO` per la promozione commerciale e non modifica il runtime Sites v84.
