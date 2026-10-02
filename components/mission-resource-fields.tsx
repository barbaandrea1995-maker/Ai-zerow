"use client";

import { useEffect, useMemo, useState } from "react";
import { LoaderCircle, ShieldCheck } from "lucide-react";

type ResourceOption = {
  id: string;
  code: string | null;
  label: string;
  kind: "driver" | "vehicle" | "cargo";
  status: string;
  available: boolean;
  conflict: { recordId: string; title: string; startsAt: string; endsAt: string } | null;
  qualifications: string[];
  updatedAt: string;
};

type ResourceCatalog = {
  availability: "READY" | "DATE_REQUIRED" | "NO_RESOURCES";
  drivers: ResourceOption[];
  vehicles: ResourceOption[];
  cargoAssets: ResourceOption[];
  totals: {
    drivers: number;
    vehicles: number;
    cargoAssets: number;
    availableDrivers: number;
    availableVehicles: number;
    availableCargoAssets: number;
  };
};

type MissionResourceFieldsProps = {
  plannedAt: string;
  plannedEndAt: string;
  driverId: string;
  vehicleId: string;
  cargoAssetId: string;
  onDriverChange: (value: string) => void;
  onVehicleChange: (value: string) => void;
  onCargoAssetChange: (value: string) => void;
};

function resourceLabel(resource: ResourceOption) {
  return resource.code && resource.code !== resource.label
    ? `${resource.code} · ${resource.label}`
    : resource.label;
}

export function MissionResourceFields({
  plannedAt,
  plannedEndAt,
  driverId,
  vehicleId,
  cargoAssetId,
  onDriverChange,
  onVehicleChange,
  onCargoAssetChange,
}: MissionResourceFieldsProps) {
  const [catalog, setCatalog] = useState<ResourceCatalog | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!plannedAt) {
        setCatalog(null);
        setState("idle");
        return;
      }
      setState("loading");
      const params = new URLSearchParams({ plannedAt });
      if (plannedEndAt) params.set("plannedEndAt", plannedEndAt);
      void fetch(`/api/mission/resources?${params.toString()}`, { cache: "no-store" })
        .then(async (response) => {
          const payload = await response.json() as { catalog?: ResourceCatalog };
          if (!response.ok || !payload.catalog) throw new Error("mission_resources_unavailable");
          setCatalog(payload.catalog);
          setState("ready");
        })
        .catch(() => {
          setCatalog(null);
          setState("error");
        });
    }, 140);
    return () => window.clearTimeout(timer);
  }, [plannedAt, plannedEndAt]);

  const selectableDrivers = useMemo(() => catalog?.drivers.filter((resource) => resource.available) ?? [], [catalog]);
  const selectableVehicles = useMemo(() => catalog?.vehicles.filter((resource) => resource.available) ?? [], [catalog]);
  const selectableCargo = useMemo(() => catalog?.cargoAssets.filter((resource) => resource.available) ?? [], [catalog]);
  const hasDate = Boolean(plannedAt);
  const disabled = !hasDate || state === "loading" || state === "error";

  return <fieldset className="contents" disabled={disabled}>
    <div className="sm:col-span-2 rounded-2xl border border-lime-300/15 bg-lime-300/[0.035] p-3.5">
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/[0.08] text-lime-200"><ShieldCheck className="size-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-lime-300/70">REGISTRO RISORSE · DISPONIBILITÀ LIVE</p>
          <p className="mt-1 text-[10px] leading-4 text-slate-500">Autista e mezzo sono selezionabili solo se registrati nel tenant, operativi e liberi nella finestra della missione. L’asset da consegnare è opzionale.</p>
        </div>
        <span className="shrink-0 text-[9px] font-mono text-slate-600">{state === "loading" ? <LoaderCircle className="size-3.5 animate-spin text-lime-200" /> : catalog?.availability ?? "DATA REQUIRED"}</span>
      </div>
    </div>
    <label className="text-xs text-slate-400">Autista reale<select aria-label="Autista reale" className="mt-2 h-10 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-xs text-slate-100 outline-none focus:border-lime-300/40 focus:ring-2 focus:ring-lime-300/10" name="driverId" onChange={(event) => onDriverChange(event.target.value)} required value={driverId}><option value="">{!hasDate ? "Prima scegli data e ora" : selectableDrivers.length ? "Seleziona autista" : "Nessun autista disponibile"}</option>{selectableDrivers.map((resource) => <option key={resource.id} value={resource.id}>{resourceLabel(resource)}{resource.qualifications.length ? ` · ${resource.qualifications.join(", ")}` : ""}</option>)}</select></label>
    <label className="text-xs text-slate-400">Mezzo reale<select aria-label="Mezzo reale" className="mt-2 h-10 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-xs text-slate-100 outline-none focus:border-lime-300/40 focus:ring-2 focus:ring-lime-300/10" name="vehicleId" onChange={(event) => onVehicleChange(event.target.value)} required value={vehicleId}><option value="">{!hasDate ? "Prima scegli data e ora" : selectableVehicles.length ? "Seleziona mezzo" : "Nessun mezzo disponibile"}</option>{selectableVehicles.map((resource) => <option key={resource.id} value={resource.id}>{resourceLabel(resource)}</option>)}</select></label>
    <label className="text-xs text-slate-400 sm:col-span-2">Asset da consegnare <span className="text-slate-600">(opzionale)</span><select aria-label="Asset da consegnare" className="mt-2 h-10 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-xs text-slate-100 outline-none focus:border-lime-300/40 focus:ring-2 focus:ring-lime-300/10" name="cargoAssetId" onChange={(event) => onCargoAssetChange(event.target.value)} value={cargoAssetId}><option value="">Nessun asset associato</option>{selectableCargo.map((resource) => <option key={resource.id} value={resource.id}>{resourceLabel(resource)}</option>)}</select></label>
    {state === "idle" && <p className="text-[10px] text-slate-600 sm:col-span-2">Inserisci la data pianificata per verificare risorse e conflitti.</p>}
    {state === "error" && <p className="text-[10px] text-amber-200 sm:col-span-2">Registro risorse non disponibile: la missione non può essere confermata.</p>}
    {state === "ready" && catalog?.availability === "NO_RESOURCES" && <p className="text-[10px] text-amber-200 sm:col-span-2">Non ci sono contemporaneamente un autista e un mezzo disponibili in questa finestra.</p>}
    {state === "ready" && catalog && <p className="text-[10px] text-slate-600 sm:col-span-2">Disponibili: {catalog.totals.availableDrivers} autisti · {catalog.totals.availableVehicles} mezzi · {catalog.totals.availableCargoAssets} asset.</p>}
  </fieldset>;
}
