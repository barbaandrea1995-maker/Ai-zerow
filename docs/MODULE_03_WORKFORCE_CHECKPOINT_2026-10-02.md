# AI-ZEROW COMMAND — Modulo 3 / Workforce checkpoint

**Data:** 2 ottobre 2026  
**Perimetro:** `WORKFORCE` / persone autorizzate, disponibilità, turni e presenze collegate  
**Baseline visiva:** COMMAND ultra-carbon / neon lime  
**Stato:** IMPLEMENTED — tranche UI/UX commerciale + confine Authority riallineato

## Decisione di dominio

La registrazione di persone, autisti e capability appartiene ad **Authority**. Il modulo Workforce non è un secondo registro identità e non espone più `Registra autista`.

Il flusso canonico è:

`Authority invite/role → accettazione identità → risorsa workforce provisionata → Workforce/Planning → Mission`

La scelta di autista, mezzo e asset resta sempre server-side e vincolata a tenant, stato e disponibilità nella finestra della missione.

## Riallineamento eseguito

- `/workforce` ora usa una superficie dedicata coerente con il Command shell: sidebar collassabile, topbar con logo ZEROW, ricerca centrale, refresh reale, mobile drawer e palette carbon/lime.
- Rimossa la CTA `Registra autista` dal modulo 3.
- Rimossa la possibilità di creare workforce tramite il dialog generico di registrazione asset/materiali.
- `POST /api/workforce` risponde `409 workforce_registry_authority_only` e indica `/onboarding` come percorso corretto.
- Workforce legge persone autorizzate, ruoli, risorse driver provisionate, piani, presenze e geofence tramite `/api/workforce/overview` tenant-scoped.
- I filtri `Autisti`, `Field` e `Disponibili` lavorano solo su dati riletti dal server.
- La superficie mostra esplicitamente la relazione Authority → provisionamento → Mission e collega i pulsanti a Authority, Planning, Presenze e Mission.
- Il modulo non consente assegnazioni libere o testo manuale per risorse operative.

## Authority → Mission

- Un invito Authority con ruolo `driver`, dopo accettazione Neon con email corrispondente, crea una risorsa workforce `driver` con codice server `DRV-*`.
- La risorsa è collegata alla membership tramite `authorityMembershipId` e viene resa selezionabile solo dal catalogo server.
- La creazione è append-only con evento, outbox e reconciliation D1 nello stesso confine Sites.
- La selezione missione continua a usare `getMissionResourceCatalog` e il controllo delle sovrapposizioni; la UI non può forzare una disponibilità.

## Contratti mantenuti

- Capability `workforce.read` protegge la pagina e l’overview.
- `workforce.read.all` / `workforce.registry.read` / `authority.read` determinano la visibilità del directory; ruoli operativi vedono il solo perimetro autorizzato.
- Planning resta il proprietario della creazione/pubblicazione dei turni.
- Presenze resta il proprietario della timbratura server-side, timestamp e geofence on-duty.
- Authority resta il proprietario di inviti, ruoli, sospensioni e capability.
- Mission resta il proprietario della selezione finale autista/mezzo/asset e del controllo di conflitto.

## Verifiche locali

- TypeScript: PASS.
- ESLint: PASS; restano solo warning legacy sulle immagini non ottimizzate fuori dal modulo 3.
- Build Sites/Vinext: PASS.
- Verifica contratto commerciale: PASS.
- Audit superficie: PASS_WITH_EXTERNAL_GATES.
- Smoke runtime locale: non ripetibile in questa sessione perché Wrangler non riesce ad aprire l’interfaccia di rete del container; il contratto statico e il build restano verificati.

## Gate ancora espliciti

Il modulo è pronto come superficie commerciale Sites/D1 bounded. Accettazione reale di un invito Neon, provider GPS/mappe, telematica live, browser/device certification e consumer esterni restano gate separati. Non vengono dichiarati completati da questo checkpoint.
