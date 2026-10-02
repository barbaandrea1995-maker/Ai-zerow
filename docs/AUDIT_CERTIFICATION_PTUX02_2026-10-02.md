# AI-ZEROW COMMAND — Audit e certificazione PTU-UX-02

**Data:** 2 ottobre 2026
**Checkpoint:** `PTU-UX-02 · P0–P3 parziali verificati · moduli centrali attivi`
**Release candidate:** `Commercial v1 RC2.9-AUDIT-1`
**Esito:** `COMMERCIAL NO-GO`
**Deploy:** congelato

## Perimetro verificato

L’audit copre onboarding multi-tenant, profilo operativo e modalità di trasporto, capability e navigazione, pianificazione centrale, selezione di risorse reali, missioni, presenze, timestamp server-side, GPS on-duty, geofence, Command widget, route/API binding, build e migrazioni.

## Evidenze locali

| Area | Evidenza | Esito |
|---|---|---|
| TypeScript | `pnpm exec tsc --noEmit --pretty false` | PASS |
| Lint | `pnpm run lint` | PASS, 0 errori; 8 warning legacy immagini |
| Build | `pnpm run build` | PASS |
| Contratto commerciale | `pnpm run verify:commercial` | PASS · 13 ruoli · 14 widget · 18 layout protetti |
| Migrazioni | `pnpm exec drizzle-kit check` | PASS |
| Surface audit | `node scripts/audit-release-surface.mjs` | PASS_WITH_EXTERNAL_GATES · 31 route · 66 API · 18 nav |
| Binding | route/API e pulsanti Command | PASS · 0 endpoint irrisolti · 0 icon button non collegati |
| Diff hygiene | `git diff --check` | PASS |

## Funzionalità riallineate

- Onboarding tenant con profilo operativo, modalità trasporto persistenti e filtro capability.
- Modalità `ASSET_TRANSFER`, `WAREHOUSE_TO_RECIPIENT`, `WAREHOUSE_TO_JOB`, `RETURN_TO_WAREHOUSE`, `WAREHOUSE_TRANSFER` validate server-side.
- Pianificazione centrale su `/planning`, con commesse e missioni, bozza/pubblicazione, scope al sottogruppo e risorse canoniche.
- Percorso legacy `planning_create` riallineato: niente testo libero per team/responsabile.
- Presenze su `/presenze` e nel workspace commessa, con timestamp ufficiale server-side, GPS solo on-duty e geofence esplicito.
- Missioni con autista, mezzo e asset selezionabili dal registro tenant e controllo di conflitto temporale.
- Command con widget di pianificazione e presenze capability-filtered, oltre alla personalizzazione già esistente.
- Capability dedicate `attendance.self`, `attendance.read`, `attendance.manage`, `attendance.approve`, con alias retrocompatibili.
- Icona ufficiale ZEROW mantenuta nell’hero; nessuna foglia o icona di brand inventata.

## Gate aperti e severità

| Severità | Gate | Stato | Conseguenza |
|---|---|---|---|
| BLOCKER | Runtime HTTP smoke | `NOT RUN` — nessun server locale raggiungibile; il sandbox restituisce `EPERM` su `localhost:5173` | Nessuna certificazione runtime |
| BLOCKER | Browser/device/authenticated smoke | `NOT RUN` — harness/sessione autenticata non disponibile | Nessuna certificazione PWA o dispositivo |
| HIGH | Provider mappe e telematica | `NOT CONFIGURED`; la mappa resta schematica | GPS reale e osservazione Command non certificabili |
| HIGH | OpenAI live authenticated evidence | adapter presente, live request non provata in questa sessione | Company AI non marcata runtime-certified |
| HIGH | Privacy, retention, DPIA e sign-off lavoristico | `PENDING_REVIEW` | Presenze/GPS non commercialmente certificabili |
| HIGH | Deploy/migrazione target e rollback | non eseguiti; deploy congelato | Nessuna promozione commerciale |
| MEDIUM | Offline queue/replay e low-power device | contratto non certificato end-to-end | PWA operativa non certificata |
| MEDIUM | Performance | warning chunk >500 kB e proxy build | Richiede budget/performance pass prima del GA |
| LOW | Legacy image warnings | 8 warning `@next/next/no-img-element` su superfici preesistenti | Pulizia successiva, non blocca il build |

## Certificazione

La certificazione commerciale **non è rilasciata**. La codebase è un candidato tecnico locale con controlli statici verdi, ma i gate runtime, provider mappe/telematica, privacy e dispositivo reale sono ancora aperti. Qualsiasi stato diverso da `COMMERCIAL NO-GO` sarebbe privo di evidenza.

## Prossimo checkpoint

`PTU-UX-03` sarà apribile solo dopo:

1. sessione autenticata su preview e smoke browser desktop/mobile;
2. migrazione `0015_large_mysterio.sql` applicata e riletta nel target;
3. provider mappe scelto e adapter telematico autenticato, deduplicato e tenant-scoped;
4. prova OpenAI live con Company AI, rate limit, citazioni e no-direct-write;
5. prova check-in/geofence/correzione con policy privacy approvata;
6. visual/accessibility/performance regression pass e retest dei warning legacy.

Fino a quel momento il deploy commerciale resta esplicitamente bloccato.
