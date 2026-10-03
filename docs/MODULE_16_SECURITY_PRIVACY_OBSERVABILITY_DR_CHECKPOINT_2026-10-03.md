# AI-ZEROW COMMAND — W16 Security, Privacy, Observability & DR checkpoint

**Data:** 3 ottobre 2026
**Stato tranche:** `TECHNICAL PASS / PROVIDER + HUMAN GATES OPEN`
**Commercial status:** `NO-GO`
**Private publication:** Sites v111 · deployment `appgdep_6ac0ecf79bfc819188771b560b8a708c`
**Commit:** `596eeba15c79cc63e78271e9d11c47cd0ee66d21`
**Access:** owner-only · `barba.andrea.1995@icloud.com`

## Risultato

W16 porta `/governance/security` nello stesso Command shell di dashboard, Operations, Mission e PWA. La pagina riceve ruolo e capability dal server, usa l’icona ZEROW ufficiale, sidebar collassabile, topbar, ricerca, refresh, account menu, ritorno a Command e mobile navigation role-aware.

Il control plane non è un pulsante di certificazione: espone evidenze leggibili e separa ciò che è chiuso localmente da ciò che richiede provider, ambiente autorizzato o approvazione umana.

## Contratti verificati

- `governance.read` è richiesto dal layout e dalla pagina prima del rendering della superficie;
- il readback `GET /api/governance/security-readiness` deriva identità e tenant dal contesto server-side e non restituisce segreti;
- il catalogo mantiene stati distinti `READY`, `PARTIAL`, `NOT_RUN`, `BLOCKED` e `PENDING_REVIEW`;
- isolamento tenant, capability enforcement, payload/rate guard, secret boundary, document fail-closed, privacy on-duty, audit append-only e restore D1/R2 restano evidenze locali;
- malware scanner, osservabilità/SLO/RPO/RTO, DPIA/retention/DPA e sign-off commerciale restano gate aperti;
- `directWrite` è visibile come `BLOCKED` e nessuna CTA della UI può promuovere il candidato.

## Verifiche

| Check | Esito |
|---|---|
| TypeScript | `PASS` |
| Lint | `PASS` · 0 errori, 5 warning `<img>` legacy preesistenti |
| `verify:commercial` | `PASS` · W16 authority/shell/readback assertions attive |
| `audit:release` | `PASS_WITH_EXTERNAL_GATES` · nessun endpoint irrisolto, nessun Command icon button non collegato |
| Build | `PASS` · `/governance/security` presente |
| Deployment Sites | `SUCCEEDED` · v111 |
| Worker errors | `0` negli ultimi 30 minuti osservati |
| OpenAI live / malware provider | `NOT RUN` |
| DPIA/retention/sign-off | `PENDING_REVIEW` |

## Gate aperti

1. Eseguire osservabilità autorizzata con metriche, tracing redatto, error budget e SLO/RPO/RTO osservabili.
2. Configurare e provare il malware provider con callback autenticata, risultato CLEAN/INFECTED e hash mismatch.
3. Approvare DPIA, DPA, retention, DSAR, incident response e policy per attendance/GPS/AI/telephony.
4. Eseguire i test Neon/device/browser/provider ancora `NOT RUN` e raccogliere sign-off umano security/privacy/commerciale.

**Conclusione:** W16 è pubblicato come control plane tecnico Sites/D1, con boundary fail-closed e prove separate. Non è ancora una certificazione commerciale.
