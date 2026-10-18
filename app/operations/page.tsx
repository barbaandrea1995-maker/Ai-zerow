"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import {
  Activity,
  ArrowLeft,
  ArrowUpRight,
  Bell,
  BriefcaseBusiness,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleGauge,
  ClipboardCheck,
  Clock3,
  FileText,
  Gauge,
  HardHat,
  Layers3,
  Menu,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  Package,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Truck,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { AccountMenu } from "@/components/account-menu";
import { useAuthorityAccess } from "@/components/authority-access-provider";
import { CommandMobileNav } from "@/components/command-mobile-nav";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRouter } from "next/navigation";
import { jobStatusLabel, normalizeJobStatus } from "@/lib/operations-contract";
import type {
  IntakeAdapterRecord,
  IntakeCreateResponse,
} from "@/components/operations-commessa-intake";
import { invalidateReadback, readback } from "@/lib/client-readback";
import { ROLE_METADATA } from "@/lib/authority-catalog";
import { getAllowedCommandNavigation } from "@/lib/command-dashboard";
import { TenantSwitcher } from "@/components/tenant-switcher";

const OperationsCommessaIntake = dynamic(
  () => import("@/components/operations-commessa-intake"),
  { ssr: false },
);

type JobStatus =
  | "BOZZA"
  | "PROPOSTA"
  | "APPROVATA"
  | "In corso"
  | "Pianificata"
  | "BLOCCATA"
  | "Completata"
  | "CHIUSA"
  | "ANNULLATA";
type JobFilter =
  | "TUTTE"
  | "IN CORSO"
  | "PIANIFICATE"
  | "COMPLETATE"
  | "BOZZE"
  | "BLOCCATE";
type Tone = "lime" | "cyan" | "amber" | "red";

type JobActivity = {
  label: string;
  detail: string;
  state: "done" | "active" | "queued";
  owner: string;
};

type OperationsJob = {
  id: string;
  sourceId?: string;
  title: string;
  description: string;
  client: string;
  location: string;
  status: JobStatus;
  statusCode: string;
  priority: "HIGH" | "STANDARD" | "LOW";
  progress: number;
  team: string;
  due: string;
  category: string;
  version: number;
  activities: JobActivity[];
};

type OperationsAdapterRecord = IntakeAdapterRecord;
type OperationsAdapterResponse = IntakeCreateResponse;
type PlanningOptionsResponse = {
  options?: {
    workforce?: Array<{ id: string; label: string; kind: string; assignable: boolean; availableForWindow?: boolean; availabilityConflict?: { title: string } }>;
    assets?: Array<{ id: string; label: string; kind: string; assignable: boolean; availableForWindow?: boolean; availabilityConflict?: { title: string } }>;
    unavailableAssets?: Array<{ id: string; label: string; kind: string; assignable: boolean; availableForWindow?: boolean }>;
    unavailableForWindow?: Array<{ id: string; label: string; kind: string; assignable: boolean; availableForWindow?: boolean; availabilityConflict?: { title: string } }>;
  };
  existingPlans?: Array<{ id: string; status: string; version: number; title: string }>;
  availability?: { status?: string; window?: { startsAt: string; endsAt: string } | null };
  readback?: { status?: string };
};

const navItems = [
  { label: "CONTROL", id: "command", icon: MessageSquareText, capability: "command.read" },
  { label: "COMMESSE", id: "operations", icon: BriefcaseBusiness, capability: "operations.read" },
  { label: "PERSONE", id: "workforce", icon: Users, capability: "workforce.read" },
  { label: "PIANIFICAZIONE", id: "planning", icon: CalendarClock, capability: "planning.read" },
  { label: "PRESENZE", id: "attendance", icon: Clock3, capability: "workforce.read" },
  { label: "FINANZA", id: "finance", icon: Gauge, capability: "finance.read" },
  { label: "ACQUISTI", id: "procurement", icon: Package, capability: "procurement.read" },
  { label: "ASSETS", id: "assets", icon: Package, capability: "asset.read" },
  { label: "WAREHOUSE", id: "warehouse", icon: Layers3, capability: "warehouse.read" },
  { label: "MISSIONI", id: "mission", icon: Truck, capability: "mission.read" },
  { label: "DOCUMENTS", id: "documents", icon: FileText, capability: "documents.read" },
  { label: "GOVERNANCE", id: "governance", icon: ShieldCheck, capability: "governance.read" },
  { label: "COMMUNICATIONS", id: "communications", icon: MessageSquareText, capability: "communication.read" },
  { label: "INTEGRAZIONI", id: "externals", icon: Layers3, capability: "external_adapters.read" },
  { label: "AUTORIZZAZIONI", id: "authority", icon: ShieldCheck, capability: "authority.read" },
  { label: "QR / BARCODE", id: "qr", icon: QrCode, capability: "qr.read" },
  { label: "ATTIVITÀ DI SISTEMA", id: "events_authority", icon: ShieldCheck, capability: "events.read" },
  { label: "STATO PWA", id: "pwa", icon: CircleGauge, capability: "command.read" },
  { label: "SETTINGS", id: "settings", icon: Settings2, capability: "settings.read" },
];

const jobs: OperationsJob[] = [];

const emptyJob: OperationsJob = {
  id: "EMPTY",
  title: "Nessuna commessa",
  description: "Non ci sono ancora commesse da mostrare.",
  client: "—",
  location: "Nessun luogo disponibile",
  status: "BOZZA",
  statusCode: "DRAFT",
  priority: "LOW",
  progress: 0,
  team: "—",
  due: "—",
  category: "Nessun dato",
  version: 0,
  activities: [],
};

const toneStyles: Record<Tone, { icon: string; badge: string; line: string }> =
  {
    lime: {
      icon: "text-lime-200",
      badge: "border-lime-300/25 bg-lime-300/10 text-lime-200",
      line: "bg-lime-300",
    },
    cyan: {
      icon: "text-cyan-200",
      badge: "border-cyan-300/25 bg-cyan-300/10 text-cyan-200",
      line: "bg-cyan-300",
    },
    amber: {
      icon: "text-amber-200",
      badge: "border-amber-300/25 bg-amber-300/10 text-amber-200",
      line: "bg-amber-300",
    },
    red: {
      icon: "text-rose-200",
      badge: "border-rose-300/25 bg-rose-300/10 text-rose-200",
      line: "bg-rose-300",
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
      className={`grid size-10 place-items-center rounded-xl border border-white/[0.11] bg-[linear-gradient(145deg,rgba(255,255,255,0.045),rgba(0,0,0,0.25))] text-slate-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition hover:-translate-y-px hover:border-lime-300/45 hover:bg-lime-300/[0.09] hover:text-lime-100 hover:shadow-[0_0_24px_rgba(190,255,60,0.09)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300 ${className}`}
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
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 font-mono text-[10px] font-semibold tracking-[0.08em] ${styles.badge}`}
    >
      <span className="size-1.5 rounded-full bg-current shadow-[0_0_9px_currentColor]" />
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
          <p className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/80">
            {eyebrow}
          </p>
        )}
        <h2 className="text-[16px] font-semibold tracking-[-0.02em] text-lime-100">
          {title}
        </h2>
      </div>
      {action && (
        <button
          className="rounded-lg border border-lime-300/20 bg-lime-300/[0.045] px-3 py-2 text-[11px] font-semibold text-lime-200 transition hover:border-lime-200/45 hover:bg-lime-300/10 hover:text-lime-100"
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
  detail,
  footnote,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  footnote: string;
  icon: typeof BriefcaseBusiness;
  tone: Tone;
}) {
  const style = toneStyles[tone];
  return (
    <article className="carbon-card rounded-2xl p-5">
      <div className="flex items-start justify-between gap-3">
        <span
          className={`grid size-10 place-items-center rounded-xl border border-current/20 bg-current/10 ${style.icon}`}
        >
          <Icon className="size-[18px]" />
        </span>
        <StatusBadge tone={tone}>{detail}</StatusBadge>
      </div>
      <p className="mt-5 text-sm font-medium text-slate-400">{label}</p>
      <p className="mt-1 font-mono text-[32px] font-semibold leading-none tracking-[-0.08em] text-lime-100">
        {value}
      </p>
      <p className="mt-4 text-[11px] text-slate-600">{footnote}</p>
    </article>
  );
}

function JobStatus({ status }: { status: JobStatus }) {
  const tone: Tone =
    status === "In corso"
      ? "lime"
      : status === "BLOCCATA" || status === "ANNULLATA"
        ? "red"
        : status === "Completata" || status === "CHIUSA"
          ? "amber"
          : "cyan";
  return <StatusBadge tone={tone}>{status.toUpperCase()}</StatusBadge>;
}

function ActivityState({ state }: { state: JobActivity["state"] }) {
  if (state === "done")
    return (
      <span className="grid size-7 place-items-center rounded-full border border-lime-300/30 bg-lime-300/10 text-lime-200">
        <Check className="size-3.5" />
      </span>
    );
  if (state === "active")
    return (
      <span className="grid size-7 place-items-center rounded-full border border-cyan-300/30 bg-cyan-300/10 text-cyan-200">
        <Activity className="size-3.5" />
      </span>
    );
  return (
    <span className="grid size-7 place-items-center rounded-full border border-white/10 bg-black/25 text-slate-600">
      <span className="size-1.5 rounded-full bg-current" />
    </span>
  );
}

function priorityLabel(value: OperationsJob["priority"]) {
  return value === "HIGH" ? "Alta" : value === "LOW" ? "Bassa" : "Standard";
}

function resourceKindLabel(value: string) {
  const labels: Record<string, string> = {
    ASSET: "Asset",
    EQUIPMENT: "Attrezzatura",
    VEHICLE: "Mezzo",
    WORKFORCE: "Personale",
    OPERATOR: "Operatore",
  };
  return labels[value.trim().toUpperCase()] ?? value.replaceAll("_", " ");
}

function jobsFromAdapter(records: OperationsAdapterRecord[]): OperationsJob[] {
  return records.map((record) => {
    const payload = record.payload ?? {};
    const detailParts = record.detail.split(" · ");
    const location =
      (typeof payload.worksite === "string" && payload.worksite.trim()) ||
      (typeof payload.location === "string" && payload.location.trim()) ||
      detailParts[0] ||
      record.detail;
    const assignment =
      payload.assignment &&
      typeof payload.assignment === "object" &&
      !Array.isArray(payload.assignment)
        ? (payload.assignment as Record<string, unknown>)
        : null;
    const team =
      (typeof assignment?.team === "string" && assignment.team.trim()) ||
      (typeof assignment?.responsible === "string" && assignment.responsible.trim()) ||
      "Da assegnare";
    const statusCode = normalizeJobStatus(payload.statusCode ?? record.status);
    const statusLabel = jobStatusLabel(statusCode);
    const status: JobStatus =
      statusLabel === "IN CORSO"
        ? "In corso"
        : statusLabel === "PIANIFICATA"
          ? "Pianificata"
          : statusLabel === "COMPLETATA"
            ? "Completata"
            : (statusLabel as JobStatus);
    const canonicalCode =
      record.canonicalCode ??
      (record.id.startsWith("OP-") ? `#${record.id.slice(3)}` : record.id);
    const originalTitle =
      typeof payload.title === "string" && payload.title !== record.title
        ? payload.title
        : record.title;
    const rawActivities = Array.isArray(payload.activities)
      ? payload.activities
      : [];
    const activities = rawActivities.flatMap((activity, index) => {
      if (!activity || typeof activity !== "object") return [];
      const item = activity as Record<string, unknown>;
      const label =
        typeof item.title === "string"
          ? item.title
          : typeof item.label === "string"
            ? item.label
            : "Attività operativa";
      return [
        {
          label,
          detail:
            typeof item.detail === "string"
              ? item.detail
              : "Attività collegata alla commessa",
          state:
            item.state === "done" ||
            item.state === "active" ||
            item.state === "blocked"
              ? item.state
              : "queued",
          owner: typeof item.owner === "string" ? item.owner : "Da assegnare",
          key: `${record.id}-activity-${index}`,
        } as JobActivity,
      ];
    });
    return {
      id: canonicalCode,
      sourceId: record.id,
      title: originalTitle,
      description:
        typeof payload.description === "string" ? payload.description : "",
      client: typeof payload.client === "string" ? payload.client : "—",
      location: location || record.detail,
      team: team || "—",
      status,
      statusCode,
      progress: Math.max(0, Math.min(100, Number(record.progress) || 0)),
      due:
        typeof payload.dueDate === "string"
          ? payload.dueDate
          : record.meta || "—",
      category:
        typeof payload.category === "string"
          ? payload.category
          : "Da classificare",
      priority:
        payload.priority === "HIGH" || payload.priority === "LOW"
          ? payload.priority
          : "STANDARD",
      version: typeof payload.version === "number" ? payload.version : 1,
      activities,
    };
  });
}

export default function OperationsPage() {
  const router = useRouter();
  const authority = useAuthorityAccess();
  const canWriteOperations = authority.capabilities.has("operations.write");
  const visibleNavItems = navItems.filter((item) =>
    authority.capabilities.has(item.capability),
  );
  const allowedNavigation = getAllowedCommandNavigation([
    ...authority.capabilities,
  ]).map((item) => item.id);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [filter, setFilter] = useState<JobFilter>("TUTTE");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [newJobOpen, setNewJobOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [adapterJobs, setAdapterJobs] = useState<OperationsJob[] | null>(null);
  const [adapterStatus, setAdapterStatus] = useState<
    "loading" | "online" | "empty" | "error"
  >("loading");
  const [lastReadbackAt, setLastReadbackAt] = useState("");
  const activeJobs = adapterJobs ?? jobs;
  const adapterOnline = adapterStatus === "online";

  const loadOperations = useCallback(async () => {
    try {
      invalidateReadback("s04:operations");
      const payload = await readback<OperationsAdapterResponse>(
        "s04:operations",
        "/api/operations",
        { force: true },
      );
      const records = Array.isArray(payload.records) ? payload.records : [];
      const nextJobs = records.length ? jobsFromAdapter(records) : [];
      setAdapterJobs(nextJobs);
      setSelectedId((current) => current || nextJobs[0]?.id || "");
      setAdapterStatus(records.length ? "online" : "empty");
      setLastReadbackAt(new Date().toISOString());
    } catch {
      setAdapterJobs([]);
      setAdapterStatus("error");
      setLastReadbackAt(new Date().toISOString());
    }
  }, [setAdapterJobs, setAdapterStatus, setLastReadbackAt, setSelectedId]);

  useEffect(() => {
    const request = window.setTimeout(() => { void loadOperations(); }, 0);
    return () => window.clearTimeout(request);
  }, [loadOperations]);

  const filteredJobs = useMemo(
    () =>
      activeJobs.filter((job) => {
        const matchesFilter =
          filter === "TUTTE" ||
          (filter === "IN CORSO" && job.status === "In corso") ||
          (filter === "PIANIFICATE" &&
            ["Pianificata", "PROPOSTA", "APPROVATA"].includes(job.status)) ||
          (filter === "COMPLETATE" &&
            ["Completata", "CHIUSA"].includes(job.status)) ||
          (filter === "BOZZE" && job.status === "BOZZA") ||
          (filter === "BLOCCATE" && job.status === "BLOCCATA");
        const haystack =
          `${job.id} ${job.title} ${job.location} ${job.team} ${job.category}`.toLowerCase();
        return matchesFilter && haystack.includes(query.trim().toLowerCase());
      }),
    [activeJobs, filter, query],
  );

  const selectedJob =
    activeJobs.find((job) => job.id === selectedId) ?? emptyJob;
  const [planningOptions, setPlanningOptions] =
    useState<PlanningOptionsResponse | null>(null);
  const [planningOptionsJobId, setPlanningOptionsJobId] = useState("");
  const planningReadbackKey = `planning-options:${selectedJob.id}`;
  const resourceOptions = useMemo(() => {
    if (planningOptionsJobId !== selectedJob.id || !planningOptions?.options) return [];
    return [
      ...(planningOptions.options.workforce ?? []),
      ...(planningOptions.options.assets ?? []),
    ];
  }, [planningOptions, planningOptionsJobId, selectedJob.id]);

  useEffect(() => {
    if (selectedJob.id === "EMPTY") return;
    let active = true;
    const reference = encodeURIComponent(selectedJob.sourceId ?? selectedJob.id);
    readback<PlanningOptionsResponse>(
      planningReadbackKey,
      `/api/operations/jobs/${reference}/planning/resource-options`,
      { force: true },
    )
      .then((payload) => {
        if (!active) return;
        setPlanningOptions(payload);
        setPlanningOptionsJobId(selectedJob.id);
      })
      .catch(() => {
        if (!active) return;
        setPlanningOptions(null);
        setPlanningOptionsJobId(selectedJob.id);
      });
    return () => {
      active = false;
    };
  }, [planningReadbackKey, selectedJob.id, selectedJob.sourceId]);
  const activeCount = activeJobs.filter(
    (job) => job.status === "In corso",
  ).length;
  const plannedCount = activeJobs.filter((job) =>
    ["Pianificata", "PROPOSTA", "APPROVATA"].includes(job.status),
  ).length;
  const activityCount = activeJobs.reduce(
    (total, job) => total + job.activities.length,
    0,
  );
  const openReports = activeJobs.filter(
    (job) =>
      job.status !== "Completata" &&
      job.status !== "CHIUSA" &&
      job.status !== "ANNULLATA",
  ).length;

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  };

  const handleIntakeCreated = (payload: IntakeCreateResponse) => {
    invalidateReadback("s04:operations");
    const records = Array.isArray(payload.records) ? payload.records : [];
    const nextJobs = records.length ? jobsFromAdapter(records) : [];
    setAdapterJobs(nextJobs);
    setAdapterStatus("online");
    const createdJob = payload.created
      ? jobsFromAdapter([payload.created])[0]
      : undefined;
    if (createdJob) setSelectedId(createdJob.id);
    notify(
      `Commessa ${createdJob?.id ?? "nuova"} salvata in bozza · pronta per la revisione`,
    );
  };

  const navigate = (id: string, label: string) => {
    setMobileMenu(false);
    const destinations: Record<string, string> = {
      command: "/",
      operations: "/operations",
      workforce: "/workforce",
      planning: "/planning",
      attendance: "/presenze",
      finance: "/finance",
      procurement: "/procurement",
      assets: "/assets",
      warehouse: "/warehouse",
      mission: "/mission",
      documents: "/documents",
      governance: "/governance",
      communications: "/communications",
      externals: "/externals",
      authority: "/onboarding",
      qr: "/qr",
      events_authority: "/events",
      events: "/events",
      pwa: "/pwa/diagnostics",
      settings: "/settings",
    };
    const destination = destinations[id];
    if (destination) {
      router.push(destination);
      return;
    }
    notify(`${label}: sezione non disponibile nel perimetro autorizzato`);
  };

  const readbackTimeLabel = lastReadbackAt
    ? new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit" }).format(new Date(lastReadbackAt))
    : adapterStatus === "loading"
      ? "Aggiornamento in corso"
      : "Non disponibile";
  const operationalFlow = [
    { id: "operations", label: "Commesse", detail: `${activeJobs.length} visibili`, icon: BriefcaseBusiness, state: adapterOnline ? "AGGIORNATO" : "IN ATTESA", path: "/operations", capability: "operations.read" },
    { id: "planning", label: "Pianificazione", detail: "Attività e risorse", icon: CalendarClock, state: authority.capabilities.has("planning.read") ? "PRONTO" : "LIMITATO", path: "/planning", capability: "planning.read" },
    { id: "workforce", label: "Presenze", detail: "Turni e squadre", icon: Clock3, state: authority.capabilities.has("workforce.read") ? "PRONTO" : "LIMITATO", path: "/presenze", capability: "workforce.read" },
    { id: "mission", label: "Trasporti", detail: "Trasporto e consegna", icon: Truck, state: authority.capabilities.has("mission.read") ? "PRONTO" : "LIMITATO", path: "/mission", capability: "mission.read" },
    { id: "warehouse", label: "Magazzino", detail: "Materiali e stock", icon: Package, state: authority.capabilities.has("warehouse.read") ? "PRONTO" : "LIMITATO", path: "/warehouse", capability: "warehouse.read" },
  ].filter((node) => authority.capabilities.has(node.capability));

  return (
    <main className="zw-app-shell zw-command-ultra min-h-screen overflow-x-hidden text-slate-100 selection:bg-lime-300 selection:text-[#060806]">
      <div className="zw-command-ambient" aria-hidden="true" />
      <div className="relative flex min-h-screen">
        <aside
          aria-label="Navigazione principale"
          className={`zw-command-sidebar fixed inset-y-0 left-0 z-40 flex flex-col px-3 py-4 transition-[width,transform] lg:static lg:translate-x-0 ${sidebarCollapsed ? "is-collapsed lg:w-[76px]" : "lg:w-[248px]"} ${mobileMenu ? "translate-x-0" : "-translate-x-full"}`}
        >
          <div className="flex items-center justify-between px-2">
            <button
              aria-label="Apri Command"
              className="flex min-w-0 items-center gap-3 text-left"
              onClick={() => {
                setMobileMenu(false);
                router.push("/command");
              }}
              type="button"
            >
              <span className="neon-pulse relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black shadow-[0_0_22px_rgba(200,255,34,.12)]"><Image src="/ai-zerow-icon.jpeg" alt="AI-ZEROW" width={40} height={40} className="size-full object-cover" /></span>
              <span className="zw-command-sidebar__brand-copy min-w-0">
                <span className="block text-sm font-bold tracking-[0.18em] text-slate-50">
                  AI-ZEROW
                </span>
                <span className="block text-[10px] uppercase tracking-[0.22em] text-lime-300/75">
                  command
                </span>
              </span>
            </button>
            <div className="flex items-center gap-1">
              <button aria-label={sidebarCollapsed ? "Espandi sidebar" : "Riduci sidebar"} className="zw-command-sidebar__collapse hidden size-8 place-items-center rounded-lg text-slate-500 hover:bg-lime-300/10 hover:text-lime-200 lg:grid" onClick={() => setSidebarCollapsed((value) => !value)} type="button">{sidebarCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}</button>
              <button className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-white/5 hover:text-white lg:hidden" onClick={() => setMobileMenu(false)} type="button" aria-label="Chiudi menu"><X className="size-4" /></button>
            </div>
          </div>
          <button
            className="zw-command-tenant mt-7 flex w-full items-center gap-3 rounded-2xl p-3 text-left transition hover:border-lime-300/25"
            type="button"
            onClick={() =>
              notify(
                `Azienda ZEROW · contesto ${ROLE_METADATA[authority.role].label}`,
              )
            }
          >
            <span className="grid size-8 place-items-center rounded-lg border border-lime-300/20 bg-lime-300/10 text-lime-200">
              <HardHat className="size-4" />
            </span>
            <span className="zw-command-sidebar__tenant-copy min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-slate-200">
                Azienda ZEROW
              </span>
              <span className="mt-0.5 block truncate text-[10px] text-slate-600">
                {ROLE_METADATA[authority.role].label} · profilo operativo
              </span>
            </span>
            <ChevronRight className="size-3.5 text-slate-600" />
          </button>
          <nav className="mt-6 min-h-0 flex-1 overflow-y-auto" aria-label="Navigazione principale">
            <p className="zw-command-sidebar__nav-caption px-3 text-[9px] font-semibold uppercase tracking-[0.22em] text-slate-700">
              Area autorizzata
            </p>
            <div className="mt-2 space-y-1">
              {visibleNavItems.map((item) => {
                const Icon = item.icon;
                const active = item.id === "operations";
                return (
                  <button
                    aria-current={active ? "page" : undefined}
                    aria-label={sidebarCollapsed ? item.label : undefined}
                    title={sidebarCollapsed ? item.label : undefined}
                    className={`zw-command-nav-item ${active ? "is-active" : ""}`}
                    key={item.id}
                    onClick={() => navigate(item.id, item.label)}
                    type="button"
                  >
                    <Icon
                      className={`size-4 ${active ? "text-lime-200" : "text-slate-600 group-hover:text-slate-300"}`}
                    />
                    <span className="zw-command-sidebar__nav-label">{item.label}</span>
                    {item.id === "command" && (
                      <span className="zw-command-sidebar__nav-badge ml-auto rounded border border-lime-300/20 px-1.5 py-0.5 font-mono text-[8px] tracking-[0.08em] text-lime-200">
                        AI
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </nav>
          <div className="zw-command-sidebar__footer mt-4 border-t border-white/[0.07] pt-4">
            <div className="flex items-center justify-between px-2 text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-600">
              <span>Sistema</span>
              <span className="flex items-center gap-1.5 text-lime-200">
                <span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_8px_rgba(190,255,60,0.8)]" />
                {adapterOnline ? "DATI AGGIORNATI" : adapterStatus === "loading" ? "AGGIORNAMENTO" : "IN ATTESA"}
              </span>
            </div>
            <div className="zw-command-core-status mt-3 rounded-xl p-3">
              <div className="flex items-center gap-2 text-[10px] text-slate-400">
                <Activity className="size-3.5 text-lime-300" />
                Area commesse
              </div>
              <p className="mt-2 font-mono text-[10px] text-slate-600">
                {activeJobs.length} COMMESSE
              </p>
              <p className="mt-3 font-mono text-[10px] text-lime-300/60">
                PROFILO / {ROLE_METADATA[authority.role].label.toUpperCase()}
              </p>
            </div>
          </div>
        </aside>
        {mobileMenu && (
          <button
            className="zw-command-sidebar-backdrop fixed inset-0 z-[100] bg-black/75 backdrop-blur-sm lg:hidden"
            onClick={() => setMobileMenu(false)}
            aria-label="Chiudi menu"
            type="button"
          />
        )}
        <section className="min-w-0 flex-1">
          <header className="zw-command-topbar sticky top-0 z-20 flex h-[72px] items-center gap-3 px-4 sm:gap-5 sm:px-7">
            <IconButton label="Apri menu" onClick={() => setMobileMenu(true)} className="lg:hidden"><Menu className="size-4" /></IconButton>
            <button aria-label="Apri Commesse" className="zw-command-topbar__brand flex shrink-0 items-center gap-2 text-left" onClick={() => router.push("/operations")} type="button"><span className="relative grid size-9 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black shadow-[0_0_18px_rgba(200,255,34,.12)]"><Image src="/ai-zerow-icon.jpeg" alt="ZEROW" width={36} height={36} className="size-full object-cover" /></span><span className="zw-command-topbar__wordmark hidden sm:block"><span className="block text-[11px] font-bold tracking-[0.18em] text-slate-50">ZEROW</span><span className="block text-[9px] uppercase tracking-[0.2em] text-lime-300/75">commesse</span></span></button>
            <IconButton className="hidden lg:grid" label={sidebarCollapsed ? "Espandi sidebar" : "Riduci sidebar"} onClick={() => setSidebarCollapsed((value) => !value)}>{sidebarCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}</IconButton>
            <div className="relative hidden min-w-0 flex-1 justify-center md:flex"><div className="relative w-full max-w-[520px]"><Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-600" /><Input aria-label="Cerca nelle commesse" className="h-10 w-full border-lime-300/10 bg-black/35 pl-10 text-xs text-slate-100 placeholder:text-slate-600" onChange={(event) => setQuery(event.target.value)} placeholder="Cerca nome, cliente, luogo…" value={query} /></div></div>
            <div className="flex min-w-0 flex-1 items-center gap-2 md:hidden">
              <span className="truncate text-xs font-semibold tracking-[0.14em] text-slate-200">COMMESSE</span>
              <span className="size-1 rounded-full bg-lime-300" />
            </div>
            <div className="ml-auto flex items-center gap-2">
              <TenantSwitcher />
              <span className="hidden items-center gap-2 rounded-full border border-lime-300/20 bg-lime-300/5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-lime-200 sm:flex">
                <span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_9px_rgba(190,255,60,0.9)]" />
                {adapterStatus === "loading" ? "AGGIORNAMENTO" : adapterOnline ? "DATI AGGIORNATI" : adapterStatus === "error" ? "ERRORE DATI" : "IN ATTESA"}
              </span>
              <IconButton className="zw-command-topbar__back hidden sm:grid" label="Torna indietro" onClick={() => router.back()}><ArrowLeft className="size-4" /></IconButton>
              <IconButton className="zw-command-topbar__refresh" label="Aggiorna commesse" onClick={() => { setAdapterStatus("loading"); void loadOperations(); }}><RefreshCw className={adapterStatus === "loading" ? "size-4 animate-spin" : "size-4"} /></IconButton>
              {authority.capabilities.has("communication.read") ? <IconButton className="zw-command-topbar__notifications" label="Apri comunicazioni" onClick={() => router.push("/communications")}><Bell className="size-4" /></IconButton> : null}
              <AccountMenu actor={authority.actor} />
            </div>
          </header>
          <div className="mx-auto max-w-[1680px] px-4 py-5 sm:px-7 sm:py-7">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/70">
                  <span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_9px_rgba(190,255,60,0.9)]" />
                  COMMESSE / REGISTRO
                </div>
                <h1 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-50 sm:text-[28px]">
                  Commesse
                </h1>
                <p className="mt-1 text-xs text-slate-500">
                  Clienti, cantieri, attività e avanzamento in un’unica vista · {adapterOnline ? "dati aggiornati" : "aggiornamento in corso"}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="hidden items-center rounded-xl border border-white/[0.1] bg-black/25 px-3.5 py-2.5 font-mono text-[10px] text-slate-500 sm:inline-flex">
                  <Clock3 className="mr-2 size-3.5 text-lime-300" />
                  Aggiornato {readbackTimeLabel}
                </span>
                {canWriteOperations && (
                  <Button
                    aria-expanded={newJobOpen}
                    aria-haspopup="dialog"
                    className="h-12 rounded-xl border-lime-100/55 px-5 text-sm shadow-[0_0_30px_rgba(190,255,60,0.18)]"
                    onClick={(event) => {
                      event.preventDefault();
                      setNewJobOpen(true);
                    }}
                    type="button"
                  >
                    <Plus className="size-4" />
                    Nuova commessa
                  </Button>
                )}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label="Commesse attive"
                value={String(activeCount)}
                detail={adapterOnline ? "Dati aggiornati" : "In attesa"}
                footnote={adapterOnline ? "Stato in corso" : "Nessuna commessa ancora presente"}
                icon={BriefcaseBusiness}
                tone="lime"
              />
              <MetricCard
                label="In pianificazione"
                value={String(plannedCount)}
                detail={adapterOnline ? "Piani attivi" : "In attesa"}
                footnote={adapterOnline ? "Proposte, approvate e pianificate" : "Nessun piano ancora presente"}
                icon={CalendarClock}
                tone="cyan"
              />
              <MetricCard
                label="Attività collegate"
                value={String(activityCount)}
                detail={adapterOnline ? "Per commessa" : "Nessun dato"}
                footnote={adapterOnline ? "Attività già presenti nelle schede" : "Le attività nasceranno dalla scheda"}
                icon={ClipboardCheck}
                tone="lime"
              />
              <MetricCard
                label="Rapportini aperti"
                value={String(openReports)}
                detail={adapterOnline ? "Stato operativo" : "Nessun dato"}
                footnote={adapterOnline ? "Commesse non ancora chiuse" : "Disponibile dalla scheda"}
                icon={FileText}
                tone="amber"
              />
            </div>
            <div className="mt-4 grid gap-4 2xl:grid-cols-[minmax(0,1.15fr)_minmax(380px,0.85fr)]">
              <section className="carbon-card rounded-2xl p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <SectionTitle
                      eyebrow="REGISTRO OPERATIVO"
                      title="Registro commesse"
                    />
                    <p className="mt-1 text-[11px] text-slate-500">
                      {adapterOnline
                        ? "Tutte le commesse dell’azienda, con stato e prossima azione."
                        : "Le commesse compariranno qui appena disponibili."}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {adapterOnline ? (
                      <StatusBadge tone="lime">DATI AGGIORNATI</StatusBadge>
                    ) : (
                      <StatusBadge tone="cyan">IN ATTESA</StatusBadge>
                    )}
                    <IconButton
                      label="Impostazioni registro"
                      onClick={() =>
                        notify(
                          "I filtri avanzati saranno disponibili qui a breve.",
                        )
                      }
                    >
                      <Settings2 className="size-4" />
                    </IconButton>
                  </div>
                </div>
                <div className="mt-4 overflow-x-auto">
                  <Tabs
                    value={filter}
                    onValueChange={(value) => setFilter(value as JobFilter)}
                  >
                    <TabsList className="h-9 min-w-max rounded-lg border border-white/10 bg-black/55 p-1">
                      <TabsTrigger
                        className="h-7 rounded-md px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]"
                        value="TUTTE"
                      >
                        Tutte
                      </TabsTrigger>
                      <TabsTrigger
                        className="h-7 rounded-md px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]"
                        value="IN CORSO"
                      >
                        In corso
                      </TabsTrigger>
                      <TabsTrigger
                        className="h-7 rounded-md px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]"
                        value="PIANIFICATE"
                      >
                        Pianificate
                      </TabsTrigger>
                      <TabsTrigger
                        className="h-7 rounded-md px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]"
                        value="BOZZE"
                      >
                        Bozze
                      </TabsTrigger>
                      <TabsTrigger
                        className="h-7 rounded-md px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]"
                        value="BLOCCATE"
                      >
                        Bloccate
                      </TabsTrigger>
                      <TabsTrigger
                        className="h-7 rounded-md px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]"
                        value="COMPLETATE"
                      >
                        Completate
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
                <div className="mt-4 overflow-hidden rounded-xl border border-white/[0.08] bg-black/20">
                  <div className="hidden grid-cols-[1.15fr_0.85fr_0.7fr_0.45fr] gap-3 border-b border-white/[0.08] px-4 py-3 text-[9px] font-semibold uppercase tracking-[0.15em] text-slate-600 md:grid">
                    <span>Commessa</span>
                    <span>Responsabile</span>
                    <span>Stato</span>
                    <span>Avanzamento</span>
                  </div>
                  <div className="divide-y divide-white/[0.07]">
                    {filteredJobs.map((job) => {
                      const active = selectedJob.id === job.id;
                      return (
                        <button
                          key={job.id}
                          className={`grid w-full gap-3 px-4 py-3 text-left transition md:grid-cols-[1.15fr_0.85fr_0.7fr_0.45fr] md:items-center ${active ? "bg-lime-300/[0.07]" : "hover:bg-white/[0.035]"}`}
                          onClick={() => setSelectedId(job.id)}
                          type="button"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <span
                              className={`grid size-9 shrink-0 place-items-center rounded-xl border ${active ? "border-lime-300/35 bg-lime-300/10 text-lime-200" : "border-white/10 bg-black/30 text-slate-500"}`}
                            >
                              <BriefcaseBusiness className="size-4" />
                            </span>
                            <span className="min-w-0">
                              <span className="flex items-center gap-2">
                                <span className="font-mono text-[11px] text-lime-200">
                                  {job.id}
                                </span>
                                <span className="truncate text-xs font-medium text-slate-200">
                                  {job.title}
                                </span>
                              </span>
                              <span className="mt-1 block truncate text-[11px] text-slate-500">
                                {job.location} · {job.category}
                              </span>
                            </span>
                          </div>
                          <div className="flex items-center gap-2 pl-12 md:pl-0">
                            <span className="size-1.5 rounded-full bg-lime-300" />
                            <span className="text-xs text-slate-400">
                              {job.team}
                            </span>
                          </div>
                          <div className="pl-12 md:pl-0">
                            <JobStatus status={job.status} />
                          </div>
                          <div className="pl-12 md:pl-0">
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 min-w-[54px] flex-1 overflow-hidden rounded-full bg-white/10">
                                <div
                                  className="h-full rounded-full bg-lime-300 shadow-[0_0_10px_rgba(190,255,60,0.55)]"
                                  style={{ width: `${job.progress}%` }}
                                />
                              </div>
                              <span className="font-mono text-[10px] text-slate-400">
                                {job.progress}%
                              </span>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                    {filteredJobs.length === 0 && (
                      <div className="px-4 py-10 text-center text-xs text-slate-500">
                        Nessuna commessa corrisponde ai filtri selezionati.
                      </div>
                    )}
                  </div>
                </div>
              </section>
              <section className="carbon-card carbon-card-neon rounded-2xl p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <SectionTitle
                      eyebrow="COMMESSA SELEZIONATA"
                      title={selectedJob.title}
                    />
                    <p className="mt-1 text-xs text-slate-500">
                      {selectedJob.title} · {selectedJob.location}
                    </p>
                  </div>
                  <button
                    className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-lime-300 hover:text-lime-100"
                    onClick={() =>
                      adapterOnline
                        ? router.push(
                            `/operations/${encodeURIComponent(selectedJob.sourceId ?? selectedJob.id)}`,
                          )
                        : notify(
                            "Il dettaglio sarà disponibile quando la commessa sarà caricata.",
                          )
                    }
                    type="button"
                  >
                    Apri scheda <ArrowUpRight className="size-3.5" />
                  </button>
                </div>
                <div className="mt-5 flex flex-wrap items-center gap-2">
                  <JobStatus status={selectedJob.status} />
                  <StatusBadge
                    tone={
                      selectedJob.priority === "HIGH"
                        ? "red"
                        : selectedJob.priority === "STANDARD"
                          ? "cyan"
                          : "amber"
                    }
                  >
                    {priorityLabel(selectedJob.priority)}
                  </StatusBadge>
                  <span className="rounded-full border border-white/10 px-2 py-1 text-[10px] text-slate-500">
                    {selectedJob.due}
                  </span>
                </div>
                <div className="carbon-inset mt-5 rounded-xl p-4">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.14em] text-slate-600">
                        Avanzamento
                      </p>
                      <p className="mt-1 font-mono text-3xl font-semibold tracking-[-0.07em] text-slate-50">
                        {selectedJob.progress}%
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[11px] text-slate-500">Responsabile</p>
                      <p className="mt-1 text-xs font-medium text-lime-200">
                        {selectedJob.team}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-lime-300 shadow-[0_0_16px_rgba(190,255,60,0.64)]"
                      style={{ width: `${selectedJob.progress}%` }}
                    />
                  </div>
                  <div className="mt-2 flex justify-between text-[10px] text-slate-600">
                    <span>Avvio</span>
                    <span>Chiusura</span>
                  </div>
                </div>
                <div className="mt-5 space-y-3">
                  {selectedJob.activities.map((activity) => (
                    <div
                      className="flex items-center gap-3"
                      key={activity.label}
                    >
                      <ActivityState state={activity.state} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-slate-200">
                          {activity.label}
                        </p>
                        <p className="mt-1 truncate text-[11px] text-slate-500">
                          {activity.detail}
                        </p>
                      </div>
                      <span className="hidden text-[10px] text-slate-600 sm:block">
                        {activity.owner}
                      </span>
                    </div>
                  ))}
                </div>
                {canWriteOperations && (
                  <div className="mt-5 grid grid-cols-2 gap-2">
                    <Button
                      variant="outline"
                      className="h-9 border-white/10 bg-black/20 text-xs text-slate-300 hover:border-lime-300/30 hover:bg-lime-300/10 hover:text-lime-100"
                      onClick={() => selectedJob.id === "EMPTY"
                        ? notify("Seleziona una commessa riletta prima di pianificare")
                        : router.push(`/planning?jobId=${encodeURIComponent(selectedJob.sourceId ?? selectedJob.id)}&create=1`)}
                    >
                      <CalendarClock className="size-3.5" />
                      Pianifica
                    </Button>
                    <Button
                      className="h-9 bg-lime-300 text-xs font-semibold text-[#060806] hover:bg-lime-200"
                      onClick={() => selectedJob.id === "EMPTY"
                        ? notify("Seleziona una commessa riletta prima di aprire il rapportino")
                        : router.push(`/operations/${encodeURIComponent(selectedJob.sourceId ?? selectedJob.id)}#rapportino`)}
                    >
                      <FileText className="size-3.5" />
                      Rapportino
                    </Button>
                  </div>
                )}
              </section>
            </div>
            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)_minmax(300px,0.75fr)]">
              <section className="carbon-card rounded-2xl p-4 sm:p-5">
                <SectionTitle
                  eyebrow="ATTIVITÀ"
                  title="Attività operative"
                  action="Apri scheda"
                  onAction={() => selectedJob.id === "EMPTY"
                    ? notify("Seleziona una commessa riletta prima di aprire le attività")
                    : router.push(`/operations/${encodeURIComponent(selectedJob.sourceId ?? selectedJob.id)}#attivita`)}
                />
                <div className="mt-4 space-y-3">
                  {selectedJob.activities.length ? (
                    selectedJob.activities.map((activity) => (
                      <div
                        className="carbon-inset flex items-center gap-3 rounded-xl p-3"
                        key={`contract-${activity.label}`}
                      >
                        <ActivityState state={activity.state} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-slate-200">
                            {activity.label}
                          </p>
                          <p className="mt-1 truncate text-[11px] text-slate-500">
                            {activity.detail}
                          </p>
                        </div>
                        <ChevronRight className="size-4 text-slate-600" />
                      </div>
                    ))
                  ) : (
                    <div className="py-6 text-center text-xs text-slate-500">
                      Nessuna attività collegata.
                    </div>
                  )}
                </div>
              </section>
              <section className="carbon-card rounded-2xl p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <SectionTitle
                    eyebrow="PIANIFICAZIONE / RISORSE"
                    title="Risorse verificabili"
                  />
                  <StatusBadge tone={resourceOptions.length ? "lime" : "cyan"}>{resourceOptions.length ? "DISPONIBILI" : "DA VERIFICARE"}</StatusBadge>
                </div>
                {resourceOptions.length ? (
                  <div className="mt-4 space-y-2">
                    {resourceOptions.slice(0, 4).map((resource) => (
                      <div className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2.5" key={resource.id}>
                        <span className="grid size-8 place-items-center rounded-lg border border-lime-300/20 bg-lime-300/[0.07] text-lime-200"><Users className="size-3.5" /></span>
                        <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-slate-200">{resource.label}</p><p className="mt-0.5 text-[10px] uppercase tracking-[0.1em] text-slate-600">{resourceKindLabel(resource.kind)}</p></div>
                        <span className={`text-[9px] font-semibold uppercase tracking-[0.08em] ${resource.availableForWindow === false ? "text-amber-200" : resource.assignable ? "text-lime-200" : "text-slate-500"}`}>{resource.availableForWindow === false ? `Occupata${resource.availabilityConflict?.title ? ` · ${resource.availabilityConflict.title}` : ""}` : resource.assignable ? "Disponibile" : "Non assegnabile"}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-4 rounded-xl border border-dashed border-white/10 px-3 py-6 text-center text-xs text-slate-500">Apri Pianifica per verificare personale e asset realmente assegnabili.</div>
                )}
                <div className="mt-5 border-t border-white/[0.08] pt-4">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-500">Controllo disponibilità</span>
                    <span className="font-mono text-slate-600">{resourceOptions.length || "—"} risorse disponibili</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-lime-300 to-cyan-300" style={{ width: `${Math.min(100, resourceOptions.length * 16)}%` }} /></div>
                </div>
              </section>
              <section className="carbon-card rounded-2xl p-4 sm:p-5">
                <SectionTitle
                  eyebrow="DAILY REPORT"
                  title="Rapportino giornaliero"
                />
                <div className="carbon-inset mt-4 rounded-xl p-4">
                  <div className="flex items-start gap-3">
                    <span className="grid size-9 place-items-center rounded-xl border border-amber-300/25 bg-amber-300/10 text-amber-200">
                      <FileText className="size-4" />
                    </span>
                    <div>
                      <p className="text-xs font-semibold text-slate-200">
                        {selectedJob.id === emptyJob.id
                          ? "Nessuna commessa selezionata"
                          : `${selectedJob.title} · da completare`}
                      </p>
                      <p className="mt-1 text-[11px] leading-5 text-slate-500">
                        {selectedJob.id === emptyJob.id
                          ? "Apri una commessa per preparare il rapportino."
                          : "Completa il rapportino nella scheda della commessa."}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2 text-center">
                    <div className="rounded-lg border border-white/10 bg-black/25 px-2 py-2">
                      <p className="font-mono text-lg text-slate-100">—</p>
                      <p className="text-[10px] text-slate-600">presenza</p>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-black/25 px-2 py-2">
                      <p className="font-mono text-lg text-lime-200">—</p>
                      <p className="text-[10px] text-slate-600">avanzamento</p>
                    </div>
                  </div>
                </div>
                {canWriteOperations && (
                  <Button
                    variant="outline"
                    className="mt-4 h-9 w-full border-lime-300/25 bg-lime-300/5 text-xs text-lime-200 hover:bg-lime-300/10"
                    onClick={() => selectedJob.id === emptyJob.id
                      ? notify("Seleziona una commessa per preparare il rapportino")
                      : router.push(`/operations/${encodeURIComponent(selectedJob.sourceId ?? selectedJob.id)}#rapportino`)}
                  >
                    <ClipboardCheck className="size-3.5" />
                    Prepara rapportino
                  </Button>
                )}
              </section>
            </div>
            <section className="carbon-card mt-4 rounded-2xl p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-lime-300/70">PROSSIMI PASSI</p>
                  <h2 className="mt-1 text-[15px] font-semibold text-slate-100">Dalla commessa al lavoro</h2>
                  <p className="mt-1 text-[11px] text-slate-500">Apri il passaggio che vuoi completare: tutto resta collegato alla commessa.</p>
                </div>
                <StatusBadge tone="lime">ACCESSO AUTORIZZATO</StatusBadge>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                {operationalFlow.map((node) => {
                  const Icon = node.icon;
                  return <button className="group flex min-w-0 items-center gap-3 rounded-xl border border-white/[0.08] bg-black/20 p-3 text-left transition hover:-translate-y-px hover:border-lime-300/30 hover:bg-lime-300/[0.045]" key={node.id} onClick={() => router.push(node.path)} type="button"><span className="grid size-9 shrink-0 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/[0.07] text-lime-200"><Icon className="size-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-slate-200">{node.label}</span><span className="mt-1 block truncate text-[10px] text-slate-600">{node.detail}</span></span><span className="shrink-0 text-[9px] font-semibold uppercase tracking-[0.08em] text-lime-200/75">{node.state}</span></button>;
                })}
              </div>
            </section>
            <section className="carbon-card mt-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl p-4 sm:p-5">
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-xl border border-lime-300/25 bg-lime-300/10 text-lime-200">
                  <ShieldCheck className="size-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-slate-100">
                    {adapterOnline
                      ? "Area commesse pronta"
                      : "Area commesse in attesa di dati"}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {adapterOnline
                      ? "Commesse e attività sono aggiornate; pianificazione e rapportini restano disponibili nella scheda."
                      : "Commesse, attività, pianificazione, risorse e rapportini saranno disponibili con i primi dati."}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {adapterOnline ? (
                  <StatusBadge>OPERATIVO</StatusBadge>
                ) : (
                  <StatusBadge>IN ATTESA</StatusBadge>
                )}
                <button
                  className="grid size-8 place-items-center rounded-lg border border-white/10 text-slate-500 hover:border-lime-300/30 hover:text-lime-200"
                  onClick={() =>
                    notify("Area operativa verificata")
                  }
                  type="button"
                  aria-label="Apri evidenze"
                >
                  <ArrowUpRight className="size-3.5" />
                </button>
              </div>
            </section>
            <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] py-5 text-[10px] text-slate-600">
              <span>
                {adapterOnline
                  ? "ZEROW · registro commesse"
                  : "ZEROW · area commesse"}
              </span>
              <span className="flex items-center gap-2">
                <span>sistema operativo</span>
                <span className="size-1 rounded-full bg-lime-300" />
                <span>
                  {adapterOnline ? "dati aggiornati" : "in attesa di dati"}
                </span>
              </span>
            </footer>
          </div>
        </section>
      </div>
      <CommandMobileNav
        active="operations"
        allowedNavigation={allowedNavigation}
        role={authority.role}
        roles={authority.roles}
      />
      {canWriteOperations && newJobOpen && (
        <OperationsCommessaIntake
          open={newJobOpen}
          onOpenChange={setNewJobOpen}
          onCreated={handleIntakeCreated}
        />
      )}
      {toast && (
        <div className="fixed bottom-5 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2 rounded-xl border border-lime-300/25 bg-[#0b1008]/95 px-4 py-3 text-xs text-lime-100 shadow-[0_0_30px_rgba(190,255,60,0.14)] backdrop-blur-xl">
          <CheckCircle2 className="size-4 text-lime-300" />
          {toast}
        </div>
      )}
    </main>
  );
}
