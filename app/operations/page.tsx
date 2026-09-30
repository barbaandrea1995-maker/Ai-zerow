"use client";

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
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
  Send,
  Settings2,
  ShieldCheck,
  Truck,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useRouter } from "next/navigation";

type JobStatus = "In corso" | "Pianificata" | "Completata";
type JobFilter = "TUTTE" | "IN CORSO" | "PIANIFICATE" | "COMPLETATE";
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
  location: string;
  status: JobStatus;
  priority: "HIGH" | "STANDARD" | "LOW";
  progress: number;
  team: string;
  due: string;
  category: string;
  activities: JobActivity[];
};

type OperationsAdapterRecord = {
  id: string;
  title: string;
  detail: string;
  meta: string;
  status: string;
  progress: number;
};

type OperationsAdapterResponse = {
  records?: OperationsAdapterRecord[];
};

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

const jobs: OperationsJob[] = [
  {
    id: "#4587",
    title: "Manutenzione impianto",
    location: "Via Roma, Milano",
    status: "In corso",
    priority: "HIGH",
    progress: 68,
    team: "Team Alpha",
    due: "Oggi · 16:30",
    category: "Manutenzione",
    activities: [
      { label: "Messa in sicurezza area", detail: "Completata alle 08:42", state: "done", owner: "L. Bianchi" },
      { label: "Sostituzione componenti", detail: "In esecuzione sul campo", state: "active", owner: "M. Rossi" },
      { label: "Collaudo e rapportino", detail: "Richiede chiusura attività", state: "queued", owner: "Team Alpha" },
    ],
  },
  {
    id: "#4586",
    title: "Controllo sicurezza",
    location: "Corso Italia, Milano",
    status: "In corso",
    priority: "STANDARD",
    progress: 45,
    team: "Team Beta",
    due: "Oggi · 18:00",
    category: "Ispezione",
    activities: [
      { label: "Checklist preliminare", detail: "Completata alle 09:10", state: "done", owner: "A. Esposito" },
      { label: "Verifica dispositivi", detail: "In attesa di evidenza", state: "active", owner: "Team Beta" },
      { label: "Rapporto sicurezza", detail: "Da generare", state: "queued", owner: "Responsabile HSE" },
    ],
  },
  {
    id: "#4585",
    title: "Installazione",
    location: "Via Dante, Milano",
    status: "Pianificata",
    priority: "STANDARD",
    progress: 6,
    team: "Team Gamma",
    due: "Domani · 07:30",
    category: "Installazione",
    activities: [
      { label: "Verifica risorse", detail: "Opzioni da confermare", state: "active", owner: "Planning" },
      { label: "Briefing squadra", detail: "Pianificato per domani", state: "queued", owner: "Team Gamma" },
      { label: "Avvio installazione", detail: "Non iniziata", state: "queued", owner: "Team Gamma" },
    ],
  },
  {
    id: "#4584",
    title: "Ispezione periodica",
    location: "Zona Industriale",
    status: "Completata",
    priority: "LOW",
    progress: 100,
    team: "Team Alpha",
    due: "Ieri · 17:00",
    category: "Ispezione",
    activities: [
      { label: "Ispezione periodica", detail: "Chiusa alle 16:14", state: "done", owner: "Team Alpha" },
      { label: "Evidenze archiviate", detail: "Verificate", state: "done", owner: "Back office" },
      { label: "Rapportino giornaliero", detail: "Pronto per readback", state: "done", owner: "Team Alpha" },
    ],
  },
];

const toneStyles: Record<Tone, { icon: string; badge: string; line: string }> = {
  lime: { icon: "text-lime-200", badge: "border-lime-300/25 bg-lime-300/10 text-lime-200", line: "bg-lime-300" },
  cyan: { icon: "text-cyan-200", badge: "border-cyan-300/25 bg-cyan-300/10 text-cyan-200", line: "bg-cyan-300" },
  amber: { icon: "text-amber-200", badge: "border-amber-300/25 bg-amber-300/10 text-amber-200", line: "bg-amber-300" },
  red: { icon: "text-rose-200", badge: "border-rose-300/25 bg-rose-300/10 text-rose-200", line: "bg-rose-300" },
};

function IconButton({ label, children, onClick, className = "" }: { label: string; children: ReactNode; onClick?: () => void; className?: string }) {
  return <button aria-label={label} className={`grid size-9 place-items-center rounded-lg border border-white/10 bg-black/20 text-slate-500 transition hover:border-lime-300/35 hover:bg-lime-300/10 hover:text-lime-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300 ${className}`} onClick={onClick} type="button">{children}</button>;
}

function StatusBadge({ children, tone = "lime" }: { children: ReactNode; tone?: Tone }) {
  const styles = toneStyles[tone];
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-semibold tracking-[0.05em] ${styles.badge}`}><span className="size-1.5 rounded-full bg-current shadow-[0_0_9px_currentColor]" />{children}</span>;
}

function SectionTitle({ eyebrow, title, action, onAction }: { eyebrow?: string; title: string; action?: string; onAction?: () => void }) {
  return <div className="flex items-start justify-between gap-3"><div>{eyebrow && <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/65">{eyebrow}</p>}<h2 className="text-[15px] font-semibold tracking-[-0.01em] text-slate-100">{title}</h2></div>{action && <button className="text-[11px] font-medium text-lime-300 transition hover:text-lime-100" onClick={onAction} type="button">{action}</button>}</div>;
}

function MetricCard({ label, value, detail, icon: Icon, tone }: { label: string; value: string; detail: string; icon: typeof BriefcaseBusiness; tone: Tone }) {
  const style = toneStyles[tone];
  return <article className="carbon-card rounded-2xl p-4"><div className="flex items-start justify-between gap-3"><span className={`grid size-9 place-items-center rounded-xl border border-current/20 bg-current/10 ${style.icon}`}><Icon className="size-[18px]" /></span><StatusBadge tone={tone}>{detail}</StatusBadge></div><p className="mt-4 text-xs text-slate-500">{label}</p><p className="mt-1 font-mono text-[29px] font-semibold leading-none tracking-[-0.06em] text-slate-50">{value}</p><div className="mt-4 flex items-end gap-1.5 opacity-80">{[18,26,20,35,28,48,42,57,53,66,61,75].map((height, index) => <span className={`flex-1 rounded-t-sm ${style.line}`} key={index} style={{ height: `${height / 2}px`, opacity: 0.25 + index * 0.05 }} />)}</div></article>;
}

function JobStatus({ status }: { status: JobStatus }) {
  const tone: Tone = status === "In corso" ? "lime" : status === "Pianificata" ? "cyan" : "amber";
  return <StatusBadge tone={tone}>{status.toUpperCase()}</StatusBadge>;
}

function ActivityState({ state }: { state: JobActivity["state"] }) {
  if (state === "done") return <span className="grid size-7 place-items-center rounded-full border border-lime-300/30 bg-lime-300/10 text-lime-200"><Check className="size-3.5" /></span>;
  if (state === "active") return <span className="grid size-7 place-items-center rounded-full border border-cyan-300/30 bg-cyan-300/10 text-cyan-200"><Activity className="size-3.5" /></span>;
  return <span className="grid size-7 place-items-center rounded-full border border-white/10 bg-black/25 text-slate-600"><span className="size-1.5 rounded-full bg-current" /></span>;
}

function jobsFromAdapter(records: OperationsAdapterRecord[]): OperationsJob[] {
  return records.map((record, index) => {
    const fallback = jobs[index % jobs.length];
    const [location, team] = record.detail.split(" · ");
    const status: JobStatus = record.status === "IN CORSO" ? "In corso" : record.status === "PIANIFICATA" ? "Pianificata" : "Completata";
    return {
      ...fallback,
      id: record.id.startsWith("OP-") ? `#${record.id.slice(3)}` : record.id,
      sourceId: record.id,
      title: record.title,
      location: location || record.detail,
      team: team || fallback.team,
      status,
      progress: Math.max(0, Math.min(100, Number(record.progress) || 0)),
      due: record.meta || fallback.due,
      category: "Adapter readback",
    };
  });
}

export default function OperationsPage() {
  const router = useRouter();
  const [mobileMenu, setMobileMenu] = useState(false);
  const [filter, setFilter] = useState<JobFilter>("TUTTE");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(jobs[0].id);
  const [newJobOpen, setNewJobOpen] = useState(false);
  const [planningOpen, setPlanningOpen] = useState(false);
  const [jobTitle, setJobTitle] = useState("");
  const [jobLocation, setJobLocation] = useState("");
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
        setAdapterJobs(records.length ? jobsFromAdapter(records) : null);
        setAdapterStatus(records.length ? "online" : "empty");
      })
      .catch(() => {
        if (!active) return;
        setAdapterJobs(null);
        setAdapterStatus("error");
      });
    return () => {
      active = false;
    };
  }, []);

  const filteredJobs = useMemo(() => activeJobs.filter((job) => {
    const matchesFilter = filter === "TUTTE" || (filter === "IN CORSO" && job.status === "In corso") || (filter === "PIANIFICATE" && job.status === "Pianificata") || (filter === "COMPLETATE" && job.status === "Completata");
    const haystack = `${job.id} ${job.title} ${job.location} ${job.team} ${job.category}`.toLowerCase();
    return matchesFilter && haystack.includes(query.trim().toLowerCase());
  }), [activeJobs, filter, query]);

  const selectedJob = activeJobs.find((job) => job.id === selectedId) ?? activeJobs[0];

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  };

  const handleCreateJob = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNewJobOpen(false);
    const title = jobTitle.trim() || "Nuova commessa";
    try {
      const response = await fetch("/api/operations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, detail: `${jobLocation.trim() || "Ubicazione da definire"} · Planning`, meta: "Da pianificare", status: "PIANIFICATA", tone: "cyan", progress: 0, recordType: "read-model" }),
      });
      if (!response.ok) throw new Error("operations_adapter_write_failed");
      const payload = (await response.json()) as OperationsAdapterResponse;
      const records = Array.isArray(payload.records) ? payload.records : [];
      setAdapterJobs(records.length ? jobsFromAdapter(records) : null);
      setAdapterStatus("online");
      notify(`Commessa salvata su Sites D1 adapter: ${title}`);
    } catch {
      notify(`Adapter Operations non disponibile: bozza non salvata (${title})`);
    }
    setJobTitle("");
    setJobLocation("");
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
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-[232px] flex-col border-r border-lime-300/10 bg-[#050607]/96 px-3 py-4 backdrop-blur-xl transition-transform lg:static lg:translate-x-0 ${mobileMenu ? "translate-x-0" : "-translate-x-full"}`}><div className="flex items-center justify-between px-2"><button className="flex items-center gap-3 text-left" onClick={() => { setMobileMenu(false); window.location.href = "/"; }} type="button"><span className="neon-pulse relative grid size-10 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black font-mono text-[18px] font-black italic text-lime-200"><span className="absolute inset-x-2 top-3 h-0.5 rotate-[-16deg] bg-lime-300" /><span className="absolute inset-x-2 top-5 h-0.5 rotate-[-16deg] bg-lime-300/80" /><span className="absolute inset-x-2 top-7 h-0.5 rotate-[-16deg] bg-lime-300/60" />Z</span><span><span className="block text-sm font-bold tracking-[0.18em] text-slate-50">AI-ZEROW</span><span className="block text-[10px] uppercase tracking-[0.22em] text-lime-300/75">command</span></span></button><button className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-white/5 hover:text-white lg:hidden" onClick={() => setMobileMenu(false)} type="button" aria-label="Chiudi menu"><X className="size-4" /></button></div><button className="carbon-card mt-8 flex w-full items-center gap-3 rounded-xl p-3 text-left transition hover:border-lime-300/25" type="button" onClick={() => notify("Workspace ZEROW · contesto owner") }><span className="grid size-8 place-items-center rounded-lg border border-lime-300/20 bg-lime-300/10 text-lime-200"><HardHat className="size-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-slate-200">ZEROW workspace</span><span className="mt-0.5 block truncate text-[10px] text-slate-600">owner · tenant context</span></span><ChevronRight className="size-3.5 text-slate-600" /></button><nav className="mt-7 flex-1" aria-label="Navigazione principale"><p className="px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-600">Workspace</p><div className="mt-2 space-y-1">{navItems.map((item) => { const Icon = item.icon; const active = item.id === "operations"; return <button aria-current={active ? "page" : undefined} className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${active ? "border border-lime-300/20 bg-lime-300/10 text-lime-200 shadow-[inset_0_0_20px_rgba(190,255,60,0.04)]" : "text-slate-500 hover:bg-white/[0.045] hover:text-slate-100"}`} key={item.id} onClick={() => navigate(item.id, item.label)} type="button"><Icon className={`size-4 ${active ? "text-lime-200" : "text-slate-600 group-hover:text-slate-300"}`} /><span>{item.label}</span>{item.id === "command" && <span className="ml-auto rounded border border-white/10 px-1.5 py-0.5 font-mono text-[8px] tracking-[0.08em] text-slate-600">AI</span>}</button>; })}</div></nav><div className="mt-5 border-t border-white/[0.08] pt-4"><div className="flex items-center justify-between px-2 text-[10px] uppercase tracking-[0.14em] text-slate-600"><span>System status</span><span className="flex items-center gap-1.5 text-lime-200"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_8px_rgba(190,255,60,0.8)]" />online</span></div><div className="carbon-inset mt-3 rounded-xl p-3"><div className="flex items-center gap-2 text-[10px] text-slate-400"><Activity className="size-3.5 text-lime-300" />Operations core</div><div className="mt-2 flex items-end gap-0.5">{[18,26,21,33,30,44,38,52,48,61,57,73].map((height, index) => <span className="flex-1 rounded-t-sm bg-lime-300/80" key={index} style={{ height: `${height / 2}px` }} />)}</div><p className="mt-3 font-mono text-[9px] text-slate-600">{adapterOnline ? "S04 · ADAPTER ONLINE" : "S04 · STATIC MODULE"}</p></div></div></aside>
    {mobileMenu && <button className="fixed inset-0 z-30 bg-black/75 lg:hidden" onClick={() => setMobileMenu(false)} aria-label="Chiudi menu" type="button" />}
    <section className="min-w-0 flex-1"><header className="sticky top-0 z-20 flex h-[72px] items-center gap-3 border-b border-white/[0.08] bg-[#050607]/88 px-4 backdrop-blur-xl sm:gap-5 sm:px-7"><IconButton label="Apri menu" onClick={() => setMobileMenu(true)} className="lg:hidden"><Menu className="size-4" /></IconButton><div className="relative hidden min-w-0 flex-1 md:block"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-600" /><Input aria-label="Cerca nelle Operations" className="h-10 max-w-[440px] border-white/10 bg-black/30 pl-10 text-xs text-slate-100 placeholder:text-slate-600 focus-visible:border-lime-300/40" onChange={(event) => setQuery(event.target.value)} placeholder="Cerca commesse, team, ubicazioni…" value={query} /></div><div className="flex min-w-0 flex-1 items-center gap-2 md:hidden"><span className="truncate text-xs font-semibold tracking-[0.14em] text-slate-200">OPERATIONS</span><span className="size-1 rounded-full bg-lime-300" /></div><div className="ml-auto flex items-center gap-2"><span className="hidden items-center gap-2 rounded-full border border-lime-300/20 bg-lime-300/5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-lime-200 sm:flex"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_9px_rgba(190,255,60,0.9)]" />Preview mode</span><IconButton label="Notifiche"><Bell className="size-4" /></IconButton><span className="hidden size-8 place-items-center rounded-full border border-white/15 bg-gradient-to-br from-slate-200 to-slate-500 text-xs font-bold text-[#080a0b] sm:grid">AB</span><div className="hidden text-right lg:block"><p className="text-xs font-medium text-slate-200">Operatore</p><p className="text-[10px] text-slate-600">Team Alpha</p></div><ChevronDown className="hidden size-3.5 text-slate-500 lg:block" /></div></header>
      <div className="mx-auto max-w-[1680px] px-4 py-5 sm:px-7 sm:py-7"><div className="mb-5 flex flex-wrap items-end justify-between gap-4"><div><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/70"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_9px_rgba(190,255,60,0.9)]" />AI-ZEROW / WORK / OPERATIONS</div><h1 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-50 sm:text-[28px]">Operations control</h1><p className="mt-1 text-xs text-slate-500">Commesse, pianificazione e attività · superficie statica allineata a COMMAND</p></div><div className="flex items-center gap-2"><span className="hidden items-center rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-[10px] text-slate-500 sm:inline-flex"><Clock3 className="mr-2 size-3.5 text-lime-300" />Aggiornato ora</span><Button className="h-9 border border-lime-300/30 bg-lime-300 px-3 text-xs font-semibold text-[#060806] shadow-[0_0_18px_rgba(190,255,60,0.16)] hover:bg-lime-200" onClick={() => setNewJobOpen(true)}><Plus className="size-3.5" />Nuova commessa</Button></div></div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="Commesse attive" value="24" detail="+12%" icon={BriefcaseBusiness} tone="lime" /><MetricCard label="In pianificazione" value="7" detail="2 urgenti" icon={CalendarClock} tone="cyan" /><MetricCard label="Attività oggi" value="68" detail="91% presidiate" icon={ClipboardCheck} tone="lime" /><MetricCard label="Rapportini aperti" value="4" detail="richiedono readback" icon={FileText} tone="amber" /></div>
        <div className="mt-4 grid gap-4 2xl:grid-cols-[minmax(0,1.15fr)_minmax(380px,0.85fr)]"><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><SectionTitle eyebrow="OPERATIONS / REGISTER" title="Registro commesse" /><p className="mt-1 text-[11px] text-slate-500">{adapterOnline ? "Readback D1 attivo · API Operations adapter online" : "Elenco statico di riferimento · API operations adapter non collegato"}</p></div><div className="flex items-center gap-2">{adapterOnline ? <StatusBadge tone="lime">ADAPTER ONLINE</StatusBadge> : <StatusBadge tone="cyan">ADAPTER REQUIRED</StatusBadge>}<IconButton label="Impostazioni registro" onClick={() => notify("Filtri avanzati disponibili con l'adapter Operations")}><Settings2 className="size-4" /></IconButton></div></div><div className="mt-4"><Tabs value={filter} onValueChange={(value) => setFilter(value as JobFilter)}><TabsList className="h-9 rounded-lg border border-white/10 bg-black/55 p-1"><TabsTrigger className="h-7 rounded-md px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]" value="TUTTE">Tutte</TabsTrigger><TabsTrigger className="h-7 rounded-md px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]" value="IN CORSO">In corso</TabsTrigger><TabsTrigger className="h-7 rounded-md px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]" value="PIANIFICATE">Pianificate</TabsTrigger><TabsTrigger className="h-7 rounded-md px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]" value="COMPLETATE">Completate</TabsTrigger></TabsList></Tabs></div><div className="mt-4 overflow-hidden rounded-xl border border-white/[0.08] bg-black/20"><div className="hidden grid-cols-[1.15fr_0.85fr_0.7fr_0.45fr] gap-3 border-b border-white/[0.08] px-4 py-3 text-[9px] font-semibold uppercase tracking-[0.15em] text-slate-600 md:grid"><span>Commessa</span><span>Squadra</span><span>Stato</span><span>Avanzamento</span></div><div className="divide-y divide-white/[0.07]">{filteredJobs.map((job) => { const active = selectedJob.id === job.id; return <button key={job.id} className={`grid w-full gap-3 px-4 py-3 text-left transition md:grid-cols-[1.15fr_0.85fr_0.7fr_0.45fr] md:items-center ${active ? "bg-lime-300/[0.07]" : "hover:bg-white/[0.035]"}`} onClick={() => setSelectedId(job.id)} type="button"><div className="flex min-w-0 items-center gap-3"><span className={`grid size-9 shrink-0 place-items-center rounded-xl border ${active ? "border-lime-300/35 bg-lime-300/10 text-lime-200" : "border-white/10 bg-black/30 text-slate-500"}`}><BriefcaseBusiness className="size-4" /></span><span className="min-w-0"><span className="flex items-center gap-2"><span className="font-mono text-[11px] text-lime-200">{job.id}</span><span className="truncate text-xs font-medium text-slate-200">{job.title}</span></span><span className="mt-1 block truncate text-[11px] text-slate-500">{job.location} · {job.category}</span></span></div><div className="flex items-center gap-2 pl-12 md:pl-0"><span className="size-1.5 rounded-full bg-lime-300" /><span className="text-xs text-slate-400">{job.team}</span></div><div className="pl-12 md:pl-0"><JobStatus status={job.status} /></div><div className="pl-12 md:pl-0"><div className="flex items-center gap-2"><div className="h-1.5 min-w-[54px] flex-1 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-lime-300 shadow-[0_0_10px_rgba(190,255,60,0.55)]" style={{ width: `${job.progress}%` }} /></div><span className="font-mono text-[10px] text-slate-400">{job.progress}%</span></div></div></button>; })}{filteredJobs.length === 0 && <div className="px-4 py-10 text-center text-xs text-slate-500">Nessuna commessa corrisponde ai filtri locali.</div>}</div></div></section>
          <section className="carbon-card carbon-card-neon rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><SectionTitle eyebrow="SELECTED JOB / READ MODEL" title={selectedJob.id} /><p className="mt-1 text-xs text-slate-500">{selectedJob.title} · {selectedJob.location}</p></div><button className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-lime-300 hover:text-lime-100" onClick={() => adapterOnline ? router.push(`/operations/${encodeURIComponent(selectedJob.sourceId ?? selectedJob.id)}`) : notify(`Dettaglio ${selectedJob.id}: disponibile dopo il readback D1`)} type="button">Apri workspace <ArrowUpRight className="size-3.5" /></button></div><div className="mt-5 flex flex-wrap items-center gap-2"><JobStatus status={selectedJob.status} /><StatusBadge tone={selectedJob.priority === "HIGH" ? "red" : selectedJob.priority === "STANDARD" ? "cyan" : "amber"}>{selectedJob.priority}</StatusBadge><span className="rounded-full border border-white/10 px-2 py-1 text-[10px] text-slate-500">{selectedJob.due}</span></div><div className="carbon-inset mt-5 rounded-xl p-4"><div className="flex items-end justify-between gap-3"><div><p className="text-[10px] uppercase tracking-[0.14em] text-slate-600">Avanzamento operativo</p><p className="mt-1 font-mono text-3xl font-semibold tracking-[-0.07em] text-slate-50">{selectedJob.progress}%</p></div><div className="text-right"><p className="text-[11px] text-slate-500">Responsabile</p><p className="mt-1 text-xs font-medium text-lime-200">{selectedJob.team}</p></div></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-lime-300 shadow-[0_0_16px_rgba(190,255,60,0.64)]" style={{ width: `${selectedJob.progress}%` }} /></div><div className="mt-2 flex justify-between text-[10px] text-slate-600"><span>Avvio</span><span>Chiusura e readback</span></div></div><div className="mt-5 space-y-3">{selectedJob.activities.map((activity) => <div className="flex items-center gap-3" key={activity.label}><ActivityState state={activity.state} /><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-slate-200">{activity.label}</p><p className="mt-1 truncate text-[11px] text-slate-500">{activity.detail}</p></div><span className="hidden text-[10px] text-slate-600 sm:block">{activity.owner}</span></div>)}</div><div className="mt-5 grid grid-cols-2 gap-2"><Button variant="outline" className="h-9 border-white/10 bg-black/20 text-xs text-slate-300 hover:border-lime-300/30 hover:bg-lime-300/10 hover:text-lime-100" onClick={() => setPlanningOpen(true)}><CalendarClock className="size-3.5" />Pianifica</Button><Button className="h-9 bg-lime-300 text-xs font-semibold text-[#060806] hover:bg-lime-200" onClick={() => notify("Rapportino mantenuto in preview · readback non eseguito")}><FileText className="size-3.5" />Rapportino</Button></div></section></div>
        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)_minmax(300px,0.75fr)]"><section className="carbon-card rounded-2xl p-4 sm:p-5"><SectionTitle eyebrow="ACTIVITY CONTRACT" title="Attività operative" action="Vedi catalogo" onAction={() => notify("Catalogo attività: route statica pronta, adapter non collegato")} /><div className="mt-4 space-y-3">{selectedJob.activities.concat([{ label: "Controllo evidenze", detail: "Disponibile dopo la chiusura", state: "queued" as const, owner: "Authority" }]).map((activity) => <div className="carbon-inset flex items-center gap-3 rounded-xl p-3" key={`contract-${activity.label}`}><ActivityState state={activity.state} /><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-slate-200">{activity.label}</p><p className="mt-1 truncate text-[11px] text-slate-500">{activity.detail}</p></div><ChevronRight className="size-4 text-slate-600" /></div>)}</div></section><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><SectionTitle eyebrow="PLANNING / RESOURCES" title="Risorse assegnate" /><StatusBadge tone="cyan">READ MODEL</StatusBadge></div><div className="mt-4 space-y-3">{[{ icon: Users, label: "Team Alpha", detail: "3 operatori · presidio attivo", tone: "lime" as Tone }, { icon: Truck, label: "A-021 · Escavatore CAT 320", detail: "Operativo · pronto in area", tone: "cyan" as Tone }, { icon: Wrench, label: "Kit manutenzione", detail: "Disponibilità da verificare", tone: "amber" as Tone }].map((resource) => { const ResourceIcon = resource.icon; return <div className="flex items-center gap-3" key={resource.label}><span className={`grid size-9 place-items-center rounded-xl border ${toneStyles[resource.tone].badge}`}><ResourceIcon className="size-4" /></span><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-slate-200">{resource.label}</p><p className="mt-1 truncate text-[11px] text-slate-500">{resource.detail}</p></div><button className="text-[10px] text-lime-300 hover:text-lime-100" onClick={() => setPlanningOpen(true)} type="button">Gestisci</button></div>; })}</div><div className="mt-5 border-t border-white/[0.08] pt-4"><div className="flex items-center justify-between text-[11px]"><span className="text-slate-500">Opzioni risorsa</span><span className="font-mono text-lime-200">3 / 5 verificabili</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full w-[60%] rounded-full bg-cyan-300 shadow-[0_0_12px_rgba(62,222,255,0.5)]" /></div></div></section><section className="carbon-card rounded-2xl p-4 sm:p-5"><SectionTitle eyebrow="DAILY REPORT" title="Rapportino giornaliero" /><div className="carbon-inset mt-4 rounded-xl p-4"><div className="flex items-start gap-3"><span className="grid size-9 place-items-center rounded-xl border border-amber-300/25 bg-amber-300/10 text-amber-200"><FileText className="size-4" /></span><div><p className="text-xs font-semibold text-slate-200">{selectedJob.id} · bozza locale</p><p className="mt-1 text-[11px] leading-5 text-slate-500">Il documento è pronto per essere composto, ma la scrittura e il readback richiedono l&apos;adapter operativo.</p></div></div><div className="mt-4 grid grid-cols-2 gap-2 text-center"><div className="rounded-lg border border-white/10 bg-black/25 px-2 py-2"><p className="font-mono text-lg text-slate-100">6.5h</p><p className="text-[10px] text-slate-600">presenza</p></div><div className="rounded-lg border border-white/10 bg-black/25 px-2 py-2"><p className="font-mono text-lg text-lime-200">68%</p><p className="text-[10px] text-slate-600">avanzamento</p></div></div></div><Button variant="outline" className="mt-4 h-9 w-full border-lime-300/25 bg-lime-300/5 text-xs text-lime-200 hover:bg-lime-300/10" onClick={() => notify("Composizione rapportino mantenuta in preview")}><ClipboardCheck className="size-3.5" />Prepara rapportino</Button></section></div>
        <section className="carbon-card mt-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl p-4 sm:p-5"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl border border-lime-300/25 bg-lime-300/10 text-lime-200"><ShieldCheck className="size-4" /></span><div><p className="text-sm font-semibold text-slate-100">{adapterOnline ? "Modulo Operations collegato al Sites adapter" : "Modulo Operations pronto per il prossimo adapter"}</p><p className="mt-1 text-[11px] text-slate-500">{adapterOnline ? "Commesse e readback sono collegati al D1 adapter; planning e rapportino restano bounded." : "Commesse, attività, planning, risorse e rapportino sono rappresentati senza simulare scritture su Neon."}</p></div></div><div className="flex items-center gap-2">{adapterOnline ? <StatusBadge>ADAPTER READ/WRITE READY</StatusBadge> : <StatusBadge>STATIC UI READY</StatusBadge>}<button className="grid size-8 place-items-center rounded-lg border border-white/10 text-slate-500 hover:border-lime-300/30 hover:text-lime-200" onClick={() => notify("Evidenze S04: superficie statica verificata")} type="button" aria-label="Apri evidenze"><ArrowUpRight className="size-3.5" /></button></div></section>
        <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] py-5 text-[10px] text-slate-600"><span>{adapterOnline ? "AI-ZEROW OPERATIONS · S04 adapter surface" : "AI-ZEROW OPERATIONS · S04 static surface"}</span><span className="flex items-center gap-2"><span>black carbon core</span><span className="size-1 rounded-full bg-lime-300" /><span>{adapterOnline ? "D1 adapter read/write" : "no backend write"}</span></span></footer>
      </div></section>
  </div>
  <Dialog open={newJobOpen} onOpenChange={setNewJobOpen}><DialogContent className="border-lime-300/20 bg-[#0a0d0e] text-slate-100 sm:max-w-[520px]"><DialogHeader><DialogTitle className="text-slate-100">Nuova commessa</DialogTitle><DialogDescription className="text-slate-500">Preview locale della composizione. La scrittura su /api/operations/jobs/create resta adapter-bound.</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={handleCreateJob}><div className="space-y-2"><label className="text-xs text-slate-400" htmlFor="job-title">Titolo</label><Input id="job-title" className="border-white/10 bg-black/30 text-slate-100" onChange={(event) => setJobTitle(event.target.value)} placeholder="Es. Manutenzione impianto" value={jobTitle} /></div><div className="space-y-2"><label className="text-xs text-slate-400" htmlFor="job-location">Ubicazione</label><Input id="job-location" className="border-white/10 bg-black/30 text-slate-100" onChange={(event) => setJobLocation(event.target.value)} placeholder="Es. Via Roma, Milano" value={jobLocation} /></div><div className="space-y-2"><label className="text-xs text-slate-400" htmlFor="job-notes">Nota operativa</label><Textarea id="job-notes" className="min-h-[90px] border-white/10 bg-black/30 text-slate-100" placeholder="Descrizione sintetica dell'intervento" /></div><DialogFooter><DialogClose asChild><Button type="button" variant="outline" className="border-white/10 bg-transparent text-slate-400">Annulla</Button></DialogClose><Button type="submit" className="bg-lime-300 text-[#060806] hover:bg-lime-200"><Send className="size-3.5" />Prepara bozza</Button></DialogFooter></form></DialogContent></Dialog>
  <Dialog open={planningOpen} onOpenChange={setPlanningOpen}><DialogContent className="border-cyan-300/20 bg-[#0a0d0e] text-slate-100 sm:max-w-[520px]"><DialogHeader><DialogTitle className="text-slate-100">Pianificazione risorse</DialogTitle><DialogDescription className="text-slate-500">Vista locale per {selectedJob.id}. La verifica delle opzioni risorsa sarà collegata a /api/operations/jobs/[jobId]/planning/resource-options.</DialogDescription></DialogHeader><div className="space-y-3"><div className="carbon-inset flex items-center gap-3 rounded-xl p-3"><Users className="size-4 text-lime-200" /><div><p className="text-xs font-medium text-slate-200">{selectedJob.team}</p><p className="text-[11px] text-slate-500">presidio operativo selezionato</p></div></div><div className="carbon-inset flex items-center gap-3 rounded-xl p-3"><Truck className="size-4 text-cyan-200" /><div><p className="text-xs font-medium text-slate-200">A-021 · Escavatore CAT 320</p><p className="text-[11px] text-slate-500">asset compatibile · read model locale</p></div></div><div className="flex items-start gap-2 rounded-xl border border-amber-300/20 bg-amber-300/5 p-3 text-[11px] leading-5 text-amber-100/80"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-200" />Nessuna modifica verrà salvata: il dominio, le autorizzazioni e il readback non sono ancora collegati.</div></div><DialogFooter><DialogClose asChild><Button className="bg-lime-300 text-[#060806] hover:bg-lime-200">Chiudi</Button></DialogClose></DialogFooter></DialogContent></Dialog>
  {toast && <div className="fixed bottom-5 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2 rounded-xl border border-lime-300/25 bg-[#0b1008]/95 px-4 py-3 text-xs text-lime-100 shadow-[0_0_30px_rgba(190,255,60,0.14)] backdrop-blur-xl"><CheckCircle2 className="size-4 text-lime-300" />{toast}</div>}
  </main>;
}
