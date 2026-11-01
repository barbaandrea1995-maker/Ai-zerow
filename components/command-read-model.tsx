"use client";

import type { ReactNode } from "react";
import { BriefcaseBusiness, Package, Plus, Users, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type JobTab = "ATTIVI" | "PIANIFICATI" | "COMPLETATI" | "ANNULLATI";
type AssetTab = "OPERATIVI" | "MANUTENZIONE" | "TUTTI";
type Tone = "lime" | "amber" | "cyan" | "red";

type ActivityItem = { title: string; detail: string; time: string; icon: LucideIcon; tone: Tone };
type Job = { id: string; title: string; location: string; status: "In corso" | "Pianificato" | "Completato" | "Bloccato" | "Annullato"; team: string; progress: number; icon: LucideIcon };
type Asset = { id: string; title: string; detail: string; status: "Operativo" | "In manutenzione" | "Bloccato" | "Non disponibile"; team: string; icon: LucideIcon };
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
type KpiData = { label: string; value: string; delta: string; icon: LucideIcon; tone: Tone; data: string };

export const defaultAssistantResponse = "Nessun dato operativo nel readback D1. Collega un adapter o crea un record.";

function readbackTone(value: string): Tone {
  return value === "cyan" || value === "amber" || value === "red" ? value : "lime";
}

export function readbackLabel(status: "loading" | "online" | "partial" | "empty" | "error") {
  if (status === "loading") return "Lettura in corso";
  if (status === "online") return "D1 verificato";
  if (status === "partial") return "D1 parziale";
  if (status === "empty") return "D1 vuoto";
  return "D1 non disponibile";
}

function recordName(record: CommandRecord) {
  return typeof record.payload?.title === "string" && record.payload.title.trim() ? record.payload.title.trim() : record.title;
}

function recordStatus(record: CommandRecord): Job["status"] {
  const status = String(record.payload?.statusCode ?? record.status).trim().toUpperCase().replace(/[ -]+/g, "_");
  if (["COMPLETED", "COMPLETATA", "CLOSED", "CHIUSA"].includes(status)) return "Completato";
  if (["CANCELLED", "CANCELED", "ANNULLATA"].includes(status)) return "Annullato";
  if (["BLOCKED", "BLOCCATA"].includes(status)) return "Bloccato";
  if (["ACTIVE", "IN_CORSO"].includes(status)) return "In corso";
  return "Pianificato";
}

export function toJobs(records: CommandRecord[]): Job[] {
  return records.filter((record) => record.module === "operations").map((record) => {
    const [location, team] = record.detail.split(" · ");
    return { id: record.canonicalCode ?? record.id, title: recordName(record), location: location || record.detail || "Ubicazione non dichiarata", status: recordStatus(record), team: team || "Team non assegnato", progress: Math.max(0, Math.min(100, Number(record.progress) || 0)), icon: BriefcaseBusiness };
  });
}

export function toAssets(records: CommandRecord[]): Asset[] {
  return records.filter((record) => record.module === "assets").map((record) => {
    const lifecycle = String(record.payload?.lifecycleStatus ?? record.status).trim().toUpperCase().replace(/[ -]+/g, "_");
    const status: Asset["status"] = ["AVAILABLE", "ACTIVE", "OPERATIVO", "ONLINE", "IN_PRESIDIO"].includes(lifecycle)
      ? "Operativo"
      : ["MAINTENANCE", "IN_MANUTENZIONE", "MANUTENZIONE"].includes(lifecycle)
        ? "In manutenzione"
        : ["BLOCKED", "BLOCCATO"].includes(lifecycle) ? "Bloccato" : "Non disponibile";
    return { id: record.canonicalCode ?? record.id, title: recordName(record), detail: record.detail || "Dettaglio non dichiarato", status, team: typeof record.payload?.team === "string" ? record.payload.team : "Team non assegnato", icon: Package };
  });
}

export function toActivities(records: CommandRecord[]): ActivityItem[] {
  return records.slice(0, 8).map((record) => ({
    title: recordName(record),
    detail: `${record.module} · ${record.status || "readback"}`,
    time: record.updatedAt ? new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit" }).format(new Date(record.updatedAt)) : "readback",
    icon: record.module === "operations" ? BriefcaseBusiness : record.module === "assets" ? Package : Users,
    tone: readbackTone(record.tone),
  }));
}

const toneStyles: Record<Tone, { icon: string; badge: string; glow: string }> = {
  lime: { icon: "text-lime-300", badge: "border-lime-300/25 bg-lime-300/10 text-lime-200", glow: "shadow-[0_0_18px_rgba(190,255,60,0.22)]" },
  cyan: { icon: "text-cyan-300", badge: "border-cyan-300/25 bg-cyan-300/10 text-cyan-200", glow: "shadow-[0_0_18px_rgba(62,222,255,0.18)]" },
  amber: { icon: "text-amber-300", badge: "border-amber-300/25 bg-amber-300/10 text-amber-200", glow: "shadow-[0_0_18px_rgba(255,188,66,0.18)]" },
  red: { icon: "text-rose-300", badge: "border-rose-300/25 bg-rose-300/10 text-rose-200", glow: "shadow-[0_0_18px_rgba(255,84,111,0.18)]" },
};

function SectionTitle({ eyebrow, title, action, onAction }: { eyebrow?: string; title: string; action?: string; onAction?: () => void }) {
  const actionHref = action === "Vedi tutti" && title === "Commesse" ? "/operations" : action === "Vedi tutti" && title === "Asset" ? "/assets" : undefined;
  return <div className="flex items-start justify-between gap-3"><div>{eyebrow ? <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/65">{eyebrow}</p> : null}<h2 className="text-[15px] font-semibold tracking-[-0.01em] text-slate-100">{title}</h2></div>{action && onAction ? <button className="text-[11px] font-medium text-lime-300 transition hover:text-lime-100" onClick={onAction} type="button">{action}</button> : actionHref ? <a className="text-[11px] font-medium text-lime-300 transition hover:text-lime-100" href={actionHref}>{action}</a> : action ? <span className="text-[11px] font-medium text-slate-600">{action}</span> : null}</div>;
}

function StatusBadge({ children, tone = "lime" }: { children: ReactNode; tone?: Tone }) {
  const styles = toneStyles[tone];
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-semibold tracking-[0.04em] ${styles.badge}`}><span className={`size-1.5 rounded-full bg-current ${styles.glow}`} />{children}</span>;
}

export function KpiCard({ label, value, delta, icon: Icon, tone, data }: KpiData) {
  return <article className={`carbon-card carbon-card-neon min-w-0 rounded-2xl p-4 ${tone === "cyan" ? "carbon-card-cyan" : ""}`}><div className="flex items-start justify-between gap-3"><span className={`grid size-9 place-items-center rounded-xl border border-current/20 bg-current/10 ${toneStyles[tone].icon}`}><Icon className="size-[18px]" /></span><StatusBadge tone={tone}>{delta}</StatusBadge></div><p className="mt-4 text-xs text-slate-500">{label}</p><div className="mt-1 flex items-end justify-between gap-4"><p className="font-mono text-[30px] font-semibold leading-none tracking-[-0.06em] text-slate-50">{value}</p><span className="pb-1 text-[10px] uppercase tracking-[0.12em] text-lime-300/60">readback</span></div><p className="mt-2 text-[10px] text-slate-600">{data}</p></article>;
}

export function ActivityPanel({ query, showAll, onToggle, activities }: { query: string; showAll: boolean; onToggle: () => void; activities: ActivityItem[] }) {
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = activities.filter((item) => `${item.title} ${item.detail}`.toLowerCase().includes(normalizedQuery));
  const visible = showAll ? filtered : filtered.slice(0, 5);
  return <section className="carbon-card rounded-2xl p-4 sm:p-5"><SectionTitle action={showAll ? "Riduci" : "Vedi tutte"} eyebrow="AGGIORNAMENTI OPERATIVI" onAction={onToggle} title="Attività recenti" /><div className="mt-4 divide-y divide-white/[0.07]">{visible.map((item) => { const Icon = item.icon; return <div className="flex items-center gap-3 py-3 first:pt-0 last:pb-0" key={`${item.title}-${item.time}`}><span className={`grid size-8 shrink-0 place-items-center rounded-xl border ${toneStyles[item.tone].badge}`}><Icon className="size-4" /></span><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-slate-200">{item.title}</p><p className="mt-1 truncate text-[11px] text-slate-500">{item.detail}</p></div><span className="shrink-0 text-[10px] text-slate-600">{item.time}</span></div>; })}{visible.length === 0 ? <div className="rounded-lg border border-dashed border-white/10 px-3 py-5 text-center text-xs text-slate-500">Nessuna attività corrisponde alla ricerca.</div> : null}</div></section>;
}

export function JobPanel({ tab, onTabChange, onNewJob, jobs, actionLabel = "Nuovo", showViewAll = true }: { tab: JobTab; onTabChange: (value: JobTab) => void; onNewJob: () => void; jobs: Job[]; actionLabel?: string; showViewAll?: boolean }) {
  const visibleJobs = jobs.filter((job) => tab === "ATTIVI" ? job.status === "In corso" || job.status === "Bloccato" : tab === "PIANIFICATI" ? job.status === "Pianificato" : tab === "COMPLETATI" ? job.status === "Completato" : job.status === "Annullato");
  return <section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><SectionTitle action={showViewAll ? "Vedi tutti" : undefined} eyebrow="COMMESSE" title="Commesse" /><Button className="h-8 border border-lime-300/25 bg-lime-300/10 px-2.5 text-[11px] text-lime-200 hover:bg-lime-300/20" onClick={onNewJob}><Plus className="size-3.5" />{actionLabel}</Button></div><Tabs className="mt-4" value={tab} onValueChange={(value) => onTabChange(value as JobTab)}><TabsList className="grid h-8 w-full grid-cols-4 rounded-lg border border-white/10 bg-black/25 p-1">{[["ATTIVI", "Attive"], ["PIANIFICATI", "Pianificate"], ["COMPLETATI", "Concluse"], ["ANNULLATI", "Annullate"]].map(([value, label]) => <TabsTrigger className="h-6 px-1 text-[9px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]" key={value} value={value}>{label}</TabsTrigger>)}</TabsList></Tabs><div className="mt-3 divide-y divide-white/[0.07]">{visibleJobs.map((job) => { const Icon = job.icon; const tone: Tone = job.status === "Pianificato" ? "cyan" : job.status === "Bloccato" || job.status === "Annullato" ? "red" : "lime"; return <div className="flex items-center gap-3 py-3 first:pt-0 last:pb-0" key={job.id}><span className={`grid size-8 shrink-0 place-items-center rounded-lg border ${toneStyles[tone].badge}`}><Icon className="size-3.5" /></span><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="font-mono text-[11px] font-semibold text-slate-200">{job.id}</span><span className="truncate text-[11px] text-slate-300">{job.title}</span></div><p className="mt-1 truncate text-[10px] text-slate-500">{job.location}</p></div><div className="hidden w-[82px] text-right sm:block"><StatusBadge tone={tone}>{job.status}</StatusBadge><div className="mt-2 ml-auto h-1 w-[72px] overflow-hidden rounded-full bg-white/10"><span className="block h-full rounded-full bg-lime-300" style={{ width: `${job.progress}%` }} /></div></div></div>; })}{visibleJobs.length === 0 ? <div className="py-6 text-center text-xs text-slate-500">Nessuna commessa {tab === "ANNULLATI" ? "annullata" : "in questo stato"}.</div> : null}</div></section>;
}

export function AssetPanel({ tab, onTabChange, assets }: { tab: AssetTab; onTabChange: (value: AssetTab) => void; assets: Asset[] }) {
  const visibleAssets = assets.filter((asset) => tab === "TUTTI" || tab === "OPERATIVI" ? tab === "TUTTI" || asset.status === "Operativo" : asset.status === "In manutenzione");
  return <section className="carbon-card rounded-2xl p-4 sm:p-5"><SectionTitle action="Vedi tutti" eyebrow="FLOTTA E ATTREZZATURE" title="Asset" /><Tabs className="mt-4" value={tab} onValueChange={(value) => onTabChange(value as AssetTab)}><TabsList className="h-8 w-full justify-start rounded-lg border border-white/10 bg-black/25 p-1"><TabsTrigger className="h-6 flex-none px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]" value="OPERATIVI">Operativi</TabsTrigger><TabsTrigger className="h-6 flex-none px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]" value="MANUTENZIONE">Manutenzione</TabsTrigger><TabsTrigger className="h-6 flex-none px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]" value="TUTTI">Tutti</TabsTrigger></TabsList></Tabs><div className="mt-3 divide-y divide-white/[0.07]">{visibleAssets.map((asset) => { const Icon = asset.icon; const tone: Tone = asset.status === "Operativo" ? "lime" : asset.status === "In manutenzione" ? "amber" : asset.status === "Bloccato" ? "red" : "cyan"; return <div className="flex items-center gap-3 py-3 first:pt-0 last:pb-0" key={asset.id}><span className={`grid size-8 shrink-0 place-items-center rounded-lg border ${toneStyles[tone].badge}`}><Icon className="size-3.5" /></span><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="font-mono text-[11px] font-semibold text-slate-200">{asset.id}</span><span className="truncate text-[11px] text-slate-300">{asset.title}</span></div><p className="mt-1 truncate text-[10px] text-slate-500">{asset.detail}</p></div><div className="hidden text-right sm:block"><div className="flex items-center justify-end gap-1.5 text-[10px] text-slate-300"><span className={`size-1.5 rounded-full bg-current ${toneStyles[tone].icon}`} />{asset.status}</div><p className="mt-1 text-[10px] text-slate-600">{asset.team}</p></div></div>; })}{visibleAssets.length === 0 ? <div className="py-6 text-center text-xs text-slate-500">Nessun asset in questo stato.</div> : null}</div></section>;
}
