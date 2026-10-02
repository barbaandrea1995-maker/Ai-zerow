# AI-ZEROW — Master Roadmap operativa

**Versione roadmap:** 1.5 — riallineamento Commercial v1 RC2.3 locale
**Data:** 2 ottobre 2026
**Baseline di partenza:** Sites v65 / tag `baseline-ai-zerow-sites-v65-2026-10-01`  
**Obiettivo:** portare AI-ZEROW da ricostruzione Sites certificata nei suoi confini a piattaforma operativa enterprise completa, senza perdere tracciabilità, sicurezza, continuità visiva o controllo umano.

**Checkpoint corrente:** `Commercial v1 RC2.3 · candidato locale non pubblicato · non certificato commerciale`, sul build ID `ai-zerow-commercial-v1-rc2-3-local-r2026-10-02` e parent locale `commercial-v1-rc2-2-local-2026-10-02`. La baseline v65 resta immutata; il runtime Sites resta congelato a v84. La promozione commerciale resta bloccata fino alla chiusura dei gate descritti in `docs/COMMERCIAL_V1_RC2_3_LOCAL_CHECKPOINT_2026-10-02.md`.

## 1. Direzione prodotto

AI-ZEROW è un sistema operativo aziendale AI-governato per coordinare:

- creazione e gestione delle commesse;
- pianificazione di attività, persone, mezzi, asset e materiali;
- esecuzione FIELD e raccolta delle evidenze;
- registrazione e gestione del magazzino;
- asset, manutenzione e disponibilità operativa;
- missioni, trasporti, consegne e POD;
- documenti, estrazione, preventivi e provenance;
- finanza operativa e procurement;
- Command, Company Twin, timeline, forecast e simulazioni;
- comunicazioni, voce e integrazioni esterne;
- governance AI, approvazioni, audit e readback.

L’AI coordina e propone. Non è la fonte autoritativa del business: lo stato autorevole vive nei domini, negli eventi persistenti e nei readback verificati.

## 2. Regole architetturali non negoziabili

Ogni modulo nuovo deve rispettare questa catena:

```text
persona/input
  → identità e tenant server-side
  → intento e contesto autorizzato
  → piano/proposta
  → policy, capability, scope e approval
  → tool tipizzato
  → dominio e transazione
  → evento persistente / outbox
  → readback verificato
  → Company Twin / Timeline / Ledger
  → risultato visibile e spiegabile
```

### Invarianti

- Il client non decide `tenantId`, ruolo, capability o autorizzazione.
- Nessun agente interroga SQL direttamente.
- Ogni write ha `idempotencyKey`; le modifiche concorrenti usano `expectedVersion`.
- Un’azione non è “riuscita” finché il readback non è verificato.
- Gli stati `proposed`, `pending approval`, `approved`, `executing`, `committed`, `verified`, `failed`, `unknown`, `reconcile` sono distinti anche nella UI.
- Gli eventi business sono append-only; le proiezioni possono essere rigenerate.
- Documenti e telemetria personale hanno provenance, minimizzazione e retention.
- L’AI può operare in modalità copilota; assisted e semi-autonomous solo su whitelist, policy e approval espliciti.
- Ogni integrazione esterna ha un adapter versionato e un confine di capability dichiarato.

## 3. Legenda di stato

| Stato | Significato |
|---|---|
| `FROZEN` | Base immutabile e ripristinabile. |
| `CLOSED — Sites` | Implementato e verificato nel perimetro Sites/D1. |
| `PARTIAL` | Una superficie o un adapter esiste, ma il ciclo completo non è chiuso. |
| `DEFERRED` | Previsto, ma dipende da servizio/provider/runtime non ancora disponibile. |
| `NOT RUN` | Non certificato perché manca harness, device o ambiente autorizzato. |
| `EXTERNAL` | Dipende da decisione/provider/contratto esterno. |
| `READY` | Accettazione completa e gate di release superati. |

## 4. Stato attuale dopo il freeze

| Workstream | Stato iniziale | Nota |
|---|---|---|
| W00 Baseline e governance | `FROZEN` | Tag v65 creato e pubblicato nel repository. |
| W01 Shell e visual system | `RC2 — PASS LOCALE` | Command ultra-carbon, core Z senza foglia, 11 widget personalizzabili, PWA parity e smoke desktop/mobile superati; axe rileva 0 violazioni automatiche sulle superfici critiche. |
| W02 Identity, tenant, authority | `RC2 — IMPLEMENTED / PROVIDER GATE` | 13 ruoli, capability server-side, menu/CTA/widget filtering, bootstrap fail-closed e isolamento A/B verificati. Invite, role change, suspend/reactivate/revoke/remove e last-owner guard sono implementati; accettazione con sessione Neon reale resta `NOT RUN`. |
| W03 Commessa e Job Workspace | `RC2 — CLOSED LOCAL CORE` | Creazione manuale/Company AI, preventivo DOCX diviso, scope al sottogruppo, workspace, completion gate, eventi, readback e journey cross-modulo sono verificati localmente. Chiusura GA dipende dai gate provider di W09/W12/W16. |
| W04 Planning | `RC2.2 — LOCAL ADVANCED PASS / EXTERNAL DEFERRED` | Capacità, conflitti, qualifiche, revisioni, what-if e resource options readback sono implementati con D1, versioni, idempotenza e capability; executor/capacity provider esterni restano differiti. |
| W05 Workforce e FIELD | `RC2.2 — LOCAL ATTENDANCE PASS / PARTIAL` | Check-in, pausa, ripresa, check-out, correzione/approvazione e GPS on-duty opzionale sono implementati; workforce registry esterno, tracking continuo e device/offline certification restano aperti. |
| W06 Assets e manutenzione | `RC2.2 — LOCAL LIFECYCLE PASS / PARTIAL external` | Manutenzione, blocco, rilascio e guard di assegnabilità sono persistiti su D1 con eventi; telemetria, certificazioni e disponibilità canonica esterna restano da collegare. |
| W07 Materiali e Warehouse | `RC2.2 — LOCAL CORE + REPLENISHMENT PROPOSAL` | Core inventario invariato e proposta replenishment `PROPOSAL_ONLY` aggiunta; lotti/seriali, procurement automatico e replenishment esecutivo restano evolutivi/esterni. |
| W08 Mission e trasporti | `RC2.3 — CLOSED LOCAL CORE / EXTERNAL DEFERRED` | Create, dispatch, delivery/POD, verifica POD, reconciliation e chiusura, collegamento commessa e guard di caricamento passano; routing/telematica provider-backed restano esterni. |
| W09 Documents | `RC2.3 — STORAGE PASS / FAIL-CLOSED SECURITY GATE` | Upload R2 fino a 20 MB, DOC/DOCX/PDF/XLS/XLSX/CSV/TXT/immagini, MIME+magic signature e SHA-256 passano; quarantena/callback provider sono contrattualizzati e il download resta bloccato senza evidenza CLEAN. OCR e retention provider-backed restano bloccanti. |
| W10 Finance e Procurement | `CLOSED — Sites / PARTIAL external` | Ledger/proposte bounded; accounting, PO e payment executor aperti. |
| W11 Events, Outbox, Twin e Timeline | `RC2.3 — SITES CONTROL PASS / EXTERNAL CONSUMER DEFERRED` | Eventi, outbox, retry limitato, DLQ, requeue, block e reconciliation sono governati in Sites; consumer, Twin e worker persistenti da certificare. |
| W12 AI, Tool Gateway e Approval | `RC2.3 — IMPLEMENTED / LIVE GATE NOT RUN` | Intake e Command usano OpenAI Responses lato server con contesto capability-filtered, output strutturato, citation allowlist, quota D1 atomica, ledger, no-direct-write e binding runtime Site per il secret. Quota, payload guard e preventivo DOCX reale sono verificati localmente; la chiamata live richiede sessione Neon autenticata e runtime pubblicato. |
| W13 Communication, Voice, Telephony | `RC2.3 — COMMUNICATIONS SITES BOUNDARY / VOICE DEFERRED` | Communications readback/proposal è capability-gated e tenant-scoped; provider voice/SIP, telephony, policy operative e delivery reale restano da configurare. |
| W14 NEXUS e adapter esterni | `PARTIAL` | Registry dichiarativo e adapter `mock_read_only`; integrazione reale non attiva. |
| W15 PWA, iOS e Android | `PARTIAL / NOT RUN` | PWA/offline surface presente; device certification non chiusa. |
| W16 Security, Privacy, Observability, DR | `RC2 — DR PASS / PARTIAL` | Tenant isolation, payload guards e restore rehearsal D1+R2 con conteggi/hash identici passano. Scanner malware, GDPR/DPIA, osservabilità provider-backed e SLO/RPO/RTO formali restano aperti. |
| W17 Release e GA | `RC2.3 LOCAL TECHNICAL PASS / NOT PUBLISHED / COMMERCIAL NO-GO` | TypeScript, lint, build, contract e hardening locale passano. OpenAI live, malware scan, invito Neon reale, executor esterni, device certification e sign-off umano privacy/security/commerciale restano bloccanti. |

## 5. Roadmap per fasi e moduli

### W00 — Freeze, governance e controllo del cambiamento

**Risultato:** base v65 ripristinabile e processo unico di avanzamento.

- mantenere il tag di baseline senza riscriverlo;
- associare ogni commit a un workstream e a un criterio di accettazione;
- separare `Sites closed`, `external deferred` e `not certified`;
- mantenere un changelog di versione e un registro decisioni;
- usare branch/worktree di lavoro per ogni tranche importante;
- pubblicare solo artefatti costruiti dal commit dichiarato;
- mantenere la configurazione di accesso owner-only finché non viene richiesta una modifica esplicita.

**Gate W00:** tag presente, commit verificabile, URL v65 integro, manifest di baseline presente.

---

### W01 — Fondazioni di piattaforma e contratti

**Obiettivo:** rendere ogni dominio costruibile con gli stessi contratti tecnici.

#### Scope

- environment separation: development, staging, production e restore;
- schema registry e versioning dei contratti;
- OpenAPI sincronizzata con le route reali;
- AsyncAPI/event envelope per eventi e outbox;
- error taxonomy: `VALIDATION`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `APPROVAL_REQUIRED`, `UNAVAILABLE`, `PARTIAL_FAILURE`, `INTERNAL`;
- correlation, causation, request, trace e idempotency IDs;
- migration discipline e compatibility check;
- runtime readiness endpoint e release manifest;
- OTel traces, metriche e log redatti;
- adapter contract per servizi non ancora disponibili.

**Accettazione:** ogni endpoint di dominio ha schema, auth context, error contract, test di tenant isolation, idempotenza/versione e criterio di readback.

---

### W02 — Identity, tenant, onboarding e authority

**Obiettivo:** ogni persona vede e può modificare solo ciò che la propria membership autorizza.

#### Funzioni

- login, signup, sessione e active organization;
- onboarding tenant: azienda, sedi, assistant identity, configurazione iniziale;
- membership e ruoli canonici: owner, admin, member, manager, office, technical, field supervisor, worker, warehouse manager, warehouse operator, driver, maintenance, auditor;
- capability arrays immutabili e profili di accesso;
- `resourceScope`, `fieldScope`, `fileScope`;
- lifecycle utente: invite, active, suspended, removed;
- cambio ruolo con audit e invalidazione sessioni quando necessario;
- tenant context server-side per web, mobile, webhook e worker;
- permission decision e deny reason visibile senza rivelare dati riservati.

**Gate:** auth, tenant, membership, scope e capability sono verificati server-side in ogni dominio; nessun tenant viene accettato dal prompt o dal body del client.

---

### W03 — Creazione e gestione della commessa

**Obiettivo:** chiudere il primo verticale operativo completo, dalla creazione alla chiusura della commessa.

#### Anagrafica commessa

- codice progressivo tenant-scoped (`COMM-0001`, `COMM-0002`, …);
- cliente, committente, referente e contatti;
- sede/cantiere, indirizzi, coordinate solo se necessarie e governate;
- titolo, descrizione, categoria e priorità;
- date pianificate, milestone e deadline;
- stato, owner operativo, responsabile e team;
- budget, ricavi previsti, costi target e centro di costo;
- allegati, documenti collegati, note e tag;
- riferimenti esterni e `jobId` stabile cross-domain.

#### Ciclo di vita

```text
DRAFT → PROPOSED → APPROVED → PLANNED → ACTIVE → BLOCKED
      → COMPLETED → CLOSED → ARCHIVED
```

Ogni transizione ha precondizioni, actor, timestamp, motivo, evento e readback. `BLOCKED`, `CANCELLED` e `RECONCILE_REQUIRED` non sono nascosti dentro un generico errore.

#### Attività e work breakdown

- WBS per fasi, attività e sotto-attività;
- dipendenze e predecessori;
- responsabile, squadra, qualifica richiesta e durata;
- materiali, asset, mezzi e documenti necessari;
- checklist e criteri di completamento;
- avanzamento percentuale con evidenza;
- blocker, note, foto, file, audio e rapportino;
- consuntivo ore, materiali, trasferte e costi;
- revisione della commessa senza perdere la storia precedente.

#### Accettazione W03

1. Un manager crea una commessa reale.
2. Il server assegna codice e tenant senza fidarsi del client.
3. La commessa viene pianificata, assegnata, eseguita e chiusa.
4. Ogni stato mostra proposta/approval/esecuzione/verifica.
5. Il workspace restituisce dati vuoti o parziali senza inventare record.
6. Eventi, audit, versioni e readback ricostruiscono chi ha fatto cosa.

---

### W04 — Pianificazione, schedulazione e capacity

**Obiettivo:** trasformare commesse e attività in un piano eseguibile e revisionabile.

#### Funzioni

- calendario per commessa, squadra, persona, asset e missione;
- finestre temporali, deadline, milestone e dipendenze;
- capacità per ore, qualifiche, veicoli, attrezzature e materiali;
- eleggibilità: ruolo, qualifica, certificazione, disponibilità e scope;
- conflitti di risorsa, sovrapposizioni e violazioni di calendario;
- piano draft, proposta, approvazione, pubblicazione e revisione;
- assegnazione e riassegnazione con motivo e audit;
- replanning per ritardo, guasto, assenza, shortage o cambio priorità;
- simulazione what-if isolata dal piano reale;
- notifiche di modifica a ruoli coinvolti;
- snapshot di piano per confrontare previsto, corrente e consuntivo.

#### Stati

```text
DRAFT → PROPOSED → APPROVED → PUBLISHED → IN_EXECUTION
      → REVISED → SUPERSEDED / CANCELLED
```

**Gate:** nessuna assegnazione senza verifica di capability, qualifica, disponibilità, quantità/capacità e policy workflow.

---

### W05 — Workforce, FIELD e presenza operativa

**Obiettivo:** collegare persona, turno, lavoro e prova dell’esecuzione.

#### Workforce

- registry persone, squadre e ruoli;
- qualifiche, certificazioni, scadenze e documenti;
- turni, pattern, eccezioni, ferie e indisponibilità;
- attendance: apertura, check-in, pausa, check-out, correzione e approvazione;
- eligibility per commessa, attività, asset e missione;
- assegnazione responsabile/squadra con readback.

#### FIELD

- apertura turno e work context;
- lista lavori assegnati e priorità;
- avanzamento attività e checklist;
- evidenze testuali, fotografiche, vocali e documentali;
- blocker, guasto, shortage e richiesta supporto;
- richiesta materiale direttamente dalla commessa;
- rapportino giornaliero e firma/approvazione;
- modalità offline con coda ordinata e replay idempotente;
- sincronizzazione e conflitto esplicito al rientro online.

#### Tracking e privacy

- tracking solo in work context autorizzato;
- indicatore chiaro di tracking attivo;
- precisione/frequenza minime necessarie;
- retention delle coordinate raw limitata;
- conservazione del solo fatto operativo quando possibile;
- DPIA, informativa e policy lavoro fuori turno prima del go-live.

---

### W06 — Asset, mezzi, attrezzature e manutenzione

**Obiettivo:** sapere quali risorse fisiche esistono, dove sono, se sono disponibili e se possono essere usate.

#### Registro asset

- codice progressivo tenant-scoped;
- categoria, tipo, marca, modello, seriale, targa o identificativo;
- proprietà, sede, ubicazione e responsabile;
- stato: disponibile, riservato, assegnato, in uso, fermo, manutenzione, dismesso;
- documenti, manuali, garanzie, certificati e scadenze;
- valore, costo, centro di costo e collegamenti economici;
- QR/barcode canonical code;
- storico movimenti, assegnazioni, incidenti e revisioni.

#### Manutenzione

- piano manutentivo preventivo per tempo, ore o utilizzo;
- segnalazione guasto e classificazione priorità;
- work order di manutenzione;
- checklist, tecnico, ricambi, tempi e costi;
- blocco automatico dell’asset quando non sicuro;
- rilascio dopo controllo e readback;
- collegamento guasto → commessa → missione → costo;
- KPI: disponibilità, downtime, MTBF/MTTR e manutenzione arretrata.

#### Gate

Un asset non può essere assegnato a un lavoro o a un trasporto se stato, capacità, certificazioni, manutenzione e compatibilità non risultano validi.

---

### W07 — Materiali, registrazione magazzino e Warehouse

**Obiettivo:** gestire l’intero ciclo materiale, dalla registrazione anagrafica al consumo o reso riconciliato.

#### Anagrafica materiale

- codice articolo/SKU e codice descrittivo tenant-scoped;
- descrizione, categoria, marca e specifiche;
- unità di misura, confezione e fattore di conversione;
- barcode/QR e codici alternativi;
- lotto, seriale, data scadenza e tracciabilità quando necessari;
- fornitore, lead time, costo standard e ultimo costo;
- scorta minima/massima, punto di riordino e criticità;
- sostituti compatibili e vincoli di utilizzo;
- documenti tecnici e schede di sicurezza.

#### Struttura fisica

- magazzino, deposito, sede e cantiere;
- zone, scaffali, ubicazioni e contenitori;
- responsabile e operatori autorizzati;
- capacità, condizioni e inventario per ubicazione;
- stock disponibile, riservato, in transito, danneggiato e quarantena.

#### Movimenti

```text
RECEIVE → PUT_AWAY → AVAILABLE
AVAILABLE → RESERVE → PICK → PACK → LOAD
LOAD → IN_TRANSIT → DELIVER / CONSUME
CONSUME → RECONCILE
AVAILABLE → TRANSFER / ADJUST / RETURN / QUARANTINE
```

- registrazione ingresso con documento e provenienza;
- ricevimento parziale, controllo quantità e qualità;
- ubicazione e trasferimento interno;
- riserva per commessa, attività o missione;
- material request dal FIELD o dalla commessa;
- review/approval quando quantità o costo lo richiedono;
- picking, packing, staging e carico;
- consumo sul lavoro con quantità effettiva e operatore;
- reso, scarto, rettifica e riconciliazione;
- inventario ciclico e inventario straordinario;
- gestione shortage, backorder e proposta procurement;
- audit di ogni movimento con before/after quantity.

#### Scan experience

- scansione QR/barcode da mobile;
- conferma visiva di articolo, lotto, quantità e ubicazione;
- prevenzione di doppio scan e replay;
- gestione offline con idempotency key;
- errore chiaro per articolo sconosciuto, ubicazione non valida o stock insufficiente.

#### Accettazione W07

Una richiesta FIELD produce, se autorizzata, una riserva; la riserva produce picking/packing; il carico alimenta una missione; la consegna o il consumo aggiorna le quantità; il readback mostra sempre stock disponibile, riservato e consuntivato.

---

### W08 — Missioni, trasporti e consegne

**Obiettivo:** coordinare materiale, veicolo, autista, tappe e prova di consegna senza confondere gli stati logistici.

#### Creazione missione

- origine: richiesta warehouse, commessa, transfer o rientro;
- priorità, finestra e deadline;
- origine, destinazione e tappe;
- materiale, quantità, peso, volume e vincoli;
- veicolo compatibile e capacità;
- autista/squadra eleggibile;
- documenti di trasporto, autorizzazioni e note;
- costi stimati e consuntivi.

#### State machine

```text
DRAFT → PROPOSED → APPROVED → ASSIGNED → LOADED → STARTED
      → ARRIVED → DELIVERED → POD_VERIFIED → RECONCILED → CLOSED
```

Stati di eccezione: `DELAYED`, `BLOCKED`, `VEHICLE_FAULT`, `PARTIAL_DELIVERY`, `REFUSED`, `LOST`, `RECONCILE_REQUIRED`, `CANCELLED`.

#### Funzioni operative

- assegnazione veicolo/autista con verifica capacità e documenti;
- load scan e controllo quantità;
- partenza/start con contesto missione;
- arrivo alle tappe e avanzamento percorso;
- ritardo, guasto, deviazione e richiesta assistenza;
- consegna parziale o rifiutata;
- POD: firma, foto, documento, timestamp e actor;
- scarico, consumo, reso o giacenza;
- riconciliazione tra pianificato, caricato, trasportato e consegnato;
- calcolo costi e collegamento a commessa/procurement;
- tracking solo se autorizzato e necessario.

#### Gate

Una missione non è completata quando l’autista preme “consegnato”: è completata solo dopo POD, controllo quantità, readback e riconciliazione.

---

### W09 — Documenti, OCR, provenance e intelligence

**Obiettivo:** trasformare file e documenti in informazioni verificabili collegate al lavoro reale.

#### Ingest e storage

- upload PDF, immagini, fogli di calcolo e formati supportati;
- storage privato e key tenant-scoped;
- SHA-256/content address e controllo integrità upload/download;
- antivirus/content scanning prima dell’uso;
- metadati: autore, origine, data, tipo, dimensione e classificazione;
- versioni e documenti sostituiti senza perdere la storia;
- retention e cancellazione secondo policy.

#### Analisi

- classificazione documento;
- OCR ed estrazione strutturata;
- confidence per campo e pagina;
- provenance per ogni valore estratto;
- review umana per bassa confidenza o dato economico sensibile;
- confronto tra preventivi;
- rilevazione di scadenze, importi, quantità, clausole e anomalie;
- separazione tra testo osservato, dato estratto e interpretazione AI.

#### Collegamenti e azioni

- collega a commessa, attività, cliente, fornitore, materiale, asset, missione e purchase order;
- crea proposta di commessa o job;
- crea proposta di ordine o pagamento;
- allega evidenza a FIELD, consegna o manutenzione;
- ricerca con scope autorizzato;
- audit di chi ha visualizzato, estratto, modificato o approvato.

#### Gate

Nessun valore estratto diventa automaticamente fatto contabile o ordine. La UI deve mostrare origine, confidenza, revisione e stato di approvazione.

---

### W10 — Finance operativo e Procurement

**Obiettivo:** collegare lavori, materiali, documenti e acquisti senza trasformare l’AI in autorità finanziaria.

#### Finance

- costi previsti, impegnati e consuntivi;
- ricavi e valore commessa;
- ore, materiali, trasporti, manutenzione e fornitori;
- centri di costo e categorie;
- margine previsto vs reale;
- allegati e provenance;
- riconciliazione tra documento, evento e movimento economico;
- export per sistemi contabili esterni.

#### Procurement

```text
NEED → REQUESTED → REVIEW → APPROVED → PO_DRAFT
     → PO_ISSUED → PARTIALLY_RECEIVED → RECEIVED → RECONCILED
```

- richiesta acquisto da shortage, documenti o commessa;
- confronto fornitori e preventivi;
- policy per soglia economica;
- approvazione human-in-the-loop;
- purchase order e righe;
- ricevimento parziale/totale;
- collegamento a magazzino e costo commessa;
- annullamento, reso e riconciliazione.

**Gate:** nessun ordine, pagamento o impegno economico senza policy, approval, idempotenza e readback esterno quando il provider sarà attivo.

---

### W11 — Event Store, Outbox, Company Twin, Timeline e Ledger

**Obiettivo:** rendere ogni fatto ricostruibile e ogni proiezione rigenerabile.

- `EventEnvelope` con tenant, actor, source, aggregate, schema version e provenance;
- idempotenza per evento e aggregate-version uniqueness;
- outbox transactionale;
- retry, backoff, dead-letter e recovery manuale;
- consumer per proiezioni operative;
- Company Twin con revisioni di entità e relazioni;
- Timeline per commessa, persona, asset, materiale, missione e documento;
- AI Action Ledger con intent, plan, model, tools, policy, approval, before/after, readback, cost e trace;
- reconciliation per stati downstream incerti;
- freshness e lag monitorati;
- replay controllato per ricostruire proiezioni.

**Gate:** un record di dashboard, forecast o risposta AI deve dichiarare fonte, timestamp, revision e livello di certezza.

---

### W12 — Command, AI Orchestrator, Tool Gateway e governance

**Obiettivo:** permettere di chiedere, capire, proporre e agire mantenendo l’autorità nel dominio.

#### Command

- attenzione prioritaria: blocchi, ritardi, shortage, approval age, guasti e scadenze;
- KPI commesse, workforce, warehouse, missioni, asset e finanza;
- timeline e drill-down alla fonte;
- query read-only con contesto tenant;
- filtri per ruolo, sede, commessa e periodo;
- stato di freshness del Twin;
- fallback trasparente quando il provider non è disponibile.

#### AI Orchestrator

- intent classification;
- context pack autorizzato;
- piano strutturato e spiegabile;
- selezione tool con schema;
- policy/approval decision;
- esecuzione con idempotency/expectedVersion;
- readback e verifica;
- spiegazione con fonti e stato;
- gestione `unknown` senza dichiarare successo;
- cost/latency/model tracking;
- eval di tool selection, refusal, approval e hallucination resistance.

#### Tool Gateway

- registry versionato;
- input/output schema validation;
- capability richiesta e resource scope;
- dry-run/preview;
- rate limit e budget;
- deny by default;
- log senza prompt, document body o secret;
- nessun accesso SQL diretto.

#### Workflow governance

- draft, diff, version, sandbox, approval e publish;
- whitelist per autonomia semi-autonomous;
- rollback di workflow e tool manifest;
- test sintetici prima del publish.

---

### W13 — Comunicazione, Voice e Telephony

**Obiettivo:** aggiungere comunicazioni operative senza perdere scope e privacy.

- riassunto turno e daily briefing;
- broadcast per team/sede/commessa;
- acknowledgement e delivery status;
- traduzione IT/EN/FR/DE/ES con revisione quando rilevante;
- walkie AI con messaggi e ack;
- voice realtime opt-in con credenziale effimera;
- trasformazione voce → proposta strutturata, mai write implicita;
- pilot SIP con webhook firmato, routing e audit;
- niente raw audio/transcript persistente quando non necessario;
- retention e accesso separati per comunicazioni sensibili.

---

### W14 — Adapter esterni e integrazione NEXUS

**Obiettivo:** collegare provider e sistemi esterni con confini espliciti e senza bypass.

#### Catalogo adapter

- identity/auth;
- canonical domains;
- storage/OCR;
- Neon schema binding;
- event consumers;
- AI/voice;
- policy;
- runtime parity;
- native mobile;
- certification/promotion.

Ogni adapter espone capability, health, readback, versione contratto, owner e stato (`DECLARATIVE`, `HEALTHY`, `READBACK`, `BLOCKED`, `DEFERRED`).

#### NEXUS

1. congelare il canonical read contract;
2. definire endpoint, auth, tenant mapping e versioning ufficiali;
3. validare read-only con dati sintetici;
4. definire consistency e reconciliation;
5. introdurre write solo dopo approval, audit e rollback;
6. eseguire parity suite e cutover controllato.

Finché questi passaggi non sono conclusi, `mock_read_only` resta lo stato corretto.

---

### W15 — PWA, mobile nativo e offline

**Obiettivo:** rendere l’esecuzione affidabile anche sul campo e con connettività intermittente.

#### PWA

- manifest, service worker e offline fallback;
- queue IndexedDB FIFO;
- replay sequenziale solo dopo readback positivo;
- conflitto esplicito e retry safe;
- diagnostica di cache, queue e sync;
- installability e responsive touch.

#### iOS/Android

- login e credenziali Keychain/secure storage;
- tracking session emessa dal server;
- background/lock screen/low power;
- permission changes e revoca;
- offline replay e reconnect;
- camera, QR/barcode e allegati;
- push/notification quando necessari;
- TestFlight/signing e Android equivalent;
- certificazione su dispositivi fisici con evidenze.

**Gate:** device certification completa prima di dichiarare il mobile production-ready.

---

### W16 — Security, privacy, compliance, observability e DR

**Obiettivo:** rendere la piattaforma operabile e difendibile in produzione.

#### Security

- TLS e encryption at rest;
- KMS/secrets provider-backed e rotation;
- least privilege DB/runtime;
- default deny per tenant/environment/identity;
- distributed rate limiting verificato;
- egress allowlist e SSRF protection;
- content scanning file;
- prompt/tool injection defenses;
- security headers/WAF;
- access review privilegiati;
- audit trail e redazione log.

#### Privacy/GDPR

- registro trattamenti;
- base giuridica per identity, attendance, GPS, documenti, AI e telephony;
- minimizzazione e retention per classe dati;
- DPIA per tracking e AI ad alto rischio;
- informative e indicatori tracking;
- DSAR/accesso/rettifica/cancellazione ove applicabile;
- DPA/subprocessor e trasferimenti;
- incident/breach runbook;
- verifica Statuto dei Lavoratori per controllo a distanza.

#### Operations/DR

- SLO, error budget e alert;
- RPO/RTO formalizzati;
- PITR e backup indipendente secondo criticità;
- restore rehearsal periodico;
- rollback last-known-good;
- migration compatibility;
- dashboard per error rate, p95, queue/DLQ, event lag, Twin freshness, approval age, readback failures e AI cost;
- tabletop incident e DR.

---

### W17 — Test, certificazione e General Availability

**Obiettivo:** promuovere solo ciò che è verificato end-to-end.

#### Matrice test

- unit/domain: invarianti e state machine;
- contract: OpenAPI, AsyncAPI, tool manifest e adapter;
- persistence: migration, concurrency, idempotenza e outbox;
- integration: auth, DB, storage, AI, OTel e provider failure modes;
- browser E2E: onboarding → commessa → planning → FIELD → warehouse → mission → approval → timeline;
- real device: background, lock, low power, offline e reconnect;
- security: tenant isolation, forged tenant, access control, injection, SSRF, upload abuse e rate limit;
- privacy: off-duty tracking, retention, DSAR e telemetry redaction;
- AI eval: tool selection, refusal, approval, readback e cost;
- load: GPS burst, COMMAND, document ingest, Twin concurrency;
- resilience: outage provider, DB failover, delayed outbox, duplicate webhook;
- DR: restore DB, storage refs, readiness e audit consistency.

#### Gate di release

| Gate | Condizione |
|---|---|
| G0 | Baseline e scope congelati. |
| G1 | Identity, tenant, contratti e security foundation verificati. |
| G2 | Commessa + planning + workforce/field end-to-end. |
| G3 | Asset + materiali/warehouse + missioni/trasporti end-to-end. |
| G4 | Documents + finance/procurement con provenance e approval. |
| G5 | Eventi/Twin/Timeline + AI/Tool Gateway con readback. |
| G6 | Mobile, privacy, DR, load, security e provider gates. |
| G7 | Exact build, smoke post-deploy, rollback e sign-off umano. |

La V1 enterprise è `READY` solo dopo G7. Una demo funzionante non sostituisce un gate di certificazione.

## 6. Flusso operativo completo da certificare

Questo è il percorso integrato che deve diventare il test principale della piattaforma:

1. Owner configura tenant, ruoli, sedi e policy.
2. Manager crea una commessa con cliente, sito, budget, attività e documenti.
3. Planning propone date, persone, competenze, asset e materiali.
4. Manager approva il piano; il sistema pubblica assegnazioni e milestone.
5. Workforce valida presenza, qualifica e disponibilità.
6. FIELD apre il turno, esegue attività e registra evidenze/blocker.
7. FIELD richiede materiale; Warehouse valida disponibilità e autorizzazione.
8. Warehouse registra riserva, picking, packing e carico.
9. Mission assegna veicolo/autista, gestisce partenza, arrivo e consegna.
10. POD e quantità consegnate aggiornano commessa, magazzino e Twin.
11. FIELD consuma o restituisce materiale e chiude il rapportino.
12. Asset registra utilizzo, eventuale guasto e manutenzione.
13. Documents collega rapporti, preventivi, DDT, fatture e certificati.
14. Procurement genera eventuale proposta d’ordine con approval.
15. Finance aggiorna costi/ricavi previsti e consuntivi.
16. Command mostra timeline, anomalie, KPI e stato verificato.
17. AI risponde o propone un’azione usando solo contesto autorizzato.
18. Event Store, Outbox, Ledger e readback rendono il percorso ricostruibile.

## 7. Parallelizzazione per non fermare il lavoro

La roadmap procede in stream paralleli con contratti condivisi:

| Stream | Responsabilità | Primi output |
|---|---|---|
| A — Product/domain | Commessa, planning, workforce, asset, warehouse, mission, documents, finance. | State machine e acceptance test per dominio. |
| B — UX/UI | Stati, ruoli, empty/loading/error/approval/reconcile, mobile responsive. | Pattern UI riutilizzabili senza cambiare palette/moduli/card. |
| C — Platform/data | Schema, API, migrations, events, outbox, readback. | Contratti e fixture tenant-scoped. |
| D — AI/governance | Intent, tools, approval, ledger, eval. | Tool registry e policy matrix. |
| E — Security/privacy | Threat model, scopes, retention, DPIA, egress, scanning. | Gate e runbook. |
| F — Mobile/field | PWA, offline, QR, device, GPS. | Certification pack e replay evidence. |
| G — Ops/release | CI, observability, DR, load, promotion, rollback. | Release evidence e deployment checklist. |

Gli stream non devono inventare dati quando il servizio dipendente è `DEFERRED`: usano adapter contract, dati sintetici marcati e stati visibili.

## 8. Ordine di esecuzione consigliato

### Tranche 1 — Subito dopo il freeze

- W01 contratti e release manifest;
- W03 ciclo completo della commessa nel perimetro Sites bounded;
- W04 primo planning reale con revisioni;
- W05 assegnazione workforce e FIELD minimale;
- definizione del test end-to-end commessa → planning → FIELD.

### Tranche 2 — Catena fisica operativa

- W06 asset e manutenzione;
- W07 anagrafica materiale e stock ledger;
- W08 missione e trasporto;
- test completo richiesta materiale → magazzino → missione → POD → reconcile.

### Tranche 3 — Catena documentale/economica

- W09 document ingest/provenance/review;
- W10 procurement, finance e approval;
- integrazione dei documenti nella commessa e nel costo.

### Tranche 4 — Intelligenza e controllo

- W11 Twin/Timeline/ledger/consumer;
- W12 Command AI e Tool Gateway;
- forecast, simulation e governance workflow.

### Tranche 5 — Estensione e certificazione

- W13 communication/voice/telephony;
- W14 NEXUS e adapter production;
- W15 mobile device certification;
- W16 security/privacy/DR;
- W17 release e GA.

## 9. Definition of Done comune a ogni modulo

Un modulo non è chiuso finché non possiede:

- modello dati e migration versionata;
- API/contract aggiornato;
- tenant context e capability check server-side;
- state machine con transizioni valide e invalide;
- idempotenza e concurrency/version check;
- evento append-only e outbox quando applicabile;
- readback verificato;
- UI role-aware con stati loading, empty, error, partial, approval e reconcile;
- audit e provenance;
- test unit, contract, integration ed E2E pertinenti;
- observability senza dati sensibili;
- retention/privacy decision;
- runbook di recovery e rollback;
- evidenza di release collegata a commit e versione.

## 10. Percorso critico aggiornato verso Commercial v1

W03 ha già un verticale bounded Sites funzionante. Il percorso immediato non è aggiungere un altro mock, ma certificare e completare la catena reale:

```text
applica migrazione D1 0010
→ browser test autenticato Command desktop/mobile
→ prova isolamento ruoli e tenant
→ OpenAI live test senza esposizione segreti
→ commessa → planning → FIELD
→ materiale → magazzino → trasporto/POD
→ documenti → procurement/finance → approval
→ security/privacy/restore evidence
→ exact-build checkpoint
→ sign-off umano
→ deploy controllato
```

Il prodotto non viene dichiarato commerciabile finché i gate del checkpoint non hanno evidenza riproducibile. Il design, i widget o una build verde non sostituiscono tenant isolation, test provider, privacy, restore e percorso operativo end-to-end.
