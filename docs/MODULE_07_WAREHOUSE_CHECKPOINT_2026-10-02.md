# AI-ZEROW COMMAND — Modulo 7 / Materiali e Magazzino

**Data:** 2 ottobre 2026  
**Perimetro:** W07 / anagrafica materiali, giacenze, movimenti, richieste e replenishment  
**Baseline visiva:** COMMAND ultra-carbon / neon lime  
**Stato:** TECHNICAL PASS — pubblicazione privata owner-only

## Decisione di dominio

Il magazzino è la fonte autorevole del saldo materiale. Le quantità sono
persistite in millesimi dell’unità dichiarata, mentre la disponibilità è il
fisico meno il prenotato. Il ledger append-only conserva prima/dopo, attore,
commessa, missione, versione e idempotenza.

La catena operativa è:

    anagrafica → giacenza → richiesta commessa → prenotazione → prelievo
    → carico missione → consumo/reso → readback e reconciliation

## Riallineamento eseguito

- /warehouse ora usa la shell Command condivisa: sidebar collassabile, logo
  ZEROW, ricerca centrale, tenant switcher, notifiche, profilo, back e refresh.
- Il control deck espone KPI per anagrafiche, disponibilità, riservato e sotto
  scorta.
- Il registro permette ricerca per SKU/materiale/ubicazione, filtro di stato e
  filtro di ubicazione.
- L’inspector mostra saldo fisico, riservato, libero, minimo, ubicazione,
  versione e ultimo readback.
- La registrazione materiale usa il contratto inventory canonico e genera lo
  SKU dal server quando non viene fornito.
- Il movimento guidato supporta carico, prenotazione, rilascio, prelievo,
  carico missione, consumo, reso e rettifica.
- Il replenishment mostra suggerimenti PROPOSAL_ONLY senza emettere ordini.
- Il ledger recente mostra prima/dopo e i riferimenti a commessa e missione.
- I collegamenti portano a Commesse, Missioni, Procurement capability-filtered
  e QR/Barcode.

## Contratti mantenuti

- GET /api/warehouse/inventory è tenant-scoped, capability-gated e restituisce
  items, movements, replenishment, summary e readback verificato.
- POST /api/warehouse/inventory richiede warehouse.write e idempotencyKey.
- La registrazione assegna SKU canonical server-side e scrive saldo iniziale,
  movimento REGISTER, evento, outbox e reconciliation.
- Ogni movimento richiede expectedVersion e applica optimistic concurrency.
- Prenotazioni, prelievi, carichi, consumi e resi controllano le invarianti:
  saldo non negativo, riservato non superiore al fisico, carico non superiore
  al prelevato e consumo/reso non superiore al prelevato.
- Commessa e missione sono validate server-side quando richieste dal tipo di
  movimento; la missione è caricabile solo nello stato previsto.
- Le richieste materiali della commessa restano nel journey della workspace
  Operations; il modulo Magazzino le raggiunge senza duplicare un secondo
  registro.
- Tenant, ruolo, capability, attore e saldo ufficiale non sono determinati dal
  client.

## Verifiche locali

- TypeScript: PASS.
- ESLint: PASS; restano solo 8 warning legacy sulle immagini in superfici
  precedenti.
- Build Sites/Vinext: PASS.
- Verifica contratto commerciale: PASS.
- Audit superficie: PASS_WITH_EXTERNAL_GATES; nessun endpoint irrisolto,
  nessun gap di navigazione e nessun pulsante Command attivo non collegato.
- git diff --check: PASS.
- Smoke browser/device autenticato e runtime locale: non certificati in questo
  ambiente; il container non consente l’apertura della porta locale con EPERM.

## Gate ancora espliciti

Procurement automatico, replenishment esecutivo, lotti/seriali, barcode
provider-backed, offline/replay e device certification restano gate separati.
Il checkpoint certifica la superficie Sites/D1 e i vincoli server-side, non
un’esecuzione esterna non presente.

## Pubblicazione

- Site: https://ai-zerow-command.barba-andrea-1995.chatgpt.site
- Accesso: custom owner-only invariato.
- Versione: latest private Sites publication verificata dopo questo checkpoint.
