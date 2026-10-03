"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Building2, CheckCircle2, Crosshair, LoaderCircle, MapPin, Plus, RefreshCw, ShieldCheck, Warehouse, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type WarehouseLocation = {
  id: string;
  code: string;
  name: string;
  locationLabel: string;
  coordinates: { latitude: number; longitude: number };
  geofence: { radiusMeters: number; status: string };
  locationSource: string;
  locationStatus: string;
  status: string;
  version: number;
  updatedAt: string;
};

type WarehousePayload = {
  warehouses?: WarehouseLocation[];
  readback?: { status?: string; checkedAt?: string };
  error?: string;
};

function errorLabel(error: string | undefined) {
  if (error === "warehouse_name_required") return "Inserisci il nome del magazzino.";
  if (error === "warehouse_location_required") return "Inserisci un luogo o indirizzo operativo.";
  if (error === "server_coordinates_required") return "Servono coordinate valide: usa la posizione del dispositivo o inseriscile manualmente.";
  if (error === "geofence_radius_must_be_25_to_5000_meters") return "Il geofence deve essere compreso tra 25 e 5.000 metri.";
  return "Configurazione magazzino non completata.";
}

function numberOrEmpty(value: number) {
  return Number.isFinite(value) ? value.toFixed(6) : "";
}

export default function TenantWarehouseControl({
  canManage,
  onNotify,
}: {
  canManage: boolean;
  onNotify: (message: string) => void;
}) {
  const [warehouses, setWarehouses] = useState<WarehouseLocation[]>([]);
  const [readbackStatus, setReadbackStatus] = useState("CHECKING");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [geoBusy, setGeoBusy] = useState(false);
  const [geoSource, setGeoSource] = useState<"manual" | "browser_geolocation">("manual");

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/authority/warehouses", { cache: "no-store" });
      const payload = await response.json() as WarehousePayload;
      if (!response.ok) throw new Error(payload.error ?? "warehouse_location_readback_unavailable");
      setWarehouses(payload.warehouses ?? []);
      setReadbackStatus(payload.readback?.status === "verified" ? "VERIFIED" : "CHECKING");
      setLoading(false);
    } catch (error) {
      setLoading(false);
      onNotify(errorLabel(error instanceof Error ? error.message : undefined));
    } finally {
      setRefreshing(false);
    }
  }, [onNotify]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  function useDeviceLocation() {
    if (!navigator.geolocation) {
      onNotify("Geolocalizzazione browser non disponibile: inserisci le coordinate manualmente.");
      return;
    }
    setGeoBusy(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const form = document.querySelector<HTMLFormElement>("#tenant-warehouse-form");
        if (form) {
          const latitude = form.elements.namedItem("latitude");
          const longitude = form.elements.namedItem("longitude");
          if (latitude instanceof HTMLInputElement) latitude.value = numberOrEmpty(position.coords.latitude);
          if (longitude instanceof HTMLInputElement) longitude.value = numberOrEmpty(position.coords.longitude);
        }
        setGeoSource("browser_geolocation");
        setGeoBusy(false);
        onNotify("Coordinate rilevate. Conferma il luogo e salva il magazzino.");
      },
      () => {
        setGeoBusy(false);
        onNotify("Posizione non disponibile: inserisci le coordinate manualmente.");
      },
      { enableHighAccuracy: true, maximumAge: 60_000, timeout: 10_000 },
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const field = (key: string) => {
      const value = form.get(key);
      return typeof value === "string" ? value.trim() : "";
    };
    setBusy(true);
    try {
      const response = await fetch("/api/authority/warehouses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: field("name"),
          locationLabel: field("locationLabel"),
          latitude: field("latitude"),
          longitude: field("longitude"),
          geofenceRadiusMeters: field("geofenceRadiusMeters"),
          locationSource: geoSource,
        }),
      });
      const payload = await response.json() as WarehousePayload;
      if (!response.ok) {
        onNotify(errorLabel(payload.error));
        return;
      }
      setWarehouses(payload.warehouses ?? []);
      setReadbackStatus(payload.readback?.status === "verified" ? "VERIFIED" : "CHECKING");
      setOpen(false);
      formElement.reset();
      setGeoSource("manual");
      onNotify("Magazzino creato e riletto dal server con geofence attivo.");
    } catch {
      onNotify("Servizio magazzini temporaneamente non disponibile.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="carbon-card carbon-card-neon mb-5 rounded-[24px] p-4 sm:p-5" aria-labelledby="tenant-warehouse-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="grid size-10 place-items-center rounded-2xl border border-lime-300/25 bg-lime-300/10 text-lime-200"><Warehouse className="size-4" /></span>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/70">ONBOARDING / WAREHOUSE NETWORK</p>
            <h2 className="mt-1 text-[16px] font-semibold text-slate-100" id="tenant-warehouse-title">Magazzini dell’azienda</h2>
            <p className="mt-1 max-w-2xl text-[11px] leading-5 text-slate-500">Il tenant può avere uno o più depositi. Ogni ubicazione viene validata dal server con coordinate e zona geofence, poi diventa selezionabile nella registrazione materiale.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-lg border border-lime-300/20 bg-lime-300/[.04] px-3 py-2 font-mono text-[9px] text-lime-200">{readbackStatus} · {warehouses.length} LOCATIONS</span>
          <Button className="h-9 border border-white/10 bg-black/25 text-xs text-slate-300 hover:border-lime-300/30 hover:bg-lime-300/[.06]" onClick={() => void refresh()} type="button" variant="outline"><RefreshCw className={refreshing ? "size-3.5 animate-spin" : "size-3.5"} />Rileggi</Button>
          <Button className="h-9 bg-lime-300 text-xs font-semibold text-[#060806] hover:bg-lime-200 disabled:opacity-40" disabled={!canManage} onClick={() => setOpen(true)} type="button"><Plus className="size-3.5" />Nuovo magazzino</Button>
        </div>
      </div>

      {loading ? <div className="mt-5 flex items-center gap-2 rounded-xl border border-white/[.08] bg-black/20 p-4 text-xs text-slate-500"><LoaderCircle className="size-4 animate-spin text-lime-300" />Readback magazzini tenant…</div> : warehouses.length === 0 ? <div className="mt-5 rounded-2xl border border-dashed border-lime-300/20 bg-lime-300/[.025] p-6 text-center"><Building2 className="mx-auto size-7 text-slate-600" /><p className="mt-3 text-sm font-semibold text-slate-300">Nessun magazzino configurato</p><p className="mt-1 text-[11px] text-slate-600">Crea il primo deposito prima di registrare materiali senza barcode.</p></div> : <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{warehouses.map((warehouse) => <article className="rounded-2xl border border-white/[.08] bg-black/20 p-4" key={warehouse.id}><div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/[.07] text-lime-200"><MapPin className="size-4" /></span><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-100">{warehouse.name}</p><p className="mt-1 font-mono text-[10px] text-lime-200/70">{warehouse.code} · v{warehouse.version}</p></div></div><span className="rounded-full border border-lime-300/20 bg-lime-300/[.05] px-2 py-1 text-[9px] uppercase text-lime-200">{warehouse.status}</span></div><p className="mt-4 truncate text-xs text-slate-300">{warehouse.locationLabel}</p><div className="mt-3 grid grid-cols-2 gap-2 text-[10px]"><div className="carbon-inset rounded-lg p-2"><span className="block uppercase tracking-[.12em] text-slate-600">Coordinate</span><span className="mt-1 block font-mono text-slate-300">{warehouse.coordinates.latitude.toFixed(5)}, {warehouse.coordinates.longitude.toFixed(5)}</span></div><div className="carbon-inset rounded-lg p-2"><span className="block uppercase tracking-[.12em] text-slate-600">Geofence</span><span className="mt-1 block font-mono text-lime-200">{warehouse.geofence.radiusMeters} m</span></div></div><div className="mt-3 flex items-center gap-2 text-[9px] text-slate-600"><CheckCircle2 className="size-3.5 text-lime-300" />{warehouse.locationStatus} · server readback</div></article>)}</div>}

      <div className="mt-4 flex items-start gap-2 rounded-xl border border-cyan-300/15 bg-cyan-300/[.035] p-3 text-[10px] leading-5 text-cyan-100/70"><ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-cyan-200" />Il luogo non viene inventato dal client: il server conserva coordinate normalizzate, raggio e origine della rilevazione. Un geocoder esterno potrà essere collegato in seguito senza cambiare il contratto tenant.</div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="border-lime-300/20 bg-[#090d0a] text-slate-100 sm:max-w-[620px]">
          <form id="tenant-warehouse-form" className="space-y-4" onSubmit={submit}>
            <DialogHeader><DialogTitle>Configura un magazzino</DialogTitle><DialogDescription className="text-slate-500">Nome, luogo operativo, coordinate e raggio geofence. Il server assegna il codice e valida il perimetro.</DialogDescription></DialogHeader>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-xs text-slate-400 sm:col-span-2" htmlFor="warehouse-name">Nome magazzino<Input id="warehouse-name" name="name" placeholder="Es. Deposito Milano Nord" required /></label>
              <label className="grid gap-2 text-xs text-slate-400 sm:col-span-2" htmlFor="warehouse-location">Luogo riconoscibile<Input id="warehouse-location" name="locationLabel" placeholder="Via, città o riferimento operativo" required /></label>
              <label className="grid gap-2 text-xs text-slate-400" htmlFor="warehouse-latitude">Latitudine<Input id="warehouse-latitude" name="latitude" placeholder="45.464211" inputMode="decimal" required /></label>
              <label className="grid gap-2 text-xs text-slate-400" htmlFor="warehouse-longitude">Longitudine<Input id="warehouse-longitude" name="longitude" placeholder="9.191383" inputMode="decimal" required /></label>
              <div className="sm:col-span-2"><Button className="h-9 border border-cyan-300/20 bg-cyan-300/[.05] text-xs text-cyan-100 hover:bg-cyan-300/10" disabled={geoBusy} onClick={useDeviceLocation} type="button"><Crosshair className={geoBusy ? "size-3.5 animate-pulse" : "size-3.5"} />{geoBusy ? "Rilevo posizione…" : "Usa posizione del dispositivo"}</Button><p className="mt-2 text-[10px] text-slate-600">La geolocalizzazione del browser è opzionale: puoi inserire coordinate verificate dall’azienda.</p></div>
              <label className="grid gap-2 text-xs text-slate-400 sm:col-span-2" htmlFor="warehouse-radius">Raggio geofence in metri<Input id="warehouse-radius" defaultValue="100" min="25" max="5000" name="geofenceRadiusMeters" type="number" required /></label>
            </div>
            <DialogFooter><DialogClose asChild><Button className="border-white/10 bg-transparent text-slate-400" type="button" variant="outline"><X className="size-3.5" />Annulla</Button></DialogClose><Button className="bg-lime-300 text-[#050705] hover:bg-lime-200" disabled={busy || !canManage} type="submit">{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Warehouse className="size-3.5" />}Salva e rileggi</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
