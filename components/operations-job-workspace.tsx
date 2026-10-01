"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  BriefcaseBusiness,
  CalendarClock,
  Check,
  CheckCircle2,
  ClipboardCheck,
  CircleGauge,
  FileText,
  Flag,
  FolderKanban,
  HardHat,
  Layers3,
  LoaderCircle,
  MapPin,
  Package,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Truck,
  Users,
  Wrench,
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
  if (status === "readback") return "READBACK OK";
  if (status === "deferred") return "GATE SUCCESSIVO";
  return "DA PREPARARE";
}

function sectionTone(status: WorkspaceSection["status"]) {
  if (status === "readback") return "border-lime-300/25 bg-lime-300/10 text-lime-200";
  if (status === "deferred") return "border-amber-300/25 bg-amber-300/10 text-amber-200";
  return "border-white/10 bg-black/20 text-slate-500";
}

function statusTone(status: string) {
  const value = status.toUpperCase();
  if (["ACTIVE", "IN CORSO", "DONE", "COMPLETED", "COMPLETATA", "CLOSED", "CHIUSA", "VERIFIED_SITES_READBACK", "ASSIGNED"].includes(value)) return "border-lime-300/25 bg-lime-300/10 text-lime-200";
  if (["BLOCKED", "BLOCCATA"].includes(value)) return "border-rose-300/25 bg-rose-300/10 text-rose-200";
  if (["DRAFT", "BOZZA", "QUEUED", "PROPOSTA", "DA PREPARARE"].includes(value)) return "border-amber-300/25 bg-amber-300/10 text-amber-200";
  return "border-cyan-300/25 bg-cyan-300/10 text-cyan-200";
}

function valueOr(value: unknown, fallback = "—") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function InfoRow({ label, value, icon: Icon }: { label: string; value: string; icon: typeof MapPin }) {
  return (
    <div className="flex items-start gap-3 border-b border-white/[0.07] py-3 last:border-0 last:pb-0">
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border border-white/10 bg-black/25 text-slate-500"><Icon className="size-3.5" /></span>
      <div className="min-w-0 flex-1"><p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-slate-600">{label}</p><p className="mt-1 break-words text-xs text-slate-200">{value}</p></div>
    </div>
  );
}

function CompletionGate({ completion }: { completion: WorkspacePayload["workspace"]["completion"] }) {
  const missing = completion.requirements.filter((requirement) => !requirement.complete).length;
  return (
    <section className="relative overflow-hidden rounded-[24px] border border-amber-300/15 bg-[linear-gradient(145deg,rgba(38,31,18,0.7),rgba(11,14,13,0.94)_62%,rgba(22,29,20,0.78))] p-5 shadow-[0_20px_55px_rgba(0,0,0,0.18)] sm:p-6">
      <div className="pointer-events-none absolute -right-20 -top-24 size-56 rounded-full bg-amber-300/[0.055] blur-3xl" />
      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-2xl border border-amber-300/25 bg-amber-300/[0.08] text-amber-200"><ShieldCheck className="size-4" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-200/75">Completion gate</p><h2 className="mt-1 text-[15px] font-semibold text-slate-100">Chiusura sotto controllo</h2><p className="mt-1 max-w-2xl text-[11px] leading-5 text-slate-500">Il 100% è avanzamento operativo. La chiusura resta autorizzata solo quando scheda, attività, assegnazione, evidenze e rapportino sono verificati.</p></div></div>
        <span className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${completion.ready ? "border-lime-300/25 bg-lime-300/10 text-lime-200" : "border-amber-300/25 bg-amber-300/10 text-amber-200"}`}>{completion.ready ? "Pronta alla verifica" : `${missing} controlli aperti`}</span>
      </div>
      <div className="relative mt-5 grid gap-2 sm:grid-cols-2">{completion.requirements.map((requirement) => <div className={`rounded-2xl border px-3.5 py-3 ${requirement.complete ? "border-lime-300/15 bg-lime-300/[0.035]" : "border-amber-300/15 bg-amber-300/[0.035]"}`} key={requirement.key}><div className="flex items-center gap-2.5"><span className={`grid size-5 place-items-center rounded-full border ${requirement.complete ? "border-lime-300/35 bg-lime-300/10 text-lime-200" : "border-amber-300/30 text-amber-200"}`}>{requirement.complete ? <Check className="size-3" /> : <span className="size-1.5 rounded-full bg-current" />}</span><span className="text-[11px] font-medium text-slate-200">{requirement.label}</span></div><p className="mt-1.5 pl-7 text-[10px] leading-4 text-slate-500">{requirement.detail}</p></div>)}</div>
    </section>
  );
}

function JourneyRail({ journey }: { journey: WorkspacePayload["workspace"]["journey"] }) {
  return (
    <section className="carbon-card rounded-[24px] p-5 sm:p-6">
      <div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-200"><Layers3 className="size-4" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-200/70">Lifecycle map</p><h2 className="mt-1 text-[15px] font-semibold text-slate-100">Dalla commessa al controllo</h2></div></div>
      <div className="mt-5">{journey.map((step, index) => { const complete = step.status === "readback"; const deferred = step.status === "deferred"; return <div className="relative flex gap-3 pb-4 last:pb-0" key={step.key}>{index < journey.length - 1 && <span className="absolute left-[9px] top-5 h-[calc(100%-9px)] w-px bg-white/[0.09]" />}<span className={`relative z-10 grid size-[19px] shrink-0 place-items-center rounded-full border ${complete ? "border-lime-300/45 bg-lime-300 text-[#071006]" : deferred ? "border-amber-300/30 bg-amber-300/[0.08] text-amber-200" : "border-white/15 bg-black/30 text-slate-600"}`}>{complete ? <Check className="size-2.5" /> : <span className="size-1.5 rounded-full bg-current" />}</span><div className="flex min-w-0 flex-1 items-center justify-between gap-3"><span className={`text-[11px] ${complete ? "text-slate-200" : deferred ? "text-amber-100/70" : "text-slate-500"}`}>{step.label}</span><span className={`rounded-full border px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.12em] ${complete ? "border-lime-300/20 bg-lime-300/[0.06] text-lime-200" : deferred ? "border-amber-300/20 bg-amber-300/[0.05] text-amber-200" : "border-white/10 text-slate-600"}`}>{complete ? "readback" : deferred ? "deferred" : "da preparare"}</span></div></div>; })}</div>
    </section>
  );
}

function WorkspaceSectionCard({ title, eyebrow, icon: Icon, section, onCompleteActivity }: { title: string; eyebrow: string; icon: typeof BriefcaseBusiness; section: WorkspaceSection; onCompleteActivity?: (activityId: string) => void }) {
  return (
    <section className="carbon-card group rounded-[22px] p-4 transition hover:border-lime-300/20 sm:p-5">
      <div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/10 text-lime-200"><Icon className="size-4" /></span><div className="min-w-0"><p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-lime-300/65">{eyebrow}</p><h2 className="mt-1 truncate text-[14px] font-semibold text-slate-100">{title}</h2></div></div><span className={`shrink-0 rounded-full border px-2 py-1 text-[8px] font-semibold uppercase tracking-[0.1em] ${sectionTone(section.status)}`}>{section.count ? `${section.count} · ${sectionLabel(section.status)}` : sectionLabel(section.status)}</span></div>
      <div className="mt-4 space-y-2">{section.records.map((record) => { const activityId = typeof record.payload?.id === "string" ? record.payload.id : null; return <div className="carbon-inset flex items-center gap-3 rounded-xl p-3" key={record.id}><span className={`grid size-7 shrink-0 place-items-center rounded-lg border ${statusTone(record.status)}`}><CheckCircle2 className="size-3.5" /></span><div className="min-w-0 flex-1"><p className="truncate text-[11px] font-medium text-slate-200">{record.title}</p><p className="mt-1 truncate text-[10px] text-slate-500">{record.detail || "Record operativo"}{record.meta ? ` · ${record.meta}` : ""}</p></div><span className={`hidden rounded-full border px-2 py-1 text-[8px] font-semibold uppercase tracking-[0.08em] sm:inline-flex ${statusTone(record.status)}`}>{record.status}</span>{onCompleteActivity && activityId && record.status !== "DONE" && <button aria-label={`Completa ${record.title}`} className="grid size-7 shrink-0 place-items-center rounded-lg border border-lime-300/20 text-lime-200 transition hover:bg-lime-300/10" onClick={() => onCompleteActivity(activityId)} type="button"><Check className="size-3.5" /></button>}</div>; })}{section.records.length === 0 && <div className="rounded-xl border border-dashed border-white/[0.1] bg-black/15 px-3 py-5 text-center"><p className="text-[11px] text-slate-500">{section.status === "deferred" ? "Disponibile nel gate successivo." : "Nessun record collegato alla commessa."}</p><p className="mt-1 text-[10px] text-slate-700">Readback tenant-scoped</p></div>}</div>
    </section>
  );
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

  const notify = useCallback((message: string) => { setToast(message); window.setTimeout(() => setToast(""), 3200); }, []);

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

  useEffect(() => { const timer = window.setTimeout(() => void refresh(), 0); return () => window.clearTimeout(timer); }, [refresh]);

  const mutate = useCallback(async (action: string, body: Record<string, unknown>) => {
    if (!payload) return;
    try {
      const response = await fetch(`/api/operations/jobs/${encodeURIComponent(jobId)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, expectedVersion: payload.readback?.version ?? 1, idempotencyKey: `w03-${jobId}-${action}-${crypto.randomUUID()}`, ...body }) });
      const nextPayload = await response.json() as WorkspacePayload & { error?: string; requirements?: CompletionRequirement[] };
      if (!response.ok) {
        if (nextPayload.error === "completion_requirements_unmet" && nextPayload.requirements) {
          const missing = nextPayload.requirements.filter((requirement) => !requirement.complete).map((requirement) => requirement.label).join(", ");
          notify(`Completamento bloccato: ${missing || "requisiti mancanti"}`);
        } else notify(nextPayload.error === "version_conflict" ? "La commessa è cambiata: ricarico il readback." : `Operazione non eseguita: ${nextPayload.error ?? "errore"}`);
        if (response.status === 409) await refresh();
        return;
      }
      setPayload(nextPayload);
      setProgress(nextPayload.job.progress);
      setActionOpen(null);
      notify(`Readback verificato · ${action.replaceAll("_", " ")}`);
    } catch { notify("Connessione non disponibile: nessuna modifica è stata confermata."); }
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

  if (state === "loading") return <main className="grid min-h-screen place-items-center bg-[#050607] text-slate-100"><div className="flex items-center gap-3 text-xs text-slate-500"><LoaderCircle className="size-4 animate-spin text-lime-300" />Caricamento dossier commessa…</div></main>;
  if (state !== "ready" || !payload) {
    const message = state === "unauthenticated" ? "Accedi per leggere il dossier della commessa." : state === "forbidden" ? "Il ruolo corrente non dispone di operations.read." : state === "missing" ? "La commessa non è presente nel readback tenant-scoped." : "Il dossier non è momentaneamente disponibile.";
    return <main className="grid min-h-screen place-items-center bg-[#050607] px-5 text-slate-100"><section className="carbon-card w-full max-w-lg rounded-2xl p-6 text-center"><ShieldCheck className="mx-auto size-8 text-amber-200" /><h1 className="mt-4 text-lg font-semibold">Dossier non disponibile</h1><p className="mt-2 text-xs leading-5 text-slate-500">{message}</p><div className="mt-5 flex justify-center gap-2"><Button variant="outline" className="border-white/10 bg-black/20 text-xs text-slate-300" onClick={() => router.push("/operations")}><ArrowLeft className="size-3.5" />Torna alle commesse</Button>{state === "unauthenticated" && <Button className="bg-lime-300 text-xs font-semibold text-[#060806]" onClick={() => router.push(`/login?next=${encodeURIComponent(`/operations/${jobId}`)}`)}>Accedi</Button>}</div></section></main>;
  }

  const { job, workspace } = payload;
  const version = payload.readback?.version ?? 1;
  const jobData = job.payload ?? {};
  const payloadText = (key: string, fallback = "") => typeof jobData[key] === "string" ? jobData[key] as string : fallback;
  const clientName = valueOr(jobData.client ?? jobData.clientName, "Cliente da definire");
  const jobDescription = valueOr(jobData.description, "Descrizione operativa da completare.");
  const openingType = payloadText("openingType") === "PRONTO_INTERVENTO" ? "Pronto intervento" : "Nuova commessa";
  const sourceMode = payloadText("sourceMode") === "COMPANY_AI" ? "Company AI" : "Inserimento manuale";
  const priority = payloadText("priority", "STANDARD");
  const rawScope = jobData.scope;
  const jobScope = rawScope && typeof rawScope === "object" && !Array.isArray(rawScope) ? rawScope as Record<string, unknown> : null;
  const scopeLabel = jobScope && typeof jobScope.sectionTitle === "string" && typeof jobScope.groupTitle === "string" && typeof jobScope.subgroupTitle === "string" ? `${jobScope.sectionTitle} / ${jobScope.groupTitle} / ${jobScope.subgroupTitle}` : "Scope da definire fino al sottogruppo";
  const contactLabel = payloadText("clientContact") || payloadText("clientEmail") || payloadText("clientPhone") || "Referente da indicare";
  const sourcePreviewId = payloadText("aiPreviewId");

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#050607] text-slate-100 selection:bg-lime-300 selection:text-[#060806]">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_74%_0%,rgba(190,255,60,0.09),transparent_25%),radial-gradient(circle_at_18%_78%,rgba(70,110,120,0.08),transparent_27%)]" />
      <div className="relative mx-auto max-w-[1560px] px-4 py-5 sm:px-7 sm:py-7">
        <header className="flex flex-wrap items-center justify-between gap-4"><div className="flex min-w-0 items-center gap-3"><Button variant="outline" className="h-9 shrink-0 border-white/10 bg-black/20 px-3 text-xs text-slate-300 hover:border-lime-300/30 hover:text-lime-100" onClick={() => router.push("/operations")}><ArrowLeft className="size-3.5" />Commesse</Button><div className="min-w-0"><p className="truncate text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/70">AI-ZEROW / OPERATIONS / DOSSIER COMMESSA</p><p className="mt-1 truncate font-mono text-[11px] text-slate-600">{job.id} · workspace operativo</p></div></div><div className="flex items-center gap-2"><span className="hidden items-center gap-2 rounded-full border border-lime-300/20 bg-lime-300/[0.06] px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-lime-200 sm:inline-flex"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_9px_rgba(190,255,60,0.9)]" />D1 readback · v{version}</span><button aria-label="Rileggi dossier commessa" className="grid size-9 place-items-center rounded-xl border border-white/10 bg-black/20 text-slate-500 transition hover:border-lime-300/30 hover:text-lime-200" onClick={() => void refresh()} type="button"><RefreshCw className="size-4" /></button></div></header>

        <section className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <article className="relative overflow-hidden rounded-[28px] border border-lime-300/20 bg-[linear-gradient(140deg,rgba(24,38,29,0.96),rgba(7,12,13,0.98)_55%,rgba(13,24,22,0.95))] p-5 shadow-[0_30px_85px_rgba(0,0,0,0.32)] sm:p-7"><div className="pointer-events-none absolute -right-40 -top-44 size-[34rem] rounded-full bg-lime-300/[0.055] blur-3xl" /><div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-lime-300/75 to-transparent" /><div className="relative flex flex-wrap items-start justify-between gap-5"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full border border-lime-300/25 bg-lime-300/[0.08] px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-lime-200">{openingType}</span><span className="rounded-full border border-cyan-300/20 bg-cyan-300/[0.06] px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-cyan-100/80">{sourceMode}</span>{priority !== "STANDARD" && <span className="rounded-full border border-amber-300/20 bg-amber-300/[0.07] px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-amber-200">Priorità {priority === "HIGH" ? "alta" : "bassa"}</span>}</div><h1 className="mt-4 max-w-4xl break-words text-3xl font-semibold tracking-[-0.055em] text-lime-100 sm:text-[42px]">{job.title}</h1><p className="mt-3 flex items-center gap-2 text-xs text-slate-400"><MapPin className="size-3.5 shrink-0 text-cyan-200" />{valueOr(jobData.location ?? job.detail, "Luogo da definire")}</p><p className="mt-4 max-w-3xl text-sm leading-6 text-slate-300/85">{jobDescription}</p></div><div className="shrink-0 text-left sm:text-right"><p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-600">Stato attuale</p><span className={`mt-2 inline-flex rounded-full border px-3 py-1.5 text-xs font-semibold ${statusTone(job.status)}`}>{job.status}</span><p className="mt-2 font-mono text-[10px] text-slate-600">{job.id}</p></div></div><div className="relative mt-7 grid gap-2 sm:grid-cols-3"><div className="rounded-2xl border border-white/[0.08] bg-black/20 p-3.5"><p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-slate-600">Cliente</p><p className="mt-2 truncate text-xs font-medium text-slate-200">{clientName}</p><p className="mt-1 truncate text-[10px] text-slate-500">{contactLabel}</p></div><div className="rounded-2xl border border-white/[0.08] bg-black/20 p-3.5"><p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-slate-600">Scadenza operativa</p><p className="mt-2 truncate text-xs font-medium text-slate-200">{valueOr(jobData.dueDate ?? job.meta, "Da pianificare")}</p><p className="mt-1 text-[10px] text-slate-500">Riferimento di commessa</p></div><div className="rounded-2xl border border-lime-300/15 bg-lime-300/[0.045] p-3.5"><p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-lime-300/65">Scope operativo</p><p className="mt-2 line-clamp-2 text-xs font-medium text-lime-100/90">{scopeLabel}</p><p className="mt-1 text-[10px] text-slate-500">Livello: sottogruppo</p></div></div><div className="relative mt-6 border-t border-white/[0.08] pt-5"><div className="flex items-center justify-between gap-3 text-[10px] text-slate-500"><span className="font-semibold uppercase tracking-[0.15em]">Avanzamento verificato</span><span className="font-mono text-lg text-lime-200">{job.progress}%</span></div><div className="mt-3 h-2.5 overflow-hidden rounded-full bg-black/60"><div className="h-full rounded-full bg-gradient-to-r from-lime-300 via-lime-200 to-cyan-300 shadow-[0_0_20px_rgba(190,255,60,0.58)] transition-all" style={{ width: `${job.progress}%` }} /></div></div><div className="relative mt-6 flex flex-wrap gap-2"><Button variant="outline" className="h-10 border-white/10 bg-black/25 text-xs text-slate-300 hover:border-lime-300/35 hover:bg-lime-300/[0.07]" onClick={openDetails}><BriefcaseBusiness className="size-3.5" />Modifica scheda</Button>{nextStatusAction && <Button className="h-10 bg-lime-300 px-4 text-xs font-semibold text-[#060806] shadow-[0_0_22px_rgba(190,255,60,0.18)] hover:bg-lime-200" onClick={() => void mutate("set_status", { statusCode: nextStatusAction.statusCode })}><Send className="size-3.5" />{nextStatusAction.label}</Button>}<Button variant="outline" className="h-10 border-cyan-300/25 bg-cyan-300/[0.05] text-xs text-cyan-100 hover:bg-cyan-300/[0.1]" onClick={() => setActionOpen("progress")}><CircleGauge className="size-3.5" />Aggiorna avanzamento</Button></div></article>
          <aside className="carbon-card rounded-[28px] p-5 sm:p-6"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/70">Command snapshot</p><h2 className="mt-1 text-[17px] font-semibold text-slate-100">Stato del dossier</h2></div><span className="grid size-10 place-items-center rounded-2xl border border-lime-300/25 bg-lime-300/10 text-lime-200"><BadgeCheck className="size-5" /></span></div><div className="mt-6 flex items-center gap-4"><div className="relative grid size-24 shrink-0 place-items-center rounded-full border-[7px] border-lime-300/15 bg-black/25"><div className="absolute inset-[-7px] rounded-full border-[7px] border-transparent border-lime-300 border-r-transparent rotate-[-45deg]" /><span className="font-mono text-xl font-semibold text-lime-100">{job.progress}%</span></div><div><p className="text-xs font-medium text-slate-200">{workspace.completion.ready ? "Pronta per la verifica" : "Costruzione in corso"}</p><p className="mt-1 text-[11px] leading-5 text-slate-500">La superficie riunisce dati, lifecycle e operazioni collegate.</p></div></div><div className="mt-6 space-y-3"><div className="flex items-center justify-between border-b border-white/[0.07] pb-3 text-[11px]"><span className="text-slate-500">Origine dati</span><span className="text-cyan-100">{sourceMode}</span></div><div className="flex items-center justify-between border-b border-white/[0.07] pb-3 text-[11px]"><span className="text-slate-500">Controlli chiusura</span><span className={workspace.completion.ready ? "text-lime-200" : "text-amber-200"}>{workspace.completion.ready ? "READY" : "IN REVIEW"}</span></div><div className="flex items-center justify-between text-[11px]"><span className="text-slate-500">Versione readback</span><span className="font-mono text-lime-200">v{version}</span></div></div>{sourcePreviewId && <div className="mt-5 rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.045] p-3"><div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-cyan-100/75"><Sparkles className="size-3.5" />Preview Company AI collegata</div><p className="mt-2 truncate font-mono text-[9px] text-slate-500">{sourcePreviewId}</p></div>}</aside>
        </section>

        <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]"><div className="min-w-0 space-y-4"><CompletionGate completion={workspace.completion} /><section className="carbon-card rounded-[24px] p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-2xl border border-lime-300/20 bg-lime-300/10 text-lime-200"><Wrench className="size-4" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/65">Operations desk</p><h2 className="mt-1 text-[15px] font-semibold">Azioni sulla commessa</h2></div></div><span className="rounded-full border border-lime-300/20 bg-lime-300/[0.05] px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-lime-200">server write · readback</span></div><div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-5"><Button variant="outline" className="h-11 border-white/10 bg-black/20 text-xs text-slate-300 hover:border-lime-300/30" onClick={() => setActionOpen("activity")}><Plus className="size-3.5" />Attività</Button><Button variant="outline" className="h-11 border-white/10 bg-black/20 text-xs text-slate-300 hover:border-lime-300/30" onClick={() => setActionOpen("assign")}><Users className="size-3.5" />Assegna</Button><Button variant="outline" className="h-11 border-white/10 bg-black/20 text-xs text-slate-300 hover:border-lime-300/30" onClick={() => setActionOpen("evidence")}><MapPin className="size-3.5" />Evidenza</Button><Button variant="outline" className="h-11 border-white/10 bg-black/20 text-xs text-slate-300 hover:border-lime-300/30" onClick={() => setActionOpen("report")}><FileText className="size-3.5" />Rapportino</Button><Button variant="outline" className="h-11 border-white/10 bg-black/20 text-xs text-slate-300 hover:border-lime-300/30" onClick={() => void refresh()}><RefreshCw className="size-3.5" />Rileggi</Button></div></section><div className="grid gap-4 lg:grid-cols-2"><WorkspaceSectionCard eyebrow="ACTIVITY" title="Attività collegate" icon={ClipboardCheck} section={workspace.sections.activities} onCompleteActivity={(activityId) => void mutate("complete_activity", { activityId })} /><WorkspaceSectionCard eyebrow="PLANNING" title="Pianificazione e assegnazioni" icon={Users} section={workspace.sections.planning} /><WorkspaceSectionCard eyebrow="RESOURCES" title="Risorse e mezzi" icon={Truck} section={workspace.sections.resources} /><WorkspaceSectionCard eyebrow="MATERIALS" title="Materiali e magazzino" icon={Package} section={workspace.sections.materials} /><WorkspaceSectionCard eyebrow="FIELD / EVIDENCE" title="Evidenze operative" icon={MapPin} section={workspace.sections.evidence} /><WorkspaceSectionCard eyebrow="OUTPUT" title="Rapportino e controllo" icon={FileText} section={workspace.sections.rapportino} /></div></div><aside className="min-w-0 space-y-4"><section className="carbon-card rounded-[24px] p-5 sm:p-6"><div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-2xl border border-lime-300/20 bg-lime-300/10 text-lime-200"><FolderKanban className="size-4" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/70">Dossier operativo</p><h2 className="mt-1 text-[15px] font-semibold">Dati di riferimento</h2></div></div><div className="mt-4"><InfoRow icon={BriefcaseBusiness} label="Cliente / ragione sociale" value={clientName} /><InfoRow icon={Users} label="Referente" value={contactLabel} /><InfoRow icon={MapPin} label="Cantiere / luogo" value={valueOr(jobData.worksite ?? jobData.location ?? job.detail, "Luogo da definire")} /><InfoRow icon={CalendarClock} label="Scadenza" value={valueOr(jobData.dueDate ?? job.meta, "Da pianificare")} /><InfoRow icon={Flag} label="Riferimento preventivo" value={valueOr(jobData.clientReference, "Non indicato")} /></div></section><JourneyRail journey={workspace.journey} /><section className="relative overflow-hidden rounded-[24px] border border-cyan-300/15 bg-[linear-gradient(145deg,rgba(10,28,31,0.82),rgba(7,13,14,0.95))] p-5 sm:p-6"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-200"><HardHat className="size-4" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200/70">Guardrail operativo</p><h2 className="mt-1 text-[14px] font-semibold">Write + readback verificato</h2></div></div><p className="mt-4 text-[11px] leading-5 text-slate-500">Ogni azione passa dal server, dal ledger e dalla rilettura della versione della commessa. Le aree differite restano dichiarate nel lifecycle.</p><div className="mt-4 flex flex-wrap gap-2"><span className="rounded-full border border-lime-300/20 bg-lime-300/[0.06] px-2.5 py-1 text-[9px] text-lime-200">TENANT SCOPED</span><span className="rounded-full border border-cyan-300/20 bg-cyan-300/[0.06] px-2.5 py-1 text-[9px] text-cyan-100">AUDITABLE</span></div></section></aside></section>

        <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] py-5 text-[10px] text-slate-600"><span>AI-ZEROW OPERATIONS · COMMESSA WORKSPACE</span><span className="flex items-center gap-2"><CheckCircle2 className="size-3.5 text-lime-300" />Scheda tipizzata · eventi · readback verificato</span></footer>
      </div>

      <Dialog open={actionOpen !== null} onOpenChange={(open) => !open && setActionOpen(null)}><DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto border-lime-300/20 bg-[#0a0d0e] text-slate-100 sm:max-w-[560px]"><DialogHeader><DialogTitle className="text-slate-100">{actionOpen === "details" ? "Modifica scheda commessa" : actionOpen === "activity" ? "Aggiungi attività" : actionOpen === "assign" ? "Assegna risorse" : actionOpen === "evidence" ? "Registra evidenza" : actionOpen === "report" ? "Rapportino giornaliero" : "Aggiorna avanzamento"}</DialogTitle><DialogDescription className="text-slate-500">La modifica viene autorizzata dal server, registrata come evento e riletta dal readback D1.</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={submitAction}>{actionOpen === "details" && <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-2 text-xs text-slate-400 sm:col-span-2">Titolo<Input className="mt-2 border-white/10 bg-black/30 text-slate-100" onChange={(event) => setTitle(event.target.value)} value={title} /></label><label className="space-y-2 text-xs text-slate-400 sm:col-span-2">Descrizione<Textarea className="mt-2 min-h-[90px] border-white/10 bg-black/30 text-slate-100" onChange={(event) => setDescription(event.target.value)} value={description} /></label><label className="space-y-2 text-xs text-slate-400">Cliente<Input className="mt-2 border-white/10 bg-black/30 text-slate-100" onChange={(event) => setClient(event.target.value)} value={client} /></label><label className="space-y-2 text-xs text-slate-400">Scadenza<Input className="mt-2 border-white/10 bg-black/30 text-slate-100" onChange={(event) => setDueDate(event.target.value)} value={dueDate} /></label><label className="space-y-2 text-xs text-slate-400 sm:col-span-2">Ubicazione<Input className="mt-2 border-white/10 bg-black/30 text-slate-100" onChange={(event) => setLocation(event.target.value)} value={location} /></label></div>}{actionOpen === "activity" && <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-2 text-xs text-slate-400 sm:col-span-2">Titolo attività<Input className="mt-2 border-white/10 bg-black/30 text-slate-100" onChange={(event) => setActivityTitle(event.target.value)} placeholder="Es. Sopralluogo tecnico" value={activityTitle} /></label><label className="space-y-2 text-xs text-slate-400 sm:col-span-2">Dettaglio<Textarea className="mt-2 min-h-[80px] border-white/10 bg-black/30 text-slate-100" onChange={(event) => setActivityDetail(event.target.value)} placeholder="Cosa deve essere completato?" value={activityDetail} /></label><label className="space-y-2 text-xs text-slate-400">Responsabile<Input className="mt-2 border-white/10 bg-black/30 text-slate-100" onChange={(event) => setActivityOwner(event.target.value)} placeholder="Persona o squadra" value={activityOwner} /></label><label className="space-y-2 text-xs text-slate-400">Scadenza<Input className="mt-2 border-white/10 bg-black/30 text-slate-100" onChange={(event) => setActivityDueDate(event.target.value)} placeholder="YYYY-MM-DD" value={activityDueDate} /></label></div>}{actionOpen === "assign" && <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-2 text-xs text-slate-400">Responsabile<Input className="mt-2 border-white/10 bg-black/30 text-slate-100" onChange={(event) => setResponsible(event.target.value)} placeholder="Nome responsabile" value={responsible} /></label><label className="space-y-2 text-xs text-slate-400">Squadra<Input className="mt-2 border-white/10 bg-black/30 text-slate-100" onChange={(event) => setTeam(event.target.value)} placeholder="Squadra / crew" value={team} /></label><label className="space-y-2 text-xs text-slate-400 sm:col-span-2">Ruolo<Input className="mt-2 border-white/10 bg-black/30 text-slate-100" onChange={(event) => setRole(event.target.value)} value={role} /></label></div>}{actionOpen === "evidence" && <div className="space-y-4"><label className="space-y-2 text-xs text-slate-400">Titolo evidenza<Input className="mt-2 border-white/10 bg-black/30 text-slate-100" onChange={(event) => setEvidenceTitle(event.target.value)} placeholder="Es. Sopralluogo completato" value={evidenceTitle} /></label><label className="space-y-2 text-xs text-slate-400">Nota<Textarea className="mt-2 min-h-[110px] border-white/10 bg-black/30 text-slate-100" onChange={(event) => setEvidenceDetail(event.target.value)} placeholder="Descrivi il fatto osservato" value={evidenceDetail} /></label></div>}{actionOpen === "report" && <label className="space-y-2 text-xs text-slate-400">Rapportino<Textarea className="mt-2 min-h-[160px] border-white/10 bg-black/30 text-slate-100" onChange={(event) => setReportText(event.target.value)} placeholder="Attività svolte, criticità, materiali e prossimi passi" value={reportText} /></label>}{actionOpen === "progress" && <div className="space-y-4"><div className="flex items-end justify-between"><p className="text-xs text-slate-400">Avanzamento verificato</p><span className="font-mono text-2xl text-lime-200">{progress}%</span></div><input aria-label="Avanzamento commessa" className="w-full accent-lime-300" max="100" min="0" onChange={(event) => setProgress(Number(event.target.value))} type="range" value={progress} /></div>}<DialogFooter><DialogClose asChild><Button type="button" variant="outline" className="border-white/10 bg-transparent text-slate-400">Annulla</Button></DialogClose><Button type="submit" className="bg-lime-300 text-[#060806] hover:bg-lime-200"><Send className="size-3.5" />Salva e rileggi</Button></DialogFooter></form></DialogContent></Dialog>
      {toast && <button className="fixed bottom-5 right-5 z-50 max-w-[360px] rounded-xl border border-lime-300/25 bg-[#0a100c]/95 px-4 py-3 text-left text-xs text-lime-100 shadow-[0_0_28px_rgba(190,255,60,0.14)] backdrop-blur-xl" onClick={() => setToast("")} type="button"><CheckCircle2 className="mr-2 inline size-4 text-lime-300" />{toast}</button>}
    </main>
  );
}
