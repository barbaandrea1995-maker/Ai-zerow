# AI-ZEROW-COMMAND — Neon usage authorization

## Authorization record

- Project: `AI-ZEROW-COMMAND`
- Neon project: `AI-ZEROW COMMAND` (`proud-dream-31716379`)
- Branch: `production`
- Database: `neondb`
- Usage status: `AUTHORIZED_FOR_PROJECT_USE`
- Recorded: `2026-09-29` (`Europe/Rome`)

This record authorizes Neon integration work for AI-ZEROW-COMMAND, including the
schema/migration adapter, Neon Auth integration and runtime binding work, within
the existing approval and tenant-scope boundaries.

## What this does not certify

Authorization is a project permission, not runtime evidence. It does not by
itself certify a live Neon readback, migration parity, production cutover,
tenant isolation, Auth session flow or external writes. The Sites D1 adapter
remains the current canonical control-plane readback until those checks are
completed. A separate owner-only, read-only Neon runtime readback is now wired
to `DATABASE_URL`; it is evidence of binding, not a migration or tenant-isolation
certification.

No secret, token, connection string or provider credential is stored in this
record. The canonical status is exposed in the S10 external adapter registry as
`AUTHORIZED` + `DEFERRED`.

## S10 readback checkpoint

Il readback diretto e il checkpoint runtime sono documentati in
`docs/NEON_S10_READBACK_CHECKPOINT_2026-09-30.md`. L'autorizzazione resta valida;
il runtime è `PARTIALLY_VERIFIED`, mentre i marker `0016/0017`, il read scope
`neon_auth` e la parità Auth/tenant restano aperti.
