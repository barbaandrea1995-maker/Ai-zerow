"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LoaderCircle, LogIn, LogOut, MapPin, Pause, Play, RefreshCw, ShieldCheck, Warehouse } from "lucide-react";
import { clientRequestFingerprint, idempotentJsonMutation } from "@/lib/client-request-idempotency";

type WarehouseOption = { id: string; code: string; name: string; locationLabel: string };
type AttendanceRecord = { id: string; warehouseId: string; status: string; version: number; payload: { warehouse?: { name?: string; locationLabel?: string }; lastTransition?: { recordedAt?: string; location?: unknown; geofence?: { status?: string } } }; updatedAt: string };
type Props = { warehouses: WarehouseOption[]; onChanged?: () => void | Promise<void> };
type Action = "check_in" | "pause" | "resume" | "check_out";

function readLocation(): Promise<{ lat: number; lon: number; accuracyM: number } | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => navigator.geolocation.getCurrentPosition((position) => resolve({ lat: position.coords.latitude, lon: position.coords.longitude, accuracyM: position.coords.accuracy }), () => resolve(null), { enableHighAccuracy: true, maximumAge: 30_000, timeout: 6_000 }));
}

function formatTime(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
}

function statusLabel(value: string) {
  return value === "CHECKED_IN" ? "IN SERVIZIO" : value === "PAUSED" ? "IN PAUSA" : value === "CHECKED_OUT" ? "FUORI SERVIZIO" : "NESSUNA TIMBRATURA";
}

export function WarehouseAttendanceControl({ warehouses, onChanged }: Props) {
  const [selectedWarehouseId, setSelectedWarehouseId] = useState(warehouses[0]?.id ?? "");
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState<Action | "">("");
  const [notice, setNotice] = useState("");
  const [locationSeen, setLocationSeen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/warehouse/attendance", { cache: "no-store" });
      const result = await response.json() as { records?: AttendanceRecord[] };
      if (!response.ok) throw new Error();
      setRecords(result.records ?? []);
      setState("ready");
    } catch {
      setState("error");
      setNotice("Le presenze magazzino non sono disponibili.");
    }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void refresh(), 0); return () => window.clearTimeout(timer); }, [refresh]);

  const activeWarehouseId = selectedWarehouseId || warehouses[0]?.id || "";
  const latest = useMemo(() => records.find((record) => record.warehouseId === activeWarehouseId), [records, activeWarehouseId]);
  const status = latest?.status ?? "NONE";
  const selectedWarehouse = warehouses.find((warehouse) => warehouse.id === activeWarehouseId);
  const actions = status === "CHECKED_IN" ? [{ action: "pause" as const, label: "Pausa", icon: Pause }, { action: "check_out" as const, label: "Uscita", icon: LogOut }] : status === "PAUSED" ? [{ action: "resume" as const, label: "Riprendi", icon: Play }, { action: "check_out" as const, label: "Uscita", icon: LogOut }] : [{ action: "check_in" as const, label: "Entrata", icon: LogIn }];

  async function execute(action: Action) {
    if (!activeWarehouseId) { setNotice("Seleziona un magazzino operativo."); return; }
    setBusy(action);
    setNotice("");
    const location = await readLocation();
    setLocationSeen(Boolean(location));
    if ((action === "check_in" || action === "check_out") && !location) { setNotice("Per entrata e uscita devi consentire la posizione: il server verificherà la geofence del magazzino."); setBusy(""); return; }
    try {
      const response = await idempotentJsonMutation({ url: "/api/warehouse/attendance", namespace: "warehouse-attendance", operation: `${activeWarehouseId}:${action}`, fingerprint: clientRequestFingerprint({ action, warehouseId: activeWarehouseId, expectedVersion: latest?.version }), payload: { action, warehouseId: activeWarehouseId, expectedVersion: latest?.version, clientObservedAt: new Date().toISOString(), location } });
      const result = await response.json() as { error?: string };
      if (!response.ok) {
        setNotice(result.error === "warehouse_geofence_required" ? "Timbratura rifiutata: devi essere dentro la geofence del magazzino." : "La timbratura non è stata registrata.");
        return;
      }
      await refresh();
      await onChanged?.();
      setNotice(action === "check_in" ? "Ingresso magazzino registrato." : action === "check_out" ? "Uscita magazzino registrata." : "Presenza magazzino aggiornata.");
    } catch { setNotice("Connessione non disponibile: nessuna timbratura confermata."); } finally { setBusy(""); }
  }

  return <section className="carbon-card-neon mt-4 rounded-2xl p-4 sm:p-5" aria-labelledby="warehouse-attendance-title"><div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-2xl border border-cyan-300/25 bg-cyan-300/10 text-cyan-200"><Warehouse className="size-5" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-cyan-200/70">PRESENZA / MAGAZZINO</p><h2 className="mt-1 text-base font-semibold text-slate-100" id="warehouse-attendance-title">Ingresso operativo</h2><p className="mt-1 text-xs text-slate-500">Entrata e uscita sono valide solo dentro la geofence del magazzino. Il tracking continuo resta riservato alla mansione autista durante una missione.</p></div></div><button aria-label="Aggiorna presenze magazzino" className="grid size-9 place-items-center rounded-xl border border-white/10 bg-black/20 text-slate-500 hover:border-cyan-300/30 hover:text-cyan-100" onClick={() => void refresh()} type="button"><RefreshCw className={state === "loading" ? "size-4 animate-spin" : "size-4"} /></button></div><div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end"><label className="text-xs text-slate-400">Magazzino<select aria-label="Magazzino per la timbratura" className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-slate-100 outline-none focus:border-cyan-300/40" onChange={(event) => setSelectedWarehouseId(event.target.value)} value={activeWarehouseId}><option value="">Seleziona magazzino</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name} · {warehouse.locationLabel}</option>)}</select></label><div className="flex flex-wrap gap-2">{actions.map(({ action, label, icon: Icon }) => <button className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-4 py-2 text-[10px] font-semibold transition disabled:opacity-50 ${action === "check_out" ? "border border-rose-300/25 bg-rose-300/[.04] text-rose-100" : "bg-lime-300 text-[#050705] hover:bg-lime-200"}`} disabled={!activeWarehouseId || Boolean(busy) || state === "loading"} key={action} onClick={() => void execute(action)} type="button">{busy === action ? <LoaderCircle className="size-3.5 animate-spin" /> : <Icon className="size-3.5" />}{label}</button>)}</div></div><div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[10px] text-slate-500"><span className="inline-flex items-center gap-1.5"><span className={`size-2 rounded-full ${status === "CHECKED_IN" ? "bg-lime-300 shadow-[0_0_10px_rgba(200,255,34,.8)]" : "bg-slate-600"}`} />{statusLabel(status)}</span><span>Ultimo evento · {formatTime(latest?.payload.lastTransition?.recordedAt ?? latest?.updatedAt)}</span><span className="inline-flex items-center gap-1.5"><MapPin className="size-3 text-cyan-200" />{latest?.payload.lastTransition?.geofence?.status ?? (locationSeen ? "POSIZIONE OSSERVATA" : "GEOFENCE SERVER-SIDE")}</span>{selectedWarehouse && <span>{selectedWarehouse.name}</span>}</div><div className="mt-3 flex items-center gap-2 text-[9px] text-slate-600"><ShieldCheck className="size-3.5 text-cyan-200/70" />Il magazzino certifica la presenza; non apre una sessione GPS continua.</div>{notice && <p className="mt-3 rounded-xl border border-white/[.08] bg-black/20 px-3 py-2 text-[10px] text-slate-400">{notice}</p>}</section>;
}
