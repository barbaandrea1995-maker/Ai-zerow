# AI-ZEROW COMMAND — W17 OpenAI live check checkpoint

**Stato:** TECHNICAL PASS · IMPLEMENTATO LOCALMENTE · COMMERCIAL NO-GO  
**Commit:** e7108ea — feat(w17): add governed OpenAI live check  
**Pubblicazione corrente:** Sites v112 resta la release privata verificata precedente; questa tranche non è stata ancora pubblicata perché il push della sorgente verso il repository Sites non ha completato l’autenticazione.

## Cosa è stato chiuso

- aggiunto POST /api/governance/ai-live-check;
- esecuzione consentita solo con capability server-side tenant.manage;
- il test invia a OpenAI solo un prompt tecnico minimo, senza commesse, documenti, knowledge o record operativi;
- il modello e la chiave restano server-side;
- l’output del modello non viene persistito né restituito;
- nel registry tenant-scoped viene salvata solo evidenza redatta: esito, modello, timestamp e presenza del request id;
- aggiunto rate limit dedicato di 2 verifiche/minuto per tenant/attore;
- il readback W12/W17 riconosce solo la sorgente sites-openai-live-check come prova live;
- Command, Company AI e Release Center distinguono NOT_RUN, VERIFIED e FAILED;
- il confine directWrite=false e la decisione commerciale NO_GO restano invariati.

## Verifiche locali

| Controllo | Esito |
|---|---|
| TypeScript | PASS |
| Lint | PASS · 0 errori · 5 warning legacy immagini |
| Contract verification | PASS |
| Surface audit | PASS_WITH_EXTERNAL_GATES · 68 API · 0 endpoint irrisolti |
| Build | PASS |
| Live provider check | NOT_RUN finché non viene eseguito da un owner autenticato |
| Browser/device certification | NOT_RUN |
| Commercial promotion | BLOCKED |

## Regola di promozione

Il pulsante è visibile come controllo owner-only nel registry Integrazioni. Un esito positivo abiliterà soltanto il gate OpenAI live; non chiude malware provider, mappe/GPS, osservabilità, DPIA/retention, device certification o sign-off umano. La piattaforma non può quindi essere dichiarata certificata commerciale.
