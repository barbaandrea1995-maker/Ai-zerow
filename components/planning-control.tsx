"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  Bell,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  ListFilter,
  LoaderCircle,
  MapPin,
  Menu,
  RefreshCw,
  Route,
  Search,
  Send,
  ShieldCheck,
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
import { getAllowedCommandNavigation } from "@/lib/command-dashboard";
import { missionExceptionLabel } from "@/lib/mission-exception-contract";

type Tone = "lime" | "cyan" | "amber" | "red";
type PlanningView = "today" | "plans" | "perimeters";
type StatusFilter = "ALL" | "DRAFT" | "PUBLISHED" | "ATTENTION";

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
  planningEligible: boolean;
  planningBlockedReason: string | null;
  updatedAt: string;
};

type PlanningMissionSchedule = {
  status: string;
  toleranceMinutes: number;
  plannedStartAt: string | null;
  plannedEndAt: string | null;
  planningWindow: { startsAt: string | null; endsAt: string | null };
  missionWindow: { startsAt: string | null; endsAt: string | null };
  windowAlignment: string;
  actualStartAt: string | null;
  actualEndAt: string | null;
  startDeltaMinutes: number | null;
  endDeltaMinutes: number | null;
  checkedAt: string;
};

type PlanningMissionException = {
  type: string;
  note: string;
  reference: string | null;
  stopId: string | null;
  reportedAt: string;
  reportedBy: string;
  recoveryStatus: "OPEN" | "RESOLVED";
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
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
  conflictDetails: string[];
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
    schedule: PlanningMissionSchedule;
    exception: PlanningMissionException | null;
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
  linkedMissions?: number;
  exceptionsOpen?: number;
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

const toneStyles: Record<Tone, { icon: string; badge: string; border: string }> = {
  lime: {
    icon: "text-lime-200",
    badge: "border-lime-300/25 bg-lime-300/[.08] text-lime-100",
    border: "border-lime-300/20 bg-lime-300/[.05] text-lime-100",
  },
  cyan: {
    icon: "text-cyan-200",
    badge: "border-cyan-300/25 bg-cyan-300/[.08] text-cyan-100",
    border: "border-cyan-300/20 bg-cyan-300/[.05] text-cyan-100",
  },
  amber: {
    icon: "text-amber-200",
    badge: "border-amber-300/25 bg-amber-300/[.08] text-amber-100",
    border: "border-amber-300/20 bg-amber-300/[.05] text-amber-100",
  },
  red: {
    icon: "text-rose-200",
    badge: "border-rose-300/25 bg-rose-300/[.08] text-rose-100",
    border: "border-rose-300/20 bg-rose-300/[.05] text-rose-100",
  },
};

function formatDate(value: string | null) {
  if (!value) return "Da definire";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Da definire"
    : date.toLocaleString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function formatDay(value: string | null) {
  if (!value) return "Data da definire";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Data da definire"
    : date.toLocaleDateString("it-IT", { weekday: "long", day: "2-digit", month: "long" });
}

function currentDayOverlap(startsAt: string | null, endsAt: string | null) {
  if (!startsAt || !endsAt) return false;
  const starts = Date.parse(startsAt);
  const ends = Date.parse(endsAt);
  if (!Number.isFinite(starts) || !Number.isFinite(ends) || ends <= starts) return false;
  const dayStart = new Date();
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

function moduleLabel(module: PlanningJob["module"] | PlanningPlan["jobModule"]) {
  if (!module) return "Perimetro";
  return module === "mission" ? "Missione" : "Commessa";
}

function activityLabel(activityType: string) {
  return activityType === "TRANSPORT" ? "Trasporto" : "Lavorazione";
}

function priorityLabel(priority: string) {
  if (priority === "CRITICAL") return "Critica";
  if (priority === "HIGH") return "Alta";
  return "Standard";
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    PUBLISHED: "Pubblicato",
    DRAFT: "Bozza",
    FEASIBLE: "Verificato",
    CONFLICTED: "Conflitto",
    GOVERNED: "Assistito",
    MISSION_PLANNED: "Missione pianificata",
    IN_EXECUTION: "In esecuzione",
    DELIVERED_AWAITING_POD: "Consegna da verificare",
    POD_VERIFIED: "POD verificato",
    RECONCILED: "Riconciliata",
    CLOSED: "Chiusa",
    EXCEPTION: "Eccezione",
    NOT_SCHEDULED: "Finestra da definire",
    SCHEDULED: "Programmata",
    IN_PROGRESS: "In corso",
    STARTED_LATE: "Partita in ritardo",
    COMPLETED: "Completata",
    COMPLETED_LATE: "Chiusa in ritardo",
    OVERDUE: "Oltre finestra",
    ACTIVE: "Attiva",
    OPEN: "Aperta",
  };
  return labels[status] ?? status.replaceAll("_", " ").toLowerCase();
}

function statusTone(status: string, feasible = true): Tone {
  if (!feasible || status === "CONFLICTED" || status === "EXCEPTION") return "red";
  if (status === "PUBLISHED" || status === "FEASIBLE" || status === "COMPLETED") return "lime";
  if (status === "DRAFT" || status === "STARTED_LATE" || status === "OVERDUE") return "amber";
  return "cyan";
}

function scheduleDeltaLabel(schedule: PlanningMissionSchedule) {
  const delta = schedule.endDeltaMinutes ?? schedule.startDeltaMinutes;
  if (delta === null || delta === 0) return "";
  return ` · ${delta > 0 ? "+" : ""}${delta} min`;
}

function planningErrorMessage(code?: string, detail?: string) {
  if (code === "planning_resource_ids_required") return "Seleziona almeno una persona, squadra, mezzo o asset.";
  if (code === "planning_resource_not_found") return "Una risorsa selezionata non appartiene più al registro aziendale.";
  if (code === "planning_resource_unavailable") return detail ? `${detail} non è disponibile nella finestra scelta.` : "Una risorsa non è disponibile nella finestra scelta.";
  if (code === "planning_conflicts") return "La proposta contiene sovrapposizioni o requisiti non soddisfatti.";
  if (code === "planning_job_not_active") return "Il perimetro è completato, chiuso o annullato e resta disponibile solo per consultazione.";
  if (code === "workforce_registry_access_required") return "Il tuo ruolo non può assegnare persone dal registro aziendale.";
  if (code === "asset_registry_access_required") return "Il tuo ruolo non può assegnare mezzi o attrezzature.";
  if (code === "valid_resources_and_slots_required") return "Controlla orari e risorse prima di salvare.";
  if (code === "version_conflict") return "Il piano è stato aggiornato da un altro operatore. Aggiorna i dati e riprova.";
  if (detail && !detail.includes("_")) return detail;
  return "Operazione non completata. Controlla i dati e riprova.";
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
  return <button aria-label={label} className={`grid size-9 place-items-center rounded-lg border border-white/10 bg-black/20 text-slate-500 transition hover:border-lime-300/35 hover:bg-lime-300/10 hover:text-lime-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300 ${className}`} onClick={onClick} type="button">{children}</button>;
}

function StatusPill({ status, tone = statusTone(status) }: { status: string; tone?: Tone }) {
  return <span className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[.08em] ${toneStyles[tone].badge}`}><span className="size-1.5 rounded-full bg-current shadow-[0_0_8px_currentColor]" />{statusLabel(status)}</span>;
}

function Metric({
  label,
  value,
  detail,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  detail: string;
  icon: LucideIcon;
  tone: Tone;
}) {
  return <article className="carbon-card rounded-2xl p-4"><div className="flex items-center justify-between gap-3"><span className={`grid size-9 place-items-center rounded-xl border border-current/20 bg-current/[.07] ${toneStyles[tone].icon}`}><Icon className="size-4" /></span><span className="font-mono text-2xl font-semibold tracking-[-.06em] text-slate-50">{value}</span></div><p className="mt-4 text-[10px] font-semibold uppercase tracking-[.15em] text-slate-400">{label}</p><p className="mt-1 text-[10px] text-slate-600">{detail}</p></article>;
}

function EmptyState({
  title,
  detail,
  canCreate,
  onCreate,
}: {
  title: string;
  detail: string;
  canCreate: boolean;
  onCreate: () => void;
}) {
  return <div className="rounded-2xl border border-dashed border-white/10 bg-black/10 px-5 py-12 text-center"><CalendarClock className="mx-auto size-8 text-slate-700" /><p className="mt-3 text-sm font-medium text-slate-300">{title}</p><p className="mx-auto mt-1 max-w-md text-xs leading-5 text-slate-600">{detail}</p>{canCreate && <Button className="mt-5 bg-lime-300 text-xs font-semibold text-[#050705] hover:bg-lime-200" onClick={onCreate}><Target className="size-4" />Pianifica attività</Button>}</div>;
}

function ResourceSummary({ labels }: { labels: string[] }) {
  if (!labels.length) return <span className="text-amber-200">Nessuna risorsa</span>;
  const visible = labels.slice(0, 3);
  const remaining = labels.length - visible.length;
  return <span>{visible.join(" · ")}{remaining > 0 ? ` · +${remaining}` : ""}</span>;
}

function PlanCard({
  plan,
  busy,
  canPublish,
  onPublish,
  onOpenMission,
}: {
  plan: PlanningPlan;
  busy: boolean;
  canPublish: boolean;
  onPublish: () => void;
  onOpenMission: () => void;
}) {
  const mission = plan.linkedMission;
  const canOpenMission = Boolean(mission)
    || (plan.activityType === "TRANSPORT" && plan.status === "PUBLISHED" && plan.feasible);
  const missionAttention = mission?.exception?.recoveryStatus === "OPEN";

  return <article className="rounded-2xl border border-white/[.08] bg-black/20 p-4 transition hover:border-lime-300/20 sm:p-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2"><span className={`rounded-full border px-2 py-1 text-[9px] font-semibold uppercase tracking-[.1em] ${plan.jobModule === "mission" ? toneStyles.cyan.badge : toneStyles.lime.badge}`}>{moduleLabel(plan.jobModule)}</span><span className="text-[10px] text-slate-600">{activityLabel(plan.activityType)} · Priorità {priorityLabel(plan.priority)}</span></div>
        <h3 className="mt-2 text-base font-semibold text-slate-100">{plan.title}</h3>
        <p className="mt-1 text-xs text-slate-500">{plan.jobTitle}</p>
      </div>
      <StatusPill status={plan.status} tone={statusTone(plan.status, plan.feasible)} />
    </div>

    <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      <div className="rounded-xl border border-white/[.06] bg-black/20 p-3"><p className="text-[9px] font-semibold uppercase tracking-[.14em] text-slate-600">Finestra</p><p className="mt-1.5 text-[11px] leading-5 text-slate-300"><CalendarClock className="mr-1.5 inline size-3.5 text-lime-200" />{formatDate(plan.startsAt)} → {formatDate(plan.endsAt)}</p></div>
      <div className="rounded-xl border border-white/[.06] bg-black/20 p-3"><p className="text-[9px] font-semibold uppercase tracking-[.14em] text-slate-600">Luogo</p><p className="mt-1.5 truncate text-[11px] text-slate-300"><MapPin className="mr-1.5 inline size-3.5 text-cyan-200" />{plan.location || "Da definire"}</p></div>
      <div className="rounded-xl border border-white/[.06] bg-black/20 p-3 sm:col-span-2 xl:col-span-1"><p className="text-[9px] font-semibold uppercase tracking-[.14em] text-slate-600">Risorse · {plan.resourceCount}</p><p className="mt-1.5 truncate text-[11px] text-slate-300"><Users className="mr-1.5 inline size-3.5 text-amber-200" /><ResourceSummary labels={plan.resourceLabels} /></p></div>
    </div>

    {plan.scopeSubgroupTitle && <p className="mt-3 text-[10px] text-slate-500"><ShieldCheck className="mr-1.5 inline size-3.5 text-lime-200" />Ambito: {plan.scopeSubgroupTitle}</p>}
    {plan.requiredQualifications.length > 0 && <p className="mt-2 text-[10px] text-slate-500">Qualifiche richieste: {plan.requiredQualifications.join(" · ")}</p>}

    {!plan.feasible && <div className="mt-4 rounded-xl border border-rose-300/20 bg-rose-300/[.04] p-3"><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.12em] text-rose-100"><CircleAlert className="size-3.5" />{plan.conflictCount} {plan.conflictCount === 1 ? "conflitto da risolvere" : "conflitti da risolvere"}</div>{plan.conflictDetails.slice(0, 2).map((detail, index) => <p className="mt-2 text-[10px] leading-4 text-slate-400" key={`${plan.id}-conflict-${index}`}>{detail}</p>)}</div>}

    {mission && <div className={`mt-4 rounded-xl border p-3 ${missionAttention ? "border-rose-300/20 bg-rose-300/[.035]" : "border-cyan-300/15 bg-cyan-300/[.03]"}`}><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[10px] font-semibold uppercase tracking-[.14em] text-cyan-100">Missione collegata</p><span className="flex items-center gap-2 text-[9px] text-slate-500">Esecuzione <StatusPill status={mission.executionStatus} tone={statusTone(mission.executionStatus)} /></span></div><div className="mt-3 grid gap-2 text-[10px] text-slate-400 sm:grid-cols-2"><p><Clock3 className="mr-1.5 inline size-3.5 text-cyan-200" />{statusLabel(mission.schedule.status)}{scheduleDeltaLabel(mission.schedule)}</p><p><Route className="mr-1.5 inline size-3.5 text-lime-200" />{mission.routeProgress ? `${mission.routeProgress.completedStops}/${mission.routeProgress.totalStops} tappe completate` : "Percorso da preparare"}</p></div>{mission.routeProgress?.currentStopLabel && <p className="mt-2 text-[10px] text-slate-500">Prossima tappa: {mission.routeProgress.currentStopLabel}</p>}{mission.exception && <p className={`mt-2 text-[10px] ${missionAttention ? "text-rose-100" : "text-slate-500"}`}>Eccezione: {missionExceptionLabel(mission.exception.type)} · {mission.exception.recoveryStatus === "OPEN" ? "da gestire" : "risolta"}</p>}</div>}

    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/[.06] pt-4">
      {plan.status === "DRAFT" && <Button className="h-9 bg-lime-300 text-[10px] font-semibold text-[#050705] hover:bg-lime-200" disabled={busy || !canPublish || !plan.feasible} onClick={onPublish}><Send className="size-3.5" />Pubblica</Button>}
      {canOpenMission && <Button className="h-9 border-cyan-300/20 bg-cyan-300/[.05] text-[10px] font-semibold text-cyan-100 hover:bg-cyan-300/[.1]" onClick={onOpenMission} variant="outline"><Route className="size-3.5" />{mission ? "Apri missione" : "Prepara missione"}</Button>}
      <span className="ml-auto text-[9px] text-slate-700">Aggiornato {formatDate(plan.updatedAt)}</span>
    </div>
  </article>;
}

function JobSelector({
  jobs,
  selectedJobId,
  onChange,
}: {
  jobs: PlanningJob[];
  selectedJobId: string;
  onChange: (jobId: string) => void;
}) {
  return <label className="block"><span className="sr-only">Seleziona perimetro operativo</span><select aria-label="Seleziona perimetro operativo" className="h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-slate-200 outline-none focus:border-lime-300/40" onChange={(event) => onChange(event.target.value)} value={selectedJobId}>{jobs.map((job) => <option className="bg-[#080c09]" key={job.id} value={job.id}>{job.code ? `${job.code} · ` : ""}{job.title}{job.planningEligible ? "" : " · solo storico"}</option>)}</select></label>;
}

export default function PlanningControl() {
  const router = useRouter();
  const [payload, setPayload] = useState<PlanningPayload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [refreshing, setRefreshing] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<PlanningView>("today");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
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
      setSelectedJobId((current) => current && next.jobs?.some((job) => job.id === current)
        ? current
        : next.jobs?.find((job) => job.planningEligible)?.id ?? next.jobs?.[0]?.id ?? "");
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
  const jobs = useMemo(() => payload?.jobs ?? [], [payload?.jobs]);
  const plans = useMemo(() => payload?.plans ?? [], [payload?.plans]);
  const summary = payload?.summary ?? {};
  const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? jobs[0] ?? null;
  const selectedPlans = useMemo(() => plans.filter((plan) => plan.jobId === selectedJob?.id), [plans, selectedJob?.id]);
  const canWritePlanning = capabilities.includes("planning.write");
  const canReadCommunication = capabilities.includes("communication.read");
  const canReadMission = capabilities.includes("mission.read");
  const actor = { email: context?.actorEmail ?? "operator@zerow.local", name: context?.actorName ?? "Operatore" };
  const validWindow = Boolean(startsAt && endsAt && Number.isFinite(Date.parse(startsAt)) && Number.isFinite(Date.parse(endsAt)) && Date.parse(endsAt) > Date.parse(startsAt));

  const filteredPlans = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return plans.filter((plan) => {
      const searchable = `${plan.title} ${plan.jobTitle} ${plan.location ?? ""} ${plan.scopeSubgroupTitle ?? ""} ${plan.resourceLabels.join(" ")}`.toLowerCase();
      const matchesQuery = !normalized || searchable.includes(normalized);
      const hasAttention = !plan.feasible || plan.linkedMission?.exception?.recoveryStatus === "OPEN";
      const matchesStatus = statusFilter === "ALL"
        || (statusFilter === "ATTENTION" && hasAttention)
        || (statusFilter !== "ATTENTION" && plan.status === statusFilter);
      return matchesQuery && matchesStatus;
    }).sort((left, right) => Date.parse(left.startsAt ?? "") - Date.parse(right.startsAt ?? ""));
  }, [plans, query, statusFilter]);

  const todayPlans = useMemo(() => filteredPlans.filter((plan) => currentDayOverlap(plan.startsAt, plan.endsAt)), [filteredPlans]);
  const attentionPlans = useMemo(() => plans.filter((plan) => !plan.feasible || plan.linkedMission?.exception?.recoveryStatus === "OPEN"), [plans]);
  const selectedFilteredPlans = useMemo(() => filteredPlans.filter((plan) => plan.jobId === selectedJob?.id), [filteredPlans, selectedJob?.id]);
  const filteredJobs = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return jobs;
    return jobs.filter((job) => `${job.code ?? ""} ${job.title} ${job.location ?? ""} ${job.scopeSubgroupTitle ?? ""}`.toLowerCase().includes(normalized));
  }, [jobs, query]);

  function navigate(path: string) {
    router.push(path);
  }

  function resetSimulation() {
    setSimulation({ status: "idle", evaluation: null });
  }

  function openCreate(job = selectedJob) {
    if (!job) {
      setNotice("Prima seleziona una commessa o una missione.");
      return;
    }
    if (!job.planningEligible) {
      setNotice(job.planningBlockedReason ?? "Questo perimetro è disponibile solo per consultazione.");
      return;
    }
    setSelectedJobId(job.id);
    setTitle(job.module === "mission" ? `Piano missione · ${job.title}` : `Attività · ${job.title}`);
    setActivityType(job.module === "mission" ? "TRANSPORT" : "WORK");
    setPriority("STANDARD");
    setStartsAt(localDateTime(1));
    setEndsAt(localDateTime(5));
    setLocation(job.location ?? "");
    setQualifications("");
    setNotes("");
    setResourceIds([]);
    resetSimulation();
    setModal(true);
  }

  function requestBody(action: "draft" | "what_if") {
    return {
      action,
      title: title.trim() || "Piano operativo",
      activityType: selectedJob?.module === "mission" ? "TRANSPORT" : activityType,
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
    if (!selectedJob || !validWindow || !resourceIds.length) return;
    setSimulation({ status: "checking", evaluation: null });
    try {
      const response = await fetch(`/api/operations/jobs/${encodeURIComponent(selectedJob.id)}/planning`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody("what_if")),
      });
      const result = await response.json() as { error?: string; detail?: string; evaluation?: Evaluation };
      if (!response.ok) throw new Error(planningErrorMessage(result.error, result.detail ?? result.evaluation?.conflicts?.[0]?.detail));
      setSimulation({
        status: "ready",
        evaluation: result.evaluation ?? null,
        message: result.evaluation?.feasible ? "Finestra e risorse compatibili." : "La proposta presenta conflitti.",
      });
    } catch (error) {
      setSimulation({ status: "error", evaluation: null, message: error instanceof Error ? error.message : planningErrorMessage() });
    }
  }

  async function createPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedJob || !validWindow || !resourceIds.length) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(`/api/operations/jobs/${encodeURIComponent(selectedJob.id)}/planning`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...requestBody("draft"), action: "draft" }),
      });
      const result = await response.json() as { error?: string; detail?: string; evaluation?: Evaluation };
      if (!response.ok) throw new Error(planningErrorMessage(result.error, result.detail ?? result.evaluation?.conflicts?.[0]?.detail));
      setModal(false);
      setNotice("Bozza salvata. Pubblicala quando finestra e risorse sono confermate.");
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : planningErrorMessage());
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
      if (!response.ok) throw new Error(planningErrorMessage(result.error, result.detail ?? result.evaluation?.conflicts?.[0]?.detail));
      setNotice("Piano pubblicato e disponibilità confermata.");
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : planningErrorMessage());
    } finally {
      setBusy(false);
    }
  }

  function openMissionFromPlan(plan: PlanningPlan) {
    const missionQuery = plan.linkedMission
      ? `missionId=${encodeURIComponent(plan.linkedMission.id)}`
      : `planId=${encodeURIComponent(plan.id)}&jobId=${encodeURIComponent(plan.jobId)}`;
    router.push(`/mission?${missionQuery}`);
  }

  if (state === "loading" && !payload) {
    return <main className="grid min-h-screen place-items-center bg-[#030504] text-sm text-slate-400"><LoaderCircle className="mr-2 inline size-4 animate-spin text-lime-300" />Caricamento pianificazione…</main>;
  }

  if (state === "error" && !payload) {
    return <main className="grid min-h-screen place-items-center bg-[#030504] p-5"><div className="carbon-card w-full max-w-md rounded-2xl p-6 text-center"><CircleAlert className="mx-auto size-8 text-amber-200" /><h1 className="mt-4 text-lg font-semibold text-slate-100">Pianificazione non disponibile</h1><p className="mt-2 text-sm leading-6 text-slate-500">Non è stato possibile leggere il piano autorizzato. Riprova tra qualche istante.</p><Button className="mt-5 bg-lime-300 text-[#050705] hover:bg-lime-200" onClick={() => void refresh()}><RefreshCw className="size-4" />Riprova</Button></div></main>;
  }

  const viewOptions: Array<{ id: PlanningView; label: string; icon: LucideIcon; count: number }> = [
    { id: "today", label: "Oggi", icon: Clock3, count: plans.filter((plan) => currentDayOverlap(plan.startsAt, plan.endsAt)).length },
    { id: "plans", label: "Piani", icon: CalendarClock, count: plans.length },
    { id: "perimeters", label: "Perimetri", icon: BriefcaseBusiness, count: jobs.length },
  ];

  return <main className="zw-app-shell zw-planning-module min-h-screen overflow-x-hidden text-slate-100 selection:bg-lime-300 selection:text-[#060806]">
    <div aria-hidden="true" className="zw-command-ambient" />
    <section className="relative min-w-0">
      <header className="zw-command-topbar sticky top-0 z-20 flex min-h-[72px] items-center gap-3 px-4 py-3 sm:gap-5 sm:px-7">
        <IconButton className="lg:hidden" label="Apri menu"><Menu className="size-4" /></IconButton>
        <button aria-label="Apri Pianificazione" className="zw-command-topbar__brand flex shrink-0 items-center gap-3 text-left" onClick={() => navigate("/planning")} type="button"><span className="relative grid size-10 place-items-center overflow-hidden rounded-xl border border-lime-300/35 bg-black shadow-[0_0_18px_rgba(200,255,34,.12)]"><Image alt="ZEROW" className="size-full object-cover" height={40} src="/ai-zerow-icon.jpeg" width={40} /></span><span><span className="block text-sm font-semibold text-slate-100">Pianificazione</span><span className="mt-0.5 hidden text-[10px] uppercase tracking-[.16em] text-slate-500 sm:block">Agenda e risorse</span></span></button>
        <div className="ml-auto flex min-w-0 items-center gap-2"><TenantSwitcher /><span className="hidden items-center gap-2 rounded-full border border-lime-300/20 bg-lime-300/[.04] px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[.12em] text-lime-200 sm:flex"><span className="size-1.5 rounded-full bg-lime-300" />{refreshing ? "AGGIORNAMENTO" : payload?.readback?.status === "verified" ? "DATI AGGIORNATI" : "DATI OPERATIVI"}</span><IconButton className="zw-command-topbar__back hidden sm:grid" label="Torna indietro" onClick={() => router.back()}><ArrowLeft className="size-4" /></IconButton><IconButton className="zw-command-topbar__refresh" label="Aggiorna pianificazione" onClick={() => void refresh()}><RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} /></IconButton>{canReadCommunication && <IconButton className="zw-command-topbar__notifications" label="Apri comunicazioni" onClick={() => navigate("/communications")}><Bell className="size-4" /></IconButton>}<AccountMenu actor={actor} /></div>
      </header>

      <div className="mx-auto w-full max-w-[1440px] px-4 pb-28 pt-6 sm:px-7 lg:pb-10">
        <section className="carbon-card overflow-hidden rounded-3xl p-5 sm:p-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between"><div className="max-w-3xl"><p className="text-[10px] font-semibold uppercase tracking-[.22em] text-lime-300/75">PIANIFICAZIONE · CONTROL ROOM</p><h1 className="mt-2 text-2xl font-semibold tracking-[-.035em] text-slate-50 sm:text-3xl">Piano operativo aziendale</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Coordina commesse e missioni con persone, squadre, mezzi e attrezzature realmente disponibili. Ogni pubblicazione viene ricontrollata dal server.</p></div><div className="flex flex-wrap gap-2">{canReadMission && <Button className="h-10 border-white/10 bg-black/20 text-slate-300 hover:border-cyan-300/25 hover:bg-cyan-300/[.05] hover:text-cyan-100" onClick={() => navigate("/mission")} variant="outline"><Truck className="size-4" />Apri missioni<ArrowUpRight className="size-3.5" /></Button>}{canWritePlanning && <Button className="h-10 bg-lime-300 px-4 font-semibold text-[#050705] hover:bg-lime-200" disabled={!selectedJob?.planningEligible} onClick={() => openCreate()}><Target className="size-4" />Nuova attività</Button>}</div></div>
        </section>

        <section aria-label="Riepilogo pianificazione" className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric detail="finestre nella giornata" icon={Clock3} label="Oggi" tone="lime" value={summary.today ?? 0} /><Metric detail="in preparazione" icon={ListFilter} label="Bozze" tone="amber" value={summary.drafts ?? 0} /><Metric detail="comunicate ai reparti" icon={CheckCircle2} label="Pubblicati" tone="cyan" value={summary.published ?? 0} /><Metric detail="conflitti o eccezioni" icon={CircleAlert} label="Attenzioni" tone={attentionPlans.length ? "red" : "lime"} value={(summary.conflicted ?? 0) + (summary.exceptionsOpen ?? 0)} /></section>

        <section className="carbon-card mt-4 rounded-2xl p-3 sm:p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div aria-label="Vista pianificazione" className="grid grid-cols-3 gap-1 rounded-xl border border-white/[.07] bg-black/25 p-1">{viewOptions.map((item) => { const Icon = item.icon; return <button aria-pressed={view === item.id} className={`rounded-lg px-3 py-2 text-[10px] font-semibold transition ${view === item.id ? "bg-lime-300 text-[#050705]" : "text-slate-500 hover:bg-white/[.04] hover:text-slate-200"}`} key={item.id} onClick={() => setView(item.id)} type="button"><Icon className="mr-1.5 inline size-3.5" />{item.label}<span className="ml-1.5 font-mono opacity-70">{item.count}</span></button>; })}</div><div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row lg:max-w-[720px]"><label className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-600" /><Input aria-label="Cerca nella pianificazione" className="h-10 border-white/10 bg-black/25 pl-9 text-xs" onChange={(event) => setQuery(event.target.value)} placeholder="Attività, commessa, luogo o risorsa" value={query} /></label><select aria-label="Filtra stato piani" className="h-10 rounded-xl border border-white/10 bg-black/25 px-3 text-xs text-slate-300 outline-none focus:border-lime-300/40" onChange={(event) => setStatusFilter(event.target.value as StatusFilter)} value={statusFilter}><option className="bg-[#080c09]" value="ALL">Tutti gli stati</option><option className="bg-[#080c09]" value="DRAFT">Bozze</option><option className="bg-[#080c09]" value="PUBLISHED">Pubblicati</option><option className="bg-[#080c09]" value="ATTENTION">Da attenzionare</option></select></div></div>
        </section>

        {view === "today" && <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,.72fr)]">
          <section className="carbon-card min-w-0 rounded-2xl p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/75">AGENDA DI OGGI</p><h2 className="mt-1 text-lg font-semibold text-slate-100">{formatDay(new Date().toISOString())}</h2><p className="mt-1 text-xs text-slate-500">Finestre attive nel tuo perimetro autorizzato.</p></div><StatusPill status={todayPlans.length ? "ACTIVE" : "NOT_SCHEDULED"} tone={todayPlans.length ? "lime" : "amber"} /></div><div className="mt-4 space-y-3">{todayPlans.map((plan) => <PlanCard busy={busy} canPublish={canWritePlanning} key={plan.id} onOpenMission={() => openMissionFromPlan(plan)} onPublish={() => void publishPlan(plan)} plan={plan} />)}{todayPlans.length === 0 && <EmptyState canCreate={canWritePlanning && Boolean(selectedJob?.planningEligible)} detail={query || statusFilter !== "ALL" ? "Nessun piano di oggi corrisponde ai filtri selezionati." : "Crea una finestra operativa collegata a una commessa o a una missione."} onCreate={() => openCreate()} title="Nessuna attività visibile oggi" />}</div></section>

          <aside className="space-y-4"><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-center gap-3"><span className={`grid size-10 place-items-center rounded-xl border ${toneStyles.cyan.border}`}><BriefcaseBusiness className="size-[18px]" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-cyan-200/75">PERIMETRO SELEZIONATO</p><h2 className="mt-1 text-base font-semibold text-slate-100">Dove pianificare</h2></div></div>{jobs.length > 0 ? <><div className="mt-4"><JobSelector jobs={jobs} onChange={setSelectedJobId} selectedJobId={selectedJob?.id ?? ""} /></div>{selectedJob && <div className="mt-3 rounded-xl border border-white/[.07] bg-black/20 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><StatusPill status={selectedJob.status} tone={selectedJob.planningEligible ? "lime" : "amber"} /><span className={`rounded-full border px-2 py-1 text-[9px] uppercase tracking-[.08em] ${selectedJob.module === "mission" ? toneStyles.cyan.badge : toneStyles.lime.badge}`}>{moduleLabel(selectedJob.module)}</span></div><h3 className="mt-3 text-sm font-semibold text-slate-100">{selectedJob.title}</h3><p className="mt-2 text-[11px] leading-5 text-slate-500"><MapPin className="mr-1.5 inline size-3.5 text-cyan-200" />{selectedJob.location || "Luogo da definire"}</p><p className="mt-2 text-[10px] text-slate-600">{selectedJob.scopeSubgroupTitle ? `Ambito: ${selectedJob.scopeSubgroupTitle}` : "Ambito operativo generale"}</p>{selectedJob.planningBlockedReason && <p className="mt-3 rounded-lg border border-amber-300/15 bg-amber-300/[.04] p-2.5 text-[10px] leading-4 text-amber-100">{selectedJob.planningBlockedReason}</p>}<p className="mt-3 border-t border-white/[.06] pt-3 text-[10px] text-slate-500">{selectedPlans.length} {selectedPlans.length === 1 ? "piano collegato" : "piani collegati"}</p></div>}<Button className="mt-3 h-10 w-full bg-lime-300 text-xs font-semibold text-[#050705] hover:bg-lime-200" disabled={!canWritePlanning || !selectedJob?.planningEligible} onClick={() => openCreate()}><Target className="size-4" />Aggiungi attività</Button></> : <p className="mt-4 rounded-xl border border-dashed border-white/10 p-5 text-center text-xs leading-5 text-slate-600">Non ci sono commesse o missioni pianificabili nel tuo perimetro.</p>}</section>

            <section className="carbon-card-neon rounded-2xl p-4 sm:p-5"><div className="flex items-center gap-3"><span className={`grid size-10 place-items-center rounded-xl border ${toneStyles.lime.border}`}><ShieldCheck className="size-[18px]" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-lime-200/75">CONTROLLO SERVER</p><h2 className="mt-1 text-sm font-semibold text-slate-100">Disponibilità verificata</h2></div></div><p className="mt-3 text-[11px] leading-5 text-slate-500">Persone, squadre e asset vengono ricontrollati sulla finestra scelta. Gli asset affidati a lungo termine seguono automaticamente la persona assegnataria.</p></section>
          </aside>
        </section>}

        {view === "plans" && <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,.72fr)]">
          <section className="carbon-card min-w-0 rounded-2xl p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/75">REGISTRO PIANI</p><h2 className="mt-1 text-lg font-semibold text-slate-100">Tutte le attività</h2><p className="mt-1 text-xs text-slate-500">Bozze e pubblicazioni ordinate per data di inizio.</p></div><span className="rounded-full border border-white/10 px-2.5 py-1 font-mono text-[9px] text-slate-500">{filteredPlans.length} PIANI</span></div><div className="mt-4 space-y-3">{filteredPlans.map((plan) => <PlanCard busy={busy} canPublish={canWritePlanning} key={plan.id} onOpenMission={() => openMissionFromPlan(plan)} onPublish={() => void publishPlan(plan)} plan={plan} />)}{filteredPlans.length === 0 && <EmptyState canCreate={canWritePlanning && Boolean(selectedJob?.planningEligible)} detail="Modifica la ricerca oppure crea la prima attività del perimetro selezionato." onCreate={() => openCreate()} title="Nessun piano corrispondente" />}</div></section>

          <aside className="space-y-4"><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-rose-200/75">ATTENZIONI OPERATIVE</p><h2 className="mt-1 text-base font-semibold text-slate-100">Da risolvere prima dell’esecuzione</h2></div><span className="font-mono text-lg text-rose-100">{attentionPlans.length}</span></div><div className="mt-4 space-y-2">{attentionPlans.slice(0, 5).map((plan) => <button className="w-full rounded-xl border border-white/[.07] bg-black/20 p-3 text-left transition hover:border-rose-300/20" key={plan.id} onClick={() => { setQuery(plan.title); setStatusFilter("ATTENTION"); }} type="button"><div className="flex items-start gap-2"><CircleAlert className="mt-0.5 size-3.5 shrink-0 text-rose-200" /><span className="min-w-0"><span className="block truncate text-xs font-medium text-slate-200">{plan.title}</span><span className="mt-1 block truncate text-[10px] text-slate-600">{!plan.feasible ? `${plan.conflictCount} conflitti` : "Eccezione missione aperta"} · {plan.jobTitle}</span></span></div></button>)}{attentionPlans.length === 0 && <div className="rounded-xl border border-lime-300/15 bg-lime-300/[.03] p-4 text-[11px] leading-5 text-lime-100"><CheckCircle2 className="mr-1.5 inline size-4" />Nessun conflitto o eccezione aperta.</div>}</div></section>

            <section className="carbon-card-neon rounded-2xl p-4 sm:p-5"><div className="flex items-center gap-3"><span className={`grid size-10 place-items-center rounded-xl border ${toneStyles.cyan.border}`}><Sparkles className="size-[18px]" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-cyan-200/75">COMPANY AI</p><h2 className="mt-1 text-sm font-semibold text-slate-100">Analisi della copertura</h2></div></div><p className="mt-3 text-[11px] leading-5 text-slate-500">Company AI legge piani ed eventi autorizzati e prepara l’analisi. Le assegnazioni restano confermate da Pianificazione.</p><div className="mt-4 space-y-2"><button className="flex w-full items-center gap-2 rounded-xl border border-white/[.08] bg-black/20 px-3 py-2.5 text-left text-[11px] text-slate-400 transition hover:border-lime-300/25 hover:text-lime-100" onClick={() => navigate("/command?prompt=Analizza%20la%20copertura%20della%20pianificazione%20aziendale")} type="button"><ChevronRight className="size-3.5 text-lime-300" />Analizza copertura</button><button className="flex w-full items-center gap-2 rounded-xl border border-white/[.08] bg-black/20 px-3 py-2.5 text-left text-[11px] text-slate-400 transition hover:border-lime-300/25 hover:text-lime-100" onClick={() => navigate("/command?prompt=Mostra%20conflitti%20ed%20eccezioni%20della%20pianificazione")} type="button"><ChevronRight className="size-3.5 text-lime-300" />Spiega le attenzioni</button></div></section>
          </aside>
        </section>}

        {view === "perimeters" && <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(300px,.72fr)_minmax(0,1.45fr)]">
          <aside className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-cyan-200/75">PERIMETRI OPERATIVI</p><h2 className="mt-1 text-base font-semibold text-slate-100">Commesse e missioni</h2><p className="mt-1 text-xs leading-5 text-slate-500">Scegli dove creare o consultare il piano.</p></div><span className="font-mono text-[9px] text-slate-600">{filteredJobs.length}</span></div><div className="mt-4 space-y-2">{filteredJobs.map((job) => <button aria-pressed={job.id === selectedJob?.id} className={`w-full rounded-xl border p-3.5 text-left transition ${job.id === selectedJob?.id ? "border-lime-300/35 bg-lime-300/[.07]" : "border-white/[.07] bg-black/20 hover:border-lime-300/20"} ${job.planningEligible ? "" : "opacity-70"}`} key={job.id} onClick={() => setSelectedJobId(job.id)} type="button"><div className="flex items-start justify-between gap-2"><span className="min-w-0"><span className="block truncate text-xs font-semibold text-slate-100">{job.code ? `${job.code} · ` : ""}{job.title}</span><span className="mt-1.5 block truncate text-[10px] text-slate-600">{job.location || "Luogo da definire"}</span></span><span className={`shrink-0 rounded-full border px-2 py-1 text-[8px] font-semibold uppercase tracking-[.08em] ${job.module === "mission" ? toneStyles.cyan.badge : toneStyles.lime.badge}`}>{moduleLabel(job.module)}</span></div><span className={`mt-2 block text-[9px] ${job.planningEligible ? "text-slate-600" : "text-amber-200"}`}>{statusLabel(job.status)}{job.planningEligible ? job.scopeSubgroupTitle ? ` · ${job.scopeSubgroupTitle}` : "" : " · solo storico"}</span></button>)}{filteredJobs.length === 0 && <p className="rounded-xl border border-dashed border-white/10 p-5 text-center text-xs leading-5 text-slate-600">Nessun perimetro corrisponde alla ricerca.</p>}</div></aside>

          <section className="carbon-card min-w-0 rounded-2xl p-4 sm:p-5">{selectedJob ? <><div className="flex flex-col gap-3 border-b border-white/[.07] pb-4 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full border px-2 py-1 text-[9px] font-semibold uppercase tracking-[.08em] ${selectedJob.module === "mission" ? toneStyles.cyan.badge : toneStyles.lime.badge}`}>{moduleLabel(selectedJob.module)}</span><StatusPill status={selectedJob.status} tone={selectedJob.planningEligible ? "lime" : "amber"} /></div><h2 className="mt-3 text-lg font-semibold text-slate-100">{selectedJob.title}</h2><p className="mt-1 text-xs text-slate-500"><MapPin className="mr-1.5 inline size-3.5 text-cyan-200" />{selectedJob.location || "Luogo da definire"}</p><p className="mt-2 text-[10px] text-slate-600">{selectedJob.scopeSubgroupTitle ? `Ambito: ${selectedJob.scopeSubgroupTitle}` : "Ambito operativo generale"}</p>{selectedJob.planningBlockedReason && <p className="mt-3 rounded-lg border border-amber-300/15 bg-amber-300/[.04] p-2.5 text-[10px] leading-4 text-amber-100">{selectedJob.planningBlockedReason}</p>}</div>{canWritePlanning && <Button className="h-10 shrink-0 bg-lime-300 text-xs font-semibold text-[#050705] hover:bg-lime-200" disabled={!selectedJob.planningEligible} onClick={() => openCreate(selectedJob)}><Target className="size-4" />Nuova attività</Button>}</div><div className="mt-4 space-y-3">{selectedFilteredPlans.map((plan) => <PlanCard busy={busy} canPublish={canWritePlanning} key={plan.id} onOpenMission={() => openMissionFromPlan(plan)} onPublish={() => void publishPlan(plan)} plan={plan} />)}{selectedFilteredPlans.length === 0 && <EmptyState canCreate={canWritePlanning && selectedJob.planningEligible} detail={query || statusFilter !== "ALL" ? "Nessun piano collegato corrisponde ai filtri selezionati." : selectedJob.planningEligible ? "Crea la prima finestra operativa per questo perimetro." : "Lo storico resta consultabile, ma non è possibile aggiungere nuove attività."} onCreate={() => openCreate(selectedJob)} title="Nessun piano visibile" />}</div></> : <EmptyState canCreate={false} detail="Scegli una commessa o una missione dall’elenco per consultarne le attività." onCreate={() => undefined} title="Seleziona un perimetro" />}</section>
        </section>}

        <footer className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-white/[.07] py-5 text-[10px] text-slate-600"><span>AI-ZEROW · PIANIFICAZIONE</span><span className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-lime-300" />Risorse canoniche · verifica server · perimetro autorizzato</span></footer>
      </div>
    </section>

    <CommandMobileNav active="more" allowedNavigation={allowedNavigation} role={context?.role} roles={context?.roles} />

    {notice && <div className="fixed bottom-24 left-1/2 z-[100] flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-2 rounded-xl border border-amber-300/25 bg-[#080d09]/96 px-4 py-3 text-left text-xs text-amber-100 shadow-[0_0_28px_rgba(190,255,60,.14)] backdrop-blur-xl sm:bottom-5"><CircleAlert className="size-4 shrink-0 text-amber-200" /><span>{notice}</span><button aria-label="Chiudi avviso" className="ml-2 text-slate-400 hover:text-slate-100" onClick={() => setNotice("")} type="button">×</button></div>}

    <Dialog open={modal} onOpenChange={setModal}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto border-lime-300/20 bg-[#080c09] text-slate-100 sm:max-w-[780px]">
        <DialogHeader><DialogTitle>Nuova attività pianificata</DialogTitle><DialogDescription className="text-slate-500">Definisci finestra e risorse. Il server controlla disponibilità, sovrapposizioni e qualifiche prima del salvataggio.</DialogDescription></DialogHeader>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={createPlan}>
          <div className="sm:col-span-2 rounded-xl border border-lime-300/15 bg-lime-300/[.035] p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.16em] text-lime-300/80"><Target className="size-3.5" />Perimetro operativo</p>{selectedJob && <span className={`rounded-full border px-2 py-1 text-[8px] font-semibold uppercase tracking-[.08em] ${selectedJob.module === "mission" ? toneStyles.cyan.badge : toneStyles.lime.badge}`}>{moduleLabel(selectedJob.module)}</span>}</div><p className="mt-2 text-sm text-slate-200">{selectedJob?.code ? `${selectedJob.code} · ` : ""}{selectedJob?.title ?? "—"}</p><p className="mt-1 text-[10px] text-slate-500">{selectedJob?.scopeSubgroupTitle ? `Ambito: ${selectedJob.scopeSubgroupTitle}` : "Ambito operativo generale"}</p></div>

          <label className="text-xs text-slate-400 sm:col-span-2">Titolo attività<Input className="mt-2 border-white/10 bg-black/30" maxLength={160} onChange={(event) => setTitle(event.target.value)} value={title} required /></label>

          <label className="text-xs text-slate-400">Tipo attività<select aria-label="Tipo attività" className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-slate-100 outline-none focus:border-lime-300/40 disabled:cursor-not-allowed disabled:opacity-60" disabled={selectedJob?.module === "mission"} onChange={(event) => { setActivityType(event.target.value as "WORK" | "TRANSPORT"); resetSimulation(); }} value={selectedJob?.module === "mission" ? "TRANSPORT" : activityType}><option className="bg-[#080c09]" value="WORK">Lavorazione commessa</option><option className="bg-[#080c09]" value="TRANSPORT">Trasporto / missione</option></select>{selectedJob?.module === "mission" && <span className="mt-1.5 block text-[9px] leading-4 text-cyan-200/75">Le missioni usano sempre il flusso trasporto.</span>}</label>

          <label className="text-xs text-slate-400">Priorità<select aria-label="Priorità" className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-slate-100 outline-none focus:border-lime-300/40" onChange={(event) => setPriority(event.target.value)} value={priority}><option className="bg-[#080c09]" value="STANDARD">Standard</option><option className="bg-[#080c09]" value="HIGH">Alta</option><option className="bg-[#080c09]" value="CRITICAL">Critica</option></select></label>

          <label className="text-xs text-slate-400">Inizio<Input className="mt-2 border-white/10 bg-black/30" onChange={(event) => { setStartsAt(event.target.value); resetSimulation(); }} type="datetime-local" value={startsAt} required /></label>
          <label className="text-xs text-slate-400">Fine<Input aria-invalid={Boolean(startsAt && endsAt && !validWindow)} className="mt-2 border-white/10 bg-black/30" onChange={(event) => { setEndsAt(event.target.value); resetSimulation(); }} type="datetime-local" value={endsAt} required /></label>
          {startsAt && endsAt && !validWindow && <p className="sm:col-span-2 -mt-2 text-[10px] text-rose-200">La fine deve essere successiva all’inizio.</p>}

          <label className="text-xs text-slate-400 sm:col-span-2">Luogo operativo<Input className="mt-2 border-white/10 bg-black/30" maxLength={240} onChange={(event) => setLocation(event.target.value)} placeholder="Cantiere, sede o tratta" value={location} /></label>

          <div className="sm:col-span-2"><PlanningResourceFields jobId={selectedJob?.id ?? ""} startsAt={startsAt} endsAt={endsAt} selectedIds={resourceIds} onChange={(ids) => { setResourceIds(ids); resetSimulation(); }} /></div>

          <label className="text-xs text-slate-400 sm:col-span-2">Qualifiche richieste <span className="text-slate-600">(separate da virgola)</span><Input className="mt-2 border-white/10 bg-black/30" onChange={(event) => { setQualifications(event.target.value); resetSimulation(); }} placeholder="Patentino, PES-PAV, ADR…" value={qualifications} /></label>
          <label className="text-xs text-slate-400 sm:col-span-2">Note operative<Textarea className="mt-2 min-h-20 border-white/10 bg-black/30" maxLength={2000} onChange={(event) => setNotes(event.target.value)} placeholder="Istruzioni utili alla squadra o all’autista" value={notes} /></label>

          <div className="sm:col-span-2 rounded-xl border border-cyan-300/15 bg-cyan-300/[.03] p-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-cyan-200/80">CONTROLLO PREVENTIVO</p><p className="mt-1 text-[10px] leading-4 text-slate-500">Simula capacità, qualifiche e sovrapposizioni senza salvare.</p></div><Button className="h-9 border-cyan-300/25 bg-cyan-300/[.08] text-[10px] text-cyan-100 hover:bg-cyan-300/[.14]" disabled={simulation.status === "checking" || !resourceIds.length || !validWindow} onClick={() => void simulatePlan()} type="button" variant="outline">{simulation.status === "checking" ? <LoaderCircle className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}Verifica capacità</Button></div>{simulation.status === "ready" && <div className={`mt-3 rounded-lg border px-3 py-2 text-[10px] ${simulation.evaluation?.feasible ? toneStyles.lime.border : toneStyles.red.border}`}><span className="font-semibold">{simulation.evaluation?.feasible ? "Verifica superata" : "Conflitti rilevati"}</span>{simulation.evaluation?.conflicts?.slice(0, 3).map((conflict, index) => <p className="mt-1 text-slate-400" key={`${conflict.code ?? "conflict"}-${index}`}>{conflict.detail ?? conflict.code}</p>)}</div>}{simulation.status === "error" && <p className="mt-3 text-[10px] text-amber-200">{simulation.message}</p>}</div>

          <DialogFooter className="sm:col-span-2"><DialogClose asChild><Button className="border-white/10 bg-transparent text-slate-400" type="button" variant="outline"><X className="size-3.5" />Annulla</Button></DialogClose><Button className="bg-lime-300 text-[#050705] hover:bg-lime-200" disabled={busy || !resourceIds.length || !canWritePlanning || !validWindow} type="submit">{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}Salva bozza</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </main>;
}
