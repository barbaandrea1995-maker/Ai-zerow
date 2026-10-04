"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Check, CheckCircle2, ChevronRight, LoaderCircle, MapPin, ShieldCheck, Sparkles, Warehouse } from "lucide-react";
import { useRouter } from "next/navigation";
import TenantWarehouseControl from "@/components/tenant-warehouse-control";
import { OPERATING_PROFILE_CATALOG, type OperatingProfileId } from "@/lib/tenant-operating-model";

type TenantView = {
  id: string;
  slug: string;
  name: string;
  status: string;
  operatingProfile: OperatingProfileId;
  operatingDomains: string[];
  transportModes?: string[];
};

type TenantDirectoryResponse = {
  setupRequired?: boolean;
  canonicalTenantId?: string | null;
  tenants?: TenantView[];
  error?: string;
};

type Stage = "checking" | "create" | "configure" | "complete";

const profiles = Object.entries(OPERATING_PROFILE_CATALOG) as Array<[
  OperatingProfileId,
  (typeof OPERATING_PROFILE_CATALOG)[OperatingProfileId],
]>;

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function profileLabel(profile: OperatingProfileId) {
  return OPERATING_PROFILE_CATALOG[profile]?.label ?? profile;
}

export default function PrimaryOnboarding() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("checking");
  const [tenant, setTenant] = useState<TenantView | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [profile, setProfile] = useState<OperatingProfileId>("FULL_OPERATIONS");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [warehouseCount, setWarehouseCount] = useState<number | null>(null);

  const selectedProfile = useMemo(() => OPERATING_PROFILE_CATALOG[profile], [profile]);
  const requiresWarehouse = selectedProfile.domains.includes("warehouse");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/tenants", { cache: "no-store" });
      const payload = await response.json() as TenantDirectoryResponse;
      if (!response.ok) throw new Error(payload.error ?? "tenant_directory_unavailable");
      const selected = payload.tenants?.find((item) => item.id === payload.canonicalTenantId)
        ?? payload.tenants?.find((item) => item.status === "onboarding")
        ?? null;
      if (!selected) {
        setStage("create");
        return;
      }
      if (selected.status === "active") {
        router.replace("/command");
        return;
      }
      setTenant(selected);
      setName(selected.name);
      setSlug(selected.slug);
      setProfile(selected.operatingProfile);
      setStage("configure");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Impossibile leggere lo stato dell’onboarding.");
      setStage("create");
    }
  }, [router]);

  const loadWarehouseCount = useCallback(async () => {
    if (!tenant || !requiresWarehouse) return;
    try {
      const response = await fetch("/api/authority/warehouses", { cache: "no-store" });
      const payload = await response.json() as { warehouses?: unknown[] };
      if (response.ok) setWarehouseCount(payload.warehouses?.length ?? 0);
    } catch {
      setWarehouseCount(null);
    }
  }, [requiresWarehouse, tenant]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadWarehouseCount(), 0);
    return () => window.clearTimeout(timer);
  }, [loadWarehouseCount]);

  async function createTenant() {
    const cleanName = name.trim();
    const cleanSlug = (slug.trim() || slugify(cleanName)).toLowerCase();
    if (cleanName.length < 2 || !/^[a-z0-9][a-z0-9-]{2,62}$/.test(cleanSlug)) {
      setNotice("Inserisci una ragione sociale e uno slug valido, ad esempio ems-edilizia.");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/tenants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: cleanName, slug: cleanSlug, operatingProfile: profile }),
      });
      const payload = await response.json() as TenantDirectoryResponse & { created?: boolean };
      if (!response.ok) throw new Error(payload.error ?? "tenant_provisioning_failed");
      const created = payload.tenants?.find((item) => item.id === payload.canonicalTenantId)
        ?? payload.tenants?.find((item) => item.slug === cleanSlug);
      if (!created) throw new Error("tenant_readback_unavailable");
      setTenant(created);
      setName(created.name);
      setSlug(created.slug);
      setProfile(created.operatingProfile);
      setStage("configure");
      setNotice("Azienda registrata. Ora completa il perimetro operativo prima di entrare nella PWA.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Registrazione azienda non completata.");
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile() {
    if (!tenant) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/tenants/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operatingProfile: profile, transportModes: selectedProfile.transportModes }),
      });
      const payload = await response.json() as { error?: string; operatingProfile?: OperatingProfileId; operatingDomains?: string[]; transportModes?: string[] };
      if (!response.ok) throw new Error(payload.error ?? "tenant_profile_update_failed");
      setTenant((current) => current ? { ...current, operatingProfile: payload.operatingProfile ?? profile, operatingDomains: payload.operatingDomains ?? selectedProfile.domains, transportModes: payload.transportModes ?? selectedProfile.transportModes } : current);
      setNotice("Perimetro operativo salvato. Le capability saranno calcolate dal server.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Perimetro non salvato.");
    } finally {
      setBusy(false);
    }
  }

  async function completeOnboarding() {
    if (!tenant) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/tenants/complete", { method: "POST" });
      const payload = await response.json() as { error?: string; detail?: string; requirements?: string[] };
      if (!response.ok) {
        if (payload.error === "onboarding_requirements_incomplete" && payload.requirements?.includes("warehouse")) {
          throw new Error("Configura almeno un magazzino con luogo e geofence per attivare questo profilo.");
        }
        throw new Error(payload.detail ?? payload.error ?? "onboarding_completion_failed");
      }
      setStage("complete");
      setNotice("Onboarding completato. Apertura della PWA…");
      window.setTimeout(() => router.replace("/command"), 500);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Attivazione non completata.");
    } finally {
      setBusy(false);
    }
  }

  const steps = [
    { label: "Account", detail: "Identità verificata", done: true },
    { label: "Azienda", detail: tenant ? "Registrata" : "Da registrare", done: Boolean(tenant) },
    { label: "Perimetro", detail: tenant ? profileLabel(profile) : "Scegli il modello", done: Boolean(tenant) },
    { label: "Attivazione", detail: "Sblocca la PWA", done: stage === "complete" },
  ];

  if (stage === "checking") {
    return <main className="zw-app-shell flex min-h-screen items-center justify-center px-5 text-slate-100"><div className="carbon-card carbon-card-neon flex items-center gap-3 rounded-2xl px-5 py-4 text-sm text-slate-300"><LoaderCircle className="size-4 animate-spin text-lime-300" />Verifico il tuo accesso e preparo l’onboarding…</div></main>;
  }

  return <main className="zw-app-shell min-h-screen overflow-x-hidden px-4 py-5 text-slate-100 sm:px-7 sm:py-7">
    <div className="mx-auto w-full max-w-[1180px]">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="neon-pulse grid size-11 place-items-center rounded-xl border border-lime-300/45 bg-black text-lime-200 shadow-[0_0_28px_rgba(200,255,34,.16)]"><Sparkles className="size-5" /></span>
          <div><p className="text-sm font-bold tracking-[.2em] text-slate-50">AI-ZEROW</p><p className="mt-1 text-[10px] uppercase tracking-[.22em] text-lime-300/70">primary onboarding</p></div>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-lime-300/20 bg-lime-300/[.05] px-3 py-2 text-[10px] font-semibold uppercase tracking-[.14em] text-lime-200"><ShieldCheck className="size-3.5" />Accesso verificato</span>
      </header>

      <section className="mt-8 grid gap-7 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div>
          <div className="max-w-2xl"><p className="text-[10px] font-semibold uppercase tracking-[.22em] text-lime-300/70">PRIMO ACCESSO · WORKSPACE SETUP</p><h1 className="mt-3 text-3xl font-semibold tracking-[-.05em] text-slate-50 sm:text-5xl">Configura la tua azienda.</h1><p className="mt-4 max-w-xl text-sm leading-6 text-slate-400">Prima di entrare nella PWA definiamo il perimetro reale dell’azienda. Il modello scelto decide moduli, capability e flussi disponibili; potrai rifinirlo dall’Authority in qualsiasi momento.</p></div>
          <div className="mt-7 grid gap-2 sm:grid-cols-4">{steps.map((step, index) => <div className={`rounded-2xl border p-3 ${step.done ? "border-lime-300/25 bg-lime-300/[.05]" : "border-white/[.08] bg-black/20"}`} key={step.label}><div className="flex items-center justify-between"><span className={`grid size-7 place-items-center rounded-lg border text-[10px] font-semibold ${step.done ? "border-lime-300/35 bg-lime-300/10 text-lime-200" : "border-white/10 text-slate-600"}`}>{step.done ? <Check className="size-3.5" /> : String(index + 1).padStart(2, "0")}</span><span className={`text-[9px] uppercase tracking-[.12em] ${step.done ? "text-lime-200/80" : "text-slate-600"}`}>{step.done ? "Pronto" : "In attesa"}</span></div><p className="mt-3 text-xs font-semibold text-slate-200">{step.label}</p><p className="mt-1 text-[10px] leading-4 text-slate-500">{step.detail}</p></div>)}</div>

          {!tenant ? <section className="carbon-card carbon-card-neon mt-5 rounded-[24px] p-5 sm:p-7" aria-labelledby="company-registration-title"><div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-xl border border-lime-300/25 bg-lime-300/10 text-lime-200"><Building2 className="size-5" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">01 · IDENTITÀ AZIENDALE</p><h2 id="company-registration-title" className="mt-1 text-lg font-semibold text-slate-50">Registra il primo workspace</h2><p className="mt-2 text-xs leading-5 text-slate-500">Questi dati creano il perimetro dell’azienda e la tua membership owner. Non configurano ancora utenti o dati operativi.</p></div></div><div className="mt-6 grid gap-4 sm:grid-cols-2"><label className="grid gap-2 text-sm text-slate-300 sm:col-span-2"><span>Ragione sociale</span><input className="h-12 rounded-xl border border-lime-300/15 bg-black/30 px-4 text-base text-slate-100 outline-none focus:border-lime-300/50 focus:ring-2 focus:ring-lime-300/10" onChange={(event) => { setName(event.target.value); if (!slug) setSlug(slugify(event.target.value)); }} placeholder="Es. EMS Edilizia Multiservizi" value={name} /></label><label className="grid gap-2 text-sm text-slate-300 sm:col-span-2"><span>Identificativo azienda</span><input className="h-12 rounded-xl border border-lime-300/15 bg-black/30 px-4 font-mono text-base text-slate-100 outline-none focus:border-lime-300/50 focus:ring-2 focus:ring-lime-300/10" onChange={(event) => setSlug(event.target.value)} placeholder="ems-edilizia" value={slug} /><span className="text-xs text-slate-600">Solo lettere minuscole, numeri e trattini.</span></label></div><div className="mt-6 flex items-center justify-end"><button className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-lime-300 px-5 text-sm font-semibold text-[#050705] shadow-[0_0_28px_rgba(200,255,34,.18)] transition hover:bg-lime-200 disabled:cursor-wait disabled:opacity-50" disabled={busy} onClick={() => void createTenant()} type="button">{busy ? <LoaderCircle className="size-4 animate-spin" /> : <ChevronRight className="size-4" />}Continua</button></div></section> : <>
            <section className="carbon-card mt-5 rounded-[24px] p-5 sm:p-7" aria-labelledby="operating-model-title"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">02 · MODELLO OPERATIVO</p><h2 id="operating-model-title" className="mt-1 text-lg font-semibold text-slate-50">Cosa fa realmente {tenant.name}?</h2><p className="mt-2 text-xs leading-5 text-slate-500">La scelta è server-side: filtra menu, capability e API. Non è una semplice preferenza grafica.</p></div><span className="rounded-full border border-lime-300/20 bg-lime-300/[.05] px-3 py-1.5 font-mono text-[9px] text-lime-200">{tenant.slug}</span></div><div className="mt-5 grid gap-3 md:grid-cols-2">{profiles.map(([id, item]) => { const active = profile === id; return <button className={`min-h-[118px] rounded-2xl border p-4 text-left transition ${active ? "border-lime-300/55 bg-lime-300/[.08] shadow-[0_0_28px_rgba(200,255,34,.1)]" : "border-white/[.08] bg-black/20 hover:border-lime-300/25"}`} disabled={busy} key={id} onClick={() => setProfile(id)} type="button"><div className="flex items-start justify-between gap-3"><span className={`text-sm font-semibold ${active ? "text-lime-100" : "text-slate-200"}`}>{item.label}</span>{active ? <CheckCircle2 className="size-4 text-lime-200" /> : null}</div><p className="mt-2 text-xs leading-5 text-slate-500">{item.description}</p><div className="mt-4 flex flex-wrap gap-1.5">{item.domains.map((domain) => <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[10px] uppercase tracking-[.08em] text-slate-500" key={domain}>{domain}</span>)}</div></button>; })}</div><div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[.08] bg-black/20 p-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.14em] text-lime-300/70">Flussi compresi</p><p className="mt-1 text-xs text-slate-500">{selectedProfile.transportModes.length ? selectedProfile.transportModes.length + " modalità di trasporto disponibili" : "Pianificazione e attività operative"}</p></div><button className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-lime-300/25 bg-lime-300/[.06] px-3 text-xs font-semibold text-lime-100 hover:bg-lime-300/[.12]" disabled={busy} onClick={() => void saveProfile()} type="button">Salva modello</button></div></section>
            {requiresWarehouse ? <TenantWarehouseControl canManage onNotify={setNotice} /> : <section className="carbon-card mt-5 rounded-[24px] border border-cyan-300/15 bg-cyan-300/[.025] p-5 sm:p-6"><div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-xl border border-cyan-300/20 bg-cyan-300/[.06] text-cyan-100"><MapPin className="size-5" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-cyan-200/70">CONFIGURAZIONE CONDIZIONALE</p><h2 className="mt-1 text-base font-semibold text-slate-100">Nessun magazzino richiesto</h2><p className="mt-2 text-xs leading-5 text-slate-500">Il profilo scelto non attiva il dominio warehouse. Potrai aggiungere sedi e geofence in seguito se il modello aziendale cambia.</p></div></div></section>}
            <section className="carbon-card mt-5 rounded-[24px] border border-lime-300/20 bg-lime-300/[.035] p-5 sm:p-6"><div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-xl border border-lime-300/25 bg-lime-300/10 text-lime-200"><ShieldCheck className="size-5" /></span><div className="min-w-0 flex-1"><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">03 · ATTIVAZIONE</p><h2 className="mt-1 text-lg font-semibold text-slate-50">Apri il workspace operativo</h2><p className="mt-2 text-xs leading-5 text-slate-500">L’accesso ai moduli si abilita solo dopo il controllo server-side del perimetro e dei requisiti del profilo.</p>{requiresWarehouse && warehouseCount === 0 ? <p className="mt-3 flex items-center gap-2 text-xs text-amber-200"><Warehouse className="size-4" />Serve almeno un magazzino attivo con geofence.</p> : null}</div></div><div className="mt-5 flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-2 text-[10px] text-slate-500"><span className="rounded-full border border-lime-300/15 bg-lime-300/[.04] px-2.5 py-1 text-lime-100">Owner verificato</span><span className="rounded-full border border-white/10 px-2.5 py-1">Capability server-side</span></div><button className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-lime-300 px-5 text-sm font-semibold text-[#050705] shadow-[0_0_28px_rgba(200,255,34,.18)] transition hover:bg-lime-200 disabled:cursor-wait disabled:opacity-50" disabled={busy || stage === "complete"} onClick={() => void completeOnboarding()} type="button">{busy ? <LoaderCircle className="size-4 animate-spin" /> : <ChevronRight className="size-4" />}Attiva workspace</button></div></section>
          </>}
          {notice ? <p className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/[.05] px-4 py-3 text-sm leading-5 text-amber-100" role="status">{notice}</p> : null}
        </div>
        <aside className="space-y-4 lg:pt-16"><section className="carbon-card rounded-[24px] p-5"><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">IL PRINCIPIO ZEROW</p><h2 className="mt-2 text-lg font-semibold text-slate-50">Un’azienda, un perimetro.</h2><p className="mt-3 text-xs leading-5 text-slate-500">Ogni persona potrà avere più mansioni. Ogni modulo comparirà solo quando il tenant e la capability lo consentono.</p><div className="mt-5 space-y-3">{["Account personale separato dall’azienda", "Profilo operativo configurabile", "Ruoli multipli e capability granulari", "Accesso alla PWA solo dopo attivazione"].map((item) => <div className="flex items-start gap-2.5 text-xs text-slate-300" key={item}><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-lime-300" />{item}</div>)}</div></section><section className="carbon-inset rounded-[24px] p-5"><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-slate-500">DOPO L’ATTIVAZIONE</p><div className="mt-4 space-y-3 text-xs text-slate-400"><p className="flex items-center gap-2"><Building2 className="size-4 text-lime-300" />Authority e persone</p><p className="flex items-center gap-2"><Warehouse className="size-4 text-cyan-200" />Sedi, magazzini e geofence</p><p className="flex items-center gap-2"><MapPin className="size-4 text-amber-200" />Commesse, missioni e luoghi riconosciuti</p></div></section></aside>
      </section>
    </div>
  </main>;
}
