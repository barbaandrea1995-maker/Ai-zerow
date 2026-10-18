"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  ArrowLeft,
  Bell,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  FileCheck2,
  Gauge,
  Link2,
  LockKeyhole,
  Mail,
  Menu,
  MessageSquareText,
  Mic,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  UsersRound,
  Volume2,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TenantSwitcher } from "@/components/tenant-switcher";
import { CommandMobileNav } from "@/components/command-mobile-nav";
import { getAllowedCommandNavigation } from "@/lib/command-dashboard";
import { authorityRoleLabel } from "@/lib/authority-catalog";

type Tone = "lime" | "cyan" | "amber" | "red";
type ViewKey = "inbox" | "compose" | "acknowledgements" | "voice";
type CommunicationType = "SHIFT_BRIEFING" | "TEAM_BROADCAST" | "ACK_REQUEST" | "VOICE_PROPOSAL";
type Channel = "IN_APP" | "PUSH" | "EMAIL" | "VOICE";
type AudienceType = "TENANT" | "TEAM" | "ROLE" | "JOB";

type RecordItem = {
  id: string;
  recordType: string;
  title: string;
  detail: string;
  meta: string;
  status: string;
  tone: Tone;
  progress: number;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type AuthorityContext = { actorName?: string; role?: string; roles?: string[]; capabilities?: string[]; operatingDomains?: string[] };
type ApiResponse = { records?: RecordItem[]; context?: AuthorityContext; readback?: { count?: number; checkedAt?: string }; error?: string };
type OperationJob = { id: string; canonicalCode?: string; title: string; status?: string };
type OperationsResponse = { records?: OperationJob[]; error?: string };
type ExternalAdapter = { key: string; title: string; provider: string; effectiveStatus?: string; status?: string; contract?: string; gate?: string; nextAction?: string; capabilities?: string[] };
type ExternalResponse = { adapters?: ExternalAdapter[]; error?: string };

type FormState = {
  recordType: CommunicationType;
  channel: Channel;
  audienceType: AudienceType;
  audienceRef: string;
  jobId: string;
  title: string;
  detail: string;
  requiresAcknowledgement: boolean;
};

const navItems: Array<{ label: string; href: string; icon: LucideIcon; capability?: string }> = [
  { label: "CENTRALE", href: "/command", icon: Sparkles, capability: "command.read" },
  { label: "COMMESSE", href: "/operations", icon: FileCheck2, capability: "operations.read" },
  { label: "PERSONE", href: "/workforce", icon: UsersRound, capability: "workforce.read" },
  { label: "PIANIFICAZIONE", href: "/planning", icon: Gauge, capability: "planning.read" },
  { label: "PRESENZE", href: "/presenze", icon: Clock3, capability: "workforce.read" },
  { label: "MAGAZZINO", href: "/warehouse", icon: Link2, capability: "warehouse.read" },
  { label: "ASSET", href: "/assets", icon: ShieldCheck, capability: "asset.read" },
  { label: "MISSIONI", href: "/mission", icon: Send, capability: "mission.read" },
  { label: "DOCUMENTI", href: "/documents", icon: BookOpen, capability: "documents.read" },
  { label: "FINANZA", href: "/finance", icon: Activity, capability: "finance.read" },
  { label: "ACQUISTI", href: "/procurement", icon: FileCheck2, capability: "procurement.read" },
  { label: "GOVERNANCE", href: "/governance", icon: LockKeyhole, capability: "governance.read" },
  { label: "COMUNICAZIONI", href: "/communications", icon: MessageSquareText, capability: "communication.read" },
  { label: "INTEGRAZIONI", href: "/externals", icon: Link2, capability: "external_adapters.read" },
  { label: "EVENTI", href: "/events", icon: FileCheck2, capability: "events.read" },
  { label: "AUTORITÀ", href: "/onboarding", icon: ShieldCheck, capability: "authority.read" },
];

const viewItems: Array<{ id: ViewKey; label: string; icon: LucideIcon }> = [
  { id: "inbox", label: "Registro", icon: MessageSquareText },
  { id: "compose", label: "Nuova proposta", icon: Plus },
  { id: "acknowledgements", label: "Acknowledgement", icon: CheckCircle2 },
  { id: "voice", label: "Voice boundary", icon: Mic },
];

const EMPTY_CAPABILITIES: string[] = [];

const toneClass: Record<Tone, { icon: string; badge: string; bar: string }> = {
  lime: { icon: "text-lime-200", badge: "border-lime-300/25 bg-lime-300/10 text-lime-200", bar: "bg-lime-300" },
  cyan: { icon: "text-cyan-200", badge: "border-cyan-300/25 bg-cyan-300/10 text-cyan-200", bar: "bg-cyan-300" },
  amber: { icon: "text-amber-200", badge: "border-amber-300/25 bg-amber-300/10 text-amber-200", bar: "bg-amber-300" },
  red: { icon: "text-rose-200", badge: "border-rose-300/25 bg-rose-300/10 text-rose-200", bar: "bg-rose-300" },
};

function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`carbon-card rounded-2xl p-4 sm:p-5 ${className}`}>{children}</section>;
}

function Badge({ children, tone = "lime" }: { children: ReactNode; tone?: Tone }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[9px] font-semibold uppercase tracking-[.06em] ${toneClass[tone].badge}`}><span className="size-1.5 rounded-full bg-current" />{children}</span>;
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
}

function textValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function boolValue(value: unknown) {
  return value === true;
}

function statusTone(status: string): Tone {
  const normalized = status.toUpperCase();
  if (normalized.includes("BLOCK") || normalized.includes("FAIL")) return "red";
  if (normalized.includes("PENDING") || normalized.includes("DEFERRED") || normalized.includes("DRAFT")) return "amber";
  if (normalized.includes("DELIVERED") || normalized.includes("VERIFIED") || normalized.includes("READY")) return "lime";
  return "cyan";
}

function typeLabel(value: string) {
  return value.replaceAll("_", " ");
}

function channelLabel(value: string) {
  return ({ IN_APP: "In-app", PUSH: "Push", EMAIL: "Email", VOICE: "Voice" } as Record<string, string>)[value] ?? value;
}

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || `request_failed_${response.status}`);
  return payload;
}

function recordChannel(record: RecordItem) {
  return textValue(record.payload?.channel, record.recordType === "VOICE_PROPOSAL" ? "VOICE" : "IN_APP");
}

function recordAudience(record: RecordItem) {
  return textValue(record.payload?.audienceType, "TENANT");
}

function IconButton({ label, onClick, children, className = "" }: { label: string; onClick: () => void; children: ReactNode; className?: string }) {
  return <button aria-label={label} className={`grid size-9 place-items-center rounded-xl border border-white/10 bg-black/20 text-slate-500 transition hover:border-lime-300/30 hover:text-lime-200 ${className}`} onClick={onClick} type="button">{children}</button>;
}

export default function CommunicationsControl() {
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [view, setView] = useState<ViewKey>("inbox");
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [jobs, setJobs] = useState<OperationJob[]>([]);
  const [context, setContext] = useState<AuthorityContext>({});
  const [externalAdapters, setExternalAdapters] = useState<ExternalAdapter[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [channelFilter, setChannelFilter] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [form, setForm] = useState<FormState>({ recordType: "TEAM_BROADCAST", channel: "IN_APP", audienceType: "TENANT", audienceRef: "", jobId: "", title: "", detail: "", requiresAcknowledgement: false });

  const capabilities = context.capabilities ?? EMPTY_CAPABILITIES;
  const allowedMobileNavigation = useMemo(() => getAllowedCommandNavigation(capabilities).map((item) => item.id), [capabilities]);
  const canSend = capabilities.includes("communication.send");
  const canReadJobs = capabilities.includes("operations.read");
  const allowedNavigation = navItems.filter((item) => item.href === "/communications" || !item.capability || capabilities.includes(item.capability));
  const voiceAdapter = externalAdapters.find((adapter) => adapter.key === "voice-telephony");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await readJson<ApiResponse>("/api/communications");
      const nextRecords = payload.records ?? [];
      const nextCapabilities = payload.context?.capabilities ?? [];
      setRecords(nextRecords);
      setContext(payload.context ?? {});
      setSelectedId((current) => current && nextRecords.some((record) => record.id === current) ? current : nextRecords[0]?.id ?? "");
      const [jobsResult, externalResult] = await Promise.allSettled([
        nextCapabilities.includes("operations.read")
          ? readJson<OperationsResponse>("/api/operations")
          : Promise.resolve<OperationsResponse>({ records: [] }),
        nextCapabilities.includes("external_adapters.read")
          ? readJson<ExternalResponse>("/api/externals")
          : Promise.resolve<ExternalResponse>({ adapters: [] }),
      ]);
      setJobs(jobsResult.status === "fulfilled" ? jobsResult.value.records ?? [] : []);
      setExternalAdapters(externalResult.status === "fulfilled" ? externalResult.value.adapters ?? [] : []);
    } catch {
      setRecords([]);
      setJobs([]);
      setExternalAdapters([]);
      setToast("Registro comunicazioni non disponibile");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const filteredRecords = useMemo(() => records.filter((record) => {
    const haystack = `${record.id} ${record.title} ${record.detail} ${record.meta} ${record.status} ${record.recordType} ${recordChannel(record)} ${recordAudience(record)}`.toLocaleLowerCase("it-IT");
    const matchesQuery = haystack.includes(query.toLocaleLowerCase("it-IT"));
    const matchesStatus = statusFilter === "ALL" || record.status === statusFilter;
    const matchesChannel = channelFilter === "ALL" || recordChannel(record) === channelFilter;
    return matchesQuery && matchesStatus && matchesChannel;
  }), [channelFilter, query, records, statusFilter]);
  const selected = filteredRecords.find((record) => record.id === selectedId) ?? filteredRecords[0] ?? records[0];
  const acknowledgementRecords = records.filter((record) => boolValue(record.payload?.requiresAcknowledgement) || record.recordType === "ACK_REQUEST");
  const pendingAcknowledgements = acknowledgementRecords.filter((record) => !/DELIVERED|ACKNOWLEDGED|CLOSED|REJECTED/i.test(record.status));
  const voiceRecords = records.filter((record) => recordChannel(record) === "VOICE" || record.recordType === "VOICE_PROPOSAL");
  const deferredCount = records.filter((record) => textValue(record.payload?.providerStatus) === "EXTERNAL_DEFERRED" || record.status === "EXTERNAL_DEFERRED").length;
  const activeProgress = records.length ? Math.round(records.reduce((sum, record) => sum + record.progress, 0) / records.length) : 0;

  function navigate(path: string) {
    setMobileMenu(false);
    router.push(path);
  }

  function openComposer(type: CommunicationType = "TEAM_BROADCAST") {
    const voice = type === "VOICE_PROPOSAL";
    setForm((current) => ({ ...current, recordType: type, channel: voice ? "VOICE" : current.channel, requiresAcknowledgement: voice || current.requiresAcknowledgement }));
    setView("compose");
  }

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function createProposal(event: FormEvent) {
    event.preventDefault();
    if (!canSend) {
      setToast("Il ruolo corrente è in sola lettura per le comunicazioni");
      return;
    }
    if (form.title.trim().length < 2 || form.detail.trim().length < 2) {
      setToast("Titolo e messaggio sono obbligatori");
      return;
    }
    if (form.audienceType === "JOB" && !form.jobId) {
      setToast("Seleziona una commessa reale dal registro Operations");
      return;
    }
    setSaving(true);
    try {
      await readJson<ApiResponse>("/api/communications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          recordType: form.recordType,
          channel: form.channel,
          audienceType: form.audienceType,
          audienceRef: form.audienceRef,
          jobId: form.jobId || undefined,
          title: form.title,
          detail: form.detail,
          requiresAcknowledgement: form.requiresAcknowledgement,
          idempotencyKey: `communication:${crypto.randomUUID()}`,
        }),
      });
      setToast("Proposta registrata e riletta nel tenant");
      setForm({ recordType: "TEAM_BROADCAST", channel: "IN_APP", audienceType: "TENANT", audienceRef: "", jobId: "", title: "", detail: "", requiresAcknowledgement: false });
      setView("inbox");
      await load();
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Proposta non registrata");
    } finally {
      setSaving(false);
    }
  }

  return <main className="zw-app-shell zw-command-ultra min-h-screen overflow-x-hidden text-slate-100"><div className="zw-command-ambient" aria-hidden="true" /><div className="flex min-h-screen">
    <aside className={`zw-command-sidebar hidden shrink-0 flex-col border-r border-lime-300/10 bg-[#050706]/96 px-3 py-4 backdrop-blur-xl transition-[width] duration-200 lg:flex ${sidebarCollapsed ? "w-[78px]" : "w-[252px]"}`}>
      <div className={`flex items-center ${sidebarCollapsed ? "justify-center" : "justify-between"}`}><button aria-label="Apri Command" className="flex items-center gap-3 text-left" onClick={() => navigate("/command")} type="button"><span className="neon-pulse grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black shadow-[0_0_22px_rgba(200,255,34,.14)]"><Image src="/ai-zerow-icon.jpeg" alt="AI-ZEROW" width={40} height={40} className="size-full object-cover" /></span>{!sidebarCollapsed && <span><span className="block text-sm font-bold tracking-[.18em] text-slate-50">AI-ZEROW</span><span className="block text-[10px] uppercase tracking-[.22em] text-lime-300/75">command</span></span>}</button>{!sidebarCollapsed && <IconButton label="Riduci sidebar" onClick={() => setSidebarCollapsed(true)}><PanelLeftClose className="size-4" /></IconButton>}</div>
      {sidebarCollapsed && <button aria-label="Espandi sidebar" className="mx-auto mt-5 grid size-8 place-items-center rounded-lg border border-white/10 text-slate-600 transition hover:border-lime-300/30 hover:text-lime-200" onClick={() => setSidebarCollapsed(false)} type="button"><PanelLeftOpen className="size-4" /></button>}
      {!sidebarCollapsed && <div className="carbon-card mt-7 rounded-2xl p-3"><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.13em] text-lime-200"><MessageSquareText className="size-4" />W13 / COMMUNICATIONS</div><p className="mt-2 text-[10px] leading-5 text-slate-600">Briefing, broadcast, acknowledgment e voice sotto lo stesso perimetro.</p></div>}
      <nav className={`${sidebarCollapsed ? "mt-7" : "mt-6"} flex-1`} aria-label="Navigazione Command"><p className={`px-3 text-[9px] font-semibold uppercase tracking-[.2em] text-slate-700 ${sidebarCollapsed ? "sr-only" : ""}`}>Command modules</p><div className="mt-2 space-y-1">{allowedNavigation.map((item) => { const NavIcon = item.icon; const active = item.href === "/communications"; return <button aria-current={active ? "page" : undefined} aria-label={item.label} className={`group flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-[11px] font-medium tracking-[.06em] transition ${sidebarCollapsed ? "justify-center px-0" : ""} ${active ? "border-lime-300/25 bg-lime-300/[.08] text-lime-100 shadow-[0_0_18px_rgba(200,255,34,.07)]" : "border-transparent text-slate-500 hover:border-white/10 hover:bg-white/[.035] hover:text-slate-100"}`} key={item.href} onClick={() => navigate(item.href)} type="button"><NavIcon className="size-4 shrink-0" />{!sidebarCollapsed && <span>{item.label}</span>}</button>; })}</div></nav>
      {!sidebarCollapsed && <div className="border-t border-white/[.08] pt-4"><div className="flex items-center justify-between px-2 text-[9px] uppercase tracking-[.14em] text-slate-600"><span>Authority</span><span className="text-lime-200">{context.role ? authorityRoleLabel(context.role) : "—"}</span></div><p className="mt-3 px-2 font-mono text-[9px] text-slate-600">tenant scoped · delivery deferred</p></div>}
    </aside>

    <section className="min-w-0 flex-1"><header className="zw-command-topbar sticky top-0 z-30 flex h-[72px] items-center gap-3 border-b border-white/[.08] bg-[#050706]/88 px-4 backdrop-blur-xl sm:gap-5 sm:px-7"><IconButton label="Apri menu" onClick={() => setMobileMenu(true)} className="lg:hidden"><Menu className="size-4" /></IconButton><button aria-label="Apri Comunicazioni" className="zw-command-topbar__brand flex shrink-0 items-center gap-2 text-left" onClick={() => setView("inbox")} type="button"><span className="relative grid size-9 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black"><Image src="/ai-zerow-icon.jpeg" alt="ZEROW" width={36} height={36} className="size-full object-cover" /></span><span className="hidden sm:block"><span className="block text-[11px] font-bold tracking-[.18em] text-slate-50">ZEROW</span><span className="block text-[9px] uppercase tracking-[.2em] text-lime-300/75">communications</span></span></button><IconButton className="hidden lg:grid" label="Riduci sidebar" onClick={() => setSidebarCollapsed((value) => !value)}>{sidebarCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}</IconButton><div className="relative hidden min-w-0 flex-1 justify-center md:flex"><div className="relative w-full max-w-[520px]"><Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-600" /><Input aria-label="Cerca comunicazioni" className="h-10 w-full border-lime-300/10 bg-black/35 pl-10 text-xs text-slate-100 placeholder:text-slate-600" onChange={(event) => setQuery(event.target.value)} placeholder="Cerca messaggi, commesse, canali…" value={query} /></div></div><div className="flex min-w-0 flex-1 items-center gap-2 md:hidden"><span className="truncate text-xs font-semibold tracking-[.14em] text-slate-200">COMMUNICATIONS</span><span className="size-1 rounded-full bg-lime-300" /></div><div className="ml-auto flex min-w-0 items-center gap-2"><TenantSwitcher /><span className="hidden items-center gap-2 rounded-full border border-lime-300/20 bg-lime-300/5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[.12em] text-lime-200 sm:flex"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_9px_rgba(200,255,34,.85)]" />{loading ? "READING" : "D1 VERIFIED"}</span><IconButton label="Torna indietro" onClick={() => navigate("/command")}><ArrowLeft className="size-4" /></IconButton><IconButton label="Aggiorna comunicazioni" onClick={() => void load()}><RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} /></IconButton><IconButton label="Apri comunicazioni nel Command" onClick={() => navigate("/command")}><Bell className="size-4" /></IconButton><span className="hidden size-8 place-items-center rounded-full border border-white/15 bg-gradient-to-br from-slate-200 to-slate-500 text-xs font-bold text-[#080a0b] sm:grid">AB</span><div className="hidden text-right lg:block"><p className="text-xs font-medium text-slate-200">{context.role ? authorityRoleLabel(context.role) : "Operatore"}</p><p className="text-[10px] text-slate-600">Tenant corrente</p></div><ChevronDown className="hidden size-3.5 text-slate-500 lg:block" /></div></header>

      {mobileMenu && <><button aria-label="Chiudi menu laterale" className="fixed inset-0 z-30 bg-black/70 lg:hidden" onClick={() => setMobileMenu(false)} type="button" /><aside className="fixed inset-y-0 left-0 z-40 flex w-[280px] flex-col border-r border-lime-300/15 bg-[#070b08] px-4 py-4 shadow-[0_0_60px_rgba(0,0,0,.7)] lg:hidden"><div className="flex items-center justify-between"><button className="flex items-center gap-3 text-left" onClick={() => navigate("/command")} type="button"><span className="grid size-9 place-items-center overflow-hidden rounded-xl border border-lime-300/40"><Image src="/ai-zerow-icon.jpeg" alt="AI-ZEROW" width={36} height={36} className="size-full object-cover" /></span><span className="text-xs font-bold tracking-[.18em]">AI-ZEROW</span></button><IconButton label="Chiudi menu" onClick={() => setMobileMenu(false)}><X className="size-4" /></IconButton></div><nav className="mt-8 space-y-1" aria-label="Navigazione mobile">{allowedNavigation.map((item) => { const NavIcon = item.icon; const active = item.href === "/communications"; return <button className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-xs ${active ? "border border-lime-300/20 bg-lime-300/10 text-lime-200" : "text-slate-400 hover:bg-white/[.04]"}`} key={item.href} onClick={() => navigate(item.href)} type="button"><NavIcon className="size-4" />{item.label}</button>; })}</nav></aside></>}

      <div className="mx-auto max-w-[1680px] px-4 py-5 sm:px-7 sm:py-7"><section className="relative overflow-hidden rounded-[24px] border border-lime-300/20 bg-[linear-gradient(115deg,rgba(7,12,8,.98),rgba(8,18,11,.94)_56%,rgba(45,74,0,.3))] p-5 shadow-[0_24px_70px_rgba(0,0,0,.42)] sm:p-7"><div className="pointer-events-none absolute -right-28 -top-24 size-[340px] rounded-full bg-lime-300/[.11] blur-[86px]" /><div className="relative flex flex-wrap items-end justify-between gap-6"><div className="max-w-3xl"><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.22em] text-lime-300/80"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_12px_rgba(200,255,34,.8)]" />W13 / FIELD COMMUNICATIONS CONTROL</div><h1 className="mt-3 max-w-2xl text-[clamp(2rem,4.4vw,4.1rem)] font-semibold leading-[.94] tracking-[-.07em] text-slate-50">KEEP THE FIELD<br /><span className="text-lime-300">IN SYNC.</span></h1><p className="mt-4 max-w-2xl text-sm leading-6 text-slate-400">Briefing, broadcast e acknowledgement partono dal tenant autorizzato. La consegna provider e la voce restano visibili come confini, mai come successo inventato.</p><div className="mt-5 flex flex-wrap gap-2"><Button className="h-10 bg-lime-300 px-4 text-xs font-semibold text-[#050705] shadow-[0_0_24px_rgba(200,255,34,.16)] hover:bg-lime-200" disabled={!canSend} onClick={() => openComposer("TEAM_BROADCAST")}><Plus className="size-3.5" />Nuova comunicazione</Button><Button className="h-10 border-lime-300/20 bg-black/25 px-4 text-xs text-lime-100 hover:border-lime-300/45 hover:bg-lime-300/[.06]" onClick={() => setView("acknowledgements")} variant="outline"><CheckCircle2 className="size-3.5" />Apri acknowledgment</Button></div></div><div className="min-w-[230px] rounded-2xl border border-white/[.10] bg-black/25 p-4 backdrop-blur-xl"><div className="flex items-center justify-between gap-3"><span className="text-[9px] font-semibold uppercase tracking-[.16em] text-slate-500">Delivery boundary</span><span className="size-2 rounded-full bg-amber-300 shadow-[0_0_14px_rgba(255,181,46,.7)]" /></div><p className="mt-3 font-mono text-2xl font-semibold tracking-[-.06em] text-amber-100">{deferredCount} DEFERRED</p><p className="mt-2 text-[10px] leading-5 text-slate-500">Sites certifica proposta, ledger ed eventi. Consumer, push, email e telephony richiedono adapter.</p><div className="mt-4 flex items-center justify-between border-t border-white/[.08] pt-3 text-[10px]"><span className="text-slate-600">Provider voice</span><span className="text-amber-100">{voiceAdapter?.effectiveStatus ?? voiceAdapter?.status ?? "NOT OBSERVED"}</span></div></div></div></section>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><article className="carbon-card rounded-2xl p-4"><div className="flex items-start justify-between"><span className="grid size-9 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/10 text-lime-200"><MessageSquareText className="size-[18px]" /></span><Badge>{loading ? "—" : "D1"}</Badge></div><p className="mt-4 text-[10px] uppercase tracking-[.14em] text-slate-600">Record nel tenant</p><p className="mt-1 font-mono text-[28px] font-semibold leading-none tracking-[-.06em] text-slate-50">{loading ? "—" : records.length}</p><p className="mt-3 text-[10px] text-slate-600">Readback append-only</p></article><article className="carbon-card rounded-2xl p-4"><div className="flex items-start justify-between"><span className="grid size-9 place-items-center rounded-xl border border-amber-300/20 bg-amber-300/10 text-amber-100"><CheckCircle2 className="size-[18px]" /></span><Badge tone="amber">OPEN</Badge></div><p className="mt-4 text-[10px] uppercase tracking-[.14em] text-slate-600">Acknowledgment aperti</p><p className="mt-1 font-mono text-[28px] font-semibold leading-none tracking-[-.06em] text-slate-50">{pendingAcknowledgements.length}</p><p className="mt-3 text-[10px] text-slate-600">Inbound provider non collegato</p></article><article className="carbon-card rounded-2xl p-4"><div className="flex items-start justify-between"><span className="grid size-9 place-items-center rounded-xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-100"><Gauge className="size-[18px]" /></span><Badge tone="cyan">SITES</Badge></div><p className="mt-4 text-[10px] uppercase tracking-[.14em] text-slate-600">Progress readback</p><p className="mt-1 font-mono text-[28px] font-semibold leading-none tracking-[-.06em] text-slate-50">{activeProgress}%</p><p className="mt-3 text-[10px] text-slate-600">Nessuna consegna implicita</p></article><article className="carbon-card rounded-2xl p-4"><div className="flex items-start justify-between"><span className="grid size-9 place-items-center rounded-xl border border-amber-300/20 bg-amber-300/10 text-amber-100"><Mic className="size-[18px]" /></span><Badge tone="amber">DEFERRED</Badge></div><p className="mt-4 text-[10px] uppercase tracking-[.14em] text-slate-600">Voice proposals</p><p className="mt-1 font-mono text-[28px] font-semibold leading-none tracking-[-.06em] text-slate-50">{voiceRecords.length}</p><p className="mt-3 text-[10px] text-slate-600">Consenso prima del connector</p></article></div>

        <div className="mt-5 flex gap-2 overflow-x-auto border-b border-white/[.08] pb-2">{viewItems.map(({ id, label, icon: Icon }) => <button className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[.08em] transition ${view === id ? "border border-lime-300/25 bg-lime-300/10 text-lime-200 shadow-[0_0_20px_rgba(200,255,34,.06)]" : "border border-transparent text-slate-600 hover:bg-white/[.035] hover:text-slate-300"}`} key={id} onClick={() => setView(id)} type="button"><Icon className="size-3.5" />{label}{id === "acknowledgements" && pendingAcknowledgements.length > 0 ? <span className="rounded-full bg-amber-300 px-1.5 py-0.5 text-[8px] text-[#050705]">{pendingAcknowledgements.length}</span> : null}</button>)}</div>

        {view === "inbox" && <div className="mt-4 grid gap-4 2xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,.75fr)]"><Panel><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-lime-300/70">COMMUNICATION REGISTER</p><h2 className="mt-1 text-base font-semibold">Registro operativo</h2><p className="mt-1 text-[11px] text-slate-500">Messaggi, briefing e proposte con stato, audience, canale e delivery boundary.</p></div><div className="flex items-center gap-2"><Badge tone={loading ? "amber" : "lime"}>{loading ? "READING" : "D1 READBACK"}</Badge><IconButton label="Aggiorna registro" onClick={() => void load()}><RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} /></IconButton></div></div><div className="mt-4 grid gap-2 md:grid-cols-[minmax(0,1fr)_150px_150px]"><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-600" /><Input aria-label="Filtra registro comunicazioni" className="h-10 border-white/10 bg-black/25 pl-9 text-xs text-slate-100 placeholder:text-slate-600" onChange={(event) => setQuery(event.target.value)} placeholder="Titolo, commessa, canale…" value={query} /></div><select aria-label="Filtra canale" className="h-10 rounded-xl border border-white/10 bg-black/25 px-3 text-xs text-slate-200 outline-none focus:border-lime-300/40" onChange={(event) => setChannelFilter(event.target.value)} value={channelFilter}><option value="ALL">Tutti i canali</option><option value="IN_APP">In-app</option><option value="PUSH">Push</option><option value="EMAIL">Email</option><option value="VOICE">Voice</option></select><select aria-label="Filtra stato" className="h-10 rounded-xl border border-white/10 bg-black/25 px-3 text-xs text-slate-200 outline-none focus:border-lime-300/40" onChange={(event) => setStatusFilter(event.target.value)} value={statusFilter}><option value="ALL">Tutti gli stati</option>{[...new Set(records.map((record) => record.status))].map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</select></div><div className="mt-4 space-y-2">{filteredRecords.map((record) => <button className={`group w-full rounded-2xl border p-4 text-left transition ${selected?.id === record.id ? "border-lime-300/35 bg-lime-300/[.065] shadow-[0_0_24px_rgba(200,255,34,.07)]" : "border-white/[.07] bg-black/20 hover:border-lime-300/25 hover:bg-lime-300/[.03]"}`} key={record.id} onClick={() => setSelectedId(record.id)} type="button"><div className="flex items-start gap-3"><span className={`grid size-10 shrink-0 place-items-center rounded-xl border border-current/20 bg-current/10 ${toneClass[record.tone].icon}`}>{recordChannel(record) === "VOICE" ? <Mic className="size-[18px]" /> : recordChannel(record) === "EMAIL" ? <Mail className="size-[18px]" /> : <MessageSquareText className="size-[18px]" />}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="truncate text-sm font-semibold text-slate-100">{record.title}</span><Badge tone={record.tone}>{record.status}</Badge></div><p className="mt-1 truncate font-mono text-[10px] text-slate-600">{record.id} · {typeLabel(record.recordType)} · {channelLabel(recordChannel(record))}</p></div><ChevronRight className={`mt-1 size-4 transition ${selected?.id === record.id ? "text-lime-200" : "text-slate-700 group-hover:text-lime-200"}`} /></div><div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-600"><span>{recordAudience(record)}</span>{textValue(record.payload?.jobCode) && <span>{textValue(record.payload?.jobCode)}</span>}<span>{formatDate(record.createdAt)}</span>{boolValue(record.payload?.requiresAcknowledgement) && <span className="text-amber-100">ack richiesto</span>}</div></button>)}{!loading && filteredRecords.length === 0 && <div className="rounded-2xl border border-dashed border-white/10 p-10 text-center"><MessageSquareText className="mx-auto size-7 text-slate-700" /><p className="mt-3 text-xs text-slate-500">Nessuna comunicazione corrisponde ai filtri.</p><p className="mt-1 text-[10px] text-slate-700">Il registro non crea messaggi demo.</p></div>}{loading && <p className="py-10 text-center text-xs text-slate-600">Lettura D1 in corso…</p>}</div></Panel><Panel className="border-lime-300/15"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-lime-300/70">MESSAGE INSPECTOR</p><h2 className="mt-1 text-base font-semibold">Dettaglio e confine</h2></div><FileCheck2 className="size-4 text-lime-200" /></div>{selected ? <div className="mt-5 space-y-4"><div><div className="flex flex-wrap items-center gap-2"><p className="break-words text-sm font-semibold text-slate-100">{selected.title}</p><Badge tone={selected.tone}>{selected.status}</Badge></div><p className="mt-1 font-mono text-[10px] text-slate-600">{selected.id} · creato {formatDate(selected.createdAt)}</p></div><div className="grid grid-cols-2 gap-2"><div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">Canale</p><p className="mt-1 text-sm text-slate-100">{channelLabel(recordChannel(selected))}</p></div><div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">Audience</p><p className="mt-1 text-sm text-lime-100">{recordAudience(selected)}</p></div></div><div className="rounded-xl border border-white/[.07] bg-black/20 p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">Messaggio</p><p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-300">{selected.detail}</p></div>{textValue(selected.payload?.jobCode) && <div className="rounded-xl border border-lime-300/15 bg-lime-300/[.035] p-3"><p className="text-[9px] uppercase tracking-[.14em] text-lime-300/70">COMMESSA COLLEGATA</p><p className="mt-2 text-xs font-semibold text-lime-100">{textValue(selected.payload?.jobCode)}</p><p className="mt-1 text-[10px] text-slate-600">{textValue(selected.payload?.jobTitle)}</p></div>}<div className="rounded-xl border border-amber-300/15 bg-amber-300/[.035] p-3"><p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.14em] text-amber-100"><CircleAlert className="size-3.5" />Delivery state</p><p className="mt-2 text-[11px] leading-5 text-slate-500">{textValue(selected.payload?.providerStatus, "SITES_READBACK_ONLY")} · {textValue(selected.payload?.deliveryStatus, "PENDING_EXTERNAL_CONSUMER")}</p><p className="mt-2 text-[10px] text-slate-600">Sites certifica il record; non dichiara consegna a push, email o telephony.</p></div><div className="flex flex-wrap gap-2"><Button className="h-9 border-lime-300/20 bg-lime-300/[.05] text-[10px] text-lime-100 hover:bg-lime-300/[.12]" onClick={() => openComposer(selected.recordType === "VOICE_PROPOSAL" ? "VOICE_PROPOSAL" : "ACK_REQUEST")} variant="outline"><Plus className="size-3.5" />Crea follow-up</Button>{boolValue(selected.payload?.requiresAcknowledgement) && <Button className="h-9 border-amber-300/20 bg-amber-300/[.05] text-[10px] text-amber-100 hover:bg-amber-300/[.12]" onClick={() => setView("acknowledgements")} variant="outline"><CheckCircle2 className="size-3.5" />Vedi ack</Button>}</div></div> : <div className="py-12 text-center text-xs text-slate-600">Seleziona un messaggio da ispezionare.</div>}</Panel></div>}

        {view === "compose" && <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,.9fr)]"><Panel className="border-lime-300/20"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-lime-300/70">S05 / COMMUNICATION PROPOSAL</p><h2 className="mt-1 text-lg font-semibold">Nuova comunicazione governata</h2><p className="mt-1 text-[11px] leading-5 text-slate-500">La proposta viene salvata nel tenant, emette evento/outbox e resta in attesa del consumer autorizzato.</p></div><Button className="h-8 border-white/10 bg-transparent text-[10px] text-slate-500 hover:text-slate-200" onClick={() => setView("inbox")} variant="outline"><X className="size-3.5" />Chiudi</Button></div><form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={createProposal}><label className="text-xs text-slate-400">Tipo comunicazione<select aria-label="Tipo comunicazione" className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-slate-100 outline-none focus:border-lime-300/40" onChange={(event) => { const next = event.target.value as CommunicationType; updateForm("recordType", next); if (next === "VOICE_PROPOSAL") updateForm("channel", "VOICE"); }} value={form.recordType}><option value="SHIFT_BRIEFING">Briefing turno</option><option value="TEAM_BROADCAST">Broadcast operativo</option><option value="ACK_REQUEST">Richiesta acknowledgment</option><option value="VOICE_PROPOSAL">Proposta voice</option></select></label><label className="text-xs text-slate-400">Canale<select aria-label="Canale comunicazione" className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-slate-100 outline-none focus:border-lime-300/40" onChange={(event) => { const next = event.target.value as Channel; updateForm("channel", next); if (next === "VOICE") updateForm("requiresAcknowledgement", true); }} value={form.channel}><option value="IN_APP">In-app</option><option value="PUSH">Push · provider deferred</option><option value="EMAIL">Email · provider deferred</option><option value="VOICE">Voice · consent + provider</option></select></label><label className="text-xs text-slate-400">Audience<select aria-label="Audience comunicazione" className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-slate-100 outline-none focus:border-lime-300/40" onChange={(event) => updateForm("audienceType", event.target.value as AudienceType)} value={form.audienceType}><option value="TENANT">Tenant corrente</option><option value="TEAM">Team / reparto</option><option value="ROLE">Ruolo operativo</option><option value="JOB">Commessa reale</option></select></label><label className="text-xs text-slate-400">Riferimento audience<Input className="mt-2 border-white/10 bg-black/30" disabled={form.audienceType === "JOB"} onChange={(event) => updateForm("audienceRef", event.target.value)} placeholder={form.audienceType === "JOB" ? "Usa il selettore commessa" : "Team Alpha, autisti, capi squadra…"} value={form.audienceRef} /></label>{form.audienceType === "JOB" && <label className="text-xs text-slate-400 sm:col-span-2">Commessa collegata<select aria-label="Commessa reale" className="mt-2 h-11 w-full rounded-xl border border-lime-300/20 bg-black/30 px-3 text-xs text-slate-100 outline-none focus:border-lime-300/45" disabled={!canReadJobs} onChange={(event) => updateForm("jobId", event.target.value)} value={form.jobId}><option value="">Seleziona dal registro Operations</option>{jobs.map((job) => <option key={job.id} value={job.id}>{job.canonicalCode ?? job.id} · {job.title}</option>)}</select><span className="mt-1 block text-[10px] text-slate-600">Il server rivalida l’ID nel tenant prima di persistere la proposta.</span></label>}<label className="text-xs text-slate-400 sm:col-span-2">Titolo<Input className="mt-2 border-white/10 bg-black/30" onChange={(event) => updateForm("title", event.target.value)} placeholder="Es. Briefing apertura cantiere" value={form.title} required /></label><label className="text-xs text-slate-400 sm:col-span-2">Messaggio / brief operativo<textarea className="mt-2 min-h-32 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-lime-300/40" onChange={(event) => updateForm("detail", event.target.value)} placeholder="Scrivi il contenuto operativo, massimo 300 caratteri…" value={form.detail} required /></label><label className="flex items-center gap-3 rounded-xl border border-white/[.08] bg-black/20 p-3 text-xs text-slate-300 sm:col-span-2"><input checked={form.requiresAcknowledgement} className="size-4 accent-lime-300" disabled={form.channel === "VOICE"} onChange={(event) => updateForm("requiresAcknowledgement", event.target.checked)} type="checkbox" />Richiedi acknowledgment<span className="ml-auto text-[10px] text-slate-600">{form.channel === "VOICE" ? "obbligatorio per voice" : "inbound status provider"}</span></label><div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-2"><p className="text-[10px] leading-4 text-slate-600">Actor, tenant, timestamp, event e idempotency restano server-owned.</p><Button className="h-10 bg-lime-300 px-4 text-xs font-semibold text-[#050705] hover:bg-lime-200" disabled={saving || !canSend} type="submit">{saving ? <RefreshCw className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}{saving ? "Registrazione…" : "Registra proposta e rileggi"}</Button></div></form></Panel><div className="space-y-4"><Panel className="border-amber-300/15"><div className="flex items-center gap-2 text-amber-100"><ShieldCheck className="size-4" /><h2 className="text-sm font-semibold">Confine operativo</h2></div><ul className="mt-4 space-y-2 text-[10px] leading-5 text-slate-500"><li>• In-app: readback Sites verificato.</li><li>• Push/email: proposta registrata, consumer provider deferred.</li><li>• Voice: consenso esplicito, credenziale effimera e connector ancora deferred.</li><li>• Commessa: selezione canonica, validazione tenant server-side.</li></ul></Panel><Panel><div className="flex items-center gap-2 text-lime-100"><Clock3 className="size-4" /><h2 className="text-sm font-semibold">Stati distinguibili</h2></div><div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-1"><Badge tone="amber">DRAFT</Badge><Badge tone="amber">PENDING_EXTERNAL_CONSUMER</Badge><Badge tone="cyan">SITES_READBACK_ONLY</Badge><Badge tone="amber">EXTERNAL_DEFERRED</Badge></div></Panel></div></div>}

        {view === "acknowledgements" && <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,.85fr)]"><Panel><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-lime-300/70">ACKNOWLEDGEMENT CONTROL</p><h2 className="mt-1 text-lg font-semibold">Conferme operative</h2><p className="mt-1 text-[11px] leading-5 text-slate-500">Richieste e stati riletti dal ledger Sites. La conferma inbound non viene inventata finché il provider non consegna evidenza.</p></div><span className="rounded-full border border-amber-300/20 bg-amber-300/[.05] px-2.5 py-1.5 text-[10px] text-amber-100">{pendingAcknowledgements.length} OPEN</span></div><div className="mt-4 space-y-2">{acknowledgementRecords.map((record) => <button className={`w-full rounded-2xl border p-4 text-left transition ${selected?.id === record.id ? "border-lime-300/35 bg-lime-300/[.06]" : "border-white/[.07] bg-black/20 hover:border-lime-300/25"}`} key={record.id} onClick={() => { setSelectedId(record.id); setView("inbox"); }} type="button"><div className="flex items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-xl border border-amber-300/20 bg-amber-300/10 text-amber-100"><CheckCircle2 className="size-4" /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-semibold text-slate-100">{record.title}</p><Badge tone={statusTone(record.status)}>{record.status}</Badge></div><p className="mt-1 text-[10px] text-slate-600">{record.id} · {recordAudience(record)} · {channelLabel(recordChannel(record))}</p><p className="mt-3 line-clamp-2 text-[11px] leading-5 text-slate-500">{record.detail}</p></div><ChevronRight className="mt-1 size-4 text-slate-700" /></div></button>)}{acknowledgementRecords.length === 0 && <div className="rounded-2xl border border-dashed border-white/10 p-10 text-center"><CheckCircle2 className="mx-auto size-7 text-slate-700" /><p className="mt-3 text-xs text-slate-500">Nessuna richiesta di acknowledgment nel tenant.</p><p className="mt-1 text-[10px] text-slate-700">Le richieste vengono create dalla proposta comunicazione.</p></div>}</div></Panel><Panel className="border-amber-300/15"><div className="flex items-center gap-2 text-amber-100"><CircleAlert className="size-4" /><h2 className="text-sm font-semibold">Provider inbound</h2></div><p className="mt-4 text-xs leading-6 text-slate-500">Il modulo conserva la richiesta, il destinatario e lo stato osservato. Non espone un pulsante “confermato” locale: l’ack deve arrivare da un canale autenticato e firmato, con correlazione all’idempotency key.</p><div className="mt-5 space-y-2 text-[10px]"><div className="flex items-center justify-between rounded-xl border border-white/[.07] bg-black/20 px-3 py-2.5"><span className="text-slate-500">Sites ledger</span><span className="text-lime-100">READBACK</span></div><div className="flex items-center justify-between rounded-xl border border-white/[.07] bg-black/20 px-3 py-2.5"><span className="text-slate-500">Firma webhook</span><span className="text-amber-100">NOT CONFIGURED</span></div><div className="flex items-center justify-between rounded-xl border border-white/[.07] bg-black/20 px-3 py-2.5"><span className="text-slate-500">Delivery provider</span><span className="text-amber-100">DEFERRED</span></div></div><Button className="mt-5 h-9 w-full border-lime-300/20 bg-lime-300/[.05] text-[10px] text-lime-100 hover:bg-lime-300/[.12]" onClick={() => setView("compose")} variant="outline"><Plus className="size-3.5" />Crea richiesta ack</Button></Panel></div>}

        {view === "voice" && <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,.9fr)]"><Panel className="border-amber-300/15"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-amber-200/75">VOICE / TELEPHONY BOUNDARY</p><h2 className="mt-1 text-lg font-semibold">Voice senza scorciatoie</h2><p className="mt-1 max-w-2xl text-[11px] leading-5 text-slate-500">La piattaforma prepara una proposta strutturata. Identità chiamante, consenso, transcript e handoff verso Company AI richiedono un adapter autorizzato.</p></div><Badge tone="amber">{voiceAdapter?.effectiveStatus ?? voiceAdapter?.status ?? "NOT OBSERVED"}</Badge></div><div className="mt-5 grid gap-3 sm:grid-cols-2"><div className="carbon-inset rounded-xl p-4"><div className="flex items-center gap-2 text-amber-100"><Mic className="size-4" /><p className="text-xs font-semibold">Connector voice</p></div><p className="mt-3 text-[11px] leading-5 text-slate-500">{voiceAdapter?.contract ?? "Voice / telephony adapter non rilevato nel readback corrente."}</p><p className="mt-3 font-mono text-[10px] text-amber-100">{voiceAdapter?.nextAction ?? "Definire consenso e identità prima del connector"}</p></div><div className="carbon-inset rounded-xl p-4"><div className="flex items-center gap-2 text-lime-100"><ShieldCheck className="size-4" /><p className="text-xs font-semibold">Guardrail</p></div><ul className="mt-3 space-y-2 text-[10px] leading-5 text-slate-500"><li>• opt-in e consenso prima della connessione;</li><li>• credenziale effimera, mai nel ledger;</li><li>• transcript minimizzato e retention governata;</li><li>• comando voice → proposta, mai write implicita.</li></ul></div></div><div className="mt-5 rounded-xl border border-amber-300/20 bg-amber-300/[.04] p-4"><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.15em] text-amber-100"><Volume2 className="size-3.5" />Stato reale</div><p className="mt-2 text-[11px] leading-5 text-slate-500">Il catalogo adapter dichiara il confine, ma non certifica health, telephony o una chiamata. Questa pagina non apre microfono, non invia audio e non simula transcript.</p></div><Button className="mt-5 h-10 bg-lime-300 px-4 text-xs font-semibold text-[#050705] hover:bg-lime-200" disabled={!canSend} onClick={() => openComposer("VOICE_PROPOSAL")}><Mic className="size-3.5" />Prepara proposta voice</Button></Panel><Panel><div className="flex items-center gap-2 text-lime-100"><FileCheck2 className="size-4" /><h2 className="text-sm font-semibold">Proposte voice registrate</h2></div><div className="mt-4 space-y-2">{voiceRecords.slice(0, 8).map((record) => <button className="w-full rounded-xl border border-white/[.07] bg-black/20 p-3 text-left transition hover:border-lime-300/25" key={record.id} onClick={() => { setSelectedId(record.id); setView("inbox"); }} type="button"><div className="flex items-center justify-between gap-2"><span className="truncate text-xs font-semibold text-slate-200">{record.title}</span><Badge tone="amber">{record.status}</Badge></div><p className="mt-1 truncate text-[10px] text-slate-600">{record.id} · {formatDate(record.createdAt)}</p></button>)}{voiceRecords.length === 0 && <div className="rounded-xl border border-dashed border-white/10 p-8 text-center"><Mic className="mx-auto size-7 text-slate-700" /><p className="mt-3 text-xs text-slate-500">Nessuna proposta voice</p><p className="mt-1 text-[10px] text-slate-700">Il provider non viene contattato da questa sezione.</p></div>}</div></Panel></div>}

        <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/[.08] py-5 text-[10px] text-slate-600"><button className="flex items-center gap-2 transition hover:text-lime-200" onClick={() => navigate("/command")} type="button"><ArrowLeft className="size-3.5" />Torna a Command</button><span>AI-ZEROW COMMAND · W13 / COMMUNICATIONS CONTROL</span><span className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-lime-300" />tenant scoped · no raw audio · external delivery deferred</span></footer>
      </div>
    </section>
  </div><CommandMobileNav active="communications" allowedNavigation={allowedMobileNavigation} role={context.role} roles={context.roles} />{toast ? <button aria-label="Chiudi messaggio" className="fixed bottom-5 right-5 z-50 flex max-w-[380px] items-center gap-3 rounded-xl border border-lime-300/25 bg-[#0a100c]/95 px-4 py-3 text-left text-xs text-lime-100 shadow-[0_0_28px_rgba(190,255,60,.14)] backdrop-blur-xl" onClick={() => setToast("")} type="button">{toast}<X className="size-3.5 shrink-0" /></button> : null}</main>;
}
