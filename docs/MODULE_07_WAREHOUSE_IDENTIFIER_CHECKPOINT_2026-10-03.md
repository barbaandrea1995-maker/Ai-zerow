# Module 07 · Warehouse identifiers checkpoint

Date: 2026-10-03
Status: local implementation verified; not published in this tranche.

## Canonical flow

1. The Warehouse registration surface is the only material-registration entry point.
2. The server always assigns the canonical material ID/SKU from the material description. The operator cannot type or override it.
3. A physical barcode is optional. When supplied, it is stored as the tenant-scoped physical identifier and remains visible in the material register.
4. When no barcode is supplied, the server creates `AZ1|MATERIAL|<server-id>` as the QR payload and stores it on the material record. The Warehouse inspector renders a printable QR preview.
5. Unit of measure and warehouse are read from server catalogs. Shelf is optional and tenant-owned.
6. A movement can start from a local ZXing camera/manual scan. The server resolves barcode, QR, SKU or material ID inside the current tenant before the movement is allowed.
7. A remote/planned movement uses the server-read inventory catalog. Options are filtered by the current operation (available or reserved stock) and the write route rechecks balance, version and tenant scope.

## Persistence and audit

- `inventory_items.storage_shelf`
- `inventory_items.barcode` with tenant uniqueness
- `inventory_items.qr_code` with tenant uniqueness
- server identifier resolution on `GET /api/warehouse/inventory?identifier=...`
- identifier-aware movement writes on `POST /api/warehouse/inventory`
- existing append-only movement/event/outbox/reconciliation chain preserved

## Verification

- TypeScript: PASS
- ESLint: PASS (legacy image optimization warnings only)
- Drizzle schema check: PASS
- Commercial verification: PASS
- E2E contract/button audit: PASS_WITH_AUTHENTICATED_GATE
- Production browser/authenticated runtime: NOT_RUN in this local tranche
- Deployment: intentionally not performed
