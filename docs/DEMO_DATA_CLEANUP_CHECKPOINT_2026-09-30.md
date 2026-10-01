# AI-ZEROW-COMMAND — demo data cleanup checkpoint

Date: 2026-09-30  
Scope: production cleanup for the Sites/D1 PWA

## Outcome

The PWA keeps its existing shell, routes, links and write/readback behaviors, but no longer renders seeded or QA-only operational data. Empty states now come from the tenant-scoped D1 readback instead of static demo fallbacks.

## D1 scope

Migration `drizzle/0006_remove_demo_data.sql` removes only:

- S04 rows marked `sites-s04-seed`;
- S05 rows marked `sites-s05-seed`;
- S06 seed events, outbox rows and reconciliations;
- the two QA-only PWA diagnostics events and their derived outbox/reconciliation rows;
- S07 seed ledger rows;
- the single QR row that pointed to the seeded asset.

The real owner-created commessa `OPERATIONS-47363CDE`, the EMS tenant, memberships and authority boundary are preserved. Historical seed migrations are retained as provenance; the cleanup migration is repeatable for the current production state.

## UI scope

- COMMAND, Operations and S04 modules now show empty readback states.
- Authority no longer shows fake users, teams, activity, access counts or trend lines; canonical role/capability/policy catalogs remain available.
- S05 modules, Events, QR/Barcode and External Control no longer show decorative demo trends or seeded identifiers.
- QR generation, scanner/manual resolution, append-only S05 proposals, event append, Authority profile creation and PWA diagnostics actions remain connected to their existing APIs.

## Verification

- `npx tsc --noEmit`: pass
- `npm run lint`: pass, existing warnings only
- `npm run build`: pass
- `git diff --check`: pass
- Runtime identifier sweep: no demo IDs found in `app/`, `components/` or `lib/`.

The production deployment ID and post-deploy D1 counts are appended after publication.

## Production publication

- Version: `57`
- Commit: `ec9d71aa6df57208c42d15ecb2b34a27e98c2585`
- Deployment: `appgdep_6abd8ac56bec81918286cb0b2a076196`
- Status: `succeeded`
- URL: `https://ai-zerow-command.barba-andrea-1995.chatgpt.site`

Post-deploy D1 readback: `s04_records=1` (the real `OPERATIONS-47363CDE`), `s05_records=0`, `s06_events=0`, `s06_outbox=0`, `s06_reconciliations=0`, `s07_ai_ledger=0`, `qr_codes=0`, `access_profiles=0`, `tenants=1`, `tenant_memberships=2`.

Unauthenticated `/command` correctly redirects to `/login`; the public login surface renders successfully.

## Production re-publication — 2026-10-01

The current aligned source was republished privately after the cleanup and
AUTH-AB source reconciliation.

- Version: `58`
- Commit: `2afcee33ff6d023f4db04e786312659fb5d8c9c2`
- Deployment: `appgdep_6abddb5e2e7c81918579786367cba6bd`
- Status: `succeeded`
- URL: `https://ai-zerow-command.barba-andrea-1995.chatgpt.site`
- TypeScript, lint, build, diff check and runtime demo-identifier sweep: pass
- Worker error logs after publication: none observed

Post-deploy readback repeated on version 58: one real S04 commessa
(`OPERATIONS-47363CDE`), zero S05/S06/S07/QR/access-profile demo rows, one EMS
tenant and two active owner memberships. The publication includes the
server-side AUTH-AB surface, but does not perform a Neon Auth production
cutover; Sites/D1 remains canonical.
