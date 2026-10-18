"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  ArrowLeft,
  ArrowUpRight,
  BadgeCheck,
  CheckCircle2,
  CircleAlert,
  CircleX,
  FileCheck2,
  KeyRound,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TimerReset,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReleaseGateStatus } from "@/lib/release-readiness";

type ReleaseGate = {
  id: string;
  workstream: string;
  label: string;
  status: ReleaseGateStatus;
  detail: string;
  evidence: string;
  nextAction: string;
  href?: string;
};

type ReleaseSnapshot = {
  contract?: { tranche?: string; certification?: string; commercialStatus?: string; promotionAllowed?: boolean; directWrite?: boolean };
  build?: { id?: string; label?: string; runtimePublication?: string; previousPublishedSitesVersion?: number; lastPublishedRuntimeStatus?: string };
  authority?: { role?: string; identityProvider?: string; tenantScope?: string };
  summary?: { status?: "READY" | "PARTIAL"; commercialStatus?: "GO" | "NO_GO"; promotionAllowed?: boolean; ready?: number; open?: number; blocked?: number; notRun?: number; review?: number; total?: number };
  gates?: ReleaseGate[];
  blockers?: string[];
  evidence?: { ledger?: { status?: string; count?: number }; externalRegistry?: { status?: string; persistedChecks?: number; summary?: { deferred?: number; notRun?: number; total?: number } | null }; restore?: { d1?: string; r2?: string } };
  readback?: { checkedAt?: string };
  error?: string;
};

type Filter = "ALL" | string;

const statusTone: Record<ReleaseGateStatus, { label: string; badge: string; icon: string }> = {
  READY: { label: "READY", badge: "border-lime-300/25 bg-lime-300/10 text-lime-200", icon: "text-lime-200" },
  PARTIAL: { label: "PARTIAL", badge: "border-cyan-300/25 bg-cyan-300/10 text-cyan-200", icon: "text-cyan-200" },
  NOT_RUN: { label: "NOT RUN", badge: "border-amber-300/25 bg-amber-300/10 text-amber-200", icon: "text-amber-200" },
  BLOCKED: { label: "BLOCKED", badge: "border-rose-300/25 bg-rose-300/10 text-rose-200", icon: "text-rose-200" },
  PENDING_REVIEW: { label: "REVIEW", badge: "border-violet-300/25 bg-violet-300/10 text-violet-200", icon: "text-violet-200" },
};

function StatusBadge({ status }: { status: ReleaseGateStatus }) {
  const tone = statusTone[status];
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-semibold tracking-[0.06em] ${tone.badge}`}><span className="size-1.5 rounded-full bg-current" />{tone.label}</span>;
}

function StatusIcon({ status }: { status: ReleaseGateStatus }) {
  const Icon = status === "READY" ? CheckCircle2 : status === "BLOCKED" ? CircleX : CircleAlert;
  return <Icon className={`size-[18px] ${statusTone[status].icon}`} />;
}

function Metric({ icon: Icon, label, value, detail, status }: { icon: LucideIcon; label: string; value: string; detail: string; status: ReleaseGateStatus }) {
  return <article className="carbon-card rounded-2xl p-4"><div className="flex items-start justify-between gap-3"><span className={`grid size-9 place-items-center rounded-xl border border-current/20 bg-current/10 ${statusTone[status].icon}`}><Icon className="size-[18px]" /></span><StatusBadge status={status} /></div><p className="mt-4 text-xs text-slate-500">{label}</p><p className="mt-1 font-mono text-[28px] font-semibold leading-none tracking-[-0.06em] text-slate-50">{value}</p><p className="mt-3 text-[10px] leading-4 text-slate-600">{detail}</p></article>;
}

export default function ReleaseCertificationCenter() {
  const router = useRouter();
  const [data, setData] = useState<ReleaseSnapshot>({});
  const [filter, setFilter] = useState<Filter>("ALL");
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/release/readiness", { cache: "no-store" });
      const payload = await response.json() as ReleaseSnapshot;
      if (!response.ok) throw new Error(payload.error || "release_readiness_unavailable");
      setData(payload);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Readiness release non disponibile");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const gates = useMemo(() => data.gates ?? [], [data.gates]);
  const filters = useMemo(() => ["ALL", ...new Set(gates.map((gate) => gate.workstream))], [gates]);
  const filteredGates = useMemo(() => filter === "ALL" ? gates : gates.filter((gate) => gate.workstream === filter), [filter, gates]);
  const summary = data.summary;
  const openGates = gates.filter((gate) => gate.status !== "READY");
  const lastCheck = data.readback?.checkedAt ? new Date(data.readback.checkedAt).toLocaleString("it-IT") : "—";
  const nav = (path: string) => router.push(path);

  return <main className="zw-app-shell zw-command-ultra min-h-screen overflow-x-hidden text-slate-100"><div className="zw-command-ambient" aria-hidden="true" /><div className="relative flex min-h-screen"><aside className="hidden w-[248px] shrink-0 flex-col border-r border-lime-300/10 bg-[#050607]/96 px-3 py-4 lg:flex"><button className="flex items-center gap-3 px-2 text-left" onClick={() => nav("/command")} type="button"><span className="neon-pulse grid size-10 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black"><Image src="/ai-zerow-icon.jpeg" alt="AI-ZEROW" width={40} height={40} className="size-full object-cover" /></span><span><span className="block text-sm font-bold tracking-[0.18em] text-slate-50">AI-ZEROW</span><span className="block text-[10px] uppercase tracking-[0.22em] text-lime-300/75">command</span></span></button><div className="carbon-card mt-8 rounded-2xl p-3"><div className="flex items-center gap-2 text-xs text-lime-200"><BadgeCheck className="size-4" />W17 RELEASE CENTER</div><p className="mt-2 text-[10px] leading-5 text-slate-600">Unico registro di promozione: evidenza locale, provider e sign-off restano separati.</p></div><nav className="mt-7 flex-1" aria-label="Navigazione release"><p className="px-3 text-[9px] font-semibold uppercase tracking-[0.22em] text-slate-700">Certification</p><div className="mt-2 space-y-1">{[
    ["/command", "COMMAND", Sparkles], ["/governance", "AI CONTROL PLANE", ShieldCheck], ["/governance/security", "SECURITY / PRIVACY", LockKeyhole], ["/release", "RELEASE CENTER", BadgeCheck], ["/externals", "EXTERNAL ADAPTERS", KeyRound], ["/events", "EVENTS / LEDGER", FileCheck2],
  ].map(([href, label, Icon]) => <button className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${href === "/release" ? "border border-lime-300/20 bg-lime-300/10 text-lime-200" : "text-slate-500 hover:bg-white/[0.045] hover:text-slate-100"}`} key={href as string} onClick={() => nav(href as string)} type="button"><Icon className="size-4" /><span>{label as string}</span></button>)}</div></nav><div className="border-t border-white/[0.08] pt-4"><div className="flex items-center justify-between px-2 text-[9px] uppercase tracking-[0.14em] text-slate-600"><span>Authority</span><span className="text-lime-200">{data.authority?.role ?? "—"}</span></div><p className="mt-3 px-2 font-mono text-[9px] text-slate-600">tenant scoped · no deploy from UI</p></div></aside><section className="min-w-0 flex-1"><header className="zw-command-topbar sticky top-0 z-20 flex h-[72px] items-center gap-3 border-b border-white/[0.08] bg-[#050607]/88 px-4 backdrop-blur-xl sm:px-7"><button className="grid size-9 place-items-center rounded-xl border border-white/10 bg-black/30 text-slate-500 lg:hidden" onClick={() => nav("/governance")} type="button" aria-label="Torna alla governance"><ArrowLeft className="size-4" /></button><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/70">AI-ZEROW / W17 / RELEASE</p><h1 className="mt-1 text-base font-semibold tracking-[-0.03em] text-slate-50 sm:text-lg">Release & Certification Center</h1></div><div className="ml-auto flex items-center gap-2"><span className="hidden items-center gap-2 rounded-full border border-amber-300/20 bg-amber-300/5 px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-amber-100 sm:flex"><span className="size-1.5 rounded-full bg-amber-300" />COMMERCIAL NO-GO</span><Button aria-label="Aggiorna release readiness" className="h-9 w-9 border-white/10 p-0 sm:w-auto sm:px-3 bg-black/20 text-xs text-slate-300 hover:border-lime-300/30 hover:text-lime-200" onClick={() => void load()} variant="outline"><RefreshCw className="size-3.5" /><span className="hidden sm:inline">Aggiorna</span></Button></div></header><div className="mx-auto max-w-[1680px] px-4 py-5 sm:px-7 sm:py-7"><div className="mb-5 flex flex-wrap items-end justify-between gap-4"><div><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/70"><span className="size-1.5 rounded-full bg-lime-300" />PROMOTION CONTROL / READINESS</div><h2 className="mt-2 text-2xl font-semibold tracking-[-0.05em] text-slate-50 sm:text-[32px]">Una decisione unica, prove leggibili</h2><p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">Il centro unifica i gate tecnici locali e rende visibili i blocchi esterni. `READY` tecnico non significa certificato commerciale: la promozione resta esplicitamente separata.</p></div><span className="rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-[10px] text-slate-500"><Activity className="mr-2 inline size-3.5 text-lime-300" />Ultimo readback {lastCheck}</span></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric icon={BadgeCheck} label="Gate locali pronti" value={loading ? "—" : `${summary?.ready ?? 0}/${summary?.total ?? gates.length}`} detail="Registro W17 aggregato" status={summary?.open === 0 ? "READY" : "PARTIAL"} /><Metric icon={CircleAlert} label="Blocchi aperti" value={loading ? "—" : String(summary?.open ?? openGates.length)} detail="Provider, review o certification" status={summary?.open ? "NOT_RUN" : "READY"} /><Metric icon={KeyRound} label="Gate provider" value={loading ? "—" : String(summary?.notRun ?? 0)} detail="Richiedono evidenza runtime" status={summary?.notRun ? "NOT_RUN" : "READY"} /><Metric icon={TimerReset} label="Human review" value={loading ? "—" : String(summary?.review ?? 0)} detail="DPIA e sign-off esplicito" status={summary?.review ? "PENDING_REVIEW" : "READY"} /></div><div className="mt-4 grid gap-4 2xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]"><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-lime-300/70">W17 / GATE REGISTER</p><h2 className="mt-1 text-[15px] font-semibold">Release evidence register</h2><p className="mt-1 text-[11px] text-slate-500">Filtra per workstream e apri la sezione che possiede la prossima evidenza.</p></div><div className="flex flex-wrap justify-end gap-1.5">{filters.map((item) => <button className={`rounded-full border px-2.5 py-1.5 text-[10px] font-semibold transition ${filter === item ? "border-lime-300/35 bg-lime-300/10 text-lime-100" : "border-white/10 bg-black/20 text-slate-500 hover:text-slate-200"}`} key={item} onClick={() => setFilter(item)} type="button">{item}</button>)}</div></div><div className="mt-4 space-y-2">{filteredGates.map((gate) => <article className="rounded-xl border border-white/[0.08] bg-black/20 p-3" key={gate.id}><div className="flex items-start gap-3"><span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border border-white/10 bg-black/25"><StatusIcon status={gate.status} /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-xs font-semibold text-slate-200">{gate.label}</h3><p className="mt-1 text-[9px] uppercase tracking-[0.14em] text-slate-600">{gate.workstream} · {gate.id}</p></div><StatusBadge status={gate.status} /></div><p className="mt-2 text-[11px] leading-5 text-slate-500">{gate.detail}</p><div className="mt-2 grid gap-2 text-[10px] sm:grid-cols-2"><p className="rounded-lg border border-white/[0.06] bg-black/20 px-2.5 py-2 text-slate-600"><span className="text-slate-500">Evidenza · </span>{gate.evidence}</p><p className="rounded-lg border border-amber-300/10 bg-amber-300/[0.03] px-2.5 py-2 text-amber-100/70"><span className="text-amber-100/50">Next · </span>{gate.nextAction}</p></div>{gate.href ? <button className="mt-2 inline-flex items-center gap-1 text-[10px] font-semibold text-lime-200 transition hover:text-lime-100" onClick={() => nav(gate.href as string)} type="button">Apri controllo <ArrowUpRight className="size-3" /></button> : null}</div></div></article>)}{loading ? <p className="py-8 text-center text-xs text-slate-600">Readback W17 in corso…</p> : null}{!loading && filteredGates.length === 0 ? <p className="py-8 text-center text-xs text-slate-600">Nessun gate nel filtro.</p> : null}</div></section><aside className="space-y-4"><section className="carbon-card-neon rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-lime-300/70">PROMOTION BOUNDARY</p><h2 className="mt-1 text-sm font-semibold">Commercial release</h2></div><StatusBadge status={summary?.commercialStatus === "GO" ? "READY" : "NOT_RUN"} /></div><div className="mt-4 space-y-3 text-xs"><div className="flex items-center justify-between border-b border-white/[0.08] pb-3"><span className="text-slate-500">Decision</span><span className="text-amber-200">{summary?.commercialStatus ?? "NO_GO"}</span></div><div className="flex items-center justify-between border-b border-white/[0.08] pb-3"><span className="text-slate-500">Promotion</span><span className="text-rose-200">{summary?.promotionAllowed ? "ALLOWED" : "BLOCKED"}</span></div><div className="flex items-center justify-between border-b border-white/[0.08] pb-3"><span className="text-slate-500">Candidate deploy</span><span className="text-amber-200">{data.build?.runtimePublication ?? "NOT_RUN"}</span></div><div className="flex items-center justify-between"><span className="text-slate-500">Direct write</span><span className="text-lime-200">BLOCKED</span></div></div><div className="mt-4 rounded-xl border border-rose-300/15 bg-rose-300/[0.04] p-3"><p className="text-[11px] leading-5 text-rose-100/80">Nessun controllo UI può promuovere il candidato. Il deploy resta un’azione separata e autorizzata.</p></div></section><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-lime-300/70">BUILD IDENTITY</p><h2 className="mt-1 text-sm font-semibold">Candidato locale</h2></div><ShieldCheck className="size-4 text-lime-200" /></div><div className="mt-4 space-y-3 text-xs"><div className="carbon-inset rounded-xl p-3"><p className="text-[10px] text-slate-600">Build</p><p className="mt-1 break-all font-mono text-[10px] text-lime-100">{data.build?.label ?? "—"}</p></div><div className="grid grid-cols-2 gap-2"><div className="carbon-inset rounded-xl p-3"><p className="text-[10px] text-slate-600">Previous published runtime</p><p className="mt-1 text-sm text-slate-100">v{data.build?.previousPublishedSitesVersion ?? "—"}</p></div><div className="carbon-inset rounded-xl p-3"><p className="text-[10px] text-slate-600">Runtime status</p><p className="mt-1 text-sm text-lime-100">{data.build?.lastPublishedRuntimeStatus ?? "—"}</p></div></div></div><p className="mt-4 text-[10px] leading-4 text-slate-600">Il candidato RC2.9 è pubblicato tecnicamente; la certificazione commerciale resta bloccata dai gate aperti.</p></section></aside></div><section className="carbon-card mt-4 rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-lime-300/70">OPEN BLOCKERS</p><h2 className="mt-1 text-sm font-semibold">Cosa manca per la certificazione</h2></div><span className="font-mono text-[10px] text-amber-200">{openGates.length} OPEN</span></div><div className="mt-4 grid gap-3 md:grid-cols-3">{openGates.slice(0, 6).map((gate) => <button className="group rounded-xl border border-white/[0.08] bg-black/20 p-3 text-left transition hover:border-lime-300/25 hover:bg-lime-300/[0.04]" key={gate.id} onClick={() => gate.href && nav(gate.href)} type="button"><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold text-slate-200">{gate.label}</span><ArrowUpRight className="size-3.5 text-slate-600 transition group-hover:text-lime-200" /></div><p className="mt-2 text-[11px] leading-5 text-slate-500">{gate.nextAction}</p><div className="mt-3"><StatusBadge status={gate.status} /></div></button>)}</div></section><footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] py-5 text-[10px] text-slate-600"><span>AI-ZEROW COMMAND · W17 / RELEASE CERTIFICATION CENTER</span><span className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-lime-300" />no secrets exported · promotion gated · tenant scoped</span></footer></div></section></div>{toast ? <button className="fixed bottom-5 right-5 z-50 max-w-[360px] rounded-xl border border-lime-300/25 bg-[#0a100c]/95 px-4 py-3 text-left text-xs text-amber-100 shadow-[0_0_28px_rgba(190,255,60,0.14)] backdrop-blur-xl" onClick={() => setToast("")} type="button">{toast}</button> : null}</main>;
}
