"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock3, FilePenLine, LoaderCircle, LogIn, LogOut, MapPin, Pause, Play, RefreshCw, ShieldCheck } from "lucide-react";
import { Input } from "@/components/ui/input";

type AttendanceRecord = {
  id: string;
  status: string;
  version: number;
  payload: {
    lastTransition?: {
      action?: string;
      recordedAt?: string;
      clientObservedAt?: string | null;
      correctionAt?: string | null;
      location?: { lat: number; lon: number; accuracyM: number | null } | null;
    };
  };
  updatedAt: string;
};

type AttendanceResponse = { records?: AttendanceRecord[]; context?: { capabilities?: string[] }; error?: string };
type AttendanceWriteResponse = { error?: string; reason?: string; tracking?: { status?: string } };
type AttendanceAction = "check_in" | "pause" | "resume" | "check_out" | "correction_request" | "correction_approve";

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

function isNetworkFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /load failed|failed to fetch|networkerror|network request failed|fetch failed/i.test(message);
}

function attendanceErrorMessage(error: unknown) {
  if (isNetworkFailure(error)) {
    return "Connessione non disponibile: la richiesta non è arrivata al server. Nessuna timbratura è stata modificata. Riprova con la rete attiva.";
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return "La timbratura non è stata registrata. Controlla i dati e riprova.";
}

async function postAttendance(url: string, body: Record<string, unknown>) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (error) {
      lastError = error;
      if (!isNetworkFailure(error) || attempt === 1) throw error;
      await new Promise((resolve) => window.setTimeout(resolve, 350));
    }
  }
  throw lastError;
}

export function AttendanceControl({ jobId, canApprove = false, onChanged }: { jobId: string; canApprove?: boolean; onChanged?: () => void | Promise<void> }) {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState<AttendanceAction | "">("");
  const [locationState, setLocationState] = useState<"idle" | "captured" | "unavailable">("idle");
  const [notice, setNotice] = useState("");
  const [correctionAt, setCorrectionAt] = useState("");
  const [correctionNote, setCorrectionNote] = useState("");
  const [serverCanApprove, setServerCanApprove] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/operations/jobs/${encodeURIComponent(jobId)}/attendance`, { cache: "no-store" });
      const payload = await response.json() as AttendanceResponse;
      if (!response.ok) throw new Error("Le presenze non sono disponibili in questo momento.");
      setRecords(payload.records ?? []);
      setServerCanApprove(Boolean(payload.context?.capabilities?.includes("attendance.approve") || payload.context?.capabilities?.includes("workforce.manage")));
      setState("ready");
    } catch {
      setNotice("Le presenze non sono disponibili in questo momento.");
      setState("error");
    }
  }, [jobId]);

  useEffect(() => { const timer = window.setTimeout(() => void refresh(), 0); return () => window.clearTimeout(timer); }, [refresh]);

  const latest = records[0];
  const status = latest?.status ?? "NONE";
  const actions = useMemo(() => {
    if (status === "CHECKED_IN") return [{ action: "pause" as const, label: "Pausa", icon: Pause }, { action: "check_out" as const, label: "Uscita", icon: LogOut }, { action: "correction_request" as const, label: "Uscita dimenticata", icon: FilePenLine }];
    if (status === "PAUSED") return [{ action: "resume" as const, label: "Riprendi", icon: Play }, { action: "check_out" as const, label: "Uscita", icon: LogOut }, { action: "correction_request" as const, label: "Uscita dimenticata", icon: FilePenLine }];
    if (status === "CORRECTION_REQUESTED") return (canApprove || serverCanApprove) ? [{ action: "correction_approve" as const, label: "Approva uscita", icon: ShieldCheck }] : [];
    return [{ action: "check_in" as const, label: "Entrata", icon: LogIn }];
  }, [canApprove, serverCanApprove, status]);

  async function execute(action: AttendanceAction) {
    setBusy(action);
    setNotice("");
    if (action === "correction_request" && correctionNote.trim().length < 8) {
      setNotice("Inserisci il motivo della correzione prima di inviare la richiesta.");
      setBusy("");
      return;
    }
    const requiresLiveLocation = action === "check_in" || action === "check_out";
    const location = requiresLiveLocation ? await readLocation() : null;
    if (requiresLiveLocation) setLocationState(location ? "captured" : "unavailable");
    if (requiresLiveLocation && !location) {
      setNotice("Per entrata e uscita devi consentire la posizione: il server valida timestamp e geofence.");
      setBusy("");
      return;
    }
    try {
      const response = await postAttendance(`/api/operations/jobs/${encodeURIComponent(jobId)}/attendance`, {
        action,
        expectedVersion: latest?.version,
        clientObservedAt: new Date().toISOString(),
        correctionAt: correctionAt ? new Date(correctionAt).toISOString() : undefined,
        correctionNote: correctionNote.trim() || undefined,
        note: correctionNote.trim() || undefined,
        location,
        idempotencyKey: `attendance-${action}-${jobId}-${crypto.randomUUID()}`,
      });
      const payload = await response.json() as AttendanceWriteResponse;
      if (!response.ok) {
        if (payload.error === "attendance_geofence_required" || payload.error === "driver_origin_geofence_required") throw new Error("Timbratura rifiutata: devi essere dentro il geofence operativo assegnato.");
        if (payload.error === "driver_tracking_device_not_bound" || payload.error === "vehicle_tracking_device_required") throw new Error("Prima di timbrare devi avere mezzo e dispositivo GPS associati alla missione.");
        if (payload.error === "correction_note_required") throw new Error("Inserisci il motivo della correzione.");
        throw new Error("La timbratura non è stata registrata.");
      }
      await refresh();
      await onChanged?.();
      setNotice(action === "correction_request" ? "Richiesta di uscita correttiva registrata: serve l’approvazione autorizzata." : action === "correction_approve" ? "Uscita correttiva approvata e presenza chiusa." : payload.tracking?.status === "STARTED" ? "Ingresso registrato: tracking GPS attivo per la missione." : payload.tracking?.status === "CLOSED" ? "Uscita registrata: tracking GPS terminato." : "Presenza registrata con posizione osservata.");
    } catch (error) {
      setNotice(attendanceErrorMessage(error));
    } finally {
      setBusy("");
    }
  }

  return <section className="mt-4 rounded-[24px] border border-cyan-300/15 bg-[linear-gradient(150deg,rgba(9,18,16,.94),rgba(3,7,6,.98))] p-5 shadow-[0_18px_54px_rgba(0,0,0,.28)] sm:p-6" aria-labelledby="attendance-control-title">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-2xl border border-cyan-300/20 bg-cyan-300/[.07] text-cyan-200"><Clock3 className="size-4" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-cyan-200/65">PRESENZE / COMMESSA</p><h2 className="mt-1 text-[15px] font-semibold text-slate-100" id="attendance-control-title">Turno e timbratura</h2><p className="mt-1 text-[10px] leading-5 text-slate-500">Orario ufficiale dell’evento · posizione soltanto durante il servizio.</p></div></div>
      <button aria-label="Aggiorna timbrature" className="grid size-10 place-items-center rounded-xl border border-white/10 bg-black/25 text-slate-500 transition hover:border-cyan-300/30 hover:text-cyan-100" onClick={() => void refresh()} type="button"><RefreshCw className="size-4" /></button>
    </div>
    <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto] lg:items-center"><div className="rounded-2xl border border-white/[.08] bg-black/25 p-4"><div className="flex flex-wrap items-center gap-2"><span className={`size-2 rounded-full ${status === "CHECKED_IN" ? "bg-lime-300 shadow-[0_0_14px_rgba(200,255,34,.8)]" : status === "PAUSED" ? "bg-amber-300" : "bg-slate-600"}`} /><span className="text-[11px] font-semibold text-slate-100">{statusLabel(status)}</span><span className="rounded-full border border-white/10 px-2 py-1 font-mono text-[8px] text-slate-600">{state === "loading" ? "AGGIORNAMENTO" : state === "error" ? "NON DISPONIBILE" : "DATI AGGIORNATI"}</span></div><div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-[10px] text-slate-500"><span>Ultimo evento: <strong className="font-medium text-slate-300">{formatTime(latest?.payload.lastTransition?.correctionAt ?? latest?.payload.lastTransition?.recordedAt ?? latest?.updatedAt)}</strong>{latest?.payload.lastTransition?.correctionAt && <span className="ml-1 text-amber-200/70">(ora corretta)</span>}</span><span className="inline-flex items-center gap-1.5">{locationState === "captured" ? <MapPin className="size-3 text-lime-200" /> : <MapPin className="size-3 text-slate-600" />}Posizione {locationState === "captured" ? "osservata" : locationState === "unavailable" ? "non disponibile" : "in attesa"}</span></div></div><div className="flex flex-wrap gap-2">{actions.map(({ action, label, icon: Icon }) => <button className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-4 py-2 text-[10px] font-semibold transition disabled:cursor-wait disabled:opacity-50 ${action === "check_out" ? "border border-rose-300/25 bg-rose-300/[.04] text-rose-100 hover:bg-rose-300/[.08]" : action === "correction_request" ? "border border-amber-300/25 bg-amber-300/[.04] text-amber-100 hover:bg-amber-300/[.08]" : "bg-lime-300 text-[#050705] hover:bg-lime-200"}`} disabled={Boolean(busy) || state === "loading"} key={action} onClick={() => void execute(action)} type="button">{busy === action ? <LoaderCircle className="size-3.5 animate-spin" /> : <Icon className="size-3.5" />}{label}</button>)}</div></div>
    {(status === "CHECKED_IN" || status === "PAUSED") && <div className="mt-3 grid gap-3 rounded-2xl border border-amber-300/15 bg-amber-300/[.035] p-4 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)]"><label className="text-[10px] text-amber-100/70">Ora effettiva (opzionale)<Input className="mt-1 h-9 border-amber-300/15 bg-black/25 text-[10px]" onChange={(event) => setCorrectionAt(event.target.value)} type="datetime-local" value={correctionAt} /></label><label className="text-[10px] text-amber-100/70">Motivo correzione uscita<Input className="mt-1 h-9 border-amber-300/15 bg-black/25 text-[10px]" onChange={(event) => setCorrectionNote(event.target.value)} placeholder="Ho dimenticato di timbrare l’uscita…" value={correctionNote} /></label><p className="text-[9px] leading-4 text-amber-100/60 sm:col-span-2">Se sei fuori geofence, l’uscita normale resta bloccata. La richiesta viene registrata con audit e si chiude solo dopo approvazione autorizzata.</p></div>}
    <div className="mt-3 flex items-center gap-2 text-[9px] text-slate-600"><ShieldCheck className="size-3.5 text-cyan-200/70" />La posizione viene letta solo quando effettui una timbratura. Entrata e uscita richiedono GPS e geofence; per un autista il tracking continua fino all’uscita.</div>
    {notice && <p className="mt-3 rounded-xl border border-white/[.08] bg-black/20 px-3 py-2 text-[10px] text-slate-400">{notice}</p>}
  </section>;
}
