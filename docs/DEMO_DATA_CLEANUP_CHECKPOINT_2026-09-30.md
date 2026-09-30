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
