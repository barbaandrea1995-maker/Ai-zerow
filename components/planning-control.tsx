"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { CalendarClock, CheckCircle2, CircleAlert, ClipboardList, LoaderCircle, MapPin, Plus, RefreshCw, Send, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PlanningResourceFields } from "@/components/planning-resource-fields";

type PlanningJob = {
  id: string;
  code: string | null;
  title: string;
  module: "operations" | "mission";
  status: string;
  location: string | null;
  scopeSubgroupId: string | null;
  scopeSubgroupTitle: string | null;
  updatedAt: string;
};

type PlanningPlan = {
  id: string;
  jobId: string;
  jobTitle: string;
  title: string;
  status: string;
  version: number;
  activityType: string;
  startsAt: string | null;
  endsAt: string | null;
  resourceCount: number;
  feasible: boolean;
  updatedAt: string;
};

type PlanningPayload = {
  jobs?: PlanningJob[];
  plans?: PlanningPlan[];
  summary?: { jobs?: number; plans?: number; published?: number; conflicted?: number };
};

function localDateTime(offsetHours: number) {
  const date = new Date(Date.now() + offsetHours * 3_600_000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
}

function moduleLabel(module: PlanningJob["module"]) {
  return module === "mission" ? "MISSIONE" : "COMMESSA";
}

export default function PlanningControl() {
  const [payload, setPayload] = useState<PlanningPayload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [selectedJobId, setSelectedJobId] = useState("");
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState(false);
  const [title, setTitle] = useState("");
  const [activityType, setActivityType] = useState<"WORK" | "TRANSPORT">("WORK");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [resourceIds, setResourceIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    setState("loading");
    try {
      const response = await fetch("/api/planning", { cache: "no-store" });
      const next = await response.json() as PlanningPayload & { error?: string };
      if (!response.ok) throw new Error(next.error ?? "planning_unavailable");
      setPayload(next);
      setSelectedJobId((current) => current && next.jobs?.some((job) => job.id === current) ? current : next.jobs?.[0]?.id ?? "");
      setState("ready");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Pianificazione non disponibile");
      setState("error");
    }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void refresh(), 0); return () => window.clearTimeout(timer); }, [refresh]);

  const jobs = useMemo(() => payload?.jobs ?? [], [payload?.jobs]);
  const plans = payload?.plans ?? [];
  const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? jobs[0] ?? null;
  const filteredJobs = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? jobs.filter((job) => [job.code, job.title, job.location, job.scopeSubgroupTitle].some((value) => value?.toLowerCase().includes(query))) : jobs;
  }, [jobs, search]);
  const selectedPlans = plans.filter((plan) => plan.jobId === selectedJob?.id);

  function openCreate() {
    if (!selectedJob) {
      setNotice("Seleziona una commessa o una missione prima di creare un piano.");
      return;
    }
    setTitle(selectedJob.module === "mission" ? "Piano missione" : "Attività della giornata");
    setActivityType(selectedJob.module === "mission" ? "TRANSPORT" : "WORK");
    setStartsAt(localDateTime(1));
    setEndsAt(localDateTime(5));
    setLocation(selectedJob.location ?? "");
    setNotes("");
    setResourceIds([]);
    setModal(true);
  }

  async function createPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedJob) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(`/api/operations/jobs/${encodeURIComponent(selectedJob.id)}/planning`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "draft",
          title: title.trim() || "Piano operativo",
          activityType,
          startsAt,
          endsAt,
          location: location.trim(),
          scopeSubgroupId: selectedJob.scopeSubgroupId,
          scopeSubgroupTitle: selectedJob.scopeSubgroupTitle,
          notes: notes.trim(),
          resourceIds,
          idempotencyKey: `planning-central-${crypto.randomUUID()}`,
        }),
      });
      const result = await response.json() as { error?: string; evaluation?: { conflicts?: Array<{ detail?: string }> } };
      if (!response.ok) throw new Error(result.error ?? result.evaluation?.conflicts?.[0]?.detail ?? "planning_write_failed");
      setModal(false);
      setNotice("Piano salvato come bozza e verificato dal server.");
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Piano non salvato");
    } finally {
      setBusy(false);
    }
  }

  async function publishPlan(plan: PlanningPlan) {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(`/api/operations/jobs/${encodeURIComponent(plan.jobId)}/planning`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "publish", recordId: plan.id, expectedVersion: plan.version, idempotencyKey: `planning-publish-${crypto.randomUUID()}` }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "planning_publish_failed");
      setNotice("Piano pubblicato dopo il nuovo controllo di capacità.");
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Pubblicazione non completata");
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading" && !payload) return <main className="grid min-h-screen place-items-center bg-[#030504] text-xs text-slate-500"><LoaderCircle className="mr-2 inline size-4 animate-spin text-lime-300" />Caricamento pianificazione…</main>;
  if (state === "error" && !payload) return <main className="grid min-h-screen place-items-center bg-[#030504]"><Button variant="outline" onClick={() => void refresh()}><RefreshCw className="size-4" />Riprova</Button></main>;

  return <main className="min-h-screen bg-[#030504] px-4 py-5 text-slate-100 sm:px-7 sm:py-7"><div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_70%_0%,rgba(200,255,34,.07),transparent_27%),linear-gradient(145deg,#020403,#071008_48%,#030504)]" /><div className="relative mx-auto max-w-[1640px]">
    <header className="overflow-hidden rounded-[28px] border border-lime-300/20 bg-[linear-gradient(145deg,rgba(18,27,19,.97),rgba(4,7,5,.99)_62%,rgba(13,20,14,.98))] p-6 shadow-[0_30px_90px_rgba(0,0,0,.42)] sm:p-8"><div className="flex flex-wrap items-start justify-between gap-5"><div><p className="text-[10px] font-semibold uppercase tracking-[.24em] text-lime-300/70">AI-ZEROW / PLANNING CONTROL</p><h1 className="mt-3 text-3xl font-semibold tracking-[-.05em] text-lime-50 sm:text-[42px]">Pianificazione operativa</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">Attività giornaliere, missioni e risorse reali in un unico piano. Ogni bozza passa da disponibilità, capacità, qualifiche e concorrenza server-side.</p></div><div className="flex items-center gap-2"><Button className="bg-lime-300 text-xs font-semibold text-[#050705] hover:bg-lime-200" onClick={openCreate} disabled={!selectedJob}><Plus className="size-4" />Nuova attività</Button><button aria-label="Rileggi pianificazione" className="grid size-10 place-items-center rounded-xl border border-white/10 bg-black/30 text-slate-500 hover:border-lime-300/30 hover:text-lime-200" onClick={() => void refresh()} type="button"><RefreshCw className="size-4" /></button></div></div></header>
    <section className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
      { label: "Perimetri", value: payload?.summary?.jobs ?? jobs.length, icon: ClipboardList, detail: "commesse e missioni" },
      { label: "Piani", value: payload?.summary?.plans ?? plans.length, icon: CalendarClock, detail: "readback tenant" },
      { label: "Pubblicati", value: payload?.summary?.published ?? 0, icon: CheckCircle2, detail: "eseguibili" },
      { label: "Conflitti", value: payload?.summary?.conflicted ?? 0, icon: CircleAlert, detail: "da risolvere" },
    ].map(({ label, value, icon: Icon, detail }) => <article className="carbon-card rounded-[20px] p-4" key={label}><div className="flex items-start justify-between"><div><p className="text-[9px] font-semibold uppercase tracking-[.18em] text-slate-600">{label}</p><p className="mt-2 font-mono text-2xl text-lime-100">{value}</p><p className="mt-1 text-[9px] text-slate-600">{detail}</p></div><span className="grid size-9 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/[.07] text-lime-200"><Icon className="size-4" /></span></div></article>)}
    </section>
    <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(300px,.72fr)_minmax(0,1.28fr)]">
      <aside className="carbon-card rounded-[24px] p-4 sm:p-5"><div className="flex items-center justify-between gap-2"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">REGISTRO OPERATIVO</p><h2 className="mt-1 text-sm font-semibold text-slate-100">Perimetri pianificabili</h2></div><span className="font-mono text-[9px] text-slate-600">{filteredJobs.length} REC</span></div><Input aria-label="Cerca commesse e missioni" className="mt-4 h-10 border-white/10 bg-black/30 text-xs" onChange={(event) => setSearch(event.target.value)} placeholder="Cerca commessa, sede, scope…" value={search} /><div className="mt-3 space-y-2">{filteredJobs.map((job) => <button className={`w-full rounded-xl border p-3 text-left transition ${job.id === selectedJob?.id ? "border-lime-300/40 bg-lime-300/[.08] shadow-[0_0_24px_rgba(200,255,34,.08)]" : "border-white/[.08] bg-black/20 hover:border-lime-300/25"}`} key={job.id} onClick={() => setSelectedJobId(job.id)} type="button"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-[11px] font-semibold text-slate-100">{job.code ? `${job.code} · ` : ""}{job.title}</p><p className="mt-1 truncate text-[9px] text-slate-600">{job.location || "Sede da definire"}</p></div><span className={`shrink-0 rounded-full border px-2 py-1 text-[8px] font-semibold ${job.module === "mission" ? "border-cyan-300/20 bg-cyan-300/[.05] text-cyan-100" : "border-lime-300/15 bg-lime-300/[.04] text-lime-100"}`}>{moduleLabel(job.module)}</span></div><div className="mt-2 flex flex-wrap items-center gap-2 text-[9px] text-slate-600"><span>{job.status}</span>{job.scopeSubgroupTitle && <><span>·</span><span className="truncate">{job.scopeSubgroupTitle}</span></>}</div></button>)}{filteredJobs.length === 0 && <div className="rounded-xl border border-dashed border-lime-300/10 p-5 text-center text-[10px] text-slate-600">Nessun perimetro disponibile nel ruolo corrente.</div>}</div></aside>
      <section className="carbon-card rounded-[24px] p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">PIANO SELEZIONATO</p><h2 className="mt-1 text-lg font-semibold text-slate-100">{selectedJob?.title ?? "Seleziona un perimetro"}</h2><p className="mt-1 text-[10px] text-slate-500">{selectedJob?.scopeSubgroupTitle ? `Scope: ${selectedJob.scopeSubgroupTitle}` : "Le attività restano collegate al record operativo."}</p></div>{selectedJob && <span className="rounded-full border border-cyan-300/20 bg-cyan-300/[.05] px-2.5 py-1 font-mono text-[9px] text-cyan-100">{moduleLabel(selectedJob.module)}</span>}</div>{selectedJob && <div className="mt-4 grid gap-2 sm:grid-cols-3"><div className="rounded-xl border border-white/[.08] bg-black/20 p-3"><p className="text-[8px] uppercase tracking-[.14em] text-slate-600">Sede</p><p className="mt-2 truncate text-[11px] text-slate-300"><MapPin className="mr-1 inline size-3 text-cyan-200" />{selectedJob.location || "Da definire"}</p></div><div className="rounded-xl border border-white/[.08] bg-black/20 p-3"><p className="text-[8px] uppercase tracking-[.14em] text-slate-600">Scope</p><p className="mt-2 truncate text-[11px] text-slate-300">{selectedJob.scopeSubgroupTitle || "Non valorizzato"}</p></div><div className="rounded-xl border border-white/[.08] bg-black/20 p-3"><p className="text-[8px] uppercase tracking-[.14em] text-slate-600">Contratto</p><p className="mt-2 text-[11px] text-lime-100">ID risorse + readback</p></div></div>}<div className="mt-4 space-y-2">{selectedPlans.map((plan) => <article className="rounded-xl border border-white/[.08] bg-black/20 p-4" key={plan.id}><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><span className={`size-2 rounded-full ${plan.feasible ? "bg-lime-300 shadow-[0_0_10px_rgba(200,255,34,.7)]" : "bg-rose-400 shadow-[0_0_10px_rgba(255,85,56,.6)]"}`} /><h3 className="text-xs font-semibold text-slate-100">{plan.title}</h3></div><p className="mt-1 text-[9px] text-slate-600">{plan.activityType} · {plan.resourceCount} risorse · aggiornato {formatDate(plan.updatedAt)}</p></div><span className={`rounded-full border px-2 py-1 text-[8px] font-semibold ${plan.status === "PUBLISHED" ? "border-lime-300/25 bg-lime-300/[.07] text-lime-100" : plan.feasible ? "border-cyan-300/20 bg-cyan-300/[.05] text-cyan-100" : "border-rose-300/25 bg-rose-300/[.05] text-rose-100"}`}>{plan.status}</span></div><div className="mt-3 flex flex-wrap items-center gap-3 text-[10px] text-slate-400"><span><CalendarClock className="mr-1 inline size-3 text-lime-200" />{formatDate(plan.startsAt)} → {formatDate(plan.endsAt)}</span><span className={plan.feasible ? "text-lime-200" : "text-rose-200"}>{plan.feasible ? "CAPACITY OK" : "CONFLICT"}</span></div>{plan.status === "DRAFT" && <Button className="mt-3 h-9 bg-lime-300 text-[10px] font-semibold text-[#050705] hover:bg-lime-200" disabled={busy || !plan.feasible} onClick={() => void publishPlan(plan)}><Send className="size-3.5" />Pubblica piano</Button>}</article>)}{selectedJob && selectedPlans.length === 0 && <div className="rounded-xl border border-dashed border-lime-300/10 p-8 text-center"><CalendarClock className="mx-auto size-7 text-slate-700" /><p className="mt-3 text-[11px] text-slate-500">Nessun piano per questo perimetro.</p><Button className="mt-4 h-9 bg-lime-300 text-[10px] text-[#050705] hover:bg-lime-200" onClick={openCreate}><Plus className="size-3.5" />Crea la prima attività</Button></div>}</div></section>
    </section>
    <div className="mt-4 flex items-center gap-2 rounded-xl border border-cyan-300/15 bg-cyan-300/[.03] px-4 py-3 text-[10px] text-slate-500"><ShieldCheck className="size-3.5 shrink-0 text-cyan-200" />Le selezioni sono tenant-scoped. Persone, squadre, asset e mezzi arrivano dal registro e vengono ricontrollati prima di ogni scrittura.</div>
    {notice && <button className="fixed bottom-5 right-5 z-50 max-w-[370px] rounded-xl border border-lime-300/25 bg-[#080d09]/95 px-4 py-3 text-left text-xs text-lime-100" onClick={() => setNotice("")} type="button"><CheckCircle2 className="mr-2 inline size-4 text-lime-300" />{notice}</button>}
  </div>
  <Dialog open={modal} onOpenChange={setModal}><DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto border-lime-300/20 bg-[#080c09] text-slate-100 sm:max-w-[720px]"><DialogHeader><DialogTitle>Nuova attività pianificata</DialogTitle><DialogDescription className="text-slate-500">{selectedJob?.title ?? "Perimetro selezionato"} · il server verifica risorse, intervallo, qualifiche e conflitti prima del readback.</DialogDescription></DialogHeader><form className="grid gap-4 sm:grid-cols-2" onSubmit={createPlan}><label className="text-xs text-slate-400 sm:col-span-2">Titolo<Input className="mt-2 border-white/10 bg-black/30" onChange={(event) => setTitle(event.target.value)} value={title} required /></label><label className="text-xs text-slate-400">Tipo attività<select aria-label="Tipo attività" className="mt-2 h-10 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-xs text-slate-100 outline-none focus:border-lime-300/40" onChange={(event) => setActivityType(event.target.value as "WORK" | "TRANSPORT")} value={activityType}><option value="WORK">Lavorazione commessa</option><option value="TRANSPORT">Trasporto / missione</option></select></label><label className="text-xs text-slate-400">Luogo<Input className="mt-2 border-white/10 bg-black/30" onChange={(event) => setLocation(event.target.value)} value={location} /></label><label className="text-xs text-slate-400">Inizio<Input className="mt-2 border-white/10 bg-black/30" onChange={(event) => setStartsAt(event.target.value)} type="datetime-local" value={startsAt} required /></label><label className="text-xs text-slate-400">Fine<Input className="mt-2 border-white/10 bg-black/30" onChange={(event) => setEndsAt(event.target.value)} type="datetime-local" value={endsAt} required /></label><div className="sm:col-span-2"><PlanningResourceFields jobId={selectedJob?.id ?? ""} selectedIds={resourceIds} onChange={setResourceIds} /></div><label className="text-xs text-slate-400 sm:col-span-2">Note operative<Textarea className="mt-2 border-white/10 bg-black/30" onChange={(event) => setNotes(event.target.value)} value={notes} /></label><DialogFooter className="sm:col-span-2"><DialogClose asChild><Button type="button" variant="outline" className="border-white/10 bg-transparent text-slate-400"><X className="size-3.5" />Annulla</Button></DialogClose><Button disabled={busy || !resourceIds.length} type="submit" className="bg-lime-300 text-[#050705] hover:bg-lime-200">{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}Salva bozza</Button></DialogFooter></form></DialogContent></Dialog>
  </main>;
}
