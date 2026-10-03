# AI-ZEROW COMMAND — W09 Document Control checkpoint

**Data:** 3 ottobre 2026  
**Stato:** TECHNICAL PASS · PUBLISHED PRIVATELY · OWNER-ONLY  
**Release line:** Commercial v1 RC2.9-AUDIT-1 technical candidate, not commercial certification

## Esito

Il modulo `/documents` è stato riallineato alla shell Command usata da Mission, Warehouse e Asset. La pagina non usa più il vecchio pannello S05 come superficie primaria: legge un catalogo operativo tenant-scoped, collega ogni file a una commessa reale e rende visibili provenance e security state senza attribuire al file una pulizia o un’analisi che non esiste.

La pubblicazione resta privata e owner-only. Questo checkpoint certifica il perimetro Sites/D1/R2 implementato, non la disponibilità dei provider esterni.

## Contratto implementato

- `GET /api/documents/catalog` legge `operational_documents` e le commesse `s04_records` del tenant corrente.
- `GET /api/documents` è riallineato al catalogo operativo; il POST legacy S05 resta separato per compatibilità degli adapter non primari.
- Il caricamento passa da `/api/operations/jobs/:jobId/documents` e richiede una commessa selezionata dal readback server.
- Il limite client/server è 20 MB; le estensioni e MIME supportati restano quelli del contratto esistente.
- La firma base e lo SHA-256 vengono controllati dal server prima della persistenza.
- La metadata row D1 e l’oggetto R2 sono tenant/job-scoped; l’upload produce evento, outbox e reconciliation.
- Il download resta consentito solo per `CLEAN_PROVIDER` + `AVAILABLE_CLEAN`.
- `queue_scan`, `manual_review` e `quarantine` usano la state machine security esistente e non espongono `provider_result` a un operatore umano.
- Company AI è un handoff verso Operations: il modulo non simula OCR, estrazione, classificazione AI o malware scanning.

## Superficie UI/UX

- sidebar Command collassabile con icona ufficiale ZEROW;
- topbar coerente con ricerca, tenant switcher, back, refresh, comunicazioni e profilo;
- hero Document Control, KPI reali e register filtrabile;
- inspector con commessa, hash, provenance, storage status, versione e date;
- azioni contestuali: download solo quando autorizzato, security hold, controllo, revisione, quarantena e apertura commessa;
- dialog upload con selezione reale della commessa e categoria, mai job reference libero;
- handoff visibile a Company AI/Operations con stato OCR `NOT RUN` quando non esiste un provider collegato;
- mobile PWA coerente: la bottom navigation resta limitata ai ruoli operativi secondo il contratto Command.

## Verifiche eseguite

| Controllo | Esito |
|---|---|
| TypeScript | PASS |
| lint | PASS · 8 warning legacy `<img>` fuori dal modulo |
| build Vinext | PASS · 755 client modules / 921 server modules |
| audit release surface | PASS_WITH_EXTERNAL_GATES · 31 page routes, 67 API routes, endpoint binding risolto |
| verify commercial static contract | PASS |
| git diff check | PASS |
| runtime smoke locale | NOT RUN: il sandbox rifiuta la connessione a `127.0.0.1:5173` e `::1:5173` con `EPERM` |
| browser/device certification | NOT RUN: sessione autenticata e harness device non disponibili |

## Gate ancora aperti

- provider malware reale e callback autenticato con SHA-256;
- OCR/extraction/classification con confidence e provenance per campo;
- replacement/versioning completo e retention policy eseguita;
- Company AI/OpenAI live su sessione autenticata;
- browser/device certification, offline/replay e test PWA real-device;
- consumer esterno outbox, osservabilità/SLO, DPIA/retention e sign-off umano.

## Decisione checkpoint

`W09 SITES TECHNICAL PASS` nel perimetro owner-only privato. Non promuovere a certificazione commerciale o GA: i gate esterni sopra restano bloccanti.
