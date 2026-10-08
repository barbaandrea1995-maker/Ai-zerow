# AI-ZEROW COMMAND — W08 / Mission Attention Queue checkpoint

**Data:** 8 ottobre 2026  
**Perimetro:** coda operativa Missioni collegata a rapportini, tracking, magazzino e Control  
**Stato:** technical pass locale, pubblicazione privata owner-only in preparazione

## Decisione di prodotto

Missioni resta l’orchestratore del trasporto. La nuova coda non crea registri
paralleli: classifica soltanto i readback server-side già presenti nella
missione e permette di filtrare la journey queue.

Le attenzioni visibili sono:

- rapportini inviati e pronti per la revisione dell’ufficio;
- integrazioni richieste dall’ufficio;
- missioni riconciliate ma senza rapportino inviato e completo;
- tracking non attivo, senza posizione o stale durante un viaggio;
- righe di magazzino non ancora riconciliate;
- eccezioni ancora aperte.

La coda è capability-aware: la revisione del rapportino è mostrata soltanto
con il perimetro autorizzato, mentre i dati restano quelli già filtrati dal
tenant e dal ruolo corrente. Se un filtro nasconde la missione selezionata,
l’inspector passa automaticamente al primo record realmente visibile.

## Verifiche

- ESLint sui file modificati: PASS.
- `pnpm run verify:commercial`: PASS.
- `pnpm run build`: PASS; resta il warning noto sui chunk oltre 500 kB.
- `pnpm run audit:ui`: PASS_WITH_RUNTIME_GATES.
- `pnpm run audit:release`: PASS_WITH_EXTERNAL_GATES.
- `git diff --check`: PASS.
- smoke HTTP locale: PASS su auth redirect, login render, route/API fail-closed,
  release identity, manifest e service worker.

Browser autenticato, certificazione dispositivo/PWA e provider esterni restano
gate separati; la coda non promuove mai un segnale non verificato a dato
operativo.
