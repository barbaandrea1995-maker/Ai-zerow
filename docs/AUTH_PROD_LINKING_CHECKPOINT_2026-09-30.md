# AI-ZEROW-COMMAND — Neon production identity linking checkpoint

Recorded: `2026-09-30` (`Europe/Rome`)

## Esito

`VERIFIED · V49 · OWNER-MEDIATED PROVISIONING`

Il ponte Neon Auth → D1 è operativo e verificato in production. La membership
reale non viene creata automaticamente dal deploy: è stata creata quando
l’owner Sites, già autenticato, ha collegato la propria sessione Neon attiva
dal Tenant directory.

## Percorso

1. Aprire `/login`.
2. Accedere o creare l’account Neon Auth.
3. Aprire `/tenants`.
4. Premere `Collega sessione` nel pannello Neon Auth.

Il server richiede contemporaneamente:

- owner Sites autenticato;
- capability `tenant.manage`;
- sessione Neon autenticata;
- tenant EMS già attivo e già posseduto dal perimetro Sites.

Il browser non può scegliere `actorId`, provider, ruolo o tenant arbitrario.
La membership creata è `identity_provider = neon`, `status = active` e ruolo
`owner`, perché il collegamento è limitato al self-link dell’owner corrente.

## Implementazione

- `app/login/login-client.tsx`: sign-in e signup Neon.
- `app/api/auth/neon-membership/route.ts`: GET/POST di readback e linking
  server-side con fail-closed e rifiuto cross-tenant.
- `app/tenants/tenants-client.tsx`: controllo operativo e readback del link.
- `lib/authority-context.ts`: resolver Sites-owner separato e lettura D1
  riutilizzabile per identità server-derived.

## Evidenza di pubblicazione

- Site: `AI-ZEROW-COMMAND`
- Versione: `49`
- URL: `https://ai-zerow-command.barba-andrea-1995.chatgpt.site`
- Accesso: `custom`, owner-only invariato
- TypeScript: `PASS`
- Lint: `PASS`, 13 warning preesistenti non bloccanti
- Build: `PASS`
- D1 schema: `tenant_memberships.identity_provider` presente
- Readback D1 production: tenant EMS attivo e due membership `owner` attive,
  una `identity_provider = sites` e una `identity_provider = neon`.
- Membership Neon: `VERIFIED` dopo l’azione esplicita dell’owner; il browser
  non ha fornito actor, ruolo o tenant.

## Confini

Questo checkpoint non certifica ancora A/B reale con due utenti Neon, revoca
membership, capability insufficiente o cross-tenant `403` sulla production.
La certificazione A/B isolata resta quella registrata in
`AUTH_AB_CHECKPOINT_2026-09-30.md`.
