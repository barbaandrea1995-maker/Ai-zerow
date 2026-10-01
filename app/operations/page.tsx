"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Bell,
  BriefcaseBusiness,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleGauge,
  ClipboardCheck,
  Clock3,
  FileText,
  Gauge,
  HardHat,
  Layers3,
  Map as MapIcon,
  Menu,
  MessageSquareText,
  Package,
  Plus,
  QrCode,
  Search,
  Settings2,
  ShieldCheck,
  Truck,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRouter } from "next/navigation";
import { jobStatusLabel, normalizeJobStatus } from "@/lib/operations-contract";
import OperationsCommessaIntake, { type IntakeAdapterRecord, type IntakeCreateResponse } from "@/components/operations-commessa-intake";

type JobStatus = "BOZZA" | "PROPOSTA" | "APPROVATA" | "In corso" | "Pianificata" | "BLOCCATA" | "Completata" | "CHIUSA" | "ANNULLATA";
type JobFilter = "TUTTE" | "IN CORSO" | "PIANIFICATE" | "COMPLETATE" | "BOZZE" | "BLOCCATE";
type Tone = "lime" | "cyan" | "amber" | "red";

type JobActivity = {
  label: string;
  detail: string;
  state: "done" | "active" | "queued";
  owner: string;
};

type OperationsJob = {
  id: string;
  sourceId?: string;
  title: string;
  description: string;
  client: string;
  location: string;
  status: JobStatus;
  statusCode: string;
  priority: "HIGH" | "STANDARD" | "LOW";
  progress: number;
  team: string;
  due: string;
  category: string;
  version: number;
  activities: JobActivity[];
};

type OperationsAdapterRecord = IntakeAdapterRecord;
type OperationsAdapterResponse = IntakeCreateResponse;

const navItems = [
  { label: "CONTROL", id: "command", icon: MessageSquareText },
  { label: "OPERATIONS", id: "operations", icon: BriefcaseBusiness },
  { label: "FIELD", id: "field", icon: MapIcon },
  { label: "WORKFORCE", id: "workforce", icon: Users },
  { label: "FINANCE", id: "finance", icon: Gauge },
  { label: "ASSETS", id: "assets", icon: Package },
  { label: "WAREHOUSE", id: "warehouse", icon: Layers3 },
  { label: "MISSION", id: "mission", icon: Truck },
  { label: "DOCUMENTS", id: "documents", icon: FileText },
  { label: "QR / BARCODE", id: "qr", icon: QrCode },
  { label: "EVENTS / AUTHORITY", id: "events_authority", icon: ShieldCheck },
  { label: "PWA / DIAGNOSTICS", id: "pwa", icon: CircleGauge },
];

const jobs: OperationsJob[] = [];

const emptyJob: OperationsJob = {
  id: "EMPTY",
  title: "Nessuna commessa",
  description: "Il readback D1 non contiene commesse.",
  client: "—",
  location: "Il readback D1 non contiene commesse.",
  status: "BOZZA",
  statusCode: "DRAFT",
  priority: "LOW",
  progress: 0,
  team: "—",
  due: "—",
  category: "Nessun dato",
  version: 0,
  activities: [],
};

const toneStyles: Record<Tone, { icon: string; badge: string; line: string }> = {
  lime: { icon: "text-lime-200", badge: "border-lime-300/25 bg-lime-300/10 text-lime-200", line: "bg-lime-300" },
  cyan: { icon: "text-cyan-200", badge: "border-cyan-300/25 bg-cyan-300/10 text-cyan-200", line: "bg-cyan-300" },
  amber: { icon: "text-amber-200", badge: "border-amber-300/25 bg-amber-300/10 text-amber-200", line: "bg-amber-300" },
  red: { icon: "text-rose-200", badge: "border-rose-300/25 bg-rose-300/10 text-rose-200", line: "bg-rose-300" },
};

function IconButton({ label, children, onClick, className = "" }: { label: string; children: ReactNode; onClick?: () => void; className?: string }) {
  return <button aria-label={label} className={`grid size-10 place-items-center rounded-xl border border-white/[0.11] bg-[linear-gradient(145deg,rgba(255,255,255,0.045),rgba(0,0,0,0.25))] text-slate-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition hover:-translate-y-px hover:border-lime-300/45 hover:bg-lime-300/[0.09] hover:text-lime-100 hover:shadow-[0_0_24px_rgba(190,255,60,0.09)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300 ${className}`} onClick={onClick} type="button">{children}</button>;
}

function StatusBadge({ children, tone = "lime" }: { children: ReactNode; tone?: Tone }) {
  const styles = toneStyles[tone];
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 font-mono text-[10px] font-semibold tracking-[0.08em] ${styles.badge}`}><span className="size-1.5 rounded-full bg-current shadow-[0_0_9px_currentColor]" />{children}</span>;
}

function SectionTitle({ eyebrow, title, action, onAction }: { eyebrow?: string; title: string; action?: string; onAction?: () => void }) {
  return <div className="flex items-start justify-between gap-3"><div>{eyebrow && <p className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/80">{eyebrow}</p>}<h2 className="text-[16px] font-semibold tracking-[-0.02em] text-lime-100">{title}</h2></div>{action && <button className="rounded-lg border border-lime-300/20 bg-lime-300/[0.045] px-3 py-2 text-[11px] font-semibold text-lime-200 transition hover:border-lime-200/45 hover:bg-lime-300/10 hover:text-lime-100" onClick={onAction} type="button">{action}</button>}</div>;
}

function MetricCard({ label, value, detail, icon: Icon, tone }: { label: string; value: string; detail: string; icon: typeof BriefcaseBusiness; tone: Tone }) {
  const style = toneStyles[tone];
  return <article className="carbon-card rounded-2xl p-5"><div className="flex items-start justify-between gap-3"><span className={`grid size-10 place-items-center rounded-xl border border-current/20 bg-current/10 ${style.icon}`}><Icon className="size-[18px]" /></span><StatusBadge tone={tone}>{detail}</StatusBadge></div><p className="mt-5 text-sm font-medium text-slate-400">{label}</p><p className="mt-1 font-mono text-[32px] font-semibold leading-none tracking-[-0.08em] text-lime-100">{value}</p><p className="mt-4 text-[11px] text-slate-600">Nessun dato nel readback</p></article>;
}

function JobStatus({ status }: { status: JobStatus }) {
  const tone: Tone = status === "In corso" ? "lime" : status === "BLOCCATA" || status === "ANNULLATA" ? "red" : status === "Completata" || status === "CHIUSA" ? "amber" : "cyan";
  return <StatusBadge tone={tone}>{status.toUpperCase()}</StatusBadge>;
}

function ActivityState({ state }: { state: JobActivity["state"] }) {
  if (state === "done") return <span className="grid size-7 place-items-center rounded-full border border-lime-300/30 bg-lime-300/10 text-lime-200"><Check className="size-3.5" /></span>;
  if (state === "active") return <span className="grid size-7 place-items-center rounded-full border border-cyan-300/30 bg-cyan-300/10 text-cyan-200"><Activity className="size-3.5" /></span>;
  return <span className="grid size-7 place-items-center rounded-full border border-white/10 bg-black/25 text-slate-600"><span className="size-1.5 rounded-full bg-current" /></span>;
}

function jobsFromAdapter(records: OperationsAdapterRecord[]): OperationsJob[] {
  return records.map((record) => {
    const payload = record.payload ?? {};
    const [location, team] = record.detail.split(" · ");
    const statusCode = normalizeJobStatus(payload.statusCode ?? record.status);
    const statusLabel = jobStatusLabel(statusCode);
    const status: JobStatus = statusLabel === "IN CORSO" ? "In corso" : statusLabel === "PIANIFICATA" ? "Pianificata" : statusLabel === "COMPLETATA" ? "Completata" : statusLabel as JobStatus;
    const canonicalCode = record.canonicalCode ?? (record.id.startsWith("OP-") ? `#${record.id.slice(3)}` : record.id);
    const originalTitle = typeof payload.title === "string" && payload.title !== record.title
      ? payload.title
      : record.title;
    const rawActivities = Array.isArray(payload.activities) ? payload.activities : [];
    const activities = rawActivities.flatMap((activity, index) => {
      if (!activity || typeof activity !== "object") return [];
      const item = activity as Record<string, unknown>;
      const label = typeof item.title === "string" ? item.title : typeof item.label === "string" ? item.label : "Attività operativa";
      return [{
        label,
        detail: typeof item.detail === "string" ? item.detail : "Attività collegata alla commessa",
        state: item.state === "done" || item.state === "active" || item.state === "blocked" ? item.state : "queued",
        owner: typeof item.owner === "string" ? item.owner : "Da assegnare",
        key: `${record.id}-activity-${index}`,
      } as JobActivity];
    });
    return {
      id: canonicalCode,
      sourceId: record.id,
      title: originalTitle,
      description: typeof payload.description === "string" ? payload.description : "",
      client: typeof payload.client === "string" ? payload.client : "—",
      location: location || record.detail,
      team: team || "—",
      status,
      statusCode,
      progress: Math.max(0, Math.min(100, Number(record.progress) || 0)),
      due: typeof payload.dueDate === "string" ? payload.dueDate : record.meta || "—",
      category: typeof payload.category === "string" ? payload.category : "Adapter readback",
      priority: payload.priority === "HIGH" || payload.priority === "LOW" ? payload.priority : "STANDARD",
      version: typeof payload.version === "number" ? payload.version : 1,
      activities,
    };
  });
}

export default function OperationsPage() {
  const router = useRouter();
  const [mobileMenu, setMobileMenu] = useState(false);
  const [filter, setFilter] = useState<JobFilter>("TUTTE");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [newJobOpen, setNewJobOpen] = useState(false);
  const [planningOpen, setPlanningOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [adapterJobs, setAdapterJobs] = useState<OperationsJob[] | null>(null);
  const [adapterStatus, setAdapterStatus] = useState<"loading" | "online" | "empty" | "error">("loading");
  const activeJobs = adapterJobs ?? jobs;
  const adapterOnline = adapterStatus === "online";

  useEffect(() => {
    let active = true;
    fetch("/api/operations", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("operations_adapter_readback_failed");
        return (await response.json()) as OperationsAdapterResponse;
      })
      .then((payload) => {
        if (!active) return;
        const records = Array.isArray(payload.records) ? payload.records : [];
        const nextJobs = records.length ? jobsFromAdapter(records) : [];
        setAdapterJobs(nextJobs);
        setSelectedId((current) => current || nextJobs[0]?.id || "");
        setAdapterStatus(records.length ? "online" : "empty");
      })
      .catch(() => {
        if (!active) return;
        setAdapterJobs([]);
        setAdapterStatus("error");
      });
    return () => {
      active = false;
    };
  }, []);

  const filteredJobs = useMemo(() => activeJobs.filter((job) => {
    const matchesFilter = filter === "TUTTE"
      || (filter === "IN CORSO" && job.status === "In corso")
      || (filter === "PIANIFICATE" && ["Pianificata", "PROPOSTA", "APPROVATA"].includes(job.status))
      || (filter === "COMPLETATE" && ["Completata", "CHIUSA"].includes(job.status))
      || (filter === "BOZZE" && job.status === "BOZZA")
      || (filter === "BLOCCATE" && job.status === "BLOCCATA");
    const haystack = `${job.id} ${job.title} ${job.location} ${job.team} ${job.category}`.toLowerCase();
    return matchesFilter && haystack.includes(query.trim().toLowerCase());
  }), [activeJobs, filter, query]);

  const selectedJob = activeJobs.find((job) => job.id === selectedId) ?? emptyJob;
  const activeCount = activeJobs.filter((job) => job.status === "In corso").length;
  const plannedCount = activeJobs.filter((job) => ["Pianificata", "PROPOSTA", "APPROVATA"].includes(job.status)).length;
  const activityCount = activeJobs.reduce((total, job) => total + job.activities.length, 0);
  const openReports = activeJobs.filter((job) => job.status !== "Completata" && job.status !== "CHIUSA" && job.status !== "ANNULLATA").length;

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  };

  const handleIntakeCreated = (payload: IntakeCreateResponse) => {
    const records = Array.isArray(payload.records) ? payload.records : [];
    const nextJobs = records.length ? jobsFromAdapter(records) : [];
    setAdapterJobs(nextJobs);
    setAdapterStatus("online");
    const createdJob = payload.created ? jobsFromAdapter([payload.created])[0] : undefined;
    if (createdJob) setSelectedId(createdJob.id);
    notify(`Commessa ${createdJob?.id ?? "assegnata"} salvata in bozza · readback verificato`);
  };

  const navigate = (id: string, label: string) => {
    setMobileMenu(false);
    if (id === "command") {
      router.push("/");
      return;
    }
    if (id === "operations") return;
    if (id === "workforce") {
      router.push("/workforce");
      return;
    }
    if (id === "assets") {
      router.push("/assets");
      return;
    }
    if (id === "warehouse") {
      router.push("/warehouse");
      return;
    }
    if (id === "mission") {
      router.push("/mission");
      return;
    }
    if (id === "qr") {
      router.push("/qr");
      return;
    }
    if (id === "events_authority") {
      router.push("/onboarding");
      return;
    }
    notify(`${label}: superficie prevista nel prossimo adapter`);
  };

  return <main className="min-h-screen overflow-x-hidden bg-[#050607] text-slate-100 selection:bg-lime-300 selection:text-[#060806]"><div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_74%_0%,rgba(190,255,60,0.07),transparent_25%),radial-gradient(circle_at_18%_78%,rgba(70,110,120,0.08),transparent_27%)]" /><div className="relative flex min-h-screen">
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-[232px] flex-col border-r border-lime-300/10 bg-[#050607]/96 px-3 py-4 backdrop-blur-xl transition-transform lg:static lg:translate-x-0 ${mobileMenu ? "translate-x-0" : "-translate-x-full"}`}><div className="flex items-center justify-between px-2"><button className="flex items-center gap-3 text-left" onClick={() => { setMobileMenu(false); router.push("/"); }} type="button"><span className="neon-pulse relative grid size-10 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black font-mono text-[18px] font-black italic text-lime-200"><span className="absolute inset-x-2 top-3 h-0.5 rotate-[-16deg] bg-lime-300" /><span className="absolute inset-x-2 top-5 h-0.5 rotate-[-16deg] bg-lime-300/80" /><span className="absolute inset-x-2 top-7 h-0.5 rotate-[-16deg] bg-lime-300/60" />Z</span><span><span className="block text-sm font-bold tracking-[0.18em] text-slate-50">AI-ZEROW</span><span className="block text-[10px] uppercase tracking-[0.22em] text-lime-300/75">command</span></span></button><button className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-white/5 hover:text-white lg:hidden" onClick={() => setMobileMenu(false)} type="button" aria-label="Chiudi menu"><X className="size-4" /></button></div><button className="carbon-card mt-8 flex w-full items-center gap-3 rounded-xl p-3 text-left transition hover:border-lime-300/25" type="button" onClick={() => notify("Workspace ZEROW · contesto owner") }><span className="grid size-8 place-items-center rounded-lg border border-lime-300/20 bg-lime-300/10 text-lime-200"><HardHat className="size-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-slate-200">ZEROW workspace</span><span className="mt-0.5 block truncate text-[10px] text-slate-600">owner · tenant context</span></span><ChevronRight className="size-3.5 text-slate-600" /></button><nav className="mt-7 flex-1" aria-label="Navigazione principale"><p className="px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-600">Workspace</p><div className="mt-2 space-y-1">{navItems.map((item) => { const Icon = item.icon; const active = item.id === "operations"; return <button aria-current={active ? "page" : undefined} className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${active ? "border border-lime-300/20 bg-lime-300/10 text-lime-200 shadow-[inset_0_0_20px_rgba(190,255,60,0.04)]" : "text-slate-500 hover:bg-white/[0.045] hover:text-slate-100"}`} key={item.id} onClick={() => navigate(item.id, item.label)} type="button"><Icon className={`size-4 ${active ? "text-lime-200" : "text-slate-600 group-hover:text-slate-300"}`} /><span>{item.label}</span>{item.id === "command" && <span className="ml-auto rounded border border-white/10 px-1.5 py-0.5 font-mono text-[8px] tracking-[0.08em] text-slate-600">AI</span>}</button>; })}</div></nav><div className="mt-5 border-t border-white/[0.08] pt-4"><div className="flex items-center justify-between px-2 text-[10px] uppercase tracking-[0.14em] text-slate-600"><span>System status</span><span className="flex items-center gap-1.5 text-lime-200"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_8px_rgba(190,255,60,0.8)]" />online</span></div><div className="carbon-inset mt-3 rounded-xl p-3"><div className="flex items-center gap-2 text-[10px] text-slate-400"><Activity className="size-3.5 text-lime-300" />Operations core</div><p className="mt-3 font-mono text-[9px] text-slate-600">{adapterOnline ? "S04 · D1 ADAPTER ONLINE" : "S04 · D1 READBACK EMPTY"}</p></div></div></aside>
    {mobileMenu && <button className="fixed inset-0 z-30 bg-black/75 lg:hidden" onClick={() => setMobileMenu(false)} aria-label="Chiudi menu" type="button" />}
    <section className="min-w-0 flex-1"><header className="sticky top-0 z-20 flex h-[72px] items-center gap-3 border-b border-white/[0.08] bg-[#050607]/88 px-4 backdrop-blur-xl sm:gap-5 sm:px-7"><IconButton label="Apri menu" onClick={() => setMobileMenu(true)} className="lg:hidden"><Menu className="size-4" /></IconButton><div className="relative hidden min-w-0 flex-1 md:block"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-600" /><Input aria-label="Cerca nelle Operations" className="h-10 max-w-[440px] border-white/10 bg-black/30 pl-10 text-xs text-slate-100 placeholder:text-slate-600 focus-visible:border-lime-300/40" onChange={(event) => setQuery(event.target.value)} placeholder="Cerca commesse, team, ubicazioni…" value={query} /></div><div className="flex min-w-0 flex-1 items-center gap-2 md:hidden"><span className="truncate text-xs font-semibold tracking-[0.14em] text-slate-200">OPERATIONS</span><span className="size-1 rounded-full bg-lime-300" /></div><div className="ml-auto flex items-center gap-2"><span className="hidden items-center gap-2 rounded-full border border-lime-300/20 bg-lime-300/5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-lime-200 sm:flex"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_9px_rgba(190,255,60,0.9)]" />D1 readback</span><IconButton label="Notifiche"><Bell className="size-4" /></IconButton><span className="hidden size-8 place-items-center rounded-full border border-white/15 bg-gradient-to-br from-slate-200 to-slate-500 text-xs font-bold text-[#080a0b] sm:grid">AB</span><div className="hidden text-right lg:block"><p className="text-xs font-medium text-slate-200">Owner</p><p className="text-[10px] text-slate-600">Tenant EMS</p></div><ChevronDown className="hidden size-3.5 text-slate-500 lg:block" /></div></header>
      <div className="mx-auto max-w-[1680px] px-4 py-5 sm:px-7 sm:py-7"><div className="mb-7 flex flex-wrap items-end justify-between gap-5"><div><div className="flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-lime-300/80"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_9px_rgba(190,255,60,0.9)]" />AI-ZEROW / WORK / OPERATIONS</div><h1 className="mt-3 text-3xl font-semibold tracking-[-0.055em] text-lime-100 sm:text-[36px]">Operations control</h1><p className="mt-2 max-w-xl text-sm leading-6 text-slate-400">Commesse, pianificazione e attività <span className="text-slate-600">·</span> readback D1 tenant-scoped</p></div><div className="flex items-center gap-3"><span className="hidden items-center rounded-xl border border-white/[0.1] bg-black/25 px-3.5 py-2.5 font-mono text-[10px] text-slate-500 sm:inline-flex"><Clock3 className="mr-2 size-3.5 text-lime-300" />Aggiornato ora</span><Button aria-expanded={newJobOpen} aria-haspopup="dialog" className="h-12 rounded-xl border-lime-100/55 px-5 text-sm shadow-[0_0_30px_rgba(190,255,60,0.18)]" onClick={(event) => { event.preventDefault(); setNewJobOpen(true); }} type="button"><Plus className="size-4" />Nuova commessa</Button></div></div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="Commesse attive" value={String(activeCount)} detail={adapterOnline ? "Readback verificato" : "In attesa"} icon={BriefcaseBusiness} tone="lime" /><MetricCard label="In pianificazione" value={String(plannedCount)} detail={adapterOnline ? "DRAFT / PLAN" : "In attesa"} icon={CalendarClock} tone="cyan" /><MetricCard label="Attività collegate" value={String(activityCount)} detail={adapterOnline ? "Per commessa" : "Nessun dato"} icon={ClipboardCheck} tone="lime" /><MetricCard label="Rapportini aperti" value={String(openReports)} detail={adapterOnline ? "Stato operativo" : "Nessun dato"} icon={FileText} tone="amber" /></div>
        <div className="mt-4 grid gap-4 2xl:grid-cols-[minmax(0,1.15fr)_minmax(380px,0.85fr)]"><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><SectionTitle eyebrow="OPERATIONS / REGISTER" title="Registro commesse" /><p className="mt-1 text-[11px] text-slate-500">{adapterOnline ? "Readback D1 attivo · API Operations adapter online" : "Readback D1 vuoto · adapter Operations in attesa"}</p></div><div className="flex items-center gap-2">{adapterOnline ? <StatusBadge tone="lime">ADAPTER ONLINE</StatusBadge> : <StatusBadge tone="cyan">ADAPTER REQUIRED</StatusBadge>}<IconButton label="Impostazioni registro" onClick={() => notify("Filtri avanzati disponibili con l'adapter Operations")}><Settings2 className="size-4" /></IconButton></div></div><div className="mt-4 overflow-x-auto"><Tabs value={filter} onValueChange={(value) => setFilter(value as JobFilter)}><TabsList className="h-9 min-w-max rounded-lg border border-white/10 bg-black/55 p-1"><TabsTrigger className="h-7 rounded-md px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]" value="TUTTE">Tutte</TabsTrigger><TabsTrigger className="h-7 rounded-md px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]" value="IN CORSO">In corso</TabsTrigger><TabsTrigger className="h-7 rounded-md px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]" value="PIANIFICATE">Pianificate</TabsTrigger><TabsTrigger className="h-7 rounded-md px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]" value="BOZZE">Bozze</TabsTrigger><TabsTrigger className="h-7 rounded-md px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]" value="BLOCCATE">Bloccate</TabsTrigger><TabsTrigger className="h-7 rounded-md px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]" value="COMPLETATE">Completate</TabsTrigger></TabsList></Tabs></div><div className="mt-4 overflow-hidden rounded-xl border border-white/[0.08] bg-black/20"><div className="hidden grid-cols-[1.15fr_0.85fr_0.7fr_0.45fr] gap-3 border-b border-white/[0.08] px-4 py-3 text-[9px] font-semibold uppercase tracking-[0.15em] text-slate-600 md:grid"><span>Commessa</span><span>Squadra</span><span>Stato</span><span>Avanzamento</span></div><div className="divide-y divide-white/[0.07]">{filteredJobs.map((job) => { const active = selectedJob.id === job.id; return <button key={job.id} className={`grid w-full gap-3 px-4 py-3 text-left transition md:grid-cols-[1.15fr_0.85fr_0.7fr_0.45fr] md:items-center ${active ? "bg-lime-300/[0.07]" : "hover:bg-white/[0.035]"}`} onClick={() => setSelectedId(job.id)} type="button"><div className="flex min-w-0 items-center gap-3"><span className={`grid size-9 shrink-0 place-items-center rounded-xl border ${active ? "border-lime-300/35 bg-lime-300/10 text-lime-200" : "border-white/10 bg-black/30 text-slate-500"}`}><BriefcaseBusiness className="size-4" /></span><span className="min-w-0"><span className="flex items-center gap-2"><span className="font-mono text-[11px] text-lime-200">{job.id}</span><span className="truncate text-xs font-medium text-slate-200">{job.title}</span></span><span className="mt-1 block truncate text-[11px] text-slate-500">{job.location} · {job.category}</span></span></div><div className="flex items-center gap-2 pl-12 md:pl-0"><span className="size-1.5 rounded-full bg-lime-300" /><span className="text-xs text-slate-400">{job.team}</span></div><div className="pl-12 md:pl-0"><JobStatus status={job.status} /></div><div className="pl-12 md:pl-0"><div className="flex items-center gap-2"><div className="h-1.5 min-w-[54px] flex-1 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-lime-300 shadow-[0_0_10px_rgba(190,255,60,0.55)]" style={{ width: `${job.progress}%` }} /></div><span className="font-mono text-[10px] text-slate-400">{job.progress}%</span></div></div></button>; })}{filteredJobs.length === 0 && <div className="px-4 py-10 text-center text-xs text-slate-500">Nessuna commessa corrisponde ai filtri locali.</div>}</div></div></section>
          <section className="carbon-card carbon-card-neon rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><SectionTitle eyebrow="SELECTED JOB / READ MODEL" title={selectedJob.id} /><p className="mt-1 text-xs text-slate-500">{selectedJob.title} · {selectedJob.location}</p></div><button className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-lime-300 hover:text-lime-100" onClick={() => adapterOnline ? router.push(`/operations/${encodeURIComponent(selectedJob.sourceId ?? selectedJob.id)}`) : notify(`Dettaglio ${selectedJob.id}: disponibile dopo il readback D1`)} type="button">Apri workspace <ArrowUpRight className="size-3.5" /></button></div><div className="mt-5 flex flex-wrap items-center gap-2"><JobStatus status={selectedJob.status} /><StatusBadge tone={selectedJob.priority === "HIGH" ? "red" : selectedJob.priority === "STANDARD" ? "cyan" : "amber"}>{selectedJob.priority}</StatusBadge><span className="rounded-full border border-white/10 px-2 py-1 text-[10px] text-slate-500">{selectedJob.due}</span></div><div className="carbon-inset mt-5 rounded-xl p-4"><div className="flex items-end justify-between gap-3"><div><p className="text-[10px] uppercase tracking-[0.14em] text-slate-600">Avanzamento operativo</p><p className="mt-1 font-mono text-3xl font-semibold tracking-[-0.07em] text-slate-50">{selectedJob.progress}%</p></div><div className="text-right"><p className="text-[11px] text-slate-500">Responsabile</p><p className="mt-1 text-xs font-medium text-lime-200">{selectedJob.team}</p></div></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-lime-300 shadow-[0_0_16px_rgba(190,255,60,0.64)]" style={{ width: `${selectedJob.progress}%` }} /></div><div className="mt-2 flex justify-between text-[10px] text-slate-600"><span>Avvio</span><span>Chiusura e readback</span></div></div><div className="mt-5 space-y-3">{selectedJob.activities.map((activity) => <div className="flex items-center gap-3" key={activity.label}><ActivityState state={activity.state} /><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-slate-200">{activity.label}</p><p className="mt-1 truncate text-[11px] text-slate-500">{activity.detail}</p></div><span className="hidden text-[10px] text-slate-600 sm:block">{activity.owner}</span></div>)}</div><div className="mt-5 grid grid-cols-2 gap-2"><Button variant="outline" className="h-9 border-white/10 bg-black/20 text-xs text-slate-300 hover:border-lime-300/30 hover:bg-lime-300/10 hover:text-lime-100" onClick={() => setPlanningOpen(true)}><CalendarClock className="size-3.5" />Pianifica</Button><Button className="h-9 bg-lime-300 text-xs font-semibold text-[#060806] hover:bg-lime-200" onClick={() => notify("Rapportino mantenuto in preview · readback non eseguito")}><FileText className="size-3.5" />Rapportino</Button></div></section></div>
        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)_minmax(300px,0.75fr)]"><section className="carbon-card rounded-2xl p-4 sm:p-5"><SectionTitle eyebrow="ACTIVITY CONTRACT" title="Attività operative" action="Vedi catalogo" onAction={() => notify("Catalogo attività: route pronta, adapter non collegato")} /><div className="mt-4 space-y-3">{selectedJob.activities.length ? selectedJob.activities.map((activity) => <div className="carbon-inset flex items-center gap-3 rounded-xl p-3" key={`contract-${activity.label}`}><ActivityState state={activity.state} /><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-slate-200">{activity.label}</p><p className="mt-1 truncate text-[11px] text-slate-500">{activity.detail}</p></div><ChevronRight className="size-4 text-slate-600" /></div>) : <div className="py-6 text-center text-xs text-slate-500">Nessuna attività nel readback D1.</div>}</div></section><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><SectionTitle eyebrow="PLANNING / RESOURCES" title="Risorse assegnate" /><StatusBadge tone="cyan">READ MODEL</StatusBadge></div><div className="mt-4 rounded-xl border border-dashed border-white/10 px-3 py-6 text-center text-xs text-slate-500">Nessuna risorsa collegata al readback D1.</div><div className="mt-5 border-t border-white/[0.08] pt-4"><div className="flex items-center justify-between text-[11px]"><span className="text-slate-500">Opzioni risorsa</span><span className="font-mono text-slate-600">0 / 0 verificabili</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10" /></div></section><section className="carbon-card rounded-2xl p-4 sm:p-5"><SectionTitle eyebrow="DAILY REPORT" title="Rapportino giornaliero" /><div className="carbon-inset mt-4 rounded-xl p-4"><div className="flex items-start gap-3"><span className="grid size-9 place-items-center rounded-xl border border-amber-300/25 bg-amber-300/10 text-amber-200"><FileText className="size-4" /></span><div><p className="text-xs font-semibold text-slate-200">{selectedJob.id === emptyJob.id ? "Nessuna commessa selezionata" : `${selectedJob.id} · bozza locale`}</p><p className="mt-1 text-[11px] leading-5 text-slate-500">Il documento sarà composto quando il readback operativo restituirà una commessa.</p></div></div><div className="mt-4 grid grid-cols-2 gap-2 text-center"><div className="rounded-lg border border-white/10 bg-black/25 px-2 py-2"><p className="font-mono text-lg text-slate-100">—</p><p className="text-[10px] text-slate-600">presenza</p></div><div className="rounded-lg border border-white/10 bg-black/25 px-2 py-2"><p className="font-mono text-lg text-lime-200">—</p><p className="text-[10px] text-slate-600">avanzamento</p></div></div></div><Button variant="outline" className="mt-4 h-9 w-full border-lime-300/25 bg-lime-300/5 text-xs text-lime-200 hover:bg-lime-300/10" onClick={() => notify("Rapportino disponibile dopo il readback di una commessa")}><ClipboardCheck className="size-3.5" />Prepara rapportino</Button></section></div>
        <section className="carbon-card mt-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl p-4 sm:p-5"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl border border-lime-300/25 bg-lime-300/10 text-lime-200"><ShieldCheck className="size-4" /></span><div><p className="text-sm font-semibold text-slate-100">{adapterOnline ? "Modulo Operations collegato al Sites adapter" : "Modulo Operations pronto per il prossimo adapter"}</p><p className="mt-1 text-[11px] text-slate-500">{adapterOnline ? "Commesse e readback sono collegati al D1 adapter; planning e rapportino restano bounded." : "Commesse, attività, planning, risorse e rapportino sono rappresentati senza simulare scritture su Neon."}</p></div></div><div className="flex items-center gap-2">{adapterOnline ? <StatusBadge>ADAPTER READ/WRITE READY</StatusBadge> : <StatusBadge>D1 READBACK EMPTY</StatusBadge>}<button className="grid size-8 place-items-center rounded-lg border border-white/10 text-slate-500 hover:border-lime-300/30 hover:text-lime-200" onClick={() => notify("Evidenze S04: readback D1 e contratti verificati")} type="button" aria-label="Apri evidenze"><ArrowUpRight className="size-3.5" /></button></div></section>
        <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] py-5 text-[10px] text-slate-600"><span>{adapterOnline ? "AI-ZEROW OPERATIONS · S04 adapter surface" : "AI-ZEROW OPERATIONS · S04 static surface"}</span><span className="flex items-center gap-2"><span>black carbon core</span><span className="size-1 rounded-full bg-lime-300" /><span>{adapterOnline ? "D1 adapter read/write" : "no backend write"}</span></span></footer>
      </div></section>
  </div>
  <OperationsCommessaIntake open={newJobOpen} onOpenChange={setNewJobOpen} onCreated={handleIntakeCreated} />
  <Dialog open={planningOpen} onOpenChange={setPlanningOpen}><DialogContent className="border-cyan-300/20 bg-[#0a0d0e] text-slate-100 sm:max-w-[520px]"><DialogHeader><DialogTitle className="text-slate-100">Pianificazione risorse</DialogTitle><DialogDescription className="text-slate-500">Vista locale per {selectedJob.id}. La verifica delle opzioni risorsa sarà collegata a /api/operations/jobs/[jobId]/planning/resource-options.</DialogDescription></DialogHeader><div className="space-y-3"><div className="carbon-inset flex items-center gap-3 rounded-xl p-3"><Users className="size-4 text-lime-200" /><div><p className="text-xs font-medium text-slate-200">{selectedJob.team}</p><p className="text-[11px] text-slate-500">presidio operativo selezionato</p></div></div><div className="carbon-inset flex items-center gap-3 rounded-xl p-3"><Truck className="size-4 text-cyan-200" /><div><p className="text-xs font-medium text-slate-200">Nessun asset selezionato</p><p className="text-[11px] text-slate-500">Le opzioni arrivano dal readback D1 della commessa.</p></div></div><div className="flex items-start gap-2 rounded-xl border border-amber-300/20 bg-amber-300/5 p-3 text-[11px] leading-5 text-amber-100/80"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-200" />Nessuna modifica verrà salvata: il dominio, le autorizzazioni e il readback non sono ancora collegati.</div></div><DialogFooter><DialogClose asChild><Button className="bg-lime-300 text-[#060806] hover:bg-lime-200">Chiudi</Button></DialogClose></DialogFooter></DialogContent></Dialog>
  {toast && <div className="fixed bottom-5 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2 rounded-xl border border-lime-300/25 bg-[#0b1008]/95 px-4 py-3 text-xs text-lime-100 shadow-[0_0_30px_rgba(190,255,60,0.14)] backdrop-blur-xl"><CheckCircle2 className="size-4 text-lime-300" />{toast}</div>}
  </main>;
}
