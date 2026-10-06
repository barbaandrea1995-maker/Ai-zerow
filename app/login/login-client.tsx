"use client";

import { useRouter } from "next/navigation";
import Image from "next/image";
import { FormEvent, useEffect, useState } from "react";

type LoginState = "ready" | "authenticated" | "not_configured" | "error";
type AuthMode = "signIn" | "signUp" | "forgotPassword" | "resetPassword";

function safeReturnPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  try {
    const url = new URL(value, "https://app.local");
    if (url.origin !== "https://app.local" || url.pathname === "/login") return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

async function getAuthClient() {
  const { createAuthClient } = await import("@neondatabase/auth/next");
  return createAuthClient();
}

export default function LoginClient({
  initialState,
  actor,
}: {
  initialState: LoginState;
  actor: { email: string; name: string } | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("signIn");
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    // The URL is an external input; synchronize the initial auth mode/token
    // after hydration so the public server render stays Neon-independent.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMode(query.get("mode") === "forgotPassword" ? "forgotPassword" : "signIn");
    setResetToken(query.get("token"));
    setReturnTo(safeReturnPath(query.get("return_to")));
  }, []);

  const activeMode: AuthMode = resetToken ? "resetPassword" : mode;

  async function routeAfterAuth(fallback: string) {
    if (returnTo) {
      router.push(returnTo);
      return;
    }
    try {
      const response = await fetch("/api/tenants", { cache: "no-store" });
      const payload = await response.json() as { setupRequired?: boolean };
      router.push(payload.setupRequired ? "/onboarding?mode=setup" : fallback);
    } catch {
      router.push(fallback);
    }
  }

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);

    try {
      const authClient = await getAuthClient();
      const result = await authClient.signIn.email({ email, password });
      if (result.error) {
        setMessage(result.error.message ?? "auth_sign_in_failed");
        return;
      }
      await routeAfterAuth("/command");
    } catch {
      setMessage("auth_sign_in_failed");
    } finally {
      setBusy(false);
    }
  }

  async function signUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);

    try {
      const authClient = await getAuthClient();
      const result = await authClient.signUp.email({ name, email, password });
      if (result.error) {
        setMessage(result.error.message ?? "auth_sign_up_failed");
        return;
      }
      await routeAfterAuth("/onboarding?mode=setup");
    } catch {
      setMessage("auth_sign_up_failed");
    } finally {
      setBusy(false);
    }
  }

  async function requestPasswordReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);

    try {
      const authClient = await getAuthClient();
      const result = await authClient.requestPasswordReset({
        email,
        redirectTo: `${window.location.origin}/login`,
      });
      if (result.error) {
        setMessage(result.error.message ?? "auth_password_reset_request_failed");
        return;
      }
      setMode("signIn");
      setMessage("Se l’account esiste, riceverai il link per impostare la password.");
    } catch {
      setMessage("auth_password_reset_request_failed");
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resetToken) {
      setMessage("Link di reset non valido o scaduto.");
      return;
    }
    if (password !== confirmPassword) {
      setMessage("Le password non coincidono.");
      return;
    }

    setBusy(true);
    setMessage(null);

    try {
      const authClient = await getAuthClient();
      const result = await authClient.resetPassword({
        newPassword: password,
        token: resetToken,
      });
      if (result.error) {
        setMessage(result.error.message ?? "auth_password_reset_failed");
        return;
      }
      setPassword("");
      setConfirmPassword("");
      router.replace("/login");
    } catch {
      setMessage("auth_password_reset_failed");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    setMessage(null);
    try {
      const authClient = await getAuthClient();
      await authClient.signOut();
      window.location.reload();
    } catch {
      setMessage("auth_sign_out_failed");
    } finally {
      setBusy(false);
    }
  }

  const title = activeMode === "signIn"
    ? "Rientra nel controllo operativo"
    : activeMode === "signUp"
      ? "Crea il tuo accesso"
      : activeMode === "forgotPassword"
        ? "Recupera l’accesso"
        : "Imposta una nuova password";

  return (
    <main className="login-surface min-h-screen px-5 py-8 text-slate-100 sm:px-8 lg:px-12">
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] w-full max-w-6xl items-center gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(390px,0.72fr)] lg:gap-16">
        <section className="login-rail hidden lg:block" aria-labelledby="login-rail-title">
          <div className="flex items-center gap-4">
            <span className="neon-pulse grid size-14 place-items-center overflow-hidden rounded-2xl border border-lime-300/45 bg-black shadow-[0_0_30px_rgba(190,255,60,0.12)]">
              <Image src="/ai-zerow-icon.jpeg" alt="AI-ZEROW" width={56} height={56} className="size-full object-cover" />
            </span>
            <div>
              <p className="text-sm font-bold tracking-[0.22em] text-slate-50">AI-ZEROW</p>
              <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-lime-300/70">centrale operativa</p>
            </div>
          </div>
          <p className="mt-16 text-[11px] font-semibold uppercase tracking-[0.24em] text-lime-300/70">ACCESSO AZIENDALE</p>
          <h2 id="login-rail-title" className="mt-4 max-w-xl text-5xl font-semibold leading-[1.02] tracking-[-0.06em] text-slate-50 xl:text-6xl">Una sola soglia per ogni decisione operativa.</h2>
          <p className="mt-6 max-w-lg text-base leading-7 text-slate-400">Accedi alla tua centrale operativa e ritrova lavori, asset e persone nello stesso spazio aziendale. Ogni accesso segue il ruolo e le responsabilità assegnate.</p>
          <div className="mt-10 grid max-w-lg grid-cols-3 gap-3">
            {[
              ["DATI", "stato verificato"],
              ["ACCESSI", "ruoli verificati"],
              ["DATI REALI", "nessun segnaposto"],
            ].map(([label, detail]) => <div className="carbon-inset rounded-xl p-3" key={label}><p className="font-mono text-xs font-semibold text-lime-200">{label}</p><p className="mt-2 text-[11px] leading-4 text-slate-500">{detail}</p></div>)}
          </div>
        </section>

        <section className="login-card carbon-card w-full rounded-2xl border border-lime-300/20 p-6 shadow-[0_0_52px_rgba(190,255,60,0.08)] sm:p-8" aria-labelledby="login-title">
          <div className="flex items-center gap-3 lg:hidden">
            <span className="neon-pulse grid size-11 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black"><Image src="/ai-zerow-icon.jpeg" alt="AI-ZEROW" width={44} height={44} className="size-full object-cover" /></span>
            <div><p className="text-sm font-bold tracking-[0.18em] text-slate-50">AI-ZEROW</p><p className="text-[10px] uppercase tracking-[0.2em] text-lime-300/70">centrale / accesso</p></div>
          </div>
          <p className="mt-7 text-[10px] font-semibold uppercase tracking-[0.22em] text-lime-300/70 lg:mt-0">AI-ZEROW / ACCESSO</p>
          <h1 id="login-title" className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-slate-50">{title}</h1>
          <p className="mt-3 text-sm leading-6 text-slate-400">Accedi per entrare nello spazio aziendale. Il sistema applica automaticamente ruoli, responsabilità e permessi.</p>

          {initialState === "authenticated" && actor ? (
            <div className="mt-7 space-y-4">
              <div className="rounded-xl border border-lime-300/15 bg-lime-300/5 p-4 text-sm" role="status">
                <p className="text-lime-100">Sessione attiva</p>
                <p className="mt-1 text-slate-300">{actor.name || actor.email}</p>
                <p className="mt-1 text-xs text-slate-500">{actor.email}</p>
              </div>
              <div className="flex flex-wrap gap-3">
                <a className="rounded-lg bg-lime-300 px-4 py-2.5 text-sm font-semibold text-[#060806] hover:bg-lime-200" href="/command">Apri command</a>
                <button className="rounded-lg border border-white/15 px-4 py-2.5 text-sm text-slate-300 hover:border-lime-300/40 hover:text-lime-100 disabled:opacity-50" disabled={busy} onClick={() => void signOut()} type="button">Esci</button>
              </div>
            </div>
          ) : initialState === "not_configured" ? (
            <p className="mt-7 rounded-xl border border-amber-300/20 bg-amber-300/5 p-4 text-sm leading-6 text-amber-100" role="alert">Neon Auth non è configurato per questo ambiente.</p>
          ) : initialState === "error" ? (
            <p className="mt-7 rounded-xl border border-rose-300/20 bg-rose-300/5 p-4 text-sm leading-6 text-rose-100" role="alert">Servizio Auth temporaneamente non disponibile.</p>
          ) : (
            <form className="mt-7 grid gap-4" onSubmit={(event) => void (activeMode === "signIn" ? signIn(event) : activeMode === "signUp" ? signUp(event) : activeMode === "forgotPassword" ? requestPasswordReset(event) : resetPassword(event))}>
              {activeMode === "signUp" ? (
                <label className="grid gap-2 text-sm text-slate-300" htmlFor="auth-name">
                  <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Nome</span>
                  <input id="auth-name" className="rounded-lg border border-white/10 bg-black/25 px-3 py-3 text-base text-slate-100 outline-none transition focus:border-lime-300/50 focus:ring-2 focus:ring-lime-300/10" autoComplete="name" onChange={(event) => setName(event.target.value)} required type="text" value={name} />
                </label>
              ) : null}
              {activeMode !== "resetPassword" ? (
                <label className="grid gap-2 text-sm text-slate-300" htmlFor="auth-email">
                  <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Email</span>
                  <input id="auth-email" className="rounded-lg border border-white/10 bg-black/25 px-3 py-3 text-base text-slate-100 outline-none transition focus:border-lime-300/50 focus:ring-2 focus:ring-lime-300/10" autoComplete="email" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} />
                </label>
              ) : null}
              {activeMode !== "forgotPassword" ? (
                <label className="grid gap-2 text-sm text-slate-300" htmlFor="auth-password">
                  <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{activeMode === "resetPassword" ? "Nuova password" : "Password"}</span>
                  <input id="auth-password" className="rounded-lg border border-white/10 bg-black/25 px-3 py-3 text-base text-slate-100 outline-none transition focus:border-lime-300/50 focus:ring-2 focus:ring-lime-300/10" autoComplete={activeMode === "resetPassword" ? "new-password" : "current-password"} minLength={8} onChange={(event) => setPassword(event.target.value)} required type="password" value={password} />
                </label>
              ) : null}
              {activeMode === "resetPassword" ? (
                <label className="grid gap-2 text-sm text-slate-300" htmlFor="auth-confirm-password">
                  <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Conferma password</span>
                  <input id="auth-confirm-password" className="rounded-lg border border-white/10 bg-black/25 px-3 py-3 text-base text-slate-100 outline-none transition focus:border-lime-300/50 focus:ring-2 focus:ring-lime-300/10" autoComplete="new-password" minLength={8} onChange={(event) => setConfirmPassword(event.target.value)} required type="password" value={confirmPassword} />
                </label>
              ) : null}
              <button className="mt-2 rounded-lg bg-lime-300 px-4 py-3 text-sm font-semibold text-[#060806] transition hover:bg-lime-200 disabled:cursor-wait disabled:opacity-50" disabled={busy} type="submit">{busy ? "Attendi…" : activeMode === "signIn" ? "Accedi" : activeMode === "signUp" ? "Crea account" : activeMode === "forgotPassword" ? "Invia link" : "Imposta password"}</button>
            </form>
          )}

          {initialState !== "authenticated" && initialState !== "not_configured" && activeMode !== "resetPassword" && (
            <div className="mt-6 flex flex-wrap gap-x-4 gap-y-3 text-sm">
              {activeMode === "signIn" ? (
                <button className="text-lime-200 underline decoration-lime-300/30 underline-offset-4" onClick={() => { setMode("forgotPassword"); setMessage(null); }} type="button">Password dimenticata?</button>
              ) : null}
              <button className="text-lime-200 underline decoration-lime-300/30 underline-offset-4" onClick={() => { setMode(mode === "signIn" || mode === "forgotPassword" ? "signUp" : "signIn"); setMessage(null); }} type="button">
                {mode === "signIn" || mode === "forgotPassword" ? "Non hai ancora un accesso? Crealo" : "Hai già un accesso? Accedi"}
              </button>
            </div>
          )}

          {message ? <p className="mt-5 rounded-lg border border-rose-300/20 bg-rose-300/5 px-3 py-3 text-sm leading-5 text-rose-100" role="alert" aria-live="polite">{message}</p> : null}
          <div className="mt-8 border-t border-white/10 pt-4">
            <p className="text-xs leading-5 text-slate-500">Dopo il login vedrai soltanto le aziende e le funzioni abilitate per il tuo profilo.</p>
            <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-slate-700">accesso protetto · dati aziendali separati</p>
          </div>
        </section>
      </div>
    </main>
  );
}
