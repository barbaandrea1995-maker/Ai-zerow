# AI-ZEROW COMMAND — Roadmap Pianificazione, Presenze, Trasporti e UI/UX commerciale

**Versione:** 1.1
**Data:** 2 ottobre 2026
**Checkpoint:** `PTU-UX-02 · P0–P3 parziali verificati · moduli centrali attivi`
**Baseline:** Commercial v1 RC2.9-AUDIT-1, candidato tecnico locale, `COMMERCIAL NO-GO`
**Deploy:** congelato fino alla certificazione finale

**Verbale audit corrente:** `docs/AUDIT_CERTIFICATION_PTUX02_2026-10-02.md`

## Obiettivo

Portare AI-ZEROW COMMAND a una prima versione commerciale coerente e verificabile, collegando in un unico modello:

- configurazione multi-azienda e multi-tenant;
- pianificazione giornaliera delle commesse;
- workforce, turni e presenze;
- geofence e posizione durante il servizio;
- trasporti, autisti, mezzi, asset e materiali;
- tracking GPS reale e osservazione su Command;
- onboarding, ruoli e capability;
- audit tecnico, funzionale, visivo, accessibilità e sicurezza;
- certificazione finale con evidenze riproducibili.

Questa roadmap estende W02, W04, W05, W06, W07, W08, W15, W16 e W17 della Master Roadmap. Non sostituisce framework, routing, autenticazione, contratti già esistenti o isolamento tenant.

## Decisione architetturale

I moduli non saranno sistemi separati:

```text
Company profile + capability
        ↓
Pianificazione
  ├─ attività giornaliera commessa
  ├─ turno e assegnazioni
  └─ trasporto come attività operativa
        ↓
Presenze / esecuzione FIELD / missione
        ↓
Eventi + outbox + readback + audit
        ↓
Command / timeline / Company AI
```

La Pianificazione è l'orchestratore. Presenze registra l'esecuzione reale. Missione gestisce il trasporto. Command osserva soltanto dati verificati e non mostra posizioni inventate.

## Modello aziendale

Il tenant viene configurato attraverso due livelli, evitando una proliferazione di profili rigidi.

### Domini operativi

- `operations`: commesse, scope, attività e cantieri;
- `workforce`: persone, squadre, turni e presenze;
- `warehouse`: depositi, stock, picking, packing e ricezione;
- `transport`: autisti, mezzi, missioni e tracking.

### Modalità di trasporto

- `ASSET_TRANSFER`: asset o attrezzatura verso cantiere/destinatario;
- `WAREHOUSE_TO_RECIPIENT`: magazzino verso destinatario esterno;
- `WAREHOUSE_TO_JOB`: magazzino verso una commessa;
- `RETURN_TO_WAREHOUSE`: rientro di asset, materiali o resi;
- `WAREHOUSE_TRANSFER`: trasferimento tra sedi o magazzini.

| Configurazione | Pianificazione | Trasporto autorizzato |
|---|---|---|
| Solo operations | Attività commessa e turni | Nessuna missione propria |
| Solo workforce | Turni e presenze | Nessuna missione propria |
| Solo warehouse | Picking e richieste di trasporto | Può creare richieste; non assegna flotta propria |
| Solo transport | Missioni, autisti, mezzi e tracking | Asset e attrezzature; tratte dirette |
| Warehouse + transport | Magazzino e missioni | Destinatario, commessa, asset e rientri |
| Full operations | Tutto il ciclo commessa | Tutte le modalità abilitate |

Un trasporto verso una commessa è disponibile solo se il tenant ha `operations` e una commessa accessibile. Un’azienda senza flotta può inoltrare una richiesta a un vettore autorizzato, ma non può simulare un autista o un mezzo interno.

Il collegamento tra tenant è sempre esplicito e least-privilege: cliente, vettore o subappaltatore vede soltanto il contratto operativo condiviso, mai il tenant completo.

## Fasi di implementazione

### P0 — Freeze, contratto e riallineamento architetturale

**Scopo:** trasformare lo studio in un contratto implementabile senza rompere la baseline.

- congelare RC2.9 e registrare questo checkpoint;
- separare `workforce` da `transport` nel modello capability;
- definire i tipi canonici `activity`, `shift`, `assignment`, `attendance`, `transportPlan` e `trackingSession`;
- mantenere compatibilità con `jobJourneyRecords`, S04 adapter, eventi, outbox e reconciliation durante la migrazione;
- vietare scritture client-side di tenant, ruolo, capability, risorsa o posizione ufficiale;
- fissare timezone, precisione GPS, policy di retention e soglie di stale come configurazioni tenant;
- definire adapter provider-neutral per mappe, routing e telematica.

**Uscita P0:** contratto versionato, matrice capability corretta, migrazioni additive approvate, nessun comportamento non verificato promosso a `READY`.

### P1 — Onboarding, domini e capability

**Scopo:** fare in modo che ogni azienda veda e utilizzi solo ciò che ha configurato.

Onboarding in sei passaggi:

1. identità e membership tenant;
2. domini operativi;
3. modalità di trasporto;
4. sedi, cantieri, magazzini e geofence;
5. persone, ruoli, mezzi, asset e autisti;
6. policy di approvazione, tracking e privacy.

Capability minime:

- `planning.read`, `planning.write`, `planning.publish`;
- `attendance.self`, `attendance.read`, `attendance.manage`, `attendance.approve`;
- `transport.request`, `transport.dispatch`, `transport.pod`, `transport.reconcile`;
- `tracking.read.live`, `tracking.read.history`, `geofence.read`, `geofence.manage`;
- `warehouse.pick`, `warehouse.ship`, `warehouse.receive`;
- `telemetry.ingest`, riservata al servizio/provider.

**Uscita P1:** un tenant operations-only non vede magazzino o trasporti; un tenant transport-only può gestire missioni autonome; un tenant full vede il percorso completo. Le stesse regole devono essere applicate a menu, widget, route, modali e API.

### P2 — Pianificazione operativa delle commesse

**Scopo:** rendere pianificabile la giornata reale, non soltanto salvare un testo con data e responsabile.

Gerarchia:

```text
Commessa → sottogruppo scope → attività → turno → risorse → esecuzione → consuntivo
```

Ogni attività deve avere sottogruppo, luogo, finestra, durata, priorità, qualifiche, risorse, dipendenze, materiali e stato. L’AI può proporre attività dal preventivo e dal knowledge pack, ma l’operatore approva e può sempre vedere la provenienza.

Viste da implementare:

- agenda di oggi;
- calendario per commessa;
- vista persone e squadre;
- vista asset, mezzi e materiali;
- attività non assegnate;
- conflitti e indisponibilità;
- trasporti in partenza;
- piano pubblicato e differenza rispetto al consuntivo.

Regole server-side prima di salvare o pubblicare:

- sovrapposizione temporale;
- disponibilità e assenza;
- qualifica e certificazione;
- stato manutentivo dell’asset o del mezzo;
- capacità e compatibilità;
- materiale disponibile o prenotato;
- tempo di trasferimento tra sedi;
- dipendenze e priorità;
- versione del piano e concorrenza.

Stati:

`DRAFT → PROPOSED → APPROVED → PUBLISHED → IN_EXECUTION → COMPLETED`

Eccezioni: `REVISED`, `BLOCKED`, `CONFLICTED`, `CANCELLED`, `SUPERSEDED`.

**Uscita P2:** nessun campo libero per “team”, “responsabile”, autista o mezzo quando esiste un registro selezionabile; ogni assegnazione ha ID verificato, snapshot e audit.

### P3 — Turni e modulo Presenze

**Scopo:** collegare il turno pianificato alla prova dell’esecuzione.

- registro turni, pattern, eccezioni, ferie e indisponibilità;
- assegnazione a persona o squadra;
- check-in, pausa, ripresa, check-out;
- correzione motivata e approvazione;
- timestamp ufficiale server-side;
- posizione osservata con accuratezza e sorgente;
- esito geofence `INSIDE`, `OUTSIDE`, `UNCERTAIN` o `UNAVAILABLE`;
- indicatore chiaro di tracking attivo;
- modalità offline con coda idempotente e replay verificabile;
- supervisore e auditor vedono solo il perimetro autorizzato.

Il tracking personale è limitato al contesto di lavoro autorizzato. La posizione fuori turno non viene raccolta. Retention, informativa, DPIA e verifica del quadro lavoristico sono gate obbligatori, non attività opzionali di UI.

**Uscita P3:** un’attività pubblicata genera un turno; il lavoratore può eseguire la presenza; il supervisore può approvare una correzione; il readback ricostruisce attore, orari, posizione e stato.

### P4 — Trasporti integrati con Pianificazione e Missioni

**Scopo:** eliminare il doppio inserimento e rendere la missione una conseguenza del piano.

Wizard unico:

1. modalità abilitata dal tenant;
2. origine tipizzata;
3. destinazione tipizzata;
4. asset/materiali/quantità;
5. finestra, priorità e vincoli;
6. autista, mezzo e capacità realmente disponibili;
7. documenti e autorizzazioni;
8. approvazione e pubblicazione.

State machine:

`DRAFT → PROPOSED → APPROVED → ASSIGNED → LOADED → STARTED → ARRIVED → DELIVERED → POD_VERIFIED → RECONCILED → CLOSED`

Eccezioni: `DELAYED`, `BLOCKED`, `VEHICLE_FAULT`, `PARTIAL_DELIVERY`, `REFUSED`, `LOST`, `CANCELLED`.

Regole specifiche:

- Bobcat e attrezzature usano asset ID e custodia;
- magazzino → commessa crea riserva, picking, carico e ricezione;
- magazzino → destinatario richiede POD e destinatario;
- rientri e resi riaprono solo il flusso logistico autorizzato;
- driver e vehicle sono selezionabili solo da cataloghi tenant-scoped e non occupati;
- missione e attività condividono ID, stato, finestra e audit.

**Uscita P4:** il trasporto non è più testo libero e non può essere assegnato a una risorsa già impegnata.

### P5 — GPS, telematica e Command operativo

**Scopo:** sostituire la mappa dimostrativa con osservazione reale e dichiarata.

- integrazione provider telematico tramite webhook autenticato e deduplicato;
- associazione `vehicle ↔ device ↔ tenant` verificata server-side;
- timestamp dispositivo separato da timestamp ricezione;
- gestione dati fuori ordine, duplicati, ritardi e provider offline;
- PWA autista come fonte complementare durante la missione;
- mappa con provider configurato, marker, tratte, tappe, geofence e stato stale;
- Command mostra fonte, ultima posizione, accuratezza e freschezza;
- nessuna posizione simulata quando il provider non risponde;
- controllo accessi distinto tra live tracking e storico.

**Uscita P5:** una missione attiva può essere osservata dal Command con dati reali, auditabili e tenant-scoped; un outage è visibile come stato, non nascosto.

### P6 — Pulizia e riallineamento UI/UX commerciale

**Scopo:** portare tutte le superfici a un prodotto unico, coerente e vendibile.

Audit visuale e funzionale su ogni route:

- eliminazione di moduli duplicati, legacy o non autorizzati;
- sidebar e mobile navigation derivate dalle capability reali;
- titoli, CTA e nomenclatura coerenti tra Command, Commessa, Pianificazione, Presenze, Magazzino e Missioni;
- un solo flusso di creazione per attività e trasporto;
- modali senza blocchi di avanzamento inutili e senza auto-zoom;
- selettori reali per persone, mezzi, asset e materiali;
- stati loading, empty, error, success, blocked e unknown uniformi;
- responsive desktop/tablet/PWA senza overflow o ridimensionamenti manuali;
- tastiera, focus visible, touch target, contrasto WCAG AA e reduced motion;
- performance: lazy rendering, niente caricamento indiscriminato di tutti i moduli;
- uso rigoroso del sistema carbon/lime approvato;
- carbonio dominante, lime come gerarchia, glow controllato;
- icona ufficiale Z nell’animazione e nel branding, nessuna foglia o icona inventata;
- microinterazioni coerenti con il JSON visuale v3;
- Command con widget personalizzabili ma sempre capability-filtered.

**Uscita P6:** audit UI/UX senza route orfane, pulsanti non collegati, testo placeholder, stati falsi o componenti visivamente fuori sistema.

### P7 — Audit completo e certificazione

L’audit finale sarà eseguito solo dopo P1–P6 e comprenderà:

| Area | Verifica |
|---|---|
| Funzionale | onboarding, commessa, planning, turni, presenze, missione, warehouse, POD e Command |
| API | route, capability, tenant scope, idempotenza, versioni, errori e readback |
| Multi-tenant | isolamento positivo/negativo, membership e condivisioni cross-tenant esplicite |
| GPS | geofence, tracking on-duty, stale, provider outage, device permissions |
| UI/UX | route, CTA, modali, responsive, stati, typography, colori, iconografia e widget |
| Accessibilità | tastiera, focus, contrasto, aria-label, zoom 200%, reduced motion |
| PWA | installazione, offline, coda, replay, reconnect, lock/background e low power |
| Security/privacy | ruoli, audit, retention, payload, segreti, DPIA e policy lavoristica |
| Performance | bundle, lazy loading, tempi route, mappe, polling/realtime e GPS burst |
| Release | build riproducibile, migrazioni, rollback, osservabilità, backup e restore |

Ogni rilievo avrà severità `BLOCKER`, `HIGH`, `MEDIUM` o `LOW`, evidenza, responsabile, correzione e retest. Nessun blocker o high aperto è compatibile con la certificazione commerciale.

### P8 — Gate di certificazione e rilascio

La release potrà essere marcata `CERTIFIED COMMERCIAL` solo se tutti i gate sono `READY`:

1. baseline e migrazioni ripristinabili;
2. onboarding e capability verificati per ogni profilo;
3. commessa → attività → turno → presenza chiusi end-to-end;
4. magazzino/asset → trasporto → consegna/POD chiusi end-to-end;
5. GPS provider e mappe con evidenza runtime;
6. OpenAI/Company AI live con sessione autenticata e guardrail verificati;
7. PWA e almeno un dispositivo reale certificati;
8. privacy, retention, audit e sign-off umano completati;
9. UI/UX audit chiuso e regressione visuale superata;
10. backup, restore, osservabilità, rollback e runbook verificati.

Finché anche un solo gate essenziale è `NOT RUN`, `BLOCKED` o `PENDING_REVIEW`, lo stato resta `COMMERCIAL NO-GO`. Il deploy commerciale è l’ultimo atto, non una prova di certificazione.

## Scenari di accettazione obbligatori

1. **Operations-only:** Company AI propone le attività del sottogruppo; il planner pubblica il turno; l’operatore timbra in geofence; il supervisore approva il consuntivo.
2. **Transport-only:** viene creato un trasferimento asset; il sistema seleziona solo autista e mezzo disponibili; la missione viene tracciata e chiusa con POD.
3. **Warehouse + transport:** il magazzino prepara una spedizione verso destinatario; il mezzo carica; il destinatario firma; lo stock viene riconciliato.
4. **Full tenant:** il magazzino prepara materiale per una commessa; la missione collega job, asset, autista e mezzo; la commessa riceve il materiale; Command mostra stato e posizione autorizzata.
5. **Negative path:** un utente senza capability, un tenant estraneo, una risorsa occupata, un mezzo non idoneo o un provider offline ricevono un blocco esplicito e auditabile.

## Stato del checkpoint

- Roadmap: `APPROVATA`
- Base attuale: `FROZEN / RC2.9 TECHNICAL CANDIDATE`
- Implementazione di questa tranche: `P0/P1/P2/P3 PARTIAL + P6 FOUNDATION — capability, onboarding, planning centrale, risorse, presenze e pulizia UI iniziale`
- Audit finale: `PENDING`
- Certificazione commerciale: `NO-GO`
- Deploy commerciale: `FROZEN`

P0 ha separato `workforce` e `planning` dai filtri di dominio e ha introdotto la configurazione tenant-scoped delle modalità di trasporto con migrazione `0015_large_mysterio.sql`. P1 espone le modalità nell’onboarding; P2 ora offre anche `/planning` con selettori di risorse canoniche, bozze e pubblicazione; P3 offre `/presenze`, timbratura job-scoped, timestamp server-side, GPS on-duty e valutazione geofence quando la commessa ha coordinate. Restano aperti tracking telematico provider-backed, mappe reali, offline/replay certificato, audit UI/UX finale e certificazione commerciale.
