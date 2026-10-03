# AI-ZEROW COMMAND — Checkpoint W07 / Warehouse + Authority

**Data:** 3 ottobre 2026
**Stato:** CHECKPOINT LOCALE · NON PUBBLICATO
**Obiettivo:** una sola registrazione materiale, tenant-scoped, con magazzini reali e mansioni componibili.

## Decisione di ownership

- La registrazione di un materiale senza barcode appartiene esclusivamente a
  `/warehouse`, tramite `POST /api/warehouse/inventory` con
  `action: "register_item"`.
- QR / Barcode resta una superficie di scansione, identificazione e readback;
  non crea più anagrafiche materiali.
- Il vecchio writer generico `POST /api/warehouse` risponde `410` e rimanda al
  contratto inventory canonico. Il vecchio dialogo S04 è limitato agli asset.

## Magazzini tenant

- L’Owner configura uno o più magazzini da onboarding / Authority.
- Il server assegna il codice `WH-*`, valida e normalizza latitudine,
  longitudine e raggio geofence, quindi scrive il readback D1, evento, outbox
  e reconciliation.
- Il catalogo Warehouse restituisce solo i magazzini attivi del tenant e il
  catalogo server-side delle unità di misura.
- La posizione del dispositivo è opzionale; il contratto non inventa un
  indirizzo. Un geocoder esterno resta un gate esplicito da collegare in una
  tranche provider-backed.

## Authority e capability

- `warehouse.register`: Owner, Admin, Manager e Responsabile magazzino.
- `warehouse.write`: include i movimenti operativi; il Magazziniere può
  ricevere, prenotare, prelevare, caricare, consumare, restituire e rettificare
  secondo i guard server-side, ma non creare l’anagrafica materiale.
- Una membership conserva `rolesJson`; la persona può avere più mansioni e le
  capability vengono unite server-side, senza duplicare l’identità.
- La selezione delle mansioni mantiene compatibilità con le membership legacy a
  ruolo singolo.

## Verifiche locali

- TypeScript: **PASS**.
- ESLint: **PASS**, con 5 warning legacy relativi a `<img>` non ottimizzati e
  nessun errore.
- Build Sites/Vinext: **PASS**.
- Drizzle schema check: **PASS**.
- Verifica commerciale: **PASS**.
- Audit E2E contrattuale: **PASS_WITH_AUTHENTICATED_GATE**; 510 pulsanti
  classificati, nessun pulsante sospetto e doppio percorso Warehouse bloccato.
- Audit release: **PASS_WITH_EXTERNAL_GATES**; endpoint risolti e superfici
  protette verificati.
- Runtime HTTP locale: **NOT RUN** per `listen EPERM` del container.
- Runtime autenticato, geofence su dispositivo reale, geocoder esterno e
  migrazione D1 live: **NOT RUN / gate esterni**.
- Nessun deploy eseguito in questo checkpoint.

## Next release gate

1. Applicare le migrazioni `0016` e `0017` sull’ambiente target.
2. Eseguire readback autenticato con Owner, Responsabile magazzino e
   Magazziniere su tenant distinti.
3. Verificare su browser/dispositivo: creazione magazzino, selezione unità e
   magazzino, registrazione materiale, movimenti e rifiuto del doppio percorso.
4. Solo dopo questi esiti aggiornare il checkpoint a certificato e valutare la
   pubblicazione.
