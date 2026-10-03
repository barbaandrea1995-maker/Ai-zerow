"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  ArrowUpRight,
  Bell,
  BriefcaseBusiness,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
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
  Sparkles,
  Truck,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CommandMobileNav } from "@/components/command-mobile-nav";
import { Input } from "@/components/ui/input";
import { getAllowedCommandNavigation, type CommandNavigationId } from "@/lib/command-dashboard";

type Tone = "lime" | "cyan" | "amber" | "red";

type AuthorityContextView = {
  actorName: string;
  role: string;
  capabilities: string[];
};

type WorkforceMember = {
  id: string;
  name: string;
  email?: string;
  role: string;
  roleLabel: string;
  status: string;
  updatedAt: string;
};

type WorkforceResource = {
  id: string;
  code: string | null;
  label: string;
  entityType: string;
  status: string;
  available: boolean;
  conflict: { recordId: string; title: string; startsAt: string; endsAt: string } | null;
  qualifications: string[];
  authorityMembershipId: string | null;
  updatedAt: string;
};

type WorkforcePlan = {
  id: string;
  jobId: string;
  jobTitle: string;
  jobCode: string | null;
  title: string;
  status: string;
  activityType: string;
  startsAt: string | null;
  endsAt: string | null;
  resourceCount: number;
  feasible: boolean;
  updatedAt: string;
};

type WorkforceAttendance = {
  id: string;
  jobId: string;
  jobTitle: string;
  workerId: string | null;
  status: string;
  recordedAt: string | null;
  geofenceStatus: string;
  updatedAt: string;
};

type WorkforcePayload = {
  context?: AuthorityContextView;
  members?: WorkforceMember[];
  resources?: WorkforceResource[];
  plans?: WorkforcePlan[];
  attendance?: WorkforceAttendance[];
  summary?: {
    activePeople?: number;
    drivers?: number;
    availableResources?: number;
    plannedToday?: number;
    plans?: number;
    inService?: number;
    geofenceInside?: number;
  };
  registration?: {
    owner?: string;
    route?: string;
    workforceCreation?: string;
    driverProvisioning?: string;
  };
  readback?: { status?: string; checkedAt?: string };
  error?: string;
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
  { id: "documents", label: "DOCUMENTI", path: "/documents", capability: "documents.read", icon: Layers3 },
  { id: "authority", label: "AUTHORITY", path: "/onboarding", capability: "authority.read", icon: ShieldCheck },
  { id: "events", label: "EVENTI", path: "/events", capability: "events.read", icon: Activity },
  { id: "settings", label: "IMPOSTAZIONI", path: "/settings", capability: "settings.read", icon: ShieldCheck },
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
  maintenance: "Manutentore",
  auditor: "Auditor",
};

const toneStyles: Record<Tone, { icon: string; badge: string }> = {
  lime: { icon: "text-lime-200", badge: "border-lime-300/25 bg-lime-300/10 text-lime-100" },
  cyan: { icon: "text-cyan-200", badge: "border-cyan-300/25 bg-cyan-300/10 text-cyan-100" },
  amber: { icon: "text-amber-200", badge: "border-amber-300/25 bg-amber-300/10 text-amber-100" },
  red: { icon: "text-rose-200", badge: "border-rose-300/25 bg-rose-300/10 text-rose-100" },
};

function roleLabel(role: string) {
  return ROLE_LABELS[role] ?? role;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
}

function statusLabel(status: string) {
  if (status === "active") return "ATTIVO";
  if (status === "AVAILABLE") return "DISPONIBILE";
  if (status === "CHECKED_IN") return "IN SERVIZIO";
  if (status === "CHECKED_OUT" || status === "APPROVED") return "CHIUSO";
  return status.replaceAll("_", " ");
}

function statusTone(status: string): Tone {
  if (["active", "AVAILABLE", "CHECKED_IN", "PUBLISHED"].includes(status)) return "lime";
  if (["PAUSED", "DRAFT", "FEASIBLE"].includes(status)) return "amber";
  if (["CONFLICTED", "CORRECTION_REQUESTED", "SUSPENDED"].includes(status)) return "red";
  return "cyan";
}

function IconButton({ label, children, onClick, className = "" }: { label: string; children: ReactNode; onClick?: () => void; className?: string }) {
  return <button aria-label={label} className={`grid size-9 place-items-center rounded-lg border border-white/10 bg-black/20 text-slate-500 transition hover:border-lime-300/35 hover:bg-lime-300/10 hover:text-lime-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300 ${className}`} onClick={onClick} type="button">{children}</button>;
}

function StatusPill({ status, tone = statusTone(status) }: { status: string; tone?: Tone }) {
  const style = toneStyles[tone];
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[9px] font-semibold uppercase tracking-[.06em] ${style.badge}`}><span className="size-1.5 rounded-full bg-current shadow-[0_0_8px_currentColor]" />{statusLabel(status)}</span>;
}

function Kpi({ label, value, detail, icon: Icon, tone }: { label: string; value: number | string; detail: string; icon: LucideIcon; tone: Tone }) {
  return <article className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><span className={`grid size-10 place-items-center rounded-xl border border-current/20 bg-current/10 ${toneStyles[tone].icon}`}><Icon className="size-[18px]" /></span><StatusPill status={detail} tone={tone} /></div><p className="mt-5 text-[10px] font-semibold uppercase tracking-[.16em] text-slate-600">{label}</p><p className="mt-2 font-mono text-[32px] font-semibold leading-none tracking-[-.07em] text-slate-50">{value}</p><p className="mt-4 text-[10px] text-slate-600">Readback D1 tenant-scoped</p></article>;
}

export default function WorkforceControl() {
  const router = useRouter();
  const [payload, setPayload] = useState<WorkforcePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [query, setQuery] = useState("");
  const [memberFilter, setMemberFilter] = useState<"ALL" | "DRIVER" | "FIELD" | "AVAILABLE">("ALL");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/workforce/overview", { cache: "no-store" });
      const next = await response.json() as WorkforcePayload;
      if (!response.ok) throw new Error(next.error ?? "workforce_overview_unavailable");
      setPayload(next);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Workforce non disponibile");
    } finally {
      setLoading(false);
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
  const visibleNavItems = useMemo(() => navItems.filter((item) => capabilities.includes(item.capability)), [capabilities]);
  const members = useMemo(() => payload?.members ?? [], [payload]);
  const resources = useMemo(() => payload?.resources ?? [], [payload]);
  const plans = useMemo(() => payload?.plans ?? [], [payload]);
  const attendance = useMemo(() => payload?.attendance ?? [], [payload]);
  const summary = payload?.summary ?? {};
  const canManageAuthority = capabilities.includes("authority.manage");
  const canWritePlanning = capabilities.includes("planning.write");
  const canReadAuthority = capabilities.includes("authority.read");

  const filteredMembers = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return members.filter((member) => {
      const linkedResource = resources.find((resource) => resource.authorityMembershipId === member.id);
      const searchable = `${member.name} ${member.email ?? ""} ${member.roleLabel} ${linkedResource?.code ?? ""}`.toLowerCase();
      const matchesQuery = !normalized || searchable.includes(normalized);
      const matchesFilter = memberFilter === "ALL"
        || (memberFilter === "DRIVER" && member.role === "driver")
        || (memberFilter === "FIELD" && ["driver", "worker", "field_supervisor", "technical", "maintenance"].includes(member.role))
        || (memberFilter === "AVAILABLE" && linkedResource?.available);
      return matchesQuery && matchesFilter;
    });
  }, [memberFilter, members, query, resources]);

  const activeDrivers = resources.filter((resource) => resource.entityType === "driver");
  const recentPlans = plans.slice(0, 5);
  const recentAttendance = attendance.slice(0, 5);

  function navigate(item: NavItem) {
    setMobileMenu(false);
    router.push(item.path);
  }

  function openAuthority() {
    if (!canReadAuthority && !canManageAuthority) {
      setNotice("Authority non è incluso nel tuo perimetro. Chiedi al responsabile tenant.");
      return;
    }
    router.push("/onboarding");
  }

  if (loading && !payload) {
    return <main className="grid min-h-screen place-items-center bg-[#030504] text-xs text-slate-500"><LoaderCircle className="mr-2 inline size-4 animate-spin text-lime-300" />Apertura Workforce control…</main>;
  }

  return <main className="zw-app-shell zw-command-ultra min-h-screen overflow-x-hidden text-slate-100 selection:bg-lime-300 selection:text-[#060806]"><div className="zw-command-ambient" aria-hidden="true" /><div className="relative flex min-h-screen">
    <aside className={`zw-command-sidebar fixed inset-y-0 left-0 z-40 flex flex-col px-3 py-4 transition-[width,transform] lg:static lg:translate-x-0 ${sidebarCollapsed ? "is-collapsed lg:w-[76px]" : "lg:w-[248px]"} ${mobileMenu ? "translate-x-0" : "-translate-x-full"}`}>
      <div className="flex items-center justify-between px-2"><button aria-label="Apri Command" className="flex min-w-0 items-center gap-3 text-left" onClick={() => { setMobileMenu(false); router.push("/command"); }} type="button"><span className="neon-pulse relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black shadow-[0_0_22px_rgba(200,255,34,.12)]"><Image src="/ai-zerow-icon.jpeg" alt="AI-ZEROW" width={40} height={40} className="size-full object-cover" /></span><span className="zw-command-sidebar__brand-copy min-w-0"><span className="block text-sm font-bold tracking-[.18em] text-slate-50">AI-ZEROW</span><span className="block text-[10px] uppercase tracking-[.22em] text-lime-300/75">command</span></span></button><div className="flex items-center gap-1"><IconButton label={sidebarCollapsed ? "Espandi sidebar" : "Riduci sidebar"} className="hidden lg:grid" onClick={() => setSidebarCollapsed((value) => !value)}>{sidebarCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}</IconButton><IconButton label="Chiudi menu" className="lg:hidden" onClick={() => setMobileMenu(false)}><X className="size-4" /></IconButton></div></div>
      <button className="zw-command-tenant mt-7 flex w-full items-center gap-3 rounded-2xl p-3 text-left transition hover:border-lime-300/25" type="button" onClick={() => setNotice(`Workspace ZEROW · ${roleLabel(context?.role ?? "workforce")}`)}><span className="grid size-8 place-items-center rounded-lg border border-lime-300/20 bg-lime-300/10 text-lime-200"><HardHat className="size-4" /></span><span className="zw-command-sidebar__tenant-copy min-w-0 flex-1"><span className="block truncate text-xs font-medium text-slate-200">ZEROW workspace</span><span className="mt-0.5 block truncate text-[10px] text-slate-600">{roleLabel(context?.role ?? "workforce")} · tenant context</span></span><ChevronRight className="size-3.5 text-slate-600" /></button>
      <nav className="mt-6 min-h-0 flex-1 overflow-y-auto" aria-label="Navigazione principale"><p className="zw-command-sidebar__nav-caption px-3 text-[9px] font-semibold uppercase tracking-[.22em] text-slate-700">Workspace</p><div className="mt-2 space-y-1">{visibleNavItems.map((item) => { const Icon = item.icon; const active = item.id === "workforce"; return <button aria-current={active ? "page" : undefined} aria-label={sidebarCollapsed ? item.label : undefined} className={`zw-command-nav-item ${active ? "is-active" : ""}`} key={item.id} onClick={() => navigate(item)} title={sidebarCollapsed ? item.label : undefined} type="button"><Icon className={`size-4 ${active ? "text-lime-200" : "text-slate-600 group-hover:text-slate-300"}`} /><span className="zw-command-sidebar__nav-label">{item.label}</span>{item.id === "command" && <span className="zw-command-sidebar__nav-badge ml-auto rounded border border-lime-300/20 px-1.5 py-0.5 font-mono text-[8px] tracking-[.08em] text-lime-200">AI</span>}</button>; })}</div></nav>
      <div className="zw-command-sidebar__footer mt-5 border-t border-white/[.08] pt-4"><div className="flex items-center justify-between px-2 text-[10px] uppercase tracking-[.14em] text-slate-600"><span>System status</span><span className="flex items-center gap-1.5 text-lime-200"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_8px_rgba(190,255,60,.8)]" />online</span></div><div className="carbon-inset mt-3 rounded-xl p-3"><div className="flex items-center gap-2 text-[10px] text-slate-400"><Activity className="size-3.5 text-lime-300" />Workforce core</div><p className="mt-3 font-mono text-[9px] text-slate-600">D1 · {payload?.readback?.status === "verified" ? "READBACK VERIFIED" : "CHECKING"}</p><p className="mt-2 font-mono text-[9px] text-slate-600">Authority · {payload?.registration?.owner ?? "BOUNDARY"}</p></div></div>
    </aside>
    {mobileMenu && <button className="fixed inset-0 z-30 bg-black/75 lg:hidden" onClick={() => setMobileMenu(false)} aria-label="Chiudi menu" type="button" />}
    <section className="min-w-0 flex-1"><header className="zw-command-topbar sticky top-0 z-20 flex h-[72px] items-center gap-3 px-4 sm:gap-5 sm:px-7"><IconButton label="Apri menu" onClick={() => setMobileMenu(true)} className="lg:hidden"><Menu className="size-4" /></IconButton><button aria-label="Apri Workforce" className="zw-command-topbar__brand flex shrink-0 items-center gap-2 text-left" onClick={() => router.push("/workforce")} type="button"><span className="relative grid size-9 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black shadow-[0_0_18px_rgba(200,255,34,.12)]"><Image src="/ai-zerow-icon.jpeg" alt="ZEROW" width={36} height={36} className="size-full object-cover" /></span><span className="hidden sm:block"><span className="block text-[11px] font-bold tracking-[.18em] text-slate-50">ZEROW</span><span className="block text-[9px] uppercase tracking-[.2em] text-lime-300/75">workforce</span></span></button><IconButton className="hidden lg:grid" label={sidebarCollapsed ? "Espandi sidebar" : "Riduci sidebar"} onClick={() => setSidebarCollapsed((value) => !value)}>{sidebarCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}</IconButton><div className="relative hidden min-w-0 flex-1 justify-center md:flex"><div className="relative w-full max-w-[520px]"><Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-600" /><Input aria-label="Cerca nel Workforce" className="h-10 w-full border-lime-300/10 bg-black/35 pl-10 text-xs text-slate-100 placeholder:text-slate-600" onChange={(event) => setQuery(event.target.value)} placeholder="Cerca persone, ruoli, qualifiche…" value={query} /></div></div><div className="flex min-w-0 flex-1 items-center gap-2 md:hidden"><span className="truncate text-xs font-semibold tracking-[.14em] text-slate-200">WORKFORCE</span><span className="size-1 rounded-full bg-lime-300" /></div><div className="ml-auto flex items-center gap-2"><span className="hidden items-center gap-2 rounded-full border border-lime-300/20 bg-lime-300/5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[.12em] text-lime-200 sm:flex"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_9px_rgba(190,255,60,.9)]" />{refreshing ? "READING" : "D1 VERIFIED"}</span><IconButton label="Aggiorna Workforce" onClick={() => void refresh()}><RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} /></IconButton>{capabilities.includes("communication.read") && <IconButton label="Apri comunicazioni" onClick={() => router.push("/communications")}><Bell className="size-4" /></IconButton>}<span className="hidden size-8 place-items-center rounded-full border border-white/15 bg-gradient-to-br from-slate-200 to-slate-500 text-xs font-bold text-[#080a0b] sm:grid">AB</span><div className="hidden text-right lg:block"><p className="text-xs font-medium text-slate-200">{roleLabel(context?.role ?? "workforce")}</p><p className="text-[10px] text-slate-600">Tenant corrente</p></div><ChevronDown className="hidden size-3.5 text-slate-500 lg:block" /></div></header>
      <div className="mx-auto max-w-[1680px] px-4 py-5 sm:px-7 sm:py-7"><div className="zw-module-hero zw-page-enter mb-7 flex flex-wrap items-end justify-between gap-5"><div><div className="flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[.22em] text-lime-300/80"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_9px_rgba(190,255,60,.9)]" />AI-ZEROW / WORK / WORKFORCE</div><h1 className="mt-3 text-3xl font-semibold tracking-[-.055em] text-lime-100 sm:text-[36px]">Workforce</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Turni, disponibilità e presenze delle persone autorizzate. Le identità e i ruoli nascono in Authority; qui diventano esecuzione operativa leggibile.</p><div className="mt-4 flex flex-wrap items-center gap-2"><StatusPill status="AUTHORITY LINKED" tone="lime" /><StatusPill status="SERVER SELECTION" tone="cyan" /><span className="text-[10px] text-slate-600">Nessuna registrazione libera nel modulo</span></div></div><div className="flex flex-wrap items-center gap-2"><Button className="h-11 rounded-xl border-lime-100/55 px-4 text-xs shadow-[0_0_30px_rgba(190,255,60,.18)]" onClick={() => router.push("/planning")} disabled={!canWritePlanning}><CalendarClock className="size-4" />Pianifica turni</Button><Button className="h-11 rounded-xl border-white/10 bg-black/25 px-4 text-xs text-slate-300 hover:border-lime-300/30 hover:bg-lime-300/10 hover:text-lime-100" onClick={() => router.push("/presenze")} variant="outline"><Clock3 className="size-4" />Apri presenze</Button></div></div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Kpi label="Persone autorizzate" value={summary.activePeople ?? 0} detail="ACTIVE" icon={Users} tone="lime" /><Kpi label="Autisti provisionati" value={summary.drivers ?? 0} detail="AUTHORITY" icon={Truck} tone="cyan" /><Kpi label="Turni oggi" value={summary.plannedToday ?? 0} detail="PLANNING" icon={CalendarClock} tone="amber" /><Kpi label="In servizio" value={summary.inService ?? 0} detail="TIMESTAMP" icon={Clock3} tone="lime" /></div>
        <div className="mt-4 grid gap-4 2xl:grid-cols-[minmax(0,1.16fr)_minmax(360px,.84fr)]"><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-lime-300/70">WORKFORCE / DIRECTORY</p><h2 className="mt-1 text-[17px] font-semibold text-slate-100">Persone nel perimetro operativo</h2><p className="mt-1 text-[11px] text-slate-500">Readback Authority con visibilità filtrata dalle capability del ruolo.</p></div><div className="flex items-center gap-2"><StatusPill status="D1 VERIFIED" /><IconButton label="Aggiorna persone" onClick={() => void refresh()}><RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} /></IconButton></div></div><div className="mt-4 flex flex-wrap items-center gap-2"><div className="relative min-w-[220px] flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-600" /><Input aria-label="Cerca persone" className="h-9 border-white/10 bg-black/25 pl-9 text-[11px]" onChange={(event) => setQuery(event.target.value)} placeholder="Cerca nome, ruolo, codice…" value={query} /></div>{(["ALL", "DRIVER", "FIELD", "AVAILABLE"] as const).map((filter) => <button className={`rounded-lg border px-3 py-2 text-[10px] font-semibold transition ${memberFilter === filter ? "border-lime-300/35 bg-lime-300/10 text-lime-100" : "border-white/10 bg-black/20 text-slate-500 hover:border-lime-300/25 hover:text-lime-100"}`} key={filter} onClick={() => setMemberFilter(filter)} type="button">{filter === "ALL" ? "Tutti" : filter === "DRIVER" ? "Autisti" : filter === "FIELD" ? "Field" : "Disponibili"}</button>)}</div><div className="mt-4 overflow-hidden rounded-xl border border-white/[.08] bg-black/20"><div className="hidden grid-cols-[minmax(0,1.25fr)_130px_150px_120px] gap-3 border-b border-white/[.08] px-4 py-3 text-[9px] font-semibold uppercase tracking-[.14em] text-slate-600 md:grid"><span>Identità</span><span>Ruolo</span><span>Risorsa</span><span>Stato</span></div>{filteredMembers.map((member) => { const linked = resources.find((resource) => resource.authorityMembershipId === member.id); return <article className="grid gap-3 border-b border-white/[.06] px-4 py-3.5 last:border-b-0 md:grid-cols-[minmax(0,1.25fr)_130px_150px_120px] md:items-center" key={member.id}><div className="flex min-w-0 items-center gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/[.07] text-[10px] font-bold text-lime-100">{member.name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "U"}</span><div className="min-w-0"><p className="truncate text-xs font-semibold text-slate-200">{member.name}</p><p className="mt-1 truncate text-[10px] text-slate-600">{member.email ?? "Identità nel perimetro assegnato"}</p></div></div><div><span className="text-[10px] font-medium text-slate-300">{member.roleLabel || roleLabel(member.role)}</span><span className="mt-1 block text-[9px] text-slate-600">{member.status === "active" ? "membership attiva" : member.status}</span></div><div>{linked ? <><p className="font-mono text-[10px] text-cyan-100">{linked.code ?? linked.id}</p><p className="mt-1 text-[9px] text-slate-600">{linked.entityType === "driver" ? "selezionabile per missioni" : "risorsa workforce"}</p></> : <span className="text-[10px] text-slate-600">{member.role === "driver" ? "in attesa di accettazione" : "nessuna risorsa dedicata"}</span>}</div><div><StatusPill status={linked ? (linked.available ? "AVAILABLE" : "BUSY") : member.status} tone={linked ? (linked.available ? "lime" : "amber") : statusTone(member.status)} /></div></article>; })}{filteredMembers.length === 0 && <div className="px-4 py-10 text-center text-xs text-slate-600">Nessuna persona nel filtro corrente.</div>}</div><div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-lime-300/15 bg-lime-300/[.035] px-3.5 py-3"><div className="flex items-start gap-2"><ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-lime-200" /><p className="text-[10px] leading-5 text-slate-500">Per invitare un autista o assegnare capability usa Authority. Workforce non duplica il registro identità.</p></div>{canReadAuthority || canManageAuthority ? <Button className="h-8 shrink-0 border-white/10 bg-black/25 text-[10px] text-lime-100 hover:border-lime-300/30 hover:bg-lime-300/10" onClick={openAuthority} variant="outline"><ShieldCheck className="size-3.5" />Apri Authority</Button> : null}</div></section>
          <section className="carbon-card-neon rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-cyan-200/70">MISSION READINESS</p><h2 className="mt-1 text-[17px] font-semibold text-slate-100">Autisti assegnabili</h2><p className="mt-1 text-[11px] text-slate-500">Disponibilità di base dal registro Authority; la finestra missione viene ricontrollata nel modulo Mission.</p></div><span className="grid size-10 place-items-center rounded-2xl border border-cyan-300/20 bg-cyan-300/[.07] text-cyan-200"><Truck className="size-5" /></span></div><div className="mt-5 space-y-2.5">{activeDrivers.slice(0, 6).map((driver) => <div className="rounded-xl border border-white/[.08] bg-black/20 p-3.5" key={driver.id}><div className="flex items-start gap-3"><span className={`grid size-9 place-items-center rounded-xl border ${driver.available ? "border-lime-300/25 bg-lime-300/10 text-lime-100" : "border-amber-300/20 bg-amber-300/[.06] text-amber-100"}`}><Truck className="size-4" /></span><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-slate-100">{driver.label}</p><p className="mt-1 font-mono text-[9px] text-cyan-200/70">{driver.code ?? driver.id}</p></div><StatusPill status={driver.available ? "AVAILABLE" : "BUSY"} tone={driver.available ? "lime" : "amber"} /></div>{driver.qualifications.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{driver.qualifications.slice(0, 4).map((qualification) => <span className="rounded-full border border-white/10 px-2 py-1 text-[9px] text-slate-500" key={qualification}>{qualification}</span>)}</div>}{driver.conflict && <p className="mt-2 text-[9px] text-amber-200/80">Impegnato: {driver.conflict.title} · {formatDate(driver.conflict.startsAt)}</p>}</div>)}{activeDrivers.length === 0 && <div className="rounded-xl border border-dashed border-cyan-300/15 bg-black/15 p-7 text-center"><Truck className="mx-auto size-7 text-slate-700" /><p className="mt-3 text-xs font-medium text-slate-400">Nessun autista provisionato</p><p className="mt-1 text-[10px] leading-5 text-slate-600">Invita una persona in Authority con il ruolo Autista. Dopo l’accettazione comparirà qui e sarà selezionabile in Mission.</p>{canReadAuthority || canManageAuthority ? <Button className="mt-4 h-9 bg-lime-300 text-[10px] font-semibold text-[#060806] hover:bg-lime-200" onClick={openAuthority}><ShieldCheck className="size-3.5" />Vai ad Authority</Button> : null}</div>}{activeDrivers.length > 6 && <p className="text-center text-[10px] text-slate-600">+ altri {activeDrivers.length - 6} autisti nel registro autorizzato</p>}</div><div className="mt-5 grid grid-cols-2 gap-2"><div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">Disponibili</p><p className="mt-2 font-mono text-xl text-lime-100">{summary.availableResources ?? 0}</p></div><div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">Missioni</p><p className="mt-2 font-mono text-xl text-cyan-100">{summary.plans ?? 0}</p></div></div><Button className="mt-4 h-9 w-full border-white/10 bg-black/20 text-[10px] text-slate-300 hover:border-cyan-300/30 hover:text-cyan-100" onClick={() => router.push("/mission")} variant="outline"><Truck className="size-3.5" />Apri Mission</Button></section></div>
        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,.9fr)]"><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-lime-300/70">PLANNING / COVERAGE</p><h2 className="mt-1 text-[17px] font-semibold text-slate-100">Turni e copertura</h2><p className="mt-1 text-[11px] text-slate-500">I turni arrivano dalla pianificazione e restano legati a commesse, missioni e risorse reali.</p></div><Button className="h-8 border-white/10 bg-black/20 text-[10px] text-lime-100 hover:border-lime-300/30 hover:bg-lime-300/10" onClick={() => router.push("/planning")} variant="outline"><CalendarClock className="size-3.5" />Apri pianificazione</Button></div><div className="mt-4 space-y-2">{recentPlans.map((plan) => <article className="rounded-xl border border-white/[.08] bg-black/20 p-3.5" key={plan.id}><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2"><span className={`size-2 rounded-full ${plan.feasible ? "bg-lime-300 shadow-[0_0_10px_rgba(200,255,34,.75)]" : "bg-rose-400 shadow-[0_0_10px_rgba(255,85,56,.6)]"}`} /><p className="truncate text-xs font-semibold text-slate-100">{plan.title}</p></div><p className="mt-1 truncate text-[10px] text-slate-600">{plan.jobCode ? `${plan.jobCode} · ` : ""}{plan.jobTitle}</p></div><StatusPill status={plan.status} tone={plan.feasible ? statusTone(plan.status) : "red"} /></div><div className="mt-3 flex flex-wrap items-center gap-3 text-[10px] text-slate-500"><span><CalendarClock className="mr-1 inline size-3 text-lime-200" />{formatDate(plan.startsAt)} → {formatDate(plan.endsAt)}</span><span>{plan.resourceCount} risorse</span><span className={plan.feasible ? "text-lime-200" : "text-rose-200"}>{plan.feasible ? "CAPACITY OK" : "CONFLICT"}</span></div></article>)}{recentPlans.length === 0 && <div className="rounded-xl border border-dashed border-lime-300/10 p-8 text-center"><CalendarClock className="mx-auto size-7 text-slate-700" /><p className="mt-3 text-xs text-slate-500">Nessun turno nel readback.</p><Button className="mt-4 h-9 bg-lime-300 text-[10px] font-semibold text-[#060806] hover:bg-lime-200" onClick={() => router.push("/planning")} disabled={!canWritePlanning}><CalendarClock className="size-3.5" />Crea il primo turno</Button></div>}</div></section>
          <section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-cyan-200/70">ATTENDANCE / SIGNAL</p><h2 className="mt-1 text-[17px] font-semibold text-slate-100">Presenze e geofence</h2><p className="mt-1 text-[11px] text-slate-500">Timestamp server-side e posizione osservata soltanto durante l’azione di servizio.</p></div><span className="grid size-10 place-items-center rounded-2xl border border-cyan-300/20 bg-cyan-300/[.07] text-cyan-200"><MapPin className="size-5" /></span></div><div className="mt-5 grid grid-cols-2 gap-2"><div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">In servizio</p><p className="mt-2 font-mono text-2xl text-lime-100">{summary.inService ?? 0}</p></div><div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">Dentro geofence</p><p className="mt-2 font-mono text-2xl text-cyan-100">{summary.geofenceInside ?? 0}</p></div></div><div className="mt-4 space-y-2">{recentAttendance.slice(0, 3).map((record) => <div className="flex items-center gap-3 rounded-xl border border-white/[.07] bg-black/20 px-3 py-2.5" key={record.id}><span className={`size-2 rounded-full ${record.geofenceStatus === "INSIDE" ? "bg-lime-300" : "bg-slate-600"}`} /><div className="min-w-0 flex-1"><p className="truncate text-[11px] text-slate-300">{record.jobTitle}</p><p className="mt-1 text-[9px] text-slate-600">{record.workerId ?? "Operatore assegnato"} · {formatDate(record.recordedAt)}</p></div><span className="text-[9px] text-slate-500">{statusLabel(record.status)}</span></div>)}{recentAttendance.length === 0 && <p className="py-4 text-center text-[10px] text-slate-600">Nessuna timbratura nel readback.</p>}</div><Button className="mt-4 h-9 w-full border-white/10 bg-black/20 text-[10px] text-slate-300 hover:border-cyan-300/30 hover:text-cyan-100" onClick={() => router.push("/presenze")} variant="outline"><Clock3 className="size-3.5" />Registro presenze</Button></section></div>
        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,.95fr)]"><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-2xl border border-lime-300/25 bg-lime-300/10 text-lime-200"><ShieldCheck className="size-5" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-lime-300/70">AUTHORITY BOUNDARY</p><h2 className="mt-1 text-[17px] font-semibold text-slate-100">Registrazione identità fuori da Workforce</h2><p className="mt-2 text-[11px] leading-5 text-slate-500">L’invito, il ruolo Autista/Operatore, la sospensione e le capability sono governati da Authority. Solo dopo l’accettazione il server provisiona la risorsa operativa necessaria alle missioni.</p></div></div><div className="mt-5 grid gap-2 sm:grid-cols-3"><div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">Identity</p><p className="mt-2 text-xs text-lime-100">AUTHORITY</p></div><div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">Provisioning</p><p className="mt-2 text-xs text-cyan-100">ON ACCEPT</p></div><div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">Selection</p><p className="mt-2 text-xs text-lime-100">SERVER ONLY</p></div></div><div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-[10px] text-slate-600">Workforce create endpoint: {payload?.registration?.workforceCreation ?? "BLOCKED"}</p>{canReadAuthority || canManageAuthority ? <Button className="h-9 bg-lime-300 text-[10px] font-semibold text-[#060806] hover:bg-lime-200" onClick={openAuthority}><ShieldCheck className="size-3.5" />Gestisci in Authority<ArrowUpRight className="size-3.5" /></Button> : null}</div></section><section className="carbon-card-neon rounded-2xl p-4 sm:p-5"><div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-2xl border border-lime-300/25 bg-lime-300/10 text-lime-200"><Sparkles className="size-5" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-lime-300/70">COMPANY AI / WORKFORCE</p><h2 className="mt-1 text-[17px] font-semibold text-slate-100">Controllo capacità</h2></div><StatusPill status="PREVIEW" tone="cyan" /></div><p className="mt-3 text-[11px] leading-5 text-slate-500">Analisi governata di copertura, turni scoperti e disponibilità. Le scritture restano nei moduli Planning e Authority.</p><div className="mt-4 space-y-2"><button className="flex w-full items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-left text-[11px] text-slate-400 transition hover:border-lime-300/30 hover:text-lime-100" onClick={() => router.push("/command?prompt=Analizza%20copertura%20workforce")} type="button"><ChevronRight className="size-3.5 text-lime-300" />Analizza copertura workforce</button><button className="flex w-full items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-left text-[11px] text-slate-400 transition hover:border-lime-300/30 hover:text-lime-100" onClick={() => router.push("/command?prompt=Mostra%20turni%20scoperti")} type="button"><ChevronRight className="size-3.5 text-lime-300" />Mostra turni scoperti</button></div></section></div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-white/[.08] pt-4 text-[10px] text-slate-600"><span>AI-ZEROW COMMAND · WORKFORCE · MODULE 03</span><span className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_8px_rgba(190,255,60,.8)]" />Authority linked · server readback · no free-text assignment</span></div>
      </div>
    </section>
  </div><CommandMobileNav active="attendance" allowedNavigation={allowedNavigation} role={context?.role} />{notice && <button className="fixed bottom-5 right-5 z-50 max-w-[390px] rounded-xl border border-amber-300/25 bg-[#0a100c]/95 px-4 py-3 text-left text-xs text-amber-100 shadow-[0_0_28px_rgba(190,255,60,.14)] backdrop-blur-xl" onClick={() => setNotice("")} type="button"><CircleAlert className="mr-2 inline size-4 text-amber-200" />{notice}</button>}</main>;
}
