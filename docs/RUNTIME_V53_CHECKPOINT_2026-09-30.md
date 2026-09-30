# AI-ZEROW-COMMAND — runtime v53 checkpoint

Checkpoint: 2026-09-30 23:16 Europe/Rome  
Site: `AI-ZEROW-COMMAND`  
Sites project: `appgprj_6abaaf2bb58081919b265a8a6ad76dbb`

## Decisione

`CLOSED · v53 runtime repair`

La regressione runtime osservata dopo v52 è stata corretta con una modifica
minima e pubblicata sul Site production owner-only. Neon resta il provider di
identità/sessione autorizzato; D1 resta il control plane canonico per tenant,
membership, ruoli e capability.

## Correzione applicata

- l'inizializzazione server-side di Neon Auth ora è fail-closed: un errore di
  bootstrap non fa più fallire il modulo e lascia renderizzare lo stato Auth
  controllato;
- il nome dell'attore usa l'email come fallback quando il profilo Auth non
  restituisce un nome stringa valido;
- il menu account non assume più che `actor.name` sia sempre valorizzato.

Non sono state modificate migrazioni, schema, dati Neon, binding D1 o policy di
accesso del Site.

## Evidenze v53

- Commit sorgente pubblicato: `0fbc93a79e321a099eb6fa8d91761d669c0ed13b`.
- Sites deployment: `appgdep_6abd7bde93888191b6ff604ae3150c71`, `succeeded`.
- Versione Site: `53`; URL live invariata:
  `https://ai-zerow-command.barba-andrea-1995.chatgpt.site`.
- TypeScript: `PASS`.
- Lint: `PASS`; restano solo i 13 warning non bloccanti già noti.
- Build Vinext: `PASS`, incluse le route `/login`, `/command`, `/settings` e
  `/api/events`.
- `git diff --check`: `PASS`.
- Browser live: `/login` renderizza la UI Auth senza errore server;
  `/command` e `/settings` redirigono correttamente a `/login` in assenza di
  sessione.
- Worker logs production, finestra post-deploy di 15 minuti,
  `errors_only=true`: nessun evento.
- Accesso Sites: `custom`, owner-only, revision 3; invariato.

## Limiti del checkpoint

La sessione browser usata per il controllo non conteneva una sessione Neon
attiva; quindi il menu account autenticato, il readback tenant post-login e il
percorso A/B production restano gate separati. Questo checkpoint certifica la
stabilità del bootstrap pubblico/non autenticato e delle redirezioni protette,
non promuove Neon a control plane e non chiude il gate Auth production A/B.
