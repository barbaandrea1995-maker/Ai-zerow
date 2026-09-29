"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Bell,
  BriefcaseBusiness,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleGauge,
  CircleHelp,
  ClipboardCheck,
  Clock3,
  Crosshair,
  FileText,
  Gauge,
  HardHat,
  LocateFixed,
  Map as MapIcon,
  Menu,
  MessageSquareText,
  Navigation,
  Package,
  PanelRight,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Truck,
  Users,
  Wrench,
  X,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

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

const navItems: Array<{ label: string; icon: LucideIcon; id: string; badge?: string }> = [
  { label: "CONTROL", icon: MessageSquareText, id: "command", badge: "AI" },
  { label: "OPERATIONS", icon: BriefcaseBusiness, id: "operations" },
  { label: "FIELD", icon: MapIcon, id: "field" },
  { label: "WORKFORCE", icon: Users, id: "workforce" },
  { label: "FINANCE", icon: Gauge, id: "finance" },
  { label: "ASSETS", icon: Package, id: "assets" },
  { label: "WAREHOUSE", icon: Package, id: "warehouse" },
  { label: "MISSION", icon: Truck, id: "mission" },
  { label: "DOCUMENTS", icon: FileText, id: "documents" },
  { label: "EVENTS / AUTHORITY", icon: ShieldCheck, id: "events_authority" },
  { label: "PWA / DIAGNOSTICS", icon: CircleGauge, id: "pwa" },
];

const kpis: Array<{ label: string; value: string; delta: string; icon: LucideIcon; tone: Tone; data: string }> = [
  { label: "Lavori attivi", value: "24", delta: "+12%", icon: BriefcaseBusiness, tone: "lime", data: "12,18,16,24,20,28,25,35,34,46,51,58" },
  { label: "Asset operativi", value: "142", delta: "+5%", icon: Package, tone: "cyan", data: "14,22,20,32,28,26,36,44,40,53,58,62" },
  { label: "Team attivi", value: "8", delta: "+0%", icon: Users, tone: "lime", data: "12,18,22,20,32,28,25,41,40,50,48,54" },
  { label: "Completamento", value: "87%", delta: "+6%", icon: CircleGauge, tone: "lime", data: "18,15,24,22,30,28,32,44,39,54,58,67" },
];

const activities: ActivityItem[] = [
  { title: "Asset A-021 assegnato", detail: "Team Alpha", time: "2 min fa", icon: Package, tone: "lime" },
  { title: "Lavoro #4587 avviato", detail: "Via Roma, Milano", time: "12 min fa", icon: BriefcaseBusiness, tone: "lime" },
  { title: "Controllo completato", detail: "Asset A-109", time: "28 min fa", icon: CheckCircle2, tone: "lime" },
  { title: "Team Beta in posizione", detail: "3 asset operativi", time: "1 ora fa", icon: Users, tone: "cyan" },
  { title: "Segnalazione creata", detail: "Intervento richiesto", time: "2 ore fa", icon: AlertTriangle, tone: "amber" },
  { title: "Rapportino sincronizzato", detail: "Lavoro #4584", time: "3 ore fa", icon: ClipboardCheck, tone: "lime" },
];

const jobs: Job[] = [
  { id: "#4587", title: "Manutenzione impianto", location: "Via Roma, Milano", status: "In corso", team: "Team Alpha", progress: 68, icon: Wrench },
  { id: "#4586", title: "Controllo sicurezza", location: "Corso Italia, Milano", status: "In corso", team: "Team Beta", progress: 45, icon: ShieldCheck },
  { id: "#4585", title: "Installazione", location: "Via Dante, Milano", status: "Pianificato", team: "Team Gamma", progress: 6, icon: Plus },
  { id: "#4584", title: "Ispezione periodica", location: "Zona Industriale", status: "Completato", team: "Team Alpha", progress: 100, icon: Check },
];

const assets: Asset[] = [
  { id: "A-021", title: "Escavatore CAT 320", detail: "Heavy equipment", status: "Operativo", team: "Team Alpha", icon: Truck },
  { id: "A-109", title: "Furgone Fiat Ducato", detail: "Service vehicle", status: "Operativo", team: "Team Beta", icon: Truck },
  { id: "A-332", title: "Piattaforma aerea", detail: "Lifting equipment", status: "In manutenzione", team: "Team Gamma", icon: Wrench },
  { id: "A-447", title: "Generatore 50kW", detail: "Power unit", status: "Operativo", team: "Team Alpha", icon: Package },
];

const markers: MapMarker[] = [
  { id: "team-alpha", label: "Team Alpha", detail: "3 asset", kind: "TEAM", x: "27%", y: "29%", icon: Users, tone: "lime" },
  { id: "job-4587", label: "Lavoro #4587", detail: "In corso", kind: "LAVORI", x: "58%", y: "42%", icon: BriefcaseBusiness, tone: "lime" },
  { id: "asset-a021", label: "Asset #A-021", detail: "Operativo", kind: "ASSET", x: "38%", y: "64%", icon: Package, tone: "lime" },
  { id: "team-beta", label: "Team Beta", detail: "2 asset", kind: "TEAM", x: "18%", y: "76%", icon: Users, tone: "cyan" },
  { id: "team-gamma", label: "Team Gamma", detail: "4 asset", kind: "TEAM", x: "72%", y: "73%", icon: Users, tone: "amber" },
];

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

function Sparkline({ data, tone }: { data: string; tone: Tone }) {
  const points = data.split(",").map(Number);
  const max = Math.max(...points);
  const min = Math.min(...points);
  const coordinates = points.map((point, index) => { const x = (index / (points.length - 1)) * 100; const y = 30 - ((point - min) / Math.max(max - min, 1)) * 23; return `${x},${y}`; }).join(" ");
  return <svg className="h-10 w-full overflow-visible" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true"><polyline fill="none" points={coordinates} stroke={toneStyles[tone].line} strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><polyline fill="none" opacity="0.22" points={`0,32 ${coordinates} 100,32`} stroke={toneStyles[tone].line} strokeWidth="6" /></svg>;
}

function KpiCard({ label, value, delta, icon: Icon, tone, data }: (typeof kpis)[number]) {
  return <article className={`carbon-card carbon-card-neon min-w-0 rounded-2xl p-4 ${tone === "cyan" ? "carbon-card-cyan" : ""}`}><div className="flex items-start justify-between gap-3"><span className={`grid size-9 place-items-center rounded-xl border border-current/20 bg-current/10 ${toneStyles[tone].icon}`}><Icon className="size-[18px]" /></span><StatusBadge tone={tone}>{delta}</StatusBadge></div><p className="mt-4 text-xs text-slate-500">{label}</p><div className="mt-1 flex items-end justify-between gap-4"><p className="font-mono text-[30px] font-semibold leading-none tracking-[-0.06em] text-slate-50">{value}</p><span className="pb-1 text-[10px] uppercase tracking-[0.12em] text-lime-300/60">live</span></div><div className="mt-2"><Sparkline data={data} tone={tone} /></div></article>;
}

function MapBoard({ mapFilter, onFilterChange, selectedMarker, onSelectMarker }: { mapFilter: MapFilter; onFilterChange: (value: MapFilter) => void; selectedMarker: string; onSelectMarker: (id: string) => void }) {
  const visibleMarkers = markers.filter((marker) => mapFilter === "TUTTI" || mapFilter === "GEOFENCE" || marker.kind === mapFilter);
  return <section className="carbon-card rounded-2xl p-3 sm:p-4"><div className="flex flex-wrap items-center justify-between gap-3 px-1 pb-3"><div className="flex items-center gap-3"><span className="grid size-8 place-items-center rounded-lg border border-lime-300/25 bg-lime-300/10 text-lime-200"><MapIcon className="size-4" /></span><div><SectionTitle eyebrow="OPERATIONS / LIVE" title="Mappa operativa" /><p className="mt-0.5 text-[11px] text-slate-500">Asset, team e lavori in tempo reale</p></div></div><div className="flex items-center gap-2"><span className="hidden items-center gap-1.5 rounded-full border border-lime-300/15 bg-lime-300/5 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-lime-200 sm:flex"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_10px_rgba(190,255,60,0.9)]" />preview data</span><IconButton label="Schermo intero"><PanelRight className="size-4" /></IconButton></div></div><div className="relative min-h-[360px] overflow-hidden rounded-xl border border-white/10 bg-[#050607] sm:min-h-[430px]"><div className="map-grid absolute inset-0 opacity-80" /><div className="absolute inset-0 bg-[radial-gradient(circle_at_52%_48%,rgba(190,255,60,0.12),transparent_25%),radial-gradient(circle_at_16%_80%,rgba(65,224,255,0.07),transparent_22%)]" /><svg className="absolute inset-0 h-full w-full" viewBox="0 0 900 500" preserveAspectRatio="none" aria-label="Mappa operativa schematica"><path d="M0 84C110 132 128 24 226 76S384 152 480 91 643 44 900 103" fill="none" stroke="rgba(104,123,128,0.25)" strokeWidth="2" /><path d="M0 216C95 190 116 288 250 232S410 186 506 262 708 348 900 270" fill="none" stroke="rgba(113,135,138,0.22)" strokeWidth="2" /><path d="M-20 384C112 323 151 428 292 356S472 330 585 398 748 437 930 347" fill="none" stroke="rgba(113,135,138,0.2)" strokeWidth="2" /><path d="M112 -10C158 86 121 152 196 224S255 350 212 530M333 -10C305 104 358 168 321 274S328 401 380 530M588 -10C554 98 622 184 565 280S580 423 631 530M776 -10C713 111 784 196 735 296S771 431 731 530" fill="none" stroke="rgba(99,116,120,0.16)" strokeWidth="1.5" /><path d="M90 402L195 294L322 343L390 189L524 247L620 130L766 177L849 82" fill="none" stroke="rgba(190,255,60,0.72)" strokeDasharray="5 8" strokeLinecap="round" strokeWidth="2" /><path d="M90 402L195 294L322 343L390 189L524 247L620 130L766 177L849 82" fill="none" opacity="0.24" stroke="rgba(190,255,60,0.85)" strokeLinecap="round" strokeWidth="10" /><circle cx="390" cy="189" r="4" fill="#d6ff4c" /><circle cx="620" cy="130" r="4" fill="#d6ff4c" /><circle cx="195" cy="294" r="4" fill="#d6ff4c" /></svg><div className="absolute left-3 top-3 flex items-center gap-2 rounded-lg border border-white/10 bg-black/70 px-2.5 py-2 backdrop-blur"><Navigation className="size-3.5 text-lime-300" /><span className="text-[10px] font-medium text-slate-300">MILANO / AREA OPERATIVA</span></div><div className="absolute right-3 top-3 flex flex-col gap-1 rounded-lg border border-white/10 bg-black/75 p-1 backdrop-blur"><IconButton label="Zoom in" className="size-8 rounded-md border-0 bg-transparent hover:bg-white/10"><ZoomIn className="size-3.5" /></IconButton><IconButton label="Zoom out" className="size-8 rounded-md border-0 bg-transparent hover:bg-white/10"><ZoomOut className="size-3.5" /></IconButton><div className="mx-1 h-px bg-white/10" /><IconButton label="Centra mappa" className="size-8 rounded-md border-0 bg-transparent hover:bg-white/10"><LocateFixed className="size-3.5" /></IconButton></div>{visibleMarkers.map((marker) => { const Icon = marker.icon; const selected = selectedMarker === marker.id; return <button key={marker.id} className="absolute -translate-x-1/2 -translate-y-1/2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300" style={{ left: marker.x, top: marker.y }} onClick={() => onSelectMarker(marker.id)} type="button"><span className={`absolute -inset-2 rounded-full border border-lime-300/35 ${selected ? "animate-pulse bg-lime-300/15" : "opacity-0"}`} /><span className={`relative flex items-center gap-2 rounded-lg border px-2 py-1.5 backdrop-blur-md transition ${selected ? "border-lime-300/55 bg-[#101604]/95 shadow-[0_0_24px_rgba(190,255,60,0.18)]" : "border-white/15 bg-black/75 hover:border-lime-300/40"}`}><span className={`grid size-6 place-items-center rounded-md border border-current/20 bg-current/10 ${toneStyles[marker.tone].icon}`}><Icon className="size-3.5" /></span><span><span className="block text-[11px] font-semibold text-slate-100">{marker.label}</span><span className={`block text-[10px] ${marker.tone === "amber" ? "text-amber-200" : "text-lime-200"}`}>{marker.detail}</span></span></span></button>; })}<div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2"><Tabs value={mapFilter} onValueChange={(value) => onFilterChange(value as MapFilter)}><TabsList className="h-9 rounded-lg border border-white/10 bg-black/80 p-1 backdrop-blur" aria-label="Filtri mappa"><TabsTrigger className="h-7 rounded-md px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]" value="TUTTI">Tutti</TabsTrigger><TabsTrigger className="h-7 rounded-md px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]" value="ASSET">Asset</TabsTrigger><TabsTrigger className="h-7 rounded-md px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]" value="TEAM">Team</TabsTrigger><TabsTrigger className="h-7 rounded-md px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]" value="LAVORI">Lavori</TabsTrigger><TabsTrigger className="hidden h-7 rounded-md px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006] sm:inline-flex" value="GEOFENCE">Geofence</TabsTrigger></TabsList></Tabs><span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-black/75 px-2.5 py-1.5 text-[9px] uppercase tracking-[0.1em] text-slate-500"><Crosshair className="size-3 text-lime-300" />{visibleMarkers.length} segnali</span></div></div></section>;
}

function ActivityPanel({ query, showAll, onToggle }: { query: string; showAll: boolean; onToggle: () => void }) {
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = activities.filter((item) => `${item.title} ${item.detail}`.toLowerCase().includes(normalizedQuery));
  const visible = showAll ? filtered : filtered.slice(0, 5);
  return <section className="carbon-card rounded-2xl p-4 sm:p-5"><SectionTitle eyebrow="EVENT STREAM" title="Attività recenti" action={showAll ? "Riduci" : "Vedi tutte"} onAction={onToggle} /><div className="mt-4 divide-y divide-white/[0.07]">{visible.map((item) => { const Icon = item.icon; return <div className="flex items-center gap-3 py-3 first:pt-0 last:pb-0" key={`${item.title}-${item.time}`}><span className={`grid size-8 shrink-0 place-items-center rounded-xl border ${toneStyles[item.tone].badge}`}><Icon className="size-4" /></span><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-slate-200">{item.title}</p><p className="mt-1 truncate text-[11px] text-slate-500">{item.detail}</p></div><span className="shrink-0 text-[10px] text-slate-600">{item.time}</span></div>; })}{visible.length === 0 && <div className="rounded-lg border border-dashed border-white/10 px-3 py-5 text-center text-xs text-slate-500">Nessuna attività corrisponde alla ricerca.</div>}</div></section>;
}

function JobPanel({ tab, onTabChange, onNewJob }: { tab: JobTab; onTabChange: (value: JobTab) => void; onNewJob: () => void }) {
  const visibleJobs = jobs.filter((job) => tab === "ATTIVI" ? job.status === "In corso" : tab === "PIANIFICATI" ? job.status === "Pianificato" : job.status === "Completato");
  return <section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><SectionTitle eyebrow="WORK ORDERS" title="Lavori" action="Vedi tutti" /><Button className="h-8 border border-lime-300/25 bg-lime-300/10 px-2.5 text-[11px] text-lime-200 hover:bg-lime-300/20" onClick={onNewJob}><Plus className="size-3.5" />Nuovo</Button></div><Tabs className="mt-4" value={tab} onValueChange={(value) => onTabChange(value as JobTab)}><TabsList className="h-8 w-full justify-start rounded-lg border border-white/10 bg-black/25 p-1"><TabsTrigger className="h-6 flex-none px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]" value="ATTIVI">Attivi</TabsTrigger><TabsTrigger className="h-6 flex-none px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]" value="PIANIFICATI">Pianificati</TabsTrigger><TabsTrigger className="h-6 flex-none px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]" value="COMPLETATI">Completati</TabsTrigger></TabsList></Tabs><div className="mt-3 divide-y divide-white/[0.07]">{visibleJobs.map((job) => { const Icon = job.icon; const tone = job.status === "Pianificato" ? "cyan" : "lime"; return <div className="flex items-center gap-3 py-3 first:pt-0 last:pb-0" key={job.id}><span className={`grid size-8 shrink-0 place-items-center rounded-lg border ${toneStyles[tone].badge}`}><Icon className="size-3.5" /></span><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="font-mono text-[11px] font-semibold text-slate-200">{job.id}</span><span className="truncate text-[11px] text-slate-300">{job.title}</span></div><p className="mt-1 truncate text-[10px] text-slate-500">{job.location}</p></div><div className="hidden w-[82px] text-right sm:block"><StatusBadge tone={tone}>{job.status}</StatusBadge><div className="mt-2 ml-auto h-1 w-[72px] overflow-hidden rounded-full bg-white/10"><span className="block h-full rounded-full bg-lime-300" style={{ width: `${job.progress}%` }} /></div></div></div>; })}{visibleJobs.length === 0 && <div className="py-6 text-center text-xs text-slate-500">Nessun lavoro in questo stato.</div>}</div></section>;
}

function AssetPanel({ tab, onTabChange }: { tab: AssetTab; onTabChange: (value: AssetTab) => void }) {
  const visibleAssets = assets.filter((asset) => tab === "TUTTI" || tab === "OPERATIVI" ? (tab === "TUTTI" || asset.status === "Operativo") : asset.status === "In manutenzione");
  return <section className="carbon-card rounded-2xl p-4 sm:p-5"><SectionTitle eyebrow="FLEET STATUS" title="Asset" action="Vedi tutti" /><Tabs className="mt-4" value={tab} onValueChange={(value) => onTabChange(value as AssetTab)}><TabsList className="h-8 w-full justify-start rounded-lg border border-white/10 bg-black/25 p-1"><TabsTrigger className="h-6 flex-none px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]" value="OPERATIVI">Operativi</TabsTrigger><TabsTrigger className="h-6 flex-none px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]" value="MANUTENZIONE">Manutenzione</TabsTrigger><TabsTrigger className="h-6 flex-none px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]" value="TUTTI">Tutti</TabsTrigger></TabsList></Tabs><div className="mt-3 divide-y divide-white/[0.07]">{visibleAssets.map((asset) => { const Icon = asset.icon; const operational = asset.status === "Operativo"; return <div className="flex items-center gap-3 py-3 first:pt-0 last:pb-0" key={asset.id}><span className={`grid size-8 shrink-0 place-items-center rounded-lg border ${operational ? toneStyles.lime.badge : toneStyles.amber.badge}`}><Icon className="size-3.5" /></span><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="font-mono text-[11px] font-semibold text-slate-200">{asset.id}</span><span className="truncate text-[11px] text-slate-300">{asset.title}</span></div><p className="mt-1 truncate text-[10px] text-slate-500">{asset.detail}</p></div><div className="hidden text-right sm:block"><div className="flex items-center justify-end gap-1.5 text-[10px] text-slate-300"><span className={`size-1.5 rounded-full ${operational ? "bg-lime-300 shadow-[0_0_8px_rgba(190,255,60,0.8)]" : "bg-amber-300"}`} />{asset.status}</div><p className="mt-1 text-[10px] text-slate-600">{asset.team}</p></div></div>; })}{visibleAssets.length === 0 && <div className="py-6 text-center text-xs text-slate-500">Nessun asset in questo stato.</div>}</div></section>;
}

function AnalyticsPanel() {
  const [period, setPeriod] = useState("ULTIMI 30 GIORNI");
  const bars = [18, 34, 23, 48, 29, 38, 25, 55, 31, 44, 61, 36, 52, 46, 73, 42, 66, 52, 83, 60, 72, 51, 68, 86, 57, 77, 67, 91, 73, 96];
  return <section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><SectionTitle eyebrow="PERFORMANCE" title="Analytics" /><button className="flex items-center gap-1 rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-[10px] text-slate-400 hover:border-lime-300/30 hover:text-lime-200" onClick={() => setPeriod(period === "ULTIMI 30 GIORNI" ? "ULTIMI 7 GIORNI" : "ULTIMI 30 GIORNI")} type="button">{period}<ChevronDown className="size-3" /></button></div><div className="mt-4 flex h-[142px] items-end gap-1 border-b border-white/10 px-1 pb-0">{bars.map((height, index) => <span className="group relative flex-1 rounded-t-sm bg-lime-300/85 transition hover:bg-lime-200" key={`${height}-${index}`} style={{ height: `${height}%` }}><span className="pointer-events-none absolute -top-6 left-1/2 hidden -translate-x-1/2 rounded bg-black px-1.5 py-1 text-[9px] text-lime-200 group-hover:block">{height}</span></span>)}</div><div className="mt-2 flex justify-between text-[9px] text-slate-600"><span>1</span><span>5</span><span>10</span><span>15</span><span>20</span><span>25</span><span>30</span></div><div className="mt-4 grid grid-cols-3 gap-2">{[{ label: "Produttività", value: "+18%", tone: "lime" as Tone }, { label: "Tempi inattivi", value: "-12%", tone: "cyan" as Tone }, { label: "Efficienza", value: "+24%", tone: "lime" as Tone }].map((item) => <div className="carbon-inset rounded-lg p-2.5" key={item.label}><p className={`font-mono text-lg font-semibold ${toneStyles[item.tone].icon}`}>{item.value}</p><p className="mt-1 text-[10px] text-slate-500">{item.label}</p></div>)}</div><div className="mt-4 flex items-start gap-2 rounded-lg border border-lime-300/15 bg-lime-300/5 p-3"><Sparkles className="mt-0.5 size-3.5 shrink-0 text-lime-300" /><div><p className="text-[11px] font-medium text-slate-200">AI Insights</p><p className="mt-1 text-[10px] leading-4 text-slate-500">Previsto aumento carico lavori del 23%. <span className="text-slate-400">Suggerito rinforzo team nella prossima settimana.</span></p></div><ArrowUpRight className="ml-auto mt-0.5 size-3.5 shrink-0 text-lime-300" /></div></section>;
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

export default function Home() {
  const [mobileMenu, setMobileMenu] = useState(false);
  const [search, setSearch] = useState("");
  const [mapFilter, setMapFilter] = useState<MapFilter>("TUTTI");
  const [selectedMarker, setSelectedMarker] = useState("job-4587");
  const [jobTab, setJobTab] = useState<JobTab>("ATTIVI");
  const [assetTab, setAssetTab] = useState<AssetTab>("OPERATIVI");
  const [showAllActivity, setShowAllActivity] = useState(false);
  const [assistantQuery, setAssistantQuery] = useState("");
  const [assistantResponse, setAssistantResponse] = useState("Ciao, Operatore. Posso interrogare la superficie COMMAND quando il gateway sarà collegato.");
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [newJobOpen, setNewJobOpen] = useState(false);
  const [toast, setToast] = useState("");

  const submitAssistant = () => {
    const next = assistantQuery.trim();
    if (!next) return;
    setAssistantResponse(`Richiesta mantenuta in preview: “${next}”. Gateway AI e approval adapter non collegati.`);
    setAssistantQuery("");
    setToast("Richiesta registrata nella preview locale");
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

  const searchHint = useMemo(() => search.trim() ? `Filtro locale: ${search.trim()}` : "Cerca asset, lavori, team, persone…", [search]);

  return <main className="min-h-screen overflow-x-hidden bg-[#050607] text-slate-100 selection:bg-lime-300 selection:text-[#060806]"><div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_74%_0%,rgba(190,255,60,0.08),transparent_25%),radial-gradient(circle_at_18%_78%,rgba(70,110,120,0.08),transparent_27%)]" /><div className="relative flex min-h-screen">
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-[232px] flex-col border-r border-lime-300/10 bg-[#050607]/96 px-3 py-4 backdrop-blur-xl transition-transform lg:static lg:translate-x-0 ${mobileMenu ? "translate-x-0" : "-translate-x-full"}`}><div className="flex items-center justify-between px-2"><button className="flex items-center gap-3 text-left" onClick={() => { setMobileMenu(false); window.location.href = "/"; }} type="button"><span className="neon-pulse relative grid size-10 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black"><img src="/ai-zerow-icon.jpeg" alt="AI-ZEROW" className="size-full object-cover" /></span><span><span className="block text-sm font-bold tracking-[0.18em] text-slate-50">AI-ZEROW</span><span className="block text-[10px] uppercase tracking-[0.22em] text-lime-300/75">command</span></span></button><button className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-white/5 hover:text-white lg:hidden" onClick={() => setMobileMenu(false)} type="button" aria-label="Chiudi menu"><X className="size-4" /></button></div><button className="carbon-card mt-8 flex w-full items-center gap-3 rounded-xl p-3 text-left transition hover:border-lime-300/25" type="button" onClick={() => setToast("Workspace ZEROW · owner context")}><span className="grid size-8 place-items-center rounded-lg border border-lime-300/20 bg-lime-300/10 text-lime-200"><HardHat className="size-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-slate-200">ZEROW workspace</span><span className="mt-0.5 block truncate text-[10px] text-slate-600">owner · tenant context</span></span><ChevronRight className="size-3.5 text-slate-600" /></button><nav className="mt-7 flex-1" aria-label="Navigazione principale"><p className="px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-600">Workspace</p><div className="mt-2 space-y-1">{navItems.map((item) => { const Icon = item.icon; const active = item.id === "command"; return <button aria-current={active ? "page" : undefined} className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${active ? "border border-lime-300/20 bg-lime-300/10 text-lime-200 shadow-[inset_0_0_20px_rgba(190,255,60,0.04)]" : "text-slate-500 hover:bg-white/[0.045] hover:text-slate-100"}`} key={item.id} onClick={() => { if (item.id === "operations") { window.location.href = "/operations"; return; } if (item.id === "workforce") { window.location.href = "/workforce"; return; } if (item.id === "assets") { window.location.href = "/assets"; return; } if (item.id === "warehouse") { window.location.href = "/warehouse"; return; } if (item.id === "mission") { window.location.href = "/mission"; return; } if (item.id === "events_authority") { window.location.href = "/onboarding"; return; } if (active) setMobileMenu(false); else setToast(`${item.label}: superficie pronta per il prossimo adapter`); }} type="button"><Icon className={`size-4 ${active ? "text-lime-200" : "text-slate-600 group-hover:text-slate-300"}`} /><span>{item.label}</span>{item.badge && <span className={`ml-auto rounded border px-1.5 py-0.5 font-mono text-[8px] tracking-[0.08em] ${active ? "border-lime-300/25 text-lime-200" : "border-white/10 text-slate-600"}`}>{item.badge}</span>}</button>; })}</div></nav><div className="mt-5 border-t border-white/[0.08] pt-4"><div className="flex items-center justify-between px-2 text-[10px] uppercase tracking-[0.14em] text-slate-600"><span>System status</span><span className="flex items-center gap-1.5 text-lime-200"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_8px_rgba(190,255,60,0.8)]" /><span>online</span></span></div><div className="carbon-inset mt-3 rounded-xl p-3"><div className="flex items-center gap-2 text-[10px] text-slate-400"><Activity className="size-3.5 text-lime-300" />Command core</div><div className="mt-2 flex items-end gap-0.5">{[20,28,22,34,30,42,38,51,46,62,58,72].map((height, index) => <span className="flex-1 rounded-t-sm bg-lime-300/80" key={index} style={{ height: `${height / 2}px` }} />)}</div><p className="mt-3 font-mono text-[9px] text-slate-600">v1.0.0 · PREVIEW BUILD</p></div></div></aside>
    {mobileMenu && <button className="fixed inset-0 z-30 bg-black/75 lg:hidden" onClick={() => setMobileMenu(false)} aria-label="Chiudi menu" type="button" />}
    <section className="min-w-0 flex-1"><header className="sticky top-0 z-20 flex h-[72px] items-center gap-3 border-b border-white/[0.08] bg-[#050607]/88 px-4 backdrop-blur-xl sm:gap-5 sm:px-7"><IconButton label="Apri menu" onClick={() => setMobileMenu(true)} className="lg:hidden"><Menu className="size-4" /></IconButton><div className="relative hidden min-w-0 flex-1 md:block"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-600" /><Input aria-label="Cerca in COMMAND" className="h-10 max-w-[440px] border-white/10 bg-black/30 pl-10 text-xs text-slate-100 placeholder:text-slate-600 focus-visible:border-lime-300/40" onChange={(event) => setSearch(event.target.value)} placeholder="Cerca asset, lavori, team, persone…" value={search} /></div><div className="flex min-w-0 flex-1 items-center gap-2 md:hidden"><span className="truncate text-xs font-semibold tracking-[0.14em] text-slate-200">COMMAND</span><span className="size-1 rounded-full bg-lime-300" /></div><div className="ml-auto flex items-center gap-2"><span className="hidden items-center gap-2 rounded-full border border-lime-300/20 bg-lime-300/5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-lime-200 sm:flex"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_9px_rgba(190,255,60,0.9)]" />Preview mode</span><IconButton label="Notifiche"><Bell className="size-4" /></IconButton><span className="hidden size-8 place-items-center rounded-full border border-white/15 bg-gradient-to-br from-slate-200 to-slate-500 text-xs font-bold text-[#080a0b] sm:grid">AB</span><div className="hidden text-right lg:block"><p className="text-xs font-medium text-slate-200">Operatore</p><p className="text-[10px] text-slate-600">Team Alpha</p></div><ChevronDown className="hidden size-3.5 text-slate-500 lg:block" /></div></header><div className="mx-auto max-w-[1680px] px-4 py-5 sm:px-7 sm:py-7"><div className="mb-5 flex flex-wrap items-end justify-between gap-4"><div><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/70"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_9px_rgba(190,255,60,0.9)]" />AI-ZEROW / COMMAND</div><h1 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-50 sm:text-[28px]">Controllo operativo</h1><p className="mt-1 text-xs text-slate-500">Lavori, asset e team in movimento · {searchHint}</p></div><div className="flex items-center gap-2"><span className="hidden rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-[10px] text-slate-500 sm:inline-flex"><Clock3 className="mr-2 size-3.5 text-lime-300" />Aggiornato ora</span><Button className="h-9 border border-lime-300/30 bg-lime-300 px-3 text-xs font-semibold text-[#060806] shadow-[0_0_18px_rgba(190,255,60,0.16)] hover:bg-lime-200" onClick={() => setNewJobOpen(true)}><Plus className="size-3.5" />Nuovo lavoro</Button></div></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{kpis.map((kpi) => <KpiCard key={kpi.label} {...kpi} />)}</div><div className="mt-4 grid gap-4 2xl:grid-cols-[minmax(0,1.4fr)_minmax(340px,0.65fr)]"><MapBoard mapFilter={mapFilter} onFilterChange={setMapFilter} selectedMarker={selectedMarker} onSelectMarker={setSelectedMarker} /><ActivityPanel query={search} showAll={showAllActivity} onToggle={() => setShowAllActivity((value) => !value)} /></div><div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.12fr)_minmax(0,1fr)_minmax(320px,0.9fr)]"><JobPanel tab={jobTab} onTabChange={setJobTab} onNewJob={() => setNewJobOpen(true)} /><AssetPanel tab={assetTab} onTabChange={setAssetTab} /><AnalyticsPanel /></div><div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)]"><section className="carbon-card flex flex-wrap items-center justify-between gap-4 rounded-2xl p-4 sm:p-5"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl border border-lime-300/25 bg-lime-300/10 text-lime-200"><ShieldCheck className="size-4" /></span><div><p className="text-sm font-semibold text-slate-100">Command surface pronta</p><p className="mt-1 text-[11px] text-slate-500">I controlli sono collegati alla preview locale; dominio, eventi e readback restano esplicitamente separati.</p></div></div><div className="flex items-center gap-2"><StatusBadge>STATIC UI READY</StatusBadge><button className="grid size-8 place-items-center rounded-lg border border-white/10 text-slate-500 hover:border-lime-300/30 hover:text-lime-200" onClick={() => setLedgerOpen(true)} type="button" aria-label="Apri evidenze"><ArrowUpRight className="size-3.5" /></button></div></section><AssistantPanel query={assistantQuery} onQueryChange={setAssistantQuery} onSubmit={submitAssistant} response={assistantResponse} onQuickPrompt={handleQuickPrompt} onOpenLedger={() => setLedgerOpen(true)} /></div><footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] py-5 text-[10px] text-slate-600"><span>AI-ZEROW COMMAND · operational workspace</span><span className="flex items-center gap-2"><span>black carbon core</span><span className="size-1 rounded-full bg-lime-300" /><span>no secrets exported</span></span></footer></div></section>
  </div><LedgerDialog open={ledgerOpen} onOpenChange={setLedgerOpen} /><NewJobDialog open={newJobOpen} onOpenChange={setNewJobOpen} onCreated={handleNewJob} />{toast && <div className="fixed bottom-5 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2 rounded-xl border border-lime-300/25 bg-[#0b1008]/95 px-4 py-3 text-xs text-lime-100 shadow-[0_0_30px_rgba(190,255,60,0.14)] backdrop-blur-xl"><CheckCircle2 className="size-4 text-lime-300" />{toast}</div>}</main>;
}
