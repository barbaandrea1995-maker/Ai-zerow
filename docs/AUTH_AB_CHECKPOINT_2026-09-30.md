# AI-ZEROW-COMMAND — AUTH-AB checkpoint

## Decisione

`CERTIFIED · AUTH-AB ISOLATED BRANCH`

Il gate Auth/tenant A/B è implementato e verificato su una branch Neon isolata
del progetto autorizzato `AI-ZEROW COMMAND`. La certificazione non modifica la
chiusura S01–S10, non sostituisce il tenant Sites del command center e non
promuove D1 a un ruolo secondario: D1 resta il control plane canonico.

## Perimetro

- Neon project: `proud-dream-31716379`
- Production branch non modificata: `br-cool-king-zauea5pa`
- Certification branch: `br-dark-water-zayxq14d` (`auth-ab-certification-20260930`)
- Database: `neondb`
- Auth base: Neon Auth / Better Auth
- Fixture organizations: `auth-ab-tenant-a` e `auth-ab-tenant-b`
- Fixture users: `auth-ab-a@example.com` e `auth-ab-b@example.com`
- Fixture password: non registrata nel repository o in questo checkpoint

La branch isolata contiene esclusivamente fixture di test. Nessun dato fixture
è stato scritto sulla branch production; la branch resta separata per consentire
un readback ripetibile senza usare credenziali reali.

## Contratto implementato

- `lib/neon-auth/server.ts` crea Neon Auth solo quando base URL e cookie secret
  sono configurati; il secret non è esposto al client.
- `app/api/auth/[...path]/route.ts` espone il proxy server-side per le operazioni
  Auth necessarie.
- `lib/neon-auth/tenant-context.ts` risolve sessione, user, organizzazioni e
  membership dal server Auth; in caso di errore il contesto chiude in fail-closed.
- `/api/auth-ab/readback?tenantId=...` accetta il tenant richiesto solo se la
  membership appartiene alla sessione corrente. Il tenant inviato dal client non
  viene trattato come prova di autorizzazione.
- `/auth-ab` fornisce la superficie owner-visible per il checkpoint e i readback
  positivi; il runtime principale non è stato riallineato automaticamente a Neon.

## Evidenze osservate

| Check | Risultato |
| --- | --- |
| Fixture A sign-in | `200`, user A verificato |
| Fixture A session readback | `200`, sessione associata a user A |
| Fixture A organization list | `200`, solo `auth-ab-tenant-a` |
| Fixture A membership readback | `200`, ruolo `owner` |
| Fixture A → Tenant B | `403`, `You are not a member of this organization` |
| Fixture B sign-in | `200`, user B verificato |
| Fixture B session readback | `200`, sessione associata a user B |
| Fixture B organization list | `200`, solo `auth-ab-tenant-b` |

La verifica upstream Neon è stata eseguita senza riportare o salvare token di
sessione. Il percorso applicativo è entrato nella build Vinext e TypeScript lo
riconosce come `/auth-ab`, `/api/auth/:path+` e `/api/auth-ab/readback`.

## Verifiche del source

- `pnpm exec tsc --noEmit`: PASS
- `pnpm lint`: PASS, nessun errore; warning preesistenti non bloccanti
- `pnpm build`: PASS
- Il preview locale Wrangler è rimasto bloccato da `uv_interface_addresses`
  dell’ambiente e il preview Vinext non ha esposto la porta nel namespace di
  esecuzione; questo è un limite del preview locale, non un PASS browser del
  Site live.

## Stato successivo

AUTH-AB è chiuso per la certificazione isolata A/B. Restano separati e non
certificati: provisioning delle membership reali sulla branch production,
cutover del runtime principale da Sites/D1 a Neon Auth, device/native QA e la
matrice B0–B10/W20. Nessun cutover deve essere effettuato implicitamente.

