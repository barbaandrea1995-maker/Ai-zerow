# AI-ZEROW COMMAND — checkpoint multi-tenant e mission resources

**Data:** 2 ottobre 2026

**Stato:** `IMPLEMENTED_STATIC · NOT_DEPLOYED · COMMERCIAL NO-GO`

**Deploy eseguito in questo passaggio:** no

**Runtime pubblicato invariato:** Sites v86 owner-only

Questo checkpoint registra il riallineamento del dominio operativo richiesto per un gestionale multi-azienda, multi-tenant e cross-tenant. L’implementazione è presente nel codice locale e nei contratti statici; non è una certificazione runtime autenticata né una dichiarazione di versione commerciabile.

## Perimetro aziendale configurabile

Ogni tenant ha un profilo operativo persistito in D1 e un insieme di domini derivato server-side:

| Profilo | Domini | Superfici abilitate |
|---|---|---|
| `OPERATIONS` | operations | commesse, planning, field, documenti, finance e procurement secondo ruolo |
| `WAREHOUSE` | warehouse | magazzino, scorte, richieste e movimentazioni |
| `TRANSPORT` | transport | missioni, autisti, mezzi, asset di trasporto e consegne |
| `WAREHOUSE_TRANSPORT` | warehouse + transport | deposito, flotta, autisti e consegne |
| `FULL_OPERATIONS` | operations + warehouse + transport | perimetro completo |

L’onboarding espone questi profili. La selezione viene salvata da `/api/tenants/profile` solo con `tenant.manage`; ad ogni richiesta il contesto D1 ricalcola le capability del ruolo filtrandole sui domini del tenant. Il profilo non è quindi una preferenza solo grafica e il client non può ampliare il perimetro.

## Isolamento e passaggio cross-tenant

- `tenantMemberships` resta la fonte di autorizzazione per ogni tenant accessibile.
- Il cookie `zerow_tenant_id` è solo una selezione: ogni richiesta lo verifica contro una membership attiva e un tenant attivo.
- Selezione cross-tenant disponibile tramite `/api/auth/tenant`; un ID non appartenente all’identità corrente restituisce `cross_tenant_access_denied`.
- Le route di dominio continuano a derivare `context.tenantId` server-side; il body del browser non può scegliere il tenant dei dati.
- Il selettore tenant è presente nella Command e mostra profilo/ruolo del contesto scelto.

## Missione, autista, mezzo e asset consegnato

La creazione missione ora segue questa catena:

1. L’azienda registra un autista reale nel modulo Workforce (`entityType=driver`).
2. L’azienda registra un mezzo reale nel modulo Asset (`entityType=vehicle`); un asset/equipment consegnabile è registrato con tipo esplicito.
3. La finestra data/ora interroga `/api/mission/resources`.
4. Il selettore mostra solo risorse del tenant, con lifecycle operativo e senza sovrapposizioni in missioni/planning attivi.
5. La conferma invia solo `driverId`, `vehicleId` e, se presente, `cargoAssetId`.
6. Il server ricalcola disponibilità, tenant, tipo, lifecycle e conflitto temporale prima del commit.
7. Il record missione conserva gli ID e uno snapshot leggibile di codice/etichetta per la provenienza storica.

Il testo libero `driver`/`vehicle` è rifiutato con `mission_free_text_resources_not_allowed`. Un conflitto restituisce `409 mission_resource_conflict`; un autista o mezzo mancante/non operativo non può essere assegnato. Il Bobcat, se rappresentato come asset cargo, è selezionabile come asset da consegnare e richiede comunque autista e mezzo reali.

Per un tenant `TRANSPORT` o `WAREHOUSE_TRANSPORT` senza commesse Operations, la Command crea una missione autonoma: il server assegna il codice `MISS-0001`-style, crea il record trasporto e il relativo journey/event/outbox nello stesso commit D1. Se esistono commesse Operations, la stessa schermata propone il collegamento alla commessa reale.

## Riallineamento UI e navigazione

- Rimossa la voce FIELD dalle sidebar legacy dove non esisteva una route autonoma.
- Finance, Documenti, PWA e Eventi ora usano le rispettive route reali; Eventi usa il gate `events.read` coerente con il layout.
- Le voci di menu sono filtrate dal contesto autorizzato e dal profilo operativo; i ruoli non vedono moduli fuori perimetro.
- Il core animato della Command usa l’asset fornito `/public/ai-zerow-icon.png`; non usa più la lettera Z generata via CSS.
- La registrazione tenant richiede nome, slug e profilo espliciti; non viene più creato implicitamente un tenant EMS da body vuoto.

## Evidenza locale

Controlli eseguiti dopo l’allineamento:

- `pnpm exec tsc --noEmit` — PASS
- `pnpm lint` — PASS, 8 warning legacy `img`, 0 errori
- `pnpm build` — PASS
- `pnpm verify:commercial` — PASS
- `git diff --check` — PASS

Lo smoke HTTP locale della tranche precedente era PASS; dopo l’aggiunta della missione autonoma il preview sandbox ha aperto il listener ma ha lasciato le richieste pendenti. Per questo l’evidenza runtime di questo ultimo commit resta `NOT_RUN_ENVIRONMENT_BLOCKED`, mentre build e contratti statici restano PASS.

## Gate ancora aperti

Questa tranche non chiude i gate esterni:

- migration D1 del nuovo profilo tenant non applicata al runtime pubblicato;
- OpenAI live autenticato non eseguito/readback non certificato;
- provider mappa e GPS browser non collegati;
- malware scanner e consumer/executor esterni non certificati;
- test Neon A/B, browser/device/PWA e sign-off security/privacy/commerciale non eseguiti;
- smoke runtime ripetibile su questo ultimo commit, smoke autenticato del nuovo flusso e certificazione browser/device non eseguiti; il precedente smoke locale non viene riutilizzato come prova del commit corrente.

**Decisione:** mantenere il deploy congelato e `promotionAllowed=false` finché questi gate non producono evidenza ripetibile.
