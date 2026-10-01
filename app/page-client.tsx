"use client";

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  Activity,
  ArrowUpRight,
  Bell,
  BriefcaseBusiness,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleGauge,
  CircleHelp,
  Crosshair,
  FileText,
  Gauge,
  HardHat,
  LocateFixed,
  Map as MapIcon,
  Menu,
  MessageSquareText,
  Navigation,
  Network,
  Package,
  PanelRight,
  Plus,
  Search,
  Send,
  Settings,
  ShoppingCart,
  ShieldCheck,
  Sparkles,
  Truck,
  Users,
  X,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";
import { AccountMenu, type AccountActor } from "@/components/account-menu";
import { CommandHero } from "@/components/command-hero";
import { CommandMobileNav } from "@/components/command-mobile-nav";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { readback } from "@/lib/client-readback";

type MapFilter = "TUTTI" | "ASSET" | "TEAM" | "LAVORI" | "GEOFENCE";
type JobTab = "ATTIVI" | "PIANIFICATI" | "COMPLETATI";
type AssetTab = "OPERATIVI" | "MANUTENZIONE" | "TUTTI";
type Tone = "lime" | "amber" | "cyan" | "red";

type ActivityItem = {
  title: string;
  detail: string;
  time: string;
  icon: LucideIcon;
  tone: Tone;
};

type Job = {
  id: string;
  title: string;
  location: string;
  status: "In corso" | "Pianificato" | "Completato";
  team: string;
  progress: number;
  icon: LucideIcon;
};

type Asset = {
  id: string;
  title: string;
  detail: string;
  status: "Operativo" | "In manutenzione";
  team: string;
  icon: LucideIcon;
};

type MapMarker = {
  id: string;
  label: string;
  detail: string;
  kind: Exclude<MapFilter, "TUTTI" | "GEOFENCE">;
  x: string;
  y: string;
  icon: LucideIcon;
  tone: Tone;
};

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
};

type KpiData = {
  label: string;
  value: string;
  delta: string;
  icon: LucideIcon;
  tone: Tone;
  data: string;
};

const navItems: Array<{ label: string; icon: LucideIcon; id: string; path?: string; badge?: string }> = [
  { label: "CONTROL", icon: MessageSquareText, id: "command", badge: "AI" },
  { label: "OPERATIONS", icon: BriefcaseBusiness, id: "operations" },
  { label: "WORKFORCE", icon: Users, id: "workforce" },
  { label: "FINANCE", icon: Gauge, id: "finance" },
  { label: "PROCUREMENT", icon: ShoppingCart, id: "procurement" },
  { label: "ASSETS", icon: Package, id: "assets" },
  { label: "WAREHOUSE", icon: Package, id: "warehouse" },
  { label: "MISSION", icon: Truck, id: "mission" },
  { label: "DOCUMENTS", icon: FileText, id: "documents" },
  { label: "GOVERNANCE", icon: ShieldCheck, id: "governance" },
  { label: "EXTERNAL ADAPTERS", icon: Network, id: "externals" },
  { label: "AUTHORITY", icon: ShieldCheck, id: "authority" },
  { label: "EVENTS", icon: Activity, id: "events" },
  { label: "PWA / DIAGNOSTICS", icon: CircleGauge, id: "pwa" },
  { label: "SETTINGS", icon: Settings, id: "settings" },
];

const commandModules = ["operations", "assets", "workforce"] as const;
const defaultAssistantResponse = "Nessun dato operativo nel readback D1. Collega un adapter o crea un record.";

function readbackTone(value: string): Tone {
  return value === "cyan" || value === "amber" || value === "red" ? value : "lime";
}

function readbackLabel(status: "loading" | "online" | "partial" | "empty" | "error") {
  if (status === "loading") return "Lettura in corso";
  if (status === "online") return "D1 verificato";
  if (status === "partial") return "D1 parziale";
  if (status === "empty") return "D1 vuoto";
  return "D1 non disponibile";
}

function recordName(record: CommandRecord) {
  return typeof record.payload?.title === "string" && record.payload.title.trim()
    ? record.payload.title.trim()
    : record.title;
}

function recordStatus(record: CommandRecord): Job["status"] {
  const status = record.status.toUpperCase();
  if (status.includes("COMPLET")) return "Completato";
  if (status.includes("CORSO") || status.includes("ACTIVE")) return "In corso";
  return "Pianificato";
}

function toJobs(records: CommandRecord[]): Job[] {
  return records.filter((record) => record.module === "operations").map((record) => {
    const [location, team] = record.detail.split(" · ");
    return {
      id: record.canonicalCode ?? record.id,
      title: recordName(record),
      location: location || record.detail || "Ubicazione non dichiarata",
      status: recordStatus(record),
      team: team || "Team non assegnato",
      progress: Math.max(0, Math.min(100, Number(record.progress) || 0)),
      icon: BriefcaseBusiness,
    };
  });
}

function toAssets(records: CommandRecord[]): Asset[] {
  return records.filter((record) => record.module === "assets").map((record) => ({
    id: record.canonicalCode ?? record.id,
    title: recordName(record),
    detail: record.detail || "Dettaglio non dichiarato",
    status: record.status.toUpperCase().includes("MANUTEN") ? "In manutenzione" : "Operativo",
    team: typeof record.payload?.team === "string" ? record.payload.team : "Team non assegnato",
    icon: Package,
  }));
}

function toActivities(records: CommandRecord[]): ActivityItem[] {
  return records.slice(0, 8).map((record) => ({
    title: recordName(record),
    detail: `${record.module} · ${record.status || "readback"}`,
    time: record.updatedAt
      ? new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit" }).format(new Date(record.updatedAt))
      : "readback",
    icon: record.module === "operations" ? BriefcaseBusiness : record.module === "assets" ? Package : Users,
    tone: readbackTone(record.tone),
  }));
}

const toneStyles: Record<Tone, { icon: string; badge: string; glow: string; line: string }> = {
  lime: { icon: "text-lime-300", badge: "border-lime-300/25 bg-lime-300/10 text-lime-200", glow: "shadow-[0_0_18px_rgba(190,255,60,0.22)]", line: "rgba(203,255,73,0.76)" },
  cyan: { icon: "text-cyan-300", badge: "border-cyan-300/25 bg-cyan-300/10 text-cyan-200", glow: "shadow-[0_0_18px_rgba(62,222,255,0.18)]", line: "rgba(62,222,255,0.72)" },
  amber: { icon: "text-amber-300", badge: "border-amber-300/25 bg-amber-300/10 text-amber-200", glow: "shadow-[0_0_18px_rgba(255,188,66,0.18)]", line: "rgba(255,188,66,0.72)" },
  red: { icon: "text-rose-300", badge: "border-rose-300/25 bg-rose-300/10 text-rose-200", glow: "shadow-[0_0_18px_rgba(255,84,111,0.18)]", line: "rgba(255,84,111,0.72)" },
};

function IconButton({ label, children, onClick, className = "" }: { label: string; children: ReactNode; onClick?: () => void; className?: string }) {
  return <button aria-label={label} className={`grid size-9 place-items-center rounded-lg border border-white/10 bg-black/20 text-slate-500 transition hover:border-lime-300/35 hover:bg-lime-300/10 hover:text-lime-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300 ${className}`} onClick={onClick} type="button">{children}</button>;
}

function SectionTitle({ eyebrow, title, action, onAction }: { eyebrow?: string; title: string; action?: string; onAction?: () => void }) {
  return <div className="flex items-start justify-between gap-3"><div>{eyebrow && <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/65">{eyebrow}</p>}<h2 className="text-[15px] font-semibold tracking-[-0.01em] text-slate-100">{title}</h2></div>{action && <button className="text-[11px] font-medium text-lime-300 transition hover:text-lime-100" onClick={onAction} type="button">{action}</button>}</div>;
}

function StatusBadge({ children, tone = "lime" }: { children: ReactNode; tone?: Tone }) {
  const styles = toneStyles[tone];
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-semibold tracking-[0.04em] ${styles.badge}`}><span className={`size-1.5 rounded-full bg-current ${styles.glow}`} />{children}</span>;
}

function KpiCard({ label, value, delta, icon: Icon, tone, data }: KpiData) {
  return <article className={`carbon-card carbon-card-neon min-w-0 rounded-2xl p-4 ${tone === "cyan" ? "carbon-card-cyan" : ""}`}><div className="flex items-start justify-between gap-3"><span className={`grid size-9 place-items-center rounded-xl border border-current/20 bg-current/10 ${toneStyles[tone].icon}`}><Icon className="size-[18px]" /></span><StatusBadge tone={tone}>{delta}</StatusBadge></div><p className="mt-4 text-xs text-slate-500">{label}</p><div className="mt-1 flex items-end justify-between gap-4"><p className="font-mono text-[30px] font-semibold leading-none tracking-[-0.06em] text-slate-50">{value}</p><span className="pb-1 text-[10px] uppercase tracking-[0.12em] text-lime-300/60">readback</span></div><p className="mt-2 text-[10px] text-slate-600">{data}</p></article>;
}

function MapBoard({ mapFilter, onFilterChange, selectedMarker, onSelectMarker, markers }: { mapFilter: MapFilter; onFilterChange: (value: MapFilter) => void; selectedMarker: string; onSelectMarker: (id: string) => void; markers: MapMarker[] }) {
  const visibleMarkers = markers.filter((marker) => mapFilter === "TUTTI" || mapFilter === "GEOFENCE" || marker.kind === mapFilter);
  return <section className="carbon-card rounded-2xl p-3 sm:p-4"><div className="flex flex-wrap items-center justify-between gap-3 px-1 pb-3"><div className="flex items-center gap-3"><span className="grid size-8 place-items-center rounded-lg border border-lime-300/25 bg-lime-300/10 text-lime-200"><MapIcon className="size-4" /></span><div><SectionTitle eyebrow="OPERATIONS / LIVE" title="Mappa operativa" /><p className="mt-0.5 text-[11px] text-slate-500">Asset, team e lavori in tempo reale</p></div></div><div className="flex items-center gap-2"><span className="hidden items-center gap-1.5 rounded-full border border-lime-300/15 bg-lime-300/5 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-lime-200 sm:flex"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_10px_rgba(190,255,60,0.9)]" />D1 readback</span><IconButton label="Schermo intero"><PanelRight className="size-4" /></IconButton></div></div><div className="relative min-h-[360px] overflow-hidden rounded-xl border border-white/10 bg-[#050607] sm:min-h-[430px]"><div className="map-grid absolute inset-0 opacity-80" /><div className="absolute inset-0 bg-[radial-gradient(circle_at_52%_48%,rgba(190,255,60,0.12),transparent_25%),radial-gradient(circle_at_16%_80%,rgba(65,224,255,0.07),transparent_22%)]" /><svg className="absolute inset-0 h-full w-full" viewBox="0 0 900 500" preserveAspectRatio="none" aria-label="Mappa operativa schematica"><path d="M0 84C110 132 128 24 226 76S384 152 480 91 643 44 900 103" fill="none" stroke="rgba(104,123,128,0.25)" strokeWidth="2" /><path d="M0 216C95 190 116 288 250 232S410 186 506 262 708 348 900 270" fill="none" stroke="rgba(113,135,138,0.22)" strokeWidth="2" /><path d="M-20 384C112 323 151 428 292 356S472 330 585 398 748 437 930 347" fill="none" stroke="rgba(113,135,138,0.2)" strokeWidth="2" /><path d="M112 -10C158 86 121 152 196 224S255 350 212 530M333 -10C305 104 358 168 321 274S328 401 380 530M588 -10C554 98 622 184 565 280S580 423 631 530M776 -10C713 111 784 196 735 296S771 431 731 530" fill="none" stroke="rgba(99,116,120,0.16)" strokeWidth="1.5" /><path d="M90 402L195 294L322 343L390 189L524 247L620 130L766 177L849 82" fill="none" stroke="rgba(190,255,60,0.72)" strokeDasharray="5 8" strokeLinecap="round" strokeWidth="2" /><path d="M90 402L195 294L322 343L390 189L524 247L620 130L766 177L849 82" fill="none" opacity="0.24" stroke="rgba(190,255,60,0.85)" strokeLinecap="round" strokeWidth="10" /><circle cx="390" cy="189" r="4" fill="#d6ff4c" /><circle cx="620" cy="130" r="4" fill="#d6ff4c" /><circle cx="195" cy="294" r="4" fill="#d6ff4c" /></svg><div className="absolute left-3 top-3 flex items-center gap-2 rounded-lg border border-white/10 bg-black/70 px-2.5 py-2 backdrop-blur"><Navigation className="size-3.5 text-lime-300" /><span className="text-[10px] font-medium text-slate-300">AREA OPERATIVA · D1 readback</span></div><div className="absolute right-3 top-3 flex flex-col gap-1 rounded-lg border border-white/10 bg-black/75 p-1 backdrop-blur"><IconButton label="Zoom in" className="size-8 rounded-md border-0 bg-transparent hover:bg-white/10"><ZoomIn className="size-3.5" /></IconButton><IconButton label="Zoom out" className="size-8 rounded-md border-0 bg-transparent hover:bg-white/10"><ZoomOut className="size-3.5" /></IconButton><div className="mx-1 h-px bg-white/10" /><IconButton label="Centra mappa" className="size-8 rounded-md border-0 bg-transparent hover:bg-white/10"><LocateFixed className="size-3.5" /></IconButton></div>{visibleMarkers.map((marker) => { const Icon = marker.icon; const selected = selectedMarker === marker.id; return <button key={marker.id} className="absolute -translate-x-1/2 -translate-y-1/2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300" style={{ left: marker.x, top: marker.y }} onClick={() => onSelectMarker(marker.id)} type="button"><span className={`absolute -inset-2 rounded-full border border-lime-300/35 ${selected ? "animate-pulse bg-lime-300/15" : "opacity-0"}`} /><span className={`relative flex items-center gap-2 rounded-lg border px-2 py-1.5 backdrop-blur-md transition ${selected ? "border-lime-300/55 bg-[#101604]/95 shadow-[0_0_24px_rgba(190,255,60,0.18)]" : "border-white/15 bg-black/75 hover:border-lime-300/40"}`}><span className={`grid size-6 place-items-center rounded-md border border-current/20 bg-current/10 ${toneStyles[marker.tone].icon}`}><Icon className="size-3.5" /></span><span><span className="block text-[11px] font-semibold text-slate-100">{marker.label}</span><span className={`block text-[10px] ${marker.tone === "amber" ? "text-amber-200" : "text-lime-200"}`}>{marker.detail}</span></span></span></button>; })}{visibleMarkers.length === 0 && <div className="absolute inset-x-0 top-1/2 mx-auto max-w-xs -translate-y-1/2 rounded-xl border border-dashed border-white/15 bg-black/55 px-4 py-3 text-center text-xs leading-5 text-slate-500">Nessun segnale con coordinate nel readback D1.</div>}<div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2"><Tabs value={mapFilter} onValueChange={(value) => onFilterChange(value as MapFilter)}><TabsList className="h-9 rounded-lg border border-white/10 bg-black/80 p-1 backdrop-blur" aria-label="Filtri mappa"><TabsTrigger className="h-7 rounded-md px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]" value="TUTTI">Tutti</TabsTrigger><TabsTrigger className="h-7 rounded-md px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]" value="ASSET">Asset</TabsTrigger><TabsTrigger className="h-7 rounded-md px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]" value="TEAM">Team</TabsTrigger><TabsTrigger className="h-7 rounded-md px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]" value="LAVORI">Lavori</TabsTrigger><TabsTrigger className="hidden h-7 rounded-md px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006] sm:inline-flex" value="GEOFENCE">Geofence</TabsTrigger></TabsList></Tabs><span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-black/75 px-2.5 py-1.5 text-[9px] uppercase tracking-[0.1em] text-slate-500"><Crosshair className="size-3 text-lime-300" />{visibleMarkers.length} segnali</span></div></div></section>;
}

function ActivityPanel({ query, showAll, onToggle, activities }: { query: string; showAll: boolean; onToggle: () => void; activities: ActivityItem[] }) {
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = activities.filter((item) => `${item.title} ${item.detail}`.toLowerCase().includes(normalizedQuery));
  const visible = showAll ? filtered : filtered.slice(0, 5);
  return <section className="carbon-card rounded-2xl p-4 sm:p-5"><SectionTitle eyebrow="EVENT STREAM" title="Attività recenti" action={showAll ? "Riduci" : "Vedi tutte"} onAction={onToggle} /><div className="mt-4 divide-y divide-white/[0.07]">{visible.map((item) => { const Icon = item.icon; return <div className="flex items-center gap-3 py-3 first:pt-0 last:pb-0" key={`${item.title}-${item.time}`}><span className={`grid size-8 shrink-0 place-items-center rounded-xl border ${toneStyles[item.tone].badge}`}><Icon className="size-4" /></span><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-slate-200">{item.title}</p><p className="mt-1 truncate text-[11px] text-slate-500">{item.detail}</p></div><span className="shrink-0 text-[10px] text-slate-600">{item.time}</span></div>; })}{visible.length === 0 && <div className="rounded-lg border border-dashed border-white/10 px-3 py-5 text-center text-xs text-slate-500">Nessuna attività corrisponde alla ricerca.</div>}</div></section>;
}

function JobPanel({ tab, onTabChange, onNewJob, jobs }: { tab: JobTab; onTabChange: (value: JobTab) => void; onNewJob: () => void; jobs: Job[] }) {
  const visibleJobs = jobs.filter((job) => tab === "ATTIVI" ? job.status === "In corso" : tab === "PIANIFICATI" ? job.status === "Pianificato" : job.status === "Completato");
  return <section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><SectionTitle eyebrow="WORK ORDERS" title="Lavori" action="Vedi tutti" /><Button className="h-8 border border-lime-300/25 bg-lime-300/10 px-2.5 text-[11px] text-lime-200 hover:bg-lime-300/20" onClick={onNewJob}><Plus className="size-3.5" />Nuovo</Button></div><Tabs className="mt-4" value={tab} onValueChange={(value) => onTabChange(value as JobTab)}><TabsList className="h-8 w-full justify-start rounded-lg border border-white/10 bg-black/25 p-1"><TabsTrigger className="h-6 flex-none px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]" value="ATTIVI">Attivi</TabsTrigger><TabsTrigger className="h-6 flex-none px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]" value="PIANIFICATI">Pianificati</TabsTrigger><TabsTrigger className="h-6 flex-none px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]" value="COMPLETATI">Completati</TabsTrigger></TabsList></Tabs><div className="mt-3 divide-y divide-white/[0.07]">{visibleJobs.map((job) => { const Icon = job.icon; const tone = job.status === "Pianificato" ? "cyan" : "lime"; return <div className="flex items-center gap-3 py-3 first:pt-0 last:pb-0" key={job.id}><span className={`grid size-8 shrink-0 place-items-center rounded-lg border ${toneStyles[tone].badge}`}><Icon className="size-3.5" /></span><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="font-mono text-[11px] font-semibold text-slate-200">{job.id}</span><span className="truncate text-[11px] text-slate-300">{job.title}</span></div><p className="mt-1 truncate text-[10px] text-slate-500">{job.location}</p></div><div className="hidden w-[82px] text-right sm:block"><StatusBadge tone={tone}>{job.status}</StatusBadge><div className="mt-2 ml-auto h-1 w-[72px] overflow-hidden rounded-full bg-white/10"><span className="block h-full rounded-full bg-lime-300" style={{ width: `${job.progress}%` }} /></div></div></div>; })}{visibleJobs.length === 0 && <div className="py-6 text-center text-xs text-slate-500">Nessun lavoro in questo stato.</div>}</div></section>;
}

function AssetPanel({ tab, onTabChange, assets }: { tab: AssetTab; onTabChange: (value: AssetTab) => void; assets: Asset[] }) {
  const visibleAssets = assets.filter((asset) => tab === "TUTTI" || tab === "OPERATIVI" ? (tab === "TUTTI" || asset.status === "Operativo") : asset.status === "In manutenzione");
  return <section className="carbon-card rounded-2xl p-4 sm:p-5"><SectionTitle eyebrow="FLEET STATUS" title="Asset" action="Vedi tutti" /><Tabs className="mt-4" value={tab} onValueChange={(value) => onTabChange(value as AssetTab)}><TabsList className="h-8 w-full justify-start rounded-lg border border-white/10 bg-black/25 p-1"><TabsTrigger className="h-6 flex-none px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]" value="OPERATIVI">Operativi</TabsTrigger><TabsTrigger className="h-6 flex-none px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]" value="MANUTENZIONE">Manutenzione</TabsTrigger><TabsTrigger className="h-6 flex-none px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]" value="TUTTI">Tutti</TabsTrigger></TabsList></Tabs><div className="mt-3 divide-y divide-white/[0.07]">{visibleAssets.map((asset) => { const Icon = asset.icon; const operational = asset.status === "Operativo"; return <div className="flex items-center gap-3 py-3 first:pt-0 last:pb-0" key={asset.id}><span className={`grid size-8 shrink-0 place-items-center rounded-lg border ${operational ? toneStyles.lime.badge : toneStyles.amber.badge}`}><Icon className="size-3.5" /></span><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="font-mono text-[11px] font-semibold text-slate-200">{asset.id}</span><span className="truncate text-[11px] text-slate-300">{asset.title}</span></div><p className="mt-1 truncate text-[10px] text-slate-500">{asset.detail}</p></div><div className="hidden text-right sm:block"><div className="flex items-center justify-end gap-1.5 text-[10px] text-slate-300"><span className={`size-1.5 rounded-full ${operational ? "bg-lime-300 shadow-[0_0_8px_rgba(190,255,60,0.8)]" : "bg-amber-300"}`} />{asset.status}</div><p className="mt-1 text-[10px] text-slate-600">{asset.team}</p></div></div>; })}{visibleAssets.length === 0 && <div className="py-6 text-center text-xs text-slate-500">Nessun asset in questo stato.</div>}</div></section>;
}

function AnalyticsPanel() {
  const [period, setPeriod] = useState("ULTIMI 30 GIORNI");
  return <section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><SectionTitle eyebrow="PERFORMANCE" title="Analytics" /><button className="flex items-center gap-1 rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-[10px] text-slate-400 hover:border-lime-300/30 hover:text-lime-200" onClick={() => setPeriod(period === "ULTIMI 30 GIORNI" ? "ULTIMI 7 GIORNI" : "ULTIMI 30 GIORNI")} type="button">{period}<ChevronDown className="size-3" /></button></div><div className="carbon-inset mt-4 grid min-h-[142px] place-items-center rounded-xl border border-dashed border-white/10 text-center"><div><p className="text-xs text-slate-400">Nessun dato analytics</p><p className="mt-1 text-[10px] text-slate-600">Il readback D1 non contiene ancora eventi operativi.</p></div></div><div className="mt-4 grid grid-cols-3 gap-2">{["Produttività", "Tempi inattivi", "Efficienza"].map((label) => <div className="carbon-inset rounded-lg p-2.5" key={label}><p className="font-mono text-lg font-semibold text-slate-600">—</p><p className="mt-1 text-[10px] text-slate-500">{label}</p></div>)}</div><div className="mt-4 flex items-start gap-2 rounded-lg border border-white/10 bg-black/10 p-3"><Sparkles className="mt-0.5 size-3.5 shrink-0 text-slate-600" /><div><p className="text-[11px] font-medium text-slate-300">AI Insights</p><p className="mt-1 text-[10px] leading-4 text-slate-600">Disponibili dopo il primo readback operativo.</p></div></div></section>;
}

function AssistantPanel({ query, onQueryChange, onSubmit, response, onQuickPrompt, onOpenLedger }: { query: string; onQueryChange: (value: string) => void; onSubmit: () => void; response: string; onQuickPrompt: (prompt: string) => void; onOpenLedger: () => void }) {
  const quickPrompts = ["Crea un nuovo lavoro", "Quali asset sono disponibili?", "Mostra team più vicino", "Analizza le performance di oggi"];
  return <section className="carbon-card carbon-card-neon rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div className="flex items-center gap-3"><span className="neon-pulse grid size-9 place-items-center rounded-xl bg-lime-300 text-[#060806]"><Sparkles className="size-[18px]" /></span><div><p className="text-[15px] font-semibold text-slate-50">AI Assistant</p><p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-lime-200/60">command / governed preview</p></div></div><StatusBadge tone="amber">ADAPTER REQUIRED</StatusBadge></div><div className="carbon-inset mt-5 rounded-xl p-3"><div className="flex items-center gap-2 text-[10px] text-lime-200"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_10px_rgba(190,255,60,0.9)]" />SYSTEM READY<span className="ml-auto font-mono text-[9px] text-slate-600">READ ONLY</span></div><p className="mt-3 text-sm leading-6 text-slate-300">{response}</p></div><form className="mt-4 flex gap-2" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); onSubmit(); }}><div className="relative min-w-0 flex-1"><MessageSquareText className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-600" /><Input aria-label="Chiedi a AI-ZEROW" className="h-10 border-white/10 bg-black/40 pl-9 text-xs text-slate-100 placeholder:text-slate-600" onChange={(event) => onQueryChange(event.target.value)} placeholder="Chiedi a AI-ZEROW…" value={query} /></div><Button aria-label="Invia richiesta" className="h-10 w-10 bg-lime-300 p-0 text-[#060806] shadow-[0_0_18px_rgba(190,255,60,0.18)] hover:bg-lime-200" size="icon" type="submit"><Send className="size-4" /></Button></form><div className="mt-4 space-y-2">{quickPrompts.map((prompt) => <button className="flex w-full items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-left text-[11px] text-slate-400 transition hover:border-lime-300/30 hover:bg-lime-300/5 hover:text-lime-200" key={prompt} onClick={() => onQuickPrompt(prompt)} type="button"><span className="grid size-5 place-items-center rounded-md border border-white/10 text-slate-600"><ChevronRight className="size-3" /></span>{prompt}</button>)}</div><div className="mt-5 flex items-center justify-between border-t border-white/10 pt-4"><button className="flex items-center gap-2 text-[10px] text-slate-500 hover:text-lime-200" onClick={onOpenLedger} type="button"><FileText className="size-3.5" />Apri command ledger</button><span className="font-mono text-[9px] text-slate-600">S07 / LOCAL</span></div></section>;
}

function LedgerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="carbon-card max-h-[90vh] max-w-2xl overflow-y-auto border-lime-300/20 p-0 text-slate-100"><DialogHeader className="border-b border-white/10 px-5 py-5 text-left"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl border border-lime-300/25 bg-lime-300/10 text-lime-200"><ShieldCheck className="size-4" /></span><div><DialogTitle className="text-base text-slate-50">Command ledger</DialogTitle><DialogDescription className="mt-1 text-xs text-slate-500">Registro locale della preview. Nessuna scrittura è stata inviata al dominio.</DialogDescription></div></div></DialogHeader><div className="space-y-3 p-5"><div className="carbon-inset flex items-center justify-between rounded-xl p-3"><div><p className="text-xs font-medium text-slate-200">Gateway AI</p><p className="mt-1 text-[10px] text-slate-500">OpenAI runtime · tool gateway · approval</p></div><StatusBadge tone="amber">ADAPTER REQUIRED</StatusBadge></div><div className="carbon-inset flex items-center justify-between rounded-xl p-3"><div><p className="text-xs font-medium text-slate-200">Tenant context</p><p className="mt-1 text-[10px] text-slate-500">Actor, membership e scope server-owned</p></div><StatusBadge>VERIFIED</StatusBadge></div><div className="carbon-inset flex items-center justify-between rounded-xl p-3"><div><p className="text-xs font-medium text-slate-200">Readback governato</p><p className="mt-1 text-[10px] text-slate-500">La preview non simula conferme di dominio</p></div><StatusBadge tone="amber">NOT RUN</StatusBadge></div></div><DialogFooter className="border-t border-white/10 px-5 py-4"><DialogClose asChild><Button className="border-white/10 bg-transparent text-slate-300 hover:bg-white/10 hover:text-white" variant="outline">Chiudi</Button></DialogClose></DialogFooter></DialogContent></Dialog>;
}

function NewJobDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (title: string) => void }) {
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!title.trim()) return; onCreated(`${title.trim()}${location.trim() ? ` · ${location.trim()}` : ""}`); setTitle(""); setLocation(""); };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="carbon-card max-w-lg border-lime-300/20 p-0 text-slate-100"><form onSubmit={submit}><DialogHeader className="border-b border-white/10 px-5 py-5 text-left"><DialogTitle className="text-base text-slate-50">Nuovo lavoro</DialogTitle><DialogDescription className="mt-1 text-xs text-slate-500">Crea una bozza locale. L’invio operativo richiede l’adapter del dominio.</DialogDescription></DialogHeader><div className="space-y-4 p-5"><label className="block"><span className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Titolo</span><Input autoFocus className="border-white/10 bg-black/30 text-sm text-slate-100 placeholder:text-slate-600" onChange={(event) => setTitle(event.target.value)} placeholder="Es. Manutenzione impianto" value={title} /></label><label className="block"><span className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Località</span><Input className="border-white/10 bg-black/30 text-sm text-slate-100 placeholder:text-slate-600" onChange={(event) => setLocation(event.target.value)} placeholder="Es. Via Roma, Milano" value={location} /></label><div className="flex items-center gap-2 rounded-lg border border-amber-300/15 bg-amber-300/5 p-3 text-[10px] leading-4 text-amber-100/75"><CircleHelp className="size-3.5 shrink-0 text-amber-300" />Preview locale: il record non viene scritto su Neon e non genera eventi.</div></div><DialogFooter className="border-t border-white/10 px-5 py-4"><DialogClose asChild><Button className="border-white/10 bg-transparent text-slate-300 hover:bg-white/10 hover:text-white" variant="outline">Annulla</Button></DialogClose><Button className="bg-lime-300 text-[#060806] hover:bg-lime-200" type="submit"><Plus className="size-4" />Crea bozza</Button></DialogFooter></form></DialogContent></Dialog>;
}

export default function CommandSurface({ actor }: { actor: AccountActor }) {
  const router = useRouter();
  const [mobileMenu, setMobileMenu] = useState(false);
  const [search, setSearch] = useState("");
  const [mapFilter, setMapFilter] = useState<MapFilter>("TUTTI");
  const [selectedMarker, setSelectedMarker] = useState("");
  const [jobTab, setJobTab] = useState<JobTab>("ATTIVI");
  const [assetTab, setAssetTab] = useState<AssetTab>("OPERATIVI");
  const [showAllActivity, setShowAllActivity] = useState(false);
  const [assistantQuery, setAssistantQuery] = useState("");
  const [assistantResponse, setAssistantResponse] = useState(defaultAssistantResponse);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [newJobOpen, setNewJobOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [readbackStatus, setReadbackStatus] = useState<"loading" | "online" | "partial" | "empty" | "error">("loading");
  const [records, setRecords] = useState<CommandRecord[]>([]);

  useEffect(() => {
    let active = true;

    readback<CommandDashboardResponse>("command:dashboard", "/api/command/dashboard").then((payload) => {
      if (!active) return;
      const nextRecords = Array.isArray(payload.records) ? payload.records : [];
      const requestedModules = payload.requestedModules?.length ?? commandModules.length;
      const readableModules = payload.modules?.length ?? 0;
      setRecords(nextRecords);
      if (readableModules === 0) setReadbackStatus("error");
      else if (nextRecords.length === 0) setReadbackStatus("empty");
      else if (readableModules === requestedModules) setReadbackStatus("online");
      else setReadbackStatus("partial");
    }).catch(() => {
      if (!active) return;
      setRecords([]);
      setReadbackStatus("error");
    });

    return () => {
      active = false;
    };
  }, []);

  const jobs = useMemo(() => toJobs(records), [records]);
  const assets = useMemo(() => toAssets(records), [records]);
  const activities = useMemo(() => toActivities(records), [records]);
  const markers = useMemo<MapMarker[]>(() => [], []);
  const commandKpis = useMemo<KpiData[]>(() => {
    const activeJobs = jobs.filter((job) => job.status === "In corso").length;
    const operationalAssets = assets.filter((asset) => asset.status === "Operativo").length;
    const averageProgress = jobs.length
      ? Math.round(jobs.reduce((total, job) => total + job.progress, 0) / jobs.length)
      : null;
    const stateLabel = readbackLabel(readbackStatus);
    return [
      { label: "Lavori attivi", value: readbackStatus === "loading" ? "—" : String(activeJobs), delta: stateLabel, icon: BriefcaseBusiness, tone: "lime", data: `${records.filter((record) => record.module === "operations").length} record operations` },
      { label: "Asset operativi", value: readbackStatus === "loading" ? "—" : String(operationalAssets), delta: stateLabel, icon: Package, tone: "cyan", data: `${records.filter((record) => record.module === "assets").length} record assets` },
      { label: "Team in readback", value: readbackStatus === "loading" ? "—" : String(records.filter((record) => record.module === "workforce").length), delta: stateLabel, icon: Users, tone: "amber", data: "Presenze e assegnazioni server-side" },
      { label: "Avanzamento medio", value: readbackStatus === "loading" || averageProgress === null ? "—" : `${averageProgress}%`, delta: stateLabel, icon: Activity, tone: "lime", data: jobs.length ? "Media dei lavori nel readback" : "Nessun lavoro disponibile" },
    ];
  }, [assets, jobs, readbackStatus, records]);

  const submitAssistant = async () => {
    const next = assistantQuery.trim();
    if (!next) return;
    setAssistantQuery("");
    try {
      const response = await fetch("/api/command/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: next, actionType: "query", idempotencyKey: `command-query-${crypto.randomUUID()}` }),
      });
      const data = (await response.json()) as { result?: { message?: string }; error?: string };
      if (!response.ok) throw new Error(data.error || "command_adapter_unavailable");
      setAssistantResponse(data.result?.message || `Preview registrata per “${next}”.`);
      setToast("Richiesta registrata nel ledger S07");
    } catch (error) {
      setAssistantResponse(`Preview locale per “${next}”. ${error instanceof Error ? error.message : "Gateway non disponibile"}.`);
      setToast("Gateway AI esterno ancora differito");
    }
    window.setTimeout(() => setToast(""), 3000);
  };

  const handleQuickPrompt = (prompt: string) => {
    setAssistantQuery(prompt);
    setAssistantResponse(`Pronto a preparare: “${prompt}”. Conferma e adapter richiesti prima di qualsiasi scrittura.`);
  };

  const handleNewJob = (title: string) => {
    setNewJobOpen(false);
    setToast(`Bozza locale creata: ${title}`);
    window.setTimeout(() => setToast(""), 3500);
  };

  const readbackAssistantResponse = useMemo(() => {
    if (readbackStatus === "loading") return defaultAssistantResponse;
    if (readbackStatus === "error") return "Il readback D1 non è disponibile in questo momento. Nessuna metrica o scrittura viene simulata.";
    if (readbackStatus === "empty") return "Il readback D1 è raggiungibile ma non contiene ancora record operativi. Collega un adapter o crea un record dal modulo competente.";
    return "Readback D1 verificato. Posso preparare una preview governata; le scritture restano vincolate ai relativi adapter.";
  }, [readbackStatus]);
  const assistantPanelResponse = assistantResponse === defaultAssistantResponse ? readbackAssistantResponse : assistantResponse;

  return <main className="zw-app-shell min-h-screen overflow-x-hidden bg-[#050607] text-slate-100 selection:bg-lime-300 selection:text-[#060806]"><div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_74%_0%,rgba(190,255,60,0.08),transparent_25%),radial-gradient(circle_at_18%_78%,rgba(70,110,120,0.08),transparent_27%)]" /><div className="relative flex min-h-screen">
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-[232px] flex-col border-r border-lime-300/10 bg-[#050607]/96 px-3 py-4 backdrop-blur-xl transition-transform lg:static lg:translate-x-0 ${mobileMenu ? "translate-x-0" : "-translate-x-full"}`}><div className="flex items-center justify-between px-2"><button className="flex items-center gap-3 text-left" onClick={() => { setMobileMenu(false); router.push("/"); }} type="button"><span className="neon-pulse relative grid size-10 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black"><Image src="/ai-zerow-icon.jpeg" alt="AI-ZEROW" width={40} height={40} className="size-full object-cover" /></span><span><span className="block text-sm font-bold tracking-[0.18em] text-slate-50">AI-ZEROW</span><span className="block text-[10px] uppercase tracking-[0.22em] text-lime-300/75">command</span></span></button><button className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-white/5 hover:text-white lg:hidden" onClick={() => setMobileMenu(false)} type="button" aria-label="Chiudi menu"><X className="size-4" /></button></div><button className="carbon-card mt-8 flex w-full items-center gap-3 rounded-xl p-3 text-left transition hover:border-lime-300/25" type="button" onClick={() => setToast("Workspace ZEROW · owner context")}><span className="grid size-8 place-items-center rounded-lg border border-lime-300/20 bg-lime-300/10 text-lime-200"><HardHat className="size-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-slate-200">ZEROW workspace</span><span className="mt-0.5 block truncate text-[10px] text-slate-600">owner · tenant context</span></span><ChevronRight className="size-3.5 text-slate-600" /></button><nav className="mt-7 flex-1" aria-label="Navigazione principale"><p className="px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-600">Workspace</p><div className="mt-2 space-y-1">{navItems.map((item) => { const Icon = item.icon; const active = item.id === "command"; return <button aria-current={active ? "page" : undefined} className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${active ? "border border-lime-300/20 bg-lime-300/10 text-lime-200 shadow-[inset_0_0_20px_rgba(190,255,60,0.04)]" : "text-slate-500 hover:bg-white/[0.045] hover:text-slate-100"}`} key={item.id} onClick={() => { const destinations: Record<string, string> = { operations: "/operations", workforce: "/workforce", assets: "/assets", warehouse: "/warehouse", mission: "/mission", finance: "/finance", procurement: "/procurement", documents: "/documents", governance: "/governance", externals: "/externals", authority: "/onboarding", events: "/events", pwa: "/pwa/diagnostics", settings: "/settings" }; if (destinations[item.id]) { router.push(destinations[item.id]); return; } if (active) setMobileMenu(false); else setToast(`${item.label}: superficie pronta per il prossimo adapter`); }} type="button"><Icon className={`size-4 ${active ? "text-lime-200" : "text-slate-600 group-hover:text-slate-300"}`} /><span>{item.label}</span>{item.badge && <span className={`ml-auto rounded border px-1.5 py-0.5 font-mono text-[8px] tracking-[0.08em] ${active ? "border-lime-300/25 text-lime-200" : "border-white/10 text-slate-600"}`}>{item.badge}</span>}</button>; })}</div></nav><div className="mt-5 border-t border-white/[0.08] pt-4"><div className="flex items-center justify-between px-2 text-[10px] uppercase tracking-[0.14em] text-slate-600"><span>System status</span><span className="flex items-center gap-1.5 text-lime-200"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_8px_rgba(190,255,60,0.8)]" /><span>{readbackLabel(readbackStatus)}</span></span></div><div className="carbon-inset mt-3 rounded-xl p-3"><div className="flex items-center gap-2 text-[10px] text-slate-400"><Activity className="size-3.5 text-lime-300" />Command core</div><p className="mt-2 font-mono text-[9px] text-slate-600">D1 · {records.length} record{records.length === 1 ? "" : "s"} readback</p><p className="mt-3 font-mono text-[9px] text-slate-600">Sites · D1 readback</p></div></div></aside>
    {mobileMenu && <button className="fixed inset-0 z-30 bg-black/75 lg:hidden" onClick={() => setMobileMenu(false)} aria-label="Chiudi menu" type="button" />}
    <section className="min-w-0 flex-1"><header className="sticky top-0 z-20 flex h-[72px] items-center gap-3 border-b border-white/[0.08] bg-[#050607]/88 px-4 backdrop-blur-xl sm:gap-5 sm:px-7"><IconButton label="Apri menu" onClick={() => setMobileMenu(true)} className="lg:hidden"><Menu className="size-4" /></IconButton><div className="relative hidden min-w-0 flex-1 md:block"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-600" /><Input aria-label="Cerca in COMMAND" className="h-10 max-w-[440px] border-white/10 bg-black/30 pl-10 text-xs text-slate-100 placeholder:text-slate-600 focus-visible:border-lime-300/40" onChange={(event) => setSearch(event.target.value)} placeholder="Cerca commesse, clienti, asset, documenti…" value={search} /></div><div className="flex min-w-0 flex-1 items-center gap-2 md:hidden"><span className="truncate text-xs font-semibold tracking-[0.14em] text-slate-200">COMMAND</span><span className="size-1 rounded-full bg-lime-300" /></div><div className="ml-auto flex items-center gap-2"><span className="hidden items-center gap-2 rounded-full border border-lime-300/20 bg-lime-300/5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-lime-200 sm:flex"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_9px_rgba(190,255,60,0.9)]" />{readbackLabel(readbackStatus)}</span><IconButton label="Notifiche"><Bell className="size-4" /></IconButton><AccountMenu actor={actor} /></div></header><div className="mx-auto max-w-[1680px] px-4 py-5 sm:px-7 sm:py-7"><CommandHero onNewJob={() => setNewJobOpen(true)} recordCount={records.length} statusLabel={readbackLabel(readbackStatus)} /><div className="zw-section-reveal mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{commandKpis.map((kpi) => <KpiCard key={kpi.label} {...kpi} />)}</div><div className="zw-section-reveal mt-4 grid gap-4 2xl:grid-cols-[minmax(0,1.48fr)_minmax(360px,0.62fr)]"><div className="min-w-0" id="operational-map"><MapBoard mapFilter={mapFilter} onFilterChange={setMapFilter} selectedMarker={selectedMarker} onSelectMarker={setSelectedMarker} markers={markers} /></div><div className="min-w-0" id="company-ai"><AssistantPanel query={assistantQuery} onQueryChange={setAssistantQuery} onSubmit={submitAssistant} response={assistantPanelResponse} onQuickPrompt={handleQuickPrompt} onOpenLedger={() => setLedgerOpen(true)} /></div></div><div className="zw-section-reveal mt-4 grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)_minmax(0,1fr)]"><ActivityPanel query={search} showAll={showAllActivity} onToggle={() => setShowAllActivity((value) => !value)} activities={activities} /><JobPanel tab={jobTab} onTabChange={setJobTab} onNewJob={() => setNewJobOpen(true)} jobs={jobs} /><AssetPanel tab={assetTab} onTabChange={setAssetTab} assets={assets} /></div><div className="zw-section-reveal mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.65fr)]"><AnalyticsPanel /><section className="carbon-card flex flex-wrap items-center justify-between gap-4 rounded-2xl p-4 sm:p-5"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl border border-lime-300/25 bg-lime-300/10 text-lime-200"><ShieldCheck className="size-4" /></span><div><p className="text-sm font-semibold text-slate-100">Command surface pronta</p><p className="mt-1 text-[11px] text-slate-500">I controlli mostrano il readback D1; le scritture passano dai relativi adapter.</p></div></div><div className="flex items-center gap-2"><StatusBadge tone={readbackStatus === "error" ? "red" : readbackStatus === "partial" ? "amber" : "lime"}>{readbackLabel(readbackStatus)}</StatusBadge><button className="grid size-8 place-items-center rounded-lg border border-white/10 text-slate-500 hover:border-lime-300/30 hover:text-lime-200" onClick={() => setLedgerOpen(true)} type="button" aria-label="Apri evidenze"><ArrowUpRight className="size-3.5" /></button></div></section></div><footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] py-5 text-[10px] text-slate-600"><span>AI-ZEROW COMMAND · operational workspace</span><span className="flex items-center gap-2"><span>black carbon core</span><span className="size-1 rounded-full bg-lime-300" /><span>no secrets exported</span></span></footer></div></section>
  </div><CommandMobileNav active="home" /><LedgerDialog open={ledgerOpen} onOpenChange={setLedgerOpen} /><NewJobDialog open={newJobOpen} onOpenChange={setNewJobOpen} onCreated={handleNewJob} />{toast && <div className="fixed bottom-5 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2 rounded-xl border border-lime-300/25 bg-[#0b1008]/95 px-4 py-3 text-xs text-lime-100 shadow-[0_0_30px_rgba(190,255,60,0.14)] backdrop-blur-xl"><CheckCircle2 className="size-4 text-lime-300" />{toast}</div>}</main>;
}
