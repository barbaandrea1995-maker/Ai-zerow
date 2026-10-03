"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import Image from "next/image";
import {
  Activity,
  ArrowLeft,
  ArrowUpRight,
  Bell,
  BriefcaseBusiness,
  Building2,
  Check,
  CheckCircle2,
  Clock3,
  ChevronDown,
  ChevronRight,
  CircleGauge,
  CircleHelp,
  CircleX,
  Crosshair,
  DatabaseZap,
  FileText,
  Gauge,
  HardHat,
  KeyRound,
  LoaderCircle,
  LocateFixed,
  LockKeyhole,
  Menu,
  MessageSquareText,
  Navigation,
  Package,
  PanelRight,
  Plus,
  Search,
  RefreshCw,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Truck,
  UserRoundCog,
  Users,
  X,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CommandMobileNav } from "@/components/command-mobile-nav";
import AuthorityMembershipControl, {
  type AuthorityInvitationView,
  type AuthorityMembershipView,
} from "@/components/authority-membership-control";
import { TenantOperatingProfile } from "@/components/tenant-operating-profile";
import TenantWarehouseControl from "@/components/tenant-warehouse-control";
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
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRouter } from "next/navigation";
import {
  AUTHORITY_ROLES,
  ROLE_CAPABILITIES,
  ROLE_METADATA,
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
  roles?: string[];
  capabilities: string[];
  operatingProfile: string;
  operatingDomains: string[];
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

type AuthorityTeamView = {
  id: string;
  tenantId: string;
  code: string | null;
  name: string;
  description: string;
  status: string;
  capacity: number;
  qualifications: string[];
  memberIds: string[];
  members: AuthorityMembershipView[];
  activeMemberCount: number;
  createdAt: string;
  updatedAt: string;
};

type AuthorityTabId =
  | "overview"
  | "users"
  | "roles"
  | "permissions"
  | "teams"
  | "access"
  | "audit"
  | "policies";

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

const authorityTabs: Array<{
  id: AuthorityTabId;
  label: string;
  target: string;
}> = [
  { id: "overview", label: "Panoramica", target: "authority-overview" },
  { id: "users", label: "Utenti", target: "authority-users" },
  { id: "roles", label: "Ruoli", target: "authority-roles" },
  { id: "permissions", label: "Permessi", target: "authority-permissions" },
  { id: "teams", label: "Team", target: "authority-teams" },
  { id: "access", label: "Accessi", target: "authority-policies" },
  { id: "audit", label: "Audit Log", target: "authority-activity" },
  { id: "policies", label: "Politiche", target: "authority-policies" },
];

const authorityRoleDistribution: Array<{
  label: string;
  value: number;
  share: string;
  tone: string;
}> = [];

const authorityActivity: Array<{
  icon: typeof Users;
  title: string;
  detail: string;
  time: string;
  tone: Tone;
}> = [];

const permissionMatrixRoles = [
  "worker",
  "field_supervisor",
  "manager",
  "admin",
  "technical",
  "auditor",
] as const;
const permissionModules = [
  { module: "Command", read: "command.read", write: "command.customize" },
  { module: "Commesse", read: "operations.read", write: "operations.write" },
  { module: "Asset", read: "asset.read", write: "asset.write" },
  { module: "Pianificazione", read: "planning.read", write: "planning.write" },
  { module: "Workforce", read: "workforce.read", write: "workforce.manage" },
  { module: "Presenze", read: "attendance.read", write: "attendance.manage" },
  { module: "Magazzino", read: "warehouse.read", write: "warehouse.write" },
  { module: "Documenti", read: "documents.read", write: "documents.write" },
  { module: "Authority", read: "authority.read", write: "authority.manage" },
] as const;

const permissionMatrix = permissionModules.map((module) => ({
  module: module.module,
  values: permissionMatrixRoles.map((role) => {
    const capabilities: readonly string[] = ROLE_CAPABILITIES[role];
    if (capabilities.includes(module.write))
      return module.write === "authority.manage"
        ? "Amministrazione"
        : "Modifica";
    if (capabilities.includes(module.read)) return "Lettura";
    return "Nessun accesso";
  }),
}));

const authorityPolicies = [
  {
    icon: LockKeyhole,
    title: "Autenticazione a due fattori",
    detail: "Policy del provider per ruoli amministrativi",
    state: "NOT RUN",
  },
  {
    icon: CircleGauge,
    title: "Durata sessione",
    detail: "Governata dal provider di identita",
    state: "PROVIDER",
  },
  {
    icon: ShieldCheck,
    title: "Accesso da dispositivi",
    detail: "Allowlist e postura dispositivo",
    state: "DEFERRED",
  },
  {
    icon: Activity,
    title: "Log attivita",
    detail: "Ledger applicativo tenant-scoped",
    state: "PARTIAL",
  },
  {
    icon: KeyRound,
    title: "Politica password",
    detail: "Governata da Neon Auth",
    state: "PROVIDER",
  },
];

const authorityKpis = [
  {
    label: "Utenti attivi",
    value: "0",
    delta: "Nessun dato",
    icon: Users,
    tone: "lime" as const,
    data: "",
  },
  {
    label: "Ruoli definiti",
    value: "—",
    delta: "Catalogo",
    icon: UserRoundCog,
    tone: "cyan" as const,
    data: "",
  },
  {
    label: "Permessi",
    value: "—",
    delta: "Catalogo",
    icon: KeyRound,
    tone: "lime" as const,
    data: "",
  },
  {
    label: "Team operativi",
    value: "0",
    delta: "Nessun dato",
    icon: Users,
    tone: "lime" as const,
    data: "",
  },
];

const navItems: Array<{ label: string; id: string; icon: LucideIcon; capability?: string }> = [
  { label: "CONTROL", id: "command", icon: MessageSquareText, capability: "command.read" },
  { label: "OPERATIONS", id: "operations", icon: BriefcaseBusiness, capability: "operations.read" },
  { label: "WORKFORCE", id: "workforce", icon: Users, capability: "workforce.read" },
  { label: "FINANCE", id: "finance", icon: Gauge, capability: "finance.read" },
  { label: "ASSETS", id: "assets", icon: Package, capability: "asset.read" },
  { label: "WAREHOUSE", id: "warehouse", icon: Package, capability: "warehouse.read" },
  { label: "MISSION", id: "mission", icon: Truck, capability: "mission.read" },
  { label: "DOCUMENTS", id: "documents", icon: FileText, capability: "documents.read" },
  { label: "EVENTS / AUTHORITY", id: "events_authority", icon: ShieldCheck, capability: "authority.read" },
  { label: "PWA / DIAGNOSTICS", id: "pwa", icon: CircleGauge, capability: "command.read" },
];

const fallbackTenantFields = [
  {
    key: "actorId",
    value: "readback pending",
    detail: "Sites/Neon server identity",
    tone: "amber" as Tone,
  },
  {
    key: "membershipId",
    value: "readback pending",
    detail: "server-derived membership",
    tone: "amber" as Tone,
  },
  {
    key: "tenantId",
    value: "D1 membership",
    detail: "server-selected tenant",
    tone: "cyan" as Tone,
  },
  {
    key: "environment",
    value: "Sites production",
    detail: "owner-only publication",
    tone: "lime" as Tone,
  },
  {
    key: "role",
    value: "readback pending",
    detail: "server-resolved role",
    tone: "amber" as Tone,
  },
  {
    key: "capabilities",
    value: "13 canonical roles",
    detail: "immutable catalog",
    tone: "cyan" as Tone,
  },
  {
    key: "resourceScope",
    value: "tenant",
    detail: "server-owned scope",
    tone: "lime" as Tone,
  },
  {
    key: "fieldScope",
    value: "tenant",
    detail: "field boundary",
    tone: "lime" as Tone,
  },
  {
    key: "fileScope",
    value: "site",
    detail: "Sites file boundary",
    tone: "lime" as Tone,
  },
  {
    key: "contextSource",
    value: "Sites or Neon Auth",
    detail: "server-resolved source",
    tone: "lime" as Tone,
  },
  {
    key: "sessionId",
    value: "server session",
    detail: "not exposed to client",
    tone: "cyan" as Tone,
  },
  {
    key: "approvalContext",
    value: "owner",
    detail: "owner approval gate",
    tone: "lime" as Tone,
  },
];

const negativeCases = [
  {
    title: "Unauthenticated",
    expected: "API returns 401",
    status: "SITES GUARD",
    tone: "lime" as Tone,
    icon: CircleHelp,
  },
  {
    title: "Capability missing",
    expected: "tenant.manage gate returns 403",
    status: "SITES GUARD",
    tone: "lime" as Tone,
    icon: LockKeyhole,
  },
  {
    title: "Organization missing",
    expected: "D1 membership required",
    status: "D1 GUARD",
    tone: "cyan" as Tone,
    icon: Building2,
  },
  {
    title: "Expired session",
    expected: "Neon/Sites identity rejected",
    status: "AUTH GUARD",
    tone: "lime" as Tone,
    icon: CheckCircle2,
  },
  {
    title: "Cross-tenant resource",
    expected: "assertTenantScope boundary",
    status: "SITES GUARD",
    tone: "lime" as Tone,
    icon: ShieldCheck,
  },
  {
    title: "Tenant A / B",
    expected: "membership verified server-side",
    status: "D1 GUARD",
    tone: "lime" as Tone,
    icon: CircleX,
  },
];

const toneStyles: Record<
  Tone,
  { icon: string; badge: string; glow: string; line: string }
> = {
  lime: {
    icon: "text-lime-300",
    badge: "border-lime-300/25 bg-lime-300/10 text-lime-200",
    glow: "shadow-[0_0_18px_rgba(190,255,60,0.22)]",
    line: "rgba(203,255,73,0.76)",
  },
  cyan: {
    icon: "text-cyan-300",
    badge: "border-cyan-300/25 bg-cyan-300/10 text-cyan-200",
    glow: "shadow-[0_0_18px_rgba(62,222,255,0.18)]",
    line: "rgba(62,222,255,0.72)",
  },
  amber: {
    icon: "text-amber-300",
    badge: "border-amber-300/25 bg-amber-300/5 text-amber-200",
    glow: "shadow-[0_0_18px_rgba(255,188,66,0.18)]",
    line: "rgba(255,188,66,0.72)",
  },
  red: {
    icon: "text-rose-300",
    badge: "border-rose-300/25 bg-rose-300/10 text-rose-200",
    glow: "shadow-[0_0_18px_rgba(255,84,111,0.18)]",
    line: "rgba(255,84,111,0.72)",
  },
};

function IconButton({
  label,
  children,
  onClick,
  className = "",
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
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

function StatusBadge({
  children,
  tone = "lime",
}: {
  children: ReactNode;
  tone?: Tone;
}) {
  const styles = toneStyles[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-semibold tracking-[0.05em] ${styles.badge}`}
    >
      <span className={`size-1.5 rounded-full bg-current ${styles.glow}`} />
      {children}
    </span>
  );
}

function SectionTitle({
  eyebrow,
  title,
  action,
  onAction,
}: {
  eyebrow?: string;
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        {eyebrow && (
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/65">
            {eyebrow}
          </p>
        )}
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-slate-100">
          {title}
        </h2>
      </div>
      {action && (
        <button
          className="text-[11px] font-medium text-lime-300 transition hover:text-lime-100"
          onClick={onAction}
          type="button"
        >
          {action}
        </button>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  delta,
  icon: Icon,
  tone,
  data,
}: (typeof authorityKpis)[number]) {
  void data;
  return (
    <article
      className={`carbon-card carbon-card-neon min-w-0 rounded-2xl p-4 ${tone === "cyan" ? "carbon-card-cyan" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <span
          className={`grid size-9 place-items-center rounded-xl border border-current/20 bg-current/10 ${toneStyles[tone].icon}`}
        >
          <Icon className="size-[18px]" />
        </span>
        <StatusBadge tone={tone}>{delta}</StatusBadge>
      </div>
      <p className="mt-4 text-xs text-slate-500">{label}</p>
      <div className="mt-1 flex items-end justify-between gap-4">
        <p className="font-mono text-[30px] font-semibold leading-none tracking-[-0.06em] text-slate-50">
          {value}
        </p>
        <span className="pb-1 text-[10px] uppercase tracking-[0.12em] text-slate-500">
          D1 readback
        </span>
      </div>
      <p className="mt-3 text-[10px] text-slate-600">
        Nessun dato demo. Il valore arriva dal collegamento Authority.
      </p>
    </article>
  );
}

function CapabilityPill({ capability }: { capability: string }) {
  const action = /\.write$|\.manage$|\.send$|\.review$|\.broadcast\./.test(
    capability,
  );
  return (
    <span
      className={`rounded-md border px-2 py-1 font-mono text-[10px] ${action ? "border-lime-300/20 bg-lime-300/5 text-lime-200" : "border-white/10 bg-black/20 text-slate-400"}`}
    >
      {capability}
    </span>
  );
}

function AuthorityVisualDashboard({
  activeTab,
  canManageAuthority,
  filteredRoles,
  filteredUsers,
  onNotify,
  onNewUser,
  onNewTeam,
  onRefresh,
  onSelectRole,
  onSelectTab,
  selectedRole,
  teams,
}: {
  activeTab: AuthorityTabId;
  canManageAuthority: boolean;
  filteredRoles: AuthorityRole[];
  filteredUsers: AuthorityUser[];
  onNotify: (message: string) => void;
  onNewUser: () => void;
  onNewTeam: () => void;
  onRefresh: () => void;
  onSelectRole: (role: AuthorityRole) => void;
  onSelectTab: (tab: AuthorityTabId, target: string) => void;
  selectedRole: AuthorityRole;
  teams: AuthorityTeamView[];
}) {
  const roleNodePositions = [
    { left: "18%", top: "24%" },
    { left: "48%", top: "18%" },
    { left: "78%", top: "30%" },
    { left: "25%", top: "72%" },
    { left: "69%", top: "75%" },
  ];
  const handleTabChange = (value: string) => {
    const tab = authorityTabs.find((item) => item.id === value);
    if (tab) onSelectTab(tab.id, tab.target);
  };

  return (
    <>
      <div
        className="mt-4 grid gap-4 2xl:grid-cols-[minmax(0,1.4fr)_minmax(340px,0.65fr)]"
        id="authority-overview"
      >
        <section className="carbon-card rounded-2xl p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-3 px-1 pb-3">
            <div className="flex items-center gap-3">
              <span className="grid size-8 place-items-center rounded-lg border border-lime-300/25 bg-lime-300/10 text-lime-200">
                <ShieldCheck className="size-4" />
              </span>
              <div>
                <SectionTitle
                  eyebrow="AUTHORITY / LIVE"
                  title="Authority control"
                />
                <p className="mt-0.5 text-[11px] text-slate-500">
                  Utenti, ruoli e accessi sotto controllo
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="hidden items-center gap-1.5 rounded-full border border-lime-300/15 bg-lime-300/5 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-lime-200 sm:flex">
                <span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_10px_rgba(190,255,60,0.9)]" />
                S02 · Sites native
              </span>
              <IconButton
                label="Schermo intero"
                onClick={() =>
                  onNotify("Authority overview: preview control plane")
                }
              >
                <PanelRight className="size-4" />
              </IconButton>
            </div>
          </div>
          <div className="relative min-h-[360px] overflow-hidden rounded-xl border border-white/10 bg-[#050607] sm:min-h-[430px]">
            <div className="map-grid absolute inset-0 opacity-80" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_52%_48%,rgba(190,255,60,0.12),transparent_25%),radial-gradient(circle_at_16%_80%,rgba(65,224,255,0.07),transparent_22%)]" />
            <svg
              className="absolute inset-0 h-full w-full"
              viewBox="0 0 900 500"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path
                d="M110 118L420 245L760 145M205 390L420 245L705 385"
                fill="none"
                stroke="rgba(190,255,60,0.66)"
                strokeDasharray="5 8"
                strokeLinecap="round"
                strokeWidth="2"
              />
              <path
                d="M110 118L420 245L760 145M205 390L420 245L705 385"
                fill="none"
                opacity="0.2"
                stroke="rgba(190,255,60,0.85)"
                strokeLinecap="round"
                strokeWidth="12"
              />
              <circle cx="420" cy="245" r="7" fill="#d6ff4c" />
              <circle
                cx="420"
                cy="245"
                r="28"
                fill="none"
                opacity="0.35"
                stroke="#d6ff4c"
                strokeDasharray="3 7"
              />
              <circle cx="110" cy="118" r="4" fill="#d6ff4c" />
              <circle cx="760" cy="145" r="4" fill="#d6ff4c" />
              <circle cx="205" cy="390" r="4" fill="#d6ff4c" />
              <circle cx="705" cy="385" r="4" fill="#d6ff4c" />
            </svg>
            <div className="absolute left-3 top-3 flex items-center gap-2 rounded-lg border border-white/10 bg-black/70 px-2.5 py-2 backdrop-blur">
              <Navigation className="size-3.5 text-lime-300" />
              <span className="text-[10px] font-medium text-slate-300">
                TENANT / OWNER-PRIVATE
              </span>
            </div>
            <div className="absolute right-3 top-3 flex flex-col gap-1 rounded-lg border border-white/10 bg-black/75 p-1 backdrop-blur">
              <IconButton
                label="Zoom in"
                className="size-8 rounded-md border-0 bg-transparent hover:bg-white/10"
                onClick={() =>
                  onNotify(
                    "Authority graph: zoom in disponibile nel modulo runtime",
                  )
                }
              >
                <ZoomIn className="size-3.5" />
              </IconButton>
              <IconButton
                label="Zoom out"
                className="size-8 rounded-md border-0 bg-transparent hover:bg-white/10"
                onClick={() =>
                  onNotify(
                    "Authority graph: zoom out disponibile nel modulo runtime",
                  )
                }
              >
                <ZoomOut className="size-3.5" />
              </IconButton>
              <div className="mx-1 h-px bg-white/10" />
              <IconButton
                label="Centra Authority"
                className="size-8 rounded-md border-0 bg-transparent hover:bg-white/10"
                onClick={() =>
                  onNotify("Authority core centrato sul tenant Sites")
                }
              >
                <LocateFixed className="size-3.5" />
              </IconButton>
            </div>
            <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center text-center">
              <span className="grid size-16 place-items-center rounded-full border border-lime-200/70 bg-lime-300/15 text-lime-200 shadow-[0_0_34px_rgba(190,255,60,0.25)]">
                <ShieldCheck className="size-7" />
              </span>
              <span className="mt-2 rounded-lg border border-lime-300/25 bg-black/75 px-3 py-1.5 text-[11px] font-semibold text-slate-100 backdrop-blur">
                Authority core
              </span>
              <span className="mt-1 text-[10px] text-lime-200">
                13 ruoli · 186 permessi
              </span>
            </div>
            {authorityRoleDistribution.slice(0, 5).map((role, index) => (
              <button
                className="absolute -translate-x-1/2 -translate-y-1/2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300"
                key={role.label}
                style={roleNodePositions[index]}
                onClick={() =>
                  onNotify(
                    `${role.label}: ${role.value} utenti · ${role.share}`,
                  )
                }
                type="button"
              >
                <span className="relative flex items-center gap-2 rounded-lg border border-white/15 bg-black/75 px-2 py-1.5 backdrop-blur-md transition hover:border-lime-300/40">
                  <span
                    className={`grid size-6 place-items-center rounded-md border border-current/20 bg-current/10 ${index === 2 ? "text-amber-200" : "text-lime-200"}`}
                  >
                    <UserRoundCog className="size-3.5" />
                  </span>
                  <span>
                    <span className="block text-[11px] font-semibold text-slate-100">
                      {role.label}
                    </span>
                    <span className="block text-[10px] text-lime-200">
                      {role.value} utenti
                    </span>
                  </span>
                </span>
              </button>
            ))}
            {authorityRoleDistribution.length === 0 && (
              <p className="absolute left-1/2 top-[68%] -translate-x-1/2 rounded-lg border border-white/10 bg-black/70 px-3 py-2 text-center text-[10px] text-slate-500">
                Nessuna distribuzione utenti nel readback D1.
              </p>
            )}
            <div className="absolute bottom-3 left-3 right-3 flex items-center gap-2 overflow-x-auto">
              <Tabs
                className="min-w-max"
                value={activeTab}
                onValueChange={handleTabChange}
              >
                <TabsList
                  className="h-9 rounded-lg border border-white/10 bg-black/80 p-1 backdrop-blur"
                  aria-label="Sezioni Authority"
                >
                  {authorityTabs.slice(0, 5).map((tab) => (
                    <TabsTrigger
                      className="h-7 rounded-md px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]"
                      key={tab.id}
                      value={tab.id}
                    >
                      {tab.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
              <span className="ml-auto flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-black/75 px-2.5 py-1.5 text-[9px] uppercase tracking-[0.1em] text-slate-500">
                <Crosshair className="size-3 text-lime-300" />
                S02 active
              </span>
            </div>
          </div>
        </section>

        <section
          className="carbon-card rounded-2xl p-4 sm:p-5"
          id="authority-activity"
        >
          <SectionTitle
            eyebrow="EVENT STREAM"
            title="Attività recenti"
            action="Vedi tutte"
            onAction={() =>
              onNotify(
                "Audit Log: read model visuale pronto per il collegamento agli eventi",
              )
            }
          />
          <div className="mt-4 divide-y divide-white/[0.07]">
            {authorityActivity.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  className="flex w-full items-center gap-3 py-3 text-left transition first:pt-0 last:pb-0 hover:bg-white/[0.025]"
                  key={item.title}
                  onClick={() => onNotify(`${item.title}: ${item.detail}`)}
                  type="button"
                >
                  <span
                    className={`grid size-8 shrink-0 place-items-center rounded-xl border ${toneStyles[item.tone].badge}`}
                  >
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-slate-200">
                      {item.title}
                    </span>
                    <span className="mt-1 block truncate text-[11px] text-slate-500">
                      {item.detail}
                    </span>
                  </span>
                  <span className="shrink-0 text-[10px] text-slate-600">
                    {item.time}
                  </span>
                </button>
              );
            })}
            {authorityActivity.length === 0 && (
              <p className="py-6 text-center text-xs text-slate-500">
                Nessuna attività nel readback D1.
              </p>
            )}{" "}
          </div>
        </section>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.12fr)_minmax(0,1fr)_minmax(320px,0.9fr)]">
        <section
          className="carbon-card rounded-2xl p-4 sm:p-5"
          id="authority-users"
        >
          <div className="flex items-start justify-between gap-3">
            <SectionTitle
              eyebrow="USER DIRECTORY"
              title="Utenti"
              action="Vedi tutti"
              onAction={() =>
                onNotify(
                  "Utenti: elenco completo disponibile con il relativo adapter",
                )
              }
            />
            <Button
              className="h-8 border border-lime-300/25 bg-lime-300/10 px-2.5 text-[11px] text-lime-200 hover:bg-lime-300/20"
              onClick={onNewUser}
            >
              <Plus className="size-3.5" />
              Nuovo
            </Button>
          </div>
          <Tabs className="mt-4" defaultValue="TUTTI">
            <TabsList className="h-8 w-full justify-start rounded-lg border border-white/10 bg-black/25 p-1">
              <TabsTrigger
                className="h-6 flex-none px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]"
                value="TUTTI"
              >
                Tutti
              </TabsTrigger>
              <TabsTrigger
                className="h-6 flex-none px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]"
                value="ONLINE"
              >
                Online
              </TabsTrigger>
              <TabsTrigger
                className="h-6 flex-none px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]"
                value="OFFLINE"
              >
                Offline
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="mt-3 divide-y divide-white/[0.07]">
            {filteredUsers.slice(0, 5).map((user) => (
              <button
                className="flex w-full items-center gap-3 py-3 text-left transition first:pt-0 last:pb-0 hover:bg-white/[0.025]"
                key={user.email}
                onClick={() =>
                  onNotify(`${user.name}: ${user.role} · ${user.team}`)
                }
                type="button"
              >
                <span
                  className={`grid size-8 shrink-0 place-items-center rounded-full border text-[9px] font-bold ${user.tone === "violet" ? "border-violet-300/30 bg-violet-300/15 text-violet-100" : user.tone === "cyan" ? "border-cyan-300/30 bg-cyan-300/15 text-cyan-100" : "border-lime-300/30 bg-lime-300/15 text-lime-100"}`}
                >
                  {user.initials}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] font-medium text-slate-200">
                    {user.name}
                  </span>
                  <span className="mt-1 block truncate text-[10px] text-slate-500">
                    {user.role} · {user.team}
                  </span>
                </span>
                <span className="flex items-center gap-1.5 text-[10px] text-slate-400">
                  <span
                    className={`size-1.5 rounded-full ${user.status === "Online" ? "bg-lime-300 shadow-[0_0_8px_rgba(190,255,60,0.8)]" : "bg-rose-300"}`}
                  />
                  {user.status}
                </span>
              </button>
            ))}
            {filteredUsers.length === 0 && (
              <div className="py-6 text-center text-xs text-slate-500">
                Nessun utente nel readback D1.
              </div>
            )}
          </div>
        </section>

        <section
          className="carbon-card rounded-2xl p-4 sm:p-5"
          id="authority-roles"
        >
          <div className="flex items-start justify-between gap-3">
            <SectionTitle
              eyebrow="ROLE CATALOG / 13 · MULTI-MANSIONE"
              title="Ruoli"
              action="Vedi tutti"
              onAction={() => onSelectTab("roles", "authority-roles")}
            />
            <StatusBadge>SITES CATALOG</StatusBadge>
          </div>
          <Tabs className="mt-4" defaultValue="CANONICI">
            <TabsList className="h-8 w-full justify-start rounded-lg border border-white/10 bg-black/25 p-1">
              <TabsTrigger
                className="h-6 flex-none px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]"
                value="CANONICI"
              >
                Canonici
              </TabsTrigger>
              <TabsTrigger
                className="h-6 flex-none px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]"
                value="CAPABILITY"
              >
                Capability
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="mt-3 divide-y divide-white/[0.07]">
            {filteredRoles.slice(0, 5).map((role) => {
              const active = role === selectedRole;
              return (
                <button
                  className="flex w-full items-center gap-3 py-3 text-left transition first:pt-0 last:pb-0 hover:bg-white/[0.025]"
                  key={role}
                  onClick={() => onSelectRole(role)}
                  type="button"
                >
                  <span
                    className={`grid size-8 shrink-0 place-items-center rounded-lg border ${active ? "border-lime-300/25 bg-lime-300/10 text-lime-200" : "border-white/10 bg-black/20 text-slate-600"}`}
                  >
                    <UserRoundCog className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block truncate text-[11px] font-medium ${active ? "text-lime-100" : "text-slate-300"}`}
                    >
                      {ROLE_METADATA[role].label}
                    </span>
                    <span className="mt-1 block text-[10px] text-slate-600">
                      {ROLE_CAPABILITIES[role].length} capability
                    </span>
                  </span>
                  {active && <Check className="size-4 text-lime-200" />}
                </button>
              );
            })}
          </div>
        </section>

        <section
          className="carbon-card rounded-2xl p-4 sm:p-5"
          id="authority-teams"
        >
          <div className="flex items-start justify-between gap-3">
            <SectionTitle
              eyebrow="WORKFORCE / TEAM"
              title="Squadre operative"
              action={canManageAuthority ? "Nuova squadra" : "Solo lettura"}
              onAction={canManageAuthority ? onNewTeam : () => onNotify("Il tuo ruolo è in sola lettura per la gestione squadre")}
            />
            <button
              className="flex items-center gap-1 rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-[10px] text-slate-400 hover:border-lime-300/30 hover:text-lime-200"
              onClick={onRefresh}
              type="button"
              aria-label="Aggiorna squadre operative"
            >
              Aggiorna
              <LoaderCircle className="size-3" />
            </button>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="carbon-inset rounded-lg p-2.5">
              <p className="font-mono text-lg font-semibold text-lime-300">{teams.length}</p>
              <p className="mt-1 text-[10px] text-slate-500">team nel readback D1</p>
            </div>
            <div className="carbon-inset rounded-lg p-2.5">
              <p className="font-mono text-lg font-semibold text-cyan-300">{teams.reduce((sum, team) => sum + team.activeMemberCount, 0)}</p>
              <p className="mt-1 text-[10px] text-slate-500">membri attivi assegnabili</p>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            {teams.length ? teams.map((team) => (
              <div className="rounded-xl border border-white/[0.08] bg-black/15 p-3" key={team.id}>
                <div className="flex items-start gap-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-xl border border-lime-300/25 bg-lime-300/10 text-lime-100">
                    <Users className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-xs font-semibold text-slate-100">{team.name}</p>
                      <StatusBadge>{team.status}</StatusBadge>
                    </div>
                    <p className="mt-1 text-[10px] text-slate-500">{team.code ?? "Codice in assegnazione"} · {team.activeMemberCount} membri · capacità {team.capacity}</p>
                    {team.description && <p className="mt-1 truncate text-[10px] text-slate-600">{team.description}</p>}
                    {team.members.length > 0 && <p className="mt-2 truncate text-[10px] text-lime-100/70">{team.members.map((member) => member.displayName).join(" · ")}</p>}
                  </div>
                </div>
              </div>
            )) : (
              <div className="rounded-xl border border-dashed border-white/10 bg-black/10 p-4 text-center">
                <p className="text-xs text-slate-400">Nessuna squadra registrata.</p>
                <p className="mt-1 text-[10px] text-slate-600">Crea una squadra con membri attivi: sarà subito selezionabile in Pianificazione.</p>
              </div>
            )}
          </div>
        </section>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)]">
        <section
          className="carbon-card rounded-2xl p-4 sm:p-5"
          id="authority-permissions"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <SectionTitle
                eyebrow="CAPABILITY MATRIX"
                title="Matrice permessi"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Catalogo visuale · resolver canonico server-owned.
              </p>
            </div>
            <button
              className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-[10px] text-slate-400 transition hover:border-lime-300/25 hover:text-lime-200"
              onClick={() =>
                onNotify("Gestione permessi: capability catalogo pronto")
              }
              type="button"
            >
              <Settings2 className="size-3.5" />
              Gestisci
            </button>
          </div>
          <div
            aria-label="Matrice permessi per ruolo"
            className="mt-4 overflow-x-auto rounded-xl border border-white/[0.08] bg-black/20"
            role="region"
            tabIndex={0}
          >
            <table className="w-full min-w-[720px] text-left">
              <thead className="border-b border-white/[0.08] text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                <tr>
                  <th className="px-3 py-3">Modulo</th>
                  {permissionMatrixRoles.map((role) => (
                    <th className="px-2 py-3 text-center" key={role}>
                      {ROLE_METADATA[role].label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.07]">
                {permissionMatrix.map((row) => (
                  <tr key={row.module}>
                    <td className="whitespace-nowrap px-3 py-2.5 text-[11px] text-slate-300">
                      {row.module}
                    </td>
                    {row.values.map((value, index) => (
                      <td
                        className="px-2 py-2.5 text-center"
                        key={`${row.module}-${index}`}
                      >
                        <span
                          className={`inline-flex min-w-[64px] justify-center rounded-md border px-1.5 py-1 text-[9px] ${value === "Amministrazione" ? "border-violet-300/25 bg-violet-300/15 text-violet-100" : value === "Modifica" ? "border-amber-300/25 bg-amber-300/15 text-amber-100" : value === "Nessun accesso" ? "border-white/10 bg-white/[0.04] text-slate-600" : "border-lime-300/20 bg-lime-300/10 text-lime-200"}`}
                        >
                          {value}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section
          className="carbon-card carbon-card-neon rounded-2xl p-4 sm:p-5"
          id="authority-policies"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="neon-pulse grid size-9 place-items-center rounded-xl bg-lime-300 text-[#060806]">
                <Sparkles className="size-[18px]" />
              </span>
              <div>
                <p className="text-[15px] font-semibold text-slate-50">
                  AI Assistant
                </p>
                <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-lime-200/60">
                  authority / governed preview
                </p>
              </div>
            </div>
            <StatusBadge>READ ONLY</StatusBadge>
          </div>
          <div className="carbon-inset mt-5 rounded-xl p-3">
            <div className="flex items-center gap-2 text-[10px] text-lime-200">
              <span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_10px_rgba(190,255,60,0.9)]" />
              SYSTEM READY
              <span className="ml-auto font-mono text-[9px] text-slate-600">
                S02
              </span>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Posso interrogare utenti, ruoli e accessi quando l’adapter
              Authority sarà collegato.
            </p>
          </div>
          <div className="mt-4 space-y-2">
            <button
              className="flex w-full items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-left text-[11px] text-slate-400 transition hover:border-lime-300/30 hover:bg-lime-300/5 hover:text-lime-200"
              onClick={() =>
                onNotify("AI Assistant: utenti offline · read model Authority")
              }
              type="button"
            >
              <span className="grid size-5 place-items-center rounded-md border border-white/10 text-slate-600">
                <ChevronRight className="size-3" />
              </span>
              Quali utenti sono offline?
            </button>
            <button
              className="flex w-full items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-left text-[11px] text-slate-400 transition hover:border-lime-300/30 hover:bg-lime-300/5 hover:text-lime-200"
              onClick={() =>
                onNotify(
                  "AI Assistant: analisi accessi sospetti in sola lettura",
                )
              }
              type="button"
            >
              <span className="grid size-5 place-items-center rounded-md border border-white/10 text-slate-600">
                <ChevronRight className="size-3" />
              </span>
              Analizza accessi sospetti
            </button>
            <button
              className="flex w-full items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-left text-[11px] text-slate-400 transition hover:border-lime-300/30 hover:bg-lime-300/5 hover:text-lime-200"
              onClick={onNewUser}
              type="button"
            >
              <span className="grid size-5 place-items-center rounded-md border border-white/10 text-slate-600">
                <ChevronRight className="size-3" />
              </span>
              Crea nuovo profilo
            </button>
          </div>
          <div className="mt-5 border-t border-white/10 pt-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-lime-200/60">
              POLITICHE
            </p>
            <div className="mt-3 space-y-2">
              {authorityPolicies.slice(0, 3).map((policy) => {
                const Icon = policy.icon;
                return (
                  <button
                    className="flex w-full items-center gap-2 text-left"
                    key={policy.title}
                    onClick={() => onNotify(`${policy.title}: ${policy.state}`)}
                    type="button"
                  >
                    <Icon className="size-3.5 text-lime-300" />
                    <span className="min-w-0 flex-1 truncate text-[10px] text-slate-400">
                      {policy.title}
                    </span>
                    <span className="text-[9px] text-lime-200">
                      {policy.state}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      </div>
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
  const [teamOpen, setTeamOpen] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [teamDescription, setTeamDescription] = useState("");
  const [teamCapacity, setTeamCapacity] = useState("1");
  const [teamQualifications, setTeamQualifications] = useState("");
  const [teamMemberIds, setTeamMemberIds] = useState<string[]>([]);
  const [toast, setToast] = useState("");
  const [authorityContext, setAuthorityContext] =
    useState<AuthorityContextView | null>(null);
  const [profiles, setProfiles] = useState<AccessProfile[]>([]);
  const [memberships, setMemberships] = useState<AuthorityMembershipView[]>([]);
  const [invitations, setInvitations] = useState<AuthorityInvitationView[]>([]);
  const [teams, setTeams] = useState<AuthorityTeamView[]>([]);
  const [profileSubmitting, setProfileSubmitting] = useState(false);
  const [teamSubmitting, setTeamSubmitting] = useState(false);
  const visibleNavItems = useMemo(
    () => navItems.filter((item) => Boolean(item.capability && authorityContext?.capabilities.includes(item.capability))),
    [authorityContext],
  );

  const filteredRoles = useMemo(
    () =>
      AUTHORITY_ROLES.filter((role) =>
        role.toLowerCase().includes(query.trim().toLowerCase()),
      ),
    [query],
  );
  const filteredUsers = useMemo(() => {
    const authorityUsers: AuthorityUser[] = memberships.map((membership) => ({
      initials:
        membership.displayName
          .split(/\s+/)
          .slice(0, 2)
          .map((part) => part[0]?.toUpperCase())
          .join("") || "U",
      name: membership.displayName,
      email: membership.actorEmail,
      role: membership.roleLabel,
      team:
        membership.identityProvider === "neon"
          ? "Neon Auth"
          : "Sites workspace",
      status: membership.status === "active" ? "Online" : "Offline",
      lastAccess: membership.updatedAt,
      tone:
        membership.role === "owner" || membership.role === "admin"
          ? "violet"
          : membership.status === "active"
            ? "lime"
            : "amber",
    }));
    const normalized = query.trim().toLowerCase();
    if (!normalized) return authorityUsers;
    return authorityUsers.filter((user) =>
      `${user.name} ${user.email} ${user.role} ${user.team}`
        .toLowerCase()
        .includes(normalized),
    );
  }, [memberships, query]);
  const selectedCapabilities = ROLE_CAPABILITIES[selectedRole];
  const canManageAuthority =
    authorityContext?.capabilities.includes("authority.manage") ?? false;
  const contextFields = authorityContext
    ? [
        {
          key: "actorId",
          value: authorityContext.actorId,
          detail: "server-derived identity",
          tone: "lime" as Tone,
        },
        {
          key: "membershipId",
          value: authorityContext.membershipId,
          detail: "server-derived D1 membership",
          tone: "lime" as Tone,
        },
        {
          key: "tenantId",
          value: authorityContext.tenantId,
          detail: "D1 membership boundary",
          tone: "lime" as Tone,
        },
        {
          key: "environment",
          value: authorityContext.environment,
          detail: "owner-only publication",
          tone: "lime" as Tone,
        },
        {
          key: "role",
          value: authorityContext.roles?.join(" + ") || authorityContext.role,
          detail: "mansioni server-resolved · capability union",
          tone: "lime" as Tone,
        },
        {
          key: "capabilities",
          value: `${authorityContext.capabilities.length} canonical`,
          detail: "server capability resolver",
          tone: "lime" as Tone,
        },
        {
          key: "resourceScope",
          value: authorityContext.resourceScope,
          detail: "server-owned scope",
          tone: "lime" as Tone,
        },
        {
          key: "fieldScope",
          value: authorityContext.fieldScope,
          detail: "field boundary",
          tone: "lime" as Tone,
        },
        {
          key: "fileScope",
          value: authorityContext.fileScope,
          detail: "Sites file boundary",
          tone: "lime" as Tone,
        },
        {
          key: "contextSource",
          value: authorityContext.contextSource,
          detail: "required source",
          tone: "lime" as Tone,
        },
        {
          key: "sessionId",
          value: authorityContext.sessionId ?? "Sites session",
          detail: "not exposed to client",
          tone: "cyan" as Tone,
        },
        {
          key: "approvalContext",
          value: authorityContext.approvalContext,
          detail: "owner approval gate",
          tone: "lime" as Tone,
        },
      ]
    : fallbackTenantFields;
  const onboardingSteps = [
    {
      label: "Identita e tenant",
      detail: "Sessione e membership server-side",
      state: authorityContext ? "VERIFICATO" : "IN ATTESA",
      ready: Boolean(authorityContext),
    },
    {
      label: "Ruoli canonici",
      detail: `${AUTHORITY_ROLES.length} profili operativi`,
      state: "PRONTO",
      ready: true,
    },
    {
      label: "Profili accesso",
      detail: profiles.length
        ? `${profiles.length} profili persistenti`
        : "Nessun profilo personalizzato",
      state: profiles.length ? "CONFIGURATO" : "DA CONFIGURARE",
      ready: profiles.length > 0,
    },
    {
      label: "Visibilita moduli",
      detail: "Menu, pagine e API capability-gated",
      state: "ATTIVO",
      ready: true,
    },
    {
      label: "Company AI",
      detail: "Tool e approval boundary",
      state: "PARZIALE",
      ready: false,
    },
    {
      label: "Certificazione",
      detail: "Gate Commercial v1",
      state: "IN CORSO",
      ready: false,
    },
  ];
  const liveAuthorityKpis = [
    {
      ...authorityKpis[0],
      value: String(
        memberships.filter((membership) => membership.status === "active")
          .length,
      ),
      delta: "D1 live",
    },
    {
      ...authorityKpis[1],
      value: String(AUTHORITY_ROLES.length),
      delta: "Canonici",
    },
    {
      ...authorityKpis[2],
      value: String(
        new Set(AUTHORITY_ROLES.flatMap((role) => [...ROLE_CAPABILITIES[role]]))
          .size,
      ),
      delta: "Capability",
    },
    {
      ...authorityKpis[3],
      value: String(teams.length),
      delta: "D1 live",
    },
  ];

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  };

  const refreshAuthority = useCallback(async () => {
    try {
      const [profilesResponse, membershipsResponse, teamsResponse] = await Promise.all([
        fetch("/api/authority/access-profiles", { cache: "no-store" }),
        fetch("/api/authority/memberships", { cache: "no-store" }),
        fetch("/api/authority/teams", { cache: "no-store" }),
      ]);
      const profilesPayload = (await profilesResponse.json()) as {
        context?: AuthorityContextView;
        profiles?: AccessProfile[];
        error?: string;
      };
      const membershipsPayload = (await membershipsResponse.json()) as {
        context?: AuthorityContextView;
        memberships?: AuthorityMembershipView[];
        invitations?: AuthorityInvitationView[];
        error?: string;
      };
      const teamsPayload = (await teamsResponse.json()) as {
        context?: AuthorityContextView;
        teams?: AuthorityTeamView[];
        error?: string;
      };
      if (!profilesResponse.ok || !membershipsResponse.ok || !teamsResponse.ok) {
        setToast(
          profilesPayload.error === "authority_store_unavailable" ||
            membershipsPayload.error ===
              "authority_membership_store_unavailable" ||
            teamsPayload.error === "authority_team_store_unavailable"
            ? "Authority store Sites non disponibile"
            : "Readback Authority non riuscito",
        );
        return;
      }
      setAuthorityContext(
        profilesPayload.context ?? membershipsPayload.context ?? null,
      );
      setProfiles(profilesPayload.profiles ?? []);
      setMemberships(membershipsPayload.memberships ?? []);
      setInvitations(membershipsPayload.invitations ?? []);
      setTeams(teamsPayload.teams ?? []);
    } catch {
      setToast("Readback Authority non raggiungibile");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshAuthority(), 0);
    return () => window.clearTimeout(timer);
  }, [refreshAuthority]);

  const navigate = (id: string, label: string) => {
    setMobileMenu(false);
    if (id === "command") {
      router.push("/command");
      return;
    }
    if (id === "operations") {
      router.push("/operations");
      return;
    }
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
    if (id === "finance") {
      router.push("/finance");
      return;
    }
    if (id === "documents") {
      router.push("/documents");
      return;
    }
    if (id === "pwa") {
      router.push("/pwa/diagnostics");
      return;
    }
    if (id === "events_authority") return;
    notify(`${label}: superficie prevista nel prossimo modulo`);
  };

  const selectAuthorityTab = (tab: AuthorityTabId, target: string) => {
    setActiveTab(tab);
    window.requestAnimationFrame(() =>
      document
        .getElementById(target)
        ?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  };

  const createProfile = async () => {
    if (!canManageAuthority) {
      notify(
        "Il tuo ruolo consente la lettura Authority ma non la gestione dei profili",
      );
      return;
    }
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
      const payload = (await response.json()) as {
        profile?: AccessProfile;
        error?: string;
        context?: AuthorityContextView;
      };
      if (!response.ok || !payload.profile) {
        notify(
          payload.error === "authority_store_unavailable"
            ? "Authority store Sites non disponibile"
            : "Profilo non salvato",
        );
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

  const createTeam = async () => {
    if (!canManageAuthority) {
      notify("Il tuo ruolo consente la lettura Authority ma non la gestione delle squadre");
      return;
    }
    const name = teamName.trim();
    if (name.length < 2) {
      notify("Inserisci il nome della squadra");
      return;
    }
    if (!teamMemberIds.length) {
      notify("Seleziona almeno un membro attivo");
      return;
    }
    setTeamSubmitting(true);
    try {
      const response = await fetch("/api/authority/teams", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          description: teamDescription,
          capacity: Number(teamCapacity) || 1,
          qualifications: teamQualifications.split(",").map((item) => item.trim()).filter(Boolean),
          memberIds: teamMemberIds,
        }),
      });
      const payload = (await response.json()) as {
        team?: AuthorityTeamView;
        teams?: AuthorityTeamView[];
        error?: string;
      };
      if (!response.ok || !payload.team) {
        const message = payload.error === "team_membership_not_active"
          ? "Un membro selezionato non è più attivo"
          : payload.error === "team_name_already_exists"
            ? "Esiste già una squadra con questo nome"
            : payload.error === "authority_team_store_unavailable"
              ? "Authority store Sites non disponibile"
              : "Squadra non salvata";
        notify(message);
        return;
      }
      setTeams(payload.teams ?? [payload.team, ...teams]);
      setTeamOpen(false);
      setTeamName("");
      setTeamDescription("");
      setTeamCapacity("1");
      setTeamQualifications("");
      setTeamMemberIds([]);
      notify(`Squadra salvata su Sites: ${payload.team.name}`);
    } catch {
      notify("Squadra non salvata: errore di rete");
    } finally {
      setTeamSubmitting(false);
    }
  };

  return (
    <main className="authority-page zw-app-shell min-h-screen overflow-x-hidden bg-[#050607] text-slate-100 selection:bg-lime-300 selection:text-[#060806]">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_74%_0%,rgba(190,255,60,0.08),transparent_25%),radial-gradient(circle_at_18%_78%,rgba(70,110,120,0.08),transparent_27%)]" />
      <div className="relative flex min-h-screen">
        <aside
          className={`fixed inset-y-0 left-0 z-40 flex w-[232px] flex-col border-r border-lime-300/10 bg-[#050607]/96 px-3 py-4 backdrop-blur-xl transition-transform lg:static lg:translate-x-0 ${mobileMenu ? "translate-x-0" : "-translate-x-full"}`}
        >
          <div className="flex items-center justify-between px-2">
            <button
              className="flex items-center gap-3 text-left"
              onClick={() => {
                setMobileMenu(false);
                router.push("/command");
              }}
              type="button"
            >
              <span className="neon-pulse relative grid size-10 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black">
                <Image
                  src="/ai-zerow-icon.jpeg"
                  alt="AI-ZEROW"
                  width={40}
                  height={40}
                  className="size-full object-cover"
                />
              </span>
              <span>
                <span className="block text-sm font-bold tracking-[0.18em] text-slate-50">
                  AI-ZEROW
                </span>
                <span className="block text-[10px] uppercase tracking-[0.22em] text-lime-300/75">
                  command
                </span>
              </span>
            </button>
            <button
              className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-white/5 hover:text-white lg:hidden"
              onClick={() => setMobileMenu(false)}
              type="button"
              aria-label="Chiudi menu"
            >
              <X className="size-4" />
            </button>
          </div>
          <button
            className="carbon-card mt-8 flex w-full items-center gap-3 rounded-xl p-3 text-left transition hover:border-lime-300/25"
            type="button"
            onClick={() => notify("Workspace ZEROW · contesto owner Sites")}
          >
            <span className="grid size-8 place-items-center rounded-lg border border-lime-300/20 bg-lime-300/10 text-lime-200">
              <HardHat className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-slate-200">
                ZEROW workspace
              </span>
              <span className="mt-0.5 block truncate text-[10px] text-slate-600">
                owner · Sites tenant context
              </span>
            </span>
            <ChevronRight className="size-3.5 text-slate-600" />
          </button>
          <nav className="mt-7 flex-1" aria-label="Navigazione principale">
            <p className="px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-600">
              Workspace
            </p>
            <div className="mt-2 space-y-1">
              {visibleNavItems.map((item) => {
                const Icon = item.icon;
                const active = item.id === "events_authority";
                return (
                  <button
                    aria-current={active ? "page" : undefined}
                    className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${active ? "border border-lime-300/20 bg-lime-300/10 text-lime-200 shadow-[inset_0_0_20px_rgba(190,255,60,0.04)]" : "text-slate-500 hover:bg-white/[0.045] hover:text-slate-100"}`}
                    key={item.id}
                    onClick={() => navigate(item.id, item.label)}
                    type="button"
                  >
                    <Icon
                      className={`size-4 ${active ? "text-lime-200" : "text-slate-600 group-hover:text-slate-300"}`}
                    />
                    <span>{item.label}</span>
                    {item.id === "command" && (
                      <span className="ml-auto rounded border border-white/10 px-1.5 py-0.5 font-mono text-[8px] tracking-[0.08em] text-slate-600">
                        AI
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </nav>
          <div className="mt-5 border-t border-white/[0.08] pt-4">
            <div className="flex items-center justify-between px-2 text-[10px] uppercase tracking-[0.14em] text-slate-600">
              <span>System status</span>
              <span className="flex items-center gap-1.5 text-lime-200">
                <span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_8px_rgba(190,255,60,0.8)]" />
                online
              </span>
            </div>
            <div className="carbon-inset mt-3 rounded-xl p-3">
              <div className="flex items-center gap-2 text-[10px] text-slate-400">
                <ShieldCheck className="size-3.5 text-lime-300" />
                Authority core
              </div>
              <p className="mt-2 font-mono text-[9px] text-slate-600">
                D1 · nessun trend senza readback
              </p>
              <p className="mt-3 font-mono text-[9px] text-slate-600">
                S02 · SITES NATIVE
              </p>
            </div>
          </div>
        </aside>

        {mobileMenu && (
          <button
            className="fixed inset-0 z-30 bg-black/75 lg:hidden"
            onClick={() => setMobileMenu(false)}
            aria-label="Chiudi menu"
            type="button"
          />
        )}

        <section className="min-w-0 flex-1">
          <header className="authority-topbar sticky top-0 z-20 flex h-[72px] items-center gap-3 border-b border-white/[0.08] bg-[#050607]/88 px-4 backdrop-blur-xl sm:gap-5 sm:px-7">
            <IconButton
              label="Apri menu"
              onClick={() => setMobileMenu(true)}
              className="lg:hidden"
            >
              <Menu className="size-4" />
            </IconButton>
            <div className="relative hidden min-w-0 flex-1 md:block">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-600" />
              <Input
                aria-label="Cerca utenti, ruoli, permessi, team"
                className="h-10 max-w-[440px] border-white/10 bg-black/30 pl-10 text-xs text-slate-100 placeholder:text-slate-600 focus-visible:border-lime-300/40"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Cerca utenti, ruoli, permessi, team…"
                value={query}
              />
            </div>
            <div className="flex min-w-0 flex-1 items-center gap-2 md:hidden">
              <span className="truncate text-xs font-semibold tracking-[0.14em] text-slate-200">
                AUTHORITY
              </span>
              <span className="size-1 rounded-full bg-lime-300" />
            </div>
            <div className="ml-auto flex items-center gap-2">
              <span className="hidden items-center gap-2 rounded-full border border-lime-300/20 bg-lime-300/5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-lime-200 sm:flex">
                <span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_9px_rgba(190,255,60,0.9)]" />
                Sites native
              </span>
              <button aria-label="Torna indietro" className="grid size-9 place-items-center rounded-lg border border-white/10 bg-black/20 text-slate-500 hover:border-lime-300/30 hover:text-lime-200" onClick={() => router.back()} type="button"><ArrowLeft className="size-4" /></button>
              <button aria-label="Aggiorna Authority" className="grid size-9 place-items-center rounded-lg border border-white/10 bg-black/20 text-slate-500 hover:border-lime-300/30 hover:text-lime-200" onClick={() => void refreshAuthority()} type="button"><RefreshCw className="size-4" /></button>
              {authorityContext?.capabilities.includes("communication.read") ? <IconButton label="Apri comunicazioni" onClick={() => router.push("/communications")}>
                <Bell className="size-4" />
              </IconButton> : null}
              <span className="hidden size-8 place-items-center rounded-full border border-white/15 bg-gradient-to-br from-slate-200 to-slate-500 text-xs font-bold text-[#080a0b] sm:grid">
                AB
              </span>
              <div className="hidden text-right lg:block">
                <p className="text-xs font-medium text-slate-200">
                  {authorityContext?.actorName ?? "Operatore"}
                </p>
                <p className="text-[10px] text-slate-600">
                  {authorityContext
                    ? `${authorityContext.roles?.join(" + ") || authorityContext.role} · Sites owner`
                    : "Site owner · readback pending"}
                </p>
              </div>
              <ChevronDown className="hidden size-3.5 text-slate-500 lg:block" />
            </div>
          </header>

          <div className="authority-content mx-auto max-w-[1680px] px-4 py-5 sm:px-7 sm:py-7">
            <div className="authority-hero mb-5">
              <div className="authority-hero-grid" aria-hidden="true" />
              <div className="relative flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
                <div className="flex items-center gap-4">
                  <span className="authority-mark">
                    <Image
                      src="/ai-zerow-icon.jpeg"
                      alt="AI-ZEROW"
                      width={52}
                      height={52}
                      className="size-full object-cover"
                    />
                  </span>
                  <div>
                    <p className="authority-kicker">
                      COMMAND / AUTHORITY CONTROL PLANE
                    </p>
                    <p className="mt-1 text-sm font-medium tracking-wide text-slate-200 sm:text-base">
                      Access matrix <span className="text-slate-600">·</span>{" "}
                      tenant boundary <span className="text-slate-600">·</span>{" "}
                      governed profiles
                    </p>
                    <p className="mt-2 text-xs text-slate-500">
                      S02 is locked for the Sites-native operating scope.
                    </p>
                  </div>
                </div>
                <div className="authority-hero-meta grid grid-cols-3 gap-2 sm:min-w-[330px]">
                  <div>
                    <span>STATE</span>
                    <strong>LOCKED</strong>
                  </div>
                  <div>
                    <span>STORE</span>
                    <strong>D1 / SITES</strong>
                  </div>
                  <div>
                    <span>EDGE</span>
                    <strong>OWNER PRIVATE</strong>
                  </div>
                </div>
              </div>
            </div>
            <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/70">
                  <span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_9px_rgba(190,255,60,0.9)]" />
                  AI-ZEROW / AUTHORITY
                </div>
                <h1 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-50 sm:text-[28px]">
                  Authority
                </h1>
                <p className="mt-1 text-xs text-slate-500">
                  Gestione utenti, ruoli, permessi e accessi ·{" "}
                  {authorityContext
                    ? "readback server verificato"
                    : "readback in corso"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="hidden rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-[10px] text-slate-500 sm:inline-flex">
                  <Clock3 className="mr-2 size-3.5 text-lime-300" />
                  RBAC · deny by default
                </span>
                <Button
                  className="h-9 border border-lime-300/30 bg-lime-300 px-3 text-xs font-semibold text-[#060806] shadow-[0_0_18px_rgba(190,255,60,0.16)] hover:bg-lime-200 disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={!canManageAuthority}
                  onClick={() => setProfileOpen(true)}
                  title={
                    canManageAuthority
                      ? "Crea un profilo"
                      : "Richiede authority.manage"
                  }
                >
                  <Plus className="size-3.5" />
                  Nuovo profilo
                </Button>
              </div>
            </div>

            <section
              className="carbon-card mb-5 rounded-2xl p-4 sm:p-5"
              aria-labelledby="onboarding-readiness-title"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-lime-300/70">
                    TENANT ONBOARDING / CONTROL GATE
                  </p>
                  <h2
                    className="mt-1 text-base font-semibold text-slate-100"
                    id="onboarding-readiness-title"
                  >
                    Percorso di attivazione aziendale
                  </h2>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Prima identita e perimetro, poi persone, moduli, Company AI
                    e certificazione.
                  </p>
                </div>
                <StatusBadge
                  tone={
                    onboardingSteps.every((step) => step.ready)
                      ? "lime"
                      : "amber"
                  }
                >
                  {onboardingSteps.filter((step) => step.ready).length}/
                  {onboardingSteps.length} GATE
                </StatusBadge>
              </div>
              <ol className="mt-4 grid gap-2 md:grid-cols-2 2xl:grid-cols-6">
                {onboardingSteps.map((step, index) => (
                  <li
                    className={`rounded-xl border p-3 ${step.ready ? "border-lime-300/18 bg-lime-300/[0.035]" : "border-white/[0.07] bg-black/20"}`}
                    key={step.label}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`grid size-6 place-items-center rounded-lg border font-mono text-[9px] ${step.ready ? "border-lime-300/25 bg-lime-300/10 text-lime-200" : "border-amber-300/20 bg-amber-300/5 text-amber-200"}`}
                      >
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span
                        className={`text-[8px] font-semibold tracking-[0.1em] ${step.ready ? "text-lime-300/70" : "text-amber-200/70"}`}
                      >
                        {step.state}
                      </span>
                    </div>
                    <p className="mt-3 text-[11px] font-semibold text-slate-300">
                      {step.label}
                    </p>
                    <p className="mt-1 text-[9px] leading-4 text-slate-600">
                      {step.detail}
                    </p>
                  </li>
                ))}
              </ol>
            </section>

            <TenantOperatingProfile />

            <TenantWarehouseControl
              canManage={Boolean(authorityContext?.capabilities.includes("tenant.manage"))}
              onNotify={notify}
            />

            <AuthorityMembershipControl
              canManage={canManageAuthority}
              currentActorId={authorityContext?.actorId ?? null}
              invitations={invitations}
              memberships={memberships}
              onDirectoryChange={(payload) => {
                if (payload.memberships) setMemberships(payload.memberships);
                if (payload.invitations) setInvitations(payload.invitations);
              }}
              onNotify={notify}
              onRefresh={refreshAuthority}
            />

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {liveAuthorityKpis.map((kpi) => (
                <MetricCard key={kpi.label} {...kpi} />
              ))}
            </div>

            <AuthorityVisualDashboard
              activeTab={activeTab}
              canManageAuthority={canManageAuthority}
              filteredRoles={filteredRoles}
              filteredUsers={filteredUsers}
              onNewUser={() => setProfileOpen(true)}
              onNewTeam={() => setTeamOpen(true)}
              onNotify={notify}
              onRefresh={() => void refreshAuthority()}
              onSelectRole={setSelectedRole}
              onSelectTab={selectAuthorityTab}
              selectedRole={selectedRole}
              teams={teams}
            />

            <div className="mt-4 grid gap-4 2xl:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)]">
              <section className="carbon-card rounded-2xl p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <SectionTitle
                      eyebrow="SITE SESSION / BOUNDARY"
                      title="Contesto corrente"
                    />
                    <p className="mt-1 text-[11px] text-slate-500">
                      Identità, membership e tenant derivano dal server Sites.
                    </p>
                  </div>
                  <StatusBadge tone={authorityContext ? "lime" : "amber"}>
                    {authorityContext ? "SITES NATIVE" : "READBACK PENDING"}
                  </StatusBadge>
                </div>
                <div className="carbon-card-neon mt-4 rounded-xl border p-4">
                  <div className="flex items-center gap-3">
                    <span className="grid size-10 place-items-center rounded-xl border border-lime-300/30 bg-lime-300/10 text-lime-200">
                      <LockKeyhole className="size-5" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-slate-100">
                        Owner-only Site access
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        Accesso verificato dal perimetro privato Sites
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <div className="rounded-lg border border-white/10 bg-black/25 p-3">
                      <p className="text-[10px] uppercase tracking-[0.12em] text-slate-600">
                        Account
                      </p>
                      <p className="mt-1 truncate text-xs text-lime-200">
                        {authorityContext?.actorEmail ?? "owner"}
                      </p>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-black/25 p-3">
                      <p className="text-[10px] uppercase tracking-[0.12em] text-slate-600">
                        App role
                      </p>
                      <p className="mt-1 text-xs text-lime-200">
                        {authorityContext?.role ?? "readback pending"}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="mt-4 space-y-2">
                  <div className="flex items-center gap-2 rounded-lg border border-cyan-300/15 bg-cyan-300/5 px-3 py-2.5 text-[11px] text-cyan-100/80">
                    <ShieldCheck className="size-4 shrink-0 text-cyan-200" />
                    <span>
                      Client identity:{" "}
                      <strong className="font-medium text-cyan-100">
                        server-owned
                      </strong>
                    </span>
                  </div>
                  <div className="flex items-center gap-2 rounded-lg border border-lime-300/15 bg-lime-300/5 px-3 py-2.5 text-[11px] text-lime-100/80">
                    <LockKeyhole className="size-4 shrink-0 text-lime-200" />
                    <span>
                      Tenant isolation:{" "}
                      <strong className="font-medium text-lime-100">
                        assertTenantScope
                      </strong>
                    </span>
                  </div>
                  <div className="flex items-center gap-2 rounded-lg border border-lime-300/15 bg-lime-300/5 px-3 py-2.5 text-[11px] text-lime-100/80">
                    <CheckCircle2 className="size-4 shrink-0 text-lime-200" />
                    <span>
                      Resolver runtime:{" "}
                      <strong className="font-medium text-lime-100">
                        Sites auth + D1 active
                      </strong>
                    </span>
                  </div>
                </div>
              </section>
              <section className="carbon-card rounded-2xl p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <SectionTitle
                      eyebrow="TENANT CONTEXT / SERVER AUTH"
                      title="Identity context fields"
                    />
                    <p className="mt-1 text-[11px] text-slate-500">
                      Campi derivati server-side da Sites Auth o Neon Auth e
                      autorizzati in D1.
                    </p>
                  </div>
                  <IconButton
                    label="Verifica contesto"
                    onClick={() =>
                      notify(
                        authorityContext
                          ? "TenantContext server verificato"
                          : "TenantContext in attesa del readback",
                      )
                    }
                  >
                    <Settings2 className="size-4" />
                  </IconButton>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {contextFields.map((field) => (
                    <div
                      className="carbon-inset rounded-xl p-3"
                      key={field.key}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[10px] text-slate-500">
                          {field.key}
                        </span>
                        <span
                          className={`size-1.5 rounded-full ${field.tone === "lime" ? "bg-lime-300" : field.tone === "cyan" ? "bg-cyan-300" : field.tone === "amber" ? "bg-amber-300" : "bg-rose-300"}`}
                        />
                      </div>
                      <p className="mt-2 truncate text-xs font-medium text-slate-200">
                        {field.value}
                      </p>
                      <p className="mt-1 truncate text-[10px] text-slate-600">
                        {field.detail}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
              <section
                className="carbon-card rounded-2xl p-4 sm:p-5"
                id="authority-roles"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <SectionTitle
                      eyebrow="ROLE CATALOG / 13"
                      title="Ruoli canonici"
                    />
                    <p className="mt-1 text-[11px] text-slate-500">
                      Catalogo server condiviso con il profilo accesso.
                    </p>
                  </div>
                  <StatusBadge>SITES CATALOG</StatusBadge>
                </div>
                <div className="mt-4 space-y-1.5">
                  {filteredRoles.map((role) => {
                    const active = role === selectedRole;
                    return (
                      <button
                        className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${active ? "border-lime-300/35 bg-lime-300/10" : "border-white/[0.07] bg-black/15 hover:border-lime-300/20 hover:bg-white/[0.035]"}`}
                        key={role}
                        onClick={() => setSelectedRole(role)}
                        type="button"
                      >
                        <span
                          className={`grid size-8 place-items-center rounded-lg border ${active ? "border-lime-300/25 bg-lime-300/10 text-lime-200" : "border-white/10 bg-black/20 text-slate-600"}`}
                        >
                          <UserRoundCog className="size-3.5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span
                            className={`block text-xs font-medium ${active ? "text-lime-100" : "text-slate-300"}`}
                          >
                            {ROLE_METADATA[role].label}
                          </span>
                          <span className="mt-1 block truncate text-[10px] text-slate-600">
                            {ROLE_METADATA[role].purpose}
                          </span>
                          <span className="mt-1 block text-[10px] text-slate-600">
                            {ROLE_CAPABILITIES[role].length} capability
                          </span>
                        </span>
                        {active && <Check className="size-4 text-lime-200" />}
                      </button>
                    );
                  })}
                  {filteredRoles.length === 0 && (
                    <div className="rounded-xl border border-white/10 p-5 text-center text-xs text-slate-500">
                      Nessun ruolo trovato nel catalogo.
                    </div>
                  )}
                </div>
              </section>
              <section className="carbon-card carbon-card-neon rounded-2xl p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <SectionTitle
                      eyebrow="CAPABILITY RESOLVER / READ MODEL"
                      title={ROLE_METADATA[selectedRole].label}
                    />
                    <p className="mt-1 text-[11px] text-slate-500">
                      {ROLE_METADATA[selectedRole].purpose}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge>SERVER RESOLVED</StatusBadge>
                    <button
                      className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-lime-300 hover:text-lime-100"
                      onClick={() =>
                        notify(
                          `Capability ${selectedRole}: catalogo server verificato`,
                        )
                      }
                      type="button"
                    >
                      Readback <ArrowUpRight className="size-3.5" />
                    </button>
                  </div>
                </div>
                <div className="carbon-inset mt-4 rounded-xl p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.14em] text-slate-600">
                        Capability count
                      </p>
                      <p className="mt-1 font-mono text-3xl font-semibold tracking-[-0.07em] text-slate-50">
                        {selectedCapabilities.length}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[11px] text-slate-500">Source</p>
                      <p className="mt-1 font-mono text-[10px] text-cyan-200">
                        authority-catalog
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {selectedCapabilities.map((capability) => (
                      <CapabilityPill
                        capability={capability}
                        key={capability}
                      />
                    ))}
                  </div>
                </div>
                <div className="mt-4 flex items-start gap-2 rounded-xl border border-lime-300/20 bg-lime-300/5 p-3 text-[11px] leading-5 text-lime-100/80">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-lime-200" />
                  Visibilita, route e API applicano la stessa capability
                  server-side. Il client non puo ampliare il proprio perimetro.
                </div>
              </section>
            </div>

            <section className="carbon-card mt-4 rounded-2xl p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <SectionTitle
                    eyebrow="ACCESS PROFILES / D1 READBACK"
                    title="Profili accesso salvati"
                  />
                  <p className="mt-1 text-[11px] text-slate-500">
                    Profili persistenti nel database Sites, isolati dal tenant
                    owner-private.
                  </p>
                </div>
                <StatusBadge tone={authorityContext ? "lime" : "amber"}>
                  {authorityContext
                    ? `${profiles.length} READ`
                    : "READBACK PENDING"}
                </StatusBadge>
              </div>
              <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {profiles.map((profile) => (
                  <article
                    className="carbon-inset rounded-xl p-3"
                    key={profile.id}
                  >
                    <div className="flex items-start gap-3">
                      <span className="grid size-9 place-items-center rounded-lg border border-lime-300/20 bg-lime-300/10 text-lime-200">
                        <UserRoundCog className="size-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-slate-100">
                          {profile.label}
                        </p>
                        <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.08em] text-lime-200/75">
                          {profile.baseRole}
                        </p>
                      </div>
                      <CheckCircle2 className="size-4 shrink-0 text-lime-300" />
                    </div>
                    <div className="mt-3 flex items-center justify-between text-[10px] text-slate-600">
                      <span>{profile.capabilities.length} capability</span>
                      <span>{profile.createdAt.slice(0, 10)}</span>
                    </div>
                  </article>
                ))}
                {profiles.length === 0 && (
                  <div className="rounded-xl border border-dashed border-white/10 p-5 text-center text-xs text-slate-500 md:col-span-2 xl:col-span-3">
                    Nessun profilo salvato. Crea il primo ruolo operativo dal
                    comando in alto.
                  </div>
                )}
              </div>
            </section>

            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
              <section className="carbon-card rounded-2xl p-4 sm:p-5">
                <SectionTitle
                  eyebrow="AUTHORITY / NEGATIVE CASES"
                  title="Casi di sicurezza"
                  action="Apri evidenze"
                  onAction={() =>
                    notify("Evidence ledger: guard server-side attive")
                  }
                />
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {negativeCases.map((item) => {
                    const Icon = item.icon;
                    return (
                      <div
                        className="carbon-inset flex items-center gap-3 rounded-xl p-3"
                        key={item.title}
                      >
                        <span
                          className={`grid size-8 place-items-center rounded-lg border ${toneStyles[item.tone].badge}`}
                        >
                          <Icon className="size-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-slate-200">
                            {item.title}
                          </p>
                          <p className="mt-1 truncate text-[10px] text-slate-500">
                            {item.expected}
                          </p>
                        </div>
                        <span
                          className={`shrink-0 rounded border px-1.5 py-1 font-mono text-[9px] ${item.tone === "lime" ? "border-lime-300/20 text-lime-200" : item.tone === "cyan" ? "border-cyan-300/20 text-cyan-200" : "border-amber-300/20 text-amber-200"}`}
                        >
                          {item.status}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </section>
              <section className="carbon-card rounded-2xl p-4 sm:p-5">
                <SectionTitle
                  eyebrow="AUTHORITY BOUNDARY"
                  title="Readback implementato"
                />
                <div className="mt-4 space-y-3">
                  {[
                    {
                      icon: DatabaseZap,
                      title: "Sites / Neon Auth",
                      detail: "identità sempre derivata server-side",
                      tone: "lime" as Tone,
                    },
                    {
                      icon: Building2,
                      title: "D1 tenant resolver",
                      detail: "tenant e membership verificati in D1",
                      tone: "lime" as Tone,
                    },
                    {
                      icon: ShieldCheck,
                      title: "Permission resolver",
                      detail: "capability assegnate dal ruolo D1",
                      tone: "lime" as Tone,
                    },
                  ].map((item) => {
                    const Icon = item.icon;
                    return (
                      <div className="flex items-center gap-3" key={item.title}>
                        <span
                          className={`grid size-9 place-items-center rounded-xl border ${toneStyles[item.tone].badge}`}
                        >
                          <Icon className="size-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-slate-200">
                            {item.title}
                          </p>
                          <p className="mt-1 text-[11px] text-slate-500">
                            {item.detail}
                          </p>
                        </div>
                        <span className="font-mono text-[9px] text-lime-200">
                          ACTIVE
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-5 flex items-start gap-2 rounded-xl border border-lime-300/15 bg-lime-300/5 p-3 text-[11px] leading-5 text-lime-100/75">
                  <KeyRound className="mt-0.5 size-4 shrink-0 text-lime-200" />
                  S02 ora usa identità Sites o Neon e un resolver D1 fail-closed
                  per tenant, ruoli e capability.
                </div>
              </section>
            </div>

            <section className="carbon-card mt-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl p-4 sm:p-5">
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-xl border border-lime-300/25 bg-lime-300/10 text-lime-200">
                  <ShieldCheck className="size-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-slate-100">
                    S02 CLOSED · Sites native
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Auth, tenant boundary, 13 ruoli canonici, capability gate e
                    profili persistenti sono chiusi nel perimetro Sites.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge>S02 CLOSED</StatusBadge>
                <button
                  className="grid size-8 place-items-center rounded-lg border border-white/10 text-slate-500 hover:border-lime-300/30 hover:text-lime-200"
                  onClick={() =>
                    notify("S02: Sites native, nessuna dipendenza esterna")
                  }
                  type="button"
                  aria-label="Apri evidenze"
                >
                  <ArrowUpRight className="size-3.5" />
                </button>
              </div>
            </section>
            <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] py-5 text-[10px] text-slate-600">
              <span>AI-ZEROW AUTHORITY · S02 CLOSED</span>
              <span className="flex items-center gap-2">
                <span>black carbon core</span>
                <span className="size-1 rounded-full bg-lime-300" />
                <span>Sites-only authority</span>
              </span>
            </footer>
          </div>
        </section>
      </div>

      <CommandMobileNav active="more" role={authorityContext?.role} />
      <Dialog open={teamOpen} onOpenChange={setTeamOpen}>
        <DialogContent className="border-lime-300/20 bg-[#0a0d0e] text-slate-100 sm:max-w-[620px]">
          <DialogHeader>
            <DialogTitle>Crea squadra operativa</DialogTitle>
            <DialogDescription className="text-slate-500">
              La squadra è tenant-scoped, riceve un codice server e diventa una risorsa reale per la pianificazione. I membri sono selezionabili solo dal roster attivo.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <label className="text-xs text-slate-400" htmlFor="team-name">Nome squadra</label>
              <Input id="team-name" className="border-white/10 bg-black/30 text-slate-100" onChange={(event) => setTeamName(event.target.value)} placeholder="Es. Squadra Rete Nord" value={teamName} />
            </div>
            <div className="space-y-2">
              <label className="text-xs text-slate-400" htmlFor="team-capacity">Capacità simultanea</label>
              <Input id="team-capacity" className="border-white/10 bg-black/30 text-slate-100" min={1} max={100} onChange={(event) => setTeamCapacity(event.target.value)} type="number" value={teamCapacity} />
            </div>
            <div className="space-y-2">
              <label className="text-xs text-slate-400" htmlFor="team-qualifications">Qualifiche</label>
              <Input id="team-qualifications" className="border-white/10 bg-black/30 text-slate-100" onChange={(event) => setTeamQualifications(event.target.value)} placeholder="ADR, PES-PAV" value={teamQualifications} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <label className="text-xs text-slate-400" htmlFor="team-description">Descrizione</label>
              <Textarea id="team-description" className="min-h-20 border-white/10 bg-black/30 text-slate-100" onChange={(event) => setTeamDescription(event.target.value)} placeholder="Perimetro operativo della squadra" value={teamDescription} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <p className="text-xs text-slate-400">Membri attivi</p>
              <div className="grid max-h-48 gap-2 overflow-y-auto rounded-xl border border-white/10 bg-black/20 p-2 sm:grid-cols-2">
                {memberships.filter((membership) => membership.status === "active").map((membership) => {
                  const selected = teamMemberIds.includes(membership.id);
                  return (
                    <label className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-[11px] transition ${selected ? "border-lime-300/35 bg-lime-300/10 text-lime-100" : "border-white/[0.08] text-slate-400 hover:border-lime-300/25"}`} key={membership.id}>
                      <input checked={selected} className="size-4 accent-lime-300" onChange={() => setTeamMemberIds((current) => selected ? current.filter((id) => id !== membership.id) : [...current, membership.id])} type="checkbox" />
                      <span className="min-w-0 truncate">{membership.displayName}<span className="ml-1 text-[9px] text-slate-600">· {membership.rolesLabel?.join(" + ") ?? membership.roleLabel}</span></span>
                    </label>
                  );
                })}
                {!memberships.some((membership) => membership.status === "active") && <p className="col-span-2 p-3 text-center text-[10px] text-amber-200">Nessun membro attivo disponibile: invita prima un operatore.</p>}
              </div>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" className="border-white/10 bg-transparent text-slate-400">Annulla</Button>
            </DialogClose>
            <Button type="button" disabled={teamSubmitting || !canManageAuthority || !teamMemberIds.length} className="bg-lime-300 text-[#060806] hover:bg-lime-200" onClick={() => void createTeam()}>
              {teamSubmitting ? <LoaderCircle className="size-3.5 animate-spin" /> : <Users className="size-3.5" />}
              {teamSubmitting ? "Salvataggio…" : canManageAuthority ? "Crea squadra" : "Solo lettura"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent className="border-lime-300/20 bg-[#0a0d0e] text-slate-100 sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="text-slate-100">
              Crea profilo accesso
            </DialogTitle>
            <DialogDescription className="text-slate-500">
              Tenant, creator e capability sono ricostruiti dal server. Il
              browser invia solo etichetta e ruolo canonico.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs text-slate-400" htmlFor="profile-label">
                Etichetta profilo
              </label>
              <Input
                id="profile-label"
                className="border-white/10 bg-black/30 text-slate-100"
                onChange={(event) => setProfileLabel(event.target.value)}
                placeholder="Es. Responsabile operativo"
                value={profileLabel}
              />
            </div>
            <div className="space-y-2">
              <p className="text-xs text-slate-400">Ruolo base</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {AUTHORITY_ROLES.slice(0, 6).map((role) => (
                  <button
                    className={`rounded-lg border px-3 py-2 text-left text-[11px] transition ${selectedRole === role ? "border-lime-300/35 bg-lime-300/10 text-lime-100" : "border-white/10 bg-black/20 text-slate-400 hover:border-lime-300/25"}`}
                    key={role}
                    onClick={() => setSelectedRole(role)}
                    type="button"
                  >
                    {ROLE_METADATA[role].label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-start gap-2 rounded-xl border border-lime-300/15 bg-lime-300/5 p-3 text-[11px] leading-5 text-lime-100/80">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-lime-200" />
              Deny by default: il profilo non puo assegnare capability esterne
              al ruolo selezionato.
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button
                type="button"
                variant="outline"
                className="border-white/10 bg-transparent text-slate-400"
              >
                Annulla
              </Button>
            </DialogClose>
            <Button
              type="button"
              disabled={profileSubmitting || !canManageAuthority}
              className="bg-lime-300 text-[#060806] hover:bg-lime-200"
              onClick={() => void createProfile()}
            >
              <Send className="size-3.5" />
              {profileSubmitting
                ? "Salvataggio…"
                : canManageAuthority
                  ? "Salva profilo"
                  : "Solo lettura"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {toast && (
        <div className="fixed bottom-5 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2 rounded-xl border border-lime-300/25 bg-[#0b1008]/95 px-4 py-3 text-xs text-lime-100 shadow-[0_0_30px_rgba(190,255,60,0.14)] backdrop-blur-xl">
          <CheckCircle2 className="size-4 text-lime-300" />
          {toast}
        </div>
      )}
    </main>
  );
}
