# AI-ZEROW COMMAND — W13 Communications / Voice / Telephony

**Data:** 3 ottobre 2026  
**Workstream:** W13  
**Stato:** TECHNICAL PASS · SITES/D1 · PUBLISHED PRIVATELY · OWNER-ONLY  
**Decisione commerciale:** NO-GO fino alla chiusura dei gate esterni e umani

## Perimetro chiuso in questa tranche

- `/communications` è stato riallineato alla shell Command carbon/lime condivisa, con layout desktop/mobile, sidebar collassabile, topbar, ricerca, back, refresh, inspector e capability filtering.
- Il registro legge il readback di `/api/communications` e separa briefing, broadcast, richieste di acknowledgment e proposte voice.
- La nuova proposta accetta solo tipi, canali e audience dichiarati dal contratto; per una comunicazione legata a una commessa presenta esclusivamente commesse reali del catalogo Operations.
- `POST /api/communications` richiede `communication.send`, risolve ID o codice canonico nel tenant server-side e rifiuta riferimenti inesistenti o cross-tenant.
- La persistenza riusa il boundary S05: record append-only, evento, outbox e reconciliation. La UI rilegge il risultato invece di trattare la richiesta client come consegna riuscita.
- La vista Acknowledgement espone le richieste aperte senza simulare conferme inbound; la vista Voice espone adapter, consenso, identità e transcript come confini di contratto.

## Invarianti verificati

1. Nessun `tenantId`, ruolo o capability arriva dal client come fonte di autorizzazione.
2. Nessuna commessa viene digitata liberamente per creare una comunicazione: il server valida `s04_records` del tenant attivo.
3. `deliveryStatus` e `providerStatus` restano espliciti: `PENDING_EXTERNAL_CONSUMER`, `SITES_READBACK_ONLY` e `EXTERNAL_DEFERRED` non equivalgono a `DELIVERED`.
4. Voice crea solo `VOICE_PROPOSAL`; non apre microfono, non invia audio, non persiste raw audio/transcript e non simula SIP o webhook.
5. I canali `VOICE` richiedono acknowledgment; il contratto di consenso resta obbligatorio prima di un futuro connector.
6. Le capability sono separate: `communication.read` per il readback e `communication.send` per la proposta.

## Verifica tecnica

| Controllo | Esito |
|---|---|
| TypeScript `pnpm exec tsc --noEmit --pretty false` | PASS |
| `pnpm run verify:commercial` | PASS |
| `pnpm run audit:release` | PASS_WITH_EXTERNAL_GATES |
| Lint | PASS, solo warning legacy sugli `<img>` |
| Build produzione | PASS |
| `git diff --check` | PASS |
| Runtime HTTP smoke | NOT RUN / ambiente Sites locale non autorizzato al bind |
| Browser/device e PWA installability reale | NOT RUN |
| OpenAI live / provider delivery | NOT RUN |

## Gate ancora aperti

- consumer/worker esterno per delivery e retry reale;
- provider notification, push/email e receipt readback;
- voice/SIP/telephony, identità chiamante, consenso runtime, credenziale effimera e webhook firmati;
- retention e accesso alle comunicazioni sensibili;
- sessione autenticata Neon, runtime OpenAI, browser/device e offline/replay;
- sign-off umano, osservabilità e certificazione commerciale.

## Decisione

W13 è un **technical pass pubblicato privatamente** nel perimetro Sites/D1. La piattaforma mantiene il confine corretto: Company AI e UI possono proporre e rileggere, ma non dichiarano una comunicazione consegnata né una chiamata avvenuta senza provider evidence. La certificazione commerciale resta **NO-GO**.
