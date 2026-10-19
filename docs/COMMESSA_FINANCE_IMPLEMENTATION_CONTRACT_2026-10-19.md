# Commessa e Finanza — contratto d’implementazione

**Data:** 19 ottobre 2026
**Stato:** valore commessa e intake Finance implementati in Sites/D1 + R2; Nutrient OCR/parsing e proposta Company AI collegati con consenso esplicito, evidenze per campo e audit. Scansione antimalware e registri contabili documentali restano flussi separati.

## Modello della commessa

- La tipologia descrive il percorso: cantiere / nuova commessa, pronto intervento o manutenzione programmata.
- Le lavorazioni sono voci distinte e possono appartenere a sezioni e raggruppamenti diversi. La classificazione globale è facoltativa e va usata solo quando descrive davvero tutte le lavorazioni.
- Company AI propone tipologia, lavorazioni e classificazioni dal catalogo aziendale. Ogni voce resta modificabile e richiede conferma umana; il server risolve e valida gli identificativi contro il catalogo.
- Il valore economico è facoltativo e si registra come `ESTIMATE` oppure `CONTRACTED`. È una previsione o un accordo dichiarato: non è una fattura, un costo sostenuto, un incasso o un saldo.

## Fonte e collegamento attuale

- `job_journey_records` è la fonte versionata del valore, con `domain=finance` e `recordType=JOB_COMMERCIAL_VALUE`.
- La creazione della commessa persiste commessa, voci di lavoro, valore, evento e reconciliation nello stesso batch D1. La scrittura del valore usa tenant, autore, versione e chiave idempotente derivati lato server.
- Finanza legge il valore da `/api/finance/portfolio`, lo collega alla commessa S04 dello stesso tenant e mostra separatamente preventivi e importi accordati.
- Centrale espone il widget `finance-job-kpi` agli utenti con `command.read` e `finance.read`; `/api/finance/job-summary` fornisce il catalogo commesse e ricalcola il riepilogo sul server dopo ogni selezione. Non somma valute diverse e separa proposte/revisioni, approvate e riconciliate.
- Il riepilogo usa `w10_workflows` per le spese Finance e `job_journey_records` per il valore commerciale. L’indice `w10_workflows_tenant_module_job_updated_idx` mantiene la lettura per commessa tenant-scoped.
- Il campo `commercialValue` nel payload S04 è una proiezione per la scheda commessa. In caso di divergenza, il record versionato Finance è la fonte autorevole.
- Il percorso attuale registra il valore alla creazione. Le revisioni successive dovranno essere append-only, con nuova versione, motivazione, autore e data di efficacia; non si sovrascrive la storia.

## Intake documentale Finance

L’archivio deve accettare documenti aziendali sia collegati a una commessa sia generali. Il collegamento a una commessa è quindi facoltativo, ma sempre risolto e autorizzato dal server quando presente. File e metadati devono restare nel tenant e nell’archivio documentale, con hash, provenienza, versione, stato di scansione e log di audit.

| Documento / evento | Effetto nel registro | Regola |
|---|---|---|
| Preventivo o contratto cliente | Valore atteso o accordato | Non è ricavo fatturato né denaro ricevuto |
| Fattura fornitore | Costo documentato, eventualmente ripartito tra commesse | Diventa dato di costo dopo revisione umana; conservare imponibile, IVA, totale e righe distinti |
| Fattura cliente | Ricavo fatturato | Non equivale a incasso; collegamento alla commessa e al documento originale |
| Ricevuta o movimento bancario | Incasso o pagamento | Registrare separatamente e riconciliare alla fattura; non inferire il pagamento dal documento fattura |
| DDT / bolla di trasporto | Evidenza di consegna o movimentazione | Non crea un costo. Il carico/scarico fisico resta nel registro magazzino o missione |
| Documento generale | Archivio e, se pertinente, evento Finance generale | Può restare senza commessa; non inventare allocazioni |

Company AI deve produrre una **proposta di estrazione**, con tipo documento, controparte, date, numero, imponibile, IVA, totale, valuta, righe e possibili commesse. Ogni campo deve poter indicare la pagina o il passaggio sorgente e il livello di confidenza. Ambiguità, importi non riconciliati o possibili duplicati richiedono revisione; nessuna proposta crea da sola una scrittura approvata.

### Stato implementato — archivio e upload

- `finance_documents` è il registro Finance tenant-scoped; `jobId` è nullable e, se valorizzato, il server accetta solo un record S04 `operations/job` dello stesso tenant.
- Poiché Sites pubblica il Worker separatamente dalle migrazioni D1, il server installa in modo idempotente la sola tabella e gli indici Finance mancanti prima del primo accesso; non modifica righe aziendali.
- `POST /api/finance/documents` richiede `finance.write`; `GET` richiede `finance.read`. Firma, MIME, dimensione massima 20 MB, SHA-256, deduplica per tenant, idempotenza e chiave R2 tenant-scoped sono verificati lato server.
- R2 viene riletto con `head`; D1 registra documento, evento S06, outbox e reconciliation nello stesso batch. Un errore prima del commit rimuove l’oggetto caricato; dopo il commit conserva oggetto e metadati per consentire il readback.
- Ogni upload resta `scanStatus=NOT_RUN`, `status=QUARANTINED`; non è scaricabile. La firma del file non viene presentata come malware scan.
- Il catalogo Documenti aggiunge i file Finance solo con `finance.read`; il download e la superficie di sicurezza applicano la capability Finance anche quando il documento compare nel catalogo condiviso. I documenti generali non richiedono una commessa.
- Il modulo Finanza mostra caricamento, commessa facoltativa, tipo documento, hash/readback e stato di quarantena. Il caricamento non crea costi, ricavi, incassi o movimenti contabili.
- Il provider antimalware non è collegato: nessun file viene marcato pulito e il download resta bloccato. L’analisi documentale è un’azione esplicita distinta: dopo consenso, il server invia il file a Nutrient per parsing/OCR e il testo estratto a Company AI/OpenAI. Questo non cambia lo stato antimalware.
- `finance_document_extractions` registra ogni tentativo con tenant, hash sorgente, versione documento, autore, chiave idempotente, provider, stato, proposta, errore tecnico codificato e versione. S06 registra richiesta, proposta o fallimento con outbox e reconciliation.
- Company AI restituisce una proposta, non scritture: ogni dato non vuoto deve citare elementi Nutrient realmente ricevuti; l’app lega citazioni a pagina e confidenza, verifica codici commessa contro il catalogo del tenant, segnala categoria/importi mancanti o incongruenti e conserva solo le citazioni usate, non l’intero OCR.
- Il consenso dell’utente è richiesto prima dell’invio. Nutrient riceve il file originale; OpenAI riceve solo il testo spaziale normalizzato e il contesto minimo delle commesse candidate. Crediti e conservazione provider dipendono dal piano e dalle relative impostazioni.
- La proposta resta `PROPOSED` o `REVIEW_REQUIRED`, richiede ancora una revisione umana e non crea costi, ricavi, incassi, pagamenti o collegamenti a commesse. Download e stato antimalware restano governati dal registro security separato.

### Flusso previsto

1. **Implementato:** upload con `finance.write`, validazione server-side di dimensione, MIME e firma; hash SHA-256, chiave tenant-scoped, idempotenza, readback e quarantena. La scansione è ancora `NOT_RUN` perché manca il provider.
2. **Implementato:** dopo consenso esplicito, Nutrient esegue parsing/OCR; Company AI propone campi con riferimenti a fonti e il server registra l’estrazione versionata e auditata. L’originale resta invariato e in quarantena; l’analisi non equivale a malware scan.
3. **Prossimo blocco:** l’utente autorizzato corregge e conferma o respinge i campi; il server verifica tenant, riferimenti alla commessa, quadratura degli importi, duplicati e capability.
4. La conferma genera record Finance versionati e un evento auditabile. Fattura fornitore e fattura cliente generano costo documentato e ricavo fatturato; pagamento/incasso e DDT restano eventi distinti.
5. Finanza mostra separatamente valore preventivato/accordato, costi approvati, ricavi fatturati e flussi di cassa. Un margine può apparire solo come indicatore con formula e stato di completezza espliciti; mai come saldo contabile certificato.

### Non duplicare costi e movimenti

- Una prenotazione o un prelievo di magazzino non è automaticamente un costo Finance.
- Una fattura che documenta materiale già registrato in acquisto non deve essere sommata una seconda volta: usare riferimenti di riconciliazione a documento, fornitore, numero, importo e righe.
- Una bolla attesta il trasferimento/consegna; la movimentazione fisica e le quantità restano nel ledger warehouse/missione.
- Il trasporto diretto di materiali in cantiere e il ritiro da parte di un operatore mantengono i flussi operativi esistenti; Finance registra soltanto i documenti e i costi confermati.

## Permessi e confini

- `finance.read` legge i valori, i registri e i documenti finanziari; `finance.write` carica e prepara i documenti; una capability di approvazione distinta dovrà confermare estrazioni e registrazioni.
- `documents.read/write` governa i documenti operativi. I documenti Finance nel catalogo condiviso richiedono in aggiunta `finance.read`; avere accesso alla commessa non concede automaticamente visibilità sugli importi o sui file finanziari.
- Il server deriva tenant e autore dalla sessione; il client non può scegliere tenant, approvatore, versione, saldo o stato `CLEAN`.
- Nessuna emissione fiscale, contabilizzazione, pagamento, OCR o scansione antivirus può essere dichiarata eseguita senza un provider con readback verificato.

## Sequenza di rilascio

1. **Completato in questo blocco:** classificazione per lavorazione, tipo operativo, conferma Company AI, importo commessa versionato, lettura in Finanza e KPI Centrale per commessa.
2. **Completato in questo blocco:** archivio Finance indipendente dalla commessa, upload sicuro, collegamento facoltativo a un job, visibilità Finance nel catalogo Documenti, quarantena, deduplica, eventi e readback.
3. **Completato in questo blocco:** proposta Company AI con evidenze per campo e controlli automatici espliciti; la proposta richiede revisione umana e non scrive nel ledger.
4. **Prossimo blocco:** revisione, correzione e conferma con capability distinta; poi registri separati per costo, ricavo fatturato e cassa e riconciliazione a fatture, acquisti, magazzino e missioni.
5. **Gate commerciale separato:** test su tenant isolato, ruoli/capability, duplicati, importi italiani, documenti non puliti, rielaborazione e readback runtime; collegamento a un provider contabile solo se configurato.

## Limite dichiarato

Il collegamento oggi disponibile non è un sistema contabile e non gestisce ancora registrazioni documentali di costo, ricavo, incasso o riconciliazione bancaria. La proposta estratta non è un dato contabile approvato. La scansione antimalware resta separata; Nutrient OCR non certifica che un file sia sicuro.
