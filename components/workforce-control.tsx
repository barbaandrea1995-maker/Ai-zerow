"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  ArrowLeft,
  ArrowUpRight,
  Bell,
  BriefcaseBusiness,
  CalendarClock,
  ChevronRight,
  CircleAlert,
  Clock3,
  HardHat,
  Layers3,
  LoaderCircle,
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
import { AccountMenu } from "@/components/account-menu";
import { Button } from "@/components/ui/button";
import { CommandMobileNav } from "@/components/command-mobile-nav";
import { Input } from "@/components/ui/input";
import { TenantSwitcher } from "@/components/tenant-switcher";
import { getAllowedCommandNavigation, type CommandNavigationId } from "@/lib/command-dashboard";

type Tone = "lime" | "cyan" | "amber" | "red";

type WorkforceContext = {
  actorName: string;
  actorEmail: string;
  role: string;
  roles?: string[];
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

type WorkforcePayload = {
  context?: WorkforceContext;
  members?: WorkforceMember[];
  resources?: WorkforceResource[];
  summary?: {
    activePeople?: number;
    drivers?: number;
    availableResources?: number;
  };
  registration?: {
    owner?: string;
    route?: string;
    workforceCreation?: string;
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
  if (status === "active") return "ATTIVA";
  if (status === "AVAILABLE") return "DISPONIBILE";
  if (status === "ACTIVE") return "OPERATIVA";
  if (status === "BUSY") return "IMPEGNATA";
  if (status === "SUSPENDED") return "SOSPESA";
  return status.replaceAll("_", " ");
}

function resourceTypeLabel(entityType: string) {
  if (entityType === "driver") return "Autista";
  if (entityType === "person" || entityType === "worker") return "Operatore";
  if (entityType === "team") return "Squadra";
  if (entityType === "vehicle") return "Mezzo";
  if (entityType === "asset") return "Asset";
  return entityType.replaceAll("_", " ");
}

function statusTone(status: string): Tone {
  if (["active", "AVAILABLE", "ACTIVE", "OPERATIVO", "ONLINE"].includes(status)) return "lime";
  if (["BUSY", "PAUSED", "DRAFT"].includes(status)) return "amber";
  if (["SUSPENDED", "CONFLICTED"].includes(status)) return "red";
  return "cyan";
}

function IconButton({ label, children, onClick, className = "" }: { label: string; children: ReactNode; onClick?: () => void; className?: string }) {
  return <button aria-label={label} className={`grid size-9 place-items-center rounded-lg border border-white/10 bg-black/20 text-slate-500 transition hover:border-lime-300/35 hover:bg-lime-300/10 hover:text-lime-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300 ${className}`} onClick={onClick} type="button">{children}</button>;
}

function StatusPill({ status, tone = statusTone(status) }: { status: string; tone?: Tone }) {
  const style = toneStyles[tone];
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[9px] font-semibold uppercase tracking-[.06em] ${style.badge}`}><span className="size-1.5 rounded-full bg-current shadow-[0_0_8px_currentColor]" />{statusLabel(status)}</span>;
}

function KpiCard({ label, value, detail, icon: Icon, tone }: { label: string; value: number | string; detail: string; icon: LucideIcon; tone: Tone }) {
  return <article className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><span className={`grid size-10 place-items-center rounded-xl border border-current/20 bg-current/10 ${toneStyles[tone].icon}`}><Icon className="size-[18px]" /></span><StatusPill status={detail} tone={tone} /></div><p className="mt-5 text-[10px] font-semibold uppercase tracking-[.16em] text-slate-600">{label}</p><p className="mt-2 font-mono text-[32px] font-semibold leading-none tracking-[-.07em] text-slate-50">{value}</p><p className="mt-4 text-[10px] text-slate-600">Dati operativi aggiornati</p></article>;
}

export default function WorkforceControl() {
  const router = useRouter();
  const [payload, setPayload] = useState<WorkforcePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [query, setQuery] = useState("");
  const [resourceFilter, setResourceFilter] = useState<"ALL" | "DRIVER" | "PERSON" | "AVAILABLE">("ALL");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/workforce/overview", { cache: "no-store" });
      const next = await response.json() as WorkforcePayload;
      if (!response.ok) throw new Error(next.error ?? "workforce_overview_unavailable");
      setPayload(next);
      setNotice("");
    } catch {
      setNotice("Le risorse operative non sono disponibili in questo momento. Riprova tra poco.");
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
  const summary = payload?.summary ?? {};
  const canReadAuthority = capabilities.includes("authority.read") || capabilities.includes("authority.manage");
  const canReadPlanning = capabilities.includes("planning.read");
  const canReadMission = capabilities.includes("mission.read");
  const canReadAttendance = capabilities.includes("workforce.read");

  const memberByResource = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);
  const filteredResources = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return resources.filter((resource) => {
      const linkedMember = resource.authorityMembershipId ? memberByResource.get(resource.authorityMembershipId) : undefined;
      const searchable = `${resource.label} ${resource.code ?? ""} ${resource.entityType} ${linkedMember?.name ?? ""} ${linkedMember?.roleLabel ?? ""} ${resource.qualifications.join(" ")}`.toLowerCase();
      const matchesQuery = !normalized || searchable.includes(normalized);
      const matchesFilter = resourceFilter === "ALL"
        || (resourceFilter === "DRIVER" && resource.entityType === "driver")
        || (resourceFilter === "PERSON" && ["person", "worker", "team"].includes(resource.entityType))
        || (resourceFilter === "AVAILABLE" && resource.available);
      return matchesQuery && matchesFilter;
    });
  }, [memberByResource, query, resourceFilter, resources]);

  const availableResources = resources.filter((resource) => resource.available);
  const drivers = resources.filter((resource) => resource.entityType === "driver");
  const availableDrivers = drivers.filter((resource) => resource.available);
  const occupiedResources = resources.filter((resource) => !resource.available);
  const conflictedResources = resources.filter((resource) => resource.conflict);
  const unprovisionedMembers = members.filter((member) => member.status === "active" && !resources.some((resource) => resource.authorityMembershipId === member.id));
  const actor = { email: context?.actorEmail ?? "operator@zerow.local", name: context?.actorName ?? "Operatore" };

  function navigate(item: NavItem) {
    setMobileMenu(false);
    router.push(item.path);
  }

  function goBack() {
    if (window.history.length > 1) router.back();
    else router.push("/command");
  }

  function openAuthority() {
    if (!canReadAuthority) {
      setNotice("Authority non è incluso nel tuo perimetro. Chiedi al responsabile dell’azienda.");
      return;
    }
    router.push("/onboarding");
  }

  if (loading && !payload) {
    return <main className="grid min-h-screen place-items-center bg-[#030504] text-xs text-slate-500"><LoaderCircle className="mr-2 inline size-4 animate-spin text-lime-300" />Apertura risorse operative…</main>;
  }

  return <main className="zw-app-shell zw-command-ultra min-h-screen overflow-x-hidden text-slate-100 selection:bg-lime-300 selection:text-[#060806]"><div className="zw-command-ambient" aria-hidden="true" /><div className="relative flex min-h-screen">
    <aside className={`zw-command-sidebar fixed inset-y-0 left-0 z-40 flex flex-col px-3 py-4 transition-[width,transform] lg:static lg:translate-x-0 ${sidebarCollapsed ? "is-collapsed lg:w-[76px]" : "lg:w-[248px]"} ${mobileMenu ? "translate-x-0" : "-translate-x-full"}`}>
      <div className="flex items-center justify-between px-2"><button aria-label="Apri Control" className="flex min-w-0 items-center gap-3 text-left" onClick={() => { setMobileMenu(false); router.push("/command"); }} type="button"><span className="neon-pulse relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black shadow-[0_0_22px_rgba(200,255,34,.12)]"><Image src="/ai-zerow-icon.jpeg" alt="AI-ZEROW" width={40} height={40} className="size-full object-cover" /></span><span className="zw-command-sidebar__brand-copy min-w-0"><span className="block text-sm font-bold tracking-[.18em] text-slate-50">AI-ZEROW</span><span className="block text-[10px] uppercase tracking-[.22em] text-lime-300/75">command</span></span></button><div className="flex items-center gap-1"><IconButton label={sidebarCollapsed ? "Espandi sidebar" : "Riduci sidebar"} className="hidden lg:grid" onClick={() => setSidebarCollapsed((value) => !value)}>{sidebarCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}</IconButton><IconButton label="Chiudi menu" className="lg:hidden" onClick={() => setMobileMenu(false)}><X className="size-4" /></IconButton></div></div>
      <div className="zw-command-tenant mt-7 flex items-center gap-3 rounded-2xl p-3"><span className="grid size-9 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/10 text-lime-200"><HardHat className="size-4" /></span><span className="zw-command-sidebar__tenant-copy min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-slate-200">ZEROW workspace</span><span className="mt-0.5 block truncate text-[10px] uppercase tracking-[.1em] text-slate-600">{roleLabel(context?.role ?? "workforce")} · profilo operativo</span></span></div>
      <nav className="mt-6 min-h-0 flex-1 overflow-y-auto" aria-label="Navigazione principale"><p className="zw-command-sidebar__nav-caption px-3 text-[9px] font-semibold uppercase tracking-[.22em] text-slate-700">Area autorizzata</p><div className="mt-2 space-y-1">{visibleNavItems.map((item) => { const Icon = item.icon; const active = item.id === "workforce"; return <button aria-current={active ? "page" : undefined} aria-label={sidebarCollapsed ? item.label : undefined} className={`zw-command-nav-item ${active ? "is-active" : ""}`} key={item.id} onClick={() => navigate(item)} title={sidebarCollapsed ? item.label : undefined} type="button"><Icon className={`size-4 ${active ? "text-lime-200" : "text-slate-600 group-hover:text-slate-300"}`} /><span className="zw-command-sidebar__nav-label">{item.label}</span>{item.id === "command" && <span className="zw-command-sidebar__nav-badge ml-auto rounded border border-lime-300/20 px-1.5 py-0.5 font-mono text-[8px] tracking-[.08em] text-lime-200">AI</span>}</button>; })}</div></nav>
      <div className="zw-command-sidebar__footer mt-4 border-t border-white/[.07] pt-4"><div className="flex items-center justify-between px-2 text-[9px] uppercase tracking-[.14em] text-slate-600"><span>Sistema</span><span className="flex items-center gap-1.5 text-lime-200"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_10px_rgba(200,255,34,.9)]" />{payload?.readback?.status === "verified" ? "DATI AGGIORNATI" : "AGGIORNAMENTO"}</span></div><div className="zw-command-core-status mt-3 rounded-xl p-3"><p className="font-mono text-[9px] text-slate-500">{resources.length} RISORSE</p><p className="mt-2 font-mono text-[9px] text-lime-300/60">PROFILO / {roleLabel(context?.role ?? "workforce").toUpperCase()}</p></div></div>
    </aside>
    {mobileMenu && <button className="fixed inset-0 z-30 bg-black/75 lg:hidden" onClick={() => setMobileMenu(false)} aria-label="Chiudi menu" type="button" />}
    <section className="min-w-0 flex-1"><header className="zw-command-topbar sticky top-0 z-20 flex h-[72px] items-center gap-3 px-4 sm:gap-5 sm:px-7"><IconButton label="Apri menu" onClick={() => setMobileMenu(true)} className="lg:hidden"><Menu className="size-4" /></IconButton><button aria-label="Apri Workforce" className="zw-command-topbar__brand flex shrink-0 items-center gap-2 text-left" onClick={() => router.push("/workforce")} type="button"><span className="relative grid size-9 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black shadow-[0_0_18px_rgba(200,255,34,.12)]"><Image src="/ai-zerow-icon.jpeg" alt="ZEROW" width={36} height={36} className="size-full object-cover" /></span><span className="zw-command-topbar__wordmark hidden sm:block"><span className="block text-[11px] font-bold tracking-[.18em] text-slate-50">ZEROW</span><span className="block text-[9px] uppercase tracking-[.2em] text-lime-300/75">workforce</span></span></button><IconButton className="hidden lg:grid" label={sidebarCollapsed ? "Espandi sidebar" : "Riduci sidebar"} onClick={() => setSidebarCollapsed((value) => !value)}>{sidebarCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}</IconButton><div className="relative hidden min-w-0 flex-1 justify-center md:flex"><div className="relative w-full max-w-[520px]"><Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-600" /><Input aria-label="Cerca nelle risorse operative" className="h-10 w-full border-lime-300/10 bg-black/35 pl-10 text-xs text-slate-100 placeholder:text-slate-600" onChange={(event) => setQuery(event.target.value)} placeholder="Cerca persone, squadre, qualifiche…" value={query} /></div></div><div className="flex min-w-0 flex-1 items-center gap-2 md:hidden"><span className="truncate text-xs font-semibold tracking-[.14em] text-slate-200">WORKFORCE</span><span className="size-1 rounded-full bg-lime-300" /></div><div className="ml-auto flex min-w-0 items-center gap-2"><TenantSwitcher /><span className="hidden items-center gap-2 rounded-full border border-lime-300/20 bg-lime-300/5 px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[.12em] text-lime-200 sm:flex"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_9px_rgba(200,255,34,.9)]" />{refreshing ? "AGGIORNAMENTO" : "DATI AGGIORNATI"}</span><IconButton className="zw-command-topbar__back" label="Torna indietro" onClick={goBack}><ArrowLeft className="size-4" /></IconButton><IconButton className="zw-command-topbar__refresh" label="Aggiorna risorse" onClick={() => void refresh()}><RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} /></IconButton>{capabilities.includes("communication.read") && <IconButton className="zw-command-topbar__notifications" label="Apri comunicazioni" onClick={() => router.push("/communications")}><Bell className="size-4" /></IconButton>}<AccountMenu actor={actor} /></div></header>
      <div className="mx-auto max-w-[1920px] px-4 py-5 sm:px-7 sm:py-7"><div className="mb-5 flex flex-wrap items-end justify-between gap-4"><div><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.2em] text-lime-300/70"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_9px_rgba(190,255,60,.9)]" />AI-ZEROW / WORKFORCE</div><h1 className="mt-2 text-2xl font-semibold tracking-[-.04em] text-slate-50 sm:text-[28px]">Risorse operative</h1><p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">Persone, squadre e mezzi pronti per essere collegati alle attività · {payload?.readback?.status === "verified" ? "dati operativi aggiornati" : "aggiornamento in corso"}</p></div><div className="flex flex-wrap items-center gap-2">{canReadAuthority && <Button className="h-10 rounded-xl border-lime-100/55 px-4 text-xs shadow-[0_0_30px_rgba(190,255,60,.18)]" onClick={openAuthority}><ShieldCheck className="size-4" />Authority</Button>}{canReadPlanning && <Button className="h-10 rounded-xl border-white/10 bg-black/25 text-xs text-slate-300 hover:border-cyan-300/30 hover:bg-cyan-300/10 hover:text-cyan-100" onClick={() => router.push("/planning")} variant="outline"><CalendarClock className="size-4" />Pianificazione</Button>}</div></div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><KpiCard label="Persone autorizzate" value={summary.activePeople ?? 0} detail="ATTIVE" icon={Users} tone="lime" /><KpiCard label="Risorse operative" value={resources.length} detail="REGISTRO" icon={BriefcaseBusiness} tone="cyan" /><KpiCard label="Disponibili ora" value={summary.availableResources ?? availableResources.length} detail="PRONTE" icon={Sparkles} tone="lime" /><KpiCard label="Autisti disponibili" value={availableDrivers.length} detail="SELEZIONABILI" icon={Truck} tone="amber" /></div>
        <div className="mt-4 grid gap-4 2xl:grid-cols-[minmax(0,1.18fr)_minmax(340px,.82fr)]"><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-lime-300/70">REGISTRO OPERATIVO</p><h2 className="mt-1 text-[17px] font-semibold text-slate-100">Risorse assegnabili</h2><p className="mt-1 text-[11px] text-slate-500">Disponibilità, qualifiche e impegni già presenti. La scelta finale viene sempre ricontrollata nel modulo di destinazione.</p></div><div className="flex items-center gap-2"><StatusPill status="UPDATED" /><IconButton label="Aggiorna registro" onClick={() => void refresh()}><RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} /></IconButton></div></div><div className="mt-4 flex flex-wrap items-center gap-2"><div className="relative min-w-[220px] flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-600" /><Input aria-label="Cerca risorse" className="h-9 border-white/10 bg-black/25 pl-9 text-[11px]" onChange={(event) => setQuery(event.target.value)} placeholder="Cerca nome, tipo, qualifica…" value={query} /></div>{(["ALL", "PERSON", "DRIVER", "AVAILABLE"] as const).map((filter) => <button className={`rounded-lg border px-3 py-2 text-[10px] font-semibold transition ${resourceFilter === filter ? "border-lime-300/35 bg-lime-300/10 text-lime-100" : "border-white/10 bg-black/20 text-slate-500 hover:border-lime-300/25 hover:text-lime-100"}`} key={filter} onClick={() => setResourceFilter(filter)} type="button">{filter === "ALL" ? "Tutte" : filter === "PERSON" ? "Persone e squadre" : filter === "DRIVER" ? "Autisti" : "Disponibili"}</button>)}</div><div className="mt-4 overflow-hidden rounded-xl border border-white/[.08] bg-black/20"><div className="hidden grid-cols-[minmax(0,1.4fr)_120px_minmax(130px,.8fr)_125px] gap-3 border-b border-white/[.08] px-4 py-3 text-[9px] font-semibold uppercase tracking-[.14em] text-slate-600 md:grid"><span>Risorsa</span><span>Tipologia</span><span>Qualifiche</span><span>Disponibilità</span></div>{filteredResources.map((resource) => { const linkedMember = resource.authorityMembershipId ? memberByResource.get(resource.authorityMembershipId) : undefined; const resourceTone = resource.conflict ? "amber" : resource.available ? "lime" : "cyan"; return <article className="grid gap-3 border-b border-white/[.06] px-4 py-3.5 last:border-b-0 md:grid-cols-[minmax(0,1.4fr)_120px_minmax(130px,.8fr)_125px] md:items-center" key={resource.id}><div className="flex min-w-0 items-center gap-3"><span className={`grid size-9 shrink-0 place-items-center rounded-xl border ${resource.entityType === "driver" ? "border-cyan-300/20 bg-cyan-300/[.07] text-cyan-100" : "border-lime-300/20 bg-lime-300/[.07] text-lime-100"}`}>{resource.entityType === "driver" ? <Truck className="size-4" /> : resource.entityType === "team" ? <Users className="size-4" /> : <HardHat className="size-4" />}</span><div className="min-w-0"><p className="truncate text-xs font-semibold text-slate-200">{resource.label}</p><p className="mt-1 truncate text-[10px] text-slate-600">{linkedMember?.roleLabel ?? resourceTypeLabel(resource.entityType)} · {resource.code ?? "Codice assegnato automaticamente"}</p>{resource.conflict && <p className="mt-1 truncate text-[10px] text-amber-200/80">Impegnata: {resource.conflict.title} · {formatDate(resource.conflict.startsAt)}</p>}</div></div><div><span className="text-[10px] font-medium text-slate-300">{resourceTypeLabel(resource.entityType)}</span><span className="mt-1 block text-[9px] text-slate-600">{linkedMember ? "persona autorizzata" : "risorsa registrata"}</span></div><div className="flex flex-wrap gap-1.5">{resource.qualifications.length > 0 ? resource.qualifications.slice(0, 3).map((qualification) => <span className="rounded-full border border-white/10 px-2 py-1 text-[9px] text-slate-500" key={qualification}>{qualification}</span>) : <span className="text-[10px] text-slate-600">Nessuna qualifica indicata</span>}</div><div><StatusPill status={resource.conflict ? "BUSY" : resource.available ? "AVAILABLE" : resource.status} tone={resourceTone} /></div></article>; })}{filteredResources.length === 0 && <div className="px-4 py-12 text-center"><Users className="mx-auto size-7 text-slate-700" /><p className="mt-3 text-xs font-medium text-slate-400">Nessuna risorsa nel filtro corrente</p><p className="mt-1 text-[10px] text-slate-600">Prova a cambiare ricerca o filtro.</p></div>}</div>{unprovisionedMembers.length > 0 && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-lime-300/15 bg-lime-300/[.035] px-3.5 py-3"><div className="flex items-start gap-2"><ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-lime-200" /><p className="text-[10px] leading-5 text-slate-500">{unprovisionedMembers.length} persona{unprovisionedMembers.length === 1 ? "a" : "e"} autorizzata non ha ancora una risorsa operativa collegata.</p></div>{canReadAuthority && <Button className="h-8 shrink-0 border-white/10 bg-black/25 text-[10px] text-lime-100 hover:border-lime-300/30 hover:bg-lime-300/10" onClick={openAuthority} variant="outline"><ShieldCheck className="size-3.5" />Completa in Authority</Button>}</div>}</section>
          <section className="carbon-card-neon rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-cyan-200/70">DISPONIBILITÀ</p><h2 className="mt-1 text-[17px] font-semibold text-slate-100">Quadro operativo</h2><p className="mt-1 text-[11px] text-slate-500">Una vista sintetica per capire chi può essere collegato a un’attività in questo momento.</p></div><span className="grid size-10 place-items-center rounded-2xl border border-cyan-300/20 bg-cyan-300/[.07] text-cyan-200"><Sparkles className="size-5" /></span></div><div className="mt-5 grid grid-cols-2 gap-2"><div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">Disponibili</p><p className="mt-2 font-mono text-xl text-lime-100">{availableResources.length}</p></div><div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">Impegnate</p><p className="mt-2 font-mono text-xl text-amber-100">{occupiedResources.length}</p></div><div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">Autisti</p><p className="mt-2 font-mono text-xl text-cyan-100">{drivers.length}</p></div><div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">Con attenzione</p><p className="mt-2 font-mono text-xl text-amber-100">{conflictedResources.length}</p></div></div><div className="mt-5 space-y-2">{conflictedResources.slice(0, 3).map((resource) => <div className="rounded-xl border border-amber-300/15 bg-amber-300/[.035] px-3 py-2.5" key={resource.id}><div className="flex items-center justify-between gap-2"><p className="truncate text-[11px] font-medium text-slate-300">{resource.label}</p><StatusPill status="BUSY" tone="amber" /></div><p className="mt-1 truncate text-[9px] text-slate-600">{resource.conflict?.title} · {formatDate(resource.conflict?.startsAt ?? null)}</p></div>)}{conflictedResources.length === 0 && <p className="rounded-xl border border-dashed border-cyan-300/15 p-5 text-center text-[10px] text-slate-600">Nessun impegno in conflitto rilevato.</p>}</div>{canReadMission && <Button className="mt-5 h-9 w-full border-white/10 bg-black/20 text-[10px] text-slate-300 hover:border-cyan-300/30 hover:text-cyan-100" onClick={() => router.push("/mission")} variant="outline"><Truck className="size-3.5" />Apri Missioni</Button>}</section></div>
        <section className="mt-4 carbon-card rounded-2xl p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-lime-300/70">COLLEGAMENTI OPERATIVI</p><h2 className="mt-1 text-[17px] font-semibold text-slate-100">Ogni modulo al posto giusto</h2><p className="mt-1 text-[11px] text-slate-500">Workforce legge la disponibilità e rimanda la gestione al modulo responsabile, senza duplicare registri o azioni.</p></div><StatusPill status="PERIMETRO CHIARO" tone="lime" /></div><div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4"><button className="group rounded-xl border border-white/[.08] bg-black/20 p-4 text-left transition hover:border-lime-300/30 hover:bg-lime-300/[.04]" onClick={openAuthority} type="button" disabled={!canReadAuthority}><div className="flex items-center justify-between"><ShieldCheck className="size-5 text-lime-200" /><ArrowUpRight className="size-4 text-slate-600 transition group-hover:text-lime-200" /></div><p className="mt-4 text-xs font-semibold text-slate-200">Authority</p><p className="mt-1 text-[10px] leading-5 text-slate-600">Persone, mansioni e accessi.</p></button>{canReadPlanning && <button className="group rounded-xl border border-white/[.08] bg-black/20 p-4 text-left transition hover:border-lime-300/30 hover:bg-lime-300/[.04]" onClick={() => router.push("/planning")} type="button"><div className="flex items-center justify-between"><CalendarClock className="size-5 text-cyan-200" /><ArrowUpRight className="size-4 text-slate-600 transition group-hover:text-lime-200" /></div><p className="mt-4 text-xs font-semibold text-slate-200">Pianificazione</p><p className="mt-1 text-[10px] leading-5 text-slate-600">Attività, turni e assegnazioni.</p></button>}{canReadAttendance && <button className="group rounded-xl border border-white/[.08] bg-black/20 p-4 text-left transition hover:border-lime-300/30 hover:bg-lime-300/[.04]" onClick={() => router.push("/presenze")} type="button"><div className="flex items-center justify-between"><Clock3 className="size-5 text-cyan-200" /><ArrowUpRight className="size-4 text-slate-600 transition group-hover:text-lime-200" /></div><p className="mt-4 text-xs font-semibold text-slate-200">Presenze</p><p className="mt-1 text-[10px] leading-5 text-slate-600">Timbrature, posizione e geofence.</p></button>}{canReadMission && <button className="group rounded-xl border border-white/[.08] bg-black/20 p-4 text-left transition hover:border-lime-300/30 hover:bg-lime-300/[.04]" onClick={() => router.push("/mission")} type="button"><div className="flex items-center justify-between"><Truck className="size-5 text-amber-200" /><ArrowUpRight className="size-4 text-slate-600 transition group-hover:text-lime-200" /></div><p className="mt-4 text-xs font-semibold text-slate-200">Missioni</p><p className="mt-1 text-[10px] leading-5 text-slate-600">Viaggi e selezione di autista e mezzo.</p></button>}</div></section>
        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,.8fr)]"><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-2xl border border-lime-300/25 bg-lime-300/10 text-lime-200"><ShieldCheck className="size-5" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-lime-300/70">PERIMETRO DEL MODULO</p><h2 className="mt-1 text-[17px] font-semibold text-slate-100">Qui non si creano persone</h2><p className="mt-2 text-[11px] leading-5 text-slate-500">Le persone entrano nel sistema tramite Authority. Dopo l’abilitazione, Workforce mostra la risorsa operativa e la sua disponibilità. La gestione resta nel modulo proprietario.</p></div></div><div className="mt-5 grid gap-2 sm:grid-cols-3"><div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">Persone</p><p className="mt-2 text-xs text-lime-100">AUTHORITY</p></div><div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">Disponibilità</p><p className="mt-2 text-xs text-cyan-100">WORKFORCE</p></div><div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">Assegnazione</p><p className="mt-2 text-xs text-amber-100">MODULO DESTINAZIONE</p></div></div></section><section className="carbon-card-neon rounded-2xl p-4 sm:p-5"><div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-2xl border border-lime-300/25 bg-lime-300/10 text-lime-200"><Sparkles className="size-5" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-lime-300/70">COMPANY AI</p><h2 className="mt-1 text-[17px] font-semibold text-slate-100">Leggi la capacità del team</h2></div><StatusPill status="ASSISTITA" tone="cyan" /></div><p className="mt-3 text-[11px] leading-5 text-slate-500">Company AI può evidenziare scoperture, sovraccarichi e risorse non pronte. Le modifiche restano nei moduli autorizzati.</p><div className="mt-4 space-y-2"><button className="flex w-full items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-left text-[11px] text-slate-400 transition hover:border-lime-300/30 hover:text-lime-100" onClick={() => router.push("/command?prompt=Analizza%20disponibilita%20risorse")} type="button"><ChevronRight className="size-3.5 text-lime-300" />Analizza disponibilità risorse</button><button className="flex w-full items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-left text-[11px] text-slate-400 transition hover:border-lime-300/30 hover:text-lime-100" onClick={() => router.push("/command?prompt=Individua%20risorse%20non%20pronte")} type="button"><ChevronRight className="size-3.5 text-lime-300" />Individua risorse non pronte</button></div></section></div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-white/[.08] pt-4 text-[10px] text-slate-600"><span>AI-ZEROW COMMAND · RISORSE OPERATIVE</span><span className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_8px_rgba(190,255,60,.8)]" />Disponibilità aggiornata · accesso personalizzato</span></div>
      </div>
    </section>
  </div><CommandMobileNav active="more" allowedNavigation={allowedNavigation} role={context?.role} roles={context?.roles} />{notice && <button className="fixed bottom-5 right-5 z-50 max-w-[390px] rounded-xl border border-amber-300/25 bg-[#0a100c]/95 px-4 py-3 text-left text-xs text-amber-100 shadow-[0_0_28px_rgba(190,255,60,.14)] backdrop-blur-xl" onClick={() => setNotice("")} type="button"><CircleAlert className="mr-2 inline size-4 text-amber-200" />{notice}</button>}</main>;
}
