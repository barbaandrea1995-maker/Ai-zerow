"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Bell,
  BriefcaseBusiness,
  CalendarClock,
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
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { invalidateReadback, readback } from "@/lib/client-readback";

const ServerNamingDialog = dynamic(() => import("@/components/server-naming-dialog").then((module) => module.ServerNamingDialog), { ssr: false });

type ModuleKey = "workforce" | "warehouse" | "mission" | "assets";
type Tone = "lime" | "cyan" | "amber" | "red";
type RegisterMode = "readmodel" | "adapter";

type Metric = {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  tone: Tone;
};

type RegisterRow = {
  id: string;
  canonicalCode?: string;
  title: string;
  detail: string;
  meta: string;
  status: string;
  tone: Tone;
  progress: number;
  icon: LucideIcon;
  mode: RegisterMode;
};

type AdapterRecord = {
  id: string;
  canonicalCode?: string;
  recordType: string;
  title: string;
  detail: string;
  meta: string;
  status: string;
  tone: string;
  progress: number;
  payload?: Record<string, unknown>;
};

type AdapterResponse = {
  records?: AdapterRecord[];
};

type ActivityRow = {
  label: string;
  detail: string;
  time: string;
  tone: Tone;
  icon: LucideIcon;
};

type ModuleConfig = {
  code: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  cta: string;
  registerTitle: string;
  registerHint: string;
  secondaryTitle: string;
  secondaryHint: string;
  metrics: Metric[];
  rows: RegisterRow[];
  activities: ActivityRow[];
  secondaryRows: { label: string; value: string; detail: string; tone: Tone }[];
  prompts: string[];
  assistantHint: string;
};

const toneStyles: Record<Tone, { icon: string; badge: string; line: string; dot: string }> = {
  lime: {
    icon: "text-lime-200",
    badge: "border-lime-300/25 bg-lime-300/10 text-lime-200",
    line: "bg-lime-300",
    dot: "bg-lime-300",
  },
  cyan: {
    icon: "text-cyan-200",
    badge: "border-cyan-300/25 bg-cyan-300/10 text-cyan-200",
    line: "bg-cyan-300",
    dot: "bg-cyan-300",
  },
  amber: {
    icon: "text-amber-200",
    badge: "border-amber-300/25 bg-amber-300/10 text-amber-200",
    line: "bg-amber-300",
    dot: "bg-amber-300",
  },
  red: {
    icon: "text-rose-200",
    badge: "border-rose-300/25 bg-rose-300/10 text-rose-200",
    line: "bg-rose-300",
    dot: "bg-rose-300",
  },
};

const moduleConfigs: Record<ModuleKey, ModuleConfig> = {
  workforce: {
    code: "WORKFORCE",
    eyebrow: "AI-ZEROW / WORK / WORKFORCE",
    title: "Workforce control",
    subtitle: "Presenze, turni e qualifiche · readback D1 tenant-scoped",
    cta: "Nuovo turno",
    registerTitle: "Registro workforce",
    registerHint: "People, turni e qualifiche · Sites adapter / readback",
    secondaryTitle: "Presidio operativo",
    secondaryHint: "Copertura restituita dal readback D1",
    metrics: [
      { label: "Operatori attivi", value: "0", detail: "Nessun dato", icon: Users, tone: "lime" },
      { label: "Turni oggi", value: "0", detail: "Nessun dato", icon: CalendarClock, tone: "cyan" },
      { label: "Qualifiche valide", value: "0", detail: "Nessun dato", icon: ShieldCheck, tone: "lime" },
      { label: "Presidi operativi", value: "0", detail: "Nessun dato", icon: HardHat, tone: "amber" },
    ],
    rows: [],
    activities: [],
    secondaryRows: [],
    prompts: ["Chi è disponibile ora?", "Mostra turni scoperti", "Qualifiche in scadenza"],
    assistantHint: "Risposte workforce disponibili quando l’adapter restituisce presenze e qualifiche.",
  },
  warehouse: {
    code: "WAREHOUSE",
    eyebrow: "AI-ZEROW / SUPPLY / WAREHOUSE",
    title: "Warehouse control",
    subtitle: "Scorte, richieste e riconciliazione · readback D1 tenant-scoped",
    cta: "Nuova richiesta",
    registerTitle: "Registro materiali",
    registerHint: "Inventory, richieste e soglie · Sites adapter / readback",
    secondaryTitle: "Stato scorte",
    secondaryHint: "Disponibilità restituita dal readback D1",
    metrics: [
      { label: "Scorte attive", value: "0", detail: "Nessun dato", icon: Package, tone: "lime" },
      { label: "Richieste aperte", value: "0", detail: "Nessun dato", icon: ClipboardCheck, tone: "cyan" },
      { label: "Sotto soglia", value: "0", detail: "Nessun dato", icon: AlertTriangle, tone: "amber" },
      { label: "Scan oggi", value: "0", detail: "Nessun dato", icon: CircleGauge, tone: "lime" },
    ],
    rows: [],
    activities: [],
    secondaryRows: [],
    prompts: ["Quali scorte sono critiche?", "Mostra richieste urgenti", "Riconcilia ultimo scan"],
    assistantHint: "Le azioni di scan, QR e riconciliazione restano in attesa del warehouse adapter.",
  },
  mission: {
    code: "MISSION",
    eyebrow: "AI-ZEROW / FIELD / MISSION",
    title: "Mission control",
    subtitle: "Carichi, assegnazioni ed evidenze · readback D1 tenant-scoped",
    cta: "Nuova missione",
    registerTitle: "Registro missioni",
    registerHint: "Trasporti, carichi ed evidenze · Sites adapter / readback",
    secondaryTitle: "Flotta in movimento",
    secondaryHint: "Assegnazioni restituite dal readback D1",
    metrics: [
      { label: "Missioni attive", value: "0", detail: "Nessun dato", icon: Truck, tone: "lime" },
      { label: "Carichi assegnati", value: "0", detail: "Nessun dato", icon: Package, tone: "cyan" },
      { label: "Evidenze", value: "0", detail: "Nessun dato", icon: FileText, tone: "lime" },
      { label: "Riconciliazioni", value: "0", detail: "Nessun dato", icon: AlertTriangle, tone: "amber" },
    ],
    rows: [],
    activities: [],
    secondaryRows: [],
    prompts: ["Quali missioni sono in ritardo?", "Mostra prossime partenze", "Analizza evidenze mancanti"],
    assistantHint: "Pianificazione, prove e riconciliazione diventano operative con il mission adapter.",
  },
  assets: {
    code: "ASSETS",
    eyebrow: "AI-ZEROW / OPERATIONS / ASSETS",
    title: "Assets control",
    subtitle: "Flotta, manutenzione e capacità · readback D1 tenant-scoped",
    cta: "Nuovo asset",
    registerTitle: "Registro asset",
    registerHint: "Asset, capacità e manutenzione · Sites adapter / readback",
    secondaryTitle: "Capacità flotta",
    secondaryHint: "Disponibilità restituita dal readback D1",
    metrics: [
      { label: "Asset operativi", value: "0", detail: "Nessun dato", icon: Package, tone: "lime" },
      { label: "In manutenzione", value: "0", detail: "Nessun dato", icon: Wrench, tone: "amber" },
      { label: "Capacità attive", value: "0", detail: "Nessun dato", icon: Gauge, tone: "cyan" },
      { label: "Asset assegnati", value: "0", detail: "Nessun dato", icon: BriefcaseBusiness, tone: "lime" },
    ],
    rows: [],
    activities: [],
    secondaryRows: [],
    prompts: ["Quali asset sono disponibili?", "Mostra manutenzioni urgenti", "Trova asset vicino a me"],
    assistantHint: "Telemetria, geolocalizzazione e assegnazioni operative richiedono l’assets adapter.",
  },
};

const navItems: { label: string; id: string; icon: LucideIcon }[] = [
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

const routes: Record<string, string> = {
  command: "/command",
  operations: "/operations",
  workforce: "/workforce",
  assets: "/assets",
  warehouse: "/warehouse",
  mission: "/mission",
  finance: "/finance",
  documents: "/documents",
  qr: "/qr",
  governance: "/governance",
  events_authority: "/events",
  pwa: "/pwa/diagnostics",
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

function MetricCard({ metric }: { metric: Metric }) {
  const style = toneStyles[metric.tone];
  const Icon = metric.icon;
  return <article className="carbon-card rounded-2xl p-4"><div className="flex items-start justify-between gap-3"><span className={`grid size-9 place-items-center rounded-xl border border-current/20 bg-current/10 ${style.icon}`}><Icon className="size-[18px]" /></span><StatusBadge tone={metric.tone}>{metric.detail}</StatusBadge></div><p className="mt-4 text-xs text-slate-500">{metric.label}</p><p className="mt-1 font-mono text-[29px] font-semibold leading-none tracking-[-0.06em] text-slate-50">{metric.value}</p><p className="mt-4 text-[10px] text-slate-600">Nessun dato nel readback</p></article>;
}

function rowsFromAdapter(records: AdapterRecord[], fallback: RegisterRow[]): RegisterRow[] {
  return records.map((record) => {
    const local = fallback.find((row) => row.id === record.id);
    const tone: Tone = record.tone === "cyan" || record.tone === "amber" || record.tone === "red" ? record.tone : local?.tone ?? "lime";
    return {
      id: record.id,
      canonicalCode: record.canonicalCode,
      title: record.title,
      detail: record.detail,
      meta: record.meta,
      status: record.status,
      tone,
      progress: Math.max(0, Math.min(100, Number(record.progress) || 0)),
      icon: local?.icon ?? Package,
      mode: record.recordType === "adapter-contract" ? "adapter" : "readmodel",
    };
  });
}

const emptyRegisterRow: RegisterRow = {
  id: "EMPTY",
  title: "Nessun elemento",
  detail: "Il readback D1 non contiene dati per questo modulo.",
  meta: "—",
  status: "EMPTY",
  tone: "amber",
  progress: 0,
  icon: Package,
  mode: "readmodel",
};

function S04ModulePage({ module }: { module: ModuleKey }) {
  const router = useRouter();
  const config = moduleConfigs[module];
  const [mobileMenu, setMobileMenu] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"ALL" | "ACTIVE" | "ADAPTER">("ALL");
  const [selectedId, setSelectedId] = useState("");
  const [toast, setToast] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [adapterRows, setAdapterRows] = useState<RegisterRow[] | null>(null);
  const [adapterStatus, setAdapterStatus] = useState<"loading" | "online" | "empty" | "error">("loading");
  const rows = useMemo(() => adapterRows ?? config.rows, [adapterRows, config.rows]);
  const selected = rows.find((row) => row.id === selectedId) ?? emptyRegisterRow;
  const adapterOnline = adapterStatus === "online";

  useEffect(() => {
    let active = true;
    readback<AdapterResponse>(`s04:${module}`, `/api/${module}`)
      .then((body) => {
        if (!active) return;
        const records = Array.isArray(body.records) ? body.records : [];
        setAdapterRows(records.length ? rowsFromAdapter(records, config.rows) : []);
        setAdapterStatus(records.length ? "online" : "empty");
      })
      .catch(() => {
        if (!active) return;
        setAdapterRows([]);
        setAdapterStatus("error");
      });
    return () => {
      active = false;
    };
  }, [module, config.rows, refreshKey]);

  const filteredRows = useMemo(() => rows.filter((row) => {
    const haystack = `${row.id} ${row.title} ${row.detail} ${row.meta} ${row.status}`.toLowerCase();
    const matchesQuery = haystack.includes(query.trim().toLowerCase());
    const matchesFilter = filter === "ALL" || (filter === "ACTIVE" && row.mode === "readmodel") || (filter === "ADAPTER" && row.mode === "adapter");
    return matchesQuery && matchesFilter;
  }), [rows, filter, query]);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  };

  const navigate = (id: string, label: string) => {
    setMobileMenu(false);
    if (routes[id]) {
      router.push(routes[id]);
      return;
    }
    notify(`${label}: superficie prevista nel prossimo adapter`);
  };

  const openCreate = () => {
    if (module === "assets" || module === "warehouse") {
      setCreateOpen(true);
      return;
    }
    notify(`${config.cta}: azione pronta per l'adapter ${config.code}`);
  };

  return <main className="min-h-screen overflow-x-hidden bg-[#050607] text-slate-100 selection:bg-lime-300 selection:text-[#060806]"><div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_74%_0%,rgba(190,255,60,0.07),transparent_25%),radial-gradient(circle_at_18%_78%,rgba(70,110,120,0.08),transparent_27%)]" /><div className="relative flex min-h-screen">
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-[232px] flex-col border-r border-lime-300/10 bg-[#050607]/96 px-3 py-4 backdrop-blur-xl transition-transform lg:static lg:translate-x-0 ${mobileMenu ? "translate-x-0" : "-translate-x-full"}`}>
      <div className="flex items-center justify-between px-2"><button className="flex items-center gap-3 text-left" onClick={() => { setMobileMenu(false); router.push("/"); }} type="button"><span className="neon-pulse relative grid size-10 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black"><img src="/ai-zerow-icon.jpeg" alt="AI-ZEROW" className="size-full object-cover" /></span><span><span className="block text-sm font-bold tracking-[0.18em] text-slate-50">AI-ZEROW</span><span className="block text-[10px] uppercase tracking-[0.22em] text-lime-300/75">command</span></span></button><button className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-white/5 hover:text-white lg:hidden" onClick={() => setMobileMenu(false)} type="button" aria-label="Chiudi menu"><X className="size-4" /></button></div>
      <button className="carbon-card mt-8 flex w-full items-center gap-3 rounded-xl p-3 text-left transition hover:border-lime-300/25" type="button" onClick={() => notify("Workspace ZEROW · contesto owner Sites")}><span className="grid size-8 place-items-center rounded-lg border border-lime-300/20 bg-lime-300/10 text-lime-200"><HardHat className="size-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-slate-200">ZEROW workspace</span><span className="mt-0.5 block truncate text-[10px] text-slate-600">owner · Sites tenant context</span></span><ChevronRight className="size-3.5 text-slate-600" /></button>
      <nav className="mt-7 flex-1" aria-label="Navigazione principale"><p className="px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-600">Workspace</p><div className="mt-2 space-y-1">{navItems.map((item) => { const Icon = item.icon; const active = item.id === module; return <button aria-current={active ? "page" : undefined} className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${active ? "border border-lime-300/20 bg-lime-300/10 text-lime-200 shadow-[inset_0_0_20px_rgba(190,255,60,0.04)]" : "text-slate-500 hover:bg-white/[0.045] hover:text-slate-100"}`} key={item.id} onClick={() => navigate(item.id, item.label)} type="button"><Icon className={`size-4 ${active ? "text-lime-200" : "text-slate-600 group-hover:text-slate-300"}`} /><span>{item.label}</span>{item.id === "command" && <span className="ml-auto rounded border border-white/10 px-1.5 py-0.5 font-mono text-[8px] tracking-[0.08em] text-slate-600">AI</span>}</button>; })}</div></nav>
      <div className="mt-5 border-t border-white/[0.08] pt-4"><div className="flex items-center justify-between px-2 text-[10px] uppercase tracking-[0.14em] text-slate-600"><span>System status</span><span className="flex items-center gap-1.5 text-lime-200"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_8px_rgba(190,255,60,0.8)]" />online</span></div><div className="carbon-inset mt-3 rounded-xl p-3"><div className="flex items-center gap-2 text-[10px] text-slate-400"><Activity className="size-3.5 text-lime-300" />{config.code.toLowerCase()} core</div><p className="mt-3 font-mono text-[9px] text-slate-600">{adapterOnline ? "S04 · D1 ADAPTER ONLINE" : "S04 · D1 READBACK EMPTY"}</p></div></div>
    </aside>
    {mobileMenu && <button className="fixed inset-0 z-30 bg-black/75 lg:hidden" onClick={() => setMobileMenu(false)} aria-label="Chiudi menu" type="button" />}
    <section className="min-w-0 flex-1"><header className="sticky top-0 z-20 flex h-[72px] items-center gap-3 border-b border-white/[0.08] bg-[#050607]/88 px-4 backdrop-blur-xl sm:gap-5 sm:px-7"><IconButton label="Apri menu" onClick={() => setMobileMenu(true)} className="lg:hidden"><Menu className="size-4" /></IconButton><div className="relative hidden min-w-0 flex-1 md:block"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-600" /><Input aria-label={`Cerca in ${config.code}`} className="h-10 max-w-[440px] border-white/10 bg-black/30 pl-10 text-xs text-slate-100 placeholder:text-slate-600 focus-visible:border-lime-300/40" onChange={(event) => setQuery(event.target.value)} placeholder={`Cerca in ${config.code.toLowerCase()}…`} value={query} /></div><div className="flex min-w-0 flex-1 items-center gap-2 md:hidden"><span className="truncate text-xs font-semibold tracking-[0.14em] text-slate-200">{config.code}</span><span className="size-1 rounded-full bg-lime-300" /></div><div className="ml-auto flex items-center gap-2"><span className="hidden items-center gap-2 rounded-full border border-lime-300/20 bg-lime-300/5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-lime-200 sm:flex"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_9px_rgba(190,255,60,0.9)]" />D1 readback</span><IconButton label="Notifiche" onClick={() => notify(`${config.code}: nessuna notifica runtime collegata`)}><Bell className="size-4" /></IconButton><span className="hidden size-8 place-items-center rounded-full border border-white/15 bg-gradient-to-br from-slate-200 to-slate-500 text-xs font-bold text-[#080a0b] sm:grid">AB</span><div className="hidden text-right lg:block"><p className="text-xs font-medium text-slate-200">Owner</p><p className="text-[10px] text-slate-600">Tenant EMS</p></div><ChevronDown className="hidden size-3.5 text-slate-500 lg:block" /></div></header>
      <div className="mx-auto max-w-[1680px] px-4 py-5 sm:px-7 sm:py-7"><div className="mb-5 flex flex-wrap items-end justify-between gap-4"><div><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/70"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_9px_rgba(190,255,60,0.9)]" />{config.eyebrow}</div><h1 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-50 sm:text-[28px]">{config.title}</h1><p className="mt-1 text-xs text-slate-500">{config.subtitle}</p></div><div className="flex items-center gap-2"><span className="hidden items-center rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-[10px] text-slate-500 sm:inline-flex"><Clock3 className="mr-2 size-3.5 text-lime-300" />{adapterOnline ? "Readback D1 verificato" : "Readback D1 vuoto"}</span><Button className="h-9 border border-lime-300/30 bg-lime-300 px-3 text-xs font-semibold text-[#060806] shadow-[0_0_18px_rgba(190,255,60,0.16)] hover:bg-lime-200" onClick={openCreate}><Plus className="size-3.5" />{config.cta}</Button></div></div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{config.metrics.map((metric) => <MetricCard key={metric.label} metric={metric} />)}</div>
        <div className="mt-4 grid gap-4 2xl:grid-cols-[minmax(0,1.18fr)_minmax(360px,0.82fr)]"><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><SectionTitle eyebrow={`${config.code} / REGISTER`} title={config.registerTitle} /><p className="mt-1 text-[11px] text-slate-500">{config.registerHint}</p></div><div className="flex items-center gap-2">{adapterOnline ? <StatusBadge tone="lime">ADAPTER ONLINE</StatusBadge> : <StatusBadge tone="cyan">ADAPTER REQUIRED</StatusBadge>}<IconButton label="Impostazioni registro" onClick={() => notify(`${config.code}: filtri avanzati disponibili con l'adapter`)}><Settings2 className="size-4" /></IconButton></div></div><div className="mt-4"><Tabs value={filter} onValueChange={(value) => setFilter(value as "ALL" | "ACTIVE" | "ADAPTER")}><TabsList className="h-9 rounded-lg border border-white/10 bg-black/55 p-1"><TabsTrigger className="h-7 rounded-md px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]" value="ALL">Tutti</TabsTrigger><TabsTrigger className="h-7 rounded-md px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]" value="ACTIVE">Read model</TabsTrigger><TabsTrigger className="h-7 rounded-md px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]" value="ADAPTER">Adapter</TabsTrigger></TabsList></Tabs></div><div className="mt-4 overflow-hidden rounded-xl border border-white/[0.08] bg-black/20"><div className="hidden grid-cols-[1.25fr_0.8fr_0.65fr_0.55fr] gap-3 border-b border-white/[0.08] px-4 py-3 text-[9px] font-semibold uppercase tracking-[0.15em] text-slate-600 md:grid"><span>Elemento</span><span>Stato</span><span>Avanzamento</span><span>Riferimento</span></div>{filteredRows.length === 0 && <div className="px-4 py-10 text-center text-xs text-slate-600">Nessun elemento nel filtro corrente.</div>}{filteredRows.map((row) => { const Icon = row.icon; const style = toneStyles[row.tone]; const active = selected.id === row.id; return <button className={`grid w-full gap-3 border-b border-white/[0.06] px-4 py-3 text-left transition last:border-b-0 md:grid-cols-[1.25fr_0.8fr_0.65fr_0.55fr] md:items-center ${active ? "bg-lime-300/[0.055]" : "hover:bg-white/[0.035]"}`} key={row.id} onClick={() => setSelectedId(row.id)} type="button"><span className="flex min-w-0 items-center gap-3"><span className={`grid size-8 shrink-0 place-items-center rounded-lg border border-white/10 bg-black/30 ${style.icon}`}><Icon className="size-4" /></span><span className="min-w-0"><span className="block truncate text-[12px] font-semibold text-slate-200">{row.canonicalCode ?? row.title}</span><span className="mt-0.5 block truncate text-[10px] text-slate-600">{row.canonicalCode && row.title !== row.canonicalCode ? `${row.title} · ` : ""}{row.detail}</span></span></span><span className="flex items-center gap-2 md:block"><StatusBadge tone={row.tone}>{row.status}</StatusBadge><span className="mt-1 block text-[10px] text-slate-600 md:hidden">{row.meta}</span></span><span className="hidden md:block"><span className="flex items-center gap-2"><span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10"><span className={`block h-full rounded-full ${style.line}`} style={{ width: `${row.progress}%` }} /></span><span className="font-mono text-[10px] text-slate-500">{row.progress}%</span></span></span><span className="hidden text-[10px] text-slate-500 md:block">{row.meta}</span></button>; })}</div><div className="mt-4 flex items-center justify-between gap-3 text-[10px] text-slate-600"><span className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-cyan-300" />{adapterOnline ? "Readback D1 verificato" : "Visualizzazione dichiaratamente statica"}</span><button className="flex items-center gap-1.5 text-lime-300 transition hover:text-lime-100" onClick={() => notify(`${config.code}: readback D1 ${adapterOnline ? "verificato" : "non ancora eseguito"}`)} type="button">Verifica readback <ArrowUpRight className="size-3.5" /></button></div></section>
          <section className="carbon-card-neon rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><SectionTitle eyebrow={`${config.code} / SELECTED`} title={selected.canonicalCode ?? selected.title} /><p className="mt-1 text-[11px] text-slate-500">{selected.id} · dettaglio del read model</p></div><StatusBadge tone={selected.tone}>{selected.status}</StatusBadge></div><div className="carbon-inset mt-5 rounded-xl p-4"><div className="flex items-center justify-between gap-3"><span className="text-[10px] uppercase tracking-[0.16em] text-slate-600">Progress state</span><span className="font-mono text-sm text-lime-200">{selected.progress}%</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-black/60"><span className={`block h-full rounded-full ${toneStyles[selected.tone].line}`} style={{ width: `${selected.progress}%` }} /></div><div className="mt-3 flex items-center justify-between text-[10px] text-slate-500"><span>{selected.detail}</span><span>{selected.meta}</span></div></div><div className="mt-4 grid gap-2 sm:grid-cols-2"><div className="rounded-xl border border-white/10 bg-black/20 p-3"><p className="text-[9px] uppercase tracking-[0.14em] text-slate-600">Source state</p><p className="mt-2 text-xs text-slate-200">{selected.mode === "adapter" ? "Adapter gate" : "Read model"}</p></div><div className="rounded-xl border border-white/10 bg-black/20 p-3"><p className="text-[9px] uppercase tracking-[0.14em] text-slate-600">Readback</p><p className="mt-2 text-xs text-amber-200">{adapterOnline ? "VERIFIED" : "NOT RUN"}</p></div></div><div className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/[0.06] p-3"><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-200"><AlertTriangle className="size-3.5" />Domain adapter required</div><p className="mt-2 text-[11px] leading-5 text-slate-500">Questa scheda espone il contratto visivo S04. Nessuna mutazione di dominio viene simulata.</p></div><Button variant="outline" className="mt-4 h-9 w-full border-white/10 bg-black/25 text-xs text-slate-300 hover:border-lime-300/30 hover:bg-lime-300/10 hover:text-lime-100" onClick={() => notify(`${config.code}: dettaglio operativo disponibile dopo il collegamento dell'adapter`)}><ArrowUpRight className="size-3.5" />Apri dettaglio adapter</Button></section></div>
        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.9fr)_minmax(300px,0.72fr)]"><section className="carbon-card rounded-2xl p-4 sm:p-5"><SectionTitle eyebrow={`${config.code} / ACTIVITY`} title="Attività recenti" action="Vedi tutte" onAction={() => notify(`${config.code}: elenco completo disponibile con readback`)} /><div className="mt-4 divide-y divide-white/[0.07]">{config.activities.length ? config.activities.map((activity) => { const Icon = activity.icon; const style = toneStyles[activity.tone]; return <div className="flex items-center gap-3 py-3 first:pt-0 last:pb-0" key={activity.label}><span className={`grid size-8 shrink-0 place-items-center rounded-lg border border-white/10 bg-black/25 ${style.icon}`}><Icon className="size-4" /></span><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-slate-200">{activity.label}</p><p className="mt-0.5 truncate text-[10px] text-slate-600">{activity.detail}</p></div><span className="shrink-0 text-[10px] text-slate-600">{activity.time}</span></div>; }) : <div className="py-6 text-center text-xs text-slate-500">Nessuna attività nel readback D1.</div>}</div></section><section className="carbon-card rounded-2xl p-4 sm:p-5"><SectionTitle eyebrow={`${config.code} / COVERAGE`} title={config.secondaryTitle} action="Analizza" onAction={() => notify(`${config.code}: analisi disponibile dopo il readback D1`)} /><p className="mt-1 text-[11px] text-slate-500">{config.secondaryHint}</p><div className="mt-5 space-y-4">{config.secondaryRows.length ? config.secondaryRows.map((row) => <div key={row.label}><div className="flex items-center justify-between gap-3"><span className="text-xs text-slate-300">{row.label}</span><span className="font-mono text-xs text-slate-200">{row.value}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10"><span className={`block h-full rounded-full ${toneStyles[row.tone].line}`} style={{ width: `${row.value.includes("%") ? row.value : Math.min(Number(row.value) * 4, 100)}%` }} /></div><p className="mt-1 text-[10px] text-slate-600">{row.detail}</p></div>) : <div className="py-6 text-center text-xs text-slate-500">Nessuna copertura nel readback D1.</div>}</div></section><section className="carbon-card rounded-2xl p-4 sm:p-5"><SectionTitle eyebrow="S04 / SIGNAL" title="Operational signal" /><div className="carbon-inset mt-5 grid min-h-[142px] place-items-center rounded-xl border border-dashed border-white/10 text-center"><p className="text-xs text-slate-500">Nessun segnale nel readback D1.</p></div><div className="mt-4 grid grid-cols-2 gap-2"><div className="carbon-inset rounded-lg p-3"><p className="text-[10px] text-slate-600">Presidio</p><p className="mt-1 font-mono text-lg text-slate-600">—</p></div><div className="carbon-inset rounded-lg p-3"><p className="text-[10px] text-slate-600">Readback</p><p className="mt-1 font-mono text-lg text-amber-200">{adapterOnline ? "OK" : "N/R"}</p></div></div><div className="mt-4 flex items-center gap-2 text-[10px] text-slate-600"><span className="size-1.5 rounded-full bg-cyan-300" />{adapterOnline ? "Signal letto dal Sites D1 adapter" : "Nessun segnale operativo"}</div></section></div>
        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.12fr)_minmax(360px,0.88fr)]"><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><SectionTitle eyebrow="S04 / CONTRACT" title="Domain boundary" /><p className="mt-1 text-[11px] text-slate-500">{adapterOnline ? "Readback D1 attivo · adapter canonico esterno ancora esplicito" : "Surface pronta · autorità server ancora esterna al modulo statico"}</p></div>{adapterOnline ? <StatusBadge tone="lime">READBACK VERIFIED</StatusBadge> : <StatusBadge tone="amber">READBACK NOT RUN</StatusBadge>}</div><div className="mt-4 grid gap-2 sm:grid-cols-3"><div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[0.14em] text-slate-600">Native Sites</p><p className="mt-2 text-xs text-lime-200">COMPOSITION READY</p></div><div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[0.14em] text-slate-600">API {config.code}</p><p className="mt-2 text-xs text-amber-200">{adapterOnline ? "D1 ADAPTER ONLINE" : "ADAPTER REQUIRED"}</p></div><div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[0.14em] text-slate-600">State machine</p><p className="mt-2 text-xs text-amber-200">UNKNOWN</p></div></div><div className="mt-4 flex flex-wrap items-center gap-2"><StatusBadge tone="lime">SITES ONLY</StatusBadge><StatusBadge tone="cyan">{adapterOnline ? "D1 READ MODEL" : "STATIC READ MODEL"}</StatusBadge><button className="ml-auto flex items-center gap-1.5 text-[10px] text-lime-300 transition hover:text-lime-100" onClick={() => notify(`${config.code}: gate canonico ancora aperto`)} type="button">Apri contratto S04 <ArrowUpRight className="size-3.5" /></button></div></section><section className="carbon-card-neon rounded-2xl p-4 sm:p-5"><div className="flex items-start gap-3"><span className="grid size-9 place-items-center rounded-xl border border-lime-300/25 bg-lime-300/10 text-lime-200"><MessageSquareText className="size-[18px]" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/70">AI ASSISTANT / {config.code}</p><h2 className="mt-1 text-sm font-semibold text-slate-100">Read model assistant</h2></div><StatusBadge tone="cyan">PREVIEW</StatusBadge></div><p className="mt-3 text-[11px] leading-5 text-slate-500">{config.assistantHint}</p><div className="mt-4 flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2.5"><Search className="size-3.5 text-slate-600" /><span className="text-[11px] text-slate-600">Chiedi a AI-ZEROW…</span><IconButton label="Invia richiesta" className="ml-auto size-8" onClick={() => notify(`${config.code}: assistente in sola lettura finché l'adapter non è collegato`)}><Send className="size-3.5" /></IconButton></div><div className="mt-3 space-y-2">{config.prompts.map((prompt) => <button className="flex w-full items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-left text-[11px] text-slate-400 transition hover:border-lime-300/30 hover:bg-lime-300/5 hover:text-lime-200" key={prompt} onClick={() => notify(`${config.code}: prompt pronto per il readback adapter`)} type="button"><span className="grid size-5 place-items-center rounded-md border border-white/10 text-slate-600"><ChevronRight className="size-3" /></span>{prompt}</button>)}</div></section></div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.08] pt-4 text-[10px] text-slate-600"><span>AI-ZEROW COMMAND · {config.code} · S04 / D1 READBACK</span><span className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_8px_rgba(190,255,60,0.8)]" />Sites private · owner only · no domain mutation</span></div>
      </div>
    </section>
  </div>{(module === "assets" || module === "warehouse") && createOpen && <ServerNamingDialog module={module} open={createOpen} onOpenChange={setCreateOpen} onCreated={() => { invalidateReadback(`s04:${module}`); setRefreshKey((value) => value + 1); }} onNotice={notify} />}{toast && <div className="fixed bottom-5 right-5 z-50 max-w-[360px] rounded-xl border border-lime-300/25 bg-[#0a100c]/95 px-4 py-3 text-xs text-lime-100 shadow-[0_0_28px_rgba(190,255,60,0.14)] backdrop-blur-xl">{toast}</div>}</main>;
}

export default S04ModulePage;
