# AI-ZEROW COMMAND — full audit checkpoint RC2.9-AUDIT-1

**Data:** 2 ottobre 2026
**Stato locale:** `PASS TECNICO LOCALE · COMMERCIAL NO-GO`
**Runtime pubblicato:** Sites v86 owner-only
**Nuovo deploy:** no
**Baseline immutabile:** `baseline-ai-zerow-sites-v65-2026-10-01`

Questo checkpoint chiude l’audit della roadmap sul codice presente nel workspace. Non trasforma un adapter dichiarato in un’integrazione esterna attiva e non certifica la commerciabilità senza evidenza runtime, provider e approvazione umana.

## Inventario verificato

| Superficie | Evidenza | Esito |
|---|---:|---|
| Route pagina | 29 | PASS inventario |
| Layout | 19 | 18 con gate pagina esplicito; PASS locale |
| API route | 62 | PASS inventario |
| Navigazione Command | 16 | PASS: nessun path senza pagina |
| Endpoint chiamati dalla UI | 28 | PASS: nessun endpoint non risolto; workflow finance/procurement espansi sui route reali |
| Ruoli canonici | 13 | PASS contratto statico |
| Widget Command | 12 | PASS capability-filtered e personalizzabili |
| PWA | manifest + service worker | PASS binding locale |

## Collegamenti dei controlli

- La Command canonica è `/` e usa `components/command-surface.tsx`.
- La navigazione visibile è filtrata da capability; la barra Authority ora filtra anch’essa le destinazioni dopo il readback del contesto.
- Il campanello è visibile solo con `communication.read` e apre `/communications`.
- I controlli della mappa hanno ora azione locale verificabile: zoom, reset vista e fullscreen browser.
- “Vedi tutti” di Lavori e Asset porta ai moduli `/operations` e `/assets`.
- La creazione rapida dalla Command resta dichiaratamente una bozza locale; la commessa persistente passa dalla intake reale in `/operations`.
- Il customizer widget salva il layout tramite `/api/command/preferences`, con controllo server-side `command.customize`.
- Company AI passa da `/api/command/ask`, con quota, allowlist citazioni e confine `no direct write`.

## Integrazioni: stato reale

| Integrazione | Stato | Cosa significa |
|---|---|---|
| OpenAI | `ADAPTER PRESENT · LIVE NOT RUN` | Il codice server-side esiste; non è stata eseguita una richiesta OpenAI autenticata sul runtime pubblicato con readback redatto. |
| Mappa | `SCHEMATIC ONLY` | La superficie è SVG/visual readback D1. Non è presente un provider Mapbox/MapLibre/Leaflet/Google Maps. |
| GPS browser | `NOT CONNECTED` | Non sono presenti `navigator.geolocation`, `getCurrentPosition` o `watchPosition`. Il contratto attendance on-duty non equivale a GPS dispositivo attivo. |
| Document malware provider | `NOT RUN` | Il blocco fail-closed è presente; callback provider CLEAN/INFECTED non certificata. |
| Worker/consumer esterni | `DEFERRED` | Outbox, retry e DLQ locale sono presenti; consumer canonico ed executor esterni non sono collegati. |
| Neon invite reale | `NOT RUN` | Il contratto Authority è presente; manca la prova con sessione Neon e isolamento A/B reale. |
| Browser/device/PWA | `NOT RUN` | Runtime HTTP verificato; browser automation non disponibile in questo ambiente e Chromium headless non ha prodotto una sessione affidabile. |

## Verifiche eseguite

| Comando/controllo | Esito |
|---|---|
| `pnpm audit:release` | `PASS_WITH_EXTERNAL_GATES` |
| `pnpm verify:commercial` | `PASS` |
| `pnpm exec tsc --noEmit` | `PASS` |
| `pnpm lint` | `PASS` con 8 warning `<img>` preesistenti, 0 errori |
| `pnpm build` | `PASS` |
| `pnpm verify:runtime` locale | `PASS`: auth redirect, route/API protette, manifest, service worker, release NO-GO |
| Smoke URL pubblicato | `PASS_OWNER_ONLY_EDGE`: richieste non autenticate rifiutate |
| Browser/device certificazione | `NOT RUN` |

## Stato roadmap

La roadmap non è chiusa al 100% in senso commerciale. È chiusa al livello di candidato tecnico locale per i flussi Sites/D1 già implementati, mentre i workstream provider-backed restano parziali:

- `W00–W04`: base, contratti, authority, commesse e planning locali verificati.
- `W05–W08`: workforce/field, asset, warehouse e missioni/trasporti con core locale; tracking continuo, telematica e provider esterni differiti.
- `W09`: documenti e preventivi con limite 20 MB, parsing e sicurezza fail-closed; malware/OCR/retention provider-backed aperti.
- `W10–W11`: finance, procurement, eventi, outbox e reconciliation locali; executor/consumer esterni aperti.
- `W12`: Company AI governata e OpenAI adapter presenti; live authenticated evidence aperta.
- `W13–W16`: comunicazioni, adapter, PWA, security/privacy e restore locali; voice, osservabilità, DPIA/DPA e device certification aperti.
- `W17`: Release Center, audit e boundary `NO_GO` funzionanti; commercial promotion ancora vietata.

## Gate obbligatori prima della versione commerciabile

1. Eseguire OpenAI live su sessione autenticata e rileggere request id/stato nel ledger.
2. Collegare e testare malware scanner con callback autenticata e hash mismatch.
3. Collegare consumer/executor esterni per eventi, procurement, finance, OCR e telematica dove richiesto.
4. Eseguire test Neon invite, ruoli, capability e isolamento tenant A/B.
5. Eseguire browser desktop/tablet/PWA su device autorizzati.
6. Chiudere osservabilità, SLO/RPO/RTO, DPIA, DPA, retention e sign-off security/privacy/commerciale.
7. Decidere e implementare un provider mappa/GPS solo con contratto privacy, permessi espliciti e readback verificabile.

Finché questi gate non hanno evidenza, il Release Center deve restare `NO_GO` e non va eseguito un deploy commerciale.

## Riproducibilità

```bash
pnpm audit:release
pnpm verify:commercial
pnpm exec tsc --noEmit
pnpm lint
pnpm build
pnpm verify:runtime
```
