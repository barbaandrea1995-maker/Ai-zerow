# AI-ZEROW-COMMAND — Baseline congelata v65

**Data freeze:** 1 ottobre 2026 (UTC)  
**Stato:** FROZEN / ripristinabile  
**Scopo:** fissare il punto di partenza ufficiale per la roadmap AI-ZEROW.

## Riferimento immutabile

| Elemento | Valore |
|---|---|
| Site | `AI-ZEROW-COMMAND` |
| URL live | https://ai-zerow-command.barba-andrea-1995.chatgpt.site |
| Versione Sites pubblicata | `65` |
| Commit applicativo | `621840a02249f67c6640b9a5c55e5a0a72bd5659` |
| Tag di freeze | `baseline-ai-zerow-sites-v65-2026-10-01` |
| Branch sorgente | `main` |
| Accesso | custom / owner-only |
| Fonte dati Sites | D1/DB tenant-scoped |
| Stato build | typecheck e build superati |

Il tag punta al commit esatto usato per la versione 65. La roadmap e i documenti successivi possono avanzare sul branch principale, ma non modificano questo riferimento.

## Cosa è incluso nella baseline

- shell COMMAND e navigazione responsive;
- riallineamento visuale condiviso: densità, gerarchia, spaziatura, focus, hover e stati;
- palette carbon / neon-lime / cyan e vocabolario di card invariati;
- login e onboarding;
- authority/access profiles Sites-native;
- Command e alias `/command`;
- Operations e Job Workspace `/operations/:jobId`;
- Workforce, Warehouse, Mission e Assets come superfici Sites-native;
- Documents, Finance, Procurement e Governance come superfici bounded;
- Events, Outbox e Reconciliation Sites-native;
- Command preview, approval ledger e readback esplicito;
- PWA, offline fallback, replay FIFO e diagnostica;
- registry degli adapter esterni e gate dichiarativi;
- evidenza esplicita dei confini `DEFERRED`, `NOT_RUN`, `UNKNOWN` e `ADAPTER_REQUIRED`.

## Confini non falsamente certificati

La baseline non dichiara completate funzionalità che non sono state provate nel runtime esterno. Restano fuori dalla certificazione Sites-only:

- ciclo completo della commessa con dominio esterno e state machine definitiva;
- planning esecutivo e workers persistenti;
- workforce/field reali, attendance e tracking GPS certificati;
- asset e manutenzione come dominio esterno;
- inventario e magazzino con storage/OCR/provider esterni;
- missioni e trasporti con esecutori reali e riconciliazione esterna;
- OCR, object storage e document processing provider-backed;
- accounting, purchase order e payment executors;
- Company Twin e consumer asincroni completi;
- OpenAI runtime, Tool Gateway e autonomia AI production;
- integrazione NEXUS bidirezionale: oggi il confine è `mock_read_only`;
- certificazione fisica iOS/Android;
- KMS/secrets/rate limiting distribuiti/content scanning provider-backed;
- RPO/RTO/SLO, retention e DPIA formalizzati per il go-live.

## Regole del freeze

1. Il tag è il punto di ripristino della UI e del comportamento pubblicato al freeze.
2. Ogni nuovo lavoro parte da un commit successivo al tag e deve avere un ID roadmap (`W03`, `W04`, ecc.).
3. Nessun lavoro può trasformare una superficie `DEFERRED` o `NOT_RUN` in `VERIFIED` senza evidenza riproducibile.
4. Ogni write futura deve rispettare: identità → tenant → capability/scope → approval se necessario → idempotenza/versione → dominio → evento/outbox → readback → timeline/ledger.
5. Palette, moduli, schede e linguaggio visivo sono vincoli di continuità, salvo decisione esplicita futura.
6. Le credenziali, i token e i bypass non entrano nel repository né nei documenti di progetto.
7. La versione live non cambia per il solo fatto di aggiungere documentazione alla roadmap.

## Ripristino

Per tornare esattamente alla base congelata:

```sh
git fetch --tags origin
git switch --detach baseline-ai-zerow-sites-v65-2026-10-01
```

Per iniziare il lavoro successivo senza modificare il tag:

```sh
git switch -c roadmap/W03-commessa-lifecycle
```

La procedura di deploy deve sempre indicare commit, versione Sites e workstream che stanno entrando in produzione.

## Criterio di confronto futuro

Ogni tranche verrà confrontata con questa baseline su quattro assi:

| Asse | Domanda di controllo |
|---|---|
| UX | L’utente capisce cosa può fare, in quale stato si trova l’azione e cosa succede dopo? |
| Dominio | Il dato rappresenta un fatto, una proposta o una previsione? |
| Sicurezza | Tenant, ruolo, scope, approval e policy sono verificati server-side? |
| Affidabilità | Esistono idempotenza, versione, evento, readback, audit e recovery? |

