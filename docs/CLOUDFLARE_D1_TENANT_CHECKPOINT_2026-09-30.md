# AI-ZEROW-COMMAND — Cloudflare/D1 tenant checkpoint

## Stato

- Piattaforma canonica: Sites + Cloudflare D1 (`DB`)
- Deploy production: Site privato owner-only, versione `43`
- Commit pubblicato: `72dbbee88d295df76a1b0ec165a0675ac9e18f51`
- URL: `https://ai-zerow-command.barba-andrea-1995.chatgpt.site`
- Migration applicata: `drizzle/0004_colorful_giant_man.sql`

## Directory tenant

Il modello D1 ora comprende:

- `tenants`: directory canonica con slug, stato e timestamp
- `tenant_memberships`: membership attribuita all'identità Sites autenticata, con ruolo e stato
- indici univoci su slug e sulla coppia tenant/actor

Il provisioning iniziale è server-side e idempotente. La pagina `/tenants` esegue il readback e, se il tenant non esiste, crea il tenant primario:

- nome: `EMS EDILIZIA MULTISERVIZI SRLS`
- slug: `ems-edilizia-multiservizi`
- tenant ID: `sites:appgprj_6abaaf2bb58081919b265a8a6ad76dbb`
- membership: `owner`, `active`

Il tenant riusa il Sites project boundary già usato dai read-model S04–S07; nessun dato esistente viene spostato o duplicato.

## Verifica production

- D1 overview: binding `DB` presente; `tenants` e `tenant_memberships` presenti.
- Readback `tenants`: una riga `active` per EMS.
- Readback `tenant_memberships`: una membership `owner` `active` associata all'identità Sites corrente.
- UI `/tenants`: `PROVISIONED · CLOUDFLARE D1`, con membership visibile.
- Neon Auth A/B resta un adapter di certificazione isolato; non è stato promosso a control plane.

## Gate

Cloudflare/D1 tenant bootstrap: **CLOSED · VERIFIED**.

La selezione di ulteriori tenant e l'invito di altri attori possono essere aggiunti sopra questa directory; il tenant primario e la membership owner sono già creati e read-backati in production.
