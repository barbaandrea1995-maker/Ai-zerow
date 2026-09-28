# AI-ZEROW-COMMAND — reconstruction baseline

This Site is a new reconstruction workspace. It does not replace or modify the source repository.

## Pinned source

- Repository: `barbaandrea1995-ui/zerow-platform`
- Branch: `feat/pwa-ui-ux-refactor`
- Active SHA: `a07c72bc4bafd3bc47dce41c3cd272cdf42d3f63`
- Main comparison SHA: `7063ce785924939217d0adf98a429668f15caa5e`
- Research status: `READY_WITH_BLOCKERS`
- Sites execution status: `S01 CLOSED — SITES ONLY`

## Evidence policy

The UI preserves the source research labels exactly: `VERIFIED`, `PARTIALLY_VERIFIED`, `UNKNOWN`, `NOT_RUN`, `BLOCKED`, `ADAPTER_REQUIRED`, `REBUILDABLE_STATIC`, and `REBUILDABLE_WITH_ADAPTERS`.

Static route, schema and source evidence is not runtime certification. Unknown interaction behavior remains unknown until an authorized exact-SHA test produces evidence. No secret, token, connection string or bypass payload is stored in this project.

## Initial scope

The first Site slice implements the shared evidence console and route-aware shell. Sites-native workspace auth and D1 authority persistence are now implemented for S02. Neon, external multi-tenant identity, domain services, event consumers, object storage, OpenAI runtime, service worker exact-build identity, camera, GPS and native mobile remain explicit adapter boundaries from the reconstruction blueprint.

## S01 closure in Sites

S01 is closed for the AI-ZEROW Sites execution scope. The baseline, evidence policy, ownership boundary and Sites project identity are locked in this checkout.

Vercel, GitHub and Neon are intentionally outside the operating workflow for this project. Their runtime bindings are deferred adapter boundaries, not open S01 blockers. No external platform deployment, repository operation or runtime claim is required to continue the Sites reconstruction.

Closure evidence for this Sites scope:

- baseline and source evidence policy recorded here;
- Sites project and owner-only access verified;
- current Sites source opens and packages successfully;
- TypeScript and Site build checks pass;
- private Sites publication succeeds from the exact packaged source.

The labels `ADAPTER_REQUIRED`, `NOT_RUN` and `UNKNOWN` remain visible only where they describe future runtime capabilities; they do not reopen S01.

## S02 closure in Sites

S02 is closed for the Sites execution scope. The Authority/Onboarding surface now uses the Sites workspace identity headers server-side, derives the owner-private Site tenant context, applies the canonical `tenant.manage` permission gate and persists access profiles in the Sites D1 binding `DB`.

The browser submits only a profile label and one canonical base role. The server supplies the actor, tenant, creator and capability array; cross-tenant resource scope is guarded by `assertTenantScope`. The UI readback is served by `GET /api/authority/access-profiles`, and profile creation by `POST /api/authority/access-profiles`.

S02 closure is intentionally limited to the Sites-only tenant model. The source-research multi-tenant adapter, external identity provider and Neon runtime remain deferred and are not represented as completed capabilities.
