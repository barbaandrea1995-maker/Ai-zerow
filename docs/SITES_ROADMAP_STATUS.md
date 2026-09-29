# AI-ZEROW-COMMAND — Sites roadmap status

## S01 — CLOSED

Scope: Sites-only reconstruction baseline.

- Project: `AI-ZEROW-COMMAND`
- Access: owner-only private Site
- Baseline/evidence policy: locked
- External platforms: intentionally not used as operating dependencies
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

The external multi-tenant identity adapter remains outside this Sites-only execution scope. It is not a blocker for S02 closure here.

## Current continuation

- S02: closed in Sites-only scope; external multi-tenant adapter remains deferred.
- S03: COMMAND shell and route-aware presentation implemented.
- S04: Sites adapter tranche implemented; canonical domain-service gate remains open.

### S04 evidence in Sites

- Canonical static surfaces are available at `/operations`, `/workforce`, `/warehouse`, `/mission` and `/assets`.
- The new surfaces share the CONTROL/Authority carbon-metal shell, neon-lime hierarchy, responsive navigation and explicit `STATIC READ MODEL` / `ADAPTER REQUIRED` states.
- Sites now exposes the server-side S04 adapter contract through `/api/:module` for the five canonical modules, backed by the tenant-scoped D1 table `s04_records`.
- The adapter enforces Sites workspace identity, canonical capability checks, tenant scope and bounded read/write payloads; the Operations create flow performs a real server-side D1 write.
- The local D1 migration/readback was verified with four seeded records per module and one explicit adapter-contract record per module.
- The UI consumes adapter readback when available and visibly falls back to the static contract only when the adapter is unavailable.
- The original canonical domain-service readback, state-machine certification, external reconciliation and event parity remain `NOT_RUN` because those services are not present in the Sites-only execution boundary.

S04 is therefore closed for the Sites adapter tranche, but not closed end-to-end against the canonical external operations/workforce/warehouse/mission/assets services.

## Sites-only rule

All implementation, packaging, publication and status checks for this project stay inside Sites. No Vercel or GitHub workflow is required for the Sites reconstruction.
