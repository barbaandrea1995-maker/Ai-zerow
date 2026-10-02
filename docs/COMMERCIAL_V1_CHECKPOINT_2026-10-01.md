# AI-ZEROW COMMAND — Commercial v1 checkpoint

**Data:** 2 ottobre 2026
**Stato:** RELEASE CANDIDATE LOCALE — NON CERTIFICATO — NON PUBBLICATO
**Baseline immutabile:** `baseline-ai-zerow-sites-v65-2026-10-01`
**Parent del lavoro:** `0e96a94417088327ad387ced3db0f746f39a706a`
**Tag checkpoint previsto:** `commercial-v1-rc1-local-2026-10-02`

## Perimetro congelato

Questo checkpoint congela la prima base candidata alla commercializzazione senza modificare o distribuire la versione live.

- Command ultra-carbon con core Z, lime gerarchico e responsive PWA;
- 11 widget autorizzabili, ordinabili, ridimensionabili e nascondibili;
- preferenze persistenti per `tenantId + actorId`, mai in localStorage;
- catalogo di 13 ruoli con capability deny-by-default;
- menu, widget, route e API filtrati lato server;
- Authority con separazione `authority.read` / `authority.manage`;
- Company AI Command collegata a OpenAI Responses lato server;
- contesto AI filtrato per tenant/capability, output strutturato, citation allowlist, ledger e nessuna write diretta;
- payload guard e quota Company AI atomica per tenant, attore, azione e finestra;
- migrazioni append-only `0010_command_dashboard_preferences.sql` e `0011_ai_rate_limit_windows.sql`;
- roadmap e matrice ruoli riallineate.

## Evidenze disponibili

| Gate | Esito | Evidenza |
|---|---|---|
| TypeScript | PASS | `pnpm exec tsc --noEmit` |
| ESLint | PASS | `pnpm lint`: 0 errori, 8 warning preesistenti su `<img>` |
| Production build | PASS | `pnpm build` |
| Contract verification | PASS | `pnpm verify:commercial`: 13 ruoli, 11 widget, 14 route guard, AI guards e 2 migrazioni |
| Exact-build manifest | PASS locale | build ID `ai-zerow-commercial-v1-rc1-local-r2026-10-02`, source tag e rollback target registrati in `COMMERCIAL_V1_RC1_BUILD_MANIFEST.json` |
| Migration SQL inspection | PASS | preferenze tenant/actor e quota tenant/actor/action/window con chiavi uniche |
| D1 migration runtime | PASS locale isolato | `0010` e `0011`: 3 comandi ciascuna; upsert layout e quota incrementata a 2 riletti correttamente |
| Company AI quota runtime | PASS locale isolato | 6 intake accettati nella stessa finestra; il 7° restituisce `429 company_ai_rate_limit_exceeded`; contatore D1 riletto a 7 |
| Payload abuse | PASS locale isolato | intake e Command rifiutano payload oltre soglia con `413 payload_too_large` |
| RBAC API matrix | PASS locale isolato | Worker: dashboard/preferenze `403`; Auditor: GET `200`, customize false e PUT `403`; Owner: dashboard/PUT `200` |
| Widget tampering | PASS locale isolato | widget sconosciuto rimosso, duplicato collassato, size invalida normalizzata, catalogo autorizzato ripristinato |
| Tenant isolation | PASS locale isolato | identita non censita `401`; selezione del tenant B da owner A `403`; owner B vede esclusivamente il proprio tenant |
| Bootstrap owner | PASS | dopo la creazione del tenant canonico, una nuova identita Sites senza membership non puo auto-promuoversi |
| Preventivo DOCX reale | PASS locale | il file EMS perdita idrica viene letto, separato in 24 voci e classificato fino al sottogruppo `E-IDRICO-ADDUZIONE`; replay idempotente verificato |
| Secret handling | PASS | chiave letta solo da `process.env`; runtime Sites rev. 5 espone `OPENAI_API_KEY` come secret senza rivelarne il valore |
| Browser desktop | PASS visuale | 1440×1050, hero su due righe, core Z, 11 widget e configuratore verificati |
| Browser PWA mobile | PASS visuale | 390×844, reflow a colonna, bottom navigation e touch surface verificati |
| Accessibilita automatica | PASS | axe WCAG 2 A/AA: 0 violazioni desktop e mobile; contrasto gradienti resta review manuale |
| OpenAI live request | PENDING | secret configurato in Sites, ma il candidato non viene pubblicato per eseguire la nuova route |
| Tenant A/B negative cases | PASS locale isolato | membership distinte, directory separata e tentativo cross-tenant `403` sul candidato |
| Security/privacy/restore | PENDING | necessario prima della vendita GA |

## Decisione di release

`NO-GO` al deploy in questo checkpoint. La UI e i contratti sono candidati, ma una versione commerciabile deve chiudere almeno:

1. chiamata OpenAI live sul candidato, fallback, timeout e controllo costi;
2. percorso commessa → pianificazione → field → magazzino → trasporto → documenti;
3. upload binario/storage antivirus e gestione retention, oltre ai limiti JSON gia verificati;
4. visual smoke autenticato delle pagine per ogni famiglia di ruolo, oltre alla matrice API gia superata;
5. restore rehearsal e rollback operativo; manifest e rollback target sono gia congelati;
6. review manuale contrasto, privacy/security e sign-off umano finale.

Nessun deploy deve partire automaticamente al completamento tecnico: serve una decisione esplicita dopo il dossier di certificazione.
