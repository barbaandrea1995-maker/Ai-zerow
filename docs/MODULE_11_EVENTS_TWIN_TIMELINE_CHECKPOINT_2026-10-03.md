# AI-ZEROW COMMAND — W11 Events, Twin, Timeline & Ledger checkpoint

**Data:** 3 ottobre 2026  
**Stato:** TECHNICAL PASS · PRIVATE OWNER-ONLY RELEASE  
**Release line:** Commercial v1 RC2.9-AUDIT-1 technical candidate, not commercial certification

## Esito

`/events` è stato riallineato alla shell Command e trasformato in una control deck W11 unica per event stream, outbox, Company Twin read model e Command ledger. La superficie legge esclusivamente i readback autorizzati del tenant e rende visibile il confine tra ciò che Sites ha committato e ciò che richiede un consumer esterno.

La pubblicazione resta privata e owner-only. Il checkpoint chiude il perimetro Sites/D1, non la certificazione dei worker o dei servizi esterni.

## Contratto implementato

- `GET /api/events` legge eventi, outbox e reconciliation tenant-scoped attraverso il contratto S06.
- `POST /api/events` conserva EventEnvelope, actor, source, aggregate, schema version, correlation, causation, idempotency e aggregate-version uniqueness server-side.
- Evento, outbox e reconciliation vengono creati nello stesso batch D1; il readback è la fonte visibile dell’esito.
- `/api/events/outbox` espone solo transizioni governate `retry`, `requeue`, `block` e `dead_letter`; il worker esterno non viene simulato e Sites non dichiara `DELIVERED`.
- Il read model Company Twin è derivato dagli eventi, dalle versioni aggregate, dall’outbox e dalle reconciliation riletti; è marcato come proiezione locale e non come Twin canonico.
- `/api/command/timeline-detail` alimenta il Command ledger quando il ruolo dispone di `command.read`; preview, approval e readback restano separati e `directWrite: false`.
- La composizione manuale usa template di eventi controllati; tenant, actor, timestamp, correlation e provenance restano server-owned.

## Superficie UI/UX

- sidebar Command collassabile e topbar condivisa con icona ufficiale ZEROW;
- hero W11 con stato D1, Company Twin osservato e boundary consumer;
- KPI per eventi committati, delivery pending, DLQ, reconciliation e ledger AI;
- quattro viste collegate: Event stream/Timeline, Outbox control, Twin read model e Command ledger;
- inspector evento con payload, actor, aggregate, versione, correlation e idempotency;
- controlli outbox con retry budget massimo 5, requeue, block e DLQ esplicita;
- ricerca globale, refresh, back, tenant switcher, comunicazioni e profilo;
- responsive mobile/PWA con bottom navigation limitata ai ruoli operativi e capability filtering.

## Verifiche eseguite

| Controllo | Esito |
|---|---|
| TypeScript | PASS |
| lint | PASS · 7 warning legacy `<img>` fuori dal modulo |
| build Vinext | PASS |
| audit release surface | PASS_WITH_EXTERNAL_GATES · 31 page routes, 67 API routes, 41 endpoint references |
| verify commercial static contract | PASS |
| git diff check | PASS |
| runtime smoke locale | NOT RUN: il sandbox blocca `127.0.0.1:5173` e `::1:5173` con `EPERM` |
| browser/device certification | NOT RUN: sessione autenticata e harness device non disponibili |

## Gate ancora aperti

- consumer esterno e worker persistente con retry/backoff reale;
- DLQ operativa e replay certificato su infrastruttura autorizzata;
- Company Twin canonico con revisioni entità/relazioni e proiezioni rigenerabili;
- Timeline cross-domain proveniente dai servizi canonici, non solo dal read model Sites;
- OpenAI live, provider mappe/GPS, osservabilità/SLO, privacy/retention e sign-off umano;
- browser/device/offline certification e verifica runtime autenticata.

## Decisione checkpoint

`W11 SITES TECHNICAL PASS` nel perimetro owner-only privato. Event stream, delivery control, read model e ledger sono collegati senza inventare consumer o proiezioni esterne; la certificazione commerciale resta `NO_GO` finché i gate sopra non sono chiusi.

## Addendum di coerenza W11/W15 — 10 ottobre 2026

L’integrazione offline aveva un contratto incoerente: la PWA mandava la chiave idempotente nell’header, mentre `/api/events` la cercava solo nel body e richiedeva aggregati che il client non deve poter dichiarare per un segnale diagnostico. Il replay ora accetta la chiave dal body o dall’header e rifiuta valori discordanti. `pwa.diagnostics.signal` usa la capability dedicata `pwa.signal`, aggregato e versione server-owned derivati dalla chiave idempotente e un payload limitato al build; non può dichiarare eventi di commessa, missione, presenza o magazzino. La risposta contiene soltanto la conferma del singolo segnale, senza esporre il registro eventi a chi non ha `events.read`. Gli altri eventi mantengono il gate `events.write` e il contratto standard.

La coda rimuove l’elemento solo dopo questo readback positivo. Restano da eseguire il replay offline/online su browser autenticato e la certificazione device reale; il consumer esterno continua a essere differito.
