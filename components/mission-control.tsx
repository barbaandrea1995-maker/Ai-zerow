"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "@/components/app-link";
import { CheckCircle2, CircleGauge, LoaderCircle, MapPin, Navigation, PackageCheck, Play, RefreshCw, Send, ShieldCheck, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MissionResourceFields } from "@/components/mission-resource-fields";
import { TRANSPORT_MODE_CATALOG, type TransportMode } from "@/lib/tenant-operating-model";

type Mission = { id: string; jobId: string; jobCode: string | null; jobTitle: string; jobModule: string; title: string; status: string; version: number; payload: Record<string, unknown>; createdAt: string; updatedAt: string };
type MissionJob = { id: string; code: string | null; title: string; client: string | null; location: string | null; status: string };
type MissionPayload = { context: { capabilities: string[]; operatingTransportModes?: TransportMode[] }; jobs: MissionJob[]; missions: Mission[]; summary: { total: number; planned: number; dispatched: number; delivered: number } };
type Modal = "create" | "deliver" | null;

function field(form: FormData, key: string) { const value = form.get(key); return typeof value === "string" ? value.trim() : ""; }
function text(value: unknown, fallback = "—") { return typeof value === "string" && value.trim() ? value.trim() : fallback; }

export default function MissionControl() {
  const [payload, setPayload] = useState<MissionPayload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "forbidden" | "error">("loading");
  const [modal, setModal] = useState<Modal>(null);
  const [selected, setSelected] = useState<Mission | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [plannedAt, setPlannedAt] = useState("");
  const [plannedEndAt, setPlannedEndAt] = useState("");
  const [driverId, setDriverId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [cargoAssetId, setCargoAssetId] = useState("");
  const [transportMode, setTransportMode] = useState<TransportMode | "">("");
  const notify = useCallback((message: string) => { setNotice(message); window.setTimeout(() => setNotice(""), 3200); }, []);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/mission/control", { cache: "no-store" });
      if (response.status === 403) { setState("forbidden"); return; }
      if (!response.ok) throw new Error("mission_control_unavailable");
      setPayload(await response.json() as MissionPayload); setState("ready");
    } catch { setState("error"); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void refresh(), 0); return () => window.clearTimeout(timer); }, [refresh]);
  const canWrite = payload?.context.capabilities.includes("mission.write") ?? false;
  const enabledTransportModes = payload?.context.operatingTransportModes ?? [];

  const mutate = useCallback(async (jobId: string, action: string, body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const response = await fetch(`/api/operations/jobs/${encodeURIComponent(jobId)}/journey`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, idempotencyKey: `mission-${action}-${crypto.randomUUID()}`, ...body }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) { notify(`Operazione non eseguita: ${result.error ?? "errore"}`); if (response.status === 409) await refresh(); return; }
      await refresh(); setModal(null); setSelected(null); notify("Missione aggiornata e riletta dal ledger.");
    } catch { notify("Connessione non disponibile: nessuna modifica confermata."); }
    finally { setBusy(false); }
  }, [notify, refresh]);

  const createStandalone = useCallback(async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const response = await fetch("/api/mission/control", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "mission_create", idempotencyKey: `mission-standalone-${crypto.randomUUID()}`, ...body }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) { notify(`Operazione non eseguita: ${result.error ?? "errore"}`); if (response.status === 409) await refresh(); return; }
      await refresh(); setModal(null); notify("Missione autonoma aggiornata e riletta dal ledger.");
    } catch { notify("Connessione non disponibile: nessuna modifica confermata."); }
    finally { setBusy(false); }
  }, [notify, refresh]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (modal === "create") {
      const jobId = field(form, "jobId");
      const linkedJobCount = payload?.jobs.length ?? 0;
      if ((!jobId && linkedJobCount > 0) || !field(form, "driverId") || !field(form, "vehicleId")) {
        notify("Seleziona commessa (se presente), autista e mezzo realmente disponibili.");
        return;
      }
      const body = { title: field(form, "title"), pickup: field(form, "pickup"), dropoff: field(form, "dropoff"), plannedAt: field(form, "plannedAt"), plannedEndAt: field(form, "plannedEndAt"), driverId: field(form, "driverId"), vehicleId: field(form, "vehicleId"), cargoAssetId: field(form, "cargoAssetId"), transportMode: field(form, "transportMode"), notes: field(form, "notes") };
      if (jobId === "__standalone__") await createStandalone(body);
      else await mutate(jobId, "mission_create", body);
    }
    if (modal === "deliver" && selected) await mutate(selected.jobId, "mission_deliver", { recordId: selected.id, expectedVersion: selected.version, recipient: field(form, "recipient"), deliveredAt: field(form, "deliveredAt"), evidenceType: field(form, "evidenceType") || "AUTHORIZED_DRIVER_CONFIRMATION", evidenceReference: field(form, "evidenceReference"), documentId: field(form, "documentId"), note: field(form, "note") });
  };

  if (state === "loading") return <main className="grid min-h-screen place-items-center bg-[#030504] text-xs text-slate-500"><LoaderCircle className="mr-2 inline size-4 animate-spin text-lime-300" />Caricamento trasporti…</main>;
  if (state === "forbidden") return <main className="grid min-h-screen place-items-center bg-[#030504] text-slate-100"><section className="carbon-card rounded-3xl p-7 text-center"><ShieldCheck className="mx-auto size-8 text-amber-200" /><p className="mt-4 text-sm">Il ruolo corrente non dispone di mission.read.</p></section></main>;
  if (state === "error" || !payload) return <main className="grid min-h-screen place-items-center bg-[#030504]"><Button variant="outline" onClick={() => void refresh()}><RefreshCw className="size-4" />Riprova</Button></main>;

  return <main className="min-h-screen bg-[#030504] px-4 py-5 text-slate-100 sm:px-7 sm:py-7"><div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_70%_0%,rgba(200,255,34,.08),transparent_26%),linear-gradient(145deg,#020403,#071008_48%,#030504)]" /><div className="relative mx-auto max-w-[1560px]">
    <header className="relative overflow-hidden rounded-[28px] border border-lime-300/20 bg-[linear-gradient(145deg,rgba(18,27,19,.97),rgba(4,7,5,.99)_60%,rgba(13,20,14,.98))] p-6 shadow-[0_30px_90px_rgba(0,0,0,.42)] sm:p-8"><div className="pointer-events-none absolute -right-44 -top-48 size-[34rem] rounded-full bg-lime-300/[.065] blur-3xl" /><div className="relative flex flex-wrap items-start justify-between gap-5"><div><p className="text-[10px] font-semibold uppercase tracking-[.24em] text-lime-300/70">AI-ZEROW / TRANSPORT CONTROL</p><h1 className="mt-3 text-3xl font-semibold tracking-[-.05em] text-lime-50 sm:text-[42px]">Missioni e consegne</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">Pianificazione viaggio, partenza e prova di consegna collegate alla commessa. Autisti, mezzi e asset arrivano dal registro tenant.</p></div><div className="flex flex-wrap items-center justify-end gap-2">{canWrite && enabledTransportModes.length > 0 && <Button className="bg-lime-300 text-xs font-semibold text-[#050705] hover:bg-lime-200" onClick={() => { setPlannedAt(""); setPlannedEndAt(""); setDriverId(""); setVehicleId(""); setCargoAssetId(""); setTransportMode((enabledTransportModes.includes("ASSET_TRANSFER") ? "ASSET_TRANSFER" : enabledTransportModes[0]) ?? ""); setModal("create"); }}><Truck className="size-4" />Nuova missione</Button>}{canWrite && enabledTransportModes.length === 0 && <span className="rounded-xl border border-amber-300/15 bg-amber-300/[.04] px-3 py-2 text-[10px] text-amber-200/80">Nessuna modalità di trasporto abilitata</span>}<button aria-label="Rileggi missioni" className="grid size-10 place-items-center rounded-xl border border-white/10 bg-black/30 text-slate-500 hover:border-lime-300/30 hover:text-lime-200" onClick={() => void refresh()} type="button"><RefreshCw className="size-4" /></button></div></div></header>
    <section className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
      { label: "Totali", value: payload.summary.total, icon: Truck }, { label: "Pianificate", value: payload.summary.planned, icon: CircleGauge }, { label: "In viaggio", value: payload.summary.dispatched, icon: Navigation }, { label: "Consegnate", value: payload.summary.delivered, icon: PackageCheck },
    ].map(({ label, value, icon: Icon }) => <article className="carbon-card rounded-[20px] p-4" key={label}><div className="flex items-start justify-between"><div><p className="text-[9px] font-semibold uppercase tracking-[.18em] text-slate-600">{label}</p><p className="mt-2 font-mono text-2xl text-lime-100">{value}</p></div><span className="grid size-9 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/[.07] text-lime-200"><Icon className="size-4" /></span></div></article>)}</section>
    <section className="mt-4 grid gap-3 lg:grid-cols-2">{payload.missions.map((mission) => <article className="carbon-card rounded-[22px] p-5" key={mission.id}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-[9px] font-semibold uppercase tracking-[.16em] text-lime-300/65">{mission.jobCode ?? mission.jobId}</p><h2 className="mt-2 truncate text-base font-semibold text-slate-100">{mission.title}</h2><p className="mt-1 truncate text-[10px] text-slate-600">{mission.jobTitle}{mission.jobModule === "mission" ? " · missione autonoma" : ""}</p></div><span className={`rounded-full border px-2.5 py-1 text-[8px] font-semibold ${mission.status === "DELIVERED" ? "border-lime-300/25 bg-lime-300/[.08] text-lime-100" : mission.status === "DISPATCHED" ? "border-cyan-300/25 bg-cyan-300/[.08] text-cyan-100" : "border-amber-300/25 bg-amber-300/[.08] text-amber-100"}`}>{mission.status}</span></div><div className="mt-4 grid gap-2 sm:grid-cols-2"><div className="rounded-xl border border-white/[.07] bg-black/25 p-3"><p className="text-[8px] uppercase tracking-[.13em] text-slate-600">Partenza</p><p className="mt-1 text-[11px] text-slate-300"><MapPin className="mr-1 inline size-3 text-cyan-200" />{text(mission.payload.pickup)}</p></div><div className="rounded-xl border border-white/[.07] bg-black/25 p-3"><p className="text-[8px] uppercase tracking-[.13em] text-slate-600">Destinazione</p><p className="mt-1 text-[11px] text-slate-300"><MapPin className="mr-1 inline size-3 text-lime-200" />{text(mission.payload.dropoff)}</p></div></div><div className="mt-4 flex flex-wrap items-center gap-2">{mission.jobModule === "operations" && <Link className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-[9px] text-slate-400 hover:border-lime-300/25 hover:text-lime-100" href={`/operations/${encodeURIComponent(mission.jobId)}`}>Apri commessa</Link>}{canWrite && mission.status === "PLANNED" && <Button variant="outline" className="h-8 border-cyan-300/20 bg-cyan-300/[.05] text-[9px] text-cyan-100" onClick={() => void mutate(mission.jobId, "mission_dispatch", { recordId: mission.id, expectedVersion: mission.version })}><Play className="size-3" />Registra partenza</Button>}{canWrite && mission.status === "DISPATCHED" && <Button variant="outline" className="h-8 border-lime-300/20 bg-lime-300/[.05] text-[9px] text-lime-100" onClick={() => { setSelected(mission); setModal("deliver"); }}><CheckCircle2 className="size-3" />Consegna / POD</Button>}</div></article>)}{payload.missions.length === 0 && <section className="carbon-card rounded-[24px] p-10 text-center lg:col-span-2"><Truck className="mx-auto size-8 text-slate-700" /><p className="mt-3 text-xs text-slate-500">Nessuna missione registrata.</p></section>}</section>
  </div>
  <Dialog open={modal !== null} onOpenChange={(open) => !open && setModal(null)}><DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto border-lime-300/20 bg-[#080c09] text-slate-100 sm:max-w-[640px]"><DialogHeader><DialogTitle>{modal === "create" ? "Nuova missione" : "Prova di consegna"}</DialogTitle><DialogDescription className="text-slate-500">La missione può collegarsi a una commessa reale oppure nascere come trasporto autonomo. Autista, mezzo, tenant e conflitti vengono ricontrollati dal server.</DialogDescription></DialogHeader><form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>{modal === "create" ? <>{payload.jobs.length > 0 ? <label className="text-xs text-slate-400 sm:col-span-2">Commessa o trasporto autonomo<select aria-label="Commessa o trasporto autonomo" className="mt-2 h-10 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-xs text-slate-100 outline-none focus:border-lime-300/40" name="jobId" required><option value="">Seleziona collegamento</option><option value="__standalone__">Missione autonoma · nessuna commessa</option>{payload.jobs.map((job) => <option key={job.id} value={job.id}>{job.code ? `${job.code} · ` : ""}{job.title}{job.location ? ` · ${job.location}` : ""}</option>)}</select></label> : <><input type="hidden" name="jobId" value="__standalone__" /><div className="sm:col-span-2 rounded-xl border border-cyan-300/15 bg-cyan-300/[.04] p-3 text-[10px] leading-5 text-cyan-100/80">Nessuna commessa nel tenant: questa sarà una missione autonoma di trasporto, con codice generato dal server.</div></>}<label className="text-xs text-slate-400 sm:col-span-2">Titolo<Input className="mt-2 border-white/10 bg-black/30" name="title" defaultValue="Missione di trasporto" required /></label><label className="text-xs text-slate-400">Modalità trasporto<select aria-label="Modalità trasporto" className="mt-2 h-10 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-xs text-slate-100 outline-none focus:border-lime-300/40 focus:ring-2 focus:ring-lime-300/10" name="transportMode" onChange={(event) => setTransportMode(event.target.value as TransportMode)} required value={transportMode}>{enabledTransportModes.map((mode) => <option key={mode} value={mode}>{TRANSPORT_MODE_CATALOG[mode]?.label ?? mode}</option>)}</select></label><label className="text-xs text-slate-400">Partenza<Input className="mt-2 border-white/10 bg-black/30" name="pickup" required /></label><label className="text-xs text-slate-400">Destinazione<Input className="mt-2 border-white/10 bg-black/30" name="dropoff" required /></label><label className="text-xs text-slate-400">Inizio pianificato<Input className="mt-2 border-white/10 bg-black/30" name="plannedAt" type="datetime-local" onChange={(event) => setPlannedAt(event.target.value)} required value={plannedAt} /></label><label className="text-xs text-slate-400">Fine pianificata <span className="text-slate-600">(opzionale)</span><Input className="mt-2 border-white/10 bg-black/30" name="plannedEndAt" type="datetime-local" onChange={(event) => setPlannedEndAt(event.target.value)} value={plannedEndAt} /></label><MissionResourceFields plannedAt={plannedAt} plannedEndAt={plannedEndAt} driverId={driverId} vehicleId={vehicleId} cargoAssetId={cargoAssetId} onDriverChange={setDriverId} onVehicleChange={setVehicleId} onCargoAssetChange={setCargoAssetId} /><label className="text-xs text-slate-400 sm:col-span-2">Note<Textarea className="mt-2 border-white/10 bg-black/30" name="notes" /></label></> : <><label className="text-xs text-slate-400 sm:col-span-2">Ricevente<Input className="mt-2 border-white/10 bg-black/30" name="recipient" required /></label><label className="text-xs text-slate-400 sm:col-span-2">Data consegna<Input className="mt-2 border-white/10 bg-black/30" name="deliveredAt" type="datetime-local" required /></label><label className="text-xs text-slate-400 sm:col-span-2">Nota POD<Textarea className="mt-2 border-white/10 bg-black/30" name="note" /></label></>}<DialogFooter className="sm:col-span-2"><DialogClose asChild><Button type="button" variant="outline" className="border-white/10 bg-transparent text-slate-400">Annulla</Button></DialogClose><Button disabled={busy} type="submit" className="bg-lime-300 text-[#050705] hover:bg-lime-200">{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}Conferma</Button></DialogFooter></form></DialogContent></Dialog>
  {notice && <button className="fixed bottom-5 right-5 z-50 max-w-[370px] rounded-xl border border-lime-300/25 bg-[#080d09]/95 px-4 py-3 text-left text-xs text-lime-100" onClick={() => setNotice("")} type="button"><CheckCircle2 className="mr-2 inline size-4 text-lime-300" />{notice}</button>}
  </main>;
}
