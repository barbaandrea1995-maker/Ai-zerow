"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowLeft,
  Bell,
  BriefcaseBusiness,
  CheckCircle2,
  CircleAlert,
  Database,
  DatabaseBackup,
  FileCheck2,
  HardDrive,
  KeyRound,
  Layers3,
  LockKeyhole,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  TimerReset,
  Users,
  X,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { AccountMenu, type AccountActor } from "@/components/account-menu";
import { CommandMobileNav } from "@/components/command-mobile-nav";
import { Input } from "@/components/ui/input";
import type { CommandNavigationId, CommandSurfaceAccess } from "@/lib/command-dashboard";
import { authorityRoleLabel } from "@/lib/authority-catalog";
import { RELEASE_BUILD_LABEL } from "@/lib/release";
import type { SecurityControl, SecurityControlDomain, SecurityControlStatus } from "@/lib/security-governance";

type SecuritySnapshot = {
  contract?: { tranche?: string; commercialStatus?: string; directWrite?: boolean };
  authority?: { role?: string; identityProvider?: string; tenantScope?: string; authorityManage?: boolean };
  controls?: SecurityControl[];
  summary?: { status?: "READY" | "PARTIAL"; commercialStatus?: "GO" | "NO_GO"; ready?: number; open?: number; provider?: number; review?: number; total?: number };
  evidence?: { ledger?: { status?: string; count?: number }; externalRegistry?: { status?: string; persistedChecks?: number }; restore?: { d1?: string; r2?: string } };
  readback?: { checkedAt?: string };
  error?: string;
};

type Filter = "ALL" | SecurityControlDomain;

const statusTone: Record<SecurityControlStatus, { label: string; badge: string; icon: string }> = {
  READY: { label: "READY", badge: "border-lime-300/25 bg-lime-300/10 text-lime-200", icon: "text-lime-200" },
  PARTIAL: { label: "PARTIAL", badge: "border-cyan-300/25 bg-cyan-300/10 text-cyan-200", icon: "text-cyan-200" },
  NOT_RUN: { label: "NOT RUN", badge: "border-amber-300/25 bg-amber-300/10 text-amber-200", icon: "text-amber-200" },
  BLOCKED: { label: "BLOCKED", badge: "border-rose-300/25 bg-rose-300/10 text-rose-200", icon: "text-rose-200" },
  PENDING_REVIEW: { label: "REVIEW", badge: "border-violet-300/25 bg-violet-300/10 text-violet-200", icon: "text-violet-200" },
};

const domainLabels: Record<Filter, string> = {
  ALL: "Tutti",
  security: "Security",
  privacy: "Privacy",
  resilience: "Resilience",
  provider: "Provider",
  release: "Release",
};

const navItems: Array<{ id: CommandNavigationId; label: string; path: string; icon: LucideIcon }> = [
  { id: "command", label: "Command", path: "/command", icon: Sparkles },
  { id: "operations", label: "Commesse", path: "/operations", icon: BriefcaseBusiness },
  { id: "workforce", label: "Workforce", path: "/workforce", icon: Users },
  { id: "planning", label: "Pianificazione", path: "/planning", icon: Activity },
  { id: "attendance", label: "Presenze", path: "/presenze", icon: TimerReset },
  { id: "finance", label: "Finance", path: "/finance", icon: Database },
  { id: "procurement", label: "Procurement", path: "/procurement", icon: HardDrive },
  { id: "assets", label: "Asset", path: "/assets", icon: HardDrive },
  { id: "warehouse", label: "Magazzino", path: "/warehouse", icon: Database },
  { id: "mission", label: "Missioni", path: "/mission", icon: BriefcaseBusiness },
  { id: "documents", label: "Documenti", path: "/documents", icon: FileCheck2 },
  { id: "governance", label: "Governance", path: "/governance", icon: ShieldCheck },
  { id: "communications", label: "Comunicazioni", path: "/communications", icon: Bell },
  { id: "externals", label: "Adapter esterni", path: "/externals", icon: Layers3 },
  { id: "authority", label: "Authority", path: "/onboarding", icon: KeyRound },
  { id: "events", label: "Eventi", path: "/events", icon: Activity },
  { id: "pwa", label: "PWA / Mobile", path: "/pwa/diagnostics", icon: DatabaseBackup },
  { id: "settings", label: "Impostazioni", path: "/settings", icon: HardDrive },
];

function StatusBadge({ status }: { status: SecurityControlStatus }) {
  const tone = statusTone[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] ${tone.badge}`}>
      <span className="size-1.5 rounded-full bg-current" />
      {tone.label}
    </span>
  );
}

function StatusIcon({ status }: { status: SecurityControlStatus }) {
  const Icon = status === "READY" ? CheckCircle2 : status === "BLOCKED" ? XCircle : CircleAlert;
  return <Icon className={`size-[18px] ${statusTone[status].icon}`} />;
}

function IconButton({ label, children, className = "", onClick }: { label: string; children: ReactNode; className?: string; onClick: () => void }) {
  return (
    <button aria-label={label} className={`grid size-10 place-items-center rounded-xl border border-white/10 bg-black/20 text-slate-400 transition hover:border-lime-300/30 hover:bg-lime-300/5 hover:text-lime-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300/60 ${className}`} onClick={onClick} type="button">
      {children}
    </button>
  );
}

function Metric({ icon: Icon, label, value, detail, status = "READY" }: { icon: LucideIcon; label: string; value: string; detail: string; status?: SecurityControlStatus }) {
  return (
    <article className="carbon-card carbon-card-neon rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        <span className={`grid size-9 place-items-center rounded-xl border border-current/20 bg-current/10 ${statusTone[status].icon}`}><Icon className="size-[18px]" /></span>
        <StatusBadge status={status} />
      </div>
      <p className="mt-4 text-[11px] text-slate-500">{label}</p>
      <p className="mt-1 font-mono text-2xl font-semibold leading-none tracking-[-0.06em] text-slate-50">{value}</p>
      <p className="mt-3 text-[10px] leading-4 text-slate-600">{detail}</p>
    </article>
  );
}

function NavButton({ children, active, onClick }: { children: ReactNode; active?: boolean; onClick: () => void }) {
  return <button aria-current={active ? "page" : undefined} className={`group flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-xs font-semibold transition ${active ? "border-lime-300/25 bg-lime-300/10 text-lime-200 shadow-[inset_3px_0_0_#c8ff22]" : "border-transparent text-slate-500 hover:border-lime-300/10 hover:bg-white/[0.045] hover:text-slate-100"}`} onClick={onClick} type="button">{children}</button>;
}

export default function SecurityPrivacyControl({ access, actor, role }: { access: Pick<CommandSurfaceAccess, "allowedNavigation" | "roles">; actor: AccountActor; role: string }) {
  const router = useRouter();
  const [data, setData] = useState<SecuritySnapshot>({});
  const [filter, setFilter] = useState<Filter>("ALL");
  const [loading, setLoading] = useState(true);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/governance/security-readiness", { cache: "no-store" });
      const payload = await response.json() as SecuritySnapshot;
      if (!response.ok) throw new Error(payload.error || "security_readiness_unavailable");
      setData(payload);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Readiness security non disponibile");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const controls = useMemo(() => data.controls ?? [], [data.controls]);
  const filteredControls = useMemo(() => {
    const term = search.trim().toLowerCase();
    return controls.filter((control) => {
      const inDomain = filter === "ALL" || control.domain === filter;
      if (!term) return inDomain;
      return inDomain && `${control.label} ${control.detail} ${control.evidence} ${control.nextAction}`.toLowerCase().includes(term);
    });
  }, [controls, filter, search]);
  const summary = data.summary;
  const openControls = controls.filter((control) => control.status !== "READY");
  const lastCheck = data.readback?.checkedAt ? new Date(data.readback.checkedAt).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }) : "—";
  const visibleNavigation = navItems.filter((item) => access.allowedNavigation.includes(item.id));
  const canReadCommunications = access.allowedNavigation.includes("communications");

  return (
    <main className="zw-app-shell zw-command-ultra min-h-screen overflow-x-hidden text-slate-100 selection:bg-lime-300 selection:text-[#060806]">
      <div className="zw-command-ambient" aria-hidden="true" />
      <div className="relative flex min-h-screen">
        <aside className={`zw-command-sidebar fixed inset-y-0 left-0 z-40 flex flex-col px-3 py-4 transition-[width,transform] lg:static lg:translate-x-0 ${sidebarCollapsed ? "is-collapsed lg:w-[76px]" : "lg:w-[248px]"} ${mobileMenu ? "translate-x-0" : "-translate-x-full"}`}>
          <div className="flex items-center justify-between px-2">
            <button aria-label="Apri Command" className="flex min-w-0 items-center gap-3 text-left" onClick={() => { setMobileMenu(false); router.push("/command"); }} type="button">
              <span className="neon-pulse relative grid size-10 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black"><Image src="/ai-zerow-icon.jpeg" alt="AI-ZEROW" width={40} height={40} className="size-full object-cover" /></span>
              <span className="zw-command-sidebar__brand-copy min-w-0"><span className="block text-sm font-bold tracking-[0.18em] text-slate-50">AI-ZEROW</span><span className="block text-[10px] uppercase tracking-[0.22em] text-lime-300/75">command</span></span>
            </button>
            <div className="flex items-center gap-1"><button aria-label={sidebarCollapsed ? "Espandi sidebar" : "Riduci sidebar"} className="zw-command-sidebar__collapse hidden size-8 place-items-center rounded-lg text-slate-500 hover:bg-lime-300/10 hover:text-lime-200 lg:grid" onClick={() => setSidebarCollapsed((value) => !value)} type="button">{sidebarCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}</button><button aria-label="Chiudi menu" className="grid size-9 place-items-center rounded-xl text-slate-500 hover:bg-white/5 hover:text-white lg:hidden" onClick={() => setMobileMenu(false)} type="button"><X className="size-4" /></button></div>
          </div>
          <div className="zw-command-tenant mt-7 flex items-center gap-3 rounded-2xl p-3"><span className="grid size-9 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/10 text-lime-200"><LockKeyhole className="size-4" /></span><span className="zw-command-sidebar__tenant-copy min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-slate-200">ZEROW workspace</span><span className="mt-0.5 block truncate text-[10px] uppercase tracking-[0.1em] text-slate-600">{role} · tenant scoped</span></span></div>
          <nav className="mt-6 min-h-0 flex-1 overflow-y-auto" aria-label="Navigazione principale"><p className="zw-command-sidebar__nav-caption px-3 text-[9px] font-semibold uppercase tracking-[0.22em] text-slate-700">Authorized workspace</p><div className="mt-2 space-y-1">{visibleNavigation.map((item) => { const Icon = item.icon; const active = item.id === "governance"; return <NavButton active={active} key={item.id} onClick={() => { setMobileMenu(false); router.push(item.path); }}><Icon className="size-4" /><span className="zw-command-sidebar__nav-label">{item.label}</span></NavButton>; })}</div></nav>
          <div className="zw-command-sidebar__footer mt-4 border-t border-white/[0.07] pt-4"><div className="flex items-center justify-between px-2 text-[9px] uppercase tracking-[0.14em] text-slate-600"><span>Security core</span><span className="flex items-center gap-1.5 text-lime-200"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_10px_rgba(200,255,34,.9)]" />{summary?.commercialStatus === "GO" ? "READY" : "GATED"}</span></div><div className="zw-command-core-status mt-3 rounded-xl p-3"><p className="font-mono text-[9px] text-slate-500">{RELEASE_BUILD_LABEL}</p><p className="mt-2 font-mono text-[9px] text-lime-300/60">POLICY / {authorityRoleLabel(role).toUpperCase()}</p></div></div>
        </aside>
        {mobileMenu ? <button aria-label="Chiudi menu" className="fixed inset-0 z-30 bg-black/80 backdrop-blur-sm lg:hidden" onClick={() => setMobileMenu(false)} type="button" /> : null}

        <section className="min-w-0 flex-1">
          <header className="zw-command-topbar sticky top-0 z-20 flex h-[72px] items-center gap-3 px-4 sm:gap-5 sm:px-7">
            <IconButton className="lg:hidden" label="Apri menu" onClick={() => setMobileMenu(true)}><Menu className="size-4" /></IconButton>
            <IconButton label="Torna alla governance" onClick={() => router.push("/governance")}><ArrowLeft className="size-4" /></IconButton>
            <button aria-label="Torna a Command" className="zw-command-topbar__brand flex shrink-0 items-center gap-2 text-left" onClick={() => router.push("/command")} type="button"><span className="relative grid size-9 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black shadow-[0_0_18px_rgba(200,255,34,.12)]"><Image src="/ai-zerow-icon.jpeg" alt="ZEROW" width={36} height={36} className="size-full object-cover" /></span><span className="hidden sm:block"><span className="block text-[11px] font-bold tracking-[0.18em] text-slate-50">ZEROW</span><span className="block text-[9px] uppercase tracking-[0.2em] text-lime-300/75">security control</span></span></button>
            <IconButton label={sidebarCollapsed ? "Espandi sidebar" : "Riduci sidebar"} onClick={() => setSidebarCollapsed((value) => !value)}><span className="hidden lg:block">{sidebarCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}</span><span className="lg:hidden">←</span></IconButton>
            <div className="relative hidden min-w-0 flex-1 justify-center md:flex"><div className="relative w-full max-w-[520px]"><Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-600" /><Input aria-label="Cerca nei controlli security" className="h-10 w-full border-lime-300/10 bg-black/35 pl-10 text-xs text-slate-100 placeholder:text-slate-600" onChange={(event) => setSearch(event.target.value)} placeholder="Cerca controllo, evidenza, next gate…" value={search} /></div></div>
            <div className="flex min-w-0 flex-1 items-center gap-2 md:hidden"><span className="truncate text-xs font-semibold tracking-[0.14em] text-slate-200">SECURITY / PRIVACY</span><span className="size-1 rounded-full bg-lime-300" /></div>
            <div className="ml-auto flex items-center gap-2"><span className="hidden items-center gap-2 rounded-full border border-amber-300/20 bg-amber-300/5 px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-amber-100 sm:flex"><span className="size-1.5 rounded-full bg-amber-300" />{data.summary?.commercialStatus ?? "COMMERCIAL NO-GO"}</span><IconButton label="Aggiorna controlli" onClick={() => void load()}><RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} /></IconButton>{canReadCommunications ? <IconButton label="Apri comunicazioni" onClick={() => router.push("/communications")}><Bell className="size-4" /></IconButton> : null}<AccountMenu actor={actor} /></div>
          </header>

          <div className="mx-auto max-w-[1920px] px-4 py-5 sm:px-7 sm:py-7">
            <div className="zw-module-hero zw-page-enter mb-7 flex flex-wrap items-end justify-between gap-5"><div><div className="flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-lime-300/80"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_9px_rgba(190,255,60,0.9)]" />AI-ZEROW / GOVERNANCE / W16</div><h1 className="mt-3 max-w-3xl text-3xl font-semibold tracking-[-0.06em] text-lime-100 sm:text-[42px]">Security is operational.<br /><span className="text-slate-50">Evidence stays explicit.</span></h1><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">Controlli locali, provider esterni e approvazioni umane convivono nello stesso registro senza confondere readiness tecnica e certificazione commerciale.</p></div><div className="hidden items-center gap-4 sm:flex"><div className="zw-command-hero__orb relative grid shrink-0 place-items-center"><Image src="/ai-zerow-icon.jpeg" alt="AI-ZEROW security core" width={96} height={96} className="zw-command-hero__brand-core" /><span className="zw-command-hero__core-label absolute font-mono text-[8px] uppercase tracking-[0.2em]">SECURITY CORE</span></div><div className="max-w-[170px]"><p className="font-mono text-[10px] uppercase tracking-[0.18em] text-lime-300/70">{data.contract?.tranche ?? "W16"} / CONTROL PLANE</p><p className="mt-2 text-xs leading-5 text-slate-500">Tenant scoped, fail-closed, human review required.</p></div></div></div>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300/15 bg-amber-300/[0.035] px-4 py-3 text-[10px] text-amber-100/80"><div className="flex items-center gap-2"><ShieldCheck className="size-4 text-amber-200" /><span><strong className="font-semibold text-amber-100">COMMERCIAL NO-GO.</strong> La readiness tecnica non chiude provider, DPIA, osservabilità o sign-off umano.</span></div><span className="font-mono text-[9px] text-amber-200/70">DIRECT WRITE: {data.contract?.directWrite === false ? "BLOCKED" : "NOT RUN"}</span></div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric icon={ShieldCheck} label="Controlli pronti" value={loading ? "—" : `${summary?.ready ?? 0}/${summary?.total ?? controls.length}`} detail="Contratti locali chiusi" status={summary?.status === "READY" ? "READY" : "PARTIAL"} /><Metric icon={CircleAlert} label="Gate aperti" value={loading ? "—" : String(summary?.open ?? openControls.length)} detail="Provider, review o certificazione" status={summary?.open ? "NOT_RUN" : "READY"} /><Metric icon={DatabaseBackup} label="Restore" value="D1 / R2" detail={`${data.evidence?.restore?.d1 ?? "—"} · ${data.evidence?.restore?.r2 ?? "—"}`} status="READY" /><Metric icon={TimerReset} label="Provider / review" value={loading ? "—" : String((summary?.provider ?? 0) + (summary?.review ?? 0))} detail={`Ultimo readback ${lastCheck}`} status="PENDING_REVIEW" /></div>
            <div className="mt-4 grid gap-4 2xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]"><section className="carbon-card carbon-card-neon rounded-2xl p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-lime-300/70">W16 / CONTROL REGISTER</p><h2 className="mt-1 text-[15px] font-semibold text-slate-50">Security, privacy e resilienza</h2><p className="mt-1 text-[11px] text-slate-500">Filtra il registro per dominio, testo e prossimo gate.</p></div><div className="flex flex-wrap gap-1.5">{(Object.keys(domainLabels) as Filter[]).map((item) => <button className={`rounded-full border px-2.5 py-1.5 text-[10px] font-semibold transition ${filter === item ? "border-lime-300/35 bg-lime-300/10 text-lime-100" : "border-white/10 bg-black/20 text-slate-500 hover:text-slate-200"}`} key={item} onClick={() => setFilter(item)} type="button">{domainLabels[item]}</button>)}</div></div><div className="mt-4 space-y-2">{filteredControls.map((control) => <article className="rounded-xl border border-white/[0.08] bg-black/20 p-3 transition hover:border-lime-300/20 hover:bg-lime-300/[0.025]" key={control.id}><div className="flex items-start gap-3"><span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border border-white/10 bg-black/25"><StatusIcon status={control.status} /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-xs font-semibold text-slate-200">{control.label}</h3><p className="mt-1 text-[9px] uppercase tracking-[0.14em] text-slate-600">{control.domain}</p></div><StatusBadge status={control.status} /></div><p className="mt-2 text-[11px] leading-5 text-slate-500">{control.detail}</p><div className="mt-2 grid gap-2 text-[10px] sm:grid-cols-2"><p className="rounded-lg border border-white/[0.06] bg-black/20 px-2.5 py-2 text-slate-600"><span className="text-slate-500">Evidenza · </span>{control.evidence}</p><p className="rounded-lg border border-amber-300/10 bg-amber-300/[0.03] px-2.5 py-2 text-amber-100/70"><span className="text-amber-100/50">Next · </span>{control.nextAction}</p></div></div></div></article>)}{loading ? <p className="py-8 text-center text-xs text-slate-600">Readback W16 in corso…</p> : null}{!loading && filteredControls.length === 0 ? <p className="py-8 text-center text-xs text-slate-600">Nessun controllo corrisponde al filtro.</p> : null}</div></section>
              <aside className="space-y-4"><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-lime-300/70">RELEASE BOUNDARY</p><h2 className="mt-1 text-sm font-semibold">Promotion gate</h2></div><StatusBadge status={data.summary?.commercialStatus === "GO" ? "READY" : "NOT_RUN"} /></div><div className="mt-4 space-y-3 text-xs"><div className="flex items-center justify-between border-b border-white/[0.08] pb-3"><span className="text-slate-500">Commercial status</span><span className="text-amber-200">{data.contract?.commercialStatus ?? "NO_GO"}</span></div><div className="flex items-center justify-between border-b border-white/[0.08] pb-3"><span className="text-slate-500">D1 ledger</span><span className="text-lime-200">{data.evidence?.ledger?.status ?? "—"} · {data.evidence?.ledger?.count ?? 0}</span></div><div className="flex items-center justify-between border-b border-white/[0.08] pb-3"><span className="text-slate-500">Registry checks</span><span className="text-cyan-200">{data.evidence?.externalRegistry?.persistedChecks ?? 0}</span></div><div className="flex items-center justify-between"><span className="text-slate-500">Direct write</span><span className="text-lime-200">{data.contract?.directWrite === false ? "BLOCKED" : "NOT RUN"}</span></div></div><div className="mt-4 rounded-xl border border-rose-300/15 bg-rose-300/[0.04] p-3"><p className="text-[11px] leading-5 text-rose-100/80">Nessun controllo UI può chiudere automaticamente DPIA, provider, osservabilità o sign-off umano.</p></div></section><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-lime-300/70">NEXT GATES</p><h2 className="mt-1 text-sm font-semibold">Cosa manca davvero</h2></div><LockKeyhole className="size-4 text-lime-200" /></div><div className="mt-4 space-y-2">{openControls.slice(0, 6).map((control) => <button className="group flex w-full items-start gap-3 rounded-xl border border-white/[0.08] bg-black/20 p-3 text-left transition hover:border-lime-300/25 hover:bg-lime-300/[0.04]" key={control.id} onClick={() => setFilter(control.domain)} type="button"><StatusIcon status={control.status} /><span className="min-w-0 flex-1"><span className="block text-xs font-semibold text-slate-200">{control.label}</span><span className="mt-1 block text-[10px] leading-4 text-slate-600">{control.nextAction}</span></span><span className="font-mono text-[9px] text-lime-200/70">FILTER</span></button>)}{openControls.length === 0 ? <p className="text-xs text-lime-200">Nessun gate aperto.</p> : null}</div></section></aside></div>
            <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] py-5 text-[10px] text-slate-600"><span>AI-ZEROW COMMAND · W16 / SECURITY & PRIVACY</span><span className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-lime-300" />no secrets exported · fail-closed · human sign-off required</span></footer>
          </div>
        </section>
      </div>
      <CommandMobileNav active="more" allowedNavigation={access.allowedNavigation} role={role} roles={access.roles} />
      {toast ? <button className="fixed bottom-5 right-5 z-50 max-w-[360px] rounded-xl border border-lime-300/25 bg-[#0a100c]/95 px-4 py-3 text-left text-xs text-amber-100 shadow-[0_0_28px_rgba(190,255,60,0.14)]" onClick={() => setToast("")} type="button">{toast}</button> : null}
    </main>
  );
}
