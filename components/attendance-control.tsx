"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock3, LoaderCircle, LogIn, LogOut, MapPin, Pause, Play, RefreshCw, ShieldCheck } from "lucide-react";

type AttendanceRecord = {
  id: string;
  status: string;
  version: number;
  payload: {
    lastTransition?: {
      action?: string;
      recordedAt?: string;
      clientObservedAt?: string | null;
      location?: { lat: number; lon: number; accuracyM: number | null } | null;
    };
  };
  updatedAt: string;
};

type AttendanceResponse = { records?: AttendanceRecord[]; error?: string };
type AttendanceAction = "check_in" | "pause" | "resume" | "check_out";

function statusLabel(status: string) {
  if (status === "CHECKED_IN") return "IN SERVIZIO";
  if (status === "PAUSED") return "IN PAUSA";
  if (status === "CHECKED_OUT") return "FUORI SERVIZIO";
  if (status === "CORRECTION_REQUESTED") return "CORREZIONE IN REVISIONE";
  if (status === "APPROVED") return "APPROVATA";
  return "NESSUNA TIMBRATURA";
}

function formatTime(value: string | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
}

function readLocation(): Promise<{ lat: number; lon: number; accuracyM: number } | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lon: position.coords.longitude, accuracyM: position.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 6_000 },
    );
  });
}

export function AttendanceControl({ jobId }: { jobId: string }) {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState<AttendanceAction | "">("");
  const [locationState, setLocationState] = useState<"idle" | "captured" | "unavailable">("idle");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/operations/jobs/${encodeURIComponent(jobId)}/attendance`, { cache: "no-store" });
      const payload = await response.json() as AttendanceResponse;
      if (!response.ok) throw new Error(payload.error ?? "attendance_unavailable");
      setRecords(payload.records ?? []);
      setState("ready");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Presenze non disponibili");
      setState("error");
    }
  }, [jobId]);

  useEffect(() => { const timer = window.setTimeout(() => void refresh(), 0); return () => window.clearTimeout(timer); }, [refresh]);

  const latest = records[0];
  const status = latest?.status ?? "NONE";
  const actions = useMemo(() => {
    if (status === "CHECKED_IN") return [{ action: "pause" as const, label: "Pausa", icon: Pause }, { action: "check_out" as const, label: "Uscita", icon: LogOut }];
    if (status === "PAUSED") return [{ action: "resume" as const, label: "Riprendi", icon: Play }, { action: "check_out" as const, label: "Uscita", icon: LogOut }];
    if (status === "CORRECTION_REQUESTED") return [];
    return [{ action: "check_in" as const, label: "Entrata", icon: LogIn }];
  }, [status]);

  async function execute(action: AttendanceAction) {
    setBusy(action);
    setNotice("");
    const location = await readLocation();
    setLocationState(location ? "captured" : "unavailable");
    try {
      const response = await fetch(`/api/operations/jobs/${encodeURIComponent(jobId)}/attendance`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          expectedVersion: latest?.version,
          clientObservedAt: new Date().toISOString(),
          location,
          idempotencyKey: `attendance-${action}-${jobId}-${crypto.randomUUID()}`,
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "attendance_write_failed");
      await refresh();
      setNotice(location ? "Presenza registrata con posizione osservata." : "Presenza registrata. GPS non disponibile: la posizione resta assente.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Presenza non registrata");
    } finally {
      setBusy("");
    }
  }

  return <section className="mt-4 rounded-[24px] border border-cyan-300/15 bg-[linear-gradient(150deg,rgba(9,18,16,.94),rgba(3,7,6,.98))] p-5 shadow-[0_18px_54px_rgba(0,0,0,.28)] sm:p-6" aria-labelledby="attendance-control-title">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-2xl border border-cyan-300/20 bg-cyan-300/[.07] text-cyan-200"><Clock3 className="size-4" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-cyan-200/65">WORKFORCE / PRESENZE</p><h2 className="mt-1 text-[15px] font-semibold text-slate-100" id="attendance-control-title">Turno e timbratura</h2><p className="mt-1 text-[10px] leading-5 text-slate-500">Timestamp ufficiale server-side · localizzazione soltanto durante il servizio.</p></div></div>
      <button aria-label="Rileggi presenze" className="grid size-10 place-items-center rounded-xl border border-white/10 bg-black/25 text-slate-500 transition hover:border-cyan-300/30 hover:text-cyan-100" onClick={() => void refresh()} type="button"><RefreshCw className="size-4" /></button>
    </div>
    <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto] lg:items-center"><div className="rounded-2xl border border-white/[.08] bg-black/25 p-4"><div className="flex flex-wrap items-center gap-2"><span className={`size-2 rounded-full ${status === "CHECKED_IN" ? "bg-lime-300 shadow-[0_0_14px_rgba(200,255,34,.8)]" : status === "PAUSED" ? "bg-amber-300" : "bg-slate-600"}`} /><span className="text-[11px] font-semibold text-slate-100">{statusLabel(status)}</span><span className="rounded-full border border-white/10 px-2 py-1 font-mono text-[8px] text-slate-600">{state === "loading" ? "READING" : state === "error" ? "UNAVAILABLE" : "READBACK"}</span></div><div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-[10px] text-slate-500"><span>Ultimo evento: <strong className="font-medium text-slate-300">{formatTime(latest?.payload.lastTransition?.recordedAt ?? latest?.updatedAt)}</strong></span><span className="inline-flex items-center gap-1.5">{locationState === "captured" ? <MapPin className="size-3 text-lime-200" /> : <MapPin className="size-3 text-slate-600" />}GPS {locationState === "captured" ? "osservato" : locationState === "unavailable" ? "non disponibile" : "in attesa"}</span></div></div><div className="flex flex-wrap gap-2">{actions.map(({ action, label, icon: Icon }) => <button className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-4 py-2 text-[10px] font-semibold transition disabled:cursor-wait disabled:opacity-50 ${action === "check_out" ? "border border-rose-300/25 bg-rose-300/[.04] text-rose-100 hover:bg-rose-300/[.08]" : "bg-lime-300 text-[#050705] hover:bg-lime-200"}`} disabled={Boolean(busy) || state === "loading"} key={action} onClick={() => void execute(action)} type="button">{busy === action ? <LoaderCircle className="size-3.5 animate-spin" /> : <Icon className="size-3.5" />}{label}</button>)}</div></div>
    <div className="mt-3 flex items-center gap-2 text-[9px] text-slate-600"><ShieldCheck className="size-3.5 text-cyan-200/70" />La posizione viene arrotondata e inviata solo con l’azione di presenza; il geofence viene valutato dal server quando la sede della commessa ha coordinate configurate.</div>
    {notice && <p className="mt-3 rounded-xl border border-white/[.08] bg-black/20 px-3 py-2 text-[10px] text-slate-400">{notice}</p>}
  </section>;
}
