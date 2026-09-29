"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowUpRight,
  AlertTriangle,
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
  Filter,
  Gauge,
  HardHat,
  KeyRound,
  Layers3,
  LockKeyhole,
  Map as MapIcon,
  Menu,
  MoreHorizontal,
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
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useRouter } from "next/navigation";
import {
  AUTHORITY_ROLES,
  ROLE_CAPABILITIES,
  type AuthorityRole,
} from "@/lib/authority-catalog";

type Tone = "lime" | "cyan" | "amber" | "red";

type AuthorityContextView = {
  actorId: string;
  actorEmail: string;
  actorName: string;
  membershipId: string;
  tenantId: string;
  environment: string;
  role: string;
  capabilities: string[];
  resourceScope: string;
  fieldScope: string;
  fileScope: string;
  contextSource: string;
  sessionId: string | null;
  expiresAt: string | null;
  approvalContext: string;
};

type AccessProfile = {
  id: string;
  tenantId: string;
  label: string;
  baseRole: string;
  capabilities: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

type AuthorityTabId = "overview" | "users" | "roles" | "permissions" | "teams" | "access" | "audit" | "policies";

type AuthorityUser = {
  initials: string;
  name: string;
  email: string;
  role: string;
  team: string;
  status: "Online" | "Offline";
  lastAccess: string;
  tone: "lime" | "amber" | "cyan" | "violet";
};

const authorityTabs: Array<{ id: AuthorityTabId; label: string; target: string }> = [
  { id: "overview", label: "Panoramica", target: "authority-overview" },
  { id: "users", label: "Utenti", target: "authority-users" },
  { id: "roles", label: "Ruoli", target: "authority-roles" },
  { id: "permissions", label: "Permessi", target: "authority-permissions" },
  { id: "teams", label: "Team", target: "authority-teams" },
  { id: "access", label: "Accessi", target: "authority-policies" },
  { id: "audit", label: "Audit Log", target: "authority-activity" },
  { id: "policies", label: "Politiche", target: "authority-policies" },
];

const authorityUsers: AuthorityUser[] = [
  { initials: "MR", name: "Marco Rossi", email: "marco.rossi@azienda.it", role: "Operatore", team: "Team Alpha", status: "Online", lastAccess: "Oggi, 10:24", tone: "lime" },
  { initials: "GV", name: "Giulia Verdi", email: "giulia.verdi@azienda.it", role: "Team Leader", team: "Team Beta", status: "Online", lastAccess: "Oggi, 09:18", tone: "lime" },
  { initials: "LB", name: "Luca Bianchi", email: "luca.bianchi@azienda.it", role: "Manager", team: "Team Alpha", status: "Offline", lastAccess: "Ieri, 17:32", tone: "cyan" },
  { initials: "SC", name: "Sara Conti", email: "sara.conti@azienda.it", role: "Amministratore", team: "HQ", status: "Online", lastAccess: "Oggi, 11:05", tone: "violet" },
  { initials: "DR", name: "Davide Romano", email: "davide.romano@azienda.it", role: "Tecnico", team: "Team Gamma", status: "Online", lastAccess: "Oggi, 08:45", tone: "cyan" },
];

const authorityRoleDistribution = [
  { label: "Operatore", value: 18, share: "38%", tone: "lime" },
  { label: "Team Leader", value: 8, share: "17%", tone: "green" },
  { label: "Manager", value: 6, share: "13%", tone: "yellow" },
  { label: "Amministratore", value: 4, share: "8%", tone: "orange" },
  { label: "Tecnico", value: 8, share: "17%", tone: "blue" },
  { label: "Viewer", value: 4, share: "8%", tone: "slate" },
];

const accessLevels = [
  { label: "Lettura", value: 186 },
  { label: "Inserimento", value: 142 },
  { label: "Modifica", value: 98 },
  { label: "Approvazione", value: 36 },
  { label: "Amministrazione", value: 12 },
];

const authorityActivity = [
  { icon: Users, title: "Nuovo utente aggiunto", detail: "mario.rossi@azienda.it", time: "5 min fa", tone: "lime" as Tone },
  { icon: KeyRound, title: "Ruolo modificato", detail: "Luca Bianchi → Team Leader", time: "18 min fa", tone: "lime" as Tone },
  { icon: ShieldCheck, title: "Permesso aggiornato", detail: "commesse.approva", time: "1 ora fa", tone: "lime" as Tone },
  { icon: Users, title: "Utente rimosso dal team", detail: "Giulia Verdi → Team Beta", time: "3 ore fa", tone: "lime" as Tone },
  { icon: AlertTriangle, title: "Accesso non autorizzato", detail: "Tentativo fallito", time: "5 ore fa", tone: "red" as Tone },
];

const authorityTeams = [
  { label: "Team Alpha", members: 8, initials: "TA", tone: "lime" },
  { label: "Team Beta", members: 6, initials: "TB", tone: "lime" },
  { label: "Team Gamma", members: 5, initials: "TG", tone: "lime" },
  { label: "Headquarters", members: 4, initials: "HQ", tone: "violet" },
];

const permissionMatrix = [
  { module: "Commesse", values: ["Lettura", "Modifica", "Approvazione", "Amministrazione", "Modifica", "Lettura"] },
  { module: "Lavori", values: ["Lettura", "Modifica", "Modifica", "Amministrazione", "Modifica", "Lettura"] },
  { module: "Asset", values: ["Lettura", "Modifica", "Modifica", "Amministrazione", "Modifica", "Lettura"] },
  { module: "Pianificazione", values: ["Lettura", "Modifica", "Approvazione", "Amministrazione", "Modifica", "Lettura"] },
  { module: "Team", values: ["Nessun accesso", "Lettura", "Modifica", "Amministrazione", "Lettura", "Nessun accesso"] },
  { module: "Documenti", values: ["Lettura", "Modifica", "Modifica", "Amministrazione", "Modifica", "Lettura"] },
  { module: "Analisi", values: ["Lettura", "Lettura", "Modifica", "Amministrazione", "Lettura", "Lettura"] },
];

const authorityPolicies = [
  { icon: LockKeyhole, title: "Autenticazione a due fattori", detail: "Richiesta per ruoli amministrativi", state: "Attiva" },
  { icon: CircleGauge, title: "Sessione massima", detail: "Timeout automatico", state: "8 ore" },
  { icon: ShieldCheck, title: "Accesso da dispositivi", detail: "Solo dispositivi autorizzati", state: "Limitato" },
  { icon: Activity, title: "Log attività", detail: "Tracciamento completo", state: "Attivo" },
  { icon: KeyRound, title: "Politica password", detail: "Scadenza ogni 90 giorni", state: "Attiva" },
];

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

const fallbackTenantFields = [
  { key: "actorId", value: "readback pending", detail: "Sites auth header", tone: "amber" as Tone },
  { key: "membershipId", value: "readback pending", detail: "server-derived membership", tone: "amber" as Tone },
  { key: "tenantId", value: "Sites project boundary", detail: "owner-private tenant", tone: "cyan" as Tone },
  { key: "environment", value: "Sites production", detail: "owner-only publication", tone: "lime" as Tone },
  { key: "role", value: "readback pending", detail: "server-resolved role", tone: "amber" as Tone },
  { key: "capabilities", value: "13 canonical roles", detail: "immutable catalog", tone: "cyan" as Tone },
  { key: "resourceScope", value: "tenant", detail: "server-owned scope", tone: "lime" as Tone },
  { key: "fieldScope", value: "tenant", detail: "field boundary", tone: "lime" as Tone },
  { key: "fileScope", value: "site", detail: "Sites file boundary", tone: "lime" as Tone },
  { key: "contextSource", value: "Sites workspace auth", detail: "required source", tone: "lime" as Tone },
  { key: "sessionId", value: "dispatch-owned", detail: "not exposed to client", tone: "cyan" as Tone },
  { key: "approvalContext", value: "owner", detail: "owner approval gate", tone: "lime" as Tone },
];

const negativeCases = [
  { title: "Unauthenticated", expected: "API returns 401", status: "SITES GUARD", tone: "lime" as Tone, icon: CircleHelp },
  { title: "Capability missing", expected: "tenant.manage gate returns 403", status: "SITES GUARD", tone: "lime" as Tone, icon: LockKeyhole },
  { title: "Organization missing", expected: "not applicable to owner-private Site", status: "SITES SCOPE", tone: "cyan" as Tone, icon: Building2 },
  { title: "Expired session", expected: "dispatch-owned identity rejected", status: "SITES GUARD", tone: "lime" as Tone, icon: CheckCircle2 },
  { title: "Cross-tenant resource", expected: "assertTenantScope boundary", status: "SITES GUARD", tone: "lime" as Tone, icon: ShieldCheck },
  { title: "Tenant A / B", expected: "external multi-tenant adapter deferred", status: "DEFERRED", tone: "amber" as Tone, icon: CircleX },
];

const toneStyles: Record<Tone, { icon: string; badge: string }> = {
  lime: { icon: "text-lime-200", badge: "border-lime-300/25 bg-lime-300/10 text-lime-200" },
  cyan: { icon: "text-cyan-200", badge: "border-cyan-300/25 bg-cyan-300/10 text-cyan-200" },
  amber: { icon: "text-amber-200", badge: "border-amber-300/25 bg-amber-300/5 text-amber-200" },
  red: { icon: "text-rose-200", badge: "border-rose-300/25 bg-rose-300/10 text-rose-200" },
};

function IconButton({ label, children, onClick, className = "" }: { label: string; children: ReactNode; onClick?: () => void; className?: string }) {
  return (
    <button
      aria-label={label}
      className={`grid size-9 place-items-center rounded-lg border border-white/10 bg-black/20 text-slate-500 transition hover:border-lime-300/35 hover:bg-lime-300/10 hover:text-lime-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300 ${className}`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function StatusBadge({ children, tone = "lime" }: { children: ReactNode; tone?: Tone }) {
  const styles = toneStyles[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-semibold tracking-[0.05em] ${styles.badge}`}>
      <span className="size-1.5 rounded-full bg-current shadow-[0_0_9px_currentColor]" />
      {children}
    </span>
  );
}

function SectionTitle({ eyebrow, title, action, onAction }: { eyebrow?: string; title: string; action?: string; onAction?: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        {eyebrow && <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/65">{eyebrow}</p>}
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-slate-100">{title}</h2>
      </div>
      {action && <button className="text-[11px] font-medium text-lime-300 transition hover:text-lime-100" onClick={onAction} type="button">{action}</button>}
    </div>
  );
}

function MetricCard({ label, value, detail, icon: Icon, tone }: { label: string; value: string; detail: string; icon: typeof ShieldCheck; tone: Tone }) {
  const style = toneStyles[tone];
  return (
    <article className="carbon-card rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        <span className={`grid size-9 place-items-center rounded-xl border border-current/20 bg-current/10 ${style.icon}`}><Icon className="size-[18px]" /></span>
        <StatusBadge tone={tone}>{detail}</StatusBadge>
      </div>
      <p className="mt-4 text-xs text-slate-500">{label}</p>
      <p className="mt-1 font-mono text-[29px] font-semibold leading-none tracking-[-0.06em] text-slate-50">{value}</p>
      <div className="mt-4 flex items-end gap-1.5 opacity-80">
        {[18, 26, 20, 35, 28, 48, 42, 57, 53, 66, 61, 75].map((height, index) => (
          <span className={`flex-1 rounded-t-sm ${tone === "cyan" ? "bg-cyan-300" : tone === "amber" ? "bg-amber-300" : "bg-lime-300"}`} key={index} style={{ height: `${height / 2}px`, opacity: 0.25 + index * 0.05 }} />
        ))}
      </div>
    </article>
  );
}

function CapabilityPill({ capability }: { capability: string }) {
  const action = /\.write$|\.manage$|\.send$|\.review$|\.broadcast\./.test(capability);
  return <span className={`rounded-md border px-2 py-1 font-mono text-[10px] ${action ? "border-lime-300/20 bg-lime-300/5 text-lime-200" : "border-white/10 bg-black/20 text-slate-400"}`}>{capability}</span>;
}

function AuthorityVisualDashboard({
  activeTab,
  filteredUsers,
  onNotify,
  onNewUser,
  onSelectTab,
}: {
  activeTab: AuthorityTabId;
  filteredUsers: AuthorityUser[];
  onNotify: (message: string) => void;
  onNewUser: () => void;
  onSelectTab: (tab: AuthorityTabId, target: string) => void;
}) {
  return (
    <>
      <div className="authority-tabbar mt-4 overflow-x-auto rounded-xl border border-white/10 bg-black/45 p-1" role="tablist" aria-label="Authority sections">
        <div className="flex min-w-max gap-1">
          {authorityTabs.map((tab) => (
            <button
              className={`rounded-lg px-3 py-2 text-[11px] font-medium transition ${activeTab === tab.id ? "bg-lime-300 text-[#071006] shadow-[0_0_18px_rgba(190,255,60,0.2)]" : "text-slate-500 hover:bg-white/[0.05] hover:text-slate-100"}`}
              key={tab.id}
              onClick={() => onSelectTab(tab.id, tab.target)}
              role="tab"
              aria-selected={activeTab === tab.id}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-4 2xl:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)_minmax(330px,0.72fr)]" id="authority-overview">
        <section className="carbon-card rounded-2xl p-4 sm:p-5">
          <SectionTitle eyebrow="AUTHORITY / ROLE DISTRIBUTION" title="Distribuzione ruoli" />
          <div className="mt-5 flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="authority-donut" style={{ background: "conic-gradient(#a8f22f 0 38%, #54c32a 38% 55%, #e6ee59 55% 68%, #f6ad2a 68% 76%, #7aa4ff 76% 93%, #657080 93% 100%)" }}>
              <div className="authority-donut-hole"><strong>48</strong><span>Utenti</span></div>
            </div>
            <div className="w-full space-y-2 sm:max-w-[210px]">
              {authorityRoleDistribution.map((item) => <div className="flex items-center gap-2 text-[11px]" key={item.label}><span className={`authority-legend-dot authority-legend-${item.tone}`} /><span className="min-w-0 flex-1 truncate text-slate-300">{item.label}</span><span className="font-mono text-slate-500">{item.value} ({item.share})</span></div>)}
            </div>
          </div>
        </section>

        <section className="carbon-card rounded-2xl p-4 sm:p-5">
          <SectionTitle eyebrow="AUTHORITY / ACCESS LEVELS" title="Livelli di accesso" />
          <div className="authority-bar-chart mt-5">
            {accessLevels.map((item) => <div className="authority-bar-item" key={item.label}><div className="authority-bar-value">{item.value}</div><div className="authority-bar-track"><span style={{ height: `${Math.max(12, (item.value / 186) * 100)}%` }} /></div><div className="authority-bar-label">{item.label}</div></div>)}
          </div>
        </section>

        <section className="carbon-card rounded-2xl p-4 sm:p-5" id="authority-activity">
          <SectionTitle eyebrow="AUTHORITY / AUDIT STREAM" title="Attività recenti" action="Vedi tutte" onAction={() => onNotify("Audit Log: read model visuale pronto per il collegamento agli eventi")} />
          <div className="mt-4 divide-y divide-white/[0.07]">
            {authorityActivity.map((item) => { const Icon = item.icon; return <button className="flex w-full items-center gap-3 py-3 text-left transition first:pt-0 last:pb-0 hover:bg-white/[0.025]" key={item.title} onClick={() => onNotify(`${item.title}: ${item.detail}`)} type="button"><span className={`grid size-8 shrink-0 place-items-center rounded-lg border ${item.tone === "red" ? "border-rose-300/25 bg-rose-300/10 text-rose-200" : "border-lime-300/20 bg-lime-300/10 text-lime-200"}`}><Icon className="size-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-slate-200">{item.title}</span><span className="mt-1 block truncate text-[10px] text-slate-600">{item.detail}</span></span><span className="shrink-0 text-[10px] text-slate-500">{item.time}</span></button>; })}
          </div>
        </section>
      </div>

      <div className="mt-4 grid gap-4 2xl:grid-cols-[minmax(0,1.38fr)_minmax(330px,0.62fr)]">
        <section className="carbon-card rounded-2xl p-4 sm:p-5" id="authority-users">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><SectionTitle eyebrow="AUTHORITY / USER DIRECTORY" title="Utenti" /><p className="mt-1 text-[11px] text-slate-500">Read model visivo · identità e membership restano server-owned.</p></div><button className="text-[11px] font-medium text-lime-300 transition hover:text-lime-100" onClick={() => onNotify("Utenti: elenco completo disponibile con il relativo adapter")} type="button">Vedi tutti</button></div>
          <div className="mt-4 flex flex-wrap items-center gap-2"><div className="relative min-w-[220px] flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-600" /><div className="h-9 rounded-lg border border-white/10 bg-black/35 pl-9 pr-3 text-[11px] leading-9 text-slate-600">Filtra dalla ricerca Authority in alto</div></div><button className="flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-black/25 px-3 text-[11px] text-slate-400 transition hover:border-lime-300/25 hover:text-lime-200" onClick={() => onNotify("Filtri utenti: read model visuale")} type="button"><Filter className="size-3.5" />Filtri</button></div>
          <div className="mt-4 overflow-x-auto rounded-xl border border-white/[0.08] bg-black/20"><table className="w-full min-w-[720px] text-left"><thead className="border-b border-white/[0.08] text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-600"><tr><th className="w-10 px-3 py-3"><span className="sr-only">Seleziona</span>□</th><th className="px-3 py-3">Nome</th><th className="px-3 py-3">Email</th><th className="px-3 py-3">Ruolo</th><th className="px-3 py-3">Team</th><th className="px-3 py-3">Stato</th><th className="px-3 py-3">Ultimo accesso</th><th className="w-8 px-2 py-3" /></tr></thead><tbody className="divide-y divide-white/[0.07]">{filteredUsers.map((user) => <tr className="transition hover:bg-lime-300/[0.035]" key={user.email}><td className="px-3 py-3 text-slate-600">□</td><td className="px-3 py-3"><div className="flex items-center gap-2.5"><span className={`grid size-7 place-items-center rounded-full border text-[9px] font-bold ${user.tone === "violet" ? "border-violet-300/30 bg-violet-300/15 text-violet-100" : user.tone === "cyan" ? "border-cyan-300/30 bg-cyan-300/15 text-cyan-100" : "border-lime-300/30 bg-lime-300/15 text-lime-100"}`}>{user.initials}</span><span className="whitespace-nowrap text-xs font-medium text-slate-200">{user.name}</span></div></td><td className="whitespace-nowrap px-3 py-3 text-[11px] text-slate-500">{user.email}</td><td className="px-3 py-3"><span className="rounded-md border border-lime-300/20 bg-lime-300/10 px-2 py-1 text-[10px] text-lime-200">{user.role}</span></td><td className="whitespace-nowrap px-3 py-3 text-[11px] text-slate-400">{user.team}</td><td className="px-3 py-3"><span className="flex items-center gap-1.5 text-[10px] text-slate-400"><span className={`size-1.5 rounded-full ${user.status === "Online" ? "bg-lime-300 shadow-[0_0_8px_rgba(190,255,60,0.8)]" : "bg-rose-300"}`} />{user.status}</span></td><td className="whitespace-nowrap px-3 py-3 text-[10px] text-slate-500">{user.lastAccess}</td><td className="px-2 py-3"><button className="grid size-7 place-items-center rounded-md text-slate-600 hover:bg-white/5 hover:text-lime-200" onClick={() => onNotify(`${user.name}: azioni utente disponibili con l'adapter Authority`)} type="button" aria-label={`Azioni per ${user.name}`}><MoreHorizontal className="size-4" /></button></td></tr>)}{filteredUsers.length === 0 && <tr><td className="px-3 py-8 text-center text-xs text-slate-500" colSpan={8}>Nessun utente corrisponde alla ricerca.</td></tr>}</tbody></table></div>
        </section>

        <section className="carbon-card rounded-2xl p-4 sm:p-5" id="authority-teams">
          <SectionTitle eyebrow="AUTHORITY / WORKFORCE GROUPS" title="Team" action="Vedi tutti" onAction={() => onNotify("Team: read model visuale pronto per l'adapter Workforce")} />
          <div className="mt-4 space-y-2">{authorityTeams.map((team) => <button className="flex w-full items-center gap-3 rounded-xl border border-white/[0.07] bg-black/15 p-2.5 text-left transition hover:border-lime-300/25 hover:bg-lime-300/[0.04]" key={team.label} onClick={() => onNotify(`${team.label}: ${team.members} membri nel read model`)} type="button"><span className={`grid size-9 place-items-center rounded-full border text-[10px] font-bold ${team.tone === "violet" ? "border-violet-300/30 bg-violet-300/15 text-violet-100" : "border-lime-300/25 bg-lime-300/10 text-lime-100"}`}>{team.initials}</span><span className="min-w-0 flex-1"><span className="block text-xs font-medium text-slate-200">{team.label}</span><span className="mt-1 block text-[10px] text-slate-600">{team.members} membri</span></span><Users className="size-4 text-slate-600" /></button>)}</div>
        </section>
      </div>

      <div className="mt-4 grid gap-4 2xl:grid-cols-[minmax(0,1.38fr)_minmax(330px,0.62fr)]">
        <section className="carbon-card rounded-2xl p-4 sm:p-5" id="authority-permissions">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><SectionTitle eyebrow="AUTHORITY / CAPABILITY MATRIX" title="Matrice permessi" /><p className="mt-1 text-[11px] text-slate-500">Vista comparativa del catalogo · il resolver canonico resta server-owned.</p></div><button className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-[10px] text-slate-400 transition hover:border-lime-300/25 hover:text-lime-200" onClick={() => onNotify("Gestione permessi: capability catalogo pronto")} type="button"><Settings2 className="size-3.5" />Gestisci permessi</button></div>
          <div className="mt-4 overflow-x-auto rounded-xl border border-white/[0.08] bg-black/20"><table className="w-full min-w-[760px] text-left"><thead className="border-b border-white/[0.08] text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-600"><tr><th className="px-3 py-3">Modulo</th>{["Operatore", "Team Leader", "Manager", "Amministratore", "Tecnico", "Viewer"].map((role) => <th className="px-2 py-3 text-center" key={role}>{role}</th>)}</tr></thead><tbody className="divide-y divide-white/[0.07]">{permissionMatrix.map((row) => <tr key={row.module}><td className="whitespace-nowrap px-3 py-2.5 text-[11px] text-slate-300">{row.module}</td>{row.values.map((value, index) => <td className="px-2 py-2.5 text-center" key={`${row.module}-${index}`}><span className={`inline-flex min-w-[64px] justify-center rounded-md border px-1.5 py-1 text-[9px] ${value === "Amministrazione" ? "border-violet-300/25 bg-violet-300/15 text-violet-100" : value === "Approvazione" ? "border-blue-300/25 bg-blue-300/15 text-blue-100" : value === "Modifica" ? "border-amber-300/25 bg-amber-300/15 text-amber-100" : value === "Nessun accesso" ? "border-white/10 bg-white/[0.04] text-slate-600" : "border-lime-300/20 bg-lime-300/10 text-lime-200"}`}>{value}</span></td>)}</tr>)}</tbody></table></div>
        </section>

        <section className="carbon-card rounded-2xl p-4 sm:p-5" id="authority-policies">
          <SectionTitle eyebrow="AUTHORITY / GOVERNANCE" title="Politiche di accesso" action="Vedi tutte" onAction={() => onNotify("Politiche: configurazione pronta per l'adapter Security")} />
          <div className="mt-4 space-y-3">{authorityPolicies.map((policy) => { const Icon = policy.icon; return <button className="flex w-full items-center gap-3 text-left" key={policy.title} onClick={() => onNotify(`${policy.title}: ${policy.state}`)} type="button"><span className="grid size-9 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/10 text-lime-200"><Icon className="size-4" /></span><span className="min-w-0 flex-1"><span className="block text-xs font-medium text-slate-200">{policy.title}</span><span className="mt-1 block truncate text-[10px] text-slate-600">{policy.detail}</span></span><span className="flex items-center gap-2 text-[10px] text-lime-200">{policy.state}<ChevronRight className="size-3.5 text-slate-600" /></span></button>; })}</div>
        </section>
      </div>

      <section className="authority-assistant-panel carbon-card carbon-card-neon mt-4 rounded-2xl p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl border border-lime-300/25 bg-lime-300/10 text-lime-200"><Activity className="size-4" /></span><div><p className="text-sm font-semibold text-slate-100">AI Assistant</p><p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-lime-200/60">authority / governed preview</p></div></div><StatusBadge>READ ONLY</StatusBadge></div>
        <div className="mt-4 flex flex-wrap gap-2"><button className="rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-[11px] text-slate-400 transition hover:border-lime-300/25 hover:text-lime-200" onClick={() => onNotify("AI Assistant: quali utenti sono offline?")} type="button">Quali utenti sono offline?</button><button className="rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-[11px] text-slate-400 transition hover:border-lime-300/25 hover:text-lime-200" onClick={() => onNotify("AI Assistant: analisi accessi sospetti in sola lettura")} type="button">Analizza accessi sospetti</button><button className="rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-[11px] text-slate-400 transition hover:border-lime-300/25 hover:text-lime-200" onClick={onNewUser} type="button">Crea nuovo profilo</button></div>
      </section>
    </>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const [mobileMenu, setMobileMenu] = useState(false);
  const [activeTab, setActiveTab] = useState<AuthorityTabId>("overview");
  const [selectedRole, setSelectedRole] = useState<AuthorityRole>("owner");
  const [query, setQuery] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileLabel, setProfileLabel] = useState("");
  const [toast, setToast] = useState("");
  const [authorityContext, setAuthorityContext] = useState<AuthorityContextView | null>(null);
  const [profiles, setProfiles] = useState<AccessProfile[]>([]);
  const [profileSubmitting, setProfileSubmitting] = useState(false);

  const filteredRoles = useMemo(() => AUTHORITY_ROLES.filter((role) => role.toLowerCase().includes(query.trim().toLowerCase())), [query]);
  const filteredUsers = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return authorityUsers;
    return authorityUsers.filter((user) => `${user.name} ${user.email} ${user.role} ${user.team}`.toLowerCase().includes(normalized));
  }, [query]);
  const selectedCapabilities = ROLE_CAPABILITIES[selectedRole];
  const contextFields = authorityContext ? [
    { key: "actorId", value: authorityContext.actorId, detail: "Sites auth header", tone: "lime" as Tone },
    { key: "membershipId", value: authorityContext.membershipId, detail: "server-derived owner membership", tone: "lime" as Tone },
    { key: "tenantId", value: authorityContext.tenantId, detail: "Sites project boundary", tone: "lime" as Tone },
    { key: "environment", value: authorityContext.environment, detail: "owner-only publication", tone: "lime" as Tone },
    { key: "role", value: authorityContext.role, detail: "server-resolved application role", tone: "lime" as Tone },
    { key: "capabilities", value: `${authorityContext.capabilities.length} canonical`, detail: "server capability resolver", tone: "lime" as Tone },
    { key: "resourceScope", value: authorityContext.resourceScope, detail: "server-owned scope", tone: "lime" as Tone },
    { key: "fieldScope", value: authorityContext.fieldScope, detail: "field boundary", tone: "lime" as Tone },
    { key: "fileScope", value: authorityContext.fileScope, detail: "Sites file boundary", tone: "lime" as Tone },
    { key: "contextSource", value: authorityContext.contextSource, detail: "required source", tone: "lime" as Tone },
    { key: "sessionId", value: "dispatch-owned", detail: "not exposed to client", tone: "cyan" as Tone },
    { key: "approvalContext", value: authorityContext.approvalContext, detail: "owner approval gate", tone: "lime" as Tone },
  ] : fallbackTenantFields;

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  };

  useEffect(() => {
    let active = true;
    void fetch("/api/authority/access-profiles", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as { context?: AuthorityContextView; profiles?: AccessProfile[]; error?: string };
        if (!active) return;
        if (!response.ok) {
          setToast(payload.error === "authority_store_unavailable" ? "Authority store Sites non disponibile" : "Readback Authority non riuscito");
          return;
        }
        setAuthorityContext(payload.context ?? null);
        setProfiles(payload.profiles ?? []);
      })
      .catch(() => {
        if (active) setToast("Readback Authority non raggiungibile");
      });
    return () => {
      active = false;
    };
  }, []);

  const navigate = (id: string, label: string) => {
    setMobileMenu(false);
    if (id === "command") { router.push("/"); return; }
    if (id === "operations") { router.push("/operations"); return; }
    if (id === "events_authority") return;
    notify(`${label}: superficie prevista nel prossimo modulo`);
  };

  const selectAuthorityTab = (tab: AuthorityTabId, target: string) => {
    setActiveTab(tab);
    window.requestAnimationFrame(() => document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const createProfile = async () => {
    const label = profileLabel.trim();
    if (label.length < 2) {
      notify("Inserisci un'etichetta di almeno 2 caratteri");
      return;
    }

    setProfileSubmitting(true);
    try {
      const response = await fetch("/api/authority/access-profiles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label, role: selectedRole }),
      });
      const payload = (await response.json()) as { profile?: AccessProfile; error?: string; context?: AuthorityContextView };
      if (!response.ok || !payload.profile) {
        notify(payload.error === "authority_store_unavailable" ? "Authority store Sites non disponibile" : "Profilo non salvato");
        return;
      }
      setProfiles((current) => [payload.profile!, ...current]);
      setAuthorityContext(payload.context ?? authorityContext);
      setProfileOpen(false);
      setProfileLabel("");
      notify(`Profilo salvato su Sites: ${payload.profile.label}`);
    } catch {
      notify("Profilo non salvato: errore di rete");
    } finally {
      setProfileSubmitting(false);
    }
  };

  return (
    <main className="authority-page min-h-screen overflow-x-hidden bg-[#050607] text-slate-100 selection:bg-lime-300 selection:text-[#060806]">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_74%_0%,rgba(190,255,60,0.07),transparent_25%),radial-gradient(circle_at_18%_78%,rgba(70,110,120,0.08),transparent_27%)]" />
      <div className="relative flex min-h-screen">
        <aside className={`fixed inset-y-0 left-0 z-40 flex w-[232px] flex-col border-r border-lime-300/10 bg-[#050607]/96 px-3 py-4 backdrop-blur-xl transition-transform lg:static lg:translate-x-0 ${mobileMenu ? "translate-x-0" : "-translate-x-full"}`}>
          <div className="flex items-center justify-between px-2">
            <button className="flex items-center gap-3 text-left" onClick={() => { setMobileMenu(false); router.push("/"); }} type="button">
              <span className="brand-mark neon-pulse relative grid size-10 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black"><img src="/ai-zerow-icon.jpeg" alt="AI-ZEROW" className="size-full object-cover" /></span>
              <span><span className="block text-sm font-bold tracking-[0.18em] text-slate-50">AI-ZEROW</span><span className="block text-[10px] uppercase tracking-[0.22em] text-lime-300/75">command</span></span>
            </button>
            <button className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-white/5 hover:text-white lg:hidden" onClick={() => setMobileMenu(false)} type="button" aria-label="Chiudi menu"><X className="size-4" /></button>
          </div>
          <button className="carbon-card mt-8 flex w-full items-center gap-3 rounded-xl p-3 text-left transition hover:border-lime-300/25" type="button" onClick={() => notify("Workspace ZEROW · contesto owner Sites")}>
            <span className="grid size-8 place-items-center rounded-lg border border-lime-300/20 bg-lime-300/10 text-lime-200"><HardHat className="size-4" /></span>
            <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-slate-200">ZEROW workspace</span><span className="mt-0.5 block truncate text-[10px] text-slate-600">owner · Sites tenant context</span></span><ChevronRight className="size-3.5 text-slate-600" />
          </button>
          <nav className="mt-7 flex-1" aria-label="Navigazione principale">
            <p className="px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-600">Workspace</p>
            <div className="mt-2 space-y-1">
              {navItems.map((item) => { const Icon = item.icon; const active = item.id === "events_authority"; return <button aria-current={active ? "page" : undefined} className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${active ? "border border-lime-300/20 bg-lime-300/10 text-lime-200 shadow-[inset_0_0_20px_rgba(190,255,60,0.04)]" : "text-slate-500 hover:bg-white/[0.045] hover:text-slate-100"}`} key={item.id} onClick={() => navigate(item.id, item.label)} type="button"><Icon className={`size-4 ${active ? "text-lime-200" : "text-slate-600 group-hover:text-slate-300"}`} /><span>{item.label}</span>{item.id === "command" && <span className="ml-auto rounded border border-white/10 px-1.5 py-0.5 font-mono text-[8px] tracking-[0.08em] text-slate-600">AI</span>}</button>; })}
            </div>
          </nav>
          <div className="mt-5 border-t border-white/[0.08] pt-4">
            <div className="flex items-center justify-between px-2 text-[10px] uppercase tracking-[0.14em] text-slate-600"><span>System status</span><span className="flex items-center gap-1.5 text-lime-200"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_8px_rgba(190,255,60,0.8)]" />online</span></div>
            <div className="carbon-inset mt-3 rounded-xl p-3"><div className="flex items-center gap-2 text-[10px] text-slate-400"><ShieldCheck className="size-3.5 text-lime-300" />Authority core</div><div className="mt-2 flex items-end gap-0.5">{[18, 26, 23, 36, 31, 46, 40, 56, 50, 64, 59, 73].map((height, index) => <span className="flex-1 rounded-t-sm bg-lime-300/80" key={index} style={{ height: `${height / 2}px` }} />)}</div><p className="mt-3 font-mono text-[9px] text-slate-600">S02 · SITES NATIVE</p></div>
          </div>
        </aside>

        {mobileMenu && <button className="fixed inset-0 z-30 bg-black/75 lg:hidden" onClick={() => setMobileMenu(false)} aria-label="Chiudi menu" type="button" />}

        <section className="min-w-0 flex-1">
          <header className="authority-topbar sticky top-0 z-20 flex h-[72px] items-center gap-3 border-b border-white/[0.08] bg-[#050607]/88 px-4 backdrop-blur-xl sm:gap-5 sm:px-7">
            <IconButton label="Apri menu" onClick={() => setMobileMenu(true)} className="lg:hidden"><Menu className="size-4" /></IconButton>
            <div className="relative hidden min-w-0 flex-1 md:block"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-600" /><Input aria-label="Cerca utenti, ruoli, permessi, team" className="h-10 max-w-[440px] border-white/10 bg-black/30 pl-10 text-xs text-slate-100 placeholder:text-slate-600 focus-visible:border-lime-300/40" onChange={(event) => setQuery(event.target.value)} placeholder="Cerca utenti, ruoli, permessi, team…" value={query} /></div>
            <div className="flex min-w-0 flex-1 items-center gap-2 md:hidden"><span className="truncate text-xs font-semibold tracking-[0.14em] text-slate-200">AUTHORITY</span><span className="size-1 rounded-full bg-lime-300" /></div>
            <div className="ml-auto flex items-center gap-2">
              <span className={`hidden items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] sm:flex ${authorityContext ? "border-lime-300/20 bg-lime-300/5 text-lime-200" : "border-amber-300/20 bg-amber-300/5 text-amber-200"}`}><span className={`size-1.5 rounded-full shadow-[0_0_9px_currentColor] ${authorityContext ? "bg-lime-300" : "bg-amber-300"}`} />{authorityContext ? "Sites native / verified" : "Readback pending"}</span>
              <IconButton label="Notifiche"><Bell className="size-4" /></IconButton>
              <span className="hidden size-8 place-items-center rounded-full border border-white/15 bg-gradient-to-br from-slate-200 to-slate-500 text-xs font-bold text-[#080a0b] sm:grid">AB</span>
              <div className="hidden text-right lg:block"><p className="text-xs font-medium text-slate-200">{authorityContext?.actorName ?? "Operatore"}</p><p className="text-[10px] text-slate-600">{authorityContext ? `${authorityContext.role} · Sites owner` : "Site owner · readback pending"}</p></div><ChevronDown className="hidden size-3.5 text-slate-500 lg:block" />
            </div>
          </header>

          <div className="authority-content mx-auto max-w-[1680px] px-4 py-5 sm:px-7 sm:py-7">
            <div className="authority-hero mb-5 hidden">
              <div className="authority-hero-grid" aria-hidden="true" />
              <div className="relative flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
                <div className="flex items-center gap-4">
                  <span className="authority-mark"><img src="/ai-zerow-icon.jpeg" alt="AI-ZEROW" className="size-full object-cover" /></span>
                  <div><p className="authority-kicker">COMMAND / AUTHORITY CONTROL PLANE</p><p className="mt-1 text-sm font-medium tracking-wide text-slate-200 sm:text-base">Access matrix <span className="text-slate-600">·</span> tenant boundary <span className="text-slate-600">·</span> governed profiles</p><p className="mt-2 text-xs text-slate-500">S02 is locked for the Sites-native operating scope.</p></div>
                </div>
                <div className="authority-hero-meta grid grid-cols-3 gap-2 sm:min-w-[330px]">
                  <div><span>STATE</span><strong>LOCKED</strong></div><div><span>STORE</span><strong>D1 / SITES</strong></div><div><span>EDGE</span><strong>OWNER PRIVATE</strong></div>
                </div>
              </div>
            </div>
            <div className="authority-title-block mb-5 flex flex-wrap items-end justify-between gap-4"><div><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/70"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_9px_rgba(190,255,60,0.9)]" />AI-ZEROW / COMMAND / AUTHORITY</div><h1 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-50 sm:text-[30px]">Authority</h1><p className="mt-1 text-xs text-slate-500">Gestione utenti, ruoli, permessi e accessi · control center S02</p></div><div className="flex items-center gap-2"><span className="hidden items-center rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-[10px] text-slate-500 sm:inline-flex"><DatabaseZap className="mr-2 size-3.5 text-cyan-300" />{authorityContext ? "Readback Sites verificato" : "Readback in corso"}</span><Button className="h-10 border border-lime-300/30 bg-lime-300 px-4 text-xs font-semibold text-[#060806] shadow-[0_0_22px_rgba(190,255,60,0.18)] transition hover:-translate-y-0.5 hover:bg-lime-200" onClick={() => setProfileOpen(true)}><Plus className="size-3.5" />Nuovo utente</Button></div></div>

            <div className="authority-metrics grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="Utenti attivi" value="48" detail="+12%" icon={Users} tone="lime" /><MetricCard label="Ruoli definiti" value="12" detail="+0%" icon={Package} tone="lime" /><MetricCard label="Permessi" value="186" detail="+6%" icon={KeyRound} tone="lime" /><MetricCard label="Team operativi" value="8" detail="+0%" icon={Users} tone="lime" /></div>

            <AuthorityVisualDashboard activeTab={activeTab} filteredUsers={filteredUsers} onNewUser={() => setProfileOpen(true)} onNotify={notify} onSelectTab={selectAuthorityTab} />

            <div className="mt-4 grid gap-4 2xl:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)]">
              <section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><SectionTitle eyebrow="SITE SESSION / BOUNDARY" title="Contesto corrente" /><p className="mt-1 text-[11px] text-slate-500">Identità, membership e tenant derivano dal server Sites.</p></div><StatusBadge tone={authorityContext ? "lime" : "amber"}>{authorityContext ? "SITES NATIVE" : "READBACK PENDING"}</StatusBadge></div><div className="carbon-card-neon mt-4 rounded-xl border p-4"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl border border-lime-300/30 bg-lime-300/10 text-lime-200"><LockKeyhole className="size-5" /></span><div><p className="text-sm font-semibold text-slate-100">Owner-only Site access</p><p className="mt-1 text-[11px] text-slate-500">Accesso verificato dal perimetro privato Sites</p></div></div><div className="mt-4 grid grid-cols-2 gap-2"><div className="rounded-lg border border-white/10 bg-black/25 p-3"><p className="text-[10px] uppercase tracking-[0.12em] text-slate-600">Account</p><p className="mt-1 truncate text-xs text-lime-200">{authorityContext?.actorEmail ?? "owner"}</p></div><div className="rounded-lg border border-white/10 bg-black/25 p-3"><p className="text-[10px] uppercase tracking-[0.12em] text-slate-600">App role</p><p className="mt-1 text-xs text-lime-200">{authorityContext?.role ?? "readback pending"}</p></div></div></div><div className="mt-4 space-y-2"><div className="flex items-center gap-2 rounded-lg border border-cyan-300/15 bg-cyan-300/5 px-3 py-2.5 text-[11px] text-cyan-100/80"><ShieldCheck className="size-4 shrink-0 text-cyan-200" /><span>Client identity: <strong className="font-medium text-cyan-100">server-owned</strong></span></div><div className="flex items-center gap-2 rounded-lg border border-lime-300/15 bg-lime-300/5 px-3 py-2.5 text-[11px] text-lime-100/80"><LockKeyhole className="size-4 shrink-0 text-lime-200" /><span>Tenant isolation: <strong className="font-medium text-lime-100">assertTenantScope</strong></span></div><div className="flex items-center gap-2 rounded-lg border border-lime-300/15 bg-lime-300/5 px-3 py-2.5 text-[11px] text-lime-100/80"><CheckCircle2 className="size-4 shrink-0 text-lime-200" /><span>Resolver runtime: <strong className="font-medium text-lime-100">Sites auth + D1 active</strong></span></div></div></section>
              <section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><SectionTitle eyebrow="TENANT CONTEXT / SITES CONTRACT" title="Identity context fields" /><p className="mt-1 text-[11px] text-slate-500">Campi derivati server-side dal contesto Sites owner-private.</p></div><IconButton label="Verifica contesto" onClick={() => notify(authorityContext ? "TenantContext Sites verificato" : "TenantContext in attesa del readback")}><Settings2 className="size-4" /></IconButton></div><div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{contextFields.map((field) => <div className="carbon-inset rounded-xl p-3" key={field.key}><div className="flex items-center justify-between gap-2"><span className="font-mono text-[10px] text-slate-500">{field.key}</span><span className={`size-1.5 rounded-full ${field.tone === "lime" ? "bg-lime-300" : field.tone === "cyan" ? "bg-cyan-300" : field.tone === "amber" ? "bg-amber-300" : "bg-rose-300"}`} /></div><p className="mt-2 truncate text-xs font-medium text-slate-200">{field.value}</p><p className="mt-1 truncate text-[10px] text-slate-600">{field.detail}</p></div>)}</div></section>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
              <section className="carbon-card rounded-2xl p-4 sm:p-5" id="authority-roles"><div className="flex flex-wrap items-start justify-between gap-3"><div><SectionTitle eyebrow="ROLE CATALOG / 13" title="Ruoli canonici" /><p className="mt-1 text-[11px] text-slate-500">Catalogo server condiviso con il profilo accesso.</p></div><StatusBadge>SITES CATALOG</StatusBadge></div><div className="mt-4 space-y-1.5">{filteredRoles.map((role) => { const active = role === selectedRole; return <button className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${active ? "border-lime-300/35 bg-lime-300/10" : "border-white/[0.07] bg-black/15 hover:border-lime-300/20 hover:bg-white/[0.035]"}`} key={role} onClick={() => setSelectedRole(role)} type="button"><span className={`grid size-8 place-items-center rounded-lg border ${active ? "border-lime-300/25 bg-lime-300/10 text-lime-200" : "border-white/10 bg-black/20 text-slate-600"}`}><UserRoundCog className="size-3.5" /></span><span className="min-w-0 flex-1"><span className={`block text-xs font-medium ${active ? "text-lime-100" : "text-slate-300"}`}>{role}</span><span className="mt-1 block text-[10px] text-slate-600">{ROLE_CAPABILITIES[role].length} capability</span></span>{active && <Check className="size-4 text-lime-200" />}</button>; })}{filteredRoles.length === 0 && <div className="rounded-xl border border-white/10 p-5 text-center text-xs text-slate-500">Nessun ruolo trovato nel catalogo.</div>}</div></section>
              <section className="carbon-card carbon-card-neon rounded-2xl p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><SectionTitle eyebrow="CAPABILITY RESOLVER / READ MODEL" title={selectedRole} /><p className="mt-1 text-[11px] text-slate-500">Array canonico esposto dal resolver condiviso.</p></div><div className="flex items-center gap-2"><StatusBadge>SITES VERIFIED</StatusBadge><button className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-lime-300 hover:text-lime-100" onClick={() => notify(`Capability ${selectedRole}: catalogo Sites verificato`)} type="button">Readback <ArrowUpRight className="size-3.5" /></button></div></div><div className="carbon-inset mt-4 rounded-xl p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-[10px] uppercase tracking-[0.14em] text-slate-600">Capability count</p><p className="mt-1 font-mono text-3xl font-semibold tracking-[-0.07em] text-slate-50">{selectedCapabilities.length}</p></div><div className="text-right"><p className="text-[11px] text-slate-500">Source</p><p className="mt-1 font-mono text-[10px] text-cyan-200">authority-catalog</p></div></div><div className="mt-4 flex flex-wrap gap-2">{selectedCapabilities.map((capability) => <CapabilityPill capability={capability} key={capability} />)}</div></div><div className="mt-4 flex items-start gap-2 rounded-xl border border-lime-300/20 bg-lime-300/5 p-3 text-[11px] leading-5 text-lime-100/80"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-lime-200" />Il client può selezionare solo un ruolo canonico; capability, tenant e creator vengono ricostruiti dal server.</div></section>
            </div>

            <section className="carbon-card mt-4 rounded-2xl p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><SectionTitle eyebrow="ACCESS PROFILES / D1 READBACK" title="Profili accesso salvati" /><p className="mt-1 text-[11px] text-slate-500">Profili persistenti nel database Sites, isolati dal tenant owner-private.</p></div><StatusBadge tone={authorityContext ? "lime" : "amber"}>{authorityContext ? `${profiles.length} READ` : "READBACK PENDING"}</StatusBadge></div><div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{profiles.map((profile) => <article className="carbon-inset rounded-xl p-3" key={profile.id}><div className="flex items-start gap-3"><span className="grid size-9 place-items-center rounded-lg border border-lime-300/20 bg-lime-300/10 text-lime-200"><UserRoundCog className="size-4" /></span><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-slate-100">{profile.label}</p><p className="mt-1 font-mono text-[10px] uppercase tracking-[0.08em] text-lime-200/75">{profile.baseRole}</p></div><CheckCircle2 className="size-4 shrink-0 text-lime-300" /></div><div className="mt-3 flex items-center justify-between text-[10px] text-slate-600"><span>{profile.capabilities.length} capability</span><span>{profile.createdAt.slice(0, 10)}</span></div></article>)}{profiles.length === 0 && <div className="rounded-xl border border-dashed border-white/10 p-5 text-center text-xs text-slate-500 md:col-span-2 xl:col-span-3">Nessun profilo salvato. Crea il primo ruolo operativo dal comando in alto.</div>}</div></section>

            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]"><section className="carbon-card rounded-2xl p-4 sm:p-5"><SectionTitle eyebrow="AUTHORITY / NEGATIVE CASES" title="Casi di sicurezza" action="Apri evidenze" onAction={() => notify("Evidence ledger: guard Sites S02 attive")} /><div className="mt-4 grid gap-2 sm:grid-cols-2">{negativeCases.map((item) => { const Icon = item.icon; return <div className="carbon-inset flex items-center gap-3 rounded-xl p-3" key={item.title}><span className={`grid size-8 place-items-center rounded-lg border ${toneStyles[item.tone].badge}`}><Icon className="size-4" /></span><div className="min-w-0 flex-1"><p className="text-xs font-medium text-slate-200">{item.title}</p><p className="mt-1 truncate text-[10px] text-slate-500">{item.expected}</p></div><span className={`shrink-0 rounded border px-1.5 py-1 font-mono text-[9px] ${item.tone === "lime" ? "border-lime-300/20 text-lime-200" : item.tone === "cyan" ? "border-cyan-300/20 text-cyan-200" : "border-amber-300/20 text-amber-200"}`}>{item.status}</span></div>; })}</div></section><section className="carbon-card rounded-2xl p-4 sm:p-5"><SectionTitle eyebrow="AUTHORITY BOUNDARY" title="Readback implementato" /><div className="mt-4 space-y-3">{[{ icon: DatabaseZap, title: "Sites workspace auth", detail: "actorId e email derivati dagli header server", tone: "lime" as Tone }, { icon: Building2, title: "Sites tenant resolver", detail: "tenantId = confine del progetto owner-private", tone: "lime" as Tone }, { icon: ShieldCheck, title: "Permission resolver", detail: "tenant.manage richiesto per i profili", tone: "lime" as Tone }].map((item) => { const Icon = item.icon; return <div className="flex items-center gap-3" key={item.title}><span className={`grid size-9 place-items-center rounded-xl border ${toneStyles[item.tone].badge}`}><Icon className="size-4" /></span><div className="min-w-0 flex-1"><p className="text-xs font-medium text-slate-200">{item.title}</p><p className="mt-1 text-[11px] text-slate-500">{item.detail}</p></div><span className="font-mono text-[9px] text-lime-200">ACTIVE</span></div>; })}</div><div className="mt-5 flex items-start gap-2 rounded-xl border border-lime-300/15 bg-lime-300/5 p-3 text-[11px] leading-5 text-lime-100/75"><KeyRound className="mt-0.5 size-4 shrink-0 text-lime-200" />S02 usa esclusivamente auth e storage nativi Sites. L’adapter multi-tenant esterno resta fuori da questo perimetro.</div></section></div>

            <section className="carbon-card mt-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl p-4 sm:p-5"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl border border-lime-300/25 bg-lime-300/10 text-lime-200"><ShieldCheck className="size-4" /></span><div><p className="text-sm font-semibold text-slate-100">S02 CLOSED · Sites native</p><p className="mt-1 text-[11px] text-slate-500">Auth, tenant boundary, 13 ruoli canonici, capability gate e profili persistenti sono chiusi nel perimetro Sites.</p></div></div><div className="flex items-center gap-2"><StatusBadge>S02 CLOSED</StatusBadge><button className="grid size-8 place-items-center rounded-lg border border-white/10 text-slate-500 hover:border-lime-300/30 hover:text-lime-200" onClick={() => notify("S02: Sites native, nessuna dipendenza esterna") } type="button" aria-label="Apri evidenze"><ArrowUpRight className="size-3.5" /></button></div></section>
            <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] py-5 text-[10px] text-slate-600"><span>AI-ZEROW AUTHORITY · S02 CLOSED</span><span className="flex items-center gap-2"><span>black carbon core</span><span className="size-1 rounded-full bg-lime-300" /><span>Sites-only authority</span></span></footer>
          </div>
        </section>
      </div>

      <div className="authority-mobile-nav fixed inset-x-3 bottom-3 z-40 grid grid-cols-5 items-center rounded-2xl border border-lime-300/20 bg-[#070a09]/95 p-2 shadow-[0_0_28px_rgba(0,0,0,0.45)] backdrop-blur-xl lg:hidden">
        <button className="flex flex-col items-center gap-1 rounded-xl px-2 py-1.5 text-[9px] text-slate-500" onClick={() => selectAuthorityTab("overview", "authority-overview")} type="button"><Building2 className="size-4" />Home</button>
        <button className="flex flex-col items-center gap-1 rounded-xl px-2 py-1.5 text-[9px] text-slate-500" onClick={() => selectAuthorityTab("users", "authority-users")} type="button"><Users className="size-4" />Utenti</button>
        <button className="grid size-12 -translate-y-3 place-items-center rounded-full border border-lime-200/70 bg-lime-300 text-[#071006] shadow-[0_0_24px_rgba(190,255,60,0.35)]" onClick={() => setProfileOpen(true)} type="button" aria-label="Nuovo utente"><Plus className="size-5" /></button>
        <button className="flex flex-col items-center gap-1 rounded-xl px-2 py-1.5 text-[9px] text-lime-200" onClick={() => selectAuthorityTab("roles", "authority-roles")} type="button"><ShieldCheck className="size-4" />Authority</button>
        <button className="flex flex-col items-center gap-1 rounded-xl px-2 py-1.5 text-[9px] text-slate-500" onClick={() => setMobileMenu(true)} type="button"><Menu className="size-4" />Menu</button>
      </div>

      <Dialog open={profileOpen} onOpenChange={setProfileOpen}><DialogContent className="border-lime-300/20 bg-[#0a0d0e] text-slate-100 sm:max-w-[520px]"><DialogHeader><DialogTitle className="text-slate-100">Crea profilo accesso</DialogTitle><DialogDescription className="text-slate-500">Il profilo viene salvato nel database Sites con tenant, creator e capability ricostruiti dal server.</DialogDescription></DialogHeader><div className="space-y-4"><div className="space-y-2"><label className="text-xs text-slate-400" htmlFor="profile-label">Etichetta profilo</label><Input id="profile-label" className="border-white/10 bg-black/30 text-slate-100" onChange={(event) => setProfileLabel(event.target.value)} placeholder="Es. Responsabile operativo" value={profileLabel} /></div><div className="space-y-2"><p className="text-xs text-slate-400">Ruolo base</p><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{AUTHORITY_ROLES.slice(0, 6).map((role) => <button className={`rounded-lg border px-3 py-2 text-left text-[11px] transition ${selectedRole === role ? "border-lime-300/35 bg-lime-300/10 text-lime-100" : "border-white/10 bg-black/20 text-slate-400 hover:border-lime-300/25"}`} key={role} onClick={() => setSelectedRole(role)} type="button">{role}</button>)}</div></div><div className="flex items-start gap-2 rounded-xl border border-lime-300/15 bg-lime-300/5 p-3 text-[11px] leading-5 text-lime-100/80"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-lime-200" />Il client invia solo etichetta e ruolo canonico. Il server applica tenant, creator e capability.</div></div><DialogFooter><DialogClose asChild><Button type="button" variant="outline" className="border-white/10 bg-transparent text-slate-400">Annulla</Button></DialogClose><Button type="button" disabled={profileSubmitting} className="bg-lime-300 text-[#060806] hover:bg-lime-200" onClick={() => void createProfile()}><Send className="size-3.5" />{profileSubmitting ? "Salvataggio…" : "Salva profilo"}</Button></DialogFooter></DialogContent></Dialog>
      {toast && <div className="fixed bottom-5 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2 rounded-xl border border-lime-300/25 bg-[#0b1008]/95 px-4 py-3 text-xs text-lime-100 shadow-[0_0_30px_rgba(190,255,60,0.14)] backdrop-blur-xl"><CheckCircle2 className="size-4 text-lime-300" />{toast}</div>}
    </main>
  );
}
