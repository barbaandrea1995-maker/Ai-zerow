"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  CircleAlert,
  CircleGauge,
  FileCheck2,
  KeyRound,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import Image from "next/image";
import { Button } from "@/components/ui/button";

type ReadinessStatus = "READY" | "NOT_RUN" | "NOT_CONFIGURED" | "BLOCKED";
type Gate = { id: string; label: string; status: ReadinessStatus; detail: string; evidence: string; nextAction: string };
type Readiness = {
  contract?: { tranche?: string; commercialStatus?: string; directWrite?: boolean; approval?: string };
  authority?: { role?: string; identityProvider?: string; tenantScope?: string; governanceRead?: boolean; commandRead?: boolean; approvalsReview?: boolean };
  runtime?: { provider?: string; configured?: boolean; model?: string; mode?: string; directWrite?: boolean; liveRequest?: string };
  gates?: Gate[];
  ledger?: { count?: number; status?: ReadinessStatus; checkedAt?: string | null };
  external?: { status?: ReadinessStatus; persistedChecks?: number; openAiAdapterStatus?: ReadinessStatus; latestOpenAiHealth?: { result?: string; checkedAt?: string; evidence?: string } | null };
  blockers?: string[];
  readback?: { checkedAt?: string };
  error?: string;
};

const statusTone: Record<ReadinessStatus, { badge: string; icon: string; label: string }> = {
  READY: { badge: "border-lime-300/25 bg-lime-300/10 text-lime-200", icon: "text-lime-200", label: "READY" },
  NOT_RUN: { badge: "border-amber-300/25 bg-amber-300/10 text-amber-200", icon: "text-amber-200", label: "NOT RUN" },
  NOT_CONFIGURED: { badge: "border-amber-300/25 bg-amber-300/10 text-amber-200", icon: "text-amber-200", label: "CONFIG REQUIRED" },
  BLOCKED: { badge: "border-rose-300/25 bg-rose-300/10 text-rose-200", icon: "text-rose-200", label: "BLOCKED" },
};

function StatusBadge({ status }: { status: ReadinessStatus }) {
  const tone = statusTone[status];
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-semibold tracking-[0.06em] ${tone.badge}`}><span className="size-1.5 rounded-full bg-current" />{tone.label}</span>;
}

function GateIcon({ status }: { status: ReadinessStatus }) {
  const Icon = status === "READY" ? CheckCircle2 : status === "BLOCKED" ? XCircle : CircleAlert;
  return <Icon className={`size-[18px] ${statusTone[status].icon}`} />;
}

function Metric({ icon: Icon, label, value, detail, status = "READY" }: { icon: LucideIcon; label: string; value: string; detail: string; status?: ReadinessStatus }) {
  return <article className="carbon-card rounded-2xl p-4"><div className="flex items-start justify-between gap-3"><span className={`grid size-9 place-items-center rounded-xl border border-current/20 bg-current/10 ${statusTone[status].icon}`}><Icon className="size-[18px]" /></span><StatusBadge status={status} /></div><p className="mt-4 text-xs text-slate-500">{label}</p><p className="mt-1 font-mono text-[28px] font-semibold leading-none tracking-[-0.06em] text-slate-50">{value}</p><p className="mt-3 text-[10px] leading-4 text-slate-600">{detail}</p></article>;
}

export default function CompanyAiGovernance() {
  const router = useRouter();
  const [data, setData] = useState<Readiness>({});
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/governance/ai-readiness", { cache: "no-store" });
      const payload = await response.json() as Readiness;
      if (!response.ok) throw new Error(payload.error || "ai_readiness_unavailable");
      setData(payload);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Readiness non disponibile");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const gates = data.gates ?? [];
  const readyCount = gates.filter((gate) => gate.status === "READY").length;
  const openCount = gates.filter((gate) => gate.status !== "READY").length;
  const runtime = data.runtime;
  const ledgerStatus = data.ledger?.status ?? "BLOCKED";
  const nav = (path: string) => router.push(path);
  const lastCheck = data.readback?.checkedAt ? new Date(data.readback.checkedAt).toLocaleString("it-IT") : "—";

  const priority = useMemo(() => [
    { label: "Eseguire prova OpenAI live", detail: "Richiesta autenticata, request id redatto e readback del ledger.", status: "NOT_RUN" as ReadinessStatus, href: "/externals" },
    { label: "Certificare scanner documenti", detail: "Callback CLEAN vincolato all’hash del documento.", status: "NOT_RUN" as ReadinessStatus, href: "/documents" },
    { label: "Chiudere device e sign-off", detail: "Browser/PWA, privacy, security e commerciale.", status: "NOT_RUN" as ReadinessStatus, href: "/pwa/diagnostics" },
  ], []);

  return <main className="min-h-screen bg-[#050607] text-slate-100"><div className="flex min-h-screen"><aside className="hidden w-[248px] shrink-0 flex-col border-r border-lime-300/10 bg-[#050607]/96 px-3 py-4 lg:flex"><button className="flex items-center gap-3 px-2 text-left" onClick={() => nav("/command")} type="button"><span className="neon-pulse grid size-10 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black"><Image src="/ai-zerow-icon.jpeg" alt="AI-ZEROW" width={40} height={40} className="size-full object-cover" /></span><span><span className="block text-sm font-bold tracking-[0.18em] text-slate-50">AI-ZEROW</span><span className="block text-[10px] uppercase tracking-[0.22em] text-lime-300/75">command</span></span></button><div className="carbon-card mt-8 rounded-2xl p-3"><div className="flex items-center gap-2 text-xs text-lime-200"><ShieldCheck className="size-4" />W12 CONTROL PLANE</div><p className="mt-2 text-[10px] leading-5 text-slate-600">Company AI, approval, ledger e provider boundary nello stesso perimetro.</p></div><nav className="mt-7 flex-1" aria-label="Navigazione governance"><p className="px-3 text-[9px] font-semibold uppercase tracking-[0.22em] text-slate-700">Governance</p><div className="mt-2 space-y-1">{[
    ["/command", "COMMAND", Sparkles], ["/governance", "AI CONTROL PLANE", ShieldCheck], ["/externals", "EXTERNAL ADAPTERS", KeyRound], ["/events", "EVENTS / LEDGER", FileCheck2], ["/onboarding", "AUTHORITY", LockKeyhole],
  ].map(([href, label, Icon]) => <button className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${href === "/governance" ? "border border-lime-300/20 bg-lime-300/10 text-lime-200" : "text-slate-500 hover:bg-white/[0.045] hover:text-slate-100"}`} key={href as string} onClick={() => nav(href as string)} type="button"><Icon className="size-4" /><span>{label as string}</span></button>)}</div></nav><div className="border-t border-white/[0.08] pt-4"><div className="flex items-center justify-between px-2 text-[9px] uppercase tracking-[0.14em] text-slate-600"><span>Authority</span><span className="text-lime-200">{data.authority?.role ?? "—"}</span></div><p className="mt-3 px-2 font-mono text-[9px] text-slate-600">tenant scoped · no secrets exported</p></div></aside><section className="min-w-0 flex-1"><header className="sticky top-0 z-20 flex h-[72px] items-center gap-3 border-b border-white/[0.08] bg-[#050607]/88 px-4 backdrop-blur-xl sm:px-7"><button className="grid size-9 place-items-center rounded-xl border border-white/10 bg-black/30 text-slate-500 lg:hidden" onClick={() => nav("/command")} type="button" aria-label="Torna a command"><ArrowLeft className="size-4" /></button><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/70">AI-ZEROW / W12 / GOVERNANCE</p><h1 className="mt-1 text-base font-semibold tracking-[-0.03em] text-slate-50 sm:text-lg">Company AI control plane</h1></div><div className="ml-auto flex items-center gap-2"><span className="hidden items-center gap-2 rounded-full border border-amber-300/20 bg-amber-300/5 px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-amber-100 sm:flex"><span className="size-1.5 rounded-full bg-amber-300" />COMMERCIAL NO-GO</span><Button aria-label="Aggiorna readiness" className="h-9 border-white/10 bg-black/20 text-xs text-slate-300 hover:border-lime-300/30 hover:text-lime-200" onClick={() => void load()} variant="outline"><RefreshCw className="size-3.5" />Aggiorna</Button></div></header><div className="mx-auto max-w-[1680px] px-4 py-5 sm:px-7 sm:py-7"><div className="mb-5 flex flex-wrap items-end justify-between gap-4"><div><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/70"><span className="size-1.5 rounded-full bg-lime-300" />GOVERNED AI / READINESS</div><h2 className="mt-2 text-2xl font-semibold tracking-[-0.05em] text-slate-50 sm:text-[32px]">Stato certificabile, senza ambiguità</h2><p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">La schermata separa ciò che è chiuso in Sites da ciò che richiede un provider o una prova esterna. Una chiave configurata non viene presentata come OpenAI live.</p></div><div className="flex items-center gap-2"><span className="rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-[10px] text-slate-500"><Activity className="mr-2 inline size-3.5 text-lime-300" />Ultimo readback {lastCheck}</span></div></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric icon={CircleGauge} label="Gate locali pronti" value={loading ? "—" : `${readyCount}/${gates.length}`} detail="Contratti verificati nel perimetro Sites" status={readyCount && openCount === 0 ? "READY" : "NOT_RUN"} /><Metric icon={TerminalSquare} label="Ledger Company AI" value={loading ? "—" : String(data.ledger?.count ?? 0)} detail="Entry recenti nel tenant corrente" status={ledgerStatus} /><Metric icon={KeyRound} label="Runtime provider" value={runtime?.configured ? "BOUND" : "—"} detail={runtime?.model ? `${runtime.model} · server-side` : "Binding non osservato"} status={runtime?.configured ? "READY" : "NOT_CONFIGURED"} /><Metric icon={LockKeyhole} label="Scrittura diretta" value="BLOCKED" detail="Preview, approval e tool boundary" status="READY" /></div><div className="mt-4 grid gap-4 2xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]"><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-lime-300/70">W12 / GATE REGISTER</p><h2 className="mt-1 text-[15px] font-semibold">Contratto Company AI</h2><p className="mt-1 text-[11px] text-slate-500">Ogni riga ha stato, evidenza e prossimo passo. I gate provider non vengono promossi a READY per convenienza.</p></div><span className="rounded-full border border-lime-300/20 bg-lime-300/5 px-2 py-1 text-[10px] text-lime-200">{readyCount} READY</span></div><div className="mt-4 space-y-2">{gates.map((item) => <article className="rounded-xl border border-white/[0.08] bg-black/20 p-3" key={item.id}><div className="flex items-start gap-3"><span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border border-white/10 bg-black/25"><GateIcon status={item.status} /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-xs font-semibold text-slate-200">{item.label}</h3><StatusBadge status={item.status} /></div><p className="mt-1 text-[11px] leading-5 text-slate-500">{item.detail}</p><div className="mt-2 grid gap-2 text-[10px] sm:grid-cols-2"><p className="rounded-lg border border-white/[0.06] bg-black/20 px-2.5 py-2 text-slate-600"><span className="text-slate-500">Evidenza · </span>{item.evidence}</p><p className="rounded-lg border border-amber-300/10 bg-amber-300/[0.03] px-2.5 py-2 text-amber-100/70"><span className="text-amber-100/50">Next · </span>{item.nextAction}</p></div></div></div></article>)}</div></section><aside className="space-y-4"><section className="carbon-card-neon rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-lime-300/70">RUNTIME BOUNDARY</p><h2 className="mt-1 text-sm font-semibold">OpenAI e tool gateway</h2></div><StatusBadge status={runtime?.liveRequest === "NOT_RUN" ? "NOT_RUN" : "BLOCKED"} /></div><div className="mt-4 space-y-3 text-xs"><div className="flex items-center justify-between border-b border-white/[0.08] pb-3"><span className="text-slate-500">Provider</span><span className="text-slate-200">{runtime?.provider ?? "openai"}</span></div><div className="flex items-center justify-between border-b border-white/[0.08] pb-3"><span className="text-slate-500">Model</span><span className="font-mono text-lime-100">{runtime?.model ?? "—"}</span></div><div className="flex items-center justify-between border-b border-white/[0.08] pb-3"><span className="text-slate-500">Binding</span><span className={runtime?.configured ? "text-lime-200" : "text-amber-200"}>{runtime?.configured ? "SERVER-SIDE" : "NOT OBSERVED"}</span></div><div className="flex items-center justify-between"><span className="text-slate-500">Direct write</span><span className="text-lime-200">BLOCKED</span></div></div><div className="mt-4 rounded-xl border border-amber-300/15 bg-amber-300/[0.045] p-3"><p className="text-[11px] leading-5 text-amber-100/80">La chiave non viene mai restituita dal readback. La prova OpenAI live resta separata dalla semplice presenza del binding.</p></div></section><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-lime-300/70">AUTHORITY CONTEXT</p><h2 className="mt-1 text-sm font-semibold">Chi vede questo controllo</h2></div><LockKeyhole className="size-4 text-lime-200" /></div><div className="mt-4 grid grid-cols-2 gap-2"><div className="carbon-inset rounded-xl p-3"><p className="text-[10px] text-slate-600">Ruolo</p><p className="mt-1 text-sm text-slate-100">{data.authority?.role ?? "—"}</p></div><div className="carbon-inset rounded-xl p-3"><p className="text-[10px] text-slate-600">Identity</p><p className="mt-1 text-sm text-slate-100">{data.authority?.identityProvider ?? "—"}</p></div><div className="carbon-inset rounded-xl p-3"><p className="text-[10px] text-slate-600">Tenant scope</p><p className="mt-1 text-sm text-lime-100">{data.authority?.tenantScope ?? "—"}</p></div><div className="carbon-inset rounded-xl p-3"><p className="text-[10px] text-slate-600">Approval</p><p className="mt-1 text-sm text-lime-100">{data.authority?.approvalsReview ? "ENABLED" : "READ ONLY"}</p></div></div><p className="mt-4 text-[10px] leading-4 text-slate-600">Il frontend non può ampliare tenant, ruolo o capability. Il server riduce il perimetro prima di ogni lettura.</p></section></aside></div><section className="carbon-card mt-4 rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-lime-300/70">CERTIFICATION QUEUE</p><h2 className="mt-1 text-sm font-semibold">Prossimi blocchi da chiudere</h2></div><span className="font-mono text-[10px] text-amber-200">{data.contract?.commercialStatus ?? "NO_GO"}</span></div><div className="mt-4 grid gap-3 md:grid-cols-3">{priority.map((item) => <button className="group rounded-xl border border-white/[0.08] bg-black/20 p-3 text-left transition hover:border-lime-300/25 hover:bg-lime-300/[0.04]" key={item.label} onClick={() => nav(item.href)} type="button"><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold text-slate-200">{item.label}</span><ArrowUpRight className="size-3.5 text-slate-600 transition group-hover:text-lime-200" /></div><p className="mt-2 text-[11px] leading-5 text-slate-500">{item.detail}</p><div className="mt-3"><StatusBadge status={item.status} /></div></button>)}</div></section><footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] py-5 text-[10px] text-slate-600"><span>AI-ZEROW COMMAND · W12 / COMPANY AI CONTROL PLANE</span><span className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-lime-300" />no secrets exported · approval gated · tenant scoped</span></footer></div></section></div>{toast ? <button className="fixed bottom-5 right-5 z-50 max-w-[360px] rounded-xl border border-lime-300/25 bg-[#0a100c]/95 px-4 py-3 text-left text-xs text-amber-100 shadow-[0_0_28px_rgba(190,255,60,0.14)] backdrop-blur-xl" onClick={() => setToast("")} type="button">{toast}</button> : null}</main>;
}
