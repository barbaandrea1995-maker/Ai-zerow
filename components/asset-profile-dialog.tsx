"use client";

import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, LoaderCircle, MapPin, Package, Truck, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ASSET_USAGE_MODES, TRANSPORT_CAPABILITIES, type AssetUsageMode, type TransportCapability } from "@/lib/asset-contract";

type AssetProfileRecord = {
  id: string;
  canonicalCode?: string;
  title: string;
  detail: string;
  updatedAt: string;
  payload?: Record<string, unknown>;
};

type AssetProfileDialogProps = {
  asset: AssetProfileRecord | null;
  assets: AssetProfileRecord[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  onNotice: (message: string) => void;
};

type EntityType = "asset" | "vehicle" | "equipment";
type SaveResponse = { error?: string; asset?: AssetProfileRecord; readback?: string };
type WarehouseOption = { id: string; code: string; name: string; locationLabel: string; status: string };

const usageLabels: Record<AssetUsageMode, { label: string; detail: string }> = {
  OPERATIONAL: { label: "Operativo", detail: "Attività di cantiere e uso interno; non abilita il mezzo alle consegne." },
  TRANSPORT: { label: "Trasporto", detail: "Mezzo dedicato ai trasporti e alle consegne." },
  DUAL_USE: { label: "Doppio uso", detail: "Può essere impiegato nelle attività e nelle missioni di trasporto." },
};

const capabilityLabels: Record<TransportCapability, string> = {
  MATERIALS: "Materiali",
  ASSETS: "Asset e attrezzature",
  PEOPLE: "Persone",
};

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function selectedType(value: unknown): EntityType {
  const type = stringValue(value).toUpperCase();
  return type === "VEHICLE" ? "vehicle" : type === "EQUIPMENT" ? "equipment" : "asset";
}

function selectedUsage(value: unknown, entityType: EntityType): AssetUsageMode {
  const mode = stringValue(value).toUpperCase();
  if ((ASSET_USAGE_MODES as readonly string[]).includes(mode)) return mode as AssetUsageMode;
  return entityType === "vehicle" ? "TRANSPORT" : "OPERATIONAL";
}

export function AssetProfileDialog(props: AssetProfileDialogProps) {
  const { asset, open, onOpenChange } = props;
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto border-lime-300/20 bg-[#080c09] text-slate-100 sm:max-w-[700px]">
      {open && asset && <AssetProfileForm key={`${asset.id}:${asset.updatedAt}`} {...props} asset={asset} />}
    </DialogContent>
  </Dialog>;
}

function AssetProfileForm({ asset, assets, onOpenChange, onSaved, onNotice }: Omit<AssetProfileDialogProps, "open"> & { asset: AssetProfileRecord }) {
  const payload = asset.payload ?? {};
  const initialType = selectedType(payload.entityType);
  const initialUsage = selectedUsage(payload.usageMode ?? payload.operationalProfile, initialType);
  const [title, setTitle] = useState(() => stringValue(payload.title || payload.description, asset.detail || asset.title));
  const [entityType, setEntityType] = useState<EntityType>(initialType);
  const [usageMode, setUsageMode] = useState<AssetUsageMode>(initialUsage);
  const [transportCapabilities, setTransportCapabilities] = useState<TransportCapability[]>(() => Array.isArray(payload.transportCapabilities)
    ? payload.transportCapabilities.filter((value): value is TransportCapability => typeof value === "string" && (TRANSPORT_CAPABILITIES as readonly string[]).includes(value.toUpperCase())).map((value) => value.toUpperCase() as TransportCapability)
    : initialUsage === "OPERATIONAL" ? [] : ["MATERIALS", "ASSETS"]);
  const [brand, setBrand] = useState(() => stringValue(payload.brand));
  const [model, setModel] = useState(() => stringValue(payload.model));
  const [registration, setRegistration] = useState(() => stringValue(payload.registration));
  const [serialNumber, setSerialNumber] = useState(() => stringValue(payload.serialNumber));
  const [warehouseId, setWarehouseId] = useState(() => stringValue(objectValue(payload.physicalCustody).warehouseId || payload.warehouseId));
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [warehousesBusy, setWarehousesBusy] = useState(true);
  const [capacity, setCapacity] = useState(() => payload.capacity === undefined || payload.capacity === null ? "" : String(payload.capacity));
  const [maxPayloadKg, setMaxPayloadKg] = useState(() => payload.maxPayloadKg === undefined || payload.maxPayloadKg === null ? "" : String(payload.maxPayloadKg));
  const [weightKg, setWeightKg] = useState(() => payload.weightKg === undefined || payload.weightKg === null ? "" : String(payload.weightKg));
  const [transportable, setTransportable] = useState(payload.transportable !== false);
  const [pairedCargoAssetIds, setPairedCargoAssetIds] = useState<string[]>(() => Array.isArray(payload.pairedCargoAssetIds) ? payload.pairedCargoAssetIds.filter((value): value is string => typeof value === "string") : []);
  const [notes, setNotes] = useState(() => stringValue(payload.notes));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void fetch("/api/authority/warehouses", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as { warehouses?: WarehouseOption[]; error?: string };
        if (!response.ok) throw new Error(result.error ?? "warehouse_readback_unavailable");
        if (active) setWarehouses((result.warehouses ?? []).filter((warehouse) => warehouse.status === "active"));
      })
      .catch(() => { if (active) setError("Il catalogo ubicazioni server-side non è disponibile. Riprova prima di salvare."); })
      .finally(() => { if (active) setWarehousesBusy(false); });
    return () => { active = false; };
  }, []);

  function toggleCapability(capability: TransportCapability) {
    setTransportCapabilities((current) => current.includes(capability)
      ? current.filter((entry) => entry !== capability)
      : [...current, capability]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!asset) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/assets/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          assetId: asset.id,
          expectedUpdatedAt: asset.updatedAt,
          idempotencyKey: `asset-profile-${asset.id}-${crypto.randomUUID()}`,
          title,
          entityType,
          usageMode,
          transportCapabilities: usageMode === "OPERATIONAL" ? [] : transportCapabilities,
          brand,
          model,
          registration,
          serialNumber,
          warehouseId,
          capacity,
          maxPayloadKg: entityType === "vehicle" ? maxPayloadKg : "",
          weightKg: entityType === "vehicle" ? "" : weightKg,
          transportable: entityType === "vehicle" ? false : transportable,
          pairedCargoAssetIds: entityType === "vehicle" ? pairedCargoAssetIds : [],
          notes,
        }),
      });
      const result = await response.json() as SaveResponse;
      if (!response.ok) throw new Error(result.error ?? "asset_profile_write_unavailable");
      onOpenChange(false);
      onSaved();
      onNotice(result.readback === "verified" ? "Scheda risorsa aggiornata e riletta dal server." : "Modifiche asset salvate.");
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "asset_profile_write_unavailable";
      const messages: Record<string, string> = {
        version_conflict: "La scheda è cambiata in un’altra sessione. Rileggi i dati e riprova.",
        forbidden: "Il tuo ruolo non può modificare questa risorsa.",
        asset_scope_forbidden: "La risorsa è fuori dal tuo perimetro operativo.",
        transport_capability_required: "Seleziona almeno un tipo di trasporto consentito.",
        asset_warehouse_not_found: "Il magazzino selezionato non è più attivo.",
        asset_warehouse_location_not_canonical: "Il magazzino non ha ancora un luogo server-side verificato.",
      };
      setError(messages[code] ?? "Modifica non salvata. Verifica i dati e riprova.");
    } finally {
      setSaving(false);
    }
  }

  const typeOptions: Array<{ value: EntityType; label: string; icon: typeof Package }> = [
    { value: "asset", label: "Asset operativo", icon: Package },
    { value: "vehicle", label: "Mezzo", icon: Truck },
    { value: "equipment", label: "Attrezzatura", icon: Wrench },
  ];
  const pairOptions = assets.filter((candidate) => {
    if (!asset || candidate.id === asset.id) return false;
    const type = stringValue(candidate.payload?.entityType).toUpperCase();
    return type !== "VEHICLE" && (candidate.payload?.transportable !== false || pairedCargoAssetIds.includes(candidate.id));
  });

  return <form className="space-y-4" onSubmit={submit}>
        <DialogHeader>
          <DialogTitle>Modifica scheda risorsa</DialogTitle>
          <DialogDescription className="text-slate-500">Tipologia e profilo descrivono l’uso fisico della risorsa. L’affidamento identifica chi la utilizza sul campo; ogni missione registra separatamente autista e mezzo vettore. Solo “Mezzo” crea un vettore di trasporto, mentre “Attrezzatura” o “Asset” possono essere il carico. Il codice canonico resta invariato e le missioni rileggono il profilo dal server.</DialogDescription>
        </DialogHeader>
        {asset && <div className="flex items-center justify-between gap-3 rounded-xl border border-cyan-300/15 bg-cyan-300/[.035] p-3"><div><p className="text-[9px] font-semibold uppercase tracking-[.14em] text-cyan-100/70">CODICE CANONICO</p><p className="mt-1 font-mono text-xs text-slate-200">{asset.canonicalCode ?? asset.id}</p></div><span className="text-right text-[9px] leading-4 text-slate-500">Identificativo stabile<br />QR e storico conservati</span></div>}
        <label className="block text-xs text-slate-400">Denominazione<Input autoFocus className="mt-2 border-white/10 bg-black/30 text-slate-100" maxLength={120} onChange={(event) => setTitle(event.target.value)} required value={title} /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-slate-400">Tipologia · mezzo o carico<select className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-slate-100" onChange={(event) => { const next = event.target.value as EntityType; setEntityType(next); if (next === "vehicle" && usageMode === "OPERATIONAL") { setUsageMode("TRANSPORT"); setTransportCapabilities((current) => current.length ? current : ["MATERIALS", "ASSETS"]); } if (next !== "vehicle" && usageMode === "TRANSPORT") setUsageMode("OPERATIONAL"); }} value={entityType}>{typeOptions.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="text-xs text-slate-400">Profilo di utilizzo<select className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-slate-100" onChange={(event) => { const next = event.target.value as AssetUsageMode; setUsageMode(next); if (next !== "OPERATIONAL" && !transportCapabilities.length) setTransportCapabilities(["MATERIALS", "ASSETS"]); }} value={usageMode}>{ASSET_USAGE_MODES.map((value) => <option key={value} value={value}>{usageLabels[value].label}</option>)}</select></label>
        </div>
        <p className="-mt-2 text-[10px] leading-4 text-slate-600">{usageLabels[usageMode].detail}</p>
        {usageMode !== "OPERATIONAL" && <section className="rounded-xl border border-cyan-300/15 bg-cyan-300/[.03] p-3"><p className="text-[9px] font-semibold uppercase tracking-[.14em] text-cyan-100/75">ABILITAZIONI DI TRASPORTO</p><div className="mt-2 flex flex-wrap gap-2">{TRANSPORT_CAPABILITIES.map((capability) => { const active = transportCapabilities.includes(capability); return <button aria-pressed={active} className={`rounded-lg border px-3 py-2 text-[10px] ${active ? "border-lime-300/35 bg-lime-300/10 text-lime-100" : "border-white/10 bg-black/20 text-slate-500"}`} key={capability} onClick={() => toggleCapability(capability)} type="button">{capabilityLabels[capability]}</button>; })}</div><p className="mt-2 text-[9px] text-slate-600">Per usare l’Iveco nelle consegne, abilita “Materiali”.</p></section>}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-slate-400">Marca<Input className="mt-2 border-white/10 bg-black/30 text-slate-100" maxLength={80} onChange={(event) => setBrand(event.target.value)} value={brand} /></label>
          <label className="text-xs text-slate-400">Modello<Input className="mt-2 border-white/10 bg-black/30 text-slate-100" maxLength={100} onChange={(event) => setModel(event.target.value)} value={model} /></label>
          <label className="text-xs text-slate-400">Targa / identificativo<Input className="mt-2 border-white/10 bg-black/30 text-slate-100" maxLength={40} onChange={(event) => setRegistration(event.target.value)} value={registration} /></label>
          <label className="text-xs text-slate-400">Numero seriale<Input className="mt-2 border-white/10 bg-black/30 text-slate-100" maxLength={120} onChange={(event) => setSerialNumber(event.target.value)} value={serialNumber} /></label>
          <label className="text-xs text-slate-400">Ubicazione fisica · registro server-side<span className="relative mt-2 block"><MapPin className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-cyan-200/70" /><select className="h-11 w-full rounded-xl border border-white/10 bg-black/30 pl-10 pr-3 text-sm text-slate-100" disabled={warehousesBusy} onChange={(event) => setWarehouseId(event.target.value)} value={warehouseId}><option value="">Ubicazione da definire</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name} · {warehouse.locationLabel}</option>)}</select></span><span className="mt-1 block text-[9px] leading-4 text-slate-600">La posizione fisica è separata da affidamento personale, autista e missione.</span></label>
          <label className="text-xs text-slate-400">Capacità nominale catalogo<Input className="mt-2 border-white/10 bg-black/30 text-slate-100" min="0" onChange={(event) => setCapacity(event.target.value)} step="0.01" type="number" value={capacity} /></label>
        </div>
        {entityType === "vehicle" ? <section className="rounded-xl border border-cyan-300/15 bg-cyan-300/[.03] p-3"><label className="block text-xs text-slate-400">Portata utile massima (kg)<Input className="mt-2 border-white/10 bg-black/30 text-slate-100" min="0.01" onChange={(event) => setMaxPayloadKg(event.target.value)} placeholder="Dato tecnico del mezzo" step="0.01" type="number" value={maxPayloadKg} /></label><p className="mt-2 text-[9px] leading-4 text-slate-600">Separata dalla capacità generica. Se censita, il server controlla il peso totale del carico prima di registrare la missione.</p><div className="mt-3"><p className="text-[10px] font-semibold uppercase tracking-[.14em] text-cyan-100/75">ASSET ABBINATI AL MEZZO</p><p className="mt-1 text-[9px] leading-4 text-slate-600">Collega qui l’attrezzatura che viaggia stabilmente con questo veicolo; in missione verrà proposta automaticamente, senza confondere la custodia personale.</p><div className="mt-2 max-h-44 space-y-1 overflow-y-auto">{pairOptions.length ? pairOptions.map((candidate) => { const checked = pairedCargoAssetIds.includes(candidate.id); const name = stringValue(candidate.payload?.title || candidate.payload?.description, candidate.detail || candidate.title); const modelLabel = [stringValue(candidate.payload?.brand), stringValue(candidate.payload?.model), stringValue(candidate.payload?.registration)].filter(Boolean).join(" · "); const disabled = candidate.payload?.transportable === false && !checked; return <label className="flex items-start gap-2 rounded-lg border border-white/[.07] bg-black/20 p-2.5 text-[10px] text-slate-300" key={candidate.id}><input checked={checked} className="mt-0.5 size-3.5 accent-lime-300" disabled={disabled} onChange={(event) => setPairedCargoAssetIds((current) => event.target.checked ? [...new Set([...current, candidate.id])] : current.filter((id) => id !== candidate.id))} type="checkbox" /><span className="min-w-0"><span className="block font-semibold text-slate-200">{name}</span><span className="mt-0.5 block text-[9px] text-slate-600">{[candidate.canonicalCode || candidate.id, modelLabel].filter(Boolean).join(" · ")}{candidate.payload?.transportable === false ? " · non trasportabile" : ""}</span></span></label>; }) : <p className="rounded-lg border border-dashed border-white/10 p-3 text-[10px] text-slate-600">Nessun asset trasportabile nel catalogo.</p>}</div></div></section> : <section className="rounded-xl border border-cyan-300/15 bg-cyan-300/[.03] p-3"><label className="flex items-start gap-2 text-xs text-slate-300"><input checked={transportable} className="mt-0.5 size-4 accent-lime-300" onChange={(event) => setTransportable(event.target.checked)} type="checkbox" /><span><span className="block font-semibold">Trasportabile come carico</span><span className="mt-1 block text-[9px] leading-4 text-slate-600">Esclude questa risorsa dal manifesto quando non è un bene fisico trasportabile.</span></span></label><label className="mt-3 block text-xs text-slate-400">Peso dell’asset (kg)<Input className="mt-2 border-white/10 bg-black/30 text-slate-100" min="0.01" onChange={(event) => setWeightKg(event.target.value)} placeholder="Opzionale, da scheda tecnica" step="0.01" type="number" value={weightKg} /></label></section>}
        <label className="block text-xs text-slate-400">Note<Textarea className="mt-2 border-white/10 bg-black/30 text-slate-100" maxLength={2000} onChange={(event) => setNotes(event.target.value)} value={notes} /></label>
        {error && <p className="rounded-xl border border-rose-300/20 bg-rose-300/[.05] p-3 text-[10px] leading-5 text-rose-100">{error}</p>}
        <DialogFooter><DialogClose asChild><Button className="border-white/10 bg-transparent text-slate-400" type="button" variant="outline">Annulla</Button></DialogClose><Button className="bg-lime-300 font-semibold text-[#050705] hover:bg-lime-200" disabled={saving || warehousesBusy || !asset} type="submit">{saving || warehousesBusy ? <LoaderCircle className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}Salva modifiche</Button></DialogFooter>
  </form>;
}
