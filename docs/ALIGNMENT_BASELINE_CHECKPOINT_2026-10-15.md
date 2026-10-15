# Alignment baseline checkpoint — 2026-10-15

## Esito

Il Blocco 0 della roadmap di riallineamento è implementato come superficie di
governance in sola lettura. Non esegue migrazioni, backfill o modifiche ai dati.

- Contratto: `ALIGNMENT_BASELINE_V1`
- Modalità: `READ_ONLY_DRY_RUN`
- Operazioni di scrittura dichiarate e verificate: `0`
- API: `GET /api/governance/alignment`
- UI: Governance → Riallineamento
- Autorità richiesta: `governance.read` + `tenant.manage` + owner della radice Sites

## Baseline osservata in produzione

La lettura D1 owner-only conferma due radici attive che richiedono una decisione
umana prima di qualunque migrazione:

1. `sites:appgprj_6abaaf2bb58081919b265a8a6ad76dbb` — radice Sites legacy;
2. `tenant:57617250-c415-422c-9ed0-c7c5f417c86b` — tenant operativo completo.

Il secondo tenant rimane il candidato raccomandato perché contiene profilo
aziendale, modalità di trasporto, luoghi/geofence, QR e tratta missione più
completi. La raccomandazione non autorizza automaticamente una fusione.

I rilievi ancora aperti sono:

- luogo e geofence mancanti sui record legacy;
- QR mancanti o classificati in modo errato nel tenant legacy;
- resolver QR incompatibile con `ASSET-0001` e con ID a maiuscole/minuscole miste;
- membership Sites/Neon ambigue da collegare a una persona senza unione dei ruoli;
- posizione degli asset ancora testuale, distinta da custodia e assegnazione;
- collisioni tra codici canonici presenti in sorgente e target.

La tratta missione già presente nel tenant operativo conserva invece riferimenti
coerenti a missione, piano, magazzino, cantiere e tappe.

## Invarianti del report

Il readback confronta per ogni tenant:

- profilo aziendale e modalità operative;
- membership e provider identità;
- commesse, personale, asset, planning e missioni;
- magazzini, articoli, movimenti e prenotazioni;
- luoghi, geofence, piani di rotta e tappe;
- QR attesi, registrati, duplicati e orfani;
- eventi, outbox e riconciliazioni;
- documenti operativi, record S05, workflow W10, Company AI e tracking.

Il dry-run produce un target suggerito, le sorgenti candidate, i conteggi e le
collisioni. Non produce SQL né accetta un tenant scelto dal browser.

## Strategia di sicurezza

- contesto e capability sono risolti dal server;
- il report globale richiede anche la membership owner della radice Sites;
- la risposta usa `private, no-store`;
- l'endpoint espone solo `GET`;
- il repository server del report contiene esclusivamente query `select`;
- le future migrazioni D1 saranno additive e i backfill resteranno separati.

## Verifiche

- `pnpm run audit:alignment` — PASS;
- `pnpm run audit:release` — PASS_WITH_EXTERNAL_GATES;
- `pnpm run audit:integrity` — PASS;
- `pnpm run audit:e2e` — PASS_WITH_AUTHENTICATED_GATE;
- `pnpm run audit:ui` — PASS_WITH_RUNTIME_GATES;
- `pnpm run verify:commercial` — PASS;
- `pnpm run verify:company-ai-assets` — PASS;
- `pnpm run verify:mission-resources` — PASS.

## Gate per il Blocco 1

Prima di eseguire una migrazione persistente devono essere approvati:

1. tenant operativo come target canonico della stessa azienda;
2. classificazione della radice Sites come sorgente legacy e futuro archivio;
3. strategia per ogni collisione di codice;
4. collegamento delle identità senza unione automatica di ruoli/capability;
5. conferma umana degli indirizzi legacy da geocodificare.
