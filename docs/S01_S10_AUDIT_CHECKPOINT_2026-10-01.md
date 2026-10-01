# AI-ZEROW COMMAND — checkpoint audit S01–S10

Data: 2026-10-01  
Perimetro: Site privato, D1 Sites e binding Neon già autorizzato  
Principio: un gate è chiuso solo quando il contratto server, il confine tenant, la mutazione e il readback sono coerenti.

## Esito del ribattimento

| Gate | Esito | Verifica corrente |
|---|---|---|
| S01 | CLOSED · Sites | Identità derivata dai server headers; route protette rifiutano richieste anonime; nessun actor/tenant accettato dal browser. |
| S02 | CLOSED · Sites/D1 | Tenant e capability arrivano dalla membership D1; cookie tenant solo preferenza verificata; Neon non fa bootstrap autonomo. |
| S03 | CLOSED · contract | Scope Company AI validato a sezione → raggruppamento → sottogruppo; campi, payload e input bounded. |
| S04 | CLOSED · Sites adapter | S04 generico e commesse usano idempotenza, naming server-side, batch record/event/outbox/reconciliation e readback; dominio canonico esterno differito. |
| S05 | CLOSED · Sites adapter | Proposte Documents/Finance/Procurement/Governance sono append-only, bounded e ora allineate al commit S06; adapter documentale/OCR e domini canonici differiti. |
| S06 | CLOSED · Sites adapter | Event store, idempotenza tenant, aggregate version unica, outbox e reconciliation vengono scritti nello stesso batch; il consumer esterno resta differito. |
| S07 | CLOSED · OpenAI + governed preview | Intake Company AI usa la Responses API OpenAI con output strutturato e scope validato; command/tool gateway e approval restano ledger append-only, idempotenti e senza direct write. La chiave è un secret Sites; nessun valore entra nel repository. |
| S08 | CLOSED · presentation | Release identity condivisa, service worker invalidabile, queue PWA con aggregate version stabile e replay FIFO; API non vengono messe in cache. |
| S09 | PARTIAL · evidence | Build, typecheck, lint e tabella route passano. Browser/device regression completa deve essere rieseguita sulla nuova deployment; il preview locale è stato bloccato da `uv_interface_addresses` dell’ambiente. |
| S10 | CLOSED · read-only binding | Il readback Neon autorizzato resta read-only, con project/branch/database/fingerprint e permission gaps espliciti; nessun cutover D1 e nessuna scrittura Neon. |

## Correzione Company AI / perdita idrica

La classificazione non usa più il semplice conteggio delle parole. Il resolver:

- rimuove stopword e normalizza singolare/plurale e varianti (`idrica`/`idrico`, `tubazioni`/`tubazione`);
- pesa parole chiave di sottogruppo, raggruppamento e sezione separatamente;
- riconosce segnali composti come `perdita idrica`, `ricerca perdita`, `linea di adduzione`, `acqua in pressione` e `prova di pressione`;
- restituisce solo il sottogruppo, non una voce tariffaria;
- mantiene il knowledge pack come contesto reference-only e richiede conferma umana.

Il caso del preventivo EMS viene ora proposto come:

`E · Impianti tecnologici / Idrico-sanitario e gas / Adduzione e distribuzione`

con confidence locale alta e segnali leggibili nella preview. Il test del resolver sul testo della perdita idrica restituisce `E-IDRICO-ADDUZIONE`.

L’intake DOCX ora legge anche le tabelle Word e conserva le voci sotto `LAVORAZIONI COMPRESE` come `workItems` distinti (quantità/unità quando esplicite). Le voci vengono mostrate in preview, persistite nel payload della commessa e usate per ampliare la ricerca del knowledge pack; la descrizione resta una sintesi e non una copia del preventivo.

## Confini non dichiarati chiusi

- Il command/tool gateway, OCR/storage esterno, canonical domain services, event consumer/DLQ e native mobile restano adapter esterni espliciti.
- L'intake Company AI chiama OpenAI Responses server-side; la chiave è presente solo come secret Sites e non viene stampata nei log o inclusa nel repository.
- `DECLARATIVE_PASS` nel registro externals certifica il contratto Sites, non l’health reale del provider.
- La chiusura S01–S10 non certifica un cutover del runtime Neon né la parità con servizi esterni.

## Evidenza tecnica

- `pnpm run build`: PASS.
- `pnpm exec tsc --noEmit`: PASS.
- lint mirato sulle superfici modificate: PASS, con soli warning preesistenti sulle immagini `<img>`.
- `git diff --check`: PASS.
- test resolver locale sul caso perdita idrica: PASS → `E-IDRICO-ADDUZIONE`.
- test adapter OpenAI locale con risposta strutturata simulata: PASS → `E-IDRICO-ADDUZIONE`.
- runtime locale Wrangler: NOT_RUN per errore di rete dell’ambiente (`uv_interface_addresses returned Unknown system error 1`); da ribattere dopo publish.
