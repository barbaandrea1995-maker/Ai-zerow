"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  ArrowLeft,
  ArrowUpRight,
  Bell,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Cloud,
  Database,
  FileCheck2,
  GitBranch,
  Globe2,
  KeyRound,
  Link2,
  ListChecks,
  Menu,
  Network,
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
  adapters?: Adapter[];
  checks?: Check[];
  summary?: { total: number; ready: number; deferred: number; blocked: number; notRun: number };
  readback?: { persistedChecks?: number; checkedAt?: string; status?: string };
  error?: string;
};

const nav = [
  { label: "COMMAND", href: "/command", icon: Sparkles },
  { label: "OPERATIONS", href: "/operations", icon: Boxes },
  { label: "WORKFORCE", href: "/workforce", icon: Globe2 },
  { label: "FINANCE", href: "/finance", icon: Database },
  { label: "PROCUREMENT", href: "/procurement", icon: Link2 },
  { label: "DOCUMENTS", href: "/documents", icon: FileCheck2 },
  { label: "GOVERNANCE", href: "/governance", icon: ShieldCheck },
  { label: "EXTERNALS", href: "/externals", icon: Network },
  { label: "EVENTS / AUTHORITY", href: "/events", icon: GitBranch },
  { label: "PWA / DIAGNOSTICS", href: "/pwa/diagnostics", icon: Smartphone },
];

const familyIcons: Record<string, LucideIcon> = {
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
  promotion: ArrowUpRight,
};

const statusLabel: Record<Status, string> = {
  READY: "READY",
  DEFERRED: "DEFERRED",
  BLOCKED: "BLOCKED",
  NOT_RUN: "NOT RUN",
};

const statusClass: Record<Status, { badge: string; icon: string; bar: string }> = {
  READY: { badge: "border-lime-300/25 bg-lime-300/10 text-lime-200", icon: "text-lime-200", bar: "bg-lime-300" },
  DEFERRED: { badge: "border-amber-300/25 bg-amber-300/10 text-amber-200", icon: "text-amber-200", bar: "bg-amber-300" },
  BLOCKED: { badge: "border-rose-300/25 bg-rose-300/10 text-rose-200", icon: "text-rose-200", bar: "bg-rose-300" },
  NOT_RUN: { badge: "border-slate-300/15 bg-slate-300/5 text-slate-400", icon: "text-slate-300", bar: "bg-slate-400" },
};

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function StatusBadge({ status }: { status: Status }) {
  const style = statusClass[status];
  return <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-semibold tracking-[0.06em]", style.badge)}><span className={cn("size-1.5 rounded-full bg-current", status === "READY" && "shadow-[0_0_8px_currentColor]")} />{statusLabel[status]}</span>;
}

function Metric({ label, value, detail, icon: Icon, status = "READY" }: { label: string; value: string; detail: string; icon: LucideIcon; status?: Status }) {
  return <article className="carbon-card rounded-2xl p-4"><div className="flex items-start justify-between gap-3"><span className={cn("grid size-9 place-items-center rounded-xl border border-current/20 bg-current/10", statusClass[status].icon)}><Icon className="size-[18px]" /></span><StatusBadge status={status} /></div><p className="mt-4 text-xs text-slate-500">{label}</p><p className="mt-1 font-mono text-[29px] font-semibold leading-none tracking-[-0.06em] text-slate-50">{value}</p><p className="mt-4 text-[10px] text-slate-600">Trend disponibile solo con readback D1.</p><p className="mt-2 text-[10px] text-slate-600">{detail}</p></article>;
}

function BoundaryCard({ icon: Icon, label, value, detail }: { icon: LucideIcon; label: string; value: string; detail: string }) {
  return <div className="carbon-inset rounded-xl p-3"><div className="flex items-center gap-2"><span className="grid size-7 place-items-center rounded-lg border border-lime-300/20 bg-lime-300/10 text-lime-200"><Icon className="size-3.5" /></span><span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</span></div><p className="mt-3 text-xs font-semibold text-slate-100">{value}</p><p className="mt-1 text-[10px] leading-4 text-slate-600">{detail}</p></div>;
}

export default function ExternalControlPage() {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<Snapshot>({});
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState("ALL");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [checkType, setCheckType] = useState<CheckType>("contract");
  const [checkResult, setCheckResult] = useState<CheckResult>("DECLARATIVE_PASS");
  const [detail, setDetail] = useState("");
  const [evidence, setEvidence] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/externals", { cache: "no-store" });
      const data = (await response.json()) as Snapshot;
      if (!response.ok) throw new Error(data.error || "external_registry_readback_failed");
      setSnapshot(data);
      setSelectedKey((current) => current && data.adapters?.some((adapter) => adapter.key === current) ? current : data.adapters?.[0]?.key ?? null);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Readback esterni non disponibile");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

 const adapters = useMemo(() => snapshot.adapters ?? [], [snapshot.adapters]);
  const families = useMemo(() => ["ALL", ...Array.from(new Set(adapters.map((adapter) => adapter.family)))], [adapters]);
  const filtered = useMemo(() => adapters.filter((adapter) => {
    const matchesFamily = family === "ALL" || adapter.family === family;
    const haystack = (adapter.title + " " + adapter.provider + " " + adapter.tranche + " " + adapter.contract + " " + adapter.capabilities.join(" ")).toLowerCase();
    return matchesFamily && haystack.includes(query.trim().toLowerCase());
  }), [adapters, family, query]);
  const selected = adapters.find((adapter) => adapter.key === selectedKey) ?? null;
  const summary = snapshot.summary ?? { total: 0, ready: 0, deferred: 0, blocked: 0, notRun: 0 };

  function openCheck(adapter: Adapter) {
    setSelectedKey(adapter.key);
    setCheckResult(adapter.effectiveStatus === "BLOCKED" ? "BLOCKED" : adapter.effectiveStatus === "NOT_RUN" ? "NOT_RUN" : "DECLARATIVE_PASS");
    setCheckType("contract");
    setDetail(adapter.tranche + " · " + (adapter.effectiveStatus === "READY" ? "Contratto Sites verificato" : "Gate dichiarativo da riallineare"));
    setEvidence("");
  }

  async function submitCheck(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
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
      setToast("Check dichiarativo registrato e letto dal D1 Sites.");
      setSelectedKey(null);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Check non registrato");
    } finally {
      setSaving(false);
    }
  }

  return <main className="min-h-screen bg-[#040505] text-slate-100"><div className="flex min-h-screen"><aside className="hidden w-[232px] shrink-0 flex-col border-r border-lime-300/10 bg-[#050607]/96 px-3 py-4 lg:flex"><div className="flex items-center gap-3 px-2"><button className="neon-pulse relative grid size-10 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black" onClick={() => router.push("/command")} type="button"><img src="/ai-zerow-icon.jpeg" alt="AI-ZEROW" className="size-full object-cover" /></button><button className="text-left" onClick={() => router.push("/command")} type="button"><span className="block text-sm font-bold tracking-[0.18em] text-slate-50">AI-ZEROW</span><span className="block text-[10px] uppercase tracking-[0.22em] text-lime-300/75">command</span></button></div><div className="carbon-card mt-8 rounded-xl p-3"><div className="flex items-center gap-2 text-xs text-slate-200"><Network className="size-4 text-lime-200" />EXTERNAL CONTROL</div><p className="mt-2 text-[10px] leading-5 text-slate-600">Adapter, gate e readback senza credenziali nel catalogo.</p></div><nav className="mt-7 flex-1" aria-label="Navigazione principale"><p className="px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-600">Workspace</p><div className="mt-2 space-y-1">{nav.map((item) => { const Icon = item.icon; const active = item.href === "/externals"; return <button key={item.href} aria-current={active ? "page" : undefined} className={cn("group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition", active ? "border border-lime-300/20 bg-lime-300/10 text-lime-200" : "text-slate-500 hover:bg-white/[0.045] hover:text-slate-100")} onClick={() => router.push(item.href)} type="button"><Icon className={cn("size-4", active ? "text-lime-200" : "text-slate-600 group-hover:text-slate-300")} /><span>{item.label}</span></button>; })}</div></nav><div className="border-t border-white/[0.08] pt-4"><div className="flex items-center justify-between px-2 text-[10px] uppercase tracking-[0.14em] text-slate-600"><span>Control state</span><span className="flex items-center gap-1.5 text-lime-200"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_8px_rgba(190,255,60,0.8)]" />Sites only</span></div><div className="carbon-inset mt-3 rounded-xl p-3"><div className="flex items-center gap-2 text-[10px] text-slate-400"><Activity className="size-3.5 text-lime-300" />External registry</div><p className="mt-2 font-mono text-[9px] text-slate-600">D1 · nessun trend senza readback</p><p className="mt-3 font-mono text-[9px] text-slate-600">S10–S14 · DECLARATIVE</p></div></div></aside><section className="min-w-0 flex-1"><header className="sticky top-0 z-20 flex h-[72px] items-center gap-3 border-b border-white/[0.08] bg-[#040505]/88 px-4 backdrop-blur-xl sm:px-7"><button className="grid size-9 place-items-center rounded-lg border border-white/10 bg-black/30 text-slate-500 lg:hidden" onClick={() => router.push("/command")} type="button" aria-label="Torna a command"><Menu className="size-4" /></button><button className="hidden items-center gap-2 text-xs text-slate-500 hover:text-lime-200 sm:flex" onClick={() => router.push("/command")} type="button"><ArrowLeft className="size-3.5" />Command</button><span className="hidden size-1 rounded-full bg-lime-300 sm:block" /><div className="relative hidden min-w-0 flex-1 md:block"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-600" /><Input aria-label="Cerca adapter" className="h-10 max-w-[440px] border-white/10 bg-black/30 pl-10 text-xs text-slate-100 placeholder:text-slate-600 focus-visible:border-lime-300/40" onChange={(event) => setQuery(event.target.value)} placeholder="Cerca adapter, provider, capability…" value={query} /></div><div className="flex min-w-0 flex-1 items-center gap-2 md:hidden"><span className="truncate text-xs font-semibold tracking-[0.16em] text-slate-200">EXTERNALS</span><span className="size-1 rounded-full bg-lime-300" /></div><div className="ml-auto flex items-center gap-2"><span className="hidden items-center gap-2 rounded-full border border-lime-300/20 bg-lime-300/5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-lime-200 sm:flex"><span className="size-1.5 rounded-full bg-lime-300" />{loading ? "CHECKING" : "D1 READBACK"}</span><button className="grid size-9 place-items-center rounded-lg border border-white/10 bg-black/20 text-slate-500 hover:text-lime-200" onClick={() => void load()} type="button" aria-label="Aggiorna adapter"><RefreshCw className="size-4" /></button><button className="grid size-9 place-items-center rounded-lg border border-white/10 bg-black/20 text-slate-500 hover:text-lime-200" onClick={() => setToast("Nessuna notifica esterna collegata")} type="button" aria-label="Notifiche"><Bell className="size-4" /></button><span className="hidden size-8 place-items-center rounded-full border border-white/15 bg-gradient-to-br from-slate-200 to-slate-500 text-xs font-bold text-[#080a0b] sm:grid">AB</span><div className="hidden text-right lg:block"><p className="text-xs font-medium text-slate-200">Operatore</p><p className="text-[10px] text-slate-600">Tenant EMS</p></div><ChevronDown className="hidden size-3.5 text-slate-500 lg:block" /></div></header><div className="mx-auto max-w-[1680px] px-4 py-5 sm:px-7 sm:py-7"><div className="mb-5 flex flex-wrap items-end justify-between gap-4"><div><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/70"><span className="size-1.5 rounded-full bg-lime-300" />AI-ZEROW / S10–S14 / EXTERNAL CONTROL</div><h1 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-50 sm:text-[28px]">External Control Plane</h1><p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">Catalogo degli adapter esterni, confini operativi e gate della roadmap. La console registra solo evidenze dichiarative: nessuna credenziale, endpoint o scrittura esterna viene simulata.</p></div><div className="flex items-center gap-2"><span className="hidden items-center rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-[10px] text-slate-500 sm:inline-flex"><Activity className="mr-2 size-3.5 text-lime-300" />{snapshot.readback?.persistedChecks ?? 0} check persistiti</span><Button variant="outline" className="h-9 border-white/10 bg-black/20 text-xs text-slate-300 hover:border-lime-300/30 hover:text-lime-200" onClick={() => void load()}><RefreshCw className="size-3.5" />Aggiorna</Button></div></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Adapter catalogati" value={loading ? "—" : String(summary.total)} detail="S10–S14 registry" icon={Network} /><Metric label="Sites / declared" value={loading ? "—" : String(summary.ready)} detail="native control plane" icon={Sparkles} /><Metric label="Deferred" value={loading ? "—" : String(summary.deferred)} detail="connector boundary" icon={Link2} status="DEFERRED" /><Metric label="Blocked / not run" value={loading ? "—" : String(summary.blocked + summary.notRun)} detail="gate non certificato" icon={CircleAlert} status={summary.blocked > 0 ? "BLOCKED" : "NOT_RUN"} /></div><div className="mt-4 grid gap-4 xl:grid-cols-[1.28fr_0.72fr]"><section className="carbon-card-neon rounded-2xl p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-lime-300/70">BOUNDARY / SITES ONLY</p><h2 className="mt-1 text-lg font-semibold text-slate-50">Extenders senza scorciatoie</h2><p className="mt-1 max-w-2xl text-[11px] leading-5 text-slate-500">Gli esterni sono ora modellati come contratti governati. Il modulo rende esplicito cosa è pronto, cosa richiede un adapter autorizzato e cosa resta bloccato dal vincolo operativo Sites-only.</p></div><StatusBadge status="READY" /></div><div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><BoundaryCard icon={ShieldCheck} label="Authority" value="Server-owned" detail="Ruolo e tenant arrivano dal contesto Sites." /><BoundaryCard icon={Database} label="Persistence" value="D1 readback" detail="I check sono append-only in s05_records." /><BoundaryCard icon={KeyRound} label="Secrets" value="Never stored" detail="Nessun token, URL o credential entra nel catalogo." /><BoundaryCard icon={Cloud} label="Execution" value="Declarative" detail="Le connessioni esterne non vengono invocate." /></div></section><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200/65">ROADMAP / GATES</p><h2 className="mt-1 text-[15px] font-semibold">S10 → S14</h2></div><ListChecks className="size-5 text-cyan-200" /></div><div className="mt-4 space-y-3">{[{ tranche: "S10", key: "neon-schema-binding", label: "Schema / migrations" }, { tranche: "S11", key: "runtime-parity", label: "Runtime parity" }, { tranche: "S12", key: "native-mobile", label: "Native mobile" }, { tranche: "S13", key: "certification-harness", label: "Certification" }, { tranche: "S14", key: "external-promotion", label: "Promotion" }].map((gate) => { const adapter = adapters.find((item) => item.key === gate.key); const gateStatus = adapter?.effectiveStatus ?? "NOT_RUN"; return <div className="flex items-center gap-3" key={gate.tranche}><span className="w-8 font-mono text-[10px] text-slate-600">{gate.tranche}</span><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-3"><span className="truncate text-[11px] text-slate-300">{gate.label}</span><span className={cn("text-[10px]", statusClass[gateStatus].icon)}>{statusLabel[gateStatus]}</span></div><div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10"><span className={cn("block h-full", statusClass[gateStatus].bar)} style={{ width: (gateStatus === "READY" ? 100 : gateStatus === "BLOCKED" ? 24 : gateStatus === "DEFERRED" ? 52 : 12) + "%" }} /></div></div></div>; })}</div><div className="mt-5 rounded-xl border border-amber-300/15 bg-amber-300/5 p-3"><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-200"><CircleAlert className="size-3.5" />Evidence policy</div><p className="mt-2 text-[11px] leading-5 text-slate-500">DEFERRED, BLOCKED e NOT RUN restano visibili. Un check Sites non certifica il servizio canonico esterno.</p></div></section></div><section className="carbon-card mt-4 rounded-2xl p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-lime-300/70">ADAPTER REGISTRY</p><h2 className="mt-1 text-[15px] font-semibold">Catalogo operativo</h2><p className="mt-1 text-[11px] text-slate-500">Seleziona un confine per vedere contratto, capability e ultimo check.</p></div><div className="flex flex-wrap items-center gap-2">{families.map((item) => <button className={cn("rounded-lg border px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] transition", family === item ? "border-lime-300/30 bg-lime-300/15 text-lime-200" : "border-white/10 bg-black/20 text-slate-600 hover:border-lime-300/20 hover:text-slate-300")} key={item} onClick={() => setFamily(item)} type="button">{item === "ALL" ? "Tutti" : item}</button>)}</div></div><div className="mt-4 grid gap-3 xl:grid-cols-2">{filtered.map((adapter) => { const Icon = familyIcons[adapter.family] ?? Network; const status = adapter.effectiveStatus; return <article className={cn("carbon-inset rounded-2xl p-4 transition", selectedKey === adapter.key ? "border-lime-300/45 bg-lime-300/[0.045] shadow-[0_0_30px_rgba(190,255,60,0.08)]" : "hover:border-lime-300/25")} key={adapter.key}><div className="flex items-start gap-3"><span className={cn("grid size-10 shrink-0 place-items-center rounded-xl border border-current/20 bg-current/10", statusClass[status].icon)}><Icon className="size-[18px]" /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-[10px] text-lime-300/65">{adapter.tranche}</span><StatusBadge status={status} /></div><h3 className="mt-2 text-sm font-semibold text-slate-100">{adapter.title}</h3><p className="mt-1 text-[10px] text-slate-500">{adapter.provider} · {adapter.boundary}</p></div><button className="grid size-8 place-items-center rounded-lg border border-white/10 bg-black/25 text-slate-600 hover:border-lime-300/30 hover:text-lime-200" onClick={() => openCheck(adapter)} type="button" aria-label={"Seleziona " + adapter.title}><ChevronRight className="size-4" /></button></div><div className="mt-4 rounded-xl border border-white/[0.07] bg-black/20 p-3"><p className="text-[10px] leading-5 text-slate-400">{adapter.contract}</p><div className="mt-3 flex flex-wrap gap-1.5">{adapter.capabilities.map((capability) => <span className="rounded-md border border-white/10 bg-black/25 px-2 py-1 text-[9px] text-slate-500" key={capability}>{capability}</span>)}</div></div><div className="mt-4 flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><p className="text-[9px] uppercase tracking-[0.12em] text-slate-600">Ultimo check</p><p className="mt-1 truncate text-[10px] text-slate-400">{adapter.lastCheck ? adapter.lastCheck.result + " · " + adapter.lastCheck.detail : "Nessuna evidenza persistita"}</p></div><Button className="h-8 shrink-0 border border-lime-300/25 bg-lime-300/10 px-2.5 text-[10px] text-lime-200 hover:bg-lime-300/20" onClick={() => openCheck(adapter)}><FileCheck2 className="size-3.5" />Registra check</Button></div><p className="mt-3 flex items-center gap-1.5 text-[10px] text-slate-600"><ArrowUpRight className="size-3" />{adapter.nextAction}</p></article>; })}</div>{!loading && filtered.length === 0 && <p className="py-10 text-center text-xs text-slate-600">Nessun adapter corrisponde al filtro.</p>}{loading && <p className="py-10 text-center text-xs text-slate-600">Catalogo in lettura…</p>}</section><section className="mt-4 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]"><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200/65">CHECK LOG</p><h2 className="mt-1 text-[15px] font-semibold">Ultime evidenze</h2></div><span className="font-mono text-[10px] text-slate-600">{snapshot.readback?.persistedChecks ?? 0} persisted</span></div><div className="mt-4 divide-y divide-white/[0.07]">{(snapshot.checks ?? []).slice(0, 6).map((check) => { const adapter = adapters.find((item) => item.key === check.adapterKey); return <div className="flex items-center gap-3 py-3" key={check.id}><span className={cn("grid size-8 shrink-0 place-items-center rounded-lg border", check.result === "DECLARATIVE_PASS" ? "border-lime-300/20 bg-lime-300/10 text-lime-200" : check.result === "BLOCKED" ? "border-rose-300/20 bg-rose-300/10 text-rose-200" : "border-white/10 bg-black/20 text-slate-400")}>{check.result === "DECLARATIVE_PASS" ? <CheckCircle2 className="size-4" /> : <CircleAlert className="size-4" />}</span><div className="min-w-0 flex-1"><p className="truncate text-xs text-slate-200">{adapter?.title ?? check.adapterKey}</p><p className="mt-1 truncate text-[10px] text-slate-600">{check.checkType} · {check.detail}</p></div><span className="shrink-0 text-[10px] text-slate-600">{check.result}</span></div>; })}{!loading && (snapshot.checks ?? []).length === 0 && <p className="py-6 text-center text-xs text-slate-600">Ancora nessun check: il catalogo è pronto, la certificazione no.</p>}</div></section><section className="carbon-card-neon rounded-2xl p-4 sm:p-5"><div className="flex items-start gap-3"><span className="grid size-9 place-items-center rounded-xl border border-lime-300/25 bg-lime-300/10 text-lime-200"><ShieldCheck className="size-[18px]" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-lime-300/70">EXTERNALS / CONTRACT</p><h2 className="mt-1 text-sm font-semibold">Regola di confine</h2></div></div><p className="mt-4 text-xs leading-6 text-slate-500">Il registro documenta l’interfaccia e la prova disponibile. Non esegue ping inventati, non conserva segreti e non promuove un adapter DEFERRED a READY solo perché il contratto è stato letto.</p><div className="mt-5 grid gap-2 sm:grid-cols-3"><span className="rounded-xl border border-lime-300/20 bg-lime-300/5 px-3 py-2 text-center text-[10px] text-lime-200">NO SECRETS</span><span className="rounded-xl border border-lime-300/20 bg-lime-300/5 px-3 py-2 text-center text-[10px] text-lime-200">NO DIRECT WRITE</span><span className="rounded-xl border border-amber-300/20 bg-amber-300/5 px-3 py-2 text-center text-[10px] text-amber-200">NO FAKE HEALTH</span></div></section></section><footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] py-5 text-[10px] text-slate-600"><span>AI-ZEROW COMMAND · EXTERNAL CONTROL · S10–S14</span><span className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-lime-300" />Sites private · owner only · external execution deferred</span></footer></div></section></div><Dialog open={Boolean(selectedKey)} onOpenChange={(open) => { if (!open) setSelectedKey(null); }}><DialogContent className="carbon-card max-w-lg border-lime-300/20 p-0 text-slate-100"><form onSubmit={submitCheck}><DialogHeader className="border-b border-white/10 px-5 py-5 text-left"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl border border-lime-300/25 bg-lime-300/10 text-lime-200"><FileCheck2 className="size-4" /></span><div><DialogTitle className="text-base text-slate-50">Registra evidenza dichiarativa</DialogTitle><DialogDescription className="mt-1 text-xs text-slate-500">{selected?.title ?? "Adapter"} · nessuna chiamata al provider esterno.</DialogDescription></div></div></DialogHeader><div className="space-y-4 p-5"><div className="grid gap-3 sm:grid-cols-2"><label className="block"><span className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Tipo</span><select className="h-10 w-full rounded-lg border border-white/10 bg-black/35 px-3 text-xs text-slate-100 outline-none focus:border-lime-300/40" value={checkType} onChange={(event) => setCheckType(event.target.value as CheckType)}><option value="contract">Contract</option><option value="health">Health dichiarativa</option><option value="readback">Readback</option><option value="gate">Roadmap gate</option></select></label><label className="block"><span className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Esito</span><select className="h-10 w-full rounded-lg border border-white/10 bg-black/35 px-3 text-xs text-slate-100 outline-none focus:border-lime-300/40" value={checkResult} onChange={(event) => setCheckResult(event.target.value as CheckResult)}><option value="DECLARATIVE_PASS">Contratto Sites verificato</option><option value="BLOCKED">Gate bloccato</option><option value="NOT_RUN">Non eseguito</option></select></label></div><label className="block"><span className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Nota</span><Input className="border-white/10 bg-black/35 text-xs text-slate-100 placeholder:text-slate-600" value={detail} onChange={(event) => setDetail(event.target.value)} placeholder="Es. binding dichiarato, consumer non collegato" /></label><label className="block"><span className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Evidenza</span><textarea className="min-h-24 w-full rounded-xl border border-white/10 bg-black/35 px-3 py-3 text-xs text-slate-100 outline-none placeholder:text-slate-600 focus:border-lime-300/40" value={evidence} onChange={(event) => setEvidence(event.target.value)} placeholder="Riferimento leggibile per il prossimo passaggio…" /></label><div className="flex items-start gap-2 rounded-lg border border-amber-300/15 bg-amber-300/5 p-3 text-[10px] leading-4 text-amber-100/75"><CircleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-300" />Questo check certifica solo il contratto Sites dichiarato. Non abilita provider, runtime o scritture esterne.</div></div><DialogFooter className="border-t border-white/10 px-5 py-4"><DialogClose asChild><Button className="border-white/10 bg-transparent text-slate-300 hover:bg-white/10 hover:text-white" variant="outline">Annulla</Button></DialogClose><Button className="bg-lime-300 text-[#060806] hover:bg-lime-200" disabled={saving} type="submit"><FileCheck2 className="size-3.5" />{saving ? "Salvataggio…" : "Registra check"}</Button></DialogFooter></form></DialogContent></Dialog>{toast && <button className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-xl border border-lime-300/25 bg-[#0a100c]/95 px-4 py-3 text-left text-xs text-lime-100 shadow-[0_0_28px_rgba(190,255,60,0.14)] backdrop-blur-xl" onClick={() => setToast("")} type="button">{toast}<X className="size-3.5" /></button>}</main>;
}
