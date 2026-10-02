"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarClock, CircleAlert, Clock3, LoaderCircle, MapPin, RefreshCw, ShieldCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type AttendanceRecord = {
  id: string;
  jobId: string;
  jobCode: string | null;
  jobTitle: string;
  jobModule: string;
  status: string;
  version: number;
  workerId: string | null;
  recordedAt: string | null;
  clientObservedAt: string | null;
  geofenceStatus: string;
  updatedAt: string;
};

type AttendancePayload = {
  records?: AttendanceRecord[];
  summary?: { total?: number; checkedIn?: number; paused?: number; checkedOut?: number; geofenceInside?: number; gpsObserved?: number };
};

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
}

function statusTone(status: string) {
  if (status === "CHECKED_IN") return "border-lime-300/25 bg-lime-300/[.07] text-lime-100";
  if (status === "PAUSED") return "border-amber-300/25 bg-amber-300/[.06] text-amber-100";
  if (status === "CORRECTION_REQUESTED") return "border-rose-300/25 bg-rose-300/[.06] text-rose-100";
  return "border-white/10 bg-black/20 text-slate-400";
}

function statusLabel(status: string) {
  if (status === "CHECKED_IN") return "IN SERVIZIO";
  if (status === "PAUSED") return "IN PAUSA";
  if (status === "CHECKED_OUT") return "FUORI SERVIZIO";
  if (status === "APPROVED") return "APPROVATA";
  if (status === "CORRECTION_REQUESTED") return "CORREZIONE";
  return status;
}

export default function AttendanceOverview() {
  const [payload, setPayload] = useState<AttendancePayload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    setState("loading");
    try {
      const response = await fetch("/api/workforce/attendance", { cache: "no-store" });
      const next = await response.json() as AttendancePayload & { error?: string };
      if (!response.ok) throw new Error(next.error ?? "attendance_overview_unavailable");
      setPayload(next);
      setState("ready");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Presenze non disponibili");
      setState("error");
    }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void refresh(), 0); return () => window.clearTimeout(timer); }, [refresh]);
  const records = useMemo(() => payload?.records ?? [], [payload?.records]);
  const filteredRecords = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? records.filter((record) => [record.jobCode, record.jobTitle, record.workerId, record.status].some((value) => value?.toLowerCase().includes(query))) : records;
  }, [records, search]);
  const summary = payload?.summary ?? {};

  if (state === "loading" && !payload) return <main className="grid min-h-screen place-items-center bg-[#030504] text-xs text-slate-500"><LoaderCircle className="mr-2 inline size-4 animate-spin text-lime-300" />Caricamento presenze…</main>;
  if (state === "error" && !payload) return <main className="grid min-h-screen place-items-center bg-[#030504]"><Button variant="outline" onClick={() => void refresh()}><RefreshCw className="size-4" />Riprova</Button></main>;

  return <main className="min-h-screen bg-[#030504] px-4 py-5 text-slate-100 sm:px-7 sm:py-7"><div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_70%_0%,rgba(200,255,34,.07),transparent_27%),linear-gradient(145deg,#020403,#071008_48%,#030504)]" /><div className="relative mx-auto max-w-[1640px]">
    <header className="overflow-hidden rounded-[28px] border border-cyan-300/20 bg-[linear-gradient(145deg,rgba(12,25,22,.97),rgba(4,7,5,.99)_62%,rgba(13,20,14,.98))] p-6 shadow-[0_30px_90px_rgba(0,0,0,.42)] sm:p-8"><div className="flex flex-wrap items-start justify-between gap-5"><div><p className="text-[10px] font-semibold uppercase tracking-[.24em] text-cyan-200/70">AI-ZEROW / WORKFORCE CONTROL</p><h1 className="mt-3 text-3xl font-semibold tracking-[-.05em] text-slate-50 sm:text-[42px]">Presenze operative</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">Timestamp ufficiali, stato del turno e geofence osservato. Il tracking è limitato alle azioni di servizio e resta sempre leggibile come evidenza.</p></div><button aria-label="Rileggi presenze" className="grid size-10 place-items-center rounded-xl border border-white/10 bg-black/30 text-slate-500 hover:border-cyan-300/30 hover:text-cyan-100" onClick={() => void refresh()} type="button"><RefreshCw className="size-4" /></button></div></header>
    <section className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
      { label: "Presenze", value: summary.total ?? 0, detail: "readback tenant", icon: Users },
      { label: "In servizio", value: summary.checkedIn ?? 0, detail: "timestamp server", icon: Clock3 },
      { label: "In pausa", value: summary.paused ?? 0, detail: "stato corrente", icon: CalendarClock },
      { label: "GPS osservato", value: summary.gpsObserved ?? 0, detail: `${summary.geofenceInside ?? 0} dentro geofence`, icon: MapPin },
    ].map(({ label, value, detail, icon: Icon }) => <article className="carbon-card rounded-[20px] p-4" key={label}><div className="flex items-start justify-between"><div><p className="text-[9px] font-semibold uppercase tracking-[.18em] text-slate-600">{label}</p><p className="mt-2 font-mono text-2xl text-lime-100">{value}</p><p className="mt-1 text-[9px] text-slate-600">{detail}</p></div><span className="grid size-9 place-items-center rounded-xl border border-cyan-300/20 bg-cyan-300/[.07] text-cyan-200"><Icon className="size-4" /></span></div></article>)}
    </section>
    <section className="carbon-card mt-4 rounded-[24px] p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-cyan-200/70">REGISTRO PRESENZE</p><h2 className="mt-1 text-sm font-semibold text-slate-100">Evidenze di servizio</h2></div><Input aria-label="Cerca presenze" className="h-10 max-w-sm border-white/10 bg-black/30 text-xs" onChange={(event) => setSearch(event.target.value)} placeholder="Cerca commessa, persona, stato…" value={search} /></div><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[780px] border-separate border-spacing-0 text-left"><thead><tr className="text-[9px] uppercase tracking-[.16em] text-slate-600"><th className="border-b border-white/[.08] px-3 py-3 font-semibold">Perimetro</th><th className="border-b border-white/[.08] px-3 py-3 font-semibold">Operatore</th><th className="border-b border-white/[.08] px-3 py-3 font-semibold">Stato</th><th className="border-b border-white/[.08] px-3 py-3 font-semibold">Timestamp server</th><th className="border-b border-white/[.08] px-3 py-3 font-semibold">Geofence</th><th className="border-b border-white/[.08] px-3 py-3 font-semibold">Azione</th></tr></thead><tbody>{filteredRecords.map((record) => <tr className="group text-[10px] text-slate-400 hover:bg-lime-300/[.025]" key={record.id}><td className="border-b border-white/[.06] px-3 py-3"><p className="font-medium text-slate-200">{record.jobCode ? `${record.jobCode} · ` : ""}{record.jobTitle}</p><p className="mt-1 text-[9px] text-slate-600">{record.jobModule === "mission" ? "MISSIONE" : "COMMESSA"}</p></td><td className="border-b border-white/[.06] px-3 py-3 font-mono text-[9px] text-slate-500">{record.workerId ?? "—"}</td><td className="border-b border-white/[.06] px-3 py-3"><span className={`rounded-full border px-2 py-1 text-[8px] font-semibold ${statusTone(record.status)}`}>{statusLabel(record.status)}</span></td><td className="border-b border-white/[.06] px-3 py-3"><span className="text-slate-300">{formatDate(record.recordedAt)}</span><span className="mt-1 block text-[9px] text-slate-600">v{record.version}</span></td><td className="border-b border-white/[.06] px-3 py-3"><span className={record.geofenceStatus === "INSIDE" ? "text-lime-200" : record.geofenceStatus === "OUTSIDE" ? "text-rose-200" : "text-slate-500"}>{record.geofenceStatus}</span></td><td className="border-b border-white/[.06] px-3 py-3">{record.jobModule === "operations" ? <Link className="text-lime-200 hover:text-lime-50" href={`/operations/${encodeURIComponent(record.jobId)}`}>Apri workspace</Link> : <Link className="text-lime-200 hover:text-lime-50" href="/mission">Apri missioni</Link>}</td></tr>)}{filteredRecords.length === 0 && <tr><td className="px-3 py-12 text-center text-[10px] text-slate-600" colSpan={6}>Nessuna timbratura nel perimetro autorizzato.</td></tr>}</tbody></table></div></section>
    <div className="mt-4 flex items-center gap-2 rounded-xl border border-cyan-300/15 bg-cyan-300/[.03] px-4 py-3 text-[10px] text-slate-500"><ShieldCheck className="size-3.5 shrink-0 text-cyan-200" />La posizione è opzionale e viene trasmessa soltanto con l’azione di presenza. Se il provider GPS o il geofence non sono configurati, lo stato resta esplicito.</div>
    {notice && <button className="fixed bottom-5 right-5 z-50 max-w-[370px] rounded-xl border border-amber-300/25 bg-[#080d09]/95 px-4 py-3 text-left text-xs text-amber-100" onClick={() => setNotice("")} type="button"><CircleAlert className="mr-2 inline size-4 text-amber-200" />{notice}</button>}
  </div></main>;
}
