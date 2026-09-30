# AI-ZEROW-COMMAND — Auth production bridge checkpoint

## Decisione

`IMPLEMENTED · SITES/D1 + NEON AUTH BRIDGE`

Il Site usa Neon Auth come identità/sessione della PWA e Cloudflare D1 come
control plane canonico per tenant, membership, ruoli e capability. Sites Auth
resta il perimetro owner del Site privato. Nessun valore inviato dal browser è
considerato una prova di identità, ruolo o tenant.

## Implementazione

- `lib/authority-context.ts` risolve identità Sites o Neon server-side.
- La membership viene letta da `tenant_memberships` filtrando insieme
  `identity_provider`, `actor_id`, stato attivo e tenant attivo.
- Il ruolo viene validato contro il catalogo capability; un ruolo sconosciuto
  chiude il contesto in fail-closed.
- `/api/auth/tenant` permette di selezionare solo un tenant già autorizzato in
  D1 e salva una preferenza `HttpOnly`; il cookie non concede accesso.
- `/login` espone il login Neon Auth per la superficie PWA.
- `/login` espone anche la creazione controllata dell’account Neon quando il
  branch Auth lo consente.
- `/api/auth/neon-membership` implementa il provisioning della membership Neon
  solo con doppia prova server-side: owner Sites attivo + sessione Neon attiva.
  Il browser può chiedere il collegamento, ma non può scegliere actor, ruolo o
  tenant fuori dal perimetro EMS già autorizzato.
- `/tenants` espone il collegamento operativo e il readback del risultato senza
  esporre session ID o segreti.
- La migration `0005_chunky_patch.sql` aggiunge `identity_provider` alla
  membership esistente e aggiorna il vincolo univoco tenant/provider/actor.

## Evidenze verificate

- TypeScript: `PASS`.
- Lint: `PASS`; restano solo warning preesistenti del progetto.
- Build Vinext: `PASS`.
- Deploy Sites: completato sul Site privato owner-only.
- D1 binding `DB`: presente.
- D1 `tenants`: tenant EMS attivo.
- D1 `tenant_memberships`: membership Sites owner attiva, provider `sites`.
- TypeScript: `PASS` dopo il provisioning bridge.
- Build Vinext: `PASS`; route `/api/auth/neon-membership` presente.

## Confini ancora aperti

- La membership Neon reale verrà creata al primo collegamento eseguito da
  Andrea dopo accesso/signup Neon; il percorso server-side è ora pronto e non
  crea identità o password inventate.
- Il Site resta `custom` owner-only; non è stata cambiata la visibilità per
  utenti esterni.
- Il test live A/B con due identità Neon e rifiuto cross-tenant `403` resta un
  gate distinto; la prova già registrata in `AUTH_AB_CHECKPOINT` è isolata su
  branch di certificazione.

## Regola di promozione

Nessun cutover pubblico viene considerato chiuso finché non sono presenti le
membership Neon reali in D1 e non sono verificati `401`, accesso A/B,
membership revocata, capability insufficiente e cross-tenant `403`. Il codice
per il primo provisioning è chiuso; l’attivazione dell’identità reale resta
un’azione esplicita dell’owner.
