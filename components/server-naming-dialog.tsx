"use client";

import { useState, type FormEvent } from "react";
import { Package, Send, Truck, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type CreateModule = "assets" | "warehouse";
type AssetType = "asset" | "vehicle" | "equipment";

type ServerNamingDialogProps = {
  module: CreateModule;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  onNotice: (message: string) => void;
};

type CreateResponse = {
  created?: { canonicalCode?: string; id?: string };
  error?: string;
};

const assetTypes: { value: AssetType; label: string; icon: typeof Package }[] = [
  { value: "asset", label: "Asset", icon: Package },
  { value: "vehicle", label: "Mezzo", icon: Truck },
  { value: "equipment", label: "Attrezzatura", icon: Wrench },
];

export function ServerNamingDialog({ module, open, onOpenChange, onCreated, onNotice }: ServerNamingDialogProps) {
  const [description, setDescription] = useState("");
  const [assetType, setAssetType] = useState<AssetType>("asset");
  const [barcode, setBarcode] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isWarehouse = module === "warehouse";

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanDescription = description.trim();
    if (cleanDescription.length < 2) {
      setError("Inserisci una descrizione di almeno 2 caratteri.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/${module}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: cleanDescription,
          detail: cleanDescription,
          meta: isWarehouse ? "Materiale da catalogare" : assetType === "vehicle" ? "Mezzo da catalogare" : assetType === "equipment" ? "Attrezzatura da catalogare" : "Asset da catalogare",
          status: "OPERATIVO",
          tone: "lime",
          progress: 0,
          recordType: isWarehouse ? "inventory-item" : "asset-register",
          entityType: isWarehouse ? "material" : assetType,
          barcode: barcode.trim() || undefined,
          idempotencyKey: `s04-${module}-${crypto.randomUUID()}`,
        }),
      });
      const payload = (await response.json()) as CreateResponse;
      if (!response.ok) throw new Error(payload.error ?? "server_naming_failed");

      const code = payload.created?.canonicalCode ?? payload.created?.id ?? "assegnato";
      onCreated();
      onOpenChange(false);
      onNotice(`Codice server assegnato: ${code}`);
      setDescription("");
      setBarcode("");
      setAssetType("asset");
    } catch (caught) {
      setError(caught instanceof Error && caught.message === "canonical_code_conflict"
        ? "Questo barcode è già registrato nel tenant."
        : "Salvataggio non disponibile: riprova tra poco.");
    } finally {
      setSaving(false);
    }
  };

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="border-lime-300/20 bg-[#0a0d0e] text-slate-100 sm:max-w-[520px]">
      <form className="space-y-4" onSubmit={handleSubmit}>
        <DialogHeader>
          <DialogTitle className="text-slate-100">{isWarehouse ? "Registra materiale" : "Registra asset"}</DialogTitle>
          <DialogDescription className="text-slate-500">Il server assegna il codice canonico e lo conserva nel readback D1. Il barcode, se presente, resta invariato.</DialogDescription>
        </DialogHeader>
        {!isWarehouse && <label className="block space-y-2"><span className="text-xs text-slate-400">Tipologia</span><select aria-label="Tipologia asset" className="h-10 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-xs text-slate-100 outline-none focus:border-lime-300/40" value={assetType} onChange={(event) => setAssetType(event.target.value as AssetType)}>{assetTypes.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}</select></label>}
        <label className="block space-y-2"><span className="text-xs text-slate-400">Descrizione</span><Input autoFocus className="border-white/10 bg-black/30 text-slate-100" onChange={(event) => setDescription(event.target.value)} placeholder={isWarehouse ? "Es. Chiusini di ghisa da 50x50" : "Es. Furgone operativo o martello demolitore"} value={description} /></label>
        <label className="block space-y-2"><span className="text-xs text-slate-400">Barcode <span className="text-slate-600">(opzionale)</span></span><Input className="border-white/10 bg-black/30 font-mono text-slate-100" onChange={(event) => setBarcode(event.target.value)} placeholder="Lascia vuoto per il codice automatico" value={barcode} /></label>
        {error && <p className="rounded-lg border border-rose-300/20 bg-rose-300/5 px-3 py-2 text-[11px] text-rose-200">{error}</p>}
        <DialogFooter><DialogClose asChild><Button type="button" variant="outline" className="border-white/10 bg-transparent text-slate-400">Annulla</Button></DialogClose><Button type="submit" disabled={saving} className="bg-lime-300 text-[#060806] hover:bg-lime-200"><Send className="size-3.5" />{saving ? "Salvataggio…" : "Registra"}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
