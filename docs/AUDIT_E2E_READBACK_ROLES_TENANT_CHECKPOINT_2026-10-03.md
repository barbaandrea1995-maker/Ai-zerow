# AI-ZEROW COMMAND — Audit E2E, readback, ruoli e tenant

**Data:** 3 ottobre 2026
**Perimetro:** Authority/team, Planning/resource availability, capability, tenant isolation, pulsanti e runtime locale
**Decisione:** `TECHNICAL PASS LOCALE · COMMERCIAL NO-GO · PUBBLICATO PRIVATAMENTE · SITES v115`

## Risultato

L’audit ha trovato e corretto due gap reali:

1. Authority mostrava un elenco team statico vuoto e non aveva una scrittura persistente.
2. Planning leggeva il registro risorse, ma non rileggeva la disponibilità rispetto alla finestra temporale selezionata.

La correzione introduce:

- `POST/GET /api/authority/teams` con capability `authority.manage/read`;
- team persistiti nel read model workforce `s04_records`, con codice server-side, membership attive dello stesso tenant, evento S06, outbox e reconciliation;
- readback Authority tenant-scoped con membri, capacità, qualifiche e stato;
- lettura server-side delle assegnazioni `DRAFT/PUBLISHED` in Planning;
- query `startsAt`/`endsAt`, conflitto temporale e `availableForWindow` per ogni risorsa;
- disabilitazione UI delle risorse già occupate e rimozione dagli ID selezionati;
- aggiornamento del contratto di smoke test per usare `POST` sul live-check OpenAI, evitando il falso negativo `405` su una route non-GET.

## Evidenze eseguite

| Controllo | Esito | Evidenza |
|---|---:|---|
| Build applicativa | PASS | `pnpm run build` |
| Lint | PASS | 0 errori; 5 warning `<img>` preesistenti |
| Contratto commerciale | PASS | `pnpm run verify:commercial` |
| Superficie route/API | PASS_WITH_EXTERNAL_GATES | `pnpm run audit:release` |
| Audit E2E statico | PASS_WITH_AUTHENTICATED_GATE | 504 pulsanti scansionati, nessun candidato non classificato |
| Runtime HTTP locale | PASS | redirect auth, API protette, PWA, build identity e `NO_GO` |
| Team anonimo | PASS | `GET /api/authority/teams` → `401` |
| Planning resource anonimo | PASS | `GET /api/operations/jobs/:jobId/planning/resource-options` → `401` |
| Browser/device autenticato | NOT RUN | harness browser e sessione owner/member reale non disponibili |
| Mutazioni Authority/Planning con D1 | NOT RUN | Neon Auth locale non configurato; gli header Sites non vengono emessi dal preview locale |

## Criterio pulsanti e moduli

Il controllo statico classifica ogni `<button>`/`<Button>` in una delle categorie:

- click-bound: `onClick` presente;
- form-bound: submit collegato a un `onSubmit`;
- navigation-bound: `href`, `asChild` o wrapper di navigazione;
- declarative primitive: componenti UI esplicitamente allow-listati o chiusi da `DialogClose`/`DropdownMenu`.

Non risultano pulsanti attivi non classificati. Questo è un audit di binding del codice, non sostituisce il click test autenticato su ogni stato dati. I controlli distruttivi restano quindi esclusi dall’esecuzione automatica finché non viene fornita una sessione di test con dati isolati.

## Ruoli e tenant

Il catalogo statico conferma 13 ruoli canonici, capability filtrate dal profilo operativo e gate server-side. Le nuove squadre non accettano ID membro dal browser se l’ID non appartiene a una membership attiva dello stesso tenant. Planning legge solo `s04_records` e `job_journey_records` con `tenantId` derivato dal contesto server.

La verifica autenticata completa da ripetere con una sessione reale deve coprire due identità e due tenant distinti:

```text
owner/admin con authority.manage
  → crea squadra → rilegge codice, membri, evento e reconciliation

worker/auditor senza authority.manage
  → legge se autorizzato → riceve 403 sulla creazione

tenant A
  → non vede né può assegnare risorse o job del tenant B

Planning
  → risorsa libera nella finestra: selezionabile
  → risorsa sovrapposta a DRAFT/PUBLISHED: visibile ma disabilitata
  → scrittura concorrente: server rifiuta il conflitto anche se il client è manipolato
```

## Gate ancora aperti

- sessione Neon/Auth reale per E2E mutazionale e cross-tenant runtime;
- browser/device certification, inclusa PWA mobile;
- provider mappa/telematica e GPS reale: il codice browser GPS esiste, il provider non è collegato;
- live check OpenAI con `OPENAI_API_KEY` nel runtime Sites;
- malware/OCR provider, executor esterni e sign-off umano commerciale.

Finché questi gate non producono evidenza runtime verificabile, il prodotto resta `COMMERCIAL NO-GO`; la tranche è comunque pubblicata privatamente come Sites v115, owner-only.
