"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  ArrowLeft,
  ArrowUpRight,
  Bell,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  FileText,
  HardHat,
  Layers3,
  LoaderCircle,
  Menu,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  Package,
  RefreshCw,
  Route,
  Search,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  Truck,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { AccountMenu } from "@/components/account-menu";
import { CommandMobileNav } from "@/components/command-mobile-nav";
import { PlanningResourceFields } from "@/components/planning-resource-fields";
import { TenantSwitcher } from "@/components/tenant-switcher";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getAllowedCommandNavigation, type CommandNavigationId } from "@/lib/command-dashboard";

type Tone = "lime" | "cyan" | "amber" | "red";

type PlanningContext = {
  actorName: string;
  actorEmail: string;
  role: string;
  roles?: string[];
  capabilities: string[];
};

type PlanningJob = {
  id: string;
  code: string | null;
  title: string;
  module: "operations" | "mission";
  status: string;
  location: string | null;
  scopeSubgroupId: string | null;
  scopeSubgroupTitle: string | null;
  updatedAt: string;
};

type PlanningPlan = {
  id: string;
  jobId: string;
  jobTitle: string;
  jobModule: "operations" | "mission" | null;
  title: string;
  status: string;
  version: number;
  activityType: string;
  startsAt: string | null;
  endsAt: string | null;
  location: string | null;
  scopeSubgroupTitle: string | null;
  priority: string;
  requiredQualifications: string[];
  resourceCount: number;
  resourceLabels: string[];
  conflictCount: number;
  feasible: boolean;
  linkedMission: {
    id: string;
    title: string;
    status: string;
    executionStatus: string;
    routeProgress: {
      routePlanId: string;
      status: string;
      totalStops: number;
      completedStops: number;
      physicallyClosedStops: number;
      currentStopId: string | null;
      currentStopSequence: number | null;
      currentStopLabel: string | null;
      currentStopKind: string | null;
    } | null;
    version: number;
    updatedAt: string;
  } | null;
  updatedAt: string;
};

type PlanningSummary = {
  jobs?: number;
  plans?: number;
  today?: number;
  drafts?: number;
  published?: number;
  conflicted?: number;
  scopeLinked?: number;
  assignedResources?: number;
};

type PlanningPayload = {
  context?: PlanningContext;
  jobs?: PlanningJob[];
  plans?: PlanningPlan[];
  summary?: PlanningSummary;
  readback?: { status?: string; checkedAt?: string };
  error?: string;
};

type Evaluation = {
  feasible?: boolean;
  conflicts?: Array<{ code?: string; detail?: string; resourceId?: string }>;
  checkedAt?: string;
};

type SimulationState = {
  status: "idle" | "checking" | "ready" | "error";
  evaluation: Evaluation | null;
  message?: string;
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
  { id: "documents", label: "DOCUMENTI", path: "/documents", capability: "documents.read", icon: FileText },
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

function formatDay(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "short" });
}

function currentDayOverlap(startsAt: string | null, endsAt: string | null) {
  if (!startsAt || !endsAt) return false;
  const starts = Date.parse(startsAt);
  const ends = Date.parse(endsAt);
  if (!Number.isFinite(starts) || !Number.isFinite(ends)) return false;
  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  return starts < dayEnd.getTime() && ends > dayStart.getTime();
}

function localDateTime(offsetHours: number) {
  const date = new Date(Date.now() + offsetHours * 3_600_000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function moduleLabel(module: PlanningJob["module"]) {
  return module === "mission" ? "MISSIONE" : "COMMESSA";
}

function statusLabel(status: string) {
  if (status === "PUBLISHED") return "PUBBLICATO";
  if (status === "DRAFT") return "BOZZA";
  if (status === "FEASIBLE") return "VERIFICATO";
  if (status === "CONFLICTED") return "CONFLITTO";
  if (status === "GOVERNED") return "ASSISTITO";
  if (status === "MISSION_PLANNED") return "MISSIONE PIANIFICATA";
  if (status === "IN_EXECUTION") return "IN ESECUZIONE";
  if (status === "DELIVERED_AWAITING_POD") return "CONSEGNA DA VERIFICARE";
  if (status === "POD_VERIFIED") return "POD VERIFICATO";
  if (status === "RECONCILED") return "RICONCILIATA";
  if (status === "CLOSED") return "CHIUSA";
  if (status === "EXCEPTION") return "ECCEZIONE";
  return status.replaceAll("_", " ");
}

function priorityLabel(priority: string) {
  if (priority === "HIGH") return "Alta";
  if (priority === "CRITICAL") return "Critica";
  return "Standard";
}

function statusTone(status: string, feasible = true): Tone {
  if (!feasible || status === "CONFLICTED") return "red";
  if (status === "PUBLISHED" || status === "FEASIBLE") return "lime";
  if (status === "DRAFT") return "amber";
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

function PlanCard({ plan, busy, canPublish, onPublish, onOpenMission }: { plan: PlanningPlan; busy: boolean; canPublish: boolean; onPublish: () => void; onOpenMission: () => void }) {
  const canOpenMission = plan.jobModule === "operations" && plan.activityType === "TRANSPORT" && plan.status === "PUBLISHED" && (plan.feasible || Boolean(plan.linkedMission));
  return <article className="carbon-inset rounded-2xl p-4 transition hover:border-lime-300/25"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2"><span className={`size-2 rounded-full ${plan.feasible ? "bg-lime-300 shadow-[0_0_10px_rgba(200,255,34,.75)]" : "bg-rose-400 shadow-[0_0_10px_rgba(255,85,56,.6)]"}`} /><h3 className="truncate text-sm font-semibold text-slate-100">{plan.title}</h3></div><p className="mt-1 truncate text-[10px] text-slate-600">{plan.jobTitle} · aggiornato {formatDate(plan.updatedAt)}</p></div><StatusPill status={plan.status} tone={statusTone(plan.status, plan.feasible)} /></div><div className="mt-3 grid gap-2 text-[10px] text-slate-400 sm:grid-cols-3"><span><CalendarClock className="mr-1 inline size-3 text-lime-200" />{formatDate(plan.startsAt)} → {formatDate(plan.endsAt)}</span><span><Users className="mr-1 inline size-3 text-cyan-200" />{plan.resourceCount} risorse</span><span className={plan.feasible ? "text-lime-200" : "text-rose-200"}>{plan.feasible ? "VERIFICA SUPERATA" : `${plan.conflictCount} conflitti`}</span></div><div className="mt-3 flex flex-wrap items-center gap-2"><span className="rounded-full border border-white/10 px-2 py-1 text-[9px] text-slate-500">{plan.activityType === "TRANSPORT" ? "TRASPORTO" : "LAVORAZIONE"}</span><span className="rounded-full border border-white/10 px-2 py-1 text-[9px] text-slate-500">Priorità {priorityLabel(plan.priority)}</span>{plan.scopeSubgroupTitle && <span className="max-w-full truncate rounded-full border border-lime-300/15 bg-lime-300/[.04] px-2 py-1 text-[9px] text-lime-100">Scope · {plan.scopeSubgroupTitle}</span>}{plan.linkedMission && <><span className="max-w-full truncate rounded-full border border-cyan-300/20 bg-cyan-300/[.04] px-2 py-1 text-[9px] text-cyan-100">Missione · {statusLabel(plan.linkedMission.status)}</span><span className={`max-w-full truncate rounded-full border px-2 py-1 text-[9px] ${plan.linkedMission.executionStatus === "EXCEPTION" ? "border-rose-300/25 bg-rose-300/[.05] text-rose-100" : plan.linkedMission.executionStatus === "IN_EXECUTION" ? "border-lime-300/20 bg-lime-300/[.05] text-lime-100" : "border-white/10 text-slate-500"}`}>Esecuzione · {statusLabel(plan.linkedMission.executionStatus)}</span>{plan.linkedMission.routeProgress && <span className="max-w-full truncate rounded-full border border-white/10 px-2 py-1 text-[9px] text-slate-500">Tappe · {plan.linkedMission.routeProgress.completedStops}/{plan.linkedMission.routeProgress.totalStops}{plan.linkedMission.routeProgress.currentStopLabel ? ` · corrente: ${plan.linkedMission.routeProgress.currentStopLabel}` : ""}</span>}</>}</div>{plan.resourceLabels.length > 0 && <p className="mt-3 truncate text-[10px] text-slate-600">Risorse: {plan.resourceLabels.join(" · ")}</p>}{plan.requiredQualifications.length > 0 && <p className="mt-1 truncate text-[10px] text-slate-600">Qualifiche: {plan.requiredQualifications.join(" · ")}</p>}<div className="mt-4 flex flex-wrap gap-2">{plan.status === "DRAFT" && <Button className="h-9 bg-lime-300 text-[10px] font-semibold text-[#050705] hover:bg-lime-200" disabled={busy || !canPublish || !plan.feasible} onClick={onPublish}><Send className="size-3.5" />Pubblica piano</Button>}{canOpenMission && <Button className="h-9 border-cyan-300/25 bg-cyan-300/[.06] text-[10px] font-semibold text-cyan-100 hover:bg-cyan-300/10" onClick={onOpenMission}><Route className="size-3.5" />{plan.linkedMission ? "Apri missione" : "Prepara missione"}</Button>}</div></article>;
}

export default function PlanningControl() {
  const router = useRouter();
  const [payload, setPayload] = useState<PlanningPayload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [refreshing, setRefreshing] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"agenda" | "perimeters">("agenda");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "DRAFT" | "PUBLISHED" | "CONFLICT">("ALL");
  const [modal, setModal] = useState(false);
  const [title, setTitle] = useState("");
  const [activityType, setActivityType] = useState<"WORK" | "TRANSPORT">("WORK");
  const [priority, setPriority] = useState("STANDARD");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [location, setLocation] = useState("");
  const [qualifications, setQualifications] = useState("");
  const [notes, setNotes] = useState("");
  const [resourceIds, setResourceIds] = useState<string[]>([]);
  const [simulation, setSimulation] = useState<SimulationState>({ status: "idle", evaluation: null });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/planning", { cache: "no-store" });
      const next = await response.json() as PlanningPayload;
      if (!response.ok) throw new Error(next.error ?? "planning_unavailable");
      setPayload(next);
      setSelectedJobId((current) => current && next.jobs?.some((job) => job.id === current) ? current : next.jobs?.[0]?.id ?? "");
      setState("ready");
    } catch {
      setNotice("La pianificazione non è disponibile in questo momento.");
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
  const capabilities = useMemo(() => context?.capabilities ?? ["planning.read"], [context]);
  const allowedNavigation = useMemo(() => getAllowedCommandNavigation(capabilities).map((item) => item.id), [capabilities]);
  const visibleNavItems = useMemo(() => navItems.filter((item) => capabilities.includes(item.capability)), [capabilities]);
  const jobs = useMemo(() => payload?.jobs ?? [], [payload?.jobs]);
  const plans = useMemo(() => payload?.plans ?? [], [payload?.plans]);
  const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? jobs[0] ?? null;
  const selectedPlans = useMemo(() => plans.filter((plan) => plan.jobId === selectedJob?.id), [plans, selectedJob?.id]);
  const todayPlans = useMemo(() => plans.filter((plan) => currentDayOverlap(plan.startsAt, plan.endsAt)).sort((left, right) => Date.parse(left.startsAt ?? "") - Date.parse(right.startsAt ?? "")), [plans]);
  const canWritePlanning = capabilities.includes("planning.write");
  const filteredJobs = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return jobs;
    return jobs.filter((job) => [job.code, job.title, job.location, job.scopeSubgroupTitle].some((value) => value?.toLowerCase().includes(normalized)));
  }, [jobs, query]);
  const filteredPlans = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return plans.filter((plan) => {
      const searchable = `${plan.title} ${plan.jobTitle} ${plan.location ?? ""} ${plan.scopeSubgroupTitle ?? ""} ${plan.resourceLabels.join(" ")}`.toLowerCase();
      const matchesQuery = !normalized || searchable.includes(normalized);
      const matchesStatus = statusFilter === "ALL"
        || (statusFilter === "CONFLICT" && !plan.feasible)
        || (statusFilter !== "CONFLICT" && plan.status === statusFilter);
      return matchesQuery && matchesStatus;
    }).sort((left, right) => Date.parse(left.startsAt ?? "") - Date.parse(right.startsAt ?? ""));
  }, [plans, query, statusFilter]);
  const agendaPlans = useMemo(() => filteredPlans.filter((plan) => currentDayOverlap(plan.startsAt, plan.endsAt)), [filteredPlans]);

  function navigate(path: string) {
    setMobileMenu(false);
    router.push(path);
  }

  function goBack() {
    if (window.history.length > 1) router.back();
    else router.push("/command");
  }

  function openCreate() {
    if (!selectedJob) {
      setNotice("Seleziona una commessa o una missione prima di creare un piano.");
      return;
    }
    setTitle(selectedJob.module === "mission" ? "Piano missione" : "Attività della giornata");
    setActivityType(selectedJob.module === "mission" ? "TRANSPORT" : "WORK");
    setPriority("STANDARD");
    setStartsAt(localDateTime(1));
    setEndsAt(localDateTime(5));
    setLocation(selectedJob.location ?? "");
    setQualifications("");
    setNotes("");
    setResourceIds([]);
    setSimulation({ status: "idle", evaluation: null });
    setModal(true);
  }

  function requestBody(action: "draft" | "what_if") {
    return {
      action,
      title: title.trim() || "Piano operativo",
      activityType,
      priority,
      startsAt,
      endsAt,
      location: location.trim(),
      scopeSubgroupId: selectedJob?.scopeSubgroupId,
      scopeSubgroupTitle: selectedJob?.scopeSubgroupTitle,
      requiredQualifications: qualifications.split(",").map((value) => value.trim()).filter(Boolean).slice(0, 12),
      notes: notes.trim(),
      resourceIds,
      idempotencyKey: `planning-${action}-${crypto.randomUUID()}`,
    };
  }

  async function simulatePlan() {
    if (!selectedJob) return;
    setSimulation({ status: "checking", evaluation: null });
    try {
      const response = await fetch(`/api/operations/jobs/${encodeURIComponent(selectedJob.id)}/planning`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody("what_if")),
      });
      const result = await response.json() as { error?: string; detail?: string; evaluation?: Evaluation };
      if (!response.ok) throw new Error(result.detail ?? result.evaluation?.conflicts?.[0]?.detail ?? result.error ?? "planning_check_failed");
      setSimulation({ status: "ready", evaluation: result.evaluation ?? null, message: result.evaluation?.feasible ? "Finestra e risorse compatibili." : "La proposta presenta conflitti." });
    } catch {
      setSimulation({ status: "error", evaluation: null, message: "Verifica non disponibile. Riprova." });
    }
  }

  async function createPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedJob) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(`/api/operations/jobs/${encodeURIComponent(selectedJob.id)}/planning`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody("draft")),
      });
      const result = await response.json() as { error?: string; detail?: string; evaluation?: Evaluation };
      if (!response.ok) throw new Error(result.detail ?? result.evaluation?.conflicts?.[0]?.detail ?? "planning_write_failed");
      setModal(false);
      setNotice("Piano salvato come bozza. Pubblicalo dopo aver verificato le risorse.");
      await refresh();
    } catch {
      setNotice("Piano non salvato. Controlla i dati e riprova.");
    } finally {
      setBusy(false);
    }
  }

  async function publishPlan(plan: PlanningPlan) {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(`/api/operations/jobs/${encodeURIComponent(plan.jobId)}/planning`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "publish", recordId: plan.id, expectedVersion: plan.version, idempotencyKey: `planning-publish-${crypto.randomUUID()}` }),
      });
      const result = await response.json() as { error?: string; detail?: string; evaluation?: Evaluation };
      if (!response.ok) throw new Error(result.detail ?? result.evaluation?.conflicts?.[0]?.detail ?? "planning_publish_failed");
      setNotice("Piano pubblicato dopo la verifica di disponibilità.");
      await refresh();
    } catch {
      setNotice("Pubblicazione non completata. Controlla le risorse e riprova.");
    } finally {
      setBusy(false);
    }
  }

  function openMissionFromPlan(plan: PlanningPlan) {
    const query = plan.linkedMission
      ? `missionId=${encodeURIComponent(plan.linkedMission.id)}`
      : `planId=${encodeURIComponent(plan.id)}&jobId=${encodeURIComponent(plan.jobId)}`;
    router.push(`/mission?${query}`);
  }

  if (state === "loading" && !payload) return <main className="grid min-h-screen place-items-center bg-[#030504] text-xs text-slate-500"><LoaderCircle className="mr-2 inline size-4 animate-spin text-lime-300" />Caricamento pianificazione…</main>;
  if (state === "error" && !payload) return <main className="grid min-h-screen place-items-center bg-[#030504]"><div className="carbon-card rounded-2xl p-6 text-center"><CircleAlert className="mx-auto size-7 text-amber-200" /><p className="mt-3 text-sm text-slate-300">Pianificazione non disponibile</p><Button className="mt-4 bg-lime-300 text-[#050705] hover:bg-lime-200" onClick={() => void refresh()}><RefreshCw className="size-4" />Riprova</Button></div></main>;

  const summary = payload?.summary ?? {};
  const actor = { email: context?.actorEmail ?? "operator@zerow.local", name: context?.actorName ?? "Operatore" };

  return <main className="zw-app-shell zw-planning-module min-h-screen overflow-x-hidden text-slate-100 selection:bg-lime-300 selection:text-[#060806]"><div className="zw-command-ambient" aria-hidden="true" /><div className="relative flex min-h-screen">
    <aside aria-label="Navigazione principale" className={`zw-command-sidebar fixed inset-y-0 left-0 z-40 flex flex-col px-3 py-4 transition-[width,transform] lg:static lg:translate-x-0 ${sidebarCollapsed ? "is-collapsed lg:w-[76px]" : "lg:w-[248px]"} ${mobileMenu ? "translate-x-0" : "-translate-x-full"}`}>
      <div className="flex items-center justify-between px-2"><button aria-label="Apri Command" className="flex min-w-0 items-center gap-3 text-left" onClick={() => navigate("/command")} type="button"><span className="neon-pulse relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black"><Image src="/ai-zerow-icon.jpeg" alt="AI-ZEROW" width={40} height={40} className="size-full object-cover" /></span><span className="zw-command-sidebar__brand-copy min-w-0"><span className="block text-sm font-bold tracking-[.18em] text-slate-50">AI-ZEROW</span><span className="block text-[10px] uppercase tracking-[.22em] text-lime-300/75">command</span></span></button><div className="flex items-center gap-1"><IconButton label={sidebarCollapsed ? "Espandi sidebar" : "Riduci sidebar"} className="hidden lg:grid" onClick={() => setSidebarCollapsed((value) => !value)}>{sidebarCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}</IconButton><IconButton label="Chiudi menu" className="lg:hidden" onClick={() => setMobileMenu(false)}><X className="size-4" /></IconButton></div></div>
      <div className="zw-command-tenant mt-7 flex items-center gap-3 rounded-2xl p-3"><span className="grid size-9 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/10 text-lime-200"><HardHat className="size-4" /></span><span className="zw-command-sidebar__tenant-copy min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-slate-200">ZEROW workspace</span><span className="mt-0.5 block truncate text-[10px] uppercase tracking-[.1em] text-slate-600">{roleLabel(context?.role ?? "planning")} · profilo operativo</span></span></div>
      <nav className="mt-6 min-h-0 flex-1 overflow-y-auto" aria-label="Navigazione principale"><p className="zw-command-sidebar__nav-caption px-3 text-[9px] font-semibold uppercase tracking-[.22em] text-slate-700">Area autorizzata</p><div className="mt-2 space-y-1">{visibleNavItems.map((item) => { const Icon = item.icon; const active = item.id === "planning"; return <button aria-current={active ? "page" : undefined} aria-label={sidebarCollapsed ? item.label : undefined} className={`zw-command-nav-item ${active ? "is-active" : ""}`} key={item.id} onClick={() => navigate(item.path)} type="button"><Icon className="size-4" /><span className="zw-command-sidebar__nav-label">{item.label}</span></button>; })}</div></nav>
      <div className="zw-command-sidebar__footer mt-4 border-t border-white/[.07] pt-4"><div className="flex items-center justify-between px-2 text-[9px] uppercase tracking-[.14em] text-slate-600"><span>Sistema</span><span className="flex items-center gap-1.5 text-lime-200"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_10px_rgba(200,255,34,.9)]" />{payload?.readback?.status === "verified" ? "DATI AGGIORNATI" : "AGGIORNAMENTO"}</span></div><div className="zw-command-core-status mt-3 rounded-xl p-3"><p className="font-mono text-[9px] text-slate-500">{plans.length} PIANI</p><p className="mt-2 font-mono text-[9px] text-lime-300/60">PROFILO / {roleLabel(context?.role ?? "planning").toUpperCase()}</p></div></div>
    </aside>
    {mobileMenu ? <button aria-label="Chiudi menu" className="zw-command-sidebar-backdrop fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm lg:hidden" onClick={() => setMobileMenu(false)} type="button" /> : null}
    <section className="min-w-0 flex-1"><header className="zw-command-topbar sticky top-0 z-20 flex h-[72px] items-center gap-3 px-4 sm:gap-5 sm:px-7"><IconButton className="lg:hidden" label="Apri menu" onClick={() => setMobileMenu(true)}><Menu className="size-4" /></IconButton><button aria-label="Apri Pianificazione" className="zw-command-topbar__brand flex shrink-0 items-center gap-2 text-left" onClick={() => navigate("/planning")} type="button"><span className="relative grid size-9 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black shadow-[0_0_18px_rgba(200,255,34,.12)]"><Image src="/ai-zerow-icon.jpeg" alt="ZEROW" width={36} height={36} className="size-full object-cover" /></span><span className="zw-command-topbar__wordmark hidden sm:block"><span className="block text-[11px] font-bold tracking-[.18em] text-slate-50">ZEROW</span><span className="block text-[9px] uppercase tracking-[.2em] text-lime-300/75">planning</span></span></button><IconButton className="hidden lg:grid" label={sidebarCollapsed ? "Espandi sidebar" : "Riduci sidebar"} onClick={() => setSidebarCollapsed((value) => !value)}>{sidebarCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}</IconButton><div className="relative hidden min-w-0 flex-1 justify-center md:flex"><div className="relative w-full max-w-[520px]"><Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-600" /><Input aria-label="Cerca nella pianificazione" className="h-10 w-full border-lime-300/10 bg-black/35 pl-10 text-xs text-slate-100 placeholder:text-slate-600" onChange={(event) => setQuery(event.target.value)} placeholder="Cerca commesse, scope, attività, risorse…" value={query} /></div></div><div className="flex min-w-0 flex-1 items-center gap-2 md:hidden"><span className="truncate text-xs font-semibold tracking-[.14em] text-slate-200">PIANIFICAZIONE</span><span className="size-1 rounded-full bg-lime-300" /></div><div className="ml-auto flex min-w-0 items-center gap-2"><TenantSwitcher /><span className="hidden items-center gap-2 rounded-full border border-lime-300/20 bg-lime-300/5 px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[.12em] text-lime-200 sm:flex"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_9px_rgba(200,255,34,.9)]" />{refreshing ? "AGGIORNAMENTO" : "DATI AGGIORNATI"}</span><IconButton className="zw-command-topbar__back" label="Torna indietro" onClick={goBack}><ArrowLeft className="size-4" /></IconButton><IconButton className="zw-command-topbar__refresh" label="Aggiorna Pianificazione" onClick={() => void refresh()}><RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} /></IconButton>{capabilities.includes("communication.read") ? <IconButton className="zw-command-topbar__notifications" label="Apri comunicazioni" onClick={() => navigate("/communications")}><Bell className="size-4" /></IconButton> : null}<AccountMenu actor={actor} /></div></header>
      <div className="mx-auto max-w-[1920px] px-4 py-5 sm:px-7 sm:py-7"><div className="mb-5 flex flex-wrap items-end justify-between gap-4"><div><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.2em] text-lime-300/70"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_9px_rgba(190,255,60,.9)]" />AI-ZEROW / PLANNING</div><h1 className="mt-2 text-2xl font-semibold tracking-[-.04em] text-slate-50 sm:text-[28px]">Pianificazione</h1><p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">Attività giornaliere, finestre operative e risorse reali · {payload?.readback?.status === "verified" ? "dati operativi aggiornati" : "aggiornamento in corso"}</p></div><div className="flex flex-wrap items-center gap-2"><Button className="h-10 rounded-xl border-lime-100/55 px-4 text-xs shadow-[0_0_30px_rgba(190,255,60,.18)]" disabled={!selectedJob || !canWritePlanning} onClick={openCreate}><Target className="size-4" />Nuova attività</Button><Button className="h-10 rounded-xl border-white/10 bg-black/25 px-4 text-xs text-slate-300 hover:border-cyan-300/30 hover:bg-cyan-300/10 hover:text-cyan-100" onClick={() => navigate("/presenze")} variant="outline"><ClipboardCheck className="size-4" />Presenze</Button></div></div>
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><KpiCard label="Perimetri" value={summary.jobs ?? jobs.length} detail="COMMESSE + MISSIONI" icon={ClipboardList} tone="cyan" /><KpiCard label="In agenda oggi" value={summary.today ?? todayPlans.length} detail="FINESTRE ATTIVE" icon={CalendarClock} tone="lime" /><KpiCard label="Pubblicati" value={summary.published ?? 0} detail="ESEGUIBILI" icon={CheckCircle2} tone="lime" /><KpiCard label="Conflitti" value={summary.conflicted ?? 0} detail="DA RISOLVERE" icon={CircleAlert} tone={(summary.conflicted ?? 0) > 0 ? "red" : "cyan"} /></section>
        <section className="mt-4 carbon-card rounded-2xl p-3 sm:p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><Route className="size-4 text-lime-200" /><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">AGENDA / CONTROLLO OPERATIVO</p><p className="mt-1 text-[11px] text-slate-500">{summary.scopeLinked ?? 0} piani collegati allo scope · {summary.assignedResources ?? 0} assegnazioni verificate</p></div></div><div className="flex items-center gap-1 rounded-xl border border-white/[.08] bg-black/20 p-1"><button className={`rounded-lg px-3 py-2 text-[10px] font-semibold transition ${view === "agenda" ? "bg-lime-300 text-[#050705]" : "text-slate-500 hover:text-slate-200"}`} onClick={() => setView("agenda")} type="button"><CalendarClock className="mr-1 inline size-3.5" />Agenda</button><button className={`rounded-lg px-3 py-2 text-[10px] font-semibold transition ${view === "perimeters" ? "bg-lime-300 text-[#050705]" : "text-slate-500 hover:text-slate-200"}`} onClick={() => setView("perimeters")} type="button"><BriefcaseBusiness className="mr-1 inline size-3.5" />Commesse</button></div></div><div className="mt-3 flex flex-wrap gap-2"><label className="relative min-w-[230px] flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-600" /><Input aria-label="Filtra pianificazione" className="h-9 border-white/10 bg-black/25 pl-9 text-[10px]" onChange={(event) => setQuery(event.target.value)} placeholder="Cerca attività, commesse, risorse…" value={query} /></label><select aria-label="Filtra stato piani" className="h-9 rounded-xl border border-white/10 bg-black/25 px-3 text-[10px] text-slate-300 outline-none focus:border-lime-300/40" onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} value={statusFilter}><option className="bg-[#080c09]" value="ALL">Tutti gli stati</option><option className="bg-[#080c09]" value="DRAFT">Bozze</option><option className="bg-[#080c09]" value="PUBLISHED">Pubblicati</option><option className="bg-[#080c09]" value="CONFLICT">Conflitti</option></select><Button className="h-9 border-white/10 bg-black/20 text-[10px] text-slate-300 hover:border-lime-300/30 hover:bg-lime-300/10 hover:text-lime-100" onClick={() => { setStatusFilter("ALL"); setQuery(""); }} variant="outline"><RefreshCw className="size-3.5" />Reset filtri</Button></div></section>
        {view === "agenda" ? <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.22fr)_minmax(320px,.78fr)]"><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-lime-300/70">AGENDA OPERATIVA</p><h2 className="mt-1 text-lg font-semibold text-slate-100">Oggi in esecuzione</h2><p className="mt-1 text-[11px] text-slate-500">Finestre pubblicate e bozze del perimetro autorizzato.</p></div><span className="rounded-full border border-lime-300/20 bg-lime-300/[.06] px-2.5 py-1 font-mono text-[9px] text-lime-100">{todayPlans.length} FINESTRE</span></div><div className="mt-4 space-y-3">{agendaPlans.map((plan) => <PlanCard busy={busy} canPublish={canWritePlanning} key={plan.id} onOpenMission={() => openMissionFromPlan(plan)} onPublish={() => void publishPlan(plan)} plan={plan} />)}{agendaPlans.length === 0 && <div className="rounded-2xl border border-dashed border-lime-300/15 bg-black/15 p-10 text-center"><CalendarClock className="mx-auto size-8 text-slate-700" /><p className="mt-3 text-sm font-medium text-slate-300">Nessuna attività in agenda oggi</p><p className="mt-1 text-[11px] text-slate-600">Seleziona una commessa e crea la prima finestra operativa.</p><Button className="mt-4 bg-lime-300 text-[10px] font-semibold text-[#050705] hover:bg-lime-200" disabled={!selectedJob || !canWritePlanning} onClick={openCreate}><Target className="size-3.5" />Pianifica attività</Button></div>}</div></section><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-cyan-200/70">COMMESSA ATTIVA</p><h2 className="mt-1 text-lg font-semibold text-slate-100">{selectedJob?.title ?? "Nessuna commessa"}</h2><p className="mt-1 text-[10px] text-slate-500">{selectedJob?.code ?? "—"} · {selectedJob?.location ?? "Sede da definire"}</p></div>{selectedJob && <StatusPill status={moduleLabel(selectedJob.module)} tone={selectedJob.module === "mission" ? "cyan" : "lime"} />}</div>{selectedJob ? <><div className="mt-4 grid gap-2 sm:grid-cols-2"><div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">Scope</p><p className="mt-2 truncate text-[11px] text-slate-200">{selectedJob.scopeSubgroupTitle ?? "Sottogruppo non valorizzato"}</p></div><div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">Stato</p><p className="mt-2 text-[11px] text-lime-100">{statusLabel(selectedJob.status)}</p></div></div><div className="mt-4 flex items-center justify-between gap-2"><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-slate-600">Piani collegati · {selectedPlans.length}</p><button className="text-[10px] text-lime-200 hover:text-lime-100" onClick={() => setView("perimeters")} type="button">Apri dettaglio <ArrowUpRight className="ml-1 inline size-3" /></button></div><div className="mt-2 space-y-2">{selectedPlans.slice(0, 3).map((plan) => <div className="flex items-center gap-3 rounded-xl border border-white/[.07] bg-black/20 px-3 py-2.5" key={plan.id}><span className={`size-2 rounded-full ${plan.feasible ? "bg-lime-300" : "bg-rose-400"}`} /><div className="min-w-0 flex-1"><p className="truncate text-[11px] text-slate-200">{plan.title}</p><p className="mt-1 truncate text-[9px] text-slate-600">{formatDay(plan.startsAt)} · {formatDate(plan.startsAt)}</p></div><StatusPill status={plan.status} tone={statusTone(plan.status, plan.feasible)} /></div>)}{selectedPlans.length === 0 && <p className="rounded-xl border border-dashed border-white/10 p-4 text-center text-[10px] text-slate-600">Nessun piano collegato.</p>}</div><Button className="mt-4 h-9 w-full bg-lime-300 text-[10px] font-semibold text-[#050705] hover:bg-lime-200" disabled={!canWritePlanning} onClick={openCreate}><Target className="size-3.5" />Aggiungi attività</Button></> : <div className="mt-6 rounded-xl border border-dashed border-white/10 p-6 text-center text-[10px] text-slate-600">Nessuna commessa o missione disponibile nel ruolo corrente.</div>}</section></section> : <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(300px,.74fr)_minmax(0,1.26fr)]"><aside className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-center justify-between gap-2"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">REGISTRO OPERATIVO</p><h2 className="mt-1 text-sm font-semibold text-slate-100">Commesse pianificabili</h2></div><span className="font-mono text-[9px] text-slate-600">{filteredJobs.length} ELEMENTI</span></div><div className="mt-3 space-y-2">{filteredJobs.map((job) => <button className={`w-full rounded-xl border p-3 text-left transition ${job.id === selectedJob?.id ? "border-lime-300/40 bg-lime-300/[.08] shadow-[0_0_24px_rgba(200,255,34,.08)]" : "border-white/[.08] bg-black/20 hover:border-lime-300/25"}`} key={job.id} onClick={() => setSelectedJobId(job.id)} type="button"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-[11px] font-semibold text-slate-100">{job.code ? `${job.code} · ` : ""}{job.title}</p><p className="mt-1 truncate text-[9px] text-slate-600">{job.location || "Sede da definire"}</p></div><span className={`shrink-0 rounded-full border px-2 py-1 text-[8px] font-semibold ${job.module === "mission" ? "border-cyan-300/20 bg-cyan-300/[.05] text-cyan-100" : "border-lime-300/15 bg-lime-300/[.04] text-lime-100"}`}>{moduleLabel(job.module)}</span></div><div className="mt-2 flex flex-wrap items-center gap-2 text-[9px] text-slate-600"><span>{statusLabel(job.status)}</span>{job.scopeSubgroupTitle && <><span>·</span><span className="truncate">{job.scopeSubgroupTitle}</span></>}</div></button>)}{filteredJobs.length === 0 && <div className="rounded-xl border border-dashed border-lime-300/10 p-5 text-center text-[10px] text-slate-600">Nessuna commessa disponibile.</div>}</div></aside><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">PIANO SELEZIONATO</p><h2 className="mt-1 text-lg font-semibold text-slate-100">{selectedJob?.title ?? "Seleziona una commessa"}</h2><p className="mt-1 text-[10px] text-slate-500">{selectedJob?.scopeSubgroupTitle ? `Scope: ${selectedJob.scopeSubgroupTitle}` : "La pianificazione resta collegata alla scheda della commessa."}</p></div>{selectedJob && <Button className="h-9 bg-lime-300 text-[10px] font-semibold text-[#050705] hover:bg-lime-200" disabled={!canWritePlanning} onClick={openCreate}><Target className="size-3.5" />Nuova attività</Button>}</div>{selectedJob && <div className="mt-4 space-y-3">{selectedPlans.filter((plan) => statusFilter === "ALL" || (statusFilter === "CONFLICT" ? !plan.feasible : plan.status === statusFilter)).map((plan) => <PlanCard busy={busy} canPublish={canWritePlanning} key={plan.id} onOpenMission={() => openMissionFromPlan(plan)} onPublish={() => void publishPlan(plan)} plan={plan} />)}{selectedPlans.length === 0 && <div className="rounded-2xl border border-dashed border-lime-300/15 p-10 text-center"><CalendarClock className="mx-auto size-8 text-slate-700" /><p className="mt-3 text-sm text-slate-300">Nessun piano per questa commessa</p><p className="mt-1 text-[11px] text-slate-600">La prima attività deve usare risorse reali e uno scope già presente.</p></div>}</div>}</section></section>}
        <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,.9fr)]"><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-2xl border border-lime-300/25 bg-lime-300/10 text-lime-200"><Route className="size-5" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-lime-300/70">REGOLE DI PIANIFICAZIONE</p><h2 className="mt-1 text-[17px] font-semibold text-slate-100">Dalla commessa all’esecuzione</h2><p className="mt-2 text-[11px] leading-5 text-slate-500">Ogni piano segue lo stesso percorso e utilizza solo risorse realmente disponibili.</p></div></div><div className="mt-5 grid gap-2 sm:grid-cols-4">{[{ label: "PERIMETRO", value: "Sottogruppo" }, { label: "FINESTRA", value: "Orario" }, { label: "RISORSE", value: "Disponibilità" }, { label: "STATO", value: "Pubblicato" }].map((step, index) => <div className="carbon-inset rounded-xl p-3" key={step.label}><div className="flex items-center gap-2"><span className="grid size-5 place-items-center rounded-full border border-lime-300/25 text-[9px] text-lime-200">{index + 1}</span><p className="text-[9px] font-semibold tracking-[.14em] text-slate-600">{step.label}</p></div><p className="mt-3 text-xs text-slate-200">{step.value}</p></div>)}</div></section><section className="carbon-card-neon rounded-2xl p-4 sm:p-5"><div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-2xl border border-cyan-300/25 bg-cyan-300/10 text-cyan-200"><Sparkles className="size-5" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-cyan-200/70">COMPANY AI / PLANNING</p><h2 className="mt-1 text-[17px] font-semibold text-slate-100">Controllo capacità</h2></div><StatusPill status="GOVERNED" tone="cyan" /></div><p className="mt-3 text-[11px] leading-5 text-slate-500">Company AI può analizzare copertura e conflitti, mentre la conferma resta in capo a Planning e all’operatore.</p><div className="mt-4 space-y-2"><button className="flex w-full items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-left text-[11px] text-slate-400 transition hover:border-lime-300/30 hover:text-lime-100" onClick={() => navigate("/command?prompt=Analizza%20copertura%20pianificazione")} type="button"><ChevronRight className="size-3.5 text-lime-300" />Analizza copertura pianificazione</button><button className="flex w-full items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-left text-[11px] text-slate-400 transition hover:border-lime-300/30 hover:text-lime-100" onClick={() => navigate("/command?prompt=Trova%20conflitti%20di%20pianificazione")} type="button"><ChevronRight className="size-3.5 text-lime-300" />Trova conflitti di pianificazione</button></div></section></section>
        <section className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-cyan-300/15 bg-cyan-300/[.03] px-4 py-3 text-[10px] text-slate-500"><span className="flex items-center gap-2"><ShieldCheck className="size-3.5 shrink-0 text-cyan-200" />Accesso autorizzato · risorse registrate · disponibilità verificata</span><span className="flex items-center gap-2"><button className="text-lime-200 hover:text-lime-100" onClick={() => navigate("/workforce")} type="button">Registro risorse <ArrowUpRight className="ml-1 inline size-3" /></button><span>·</span><button className="text-lime-200 hover:text-lime-100" onClick={() => navigate("/mission")} type="button">Trasporti <ArrowUpRight className="ml-1 inline size-3" /></button></span></section>
        <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/[.07] py-5 text-[10px] text-slate-700"><span>AI-ZEROW COMMAND · pianificazione operativa</span><span className="flex items-center gap-2"><span>ultra carbon core</span><span className="size-1 rounded-full bg-lime-300" /><span>accesso personalizzato</span></span></footer>
      </div>
    </section>
  </div><CommandMobileNav active="more" allowedNavigation={allowedNavigation} role={context?.role} roles={context?.roles} />{notice && <button className="fixed bottom-5 left-1/2 z-[100] flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-2 rounded-xl border border-lime-300/25 bg-[#080d09]/96 px-4 py-3 text-left text-xs text-lime-100 shadow-[0_0_34px_rgba(200,255,34,.16)] backdrop-blur-xl" onClick={() => setNotice("")} type="button"><CircleAlert className="size-4 shrink-0 text-amber-200" />{notice}</button>}
    <Dialog open={modal} onOpenChange={setModal}><DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto border-lime-300/20 bg-[#080c09] text-slate-100 sm:max-w-[780px]"><DialogHeader><DialogTitle>Nuova attività pianificata</DialogTitle><DialogDescription className="text-slate-500">{selectedJob?.title ?? "Perimetro selezionato"} · scope, finestra e risorse vengono controllati prima della pubblicazione.</DialogDescription></DialogHeader><form className="grid gap-4 sm:grid-cols-2" onSubmit={createPlan}><div className="sm:col-span-2 rounded-xl border border-lime-300/15 bg-lime-300/[.035] p-3"><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.16em] text-lime-300/80"><Target className="size-3.5" />Perimetro bloccato</div><p className="mt-2 text-sm text-slate-200">{selectedJob?.code ? `${selectedJob.code} · ` : ""}{selectedJob?.title ?? "—"}</p><p className="mt-1 text-[10px] text-slate-500">Scope: {selectedJob?.scopeSubgroupTitle ?? "sottogruppo non valorizzato"}</p></div><label className="text-xs text-slate-400 sm:col-span-2">Titolo attività<Input className="mt-2 border-white/10 bg-black/30" onChange={(event) => setTitle(event.target.value)} value={title} required /></label><label className="text-xs text-slate-400">Tipo attività<select aria-label="Tipo attività" className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-slate-100 outline-none focus:border-lime-300/40" onChange={(event) => setActivityType(event.target.value as "WORK" | "TRANSPORT")} value={activityType}><option className="bg-[#080c09]" value="WORK">Lavorazione commessa</option><option className="bg-[#080c09]" value="TRANSPORT">Trasporto / missione</option></select></label><label className="text-xs text-slate-400">Priorità<select aria-label="Priorità" className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-slate-100 outline-none focus:border-lime-300/40" onChange={(event) => setPriority(event.target.value)} value={priority}><option className="bg-[#080c09]" value="STANDARD">Standard</option><option className="bg-[#080c09]" value="HIGH">Alta</option><option className="bg-[#080c09]" value="CRITICAL">Critica</option></select></label><label className="text-xs text-slate-400">Inizio<Input className="mt-2 border-white/10 bg-black/30" onChange={(event) => setStartsAt(event.target.value)} type="datetime-local" value={startsAt} required /></label><label className="text-xs text-slate-400">Fine<Input className="mt-2 border-white/10 bg-black/30" onChange={(event) => setEndsAt(event.target.value)} type="datetime-local" value={endsAt} required /></label><label className="text-xs text-slate-400 sm:col-span-2">Luogo operativo<Input className="mt-2 border-white/10 bg-black/30" onChange={(event) => setLocation(event.target.value)} placeholder="Cantiere, sede o tratta" value={location} /></label><div className="sm:col-span-2"><PlanningResourceFields jobId={selectedJob?.id ?? ""} startsAt={startsAt} endsAt={endsAt} selectedIds={resourceIds} onChange={setResourceIds} /></div><label className="text-xs text-slate-400 sm:col-span-2">Qualifiche richieste <span className="text-slate-600">(separate da virgola)</span><Input className="mt-2 border-white/10 bg-black/30" onChange={(event) => setQualifications(event.target.value)} placeholder="Patentino, PES-PAV, ADR…" value={qualifications} /></label><label className="text-xs text-slate-400 sm:col-span-2">Note operative<Textarea className="mt-2 min-h-20 border-white/10 bg-black/30" onChange={(event) => setNotes(event.target.value)} value={notes} /></label><div className="sm:col-span-2 rounded-xl border border-cyan-300/15 bg-cyan-300/[.03] p-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-cyan-200/80">VERIFICA PRIMA DI SALVARE</p><p className="mt-1 text-[10px] text-slate-500">Simula capacità, qualifiche, indisponibilità e sovrapposizioni senza persistenza.</p></div><Button className="h-9 border-cyan-300/25 bg-cyan-300/[.08] text-[10px] text-cyan-100 hover:bg-cyan-300/[.14]" disabled={simulation.status === "checking" || !resourceIds.length || !startsAt || !endsAt} onClick={() => void simulatePlan()} type="button">{simulation.status === "checking" ? <LoaderCircle className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}Verifica capacità</Button></div>{simulation.status === "ready" && <div className={`mt-3 rounded-lg border px-3 py-2 text-[10px] ${simulation.evaluation?.feasible ? "border-lime-300/20 bg-lime-300/[.05] text-lime-100" : "border-rose-300/25 bg-rose-300/[.05] text-rose-100"}`}><span className="font-semibold">{simulation.evaluation?.feasible ? "Verifica superata" : "Conflitti rilevati"}</span>{simulation.evaluation?.conflicts?.slice(0, 3).map((conflict, index) => <p className="mt-1 text-slate-400" key={`${conflict.code ?? "conflict"}-${index}`}>{conflict.detail ?? conflict.code}</p>)}</div>}{simulation.status === "error" && <p className="mt-3 text-[10px] text-amber-200">{simulation.message}</p>}</div><DialogFooter className="sm:col-span-2"><DialogClose asChild><Button type="button" variant="outline" className="border-white/10 bg-transparent text-slate-400"><X className="size-3.5" />Annulla</Button></DialogClose><Button disabled={busy || !resourceIds.length || !canWritePlanning} type="submit" className="bg-lime-300 text-[#050705] hover:bg-lime-200">{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}Salva bozza</Button></DialogFooter></form></DialogContent></Dialog>
  </main>;
}
