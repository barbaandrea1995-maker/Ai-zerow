# AI-ZEROW COMMAND — W15 PWA, Mobile & Offline checkpoint

**Data:** 3 ottobre 2026
**Stato tranche:** `TECHNICAL PASS / DEVICE CERTIFICATION NOT RUN`
**Commercial status:** `NO-GO` finché non sono raccolte evidenze browser/device e sign-off umano
**Scope:** Sites/D1, control deck `/pwa/diagnostics` e alias `/mobile/diagnostics`
**Private publication:** Sites v109 · deployment `appgdep_6ac0e925a3448191b3863bc0f0bb8b1f` · commit `9309a6cf527861c4a6fffe4a900372525fe640fe`
**Access:** owner-only · `barba.andrea.1995@icloud.com`

## Risultato

W15 riallinea la superficie PWA/offline al sistema visivo Command: sidebar collassabile, topbar coerente, icona ZEROW ufficiale, carbon/lime hierarchy, KPI di runtime, readiness matrix, offline queue inspector e installability observer.

La route è protetta da `pwa.read`. La `CommandMobileNav` resta disponibile soltanto per i ruoli operativi già definiti e filtra i link attraverso la navigazione autorizzata; W15 non introduce un bypass verso Command o altri moduli.

## Contratti chiusi tecnicamente

- `public/manifest.webmanifest`: standalone, start `/command`, scope `/` e icone ufficiali.
- `public/sw.js`: cache shell versionata, cleanup delle versioni precedenti, fallback `/offline`, esclusione di `POST` e `/api/` dalla cache.
- `zerow-offline / queue`: IndexedDB locale, ordering FIFO, aggregate version e payload limitato alla signal locale.
- Replay: `POST /api/events`, `x-idempotency-key`, rimozione solo dopo HTTP `2xx`, stop al primo errore e nessun successo simulato.
- Installabilità: il CTA si abilita solo su `beforeinstallprompt`; in assenza dell’evento lo stato resta `NOT OBSERVED`.
- Device boundary: iOS/Android nativi, browser/device certification, push, GPS continuo e worker esterni restano esplicitamente `NOT RUN` o `DEFERRED`.

## Capability e visibilità

| Area | Evidenza |
|---|---|
| Route | `/pwa/diagnostics` e `/mobile/diagnostics` richiedono `pwa.read`. |
| Ruoli operativi | `worker` e `driver` conservano `pwa.read`; la static verification controlla la capability. |
| Sidebar | La voce PWA appare soltanto nella navigazione calcolata dal resolver server-side. |
| Mobile nav | Bottom navigation solo per ruoli operativi e solo con link autorizzati. |
| Tenant | Identità, tenant e ruolo arrivano dalla pagina server-side; nessun valore browser decide l’accesso. |

## Verifiche locali

| Check | Esito |
|---|---|
| TypeScript | `PASS` |
| `verify:commercial` | `PASS` · 19 route guardate, W15 assertions attive |
| Lint | `PASS` · 0 errori, 5 warning `<img>` legacy preesistenti fuori da W15 |
| Build | `PASS` · route `/pwa/diagnostics` e `/mobile/diagnostics` presenti |
| Runtime device/browser | `NOT RUN` |
| Native iOS/Android | `NOT RUN` |
| Commercial certification | `NO-GO` |

## Gate aperti

1. Eseguire il test controllato install/remove/reopen su browser desktop e mobile reali.
2. Verificare offline → queue → online → replay con API/readback autentico in ambiente autorizzato.
3. Certificare viewport, touch target, safe-area, service worker lifecycle e storage eviction su dispositivi reali.
4. Decidere e implementare, con contratto separato, eventuale app nativa iOS/Android, push, camera/QR e tracking operativo.
5. Conservare il blocco di promozione commerciale finché W12/W16/provider/device e sign-off umano non sono chiusi.

**Conclusione:** W15 è pronto come superficie tecnica Sites/D1 e come contratto offline governato; non è una certificazione mobile commerciale.

## Addendum di coerenza replay — 10 ottobre 2026

Il replay della signal PWA ora usa una capability dedicata `pwa.signal`, disponibile ai ruoli che accedono a W15. L’API associa l’evento all’identità autenticata, limita il payload diagnostico e restituisce una conferma minima; la PWA elimina la voce IndexedDB soltanto dopo il readback HTTP positivo. Una signal non può impersonare un evento di dominio. La prova offline/online autenticata su device resta `NOT RUN`.
