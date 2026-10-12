"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CircleAlert, LoaderCircle, ShieldCheck, Truck } from "lucide-react";
import type { TransportMode } from "@/lib/tenant-operating-model";
import { sameCustodian } from "@/lib/mission-resource-rules";

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
  simulationEligible: boolean;
  conflict: { recordId: string; title: string; startsAt: string; endsAt: string } | null;
  custody: { assignmentId: string; assignmentKind: string; assigneeName: string; assigneeActorId: string; assigneeMembershipId: string; startsAt: string; endsAt: string | null } | null;
  qualifications: string[];
  usageMode?: string | null;
  transportCapabilities?: string[];
  deliveryEligible?: boolean;
  eligibilityReason?: string | null;
  cargoLoadable: boolean;
  weightKg: number | null;
  maxPayloadKg: number | null;
  pairedCargoAssetIds: string[];
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

type SimulationResult = {
  simulationOnly?: boolean;
  writesPerformed?: boolean;
  reservationsCreated?: boolean;
  validation?: {
    result: string;
    capacity?: { maxPayloadKg: number | null; knownCargoWeightKg: number; unknownCargoCount: number };
  };
  custodyOverride?: Array<{ resourceId: string; resourceName: string; assignedTo: string }>;
  error?: string;
  details?: Record<string, unknown> | null;
};

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

function simulationErrorMessage(result: SimulationResult) {
  const messages: Record<string, string> = {
    driver_not_found: "L’autista non risulta nel registro server-side.",
    vehicle_not_found: "Il mezzo selezionato non risulta classificato come veicolo.",
    cargo_asset_not_found: "Uno degli asset selezionati non risulta nel registro del tenant.",
    delivery_driver_capability_required: "La persona selezionata non ha il ruolo di autista di consegna.",
    vehicle_transport_profile_required: "La risorsa non è configurata come mezzo di trasporto.",
    vehicle_transport_capability_missing: "Al mezzo manca un’abilitazione richiesta per questo carico.",
    vehicle_capacity_exceeded: "Il peso censito supera la portata utile del mezzo.",
    cargo_asset_not_transportable: "Un asset selezionato è escluso dal trasporto.",
    mission_resource_conflict: "Una risorsa ha già un impegno sovrapposto in questa finestra.",
    driver_unavailable: "L’autista non è disponibile nella finestra scelta.",
    vehicle_unavailable: "Il mezzo non è disponibile nella finestra scelta.",
    cargo_asset_unavailable: "Un asset non è disponibile nella finestra scelta.",
    mission_window_invalid: "La finestra temporale non è valida.",
  };
  return result.error ? messages[result.error] ?? "Verifica server-side non superata." : "Verifica server-side non disponibile.";
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
  const [simulationMode, setSimulationMode] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [simulationResult, setSimulationResult] = useState<SimulationResult | null>(null);
  const autoPairedIds = useRef<string[]>([]);

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
      if (driverId) params.set("driverId", driverId);
      void fetch(`/api/mission/resources?${params.toString()}`, { cache: "no-store" })
        .then(async (response) => {
          const payload = await response.json() as { catalog?: ResourceCatalog };
          if (!response.ok || !payload.catalog) throw new Error("mission_resources_unavailable");
          setCatalog(payload.catalog);
          onCargoOptionsChange?.(payload.catalog.cargoAssets.filter((resource) => resource.cargoLoadable));
          setState("ready");
        })
        .catch(() => {
          setCatalog(null);
          setState("error");
        });
    }, 140);
    return () => window.clearTimeout(timer);
  }, [plannedAt, plannedEndAt, transportMode, driverId, onCargoOptionsChange]);

  const selectedDriver = useMemo(() => catalog?.drivers.find((resource) => resource.id === driverId) ?? null, [catalog, driverId]);
  const selectedVehicle = useMemo(() => catalog?.vehicles.find((resource) => resource.id === vehicleId) ?? null, [catalog, vehicleId]);
  const selectableDrivers = useMemo(() => catalog?.drivers.filter((resource) => resource.available) ?? [], [catalog]);
  const selectableVehicles = useMemo(() => catalog?.vehicles.filter((resource) => simulationMode ? resource.simulationEligible : resource.available) ?? [], [catalog, simulationMode]);
  const selectedCargoIds = useMemo(() => cargoAssetIds ?? (cargoAssetId ? [cargoAssetId] : []), [cargoAssetIds, cargoAssetId]);
  const selectedCargoResources = useMemo(() => catalog?.cargoAssets.filter((resource) => selectedCargoIds.includes(resource.id)) ?? [], [catalog, selectedCargoIds]);
  const selectedCargoAssignees = selectedCargoResources.flatMap((resource) => resource.custody
    ? [{ id: resource.id, label: resourceLabel(resource), name: resource.custody.assigneeName, assignmentKind: resource.custody.assignmentKind }]
    : []);
  const selectableCargo = useMemo(() => catalog?.cargoAssets.filter((resource) => resource.cargoLoadable && (simulationMode ? resource.simulationEligible : resource.available)) ?? [], [catalog, simulationMode]);

  useEffect(() => {
    if (!catalog || !vehicleId || !onCargoAssetsChange) {
      autoPairedIds.current = [];
      return;
    }
    const selectedPairs = catalog.vehicles.find((resource) => resource.id === vehicleId)?.pairedCargoAssetIds ?? [];
    const allowedPairs = selectableCargo.filter((resource) => selectedPairs.includes(resource.id)).map((resource) => resource.id);
    const retained = selectedCargoIds.filter((id) => !autoPairedIds.current.includes(id));
    const next = [...new Set([...retained, ...allowedPairs])];
    autoPairedIds.current = allowedPairs;
    if (next.length !== selectedCargoIds.length || next.some((id, index) => id !== selectedCargoIds[index])) onCargoAssetsChange(next);
  }, [catalog, vehicleId, selectableCargo, selectedCargoIds, onCargoAssetsChange]);

  const changeCargoSelection = (assetId: string, checked: boolean) => {
    const next = checked
      ? [...new Set([...selectedCargoIds, assetId])]
      : selectedCargoIds.filter((value) => value !== assetId);
    if (onCargoAssetsChange) onCargoAssetsChange(next);
    else onCargoAssetChange?.(next[0] ?? "");
    setSimulationResult(null);
  };

  async function simulateSelection() {
    if (!driverId || !vehicleId || !plannedAt) return;
    setSimulating(true);
    setSimulationResult(null);
    try {
      const response = await fetch("/api/mission/resources/simulate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ driverId, vehicleId, cargoAssetIds: selectedCargoIds, plannedAt, plannedEndAt: plannedEndAt || undefined, transportMode }),
      });
      const result = await response.json() as SimulationResult;
      if (!response.ok && !result.error) result.error = "mission_resource_simulation_unavailable";
      setSimulationResult(result);
    } catch {
      setSimulationResult({ error: "mission_resource_simulation_unavailable", writesPerformed: false });
    } finally {
      setSimulating(false);
    }
  }

  const hasDate = Boolean(plannedAt);
  const disabled = !hasDate || state === "loading" || state === "error";
  const selectedDriverCustodyMismatch = Boolean(selectedVehicle?.custody && selectedDriver && !sameCustodian(selectedVehicle.custody, selectedDriver));

  return <>
    <input name="simulationOnly" type="hidden" value={simulationMode ? "1" : "0"} />
    <fieldset className="contents" disabled={disabled}>
    <div className="sm:col-span-2 rounded-2xl border border-lime-300/15 bg-lime-300/[0.035] p-3.5">
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/[.08] text-lime-200"><ShieldCheck className="size-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-lime-300/70">RISORSE DAL REGISTRO SERVER-SIDE</p>
          <p className="mt-1 text-[10px] leading-4 text-slate-500">Il mezzo è il vettore; gli asset sono il carico. Tipologia, abilitazioni, custodia, conflitti e finestra vengono ricontrollati dal server.</p>
        </div>
        <span className="shrink-0 text-[9px] font-mono text-slate-600">{state === "loading" ? <LoaderCircle className="size-3.5 animate-spin text-lime-200" /> : catalog?.availability ?? "DATA REQUIRED"}</span>
      </div>
    </div>
    <label className="text-xs text-slate-400">Autista reale<select aria-label="Autista reale" className="mt-2 h-10 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-xs text-slate-100 outline-none focus:border-lime-300/40 focus:ring-2 focus:ring-lime-300/10" name="driverId" onChange={(event) => { onDriverChange(event.target.value); setSimulationResult(null); }} required value={driverId}><option value="">{!hasDate ? "Prima scegli data e ora" : selectableDrivers.length ? "Seleziona autista" : "Nessun autista disponibile"}</option>{selectableDrivers.map((resource) => <option key={resource.id} value={resource.id}>{resourceLabel(resource)}{resource.qualifications.length ? ` · ${resource.qualifications.join(", ")}` : ""}</option>)}</select></label>
    <label className="text-xs text-slate-400">Mezzo di trasporto<select aria-label="Mezzo di trasporto" className="mt-2 h-10 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-xs text-slate-100 outline-none focus:border-lime-300/40 focus:ring-2 focus:ring-lime-300/10" name="vehicleId" onChange={(event) => { onVehicleChange(event.target.value); setSimulationResult(null); }} required value={vehicleId}><option value="">{!hasDate ? "Prima scegli data e ora" : selectableVehicles.length ? "Seleziona mezzo abilitato al trasporto" : "Nessun mezzo disponibile"}</option>{selectableVehicles.map((resource) => <option key={resource.id} value={resource.id}>{resourceLabel(resource)}{resource.custody && !resource.available ? ` · SIMULAZIONE · affidato a ${resource.custody.assigneeName}` : ""}</option>)}</select>{selectedDriverCustodyMismatch && <span className="mt-1.5 block text-[9px] leading-4 text-amber-200">Custodia reale a {selectedVehicle?.custody?.assigneeName}: non selezionabile per una missione reale con questo autista.</span>}{selectedVehicle?.custody && selectedDriver && !selectedDriverCustodyMismatch && <span className="mt-1.5 block text-[9px] leading-4 text-lime-200">Mezzo affidato a {selectedVehicle.custody.assigneeName}: coincide con l’autista selezionato.</span>}</label>
      <div className="sm:col-span-2 rounded-2xl border border-cyan-300/15 bg-cyan-300/[.03] p-3"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-cyan-200/75">CARICO / ASSET TRASPORTATI</p><p className="mt-1 text-[10px] leading-5 text-slate-500">Il mezzo è il vettore. Ogni asset conserva il proprio utilizzatore operativo; autista e utilizzatore possono essere persone diverse. Gli asset abbinati al mezzo vengono proposti se trasportabili e liberi nella finestra.</p></div><span className="shrink-0 rounded-full border border-cyan-300/20 px-2 py-1 font-mono text-[9px] text-cyan-100">{selectedCargoIds.length} SELEZIONATI</span></div><div className="mt-3 space-y-1.5">{catalog?.cargoAssets.filter((resource) => resource.cargoLoadable && (resource.available || resource.simulationEligible || selectedCargoIds.includes(resource.id))).map((resource) => { const selected = selectedCargoIds.includes(resource.id); const usable = simulationMode ? resource.simulationEligible : resource.available; const paired = selectedVehicle?.pairedCargoAssetIds.includes(resource.id) ?? false; return <label className={`flex cursor-pointer items-start gap-2 rounded-xl border p-2.5 text-[10px] ${selected ? "border-lime-300/25 bg-lime-300/[.055]" : "border-white/[.08] bg-black/20"}`} key={resource.id}><input aria-label={`Seleziona carico ${resourceLabel(resource)}`} checked={selected} className="mt-0.5 size-3.5 accent-lime-300" disabled={!usable && !selected} onChange={(event) => changeCargoSelection(resource.id, event.target.checked)} type="checkbox" /><span className="min-w-0 flex-1"><span className="block font-semibold text-slate-200">{resourceLabel(resource)}{paired ? <span className="ml-2 rounded-full border border-lime-300/20 px-1.5 py-0.5 text-[8px] text-lime-200">ABBINATO</span> : null}</span><span className="mt-1 block text-[9px] text-slate-600">{resource.code ?? resource.id}{resource.weightKg !== null ? ` · ${resource.weightKg} kg` : " · peso non censito"}{resource.custody ? ` · utilizzatore operativo: ${resource.custody.assigneeName}` : " · senza assegnatario operativo"}</span></span></label>; }) ?? null}{selectableCargo.length === 0 && <p className="rounded-xl border border-dashed border-cyan-300/15 px-3 py-2 text-[10px] text-slate-600">{!hasDate ? "Inserisci prima data e ora." : "Nessun asset di carico compatibile nella finestra."}</p>}</div><div className="mt-3 rounded-xl border border-lime-300/15 bg-lime-300/[.025] p-3"><p className="text-[9px] font-semibold uppercase tracking-[.14em] text-slate-500">UTILIZZATORE OPERATIVO</p>{selectedCargoAssignees.length ? <div className="mt-1 space-y-1">{selectedCargoAssignees.map((assignee) => <p className="text-[10px] text-slate-200" key={assignee.id}>{assignee.label} <span className="text-slate-500">· resta assegnato a {assignee.name}{assignee.assignmentKind === "LONG_TERM" ? " · lungo termine" : " · temporaneo"}</span></p>)}</div> : <p className="mt-1 text-[10px] text-slate-400">Nessun utilizzatore operativo assegnato. Il ricevente effettivo sarà registrato alla consegna.</p>}<p className="mt-2 text-[9px] leading-4 text-slate-600">La missione registra separatamente lo scarico, il ricevente reale e la prova di consegna; non cambia l’assegnazione dell’asset.</p></div>{transportMode === "ASSET_TRANSFER" && selectedCargoIds.length === 0 && <p className="mt-2 text-[10px] text-rose-200">Seleziona almeno un asset per un trasferimento asset.</p>}</div>
    <div className="sm:col-span-2 rounded-2xl border border-amber-300/15 bg-amber-300/[.025] p-3"><label className="flex items-start gap-2 text-[10px] text-slate-300"><input checked={simulationMode} className="mt-0.5 size-3.5 accent-amber-300" onChange={(event) => { setSimulationMode(event.target.checked); setSimulationResult(null); }} type="checkbox" /><span><span className="block font-semibold text-amber-100">Modalità prova · nessuna missione o prenotazione</span><span className="mt-1 block leading-4 text-slate-500">Mostra risorse impegnate per verificare la finestra. Il server mantiene il vincolo tra assegnatario del mezzo e autista; l’assegnatario operativo del carico può essere diverso. Con la prova attiva, “Crea e rileggi” è bloccato.</span></span></label>{simulationMode && <div className="mt-3"><button className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-amber-300/25 bg-amber-300/[.08] px-3 text-[10px] font-semibold text-amber-100 disabled:opacity-50" disabled={simulating || !driverId || !vehicleId || !hasDate} onClick={() => void simulateSelection()} type="button">{simulating ? <LoaderCircle className="size-3.5 animate-spin" /> : <Truck className="size-3.5" />}Verifica selezione senza salvare</button>{simulationResult?.validation?.result === "PASSED" && <div className="mt-2 rounded-xl border border-lime-300/20 bg-lime-300/[.04] p-3 text-[10px] leading-5 text-lime-100"><p className="font-semibold">Simulazione superata · nessuna scrittura eseguita</p><p className="text-slate-400">Driver, mezzo, carico, capability e finestra sono coerenti. Portata: {simulationResult.validation.capacity?.maxPayloadKg ? `${simulationResult.validation.capacity.knownCargoWeightKg} / ${simulationResult.validation.capacity.maxPayloadKg} kg` : "da censire per controllo peso completo"}{simulationResult.validation.capacity?.unknownCargoCount ? ` · ${simulationResult.validation.capacity.unknownCargoCount} pesi mancanti` : ""}.</p>{simulationResult.custodyOverride?.map((warning) => <p className="text-amber-100" key={warning.resourceId}>Solo prova: {warning.resourceName} resta affidato a {warning.assignedTo}.</p>)}</div>}{simulationResult?.error && <p className="mt-2 flex items-start gap-2 rounded-xl border border-rose-300/20 bg-rose-300/[.04] p-3 text-[10px] leading-5 text-rose-100"><CircleAlert className="mt-0.5 size-3.5 shrink-0" />{simulationErrorMessage(simulationResult)}</p>}</div>}</div>
    {state === "idle" && <p className="text-[10px] text-slate-600 sm:col-span-2">Inserisci la data pianificata per verificare risorse e conflitti.</p>}
    {state === "error" && <p className="text-[10px] text-amber-200 sm:col-span-2">Registro risorse non disponibile: la missione non può essere confermata.</p>}
    {state === "ready" && catalog?.availability === "NO_RESOURCES" && <p className="text-[10px] text-amber-200 sm:col-span-2">Nessuna coppia autista-mezzo reale disponibile in questa finestra. Puoi usare la modalità prova senza prenotare risorse.</p>}
    {state === "ready" && catalog && <p className="text-[10px] text-slate-600 sm:col-span-2">Disponibili per missione reale: {catalog.totals.availableDrivers} autisti · {catalog.totals.availableVehicles} mezzi · {catalog.totals.availableCargoAssets} carichi.</p>}
    </fieldset>
  </>;
}
