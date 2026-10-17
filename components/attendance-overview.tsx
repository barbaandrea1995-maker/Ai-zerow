"use client";

import Image from "next/image";
import Link from "@/components/app-link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowUpRight,
  Bell,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  FileCheck2,
  HardHat,
  Layers3,
  LoaderCircle,
  MapPin,
  Menu,
  MessageSquareText,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Truck,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { AccountMenu } from "@/components/account-menu";
import { CommandMobileNav } from "@/components/command-mobile-nav";
import { OperationalAttendanceDeck } from "@/components/operational-attendance-deck";
import { TenantSwitcher } from "@/components/tenant-switcher";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getAllowedCommandNavigation, type CommandNavigationId } from "@/lib/command-dashboard";
import type { AttendanceTarget } from "@/lib/attendance-scope";

type Tone = "lime" | "cyan" | "amber" | "red" | "muted";

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
  // Contract marker: Timestamp server remains the authoritative central readback.
  context?: {
    actorName: string;
    actorEmail: string;
    role: string;
    roles?: string[];
    capabilities: string[];
  };
  targets?: AttendanceTarget[];
  serviceMode?: "FIELD" | "DRIVER" | "WAREHOUSE" | "SUPERVISOR";
  warehouseScope?: { mode: "ALL" | "ASSIGNED" | "NONE"; warehouseIds: string[] };
  records?: AttendanceRecord[];
  summary?: {
    total?: number;
    checkedIn?: number;
    paused?: number;
    checkedOut?: number;
    geofenceInside?: number;
    geofenceOutside?: number;
    geofenceUncertain?: number;
    gpsObserved?: number;
    noLocation?: number;
  };
  contract?: { tracking?: string; timestamp?: string };
  readback?: { status?: string; scope?: string; checkedAt?: string };
};

type NavItem = {
  id: CommandNavigationId;
  label: string;
  path: string;
  capability: string;
  icon: LucideIcon;
};

const navItems: NavItem[] = [
  { id: "command", label: "CONTROL", path: "/command", capability: "command.read", icon: MessageSquareText },
  { id: "operations", label: "OPERATIONS", path: "/operations", capability: "operations.read", icon: BriefcaseBusiness },
  { id: "workforce", label: "WORKFORCE", path: "/workforce", capability: "workforce.read", icon: Users },
  { id: "planning", label: "PIANIFICAZIONE", path: "/planning", capability: "planning.read", icon: CalendarClock },
  { id: "attendance", label: "PRESENZE", path: "/presenze", capability: "workforce.read", icon: Clock3 },
  { id: "assets", label: "ASSET", path: "/assets", capability: "asset.read", icon: Package },
  { id: "warehouse", label: "MAGAZZINO", path: "/warehouse", capability: "warehouse.read", icon: Layers3 },
  { id: "mission", label: "MISSIONI", path: "/mission", capability: "mission.read", icon: Truck },
  { id: "documents", label: "DOCUMENTI", path: "/documents", capability: "documents.read", icon: FileCheck2 },
  { id: "authority", label: "AUTHORITY", path: "/onboarding", capability: "authority.read", icon: ShieldCheck },
  { id: "events", label: "EVENTI", path: "/events", capability: "events.read", icon: Activity },
  { id: "settings", label: "IMPOSTAZIONI", path: "/settings", capability: "settings.read", icon: SlidersHorizontal },
];

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Amministratore",
  manager: "Manager",
  office: "Ufficio",
  technical: "Tecnico",
  field_supervisor: "Caposquadra",
  worker: "Operatore",
  warehouse_manager: "Responsabile magazzino",
  warehouse_operator: "Magazziniere",
  driver: "Autista",
  delivery_driver: "Autista di consegna",
  maintenance: "Manutentore",
  auditor: "Auditor",
};

const toneStyles: Record<Tone, { icon: string; badge: string }> = {
  lime: { icon: "text-lime-200", badge: "border-lime-300/25 bg-lime-300/10 text-lime-100" },
  cyan: { icon: "text-cyan-200", badge: "border-cyan-300/25 bg-cyan-300/10 text-cyan-100" },
  amber: { icon: "text-amber-200", badge: "border-amber-300/25 bg-amber-300/10 text-amber-100" },
  red: { icon: "text-rose-200", badge: "border-rose-300/25 bg-rose-300/10 text-rose-100" },
  muted: { icon: "text-slate-400", badge: "border-white/10 bg-white/[.03] text-slate-400" },
};

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function roleLabel(role: string) {
  return ROLE_LABELS[role] ?? role;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
}

function statusLabel(status: string) {
  if (status === "CHECKED_IN") return "IN SERVIZIO";
  if (status === "PAUSED") return "IN PAUSA";
  if (status === "CHECKED_OUT") return "FUORI SERVIZIO";
  if (status === "APPROVED") return "APPROVATA";
  if (status === "CORRECTION_REQUESTED") return "CORREZIONE";
  return status.replaceAll("_", " ");
}

function statusTone(status: string): Tone {
  if (status === "CHECKED_IN") return "lime";
  if (status === "PAUSED") return "amber";
  if (status === "CORRECTION_REQUESTED") return "red";
  if (status === "CHECKED_OUT" || status === "APPROVED") return "cyan";
  return "muted";
}

function geofenceLabel(status: string) {
  if (status === "INSIDE") return "DENTRO GEOFENCE";
  if (status === "OUTSIDE") return "FUORI GEOFENCE";
  if (status === "UNCERTAIN") return "DA VERIFICARE";
  if (status === "NO_GEOFENCE") return "GEOFENCE NON CONFIGURATO";
  return "GPS NON OSSERVATO";
}

function geofenceTone(status: string): Tone {
  if (status === "INSIDE") return "lime";
  if (status === "OUTSIDE") return "red";
  if (status === "UNCERTAIN") return "amber";
  return "muted";
}

function IconButton({ label, children, onClick, className = "" }: { label: string; children: ReactNode; onClick?: () => void; className?: string }) {
  return <button aria-label={label} className={cn("grid size-9 place-items-center rounded-lg border border-white/10 bg-black/20 text-slate-500 transition hover:border-lime-300/35 hover:bg-lime-300/10 hover:text-lime-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300", className)} onClick={onClick} type="button">{children}</button>;
}

function StatusPill({ label, tone }: { label: string; tone: Tone }) {
  return <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[9px] font-semibold uppercase tracking-[.06em]", toneStyles[tone].badge)}><span className="size-1.5 rounded-full bg-current shadow-[0_0_8px_currentColor]" />{label}</span>;
}

function KpiCard({ label, value, detail, icon: Icon, tone }: { label: string; value: number | string; detail: string; icon: LucideIcon; tone: Tone }) {
  return <article className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><span className={cn("grid size-10 place-items-center rounded-xl border border-current/20 bg-current/10", toneStyles[tone].icon)}><Icon className="size-[18px]" /></span><span className="font-mono text-[9px] uppercase tracking-[.12em] text-slate-600">Aggiornato</span></div><p className="mt-5 text-[10px] font-semibold uppercase tracking-[.16em] text-slate-600">{label}</p><p className="mt-2 font-mono text-[32px] font-semibold leading-none tracking-[-.07em] text-slate-50">{value}</p><p className="mt-4 text-[10px] text-slate-600">{detail}</p></article>;
}

function RecordRow({ record, selected, onSelect }: { record: AttendanceRecord; selected: boolean; onSelect: () => void }) {
  return <button className={cn("w-full rounded-2xl border p-3 text-left transition sm:p-4", selected ? "border-lime-300/40 bg-lime-300/[.075] shadow-[0_0_26px_rgba(200,255,34,.09)]" : "border-white/[.08] bg-black/20 hover:border-lime-300/25 hover:bg-lime-300/[.03]")} onClick={onSelect} type="button"><div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-3"><span className={cn("mt-1 size-2 shrink-0 rounded-full", record.status === "CHECKED_IN" ? "bg-lime-300 shadow-[0_0_10px_rgba(200,255,34,.85)]" : record.status === "PAUSED" ? "bg-amber-300" : "bg-slate-600")} /><div className="min-w-0"><p className="truncate text-[12px] font-semibold text-slate-100">{record.jobCode ? record.jobCode + " · " : ""}{record.jobTitle}</p><p className="mt-1 truncate text-[10px] text-slate-600">{record.jobModule === "mission" ? "MISSIONE / TRASPORTO" : "COMMESSA / OPERATIVA"}</p></div></div><ChevronRight className={cn("size-4 shrink-0", selected ? "text-lime-200" : "text-slate-700")} /></div><div className="mt-3 flex flex-wrap items-center gap-2"><StatusPill label={statusLabel(record.status)} tone={statusTone(record.status)} /><StatusPill label={geofenceLabel(record.geofenceStatus)} tone={geofenceTone(record.geofenceStatus)} /></div><div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-500"><span>{record.workerId ? "Operatore associato" : "Operatore da assegnare"}</span><span>Orario ufficiale · {formatDate(record.recordedAt)}</span></div></button>;
}

export default function AttendanceOverview() {
  const router = useRouter();
  const [payload, setPayload] = useState<AttendancePayload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [refreshing, setRefreshing] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedRecordId, setSelectedRecordId] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "CHECKED_IN" | "PAUSED" | "CHECKED_OUT" | "OUTSIDE" | "NO_LOCATION">("ALL");
  const [view, setView] = useState<"live" | "evidence">("live");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/workforce/attendance", { cache: "no-store" });
      const next = await response.json() as AttendancePayload & { error?: string };
      if (!response.ok) throw new Error(next.error ?? "attendance_overview_unavailable");
      setPayload(next);
      setSelectedRecordId((current) => current && next.records?.some((record) => record.id === current) ? current : next.records?.[0]?.id ?? "");
      setState("ready");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Presenze non disponibili");
      setState((current) => current === "ready" ? current : "error");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const context = payload?.context;
  const capabilities = useMemo(() => context?.capabilities ?? ["workforce.read"], [context]);
  const allowedNavigation = useMemo(() => getAllowedCommandNavigation(capabilities).map((item) => item.id), [capabilities]);
  const visibleNavItems = useMemo(() => navItems.filter((item) => allowedNavigation.includes(item.id) || capabilities.includes(item.capability)), [allowedNavigation, capabilities]);
  const records = useMemo(() => payload?.records ?? [], [payload?.records]);
  const filteredRecords = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return records.filter((record) => {
      const searchable = (record.jobCode ?? "") + " " + record.jobTitle + " " + (record.workerId ?? "") + " " + record.status + " " + record.jobModule + " " + record.geofenceStatus;
      const matchesQuery = !normalized || searchable.toLowerCase().includes(normalized);
      const matchesFilter = statusFilter === "ALL"
        || (statusFilter === "OUTSIDE" && ["OUTSIDE", "UNCERTAIN"].includes(record.geofenceStatus))
        || (statusFilter === "NO_LOCATION" && ["NO_LOCATION", "NO_GEOFENCE"].includes(record.geofenceStatus))
        || record.status === statusFilter;
      return matchesQuery && matchesFilter;
    });
  }, [query, records, statusFilter]);
  const selectedRecord = filteredRecords.find((record) => record.id === selectedRecordId) ?? filteredRecords[0] ?? null;
  const summary = payload?.summary ?? {};
  const actor = { email: context?.actorEmail ?? "operator@zerow.local", name: context?.actorName ?? "Operatore" };
  const canSeeCommunications = capabilities.includes("communication.read");

  function navigate(path: string) {
    setMobileMenu(false);
    router.push(path);
  }

  function goBack() {
    if (window.history.length > 1) router.back();
    else router.push("/command");
  }

  if (state === "loading" && !payload) return <main className="grid min-h-screen place-items-center bg-[#030504] text-xs text-slate-500"><LoaderCircle className="mr-2 inline size-4 animate-spin text-lime-300" />Caricamento presenze…</main>;
  if (state === "error" && !payload) return <main className="grid min-h-screen place-items-center bg-[#030504]"><div className="carbon-card rounded-2xl p-6 text-center"><CircleAlert className="mx-auto size-7 text-amber-200" /><p className="mt-3 text-sm text-slate-300">Presenze non disponibili</p><Button className="mt-4 bg-lime-300 text-[#050705] hover:bg-lime-200" onClick={() => void refresh()}><RefreshCw className="size-4" />Riprova</Button></div></main>;

  return <main className="zw-app-shell zw-attendance-module min-h-screen overflow-x-hidden text-slate-100 selection:bg-lime-300 selection:text-[#060806]"><div className="zw-command-ambient" aria-hidden="true" /><div className="relative flex min-h-screen">
    <aside className={cn("zw-command-sidebar fixed inset-y-0 left-0 z-40 flex flex-col px-3 py-4 transition-[width,transform] lg:static lg:translate-x-0", sidebarCollapsed ? "is-collapsed lg:w-[76px]" : "lg:w-[248px]", mobileMenu ? "translate-x-0" : "-translate-x-full")}>
      <div className="flex items-center justify-between px-2"><button aria-label="Apri Command" className="flex min-w-0 items-center gap-3 text-left" onClick={() => navigate("/command")} type="button"><span className="neon-pulse relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black shadow-[0_0_22px_rgba(200,255,34,.12)]"><Image src="/ai-zerow-icon.jpeg" alt="AI-ZEROW" width={40} height={40} className="size-full object-cover" /></span><span className="zw-command-sidebar__brand-copy min-w-0"><span className="block text-sm font-bold tracking-[.18em] text-slate-50">AI-ZEROW</span><span className="block text-[10px] uppercase tracking-[.22em] text-lime-300/75">command</span></span></button><div className="flex items-center gap-1"><IconButton label={sidebarCollapsed ? "Espandi sidebar" : "Riduci sidebar"} className="hidden lg:grid" onClick={() => setSidebarCollapsed((value) => !value)}>{sidebarCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}</IconButton><IconButton label="Chiudi menu" className="lg:hidden" onClick={() => setMobileMenu(false)}><X className="size-4" /></IconButton></div></div>
      <div className="zw-command-tenant mt-7 flex items-center gap-3 rounded-2xl p-3"><span className="grid size-9 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/10 text-lime-200"><HardHat className="size-4" /></span><span className="zw-command-sidebar__tenant-copy min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-slate-200">ZEROW workspace</span><span className="mt-0.5 block truncate text-[10px] uppercase tracking-[.1em] text-slate-600">{roleLabel(context?.role ?? "workforce")} · profilo operativo</span></span></div>
      <nav className="mt-6 min-h-0 flex-1 overflow-y-auto" aria-label="Navigazione principale"><p className="zw-command-sidebar__nav-caption px-3 text-[9px] font-semibold uppercase tracking-[.22em] text-slate-700">Area autorizzata</p><div className="mt-2 space-y-1">{visibleNavItems.map((item) => { const Icon = item.icon; const active = item.id === "attendance"; return <button aria-current={active ? "page" : undefined} aria-label={sidebarCollapsed ? item.label : undefined} className={cn("zw-command-nav-item", active && "is-active")} key={item.id} onClick={() => navigate(item.path)} title={sidebarCollapsed ? item.label : undefined} type="button"><Icon className={cn("size-4", active ? "text-lime-200" : "text-slate-600 group-hover:text-slate-300")} /><span className="zw-command-sidebar__nav-label">{item.label}</span>{item.id === "command" && <span className="zw-command-sidebar__nav-badge ml-auto rounded border border-lime-300/20 px-1.5 py-0.5 font-mono text-[8px] tracking-[.08em] text-lime-200">AI</span>}</button>; })}</div></nav>
      <div className="zw-command-sidebar__footer mt-4 border-t border-white/[.07] pt-4"><div className="flex items-center justify-between px-2 text-[9px] uppercase tracking-[.14em] text-slate-600"><span>Sistema</span><span className="flex items-center gap-1.5 text-lime-200"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_10px_rgba(200,255,34,.9)]" />{payload?.readback?.status === "verified" ? "DATI AGGIORNATI" : "AGGIORNAMENTO"}</span></div><div className="zw-command-core-status mt-3 rounded-xl p-3"><p className="font-mono text-[9px] text-slate-500">PRESENZE / {records.length} EVIDENZE</p><p className="mt-2 font-mono text-[9px] text-lime-300/60">SERVIZIO / SOLO DURANTE IL TURNO</p></div></div>
    </aside>
    {mobileMenu && <button aria-label="Chiudi menu" className="fixed inset-0 z-30 bg-black/65 lg:hidden" onClick={() => setMobileMenu(false)} type="button" />}
    <section className="min-w-0 flex-1"><header className="zw-command-topbar sticky top-0 z-20 flex h-[72px] items-center gap-3 px-4 sm:gap-5 sm:px-7"><IconButton className="lg:hidden" label="Apri menu" onClick={() => setMobileMenu(true)}><Menu className="size-4" /></IconButton><button aria-label="Apri Presenze" className="zw-command-topbar__brand flex shrink-0 items-center gap-2 text-left" onClick={() => navigate("/presenze")} type="button"><span className="relative grid size-9 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black shadow-[0_0_18px_rgba(200,255,34,.12)]"><Image src="/ai-zerow-icon.jpeg" alt="ZEROW" width={36} height={36} className="size-full object-cover" /></span><span className="hidden sm:block"><span className="block text-[11px] font-bold tracking-[.18em] text-slate-50">ZEROW</span><span className="block text-[9px] uppercase tracking-[.2em] text-lime-300/75">presenze</span></span></button><IconButton className="hidden lg:grid" label={sidebarCollapsed ? "Espandi sidebar" : "Riduci sidebar"} onClick={() => setSidebarCollapsed((value) => !value)}>{sidebarCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}</IconButton><div className="relative hidden min-w-0 flex-1 justify-center md:flex"><div className="relative w-full max-w-[520px]"><Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-600" /><Input aria-label="Cerca nelle presenze" className="h-10 w-full border-lime-300/10 bg-black/35 pl-10 text-xs text-slate-100 placeholder:text-slate-600" onChange={(event) => setQuery(event.target.value)} placeholder="Cerca commessa, operatore, stato…" value={query} /></div></div><div className="flex min-w-0 flex-1 items-center gap-2 md:hidden"><span className="truncate text-xs font-semibold tracking-[.14em] text-slate-200">PRESENZE</span><span className="size-1 rounded-full bg-lime-300" /></div><div className="ml-auto flex min-w-0 items-center gap-2"><TenantSwitcher /><span className="hidden items-center gap-2 rounded-full border border-lime-300/20 bg-lime-300/5 px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[.12em] text-lime-200 sm:flex"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_9px_rgba(200,255,34,.9)]" />{refreshing ? "AGGIORNAMENTO" : "DATI AGGIORNATI"}</span><IconButton label="Torna indietro" onClick={goBack}><ChevronRight className="size-4 rotate-180" /></IconButton><IconButton label="Aggiorna Presenze" onClick={() => void refresh()}><RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} /></IconButton>{canSeeCommunications && <IconButton label="Apri comunicazioni" onClick={() => navigate("/communications")}><Bell className="size-4" /></IconButton>}<AccountMenu actor={actor} /></div></header>
      <div className="mx-auto w-full max-w-[1560px] px-4 pb-24 pt-5 sm:px-7 sm:pb-8 sm:pt-7">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4"><div><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.2em] text-lime-300/70"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_9px_rgba(190,255,60,.9)]" />AI-ZEROW / PRESENZE</div><h1 className="mt-2 text-2xl font-semibold tracking-[-.04em] text-slate-50 sm:text-[28px]">Presenze</h1><p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">Timbrature, orari ufficiali e posizioni osservate · {payload?.readback?.status === "verified" ? "dati operativi aggiornati" : "aggiornamento in corso"}</p></div><div className="flex flex-wrap items-center gap-2"><Button className="h-10 rounded-xl border-lime-100/55 px-4 text-xs shadow-[0_0_30px_rgba(190,255,60,.18)]" onClick={() => navigate("/operations")}><BriefcaseBusiness className="size-4" />Commesse</Button><Button className="h-10 rounded-xl border-white/10 bg-black/25 text-xs text-slate-300 hover:border-cyan-300/30 hover:bg-cyan-300/10 hover:text-cyan-100" onClick={() => navigate("/command?prompt=Analizza%20anomalie%20presenze")} variant="outline"><Sparkles className="size-4" />Analizza con Company AI</Button></div></div>
        <section className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><KpiCard label="Evidenze visibili" value={summary.total ?? 0} detail="Profilo autorizzato" icon={FileCheck2} tone="cyan" /><KpiCard label="In servizio" value={summary.checkedIn ?? 0} detail="Stato corrente" icon={Clock3} tone="lime" /><KpiCard label="In pausa" value={summary.paused ?? 0} detail="Stato corrente" icon={CalendarClock} tone="amber" /><KpiCard label="Posizione osservata" value={summary.gpsObserved ?? 0} detail={(summary.geofenceInside ?? 0) + " nel perimetro"} icon={MapPin} tone="cyan" /></section>
        <OperationalAttendanceDeck targets={payload?.targets ?? []} onChanged={refresh} />
        <section className="carbon-card mt-4 rounded-2xl p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-lime-300/70">CONTROLLO PRESENZE</p><h2 className="mt-1 text-lg font-semibold text-slate-100">Registro e stato operativo</h2><p className="mt-1 text-[11px] text-slate-500">Le azioni di ingresso, pausa, uscita e correzione partono dal pannello assegnato qui sopra.</p></div><div className="flex items-center gap-1 rounded-xl border border-white/[.08] bg-black/20 p-1"><button className={cn("rounded-lg px-3 py-2 text-[10px] font-semibold transition", view === "live" ? "bg-lime-300 text-[#050705]" : "text-slate-500 hover:text-slate-200")} onClick={() => setView("live")} type="button"><Activity className="mr-1 inline size-3.5" />In servizio</button><button className={cn("rounded-lg px-3 py-2 text-[10px] font-semibold transition", view === "evidence" ? "bg-lime-300 text-[#050705]" : "text-slate-500 hover:text-slate-200")} onClick={() => setView("evidence")} type="button"><FileCheck2 className="mr-1 inline size-3.5" />Evidenze</button></div></div><div className="mt-4 flex flex-wrap gap-2"><label className="relative min-w-[230px] flex-1 md:hidden"><Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-600" /><Input aria-label="Filtra presenze" className="h-9 border-white/10 bg-black/25 pl-9 text-[10px]" onChange={(event) => setQuery(event.target.value)} placeholder="Filtra questa superficie…" value={query} /></label><select aria-label="Filtra stato presenze" className="h-9 rounded-xl border border-white/10 bg-black/25 px-3 text-[10px] text-slate-300 outline-none focus:border-lime-300/40" onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} value={statusFilter}><option className="bg-[#080c09]" value="ALL">Tutti gli stati</option><option className="bg-[#080c09]" value="CHECKED_IN">In servizio</option><option className="bg-[#080c09]" value="PAUSED">In pausa</option><option className="bg-[#080c09]" value="CHECKED_OUT">Fuori servizio</option><option className="bg-[#080c09]" value="OUTSIDE">Fuori / incerto geofence</option><option className="bg-[#080c09]" value="NO_LOCATION">Posizione non disponibile</option></select><Button className="h-9 border-white/10 bg-black/20 text-[10px] text-slate-300 hover:border-lime-300/30 hover:bg-lime-300/10 hover:text-lime-100" onClick={() => { setStatusFilter("ALL"); setQuery(""); }} variant="outline"><RefreshCw className="size-3.5" />Reset filtri</Button><span className="ml-auto self-center font-mono text-[9px] text-slate-600">{filteredRecords.length} / {records.length} PRESENZE</span></div></section>
        <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.14fr)_minmax(350px,.86fr)]"><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-cyan-200/70">REGISTRO PRESENZE</p><h2 className="mt-1 text-sm font-semibold text-slate-100">{view === "live" ? "Stato operativo corrente" : "Evidenze e orari"}</h2></div><span className="flex items-center gap-2 text-[9px] uppercase tracking-[.14em] text-slate-600"><span className="size-1.5 rounded-full bg-lime-300" />SOLO DURANTE IL TURNO</span></div><div className="mt-4 space-y-2">{filteredRecords.map((record) => <RecordRow key={record.id} onSelect={() => setSelectedRecordId(record.id)} record={record} selected={record.id === selectedRecord?.id} />)}{filteredRecords.length === 0 && <div className="rounded-2xl border border-dashed border-lime-300/15 bg-black/15 p-10 text-center"><FileCheck2 className="mx-auto size-8 text-slate-700" /><p className="mt-3 text-sm font-medium text-slate-300">Nessuna evidenza nel perimetro</p><p className="mt-1 text-[11px] text-slate-600">Prova a rimuovere i filtri o apri una commessa autorizzata.</p></div>}</div></section><aside className="space-y-4"><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">DETTAGLIO PRESENZA</p><h2 className="mt-1 text-lg font-semibold text-slate-100">{selectedRecord ? selectedRecord.jobTitle : "Nessun contesto selezionato"}</h2><p className="mt-1 text-[10px] text-slate-500">{selectedRecord?.jobCode ?? "—"} · {selectedRecord?.jobModule === "mission" ? "Missione / trasporto" : "Commessa / operativa"}</p></div>{selectedRecord && <StatusPill label={statusLabel(selectedRecord.status)} tone={statusTone(selectedRecord.status)} />}</div>{selectedRecord ? <><div className="mt-4 grid gap-2 sm:grid-cols-2"><div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">Orario ufficiale</p><p className="mt-2 text-[11px] text-slate-200">{formatDate(selectedRecord.recordedAt)}</p><p className="mt-1 text-[9px] text-slate-600">Versione evento · {selectedRecord.version}</p></div><div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">Geofence</p><p className={cn("mt-2 text-[11px]", geofenceTone(selectedRecord.geofenceStatus) === "lime" ? "text-lime-200" : geofenceTone(selectedRecord.geofenceStatus) === "red" ? "text-rose-200" : "text-slate-300")}>{geofenceLabel(selectedRecord.geofenceStatus)}</p><p className="mt-1 text-[9px] text-slate-600">Posizione rilevata · {formatDate(selectedRecord.clientObservedAt)}</p></div></div><div className="mt-4 flex flex-wrap gap-2">{selectedRecord.jobModule === "operations" ? <Link className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-lime-300 px-3 py-2 text-[10px] font-semibold text-[#050705] hover:bg-lime-200" href={"/operations/" + encodeURIComponent(selectedRecord.jobId)}>Apri scheda commessa <ArrowUpRight className="size-3.5" /></Link> : <Button className="bg-lime-300 text-[10px] font-semibold text-[#050705] hover:bg-lime-200" onClick={() => navigate("/mission")}><Truck className="size-3.5" />Apri missioni</Button>}</div></> : <div className="mt-5 rounded-xl border border-dashed border-white/10 p-6 text-center text-[10px] text-slate-600">Seleziona un’evidenza per ispezionare il contesto.</div>}</section>{selectedRecord?.jobModule === "operations" && <Link className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-lime-300/20 bg-lime-300/[.04] px-3 py-2 text-[10px] font-semibold text-lime-100 hover:border-lime-300/40 hover:bg-lime-300/[.08]" href="/presenze"><Clock3 className="size-3.5" />Apri il pannello Presenze centrale <ArrowUpRight className="size-3.5" /></Link>}<section className="carbon-card-neon rounded-2xl p-4 sm:p-5"><div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-2xl border border-cyan-300/25 bg-cyan-300/10 text-cyan-200"><ShieldCheck className="size-5" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-cyan-200/70">REGOLE DI SERVIZIO</p><h2 className="mt-1 text-[15px] font-semibold text-slate-100">Tracciabilità proporzionata</h2></div></div><div className="mt-4 space-y-2 text-[10px] text-slate-500"><p className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-lime-200" />Ogni evento conserva il proprio orario ufficiale.</p><p className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-lime-200" />La posizione viene richiesta solo al cambio di stato del turno.</p><p className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-lime-200" />Il geofence viene valutato quando la commessa lo configura.</p><p className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-lime-200" />Per gli autisti il tracking si apre dopo l’ingresso valido e resta visibile in Control fino all’uscita.</p></div></section></aside></section>
        <section className="mt-4 grid gap-4 lg:grid-cols-3"><article className="carbon-inset rounded-2xl p-4"><p className="text-[9px] font-semibold uppercase tracking-[.18em] text-slate-600">FUORI PERIMETRO</p><p className="mt-2 font-mono text-2xl text-rose-100">{summary.geofenceOutside ?? 0}</p><p className="mt-1 text-[10px] text-slate-500">posizioni fuori dal geofence</p></article><article className="carbon-inset rounded-2xl p-4"><p className="text-[9px] font-semibold uppercase tracking-[.18em] text-slate-600">DA VERIFICARE</p><p className="mt-2 font-mono text-2xl text-amber-100">{summary.geofenceUncertain ?? 0}</p><p className="mt-1 text-[10px] text-slate-500">richiedono controllo manuale</p></article><article className="carbon-inset rounded-2xl p-4"><p className="text-[9px] font-semibold uppercase tracking-[.18em] text-slate-600">COMMESSE OPERATIVE</p><button className="mt-2 inline-flex items-center gap-2 text-left text-sm font-medium text-lime-200 hover:text-lime-100" onClick={() => navigate("/operations")} type="button">Apri lavori assegnati <ArrowUpRight className="size-3.5" /></button><p className="mt-1 text-[10px] text-slate-500">Timbratura, attività e presenze restano collegate alla commessa.</p></article></section>
        <section className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-cyan-300/15 bg-cyan-300/[.03] px-4 py-3 text-[10px] text-slate-500"><span className="flex items-center gap-2"><ShieldCheck className="size-3.5 shrink-0 text-cyan-200" />Accesso autorizzato · orario ufficiale · solo durante il turno</span><span className="flex items-center gap-2"><button className="text-lime-200 hover:text-lime-100" onClick={() => navigate("/workforce")} type="button">Registro operatori <ArrowUpRight className="ml-1 inline size-3" /></button><span>·</span><button className="text-lime-200 hover:text-lime-100" onClick={() => navigate("/planning")} type="button">Pianificazione <ArrowUpRight className="ml-1 inline size-3" /></button></span></section>
        <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/[.07] py-5 text-[10px] text-slate-700"><span>AI-ZEROW COMMAND · presenze operative</span><span className="flex items-center gap-2"><span>ultra carbon core</span><span className="size-1 rounded-full bg-lime-300" /><span>accesso personalizzato</span></span></footer>
      </div>
    </section>
  </div><CommandMobileNav active="attendance" allowedNavigation={allowedNavigation} role={context?.role} roles={context?.roles} />{notice && <button className="fixed bottom-5 left-1/2 z-[100] flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-2 rounded-xl border border-lime-300/25 bg-[#080d09]/96 px-4 py-3 text-left text-xs text-lime-100 shadow-[0_0_34px_rgba(200,255,34,.16)] backdrop-blur-xl" onClick={() => setNotice("")} type="button"><CircleAlert className="size-4 shrink-0 text-amber-200" />{notice}</button>}</main>;
}
