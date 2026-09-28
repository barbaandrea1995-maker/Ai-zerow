"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Bell,
  BriefcaseBusiness,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleGauge,
  CircleHelp,
  CircleX,
  DatabaseZap,
  FileText,
  Gauge,
  HardHat,
  KeyRound,
  Layers3,
  LockKeyhole,
  Map as MapIcon,
  Menu,
  MessageSquareText,
  Package,
  Plus,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Truck,
  UserRoundCog,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type Tone = "lime" | "cyan" | "amber" | "red";
type Role = keyof typeof roleCapabilities;

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
  { label: "EVENTS / AUTHORITY", id: "events_authority", icon: ShieldCheck },
  { label: "PWA / DIAGNOSTICS", id: "pwa", icon: CircleGauge },
];

const roleCapabilities = {
  owner: ["workforce.read", "workforce.write", "workforce.read.all", "tenant.manage", "command.read", "approvals.review", "operations.read", "operations.write", "finance.read", "field.read", "field.write", "warehouse.read", "warehouse.write", "mission.read", "mission.write", "documents.read", "planning.read", "planning.write", "workforce.registry.read", "workforce.manage", "asset.read", "asset.write", "finance.write", "procurement.write", "documents.write", "communication.read", "communication.send", "communication.broadcast.critical", "telephony.manage"],
  admin: ["workforce.read", "workforce.write", "workforce.read.all", "command.read", "approvals.review", "operations.read", "operations.write", "finance.read", "field.read", "field.write", "warehouse.read", "warehouse.write", "mission.read", "mission.write", "documents.read", "planning.read", "planning.write", "workforce.registry.read", "workforce.manage", "asset.read", "asset.write", "finance.write", "procurement.write", "documents.write", "communication.read", "communication.send", "communication.broadcast.critical", "telephony.manage"],
  member: ["workforce.read", "workforce.write", "command.read", "operations.read", "field.read", "field.write", "warehouse.read", "mission.read", "planning.read", "documents.read"],
  manager: ["workforce.read", "workforce.write", "workforce.read.all", "command.read", "approvals.review", "operations.read", "operations.write", "finance.read", "field.read", "field.write", "warehouse.read", "warehouse.write", "mission.read", "mission.write", "documents.read", "planning.read", "planning.write", "workforce.registry.read", "workforce.manage", "asset.read", "asset.write", "finance.write", "procurement.write", "documents.write", "communication.read", "communication.send", "communication.broadcast.critical"],
  office: ["workforce.read", "workforce.write", "workforce.read.all", "command.read", "approvals.review", "operations.read", "operations.write", "finance.read", "field.read", "warehouse.read", "mission.read", "documents.read", "planning.read", "planning.write", "workforce.registry.read", "workforce.manage", "asset.read", "finance.write", "procurement.write", "documents.write", "communication.read", "communication.send"],
  technical: ["workforce.read", "workforce.write", "command.read", "operations.read", "operations.write", "finance.read", "field.read", "field.write", "warehouse.read", "mission.read", "documents.read", "planning.read", "planning.write", "workforce.registry.read", "workforce.manage", "asset.read", "asset.write", "documents.write", "communication.read", "communication.send"],
  field_supervisor: ["workforce.read", "workforce.write", "command.read", "operations.read", "field.read", "field.write", "warehouse.read", "mission.read", "planning.read", "workforce.registry.read", "asset.read", "documents.read", "communication.read", "communication.send", "communication.broadcast.critical"],
  worker: ["workforce.read", "workforce.write", "operations.read", "field.read", "field.write", "warehouse.read", "mission.read", "documents.read", "communication.read", "communication.send"],
  warehouse_manager: ["workforce.read", "workforce.write", "command.read", "operations.read", "warehouse.read", "warehouse.write", "mission.read", "mission.write", "asset.read", "documents.read", "communication.read", "communication.send", "communication.broadcast.critical"],
  warehouse_operator: ["workforce.read", "workforce.write", "operations.read", "warehouse.read", "warehouse.write", "mission.read", "asset.read", "documents.read", "communication.read", "communication.send"],
  driver: ["workforce.read", "workforce.write", "operations.read", "warehouse.read", "mission.read", "mission.write", "asset.read", "documents.read", "communication.read", "communication.send"],
  maintenance: ["workforce.read", "workforce.write", "field.read", "asset.read", "asset.write", "documents.read", "communication.read", "communication.send"],
  auditor: ["workforce.read", "workforce.read.all", "command.read", "operations.read", "finance.read", "field.read", "warehouse.read", "mission.read", "planning.read", "workforce.registry.read", "asset.read", "documents.read"],
} as const;

const tenantFields = [
  { key: "actorId", value: "not resolved", detail: "server auth claim", tone: "cyan" as Tone },
  { key: "membershipId", value: "not resolved", detail: "membership adapter", tone: "amber" as Tone },
  { key: "tenantId", value: "not bound", detail: "tenant isolation required", tone: "red" as Tone },
  { key: "environment", value: "Sites preview", detail: "owner-only publication", tone: "lime" as Tone },
  { key: "role", value: "not resolved", detail: "application role ≠ Site owner", tone: "amber" as Tone },
  { key: "capabilities", value: "static catalog", detail: "resolver not connected", tone: "cyan" as Tone },
  { key: "resourceScope", value: "not resolved", detail: "server-owned scope", tone: "amber" as Tone },
  { key: "fieldScope", value: "not resolved", detail: "field boundary", tone: "amber" as Tone },
  { key: "fileScope", value: "not resolved", detail: "object storage boundary", tone: "amber" as Tone },
  { key: "contextSource", value: "server-auth", detail: "required source", tone: "lime" as Tone },
  { key: "sessionId", value: "not exposed", detail: "session adapter", tone: "cyan" as Tone },
  { key: "approvalContext", value: "not resolved", detail: "approval gate", tone: "amber" as Tone },
];

const negativeCases = [
  { title: "Unauthenticated", expected: "401 where route maps error", status: "PARTIALLY_VERIFIED", tone: "amber" as Tone, icon: CircleHelp },
  { title: "Capability missing", expected: "403 forbidden", status: "PARTIALLY_VERIFIED", tone: "amber" as Tone, icon: LockKeyhole },
  { title: "Organization missing", expected: "409 onboarding_required", status: "PARTIALLY_VERIFIED", tone: "amber" as Tone, icon: Building2 },
  { title: "Expired session", expected: "identity context rejects", status: "VERIFIED", tone: "lime" as Tone, icon: CheckCircle2 },
  { title: "Cross-tenant resource", expected: "Cross-tenant access denied", status: "VERIFIED", tone: "lime" as Tone, icon: ShieldCheck },
  { title: "Tenant A / B", expected: "negative integration case", status: "NOT RUN", tone: "red" as Tone, icon: CircleX },
];

const toneStyles: Record<Tone, { icon: string; badge: string; border: string }> = {
  lime: { icon: "text-lime-200", badge: "border-lime-300/25 bg-lime-300/10 text-lime-200", border: "border-lime-300/20" },
  cyan: { icon: "text-cyan-200", badge: "border-cyan-300/25 bg-cyan-300/10 text-cyan-200", border: "border-cyan-300/20" },
  amber: { icon: "text-amber-200", badge: "border-amber-300/25 bg-amber-300/10 text-amber-200", border: "border-amber-300/20" },
  red: { icon: "text-rose-200", badge: "border-rose-300/25 bg-rose-300/10 text-rose-200", border: "border-rose-300/20" },
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

function MetricCard({ label, value, detail, icon: Icon, tone }: { label: string; value: string; detail: string; icon: typeof ShieldCheck; tone: Tone }) {
  const style = toneStyles[tone];
  return <article className="carbon-card rounded-2xl p-4"><div className="flex items-start justify-between gap-3"><span className={`grid size-9 place-items-center rounded-xl border border-current/20 bg-current/10 ${style.icon}`}><Icon className="size-[18px]" /></span><StatusBadge tone={tone}>{detail}</StatusBadge></div><p className="mt-4 text-xs text-slate-500">{label}</p><p className="mt-1 font-mono text-[29px] font-semibold leading-none tracking-[-0.06em] text-slate-50">{value}</p><div className="mt-4 flex items-end gap-1.5 opacity-80">{[18,26,20,35,28,48,42,57,53,66,61,75].map((height, index) => <span className={`flex-1 rounded-t-sm ${tone === "cyan" ? "bg-cyan-300" : tone === "amber" ? "bg-amber-300" : "bg-lime-300"}`} key={index} style={{ height: `${height / 2}px`, opacity: 0.25 + index * 0.05 }} />)}</div></article>;
}

function CapabilityPill({ capability }: { capability: string }) {
  const action = /\.write$|\.manage$|\.send$|\.review$|\.broadcast\./.test(capability);
  return <span className={`rounded-md border px-2 py-1 font-mono text-[10px] ${action ? "border-lime-300/20 bg-lime-300/5 text-lime-200" : "border-white/10 bg-black/20 text-slate-400"}`}>{capability}</span>;
}

export default function OnboardingPage() {
  const roles = Object.keys(roleCapabilities) as Role[];
  const [mobileMenu, setMobileMenu] = useState(false);
  const [selectedRole, setSelectedRole] = useState<Role>("owner");
  const [query, setQuery] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileLabel, setProfileLabel] = useState("");
  const [toast, setToast] = useState("");

  const filteredRoles = useMemo(() => roles.filter((role) => role.toLowerCase().includes(query.trim().toLowerCase())), [query, roles]);
  const selectedCapabilities = roleCapabilities[selectedRole];

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  };

  const navigate = (id: string, label: string) => {
    setMobileMenu(false);
    if (id === "command") { window.location.href = "/"; return; }
    if (id === "operations") { window.location.href = "/operations"; return; }
    if (id === "events_authority") return;
    notify(`${label}: superficie prevista nel prossimo adapter`);
  };

  const createProfile = () => {
    setProfileOpen(false);
    notify(`Profilo locale preparato: ${profileLabel || selectedRole}`);
    setProfileLabel("");
  };

  return <main className="min-h-screen overflow-x-hidden bg-[#050607] text-slate-100 selection:bg-lime-300 selection:text-[#060806]"><div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_74%_0%,rgba(190,255,60,0.07),transparent_25%),radial-gradient(circle_at_18%_78%,rgba(70,110,120,0.08),transparent_27%)]" /><div className="relative flex min-h-screen">
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-[232px] flex-col border-r border-lime-300/10 bg-[#050607]/96 px-3 py-4 backdrop-blur-xl transition-transform lg:static lg:translate-x-0 ${mobileMenu ? "translate-x-0" : "-translate-x-full"}`}><div className="flex items-center justify-between px-2"><button className="flex items-center gap-3 text-left" onClick={() => { setMobileMenu(false); window.location.href = "/"; }} type="button"><span className="neon-pulse relative grid size-10 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black font-mono text-[18px] font-black italic text-lime-200"><span className="absolute inset-x-2 top-3 h-0.5 rotate-[-16deg] bg-lime-300" /><span className="absolute inset-x-2 top-5 h-0.5 rotate-[-16deg] bg-lime-300/80" /><span className="absolute inset-x-2 top-7 h-0.5 rotate-[-16deg] bg-lime-300/60" />Z</span><span><span className="block text-sm font-bold tracking-[0.18em] text-slate-50">AI-ZEROW</span><span className="block text-[10px] uppercase tracking-[0.22em] text-lime-300/75">command</span></span></button><button className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-white/5 hover:text-white lg:hidden" onClick={() => setMobileMenu(false)} type="button" aria-label="Chiudi menu"><X className="size-4" /></button></div><button className="carbon-card mt-8 flex w-full items-center gap-3 rounded-xl p-3 text-left transition hover:border-lime-300/25" type="button" onClick={() => notify("Workspace ZEROW · contesto owner") }><span className="grid size-8 place-items-center rounded-lg border border-lime-300/20 bg-lime-300/10 text-lime-200"><HardHat className="size-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-slate-200">ZEROW workspace</span><span className="mt-0.5 block truncate text-[10px] text-slate-600">owner · tenant context</span></span><ChevronRight className="size-3.5 text-slate-600" /></button><nav className="mt-7 flex-1" aria-label="Navigazione principale"><p className="px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-600">Workspace</p><div className="mt-2 space-y-1">{navItems.map((item) => { const Icon = item.icon; const active = item.id === "events_authority"; return <button aria-current={active ? "page" : undefined} className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${active ? "border border-lime-300/20 bg-lime-300/10 text-lime-200 shadow-[inset_0_0_20px_rgba(190,255,60,0.04)]" : "text-slate-500 hover:bg-white/[0.045] hover:text-slate-100"}`} key={item.id} onClick={() => navigate(item.id, item.label)} type="button"><Icon className={`size-4 ${active ? "text-lime-200" : "text-slate-600 group-hover:text-slate-300"}`} /><span>{item.label}</span>{item.id === "command" && <span className="ml-auto rounded border border-white/10 px-1.5 py-0.5 font-mono text-[8px] tracking-[0.08em] text-slate-600">AI</span>}</button>; })}</div></nav><div className="mt-5 border-t border-white/[0.08] pt-4"><div className="flex items-center justify-between px-2 text-[10px] uppercase tracking-[0.14em] text-slate-600"><span>System status</span><span className="flex items-center gap-1.5 text-lime-200"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_8px_rgba(190,255,60,0.8)]" />online</span></div><div className="carbon-inset mt-3 rounded-xl p-3"><div className="flex items-center gap-2 text-[10px] text-slate-400"><ShieldCheck className="size-3.5 text-lime-300" />Authority core</div><div className="mt-2 flex items-end gap-0.5">{[18,26,23,36,31,46,40,56,50,64,59,73].map((height, index) => <span className="flex-1 rounded-t-sm bg-lime-300/80" key={index} style={{ height: `${height / 2}px` }} />)}</div><p className="mt-3 font-mono text-[9px] text-slate-600">S02 · STATIC MODULE</p></div></div></aside>
    {mobileMenu && <button className="fixed inset-0 z-30 bg-black/75 lg:hidden" onClick={() => setMobileMenu(false)} aria-label="Chiudi menu" type="button" />}
    <section className="min-w-0 flex-1"><header className="sticky top-0 z-20 flex h-[72px] items-center gap-3 border-b border-white/[0.08] bg-[#050607]/88 px-4 backdrop-blur-xl sm:gap-5 sm:px-7"><IconButton label="Apri menu" onClick={() => setMobileMenu(true)} className="lg:hidden"><Menu className="size-4" /></IconButton><div className="relative hidden min-w-0 flex-1 md:block"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-600" /><Input aria-label="Cerca ruoli e capability" className="h-10 max-w-[440px] border-white/10 bg-black/30 pl-10 text-xs text-slate-100 placeholder:text-slate-600 focus-visible:border-lime-300/40" onChange={(event) => setQuery(event.target.value)} placeholder="Cerca ruolo, capability, tenant…" value={query} /></div><div className="flex min-w-0 flex-1 items-center gap-2 md:hidden"><span className="truncate text-xs font-semibold tracking-[0.14em] text-slate-200">AUTHORITY</span><span className="size-1 rounded-full bg-lime-300" /></div><div className="ml-auto flex items-center gap-2"><span className="hidden items-center gap-2 rounded-full border border-amber-300/20 bg-amber-300/5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-200 sm:flex"><span className="size-1.5 rounded-full bg-amber-300 shadow-[0_0_9px_rgba(255,188,66,0.9)]" />Adapter required</span><IconButton label="Notifiche"><Bell className="size-4" /></IconButton><span className="hidden size-8 place-items-center rounded-full border border-white/15 bg-gradient-to-br from-slate-200 to-slate-500 text-xs font-bold text-[#080a0b] sm:grid">AB</span><div className="hidden text-right lg:block"><p className="text-xs font-medium text-slate-200">Operatore</p><p className="text-[10px] text-slate-600">Site owner · app role pending</p></div><ChevronDown className="hidden size-3.5 text-slate-500 lg:block" /></div></header>
      <div className="mx-auto max-w-[1680px] px-4 py-5 sm:px-7 sm:py-7"><div className="mb-5 flex flex-wrap items-end justify-between gap-4"><div><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/70"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_9px_rgba(190,255,60,0.9)]" />AI-ZEROW / EVENTS / AUTHORITY</div><h1 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-50 sm:text-[28px]">Authority & onboarding</h1><p className="mt-1 text-xs text-slate-500">Identità server-owned, tenant context e capability matrix · superficie S02</p></div><div className="flex items-center gap-2"><span className="hidden items-center rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-[10px] text-slate-500 sm:inline-flex"><DatabaseZap className="mr-2 size-3.5 text-cyan-300" />Readback non eseguito</span><Button className="h-9 border border-lime-300/30 bg-lime-300 px-3 text-xs font-semibold text-[#060806] shadow-[0_0_18px_rgba(190,255,60,0.16)] hover:bg-lime-200" onClick={() => setProfileOpen(true)}><Plus className="size-3.5" />Crea profilo accesso</Button></div></div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="Ruoli canonici" value="13" detail="STATIC EVIDENCE" icon={UserRoundCog} tone="lime" /><MetricCard label="TenantContext fields" value="12" detail="SERVER-OWNED" icon={KeyRound} tone="cyan" /><MetricCard label="Capability catalog" value="28+" detail="IMMUTABLE ARRAYS" icon={ShieldCheck} tone="lime" /><MetricCard label="Negative cases" value="6" detail="2 NOT RUN" icon={AlertTriangle} tone="amber" /></div>
        <div className="mt-4 grid gap-4 2xl:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)]"><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><SectionTitle eyebrow="SITE SESSION / BOUNDARY" title="Contesto corrente" /><p className="mt-1 text-[11px] text-slate-500">Il Site owner non sostituisce l’identità applicativa ZEROW.</p></div><StatusBadge tone="amber">ADAPTER REQUIRED</StatusBadge></div><div className="carbon-card-neon mt-4 rounded-xl border p-4"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl border border-lime-300/30 bg-lime-300/10 text-lime-200"><LockKeyhole className="size-5" /></span><div><p className="text-sm font-semibold text-slate-100">Owner-only Site access</p><p className="mt-1 text-[11px] text-slate-500">Accesso alla preview verificato dal perimetro Sites</p></div></div><div className="mt-4 grid grid-cols-2 gap-2"><div className="rounded-lg border border-white/10 bg-black/25 p-3"><p className="text-[10px] uppercase tracking-[0.12em] text-slate-600">Account</p><p className="mt-1 text-xs text-lime-200">owner</p></div><div className="rounded-lg border border-white/10 bg-black/25 p-3"><p className="text-[10px] uppercase tracking-[0.12em] text-slate-600">App role</p><p className="mt-1 text-xs text-amber-200">not resolved</p></div></div></div><div className="mt-4 space-y-2"><div className="flex items-center gap-2 rounded-lg border border-cyan-300/15 bg-cyan-300/5 px-3 py-2.5 text-[11px] text-cyan-100/80"><ShieldCheck className="size-4 shrink-0 text-cyan-200" /><span>Client identity: <strong className="font-medium text-cyan-100">server-owned</strong></span></div><div className="flex items-center gap-2 rounded-lg border border-lime-300/15 bg-lime-300/5 px-3 py-2.5 text-[11px] text-lime-100/80"><LockKeyhole className="size-4 shrink-0 text-lime-200" /><span>Tenant isolation: <strong className="font-medium text-lime-100">assertTenantScope</strong></span></div><div className="flex items-center gap-2 rounded-lg border border-amber-300/15 bg-amber-300/5 px-3 py-2.5 text-[11px] text-amber-100/80"><CircleHelp className="size-4 shrink-0 text-amber-200" /><span>Resolver runtime: <strong className="font-medium text-amber-100">not connected</strong></span></div></div></section>
          <section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><SectionTitle eyebrow="TENANT CONTEXT / STATIC CONTRACT" title="Identity context fields" /><p className="mt-1 text-[11px] text-slate-500">Campi ricostruiti da `deriveTenantContextFromServerClaims`.</p></div><IconButton label="Verifica adapter" onClick={() => notify("TenantContext: adapter server richiesto per il readback")}><Settings2 className="size-4" /></IconButton></div><div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{tenantFields.map((field) => <div className="carbon-inset rounded-xl p-3" key={field.key}><div className="flex items-center justify-between gap-2"><span className="font-mono text-[10px] text-slate-500">{field.key}</span><span className={`size-1.5 rounded-full ${field.tone === "lime" ? "bg-lime-300" : field.tone === "cyan" ? "bg-cyan-300" : field.tone === "amber" ? "bg-amber-300" : "bg-rose-300"}`} /></div><p className="mt-2 truncate text-xs font-medium text-slate-200">{field.value}</p><p className="mt-1 truncate text-[10px] text-slate-600">{field.detail}</p></div>)}</div></section></div>
        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]"><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><SectionTitle eyebrow="ROLE CATALOG / 13" title="Ruoli canonici" /><p className="mt-1 text-[11px] text-slate-500">Selezione locale per ispezionare le capability statiche.</p></div><StatusBadge>STATIC EVIDENCE</StatusBadge></div><div className="mt-4 space-y-1.5">{filteredRoles.map((role) => { const active = role === selectedRole; return <button className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${active ? "border-lime-300/35 bg-lime-300/10" : "border-white/[0.07] bg-black/15 hover:border-lime-300/20 hover:bg-white/[0.035]"}`} key={role} onClick={() => setSelectedRole(role)} type="button"><span className={`grid size-8 place-items-center rounded-lg border ${active ? "border-lime-300/25 bg-lime-300/10 text-lime-200" : "border-white/10 bg-black/20 text-slate-600"}`}><UserRoundCog className="size-3.5" /></span><span className="min-w-0 flex-1"><span className={`block text-xs font-medium ${active ? "text-lime-100" : "text-slate-300"}`}>{role}</span><span className="mt-1 block text-[10px] text-slate-600">{roleCapabilities[role].length} capability</span></span>{active && <Check className="size-4 text-lime-200" />}</button>; })}{filteredRoles.length === 0 && <div className="rounded-xl border border-white/10 p-5 text-center text-xs text-slate-500">Nessun ruolo trovato nel catalogo locale.</div>}</div></section>
          <section className="carbon-card carbon-card-neon rounded-2xl p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><SectionTitle eyebrow="CAPABILITY RESOLVER / READ MODEL" title={selectedRole} /><p className="mt-1 text-[11px] text-slate-500">Array immutabile ricostruito da `ROLE_CAPABILITIES`.</p></div><div className="flex items-center gap-2"><StatusBadge tone="amber">NOT RESOLVED</StatusBadge><button className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-lime-300 hover:text-lime-100" onClick={() => notify(`Capability resolver ${selectedRole}: adapter non collegato`)} type="button">Readback <ArrowUpRight className="size-3.5" /></button></div></div><div className="carbon-inset mt-4 rounded-xl p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-[10px] uppercase tracking-[0.14em] text-slate-600">Capability count</p><p className="mt-1 font-mono text-3xl font-semibold tracking-[-0.07em] text-slate-50">{selectedCapabilities.length}</p></div><div className="text-right"><p className="text-[11px] text-slate-500">Source</p><p className="mt-1 font-mono text-[10px] text-cyan-200">packages/identity</p></div></div><div className="mt-4 flex flex-wrap gap-2">{selectedCapabilities.map((capability) => <CapabilityPill capability={capability} key={capability} />)}</div></div><div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-300/20 bg-amber-300/5 p-3 text-[11px] leading-5 text-amber-100/80"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-200" />La selezione del ruolo è solo una preview della matrice: non modifica il contesto dell’utente e non abilita endpoint.</div></section></div>
        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]"><section className="carbon-card rounded-2xl p-4 sm:p-5"><SectionTitle eyebrow="AUTHORITY / NEGATIVE CASES" title="Casi di sicurezza" action="Apri evidenze" onAction={() => notify("Evidence ledger: casi S02 mantenuti come static evidence")} /><div className="mt-4 grid gap-2 sm:grid-cols-2">{negativeCases.map((item) => { const Icon = item.icon; return <div className="carbon-inset flex items-center gap-3 rounded-xl p-3" key={item.title}><span className={`grid size-8 place-items-center rounded-lg border ${toneStyles[item.tone].badge}`}><Icon className="size-4" /></span><div className="min-w-0 flex-1"><p className="text-xs font-medium text-slate-200">{item.title}</p><p className="mt-1 truncate text-[10px] text-slate-500">{item.expected}</p></div><span className={`shrink-0 rounded border px-1.5 py-1 font-mono text-[9px] ${item.status === "VERIFIED" ? "border-lime-300/20 text-lime-200" : item.status === "NOT RUN" ? "border-rose-300/20 text-rose-200" : "border-amber-300/20 text-amber-200"}`}>{item.status}</span></div>; })}</div></section><section className="carbon-card rounded-2xl p-4 sm:p-5"><SectionTitle eyebrow="AUTHORITY BOUNDARY" title="Prossimo readback" /><div className="mt-4 space-y-3">{[{ icon: DatabaseZap, title: "Neon Auth / session", detail: "Derivare actor e membership dal server", tone: "cyan" as Tone }, { icon: Building2, title: "Tenant resolver", detail: "Confrontare tenantId con la risorsa", tone: "lime" as Tone }, { icon: ShieldCheck, title: "Permission resolver", detail: "Applicare capability per route e handler", tone: "amber" as Tone }].map((item) => { const Icon = item.icon; return <div className="flex items-center gap-3" key={item.title}><span className={`grid size-9 place-items-center rounded-xl border ${toneStyles[item.tone].badge}`}><Icon className="size-4" /></span><div className="min-w-0 flex-1"><p className="text-xs font-medium text-slate-200">{item.title}</p><p className="mt-1 text-[11px] text-slate-500">{item.detail}</p></div><span className="font-mono text-[9px] text-amber-200">PENDING</span></div>; })}</div><div className="mt-5 flex items-start gap-2 rounded-xl border border-cyan-300/15 bg-cyan-300/5 p-3 text-[11px] leading-5 text-cyan-100/75"><KeyRound className="mt-0.5 size-4 shrink-0 text-cyan-200" />Il prossimo passaggio tecnico è collegare il contesto server senza accettare identità inviate dal client.</div></section></div>
        <section className="carbon-card mt-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl p-4 sm:p-5"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl border border-lime-300/25 bg-lime-300/10 text-lime-200"><ShieldCheck className="size-4" /></span><div><p className="text-sm font-semibold text-slate-100">S02 surface pronta</p><p className="mt-1 text-[11px] text-slate-500">Ruoli, TenantContext e casi negativi sono esposti senza dichiarare certificato il runtime.</p></div></div><div className="flex items-center gap-2"><StatusBadge>STATIC UI READY</StatusBadge><button className="grid size-8 place-items-center rounded-lg border border-white/10 text-slate-500 hover:border-lime-300/30 hover:text-lime-200" onClick={() => notify("S02: static surface verificata, adapter ancora richiesto")} type="button" aria-label="Apri evidenze"><ArrowUpRight className="size-3.5" /></button></div></section>
        <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] py-5 text-[10px] text-slate-600"><span>AI-ZEROW AUTHORITY · S02 static surface</span><span className="flex items-center gap-2"><span>black carbon core</span><span className="size-1 rounded-full bg-lime-300" /><span>no identity exported</span></span></footer>
      </div></section>
  </div>
  <Dialog open={profileOpen} onOpenChange={setProfileOpen}><DialogContent className="border-lime-300/20 bg-[#0a0d0e] text-slate-100 sm:max-w-[520px]"><DialogHeader><DialogTitle className="text-slate-100">Crea profilo accesso</DialogTitle><DialogDescription className="text-slate-500">Preview locale del controllo onboarding. La creazione reale richiede `/api/authority/access-profiles` e il resolver server.</DialogDescription></DialogHeader><div className="space-y-4"><div className="space-y-2"><label className="text-xs text-slate-400" htmlFor="profile-label">Etichetta profilo</label><Input id="profile-label" className="border-white/10 bg-black/30 text-slate-100" onChange={(event) => setProfileLabel(event.target.value)} placeholder="Es. Responsabile operativo" value={profileLabel} /></div><div className="space-y-2"><p className="text-xs text-slate-400">Ruolo base</p><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{roles.slice(0, 6).map((role) => <button className={`rounded-lg border px-3 py-2 text-left text-[11px] transition ${selectedRole === role ? "border-lime-300/35 bg-lime-300/10 text-lime-100" : "border-white/10 bg-black/20 text-slate-400 hover:border-lime-300/25"}`} key={role} onClick={() => setSelectedRole(role)} type="button">{role}</button>)}</div></div><div className="flex items-start gap-2 rounded-xl border border-amber-300/20 bg-amber-300/5 p-3 text-[11px] leading-5 text-amber-100/80"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-200" />Nessun profilo sarà salvato: questa azione prepara soltanto una bozza locale.</div></div><DialogFooter><DialogClose asChild><Button type="button" variant="outline" className="border-white/10 bg-transparent text-slate-400">Annulla</Button></DialogClose><Button type="button" className="bg-lime-300 text-[#060806] hover:bg-lime-200" onClick={createProfile}><Send className="size-3.5" />Prepara bozza</Button></DialogFooter></DialogContent></Dialog>
  {toast && <div className="fixed bottom-5 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2 rounded-xl border border-lime-300/25 bg-[#0b1008]/95 px-4 py-3 text-xs text-lime-100 shadow-[0_0_30px_rgba(190,255,60,0.14)] backdrop-blur-xl"><CheckCircle2 className="size-4 text-lime-300" />{toast}</div>}
  </main>;
}
