"use client";

import Image from "next/image";
import Link from "@/components/app-link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, KeyRound, LogOut, Mail, RefreshCw, ShieldCheck, UserRound } from "lucide-react";
import { AccountMenu, type AccountActor } from "@/components/account-menu";
import { CommandMobileNav } from "@/components/command-mobile-nav";
import GpsProviderControl from "@/components/gps-provider-control";
import type { CommandNavigationId } from "@/lib/command-dashboard";

async function getAuthClient() {
  const { createAuthClient } = await import("@neondatabase/auth/next");
  return createAuthClient();
}

export default function SettingsClient({ actor, canManageLocation, allowedNavigation, role, roles }: {
  actor: AccountActor;
  canManageLocation: boolean;
  allowedNavigation: CommandNavigationId[];
  role: string;
  roles: string[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"password" | "signOut" | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");

  async function requestPasswordReset() {
    setBusy("password");
    setMessage(null);

    try {
      const authClient = await getAuthClient();
      const result = await authClient.requestPasswordReset({
        email: actor.email,
        redirectTo: `${window.location.origin}/login`,
      });

      if (result.error) {
        setMessageTone("error");
        setMessage(result.error.message ?? "Impossibile inviare il link di reset.");
        return;
      }

      setMessageTone("success");
      setMessage("Link inviato. Controlla la posta per impostare una nuova password.");
    } catch {
      setMessageTone("error");
      setMessage("Impossibile inviare il link di reset. Riprova.");
    } finally {
      setBusy(null);
    }
  }

  async function signOut() {
    setBusy("signOut");
    setMessage(null);

    try {
      const authClient = await getAuthClient();
      await authClient.signOut();
      router.replace("/login");
    } catch {
      setBusy(null);
      setMessageTone("error");
      setMessage("Uscita non disponibile. Riprova.");
    }
  }

  function refreshSettings() {
    setRefreshing(true);
    router.refresh();
    window.setTimeout(() => setRefreshing(false), 600);
  }

  return (
    <main className="zw-app-shell zw-command-ultra min-h-screen overflow-x-hidden text-slate-100 selection:bg-lime-300 selection:text-[#060806]">
      <div className="zw-command-ambient" aria-hidden="true" />
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_74%_0%,rgba(190,255,60,0.08),transparent_25%),radial-gradient(circle_at_18%_78%,rgba(70,110,120,0.08),transparent_27%)]" />
      <div className="relative mx-auto max-w-6xl px-4 py-5 sm:px-7 sm:py-8">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.08] pb-5">
          <div className="flex items-center gap-3">
            <Link
              aria-label="Torna al command center"
              className="grid size-10 place-items-center rounded-xl border border-white/10 bg-black/30 text-slate-500 transition hover:border-lime-300/30 hover:text-lime-200"
              href="/command"
            >
              <ArrowLeft className="size-4" />
            </Link>
            <span className="relative grid size-10 place-items-center overflow-hidden rounded-xl border border-lime-300/40 bg-black shadow-[0_0_22px_rgba(200,255,34,.12)]">
              <Image src="/ai-zerow-icon.jpeg" alt="AI-ZEROW" width={40} height={40} className="size-full object-cover" />
            </span>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-lime-300/70">
                AI-ZEROW / ACCOUNT
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-slate-50 sm:text-3xl">
                Impostazioni account
              </h1>
              <p className="mt-1 text-xs text-slate-500">
                Profilo, sicurezza e sessione gestiti da Neon Auth.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              aria-label="Aggiorna impostazioni"
              className="grid size-10 place-items-center rounded-xl border border-white/10 bg-black/30 text-slate-500 transition hover:border-lime-300/30 hover:text-lime-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300/60"
              onClick={refreshSettings}
              type="button"
            >
              <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
            </button>
            <AccountMenu actor={actor} />
          </div>
        </header>

        {canManageLocation ? <div className="mt-6"><GpsProviderControl /></div> : null}

        <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
          <section className="carbon-card rounded-2xl p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-lime-300/25 bg-lime-300/10 text-lime-200">
                <UserRound className="size-5" />
              </span>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-lime-300/70">
                  Profilo
                </p>
                <h2 className="mt-1 text-base font-semibold text-slate-50">Dati account</h2>
                <p className="mt-1 text-[11px] leading-5 text-slate-500">
                  Identità corrente verificata server-side prima dell’apertura del modulo.
                </p>
              </div>
            </div>
            <dl className="mt-6 grid gap-3 sm:grid-cols-2">
              <div className="carbon-inset rounded-xl p-4">
                <dt className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                  <UserRound className="size-3.5 text-lime-300" /> Nome
                </dt>
                <dd className="mt-2 truncate text-sm text-slate-100">{actor.name || "Non impostato"}</dd>
              </div>
              <div className="carbon-inset rounded-xl p-4">
                <dt className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                  <Mail className="size-3.5 text-cyan-200" /> Email
                </dt>
                <dd className="mt-2 truncate text-sm text-slate-100">{actor.email}</dd>
              </div>
            </dl>
            <p className="mt-4 text-[10px] leading-5 text-slate-600">
              Nome ed email sono mostrati dalla sessione Neon Auth attiva; nessun dato sensibile viene salvato nel browser.
            </p>
          </section>

          <section className="carbon-card carbon-card-neon rounded-2xl p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-lime-300/25 bg-lime-300/10 text-lime-200">
                <ShieldCheck className="size-5" />
              </span>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-lime-300/70">Sessione</p>
                <h2 className="mt-1 text-base font-semibold text-slate-50">Neon Auth attivo</h2>
                <p className="mt-1 text-[11px] leading-5 text-slate-500">
                  La sessione protegge Command, tenant e moduli operativi.
                </p>
              </div>
            </div>
            <div className="mt-6 flex items-center gap-3 rounded-xl border border-lime-300/20 bg-lime-300/[0.06] p-4">
              <span className="size-2 rounded-full bg-lime-300 shadow-[0_0_10px_rgba(190,255,60,0.9)]" />
              <div>
                <p className="text-xs font-medium text-lime-100">Sessione verificata</p>
                <p className="mt-1 text-[10px] text-slate-500">Accesso personale · tenant scope separato</p>
              </div>
            </div>
            <div className="mt-5 space-y-2 text-[11px] text-slate-500">
              <div className="flex items-center justify-between border-b border-white/[0.08] pb-2">
                <span>Provider</span>
                <span className="text-slate-200">Neon Auth</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Password</span>
                <span className="text-lime-200">Protetta</span>
              </div>
            </div>
          </section>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <section className="carbon-card rounded-2xl p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-amber-300/25 bg-amber-300/10 text-amber-200">
                <KeyRound className="size-5" />
              </span>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-200/70">Sicurezza</p>
                <h2 className="mt-1 text-base font-semibold text-slate-50">Password</h2>
                <p className="mt-1 text-[11px] leading-5 text-slate-500">
                  Invia un link personale per impostare una nuova password senza esporre credenziali.
                </p>
              </div>
            </div>
            <button
              className="mt-6 inline-flex items-center gap-2 rounded-lg bg-lime-300 px-4 py-2.5 text-xs font-semibold text-[#060806] transition hover:bg-lime-200 disabled:cursor-wait disabled:opacity-50"
              disabled={busy !== null}
              onClick={() => void requestPasswordReset()}
              type="button"
            >
              <KeyRound className="size-3.5" />
              {busy === "password" ? "Invio in corso…" : "Invia link di reset"}
            </button>
          </section>

          <section className="carbon-card rounded-2xl border-rose-300/15 p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-rose-300/25 bg-rose-300/10 text-rose-200">
                <LogOut className="size-5" />
              </span>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-rose-200/70">Sessione</p>
                <h2 className="mt-1 text-base font-semibold text-slate-50">Esci dall’account</h2>
                <p className="mt-1 text-[11px] leading-5 text-slate-500">
                  Chiude la sessione Neon Auth e riporta al login della PWA.
                </p>
              </div>
            </div>
            <button
              className="mt-6 inline-flex items-center gap-2 rounded-lg border border-rose-300/25 bg-rose-300/5 px-4 py-2.5 text-xs font-semibold text-rose-100 transition hover:bg-rose-300/10 disabled:cursor-wait disabled:opacity-50"
              disabled={busy !== null}
              onClick={() => void signOut()}
              type="button"
            >
              <LogOut className="size-3.5" />
              {busy === "signOut" ? "Uscita…" : "Esci"}
            </button>
          </section>
        </div>

        {message ? (
          <p
            className={`mt-4 rounded-xl border px-4 py-3 text-xs ${messageTone === "success" ? "border-lime-300/20 bg-lime-300/5 text-lime-100" : "border-rose-300/20 bg-rose-300/5 text-rose-100"}`}
            role={messageTone === "error" ? "alert" : "status"}
          >
            {message}
          </p>
        ) : null}

        <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] py-5 text-[10px] text-slate-600">
          <Link className="text-slate-500 transition hover:text-lime-200" href="/command">Torna al command center</Link>
          <span className="flex items-center gap-2">
            <span>account control</span>
            <span className="size-1 rounded-full bg-lime-300" />
            <span>no secrets exported</span>
          </span>
        </footer>
      </div>
      <CommandMobileNav active="settings" allowedNavigation={allowedNavigation} role={role} roles={roles} />
    </main>
  );
}
