"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  BriefcaseBusiness,
  Check,
  CheckCircle2,
  ClipboardCheck,
  CircleGauge,
  FileText,
  HardHat,
  LoaderCircle,
  MapPin,
  Package,
  Plus,
  Save,
  Send,
  ShieldCheck,
  Truck,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type WorkspaceRecord = {
  id: string;
  module: string;
  recordType: string;
  title: string;
  detail: string;
  meta: string;
  status: string;
  progress: number;
  payload?: Record<string, unknown>;
};

type WorkspaceSection = {
  status: "readback" | "empty" | "deferred";
  count: number;
  records: WorkspaceRecord[];
};

type CompletionRequirement = {
  key: string;
  label: string;
  complete: boolean;
  detail: string;
};

type WorkspacePayload = {
  job: WorkspaceRecord & { payload?: Record<string, unknown> };
  workspace: {
    sections: {
      activities: WorkspaceSection;
      planning: WorkspaceSection;
      resources: WorkspaceSection;
      materials: WorkspaceSection;
      field: WorkspaceSection;
      rapportino: WorkspaceSection;
      control: WorkspaceSection;
      evidence: WorkspaceSection;
    };
    journey: Array<{ key: string; label: string; status: "readback" | "empty" | "deferred" }>;
    completion: { ready: boolean; requirements: CompletionRequirement[] };
  };
  readback?: { version?: number };
  mutation?: { action: string; version?: number; readback?: string };
};

type ActionKind = "details" | "activity" | "assign" | "evidence" | "report" | "progress" | null;

function sectionLabel(status: WorkspaceSection["status"]) {
  if (status === "readback") return "D1 READBACK";
  if (status === "deferred") return "GATE SUCCESSIVO";
  return "NESSUN DATO";
}

function statusClass(status: WorkspaceSection["status"]) {
  if (status === "readback") return "border-lime-300/25 bg-lime-300/10 text-lime-200";
  if (status === "deferred") return "border-amber-300/25 bg-amber-300/10 text-amber-200";
  return "border-white/10 bg-black/20 text-slate-500";
}

function statusTone(status: string) {
  if (status === "ACTIVE" || status === "IN CORSO") return "border-lime-300/25 bg-lime-300/10 text-lime-200";
  if (status === "BLOCKED" || status === "BLOCCATA") return "border-rose-300/25 bg-rose-300/10 text-rose-200";
  if (status === "COMPLETED" || status === "COMPLETATA" || status === "CLOSED" || status === "CHIUSA") return "border-amber-300/25 bg-amber-300/10 text-amber-200";
  return "border-cyan-300/25 bg-cyan-300/10 text-cyan-200";
}

function WorkspaceSectionCard({
  title,
  eyebrow,
  icon: Icon,
  section,
  onCompleteActivity,
}: {
  title: string;
  eyebrow: string;
  icon: typeof BriefcaseBusiness;
  section: WorkspaceSection;
  onCompleteActivity?: (activityId: string) => void;
}) {
  return <section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div className="flex items-start gap-3"><span className="grid size-9 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/10 text-lime-200"><Icon className="size-4" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-lime-300/65">{eyebrow}</p><h2 className="mt-1 text-[15px] font-semibold text-slate-100">{title}</h2></div></div><span className={`rounded-full border px-2 py-1 text-[9px] font-semibold tracking-[0.08em] ${statusClass(section.status)}`}>{sectionLabel(section.status)}</span></div><div className="mt-4 space-y-2">{section.records.map((record) => { const activityId = typeof record.payload?.id === "string" ? record.payload.id : null; return <div className="carbon-inset flex items-center gap-3 rounded-xl p-3" key={record.id}><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-slate-200">{record.title}</p><p className="mt-1 truncate text-[10px] text-slate-500">{record.detail} · {record.meta}</p></div><span className={`rounded-full border px-2 py-1 text-[9px] font-semibold ${statusTone(record.status)}`}>{record.status}</span>{onCompleteActivity && activityId && record.status !== "DONE" && <button aria-label={`Completa ${record.title}`} className="grid size-7 place-items-center rounded-lg border border-lime-300/20 text-lime-200 transition hover:bg-lime-300/10" onClick={() => onCompleteActivity(activityId)} type="button"><Check className="size-3.5" /></button>}</div>; })}{section.records.length === 0 && <p className="rounded-xl border border-white/[0.08] bg-black/15 px-3 py-4 text-center text-[11px] leading-5 text-slate-500">{section.status === "deferred" ? "Questa parte resta esplicitamente fuori dalla tranche W03." : "Nessun record collegato alla commessa nel readback tenant-scoped."}</p>}</div></section>;
}

export default function OperationsJobWorkspace({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [payload, setPayload] = useState<WorkspacePayload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unauthenticated" | "forbidden" | "missing" | "error">("loading");
  const [actionOpen, setActionOpen] = useState<ActionKind>(null);
  const [toast, setToast] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [client, setClient] = useState("");
  const [location, setLocation] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [activityTitle, setActivityTitle] = useState("");
  const [activityDetail, setActivityDetail] = useState("");
  const [activityOwner, setActivityOwner] = useState("");
  const [activityDueDate, setActivityDueDate] = useState("");
  const [responsible, setResponsible] = useState("");
  const [team, setTeam] = useState("");
  const [role, setRole] = useState("Responsabile operativo");
  const [evidenceTitle, setEvidenceTitle] = useState("");
  const [evidenceDetail, setEvidenceDetail] = useState("");
  const [reportText, setReportText] = useState("");
  const [progress, setProgress] = useState(0);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  }, []);

  const refresh = useCallback(async () => {
    setState("loading");
    try {
      const response = await fetch(`/api/operations/jobs/${encodeURIComponent(jobId)}`, { cache: "no-store" });
      if (response.status === 401) throw new Error("unauthenticated");
      if (response.status === 403) throw new Error("forbidden");
      if (response.status === 404) throw new Error("missing");
      if (!response.ok) throw new Error("error");
      const nextPayload = await response.json() as WorkspacePayload;
      setPayload(nextPayload);
      setProgress(nextPayload.job.progress);
      setTitle(typeof nextPayload.job.payload?.title === "string" ? nextPayload.job.payload.title : nextPayload.job.title);
      setDescription(typeof nextPayload.job.payload?.description === "string" ? nextPayload.job.payload.description : "");
      setClient(typeof nextPayload.job.payload?.client === "string" ? nextPayload.job.payload.client : "");
      setLocation(typeof nextPayload.job.payload?.location === "string" ? nextPayload.job.payload.location : nextPayload.job.detail);
      setDueDate(typeof nextPayload.job.payload?.dueDate === "string" ? nextPayload.job.payload.dueDate : nextPayload.job.meta);
      setState("ready");
    } catch (error: unknown) {
      const code = error instanceof Error ? error.message : "error";
      setState(code === "unauthenticated" || code === "forbidden" || code === "missing" ? code : "error");
    }
  }, [jobId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const mutate = useCallback(async (action: string, body: Record<string, unknown>) => {
    if (!payload) return;
    const response = await fetch(`/api/operations/jobs/${encodeURIComponent(jobId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action,
        expectedVersion: payload.readback?.version ?? 1,
        idempotencyKey: `w03-${jobId}-${action}-${crypto.randomUUID()}`,
        ...body,
      }),
    });
    const nextPayload = await response.json() as WorkspacePayload & { error?: string };
    if (!response.ok) {
      const requirements = (nextPayload as WorkspacePayload & { requirements?: CompletionRequirement[] }).requirements;
      if (nextPayload.error === "completion_requirements_unmet" && requirements) {
        const missing = requirements.filter((requirement) => !requirement.complete).map((requirement) => requirement.label).join(", ");
        notify(`Completamento bloccato: ${missing || "requisiti mancanti"}`);
      } else {
        notify(nextPayload.error === "version_conflict" ? "La commessa è cambiata: ricarico il readback." : `Operazione non eseguita: ${nextPayload.error ?? "errore"}`);
      }
      if (response.status === 409) await refresh();
      return;
    }
    setPayload(nextPayload);
    setProgress(nextPayload.job.progress);
    setActionOpen(null);
    notify(`Readback verificato · ${action.replaceAll("_", " ")}`);
  }, [jobId, notify, payload, refresh]);

  const nextStatusAction = useMemo(() => {
    const status = payload?.job.status ?? "";
    if (status === "BOZZA") return { label: "Invia in proposta", statusCode: "PROPOSED" };
    if (status === "PROPOSTA") return { label: "Approva commessa", statusCode: "APPROVED" };
    if (status === "APPROVATA") return { label: "Pianifica commessa", statusCode: "PLANNED" };
    if (status === "PIANIFICATA") return { label: "Avvia commessa", statusCode: "ACTIVE" };
    if (status === "IN CORSO") return { label: "Verifica completamento", statusCode: "COMPLETED" };
    if (status === "BLOCCATA") return { label: "Riprendi commessa", statusCode: "ACTIVE" };
    if (status === "COMPLETATA") return { label: "Chiudi commessa", statusCode: "CLOSED" };
    return null;
  }, [payload?.job.status]);

  const submitAction = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (actionOpen === "details") await mutate("update_job", { fields: { title, description, client, location, dueDate } });
    if (actionOpen === "activity") await mutate("add_activity", { title: activityTitle, detail: activityDetail, owner: activityOwner, dueDate: activityDueDate });
    if (actionOpen === "assign") await mutate("assign", { responsible, team, role });
    if (actionOpen === "evidence") await mutate("add_evidence", { title: evidenceTitle, detail: evidenceDetail, kind: "note" });
    if (actionOpen === "report") await mutate("save_rapportino", { text: reportText });
    if (actionOpen === "progress") await mutate("set_progress", { progress });
  };

  const openDetails = () => {
    if (!payload) return;
    setTitle(typeof payload.job.payload?.title === "string" ? payload.job.payload.title : payload.job.title);
    setDescription(typeof payload.job.payload?.description === "string" ? payload.job.payload.description : "");
    setClient(typeof payload.job.payload?.client === "string" ? payload.job.payload.client : "");
    setLocation(typeof payload.job.payload?.location === "string" ? payload.job.payload.location : payload.job.detail);
    setDueDate(typeof payload.job.payload?.dueDate === "string" ? payload.job.payload.dueDate : payload.job.meta);
    setActionOpen("details");
  };

  if (state === "loading") return <main className="grid min-h-screen place-items-center bg-[#050607] text-slate-100"><div className="flex items-center gap-3 text-xs text-slate-500"><LoaderCircle className="size-4 animate-spin text-lime-300" />Caricamento workspace commessa…</div></main>;

  if (state !== "ready" || !payload) {
    const message = state === "unauthenticated" ? "Accedi per leggere il workspace della commessa." : state === "forbidden" ? "Il ruolo corrente non dispone di operations.read." : state === "missing" ? "La commessa non è presente nel readback tenant-scoped." : "Il workspace non è momentaneamente disponibile.";
    return <main className="grid min-h-screen place-items-center bg-[#050607] px-5 text-slate-100"><section className="carbon-card w-full max-w-lg rounded-2xl p-6 text-center"><ShieldCheck className="mx-auto size-8 text-amber-200" /><h1 className="mt-4 text-lg font-semibold">Workspace non disponibile</h1><p className="mt-2 text-xs leading-5 text-slate-500">{message}</p><div className="mt-5 flex justify-center gap-2"><Button variant="outline" className="border-white/10 bg-black/20 text-xs text-slate-300" onClick={() => router.push("/operations")}><ArrowLeft className="size-3.5" />Torna alle commesse</Button>{state === "unauthenticated" && <Button className="bg-lime-300 text-xs font-semibold text-[#060806]" onClick={() => router.push(`/login?next=${encodeURIComponent(`/operations/${jobId}`)}`)}>Accedi</Button>}</div></section></main>;
  }

  const { job, workspace } = payload;
  const version = payload.readback?.version ?? 1;
  const clientName = typeof job.payload?.client === "string" && job.payload.client ? job.payload.client : "Cliente da definire";
  const jobDescription = typeof job.payload?.description === "string" ? job.payload.description : "Descrizione non ancora inserita.";

  return <main className="min-h-screen overflow-x-hidden bg-[#050607] text-slate-100"><div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_74%_0%,rgba(190,255,60,0.07),transparent_25%),radial-gradient(circle_at_18%_78%,rgba(70,110,120,0.08),transparent_27%)]" /><div className="relative mx-auto max-w-[1440px] px-4 py-5 sm:px-7 sm:py-8"><header className="flex flex-wrap items-center justify-between gap-4"><div className="flex items-center gap-3"><Button variant="outline" className="h-9 border-white/10 bg-black/20 px-3 text-xs text-slate-300 hover:border-lime-300/30 hover:text-lime-100" onClick={() => router.push("/operations")}><ArrowLeft className="size-3.5" />Commesse</Button><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/70">AI-ZEROW / OPERATIONS / JOB WORKSPACE</p><h1 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-slate-50">{job.id} · {job.title}</h1></div></div><span className="inline-flex items-center gap-2 rounded-full border border-lime-300/20 bg-lime-300/5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-lime-200"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_9px_rgba(190,255,60,0.9)]" />D1 scoped readback · v{version}</span></header>
    <section className="carbon-card carbon-card-neon mt-5 rounded-2xl p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-5"><div><p className="font-mono text-xs text-lime-200">{job.id}</p><h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-50">{job.title}</h2><p className="mt-2 flex items-center gap-2 text-xs text-slate-500"><MapPin className="size-3.5 text-cyan-200" />{job.detail}</p><p className="mt-2 max-w-2xl text-xs leading-5 text-slate-400">{jobDescription}</p></div><div className="text-left sm:text-right"><p className="text-[10px] uppercase tracking-[0.16em] text-slate-600">Stato</p><p className={`mt-1 inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusTone(job.status)}`}>{job.status}</p><p className="mt-2 text-[11px] text-slate-500">{clientName} · {job.meta}</p></div></div><div className="mt-6"><div className="flex items-center justify-between text-[10px] text-slate-500"><span>Avanzamento commessa</span><span className="font-mono text-lime-200">{job.progress}%</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-lime-300 shadow-[0_0_16px_rgba(190,255,60,0.64)]" style={{ width: `${job.progress}%` }} /></div></div><div className="mt-5 flex flex-wrap gap-2"><Button variant="outline" className="h-9 border-white/10 bg-black/20 text-xs text-slate-300 hover:border-lime-300/30 hover:bg-lime-300/10" onClick={openDetails}><BriefcaseBusiness className="size-3.5" />Modifica scheda</Button>{nextStatusAction && <Button className="h-9 bg-lime-300 text-xs font-semibold text-[#060806] hover:bg-lime-200" onClick={() => void mutate("set_status", { statusCode: nextStatusAction.statusCode })}><Send className="size-3.5" />{nextStatusAction.label}</Button>}<Button variant="outline" className="h-9 border-cyan-300/25 bg-cyan-300/5 text-xs text-cyan-100 hover:bg-cyan-300/10" onClick={() => setActionOpen("progress")}><CircleGauge className="size-3.5" />Aggiorna avanzamento</Button></div></section>
    <section className="carbon-card mt-4 rounded-2xl p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-200/70">COMPLETION GATE</p><h2 className="mt-1 text-[15px] font-semibold">La commessa non si chiude da sola</h2><p className="mt-1 text-[11px] leading-5 text-slate-500">Il 100% è solo avanzamento. La chiusura richiede un controllo esplicito di scheda, attività, assegnazione, evidenze e rapportino.</p></div><span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${workspace.completion.ready ? "border-lime-300/25 bg-lime-300/10 text-lime-200" : "border-amber-300/25 bg-amber-300/10 text-amber-200"}`}>{workspace.completion.ready ? "PRONTA ALLA VERIFICA" : "REQUISITI INCOMPLETI"}</span></div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{workspace.completion.requirements.map((requirement) => <div className={`rounded-lg border px-3 py-2 ${requirement.complete ? "border-lime-300/15 bg-lime-300/[0.04]" : "border-amber-300/15 bg-amber-300/[0.035]"}`} key={requirement.key}><div className="flex items-center gap-2"><span className={`grid size-5 place-items-center rounded-full border ${requirement.complete ? "border-lime-300/30 bg-lime-300/10 text-lime-200" : "border-amber-300/25 text-amber-200"}`}>{requirement.complete ? <Check className="size-3" /> : <span className="size-1.5 rounded-full bg-current" />}</span><span className="text-[11px] font-medium text-slate-200">{requirement.label}</span></div><p className="mt-1 pl-7 text-[10px] leading-4 text-slate-500">{requirement.detail}</p></div>)}</div></section>
    <section className="carbon-card mt-4 rounded-2xl p-4 sm:p-5"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-200"><HardHat className="size-4" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200/70">W03 / COMMESSA END-TO-END</p><h2 className="mt-1 text-[15px] font-semibold">Job → Activity → Planning → Assignment → Attendance → Work Context → Field → Rapportino → Controllo</h2></div></div><div className="mt-5 flex flex-wrap gap-2">{workspace.journey.map((step) => <span className={`rounded-full border px-2.5 py-1.5 text-[10px] ${statusClass(step.status)}`} key={step.key}>{step.label} · {step.status === "readback" ? "READBACK" : step.status === "deferred" ? "DEFERRED" : "EMPTY"}</span>)}</div></section>
    <section className="carbon-card mt-4 rounded-2xl p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-lime-300/65">W03 / OPERATIVE ACTIONS</p><h2 className="mt-1 text-[15px] font-semibold text-slate-100">Completa il contesto della commessa</h2></div><span className="rounded-full border border-lime-300/20 bg-lime-300/5 px-2.5 py-1 text-[10px] text-lime-200">server write · readback</span></div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5"><Button variant="outline" className="h-10 border-white/10 bg-black/20 text-xs text-slate-300 hover:border-lime-300/30" onClick={() => setActionOpen("activity")}><Plus className="size-3.5" />Aggiungi attività</Button><Button variant="outline" className="h-10 border-white/10 bg-black/20 text-xs text-slate-300 hover:border-lime-300/30" onClick={() => setActionOpen("assign")}><Users className="size-3.5" />Assegna risorse</Button><Button variant="outline" className="h-10 border-white/10 bg-black/20 text-xs text-slate-300 hover:border-lime-300/30" onClick={() => setActionOpen("evidence")}><MapPin className="size-3.5" />Registra evidenza</Button><Button variant="outline" className="h-10 border-white/10 bg-black/20 text-xs text-slate-300 hover:border-lime-300/30" onClick={() => setActionOpen("report")}><FileText className="size-3.5" />Apri rapportino</Button><Button variant="outline" className="h-10 border-white/10 bg-black/20 text-xs text-slate-300 hover:border-lime-300/30" onClick={() => void refresh()}><Save className="size-3.5" />Rileggi stato</Button></div></section>
    <div className="mt-4 grid gap-4 lg:grid-cols-2"><WorkspaceSectionCard eyebrow="ACTIVITY" title="Attività collegate" icon={ClipboardCheck} section={workspace.sections.activities} onCompleteActivity={(activityId) => void mutate("complete_activity", { activityId })} /><WorkspaceSectionCard eyebrow="PLANNING" title="Pianificazione e assegnazioni" icon={Users} section={workspace.sections.planning} /><WorkspaceSectionCard eyebrow="RESOURCES" title="Risorse e mezzi" icon={Truck} section={workspace.sections.resources} /><WorkspaceSectionCard eyebrow="MATERIALS" title="Materiali e magazzino" icon={Package} section={workspace.sections.materials} /><WorkspaceSectionCard eyebrow="FIELD / EVIDENCE" title="Evidenze operative" icon={MapPin} section={workspace.sections.evidence} /><WorkspaceSectionCard eyebrow="OUTPUT" title="Rapportino e controllo" icon={FileText} section={workspace.sections.rapportino} /></div>
    <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] py-5 text-[10px] text-slate-600"><span>AI-ZEROW OPERATIONS · W03 JOB WORKSPACE</span><span className="flex items-center gap-2"><CheckCircle2 className="size-3.5 text-lime-300" />Scritture tipizzate · eventi · readback verificato</span></footer></div>
    <Dialog open={actionOpen !== null} onOpenChange={(open) => !open && setActionOpen(null)}><DialogContent className="border-lime-300/20 bg-[#0a0d0e] text-slate-100 sm:max-w-[560px]"><DialogHeader><DialogTitle className="text-slate-100">{actionOpen === "details" ? "Modifica scheda commessa" : actionOpen === "activity" ? "Aggiungi attività" : actionOpen === "assign" ? "Assegna risorse" : actionOpen === "evidence" ? "Registra evidenza" : actionOpen === "report" ? "Rapportino giornaliero" : "Aggiorna avanzamento"}</DialogTitle><DialogDescription className="text-slate-500">La modifica viene autorizzata dal server, registrata come evento e riletta dal readback D1.</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={submitAction}>{actionOpen === "details" && <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-2 text-xs text-slate-400 sm:col-span-2">Titolo<Input className="mt-2 border-white/10 bg-black/30 text-slate-100" onChange={(event) => setTitle(event.target.value)} value={title} /></label><label className="space-y-2 text-xs text-slate-400 sm:col-span-2">Descrizione<Textarea className="mt-2 min-h-[90px] border-white/10 bg-black/30 text-slate-100" onChange={(event) => setDescription(event.target.value)} value={description} /></label><label className="space-y-2 text-xs text-slate-400">Cliente<Input className="mt-2 border-white/10 bg-black/30 text-slate-100" onChange={(event) => setClient(event.target.value)} value={client} /></label><label className="space-y-2 text-xs text-slate-400">Scadenza<Input className="mt-2 border-white/10 bg-black/30 text-slate-100" onChange={(event) => setDueDate(event.target.value)} value={dueDate} /></label><label className="space-y-2 text-xs text-slate-400 sm:col-span-2">Ubicazione<Input className="mt-2 border-white/10 bg-black/30 text-slate-100" onChange={(event) => setLocation(event.target.value)} value={location} /></label></div>}{actionOpen === "activity" && <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-2 text-xs text-slate-400 sm:col-span-2">Titolo attività<Input className="mt-2 border-white/10 bg-black/30 text-slate-100" onChange={(event) => setActivityTitle(event.target.value)} placeholder="Es. Sopralluogo tecnico" value={activityTitle} /></label><label className="space-y-2 text-xs text-slate-400 sm:col-span-2">Dettaglio<Textarea className="mt-2 min-h-[80px] border-white/10 bg-black/30 text-slate-100" onChange={(event) => setActivityDetail(event.target.value)} placeholder="Cosa deve essere completato?" value={activityDetail} /></label><label className="space-y-2 text-xs text-slate-400">Responsabile<Input className="mt-2 border-white/10 bg-black/30 text-slate-100" onChange={(event) => setActivityOwner(event.target.value)} placeholder="Persona o squadra" value={activityOwner} /></label><label className="space-y-2 text-xs text-slate-400">Scadenza<Input className="mt-2 border-white/10 bg-black/30 text-slate-100" onChange={(event) => setActivityDueDate(event.target.value)} placeholder="YYYY-MM-DD" value={activityDueDate} /></label></div>}{actionOpen === "assign" && <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-2 text-xs text-slate-400">Responsabile<Input className="mt-2 border-white/10 bg-black/30 text-slate-100" onChange={(event) => setResponsible(event.target.value)} placeholder="Nome responsabile" value={responsible} /></label><label className="space-y-2 text-xs text-slate-400">Squadra<Input className="mt-2 border-white/10 bg-black/30 text-slate-100" onChange={(event) => setTeam(event.target.value)} placeholder="Squadra / crew" value={team} /></label><label className="space-y-2 text-xs text-slate-400 sm:col-span-2">Ruolo<Input className="mt-2 border-white/10 bg-black/30 text-slate-100" onChange={(event) => setRole(event.target.value)} value={role} /></label></div>}{actionOpen === "evidence" && <div className="space-y-4"><label className="space-y-2 text-xs text-slate-400">Titolo evidenza<Input className="mt-2 border-white/10 bg-black/30 text-slate-100" onChange={(event) => setEvidenceTitle(event.target.value)} placeholder="Es. Sopralluogo completato" value={evidenceTitle} /></label><label className="space-y-2 text-xs text-slate-400">Nota<Textarea className="mt-2 min-h-[110px] border-white/10 bg-black/30 text-slate-100" onChange={(event) => setEvidenceDetail(event.target.value)} placeholder="Descrivi il fatto osservato" value={evidenceDetail} /></label></div>}{actionOpen === "report" && <label className="space-y-2 text-xs text-slate-400">Rapportino<Textarea className="mt-2 min-h-[160px] border-white/10 bg-black/30 text-slate-100" onChange={(event) => setReportText(event.target.value)} placeholder="Attività svolte, criticità, materiali e prossimi passi" value={reportText} /></label>}{actionOpen === "progress" && <div className="space-y-4"><div className="flex items-end justify-between"><p className="text-xs text-slate-400">Avanzamento verificato</p><span className="font-mono text-2xl text-lime-200">{progress}%</span></div><input aria-label="Avanzamento commessa" className="w-full accent-lime-300" max="100" min="0" onChange={(event) => setProgress(Number(event.target.value))} type="range" value={progress} /></div>}<DialogFooter><DialogClose asChild><Button type="button" variant="outline" className="border-white/10 bg-transparent text-slate-400">Annulla</Button></DialogClose><Button type="submit" className="bg-lime-300 text-[#060806] hover:bg-lime-200"><Send className="size-3.5" />Salva e rileggi</Button></DialogFooter></form></DialogContent></Dialog>
    {toast && <div className="fixed bottom-5 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2 rounded-xl border border-lime-300/25 bg-[#0b1008]/95 px-4 py-3 text-xs text-lime-100 shadow-[0_0_30px_rgba(190,255,60,0.14)] backdrop-blur-xl"><CheckCircle2 className="size-4 text-lime-300" />{toast}</div>}
  </main>;
}
