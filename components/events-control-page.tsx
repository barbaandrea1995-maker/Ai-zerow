"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bell,
  BriefcaseBusiness,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  Database,
  ExternalLink,
  FileCheck2,
  FileClock,
  FileText,
  GitBranch,
  Layers3,
  LoaderCircle,
  LockKeyhole,
  Menu,
  MessageSquareText,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
  Sparkles,
  Truck,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { AccountMenu } from "@/components/account-menu";
import { CommandMobileNav } from "@/components/command-mobile-nav";
import { TenantSwitcher } from "@/components/tenant-switcher";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getAllowedCommandNavigation, type CommandNavigationId } from "@/lib/command-dashboard";

type EventRow = {
  eventId: string;
  eventType: string;
  schemaVersion: string;
  actorType: string;
  actorId: string;
  source: string;
  occurredAt: string;
  observedAt: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  payload: Record<string, unknown>;
  correlationId: string;
  causationId: string | null;
  idempotencyKey: string;
  status: string;
  createdAt: string;
};

type OutboxRow = {
  id: string;
  eventId: string;
  topic: string;
  status: string;
  attempts: number;
  lastError?: string | null;
  createdAt: string;
  updatedAt: string;
};

type ReconciliationRow = {
  id: string;
  aggregateType: string;
  aggregateId: string;
  expectedVersion: number;
  observedVersion: number;
  status: string;
  detail: string;
  createdAt: string;
  updatedAt: string;
};

type LedgerRow = {
  id: string;
  entryType: string;
  actionType: string;
  command: string;
  status: string;
  approvalRequired: boolean;
  relatedActionId: string | null;
  payload: Record<string, unknown>;
  requestedBy: string;
  approvedBy: string | null;
  readback: Record<string, unknown>;
  createdAt: string;
};

type EventsPayload = {
  context?: {
    actorName?: string;
    actorEmail?: string;
    role?: string;
    capabilities?: string[];
    tenantId?: string;
  };
  contract?: {
    tranche?: string;
    externalConsumer?: string;
    readback?: string;
  };
  events?: EventRow[];
  outbox?: OutboxRow[];
  reconciliations?: ReconciliationRow[];
  readback?: { status?: string; checkedAt?: string; counts?: { events?: number; outbox?: number; reconciliations?: number } };
  error?: string;
};

type LedgerPayload = { ledger?: LedgerRow[]; readback?: { status?: string; count?: number; checkedAt?: string } };
type OutboxAction = "retry" | "dead_letter" | "requeue" | "block";
type ViewId = "events" | "outbox" | "twin" | "ledger";
type NavItem = { id: CommandNavigationId; label: string; path: string; capability: string; icon: LucideIcon };

const navItems: NavItem[] = [
  { id: "command", label: "CONTROL", path: "/command", capability: "command.read", icon: MessageSquareText },
  { id: "operations", label: "OPERATIONS", path: "/operations", capability: "operations.read", icon: BriefcaseBusiness },
  { id: "workforce", label: "WORKFORCE", path: "/workforce", capability: "workforce.read", icon: Users },
  { id: "planning", label: "PIANIFICAZIONE", path: "/planning", capability: "planning.read", icon: Clock3 },
  { id: "attendance", label: "PRESENZE", path: "/presenze", capability: "workforce.read", icon: Clock3 },
  { id: "assets", label: "ASSET", path: "/assets", capability: "asset.read", icon: Layers3 },
  { id: "warehouse", label: "MAGAZZINO", path: "/warehouse", capability: "warehouse.read", icon: Layers3 },
  { id: "mission", label: "MISSIONI", path: "/mission", capability: "mission.read", icon: Truck },
  { id: "documents", label: "DOCUMENTI", path: "/documents", capability: "documents.read", icon: FileText },
  { id: "finance", label: "FINANCE", path: "/finance", capability: "finance.read", icon: FileCheck2 },
  { id: "procurement", label: "PROCUREMENT", path: "/procurement", capability: "procurement.read", icon: ShoppingCart },
  { id: "authority", label: "AUTHORITY", path: "/onboarding", capability: "authority.read", icon: ShieldCheck },
  { id: "governance", label: "GOVERNANCE", path: "/governance", capability: "governance.read", icon: ShieldCheck },
  { id: "communications", label: "COMUNICAZIONI", path: "/communications", capability: "communication.read", icon: Bell },
  { id: "events", label: "EVENTI", path: "/events", capability: "events.read", icon: Activity },
  { id: "externals", label: "ADAPTER", path: "/externals", capability: "external_adapters.read", icon: Network },
  { id: "settings", label: "IMPOSTAZIONI", path: "/settings", capability: "settings.read", icon: SlidersHorizontal },
];

const eventTemplates = [
  { value: "operation.signal", label: "Segnale operativo", aggregate: "operations" },
  { value: "workforce.attendance.observed", label: "Presenza osservata", aggregate: "workforce" },
  { value: "warehouse.movement.recorded", label: "Movimento magazzino", aggregate: "warehouse" },
  { value: "mission.status.changed", label: "Stato missione", aggregate: "mission" },
  { value: "document.security.changed", label: "Sicurezza documento", aggregate: "documents" },
  { value: "finance.workflow.changed", label: "Workflow finance", aggregate: "finance" },
  { value: "procurement.workflow.changed", label: "Workflow procurement", aggregate: "procurement" },
  { value: "command.audit.note", label: "Nota di audit", aggregate: "command" },
] as const;

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Amministratore",
  manager: "Manager",
  office: "Ufficio",
  technical: "Tecnico",
  auditor: "Auditor",
  field_supervisor: "Caposquadra",
  worker: "Operatore",
  warehouse_manager: "Responsabile magazzino",
  warehouse_operator: "Magazziniere",
  driver: "Autista",
  maintenance: "Manutenzione",
};

const viewItems: Array<{ id: ViewId; label: string; detail: string; icon: LucideIcon }> = [
  { id: "events", label: "Event stream", detail: "Timeline append-only", icon: Activity },
  { id: "outbox", label: "Outbox control", detail: "Retry e DLQ", icon: Send },
  { id: "twin", label: "Twin read model", detail: "Aggregati osservati", icon: Database },
  { id: "ledger", label: "Command ledger", detail: "AI e approval", icon: FileClock },
];

function cn(...values: Array<string | false | null | undefined>) { return values.filter(Boolean).join(" "); }
function roleLabel(role: string) { return ROLE_LABELS[role] ?? role; }

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
}

function prettyJson(value: unknown) {
  try { return JSON.stringify(value ?? {}, null, 2); } catch { return "{}"; }
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    COMMITTED_SITES_READBACK: "COMMIT SITES",
    PENDING_EXTERNAL_CONSUMER: "IN ATTESA CONSUMER",
    FAILED_RETRYABLE: "RETRY DISPONIBILE",
    FAILED_PERMANENT: "ERRORE PERMANENTE",
    RECONCILE_REQUIRED: "RICONCILIAZIONE",
    BLOCKED_EXTERNAL_CONSUMER: "BLOCCATO",
    DEAD_LETTERED: "DLQ",
    DELIVERED: "CONSEGNATO",
    SITES_READBACK_VERIFIED: "READBACK VERIFICATO",
    SITES_LEDGER_VERIFIED: "LEDGER VERIFICATO",
    PREVIEW_ONLY: "PREVIEW",
    PENDING_APPROVAL: "IN APPROVAZIONE",
    APPROVED_PENDING_EXTERNAL_EXECUTION: "APPROVATO · EXECUTOR ESTERNO",
    REJECTED: "RIFIUTATO",
  };
  return labels[status] ?? status.replaceAll("_", " ");
}

function statusTone(status: string) {
  if (/DEAD|BLOCKED|FAILED|REJECTED/.test(status)) return "red";
  if (/PENDING|RECONCILE|APPROVAL|EXTERNAL/.test(status)) return "amber";
  if (/DELIVERED|VERIFIED|COMMITTED|APPROVED/.test(status)) return "lime";
  return "cyan";
}

const toneStyles: Record<string, { badge: string; icon: string }> = {
  lime: { badge: "border-lime-300/25 bg-lime-300/10 text-lime-100", icon: "text-lime-200" },
  amber: { badge: "border-amber-300/25 bg-amber-300/10 text-amber-100", icon: "text-amber-200" },
  red: { badge: "border-rose-300/25 bg-rose-300/10 text-rose-100", icon: "text-rose-200" },
  cyan: { badge: "border-cyan-300/25 bg-cyan-300/10 text-cyan-100", icon: "text-cyan-200" },
};

function IconButton({ label, children, onClick, className = "" }: { label: string; children: ReactNode; onClick?: () => void; className?: string }) {
  return <button aria-label={label} className={cn("grid size-10 place-items-center rounded-xl border border-white/10 bg-black/25 text-slate-500 transition hover:border-lime-300/35 hover:bg-lime-300/10 hover:text-lime-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300", className)} onClick={onClick} type="button">{children}</button>;
}

function KpiCard({ label, value, detail, icon: Icon, tone = "lime" }: { label: string; value: string | number; detail: string; icon: LucideIcon; tone?: string }) {
  const styles = toneStyles[tone] ?? toneStyles.lime;
  return <article className="carbon-card rounded-2xl p-4 transition duration-200 hover:-translate-y-0.5 hover:border-lime-300/20"><div className="flex items-start justify-between gap-3"><span className={cn("grid size-10 place-items-center rounded-xl border border-current/20 bg-current/10", styles.icon)}><Icon className="size-[18px]" /></span><span className={cn("rounded-full border px-2 py-1 text-[9px] font-semibold uppercase tracking-[.08em]", styles.badge)}>{detail}</span></div><p className="mt-5 text-xs text-slate-500">{label}</p><p className="mt-1 font-mono text-[28px] font-semibold leading-none tracking-[-.06em] text-slate-50">{value}</p></article>;
}

function EventCard({ row, selected, onSelect }: { row: EventRow; selected: boolean; onSelect: () => void }) {
  const styles = toneStyles[statusTone(row.status)] ?? toneStyles.cyan;
  return <button className={cn("group w-full rounded-2xl border p-4 text-left transition", selected ? "border-lime-300/35 bg-lime-300/[.065] shadow-[0_0_24px_rgba(200,255,34,.07)]" : "border-white/[.07] bg-black/20 hover:border-lime-300/25 hover:bg-lime-300/[.03]")} onClick={onSelect} type="button"><div className="flex items-start gap-3"><span className={cn("grid size-10 shrink-0 place-items-center rounded-xl border border-current/20 bg-current/10", styles.icon)}><Activity className="size-[18px]" /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="truncate text-sm font-semibold text-slate-100">{row.eventType}</span><span className={cn("rounded-full border px-2 py-1 text-[9px] font-semibold uppercase tracking-[.05em]", styles.badge)}>{statusLabel(row.status)}</span></div><p className="mt-1 truncate font-mono text-[10px] text-slate-600">{row.aggregateType}/{row.aggregateId} · v{row.aggregateVersion}</p></div><ChevronRight className={cn("mt-1 size-4 text-slate-700 transition group-hover:text-lime-200", selected && "text-lime-200")} /></div><div className="mt-3 flex items-center justify-between gap-3 text-[10px] text-slate-600"><span>{formatDate(row.occurredAt)}</span><span className="truncate font-mono text-cyan-200/60">{row.idempotencyKey}</span></div></button>;
}

function OutboxCard({ row, busy, onAction }: { row: OutboxRow; busy: boolean; onAction: (action: OutboxAction) => void }) {
  const pendingControl = ["PENDING_EXTERNAL_CONSUMER", "FAILED_RETRYABLE", "RECONCILE_REQUIRED"].includes(row.status);
  const requeueControl = ["DEAD_LETTERED", "FAILED_PERMANENT", "BLOCKED_EXTERNAL_CONSUMER", "RECONCILE_REQUIRED"].includes(row.status);
  const styles = toneStyles[statusTone(row.status)] ?? toneStyles.amber;
  return <article className="carbon-card rounded-2xl p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-3"><span className={cn("grid size-10 shrink-0 place-items-center rounded-xl border border-current/20 bg-current/10", styles.icon)}><Send className="size-[18px]" /></span><div className="min-w-0"><p className="truncate font-mono text-xs text-slate-200">{row.topic}</p><p className="mt-1 text-[10px] text-slate-600">Evento {row.eventId.slice(0, 12)} · ultimo controllo {formatDate(row.updatedAt)}</p></div></div><span className={cn("rounded-full border px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[.06em]", styles.badge)}>{statusLabel(row.status)}</span></div><div className="mt-4 grid gap-2 sm:grid-cols-3"><div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">Tentativi</p><p className="mt-1 font-mono text-lg text-slate-100">{row.attempts} <span className="text-[10px] text-slate-600">/ 5</span></p></div><div className="carbon-inset rounded-xl p-3 sm:col-span-2"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">Confine</p><p className="mt-1 text-[10px] leading-4 text-amber-100/75">Nessuna consegna esterna viene dichiarata senza consumer autorizzato.</p></div></div>{row.lastError && <p className="mt-3 rounded-xl border border-amber-300/15 bg-amber-300/[.04] p-3 text-[10px] leading-5 text-amber-100/80">{row.lastError}</p>}{row.status !== "DELIVERED" && <div className="mt-4 flex flex-wrap gap-2"><Button className="h-9 border-lime-300/20 bg-lime-300/[.05] text-[10px] text-lime-100 hover:bg-lime-300/10" disabled={busy || !pendingControl} onClick={() => onAction("retry")} variant="outline"><RefreshCw className="size-3.5" />Retry</Button><Button className="h-9 border-cyan-300/20 bg-cyan-300/[.05] text-[10px] text-cyan-100 hover:bg-cyan-300/10" disabled={busy || !requeueControl} onClick={() => onAction("requeue")} variant="outline"><ArrowRight className="size-3.5" />Requeue</Button><Button className="h-9 border-amber-300/20 bg-amber-300/[.05] text-[10px] text-amber-100 hover:bg-amber-300/10" disabled={busy || !pendingControl} onClick={() => onAction("block")} variant="outline"><LockKeyhole className="size-3.5" />Blocca</Button><Button className="h-9 border-rose-300/20 bg-rose-300/[.05] text-[10px] text-rose-100 hover:bg-rose-300/10" disabled={busy} onClick={() => onAction("dead_letter")} variant="outline"><CircleAlert className="size-3.5" />Sposta in DLQ</Button></div>}</article>;
}

function TwinReadModel({ events, outbox, reconciliations }: { events: EventRow[]; outbox: OutboxRow[]; reconciliations: ReconciliationRow[] }) {
  const aggregateMap = new Map<string, { type: string; id: string; latest: number; eventCount: number; lastEvent: string; outboxPending: number; reconciliation: string }>();
  for (const event of events) {
    const key = `${event.aggregateType}:${event.aggregateId}`;
    const current = aggregateMap.get(key) ?? { type: event.aggregateType, id: event.aggregateId, latest: 0, eventCount: 0, lastEvent: event.occurredAt, outboxPending: 0, reconciliation: "—" };
    current.latest = Math.max(current.latest, event.aggregateVersion);
    current.eventCount += 1;
    if (new Date(event.occurredAt).getTime() >= new Date(current.lastEvent).getTime()) current.lastEvent = event.occurredAt;
    aggregateMap.set(key, current);
  }
  for (const item of outbox) {
    const event = events.find((candidate) => candidate.eventId === item.eventId);
    if (!event || item.status === "DELIVERED") continue;
    const current = aggregateMap.get(`${event.aggregateType}:${event.aggregateId}`);
    if (current) current.outboxPending += 1;
  }
  for (const row of reconciliations) {
    const current = aggregateMap.get(`${row.aggregateType}:${row.aggregateId}`);
    if (current) current.reconciliation = row.status;
  }
  const aggregates = Array.from(aggregateMap.values()).sort((a, b) => new Date(b.lastEvent).getTime() - new Date(a.lastEvent).getTime());
  return <section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-lime-300/70">W11 / COMPANY TWIN</p><h2 className="mt-1 text-base font-semibold text-slate-100">Read model degli aggregati</h2><p className="mt-1 text-[11px] text-slate-500">Vista derivata dal ledger Sites: osserva eventi, versioni e delivery boundary senza sostituire il dominio canonico.</p></div><span className="rounded-full border border-cyan-300/20 bg-cyan-300/[.06] px-2.5 py-1.5 font-mono text-[9px] text-cyan-100">{aggregates.length} AGGREGATI OSSERVATI</span></div><div className="mt-5 grid gap-3 sm:grid-cols-3"><KpiCard label="Aggregati" value={aggregates.length} detail="read model" icon={Database} tone="cyan" /><KpiCard label="Versione massima" value={aggregates.reduce((max, row) => Math.max(max, row.latest), 0)} detail="observed" icon={GitBranch} tone="lime" /><KpiCard label="Delivery in attesa" value={aggregates.reduce((sum, row) => sum + row.outboxPending, 0)} detail="external gate" icon={Send} tone="amber" /></div><div className="mt-5 space-y-2">{aggregates.map((row) => <div className="grid gap-3 rounded-2xl border border-white/[.07] bg-black/20 p-4 md:grid-cols-[minmax(0,1.2fr)_110px_110px_150px] md:items-center" key={`${row.type}:${row.id}`}><div className="min-w-0"><div className="flex items-center gap-2"><span className="grid size-8 place-items-center rounded-lg border border-lime-300/20 bg-lime-300/10 text-lime-200"><Layers3 className="size-4" /></span><div className="min-w-0"><p className="truncate text-xs font-semibold text-slate-100">{row.type}</p><p className="truncate font-mono text-[10px] text-slate-600">{row.id}</p></div></div></div><div><p className="text-[9px] uppercase tracking-[.12em] text-slate-600">Eventi</p><p className="mt-1 font-mono text-sm text-slate-200">{row.eventCount}</p></div><div><p className="text-[9px] uppercase tracking-[.12em] text-slate-600">Versione</p><p className="mt-1 font-mono text-sm text-lime-100">v{row.latest}</p></div><div className="flex items-center justify-between gap-3 md:block"><div><p className="text-[9px] uppercase tracking-[.12em] text-slate-600">Reconciliation</p><p className="mt-1 text-[10px] text-cyan-100">{statusLabel(row.reconciliation)}</p></div>{row.outboxPending > 0 && <span className="mt-2 inline-flex rounded-full border border-amber-300/20 bg-amber-300/[.05] px-2 py-1 text-[9px] text-amber-100">{row.outboxPending} pending</span>}</div></div>)}{aggregates.length === 0 && <div className="carbon-inset rounded-2xl p-10 text-center text-xs text-slate-600">Nessun aggregato osservato nel tenant. Il read model resta vuoto.</div>}</div><div className="mt-5 rounded-2xl border border-amber-300/20 bg-amber-300/[.045] p-4"><p className="flex items-center gap-2 text-xs font-semibold text-amber-100"><AlertTriangle className="size-4" />Confine Company Twin</p><p className="mt-2 text-[11px] leading-5 text-slate-500">Questa è una proiezione locale riletta da D1. Consumer esterno, worker persistente e proiezione Twin canonica non vengono simulati.</p></div></section>;
}

export default function EventsControlPage() {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<EventsPayload>({});
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ViewId>("events");
  const [selectedEventId, setSelectedEventId] = useState("");
  const [selectedLedgerId, setSelectedLedgerId] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState("");
  const [form, setForm] = useState<{ eventType: string; aggregateType: string; aggregateId: string; aggregateVersion: string; idempotencyKey: string; payload: string }>({ eventType: eventTemplates[0].value, aggregateType: eventTemplates[0].aggregate, aggregateId: "", aggregateVersion: "1", idempotencyKey: "", payload: "{\"source\":\"command\"}" });

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/events", { cache: "no-store" });
      const data = await response.json() as EventsPayload;
      if (!response.ok) throw new Error(data.error || "s06_readback_failed");
      setSnapshot(data);
      setSelectedEventId((current) => current && (data.events ?? []).some((row) => row.eventId === current) ? current : data.events?.[0]?.eventId ?? "");
      const canReadLedger = Boolean(data.context?.capabilities?.includes("command.read"));
      if (canReadLedger) {
        const ledgerResponse = await fetch("/api/command/timeline-detail", { cache: "no-store" });
        const ledgerData = await ledgerResponse.json() as LedgerPayload;
        setLedger(ledgerResponse.ok && Array.isArray(ledgerData.ledger) ? ledgerData.ledger : []);
      } else {
        setLedger([]);
      }
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Readback eventi non disponibile");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const capabilities = useMemo(() => snapshot.context?.capabilities ?? [], [snapshot.context?.capabilities]);
  const role = snapshot.context?.role ?? "";
  const canWrite = capabilities.includes("events.write");
  const canCommunicate = capabilities.includes("communication.read");
  const events = useMemo(() => snapshot.events ?? [], [snapshot.events]);
  const outbox = snapshot.outbox ?? [];
  const reconciliations = snapshot.reconciliations ?? [];
  const filteredEvents = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return events;
    return events.filter((row) => [row.eventType, row.aggregateType, row.aggregateId, row.source, row.status, row.idempotencyKey].join(" ").toLowerCase().includes(normalized));
  }, [events, query]);
  const selectedEvent = events.find((row) => row.eventId === selectedEventId) ?? filteredEvents[0] ?? null;
  const filteredLedger = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return ledger;
    return ledger.filter((row) => [row.entryType, row.actionType, row.command, row.status, row.requestedBy].join(" ").toLowerCase().includes(normalized));
  }, [ledger, query]);
  const selectedLedger = ledger.find((row) => row.id === selectedLedgerId) ?? filteredLedger[0] ?? null;
  const pendingOutbox = outbox.filter((row) => row.status !== "DELIVERED");
  const deadLettered = outbox.filter((row) => row.status === "DEAD_LETTERED");
  const aggregateCount = new Set(events.map((row) => `${row.aggregateType}:${row.aggregateId}`)).size;
  const allowedNavigation = useMemo(() => getAllowedCommandNavigation(capabilities).map((item) => item.id), [capabilities]);
  const actor = { name: snapshot.context?.actorName ?? "Operatore", email: snapshot.context?.actorEmail ?? "" };

  async function appendEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canWrite) { setToast("Il ruolo corrente non può scrivere eventi."); return; }
    let payload: Record<string, unknown>;
    try {
      const parsed = JSON.parse(form.payload) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("payload");
      payload = parsed as Record<string, unknown>;
    } catch {
      setToast("Payload JSON non valido.");
      return;
    }
    if (!form.aggregateId.trim()) { setToast("Inserisci l’ID dell’aggregato da osservare."); return; }
    setBusy("append");
    try {
      const idempotencyKey = form.idempotencyKey.trim() || `ui:event:${crypto.randomUUID()}`;
      const response = await fetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ eventType: form.eventType, aggregateType: form.aggregateType, aggregateId: form.aggregateId, aggregateVersion: Number(form.aggregateVersion), idempotencyKey, payload }) });
      const data = await response.json() as EventsPayload & { error?: string };
      if (!response.ok) throw new Error(data.error || "event_append_failed");
      setComposerOpen(false);
      setForm({ ...form, aggregateId: "", idempotencyKey: "" });
      setToast("Evento append-only registrato e rilettura verificata.");
      await load();
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Evento non registrato.");
    } finally {
      setBusy("");
    }
  }

  async function controlOutbox(row: OutboxRow, action: OutboxAction) {
    setBusy(`${row.id}:${action}`);
    try {
      const response = await fetch("/api/events/outbox", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ outboxId: row.id, action, note: "Controllo avviato da W11 Event Authority", idempotencyKey: `ui:outbox:${action}:${row.id}:${crypto.randomUUID()}` }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "outbox_action_failed");
      setToast(`Outbox aggiornato: ${action.replace("_", " ")}.`);
      await load();
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Nessuna transizione outbox confermata.");
    } finally {
      setBusy("");
    }
  }

  return <main className="min-h-screen bg-[#030504] text-slate-100">
<div className="flex min-h-screen">
<aside className={cn("zw-command-sidebar z-40 shrink-0 flex-col border-r border-lime-300/10 bg-[#050806]/95 px-3 py-4 backdrop-blur-xl lg:relative lg:flex", sidebarCollapsed ? "w-[78px]" : "w-[252px]", mobileMenu ? "fixed inset-y-0 left-0 flex w-[280px] shadow-[0_0_60px_rgba(0,0,0,.7)]" : "hidden")}>
<div className={cn("flex items-center gap-3 px-2", sidebarCollapsed && "justify-center px-0")}>
<Link aria-label="Apri Command" className="relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black shadow-[0_0_22px_rgba(200,255,34,.14)]" href="/command">
<Image src="/ai-zerow-icon.jpeg" alt="ZEROW" width={40} height={40} className="size-full object-cover" />
</Link>{!sidebarCollapsed && <Link className="min-w-0" href="/command">
<span className="block truncate text-sm font-bold tracking-[.18em] text-slate-50">AI-ZEROW</span>
<span className="block truncate text-[10px] uppercase tracking-[.2em] text-lime-300/75">event authority</span>
</Link>}<IconButton className="ml-auto hidden lg:grid" label={sidebarCollapsed ? "Espandi sidebar" : "Riduci sidebar"} onClick={() => setSidebarCollapsed((value) => !value)}>{sidebarCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}</IconButton>
<IconButton className="ml-auto lg:hidden" label="Chiudi menu" onClick={() => setMobileMenu(false)}>
<X className="size-4" />
</IconButton>
</div>
<div className={cn("carbon-inset mt-7 rounded-2xl p-3", sidebarCollapsed && "p-2")}>
<div className={cn("flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.13em] text-lime-200", sidebarCollapsed && "justify-center")}>
<span className="grid size-7 place-items-center rounded-lg border border-lime-300/20 bg-lime-300/10">
<Activity className="size-3.5" />
</span>{!sidebarCollapsed && "W11 · CONTROL PLANE"}</div>{!sidebarCollapsed && <p className="mt-3 text-[10px] leading-5 text-slate-600">Eventi, delivery boundary, read model e ledger sotto controllo umano.</p>}</div>
<nav className="mt-7 flex-1 space-y-1 overflow-y-auto">
<p className={cn("px-3 text-[9px] font-semibold uppercase tracking-[.2em] text-slate-600", sidebarCollapsed && "px-0 text-center")}>{sidebarCollapsed ? "·" : "Command modules"}</p>{navItems.filter((nav) => allowedNavigation.includes(nav.id)).map((nav) => { const Icon = nav.icon; const active = nav.id === "events"; return <Link aria-current={active ? "page" : undefined} aria-label={nav.label} className={cn("group flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-[11px] font-medium tracking-[.08em] transition", sidebarCollapsed && "justify-center px-0", active ? "border-lime-300/25 bg-lime-300/[.08] text-lime-100 shadow-[0_0_18px_rgba(200,255,34,.07)]" : "border-transparent text-slate-500 hover:border-white/10 hover:bg-white/[.035] hover:text-slate-100")} href={nav.path} key={nav.id} onClick={() => setMobileMenu(false)}>
<Icon className={cn("size-4 shrink-0", active ? "text-lime-200" : "text-slate-600 group-hover:text-lime-200")} />{!sidebarCollapsed && <span className="truncate">{nav.label}</span>}{active && !sidebarCollapsed && <span className="ml-auto size-1.5 rounded-full bg-lime-300 shadow-[0_0_8px_rgba(200,255,34,.9)]" />}</Link>; })}</nav>
<div className={cn("mt-4 border-t border-white/[.07] pt-4", sidebarCollapsed && "text-center")}>
<div className="flex items-center justify-between px-2 text-[9px] uppercase tracking-[.14em] text-slate-600">
<span>{sidebarCollapsed ? "W11" : "System core"}</span>
<span className="flex items-center gap-1.5 text-lime-200">
<span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_8px_rgba(200,255,34,.8)]" />{sidebarCollapsed ? "" : "D1"}</span>
</div>{!sidebarCollapsed && <div className="carbon-inset mt-3 rounded-xl p-3">
<div className="flex items-center gap-2 text-[10px] text-slate-400">
<Settings2 className="size-3.5 text-lime-300" />{roleLabel(role) || "Accesso verificato"}</div>
<p className="mt-2 font-mono text-[9px] text-slate-600">{events.length} eventi · {pendingOutbox.length} pending</p>
<p className="mt-2 font-mono text-[9px] text-slate-600">Sites · append-only</p>
</div>}</div>
</aside>{mobileMenu && <button aria-label="Chiudi menu laterale" className="fixed inset-0 z-30 bg-black/70 lg:hidden" onClick={() => setMobileMenu(false)} type="button" />}<section className="min-w-0 flex-1">
<header className="zw-command-topbar sticky top-0 z-20 flex h-[72px] items-center gap-3 px-4 sm:gap-5 sm:px-7">
<IconButton className="lg:hidden" label="Apri menu" onClick={() => setMobileMenu(true)}>
<Menu className="size-4" />
</IconButton>
<Link aria-label="Apri Command" className="zw-command-topbar__brand flex shrink-0 items-center gap-2" href="/command">
<span className="relative grid size-9 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black">
<Image src="/ai-zerow-icon.jpeg" alt="ZEROW" width={36} height={36} className="size-full object-cover" />
</span>
<span className="hidden sm:block">
<span className="block text-[11px] font-bold tracking-[.18em] text-slate-50">ZEROW</span>
<span className="block text-[10px] uppercase tracking-[.2em] text-lime-300/75">event authority</span>
</span>
</Link>
<IconButton className="hidden lg:grid" label={sidebarCollapsed ? "Espandi sidebar" : "Riduci sidebar"} onClick={() => setSidebarCollapsed((value) => !value)}>{sidebarCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}</IconButton>
<div className="relative hidden min-w-0 flex-1 justify-center md:flex">
<div className="relative w-full max-w-[540px]">
<Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-600" />
<Input aria-label="Cerca eventi, aggregati e ledger" className="h-10 w-full border-lime-300/10 bg-black/35 pl-10 text-xs text-slate-100 placeholder:text-slate-600" onChange={(event) => setQuery(event.target.value)} placeholder="Cerca eventi, aggregati, topic, approval…" value={query} />
</div>
</div>
<div className="flex min-w-0 flex-1 items-center gap-2 md:hidden">
<span className="truncate text-xs font-semibold tracking-[.14em] text-slate-200">EVENT AUTHORITY</span>
<span className="size-1 rounded-full bg-lime-300" />
</div>
<div className="ml-auto flex min-w-0 items-center gap-2">
<TenantSwitcher />
<span className="hidden items-center gap-2 rounded-full border border-lime-300/20 bg-lime-300/5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[.12em] text-lime-200 sm:flex">
<span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_9px_rgba(200,255,34,.9)]" />{refreshing ? "READING" : "D1 VERIFIED"}</span>
<IconButton label="Torna indietro" onClick={() => router.back()}>
<ArrowLeft className="size-4" />
</IconButton>
<IconButton label="Aggiorna Event Authority" onClick={() => void load()}>
<RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} />
</IconButton>{canCommunicate && <IconButton label="Apri comunicazioni" onClick={() => router.push("/communications")}>
<Bell className="size-4" />
</IconButton>}<AccountMenu actor={actor} />
</div>
</header>
<div className="mx-auto max-w-[1760px] px-4 py-5 pb-28 sm:px-7 sm:py-7 lg:pb-7">
<section className="carbon-card-neon relative overflow-hidden rounded-[26px] p-5 sm:p-7">
<div className="pointer-events-none absolute -right-24 -top-32 size-[360px] rounded-full bg-lime-300/[.08] blur-3xl" />
<div className="pointer-events-none absolute bottom-0 left-1/3 h-24 w-1/2 bg-lime-300/[.05] blur-3xl" />
<div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-center">
<div>
<div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[.2em] text-lime-300/75">
<span className="grid size-6 place-items-center rounded-lg border border-lime-300/25 bg-lime-300/10">
<Activity className="size-3.5" />
</span>AI-ZEROW / W11 / EVENT AUTHORITY<span className="size-1 rounded-full bg-lime-300" />{loading ? "READING" : "READBACK VERIFIED"}</div>
<h1 className="mt-5 max-w-3xl text-[clamp(2.2rem,5.1vw,5rem)] font-bold leading-[.9] tracking-[-.07em] text-slate-50">EVENTS <span className="text-lime-300 drop-shadow-[0_0_22px_rgba(200,255,34,.28)]">UNDER CONTROL.</span>
</h1>
<p className="mt-5 max-w-2xl text-sm leading-6 text-slate-400 sm:text-base">Ledger append-only, delivery boundary e read model Company Twin in un’unica superficie. Ogni fatto resta rileggibile; nessun consumer esterno viene dato per eseguito.</p>
<div className="mt-6 flex flex-wrap gap-2">
<Button className="h-10 bg-lime-300 px-4 text-xs font-semibold text-[#050705] shadow-[0_0_24px_rgba(200,255,34,.18)] hover:bg-lime-200" disabled={!canWrite} onClick={() => setComposerOpen(true)}>
<Plus className="size-3.5" />Nuovo evento</Button>
<Button className="h-10 border-white/10 bg-black/25 text-xs text-slate-300 hover:border-lime-300/30 hover:text-lime-100" onClick={() => setView("twin")} variant="outline">
<Database className="size-3.5" />Apri Twin read model</Button>
<span className="flex h-10 items-center rounded-xl border border-amber-300/20 bg-amber-300/[.04] px-3 text-[10px] text-amber-100/80">
<LockKeyhole className="mr-1.5 size-3.5" />Consumer esterno differito</span>
</div>
</div>
<div className="carbon-inset relative overflow-hidden rounded-2xl p-5">
<div className="absolute -right-8 -top-8 size-32 rounded-full bg-lime-300/[.12] blur-2xl" />
<div className="relative flex items-start gap-3">
<span className="neon-pulse grid size-12 place-items-center rounded-2xl border border-lime-300/40 bg-lime-300 text-[#050705] shadow-[0_0_30px_rgba(200,255,34,.22)]">
<Database className="size-6" />
</span>
<div>
<p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-200/70">COMPANY TWIN</p>
<h2 className="mt-1 text-sm font-semibold text-slate-100">Read model osservato</h2>
<p className="mt-2 text-[11px] leading-5 text-slate-500">{aggregateCount} aggregati · {reconciliations.length} reconciliation · {ledger.length} entry ledger</p>
</div>
</div>
<div className="mt-6 grid grid-cols-2 gap-2">
<div className="rounded-xl border border-white/[.07] bg-black/25 p-3">
<p className="text-[9px] uppercase tracking-[.12em] text-slate-600">Tenant</p>
<p className="mt-2 truncate font-mono text-[10px] text-slate-300">{snapshot.context?.tenantId ?? "—"}</p>
</div>
<div className="rounded-xl border border-white/[.07] bg-black/25 p-3">
<p className="text-[9px] uppercase tracking-[.12em] text-slate-600">Authority</p>
<p className="mt-2 font-mono text-[10px] text-lime-200">{roleLabel(role) || "—"}</p>
</div>
</div>
</div>
</div>
</section>
<section className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
<KpiCard label="Eventi committati" value={events.length} detail="D1 verified" icon={Activity} />
<KpiCard label="Delivery pending" value={pendingOutbox.length} detail="consumer gate" icon={Send} tone="amber" />
<KpiCard label="In DLQ" value={deadLettered.length} detail="recovery" icon={CircleAlert} tone="red" />
<KpiCard label="Reconciliation" value={reconciliations.length} detail="version check" icon={GitBranch} tone="cyan" />
<KpiCard label="Ledger Company AI" value={ledger.length} detail="timeline" icon={FileClock} />
</section>
<section className="mt-5 flex flex-wrap gap-2 rounded-2xl border border-white/[.07] bg-[#080d09]/80 p-2">{viewItems.map((item) => { const Icon = item.icon; const active = view === item.id; return <button aria-pressed={active} className={cn("flex min-h-11 items-center gap-2 rounded-xl border px-3 py-2 text-left transition", active ? "border-lime-300/30 bg-lime-300/10 text-lime-100 shadow-[0_0_18px_rgba(200,255,34,.08)]" : "border-transparent text-slate-500 hover:border-white/10 hover:bg-white/[.035] hover:text-slate-100")} key={item.id} onClick={() => setView(item.id)} type="button">
<Icon className="size-4" />
<span>
<span className="block text-[11px] font-semibold uppercase tracking-[.06em]">{item.label}</span>
<span className="hidden text-[10px] text-slate-600 sm:block">{item.detail}</span>
</span>
</button>; })}</section>{view === "events" && <section className="mt-4 grid gap-4 2xl:grid-cols-[minmax(0,1.14fr)_minmax(360px,.86fr)]">
<section className="carbon-card rounded-2xl p-4 sm:p-5">
<div className="flex flex-wrap items-start justify-between gap-3">
<div>
<p className="text-[10px] font-semibold uppercase tracking-[.2em] text-lime-300/70">EVENT STREAM / TIMELINE</p>
<h2 className="mt-1 text-base font-semibold text-slate-100">Ledger immutabile</h2>
<p className="mt-1 text-[11px] text-slate-500">Ogni riga conserva actor, aggregate, versione, correlazione e idempotenza.</p>
</div>
<span className="rounded-full border border-lime-300/20 bg-lime-300/[.06] px-2.5 py-1.5 font-mono text-[9px] text-lime-200">{filteredEvents.length} / {events.length}</span>
</div>
<div className="mt-4 relative">
<Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-600" />
<Input aria-label="Filtra event stream" className="h-10 border-white/10 bg-black/25 pl-9 text-xs text-slate-100 placeholder:text-slate-600" onChange={(event) => setQuery(event.target.value)} placeholder="Event type, aggregato, source, chiave…" value={query} />
</div>
<div className="mt-4 space-y-2">{filteredEvents.map((row) => <EventCard key={row.eventId} row={row} selected={selectedEvent?.eventId === row.eventId} onSelect={() => setSelectedEventId(row.eventId)} />)}{filteredEvents.length === 0 && <div className="carbon-inset rounded-2xl p-10 text-center">
<Activity className="mx-auto size-8 text-slate-700" />
<p className="mt-3 text-xs text-slate-500">Nessun evento corrisponde ai filtri.</p>
<p className="mt-1 text-[10px] text-slate-700">Il registro resta vuoto senza scritture confermate.</p>
</div>}</div>
</section>
<aside className="carbon-card-neon rounded-2xl p-4 sm:p-5">{selectedEvent ? <>
<div className="flex items-start justify-between gap-3">
<div>
<p className="text-[10px] font-semibold uppercase tracking-[.2em] text-lime-300/70">EVENT INSPECTOR</p>
<h2 className="mt-1 truncate text-base font-semibold text-slate-100">{selectedEvent.eventType}</h2>
<p className="mt-1 font-mono text-[10px] text-slate-600">{selectedEvent.eventId}</p>
</div>
<span className={cn("rounded-full border px-2 py-1 text-[9px] font-semibold uppercase", toneStyles[statusTone(selectedEvent.status)]?.badge)}>{statusLabel(selectedEvent.status)}</span>
</div>
<div className="mt-5 grid grid-cols-2 gap-2">
<div className="carbon-inset rounded-xl p-3">
<p className="text-[9px] uppercase tracking-[.12em] text-slate-600">Aggregate</p>
<p className="mt-2 truncate text-xs text-slate-200">{selectedEvent.aggregateType}</p>
<p className="mt-1 truncate font-mono text-[10px] text-slate-500">{selectedEvent.aggregateId}</p>
</div>
<div className="carbon-inset rounded-xl p-3">
<p className="text-[9px] uppercase tracking-[.12em] text-slate-600">Versione</p>
<p className="mt-2 font-mono text-xl text-lime-100">v{selectedEvent.aggregateVersion}</p>
<p className="mt-1 text-[10px] text-slate-600">schema {selectedEvent.schemaVersion}</p>
</div>
</div>
<dl className="mt-5 space-y-3 text-[10px]">
<div className="flex justify-between gap-3">
<dt className="text-slate-600">Actor</dt>
<dd className="truncate text-slate-300">{selectedEvent.actorType} · {selectedEvent.actorId}</dd>
</div>
<div className="flex justify-between gap-3">
<dt className="text-slate-600">Occurred</dt>
<dd className="text-slate-300">{formatDate(selectedEvent.occurredAt)}</dd>
</div>
<div className="flex justify-between gap-3">
<dt className="text-slate-600">Correlation</dt>
<dd className="truncate font-mono text-cyan-100/75">{selectedEvent.correlationId}</dd>
</div>
<div className="flex justify-between gap-3">
<dt className="text-slate-600">Idempotency</dt>
<dd className="truncate font-mono text-lime-100/75">{selectedEvent.idempotencyKey}</dd>
</div>
</dl>
<div className="mt-5">
<p className="text-[9px] font-semibold uppercase tracking-[.16em] text-slate-600">Payload readback</p>
<pre className="mt-2 max-h-44 overflow-auto rounded-xl border border-white/[.07] bg-black/35 p-3 font-mono text-[10px] leading-5 text-slate-400">{prettyJson(selectedEvent.payload)}</pre>
</div>
<div className="mt-5 flex flex-wrap gap-2">
<button className="flex items-center gap-1.5 text-[10px] text-lime-300 hover:text-lime-100" onClick={() => setView("twin")} type="button">Apri aggregato <ChevronRight className="size-3.5" />
</button>
<button className="flex items-center gap-1.5 text-[10px] text-slate-500 hover:text-lime-200" onClick={() => setView("outbox")} type="button">Apri delivery <ChevronRight className="size-3.5" />
</button>
</div>
</> : <div className="py-16 text-center">
<FileText className="mx-auto size-8 text-slate-700" />
<p className="mt-3 text-xs text-slate-500">Seleziona un evento per ispezionarlo.</p>
</div>}<div className="mt-6 rounded-xl border border-amber-300/20 bg-amber-300/[.045] p-3 text-[10px] leading-5 text-slate-500">
<p className="flex items-center gap-2 text-amber-100">
<LockKeyhole className="size-3.5" />Boundary W11</p>
<p className="mt-2">Sites certifica commit, ledger locale, outbox e readback. Consegna a consumer, worker e Twin canonico restano esterni.</p>
</div>
</aside>
</section>}{view === "outbox" && <section className="mt-4 grid gap-4 2xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,.9fr)]">
<section>
<div className="mb-4 flex items-end justify-between gap-3">
<div>
<p className="text-[10px] font-semibold uppercase tracking-[.2em] text-lime-300/70">DELIVERY / CONTROL</p>
<h2 className="mt-1 text-base font-semibold text-slate-100">Outbox governato</h2>
<p className="mt-1 text-[11px] text-slate-500">Retry budget massimo 5 · nessun pulsante dichiara consegna esterna.</p>
</div>
<span className="rounded-full border border-amber-300/20 bg-amber-300/[.06] px-2.5 py-1.5 font-mono text-[9px] text-amber-100">{pendingOutbox.length} PENDING</span>
</div>
<div className="space-y-3">{outbox.map((row) => <OutboxCard key={row.id} row={row} busy={Boolean(busy)} onAction={(action) => void controlOutbox(row, action)} />)}{outbox.length === 0 && <div className="carbon-inset rounded-2xl p-12 text-center text-xs text-slate-600">Outbox vuoto nel tenant.</div>}</div>
</section>
<aside className="carbon-card rounded-2xl p-5">
<div className="flex items-start gap-3">
<span className="grid size-10 place-items-center rounded-xl border border-amber-300/20 bg-amber-300/[.07] text-amber-200">
<Send className="size-[18px]" />
</span>
<div>
<p className="text-[10px] font-semibold uppercase tracking-[.18em] text-amber-200/70">OUTBOX / POLICY</p>
<h2 className="mt-1 text-base font-semibold text-slate-100">Delivery boundary</h2>
</div>
</div>
<div className="mt-5 space-y-3 text-[11px] leading-5 text-slate-500">
<p className="flex items-start gap-2">
<CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-lime-200" />Evento e outbox sono scritti nello stesso batch D1.</p>
<p className="flex items-start gap-2">
<CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-lime-200" />Retry, requeue, block e DLQ rispettano la macchina locale.</p>
<p className="flex items-start gap-2">
<AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-200" />Il consumer esterno non è collegato: `DELIVERED` non viene simulato.</p>
</div>
<div className="mt-6 grid grid-cols-2 gap-2">
<span className="rounded-xl border border-lime-300/20 bg-lime-300/[.05] px-3 py-2 text-center font-mono text-[9px] text-lime-200">MAX 5 RETRY</span>
<span className="rounded-xl border border-rose-300/20 bg-rose-300/[.05] px-3 py-2 text-center font-mono text-[9px] text-rose-100">DLQ EXPLICIT</span>
</div>
</aside>
</section>}{view === "twin" && <div className="mt-4">
<TwinReadModel events={events} outbox={outbox} reconciliations={reconciliations} />
</div>}{view === "ledger" && <section className="mt-4 grid gap-4 2xl:grid-cols-[minmax(0,1.12fr)_minmax(360px,.88fr)]">
<section className="carbon-card rounded-2xl p-4 sm:p-5">
<div className="flex flex-wrap items-start justify-between gap-3">
<div>
<p className="text-[10px] font-semibold uppercase tracking-[.2em] text-lime-300/70">COMMAND / TIMELINE</p>
<h2 className="mt-1 text-base font-semibold text-slate-100">Company AI ledger</h2>
<p className="mt-1 text-[11px] text-slate-500">Preview, approval e readback separati e tenant-scoped.</p>
</div>
<Link className="flex items-center gap-1.5 text-[10px] text-lime-300 hover:text-lime-100" href="/command">Apri Command <ExternalLink className="size-3.5" />
</Link>
</div>
<div className="mt-4 space-y-2">{filteredLedger.map((row) => { const styles = toneStyles[statusTone(row.status)] ?? toneStyles.cyan; return <button className={cn("w-full rounded-2xl border p-4 text-left transition", selectedLedger?.id === row.id ? "border-lime-300/35 bg-lime-300/[.06]" : "border-white/[.07] bg-black/20 hover:border-lime-300/25")} key={row.id} onClick={() => setSelectedLedgerId(row.id)} type="button">
<div className="flex items-start gap-3">
<span className={cn("grid size-10 shrink-0 place-items-center rounded-xl border border-current/20 bg-current/10", styles.icon)}>
<Sparkles className="size-[18px]" />
</span>
<div className="min-w-0 flex-1">
<div className="flex flex-wrap items-center gap-2">
<span className="truncate text-sm font-semibold text-slate-100">{row.command}</span>
<span className={cn("rounded-full border px-2 py-1 text-[9px] font-semibold uppercase", styles.badge)}>{statusLabel(row.status)}</span>
</div>
<p className="mt-1 truncate font-mono text-[10px] text-slate-600">{row.entryType} · {row.actionType} · {formatDate(row.createdAt)}</p>
</div>
<ChevronRight className="mt-1 size-4 text-slate-700" />
</div>
</button>; })}{filteredLedger.length === 0 && <div className="carbon-inset rounded-2xl p-10 text-center">
<Sparkles className="mx-auto size-8 text-slate-700" />
<p className="mt-3 text-xs text-slate-500">Ledger Company AI vuoto o non disponibile.</p>
<p className="mt-1 text-[10px] text-slate-700">La capability `command.read` governa questo readback.</p>
</div>}</div>
</section>
<aside className="carbon-card-neon rounded-2xl p-4 sm:p-5">{selectedLedger ? <>
<div className="flex items-start justify-between gap-3">
<div>
<p className="text-[10px] font-semibold uppercase tracking-[.2em] text-lime-300/70">LEDGER INSPECTOR</p>
<h2 className="mt-1 text-base font-semibold text-slate-100">{selectedLedger.entryType}</h2>
<p className="mt-1 font-mono text-[10px] text-slate-600">{selectedLedger.id}</p>
</div>
<span className={cn("rounded-full border px-2 py-1 text-[9px] font-semibold uppercase", toneStyles[statusTone(selectedLedger.status)]?.badge)}>{statusLabel(selectedLedger.status)}</span>
</div>
<dl className="mt-5 space-y-3 text-[10px]">
<div className="flex justify-between gap-3">
<dt className="text-slate-600">Action</dt>
<dd className="truncate text-slate-300">{selectedLedger.actionType}</dd>
</div>
<div className="flex justify-between gap-3">
<dt className="text-slate-600">Richiesto da</dt>
<dd className="truncate text-slate-300">{selectedLedger.requestedBy}</dd>
</div>
<div className="flex justify-between gap-3">
<dt className="text-slate-600">Approvato da</dt>
<dd className="truncate text-lime-100">{selectedLedger.approvedBy ?? "—"}</dd>
</div>
<div className="flex justify-between gap-3">
<dt className="text-slate-600">Approval</dt>
<dd className="text-amber-100">{selectedLedger.approvalRequired ? "RICHIESTA" : "NON RICHIESTA"}</dd>
</div>
</dl>
<p className="mt-5 text-[9px] font-semibold uppercase tracking-[.16em] text-slate-600">Payload ledger</p>
<pre className="mt-2 max-h-48 overflow-auto rounded-xl border border-white/[.07] bg-black/35 p-3 font-mono text-[10px] leading-5 text-slate-400">{prettyJson(selectedLedger.payload)}</pre>
<div className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/[.045] p-3 text-[10px] leading-5 text-slate-500">
<p className="flex items-center gap-2 text-amber-100">
<LockKeyhole className="size-3.5" />No direct write</p>
<p className="mt-2">Il ledger conserva proposta, approval e readback. Nessuna risposta Company AI modifica direttamente un dominio.</p>
</div>
</> : <div className="py-16 text-center">
<FileClock className="mx-auto size-8 text-slate-700" />
<p className="mt-3 text-xs text-slate-500">Seleziona una entry del ledger.</p>
</div>}</aside>
</section>}<footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/[.08] py-5 text-[10px] text-slate-600">
<span>AI-ZEROW COMMAND · W11 / EVENTS AUTHORITY</span>
<span className="flex items-center gap-2">
<span className="size-1.5 rounded-full bg-lime-300" />Sites private · D1 readback · external consumer deferred</span>
</footer>
</div>
</section>
</div>
<CommandMobileNav active="more" allowedNavigation={allowedNavigation} role={role} />
<Dialog open={composerOpen} onOpenChange={setComposerOpen}>
<DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto border-lime-300/20 bg-[#080c09] text-slate-100 sm:max-w-[720px]">
<form className="space-y-4" onSubmit={appendEvent}>
<DialogHeader>
<DialogTitle>Registra evento governato</DialogTitle>
<DialogDescription className="text-slate-500">L’evento entra nello stream append-only; tenant, actor, correlation e timestamp vengono assegnati dal server.</DialogDescription>
</DialogHeader>
<div className="grid gap-4 sm:grid-cols-2">
<label className="text-xs text-slate-400">Tipo evento<select className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-slate-100 outline-none focus:border-lime-300/40" onChange={(event) => { const template = eventTemplates.find((item) => item.value === event.target.value); setForm({ ...form, eventType: event.target.value, aggregateType: template?.aggregate ?? form.aggregateType }); }} value={form.eventType}>{eventTemplates.map((template) => <option key={template.value} value={template.value}>{template.label}</option>)}</select>
</label>
<label className="text-xs text-slate-400">Tipo aggregato<Input className="mt-2 border-white/10 bg-black/30" onChange={(event) => setForm({ ...form, aggregateType: event.target.value })} value={form.aggregateType} />
</label>
<label className="text-xs text-slate-400 sm:col-span-2">ID aggregato<Input autoFocus className="mt-2 border-white/10 bg-black/30" onChange={(event) => setForm({ ...form, aggregateId: event.target.value })} placeholder="ID commessa, missione, asset o dominio" value={form.aggregateId} required />
</label>
<label className="text-xs text-slate-400">Versione aggregato<Input className="mt-2 border-white/10 bg-black/30" inputMode="numeric" min="1" onChange={(event) => setForm({ ...form, aggregateVersion: event.target.value })} type="number" value={form.aggregateVersion} required />
</label>
<label className="text-xs text-slate-400">Idempotency key<Input className="mt-2 border-white/10 bg-black/30" onChange={(event) => setForm({ ...form, idempotencyKey: event.target.value })} placeholder="Generata se vuota" value={form.idempotencyKey} />
</label>
<label className="text-xs text-slate-400 sm:col-span-2">Payload JSON<Textarea className="mt-2 min-h-28 border-white/10 bg-black/30 font-mono text-xs" onChange={(event) => setForm({ ...form, payload: event.target.value })} value={form.payload} />
</label>
</div>
<div className="rounded-xl border border-amber-300/15 bg-amber-300/[.035] p-3 text-[10px] leading-5 text-amber-100/80">
<LockKeyhole className="mr-1.5 inline size-3.5" />Commit locale, outbox e reconciliation sono atomici su D1. Il consumer esterno resta differito.</div>
<DialogFooter>
<DialogClose asChild>
<Button className="border-white/10 bg-transparent text-slate-400" type="button" variant="outline">Annulla</Button>
</DialogClose>
<Button className="bg-lime-300 text-[#050705] hover:bg-lime-200" disabled={busy === "append" || !canWrite} type="submit">{busy === "append" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}Commit e rileggi</Button>
</DialogFooter>
</form>
</DialogContent>
</Dialog>{toast && <button aria-label="Chiudi messaggio" className="fixed bottom-5 right-5 z-50 max-w-[380px] rounded-xl border border-lime-300/25 bg-[#0a100c]/95 px-4 py-3 text-left text-xs text-lime-100 shadow-[0_0_28px_rgba(190,255,60,0.14)]" onClick={() => setToast("")} type="button">{toast}</button>}</main>;
}
