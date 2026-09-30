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
- Permission gate: `tenant.manage` required for authority profile read/write
- Persistence: Sites D1 binding `DB`, Drizzle schema and migration for `access_profiles`
- API: `GET`/`POST /api/authority/access-profiles`, with client identity and tenant fields ignored
- UI: `/onboarding` reads and creates persistent access profiles through the server endpoint
- S02 blockers: none within Sites scope

The external multi-tenant identity adapter remains outside this Sites-only execution scope. Neon usage is now authorized for the project, but the adapter and runtime evidence remain deferred; this is not a blocker for S02 closure here.

## Current continuation

- S01: **CLOSED · Sites native** — baseline, ownership and evidence policy locked.
- S02: **CLOSED · Sites native** — server authority, tenant boundary, capability gate and D1 profile readback verified.
- S03: **CLOSED · Sites native** — COMMAND shell, canonical `/command` alias, responsive navigation and S01–S04 route surfaces implemented.
- S04: **CLOSED · Sites adapter tranche** — five domain surfaces, tenant-scoped readback and Operations write path verified.
- S05: **CLOSED · Sites adapter tranche** — Documents, Finance, Procurement and Governance pages plus bounded D1 append-only read/write contracts.
- S06: **CLOSED · Sites adapter tranche** — event store, idempotency/aggregate-version uniqueness, durable outbox and reconciliation readback.
- S07: **CLOSED · Sites adapter tranche** — governed Command preview, approval ledger and explicit no-direct-write boundary.
- S08: **CLOSED · Sites presentation tranche** — manifest, service worker, offline fallback, IndexedDB FIFO replay surface and diagnostics.
- S09: **PARTIALLY VERIFIED · Sites browser QA** — desktop COMMAND screenshot, sidebar scroll, primary dialog interaction, route sweep and PWA diagnostics readback verified; mobile/device golden baseline remains open.
- External adapter control: **IMPLEMENTED · Sites declarative boundary** — S10–S14 catalogo, capability contract, append-only check log e roadmap gate visible at `/externals`.
- S10 Neon binding: **PARTIALLY VERIFIED · direct Neon readback** — progetto/branch/database/Auth e fingerprint schema verificati; marker `0016/0017` non provati nel progetto corretto e runtime Sites ancora su D1.

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
- `/api/command/ask`, `/api/command/approval` and `/api/command/overview` persist preview, approval-decision and readback entries in `s07_ai_ledger`. No direct domain write or provider secret is used.
- `/pwa/diagnostics`, `/mobile/diagnostics`, `/offline`, `/manifest.webmanifest` and `/sw.js` implement the Sites presentation contract. IndexedDB queue items are replayed sequentially and removed only after a successful HTTP readback.
- The Sites deployment remains owner-only and all work stays inside @Sites; no Vercel, GitHub or Neon operating workflow is required.

The deferred boundaries are explicit: external document storage/OCR, accounting and PO executors, policy engine, event consumers/retry-DLQ workers, OpenAI runtime/tool gateway, exact production SHA/browser/device certification, native mobile and the original B0–B10/PRE00/W20 matrix.

### External adapter control

- `/externals` and `/api/externals` expose a source-defined registry for identity, canonical domains, storage/OCR, Neon schema binding, event consumers, AI/voice, policy, runtime parity, native mobile, certification and promotion.
- The registry stores no endpoint, credential or provider secret. A user can append only a declarative CONTRACT, HEALTH, READBACK or GATE check; the check log is tenant-scoped and append-only in the existing s05_records D1 surface.
- DECLARATIVE_PASS means only that the Sites contract was recorded/read back. It never upgrades a canonical external service from DEFERRED, BLOCKED or NOT RUN to a falsely certified runtime.
- Neon project usage is `AUTHORIZED` for AI-ZEROW-COMMAND and is recorded in `docs/NEON_USAGE_AUTHORIZATION.md`; its S10 adapter remains `DEFERRED` until fingerprint, migration-marker, environment and runtime readback evidence exists.
- Vercel and GitHub remain outside the Sites-only operating workflow. Native iOS/Android and B0–B10/W20 remain NOT RUN until a separate authorized harness exists.

## Sites-only rule

All implementation, packaging, publication and status checks for this project stay inside Sites. No Vercel or GitHub workflow is required for the Sites reconstruction.
