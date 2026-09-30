# AI-ZEROW-COMMAND — U5 Job Workspace checkpoint

Date: 2026-09-30  
Scope: roadmap continuation after the certified S01–S10 Sites closures

## Decision

U5 is implemented as a bounded Sites/D1 readback tranche: a tenant-scoped Job Workspace for an existing commessa, preserving the `jobId` cross-domain key and the current Operations shell.

D1 remains canonical for application authority and operational readback. Neon remains limited to the authorized identity/session adapter and readback boundary. This tranche adds no Neon schema, data write, migration or external operating workflow.

## Production provenance

- Project: `AI-ZEROW-COMMAND`
- Sites project: `appgprj_6abaaf2bb58081919b265a8a6ad76dbb`
- Production version: `56`
- Deployment: `appgdep_6abd823296a08191a67c9a57c7f4fbc6`
- Source commit: `4c82813088192f3367282b90890910a29f60e067`
- Live URL: `https://ai-zerow-command.barba-andrea-1995.chatgpt.site`

## Implemented surface

- `GET /api/operations/jobs/:jobId` returns a tenant-scoped Job Workspace read model from the existing S04 D1 records.
- `/operations/:jobId` renders the workspace with explicit `readback`, `empty` and `deferred` states for the golden journey.
- `/operations` links a real adapter-backed commessa to its workspace and shows an explicit empty/readback state when no D1 record is available; no demo fallback is rendered.
- Cross-domain sections are selected only through same-tenant payload references; no unscoped lookup or write action was introduced.
- Public `/login` rendering no longer performs an upstream Neon session read or eagerly initializes the Auth client during SSR. Protected routes and the account menu continue to verify the session server-side.

## Verification evidence

- Real D1 commessa `OPERATIONS-47363CDE` opened the workspace in production and showed `Nuova commessa`, D1 scoped readback and the expected `DEFERRED` downstream states.
- Unknown commessa `OPERATIONS-TEST` returned a controlled not-found workspace state.
- Production login checks: `/login` rendered successfully, `/login?mode=forgotPassword` rendered `Recupera accesso`, and a return to `/login` rendered successfully.
- Post-v56 Worker error query: zero error events in the five-minute window covering the live checks.
- `npx tsc --noEmit`: pass.
- `npm run lint`: pass, 13 pre-existing warnings and no errors.
- `npm run build`: pass; the Job Workspace API/page routes and `/login` are included in the production build.
- `git diff --check`: pass.

## Explicit bounds

U5 does not close the full commessa lifecycle. Activities, planning, assignment, attendance, work context, field operations, rapportino and control remain empty or deferred when their canonical records are not present. No write workflow, state-machine certification, external service parity, device certification or new roadmap gate is claimed by this checkpoint.

The next change must remain additive and follow the roadmap’s next bounded tranche; the existing S01–S10 Sites closures and the Neon authorization boundary are unchanged.
