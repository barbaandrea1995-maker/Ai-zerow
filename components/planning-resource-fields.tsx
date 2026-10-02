"use client";

import { useEffect, useMemo, useState } from "react";
import { LoaderCircle, Users, Wrench } from "lucide-react";

type ResourceOption = {
  id: string;
  code: string | null;
  label: string;
  kind: "person" | "team" | "asset" | "vehicle";
  status: string;
  assignable: boolean;
  capacity: number;
  qualifications: string[];
  updatedAt: string;
};

type ResourceResponse = {
  options?: {
    workforce: ResourceOption[];
    assets: ResourceOption[];
    unavailableAssets: ResourceOption[];
  };
};

type PlanningResourceFieldsProps = {
  jobId: string;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
};

function labelFor(resource: ResourceOption) {
  return resource.code && resource.code !== resource.label
    ? `${resource.code} · ${resource.label}`
    : resource.label;
}

function kindLabel(kind: ResourceOption["kind"]) {
  if (kind === "person") return "Persona";
  if (kind === "team") return "Squadra";
  if (kind === "vehicle") return "Mezzo";
  return "Asset";
}

export function PlanningResourceFields({ jobId, selectedIds, onChange }: PlanningResourceFieldsProps) {
  const [resources, setResources] = useState<ResourceOption[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => setState("loading"), 0);
    void fetch(`/api/operations/jobs/${encodeURIComponent(jobId)}/planning/resource-options`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as ResourceResponse;
        if (!response.ok || !payload.options) throw new Error("planning_resources_unavailable");
        if (!active) return;
        setResources([...(payload.options.workforce ?? []), ...(payload.options.assets ?? [])].filter((item) => item.assignable));
        setState("ready");
      })
      .catch(() => {
        if (!active) return;
        setResources([]);
        setState("error");
      });
    return () => { active = false; window.clearTimeout(timer); };
  }, [jobId]);

  const groups = useMemo(() => [
    { label: "Persone e squadre", icon: Users, items: resources.filter((resource) => resource.kind === "person" || resource.kind === "team") },
    { label: "Asset e mezzi", icon: Wrench, items: resources.filter((resource) => resource.kind === "asset" || resource.kind === "vehicle") },
  ], [resources]);

  function toggle(id: string) {
    onChange(selectedIds.includes(id) ? selectedIds.filter((item) => item !== id) : [...selectedIds, id]);
  }

  return <fieldset className="sm:col-span-2 rounded-2xl border border-lime-300/15 bg-lime-300/[0.035] p-3.5" disabled={state !== "ready"}>
    <div className="flex items-start gap-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/[0.08] text-lime-200"><Users className="size-4" /></span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-lime-300/70">RISORSE REALI · PIANO GIORNALIERO</p>
        <p className="mt-1 text-[10px] leading-4 text-slate-500">Seleziona soltanto persone, squadre, asset e mezzi registrati nel tenant. Il server ricalcola disponibilità e conflitti prima della pubblicazione.</p>
      </div>
      <span className="shrink-0 font-mono text-[9px] text-slate-600">{state === "loading" ? <LoaderCircle className="size-3.5 animate-spin text-lime-200" /> : state === "error" ? "UNAVAILABLE" : `${selectedIds.length} SEL.`}</span>
    </div>
    {state === "error" && <p className="mt-3 text-[10px] text-amber-200">Registro risorse non disponibile: il piano non può essere confermato.</p>}
    {state === "ready" && !resources.length && <p className="mt-3 text-[10px] text-amber-200">Nessuna risorsa assegnabile nel registro tenant.</p>}
    <div className="mt-3 grid gap-3 md:grid-cols-2">
      {groups.map((group) => <div key={group.label}>
        <div className="mb-2 flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-500"><group.icon className="size-3.5 text-lime-200/70" />{group.label}</div>
        <div className="space-y-1.5">{group.items.map((resource) => <label className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition ${selectedIds.includes(resource.id) ? "border-lime-300/35 bg-lime-300/[0.07]" : "border-white/[0.08] bg-black/15 hover:border-lime-300/20"}`} key={resource.id}><input aria-label={`Seleziona ${labelFor(resource)}`} checked={selectedIds.includes(resource.id)} className="size-4 accent-lime-300" onChange={() => toggle(resource.id)} type="checkbox" value={resource.id} /><span className="min-w-0 flex-1"><span className="block truncate text-[10px] font-medium text-slate-200">{labelFor(resource)}</span><span className="mt-0.5 block truncate text-[9px] text-slate-600">{kindLabel(resource.kind)} · {resource.status}{resource.qualifications.length ? ` · ${resource.qualifications.join(", ")}` : ""}</span></span></label>)}</div>
      </div>)}
    </div>
  </fieldset>;
}
