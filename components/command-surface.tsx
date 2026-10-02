"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  AlarmClock,
  ArrowUpRight,
  Bell,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  CircleGauge,
  CloudSun,
  Clock3,
  FileText,
  Gauge,
  HardHat,
  Menu,
  MessageSquareText,
  Network,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Send,
  Settings,
  ShoppingCart,
  ShieldCheck,
  Sparkles,
  Truck,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  ActivityPanel,
  AnalyticsPanel,
  AssetPanel,
  JobPanel,
  KpiCard,
  NewJobDialog,
  defaultAssistantResponse,
  readbackLabel,
  toActivities,
  toAssets,
  toJobs,
} from "@/app/page-client";
import { AccountMenu, type AccountActor } from "@/components/account-menu";
import { CommandHero } from "@/components/command-hero";
import { CommandMobileNav } from "@/components/command-mobile-nav";
import { TenantSwitcher } from "@/components/tenant-switcher";
import { OperationalMapBoard } from "@/components/operational-map-board";
import {
  CommandPersonalizationBar,
  CommandWidgetCustomizer,
  CommandWidgetFrame,
} from "@/components/command-widget-customizer";
import { Input } from "@/components/ui/input";
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
import { readback } from "@/lib/client-readback";
import type {
  CommandNavigationId,
  CommandSurfaceAccess,
  CommandWidgetId,
  CommandWidgetLayoutItem,
  CommandWidgetPublicDefinition,
} from "@/lib/command-dashboard";

type Tone = "lime" | "amber" | "cyan" | "red";
type ReadbackStatus = "loading" | "online" | "partial" | "empty" | "error";
type MapFilter = "TUTTI" | "ASSET" | "TEAM" | "LAVORI" | "GEOFENCE";
type JobTab = "ATTIVI" | "PIANIFICATI" | "COMPLETATI";
type AssetTab = "OPERATIVI" | "MANUTENZIONE" | "TUTTI";
type AiRuntimeStatus = "checking" | "ready" | "not_configured" | "unavailable";

type CommandRecord = {
  id: string;
  canonicalCode?: string;
  module: "operations" | "assets" | "workforce";
  title: string;
  detail: string;
  meta: string;
  status: string;
  tone: Tone;
  progress: number;
  payload?: Record<string, unknown>;
  updatedAt?: string;
};

type CommandDashboardResponse = {
  records?: CommandRecord[];
  modules?: string[];
  requestedModules?: string[];
  w10?: W10Summary | null;
};

type CommandReadinessResponse = {
  summary?: { localGateReady?: number; localGateTotal?: number; ledgerCount?: number; ledgerStatus?: "READY" | "BLOCKED"; openAiLive?: "NOT_RUN" };
  runtime?: { configured?: boolean; model?: string; liveRequest?: "NOT_RUN"; directWrite?: boolean };
  governanceRead?: boolean;
};

type W10Summary = {
  status: "ok" | "not_available";
  workflowCount: number;
  reviewCount: number;
  openValueMilli: number;
  reconciledCount: number;
  checkedAt: string;
};

type CommandPreferencesResponse = {
  canCustomize?: boolean;
  catalog?: CommandWidgetPublicDefinition[];
  layout?: CommandWidgetLayoutItem[];
  savedAt?: string | null;
  error?: string;
};

type ReminderRecord = {
  id: string;
  recordType?: string;
  title?: string;
  detail?: string;
  meta?: string;
  status?: string;
  updatedAt?: string;
};

type CommunicationsResponse = {
  records?: ReminderRecord[];
};

const commandModules = ["operations", "assets", "workforce"] as const;

const navItems: Array<{
  id: CommandNavigationId;
  label: string;
  path: string;
  icon: LucideIcon;
  badge?: string;
}> = [
  { id: "command", label: "CONTROL", path: "/", icon: MessageSquareText, badge: "AI" },
  { id: "operations", label: "OPERATIONS", path: "/operations", icon: BriefcaseBusiness },
  { id: "workforce", label: "WORKFORCE", path: "/workforce", icon: Users },
  { id: "planning", label: "PLANNING", path: "/planning", icon: CalendarClock },
  { id: "attendance", label: "PRESENZE", path: "/presenze", icon: Clock3 },
  { id: "finance", label: "FINANCE", path: "/finance", icon: Gauge },
  { id: "procurement", label: "PROCUREMENT", path: "/procurement", icon: ShoppingCart },
  { id: "assets", label: "ASSETS", path: "/assets", icon: Package },
  { id: "warehouse", label: "WAREHOUSE", path: "/warehouse", icon: Package },
  { id: "mission", label: "MISSION", path: "/mission", icon: Truck },
  { id: "documents", label: "DOCUMENTS", path: "/documents", icon: FileText },
  { id: "governance", label: "GOVERNANCE", path: "/governance", icon: ShieldCheck },
  { id: "communications", label: "COMMUNICATIONS", path: "/communications", icon: MessageSquareText },
  { id: "externals", label: "EXTERNAL ADAPTERS", path: "/externals", icon: Network },
  { id: "authority", label: "AUTHORITY", path: "/onboarding", icon: ShieldCheck },
  { id: "events", label: "EVENTS", path: "/events", icon: Activity },
  { id: "pwa", label: "PWA / DIAGNOSTICS", path: "/pwa/diagnostics", icon: CircleGauge },
  { id: "settings", label: "SETTINGS", path: "/settings", icon: Settings },
];

function W10CommandPanel({ summary }: { summary: W10Summary | null }) {
  const router = useRouter();
  const amount = summary ? new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(summary.openValueMilli / 1000) : "—";
  const unavailable = !summary || summary.status !== "ok";
  return <section className="carbon-card flex h-full flex-col rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-lime-300/70">W10 / CONTROL BRIDGE</p><h2 className="mt-1 text-sm font-semibold text-slate-100">Finance & Procurement</h2><p className="mt-1 text-[11px] text-slate-500">Workflow, approval e confine provider nel Command.</p></div><span className={`rounded-full border px-2 py-1 text-[9px] font-semibold ${unavailable ? "border-amber-300/20 bg-amber-300/[0.06] text-amber-100" : "border-lime-300/20 bg-lime-300/[0.06] text-lime-100"}`}>{unavailable ? "READBACK PENDING" : "D1 VERIFIED"}</span></div>{unavailable ? <div className="carbon-inset mt-5 flex flex-1 items-center gap-3 rounded-xl p-4"><CircleGauge className="size-5 text-amber-200" /><p className="text-xs leading-5 text-slate-500">Il workflow W10 non è ancora disponibile nel readback corrente. Nessun valore viene simulato.</p></div> : <><div className="mt-5 grid grid-cols-2 gap-2"><div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[0.14em] text-slate-600">Workflow</p><p className="mt-2 font-mono text-xl text-lime-100">{summary.workflowCount}</p></div><div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[0.14em] text-slate-600">In review</p><p className="mt-2 font-mono text-xl text-cyan-100">{summary.reviewCount}</p></div><div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[0.14em] text-slate-600">Valore aperto</p><p className="mt-2 font-mono text-sm text-lime-100">{amount}</p></div><div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[0.14em] text-slate-600">Riconciliati</p><p className="mt-2 font-mono text-xl text-lime-100">{summary.reconciledCount}</p></div></div><div className="mt-4 rounded-xl border border-amber-300/15 bg-amber-300/[0.045] p-3"><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-100"><ShieldCheck className="size-3.5" />Provider boundary</div><p className="mt-2 text-[11px] leading-5 text-slate-500">Approval e stato Sites sono verificabili. Emissione PO, ricezione e contabilizzazione restano esterni.</p></div></>}<div className="mt-5 flex flex-wrap gap-2"><Button className="h-9 flex-1 bg-lime-300 text-[11px] font-semibold text-[#060806] hover:bg-lime-200" onClick={() => router.push("/procurement")}><ShoppingCart className="size-3.5" />Apri Procurement</Button><Button className="h-9 flex-1 border-white/10 bg-transparent text-[11px] text-slate-300 hover:border-lime-300/30 hover:text-lime-100" onClick={() => router.push("/finance")}><Gauge className="size-3.5" />Apri Finance</Button></div></section>;
}

function CommandReadinessPanel({ readiness }: { readiness: CommandReadinessResponse | null }) {
  const router = useRouter();
  const ready = readiness?.summary?.localGateReady ?? 0;
  const total = readiness?.summary?.localGateTotal ?? 0;
  const ledgerStatus = readiness?.summary?.ledgerStatus ?? "BLOCKED";
  const configured = Boolean(readiness?.runtime?.configured);
  return <section className="carbon-card flex h-full flex-col rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-lime-300/70">W12 / READINESS</p><h2 className="mt-1 text-sm font-semibold text-slate-100">Company AI control</h2><p className="mt-1 text-[11px] text-slate-500">Guard locali, ledger e confine provider.</p></div><span className={`rounded-full border px-2 py-1 text-[9px] font-semibold ${readiness ? "border-lime-300/20 bg-lime-300/[0.06] text-lime-100" : "border-amber-300/20 bg-amber-300/[0.06] text-amber-100"}`}>{readiness ? "D1 READBACK" : "CHECKING"}</span></div><div className="mt-5 grid grid-cols-2 gap-2"><div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[0.14em] text-slate-600">Local gates</p><p className="mt-2 font-mono text-xl text-lime-100">{readiness ? `${ready}/${total}` : "—"}</p></div><div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[0.14em] text-slate-600">Ledger</p><p className="mt-2 font-mono text-xl text-cyan-100">{readiness ? readiness.summary?.ledgerCount ?? 0 : "—"}</p></div></div><div className="mt-4 space-y-2"><div className="flex items-center justify-between rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2.5 text-[10px]"><span className="flex items-center gap-2 text-slate-500"><CircleAlert className="size-3.5 text-amber-200" />OpenAI live</span><span className="text-amber-200">NOT RUN</span></div><div className="flex items-center justify-between rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2.5 text-[10px]"><span className="flex items-center gap-2 text-slate-500"><ShieldCheck className="size-3.5 text-lime-200" />No direct write</span><span className="text-lime-200">BLOCKED</span></div><div className="flex items-center justify-between rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2.5 text-[10px]"><span className="flex items-center gap-2 text-slate-500"><Sparkles className="size-3.5 text-lime-200" />Runtime binding</span><span className={configured ? "text-lime-200" : "text-amber-200"}>{configured ? "SERVER-SIDE" : "NOT OBSERVED"}</span></div></div><div className="mt-auto flex flex-wrap gap-2 pt-5"><Button className="h-9 flex-1 bg-lime-300 text-[11px] font-semibold text-[#060806] hover:bg-lime-200" onClick={() => router.push(readiness?.governanceRead ? "/governance" : "/externals")}><ShieldCheck className="size-3.5" />{readiness?.governanceRead ? "Apri control plane" : "Apri adapter"}</Button><span className="flex h-9 items-center rounded-lg border border-amber-300/15 px-2.5 text-[9px] text-amber-100/70">{ledgerStatus}</span></div></section>;
}

function PlanningCommandPanel() {
  const router = useRouter();
  const [summary, setSummary] = useState<{ jobs: number; plans: number; published: number; conflicted: number } | null>(null);
  useEffect(() => {
    let active = true;
    void fetch("/api/planning", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as { summary?: { jobs?: number; plans?: number; published?: number; conflicted?: number } };
        if (!active || !response.ok) return;
        setSummary({ jobs: payload.summary?.jobs ?? 0, plans: payload.summary?.plans ?? 0, published: payload.summary?.published ?? 0, conflicted: payload.summary?.conflicted ?? 0 });
      })
      .catch(() => { if (active) setSummary(null); });
    return () => { active = false; };
  }, []);
  return <section className="carbon-card flex h-full flex-col rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">P2 / PLANNING</p><h2 className="mt-1 text-sm font-semibold text-slate-100">Piano operativo</h2><p className="mt-1 text-[11px] text-slate-500">Attività, missioni e risorse reali.</p></div><span className="grid size-9 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/[.07] text-lime-200"><CalendarClock className="size-4" /></span></div><div className="mt-5 grid grid-cols-2 gap-2"><div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">Perimetri</p><p className="mt-2 font-mono text-xl text-lime-100">{summary?.jobs ?? "—"}</p></div><div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">Piani</p><p className="mt-2 font-mono text-xl text-cyan-100">{summary?.plans ?? "—"}</p></div><div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">Pubblicati</p><p className="mt-2 font-mono text-xl text-lime-100">{summary?.published ?? "—"}</p></div><div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">Conflitti</p><p className="mt-2 font-mono text-xl text-amber-100">{summary?.conflicted ?? "—"}</p></div></div><Button className="mt-auto h-9 bg-lime-300 text-[11px] font-semibold text-[#060806] hover:bg-lime-200" onClick={() => router.push("/planning")}><CalendarClock className="size-3.5" />Apri pianificazione</Button></section>;
}

function WeatherCommandPanel() {
  const router = useRouter();
  return (
    <section className="carbon-card flex h-full flex-col rounded-2xl p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">LIVE / WEATHER</p>
          <h2 className="mt-1 text-sm font-semibold text-slate-100">Meteo operativo</h2>
          <p className="mt-1 text-[11px] text-slate-500">Condizioni utili per squadre, mezzi e cantieri.</p>
        </div>
        <span className="grid size-9 place-items-center rounded-xl border border-cyan-300/20 bg-cyan-300/[.07] text-cyan-200"><CloudSun className="size-4" /></span>
      </div>
      <div className="carbon-inset mt-5 flex flex-1 flex-col justify-between rounded-xl p-4">
        <div className="grid grid-cols-3 gap-2 text-center">
          {[["Temperatura", "—"], ["Condizioni", "—"], ["Vento", "—"]].map(([label, value]) => (
            <div key={label}>
              <p className="text-[9px] uppercase tracking-[.12em] text-slate-600">{label}</p>
              <p className="mt-2 font-mono text-base text-slate-300">{value}</p>
            </div>
          ))}
        </div>
        <p className="mt-5 rounded-lg border border-amber-300/15 bg-amber-300/[.045] p-3 text-[10px] leading-4 text-amber-100/75">
          Provider meteo non collegato · NOT RUN. Nessuna condizione viene simulata.
        </p>
      </div>
      <button className="mt-4 flex items-center gap-1.5 text-[10px] text-lime-300 hover:text-lime-100" onClick={() => router.push("/externals")} type="button">
        Configura provider <ArrowUpRight className="size-3.5" />
      </button>
    </section>
  );
}

function RemindersCommandPanel({ canRead }: { canRead: boolean }) {
  const router = useRouter();
  const [records, setRecords] = useState<ReminderRecord[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!canRead) return;
    let active = true;
    void fetch("/api/communications", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as CommunicationsResponse;
        if (!active) return;
        if (!response.ok) throw new Error("communications_read_failed");
        const next = (Array.isArray(payload.records) ? payload.records : [])
          .filter((record) => /remind|promem|scaden|follow.?up/i.test(`${record.recordType ?? ""} ${record.title ?? ""} ${record.status ?? ""}`))
          .slice(0, 4);
        setRecords(next);
      })
      .catch(() => {
        if (!active) return;
        setError(true);
        setRecords([]);
      });
    return () => { active = false; };
  }, [canRead]);

  return (
    <section className="carbon-card flex h-full flex-col rounded-2xl p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">COMMS / REMINDERS</p>
          <h2 className="mt-1 text-sm font-semibold text-slate-100">Promemoria</h2>
          <p className="mt-1 text-[11px] text-slate-500">Collegati al registro notifiche del tenant.</p>
        </div>
        <span className="grid size-9 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/[.07] text-lime-200"><AlarmClock className="size-4" /></span>
      </div>
      {!canRead ? (
        <div className="carbon-inset mt-5 flex flex-1 items-center rounded-xl p-4 text-[11px] leading-5 text-slate-500">Promemoria non visibili: capability comunicazioni non presente nel ruolo corrente.</div>
      ) : error ? (
        <div className="carbon-inset mt-5 flex flex-1 items-center rounded-xl border border-rose-300/15 p-4 text-[11px] leading-5 text-rose-100/75">Readback notifiche non disponibile. Riprova dal modulo Comunicazioni.</div>
      ) : records === null ? (
        <div className="carbon-inset mt-5 flex flex-1 items-center rounded-xl p-4 text-[11px] text-slate-600">Lettura promemoria in corso…</div>
      ) : records.length === 0 ? (
        <div className="carbon-inset mt-5 flex flex-1 items-center rounded-xl p-4 text-[11px] leading-5 text-slate-500">Nessun promemoria nel readback notifiche.</div>
      ) : (
        <div className="mt-5 flex-1 space-y-2">
          {records.map((record) => (
            <div className="carbon-inset rounded-xl p-3" key={record.id}>
              <div className="flex items-start gap-2"><span className="mt-1 size-1.5 shrink-0 rounded-full bg-lime-300 shadow-[0_0_8px_rgba(200,255,34,.75)]" /><div className="min-w-0"><p className="truncate text-xs text-slate-200">{record.title ?? "Promemoria"}</p><p className="mt-1 line-clamp-2 text-[10px] leading-4 text-slate-500">{record.detail ?? record.meta ?? "—"}</p></div></div>
            </div>
          ))}
        </div>
      )}
      {canRead ? <button className="mt-4 flex items-center gap-1.5 text-[10px] text-lime-300 hover:text-lime-100" onClick={() => router.push("/communications")} type="button">Apri notifiche <ArrowUpRight className="size-3.5" /></button> : null}
    </section>
  );
}

function AttendanceCommandPanel() {
  const router = useRouter();
  const [summary, setSummary] = useState<{ total: number; checkedIn: number; paused: number; gpsObserved: number } | null>(null);
  useEffect(() => {
    let active = true;
    void fetch("/api/workforce/attendance", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as { summary?: { total?: number; checkedIn?: number; paused?: number; gpsObserved?: number } };
        if (!active || !response.ok) return;
        setSummary({ total: payload.summary?.total ?? 0, checkedIn: payload.summary?.checkedIn ?? 0, paused: payload.summary?.paused ?? 0, gpsObserved: payload.summary?.gpsObserved ?? 0 });
      })
      .catch(() => { if (active) setSummary(null); });
    return () => { active = false; };
  }, []);
  return <section className="carbon-card flex h-full flex-col rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-cyan-200/70">P3 / WORKFORCE</p><h2 className="mt-1 text-sm font-semibold text-slate-100">Presenze operative</h2><p className="mt-1 text-[11px] text-slate-500">Solo servizio, timestamp e geofence osservato.</p></div><span className="grid size-9 place-items-center rounded-xl border border-cyan-300/20 bg-cyan-300/[.07] text-cyan-200"><Clock3 className="size-4" /></span></div><div className="mt-5 grid grid-cols-2 gap-2"><div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">Presenze</p><p className="mt-2 font-mono text-xl text-lime-100">{summary?.total ?? "—"}</p></div><div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">In servizio</p><p className="mt-2 font-mono text-xl text-lime-100">{summary?.checkedIn ?? "—"}</p></div><div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">In pausa</p><p className="mt-2 font-mono text-xl text-amber-100">{summary?.paused ?? "—"}</p></div><div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">GPS</p><p className="mt-2 font-mono text-xl text-cyan-100">{summary?.gpsObserved ?? "—"}</p></div></div><Button className="mt-auto h-9 border-white/10 bg-transparent text-[11px] text-slate-300 hover:border-cyan-300/30 hover:text-cyan-100" onClick={() => router.push("/presenze")} variant="outline"><Clock3 className="size-3.5" />Apri presenze</Button></section>;
}

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
      className={`grid size-10 place-items-center rounded-xl border border-white/10 bg-black/25 text-slate-500 transition hover:border-lime-300/35 hover:bg-lime-300/10 hover:text-lime-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300 ${className}`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function moveWidget(layout: CommandWidgetLayoutItem[], id: CommandWidgetId, offset: number) {
  const index = layout.findIndex((item) => item.id === id);
  const nextIndex = index + offset;
  if (index < 0 || nextIndex < 0 || nextIndex >= layout.length) return layout;
  const next = [...layout];
  const [item] = next.splice(index, 1);
  next.splice(nextIndex, 0, item);
  return next;
}

function dropWidget(layout: CommandWidgetLayoutItem[], source: CommandWidgetId, target: CommandWidgetId) {
  if (source === target) return layout;
  const sourceIndex = layout.findIndex((item) => item.id === source);
  const targetIndex = layout.findIndex((item) => item.id === target);
  if (sourceIndex < 0 || targetIndex < 0) return layout;
  const next = [...layout];
  const [item] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, item);
  return next;
}

function layoutFingerprint(layout: CommandWidgetLayoutItem[]) {
  return JSON.stringify(layout);
}

function CompanyAiPanel({
  query,
  response,
  runtimeStatus,
  onQueryChange,
  onSubmit,
  onQuickPrompt,
  onOpenLedger,
}: {
  query: string;
  response: string;
  runtimeStatus: AiRuntimeStatus;
  onQueryChange: (value: string) => void;
  onSubmit: () => void;
  onQuickPrompt: (prompt: string) => void;
  onOpenLedger: () => void;
}) {
  const quickPrompts = ["Analizza andamento commesse", "Quali asset sono disponibili?", "Evidenzia rischi operativi", "Prepara un riepilogo per il cliente"];
  const status = runtimeStatus === "ready"
    ? { label: "OPENAI LIVE", tone: "text-lime-200 border-lime-300/30 bg-lime-300/10" }
    : runtimeStatus === "checking"
      ? { label: "RUNTIME CHECK", tone: "text-cyan-200 border-cyan-300/25 bg-cyan-300/10" }
      : runtimeStatus === "not_configured"
        ? { label: "CONFIG REQUIRED", tone: "text-amber-200 border-amber-300/25 bg-amber-300/10" }
        : { label: "DEGRADED", tone: "text-amber-200 border-amber-300/25 bg-amber-300/10" };

  return (
    <section className="carbon-card carbon-card-neon flex h-full flex-col rounded-2xl p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3"><span className="neon-pulse grid size-10 place-items-center rounded-xl bg-lime-300 text-[#060806]"><Sparkles className="size-[18px]" /></span><div><p className="text-[15px] font-semibold text-slate-50">Company AI</p><p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-lime-200/60">OpenAI · governed command</p></div></div>
        <span className={`rounded-full border px-2.5 py-1 text-[9px] font-semibold tracking-[0.08em] ${status.tone}`}>{status.label}</span>
      </div>
      <div className="carbon-inset mt-5 rounded-xl p-3">
        <div className="flex items-center gap-2 text-[10px] text-lime-200"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_10px_rgba(200,255,34,.9)]" />SERVER-SIDE AI<span className="ml-auto font-mono text-[9px] text-slate-600">NO DIRECT WRITE</span></div>
        <p className="mt-3 text-sm leading-6 text-slate-300" aria-live="polite">{response}</p>
      </div>
      <form className="mt-4 flex gap-2" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
        <div className="relative min-w-0 flex-1"><MessageSquareText className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-600" /><Input aria-label="Chiedi a Company AI" className="h-10 border-white/10 bg-black/40 pl-9 text-xs text-slate-100 placeholder:text-slate-600" onChange={(event) => onQueryChange(event.target.value)} placeholder="Chiedi a Company AI…" value={query} /></div>
        <Button aria-label="Invia richiesta" className="h-10 w-10 bg-lime-300 p-0 text-[#060806] shadow-[0_0_18px_rgba(200,255,34,.18)] hover:bg-lime-200" size="icon" type="submit"><Send className="size-4" /></Button>
      </form>
      <div className="mt-4 space-y-2">{quickPrompts.map((prompt) => <button className="flex w-full items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-left text-[11px] text-slate-400 transition hover:border-lime-300/30 hover:bg-lime-300/5 hover:text-lime-200" key={prompt} onClick={() => onQuickPrompt(prompt)} type="button"><span className="grid size-5 place-items-center rounded-md border border-white/10 text-slate-600"><ChevronRight className="size-3" /></span>{prompt}</button>)}</div>
      <div className="mt-auto flex items-center justify-between border-t border-white/10 pt-4"><button className="flex items-center gap-2 text-[10px] text-slate-500 hover:text-lime-200" onClick={onOpenLedger} type="button"><FileText className="size-3.5" />Apri command ledger</button><span className="font-mono text-[9px] text-slate-600">S07 / D1</span></div>
    </section>
  );
}

function CommandLedgerDialog({ open, onOpenChange, runtimeStatus }: { open: boolean; onOpenChange: (open: boolean) => void; runtimeStatus: AiRuntimeStatus }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="carbon-card max-w-2xl border-lime-300/20 p-0 text-slate-100">
        <DialogHeader className="border-b border-white/10 px-5 py-5 text-left"><DialogTitle className="text-base text-slate-50">Command ledger</DialogTitle><DialogDescription className="mt-1 text-xs text-slate-500">Ogni richiesta conserva actor, tenant, runtime e readback. Nessuna risposta AI scrive direttamente nei domini.</DialogDescription></DialogHeader>
        <div className="space-y-3 p-5">
          <div className="carbon-inset flex items-center justify-between rounded-xl p-3"><div><p className="text-xs font-medium text-slate-200">OpenAI Responses API</p><p className="mt-1 text-[10px] text-slate-500">Chiave solo server · output strutturato · timeout controllato</p></div><span className={`rounded-full border px-2 py-1 text-[9px] ${runtimeStatus === "ready" ? "border-lime-300/25 text-lime-200" : "border-amber-300/25 text-amber-200"}`}>{runtimeStatus === "ready" ? "CONFIGURED" : runtimeStatus.toUpperCase()}</span></div>
          <div className="carbon-inset flex items-center justify-between rounded-xl p-3"><div><p className="text-xs font-medium text-slate-200">Authority context</p><p className="mt-1 text-[10px] text-slate-500">Record filtrati per tenant e capability prima del prompt</p></div><span className="text-[9px] text-lime-200">ENFORCED</span></div>
          <div className="carbon-inset flex items-center justify-between rounded-xl p-3"><div><p className="text-xs font-medium text-slate-200">Write boundary</p><p className="mt-1 text-[10px] text-slate-500">Le azioni restano preview e richiedono approvazione</p></div><span className="text-[9px] text-lime-200">NO DIRECT WRITE</span></div>
        </div>
        <DialogFooter className="border-t border-white/10 px-5 py-4"><DialogClose asChild><Button className="border-white/10 bg-transparent text-slate-300 hover:bg-white/10 hover:text-white" variant="outline">Chiudi</Button></DialogClose></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function CommandSurface({
  actor,
  access,
}: {
  actor: AccountActor;
  access: CommandSurfaceAccess;
}) {
  const router = useRouter();
  const [mobileMenu, setMobileMenu] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [search, setSearch] = useState("");
  const [mapFilter, setMapFilter] = useState<MapFilter>("TUTTI");
  const [selectedMarker, setSelectedMarker] = useState("");
  const [jobTab, setJobTab] = useState<JobTab>("ATTIVI");
  const [assetTab, setAssetTab] = useState<AssetTab>("OPERATIVI");
  const [showAllActivity, setShowAllActivity] = useState(false);
  const [assistantQuery, setAssistantQuery] = useState("");
  const [assistantResponse, setAssistantResponse] = useState(defaultAssistantResponse);
  const [aiRuntimeStatus, setAiRuntimeStatus] = useState<AiRuntimeStatus>("checking");
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [newJobOpen, setNewJobOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [readbackStatus, setReadbackStatus] = useState<ReadbackStatus>("loading");
  const [records, setRecords] = useState<CommandRecord[]>([]);
  const [widgetCatalog, setWidgetCatalog] = useState(access.widgetCatalog);
  const [widgetLayout, setWidgetLayout] = useState(access.defaultLayout);
  const [savedLayout, setSavedLayout] = useState(layoutFingerprint(access.defaultLayout));
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [preferencesSynced, setPreferencesSynced] = useState(false);
  const [w10Summary, setW10Summary] = useState<W10Summary | null>(null);
  const [commandReadiness, setCommandReadiness] = useState<CommandReadinessResponse | null>(null);
  const [customizerOpen, setCustomizerOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [savingLayout, setSavingLayout] = useState(false);

  useEffect(() => {
    let active = true;

    void readback<CommandDashboardResponse>("command:dashboard", "/api/command/dashboard")
      .then((payload) => {
        if (!active) return;
        const nextRecords = Array.isArray(payload.records) ? payload.records : [];
        const requestedModules = payload.requestedModules?.length ?? commandModules.length;
        const readableModules = payload.modules?.length ?? 0;
        setRecords(nextRecords);
        setW10Summary(payload.w10 ?? null);
        if (readableModules === 0) setReadbackStatus("error");
        else if (nextRecords.length === 0) setReadbackStatus("empty");
        else if (readableModules === requestedModules) setReadbackStatus("online");
        else setReadbackStatus("partial");
      })
      .catch(() => {
        if (!active) return;
        setRecords([]);
        setReadbackStatus("error");
      });

    void fetch("/api/command/preferences", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as CommandPreferencesResponse;
        if (!active) return;
        if (!response.ok || !payload.layout || !payload.catalog) {
          setPreferencesReady(true);
          setPreferencesSynced(false);
          return;
        }
        setWidgetCatalog(payload.catalog);
        setWidgetLayout(payload.layout);
        setSavedLayout(layoutFingerprint(payload.layout));
        setPreferencesReady(true);
        setPreferencesSynced(true);
      })
      .catch(() => {
        if (!active) return;
        setPreferencesReady(true);
        setPreferencesSynced(false);
      });

    void fetch("/api/command/ai-status", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as { configured?: boolean };
        if (!active) return;
        if (!response.ok) {
          setAiRuntimeStatus("unavailable");
          return;
        }
        setAiRuntimeStatus(payload.configured ? "ready" : "not_configured");
      })
      .catch(() => {
        if (active) setAiRuntimeStatus("unavailable");
      });

    void fetch("/api/command/readiness", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as CommandReadinessResponse;
        if (active && response.ok) setCommandReadiness(payload);
      })
      .catch(() => {
        if (active) setCommandReadiness(null);
      });

    return () => {
      active = false;
    };
  }, []);

  const jobs = useMemo(() => toJobs(records), [records]);
  const assets = useMemo(() => toAssets(records), [records]);
  const activities = useMemo(() => toActivities(records), [records]);
  const visibleNavigation = useMemo(
    () => navItems.filter((item) => access.allowedNavigation.includes(item.id)),
    [access.allowedNavigation],
  );
  const catalogById = useMemo(
    () => new Map(widgetCatalog.map((item) => [item.id, item])),
    [widgetCatalog],
  );
  const visibleWidgets = widgetLayout.filter((item) => item.visible);
  const dirtyLayout = layoutFingerprint(widgetLayout) !== savedLayout;

  const commandKpis = useMemo(() => {
    const activeJobs = jobs.filter((job) => job.status === "In corso").length;
    const operationalAssets = assets.filter((asset) => asset.status === "Operativo").length;
    const averageProgress = jobs.length
      ? Math.round(jobs.reduce((total, job) => total + job.progress, 0) / jobs.length)
      : null;
    const stateLabel = readbackLabel(readbackStatus);
    return {
      "kpi-jobs": { label: "Lavori attivi", value: readbackStatus === "loading" ? "—" : String(activeJobs), delta: stateLabel, icon: BriefcaseBusiness, tone: "lime" as Tone, data: `${records.filter((record) => record.module === "operations").length} record operations` },
      "kpi-assets": { label: "Asset operativi", value: readbackStatus === "loading" ? "—" : String(operationalAssets), delta: stateLabel, icon: Package, tone: "cyan" as Tone, data: `${records.filter((record) => record.module === "assets").length} record assets` },
      "kpi-workforce": { label: "Team in readback", value: readbackStatus === "loading" ? "—" : String(records.filter((record) => record.module === "workforce").length), delta: stateLabel, icon: Users, tone: "amber" as Tone, data: "Presenze e assegnazioni server-side" },
      "kpi-progress": { label: "Avanzamento medio", value: readbackStatus === "loading" || averageProgress === null ? "—" : `${averageProgress}%`, delta: stateLabel, icon: Activity, tone: "lime" as Tone, data: jobs.length ? "Media dei lavori nel readback" : "Nessun lavoro disponibile" },
    };
  }, [assets, jobs, readbackStatus, records]);

  const readbackAssistantResponse = useMemo(() => {
    if (readbackStatus === "loading") return defaultAssistantResponse;
    if (readbackStatus === "error") return "Il readback D1 non e disponibile. Nessuna metrica o scrittura viene simulata.";
    if (readbackStatus === "empty") return "Il readback D1 e raggiungibile ma non contiene ancora record operativi.";
    return "Readback D1 verificato. Posso preparare una preview governata; le scritture restano vincolate agli adapter.";
  }, [readbackStatus]);
  const assistantPanelResponse = assistantResponse === defaultAssistantResponse ? readbackAssistantResponse : assistantResponse;

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  };

  const submitAssistant = async () => {
    const prompt = assistantQuery.trim();
    if (!prompt) return;
    setAssistantQuery("");
    try {
      const response = await fetch("/api/command/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt, actionType: "query", idempotencyKey: `command-query-${crypto.randomUUID()}` }),
      });
      const payload = await response.json() as {
        result?: { message?: string; aiRuntime?: { status?: "used" | "not_configured" | "unavailable" } };
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "command_adapter_unavailable");
      setAssistantResponse(payload.result?.message || `Preview registrata per “${prompt}”.`);
      if (payload.result?.aiRuntime?.status === "used") setAiRuntimeStatus("ready");
      else if (payload.result?.aiRuntime?.status === "not_configured") setAiRuntimeStatus("not_configured");
      else if (payload.result?.aiRuntime?.status === "unavailable") setAiRuntimeStatus("unavailable");
      notify("Richiesta registrata nel command ledger");
    } catch (error) {
      setAssistantResponse(`Preview locale per “${prompt}”. ${error instanceof Error ? error.message : "Gateway non disponibile"}.`);
      notify("Gateway AI esterno non disponibile");
    }
  };

  const saveLayout = async () => {
    setSavingLayout(true);
    try {
      const response = await fetch("/api/command/preferences", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ layout: widgetLayout }),
      });
      const payload = await response.json() as CommandPreferencesResponse;
      if (!response.ok || !payload.layout || !payload.catalog) {
        throw new Error(payload.error || "layout_not_saved");
      }
      setWidgetCatalog(payload.catalog);
      setWidgetLayout(payload.layout);
      setSavedLayout(layoutFingerprint(payload.layout));
      setPreferencesSynced(true);
      setCustomizerOpen(false);
      setEditMode(false);
      notify("Control deck salvato sul profilo");
    } catch {
      setPreferencesSynced(false);
      notify("Layout non salvato: storage non disponibile");
    } finally {
      setSavingLayout(false);
    }
  };

  const resetLayout = () => {
    const next = widgetCatalog.map((widget) => ({
      id: widget.id,
      size: widget.defaultSize,
      visible: true,
    }));
    setWidgetLayout(next);
  };

  const hideWidget = (id: CommandWidgetId) => {
    setWidgetLayout((current) => current.map((item) => item.id === id ? { ...item, visible: false } : item));
  };

  const renderWidget = (item: CommandWidgetLayoutItem) => {
    if (item.id in commandKpis) {
      return <KpiCard {...commandKpis[item.id as keyof typeof commandKpis]} />;
    }

    if (item.id === "operational-map") {
      return <div className="h-full" id="operational-map"><OperationalMapBoard mapFilter={mapFilter} markers={[]} onFilterChange={setMapFilter} onSelectMarker={setSelectedMarker} selectedMarker={selectedMarker} /></div>;
    }
    if (item.id === "company-ai") {
      return <div className="h-full" id="company-ai"><CompanyAiPanel onOpenLedger={() => setLedgerOpen(true)} onQueryChange={setAssistantQuery} onQuickPrompt={(prompt) => { setAssistantQuery(prompt); setAssistantResponse(`Pronto a preparare: “${prompt}”. Conferma e policy restano necessarie prima di qualsiasi scrittura.`); }} onSubmit={submitAssistant} query={assistantQuery} response={assistantPanelResponse} runtimeStatus={aiRuntimeStatus} /></div>;
    }
    if (item.id === "activity-stream") {
      return <ActivityPanel activities={activities} onToggle={() => setShowAllActivity((value) => !value)} query={search} showAll={showAllActivity} />;
    }
    if (item.id === "jobs") {
      return <JobPanel jobs={jobs} onNewJob={() => setNewJobOpen(true)} onTabChange={setJobTab} tab={jobTab} />;
    }
    if (item.id === "assets") {
      return <AssetPanel assets={assets} onTabChange={setAssetTab} tab={assetTab} />;
    }
    if (item.id === "analytics") return <AnalyticsPanel />;
    if (item.id === "planning-overview") return <PlanningCommandPanel />;
    if (item.id === "attendance-overview") return <AttendanceCommandPanel />;
    if (item.id === "weather") return <WeatherCommandPanel />;
    if (item.id === "reminders") return <RemindersCommandPanel canRead={access.allowedNavigation.includes("communications")} />;
    if (item.id === "finance-procurement") return <W10CommandPanel summary={w10Summary} />;
    if (item.id === "command-readiness") return <CommandReadinessPanel readiness={commandReadiness} />;

    return (
      <section className="carbon-card flex h-full flex-wrap items-center justify-between gap-4 rounded-2xl p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl border border-lime-300/25 bg-lime-300/10 text-lime-200"><ShieldCheck className="size-4" /></span>
          <div>
            <p className="text-sm font-semibold text-slate-100">Command surface pronta</p>
            <p className="mt-1 text-[11px] text-slate-500">Dati filtrati dal resolver di ruolo e readback server-side.</p>
          </div>
        </div>
        <button aria-label="Apri evidenze" className="grid size-9 place-items-center rounded-lg border border-white/10 text-slate-500 hover:border-lime-300/30 hover:text-lime-200" onClick={() => setLedgerOpen(true)} type="button"><ArrowUpRight className="size-3.5" /></button>
      </section>
    );
  };

  return (
    <main className="zw-app-shell zw-command-ultra min-h-screen overflow-x-hidden text-slate-100 selection:bg-lime-300 selection:text-[#060806]">
      <div className="zw-command-ambient" aria-hidden="true" />
      <div className="relative flex min-h-screen">
        <aside className={`zw-command-sidebar fixed inset-y-0 left-0 z-40 flex flex-col px-3 py-4 transition-[width,transform] lg:static lg:translate-x-0 ${sidebarCollapsed ? "is-collapsed lg:w-[76px]" : "lg:w-[248px]"} ${mobileMenu ? "translate-x-0" : "-translate-x-full"}`}>
          <div className="flex items-center justify-between px-2">
            <button aria-label="Apri Command" className="flex min-w-0 items-center gap-3 text-left" onClick={() => { setMobileMenu(false); router.push("/"); }} type="button">
              <span className="neon-pulse relative grid size-10 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black"><Image src="/ai-zerow-icon.jpeg" alt="AI-ZEROW" width={40} height={40} className="size-full object-cover" /></span>
              <span className="zw-command-sidebar__brand-copy min-w-0"><span className="block text-sm font-bold tracking-[0.18em] text-slate-50">AI-ZEROW</span><span className="block text-[10px] uppercase tracking-[0.22em] text-lime-300/75">command</span></span>
            </button>
            <div className="flex items-center gap-1">
              <button aria-label={sidebarCollapsed ? "Espandi sidebar" : "Riduci sidebar"} className="zw-command-sidebar__collapse hidden size-8 place-items-center rounded-lg text-slate-500 hover:bg-lime-300/10 hover:text-lime-200 lg:grid" onClick={() => setSidebarCollapsed((value) => !value)} type="button">{sidebarCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}</button>
              <button aria-label="Chiudi menu" className="grid size-9 place-items-center rounded-xl text-slate-500 hover:bg-white/5 hover:text-white lg:hidden" onClick={() => setMobileMenu(false)} type="button"><X className="size-4" /></button>
            </div>
          </div>

          <div className="zw-command-tenant mt-7 flex items-center gap-3 rounded-2xl p-3">
            <span className="grid size-9 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/10 text-lime-200"><HardHat className="size-4" /></span>
            <span className="zw-command-sidebar__tenant-copy min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-slate-200">ZEROW workspace</span><span className="mt-0.5 block truncate text-[10px] uppercase tracking-[0.1em] text-slate-600">{access.role} · tenant scoped</span></span>
          </div>

          <nav className="mt-6 min-h-0 flex-1 overflow-y-auto" aria-label="Navigazione principale">
            <p className="zw-command-sidebar__nav-caption px-3 text-[9px] font-semibold uppercase tracking-[0.22em] text-slate-700">Authorized workspace</p>
            <div className="mt-2 space-y-1">
              {visibleNavigation.map((item) => {
                const Icon = item.icon;
                const active = item.id === "command";
                return (
                  <button
                    aria-current={active ? "page" : undefined}
                    aria-label={sidebarCollapsed ? item.label : undefined}
                    className={`zw-command-nav-item ${active ? "is-active" : ""}`}
                    key={item.id}
                    onClick={() => { setMobileMenu(false); router.push(item.path); }}
                    type="button"
                  >
                    <Icon className="size-4" />
                    <span className="zw-command-sidebar__nav-label">{item.label}</span>
                    {item.badge ? <span className="zw-command-sidebar__nav-badge ml-auto rounded border border-lime-300/20 px-1.5 py-0.5 font-mono text-[8px] text-lime-200">{item.badge}</span> : null}
                  </button>
                );
              })}
            </div>
          </nav>

          <div className="zw-command-sidebar__footer mt-4 border-t border-white/[0.07] pt-4">
            <div className="flex items-center justify-between px-2 text-[9px] uppercase tracking-[0.14em] text-slate-600"><span>System core</span><span className="flex items-center gap-1.5 text-lime-200"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_10px_rgba(200,255,34,.9)]" />{readbackLabel(readbackStatus)}</span></div>
            <div className="zw-command-core-status mt-3 rounded-xl p-3"><p className="font-mono text-[9px] text-slate-500">D1 / {records.length} RECORD</p><p className="mt-2 font-mono text-[9px] text-lime-300/60">POLICY / {access.role.toUpperCase()}</p></div>
          </div>
        </aside>

        {mobileMenu ? <button aria-label="Chiudi menu" className="fixed inset-0 z-30 bg-black/80 backdrop-blur-sm lg:hidden" onClick={() => setMobileMenu(false)} type="button" /> : null}

        <section className="min-w-0 flex-1">
          <header className="zw-command-topbar sticky top-0 z-20 flex h-[72px] items-center gap-3 px-4 sm:gap-5 sm:px-7">
            <IconButton className="lg:hidden" label="Apri menu" onClick={() => setMobileMenu(true)}><Menu className="size-4" /></IconButton>
            <button aria-label="Apri Command" className="zw-command-topbar__brand flex shrink-0 items-center gap-2 text-left" onClick={() => router.push("/command")} type="button"><span className="relative grid size-9 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black shadow-[0_0_18px_rgba(200,255,34,.12)]"><Image src="/ai-zerow-icon.jpeg" alt="ZEROW" width={36} height={36} className="size-full object-cover" /></span><span className="hidden sm:block"><span className="block text-[11px] font-bold tracking-[0.18em] text-slate-50">ZEROW</span><span className="block text-[9px] uppercase tracking-[0.2em] text-lime-300/75">command</span></span></button>
            <IconButton className="hidden lg:grid" label={sidebarCollapsed ? "Espandi sidebar" : "Riduci sidebar"} onClick={() => setSidebarCollapsed((value) => !value)}>{sidebarCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}</IconButton>
            <div className="relative hidden min-w-0 flex-1 justify-center md:flex"><div className="relative w-full max-w-[520px]"><Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-600" /><Input aria-label="Cerca in COMMAND" className="h-10 w-full border-lime-300/10 bg-black/35 pl-10 text-xs text-slate-100 placeholder:text-slate-600" onChange={(event) => setSearch(event.target.value)} placeholder="Cerca commesse, clienti, asset, documenti…" value={search} /></div></div>
            <div className="flex min-w-0 flex-1 items-center gap-2 md:hidden"><span className="truncate text-xs font-semibold tracking-[0.14em] text-slate-200">COMMAND</span><span className="size-1 rounded-full bg-lime-300" /></div>
            <div className="ml-auto flex items-center gap-2">
              <TenantSwitcher />
              <span className="hidden items-center gap-2 rounded-full border border-lime-300/20 bg-lime-300/5 px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-lime-200 sm:flex"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_9px_rgba(200,255,34,.9)]" />Live control</span>
              {access.allowedNavigation.includes("communications") ? <IconButton label="Apri comunicazioni" onClick={() => router.push("/communications")}><Bell className="size-4" /></IconButton> : null}
              <AccountMenu actor={actor} />
            </div>
          </header>

          <div className="mx-auto max-w-[1920px] px-4 py-5 sm:px-7 sm:py-7">
            <CommandHero onNewJob={() => setNewJobOpen(true)} recordCount={records.length} statusLabel={readbackLabel(readbackStatus)} />
            <div className="mt-4">
              <CommandPersonalizationBar canCustomize={access.canCustomize && preferencesReady} editMode={editMode} onEdit={() => setEditMode((value) => !value)} onOpenCustomizer={() => setCustomizerOpen(true)} saved={!dirtyLayout && preferencesSynced} totalCount={widgetLayout.length} visibleCount={visibleWidgets.length} />
            </div>

            {visibleWidgets.length ? (
              <div className="zw-widget-grid zw-section-reveal mt-4">
                {visibleWidgets.map((item) => {
                  const definition = catalogById.get(item.id);
                  if (!definition) return null;
                  return (
                    <CommandWidgetFrame
                      editMode={editMode}
                      item={item}
                      key={item.id}
                      label={definition.label}
                      onDragStart={() => undefined}
                      onDropWidget={(source, target) => setWidgetLayout((current) => dropWidget(current, source, target))}
                      onHide={hideWidget}
                      onMove={(id, offset) => setWidgetLayout((current) => moveWidget(current, id, offset))}
                    >
                      {renderWidget(item)}
                    </CommandWidgetFrame>
                  );
                })}
              </div>
            ) : (
              <section className="zw-widget-empty mt-4">
                <Package className="size-6 text-lime-300" />
                <div><p className="text-sm font-semibold text-slate-200">Control deck vuoto</p><p className="mt-1 text-xs text-slate-600">Riattiva i widget autorizzati dal configuratore personale.</p></div>
                <button className="zw-button-primary" onClick={() => setCustomizerOpen(true)} type="button">Apri configuratore</button>
              </section>
            )}

            <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] py-5 text-[10px] text-slate-700"><span>AI-ZEROW COMMAND · commercial control deck</span><span className="flex items-center gap-2"><span>ultra carbon core</span><span className="size-1 rounded-full bg-lime-300" /><span>capability filtered</span></span></footer>
          </div>
        </section>
      </div>

      <CommandMobileNav active="home" allowedNavigation={access.allowedNavigation} role={access.role} />
      <CommandWidgetCustomizer catalog={widgetCatalog} dirty={dirtyLayout} layout={widgetLayout} onLayoutChange={setWidgetLayout} onOpenChange={setCustomizerOpen} onReset={resetLayout} onSave={saveLayout} open={customizerOpen} saving={savingLayout} />
      <CommandLedgerDialog onOpenChange={setLedgerOpen} open={ledgerOpen} runtimeStatus={aiRuntimeStatus} />
      <NewJobDialog onCreated={(title) => { setNewJobOpen(false); notify(`Bozza locale creata: ${title}`); }} onOpenChange={setNewJobOpen} open={newJobOpen} />
      {toast ? <div className="fixed bottom-5 left-1/2 z-[100] flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-2 rounded-xl border border-lime-300/25 bg-[#080d09]/96 px-4 py-3 text-xs text-lime-100 shadow-[0_0_34px_rgba(200,255,34,.16)] backdrop-blur-xl"><CheckCircle2 className="size-4 shrink-0 text-lime-300" />{toast}</div> : null}
    </main>
  );
}
