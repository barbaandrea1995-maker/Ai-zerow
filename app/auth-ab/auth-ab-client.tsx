"use client";

import { useState } from "react";
import type {
  NeonAuthContextResult,
  NeonTenantMembership,
} from "@/lib/neon-auth/tenant-context";
import { authorityRoleLabel } from "@/lib/authority-catalog";

async function getAuthClient() {
  const { createAuthClient } = await import("@neondatabase/auth/next");
  return createAuthClient();
}

type ReadbackState = {
  status: number;
  body: unknown;
} | null;

export default function AuthAbClient({
  initialState,
}: {
  initialState: NeonAuthContextResult;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [readback, setReadback] = useState<ReadbackState>(null);

  async function signIn() {
    setBusy(true);
    setMessage(null);

    try {
      const authClient = await getAuthClient();
      const result = await authClient.signIn.email({ email, password });
      if (result.error) {
        setMessage(result.error.message ?? "auth_sign_in_failed");
        return;
      }

      window.location.reload();
    } catch {
      setMessage("auth_sign_in_failed");
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

  async function readTenant(tenantId: string) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/auth-ab/readback?tenantId=${encodeURIComponent(tenantId)}`,
        { cache: "no-store" },
      );
      setReadback({
        status: response.status,
        body: await response.json(),
      });
    } catch {
      setMessage("auth_ab_readback_failed");
    } finally {
      setBusy(false);
    }
  }

  const authenticated = initialState.status === "authenticated";

  return (
    <main className="min-h-screen bg-[#050607] px-5 py-10 font-mono text-slate-200 sm:px-10">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.24em] text-lime-300/70">
              AI-ZEROW / AUTH-AB
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-slate-50">
              Auth + tenant scope
            </h1>
            <p className="mt-2 max-w-2xl text-xs leading-6 text-slate-500">
              Gate isolato per Neon Auth: sessione verificata server-side,
              membership tenant e rifiuto cross-tenant.
            </p>
          </div>
          {/* Vinext's client prefetch is not compatible with this Site runtime. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            className="text-xs text-lime-200 underline decoration-lime-300/30 underline-offset-4"
            href="/"
          >
            Torna al command center
          </a>
        </div>

        <section className="carbon-card carbon-card-neon rounded-2xl p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.2em] text-lime-300/70">
                Stato gate
              </p>
              <p className="mt-2 text-lg font-semibold text-slate-50">
                {formatStatus(initialState)}
              </p>
            </div>
            {authenticated ? (
              <button
                className="rounded-lg border border-white/15 px-4 py-2 text-xs text-slate-200 transition hover:border-lime-300/40 hover:text-lime-100 disabled:opacity-50"
                disabled={busy}
                onClick={signOut}
                type="button"
              >
                Esci
              </button>
            ) : null}
          </div>

          {authenticated ? (
            <AuthenticatedPanel
              tenants={initialState.context.tenants}
              busy={busy}
              onRead={readTenant}
            />
          ) : (
            <form
              className="mt-6 grid max-w-xl gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                void signIn();
              }}
            >
              <label className="grid gap-2 text-xs text-slate-400">
                Email
                <input
                  className="rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-slate-100 outline-none focus:border-lime-300/50"
                  autoComplete="email"
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  type="email"
                  value={email}
                />
              </label>
              <label className="grid gap-2 text-xs text-slate-400">
                Password
                <input
                  className="rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-slate-100 outline-none focus:border-lime-300/50"
                  autoComplete="current-password"
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  type="password"
                  value={password}
                />
              </label>
              <button
                className="w-fit rounded-lg bg-lime-300 px-4 py-2 text-xs font-semibold text-black transition hover:bg-lime-200 disabled:cursor-wait disabled:opacity-50"
                disabled={busy}
                type="submit"
              >
                {busy ? "Verifica…" : "Accedi al gate"}
              </button>
            </form>
          )}

          {message ? (
            <p className="mt-5 rounded-lg border border-rose-300/20 bg-rose-300/5 px-3 py-2 text-xs text-rose-100">
              {message}
            </p>
          ) : null}
        </section>

        {readback ? (
          <section className="carbon-card mt-6 rounded-2xl p-6">
            <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">
              Readback autorizzativo
            </p>
            <pre className="mt-4 overflow-x-auto text-[11px] leading-6 text-lime-100/90">
              {JSON.stringify(readback, null, 2)}
            </pre>
          </section>
        ) : null}
      </div>
    </main>
  );
}

function AuthenticatedPanel({
  tenants,
  busy,
  onRead,
}: {
  tenants: NeonTenantMembership[];
  busy: boolean;
  onRead: (tenantId: string) => Promise<void>;
}) {
  return (
    <div className="mt-6">
      <p className="text-xs text-slate-400">
        Sessione verificata. Tenant accessibili: {tenants.length}.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {tenants.map((tenant) => (
          <article
            className="carbon-inset rounded-xl p-4"
            key={tenant.id}
          >
            <p className="text-[10px] uppercase tracking-[0.18em] text-lime-300/70">
              {tenant.slug}
            </p>
            <p className="mt-2 text-sm font-semibold text-slate-100">
              {tenant.name}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              ruolo: <span className="text-slate-300">{authorityRoleLabel(tenant.role)}</span>
            </p>
            <button
              className="mt-4 rounded-lg border border-lime-300/25 px-3 py-2 text-xs text-lime-100 transition hover:border-lime-300/60 disabled:opacity-50"
              disabled={busy}
              onClick={() => void onRead(tenant.id)}
              type="button"
            >
              Verifica scope
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}

function formatStatus(state: NeonAuthContextResult): string {
  if (state.status === "authenticated") return "AUTHENTICATED / MEMBERSHIP RESOLVED";
  if (state.status === "unauthenticated") return "READY / SIGN-IN REQUIRED";
  if (state.status === "not_configured") return "BLOCKED / CONFIGURATION REQUIRED";
  return "ERROR / CONTEXT UNAVAILABLE";
}
