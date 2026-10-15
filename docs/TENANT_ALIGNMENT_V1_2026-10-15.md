# TENANT_ALIGNMENT_V1 — riallineamento ufficiale

Data approvazione: 2026-10-15
Modalità: esecuzione server-side idempotente, con readback e rollback logico.

## Radice canonica

- sorgente/archivio: `sites:appgprj_6abaaf2bb58081919b265a8a6ad76dbb`;
- target operativo: `tenant:57617250-c415-422c-9ed0-c7c5f417c86b`;
- nessun record storico viene eliminato;
- la sorgente passa ad `archived` solo nello stesso batch che crea la membership Sites sul target.

## Decisioni sulle collisioni

1. Il deposito Pomezia legacy corrisponde a `WH-0002` Pomezia; le coordinate verificate del target prevalgono.
2. Il miniescavatore legacy corrisponde ad `ASSET-0002`.
3. Il Ford Transit legacy corrisponde ad `ASSET-0001`.
4. Il conducente legacy corrisponde alla persona canonica `DRV-0001`; ruoli e capability non vengono sommati.
5. La commessa legacy è distinta dalla `COMM-0001` target e viene copiata come `COMM-0002`.
6. “Nuova commessa” senza identità canonica resta nell’archivio ed è soppressa dal target.
7. Il tubo PVC viene copiato nel registro scorte di Pomezia con movimento iniziale e QR canonico.
8. Il QR legacy classificato come magazzino diventa un alias verso il materiale canonico Chiusini.
9. Provider e dispositivi tracking vengono copiati; nessun binding mezzo-dispositivo viene inventato.
10. Eventi, outbox, riconciliazioni, audit posizione e ledger AI storici restano sulla sorgente.

## Posizione e responsabilità degli asset

`asset_custody_locations` registra la posizione fisica corrente. È distinta da:

- assegnazione personale e utilizzatore operativo;
- autista della missione;
- mezzo vettore;
- asset trasportato;
- posizione GPS live.

Le modifiche dalla scheda risorsa scelgono un magazzino del catalogo server-side; non accettano più una posizione testuale libera.

## Evidenze e rollback

- `tenant_alignment_runs`: approvazione, hash manifest, dry-run ed esito;
- `tenant_alignment_links`: mappa sorgente→target per copie, match, alias e soppressioni;
- evento S06, outbox, riconciliazione e voce S07 dedicati;
- rollback logico: riattivare la sorgente e disabilitare i cloni attraverso i link, senza ricostruire dati cancellati.
