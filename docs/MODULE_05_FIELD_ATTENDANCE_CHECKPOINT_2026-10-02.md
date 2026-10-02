# AI-ZEROW COMMAND — Modulo 5 / Presenze + FIELD checkpoint

**Data:** 2 ottobre 2026  
**Perimetro:** W05 / presenza operativa, timbratura e collegamento alla workspace FIELD  
**Baseline visiva:** COMMAND ultra-carbon / neon lime  
**Stato:** TECHNICAL PASS — PUBLISHED PRIVATELY · latest private Sites version verified · owner-only

## Decisione di dominio

Presenze non è un registro isolato. È il punto di readback tra attività pianificata, persona autorizzata e prova dell’esecuzione nella commessa.

La catena canonica è:

Piano pubblicato → workspace commessa → check-in/pausa/ripresa/check-out → timestamp server → GPS on-duty opzionale → geofence esplicito → readback

Il modulo non registra autisti, mezzi o persone. Authority e Workforce restano i registri canonici; la selezione delle risorse avviene in Pianificazione e la missione resta in Mission.

## Riallineamento eseguito

- /presenze ora usa la stessa shell commerciale di Command, Workforce e Planning: sidebar collassabile, logo ZEROW, ricerca centrale, tenant switcher, notifiche, profilo, back e refresh.
- La superficie è stata ricostruita come control deck FIELD + ATTENDANCE, con hero, KPI, live board, vista evidenze, filtri e context inspector.
- Ogni evidenza mostra commessa/missione, operatore autorizzato, stato, versione, timestamp server-side, timestamp osservato dal client e stato geofence.
- Dal record di una commessa si apre la workspace FIELD reale; il controllo di entrata, pausa, ripresa e uscita usa il componente e l’endpoint già esistenti.
- Dopo una timbratura il readback centrale viene aggiornato; non viene duplicata alcuna scrittura locale.
- Il tracking è dichiarato ON_DUTY_ONLY; la posizione viene richiesta solo durante l’azione di presenza.
- Il geofence espone separatamente INSIDE, OUTSIDE, UNCERTAIN, NO_GEOFENCE e NO_LOCATION.
- Company AI è collegata solo come superficie di analisi verso Command; non esegue scritture dirette di presenza.

## Contratti mantenuti

- GET /api/workforce/attendance resta tenant-scoped, capability-gated e actor-filtered quando il ruolo non ha visibilità trasversale.
- GET/POST /api/operations/jobs/:jobId/attendance resta il contratto canonico per il controllo di turno.
- Il server assegna il timestamp ufficiale, verifica la versione attesa e applica idempotenza.
- La geolocalizzazione viene sanificata, arrotondata e valutata dal server quando la commessa possiede un geofence.
- Workforce e Authority continuano a governare ruoli, capability e perimetro; Presenze non amplia l’accesso.
- Il modulo non dichiara tracker GPS continuo, provider cartografico, replay offline o certificazione device finché non esiste evidenza runtime dedicata.

## Verifiche locali

- TypeScript: PASS.
- ESLint: PASS, restano solo 8 warning legacy sulle immagini in moduli precedenti.
- Build Sites/Vinext: PASS.
- Verifica contratto commerciale: PASS.
- Audit superficie: PASS_WITH_EXTERNAL_GATES; nessun endpoint irrisolto, nessun gap di navigazione, nessun pulsante Command attivo non collegato.
- Smoke runtime locale: NON CERTIFICATO IN QUESTA SESSIONE; il container rifiuta la connessione alla porta locale con EPERM.
- git diff --check: PASS.

## Gate ancora espliciti

Privacy/retention/DPIA, GPS continuo, provider map, offline queue/replay certificato, browser/device autenticato e approvazione umana restano gate separati. Questo checkpoint certifica il contratto Sites/D1 e la superficie commerciale implementata, non un runtime telematico esterno.

## Pubblicazione

- Site: https://ai-zerow-command.barba-andrea-1995.chatgpt.site
- Versione pubblicata: latest private Sites version verified after this checkpoint
- Audience: custom owner-only invariata
