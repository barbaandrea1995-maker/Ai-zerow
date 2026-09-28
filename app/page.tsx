"use client";

import { useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  Archive,
  ArrowUpRight,
  Bot,
  BriefcaseBusiness,
  Building2,
  Check,
  ChevronRight,
  CircleHelp,
  Database,
  FileText,
  Fingerprint,
  Gauge,
  GitBranch,
  HardHat,
  LayoutDashboard,
  Menu,
  MessageSquareText,
  MoreHorizontal,
  Package,
  Radio,
  RefreshCw,
  Route,
  ScanLine,
  Send,
  Server,
  Settings2,
  ShieldCheck,
  Smartphone,
  Truck,
  Users,
  X,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type EvidenceStatus =
  | "VERIFIED"
  | "PARTIALLY_VERIFIED"
  | "ADAPTER_REQUIRED"
  | "REBUILDABLE_STATIC"
  | "REBUILDABLE_WITH_ADAPTERS"
  | "UNKNOWN"
  | "NOT_RUN"
  | "BLOCKED"
  | "READY_WITH_BLOCKERS";

type Module = {
  id: string;
  label: string;
  route: string;
  icon: LucideIcon;
  status: EvidenceStatus;
  summary: string;
  adapter: string;
  evidence: string;
};

type Gate = {
  id: string;
  title: string;
  status: EvidenceStatus;
  detail: string;
};

const modules: Module[] = [
  {
    id: "command",
    label: "Command / AI",
    route: "/command",
    icon: Bot,
    status: "ADAPTER_REQUIRED",
    summary: "Company AI, query, timeline e comandi governati.",
    adapter: "OpenAI runtime · tool gateway · approval · AI ledger",
    evidence: "Route e guardrail presenti staticamente; runtime NOT_RUN.",
  },
  {
    id: "operations",
    label: "Operations",
    route: "/operations",
    icon: BriefcaseBusiness,
    status: "ADAPTER_REQUIRED",
    summary: "Commesse, pianificazione, attività e rapportini.",
    adapter: "Domain services e API /api/operations",
    evidence: "Superficie statica presente; readback NOT_RUN.",
  },
  {
    id: "workforce",
    label: "Workforce",
    route: "/workforce",
    icon: Users,
    status: "ADAPTER_REQUIRED",
    summary: "Presenze, turni, profili, qualifiche e tracking.",
    adapter: "Workforce · attendance · location adapters",
    evidence: "Route catalogata; autorizzazioni runtime PARTIALLY_VERIFIED.",
  },
  {
    id: "warehouse",
    label: "Warehouse",
    route: "/warehouse",
    icon: Package,
    status: "ADAPTER_REQUIRED",
    summary: "Magazzino, richieste materiali, QR e riconciliazione.",
    adapter: "Warehouse API · storage · scanner adapter",
    evidence: "Contratto statico presente; lifecycle DDT/fatture UNKNOWN.",
  },
  {
    id: "mission",
    label: "Mission",
    route: "/mission",
    icon: Truck,
    status: "ADAPTER_REQUIRED",
    summary: "Carichi, assegnazioni, evidenze e replan.",
    adapter: "Mission · transport-load · fulfillment adapters",
    evidence: "Route presente; stato operativo runtime NOT_RUN.",
  },
  {
    id: "documents",
    label: "Documents",
    route: "/documents",
    icon: FileText,
    status: "ADAPTER_REQUIRED",
    summary: "Catalogo documenti, analisi, link e proposte.",
    adapter: "Object storage · provenance · import case",
    evidence: "UI ricostruibile; upload e persistenza richiedono adapter.",
  },
  {
    id: "finance",
    label: "Finance",
    route: "/finance",
    icon: Database,
    status: "ADAPTER_REQUIRED",
    summary: "Movimenti, approvazioni e simulazioni previsionali.",
    adapter: "Neon persistence · approvals · forecast",
    evidence: "Schema e route presenti; migrazioni runtime NOT_VERIFIED.",
  },
  {
    id: "pwa",
    label: "PWA diagnostics",
    route: "/pwa/diagnostics",
    icon: Smartphone,
    status: "REBUILDABLE_WITH_ADAPTERS",
    summary: "Manifest, offline queue, SW e diagnostica build.",
    adapter: "Service worker · IndexedDB · camera/GPS browser APIs",
    evidence: "Source PWA presente; certificazione device NOT_CERTIFIED.",
  },
];

const gates: Gate[] = [
  { id: "S01", title: "Baseline + evidence ledger", status: "READY_WITH_BLOCKERS", detail: "SHA, branch e blocker register fissati." },
  { id: "S02", title: "Auth, tenant e ruoli", status: "ADAPTER_REQUIRED", detail: "Sessione e TenantContext server-owned." },
  { id: "S03", title: "Route + shared shell", status: "REBUILDABLE_STATIC", detail: "Shell desktop e PWA ricostruibile." },
  { id: "S04", title: "Operations surfaces", status: "ADAPTER_REQUIRED", detail: "Readback canonico ancora da collegare." },
  { id: "S05", title: "Documents + finance", status: "ADAPTER_REQUIRED", detail: "Storage, approval e audit adapter." },
  { id: "S06", title: "Events + reconciliation", status: "ADAPTER_REQUIRED", detail: "Outbox, retry, DLQ e revisioni." },
  { id: "S07", title: "Command / Company AI", status: "ADAPTER_REQUIRED", detail: "Nessuna scrittura diretta; approval gate." },
  { id: "S08", title: "PWA contract", status: "REBUILDABLE_WITH_ADAPTERS", detail: "Manifest, offline e replay strict FIFO." },
  { id: "S09", title: "Desktop + PWA regression", status: "NOT_RUN", detail: "Golden journeys non eseguite." },
  { id: "S10", title: "Neon binding", status: "ADAPTER_REQUIRED", detail: "Provenienza migrazioni non provata." },
  { id: "S11", title: "Runtime binding", status: "ADAPTER_REQUIRED", detail: "Environment e deployment da collegare." },
  { id: "S12", title: "Native mobile", status: "UNKNOWN", detail: "Adapter iOS/Android differito." },
  { id: "S13", title: "B0–B10 / W20", status: "NOT_RUN", detail: "Matrice certificazione non eseguita." },
  { id: "S14", title: "Production promotion", status: "BLOCKED", detail: "Bloccata finché W20 non è VERIFIED." },
];

const navItems: Array<{ label: string; icon: LucideIcon; module?: string }> = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "Command", icon: MessageSquareText, module: "command" },
  { label: "Operations", icon: BriefcaseBusiness, module: "operations" },
  { label: "Workforce", icon: Users, module: "workforce" },
  { label: "Warehouse", icon: Package, module: "warehouse" },
  { label: "Mission", icon: Truck, module: "mission" },
  { label: "Documents", icon: FileText, module: "documents" },
  { label: "Finance", icon: Database, module: "finance" },
];

const statusMeta: Record<
  EvidenceStatus,
  { label: string; dot: string; text: string; surface: string }
> = {
  VERIFIED: { label: "VERIFIED", dot: "bg-lime-300", text: "text-lime-200", surface: "border-lime-300/30 bg-lime-300/10" },
  PARTIALLY_VERIFIED: { label: "PARTIALLY VERIFIED", dot: "bg-cyan-300", text: "text-cyan-200", surface: "border-cyan-300/30 bg-cyan-300/10" },
  ADAPTER_REQUIRED: { label: "ADAPTER REQUIRED", dot: "bg-amber-300", text: "text-amber-200", surface: "border-amber-300/30 bg-amber-300/10" },
  REBUILDABLE_STATIC: { label: "REBUILDABLE STATIC", dot: "bg-sky-300", text: "text-sky-200", surface: "border-sky-300/30 bg-sky-300/10" },
  REBUILDABLE_WITH_ADAPTERS: { label: "REBUILDABLE + ADAPTERS", dot: "bg-violet-300", text: "text-violet-200", surface: "border-violet-300/30 bg-violet-300/10" },
  UNKNOWN: { label: "UNKNOWN", dot: "bg-violet-300", text: "text-violet-200", surface: "border-violet-300/30 bg-violet-300/10" },
  NOT_RUN: { label: "NOT RUN", dot: "bg-slate-400", text: "text-slate-300", surface: "border-slate-400/25 bg-slate-400/10" },
  BLOCKED: { label: "BLOCKED", dot: "bg-rose-300", text: "text-rose-200", surface: "border-rose-300/30 bg-rose-300/10" },
  READY_WITH_BLOCKERS: { label: "READY + BLOCKERS", dot: "bg-orange-300", text: "text-orange-200", surface: "border-orange-300/30 bg-orange-300/10" },
};

function StatusPill({ status }: { status: EvidenceStatus }) {
  const meta = statusMeta[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-semibold tracking-[0.08em] ${meta.surface} ${meta.text}`}>
      <span className={`size-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

function IconButton({ label, children, onClick }: { label: string; children: React.ReactNode; onClick?: () => void }) {
  return (
    <button
      aria-label={label}
      className="grid size-9 place-items-center rounded-lg border border-white/10 text-slate-400 transition hover:border-lime-300/40 hover:bg-white/5 hover:text-lime-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300"
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

export default function Home() {
  const [activeModule, setActiveModule] = useState("overview");
  const [filter, setFilter] = useState<"ALL" | "ADAPTER_REQUIRED" | "BLOCKED" | "NOT_RUN">("ALL");
  const [command, setCommand] = useState("");
  const [commandState, setCommandState] = useState("Ready for a governed query");
  const [showGates, setShowGates] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);

  const selected = modules.find((item) => item.id === activeModule);
  const filteredModules = useMemo(
    () => modules.filter((item) => filter === "ALL" || item.status === filter),
    [filter],
  );

  const submitCommand = () => {
    const next = command.trim();
    if (!next) return;
    setCommandState("UNKNOWN · gateway adapter not connected");
    setCommand("");
  };

  const selectNav = (module = "overview") => {
    setActiveModule(module);
    setMobileMenu(false);
  };

  return (
    <main className="min-h-screen bg-[#111518] text-slate-100 selection:bg-lime-300 selection:text-[#101416]">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_74%_3%,rgba(216,255,82,0.10),transparent_28%),radial-gradient(circle_at_18%_82%,rgba(145,165,175,0.08),transparent_24%)]" />

      <div className="relative flex min-h-screen">
        <aside className={`fixed inset-y-0 left-0 z-40 flex w-[244px] flex-col border-r border-lime-300/10 bg-[#171c20]/95 px-4 py-5 backdrop-blur-xl transition-transform lg:static lg:translate-x-0 ${mobileMenu ? "translate-x-0" : "-translate-x-full"}`}>
          <div className="flex items-center justify-between px-2">
            <button className="flex items-center gap-3 text-left" onClick={() => selectNav()} type="button">
              <span className="grid size-9 place-items-center rounded-xl border border-lime-300/35 bg-lime-300/10 font-mono text-sm font-bold text-lime-200 shadow-[0_0_24px_rgba(189,255,73,0.1)]">Z</span>
              <span>
                <span className="block text-sm font-semibold tracking-[0.18em] text-white">ZEROW</span>
                <span className="block text-[10px] uppercase tracking-[0.14em] text-slate-500">command console</span>
              </span>
            </button>
            <button className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-white/5 hover:text-white lg:hidden" onClick={() => setMobileMenu(false)} type="button" aria-label="Chiudi menu">
              <X className="size-4" />
            </button>
          </div>

          <div className="mt-8 rounded-xl border border-white/8 bg-white/[0.025] p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="grid size-7 place-items-center rounded-lg bg-lime-300/10 text-lime-200"><Building2 className="size-3.5" /></span>
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-slate-200">ZEROW workspace</p>
                  <p className="truncate text-[10px] text-slate-500">owner · tenant context</p>
                </div>
              </div>
              <ChevronRight className="size-3.5 text-slate-600" />
            </div>
          </div>

          <nav className="mt-7 flex-1" aria-label="Navigazione principale">
            <p className="px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-600">Workspace</p>
            <div className="mt-2 space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = item.module ? activeModule === item.module : activeModule === "overview";
                return (
                  <button
                    className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${isActive ? "bg-lime-300/10 text-lime-200" : "text-slate-400 hover:bg-white/[0.045] hover:text-slate-100"}`}
                    key={item.label}
                    onClick={() => selectNav(item.module)}
                    type="button"
                  >
                    <Icon className={`size-4 ${isActive ? "text-lime-200" : "text-slate-500 group-hover:text-slate-300"}`} />
                    <span>{item.label}</span>
                    {item.label === "Command" && <span className="ml-auto size-1.5 rounded-full bg-lime-300 shadow-[0_0_10px_rgba(189,255,73,0.7)]" />}
                  </button>
                );
              })}
            </div>

            <p className="mt-8 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-600">System</p>
            <div className="mt-2 space-y-1">
              <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-slate-400 transition hover:bg-white/[0.045] hover:text-slate-100" onClick={() => setShowGates(true)} type="button"><Gauge className="size-4 text-slate-500" /> <span>Gateboard</span><span className="ml-auto font-mono text-[10px] text-orange-200">14</span></button>
              <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-slate-400 transition hover:bg-white/[0.045] hover:text-slate-100" onClick={() => selectNav("pwa")} type="button"><Smartphone className="size-4 text-slate-500" /> <span>PWA diagnostics</span></button>
              <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-slate-400 transition hover:bg-white/[0.045] hover:text-slate-100" onClick={() => setShowGates(true)} type="button"><ShieldCheck className="size-4 text-slate-500" /> <span>Evidence</span></button>
            </div>
          </nav>

          <div className="mt-6 border-t border-white/8 pt-4">
            <div className="flex items-center justify-between px-2 text-[10px] uppercase tracking-[0.12em] text-slate-600">
              <span>Build identity</span>
              <span className="flex items-center gap-1.5 text-lime-200"><span className="size-1.5 rounded-full bg-lime-300" /> pinned</span>
            </div>
            <p className="mt-2 px-2 font-mono text-[10px] text-slate-500">a07c72bc · feat/pwa-ui-ux-refactor</p>
          </div>
        </aside>

        {mobileMenu && <button className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={() => setMobileMenu(false)} aria-label="Chiudi menu" type="button" />}

        <section className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 flex h-[70px] items-center gap-4 border-b border-lime-300/10 bg-[#111518]/88 px-4 backdrop-blur-xl sm:px-7">
            <IconButton label="Apri menu" onClick={() => setMobileMenu(true)}><Menu className="size-4 lg:hidden" /><span className="hidden text-xs lg:block">≡</span></IconButton>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-xs text-slate-500"><span>AI-ZEROW-COMMAND</span><ChevronRight className="size-3" /><span className="text-slate-300">{activeModule === "overview" ? "Overview" : selected?.label}</span></div>
              <p className="mt-0.5 truncate text-[11px] text-slate-600">forensic reconstruction workspace · read-only evidence mode</p>
            </div>
            <div className="hidden items-center gap-2 md:flex">
              <span className="flex items-center gap-2 rounded-full border border-lime-300/20 bg-lime-300/5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-lime-200"><span className="size-1.5 rounded-full bg-lime-300" /> private</span>
              <IconButton label="Impostazioni"><Settings2 className="size-4" /></IconButton>
              <IconButton label="Altre azioni"><MoreHorizontal className="size-4" /></IconButton>
            </div>
          </header>

          <div className="mx-auto max-w-[1500px] px-4 py-6 sm:px-7 sm:py-8">
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_350px]">
              <div className="min-w-0">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-lime-200"><Zap className="size-3.5" /> operational evidence console</div>
                    <h1 className="mt-3 max-w-2xl text-3xl font-semibold tracking-[-0.04em] text-white sm:text-4xl">Ricostruzione ZEROW,<br /><span className="text-slate-500">senza supposizioni.</span></h1>
                    <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-400">Baseline bloccata sul branch analizzato. La console separa ciò che è verificato staticamente da ciò che richiede un adapter o una prova runtime.</p>
                  </div>
                  <div className="rounded-2xl border border-orange-300/25 bg-orange-300/[0.06] p-4 sm:min-w-[205px]">
                    <div className="flex items-center justify-between gap-5"><span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-orange-200">Research status</span><AlertTriangle className="size-4 text-orange-200" /></div>
                    <p className="mt-3 text-xl font-semibold tracking-tight text-white">READY_WITH_BLOCKERS</p>
                    <p className="mt-1 text-xs text-slate-500">12 blocker · 4 conflict</p>
                  </div>
                </div>

                <div className="mt-7 rounded-2xl border border-white/8 bg-white/[0.025] p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3"><span className="grid size-8 place-items-center rounded-lg border border-lime-300/20 bg-lime-300/10 text-lime-200"><Fingerprint className="size-4" /></span><div><p className="text-sm font-medium text-white">Exact baseline pinned</p><p className="font-mono text-[10px] text-slate-500">barbaandrea1995-ui/zerow-platform · a07c72bc</p></div></div>
                    <StatusPill status="VERIFIED" />
                  </div>
                  <div className="mt-5 grid gap-3 sm:grid-cols-4">
                    <Metric label="Branch" value="feat/pwa-ui-ux-refactor" icon={GitBranch} />
                    <Metric label="Page routes" value="22" icon={Route} />
                    <Metric label="API routes" value="84" icon={Server} />
                    <Metric label="Controls" value="418" icon={ScanLine} />
                  </div>
                </div>

                <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <EvidenceCard label="Static evidence" value="393" note="deterministic matches" status="VERIFIED" icon={Check} />
                  <EvidenceCard label="Requires adapter" value="8" note="domain surfaces" status="ADAPTER_REQUIRED" icon={RefreshCw} />
                  <EvidenceCard label="Runtime unknown" value="25" note="unresolved slots" status="UNKNOWN" icon={CircleHelp} />
                  <EvidenceCard label="Certification" value="B0–B10" note="NOT_RUN · W20 NOT_VERIFIED" status="BLOCKED" icon={AlertTriangle} />
                </div>

                <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
                  <div><p className="text-lg font-semibold tracking-tight text-white">Core surfaces</p><p className="mt-1 text-xs text-slate-500">Route-aware modules mapped to the reconstruction boundary.</p></div>
                  <div className="flex flex-wrap gap-1.5">
                    {(["ALL", "ADAPTER_REQUIRED", "BLOCKED", "NOT_RUN"] as const).map((item) => <button className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] transition ${filter === item ? "border-lime-300/40 bg-lime-300/10 text-lime-200" : "border-white/8 text-slate-500 hover:border-white/20 hover:text-slate-300"}`} key={item} onClick={() => setFilter(item)} type="button">{item === "ALL" ? "All" : statusMeta[item].label}</button>)}
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {filteredModules.map((item) => {
                    const Icon = item.icon;
                    const active = activeModule === item.id;
                    return <button className={`group rounded-2xl border p-4 text-left transition ${active ? "border-lime-300/35 bg-lime-300/[0.06]" : "border-white/8 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]"}`} key={item.id} onClick={() => setActiveModule(item.id)} type="button">
                      <div className="flex items-start justify-between gap-3"><span className={`grid size-9 place-items-center rounded-xl border ${active ? "border-lime-300/30 bg-lime-300/10 text-lime-200" : "border-white/10 bg-white/[0.04] text-slate-400"}`}><Icon className="size-4" /></span><StatusPill status={item.status} /></div>
                      <div className="mt-4 flex items-center justify-between gap-3"><h2 className="font-medium text-white">{item.label}</h2><ArrowUpRight className="size-4 text-slate-600 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-lime-200" /></div>
                      <p className="mt-2 min-h-10 text-xs leading-5 text-slate-400">{item.summary}</p>
                      <div className="mt-4 flex items-center justify-between border-t border-white/8 pt-3"><span className="font-mono text-[10px] text-slate-600">{item.route}</span><span className="text-[10px] text-slate-500">open surface</span></div>
                    </button>;
                  })}
                </div>
              </div>

              <aside className="space-y-4">
                <section className="rounded-2xl border border-lime-300/25 bg-[#1a2416] p-4 shadow-[0_18px_70px_rgba(216,255,82,0.06)] sm:p-5">
                  <div className="flex items-center justify-between"><div className="flex items-center gap-2"><span className="grid size-8 place-items-center rounded-lg bg-lime-300 text-[#080a0c]"><MessageSquareText className="size-4" /></span><div><p className="text-sm font-semibold text-white">Command</p><p className="text-[10px] uppercase tracking-[0.12em] text-lime-200/70">governed preview</p></div></div><span className="size-2 rounded-full bg-lime-300 shadow-[0_0_12px_rgba(189,255,73,0.9)]" /> </div>
                  <p className="mt-4 text-xs leading-5 text-slate-400">La superficie è pronta. Il gateway AI e la scrittura governata restano adapter: nessuna azione viene inviata da questa preview.</p>
                  <div className="mt-4 flex gap-2"><Input aria-label="Inserisci una domanda per Command" className="h-10 border-white/10 bg-black/20 text-sm text-white placeholder:text-slate-600" onChange={(event) => setCommand(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") submitCommand(); }} placeholder="Chiedi a Command…" value={command} /><Button aria-label="Invia domanda" className="h-10 bg-lime-300 px-3 text-[#080a0c] hover:bg-lime-200" onClick={submitCommand} size="icon"><Send className="size-4" /></Button></div>
                  <div className="mt-3 flex items-center gap-2 text-[10px] text-slate-500"><span className="size-1.5 rounded-full bg-amber-300" />{commandState}</div>
                </section>

                <section className="rounded-2xl border border-white/8 bg-white/[0.025] p-4 sm:p-5">
                  <div className="flex items-center justify-between"><div><p className="text-sm font-semibold text-white">Focused surface</p><p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-slate-600">local reconstruction view</p></div><IconButton label="Deselect module" onClick={() => setActiveModule("overview")}><X className="size-3.5" /></IconButton></div>
                  {selected ? <div className="mt-5"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl border border-lime-300/25 bg-lime-300/10 text-lime-200"><selected.icon className="size-5" /></span><div><h2 className="font-medium text-white">{selected.label}</h2><p className="font-mono text-[10px] text-slate-600">{selected.route}</p></div></div><div className="mt-5 space-y-3"><DetailRow label="Status" value={<StatusPill status={selected.status} />} /><DetailRow label="Adapter" value={<span className="text-right text-xs text-slate-300">{selected.adapter}</span>} /><DetailRow label="Evidence" value={<span className="text-right text-xs leading-5 text-slate-400">{selected.evidence}</span>} /></div></div> : <div className="mt-5 rounded-xl border border-dashed border-white/10 p-4"><p className="text-sm text-slate-300">Seleziona una superficie per vedere il relativo confine di ricostruzione.</p><p className="mt-2 text-xs leading-5 text-slate-600">La console usa solo fatti presenti nel pacchetto di ricerca.</p></div>}
                </section>

                <section className="rounded-2xl border border-white/8 bg-white/[0.025] p-4 sm:p-5">
                  <div className="flex items-center justify-between"><div><p className="text-sm font-semibold text-white">Integrity signals</p><p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-slate-600">evidence ledger</p></div><Activity className="size-4 text-lime-200" /></div>
                  <div className="mt-4 space-y-3"><Signal label="Tenant fields server-owned" status="VERIFIED" icon={ShieldCheck} /><Signal label="Append-only audit surfaces" status="VERIFIED" icon={Archive} /><Signal label="Readback on governed completion" status="VERIFIED" icon={Radio} /><Signal label="Runtime control behavior" status="NOT_RUN" icon={CircleHelp} /></div>
                  <Button className="mt-5 w-full border-white/10 bg-transparent text-xs text-slate-300 hover:bg-white/5 hover:text-white" onClick={() => setShowGates(true)} variant="outline">Apri gateboard <ArrowUpRight className="size-3.5" /></Button>
                </section>

                <section className="rounded-2xl border border-white/8 bg-white/[0.02] p-4"><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500"><HardHat className="size-3.5" /> Next safe step</div><p className="mt-3 text-sm leading-5 text-slate-300">Collegare auth, TenantContext e readback senza sostituire il core di dominio.</p><p className="mt-3 font-mono text-[10px] text-slate-600">S02 → S03 · ADAPTER_REQUIRED</p></section>
              </aside>
            </div>

            <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-white/8 py-5 text-[10px] text-slate-600"><span>AI-ZEROW-COMMAND · Sites reconstruction workspace</span><span className="flex items-center gap-2"><span>source evidence</span><span className="size-1 rounded-full bg-lime-300" /><span>no secrets exported</span></span></footer>
          </div>
        </section>
      </div>

      {showGates && <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="gateboard-title"><div className="max-h-[min(740px,90vh)] w-full max-w-2xl overflow-hidden rounded-2xl border border-lime-300/15 bg-[#171c20] shadow-2xl"><div className="flex items-center justify-between border-b border-lime-300/10 px-5 py-4"><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-lime-200">S01–S14</p><h2 className="mt-1 text-lg font-semibold text-white" id="gateboard-title">Reconstruction gateboard</h2></div><IconButton label="Chiudi gateboard" onClick={() => setShowGates(false)}><X className="size-4" /></IconButton></div><div className="scrollbar-thin max-h-[calc(90vh-92px)] overflow-y-auto p-3 sm:p-5"><div className="space-y-2">{gates.map((gate) => <button className="flex w-full items-center gap-3 rounded-xl border border-white/8 bg-white/[0.02] p-3 text-left transition hover:border-lime-300/25 hover:bg-white/[0.04]" key={gate.id} onClick={() => { setShowGates(false); setActiveModule(gate.id === "S08" ? "pwa" : gate.id === "S07" ? "command" : "overview"); }} type="button"><span className="w-8 font-mono text-[11px] text-slate-600">{gate.id}</span><span className="grid size-8 place-items-center rounded-lg bg-white/[0.04] text-slate-400">{gate.status === "BLOCKED" ? <AlertTriangle className="size-3.5 text-rose-200" /> : gate.status === "NOT_RUN" ? <CircleHelp className="size-3.5 text-slate-300" /> : <Check className="size-3.5 text-lime-200" />}</span><span className="min-w-0 flex-1"><span className="block text-sm text-slate-200">{gate.title}</span><span className="mt-1 block truncate text-xs text-slate-600">{gate.detail}</span></span><StatusPill status={gate.status} /></button>)}</div></div></div></div>}
    </main>
  );
}

function Metric({ label, value, icon: Icon }: { label: string; value: string; icon: LucideIcon }) {
  return <div className="rounded-xl border border-white/8 bg-black/10 p-3"><div className="flex items-center justify-between text-[10px] uppercase tracking-[0.12em] text-slate-600"><span>{label}</span><Icon className="size-3.5 text-slate-500" /></div><p className="mt-2 truncate font-mono text-sm text-slate-200">{value}</p></div>;
}

function EvidenceCard({ label, value, note, status, icon: Icon }: { label: string; value: string; note: string; status: EvidenceStatus; icon: LucideIcon }) {
  return <div className="rounded-2xl border border-white/8 bg-white/[0.025] p-4"><div className="flex items-center justify-between"><span className="text-xs text-slate-400">{label}</span><Icon className={`size-4 ${statusMeta[status].text}`} /></div><p className="mt-3 font-mono text-2xl font-semibold tracking-tight text-white">{value}</p><div className="mt-2 flex items-center justify-between gap-2"><span className="truncate text-[10px] text-slate-600">{note}</span><span className={`size-1.5 shrink-0 rounded-full ${statusMeta[status].dot}`} /></div></div>;
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex items-start justify-between gap-4 border-b border-white/8 pb-3 last:border-0 last:pb-0"><span className="text-[10px] uppercase tracking-[0.12em] text-slate-600">{label}</span><span className="max-w-[67%]">{value}</span></div>;
}

function Signal({ label, status, icon: Icon }: { label: string; status: EvidenceStatus; icon: LucideIcon }) {
  return <div className="flex items-center gap-3"><span className={`grid size-7 place-items-center rounded-lg border ${statusMeta[status].surface}`}><Icon className={`size-3.5 ${statusMeta[status].text}`} /></span><span className="flex-1 text-xs text-slate-300">{label}</span><span className={`font-mono text-[9px] ${statusMeta[status].text}`}>{status === "VERIFIED" ? "OK" : statusMeta[status].label}</span></div>;
}
