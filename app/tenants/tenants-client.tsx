"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Building2, CheckCircle2, Database, KeyRound, Plus, RefreshCw, SlidersHorizontal } from "lucide-react";
import { OPERATING_PROFILE_CATALOG, type OperatingProfileId } from "@/lib/tenant-operating-model";
import { authorityRoleLabel } from "@/lib/authority-catalog";

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
  operatingProfile: string;
  operatingDomains: string[];
};

type ApiResponse = { provisioned?: boolean; created?: boolean; tenants?: Tenant[]; selectedTenant?: Tenant; error?: string };
type NeonLinkResponse = { ok?: boolean; created?: boolean; linked?: boolean; error?: string; membership?: { tenantId: string; role: string } | null };

const profileOptions = Object.entries(OPERATING_PROFILE_CATALOG) as [OperatingProfileId, (typeof OPERATING_PROFILE_CATALOG)[OperatingProfileId]][];

function slugify(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

export default function TenantsClient({ actor }: { actor: { displayName: string; email: string } }) {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("Leggo le aziende autorizzate…");
  const [neonLinkBusy, setNeonLinkBusy] = useState(false);
  const [neonLinkMessage, setNeonLinkMessage] = useState("Collega la sessione Neon solo quando devi abilitarla su un tenant.");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [profile, setProfile] = useState<OperatingProfileId>("FULL_OPERATIONS");

  const selectedTenant = useMemo(() => tenants.find((tenant) => tenant.id === selectedTenantId) ?? tenants[0] ?? null, [selectedTenantId, tenants]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/tenants", { cache: "no-store" });
      const data = await response.json() as ApiResponse;
      if (!response.ok) throw new Error(data.error ?? "tenant_directory_unavailable");
      const rows = data.tenants ?? [];
      setTenants(rows);
      setSelectedTenantId(rows[0]?.id ?? "");
      setMessage(rows.length ? `${rows.length} azienda/e autorizzata/e · directory D1 verificata` : "Nessuna azienda: configura il primo tenant");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "tenant_directory_unavailable");
      setMessage("Readback non disponibile");
    } finally {
      setLoading(false);
    }
  }

  async function createTenant() {
    const cleanName = name.trim();
    const cleanSlug = (slug.trim() || slugify(cleanName)).toLowerCase();
    if (cleanName.length < 2 || !cleanSlug) {
      setError("Inserisci ragione sociale e slug aziendale.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage("Creo azienda, perimetro operativo e appartenenza del titolare…");
    try {
      const response = await fetch("/api/tenants", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: cleanName, slug: cleanSlug, operatingProfile: profile }) });
      const data = await response.json() as ApiResponse;
      if (!response.ok) throw new Error(data.error ?? "tenant_provisioning_failed");
      const rows = data.tenants ?? [];
      setTenants(rows);
      setSelectedTenantId(rows.find((tenant) => tenant.slug === cleanSlug)?.id ?? rows[0]?.id ?? "");
      setName("");
      setSlug("");
      setMessage(data.created ? "Azienda creata e perimetro operativo salvato." : "Directory aggiornata.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "tenant_provisioning_failed");
      setMessage("Creazione non completata");
    } finally {
      setBusy(false);
    }
  }

  async function selectTenant(tenantId: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/tenants", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId }) });
      const data = await response.json() as ApiResponse;
      if (!response.ok) throw new Error(data.error ?? "cross_tenant_access_denied");
      setSelectedTenantId(tenantId);
      setMessage(`Contesto attivo: ${data.selectedTenant?.name ?? tenantId}`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "cross_tenant_access_denied");
    } finally {
      setBusy(false);
    }
  }

  async function linkNeonIdentity() {
    if (!selectedTenant) return;
    setNeonLinkBusy(true);
    setNeonLinkMessage("Verifico il perimetro del titolare Sites e la sessione Neon…");
    try {
      const response = await fetch("/api/auth/neon-membership", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId: selectedTenant.id }) });
      const data = await response.json() as NeonLinkResponse;
      if (!response.ok) {
        setNeonLinkMessage(data.error === "neon_identity_required" ? "Sessione Neon assente: accedi con Neon e torna qui." : data.error ?? "Collegamento Neon non riuscito");
        return;
      }
      setNeonLinkMessage(data.created ? `Identità Neon collegata come ${authorityRoleLabel(data.membership?.role ?? "owner")}.` : "Identità Neon già collegata: readback confermato.");
    } catch {
      setNeonLinkMessage("Servizio di collegamento temporaneamente non disponibile.");
    } finally {
      setNeonLinkBusy(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, []);

  return <main className="zw-app-shell zw-command-ultra min-h-screen bg-[#040505] text-slate-100"><div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_82%_0%,rgba(200,255,34,.08),transparent_30%),linear-gradient(145deg,#020403,#071008_48%,#030504)]" /><div className="relative mx-auto max-w-7xl px-4 py-5 sm:px-7 sm:py-8">
    <header className="zw-module-local-header flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.08] pb-5"><div className="flex items-center gap-3"><a className="grid size-9 place-items-center rounded-lg border border-white/10 text-slate-500 hover:border-lime-300/30 hover:text-lime-200" href="/command" aria-label="Torna a command"><ArrowLeft className="size-4" /></a><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/70">AI-ZEROW / TENANT CONTROL PLANE</p><h1 className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-slate-50">Aziende e perimetri</h1></div></div><div className="text-right"><p className="text-xs text-slate-200">{actor.displayName}</p><p className="mt-1 text-[10px] text-slate-600">{actor.email}</p></div></header>
    <section className="mt-6 grid gap-4 lg:grid-cols-[1.1fr_.9fr]"><div className="carbon-card carbon-card-neon rounded-2xl p-5 sm:p-6"><div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-xl border border-lime-300/25 bg-lime-300/10 text-lime-200"><Building2 className="size-5" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">MULTI-AZIENDA · MULTI-TENANT</p><h2 className="mt-1 text-lg font-semibold text-slate-50">Ogni azienda ha il proprio perimetro</h2><p className="mt-2 max-w-2xl text-xs leading-5 text-slate-500">Configura il modello operativo in onboarding: solo magazzino, solo trasporti, magazzino + trasporti oppure azienda completa. Menu, capability e API seguono questo perimetro.</p></div></div><div className="mt-5 flex flex-wrap items-center gap-2"><span className="inline-flex items-center gap-1.5 rounded-full border border-lime-300/20 bg-lime-300/5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[.12em] text-lime-200"><span className="size-1.5 rounded-full bg-lime-300" />{loading ? "CHECKING" : tenants.length ? "DIRECTORY READY" : "SETUP REQUIRED"}</span><span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-300/15 bg-cyan-300/5 px-3 py-1.5 text-[10px] uppercase tracking-[.1em] text-cyan-200"><Database className="size-3" />Cloudflare D1</span><button className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-[10px] text-slate-400 hover:border-lime-300/30 hover:text-lime-200" onClick={() => void load()} type="button"><RefreshCw className="size-3.5" />Aggiorna</button></div></div>
      <div className="carbon-card rounded-2xl p-5 sm:p-6"><div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/10 text-lime-200"><Plus className="size-5" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">ONBOARDING AZIENDA</p><h2 className="mt-1 text-base font-semibold text-slate-50">Registra nuova azienda</h2><p className="mt-2 text-xs leading-5 text-slate-500">L’appartenenza del Titolare viene generata dal server per l’identità autenticata.</p></div></div><div className="mt-4 grid gap-2"><input className="h-10 rounded-lg border border-white/10 bg-black/30 px-3 text-xs text-slate-100 outline-none focus:border-lime-300/40" onChange={(event) => { setName(event.target.value); if (!slug) setSlug(slugify(event.target.value)); }} placeholder="Ragione sociale" value={name} /><input className="h-10 rounded-lg border border-white/10 bg-black/30 px-3 font-mono text-xs text-slate-100 outline-none focus:border-lime-300/40" onChange={(event) => setSlug(event.target.value)} placeholder="slug-azienda" value={slug} /><select aria-label="Profilo operativo nuova azienda" className="h-10 rounded-lg border border-white/10 bg-black/30 px-3 text-xs text-slate-100 outline-none focus:border-lime-300/40" onChange={(event) => setProfile(event.target.value as OperatingProfileId)} value={profile}>{profileOptions.map(([id, item]) => <option key={id} value={id}>{item.label}</option>)}</select><button className="mt-1 inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-lime-300 px-4 text-xs font-semibold text-[#060806] hover:bg-lime-200 disabled:cursor-wait disabled:opacity-50" disabled={busy} onClick={() => void createTenant()} type="button">{busy ? <RefreshCw className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}Crea azienda</button></div></div></section>
    <section className="mt-4 rounded-2xl border border-white/[.08] bg-black/20 p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-slate-600">D1 DIRECTORY · CROSS-TENANT</p><h2 className="mt-1 text-base font-semibold text-slate-50">Aziende accessibili</h2></div><span className="font-mono text-[10px] text-lime-200">{tenants.length} TENANT</span></div>{error && <p className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/5 px-3 py-2.5 font-mono text-[10px] text-amber-100">{error}</p>}<p className="mt-3 text-[11px] text-slate-500">{message}</p><div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{tenants.map((tenant) => { const tenantProfile = profileOptions.find(([id]) => id === tenant.operatingProfile); const active = selectedTenant?.id === tenant.id; return <article className={`rounded-xl border p-4 transition ${active ? "border-lime-300/40 bg-lime-300/[.06] shadow-[0_0_24px_rgba(200,255,34,.08)]" : "border-white/[.08] bg-black/20"}`} key={tenant.membershipId}><div className="flex items-start gap-3"><span className="grid size-9 place-items-center rounded-lg border border-lime-300/20 bg-lime-300/10 text-lime-200"><CheckCircle2 className="size-4" /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-100">{tenant.name}</p><p className="mt-1 font-mono text-[10px] text-cyan-200/80">{tenant.slug}</p></div><span className="font-mono text-[9px] uppercase text-lime-200">{authorityRoleLabel(tenant.role)}</span></div><p className="mt-4 text-[10px] font-semibold uppercase tracking-[.12em] text-lime-300/65">{tenantProfile?.[1].label ?? tenant.operatingProfile}</p><div className="mt-1 flex flex-wrap gap-1.5">{tenant.operatingDomains.map((domain) => <span className="rounded-full border border-white/10 px-2 py-1 text-[9px] text-slate-500" key={domain}>{domain}</span>)}</div><button className="mt-4 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-[10px] text-slate-300 hover:border-lime-300/30 hover:text-lime-100 disabled:opacity-50" disabled={busy || active} onClick={() => void selectTenant(tenant.id)} type="button">{active ? "Contesto attivo" : "Usa questo tenant"}</button></article>; })}{loading && <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-xs text-slate-500">Lettura directory…</div>}{!loading && tenants.length === 0 && <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-xs text-slate-500 md:col-span-2 xl:col-span-3">Nessuna azienda registrata. Compila il pannello di onboarding per creare il primo perimetro.</div>}</div></section>
    {selectedTenant && <section className="mt-4 grid gap-4 lg:grid-cols-[1fr_.85fr]"><div className="rounded-2xl border border-lime-300/15 bg-lime-300/[.025] p-5 sm:p-6"><div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-xl border border-lime-300/25 bg-lime-300/10 text-lime-200"><SlidersHorizontal className="size-5" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">TENANT CORRENTE</p><h2 className="mt-1 text-lg font-semibold text-slate-50">{selectedTenant.name}</h2><p className="mt-2 text-xs leading-5 text-slate-500">Profilo: {profileOptions.find(([id]) => id === selectedTenant.operatingProfile)?.[1].label ?? selectedTenant.operatingProfile}. Per modificare il perimetro e le capability operative apri l’onboarding.</p></div></div><a className="mt-5 inline-flex items-center gap-2 rounded-lg border border-lime-300/25 bg-lime-300/[.06] px-3 py-2 text-[10px] font-semibold text-lime-100 hover:bg-lime-300/[.12]" href="/onboarding"><SlidersHorizontal className="size-3.5" />Apri configurazione ruoli e capability</a></div><div className="rounded-2xl border border-cyan-300/15 bg-cyan-300/[.03] p-5 sm:p-6"><div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-xl border border-cyan-300/25 bg-cyan-300/10 text-cyan-200"><KeyRound className="size-5" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-cyan-200/70">NEON AUTH / PRODUCTION BRIDGE</p><h2 className="mt-1 text-base font-semibold text-slate-50">Collega sessione al tenant corrente</h2><p className="mt-2 text-xs leading-5 text-slate-500">Il server assegna identità e ruolo: il browser non può scegliere actor o membership.</p></div></div><div className="mt-4 flex flex-wrap gap-2"><a className="rounded-lg border border-cyan-300/25 px-3 py-2 text-[10px] font-semibold text-cyan-100 hover:border-cyan-200/60" href="/login">Accedi con Neon</a><button className="rounded-lg bg-cyan-200 px-3 py-2 text-[10px] font-semibold text-[#061014] hover:bg-cyan-100 disabled:cursor-wait disabled:opacity-50" disabled={neonLinkBusy} onClick={() => void linkNeonIdentity()} type="button">{neonLinkBusy ? "Verifica…" : "Collega sessione"}</button></div><div className="mt-4 rounded-xl border border-white/[.08] bg-black/20 px-3 py-2.5 text-[11px] text-cyan-100/80">{neonLinkMessage}</div></div></section>}
    <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/[.08] py-5 text-[10px] text-slate-600"><span>AI-ZEROW COMMAND · D1 CONTROL PLANE</span><span>Ruoli, moduli e dati restano tenant-scoped</span></footer>
  </div></main>;
}
