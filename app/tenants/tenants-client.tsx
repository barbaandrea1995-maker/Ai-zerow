"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Building2, CheckCircle2, Database, RefreshCw, ShieldCheck } from "lucide-react";

type Tenant = {
  id: string;
  slug: string;
  name: string;
  status: string;
  membershipId: string;
  role: string;
  membershipStatus: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

type ApiResponse = {
  provisioned?: boolean;
  created?: boolean;
  tenants?: Tenant[];
  error?: string;
};

export default function TenantsClient({ actor }: { actor: { displayName: string; email: string } }) {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("Provisioning D1 in corso…");

  async function load(autoProvision = false) {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/tenants", { cache: "no-store" });
      const data = (await response.json()) as ApiResponse;
      if (!response.ok) throw new Error(data.error ?? "tenant_directory_unavailable");
      const rows = data.tenants ?? [];
      setTenants(rows);
      if (rows.length > 0) {
        setMessage("Tenant e membership verificati in D1");
      } else if (autoProvision) {
        await provision();
      } else {
        setMessage("Nessun tenant provisionato");
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "tenant_directory_unavailable");
      setMessage("Readback non disponibile");
    } finally {
      setLoading(false);
    }
  }

  async function provision() {
    setBusy(true);
    setError(null);
    setMessage("Creo EMS e la membership owner…");
    try {
      const response = await fetch("/api/tenants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "EMS EDILIZIA MULTISERVIZI SRLS",
          slug: "ems-edilizia-multiservizi",
        }),
      });
      const data = (await response.json()) as ApiResponse;
      if (!response.ok) throw new Error(data.error ?? "tenant_provisioning_failed");
      setTenants(data.tenants ?? []);
      setMessage(data.created ? "EMS provisionato in D1" : "EMS già provisionato: readback confermato");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "tenant_provisioning_failed");
      setMessage("Provisioning fallito");
    } finally {
      setBusy(false);
      setLoading(false);
    }
  }

  useEffect(() => {
    // This effect intentionally starts the authenticated readback/provisioning request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(true);
    // The first authenticated owner visit is the explicit D1 provisioning action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="min-h-screen bg-[#040505] text-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-7 sm:py-8">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.08] pb-5">
          <div className="flex items-center gap-3">
            <a className="grid size-9 place-items-center rounded-lg border border-white/10 text-slate-500 hover:border-lime-300/30 hover:text-lime-200" href="/command" aria-label="Torna a command">
              <ArrowLeft className="size-4" />
            </a>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/70">AI-ZEROW / CLOUD CONTROL</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-slate-50">Tenant directory</h1>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-200">{actor.displayName}</p>
            <p className="mt-1 text-[10px] text-slate-600">{actor.email}</p>
          </div>
        </header>

        <section className="mt-6 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="carbon-card carbon-card-neon rounded-2xl p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <span className="grid size-10 place-items-center rounded-xl border border-lime-300/25 bg-lime-300/10 text-lime-200"><Building2 className="size-5" /></span>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-lime-300/70">D1 / PRIMARY TENANT</p>
                <h2 className="mt-1 text-lg font-semibold text-slate-50">EMS EDILIZIA MULTISERVIZI SRLS</h2>
                <p className="mt-2 max-w-xl text-xs leading-5 text-slate-500">Il tenant usa il confine Sites esistente, quindi i read-model S04–S07 restano nello stesso perimetro. La membership è attribuita server-side all’identità owner corrente.</p>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-lime-300/20 bg-lime-300/5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-lime-200"><span className="size-1.5 rounded-full bg-lime-300" />{loading ? "CHECKING" : tenants.length > 0 ? "PROVISIONED" : "PENDING"}</span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-300/15 bg-cyan-300/5 px-3 py-1.5 text-[10px] uppercase tracking-[0.1em] text-cyan-200"><Database className="size-3" />Cloudflare D1</span>
              <button className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-[10px] text-slate-400 hover:border-lime-300/30 hover:text-lime-200" onClick={() => void load(false)} type="button"><RefreshCw className="size-3.5" />Aggiorna</button>
            </div>
          </div>

          <div className="carbon-card rounded-2xl p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <span className="grid size-10 place-items-center rounded-xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-200"><ShieldCheck className="size-5" /></span>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200/70">SERVER AUTHORITY</p>
                <h2 className="mt-1 text-base font-semibold text-slate-50">Membership governata</h2>
                <p className="mt-2 text-xs leading-5 text-slate-500">Tenant, actor, ruolo e creator non sono accettati dal browser: vengono ricostruiti dal contesto autenticato Sites.</p>
              </div>
            </div>
            <div className="mt-5 rounded-xl border border-white/[0.08] bg-black/20 p-3 text-[11px] text-slate-500">
              <div className="flex items-center justify-between gap-3"><span>Stato</span><span className="font-mono text-lime-200">{message}</span></div>
              {error && <p className="mt-2 font-mono text-[10px] text-amber-200">{error}</p>}
            </div>
          </div>
        </section>

        <section className="mt-4 rounded-2xl border border-white/[0.08] bg-black/20 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-600">D1 READBACK</p><h2 className="mt-1 text-base font-semibold text-slate-50">Membership attive</h2></div>
            {!loading && tenants.length === 0 && <button className="rounded-lg bg-lime-300 px-3 py-2 text-[10px] font-semibold text-[#060806] hover:bg-lime-200" disabled={busy} onClick={() => void provision()} type="button">{busy ? "Provisioning…" : "Provisiona EMS"}</button>}
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {tenants.map((tenant) => <article className="carbon-inset rounded-xl p-4" key={tenant.membershipId}><div className="flex items-start gap-3"><span className="grid size-9 place-items-center rounded-lg border border-lime-300/20 bg-lime-300/10 text-lime-200"><CheckCircle2 className="size-4" /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-100">{tenant.name}</p><p className="mt-1 font-mono text-[10px] text-cyan-200/80">{tenant.slug}</p></div><span className="font-mono text-[9px] uppercase text-lime-200">{tenant.role}</span></div><div className="mt-4 grid gap-2 text-[10px] text-slate-500 sm:grid-cols-2"><div><span className="block uppercase tracking-[0.12em] text-slate-700">Tenant ID</span><span className="mt-1 block truncate font-mono text-slate-400">{tenant.id}</span></div><div><span className="block uppercase tracking-[0.12em] text-slate-700">Membership</span><span className="mt-1 block truncate font-mono text-slate-400">{tenant.membershipId}</span></div></div></article>)}
            {loading && <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-xs text-slate-500">Lettura directory…</div>}
            {!loading && tenants.length === 0 && !error && <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-xs text-slate-500 md:col-span-2">Nessuna membership trovata. Il provisioning iniziale verrà eseguito automaticamente.</div>}
            {!loading && error && <div className="rounded-xl border border-amber-300/20 bg-amber-300/5 p-6 text-center text-xs text-amber-100/80 md:col-span-2">{error}</div>}
          </div>
        </section>

        <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] py-5 text-[10px] text-slate-600"><span>AI-ZEROW COMMAND · CLOUDFLARE/D1</span><span>Neon resta adapter certificato, non control plane</span></footer>
      </div>
    </main>
  );
}
