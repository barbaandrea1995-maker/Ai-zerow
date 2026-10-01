# Server naming checkpoint — 2026-10-01

## Decision

AI-ZEROW COMMAND assigns canonical identifiers on the server when a new S04
record is created. The browser submits a description and optional barcode; it
never chooses the tenant, sequence or canonical code.

| Domain | No barcode | With barcode |
| --- | --- | --- |
| Commesse | `COMM-0001`, `COMM-0002`, … | commessa sequence remains server-owned |
| Asset | `ASSET-0001`, … | barcode kept as canonical code |
| Mezzi | `MEZZI-0001`, … | barcode kept as canonical code |
| Attrezzature | `ATT-0001`, … | barcode kept as canonical code |
| Materiali | descriptive code, e.g. `CHIUS-GHIS-50x50` | barcode kept as canonical code |

Material codes use a normalized description, short readable stems and detected
dimensions. A repeated description receives a suffix such as `-0002`.

## Implementation boundary

- D1 remains the canonical Sites control plane; Neon authorization is not a
  cutover and is not used as the sequence authority.
- Counters live in the tenant-scoped `entity_code_counters` table and advance
  through one atomic SQLite upsert.
- `s04_records.canonical_code` stores the visible code separately from the
  existing technical row ID, preserving current cross-domain references.
- `s04_records_tenant_module_code_uq` prevents duplicate canonical codes in a
  tenant/module; barcode collisions return a recoverable `409`.
- The existing Operations, Assets and Warehouse APIs use the same naming
  service and return the created row plus verified tenant-scoped readback.
- Assets and Warehouse registration surfaces now expose the server naming flow;
  the QR/barcode module remains the code readback surface.

## Pre-publication verification

- `pnpm exec tsc --noEmit`: PASS
- `pnpm lint`: PASS, 0 errors; existing warnings only
- `pnpm build`: PASS
- `git diff --check`: PASS
- Migration `0007_server_naming.sql`: schema-only, D1-safe and bounded

## Publication evidence

Deployment details and post-deploy create/readback evidence are appended after
the production Site publication.
