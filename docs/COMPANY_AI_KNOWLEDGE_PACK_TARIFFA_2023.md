# Company AI — Knowledge Pack Tariffa 2023

**Data:** 1 ottobre 2026
**Pack:** `tariffa-2023-open-data` · versione `2023.1`
**Confine:** riferimento tecnico strutturato, non preventivo, ordine o autorizzazione.

## Contenuto importato

Il file ZIP fornito è stato normalizzato in 12.377 voci tariffarie provenienti da 9 CSV:

- A — Opere edili
- B — Opere stradali e infrastrutture a rete
- C — Verde
- D — Impianti elettrici
- E — Impianti tecnologici
- F — Opere marittime
- G — Piccola manutenzione
- H — Restauro
- S — Sicurezza

Ogni voce conserva codice, descrizione, unità di misura, prezzo 2023, parte tariffaria, breadcrumb gerarchici e provenienza `file + riga`.

La provenance completa e gli hash dei nove file sorgente sono nel manifest del pack:
`knowledge/company-ai/tariffa-2023/manifest.json`.

## Come viene usato da Company AI

1. La preview della nuova commessa legge il testo del preventivo e propone i dati anagrafici.
2. Lo stesso testo viene confrontato con il pack per proporre il percorso gerarchico fino al sottogruppo e un contesto tecnico di riferimento.
3. Le proposte restano `preview-only`: la persona verifica e modifica.
4. Lo scope della commessa collega il `jobId` a un solo livello operativo: `sezione → raggruppamento → sottogruppo`.
5. Ogni collegamento è tenant-scoped, versionato, idempotente e registrato in eventi, outbox, reconciliation e ledger S07.

## Contratto di sicurezza

- La tariffa è `reference-only`.
- Il prezzo non viene trasformato automaticamente in preventivo, costo consuntivo, ordine o fattura.
- Company AI non scrive direttamente la commessa durante la preview.
- Le voci knowledge non sono livelli dello scope: vengono conservate solo come contesto tecnico derivato per Company AI.
- Cambiare scope crea una nuova versione; la storia precedente resta leggibile.
- La ricerca è autorizzata server-side e non accetta un tenant dal body del browser.

## Superficie pronta per il prossimo passaggio

- `GET /api/company-ai/knowledge?q=...&part=A&limit=8` cerca nel pack.
- `GET /api/company-ai/scope?jobId=...` legge lo scope della commessa.
- `POST /api/company-ai/scope` salva una versione dello scope con `scopeSectionId`, `scopeGroupId`, `scopeSubgroupId`, `scopeText`, `assumptions`, `exclusions` e `status`.

Le voci tariffarie restano consultabili nel contesto Company AI, ma non sono selezionabili come categorie della commessa.
