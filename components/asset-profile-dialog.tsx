"use client";

import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, LoaderCircle, Package, Truck, Wrench } from "lucide-react";
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
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  onNotice: (message: string) => void;
};

type EntityType = "asset" | "vehicle" | "equipment";
type SaveResponse = { error?: string; asset?: AssetProfileRecord; readback?: string };

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

function selectedType(value: unknown): EntityType {
  const type = stringValue(value).toUpperCase();
  return type === "VEHICLE" ? "vehicle" : type === "EQUIPMENT" ? "equipment" : "asset";
}

function selectedUsage(value: unknown, entityType: EntityType): AssetUsageMode {
  const mode = stringValue(value).toUpperCase();
  if ((ASSET_USAGE_MODES as readonly string[]).includes(mode)) return mode as AssetUsageMode;
  return entityType === "vehicle" ? "TRANSPORT" : "OPERATIONAL";
}

export function AssetProfileDialog({ asset, open, onOpenChange, onSaved, onNotice }: AssetProfileDialogProps) {
  const [title, setTitle] = useState("");
  const [entityType, setEntityType] = useState<EntityType>("asset");
  const [usageMode, setUsageMode] = useState<AssetUsageMode>("OPERATIONAL");
  const [transportCapabilities, setTransportCapabilities] = useState<TransportCapability[]>([]);
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [registration, setRegistration] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [location, setLocation] = useState("");
  const [capacity, setCapacity] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !asset) return;
    const payload = asset.payload ?? {};
    const nextType = selectedType(payload.entityType);
    const nextUsage = selectedUsage(payload.usageMode ?? payload.operationalProfile, nextType);
    setTitle(stringValue(payload.title || payload.description, asset.detail || asset.title));
    setEntityType(nextType);
    setUsageMode(nextUsage);
    setTransportCapabilities(Array.isArray(payload.transportCapabilities)
      ? payload.transportCapabilities.filter((value): value is TransportCapability => typeof value === "string" && (TRANSPORT_CAPABILITIES as readonly string[]).includes(value.toUpperCase())).map((value) => value.toUpperCase() as TransportCapability)
      : nextUsage === "OPERATIONAL" ? [] : ["MATERIALS", "ASSETS"]);
    setBrand(stringValue(payload.brand));
    setModel(stringValue(payload.model));
    setRegistration(stringValue(payload.registration));
    setSerialNumber(stringValue(payload.serialNumber));
    setLocation(stringValue(payload.location));
    setCapacity(payload.capacity === undefined || payload.capacity === null ? "" : String(payload.capacity));
    setNotes(stringValue(payload.notes));
    setError("");
  }, [asset, open]);

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
          location,
          capacity,
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

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto border-lime-300/20 bg-[#080c09] text-slate-100 sm:max-w-[700px]">
      <form className="space-y-4" onSubmit={submit}>
        <DialogHeader>
          <DialogTitle>Modifica scheda risorsa</DialogTitle>
          <DialogDescription className="text-slate-500">Identità, utilizzo e dati tecnici vengono aggiornati nel registro tenant. Il codice canonico resta invariato; le missioni rileggeranno il nuovo profilo dal server.</DialogDescription>
        </DialogHeader>
        {asset && <div className="flex items-center justify-between gap-3 rounded-xl border border-cyan-300/15 bg-cyan-300/[.035] p-3"><div><p className="text-[9px] font-semibold uppercase tracking-[.14em] text-cyan-100/70">CODICE CANONICO</p><p className="mt-1 font-mono text-xs text-slate-200">{asset.canonicalCode ?? asset.id}</p></div><span className="text-right text-[9px] leading-4 text-slate-500">Identificativo stabile<br />QR e storico conservati</span></div>}
        <label className="block text-xs text-slate-400">Denominazione<Input autoFocus className="mt-2 border-white/10 bg-black/30 text-slate-100" maxLength={120} onChange={(event) => setTitle(event.target.value)} required value={title} /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-slate-400">Tipologia<select className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-slate-100" onChange={(event) => { const next = event.target.value as EntityType; setEntityType(next); if (next === "vehicle" && usageMode === "OPERATIONAL") { setUsageMode("TRANSPORT"); setTransportCapabilities((current) => current.length ? current : ["MATERIALS", "ASSETS"]); } if (next !== "vehicle" && usageMode === "TRANSPORT") setUsageMode("OPERATIONAL"); }} value={entityType}>{typeOptions.map(({ value, label, icon: Icon }) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="text-xs text-slate-400">Profilo di utilizzo<select className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-slate-100" onChange={(event) => { const next = event.target.value as AssetUsageMode; setUsageMode(next); if (next !== "OPERATIONAL" && !transportCapabilities.length) setTransportCapabilities(["MATERIALS", "ASSETS"]); }} value={usageMode}>{ASSET_USAGE_MODES.map((value) => <option key={value} value={value}>{usageLabels[value].label}</option>)}</select></label>
        </div>
        <p className="-mt-2 text-[10px] leading-4 text-slate-600">{usageLabels[usageMode].detail}</p>
        {usageMode !== "OPERATIONAL" && <section className="rounded-xl border border-cyan-300/15 bg-cyan-300/[.03] p-3"><p className="text-[9px] font-semibold uppercase tracking-[.14em] text-cyan-100/75">ABILITAZIONI DI TRASPORTO</p><div className="mt-2 flex flex-wrap gap-2">{TRANSPORT_CAPABILITIES.map((capability) => { const active = transportCapabilities.includes(capability); return <button aria-pressed={active} className={`rounded-lg border px-3 py-2 text-[10px] ${active ? "border-lime-300/35 bg-lime-300/10 text-lime-100" : "border-white/10 bg-black/20 text-slate-500"}`} key={capability} onClick={() => toggleCapability(capability)} type="button">{capabilityLabels[capability]}</button>; })}</div><p className="mt-2 text-[9px] text-slate-600">Per usare l’Iveco nelle consegne, abilita “Materiali”.</p></section>}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-slate-400">Marca<Input className="mt-2 border-white/10 bg-black/30 text-slate-100" maxLength={80} onChange={(event) => setBrand(event.target.value)} value={brand} /></label>
          <label className="text-xs text-slate-400">Modello<Input className="mt-2 border-white/10 bg-black/30 text-slate-100" maxLength={100} onChange={(event) => setModel(event.target.value)} value={model} /></label>
          <label className="text-xs text-slate-400">Targa / identificativo<Input className="mt-2 border-white/10 bg-black/30 text-slate-100" maxLength={40} onChange={(event) => setRegistration(event.target.value)} value={registration} /></label>
          <label className="text-xs text-slate-400">Numero seriale<Input className="mt-2 border-white/10 bg-black/30 text-slate-100" maxLength={120} onChange={(event) => setSerialNumber(event.target.value)} value={serialNumber} /></label>
          <label className="text-xs text-slate-400">Ubicazione<Input className="mt-2 border-white/10 bg-black/30 text-slate-100" maxLength={240} onChange={(event) => setLocation(event.target.value)} value={location} /></label>
          <label className="text-xs text-slate-400">Portata / capacità<Input className="mt-2 border-white/10 bg-black/30 text-slate-100" min="0" onChange={(event) => setCapacity(event.target.value)} step="0.01" type="number" value={capacity} /></label>
        </div>
        <label className="block text-xs text-slate-400">Note<Textarea className="mt-2 border-white/10 bg-black/30 text-slate-100" maxLength={2000} onChange={(event) => setNotes(event.target.value)} value={notes} /></label>
        {error && <p className="rounded-xl border border-rose-300/20 bg-rose-300/[.05] p-3 text-[10px] leading-5 text-rose-100">{error}</p>}
        <DialogFooter><DialogClose asChild><Button className="border-white/10 bg-transparent text-slate-400" type="button" variant="outline">Annulla</Button></DialogClose><Button className="bg-lime-300 font-semibold text-[#050705] hover:bg-lime-200" disabled={saving || !asset} type="submit">{saving ? <LoaderCircle className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}Salva modifiche</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
