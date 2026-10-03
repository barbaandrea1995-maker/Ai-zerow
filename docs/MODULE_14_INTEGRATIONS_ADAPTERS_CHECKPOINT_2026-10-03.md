# AI-ZEROW COMMAND — W14 Integrazioni e Adapter

**Data:** 3 ottobre 2026  
**Workstream:** W14  
**Stato:** TECHNICAL PASS · SITES/D1 · PRIVATE OWNER-ONLY RELEASE  
**Decisione commerciale:** NO-GO fino alla chiusura dei provider e dei gate umani

## Esito

`/externals` è stato riallineato come modulo **Integrazioni e Adapter**. La schermata non presenta un nuovo dominio operativo: è il control plane per leggere i confini esterni già definiti dalla roadmap, verificare il loro contratto e registrare evidenze dichiarative tenant-scoped.

## Superficie collegata

- overview della postura locale con KPI `READY`, `DEFERRED`, `BLOCKED` e `NOT_RUN`;
- registry filtrabile per famiglia, stato, provider e capability;
- inspector adapter con contratto, gate, prossima azione e ultimo readback;
- log evidenze append-only con vista tenant;
- mappa dei quattro confini: identity/tenant, domini canonici, control plane e provider/delivery;
- sidebar collassabile, header Command, ricerca, back, refresh, notifiche e navigazione role-aware;
- mobile menu e layout responsive coerente con Command.

## Contratti e invarianti

1. La lettura del registry richiede `external_adapters.read` server-side.
2. La registrazione di una evidenza richiede `tenant.manage`; la UI mostra la modalità sola lettura agli altri ruoli.
3. Adapter, tenant, ruolo e capability arrivano dal contesto server-side; il client non può scegliere un tenant.
4. I check sono append-only in `s05_records`, tenant-scoped e riletti dopo la scrittura.
5. `DECLARATIVE_PASS` descrive solo il contratto Sites; non promuove un adapter `DEFERRED`, `BLOCKED` o `NOT_RUN` a provider `READY`.
6. Nessun endpoint, token, secret, ping, health reale, consumer, promotion o scrittura esterna viene simulato.
7. Il modulo conserva il confine `directExternalWrite: false` e la regola Sites-only.

## Gate ancora aperti

- identity provider e membership production oltre il confine Sites/D1;
- domain services canonici e parity di readback/mutazione;
- event consumer, retry/DLQ e reconciliation esterna;
- OpenAI live, voice/telephony, policy provider e storage/OCR/malware;
- runtime parity, mobile nativo, browser/device harness e promotion esterna;
- osservabilità, privacy/retention e sign-off commerciale.

## Verifica tecnica

| Controllo | Esito |
|---|---|
| TypeScript | PASS |
| ESLint | PASS, warning legacy sugli `<img>` fuori dal modulo |
| Build produzione | PASS |
| Verificatore commerciale | PASS |
| Audit superficie release | PASS_WITH_EXTERNAL_GATES |
| `git diff --check` | PASS |
| Runtime HTTP smoke | NOT RUN / ambiente locale non autorizzato al bind |
| Browser/device/PWA reale | NOT RUN |

## Decisione

W14 chiude il perimetro Sites/D1 del modulo **Integrazioni e Adapter**, non la certificazione dei servizi esterni. La release resta privata owner-only e **COMMERCIAL NO-GO** finché i provider e gli harness sopra non producono evidenza verificabile.
