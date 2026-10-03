"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  Activity,
  ArrowLeft,
  Bell,
  Boxes,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Cloud,
  Database,
  FileCheck2,
  GitBranch,
  KeyRound,
  Link2,
  ListChecks,
  Menu,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Smartphone,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type Status = "READY" | "DEFERRED" | "BLOCKED" | "NOT_RUN";
type CheckResult = "DECLARATIVE_PASS" | "BLOCKED" | "NOT_RUN";
type CheckType = "contract" | "health" | "readback" | "gate";
type View = "overview" | "registry" | "evidence" | "boundaries";

type PublicContext = {
  actorName?: string;
  actorEmail?: string;
  role?: string;
  tenantId?: string;
  capabilities?: string[];
};

type Check = {
  id: string;
  adapterKey: string;
  checkType: CheckType;
  result: CheckResult;
  detail: string;
  evidence: string;
  source: string;
  checkedAt: string;
};

type Adapter = {
  key: string;
  tranche: string;
  family: string;
  title: string;
  provider: string;
  boundary: string;
  status: Status;
  effectiveStatus: Status;
  contract: string;
  gate: string;
  capabilities: string[];
  nextAction: string;
  lastCheck: Check | null;
};

type Snapshot = {
  context?: PublicContext;
  contract?: {
    tranche?: string;
    mode?: string;
    storage?: string;
    secrets?: string;
    directExternalWrite?: boolean;
    nativeBoundary?: string;
    readback?: string;
  };
  adapters?: Adapter[];
  checks?: Check[];
  summary?: { total: number; ready: number; deferred: number; blocked: number; notRun: number };
  readback?: { persistedChecks?: number; catalogEntries?: number; checkedAt?: string; status?: string };
  error?: string;
};

const NAV = [
  { label: "COMMAND", href: "/command", icon: Sparkles, capability: "command.read" },
  { label: "OPERATIONS", href: "/operations", icon: Boxes, capability: "operations.read" },
  { label: "WORKFORCE", href: "/workforce", icon: Activity, capability: "workforce.read" },
  { label: "FINANCE", href: "/finance", icon: Database, capability: "finance.read" },
  { label: "PROCUREMENT", href: "/procurement", icon: Link2, capability: "procurement.read" },
  { label: "DOCUMENTS", href: "/documents", icon: FileCheck2, capability: "documents.read" },
  { label: "GOVERNANCE", href: "/governance", icon: ShieldCheck, capability: "governance.read" },
  { label: "INTEGRAZIONI", href: "/externals", icon: Network, capability: "external_adapters.read" },
  { label: "EVENTI", href: "/events", icon: GitBranch, capability: "events.read" },
  { label: "PWA", href: "/pwa/diagnostics", icon: Smartphone, capability: "settings.read" },
];

const FAMILY_ICONS: Record<string, LucideIcon> = {
  sites: Sparkles,
  identity: KeyRound,
  domain: Boxes,
  storage: Database,
  data: Database,
  events: GitBranch,
  ai: Sparkles,
  governance: ShieldCheck,
  runtime: Server,
  mobile: Smartphone,
  certification: ListChecks,
  promotion: Cloud,
};

const STATUS_LABEL: Record<Status, string> = {
  READY: "READY",
  DEFERRED: "DEFERRED",
  BLOCKED: "BLOCKED",
  NOT_RUN: "NOT RUN",
};

const STATUS_STYLE: Record<Status, { badge: string; icon: string; bar: string }> = {
  READY: { badge: "border-lime-300/25 bg-lime-300/10 text-lime-200", icon: "text-lime-200", bar: "bg-lime-300" },
  DEFERRED: { badge: "border-amber-300/25 bg-amber-300/10 text-amber-200", icon: "text-amber-200", bar: "bg-amber-300" },
  BLOCKED: { badge: "border-rose-300/25 bg-rose-300/10 text-rose-200", icon: "text-rose-200", bar: "bg-rose-300" },
  NOT_RUN: { badge: "border-slate-300/15 bg-slate-300/5 text-slate-400", icon: "text-slate-300", bar: "bg-slate-400" },
};

const VIEW_LABELS: Array<{ id: View; label: string; note: string }> = [
  { id: "overview", label: "Postura", note: "Vista generale" },
  { id: "registry", label: "Registry", note: "Catalogo adapter" },
  { id: "evidence", label: "Evidenze", note: "Log append-only" },
  { id: "boundaries", label: "Confini", note: "Mappa handoff" },
];

const INTEGRATION_LANES = [
  { id: "identity", label: "Identity / tenant", detail: "Sessione, membership, ruolo e scope", families: ["identity"] },
  { id: "domain", label: "Domini canonici", detail: "Operations, workforce, documenti ed economia", families: ["domain", "storage"] },
  { id: "control", label: "Control plane", detail: "D1, eventi, outbox, AI e policy", families: ["sites", "events", "ai", "governance", "data"] },
  { id: "delivery", label: "Provider / delivery", detail: "Consumer, mobile, promotion e certificazione", families: ["runtime", "mobile", "certification", "promotion"] },
];

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function StatusBadge({ status }: { status: Status }) {
  const style = STATUS_STYLE[status];
  return <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-semibold tracking-[.06em]", style.badge)}><span className={cn("size-1.5 rounded-full bg-current", status === "READY" && "shadow-[0_0_8px_currentColor]")} />{STATUS_LABEL[status]}</span>;
}

function IconButton({ label, onClick, children, className = "", disabled = false }: { label: string; onClick: () => void; children: ReactNode; className?: string; disabled?: boolean }) {
  return <button aria-label={label} className={cn("grid size-9 place-items-center rounded-lg border border-white/10 bg-black/25 text-slate-500 transition hover:border-lime-300/30 hover:text-lime-200 disabled:cursor-not-allowed disabled:opacity-40", className)} disabled={disabled} onClick={onClick} type="button">{children}</button>;
}

function MetricCard({ label, value, detail, icon: Icon, status = "READY" }: { label: string; value: string; detail: string; icon: LucideIcon; status?: Status }) {
  return <article className="carbon-card rounded-2xl p-4 transition duration-200 hover:-translate-y-0.5 hover:border-lime-300/25"><div className="flex items-start justify-between gap-3"><span className={cn("grid size-9 place-items-center rounded-xl border border-current/20 bg-current/10", STATUS_STYLE[status].icon)}><Icon className="size-[18px]" /></span><StatusBadge status={status} /></div><p className="mt-4 text-xs text-slate-500">{label}</p><p className="mt-1 font-mono text-[29px] font-semibold leading-none tracking-[-.06em] text-slate-50">{value}</p><p className="mt-3 text-[10px] text-slate-600">{detail}</p></article>;
}

function formatDate(value?: string) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("it-IT", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
  } catch {
    return value;
  }
}

export default function ExternalIntegrationsControl() {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<Snapshot>({});
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState<Status | "ALL">("ALL");
  const [view, setView] = useState<View>("overview");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [checkOpen, setCheckOpen] = useState(false);
  const [checkType, setCheckType] = useState<CheckType>("contract");
  const [checkResult, setCheckResult] = useState<CheckResult>("DECLARATIVE_PASS");
  const [detail, setDetail] = useState("");
  const [evidence, setEvidence] = useState("");
  const [saving, setSaving] = useState(false);
  const [liveChecking, setLiveChecking] = useState(false);
  const [toast, setToast] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/externals", { cache: "no-store" });
      const data = (await response.json()) as Snapshot;
      if (!response.ok) throw new Error(data.error || "external_registry_readback_failed");
      setSnapshot(data);
      setSelectedKey((current) => current && data.adapters?.some((adapter) => adapter.key === current) ? current : data.adapters?.[0]?.key ?? null);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Readback integrazioni non disponibile");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const adapters = useMemo(() => snapshot.adapters ?? [], [snapshot.adapters]);
  const checks = useMemo(() => snapshot.checks ?? [], [snapshot.checks]);
  const summary = snapshot.summary ?? { total: 0, ready: 0, deferred: 0, blocked: 0, notRun: 0 };
  const capabilities = snapshot.context?.capabilities ?? [];
  const canManage = capabilities.includes("tenant.manage");
  const filtered = useMemo(() => adapters.filter((adapter) => {
    const haystack = [adapter.key, adapter.title, adapter.provider, adapter.tranche, adapter.family, adapter.boundary, adapter.contract, adapter.gate, adapter.capabilities.join(" ")].join(" ").toLowerCase();
    return (family === "ALL" || adapter.family === family) && (statusFilter === "ALL" || adapter.effectiveStatus === statusFilter) && haystack.includes(query.trim().toLowerCase());
  }), [adapters, family, query, statusFilter]);
  const families = useMemo(() => ["ALL", ...Array.from(new Set(adapters.map((adapter) => adapter.family)))], [adapters]);
  const selected = adapters.find((adapter) => adapter.key === selectedKey) ?? null;
  const readiness = summary.total > 0 ? Math.round((summary.ready / summary.total) * 100) : 0;
  const nav = NAV.filter((item) => item.href === "/externals" || capabilities.includes(item.capability));

  function openCheck(adapter: Adapter) {
    setSelectedKey(adapter.key);
    if (adapter.key === "openai-runtime") {
      void runOpenAiLiveCheck();
      return;
    }
    setCheckType("contract");
    setCheckResult(adapter.effectiveStatus === "BLOCKED" ? "BLOCKED" : adapter.effectiveStatus === "NOT_RUN" ? "NOT_RUN" : "DECLARATIVE_PASS");
    setDetail(`${adapter.tranche} · ${adapter.effectiveStatus === "READY" ? "Contratto Sites verificato" : "Gate dichiarativo da riallineare"}`);
    setEvidence("");
    if (!canManage) {
      setToast("Il tuo ruolo può leggere le integrazioni ma non registrare evidenze.");
      return;
    }
    setCheckOpen(true);
  }

  async function submitCheck(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !canManage) return;
    setSaving(true);
    try {
      const response = await fetch("/api/externals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ adapterKey: selected.key, checkType, result: checkResult, detail, evidence }),
      });
      const data = (await response.json()) as Snapshot & { error?: string };
      if (!response.ok) throw new Error(data.error || "external_check_write_failed");
      setSnapshot(data);
      setCheckOpen(false);
      setToast("Evidenza dichiarativa registrata e riletta dal D1.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Evidenza non registrata");
    } finally {
      setSaving(false);
    }
  }

  async function runOpenAiLiveCheck() {
    if (!canManage) return;
    setLiveChecking(true);
    try {
      const response = await fetch("/api/governance/ai-live-check", { method: "POST" });
      const data = (await response.json()) as {
        status?: string;
        result?: string;
        model?: string;
        requestIdPresent?: boolean;
        snapshot?: Snapshot;
        error?: string;
      };
      if (data.snapshot) setSnapshot(data.snapshot);
      if (!response.ok && !data.result) throw new Error(data.error || "openai_live_check_failed");
      setToast(data.result === "DECLARATIVE_PASS"
        ? "OpenAI live verificato · " + (data.model ?? "modello") + " · request id " + (data.requestIdPresent ? "presente" : "non restituito") + "."
        : "OpenAI live non verificato: il gate resta aperto.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Verifica OpenAI non disponibile");
    } finally {
      setLiveChecking(false);
    }
  }

  function goBack() {
    router.push("/command");
  }

  function selectAdapter(key: string) {
    setSelectedKey(key);
    if (window.matchMedia("(max-width: 1279px)").matches) window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <main className="min-h-screen bg-[#020403] text-slate-100">
      <div className="flex min-h-screen">
        <aside className={cn("hidden shrink-0 flex-col border-r border-lime-300/10 bg-[#050806]/95 px-3 py-4 transition-all duration-300 lg:flex", sidebarCollapsed ? "w-[76px]" : "w-[248px]")}>
          <div className={cn("flex items-center gap-3", sidebarCollapsed ? "justify-center" : "px-2")}>
            <button aria-label="Apri Command" className="neon-pulse relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black shadow-[0_0_22px_rgba(200,255,34,.12)]" onClick={goBack} type="button"><Image src="/ai-zerow-icon.jpeg" alt="AI-ZEROW" width={40} height={40} className="size-full object-cover" /></button>
            {!sidebarCollapsed && <button className="min-w-0 text-left" onClick={goBack} type="button"><span className="block text-sm font-bold tracking-[.18em] text-slate-50">AI-ZEROW</span><span className="block text-[10px] uppercase tracking-[.22em] text-lime-300/75">integrations control</span></button>}
            <IconButton label={sidebarCollapsed ? "Espandi sidebar" : "Riduci sidebar"} className={cn("ml-auto hidden lg:grid", sidebarCollapsed && "ml-0")} onClick={() => setSidebarCollapsed((value) => !value)}>{sidebarCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}</IconButton>
          </div>
          {!sidebarCollapsed && <div className="carbon-card mt-8 rounded-2xl p-3"><div className="flex items-center gap-2 text-xs text-slate-200"><Network className="size-4 text-lime-200" />INTEGRATIONS CONTROL</div><p className="mt-2 text-[10px] leading-5 text-slate-600">Adapter, evidenze e confini provider in un solo control plane.</p></div>}
          <nav className={cn("flex-1", sidebarCollapsed ? "mt-8" : "mt-7")} aria-label="Navigazione principale"><p className={cn("px-3 text-[10px] font-semibold uppercase tracking-[.2em] text-slate-600", sidebarCollapsed && "sr-only")}>Workspace</p><div className="mt-2 space-y-1">{nav.map((item) => { const Icon = item.icon; const active = item.href === "/externals"; return <button aria-current={active ? "page" : undefined} aria-label={sidebarCollapsed ? item.label : undefined} className={cn("group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition", active ? "border border-lime-300/20 bg-lime-300/10 text-lime-200 shadow-[inset_0_0_24px_rgba(200,255,34,.04)]" : "text-slate-500 hover:bg-white/[.045] hover:text-slate-100", sidebarCollapsed && "justify-center px-2")} key={item.href} onClick={() => router.push(item.href)} type="button"><Icon className={cn("size-4 shrink-0", active ? "text-lime-200" : "text-slate-600 group-hover:text-slate-300")} />{!sidebarCollapsed && <span>{item.label}</span>}</button>; })}</div></nav>
          {!sidebarCollapsed && <div className="border-t border-white/[.08] pt-4"><div className="flex items-center justify-between px-2 text-[10px] uppercase tracking-[.14em] text-slate-600"><span>Control state</span><span className="flex items-center gap-1.5 text-lime-200"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_8px_rgba(200,255,34,.8)]" />Sites only</span></div><div className="carbon-inset mt-3 rounded-xl p-3"><div className="flex items-center gap-2 text-[10px] text-slate-400"><Activity className="size-3.5 text-lime-300" />Integration registry</div><p className="mt-2 font-mono text-[9px] text-slate-600">D1 · {summary.total} adapter</p><p className="mt-3 font-mono text-[9px] text-slate-600">{summary.deferred + summary.notRun} external gate</p></div></div>}
        </aside>

        {mobileMenu && <div className="fixed inset-0 z-40 lg:hidden"><button aria-label="Chiudi menu" className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setMobileMenu(false)} type="button" /><aside className="relative flex h-full w-[min(86vw,320px)] flex-col border-r border-lime-300/20 bg-[#050806] px-4 py-5 shadow-[0_0_80px_rgba(0,0,0,.6)]"><div className="flex items-center justify-between"><button aria-label="Apri Command" className="flex items-center gap-3 text-left" onClick={goBack} type="button"><span className="relative grid size-10 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black"><Image src="/ai-zerow-icon.jpeg" alt="AI-ZEROW" width={40} height={40} className="size-full object-cover" /></span><span><span className="block text-sm font-bold tracking-[.18em] text-slate-50">AI-ZEROW</span><span className="block text-[10px] uppercase tracking-[.22em] text-lime-300/75">integrations control</span></span></button><IconButton label="Chiudi menu" onClick={() => setMobileMenu(false)}><X className="size-4" /></IconButton></div><nav className="mt-9 space-y-1" aria-label="Navigazione mobile">{nav.map((item) => { const Icon = item.icon; const active = item.href === "/externals"; return <button aria-current={active ? "page" : undefined} className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm", active ? "border border-lime-300/20 bg-lime-300/10 text-lime-200" : "text-slate-500 hover:bg-white/[.045] hover:text-slate-100")} key={item.href} onClick={() => { setMobileMenu(false); router.push(item.href); }} type="button"><Icon className="size-4" />{item.label}</button>; })}</nav><div className="mt-auto border-t border-white/[.08] pt-4 text-[10px] text-slate-600">Owner-aware navigation · tenant scope server-side</div></aside></div>}

        <section className="min-w-0 flex-1">
          <header className="zw-command-topbar sticky top-0 z-30 flex h-[72px] items-center gap-3 px-4 sm:gap-5 sm:px-7"><IconButton label="Apri menu" className="lg:hidden" onClick={() => setMobileMenu(true)}><Menu className="size-4" /></IconButton><button aria-label="Apri Integrazioni" className="flex shrink-0 items-center gap-2 text-left lg:hidden" onClick={() => setView("overview")} type="button"><span className="relative grid size-8 place-items-center overflow-hidden rounded-lg border border-lime-300/40 bg-black"><Image src="/ai-zerow-icon.jpeg" alt="ZEROW" width={32} height={32} className="size-full object-cover" /></span><span className="hidden text-[11px] font-bold tracking-[.18em] text-slate-50 sm:block">INTEGRATIONS</span></button><button className="hidden items-center gap-2 text-xs text-slate-500 transition hover:text-lime-200 lg:flex" onClick={goBack} type="button"><ArrowLeft className="size-3.5" />Command</button><span className="hidden size-1 rounded-full bg-lime-300 lg:block" /><div className="relative hidden min-w-0 flex-1 justify-center md:flex"><div className="relative w-full max-w-[560px]"><Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-600" /><Input aria-label="Cerca nelle integrazioni" className="h-10 w-full border-lime-300/10 bg-black/35 pl-10 text-xs text-slate-100 placeholder:text-slate-600" onChange={(event) => setQuery(event.target.value)} placeholder="Cerca adapter, provider, capability…" value={query} /></div></div><div className="flex min-w-0 flex-1 items-center gap-2 md:hidden"><span className="truncate text-xs font-semibold tracking-[.14em] text-slate-200">INTEGRAZIONI</span><span className="size-1 rounded-full bg-lime-300" /></div><div className="ml-auto flex min-w-0 items-center gap-2"><span className="hidden items-center gap-2 rounded-full border border-lime-300/20 bg-lime-300/5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[.12em] text-lime-200 sm:flex"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_9px_rgba(200,255,34,.9)]" />{loading ? "READING" : "D1 VERIFIED"}</span><IconButton label="Torna a Command" onClick={goBack}><ArrowLeft className="size-4" /></IconButton><IconButton label="Aggiorna integrazioni" onClick={() => void load()} disabled={loading}><RefreshCw className={cn("size-4", loading && "animate-spin")} /></IconButton><IconButton label="Notifiche" onClick={() => setToast("Nessuna notifica provider collegata")}><Bell className="size-4" /></IconButton><span className="hidden size-8 place-items-center rounded-full border border-white/15 bg-gradient-to-br from-slate-200 to-slate-500 text-xs font-bold text-[#080a0b] sm:grid">AB</span><div className="hidden text-right lg:block"><p className="text-xs font-medium text-slate-200">{snapshot.context?.actorName ?? "Operatore"}</p><p className="text-[10px] text-slate-600">{snapshot.context?.role ?? "authority"} · tenant scope</p></div></div></header>

          <div className="mx-auto max-w-[1720px] px-4 py-5 sm:px-7 sm:py-7">
            <section className="relative overflow-hidden rounded-[26px] border border-lime-300/20 bg-[linear-gradient(120deg,rgba(6,11,7,.98),rgba(7,18,10,.95)_48%,rgba(63,90,0,.27))] p-5 shadow-[0_26px_80px_rgba(0,0,0,.45)] sm:p-7"><div className="pointer-events-none absolute -right-28 -top-32 size-[390px] rounded-full bg-lime-300/[.11] blur-[100px]" /><div className="pointer-events-none absolute bottom-0 left-1/3 h-px w-1/3 bg-gradient-to-r from-transparent via-lime-300/70 to-transparent" /><div className="relative grid gap-7 xl:grid-cols-[minmax(0,1fr)_300px] xl:items-end"><div className="max-w-4xl"><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.22em] text-lime-300/80"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_12px_rgba(200,255,34,.8)]" />W14 / INTEGRATIONS CONTROL</div><h1 className="mt-3 max-w-3xl text-[clamp(2rem,4.8vw,4.6rem)] font-semibold leading-[.9] tracking-[-.08em] text-slate-50">CONNECT THE SYSTEM.<br /><span className="text-lime-300">PROVE THE BOUNDARY.</span></h1><p className="mt-4 max-w-2xl text-sm leading-6 text-slate-400">Un registro unico per identity, domini, eventi, AI, mobile e promotion. Il modulo documenta contratto, capability, evidenza e gate; non invoca provider né trasforma una dichiarazione in health reale.</p><div className="mt-5 flex flex-wrap gap-2"><Button className="h-10 bg-lime-300 px-4 text-xs font-semibold text-[#050705] shadow-[0_0_24px_rgba(200,255,34,.16)] hover:bg-lime-200" onClick={() => setView("registry")}><Network className="size-3.5" />Apri registry</Button><Button className="h-10 border-lime-300/20 bg-black/25 text-lime-100 hover:border-lime-300/45 hover:bg-lime-300/[.06]" onClick={() => setView("evidence")} variant="outline"><ListChecks className="size-3.5" />Vedi evidenze</Button></div></div><div className="relative overflow-hidden rounded-2xl border border-white/[.10] bg-black/25 p-4 backdrop-blur-xl"><div className="flex items-center justify-between gap-3"><span className="text-[9px] font-semibold uppercase tracking-[.16em] text-slate-500">System posture</span><span className="size-2 rounded-full bg-amber-300 shadow-[0_0_14px_rgba(255,181,46,.75)]" /></div><div className="mt-4 flex items-end justify-between gap-3"><div><p className="font-mono text-4xl font-semibold tracking-[-.08em] text-slate-50">{loading ? "—" : `${readiness}%`}</p><p className="mt-1 text-[10px] uppercase tracking-[.12em] text-amber-100/75">local readiness</p></div><div className="grid size-20 place-items-center rounded-full border border-lime-300/20" style={{ background: `conic-gradient(#c8ff22 ${readiness * 3.6}deg, rgba(255,255,255,.08) ${readiness * 3.6}deg)` }}><div className="grid size-[62px] place-items-center rounded-full bg-[#081008]"><Network className="size-5 text-lime-200" /></div></div></div><div className="mt-4 flex items-center justify-between border-t border-white/[.08] pt-3 text-[10px]"><span className="text-slate-600">{summary.ready} ready · {summary.deferred} deferred</span><span className="text-amber-100">commercial gate open</span></div></div></div></section>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="Adapter catalogati" value={loading ? "—" : String(summary.total)} detail="S10–S14 registry" icon={Network} /><MetricCard label="Ready local" value={loading ? "—" : String(summary.ready)} detail="Sites-native / authorized" icon={CheckCircle2} /><MetricCard label="External deferred" value={loading ? "—" : String(summary.deferred)} detail="Connector boundary" icon={Link2} status="DEFERRED" /><MetricCard label="Blocked / not run" value={loading ? "—" : String(summary.blocked + summary.notRun)} detail="Gate non certificato" icon={CircleAlert} status={summary.blocked > 0 ? "BLOCKED" : "NOT_RUN"} /></div>

            <div className="mt-4 flex gap-2 overflow-x-auto border-b border-white/[.08] pb-1">{VIEW_LABELS.map((item) => <button aria-current={view === item.id ? "page" : undefined} className={cn("min-w-max border-b-2 px-3 py-3 text-left transition", view === item.id ? "border-lime-300 text-lime-200" : "border-transparent text-slate-600 hover:text-slate-300")} key={item.id} onClick={() => setView(item.id)} type="button"><span className="block text-[11px] font-semibold uppercase tracking-[.12em]">{item.label}</span><span className="mt-1 block text-[10px] text-current/60">{item.note}</span></button>)}</div>

            {view === "overview" && <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,.75fr)]"><section className="carbon-card rounded-2xl p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-lime-300/70">INTEGRATIONS / CONTROL POSTURE</p><h2 className="mt-1 text-xl font-semibold tracking-[-.03em] text-slate-50">Quattro livelli. Una traccia di evidenza.</h2><p className="mt-2 max-w-2xl text-xs leading-5 text-slate-500">Ogni integrazione attraversa identity, dominio, controllo locale e provider. L’ultimo passaggio resta aperto finché non esiste un readback autorizzato.</p></div><span className="rounded-full border border-amber-300/20 bg-amber-300/5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[.1em] text-amber-100">declarative only</span></div><div className="mt-6 grid gap-3 md:grid-cols-2">{INTEGRATION_LANES.map((lane, index) => { const laneAdapters = adapters.filter((adapter) => lane.families.includes(adapter.family)); const laneStatus: Status = laneAdapters.some((adapter) => adapter.effectiveStatus === "BLOCKED") ? "BLOCKED" : laneAdapters.some((adapter) => adapter.effectiveStatus === "DEFERRED") ? "DEFERRED" : laneAdapters.some((adapter) => adapter.effectiveStatus === "NOT_RUN") ? "NOT_RUN" : "READY"; const LaneIcon = index === 0 ? KeyRound : index === 1 ? Boxes : index === 2 ? Database : Cloud; return <button className="group carbon-inset rounded-2xl p-4 text-left transition hover:-translate-y-0.5 hover:border-lime-300/30" key={lane.id} onClick={() => { setView("registry"); setFamily(lane.families[0]); }} type="button"><div className="flex items-start gap-3"><span className={cn("grid size-10 place-items-center rounded-xl border border-current/20 bg-current/10", STATUS_STYLE[laneStatus].icon)}><LaneIcon className="size-[18px]" /></span><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-3"><span className="text-sm font-semibold text-slate-100">{lane.label}</span><StatusBadge status={laneStatus} /></div><p className="mt-1 text-[11px] leading-5 text-slate-600">{lane.detail}</p></div><ChevronRight className="mt-1 size-4 text-slate-700 transition group-hover:text-lime-200" /></div><div className="mt-4 flex items-center justify-between border-t border-white/[.07] pt-3 text-[10px]"><span className="text-slate-600">{laneAdapters.length} adapter</span><span className="font-mono text-slate-500">{laneAdapters.filter((adapter) => adapter.lastCheck).length} evidenze</span></div></button>; })}</div></section><aside className="space-y-4"><section className="carbon-card-neon rounded-2xl p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-cyan-200/65">SELECTED ADAPTER</p><h2 className="mt-1 text-base font-semibold text-slate-50">{selected?.title ?? "Seleziona un adapter"}</h2></div>{selected && <StatusBadge status={selected.effectiveStatus} />}</div>{selected ? <div className="mt-5 space-y-4"><div><p className="text-[10px] uppercase tracking-[.12em] text-slate-600">Contratto</p><p className="mt-1 text-xs leading-5 text-slate-300">{selected.contract}</p></div><div><p className="text-[10px] uppercase tracking-[.12em] text-slate-600">Prossimo passaggio</p><p className="mt-1 text-xs leading-5 text-slate-400">{selected.nextAction}</p></div><div className="flex flex-wrap gap-1.5">{selected.capabilities.map((capability) => <span className="rounded-md border border-lime-300/15 bg-lime-300/[.04] px-2 py-1 text-[9px] text-lime-100/70" key={capability}>{capability}</span>)}</div><Button className="h-9 w-full border-lime-300/25 bg-lime-300/10 text-xs text-lime-100 hover:bg-lime-300/20" disabled={!canManage || liveChecking} onClick={() => openCheck(selected)} variant="outline"><FileCheck2 className="size-3.5" />{selected?.key === "openai-runtime" ? "Verifica OpenAI live" : canManage ? "Registra evidenza" : "Apri sola lettura"}</Button></div> : <p className="mt-4 text-xs leading-5 text-slate-600">Il catalogo verrà letto dal tenant corrente.</p>}</section><section className="carbon-card rounded-2xl p-5"><div className="flex items-center gap-2 text-lime-100"><ShieldCheck className="size-4" /><h2 className="text-sm font-semibold">Contract guard</h2></div><div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-1"><div className="rounded-xl border border-white/[.07] bg-black/20 p-3"><p className="text-[9px] uppercase tracking-[.12em] text-slate-600">Authority</p><p className="mt-1 text-xs text-slate-200">{snapshot.context?.role ?? "server context"}</p></div><div className="rounded-xl border border-white/[.07] bg-black/20 p-3"><p className="text-[9px] uppercase tracking-[.12em] text-slate-600">Write boundary</p><p className="mt-1 text-xs text-amber-100">{canManage ? "tenant.manage · enabled" : "read-only · approval required"}</p></div><div className="rounded-xl border border-white/[.07] bg-black/20 p-3"><p className="text-[9px] uppercase tracking-[.12em] text-slate-600">Secrets</p><p className="mt-1 text-xs text-lime-100">mai persistiti</p></div><div className="rounded-xl border border-white/[.07] bg-black/20 p-3"><p className="text-[9px] uppercase tracking-[.12em] text-slate-600">External write</p><p className="mt-1 text-xs text-lime-100">disabilitato</p></div></div></section></aside></div>}

            {view === "registry" && <div className="mt-4 space-y-4"><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">ADAPTER REGISTRY</p><h2 className="mt-1 text-lg font-semibold text-slate-50">Catalogo operativo</h2><p className="mt-1 text-[11px] text-slate-500">Filtra per famiglia, stato o capability. Seleziona un adapter per aprire il suo contratto.</p></div><div className="flex items-center gap-2"><span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-[10px] text-slate-500">{filtered.length} / {adapters.length}</span><Button className="h-9 border-white/10 bg-black/20 text-xs text-slate-300 hover:border-lime-300/30 hover:text-lime-100" onClick={() => void load()} variant="outline"><RefreshCw className="size-3.5" />Aggiorna</Button></div></div><div className="mt-5 flex gap-2 overflow-x-auto pb-1">{families.map((item) => <button className={cn("rounded-lg border px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[.08em] transition", family === item ? "border-lime-300/30 bg-lime-300/15 text-lime-200" : "border-white/10 bg-black/20 text-slate-600 hover:border-lime-300/20 hover:text-slate-300")} key={item} onClick={() => setFamily(item)} type="button">{item === "ALL" ? "Tutte" : item}</button>)}</div><div className="mt-3 flex gap-2 overflow-x-auto pb-1">{(["ALL", "READY", "DEFERRED", "BLOCKED", "NOT_RUN"] as const).map((item) => <button className={cn("rounded-lg border px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[.08em] transition", statusFilter === item ? "border-lime-300/30 bg-lime-300/15 text-lime-200" : "border-white/10 bg-black/20 text-slate-600 hover:border-lime-300/20 hover:text-slate-300")} key={item} onClick={() => setStatusFilter(item)} type="button">{item === "ALL" ? "Tutti gli stati" : STATUS_LABEL[item]}</button>)}</div></section><div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]"><section className="grid gap-3 md:grid-cols-2">{filtered.map((adapter) => { const AdapterIcon = FAMILY_ICONS[adapter.family] ?? Network; const status = adapter.effectiveStatus; return <article className={cn("carbon-card rounded-2xl p-4 transition", selectedKey === adapter.key ? "border-lime-300/40 bg-lime-300/[.035] shadow-[0_0_34px_rgba(200,255,34,.08)]" : "hover:-translate-y-0.5 hover:border-lime-300/25")} key={adapter.key}><button className="flex w-full items-start gap-3 text-left" onClick={() => selectAdapter(adapter.key)} type="button"><span className={cn("grid size-10 shrink-0 place-items-center rounded-xl border border-current/20 bg-current/10", STATUS_STYLE[status].icon)}><AdapterIcon className="size-[18px]" /></span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="font-mono text-[10px] text-lime-300/65">{adapter.tranche}</span><StatusBadge status={status} /></span><span className="mt-2 block text-sm font-semibold text-slate-100">{adapter.title}</span><span className="mt-1 block truncate text-[10px] text-slate-500">{adapter.provider} · {adapter.boundary}</span></span><ChevronRight className="mt-1 size-4 shrink-0 text-slate-700" /></button><div className="mt-4 rounded-xl border border-white/[.07] bg-black/20 p-3"><p className="text-[10px] leading-5 text-slate-400">{adapter.contract}</p><div className="mt-3 flex flex-wrap gap-1.5">{adapter.capabilities.map((capability) => <span className="rounded-md border border-white/10 bg-black/25 px-2 py-1 text-[9px] text-slate-500" key={capability}>{capability}</span>)}</div></div><div className="mt-4 flex items-center justify-between gap-3 border-t border-white/[.07] pt-3"><div className="min-w-0"><p className="text-[9px] uppercase tracking-[.12em] text-slate-600">Ultima evidenza</p><p className="mt-1 truncate text-[10px] text-slate-400">{adapter.lastCheck ? `${adapter.lastCheck.result} · ${adapter.lastCheck.detail}` : "Nessuna evidenza persistita"}</p></div><button aria-label={`Registra evidenza per ${adapter.title}`} className="grid size-8 shrink-0 place-items-center rounded-lg border border-lime-300/20 bg-lime-300/10 text-lime-200 transition hover:bg-lime-300/20 disabled:cursor-not-allowed disabled:opacity-40" disabled={!canManage} onClick={(event) => { event.stopPropagation(); openCheck(adapter); }} type="button"><FileCheck2 className="size-3.5" /></button></div></article>; })}{!loading && filtered.length === 0 && <div className="carbon-card col-span-full rounded-2xl p-10 text-center"><Network className="mx-auto size-8 text-slate-700" /><p className="mt-3 text-sm text-slate-400">Nessun adapter corrisponde ai filtri.</p><p className="mt-1 text-[11px] text-slate-600">Rimuovi un filtro o aggiorna il readback.</p></div>}</section><aside className="carbon-card-neon h-fit rounded-2xl p-5 xl:sticky xl:top-[92px]"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-cyan-200/65">INSPECTOR</p><h2 className="mt-1 text-base font-semibold text-slate-50">{selected?.title ?? "Nessuna selezione"}</h2></div>{selected && <StatusBadge status={selected.effectiveStatus} />}</div>{selected ? <div className="mt-5 space-y-4"><div><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">Provider / boundary</p><p className="mt-1 text-xs text-slate-300">{selected.provider}</p><p className="mt-1 text-[10px] text-slate-600">{selected.boundary} · {selected.tranche}</p></div><div><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">Gate</p><p className="mt-1 text-[11px] leading-5 text-slate-400">{selected.gate}</p></div><div><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">Ultimo readback</p><p className="mt-1 text-[11px] leading-5 text-slate-400">{selected.lastCheck ? `${selected.lastCheck.result} · ${formatDate(selected.lastCheck.checkedAt)}` : "NOT RUN · nessuna evidenza persistita"}</p></div><Button className="h-9 w-full bg-lime-300 text-xs font-semibold text-[#050705] hover:bg-lime-200" disabled={!canManage || liveChecking} onClick={() => openCheck(selected)}><FileCheck2 className="size-3.5" />{selected.key === "openai-runtime" ? "Verifica OpenAI live" : canManage ? "Registra evidenza" : "Sola lettura"}</Button></div> : <p className="mt-4 text-xs leading-5 text-slate-600">Seleziona una scheda del registry per aprire l’inspector.</p>}</aside></div></div>}

            {view === "evidence" && <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]"><section className="carbon-card rounded-2xl p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-cyan-200/65">APPEND-ONLY CHECK LOG</p><h2 className="mt-1 text-lg font-semibold text-slate-50">Evidenze del tenant</h2><p className="mt-1 text-[11px] text-slate-500">Il log registra ciò che è stato dichiarato nel perimetro Sites, non ciò che il provider dovrebbe aver eseguito.</p></div><span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 font-mono text-[10px] text-slate-500">{checks.length} record</span></div><div className="mt-5 space-y-2">{checks.length > 0 ? checks.map((check) => { const adapter = adapters.find((item) => item.key === check.adapterKey); const positive = check.result === "DECLARATIVE_PASS"; return <button className="flex w-full items-center gap-3 rounded-xl border border-white/[.07] bg-black/15 p-3 text-left transition hover:border-lime-300/25" key={check.id} onClick={() => selectAdapter(check.adapterKey)} type="button"><span className={cn("grid size-9 shrink-0 place-items-center rounded-lg border", positive ? "border-lime-300/20 bg-lime-300/10 text-lime-200" : check.result === "BLOCKED" ? "border-rose-300/20 bg-rose-300/10 text-rose-200" : "border-white/10 bg-white/[.03] text-slate-400")}>{positive ? <CheckCircle2 className="size-4" /> : <CircleAlert className="size-4" />}</span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-slate-200">{adapter?.title ?? check.adapterKey}</span><span className="mt-1 block truncate text-[10px] text-slate-600">{check.checkType} · {check.detail}</span></span><span className="hidden shrink-0 text-right sm:block"><span className="block text-[10px] text-slate-500">{check.result}</span><span className="mt-1 block text-[10px] text-slate-700">{formatDate(check.checkedAt)}</span></span><ChevronRight className="size-4 shrink-0 text-slate-700" /></button>; }) : <div className="rounded-2xl border border-dashed border-white/[.1] p-12 text-center"><ListChecks className="mx-auto size-8 text-slate-700" /><p className="mt-3 text-sm text-slate-400">Nessuna evidenza persistita.</p><p className="mt-1 text-[11px] text-slate-600">Il registry è pronto; la certificazione provider resta separata.</p></div>}</div></section><aside className="space-y-4"><section className="carbon-card-neon rounded-2xl p-5"><div className="flex items-center gap-2 text-lime-100"><ShieldCheck className="size-4" /><h2 className="text-sm font-semibold">Evidence policy</h2></div><p className="mt-4 text-xs leading-6 text-slate-500">`DECLARATIVE_PASS` aggiorna solo il log Sites. Non porta un adapter `DEFERRED`, `BLOCKED` o `NOT RUN` a `READY` e non crea un receipt esterno.</p><div className="mt-5 grid gap-2 sm:grid-cols-3 xl:grid-cols-1"><span className="rounded-xl border border-lime-300/20 bg-lime-300/5 px-3 py-2 text-center text-[10px] text-lime-200">APPEND-ONLY</span><span className="rounded-xl border border-lime-300/20 bg-lime-300/5 px-3 py-2 text-center text-[10px] text-lime-200">NO SECRETS</span><span className="rounded-xl border border-amber-300/20 bg-amber-300/5 px-3 py-2 text-center text-[10px] text-amber-200">NO FAKE HEALTH</span></div></section><section className="carbon-card rounded-2xl p-5"><p className="text-[10px] uppercase tracking-[.16em] text-slate-600">Current actor</p><p className="mt-2 text-sm font-semibold text-slate-100">{snapshot.context?.actorEmail ?? "server-derived authority"}</p><p className="mt-1 text-[11px] text-slate-600">{snapshot.context?.tenantId ?? "tenant scope protected"}</p><div className="mt-4 flex flex-wrap gap-1.5">{(snapshot.context?.capabilities ?? []).filter((capability) => capability.includes("external") || capability === "tenant.manage").map((capability) => <span className="rounded-md border border-white/10 bg-black/20 px-2 py-1 font-mono text-[9px] text-slate-500" key={capability}>{capability}</span>)}</div></section></aside></div>}

            {view === "boundaries" && <div className="mt-4 space-y-4"><section className="carbon-card rounded-2xl p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">INTEGRATIONS / HANDOFF MAP</p><h2 className="mt-1 text-xl font-semibold tracking-[-.03em] text-slate-50">Dall’autorità all’evidenza provider.</h2><p className="mt-2 max-w-3xl text-xs leading-5 text-slate-500">Il percorso è visibile e reversibile: ogni layer ha un contratto, una capability, un owner e un readback. Un provider non viene considerato collegato solo perché compare nel catalogo.</p></div><span className="rounded-full border border-amber-300/20 bg-amber-300/5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[.1em] text-amber-100">provider gates open</span></div><div className="mt-6 grid gap-3 lg:grid-cols-4">{INTEGRATION_LANES.map((lane, index) => { const laneAdapters = adapters.filter((adapter) => lane.families.includes(adapter.family)); const laneReady = laneAdapters.filter((adapter) => adapter.effectiveStatus === "READY").length; const LaneIcon = index === 0 ? KeyRound : index === 1 ? Boxes : index === 2 ? Database : Cloud; return <div className="relative" key={lane.id}><div className="carbon-inset h-full rounded-2xl p-4"><div className="flex items-center justify-between gap-2"><span className="grid size-9 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/10 text-lime-200"><LaneIcon className="size-4" /></span><span className="font-mono text-[10px] text-slate-600">0{index + 1}</span></div><h3 className="mt-4 text-sm font-semibold text-slate-100">{lane.label}</h3><p className="mt-1 text-[11px] leading-5 text-slate-600">{lane.detail}</p><div className="mt-4 h-1 overflow-hidden rounded-full bg-white/[.06]"><span className="block h-full bg-lime-300 shadow-[0_0_12px_rgba(200,255,34,.5)]" style={{ width: laneAdapters.length ? `${Math.round((laneReady / laneAdapters.length) * 100)}%` : "0%" }} /></div><p className="mt-2 font-mono text-[10px] text-slate-500">{laneReady}/{laneAdapters.length} ready local</p></div>{index < INTEGRATION_LANES.length - 1 && <ChevronRight className="absolute -right-3 top-1/2 z-10 hidden size-5 -translate-y-1/2 text-lime-300/60 lg:block" />}</div>; })}</div></section><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"><section className="carbon-card rounded-2xl p-4"><KeyRound className="size-5 text-lime-200" /><h3 className="mt-4 text-sm font-semibold">Identity</h3><p className="mt-2 text-[11px] leading-5 text-slate-500">Solo sessione e membership server-side. Nessuna selezione del tenant nel payload.</p></section><section className="carbon-card rounded-2xl p-4"><Database className="size-5 text-lime-200" /><h3 className="mt-4 text-sm font-semibold">Persistence</h3><p className="mt-2 text-[11px] leading-5 text-slate-500">Check in `s05_records`, append-only, tenant-scoped e rileggibili.</p></section><section className="carbon-card rounded-2xl p-4"><ShieldCheck className="size-5 text-lime-200" /><h3 className="mt-4 text-sm font-semibold">Capability</h3><p className="mt-2 text-[11px] leading-5 text-slate-500">Lettura `external_adapters.read`; evidenze solo con `tenant.manage`.</p></section><section className="carbon-card rounded-2xl p-4"><Cloud className="size-5 text-lime-200" /><h3 className="mt-4 text-sm font-semibold">Provider</h3><p className="mt-2 text-[11px] leading-5 text-slate-500">Health, delivery, promotion e mobile restano `DEFERRED`, `BLOCKED` o `NOT_RUN` finché non provati.</p></section></div></div>}

            {loading && <div className="mt-4 rounded-2xl border border-lime-300/10 bg-lime-300/[.03] px-4 py-3 text-xs text-slate-500">Lettura del registry integrazioni…</div>}
            <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/[.08] py-5 text-[10px] text-slate-600"><span>AI-ZEROW COMMAND · INTEGRATIONS CONTROL · W14</span><span className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-lime-300" />Sites private · owner only · no direct external write</span></footer>
          </div>
        </section>
      </div>

      <Dialog open={checkOpen} onOpenChange={setCheckOpen}><DialogContent className="carbon-card max-w-lg border-lime-300/20 p-0 text-slate-100"><form onSubmit={submitCheck}><DialogHeader className="border-b border-white/10 px-5 py-5 text-left"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl border border-lime-300/25 bg-lime-300/10 text-lime-200"><FileCheck2 className="size-4" /></span><div><DialogTitle className="text-base text-slate-50">Registra evidenza Sites</DialogTitle><DialogDescription className="mt-1 text-xs text-slate-500">{selected?.title ?? "Adapter"} · nessuna chiamata al provider esterno.</DialogDescription></div></div></DialogHeader><div className="space-y-4 p-5"><div className="grid gap-3 sm:grid-cols-2"><label className="block"><span className="mb-2 block text-[10px] font-semibold uppercase tracking-[.14em] text-slate-500">Tipo di evidenza</span><select className="h-10 w-full rounded-lg border border-white/10 bg-black/35 px-3 text-xs text-slate-100 outline-none focus:border-lime-300/40" value={checkType} onChange={(event) => setCheckType(event.target.value as CheckType)}><option value="contract">Contract</option><option value="health">Health dichiarativa</option><option value="readback">Readback</option><option value="gate">Roadmap gate</option></select></label><label className="block"><span className="mb-2 block text-[10px] font-semibold uppercase tracking-[.14em] text-slate-500">Esito</span><select className="h-10 w-full rounded-lg border border-white/10 bg-black/35 px-3 text-xs text-slate-100 outline-none focus:border-lime-300/40" value={checkResult} onChange={(event) => setCheckResult(event.target.value as CheckResult)}><option value="DECLARATIVE_PASS">Sites contract pass</option><option value="BLOCKED">Gate bloccato</option><option value="NOT_RUN">Non eseguito</option></select></label></div><label className="block"><span className="mb-2 block text-[10px] font-semibold uppercase tracking-[.14em] text-slate-500">Nota</span><Input required className="border-white/10 bg-black/35 text-xs text-slate-100 placeholder:text-slate-600" maxLength={240} value={detail} onChange={(event) => setDetail(event.target.value)} placeholder="Es. binding dichiarato, consumer non collegato" /></label><label className="block"><span className="mb-2 block text-[10px] font-semibold uppercase tracking-[.14em] text-slate-500">Riferimento evidenza</span><textarea className="min-h-24 w-full rounded-xl border border-white/10 bg-black/35 px-3 py-3 text-xs text-slate-100 outline-none placeholder:text-slate-600 focus:border-lime-300/40" maxLength={360} value={evidence} onChange={(event) => setEvidence(event.target.value)} placeholder="Riferimento leggibile per il prossimo passaggio…" /></label><div className="flex items-start gap-2 rounded-lg border border-amber-300/15 bg-amber-300/5 p-3 text-[10px] leading-4 text-amber-100/75"><CircleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-300" />Il check aggiorna solo il log dichiarativo Sites. Non abilita provider, runtime o scritture esterne.</div></div><DialogFooter className="border-t border-white/10 px-5 py-4"><DialogClose asChild><Button className="border-white/10 bg-transparent text-slate-300 hover:bg-white/10 hover:text-white" variant="outline">Annulla</Button></DialogClose><Button className="bg-lime-300 text-[#060806] hover:bg-lime-200" disabled={saving} type="submit"><FileCheck2 className="size-3.5" />{saving ? "Salvataggio…" : "Registra check"}</Button></DialogFooter></form></DialogContent></Dialog>

      {toast && <button aria-label="Chiudi avviso" className="fixed bottom-5 right-5 z-50 flex max-w-[min(92vw,420px)] items-center gap-3 rounded-xl border border-lime-300/25 bg-[#0a100c]/95 px-4 py-3 text-left text-xs text-lime-100 shadow-[0_0_28px_rgba(190,255,60,.14)] backdrop-blur-xl" onClick={() => setToast("")} type="button"><span className="flex-1">{toast}</span><X className="size-3.5 shrink-0" /></button>}
    </main>
  );
}
