"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Building2, CheckCircle2, LoaderCircle, MapPin, Plus, RefreshCw, Search, ShieldCheck, Warehouse, X } from "lucide-react";
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

type LocationCandidate = {
  provider: "MAPBOX";
  providerPlaceId: string;
  formattedAddress: string;
  latitude: number;
  longitude: number;
  street: string;
  streetNumber: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
  confidence: number;
};

type GeocodePayload = {
  candidates?: LocationCandidate[];
  error?: string;
  confirmationRequired?: boolean;
};

function errorLabel(error: string | undefined) {
  if (error === "warehouse_name_required") return "Inserisci il nome del magazzino.";
  if (error === "warehouse_location_required") return "Inserisci un luogo o indirizzo operativo.";
  if (error === "warehouse_server_location_required") return "Riconosci e conferma un luogo server-side prima di salvare il magazzino.";
  if (error === "warehouse_geocoder_not_configured") return "Il riconoscimento indirizzi non è configurato: il magazzino non può essere creato senza una posizione server-side.";
  if (error === "warehouse_geocoder_unavailable") return "Il servizio di riconoscimento indirizzi non risponde. Riprova tra poco.";
  if (error === "warehouse_location_confirmation_expired") return "La posizione selezionata non è più valida. Riconosci di nuovo l’indirizzo.";
  if (error === "geofence_radius_must_be_25_to_5000_meters") return "Il geofence deve essere compreso tra 25 e 5.000 metri.";
  return "Configurazione magazzino non completata.";
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
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationQuery, setLocationQuery] = useState("");
  const [locationCandidates, setLocationCandidates] = useState<LocationCandidate[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<LocationCandidate | null>(null);

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

  async function searchLocation() {
    const query = locationQuery.trim();
    if (query.length < 5) {
      onNotify("Inserisci almeno un indirizzo riconoscibile.");
      return;
    }
    setLocationBusy(true);
    setSelectedLocation(null);
    try {
      const response = await fetch("/api/location/geocode", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: query }),
      });
      const payload = await response.json() as GeocodePayload;
      if (!response.ok) {
        onNotify(errorLabel(payload.error));
        setLocationCandidates([]);
        return;
      }
      const candidates = payload.candidates ?? [];
      setLocationCandidates(candidates);
      if (candidates.length === 1 && payload.confirmationRequired === false) {
        setSelectedLocation(candidates[0]);
        onNotify("Luogo riconosciuto dal server. Controlla il risultato e conferma.");
      } else if (candidates.length === 0) {
        onNotify("Nessun luogo riconosciuto: prova con via, numero civico e città.");
      } else {
        onNotify("Seleziona il luogo corretto tra i risultati server-side.");
      }
    } catch {
      onNotify("Servizio di riconoscimento indirizzi temporaneamente non disponibile.");
    } finally {
      setLocationBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage) return;
    if (!selectedLocation) {
      onNotify("Prima riconosci e conferma il luogo dal server.");
      return;
    }
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
          locationQuery: locationQuery.trim(),
          locationLabel: selectedLocation.formattedAddress,
          provider: selectedLocation.provider,
          providerPlaceId: selectedLocation.providerPlaceId,
          confidence: selectedLocation.confidence,
          geofenceRadiusMeters: field("geofenceRadiusMeters"),
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
      setLocationQuery("");
      setLocationCandidates([]);
      setSelectedLocation(null);
      onNotify("Magazzino creato: luogo server-side, geofence e registro scorte pronti.");
    } catch {
      onNotify("Servizio magazzini temporaneamente non disponibile.");
    } finally {
      setBusy(false);
    }
  }

  function resetLocationSelection() {
    setLocationQuery("");
    setLocationCandidates([]);
    setSelectedLocation(null);
  }

  return (
    <section className="carbon-card carbon-card-neon mb-5 rounded-[24px] p-4 sm:p-5" aria-labelledby="tenant-warehouse-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="grid size-10 place-items-center rounded-2xl border border-lime-300/25 bg-lime-300/10 text-lime-200"><Warehouse className="size-4" /></span>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/70">ONBOARDING / WAREHOUSE NETWORK</p>
            <h2 className="mt-1 text-[16px] font-semibold text-slate-100" id="tenant-warehouse-title">Magazzini dell’azienda</h2>
            <p className="mt-1 max-w-2xl text-[11px] leading-5 text-slate-500">Ogni deposito è un luogo canonico server-side con codice, geofence e registro scorte separato. Il Warehouse mostra e movimenta un deposito alla volta.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-lg border border-lime-300/20 bg-lime-300/[.04] px-3 py-2 font-mono text-[9px] text-lime-200">{readbackStatus} · {warehouses.length} LOCATIONS</span>
          <Button className="h-9 border border-white/10 bg-black/25 text-xs text-slate-300 hover:border-lime-300/30 hover:bg-lime-300/[.06]" onClick={() => void refresh()} type="button" variant="outline"><RefreshCw className={refreshing ? "size-3.5 animate-spin" : "size-3.5"} />Rileggi</Button>
          <Button className="h-9 bg-lime-300 text-xs font-semibold text-[#060806] hover:bg-lime-200 disabled:opacity-40" disabled={!canManage} onClick={() => { resetLocationSelection(); setOpen(true); }} type="button"><Plus className="size-3.5" />Nuovo magazzino</Button>
        </div>
      </div>

      {loading ? <div className="mt-5 flex items-center gap-2 rounded-xl border border-white/[.08] bg-black/20 p-4 text-xs text-slate-500"><LoaderCircle className="size-4 animate-spin text-lime-300" />Readback magazzini tenant…</div> : warehouses.length === 0 ? <div className="mt-5 rounded-2xl border border-dashed border-lime-300/20 bg-lime-300/[.025] p-6 text-center"><Building2 className="mx-auto size-7 text-slate-600" /><p className="mt-3 text-sm font-semibold text-slate-300">Nessun magazzino configurato</p><p className="mt-1 text-[11px] text-slate-600">Crea il primo deposito prima di registrare materiali senza barcode.</p></div> : <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{warehouses.map((warehouse) => <article className="rounded-2xl border border-white/[.08] bg-black/20 p-4" key={warehouse.id}><div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/[.07] text-lime-200"><MapPin className="size-4" /></span><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-100">{warehouse.name}</p><p className="mt-1 font-mono text-[10px] text-lime-200/70">{warehouse.code} · v{warehouse.version}</p></div></div><span className="rounded-full border border-lime-300/20 bg-lime-300/[.05] px-2 py-1 text-[9px] uppercase text-lime-200">{warehouse.status}</span></div><p className="mt-4 truncate text-xs text-slate-300">{warehouse.locationLabel}</p><div className="mt-3 grid grid-cols-2 gap-2 text-[10px]"><div className="carbon-inset rounded-lg p-2"><span className="block uppercase tracking-[.12em] text-slate-600">Coordinate</span><span className="mt-1 block font-mono text-slate-300">{warehouse.coordinates.latitude.toFixed(5)}, {warehouse.coordinates.longitude.toFixed(5)}</span></div><div className="carbon-inset rounded-lg p-2"><span className="block uppercase tracking-[.12em] text-slate-600">Geofence</span><span className="mt-1 block font-mono text-lime-200">{warehouse.geofence.radiusMeters} m</span></div></div><div className="mt-3 flex items-center gap-2 text-[9px] text-slate-600"><CheckCircle2 className="size-3.5 text-lime-300" />{warehouse.locationStatus} · server readback</div></article>)}</div>}

      <div className="mt-4 flex items-start gap-2 rounded-xl border border-cyan-300/15 bg-cyan-300/[.035] p-3 text-[10px] leading-5 text-cyan-100/70"><ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-cyan-200" />Il server riconosce l’indirizzo, conserva il luogo canonico e collega il deposito al proprio registro scorte. Coordinate e geofence non vengono più inventate o inserite a mano nel client.</div>

      <Dialog open={open} onOpenChange={(nextOpen) => { setOpen(nextOpen); if (!nextOpen) resetLocationSelection(); }}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] overflow-y-auto overscroll-contain border-lime-300/20 bg-[#090d0a] text-slate-100 sm:max-w-[620px]">
          <form id="tenant-warehouse-form" className="space-y-4" onSubmit={submit}>
            <DialogHeader><DialogTitle>Configura un magazzino</DialogTitle><DialogDescription className="text-slate-500">Crea un luogo canonico server-side. Il server assegna il codice, verifica l’indirizzo e apre il registro scorte dedicato a questo deposito.</DialogDescription></DialogHeader>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-xs text-slate-400 sm:col-span-2" htmlFor="warehouse-name">Nome magazzino<Input id="warehouse-name" name="name" placeholder="Es. Deposito Milano Nord" required /></label>
              <div className="sm:col-span-2">
                <label className="grid gap-2 text-xs text-slate-400" htmlFor="warehouse-location">Indirizzo o luogo operativo<Input id="warehouse-location" name="locationQuery" onChange={(event) => { setLocationQuery(event.target.value); setSelectedLocation(null); setLocationCandidates([]); }} placeholder="Es. Via Catullo 93, Pomezia" required value={locationQuery} /></label>
                <div className="mt-2 flex flex-wrap gap-2"><Button className="h-10 border border-cyan-300/20 bg-cyan-300/[.05] text-xs text-cyan-100 hover:bg-cyan-300/10" disabled={locationBusy || locationQuery.trim().length < 5} onClick={() => void searchLocation()} type="button"><Search className={locationBusy ? "size-3.5 animate-pulse" : "size-3.5"} />{locationBusy ? "Riconosco dal server…" : "Riconosci luogo"}</Button>{selectedLocation && <span className="inline-flex items-center gap-2 rounded-xl border border-lime-300/25 bg-lime-300/[.06] px-3 py-2 text-[10px] font-semibold text-lime-100"><CheckCircle2 className="size-3.5" />Luogo confermato</span>}</div>
                {locationCandidates.length > 0 && <div className="mt-3 space-y-2" role="listbox" aria-label="Risultati luogo server-side">{locationCandidates.map((candidate) => <button className={`w-full rounded-xl border p-3 text-left transition ${selectedLocation?.providerPlaceId === candidate.providerPlaceId ? "border-lime-300/50 bg-lime-300/[.08]" : "border-white/10 bg-black/20 hover:border-cyan-300/30"}`} key={candidate.providerPlaceId} onClick={() => setSelectedLocation(candidate)} type="button"><span className="flex items-start gap-2"><MapPin className="mt-0.5 size-4 shrink-0 text-cyan-200" /><span className="min-w-0"><span className="block text-xs font-semibold text-slate-100">{candidate.formattedAddress}</span><span className="mt-1 block text-[10px] text-slate-500">{candidate.city}{candidate.province ? ` · ${candidate.province}` : ""} · coordinate server-side · attendibilità {Math.round(candidate.confidence * 100)}%</span></span></span></button>)}</div>}
                {selectedLocation && <div className="mt-3 rounded-xl border border-lime-300/15 bg-lime-300/[.035] p-3 text-[10px] leading-5 text-lime-100/80"><span className="font-semibold">Luogo canonico:</span> {selectedLocation.formattedAddress}<br /><span className="text-slate-500">{selectedLocation.latitude.toFixed(6)}, {selectedLocation.longitude.toFixed(6)} · provider MAPBOX · selezione riletta dal server al salvataggio</span></div>}
              </div>
              <label className="grid gap-2 text-xs text-slate-400 sm:col-span-2" htmlFor="warehouse-radius">Raggio geofence in metri<Input id="warehouse-radius" defaultValue="100" min="25" max="5000" name="geofenceRadiusMeters" type="number" required /></label>
            </div>
            <DialogFooter><DialogClose asChild><Button className="border-white/10 bg-transparent text-slate-400" type="button" variant="outline"><X className="size-3.5" />Annulla</Button></DialogClose><Button className="bg-lime-300 text-[#050705] hover:bg-lime-200" disabled={busy || !canManage || !selectedLocation} type="submit">{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Warehouse className="size-3.5" />}Crea luogo e registro</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
