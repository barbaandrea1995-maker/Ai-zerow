# AI-ZEROW-COMMAND — S01–S04 closure ledger

This ledger closes the first four roadmap gates inside the Sites execution boundary.
It preserves the forensic reconstruction labels and does not claim runtime parity
with unavailable external ZEROW services.

## Baseline

- Product: `AI-ZEROW-COMMAND`
- Sites project: `appgprj_6abaaf2bb58081919b265a8a6ad76dbb`
- Audience: owner-only custom Sites access
- Source research SHA: `a07c72bc4bafd3bc47dce41c3cd272cdf42d3f63`
- Research status: `READY_WITH_BLOCKERS`
- Sites database binding: `DB`

## Gate results

| Gate | Sites closure evidence | Status |
| --- | --- | --- |
| S01 | Baseline, ownership boundary, evidence policy, project identity and private publication workflow recorded in `docs/RECONSTRUCTION_BASELINE.md`. | `CLOSED · SITES NATIVE` |
| S02 | Server-derived Sites identity, owner-private tenant boundary, canonical capability resolver, `tenant.manage` gate and D1 `access_profiles` read/write route. | `CLOSED · SITES NATIVE` |
| S03 | Shared carbon-metal/neon-lime shell, responsive navigation, root COMMAND surface and canonical `/command` route alias; S01–S04 page surfaces are wired. | `CLOSED · SITES NATIVE` |
| S04 | `/api/operations`, `/api/workforce`, `/api/warehouse`, `/api/mission` and `/api/assets` adapter readback; tenant-scoped `s04_records`; Operations server write; UI readback/fallback states. | `CLOSED · SITES ADAPTER` |
| S05 | `/documents`, `/finance`, `/procurement`, `/governance`; canonical API aliases; tenant-scoped append-only `s05_records`; bounded server write/readback. | `CLOSED · SITES ADAPTER` |
| S06 | Append-only `s06_events`; tenant idempotency and aggregate-version uniqueness; `s06_outbox`; `s06_reconciliations`; `/events` readback surface. | `CLOSED · SITES ADAPTER` |
| S07 | `/api/command/ask`, approval decision and overview; append-only `s07_ai_ledger`; no-direct-write and deferred provider boundary. | `CLOSED · SITES ADAPTER` |
| S08 | Manifest, service worker, offline fallback, IndexedDB FIFO replay surface and `/pwa/diagnostics`. | `CLOSED · SITES PRESENTATION` |

## Readback proof

- D1 contains `access_profiles` and `s04_records`.
- `s04_records` contains 20 seeded records: four for each S04 module.
- Each S04 module contains one explicit `adapter-contract` record.
- Operations accepts a bounded server-side create request and reads the inserted record back.
- Browser-provided tenant and identity values are not trusted by the server routes.
- The published Site remains owner-only and uses no Vercel, GitHub or Neon operating workflow.
- S05–S08 are backed by migration `0002`: 12 seeded S05 records, 2 event-store records, 2 outbox records, 2 reconciliation records and 2 AI ledger entries; the published readback is checked after deployment.

## Preserved boundaries

The following remain `ADAPTER_REQUIRED`, `UNKNOWN`, `NOT_RUN` or `NOT_VERIFIED`
according to the supplied research and are intentionally not relabeled:

- external multi-tenant identity and Neon Auth;
- canonical external domain services and their state machines;
- event store, outbox, retry/DLQ and reconciliation parity;
- original runtime behavior of the 418 catalogued controls;
- PWA exact-build, standalone/offline/device certification;
- B0–B10, PRE00 and W20 certification.

S05–S08 are closed only for the Sites adapter/presentation scope. Their canonical external runtime evidence remains preserved as deferred research evidence and is not silently upgraded by this ledger.

Those boundaries do not reopen S01–S04 inside Sites; they define the next adapter
and certification work after this closure.
