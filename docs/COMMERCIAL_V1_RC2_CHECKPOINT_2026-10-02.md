# AI-ZEROW COMMAND — Commercial v1 RC2 checkpoint

**Data:** 2 ottobre 2026
**Stato:** RELEASE CANDIDATE TECNICA PUBBLICATA — NON CERTIFICATA COMMERCIALE
**Decisione:** `NO-GO` alla promozione commerciale finché i gate provider e il sign-off umano non sono chiusi
**Baseline immutabile:** `baseline-ai-zerow-sites-v65-2026-10-01`
**Checkpoint precedente:** `commercial-v1-rc1-local-2026-10-02` / `1de9c6dbf927ffe54772b022796ff8b64f349229`
**Tag RC2:** `commercial-v1-rc2-local-2026-10-02`
**Pubblicazione Sites:** versione `82` · deployment `appgdep_6abf28b8770881918615f4d8f81ff9c6` · stato `SUCCEEDED`
**URL:** https://ai-zerow-command.barba-andrea-1995.chatgpt.site
**Hotfix RC2.1:** commit `fcdc31a0f3880ec1a1b44aba6b66f755f42826d0` · fallback owner Sites riallineato con Neon configurato · pubblicato come versione `83`

## Perimetro congelato RC2

- Command ultra-carbon senza foglia, core Z e 11 widget ordinabili, ridimensionabili, visibili/nascosti e persistiti per tenant/attore;
- 13 ruoli canonici, capability deny-by-default, navigazione desktop/mobile e CTA filtrate anche nella UI;
- lifecycle membership con invito one-time hashato, cambio ruolo, sospensione, riattivazione, revoca e rimozione con protezione owner;
- commessa con preventivo DOCX realmente estratto, lavorazioni separate e scope fermato al sottogruppo;
- journey tipizzato per pianificazione, campo, richiesta materiali, missione, POD e documenti;
- inventario a millesimi con register/receive/reserve/release/pick/load/consume/return/adjust, idempotenza, versioni e invarianti;
- missioni e consegne collegate alla commessa;
- upload R2 reale fino a 20 MB con MIME, estensione, magic signature, SHA-256, deduplica e download tenant-scoped;
- Company AI collegata lato server alla Responses API, output strutturato, citation allowlist, quota D1, ledger e `directWrite: false`;
- migrazioni append-only `0010`–`0013`.

## Evidenze RC2

| Gate | Esito | Evidenza |
|---|---|---|
| TypeScript | PASS | `pnpm exec tsc --noEmit` |
| ESLint | PASS | 0 errori; 8 warning preesistenti su `<img>` |
| Production build | PASS | bundle Vinext completo; solo warning dimensione chunk |
| Contract verifier | PASS | 13 ruoli, 11 widget, 14 route, 4 migrazioni, 5 domini journey |
| Command desktop | PASS | route autenticata, core Z, carbon/neon, personalizzatore completo |
| Responsive mobile | PASS | 390×844, nessun overflow orizzontale su commessa e magazzino |
| Accessibilità automatica | PASS | axe WCAG 2 A/AA: 0 violazioni su Command, commessa, onboarding, warehouse e mission |
| RBAC Owner/Operatore | PASS | CTA, menu e moduli filtrati; API write worker `403` |
| Tenant isolation | PASS | identità ignota `401`; tenant B non legge job, documenti o stock tenant A |
| Commessa commerciale | PASS | perdita idrica, scope `E-IDRICO-ADDUZIONE`, voci separate, journey e ledger |
| Inventario | PASS | replay idempotente, conflitto versione, saldi e limiti consume/return |
| Missioni | PASS | create/dispatch/POD; load su missione `DELIVERED` respinto `409` |
| Documenti | PASS locale | DOCX 3.002.450 byte, R2 `STORED`, SHA-256 coerente; oversize `413`, firma falsa `415` |
| Restore D1 | PASS locale | export e restore pulito: 19 tabelle e conteggi business identici |
| Restore R2 | PASS locale | DOCX ripristinato con SHA-256 identico `aae80c…091b4` |
| OpenAI live | NOT RUN | il secret è presente nel runtime Sites ma non è leggibile; il deployment è riuscito, ma la chiamata live con sessione Neon autenticata non è ancora stata eseguita |
| Malware scan | NOT RUN | stato esposto come `AVAILABLE_UNSCANNED`; nessun provider scanner configurato |
| Invito Neon end-to-end | NOT RUN | richiede una sessione Neon e una mailbox/provider reali |
| Privacy/security sign-off | PENDING HUMAN | DPIA, retention, termini, DPA e review manuale non possono essere auto-certificati |

## Verdetto

RC2 è il primo candidato tecnico pubblicato del verticale commerciale principale. Non viene dichiarato “certificato per la vendita”: quattro gate esterni restano aperti:

1. prova OpenAI live con timeout, fallback e controllo costi;
2. scanner malware provider-backed e policy di quarantena/retention;
3. accettazione invito con sessione Neon reale;
4. sign-off umano security, privacy e commerciale.

Il repository e il deployment restano congelati su RC2; la promozione richiede un nuovo dossier che trasformi tutti e quattro i gate in `PASS` e un’approvazione umana esplicita. Il deployment tecnico è stato eseguito su richiesta, ma non equivale a una certificazione commerciale.
