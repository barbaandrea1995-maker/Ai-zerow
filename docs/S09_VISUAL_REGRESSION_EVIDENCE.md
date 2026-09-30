# S09 — Visual regression e verifica browser

Data verifica: 2026-09-30 14:03 Europe/Rome
Site: `AI-ZEROW-COMMAND`  
Versione pubblicata verificata: `v37`
URL: `https://ai-zerow-command.barba-andrea-1995.chatgpt.site`

## Esito Sites

S09 è **CLOSED · SITES BROWSER QA** nel perimetro browser Sites.

### Prove superate

- `pnpm build` completato senza errori.
- `pnpm exec tsc --noEmit` completato senza errori.
- `pnpm lint` completato senza errori (13 warning non bloccanti di immagini/navigazione interna).
- `git diff --check` pulito.
- Commit pubblicato: `d589fd5d90663097152f5ff5e338b4b6c30bec34`.
- Deployment Sites riuscita: `appgdep_6abcfb145960819197c7aab01f099b80`.
- Route verificate: `/`, `/command`, `/onboarding`, `/operations`, `/workforce`, `/warehouse`, `/mission`, `/assets`, `/documents`, `/finance`, `/procurement`, `/governance`, `/events`, `/externals`, `/offline`, `/pwa/diagnostics`, `/mobile/diagnostics`, `/qr`, `/s10/readback`.
- Ogni route ha restituito il proprio heading principale.
- Nessuna route ha restituito `404`, `Application error`, `Unhandled` o `Internal Server Error`.
- Readback S10 verificato sul deployment: `ownerOnly=true`, `status=partial` per il solo gap Auth esplicitato, progetto Neon corretto e ruolo runtime `zerow_runtime`.
- Dialogo `Nuovo lavoro` aperto e chiuso senza creare dati nel precedente giro QA; lo sweep v37 non ha introdotto regressioni applicative.
- `/pwa/diagnostics`: `Network ONLINE`, `Manifest AVAILABLE`, `Service worker ACTIVE`, coda locale vuota.
- Nessun errore console proveniente dal Site durante il giro QA; gli eventi residui provengono dall’estensione del browser.

### Confini non certificati fuori dal gate Sites

- Nessun golden screenshot storico completo disponibile per una comparazione pixel-perfect.
- Test standalone/offline su dispositivo mobile reale non eseguito.
- Camera/GPS e scanner QR/barcode non ancora certificati su dispositivo.
- Nessun golden screenshot storico completo, test standalone su dispositivo reale, camera/GPS reale o certificazione B0–B10/W20 è stato inventato o promosso da questa verifica.
- Questi sono confini della ricerca esterna originale, non attività aperte del gate Sites S09.

## Decisione di roadmap

La superficie desktop/browser e il contratto PWA del Site sono chiusi nel perimetro Sites. La certificazione di dispositivo reale/golden visuale resta `NOT_RUN` nel registro forense esterno e non viene trasferita automaticamente a S09.
