"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Bell,
  BookOpenCheck,
  BriefcaseBusiness,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  CircleGauge,
  Clock3,
  FileCheck2,
  Fingerprint,
  GitBranch,
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
  Target,
  TerminalSquare,
  X,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ReadinessStatus = "READY" | "NOT_RUN" | "NOT_CONFIGURED" | "BLOCKED";
type ViewKey = "overview" | "knowledge" | "scope" | "approvals" | "tools";

type Gate = {
  id: string;
  label: string;
  status: ReadinessStatus;
  detail: string;
  evidence: string;
  nextAction: string;
};

type Readiness = {
  contract?: { tranche?: string; commercialStatus?: string; directWrite?: boolean; approval?: string };
  authority?: {
    role?: string;
    identityProvider?: string;
    tenantScope?: string;
    governanceRead?: boolean;
    commandRead?: boolean;
    approvalsReview?: boolean;
  };
  runtime?: {
    provider?: string;
    configured?: boolean;
    model?: string;
    mode?: string;
    directWrite?: boolean;
    liveRequest?: string;
  };
  gates?: Gate[];
  ledger?: { count?: number; status?: ReadinessStatus; checkedAt?: string | null };
  external?: {
    status?: ReadinessStatus;
    persistedChecks?: number;
    openAiAdapterStatus?: ReadinessStatus;
    latestOpenAiHealth?: { result?: string; checkedAt?: string; evidence?: string } | null;
  };
  blockers?: string[];
  readback?: { checkedAt?: string };
};

type KnowledgeResult = {
  id: string;
  code: string;
  part: string;
  partTitle: string;
  description: string;
  unit: string;
  price: number;
  currency: string;
  breadcrumbs: Array<{ code: string; title: string }>;
  score: number;
};

type KnowledgePack = {
  id: string;
  name: string;
  version: string;
  language: string;
  authority: string;
  purpose: string;
  entryCount: number;
  parts: Array<{ part: string; title: string; entryCount: number }>;
  scopeContract: {
    linkKey: string;
    scopeField: string;
    contextEntryField: string;
    requiredHumanConfirmation: boolean;
  };
};

type KnowledgeResponse = {
  pack?: KnowledgePack;
  results?: KnowledgeResult[];
  readback?: { status?: string; count?: number; checkedAt?: string };
};

type OperationsJob = {
  id: string;
  canonicalCode?: string;
  title: string;
  detail?: string;
  meta?: string;
  status?: string;
  payload?: Record<string, unknown>;
};

type OperationsResponse = { records?: OperationsJob[] };

type ScopeSelection = {
  level?: string;
  sectionTitle?: string;
  groupTitle?: string;
  subgroupTitle?: string;
  sectionId?: string;
  groupId?: string;
  subgroupId?: string;
};

type ScopeRecord = {
  id: string;
  jobId: string;
  jobCode?: string;
  knowledgePackId?: string;
  knowledgePackVersion?: string;
  scopeLevel?: string;
  scope?: ScopeSelection | null;
  scopeText?: string;
  knowledgeContextEntryIds?: string[];
  assumptions?: string[];
  exclusions?: string[];
  status?: string;
  source?: string;
  version?: number;
  createdAt?: string;
  updatedAt?: string;
};

type ScopeResponse = {
  job?: { id: string; canonicalCode?: string; title?: string };
  latest?: ScopeRecord | null;
  scopes?: ScopeRecord[];
  knowledgeContext?: KnowledgeResult[];
  readback?: { status?: string; checkedAt?: string };
};

type LedgerEntry = {
  id: string;
  entryType?: string;
  actionType?: string;
  command?: string;
  status?: string;
  approvalRequired?: boolean;
  relatedActionId?: string | null;
  payload?: Record<string, unknown>;
  readback?: Record<string, unknown>;
  requestedBy?: string;
  approvedBy?: string | null;
  createdAt?: string;
};

type LedgerResponse = { ledger?: LedgerEntry[]; readback?: { status?: string; checkedAt?: string } };

const statusTone: Record<ReadinessStatus, { badge: string; icon: string; label: string }> = {
  READY: { badge: "border-lime-300/25 bg-lime-300/10 text-lime-200", icon: "text-lime-200", label: "READY" },
  NOT_RUN: { badge: "border-amber-300/25 bg-amber-300/10 text-amber-200", icon: "text-amber-200", label: "NOT RUN" },
  NOT_CONFIGURED: { badge: "border-amber-300/25 bg-amber-300/10 text-amber-200", icon: "text-amber-200", label: "CONFIG REQUIRED" },
  BLOCKED: { badge: "border-rose-300/25 bg-rose-300/10 text-rose-200", icon: "text-rose-200", label: "BLOCKED" },
};

const navItems = [
  { href: "/command", label: "COMMAND", icon: Sparkles },
  { href: "/governance", label: "AI CONTROL PLANE", icon: ShieldCheck },
  { href: "/governance/security", label: "SECURITY / PRIVACY", icon: LockKeyhole },
  { href: "/release", label: "RELEASE CENTER", icon: BadgeCheck },
  { href: "/externals", label: "EXTERNAL ADAPTERS", icon: KeyRound },
  { href: "/events", label: "EVENTS / LEDGER", icon: FileCheck2 },
  { href: "/onboarding", label: "AUTHORITY", icon: Fingerprint },
];

const viewItems: Array<{ id: ViewKey; label: string; icon: LucideIcon }> = [
  { id: "overview", label: "Readiness", icon: CircleGauge },
  { id: "knowledge", label: "Knowledge pack", icon: BookOpenCheck },
  { id: "scope", label: "Scope bindings", icon: Target },
  { id: "approvals", label: "Approval ledger", icon: CheckCircle2 },
  { id: "tools", label: "Tool gateway", icon: GitBranch },
];

function statusVisual(value?: string) {
  const normalized = (value ?? "UNKNOWN").toUpperCase();
  if (normalized === "READY" || normalized === "CONFIRMED" || normalized === "VERIFIED" || normalized === "APPROVED") {
    return { badge: "border-lime-300/25 bg-lime-300/10 text-lime-200", dot: "bg-lime-300", label: normalized };
  }
  if (normalized.includes("PENDING") || normalized.includes("NOT_RUN") || normalized.includes("DRAFT") || normalized.includes("DEFERRED")) {
    return { badge: "border-amber-300/25 bg-amber-300/10 text-amber-200", dot: "bg-amber-300", label: normalized.replaceAll("_", " ") };
  }
  if (normalized.includes("REJECT") || normalized.includes("BLOCK") || normalized.includes("FAIL")) {
    return { badge: "border-rose-300/25 bg-rose-300/10 text-rose-200", dot: "bg-rose-300", label: normalized.replaceAll("_", " ") };
  }
  return { badge: "border-white/10 bg-white/[.04] text-slate-400", dot: "bg-slate-500", label: normalized.replaceAll("_", " ") };
}

function StatusBadge({ status }: { status?: string }) {
  const tone = statusVisual(status);
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[9px] font-semibold uppercase tracking-[.06em] ${tone.badge}`}><span className={`size-1.5 rounded-full ${tone.dot}`} />{tone.label}</span>;
}

function ReadinessBadge({ status }: { status: ReadinessStatus }) {
  const tone = statusTone[status];
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[9px] font-semibold tracking-[.06em] ${tone.badge}`}><span className="size-1.5 rounded-full bg-current" />{tone.label}</span>;
}

function GateIcon({ status }: { status: ReadinessStatus }) {
  const Icon = status === "READY" ? CheckCircle2 : status === "BLOCKED" ? XCircle : CircleAlert;
  return <Icon className={`size-[18px] ${statusTone[status].icon}`} />;
}

function Metric({ icon: Icon, label, value, detail, status = "READY" }: { icon: LucideIcon; label: string; value: string; detail: string; status?: ReadinessStatus }) {
  return <article className="carbon-card rounded-2xl p-4 transition duration-200 hover:-translate-y-0.5 hover:border-lime-300/25"><div className="flex items-start justify-between gap-3"><span className={`grid size-9 place-items-center rounded-xl border border-current/20 bg-current/10 ${statusTone[status].icon}`}><Icon className="size-[18px]" /></span><ReadinessBadge status={status} /></div><p className="mt-4 text-[10px] uppercase tracking-[.14em] text-slate-600">{label}</p><p className="mt-1 font-mono text-[28px] font-semibold leading-none tracking-[-.06em] text-slate-50">{value}</p><p className="mt-3 text-[10px] leading-4 text-slate-600">{detail}</p></article>;
}

function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`carbon-card rounded-2xl p-4 sm:p-5 ${className}`}>{children}</section>;
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
}

function money(value: number, currency: string) {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: currency || "EUR", maximumFractionDigits: 2 }).format(value);
}

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = await response.json() as T & { error?: string; message?: string };
  if (!response.ok) throw new Error(payload.error || payload.message || `request_failed_${response.status}`);
  return payload;
}

export default function CompanyAiGovernance() {
  const router = useRouter();
  const [activeView, setActiveView] = useState<ViewKey>("overview");
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [data, setData] = useState<Readiness>({});
  const [knowledge, setKnowledge] = useState<KnowledgeResponse>({});
  const [jobs, setJobs] = useState<OperationsJob[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [scope, setScope] = useState<ScopeResponse | null>(null);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [jobQuery, setJobQuery] = useState("");
  const [surfaceQuery, setSurfaceQuery] = useState("");
  const [knowledgeQuery, setKnowledgeQuery] = useState("");
  const [knowledgePart, setKnowledgePart] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [scopeLoading, setScopeLoading] = useState(false);
  const [approvalBusy, setApprovalBusy] = useState("");
  const [toast, setToast] = useState("");

  const nav = useCallback((path: string) => {
    setMobileNavOpen(false);
    router.push(path);
  }, [router]);

  const loadCore = useCallback(async () => {
    setLoading(true);
    const results = await Promise.allSettled([
      readJson<Readiness>("/api/governance/ai-readiness"),
      readJson<KnowledgeResponse>("/api/company-ai/knowledge?limit=12"),
      readJson<OperationsResponse>("/api/operations"),
      readJson<LedgerResponse>("/api/command/overview"),
    ]);
    const errors: string[] = [];
    const [readinessResult, knowledgeResult, operationsResult, ledgerResult] = results;
    if (readinessResult.status === "fulfilled") setData(readinessResult.value);
    else errors.push("readiness");
    if (knowledgeResult.status === "fulfilled") setKnowledge(knowledgeResult.value);
    else errors.push("knowledge");
    if (operationsResult.status === "fulfilled") {
      const records = operationsResult.value.records ?? [];
      setJobs(records);
      setSelectedJobId((current) => current || records[0]?.id || "");
    } else errors.push("operations");
    if (ledgerResult.status === "fulfilled") setLedger(ledgerResult.value.ledger ?? []);
    else errors.push("ledger");
    if (errors.length === 4) setToast("Control plane non disponibile nel runtime corrente");
    else if (errors.length > 0) setToast(`Readback parziale: ${errors.join(" · ")}`);
    setLoading(false);
  }, []);

  const loadKnowledge = useCallback(async (event?: FormEvent) => {
    event?.preventDefault();
    setKnowledgeLoading(true);
    try {
      const params = new URLSearchParams({ limit: "12" });
      if (knowledgeQuery.trim()) params.set("q", knowledgeQuery.trim());
      if (knowledgePart !== "ALL") params.set("part", knowledgePart);
      setKnowledge(await readJson<KnowledgeResponse>(`/api/company-ai/knowledge?${params.toString()}`));
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Knowledge pack non disponibile");
    } finally {
      setKnowledgeLoading(false);
    }
  }, [knowledgePart, knowledgeQuery]);

  const loadScope = useCallback(async () => {
    if (!selectedJobId) {
      setScope(null);
      return;
    }
    setScopeLoading(true);
    try {
      setScope(await readJson<ScopeResponse>(`/api/company-ai/scope?jobId=${encodeURIComponent(selectedJobId)}`));
    } catch (error) {
      setScope(null);
      setToast(error instanceof Error ? error.message : "Scope readback non disponibile");
    } finally {
      setScopeLoading(false);
    }
  }, [selectedJobId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadCore(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadCore]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadScope(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadScope]);

  const gates = data.gates ?? [];
  const readyCount = gates.filter((gate) => gate.status === "READY").length;
  const openCount = gates.filter((gate) => gate.status !== "READY").length;
  const runtime = data.runtime;
  const ledgerStatus = data.ledger?.status ?? "BLOCKED";
  const canApprove = Boolean(data.authority?.approvalsReview);
  const lastCheck = data.readback?.checkedAt ? formatDate(data.readback.checkedAt) : "—";
  const query = surfaceQuery.trim().toLocaleLowerCase("it-IT");
  const filteredGates = gates.filter((gate) => `${gate.label} ${gate.detail} ${gate.evidence}`.toLocaleLowerCase("it-IT").includes(query));
  const filteredLedger = ledger.filter((entry) => `${entry.id} ${entry.command ?? ""} ${entry.status ?? ""} ${entry.entryType ?? ""}`.toLocaleLowerCase("it-IT").includes(query));
  const filteredJobs = jobs.filter((job) => `${job.canonicalCode ?? ""} ${job.title} ${job.detail ?? ""} ${job.status ?? ""}`.toLocaleLowerCase("it-IT").includes(jobQuery.toLocaleLowerCase("it-IT")));
  const selectedJob = jobs.find((job) => job.id === selectedJobId);
  const pendingApprovals = ledger.filter((entry) => entry.approvalRequired || entry.status === "PENDING_APPROVAL");
  const knowledgeResults = knowledge.results ?? [];
  const pack = knowledge.pack;
  const scopeLatest = scope?.latest ?? null;
  const priority = useMemo(() => [
    { label: "Eseguire prova OpenAI live", detail: "Richiesta autenticata, request id redatto e readback del ledger.", status: "NOT_RUN" as ReadinessStatus, href: "/externals" },
    { label: "Certificare scanner documenti", detail: "Callback CLEAN vincolato all’hash del documento.", status: "NOT_RUN" as ReadinessStatus, href: "/documents" },
    { label: "Chiudere device e sign-off", detail: "Browser/PWA, privacy, security e commerciale.", status: "NOT_RUN" as ReadinessStatus, href: "/pwa/diagnostics" },
  ], []);

  async function resolveApproval(actionId: string, decision: "approved" | "rejected") {
    if (!canApprove || !window.confirm(decision === "approved" ? "Confermi l’approvazione della proposta?" : "Confermi il rifiuto della proposta?")) return;
    setApprovalBusy(actionId);
    try {
      await readJson<LedgerResponse>("/api/command/approval", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actionId, decision, note: "Decisione manuale dal control plane Company AI" }),
      });
      setToast(decision === "approved" ? "Approval registrato nel ledger" : "Proposta rifiutata e riletta dal ledger");
      await loadCore();
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Decisione non registrata");
    } finally {
      setApprovalBusy("");
    }
  }

  function viewButton(id: ViewKey) {
    setActiveView(id);
    setMobileNavOpen(false);
  }

  return <main className="min-h-screen bg-[#030504] text-slate-100"><div className="flex min-h-screen">
    <aside className={`hidden shrink-0 flex-col border-r border-lime-300/10 bg-[#050706]/95 px-3 py-4 backdrop-blur-xl transition-[width] duration-200 lg:flex ${collapsed ? "w-[76px]" : "w-[248px]"}`}>
      <div className={`flex items-center ${collapsed ? "justify-center" : "justify-between"}`}>
        <button className="flex items-center gap-3 px-1 text-left" onClick={() => nav("/command")} type="button" aria-label="Apri Command">
          <span className="neon-pulse grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black shadow-[0_0_24px_rgba(200,255,34,.16)]"><Image src="/ai-zerow-icon.jpeg" alt="AI-ZEROW" width={40} height={40} className="size-full object-cover" /></span>
          {!collapsed && <span><span className="block text-sm font-bold tracking-[.18em] text-slate-50">AI-ZEROW</span><span className="block text-[10px] uppercase tracking-[.22em] text-lime-300/75">command</span></span>}
        </button>
        {!collapsed && <button className="grid size-8 place-items-center rounded-lg border border-white/10 text-slate-600 transition hover:border-lime-300/30 hover:text-lime-200" onClick={() => setCollapsed(true)} type="button" aria-label="Comprimi sidebar"><PanelLeftClose className="size-4" /></button>}
      </div>
      {collapsed && <button className="mx-auto mt-5 grid size-8 place-items-center rounded-lg border border-white/10 text-slate-600 transition hover:border-lime-300/30 hover:text-lime-200" onClick={() => setCollapsed(false)} type="button" aria-label="Espandi sidebar"><PanelLeftOpen className="size-4" /></button>}
      {!collapsed && <div className="carbon-card mt-7 rounded-2xl p-3"><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.12em] text-lime-200"><ShieldCheck className="size-4" />W12 CONTROL PLANE</div><p className="mt-2 text-[10px] leading-5 text-slate-600">Knowledge, scope, tools, approval e readback sotto lo stesso confine tenant.</p></div>}
      <nav className={`${collapsed ? "mt-7" : "mt-6"} flex-1`} aria-label="Navigazione governance"><p className={`px-3 text-[9px] font-semibold uppercase tracking-[.22em] text-slate-700 ${collapsed ? "sr-only" : ""}`}>Governance</p><div className="mt-2 space-y-1">{navItems.map(({ href, label, icon: Icon }) => <button className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${href === "/governance" ? "border border-lime-300/20 bg-lime-300/10 text-lime-200 shadow-[0_0_20px_rgba(200,255,34,.07)]" : "text-slate-500 hover:bg-white/[.045] hover:text-slate-100"} ${collapsed ? "justify-center px-0" : ""}`} key={href} onClick={() => nav(href)} type="button" aria-label={label}><Icon className="size-4 shrink-0" />{!collapsed && <span>{label}</span>}</button>)}</div></nav>
      {!collapsed && <div className="border-t border-white/[.08] pt-4"><div className="flex items-center justify-between px-2 text-[9px] uppercase tracking-[.14em] text-slate-600"><span>Authority</span><span className="text-lime-200">{data.authority?.role ?? "—"}</span></div><p className="mt-3 px-2 font-mono text-[9px] text-slate-600">tenant scoped · no secrets exported</p></div>}
    </aside>

    <section className="min-w-0 flex-1">
      <header className="sticky top-0 z-30 flex h-[72px] items-center gap-3 border-b border-white/[.08] bg-[#050706]/88 px-4 backdrop-blur-xl sm:px-7">
        <button className="grid size-9 place-items-center rounded-xl border border-white/10 bg-black/30 text-slate-400 transition hover:border-lime-300/30 hover:text-lime-200 lg:hidden" onClick={() => setMobileNavOpen((open) => !open)} type="button" aria-label="Apri navigazione"><Menu className="size-4" /></button>
        <button className="hidden size-9 place-items-center rounded-xl border border-white/10 bg-black/30 text-slate-500 transition hover:border-lime-300/30 hover:text-lime-200 sm:grid lg:hidden" onClick={() => nav("/command")} type="button" aria-label="Torna a Command"><ArrowLeft className="size-4" /></button>
        <div className="hidden min-w-0 sm:block"><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-lime-300/70">AI-ZEROW / W12 / GOVERNANCE</p><h1 className="mt-1 truncate text-base font-semibold tracking-[-.03em] text-slate-50 sm:text-lg">Company AI control plane</h1></div>
        <div className="relative mx-auto hidden w-full max-w-[520px] md:block"><Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-600" /><Input aria-label="Cerca nel control plane" className="h-10 border-white/10 bg-black/25 pl-9 pr-16 text-xs text-slate-100 placeholder:text-slate-600 focus:border-lime-300/35" onChange={(event) => setSurfaceQuery(event.target.value)} placeholder="Cerca gate, ledger, commessa, tool…" value={surfaceQuery} /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[9px] text-slate-700">W12</span></div>
        <div className="ml-auto flex items-center gap-2"><button className="hidden size-9 place-items-center rounded-xl border border-white/10 bg-black/20 text-slate-500 transition hover:border-lime-300/30 hover:text-lime-200 sm:grid" onClick={() => nav("/communications")} type="button" aria-label="Apri comunicazioni"><Bell className="size-4" /></button><button className="hidden items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-2.5 py-2 text-left transition hover:border-lime-300/30 sm:flex" onClick={() => nav("/onboarding")} type="button" aria-label="Apri profilo e authority"><span className="grid size-6 place-items-center rounded-lg bg-lime-300 text-[10px] font-bold text-[#050705]">AI</span><span className="hidden text-[10px] text-slate-400 xl:block">Authority</span><ChevronDown className="size-3 text-slate-600" /></button><span className="hidden items-center gap-2 rounded-full border border-amber-300/20 bg-amber-300/5 px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[.12em] text-amber-100 lg:flex"><span className="size-1.5 rounded-full bg-amber-300" />COMMERCIAL NO-GO</span><Button aria-label="Aggiorna control plane" className="h-9 border-white/10 bg-black/20 text-xs text-slate-300 hover:border-lime-300/30 hover:text-lime-200" onClick={() => void loadCore()} variant="outline"><RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} /><span className="hidden sm:inline">Aggiorna</span></Button></div>
      </header>

      {mobileNavOpen && <div className="fixed inset-0 z-40 bg-black/65 lg:hidden" onClick={() => setMobileNavOpen(false)}><aside className="h-full w-[min(84vw,320px)] border-r border-lime-300/15 bg-[#070b08] p-4 shadow-[0_0_60px_rgba(0,0,0,.65)]" onClick={(event) => event.stopPropagation()}><div className="flex items-center justify-between"><button className="flex items-center gap-3" onClick={() => nav("/command")} type="button"><span className="grid size-9 place-items-center overflow-hidden rounded-xl border border-lime-300/40"><Image src="/ai-zerow-icon.jpeg" alt="AI-ZEROW" width={36} height={36} className="size-full object-cover" /></span><span className="text-xs font-bold tracking-[.18em]">AI-ZEROW</span></button><button className="grid size-9 place-items-center rounded-lg border border-white/10 text-slate-400" onClick={() => setMobileNavOpen(false)} type="button" aria-label="Chiudi navigazione"><X className="size-4" /></button></div><nav className="mt-8 space-y-1" aria-label="Navigazione mobile">{navItems.map(({ href, label, icon: Icon }) => <button className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-xs ${href === "/governance" ? "border border-lime-300/20 bg-lime-300/10 text-lime-200" : "text-slate-400 hover:bg-white/[.04]"}`} key={href} onClick={() => nav(href)} type="button"><Icon className="size-4" />{label}</button>)}</nav></aside></div>}

      <div className="mx-auto max-w-[1680px] px-4 py-5 sm:px-7 sm:py-7">
        <section className="relative overflow-hidden rounded-[24px] border border-lime-300/20 bg-[linear-gradient(115deg,rgba(7,12,8,.98),rgba(10,20,11,.92)_50%,rgba(86,126,0,.24))] p-5 shadow-[0_24px_70px_rgba(0,0,0,.42)] sm:p-7"><div className="pointer-events-none absolute -right-24 -top-28 size-[360px] rounded-full bg-lime-300/[.12] blur-[90px]" /><div className="pointer-events-none absolute bottom-0 left-1/3 h-px w-1/2 bg-gradient-to-r from-transparent via-lime-300/60 to-transparent" /><div className="relative flex flex-wrap items-end justify-between gap-6"><div className="max-w-3xl"><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.22em] text-lime-300/80"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_12px_rgba(200,255,34,.8)]" />COMPANY AI / GOVERNED INTELLIGENCE</div><h2 className="mt-3 max-w-2xl text-[clamp(2rem,4.4vw,4.1rem)] font-semibold leading-[.94] tracking-[-.07em] text-slate-50">CONTROL THE<br /><span className="text-lime-300">INTELLIGENCE LAYER.</span></h2><p className="mt-4 max-w-2xl text-sm leading-6 text-slate-400">Knowledge, scope, tool gateway e approval nello stesso flusso. L’AI propone e spiega; il dominio autorizzato decide, scrive e rileggе.</p><div className="mt-5 flex flex-wrap gap-2"><Button className="h-10 bg-lime-300 px-4 text-xs font-semibold text-[#050705] shadow-[0_0_24px_rgba(200,255,34,.16)] hover:bg-lime-200" onClick={() => nav("/command")}><Sparkles className="size-3.5" />Apri Command</Button><Button className="h-10 border-lime-300/20 bg-black/25 px-4 text-xs text-lime-100 hover:border-lime-300/45 hover:bg-lime-300/[.06]" onClick={() => setActiveView("tools")} variant="outline"><GitBranch className="size-3.5" />Vedi il confine tool</Button></div></div><div className="min-w-[220px] rounded-2xl border border-white/[.10] bg-black/25 p-4 backdrop-blur-xl"><div className="flex items-center justify-between gap-3"><span className="text-[9px] font-semibold uppercase tracking-[.16em] text-slate-500">W12 release state</span><span className="size-2 rounded-full bg-amber-300 shadow-[0_0_14px_rgba(255,181,46,.7)]" /></div><p className="mt-3 font-mono text-2xl font-semibold tracking-[-.06em] text-amber-100">NO-GO</p><p className="mt-2 text-[10px] leading-5 text-slate-500">Local contract pass. OpenAI live, provider e sign-off esterni non ancora certificati.</p><div className="mt-4 flex items-center justify-between border-t border-white/[.08] pt-3 text-[10px]"><span className="text-slate-600">Readback</span><span className="text-lime-200">{lastCheck}</span></div></div></div></section>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><Metric icon={CircleGauge} label="Gate locali pronti" value={loading ? "—" : `${readyCount}/${gates.length}`} detail="Contratti verificati nel perimetro Sites" status={readyCount && openCount === 0 ? "READY" : "NOT_RUN"} /><Metric icon={TerminalSquare} label="Ledger Company AI" value={loading ? "—" : String(data.ledger?.count ?? ledger.length)} detail="Entry recenti nel tenant corrente" status={ledgerStatus} /><Metric icon={BookOpenCheck} label="Knowledge entries" value={pack ? String(pack.entryCount) : "—"} detail={pack ? `${pack.name} · v${pack.version}` : "Pack non rilevato"} status={pack ? "READY" : "NOT_RUN"} /><Metric icon={Target} label="Scope selezionato" value={scopeLatest ? "BOUND" : "—"} detail={scopeLatest ? "Livello massimo: sottogruppo" : "Seleziona una commessa per il readback"} status={scopeLatest ? "READY" : "NOT_RUN"} /><Metric icon={LockKeyhole} label="Scrittura diretta AI" value="BLOCKED" detail="Preview, approval e tool boundary" status="READY" /></div>

        <div className="mt-5 flex gap-2 overflow-x-auto border-b border-white/[.08] pb-2">{viewItems.map(({ id, label, icon: Icon }) => <button className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[.08em] transition ${activeView === id ? "border border-lime-300/25 bg-lime-300/10 text-lime-200 shadow-[0_0_20px_rgba(200,255,34,.06)]" : "border border-transparent text-slate-600 hover:bg-white/[.035] hover:text-slate-300"}`} key={id} onClick={() => viewButton(id)} type="button"><Icon className="size-3.5" />{label}{id === "approvals" && pendingApprovals.length > 0 ? <span className="rounded-full bg-amber-300 px-1.5 py-0.5 text-[8px] text-[#050705]">{pendingApprovals.length}</span> : null}</button>)}</div>

        {activeView === "overview" && <div className="mt-4 grid gap-4 2xl:grid-cols-[minmax(0,1.28fr)_minmax(360px,.72fr)]"><Panel><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">W12 / GATE REGISTER</p><h2 className="mt-1 text-base font-semibold">Contratto Company AI</h2><p className="mt-1 text-[11px] leading-5 text-slate-500">Ogni riga ha stato, evidenza e prossimo passo. I gate provider non vengono promossi a READY per convenienza.</p></div><span className="rounded-full border border-lime-300/20 bg-lime-300/[.05] px-2.5 py-1.5 text-[10px] text-lime-200">{readyCount} READY · {openCount} OPEN</span></div><div className="mt-4 space-y-2">{filteredGates.map((item) => <article className="rounded-xl border border-white/[.08] bg-black/20 p-3 transition hover:border-lime-300/20" key={item.id}><div className="flex items-start gap-3"><span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border border-white/10 bg-black/25"><GateIcon status={item.status} /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-xs font-semibold text-slate-200">{item.label}</h3><ReadinessBadge status={item.status} /></div><p className="mt-1 text-[11px] leading-5 text-slate-500">{item.detail}</p><div className="mt-2 grid gap-2 text-[10px] sm:grid-cols-2"><p className="rounded-lg border border-white/[.06] bg-black/20 px-2.5 py-2 text-slate-600"><span className="text-slate-500">Evidenza · </span>{item.evidence}</p><p className="rounded-lg border border-amber-300/10 bg-amber-300/[.03] px-2.5 py-2 text-amber-100/70"><span className="text-amber-100/50">Next · </span>{item.nextAction}</p></div></div></div></article>)}{filteredGates.length === 0 && <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-xs text-slate-600">Nessun gate corrisponde alla ricerca.</div>}</div></Panel><div className="space-y-4"><Panel className="border-lime-300/20 shadow-[0_0_32px_rgba(200,255,34,.08)]"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">RUNTIME BOUNDARY</p><h2 className="mt-1 text-sm font-semibold">OpenAI e tool gateway</h2></div><ReadinessBadge status={runtime?.liveRequest === "VERIFIED" ? "READY" : runtime?.liveRequest === "FAILED" ? "BLOCKED" : "NOT_RUN"} /></div><div className="mt-4 space-y-3 text-xs"><div className="flex items-center justify-between border-b border-white/[.08] pb-3"><span className="text-slate-500">Provider</span><span className="text-slate-200">{runtime?.provider ?? "openai"}</span></div><div className="flex items-center justify-between border-b border-white/[.08] pb-3"><span className="text-slate-500">Model</span><span className="font-mono text-lime-100">{runtime?.model ?? "—"}</span></div><div className="flex items-center justify-between border-b border-white/[.08] pb-3"><span className="text-slate-500">Binding</span><span className={runtime?.configured ? "text-lime-200" : "text-amber-200"}>{runtime?.configured ? "SERVER-SIDE" : "NOT OBSERVED"}</span></div><div className="flex items-center justify-between"><span className="text-slate-500">Direct write</span><span className="text-lime-200">BLOCKED</span></div></div><div className="mt-4 rounded-xl border border-amber-300/15 bg-amber-300/[.045] p-3"><p className="text-[11px] leading-5 text-amber-100/80">La chiave non viene mai restituita dal readback. La prova OpenAI live resta separata dalla semplice presenza del binding.</p></div><Button className="mt-4 h-9 w-full border-lime-300/20 bg-lime-300/[.05] text-[10px] text-lime-100 hover:bg-lime-300/[.12]" onClick={() => viewButton("tools")} variant="outline"><GitBranch className="size-3.5" />Apri tool gateway</Button></Panel><Panel><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">AUTHORITY CONTEXT</p><h2 className="mt-1 text-sm font-semibold">Chi vede questo controllo</h2></div><LockKeyhole className="size-4 text-lime-200" /></div><div className="mt-4 grid grid-cols-2 gap-2"><div className="carbon-inset rounded-xl p-3"><p className="text-[10px] text-slate-600">Ruolo</p><p className="mt-1 text-sm text-slate-100">{data.authority?.role ?? "—"}</p></div><div className="carbon-inset rounded-xl p-3"><p className="text-[10px] text-slate-600">Identity</p><p className="mt-1 text-sm text-slate-100">{data.authority?.identityProvider ?? "—"}</p></div><div className="carbon-inset rounded-xl p-3"><p className="text-[10px] text-slate-600">Tenant scope</p><p className="mt-1 text-sm text-lime-100">{data.authority?.tenantScope ?? "—"}</p></div><div className="carbon-inset rounded-xl p-3"><p className="text-[10px] text-slate-600">Approval</p><p className="mt-1 text-sm text-lime-100">{canApprove ? "ENABLED" : "READ ONLY"}</p></div></div><p className="mt-4 text-[10px] leading-4 text-slate-600">Il frontend non può ampliare tenant, ruolo o capability. Il server riduce il perimetro prima di ogni lettura.</p></Panel></div></div>}

        {activeView === "knowledge" && <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,.9fr)]"><Panel><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">KNOWLEDGE REGISTRY</p><h2 className="mt-1 text-base font-semibold">Pack tecnico collegabile alla commessa</h2><p className="mt-1 max-w-2xl text-[11px] leading-5 text-slate-500">Il pack è reference-only: Company AI può cercare contesto e proporre, ma non decide da sola lo scope né scrive una voce di dominio.</p></div><StatusBadge status={knowledge.readback?.status ?? (pack ? "READY" : "NOT_RUN")} /></div><form className="mt-4 grid gap-2 md:grid-cols-[minmax(0,1fr)_170px_auto]" onSubmit={(event) => void loadKnowledge(event)}><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-600" /><Input aria-label="Cerca knowledge pack" className="h-10 border-white/10 bg-black/25 pl-9 text-xs text-slate-100 placeholder:text-slate-600" onChange={(event) => setKnowledgeQuery(event.target.value)} placeholder="Perdita idrica, scavi, trasporti…" value={knowledgeQuery} /></div><select aria-label="Filtra parte knowledge" className="h-10 rounded-xl border border-white/10 bg-black/25 px-3 text-xs text-slate-200 outline-none focus:border-lime-300/40" onChange={(event) => setKnowledgePart(event.target.value)} value={knowledgePart}><option value="ALL">Tutte le parti</option>{pack?.parts.map((part) => <option key={part.part} value={part.part}>{part.part} · {part.title}</option>)}</select><Button className="h-10 bg-lime-300 px-4 text-xs font-semibold text-[#050705] hover:bg-lime-200" disabled={knowledgeLoading} type="submit">{knowledgeLoading ? <RefreshCw className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}Cerca</Button></form><div className="mt-4 space-y-2">{knowledgeResults.map((entry) => <article className="rounded-xl border border-white/[.08] bg-black/20 p-3 transition hover:border-lime-300/20" key={entry.id}><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="rounded-md border border-lime-300/20 bg-lime-300/[.06] px-2 py-1 font-mono text-[9px] text-lime-200">{entry.code}</span><h3 className="text-xs font-semibold text-slate-100">{entry.description}</h3></div><p className="mt-2 text-[10px] text-slate-600">Parte {entry.part} · {entry.partTitle} · {entry.unit} · score {entry.score}</p></div><span className="font-mono text-xs text-lime-100">{money(entry.price, entry.currency)}</span></div><div className="mt-3 flex flex-wrap gap-1.5">{entry.breadcrumbs.map((breadcrumb) => <span className="rounded-full border border-white/[.08] px-2 py-1 text-[9px] text-slate-500" key={`${entry.id}-${breadcrumb.code}`}>{breadcrumb.title}</span>)}</div></article>)}{knowledgeResults.length === 0 && <div className="rounded-xl border border-dashed border-white/10 p-10 text-center"><BookOpenCheck className="mx-auto size-7 text-slate-700" /><p className="mt-3 text-xs text-slate-500">Nessuna voce trovata.</p><p className="mt-1 text-[10px] text-slate-700">La ricerca non crea righe placeholder.</p></div>}</div></Panel><div className="space-y-4"><Panel className="border-lime-300/15"><div className="flex items-center justify-between gap-2"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">PACK IDENTITY</p><h2 className="mt-1 text-sm font-semibold">{pack?.name ?? "Knowledge pack"}</h2></div><BookOpenCheck className="size-4 text-lime-200" /></div><div className="mt-4 grid grid-cols-2 gap-2"><div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">Versione</p><p className="mt-1 font-mono text-sm text-lime-100">{pack?.version ?? "—"}</p></div><div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">Entries</p><p className="mt-1 font-mono text-sm text-slate-100">{pack?.entryCount ?? "—"}</p></div><div className="carbon-inset col-span-2 rounded-xl p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">Authority</p><p className="mt-1 text-xs text-slate-200">{pack?.authority ?? "—"}</p></div></div><p className="mt-4 text-[10px] leading-5 text-slate-600">{pack?.purpose ?? "Il pack non è disponibile nel readback corrente."}</p></Panel><Panel><div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">PART INDEX</p><h2 className="mt-1 text-sm font-semibold">Parti indicizzate</h2></div><Layers3 className="size-4 text-lime-200" /></div><div className="mt-4 space-y-2">{pack?.parts.map((part) => <div className="flex items-center justify-between rounded-xl border border-white/[.07] bg-black/20 px-3 py-2.5 text-[10px]" key={part.part}><span className="text-slate-300"><span className="mr-2 font-mono text-lime-200">{part.part}</span>{part.title}</span><span className="font-mono text-slate-600">{part.entryCount}</span></div>)}{!pack && <p className="text-[10px] text-slate-600">Part index non disponibile.</p>}</div></Panel></div></div>}

        {activeView === "scope" && <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(300px,.7fr)_minmax(0,1.3fr)]"><Panel><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">SCOPE BINDINGS</p><h2 className="mt-1 text-base font-semibold">Commessa → sottogruppo → contesto</h2><p className="mt-1 text-[11px] leading-5 text-slate-500">Il selettore usa commesse reali dal readback Operations. Lo scope si ferma al sottogruppo; le voci tariffarie restano knowledge context.</p></div><Button aria-label="Aggiorna commesse" className="h-8 border-white/10 bg-black/20 text-[10px] text-slate-400 hover:border-lime-300/30 hover:text-lime-200" onClick={() => void loadCore()} variant="outline"><RefreshCw className="size-3" /></Button></div><div className="relative mt-4"><Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-600" /><Input aria-label="Filtra commesse" className="h-10 border-white/10 bg-black/25 pl-9 text-xs text-slate-100 placeholder:text-slate-600" onChange={(event) => setJobQuery(event.target.value)} placeholder="Codice, titolo o stato…" value={jobQuery} /></div><div className="mt-3 space-y-2">{filteredJobs.map((job) => <button className={`w-full rounded-xl border p-3 text-left transition ${job.id === selectedJobId ? "border-lime-300/35 bg-lime-300/[.07] shadow-[0_0_22px_rgba(200,255,34,.07)]" : "border-white/[.08] bg-black/20 hover:border-lime-300/25"}`} key={job.id} onClick={() => setSelectedJobId(job.id)} type="button"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-xs font-semibold text-slate-100">{job.canonicalCode ?? job.title}</p><p className="mt-1 truncate text-[10px] text-slate-500">{job.title}</p></div><ArrowRight className={`size-3.5 shrink-0 ${job.id === selectedJobId ? "text-lime-200" : "text-slate-700"}`} /></div><div className="mt-2 flex flex-wrap gap-2 text-[9px] text-slate-600"><span>{job.status ?? "—"}</span><span>·</span><span>{job.meta ?? "data da pianificare"}</span></div></button>)}{filteredJobs.length === 0 && <div className="rounded-xl border border-dashed border-white/10 p-8 text-center"><BriefcaseBusiness className="mx-auto size-7 text-slate-700" /><p className="mt-3 text-xs text-slate-500">Nessuna commessa nel perimetro leggibile.</p><p className="mt-1 text-[10px] text-slate-700">Il server può nascondere Operations se la capability non è presente.</p></div>}</div></Panel><Panel className="min-h-[520px]"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">SCOPE INSPECTOR</p><h2 className="mt-1 text-base font-semibold">{selectedJob?.canonicalCode ?? selectedJob?.title ?? "Seleziona una commessa"}</h2><p className="mt-1 text-[11px] text-slate-500">{selectedJob?.title ?? "Nessun record operativo selezionato."}</p></div>{scopeLatest && <StatusBadge status={scopeLatest.status} />}</div>{scopeLoading && <div className="mt-10 flex items-center justify-center gap-2 text-xs text-slate-500"><RefreshCw className="size-4 animate-spin text-lime-200" />Leggo scope e knowledge context…</div>}{!scopeLoading && scopeLatest && <><div className="mt-5 grid gap-3 sm:grid-cols-3"><div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">Sezione</p><p className="mt-2 text-xs text-slate-100">{scopeLatest.scope?.sectionTitle ?? "—"}</p></div><div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">Raggruppamento</p><p className="mt-2 text-xs text-slate-100">{scopeLatest.scope?.groupTitle ?? "—"}</p></div><div className="carbon-inset rounded-xl border-lime-300/15 bg-lime-300/[.04] p-3"><p className="text-[9px] uppercase tracking-[.14em] text-lime-300/60">Sottogruppo · max</p><p className="mt-2 text-xs font-semibold text-lime-100">{scopeLatest.scope?.subgroupTitle ?? "—"}</p></div></div><div className="mt-4 rounded-xl border border-lime-300/15 bg-lime-300/[.035] p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-[9px] font-semibold uppercase tracking-[.16em] text-lime-300/70">KNOWLEDGE CONTEXT</p><p className="mt-1 text-[10px] text-slate-500">{scopeLatest.knowledgeContextEntryIds?.length ?? 0} entry selezionate automaticamente dal sottogruppo</p></div><span className="font-mono text-[9px] text-lime-200">{scopeLatest.knowledgePackId ?? "—"} · v{scopeLatest.knowledgePackVersion ?? "—"}</span></div><div className="mt-3 space-y-2">{(scope?.knowledgeContext ?? []).map((entry) => <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/[.07] bg-black/20 px-3 py-2.5" key={entry.id}><span className="min-w-0 text-[10px] text-slate-300"><span className="mr-2 font-mono text-lime-200">{entry.code}</span>{entry.description}</span><span className="font-mono text-[9px] text-slate-600">{entry.unit} · {money(entry.price, entry.currency)}</span></div>)}{(scope?.knowledgeContext ?? []).length === 0 && <p className="text-[10px] text-slate-600">Nessun contesto tariffario rilevato per questo scope.</p>}</div></div><div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="rounded-xl border border-white/[.07] bg-black/20 p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">Provenienza</p><p className="mt-2 text-xs text-slate-300">{scopeLatest.source ?? "—"}</p><p className="mt-1 text-[10px] text-slate-600">Versione scope {scopeLatest.version ?? "—"} · aggiornato {formatDate(scopeLatest.updatedAt)}</p></div><div className="rounded-xl border border-amber-300/15 bg-amber-300/[.035] p-3"><p className="text-[9px] uppercase tracking-[.14em] text-amber-100/70">Human confirmation</p><p className="mt-2 text-xs text-amber-100">{pack?.scopeContract.requiredHumanConfirmation ? "Richiesta prima del publish" : "Contratto non osservato"}</p><p className="mt-1 text-[10px] text-slate-600">Company AI può proporre il link; il server e l’utente autorizzato lo confermano.</p></div></div></>}{!scopeLoading && !scopeLatest && <div className="mt-12 rounded-2xl border border-dashed border-lime-300/15 p-10 text-center"><Target className="mx-auto size-8 text-slate-700" /><p className="mt-3 text-sm text-slate-300">Nessun binding scope rilevato</p><p className="mt-1 text-[11px] leading-5 text-slate-600">La commessa deve avere sezione, raggruppamento e sottogruppo; il collegamento al knowledge pack resta tenant-scoped e rileggibile.</p></div>}</Panel></div>}

        {activeView === "approvals" && <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,.75fr)]"><Panel><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">S07 / APPROVAL LEDGER</p><h2 className="mt-1 text-base font-semibold">Proposte in attesa di decisione umana</h2><p className="mt-1 text-[11px] leading-5 text-slate-500">Approve e reject sono decisioni umane append-only. L’approvazione non equivale a esecuzione esterna.</p></div><span className="rounded-full border border-amber-300/20 bg-amber-300/[.05] px-2.5 py-1.5 text-[10px] text-amber-100">{pendingApprovals.length} PENDING</span></div><div className="mt-4 space-y-2">{filteredLedger.map((entry) => { const pending = Boolean(entry.approvalRequired || entry.status === "PENDING_APPROVAL"); return <article className={`rounded-xl border p-3 ${pending ? "border-amber-300/20 bg-amber-300/[.035]" : "border-white/[.08] bg-black/20"}`} key={entry.id}><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-[9px] text-slate-600">{entry.id.slice(0, 18)}</span><StatusBadge status={entry.status} /></div><h3 className="mt-2 text-xs font-semibold text-slate-200">{entry.command ?? entry.actionType ?? "Company AI action"}</h3><p className="mt-1 text-[10px] text-slate-600">{entry.entryType ?? "ledger entry"} · {formatDate(entry.createdAt)} · actor {entry.requestedBy ?? "—"}</p></div><div className="flex shrink-0 items-center gap-2">{pending && <><Button className="h-8 border-lime-300/25 bg-lime-300/[.08] px-2.5 text-[10px] text-lime-100 hover:bg-lime-300/[.14]" disabled={!canApprove || approvalBusy === entry.id} onClick={() => void resolveApproval(entry.id, "approved")} variant="outline"><Check className="size-3.5" />Approva</Button><Button className="h-8 border-rose-300/20 bg-rose-300/[.05] px-2.5 text-[10px] text-rose-100 hover:bg-rose-300/[.12]" disabled={!canApprove || approvalBusy === entry.id} onClick={() => void resolveApproval(entry.id, "rejected")} variant="outline"><X className="size-3.5" />Rifiuta</Button></>}</div></div><div className="mt-3 grid gap-2 text-[10px] sm:grid-cols-2"><div className="rounded-lg border border-white/[.06] bg-black/20 px-2.5 py-2 text-slate-600"><span className="text-slate-500">Readback · </span>{typeof entry.readback?.status === "string" ? entry.readback.status : "ledger readback"}</div><div className="rounded-lg border border-white/[.06] bg-black/20 px-2.5 py-2 text-slate-600"><span className="text-slate-500">Direct write · </span><span className="text-lime-200">BLOCKED</span></div></div></article>; })}{filteredLedger.length === 0 && <div className="rounded-xl border border-dashed border-white/10 p-10 text-center"><CheckCircle2 className="mx-auto size-7 text-slate-700" /><p className="mt-3 text-xs text-slate-500">Nessuna entry nel ledger corrispondente.</p><p className="mt-1 text-[10px] text-slate-700">Le proposte AI diventano visibili solo dopo il readback server-side.</p></div>}</div></Panel><div className="space-y-4"><Panel className="border-amber-300/15"><div className="flex items-center gap-2 text-amber-100"><Clock3 className="size-4" /><h2 className="text-sm font-semibold">Boundary di approvazione</h2></div><div className="mt-4 space-y-2 text-[10px] leading-5 text-slate-500"><p className="rounded-xl border border-white/[.07] bg-black/20 p-3"><span className="text-slate-300">1. Preview</span><br />La richiesta entra nel ledger con contesto, citazioni e tool candidate.</p><p className="rounded-xl border border-white/[.07] bg-black/20 p-3"><span className="text-slate-300">2. Decisione</span><br />Solo una capability <span className="font-mono text-lime-200">approvals.review</span> può registrare approve/reject.</p><p className="rounded-xl border border-white/[.07] bg-black/20 p-3"><span className="text-slate-300">3. Readback</span><br />Il risultato resta <span className="font-mono text-amber-100">EXTERNAL_DEFERRED</span> finché un executor non produce evidenza.</p></div></Panel><Panel><div className="flex items-center justify-between gap-3"><div><p className="text-[10px] uppercase tracking-[.16em] text-slate-600">OPERATOR CONTEXT</p><h2 className="mt-1 text-sm font-semibold">Decisione disponibile</h2></div><Fingerprint className="size-4 text-lime-200" /></div><div className="mt-4 rounded-xl border border-white/[.07] bg-black/20 p-3"><p className="text-[10px] text-slate-600">Capability</p><p className={`mt-1 text-sm ${canApprove ? "text-lime-100" : "text-amber-100"}`}>{canApprove ? "approvals.review" : "READ ONLY"}</p><p className="mt-2 text-[10px] leading-4 text-slate-600">Il ruolo corrente {data.authority?.role ?? "—"} vede solo il tenant autorizzato.</p></div></Panel></div></div>}

        {activeView === "tools" && <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,.85fr)]"><Panel><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">TOOL GATEWAY / REGISTRY</p><h2 className="mt-1 text-base font-semibold">Capability prima del tool</h2><p className="mt-1 max-w-2xl text-[11px] leading-5 text-slate-500">Il registry descrive il confine. Nessun tool riceve SQL, secret o un tenant scelto dal prompt; ogni mutazione passa da dominio, idempotenza, approval e readback.</p></div><StatusBadge status="READY" /></div><div className="mt-4 space-y-2">{[
          { id: "command.read", mode: "READ", capability: "command.read", title: "Operational query", detail: "Legge KPI, timeline, commesse e stato operativo nel tenant corrente.", output: "readback autorizzato", state: data.authority?.commandRead ? "READY" : "BLOCKED" },
          { id: "company-ai.knowledge.search", mode: "REFERENCE", capability: "command.read", title: "Knowledge search", detail: "Cerca voci e breadcrumbs nel pack senza trasformarle in scope atomico.", output: "citation allowlist", state: pack ? "READY" : "NOT_RUN" },
          { id: "company-ai.scope.propose", mode: "PROPOSAL", capability: "operations.write", title: "Scope proposal", detail: "Propone sezione, raggruppamento e sottogruppo; il limite massimo è server-side.", output: "human confirmation", state: "READY" },
          { id: "command.approval", mode: "APPROVAL", capability: "approvals.review", title: "Approval decision", detail: "Registra approve o reject nel ledger append-only, senza eseguire il dominio esterno.", output: "S07 readback", state: canApprove ? "READY" : "READ ONLY" },
          { id: "domain.executor", mode: "EXECUTION", capability: "domain-specific", title: "External executor", detail: "Emissione, dispatch o scrittura di dominio resta fuori dal control plane finché il provider non è certificato.", output: "EXTERNAL_DEFERRED", state: "DEFERRED" },
        ].filter((tool) => `${tool.id} ${tool.title} ${tool.detail}`.toLocaleLowerCase("it-IT").includes(query)).map((tool) => <article className="rounded-xl border border-white/[.08] bg-black/20 p-3 transition hover:border-lime-300/20" key={tool.id}><div className="flex flex-wrap items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-xl border border-lime-300/15 bg-lime-300/[.05] text-lime-200"><GitBranch className="size-4" /></span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="text-xs font-semibold text-slate-100">{tool.title}</h3><span className="rounded-md border border-white/[.08] px-2 py-1 font-mono text-[8px] text-slate-500">{tool.mode}</span></div><p className="mt-1 font-mono text-[9px] text-slate-600">{tool.id}</p></div></div><StatusBadge status={tool.state} /></div><p className="mt-3 text-[11px] leading-5 text-slate-500">{tool.detail}</p><div className="mt-3 grid gap-2 text-[10px] sm:grid-cols-2"><div className="rounded-lg border border-white/[.06] bg-black/20 px-2.5 py-2"><span className="text-slate-600">Capability · </span><span className="font-mono text-lime-100">{tool.capability}</span></div><div className="rounded-lg border border-white/[.06] bg-black/20 px-2.5 py-2"><span className="text-slate-600">Output · </span><span className="text-slate-300">{tool.output}</span></div></div></article>)} </div></Panel><div className="space-y-4"><Panel className="border-lime-300/15"><div className="flex items-center gap-2 text-lime-100"><TerminalSquare className="size-4" /><h2 className="text-sm font-semibold">Execution contract</h2></div><div className="mt-4 space-y-3"><div className="flex items-center gap-3"><span className="grid size-7 place-items-center rounded-lg bg-lime-300/10 text-lime-200">1</span><div><p className="text-xs text-slate-200">Context pack</p><p className="text-[10px] text-slate-600">tenant, actor, capability, scope</p></div></div><div className="ml-3 h-4 border-l border-dashed border-lime-300/20" /><div className="flex items-center gap-3"><span className="grid size-7 place-items-center rounded-lg bg-lime-300/10 text-lime-200">2</span><div><p className="text-xs text-slate-200">Preview / proposal</p><p className="text-[10px] text-slate-600">schema, citations, dry-run, ledger</p></div></div><div className="ml-3 h-4 border-l border-dashed border-lime-300/20" /><div className="flex items-center gap-3"><span className="grid size-7 place-items-center rounded-lg bg-amber-300/10 text-amber-100">3</span><div><p className="text-xs text-slate-200">Human approval</p><p className="text-[10px] text-slate-600">solo capability esplicita</p></div></div><div className="ml-3 h-4 border-l border-dashed border-lime-300/20" /><div className="flex items-center gap-3"><span className="grid size-7 place-items-center rounded-lg bg-cyan-300/10 text-cyan-100">4</span><div><p className="text-xs text-slate-200">Domain + readback</p><p className="text-[10px] text-slate-600">evento, outbox, reconciliation</p></div></div></div></Panel><Panel><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] uppercase tracking-[.16em] text-slate-600">NON-NEGOTIABLE</p><h2 className="mt-1 text-sm font-semibold">AI non è autorità di dominio</h2></div><LockKeyhole className="size-4 text-lime-200" /></div><ul className="mt-4 space-y-2 text-[10px] leading-5 text-slate-500"><li className="flex gap-2"><Check className="mt-0.5 size-3.5 shrink-0 text-lime-200" />Direct write sempre bloccato.</li><li className="flex gap-2"><Check className="mt-0.5 size-3.5 shrink-0 text-lime-200" />Tenant e capability risolti server-side.</li><li className="flex gap-2"><Check className="mt-0.5 size-3.5 shrink-0 text-lime-200" />Successo solo dopo readback verificato.</li><li className="flex gap-2"><Check className="mt-0.5 size-3.5 shrink-0 text-lime-200" />Provider assente = stato deferred, mai simulato.</li></ul></Panel></div></div>}

        <section className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(330px,.74fr)]"><Panel><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">CERTIFICATION QUEUE</p><h2 className="mt-1 text-sm font-semibold">Prossimi blocchi da chiudere</h2></div><span className="font-mono text-[10px] text-amber-200">{data.contract?.commercialStatus ?? "NO_GO"}</span></div><div className="mt-4 grid gap-3 md:grid-cols-3">{priority.map((item) => <button className="group rounded-xl border border-white/[.08] bg-black/20 p-3 text-left transition hover:border-lime-300/25 hover:bg-lime-300/[.04]" key={item.label} onClick={() => nav(item.href)} type="button"><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold text-slate-200">{item.label}</span><ArrowUpRight className="size-3.5 text-slate-600 transition group-hover:text-lime-200" /></div><p className="mt-2 text-[11px] leading-5 text-slate-500">{item.detail}</p><div className="mt-3"><ReadinessBadge status={item.status} /></div></button>)}</div></Panel><Panel><div className="flex items-center gap-2 text-lime-100"><Activity className="size-4" /><h2 className="text-sm font-semibold">Pipeline osservata</h2></div><div className="mt-4 flex flex-wrap items-center gap-2 text-[9px] font-semibold uppercase tracking-[.08em]"><span className="rounded-lg border border-lime-300/20 bg-lime-300/[.06] px-2.5 py-2 text-lime-100">INPUT</span><ArrowRight className="size-3 text-slate-700" /><span className="rounded-lg border border-lime-300/20 bg-lime-300/[.06] px-2.5 py-2 text-lime-100">CONTEXT</span><ArrowRight className="size-3 text-slate-700" /><span className="rounded-lg border border-amber-300/20 bg-amber-300/[.05] px-2.5 py-2 text-amber-100">APPROVAL</span><ArrowRight className="size-3 text-slate-700" /><span className="rounded-lg border border-cyan-300/20 bg-cyan-300/[.05] px-2.5 py-2 text-cyan-100">READBACK</span></div><p className="mt-4 text-[10px] leading-5 text-slate-600">La fase EXECUTION resta deferred quando il provider o il consumer esterno non è osservato.</p></Panel></section>
        <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/[.08] py-5 text-[10px] text-slate-600"><button className="flex items-center gap-2 transition hover:text-lime-200" onClick={() => nav("/command")} type="button"><ArrowLeft className="size-3.5" />Torna a Command</button><span>AI-ZEROW COMMAND · W12 / COMPANY AI CONTROL PLANE</span><span className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-lime-300" />no secrets exported · approval gated · tenant scoped</span></footer>
      </div>
    </section>
  </div>{toast ? <button className="fixed bottom-5 right-5 z-50 max-w-[380px] rounded-xl border border-lime-300/25 bg-[#0a100c]/95 px-4 py-3 text-left text-xs text-amber-100 shadow-[0_0_28px_rgba(190,255,60,.14)] backdrop-blur-xl" onClick={() => setToast("")} type="button" aria-label="Chiudi messaggio">{toast}</button> : null}</main>;
}
