# AI-ZEROW-COMMAND — Sites roadmap status

## S01 — CLOSED

Scope: Sites-only reconstruction baseline.

- Project: `AI-ZEROW-COMMAND`
- Access: owner-only private Site
- Baseline/evidence policy: locked
- External platforms: not used as operating dependencies; Neon project usage is separately authorized
- S01 blockers: none within Sites scope

The source research labels remain evidence labels. `ADAPTER_REQUIRED`, `NOT_RUN` and `UNKNOWN` describe capabilities that will be implemented or certified later; they are not open S01 work items.

## S02 — CLOSED

Scope: Sites-native authority and onboarding contract.

- Workspace identity: server-derived from Sites authentication headers
- Tenant boundary: owner-private Site project (`tenantId` is the Sites project boundary)
- Role catalog: 13 canonical roles with shared immutable capability arrays
- Permission gates: `authority.read` per il readback e `authority.manage` per la creazione dei profili; `tenant.manage` resta riservata alla proprieta del tenant
- Persistence: Sites D1 binding `DB`, Drizzle schema and migration for `access_profiles`
- API: `GET`/`POST /api/authority/access-profiles`, with client identity and tenant fields ignored
- UI: `/onboarding` reads and creates persistent access profiles through the server endpoint
- S02 blockers: none within Sites scope

The Sites-native authority remains canonical for the main command surfaces. A separate Neon Auth tenant adapter is now implemented behind the `AUTH-AB` gate; its evidence is isolated to a Neon certification branch and does not change the S02 Sites tenant boundary.

## Current continuation

- Commercial v1 RC2.8 local W16: **LOCAL TECHNICAL CANDIDATE · NOT PUBLISHED · COMMERCIAL NO-GO** — build ID `ai-zerow-commercial-v1-rc2-8-local-r2026-10-02`, checkpoint `COMMERCIAL_V1_RC2_8_LOCAL_CHECKPOINT_2026-10-02.md`. Aggiunto il control plane Security/Privacy con isolamento tenant, guard payload/segreti, documenti fail-closed, privacy on-duty, audit, restore e separazione dei gate provider/human review. Il runtime Sites resta v84/RC2.1.
- Commercial v1 RC2.7 local governance: **LOCAL TECHNICAL CANDIDATE · NOT PUBLISHED · COMMERCIAL NO-GO** — build ID `ai-zerow-commercial-v1-rc2-7-local-r2026-10-02`, checkpoint `COMMERCIAL_V1_RC2_7_LOCAL_CHECKPOINT_2026-10-02.md`. Company AI ora ha un control plane W12 tenant/capability-gated con gate locali, ledger readback, binding metadata-only, no-direct-write e OpenAI live esplicitamente `NOT RUN`. Il Command espone la readiness come widget personalizzabile. Il runtime Sites resta v84/RC2.1.
- Commercial v1 RC2.6 local hardening: **TECHNICAL PASS · NOT PUBLISHED · COMMERCIAL NO-GO** — build ID `ai-zerow-commercial-v1-rc2-6-local-r2026-10-02`, checkpoint `COMMERCIAL_V1_RC2_6_LOCAL_CHECKPOINT_2026-10-02.md`. Il Command include il widget Finance/Procurement capability-filtered, con readback W10 tenant-scoped e boundary provider visibile. Il runtime Sites resta v84/RC2.1.
- Commercial v1 RC2.5 local hardening: **TECHNICAL PASS · NOT PUBLISHED · COMMERCIAL NO-GO** — build ID `ai-zerow-commercial-v1-rc2-5-local-r2026-10-02`, checkpoint `COMMERCIAL_V1_RC2_5_LOCAL_CHECKPOINT_2026-10-02.md`. Finance e Procurement ora hanno workflow persistenti, versioni, approval capability-gated, idempotenza, eventi, outbox e reconciliation; emissione PO, ricezione e contabilizzazione provider-backed restano esplicitamente bloccate. Il runtime Sites resta v84/RC2.1.
- Commercial v1 RC2.4 local hardening: **TECHNICAL PASS · NOT PUBLISHED · COMMERCIAL NO-GO** — build ID `ai-zerow-commercial-v1-rc2-4-local-r2026-10-02`, checkpoint `COMMERCIAL_V1_RC2_4_LOCAL_CHECKPOINT_2026-10-02.md`. Events Authority e journey documenti espongono i controlli operativi; callback malware vincolato a SHA-256 e fixture outbox/document security sono verificati localmente. Il runtime Sites resta v84/RC2.1.
- Commercial v1 RC2.2 local hardening: **TECHNICAL PASS · NOT PUBLISHED · COMMERCIAL NO-GO** — codice `73417a7`, checkpoint `COMMERCIAL_V1_RC2_2_LOCAL_CHECKPOINT_2026-10-02.md`. Planning avanzato, resource-options, attendance/FIELD, asset lifecycle, workspace readback e replenishment proposal-only sono implementati e verificati localmente. Il runtime Sites resta v84/RC2.1.
- Commercial v1 RC2.1 checkpoint: **TECHNICAL PASS · PUBLISHED · COMMERCIAL NO-GO** — tag `commercial-v1-rc2-1-local-2026-10-02`, Sites version 84 e deployment riuscito (`appgdep_6abf3110bcb48191adf6a5b3fe432d84`). Il dossier è in `COMMERCIAL_V1_RC2_CHECKPOINT_2026-10-02.md`. La promozione commerciale resta `NO-GO` fino a OpenAI live, malware scanner, accettazione invito Neon reale e sign-off umano.
- Commercial v1 Command RC: **IMPLEMENTED · PUBLISHED · OWNER-ONLY** — superficie ultra-carbon ispirata al mockup approvato, foglia rimossa, core Z, 12 widget personali incluso il bridge Finance/Procurement capability-filtered, reorder/show-hide/size, preferenze D1 tenant+actor scoped e migration `0010_command_dashboard_preferences.sql`. QA visuale desktop/PWA e personalizzatore superati con zero violazioni axe automatiche.
- Commercial v1 RBAC: **IMPLEMENTED · RUNTIME PASS LOCALE** — menu desktop/mobile, widget, pagine, CTA e API applicano capability server-side; 14 route principali sono deny-by-default, Authority separa lettura da gestione, worker/auditor/owner rispettano la matrice e un'identita non censita non puo riaprire il bootstrap owner. Invite/role/suspend/reactivate/revoke/remove sono persistenti; il consumo invito con sessione Neon reale resta `NOT RUN`.
- Commercial journey RC2.4: **PASS LOCALE** — planning create/publish, field open/close, richieste materiali, approvazione/fulfillment, mission create/dispatch/POD/reconciliation/close, document security e communications condividono capability, versioni, idempotenza, eventi, outbox, reconciliation e readback tenant-scoped; i controlli outbox e security sono esposti anche nella UI.
- Warehouse e Mission RC2: **PASS LOCALE** — inventario a millesimi e ledger append-only verificati con replay, conflitto versione e invarianti; una missione consegnata rifiuta nuovi carichi con `409 mission_not_loadable`.
- Document storage RC2.4: **PASS STORAGE / SECURITY HOLD** — upload DOCX fino a 20 MB, MIME/magic signature e SHA-256 restano applicati; la UI avvia scansione/revisione e il callback verifica lo SHA-256 prima di produrre `CLEAN_PROVIDER`/`AVAILABLE_CLEAN`. Il provider reale non è configurato e il download resta fail-closed.
- Disaster recovery RC2: **PASS LOCALE** — export D1 ripristinato in uno stato vuoto con 19 tabelle e conteggi identici; oggetto R2 ripristinato con SHA-256 identico.
- Commercial v1 Company AI Command: **IMPLEMENTED · LIVE NOT RUN** — OpenAI Responses API è collegata server-side con contesto operativo filtrato, knowledge hints, output strutturato, citation allowlist, payload guard, quota D1 e `directWrite: false`. Il control plane W12 separa binding metadata, ledger/readback e prova live; il valore della chiave non viene esposto. La prova live resta bloccante perché richiede una sessione Neon autenticata reale.
- Commercial v1 D1 hardening: **PASS LOCALE ISOLATO** — migrazioni `0010` e `0011` applicate; upsert preferenze e incremento atomico quota Company AI riletti correttamente. Nella stessa finestra 6 intake passano e il 7° restituisce `429`; payload oltre soglia restituiscono `413`; selezione cross-tenant restituisce `403`.
- Commercial v1 preventivo reale: **PASS LOCALE** — il DOCX EMS sulla perdita idrica viene estratto, suddiviso in 24 lavorazioni, classificato fino a `E-IDRICO-ADDUZIONE` e riletto in modo idempotente senza copiare l'intero preventivo in un solo campo.
- Commercial v1 release: **PUBLISHED TECHNICAL RC2.1** — il deployment tecnico è riuscito; RC2.1 resta un candidato tecnico, non una certificazione commerciale finale. I log post-release non mostrano errori Worker negli ultimi 30 minuti osservati.
- Commercial v1 RC2.2 release: **LOCAL CANDIDATE · NOT PUBLISHED** — build verificata localmente e mantenuta fuori da Sites finché i gate esterni e umani non sono chiusi.
- Commercial v1 RC2.3 release: **LOCAL CANDIDATE · NOT PUBLISHED** — build verificata localmente; nessuna pubblicazione eseguita.
- Commercial v1 RC2.4 release: **LOCAL CANDIDATE · NOT PUBLISHED** — build verificata localmente; nessuna pubblicazione eseguita.
- Commercial v1 RC2.5 release: **LOCAL CANDIDATE · NOT PUBLISHED** — build W10 verificata localmente; nessuna pubblicazione eseguita.
- Commercial v1 RC2.6 release: **LOCAL CANDIDATE · NOT PUBLISHED** — Command bridge W10 verificato localmente; nessuna pubblicazione eseguita.
- Commercial v1 RC2.7 release: **LOCAL CANDIDATE · NOT PUBLISHED** — control plane Company AI W12, readiness widget e gate commerciali espliciti; nessuna pubblicazione eseguita.
- Commercial v1 RC2.8 release: **LOCAL CANDIDATE · NOT PUBLISHED** — control plane W16 Security/Privacy e release gate espliciti; nessuna pubblicazione eseguita.

- S01: **CLOSED · Sites native** — baseline, ownership and evidence policy locked.
- S02: **CLOSED · Sites native** — server authority, tenant boundary, capability gate and D1 profile readback verified.
- S03: **CLOSED · Sites native** — COMMAND shell, canonical `/command` alias, responsive navigation and S01–S04 route surfaces implemented.
- S04: **CLOSED · Sites adapter tranche** — five domain surfaces, tenant-scoped readback and Operations write path verified.
- S05: **CLOSED · Sites adapter tranche** — Documents, Finance, Procurement and Governance pages plus bounded D1 append-only read/write contracts.
- S06: **CLOSED · Sites adapter tranche** — event store, idempotency/aggregate-version uniqueness, durable outbox and reconciliation readback.
- S07: **CLOSED · Sites adapter tranche** — governed Command preview, approval ledger and explicit no-direct-write boundary.
- S08: **CLOSED · Sites presentation tranche** — manifest, service worker, offline fallback, IndexedDB FIFO replay surface and diagnostics.
- S09: **CLOSED · Sites browser QA** — v39 exact-source route sweep, desktop shell/readback, primary interaction and PWA diagnostics verified; real-device/golden-image certification remains explicitly outside the Sites browser gate.
- External adapter control: **IMPLEMENTED · Sites declarative boundary** — S10–S14 catalogo, capability contract, append-only check log e roadmap gate visible at `/externals`.
- S10 Neon binding: **CLOSED · authorized Neon binding** — `DATABASE_URL`/`zerow_runtime` verificano schema, fingerprint, readback e marker strutturali 0016/0017 del progetto `AI-ZEROW COMMAND`; `neon_auth` resta fuori dal read scope runtime per least privilege, mentre fixture Auth/tenant e provenienza storica dei file restano confini di certificazione separati. D1 resta canonico.
- AUTH-AB identity gate: **CERTIFIED · isolated Neon branch** — `/auth-ab`, `/api/auth/*` e `/api/auth-ab/readback` usano sessione e membership server-side; fixture A/B hanno login riuscito, un tenant accessibile ciascuno e rifiuto cross-tenant `403`. La branch di certificazione non è il branch production e D1 resta canonico.
- Production identity bridge: **VERIFIED · owner-mediated provisioning** — `/login` supporta signup/sign-in Neon; `/tenants` e `/api/auth/neon-membership` collegano la sessione Neon corrente alla membership D1 EMS solo quando sono presenti contemporaneamente owner Sites, capability `tenant.manage` e sessione Neon. Il readback production conferma la membership Neon `owner` attiva accanto alla membership Sites `owner`; nessuna identità o password viene inventata dal deploy.
- U5 Job Workspace: **IMPLEMENTED · Sites/D1 bounded readback** — v56 introduce `/operations/:jobId` e `/api/operations/jobs/:jobId`, conserva `jobId` come chiave cross-domain e legge solo record S04 tenant-scoped; le fasi senza record restano `EMPTY` o `DEFERRED`. Il ciclo completo della commessa resta aperto e non viene dichiarato chiuso.
- Demo data cleanup: **IMPLEMENTED · Sites/D1 production cleanup** — la migrazione `0006_remove_demo_data.sql` rimuove seed e segnali QA dal tenant senza toccare la commessa reale `OPERATIONS-47363CDE`, tenant, membership o contratti; le superfici UI mostrano il readback vuoto e mantengono i flussi di creazione, scansione QR, eventi, Authority e diagnostica.
- Production alignment v58: **PUBLISHED · private Site** — la sorgente riallineata con cleanup demo e AUTH-AB isolato è stata verificata con TypeScript/lint/build, pubblicata con successo e riletta su D1 senza errori Worker; nessun cutover Neon Auth è stato eseguito.
- Server naming / S04 registration v61: **PUBLISHED · private Site** — Operations assegna `COMM-0001`, `COMM-0002`, …; Assets assegna codici progressivi per asset, mezzi e attrezzature; Warehouse genera codici descrittivi come `CHIUS-GHIS-50x50`. I barcode restano canonical code per gli oggetti non-commessa, i contatori sono atomici e tenant-scoped su D1 e nessun test/demo record è stato creato in produzione.

The closures above are Sites-native closures. They do not rewrite the original research labels or turn unavailable external runtime evidence into a canonical ZEROW certification.

The S05–S08 closures below are the same kind of Sites-scoped closure: they certify the implemented Sites surface, D1 readback and server-owned boundaries. They do not claim that the unavailable canonical external services, workers, AI runtime or device/browser certification have been executed.

### S04 evidence in Sites

- Canonical static surfaces are available at `/operations`, `/workforce`, `/warehouse`, `/mission` and `/assets`.
- The new surfaces share the CONTROL/Authority carbon-metal shell, neon-lime hierarchy, responsive navigation and explicit Sites adapter/readback states.
- Sites now exposes the server-side S04 adapter contract through `/api/:module` for the five canonical modules, backed by the tenant-scoped D1 table `s04_records`.
- The adapter enforces Sites workspace identity, canonical capability checks, tenant scope and bounded read/write payloads; the Operations create flow performs a real server-side D1 write.
- The local D1 migration/readback was verified with four seeded records per module and one explicit adapter-contract record per module.
- The UI consumes adapter readback when available and visibly falls back to the static contract only when the adapter is unavailable.
- The original canonical domain-service readback, state-machine certification, external reconciliation and event parity remain `NOT_RUN` because those services are not present in the Sites-only execution boundary.

S01–S04 are therefore closed for the Sites reconstruction scope. The original external operations/workforce/warehouse/mission/assets services, state machines, reconciliation and event parity remain explicit deferred boundaries rather than silently invented behavior.

### S05–S08 evidence in Sites

- `/documents`, `/finance`, `/procurement` and `/governance` use one shared COMMAND carbon-metal shell with real tenant-scoped D1 readback and bounded append-only proposals.
- Canonical route aliases are available for the reconstructed document, finance, procurement, governance, forecast, approvals and Command timeline surfaces; they all preserve the same server authority boundary.
- `s05_records` contains seeded read models/proposals and an explicit adapter-contract record for each S05 domain. Destructive update routes are not exposed.
- `/events` and `/api/events` persist append-only events, enforce tenant idempotency and aggregate-version uniqueness, create durable outbox rows and write a Sites reconciliation readback. `/api/events/outbox` and `/api/events/reconciliation` expose the same snapshot.
- `/api/command/ask`, `/api/command/approval` and `/api/command/overview` persist preview, approval-decision and readback entries in `s07_ai_ledger`. L'adapter OpenAI legge `OPENAI_API_KEY` soltanto lato server; nessun segreto viene inviato al client e nessuna risposta AI esegue una scrittura diretta di dominio.
- `/pwa/diagnostics`, `/mobile/diagnostics`, `/offline`, `/manifest.webmanifest` and `/sw.js` implement the Sites presentation contract. IndexedDB queue items are replayed sequentially and removed only after a successful HTTP readback.
- The Sites deployment remains owner-only and all work stays inside @Sites; no Vercel, GitHub or Neon operating workflow is required.

### U5 evidence in Sites

- `/operations/:jobId` is a production Job Workspace backed by a tenant-scoped read model from the existing S04 D1 surface.
- The Operations portfolio opens the workspace only for a real adapter-backed commessa and preserves the explicit static/fallback boundary otherwise.
- The live commessa `OPERATIONS-47363CDE` was verified end-to-end in production; the workspace reports its D1 readback and does not invent downstream activity, attendance, field, rapportino or control records.
- The public login route was hardened in the same production increment: it renders without a server-side Neon session read, while protected-route authorization remains server-verified.
- Full commessa lifecycle writes, state-machine parity, external executors and later roadmap gates remain deferred; see `docs/U5_JOB_WORKSPACE_CHECKPOINT_2026-09-30.md`.

The deferred boundaries are explicit: external document storage/OCR, accounting and PO executors, policy engine, event consumers/retry-DLQ workers, OpenAI live runtime certification/tool execution, exact production SHA/browser/device certification, native mobile and the original B0–B10/PRE00/W20 matrix.

### External adapter control

- `/externals` and `/api/externals` expose a source-defined registry for identity, canonical domains, storage/OCR, Neon schema binding, event consumers, AI/voice, policy, runtime parity, native mobile, certification and promotion.
- The registry stores no endpoint, credential or provider secret. A user can append only a declarative CONTRACT, HEALTH, READBACK or GATE check; the check log is tenant-scoped and append-only in the existing s05_records D1 surface.
- DECLARATIVE_PASS means only that the Sites contract was recorded/read back. It never upgrades a canonical external service from DEFERRED, BLOCKED or NOT RUN to a falsely certified runtime.
- Neon project usage is `AUTHORIZED` for AI-ZEROW-COMMAND and is recorded in `docs/NEON_USAGE_AUTHORIZATION.md`; the S10 binding gate is `AUTHORIZED + READY`, while AUTH-AB remains a separate certified identity boundary and production A/B negative-case testing is still pending.
- Vercel and GitHub remain outside the Sites-only operating workflow. Native iOS/Android and B0–B10/W20 remain NOT RUN until a separate authorized harness exists.

## Sites-only rule

All implementation, packaging, publication and status checks for this project stay inside Sites. No Vercel or GitHub workflow is required for the Sites reconstruction.
