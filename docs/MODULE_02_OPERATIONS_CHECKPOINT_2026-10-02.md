# AI-ZEROW COMMAND — Modulo 2 / Operations checkpoint

**Data:** 2 ottobre 2026  
**Perimetro:** `OPERATIONS / COMMESSE` e `Job Workspace`  
**Baseline visiva:** COMMAND ultra-carbon / neon lime  
**Stato:** IMPLEMENTED — tranche UI/UX commerciale + collegamenti locali verificati

## Decisione di sequenza

Il modulo 2 è stato identificato come `OPERATIONS / COMMESSE`, subito dopo COMMAND nella navigazione autorizzata. È il verticale di partenza perché conserva il `jobId` e collega commessa, scope, attività, pianificazione, risorse, presenze, missioni, materiali, documenti e Command.

## Riallineamento eseguito

- Sidebar Operations coerente con COMMAND, collassabile su desktop e drawer su mobile.
- Logo ZEROW ufficiale riutilizzato nella sidebar e nella topbar.
- Ricerca centrale, stato readback, notifiche e aggiornamento manuale collegati.
- Navigazione allineata ai percorsi autorizzati; le voci non abilitate non vengono mostrate.
- KPI corretti per distinguere dati riletti, readback vuoto e stato non disponibile.
- Catena operativa visibile: `Commessa → Pianificazione → Presenze → Missioni → Magazzino`.
- Risorse mostrate solo quando il server restituisce opzioni verificabili; nessun autista, mezzo o team viene inventato nel client.
- Rapportino e attività aprono il Job Workspace reale invece di mostrare conferme simulate.
- Job Workspace riallineato al materiale carbon/lime di COMMAND, con back, refresh, lifecycle e completion gate leggibili.

## Contratti mantenuti

- `GET/POST /api/operations` resta tenant-scoped e capability-gated.
- `GET/PATCH /api/operations/jobs/:jobId` resta il workspace canonico della commessa.
- Pianificazione e risorse usano `resource-options` e `planning` con controllo server-side.
- Scope Company AI resta limitato a sezione → raggruppamento → sottogruppo.
- Eventi, outbox, reconciliation, optimistic version e idempotenza non sono stati bypassati.

## Verifiche

- TypeScript: PASS.
- ESLint: PASS, solo warning preesistenti sulle immagini legacy.
- Build Sites/Vinext: PASS.
- Verifica contratto commerciale: PASS.
- Audit superficie: PASS_WITH_EXTERNAL_GATES.
- Smoke runtime: PASS.

## Gate ancora espliciti

Il modulo è pronto come superficie commerciale Sites/D1 bounded. Map provider, telematica GPS reale, consumer esterni e certificazione browser/device autenticata restano gate separati e non vengono dichiarati completati da questa tranche.
