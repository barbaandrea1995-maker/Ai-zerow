"use client";

import { useEffect, useMemo, useState } from "react";
import { LoaderCircle, ShieldCheck } from "lucide-react";
import type { TransportMode } from "@/lib/tenant-operating-model";

type ResourceOption = {
  id: string;
  code: string | null;
  label: string;
  model?: string | null;
  registration?: string | null;
  serialNumber?: string | null;
  kind: "driver" | "vehicle" | "cargo";
  actorId: string | null;
  membershipId: string | null;
  status: string;
  available: boolean;
  conflict: { recordId: string; title: string; startsAt: string; endsAt: string } | null;
  custody: { assignmentId: string; assigneeName: string; assigneeActorId: string; assigneeMembershipId: string; startsAt: string; endsAt: string | null } | null;
  qualifications: string[];
  usageMode?: string | null;
  transportCapabilities?: string[];
  deliveryEligible?: boolean;
  eligibilityReason?: string | null;
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

export type MissionCargoOption = Pick<ResourceOption, "id" | "code" | "label" | "model" | "registration" | "serialNumber">;

type MissionResourceFieldsProps = {
  transportMode?: TransportMode | "";
  plannedAt: string;
  plannedEndAt: string;
  driverId: string;
  vehicleId: string;
  cargoAssetId?: string;
  cargoAssetIds?: string[];
  onDriverChange: (value: string) => void;
  onVehicleChange: (value: string) => void;
  onCargoAssetChange?: (value: string) => void;
  onCargoAssetsChange?: (value: string[]) => void;
  onCargoOptionsChange?: (value: MissionCargoOption[]) => void;
};

function resourceLabel(resource: ResourceOption) {
  const identifiers = [resource.model, resource.registration ? `targa ${resource.registration}` : null, resource.serialNumber ? `matr. ${resource.serialNumber}` : null].filter(Boolean);
  const readable = [resource.label, ...identifiers].join(" · ");
  return resource.code && resource.code !== resource.label ? `${readable} · ${resource.code}` : readable;
}

export function MissionResourceFields({
  transportMode = "",
  plannedAt,
  plannedEndAt,
  driverId,
  vehicleId,
  cargoAssetId = "",
  cargoAssetIds,
  onDriverChange,
  onVehicleChange,
  onCargoAssetChange,
  onCargoAssetsChange,
  onCargoOptionsChange,
}: MissionResourceFieldsProps) {
  const [catalog, setCatalog] = useState<ResourceCatalog | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!plannedAt) {
        setCatalog(null);
        onCargoOptionsChange?.([]);
        setState("idle");
        return;
      }
      setState("loading");
      const params = new URLSearchParams({ plannedAt });
      if (plannedEndAt) params.set("plannedEndAt", plannedEndAt);
      if (transportMode) params.set("transportMode", transportMode);
      void fetch(`/api/mission/resources?${params.toString()}`, { cache: "no-store" })
        .then(async (response) => {
          const payload = await response.json() as { catalog?: ResourceCatalog };
          if (!response.ok || !payload.catalog) throw new Error("mission_resources_unavailable");
          setCatalog(payload.catalog);
          onCargoOptionsChange?.(payload.catalog.cargoAssets);
          setState("ready");
        })
        .catch(() => {
          setCatalog(null);
          setState("error");
        });
    }, 140);
    return () => window.clearTimeout(timer);
  }, [plannedAt, plannedEndAt, transportMode, onCargoOptionsChange]);

  const selectedDriver = useMemo(() => catalog?.drivers.find((resource) => resource.id === driverId) ?? null, [catalog, driverId]);
  const selectableDrivers = useMemo(() => catalog?.drivers.filter((resource) => resource.available) ?? [], [catalog]);
  const selectableVehicles = useMemo(() => catalog?.vehicles.filter((resource) => resource.available && (!resource.custody || !selectedDriver || resource.custody.assigneeActorId === selectedDriver.actorId || resource.custody.assigneeMembershipId === selectedDriver.membershipId)) ?? [], [catalog, selectedDriver]);
  const selectableCargo = useMemo(() => catalog?.cargoAssets.filter((resource) => resource.available) ?? [], [catalog]);
  const selectedCargoIds = cargoAssetIds ?? (cargoAssetId ? [cargoAssetId] : []);
  const changeCargoSelection = (assetId: string, checked: boolean) => {
    const next = checked
      ? [...new Set([...selectedCargoIds, assetId])]
      : selectedCargoIds.filter((value) => value !== assetId);
    if (onCargoAssetsChange) onCargoAssetsChange(next);
    else onCargoAssetChange?.(next[0] ?? "");
  };
  const hasDate = Boolean(plannedAt);
  const disabled = !hasDate || state === "loading" || state === "error";

  return <fieldset className="contents" disabled={disabled}>
    <div className="sm:col-span-2 rounded-2xl border border-lime-300/15 bg-lime-300/[0.035] p-3.5">
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/[0.08] text-lime-200"><ShieldCheck className="size-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-lime-300/70">RISORSE DISPONIBILI</p>
          <p className="mt-1 text-[10px] leading-4 text-slate-500">Autista e mezzo arrivano dal registro aziendale e vengono filtrati sulla finestra scelta. Per un trasferimento asset, seleziona anche l’attrezzatura da consegnare.</p>
        </div>
        <span className="shrink-0 text-[9px] font-mono text-slate-600">{state === "loading" ? <LoaderCircle className="size-3.5 animate-spin text-lime-200" /> : catalog?.availability ?? "DATA REQUIRED"}</span>
      </div>
    </div>
    <label className="text-xs text-slate-400">Autista reale<select aria-label="Autista reale" className="mt-2 h-10 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-xs text-slate-100 outline-none focus:border-lime-300/40 focus:ring-2 focus:ring-lime-300/10" name="driverId" onChange={(event) => onDriverChange(event.target.value)} required value={driverId}><option value="">{!hasDate ? "Prima scegli data e ora" : selectableDrivers.length ? "Seleziona autista" : "Nessun autista disponibile"}</option>{selectableDrivers.map((resource) => <option key={resource.id} value={resource.id}>{resourceLabel(resource)}{resource.qualifications.length ? ` · ${resource.qualifications.join(", ")}` : ""}</option>)}</select></label>
    <label className="text-xs text-slate-400">Mezzo di trasporto<select aria-label="Mezzo di trasporto" className="mt-2 h-10 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-xs text-slate-100 outline-none focus:border-lime-300/40 focus:ring-2 focus:ring-lime-300/10" name="vehicleId" onChange={(event) => onVehicleChange(event.target.value)} required value={vehicleId}><option value="">{!hasDate ? "Prima scegli data e ora" : selectableVehicles.length ? "Seleziona mezzo abilitato al trasporto" : "Nessun mezzo di trasporto disponibile"}</option>{selectableVehicles.map((resource) => <option key={resource.id} value={resource.id}>{resourceLabel(resource)}</option>)}</select></label>
    <div className="sm:col-span-2 rounded-2xl border border-cyan-300/15 bg-cyan-300/[.03] p-3"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-cyan-200/75">ASSET DA TRASPORTARE</p><p className="mt-1 text-[10px] leading-5 text-slate-500">Seleziona uno o più asset reali. Potrai assegnarli alle singole tappe della rotta.</p></div><span className="shrink-0 rounded-full border border-cyan-300/20 px-2 py-1 font-mono text-[9px] text-cyan-100">{selectedCargoIds.length} SELEZIONATI</span></div><div className="mt-3 space-y-1.5">{selectableCargo.length ? selectableCargo.map((resource) => <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-white/[.08] bg-black/20 p-2.5 text-[10px] text-slate-300 hover:border-cyan-300/30" key={resource.id}><input aria-label={`Seleziona asset ${resourceLabel(resource)}`} checked={selectedCargoIds.includes(resource.id)} className="mt-0.5 size-3.5 accent-lime-300" onChange={(event) => changeCargoSelection(resource.id, event.target.checked)} type="checkbox" /><span className="min-w-0 flex-1"><span className="block truncate font-semibold text-slate-200">{resourceLabel(resource)}</span><span className="mt-0.5 block text-[9px] text-slate-600">{resource.id}</span></span></label>) : <p className="rounded-xl border border-dashed border-cyan-300/15 px-3 py-2 text-[10px] text-slate-600">{!hasDate ? "Inserisci prima data e ora." : "Nessun asset disponibile nella finestra."}</p>}</div>{transportMode === "ASSET_TRANSFER" && selectedCargoIds.length === 0 && <p className="mt-2 text-[10px] text-rose-200">Seleziona almeno un asset per un trasferimento asset.</p>}</div>
    {state === "idle" && <p className="text-[10px] text-slate-600 sm:col-span-2">Inserisci la data pianificata per verificare risorse e conflitti.</p>}
    {state === "error" && <p className="text-[10px] text-amber-200 sm:col-span-2">Registro risorse non disponibile: la missione non può essere confermata.</p>}
    {state === "ready" && catalog?.availability === "NO_RESOURCES" && <p className="text-[10px] text-amber-200 sm:col-span-2">Non ci sono contemporaneamente un autista e un mezzo disponibili in questa finestra.</p>}
    {state === "ready" && catalog && <p className="text-[10px] text-slate-600 sm:col-span-2">Disponibili nella finestra: {catalog.totals.availableDrivers} autisti · {catalog.totals.availableVehicles} mezzi · {catalog.totals.availableCargoAssets} asset.</p>}
  </fieldset>;
}
