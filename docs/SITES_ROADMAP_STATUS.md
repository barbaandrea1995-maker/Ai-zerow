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
- S04: static surface tranche implemented; adapter/readback gate remains open.

### S04 evidence in Sites

- Canonical static surfaces are available at `/operations`, `/workforce`, `/warehouse`, `/mission` and `/assets`.
- The new surfaces share the CONTROL/Authority carbon-metal shell, neon-lime hierarchy, responsive navigation and explicit `STATIC READ MODEL` / `ADAPTER REQUIRED` states.
- Local interactions are presentation-safe: filters, selection, assistant prompts and CTAs report the pending adapter boundary instead of simulating domain mutations.
- Domain API readback, state-machine certification and reconciliation remain `NOT_RUN` until the canonical adapters are connected.

S04 is therefore not marked closed yet: the Sites composition gate is complete, while the canonical operations/workforce/warehouse/mission/assets readback gate is still open.

## Sites-only rule

All implementation, packaging, publication and status checks for this project stay inside Sites. No Vercel or GitHub workflow is required for the Sites reconstruction.
