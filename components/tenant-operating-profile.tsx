"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, LoaderCircle, Package, Save, Truck, Wrench } from "lucide-react";
import { OPERATING_PROFILE_CATALOG, type OperatingProfileId } from "@/lib/tenant-operating-model";

type Profile = { id: OperatingProfileId; label: string; description: string; domains: string[] };
type ProfileResponse = { operatingProfile?: OperatingProfileId; operatingDomains?: string[]; tenant?: { id: string; name: string; slug: string }; profiles?: Profile[]; canManage?: boolean; error?: string };

const fallbackProfiles = Object.entries(OPERATING_PROFILE_CATALOG).map(([id, value]) => ({ id: id as OperatingProfileId, ...value }));
const domainIcon = { operations: Wrench, warehouse: Package, transport: Truck } as const;

export function TenantOperatingProfile() {
  const [profile, setProfile] = useState<OperatingProfileId>("FULL_OPERATIONS");
  const [domains, setDomains] = useState<string[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>(fallbackProfiles);
  const [tenantName, setTenantName] = useState("Tenant corrente");
  const [canManage, setCanManage] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "saving" | "error">("loading");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/tenants/profile", { cache: "no-store" });
      const payload = await response.json() as ProfileResponse;
      if (!response.ok) throw new Error(payload.error ?? "tenant_profile_unavailable");
      setProfile(payload.operatingProfile ?? "FULL_OPERATIONS");
      setDomains(payload.operatingDomains ?? []);
      setProfiles(payload.profiles?.length ? payload.profiles : fallbackProfiles);
      setTenantName(payload.tenant?.name ?? "Tenant corrente");
      setCanManage(Boolean(payload.canManage));
      setState("ready");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Profilo tenant non disponibile");
      setState("error");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function save() {
    setState("saving");
    setNotice("");
    try {
      const response = await fetch("/api/tenants/profile", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ operatingProfile: profile }) });
      const payload = await response.json() as ProfileResponse;
      if (!response.ok) throw new Error(payload.error ?? "tenant_profile_update_failed");
      setDomains(payload.operatingDomains ?? []);
      setNotice("Perimetro operativo salvato. Menu e capability si riallineano al prossimo readback.");
      setState("ready");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Salvataggio non completato");
      setState("error");
    }
  }

  const selected = profiles.find((option) => option.id === profile) ?? profiles[profiles.length - 1];
  return <section className="carbon-card mb-5 rounded-2xl p-4 sm:p-5" aria-labelledby="tenant-operating-profile-title"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">TENANT ONBOARDING / OPERATING MODEL</p><h2 className="mt-1 text-base font-semibold text-slate-100" id="tenant-operating-profile-title">Perimetro operativo di {tenantName}</h2><p className="mt-1 max-w-3xl text-[11px] leading-5 text-slate-500">Scegli cosa fa realmente questa azienda. Il perimetro governa navigazione, capability e accesso alle API: un tenant solo magazzino non vede Missione, autisti o mezzi.</p></div><span className={`rounded-full border px-3 py-1.5 font-mono text-[9px] ${state === "error" ? "border-amber-300/20 bg-amber-300/5 text-amber-200" : "border-lime-300/20 bg-lime-300/[.06] text-lime-200"}`}>{state === "loading" ? "READING" : state === "saving" ? "SAVING" : state === "error" ? "CHECK REQUIRED" : "PROFILE READBACK"}</span></div><div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-5">{profiles.map((option) => { const active = option.id === profile; return <button className={`rounded-xl border p-3 text-left transition ${active ? "border-lime-300/50 bg-lime-300/[.08] shadow-[0_0_24px_rgba(200,255,34,.09)]" : "border-white/[.08] bg-black/20 hover:border-lime-300/25"}`} key={option.id} onClick={() => canManage && setProfile(option.id)} type="button" disabled={!canManage || state === "saving"}><div className="flex items-start justify-between gap-2"><span className={`text-[10px] font-semibold ${active ? "text-lime-100" : "text-slate-300"}`}>{option.label}</span>{active && <Check className="size-3.5 text-lime-200" />}</div><p className="mt-2 min-h-8 text-[9px] leading-4 text-slate-600">{option.description}</p><div className="mt-3 flex gap-1.5">{option.domains.map((domain) => { const Icon = domainIcon[domain as keyof typeof domainIcon]; return Icon ? <span className="grid size-6 place-items-center rounded-md border border-white/10 bg-black/20 text-slate-500" key={domain} title={domain}><Icon className="size-3" /></span> : null; })}</div></button>; })}</div><div className="mt-4 flex flex-wrap items-center gap-2"><span className="text-[10px] text-slate-600">DOMINI ATTIVI</span>{domains.map((domain) => <span className="rounded-full border border-lime-300/15 bg-lime-300/[.04] px-2.5 py-1 text-[9px] text-lime-100" key={domain}>{domain}</span>)}<span className="ml-auto" />{canManage && <button className="inline-flex items-center gap-2 rounded-lg bg-lime-300 px-3 py-2 text-[10px] font-semibold text-[#060806] hover:bg-lime-200 disabled:opacity-50" disabled={state === "saving" || state === "loading"} onClick={() => void save()} type="button">{state === "saving" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}Salva perimetro</button>}</div>{notice && <p className="mt-3 rounded-xl border border-white/[.08] bg-black/20 px-3 py-2 text-[10px] text-slate-400">{notice}</p>}{!canManage && state === "ready" && <p className="mt-3 text-[10px] text-amber-200/80">Il profilo è leggibile ma modificabile solo da owner con tenant.manage.</p>}{selected && <span className="sr-only">Profilo selezionato: {selected.label}</span>}</section>;
}
