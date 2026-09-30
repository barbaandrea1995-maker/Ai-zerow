"use client";

import { createAuthClient } from "@neondatabase/auth/next";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

type LoginState = "ready" | "authenticated" | "not_configured" | "error";
type AuthMode = "signIn" | "signUp" | "forgotPassword" | "resetPassword";

function getAuthClient() {
  return createAuthClient();
}

export default function LoginClient({
  initialState,
  actor,
  initialMode,
  resetToken,
}: {
  initialState: LoginState;
  actor: { email: string; name: string } | null;
  initialMode: AuthMode;
  resetToken: string | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const activeMode: AuthMode = resetToken ? "resetPassword" : mode;

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);

    try {
      const authClient = getAuthClient();
      const result = await authClient.signIn.email({ email, password });
      if (result.error) {
        setMessage(result.error.message ?? "auth_sign_in_failed");
        return;
      }
      router.push("/command");
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
      const authClient = getAuthClient();
      const result = await authClient.signUp.email({ name, email, password });
      if (result.error) {
        setMessage(result.error.message ?? "auth_sign_up_failed");
        return;
      }
      router.push("/tenants");
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
      const authClient = getAuthClient();
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
      const authClient = getAuthClient();
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
      const authClient = getAuthClient();
      await authClient.signOut();
      window.location.reload();
    } catch {
      setMessage("auth_sign_out_failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#040505] px-5 py-10 text-slate-100">
      <section className="w-full max-w-md rounded-2xl border border-lime-300/20 bg-black/30 p-6 shadow-[0_0_40px_rgba(190,255,60,0.06)] sm:p-8">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-lime-300/70">AI-ZEROW / PWA AUTH</p>
          <h1 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-slate-50">{activeMode === "signIn" ? "Accedi al command center" : activeMode === "signUp" ? "Crea accesso Neon" : activeMode === "forgotPassword" ? "Recupera accesso" : "Imposta nuova password"}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">Neon Auth gestisce la sessione. Tenant, ruolo e capability vengono verificati dal server tramite Cloudflare D1.</p>

        {initialState === "authenticated" && actor ? (
          <div className="mt-6 space-y-4">
            <div className="rounded-xl border border-lime-300/15 bg-lime-300/5 p-4 text-sm">
              <p className="text-lime-100">Sessione attiva</p>
              <p className="mt-1 text-slate-400">{actor.name || actor.email}</p>
              <p className="mt-1 text-xs text-slate-600">{actor.email}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <a className="rounded-lg bg-lime-300 px-4 py-2 text-sm font-semibold text-[#060806] hover:bg-lime-200" href="/command">Apri command</a>
              <button className="rounded-lg border border-white/15 px-4 py-2 text-sm text-slate-300 hover:border-lime-300/40 hover:text-lime-100 disabled:opacity-50" disabled={busy} onClick={() => void signOut()} type="button">Esci</button>
            </div>
          </div>
        ) : initialState === "not_configured" ? (
          <p className="mt-6 rounded-xl border border-amber-300/20 bg-amber-300/5 p-4 text-sm text-amber-100">Neon Auth non è configurato per questo ambiente.</p>
        ) : initialState === "error" ? (
          <p className="mt-6 rounded-xl border border-rose-300/20 bg-rose-300/5 p-4 text-sm text-rose-100">Servizio Auth temporaneamente non disponibile.</p>
        ) : (
          <form className="mt-6 grid gap-4" onSubmit={(event) => void (activeMode === "signIn" ? signIn(event) : activeMode === "signUp" ? signUp(event) : activeMode === "forgotPassword" ? requestPasswordReset(event) : resetPassword(event))}>
            {activeMode === "signUp" ? (
              <label className="grid gap-2 text-sm text-slate-400">
                Nome
                <input className="rounded-lg border border-white/10 bg-black/25 px-3 py-2.5 text-base text-slate-100 outline-none focus:border-lime-300/50" autoComplete="name" onChange={(event) => setName(event.target.value)} required type="text" value={name} />
              </label>
            ) : null}
            {activeMode !== "resetPassword" ? (
              <label className="grid gap-2 text-sm text-slate-400">
                Email
                <input className="rounded-lg border border-white/10 bg-black/25 px-3 py-2.5 text-base text-slate-100 outline-none focus:border-lime-300/50" autoComplete="email" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} />
              </label>
            ) : null}
            {activeMode !== "forgotPassword" ? (
              <label className="grid gap-2 text-sm text-slate-400">
                {activeMode === "resetPassword" ? "Nuova password" : "Password"}
                <input className="rounded-lg border border-white/10 bg-black/25 px-3 py-2.5 text-base text-slate-100 outline-none focus:border-lime-300/50" autoComplete={activeMode === "resetPassword" ? "new-password" : "current-password"} minLength={8} onChange={(event) => setPassword(event.target.value)} required type="password" value={password} />
              </label>
            ) : null}
            {activeMode === "resetPassword" ? (
              <label className="grid gap-2 text-sm text-slate-400">
                Conferma password
                <input className="rounded-lg border border-white/10 bg-black/25 px-3 py-2.5 text-base text-slate-100 outline-none focus:border-lime-300/50" autoComplete="new-password" minLength={8} onChange={(event) => setConfirmPassword(event.target.value)} required type="password" value={confirmPassword} />
              </label>
            ) : null}
            <button className="mt-2 rounded-lg bg-lime-300 px-4 py-2.5 text-sm font-semibold text-[#060806] hover:bg-lime-200 disabled:cursor-wait disabled:opacity-50" disabled={busy} type="submit">{busy ? "Attendi…" : activeMode === "signIn" ? "Accedi" : activeMode === "signUp" ? "Crea account" : activeMode === "forgotPassword" ? "Invia link" : "Imposta password"}</button>
          </form>
        )}

        {initialState !== "authenticated" && initialState !== "not_configured" && activeMode !== "resetPassword" && (
          <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2 text-xs">
            {activeMode === "signIn" ? (
              <button className="text-lime-200 underline decoration-lime-300/30 underline-offset-4" onClick={() => { setMode("forgotPassword"); setMessage(null); }} type="button">Password dimenticata?</button>
            ) : null}
            <button className="text-lime-200 underline decoration-lime-300/30 underline-offset-4" onClick={() => { setMode(mode === "signIn" || mode === "forgotPassword" ? "signUp" : "signIn"); setMessage(null); }} type="button">
              {mode === "signIn" || mode === "forgotPassword" ? "Non hai ancora un accesso Neon? Crealo" : "Hai già un accesso? Accedi"}
            </button>
          </div>
        )}

        {message ? <p className="mt-5 rounded-lg border border-rose-300/20 bg-rose-300/5 px-3 py-2 text-xs text-rose-100">{message}</p> : null}
        <p className="mt-8 text-xs leading-5 text-slate-600">Dopo il login l’accesso ai tenant viene deciso esclusivamente dalla membership D1.</p>
      </section>
    </main>
  );
}
