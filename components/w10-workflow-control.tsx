"use client";

import Image from "next/image";
import Link from "@/components/app-link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bell,
  BriefcaseBusiness,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  CircleDollarSign,
  Clock3,
  ExternalLink,
  FileCheck2,
  FileText,
  FolderOpen,
  Layers3,
  LoaderCircle,
  LockKeyhole,
  Menu,
  MessageSquareText,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
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
import type { W10Module } from "@/lib/w10-contract";

type Tone = "lime" | "cyan" | "amber" | "red" | "muted";

type JobOption = {
  id: string;
  code: string | null;
  title: string;
  client: string | null;
  location: string | null;
  status: string;
};

type Workflow = {
  id: string;
  module: W10Module;
  recordType: string;
  title: string;
  detail: string;
  status: string;
  amountMilli: number;
  currency: string;
  jobId: string | null;
  supplier: string;
  lines: Array<{ description?: string; quantity?: number; unit?: string }>;
  version: number;
  progress: number;
  nextActions: string[];
  externalStatus: "SITES_READY" | "EXTERNAL_DEFERRED" | "RECONCILED";
  createdAt: string;
  updatedAt: string;
};

type ProcurementDraftLine = { description: string; quantity: string; unit: string };

type W10Payload = {
  context?: { actorName?: string; actorEmail?: string; role?: string; roles?: string[]; capabilities?: string[] };
  workflows: Workflow[];
  jobs: JobOption[];
  contract?: { canonicalExecutor?: string; transitions?: string };
  readback?: { status?: string; checkedAt?: string };
};

type NavItem = { id: CommandNavigationId; label: string; path: string; capability: string; icon: LucideIcon };

const navItems: NavItem[] = [
  { id: "command", label: "CENTRALE", path: "/command", capability: "command.read", icon: MessageSquareText },
  { id: "operations", label: "COMMESSE", path: "/operations", capability: "operations.read", icon: BriefcaseBusiness },
  { id: "workforce", label: "PERSONE", path: "/workforce", capability: "workforce.read", icon: Users },
  { id: "planning", label: "PIANIFICAZIONE", path: "/planning", capability: "planning.read", icon: FolderOpen },
  { id: "attendance", label: "PRESENZE", path: "/presenze", capability: "workforce.read", icon: Clock3 },
  { id: "assets", label: "ASSET", path: "/assets", capability: "asset.read", icon: Package },
  { id: "warehouse", label: "MAGAZZINO", path: "/warehouse", capability: "warehouse.read", icon: Layers3 },
  { id: "mission", label: "MISSIONI", path: "/mission", capability: "mission.read", icon: Truck },
  { id: "documents", label: "DOCUMENTI", path: "/documents", capability: "documents.read", icon: FileText },
  { id: "finance", label: "FINANZA", path: "/finance", capability: "finance.read", icon: CircleDollarSign },
  { id: "procurement", label: "ACQUISTI", path: "/procurement", capability: "procurement.read", icon: ShoppingCart },
  { id: "authority", label: "AUTORITÀ", path: "/onboarding", capability: "authority.read", icon: ShieldCheck },
  { id: "events", label: "EVENTI", path: "/events", capability: "events.read", icon: CheckCircle2 },
  { id: "settings", label: "IMPOSTAZIONI", path: "/settings", capability: "settings.read", icon: SlidersHorizontal },
];

const actionLabels: Record<string, string> = {
  request: "Invia richiesta",
  submit_review: "Invia in revisione",
  approve: "Approva voce",
  prepare_po: "Prepara bozza ordine",
  external_issue: "Emetti ordine",
  receive_partial: "Registra ricezione parziale",
  receive: "Registra ricezione",
  reconcile: "Riconcilia e chiudi",
};

const externalActions = new Set(["external_issue", "receive_partial", "receive"]);

const ROLE_LABELS: Record<string, string> = {
  owner: "Titolare",
  admin: "Amministratore",
  manager: "Responsabile",
  office: "Ufficio",
  technical: "Tecnico",
  auditor: "Auditor",
  worker: "Operatore",
  driver: "Autista",
  delivery_driver: "Autista di consegna",
  field_supervisor: "Caposquadra",
  warehouse_manager: "Responsabile magazzino",
  warehouse_operator: "Magazziniere",
  maintenance: "Manutentore",
};

const toneStyles: Record<Tone, { icon: string; badge: string }> = {
  lime: { icon: "text-lime-200", badge: "border-lime-300/25 bg-lime-300/10 text-lime-100" },
  cyan: { icon: "text-cyan-200", badge: "border-cyan-300/25 bg-cyan-300/10 text-cyan-100" },
  amber: { icon: "text-amber-200", badge: "border-amber-300/25 bg-amber-300/10 text-amber-100" },
  red: { icon: "text-rose-200", badge: "border-rose-300/25 bg-rose-300/10 text-rose-100" },
  muted: { icon: "text-slate-400", badge: "border-white/10 bg-white/[.03] text-slate-400" },
};

function cn(...values: Array<string | false | null | undefined>) { return values.filter(Boolean).join(" "); }

function roleLabel(role: string) { return ROLE_LABELS[role] ?? role; }

function formatAmount(value: number, currency: string) {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: currency || "EUR" }).format(value / 1000);
}

function formatLineQuantity(line: Workflow["lines"][number]) {
  if (typeof line.quantity !== "number" || !Number.isFinite(line.quantity) || line.quantity <= 0) return "quantità da verificare";
  return `${new Intl.NumberFormat("it-IT", { maximumFractionDigits: 3 }).format(line.quantity)} ${line.unit || "pz"}`;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    PROPOSED: "DA VALUTARE",
    NEED: "FABBISOGNO",
    REQUESTED: "RICHIESTO",
    REVIEW: "IN REVISIONE",
    APPROVED: "APPROVATO",
    PO_DRAFT: "BOZZA ORDINE",
    PO_ISSUED: "ORDINE EMESSO",
    PARTIALLY_RECEIVED: "RICEZIONE PARZIALE",
    RECEIVED: "RICEVUTO",
    RECONCILED: "RICONCILIATO",
  };
  return labels[status] ?? status.replaceAll("_", " ");
}

function statusTone(status: string): Tone {
  if (["APPROVED", "RECONCILED", "RECEIVED"].includes(status)) return "lime";
  if (["REVIEW", "PO_DRAFT"].includes(status)) return "cyan";
  if (["PO_ISSUED", "PARTIALLY_RECEIVED", "REQUESTED"].includes(status)) return "amber";
  return "muted";
}

function externalStatusLabel(status: Workflow["externalStatus"]) {
  const labels: Record<Workflow["externalStatus"], string> = {
    SITES_READY: "Gestito da ZEROW",
    EXTERNAL_DEFERRED: "In attesa del sistema collegato",
    RECONCILED: "Verificato",
  };
  return labels[status];
}

function IconButton({ label, children, onClick, className = "" }: { label: string; children: ReactNode; onClick?: () => void; className?: string }) {
  return <button aria-label={label} className={cn("grid size-9 place-items-center rounded-lg border border-white/10 bg-black/20 text-slate-500 transition hover:border-lime-300/35 hover:bg-lime-300/10 hover:text-lime-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300", className)} onClick={onClick} type="button">{children}</button>;
}

function KpiCard({ label, value, detail, icon: Icon, tone }: { label: string; value: number | string; detail: string; icon: LucideIcon; tone: Tone }) {
  return <article className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><span className={cn("grid size-10 place-items-center rounded-xl border border-current/20 bg-current/10", toneStyles[tone].icon)}><Icon className="size-[18px]" /></span><span className="font-mono text-[10px] text-slate-600">D1</span></div><p className="mt-5 text-[11px] font-semibold uppercase tracking-[.16em] text-slate-600">{label}</p><p className="mt-2 font-mono text-[29px] font-semibold leading-none tracking-[-.07em] text-slate-50">{value}</p><p className="mt-4 text-[11px] text-slate-600">{detail}</p></article>;
}

function ProcurementLinesEditor({ lines, onChange }: { lines: ProcurementDraftLine[]; onChange: (lines: ProcurementDraftLine[]) => void }) {
  function updateLine(index: number, patch: Partial<ProcurementDraftLine>) {
    onChange(lines.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line));
  }

  return <div className="grid gap-3 sm:col-span-2">
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-cyan-300/15 bg-cyan-300/[.035] p-3">
      <div><p className="text-xs font-semibold text-cyan-100">Articoli della richiesta</p><p className="mt-1 text-[10px] text-slate-500">Ogni riga conserva descrizione, quantità e unità.</p></div>
      <Button className="h-9 border-cyan-300/20 bg-cyan-300/[.06] px-3 text-[10px] text-cyan-100 hover:bg-cyan-300/10" disabled={lines.length >= 80} onClick={() => onChange([...lines, { description: "", quantity: "1", unit: "pz" }])} type="button" variant="outline"><Plus className="size-3.5" />Aggiungi riga</Button>
    </div>
    {lines.map((line, index) => <fieldset className="grid gap-3 rounded-xl border border-white/[.08] bg-black/20 p-3 sm:grid-cols-[minmax(0,1fr)_140px_110px]" key={index}>
      <legend className="px-1 text-[10px] font-semibold uppercase tracking-[.14em] text-slate-500">Articolo {index + 1}</legend>
      <label className="text-[10px] text-slate-500 sm:col-span-1">Descrizione materiale<Input autoComplete="off" className="mt-1.5 border-white/10 bg-black/30 text-xs" maxLength={180} onChange={(event) => updateLine(index, { description: event.target.value })} placeholder="Es. Tubo corrugato DN160" required value={line.description} /></label>
      <label className="text-[10px] text-slate-500">Quantità<Input className="mt-1.5 border-white/10 bg-black/30 text-xs" inputMode="decimal" max="1000000000" min="0.001" onChange={(event) => updateLine(index, { quantity: event.target.value })} required step="0.001" type="number" value={line.quantity} /></label>
      <div className="flex items-end gap-2"><label className="min-w-0 flex-1 text-[10px] text-slate-500">Unità<Input autoComplete="off" className="mt-1.5 border-white/10 bg-black/30 text-xs" maxLength={24} onChange={(event) => updateLine(index, { unit: event.target.value })} placeholder="pz, m, kg…" value={line.unit} /></label>{lines.length > 1 && <Button aria-label={`Rimuovi articolo ${index + 1}`} className="mb-0.5 size-9 shrink-0 border-white/10 bg-transparent p-0 text-slate-500 hover:border-rose-300/30 hover:text-rose-200" onClick={() => onChange(lines.filter((_, lineIndex) => lineIndex !== index))} type="button" variant="outline"><X className="size-3.5" /></Button>}</div>
    </fieldset>)}
  </div>;
}

export default function W10WorkflowControl({ module }: { module: W10Module }) {
  const router = useRouter();
  const [payload, setPayload] = useState<W10Payload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "forbidden" | "error">("loading");
  const [refreshing, setRefreshing] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [selectedId, setSelectedId] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState({ title: "", detail: "", amount: "", supplier: "", jobId: "", lines: [{ description: "", quantity: "1", unit: "pz" }] as ProcurementDraftLine[] });

  const isProcurement = module === "procurement";
  const Icon = isProcurement ? ShoppingCart : CircleDollarSign;
  const moduleLabel = isProcurement ? "Acquisti" : "Finanza";
  const title = isProcurement ? "Gestione acquisti" : "Gestione finanza";
  const headline = isProcurement ? "Fabbisogni chiari, acquisti tracciati." : "Ogni euro ha una storia chiara.";
  const subtitle = isProcurement
    ? "Dalla necessità alla bozza d’ordine, con commessa reale, approvazione e stato del sistema collegato sempre chiaro."
    : "Costi e riconciliazioni legati alle attività, con approvazione responsabile e nessuna scrittura contabile simulata.";

  const notify = useCallback((message: string) => { setNotice(message); window.setTimeout(() => setNotice(""), 4600); }, []);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch(`/api/${module}/workflow`, { cache: "no-store" });
      if (response.status === 403) { setState("forbidden"); return; }
      const next = await response.json() as W10Payload & { error?: string };
      if (!response.ok) throw new Error(next.error ?? "Registro non disponibile.");
      setPayload(next);
      setSelectedId((current) => current && next.workflows.some((workflow) => workflow.id === current) ? current : next.workflows[0]?.id ?? "");
      setState("ready");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Registro non disponibile.");
      setState((current) => current === "ready" ? current : "error");
    } finally { setRefreshing(false); }
  }, [module, notify]);

  useEffect(() => { const timer = window.setTimeout(() => void refresh(), 0); return () => window.clearTimeout(timer); }, [refresh]);

  const context = payload?.context;
  const capabilities = useMemo(() => context?.capabilities ?? [module + ".read"], [context, module]);
  const allowedNavigation = useMemo(() => getAllowedCommandNavigation(capabilities).map((item) => item.id), [capabilities]);
  const visibleNavItems = useMemo(() => navItems.filter((item) => allowedNavigation.includes(item.id) || capabilities.includes(item.capability)), [allowedNavigation, capabilities]);
  const workflows = useMemo(() => payload?.workflows ?? [], [payload?.workflows]);
  const jobs = useMemo(() => payload?.jobs ?? [], [payload?.jobs]);
  const jobById = useMemo(() => new Map(jobs.map((job) => [job.id, job])), [jobs]);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return workflows.filter((workflow) => {
      const job = workflow.jobId ? jobById.get(workflow.jobId) : null;
      const haystack = [workflow.id, workflow.title, workflow.detail, workflow.status, workflow.supplier, workflow.jobId, job?.code, job?.title, job?.client].join(" ").toLowerCase();
      return (!normalized || haystack.includes(normalized)) && (statusFilter === "ALL" || workflow.status === statusFilter);
    });
  }, [jobById, query, statusFilter, workflows]);
  const selected = workflows.find((workflow) => workflow.id === selectedId) ?? filtered[0] ?? null;
  const canWrite = capabilities.includes(module + ".write");
  const canApprove = capabilities.includes("approvals.review");
  const actor = { email: context?.actorEmail ?? "operator@zerow.local", name: context?.actorName ?? "Operatore" };
  const openValue = workflows.filter((workflow) => workflow.status !== "RECONCILED").reduce((sum, workflow) => sum + workflow.amountMilli, 0);

  function navigate(path: string) { setMobileMenu(false); router.push(path); }
  function goBack() { if (window.history.length > 1) router.back(); else router.push("/command"); }
  function openCreate() {
    setForm({ title: "", detail: "", amount: "", supplier: "", jobId: "", lines: [{ description: "", quantity: "1", unit: "pz" }] });
    setDialogOpen(true);
  }

  async function createWorkflow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canWrite) return;
    const amount = Number(form.amount.replace(",", "."));
    const lines = form.lines.map((line) => ({
      description: line.description.trim(),
      quantity: Number(line.quantity.replace(",", ".")),
      unit: line.unit.trim(),
    }));
    const validProcurementLines = lines.length >= 1 && lines.length <= 80 && lines.every((line) => {
      const precisionValid = Number.isFinite(line.quantity) && Math.abs(line.quantity * 1000 - Math.round(line.quantity * 1000)) <= 1e-7;
      return line.description.length >= 2 && line.description.length <= 180 && Number.isFinite(line.quantity) && line.quantity > 0 && line.quantity <= 1_000_000_000 && precisionValid && line.unit.length <= 24;
    });
    if (form.title.trim().length < 2) { notify("Inserisci un titolo descrittivo."); return; }
    if (!Number.isFinite(amount) || amount < 0) { notify("Importo non valido."); return; }
    if (isProcurement && !validProcurementLines) { notify("Controlla gli articoli: descrizione, unità e quantità con massimo 3 decimali."); return; }
    setSaving(true);
    try {
      const response = await fetch(`/api/${module}/workflow`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "create",
          title: form.title,
          detail: form.detail,
          amountMilli: Math.round(amount * 1000),
          supplier: form.supplier,
          jobId: form.jobId || undefined,
          lines: isProcurement ? lines : [],
          idempotencyKey: "w10-create-" + module + "-" + crypto.randomUUID(),
        }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) { notify(result.error === "procurement_lines_invalid" ? "Controlla la descrizione, l’unità e la quantità (massimo 3 decimali)." : "Voce non creata: " + (result.error ?? "errore")); return; }
      setDialogOpen(false);
      notify("Voce creata e verificata nel registro aziendale.");
      await refresh();
    } catch { notify("Connessione non disponibile: nessuna voce confermata."); }
    finally { setSaving(false); }
  }

  async function transition(action: string) {
    if (!selected || externalActions.has(action)) return;
    const allowed = action === "approve" ? canApprove : canWrite;
    if (!allowed) { notify("L’autorizzazione richiesta non è presente nel ruolo corrente."); return; }
    setSaving(true);
    try {
      const response = await fetch(`/api/${module}/workflow`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, id: selected.id, expectedVersion: selected.version, idempotencyKey: "w10-transition-" + selected.id + "-" + selected.version + "-" + action, evidence: "Sites W10 control deck" }),
      });
      const result = await response.json() as { error?: string; detail?: string };
      if (!response.ok) { notify("Aggiornamento non eseguito: " + (result.detail ?? result.error ?? "errore")); return; }
      notify("Stato aggiornato: " + (actionLabels[action] ?? action) + ".");
      await refresh();
    } catch { notify("Connessione non disponibile: nessuna transizione confermata."); }
    finally { setSaving(false); }
  }

  if (state === "loading" && !payload) return <main className="grid min-h-screen place-items-center bg-[#030504] text-sm text-slate-500"><span className="flex items-center gap-3"><LoaderCircle className="size-4 animate-spin text-lime-300" />Caricamento del registro…</span></main>;
  if (state === "forbidden") return <main className="grid min-h-screen place-items-center bg-[#030504] px-5 text-slate-100"><section className="carbon-card max-w-lg rounded-3xl p-7 text-center"><ShieldCheck className="mx-auto size-8 text-amber-200" /><h1 className="mt-4 text-lg font-semibold">Modulo non visibile</h1><p className="mt-2 text-sm text-slate-500">Il tuo ruolo non è autorizzato a consultare questo modulo.</p><Button className="mt-5 bg-lime-300 text-[#050705] hover:bg-lime-200" onClick={() => router.push("/command")}>Torna al Command</Button></section></main>;
  if (state === "error" && !payload) return <main className="grid min-h-screen place-items-center bg-[#030504] text-slate-100"><section className="carbon-card rounded-2xl p-7 text-center"><CircleAlert className="mx-auto size-7 text-amber-200" /><p className="mt-3 text-sm text-slate-300">Registro non disponibile</p><Button className="mt-4 bg-lime-300 text-[#050705] hover:bg-lime-200" onClick={() => void refresh()}><RefreshCw className="size-4" />Riprova</Button></section></main>;

  return <main className="zw-app-shell zw-w10-module min-h-screen overflow-x-hidden text-slate-100 selection:bg-lime-300 selection:text-[#060806]"><div className="zw-command-ambient" aria-hidden="true" /><div className="relative flex min-h-screen">
    <aside className={cn("zw-command-sidebar fixed inset-y-0 left-0 z-40 flex flex-col px-3 py-4 transition-[width,transform] lg:static lg:translate-x-0", sidebarCollapsed ? "is-collapsed lg:w-[76px]" : "lg:w-[248px]", mobileMenu ? "translate-x-0" : "-translate-x-full")}>
      <div className="flex items-center justify-between px-2"><button aria-label="Apri Command" className="flex min-w-0 items-center gap-3 text-left" onClick={() => navigate("/command")} type="button"><span className="neon-pulse relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black shadow-[0_0_22px_rgba(200,255,34,.12)]"><Image src="/ai-zerow-icon.jpeg" alt="AI-ZEROW" width={40} height={40} className="size-full object-cover" /></span><span className="zw-command-sidebar__brand-copy min-w-0"><span className="block text-sm font-bold tracking-[.18em] text-slate-50">AI-ZEROW</span><span className="block text-[10px] uppercase tracking-[.22em] text-lime-300/75">comando</span></span></button><div className="flex items-center gap-1"><IconButton label={sidebarCollapsed ? "Espandi sidebar" : "Riduci sidebar"} className="hidden lg:grid" onClick={() => setSidebarCollapsed((value) => !value)}>{sidebarCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}</IconButton><IconButton label="Chiudi menu" className="lg:hidden" onClick={() => setMobileMenu(false)}><X className="size-4" /></IconButton></div></div>
      <div className="zw-command-tenant mt-7 flex items-center gap-3 rounded-2xl p-3"><span className="grid size-9 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/10 text-lime-200"><Icon className="size-4" /></span><span className="zw-command-sidebar__tenant-copy min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-slate-200">Azienda corrente</span><span className="mt-0.5 block truncate text-[10px] uppercase tracking-[.1em] text-slate-600">{roleLabel(context?.role ?? "operator")} · perimetro aziendale</span></span></div>
      <nav className="mt-6 min-h-0 flex-1 overflow-y-auto" aria-label="Navigazione principale"><p className="zw-command-sidebar__nav-caption px-3 text-[9px] font-semibold uppercase tracking-[.22em] text-slate-700">Moduli disponibili</p><div className="mt-2 space-y-1">{visibleNavItems.map((item) => { const NavIcon = item.icon; const active = item.id === module; return <button aria-current={active ? "page" : undefined} aria-label={sidebarCollapsed ? item.label : undefined} className={cn("zw-command-nav-item", active && "is-active")} key={item.id} onClick={() => navigate(item.path)} title={sidebarCollapsed ? item.label : undefined} type="button"><NavIcon className={cn("size-4", active ? "text-lime-200" : "text-slate-600")} /><span className="zw-command-sidebar__nav-label">{item.label}</span>{item.id === "command" && <span className="zw-command-sidebar__nav-badge ml-auto rounded border border-lime-300/20 px-1.5 py-0.5 font-mono text-[8px] tracking-[.08em] text-lime-200">AI</span>}</button>; })}</div></nav>
      <div className="zw-command-sidebar__footer mt-4 border-t border-white/[.07] pt-4"><div className="flex items-center justify-between px-2 text-[9px] uppercase tracking-[.14em] text-slate-600"><span>Sistema</span><span className="flex items-center gap-1.5 text-lime-200"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_8px_rgba(200,255,34,.8)]" />D1 ONLINE</span></div><div className="carbon-inset mt-3 rounded-xl p-3"><div className="flex items-center gap-2 text-[11px] text-slate-400"><Settings2 className="size-3.5 text-lime-300" />Registro operativo</div><p className="mt-2 font-mono text-[10px] text-slate-600">{workflows.length} voci · {isProcurement ? "acquisti" : "finanza"}</p><p className="mt-3 font-mono text-[10px] text-slate-600">Sites · approvazioni controllate</p></div></div>
    </aside>
    <section className="min-w-0 flex-1"><header className="zw-command-topbar sticky top-0 z-20 flex h-[72px] items-center gap-3 px-4 sm:gap-5 sm:px-7"><IconButton className="lg:hidden" label="Apri menu" onClick={() => setMobileMenu(true)}><Menu className="size-4" /></IconButton><button aria-label={"Apri " + title} className="zw-command-topbar__brand flex shrink-0 items-center gap-2 text-left" onClick={() => navigate("/" + module)} type="button"><span className="relative grid size-9 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black shadow-[0_0_18px_rgba(200,255,34,.12)]"><Image src="/ai-zerow-icon.jpeg" alt="ZEROW" width={36} height={36} className="size-full object-cover" /></span><span className="hidden sm:block"><span className="block text-[11px] font-bold tracking-[.18em] text-slate-50">ZEROW</span><span className="block text-[10px] uppercase tracking-[.2em] text-lime-300/75">{moduleLabel} · gestione</span></span></button><IconButton className="hidden lg:grid" label={sidebarCollapsed ? "Espandi sidebar" : "Riduci sidebar"} onClick={() => setSidebarCollapsed((value) => !value)}>{sidebarCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}</IconButton><div className="relative hidden min-w-0 flex-1 justify-center md:flex"><div className="relative w-full max-w-[520px]"><Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-600" /><Input aria-label={"Cerca in " + moduleLabel} className="h-10 w-full border-lime-300/10 bg-black/35 pl-10 text-xs text-slate-100 placeholder:text-slate-600" onChange={(event) => setQuery(event.target.value)} placeholder="Cerca voce, commessa o fornitore…" value={query} /></div></div><div className="flex min-w-0 flex-1 items-center gap-2 md:hidden"><span className="truncate text-xs font-semibold tracking-[.14em] text-slate-200">{moduleLabel.toUpperCase()} · GESTIONE</span><span className="size-1 rounded-full bg-lime-300" /></div><div className="ml-auto flex min-w-0 items-center gap-2"><TenantSwitcher /><span className="hidden items-center gap-2 rounded-full border border-lime-300/20 bg-lime-300/5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[.12em] text-lime-200 sm:flex"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_9px_rgba(200,255,34,.9)]" />{refreshing ? "AGGIORNAMENTO" : "DATI VERIFICATI"}</span><IconButton label="Torna indietro" onClick={goBack}><ArrowLeft className="size-4" /></IconButton><IconButton label={"Aggiorna " + moduleLabel} onClick={() => void refresh()}><RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} /></IconButton>{capabilities.includes("communication.read") && <IconButton label="Apri comunicazioni" onClick={() => navigate("/communications")}><Bell className="size-4" /></IconButton>}<AccountMenu actor={actor} /></div></header>
      <div className="mx-auto max-w-[1680px] px-4 py-5 pb-24 sm:px-7 sm:py-7 lg:pb-8"><section className="zw-module-hero relative overflow-hidden rounded-[26px] p-5 sm:p-7"><div className="relative z-[1] max-w-4xl"><p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.22em] text-lime-300/80"><Icon className="size-3.5" />GESTIONE AZIENDALE / {moduleLabel.toUpperCase()}</p><h1 className="mt-3 max-w-4xl text-3xl font-semibold tracking-[-.06em] text-slate-50 sm:text-[46px]">{headline.split(" ").slice(0, -2).join(" ")}<br /><span className="text-lime-300">{headline.split(" ").slice(-2).join(" ")}</span></h1><p className="mt-4 max-w-3xl text-sm leading-6 text-slate-400">{subtitle}</p><div className="mt-5 flex flex-wrap gap-2"><Button className="bg-lime-300 text-[11px] font-semibold text-[#050705] hover:bg-lime-200" disabled={!canWrite} onClick={openCreate}><Plus className="size-3.5" />{isProcurement ? "Nuova richiesta" : "Nuova voce"}</Button><Link className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-lime-300/25 bg-lime-300/[.05] px-3 py-2 text-[11px] font-semibold text-lime-100 hover:bg-lime-300/10" href={isProcurement ? "/finance" : "/procurement"}>{isProcurement ? <CircleDollarSign className="size-3.5" /> : <ShoppingCart className="size-3.5" />}{isProcurement ? "Apri Finanza" : "Apri Acquisti"}</Link><Link className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[11px] text-slate-400 hover:border-lime-300/25 hover:text-lime-100" href="/operations"><BriefcaseBusiness className="size-3.5" />Collega commessa</Link></div></div><div className="absolute -right-16 -top-20 size-[24rem] rounded-full bg-lime-300/[.07] blur-3xl" /><div className="absolute bottom-0 right-8 hidden w-[300px] lg:block"><div className="relative h-28 overflow-hidden rounded-t-[26px] border border-lime-300/20 bg-black/25 p-4"><div className="absolute inset-x-0 top-1/2 border-t border-dashed border-lime-300/25" /><div className="absolute left-[18%] top-[42%] size-3 rounded-full bg-cyan-200 shadow-[0_0_18px_rgba(89,217,255,.75)]" /><div className="absolute right-[18%] top-[42%] size-3 rounded-full bg-lime-300 shadow-[0_0_18px_rgba(200,255,34,.8)]" /><Icon className="absolute left-1/2 top-[28%] size-8 -translate-x-1/2 text-lime-300/70" /><p className="absolute bottom-3 left-4 text-[9px] uppercase tracking-[.16em] text-slate-600">FLUSSO OPERATIVO</p><p className="absolute bottom-3 right-4 font-mono text-[9px] text-amber-200/70">SISTEMA COLLEGATO</p></div></div><div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-lime-300/55 to-transparent" /></section>
        <section className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><KpiCard label="Voci registrate" value={workflows.length} detail="Perimetro aziendale" icon={FileCheck2} tone="lime" /><KpiCard label="In revisione" value={workflows.filter((workflow) => workflow.status === "REVIEW").length} detail="In attesa di approvazione" icon={ShieldCheck} tone="amber" /><KpiCard label="Valore aperto" value={formatAmount(openValue, "EUR")} detail="Dati verificati dal server" icon={CircleDollarSign} tone="cyan" /><KpiCard label="Approvati" value={workflows.filter((workflow) => workflow.status === "APPROVED").length} detail="Pronti al passaggio" icon={Check} tone="lime" /><KpiCard label="Riconciliati" value={workflows.filter((workflow) => workflow.status === "RECONCILED").length} detail="Registro verificato" icon={CheckCircle2} tone="lime" /></section>
        <section className="mt-4 grid gap-4 2xl:grid-cols-[minmax(0,1.18fr)_minmax(340px,.82fr)]"><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-lime-300/70">REGISTRO / {moduleLabel.toUpperCase()}</p><h2 className="mt-1 text-base font-semibold text-slate-100">Movimenti e richieste</h2><p className="mt-1 text-[11px] text-slate-500">Stati, importi, commesse e versioni verificati nel registro aziendale.</p></div><span className="rounded-full border border-lime-300/20 bg-lime-300/[.06] px-2.5 py-1.5 font-mono text-[9px] text-lime-200">{filtered.length} / {workflows.length}</span></div><div className="mt-4 grid gap-2 md:grid-cols-[minmax(0,1fr)_190px]"><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-600" /><Input aria-label="Filtra movimenti" className="h-10 border-white/10 bg-black/25 pl-9 text-xs text-slate-100 placeholder:text-slate-600" onChange={(event) => setQuery(event.target.value)} placeholder="Titolo, commessa, controparte…" value={query} /></div><select aria-label="Filtra stato" className="h-10 rounded-xl border border-white/10 bg-black/25 px-3 text-xs text-slate-200 outline-none focus:border-lime-300/40" onChange={(event) => setStatusFilter(event.target.value)} value={statusFilter}><option value="ALL">Tutti gli stati</option>{[...new Set(workflows.map((workflow) => workflow.status))].map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select></div><div className="mt-4 space-y-2">{filtered.map((workflow) => { const selectedRow = selected?.id === workflow.id; const job = workflow.jobId ? jobById.get(workflow.jobId) : null; return <button className={cn("group w-full rounded-2xl border p-4 text-left transition", selectedRow ? "border-lime-300/35 bg-lime-300/[.065] shadow-[0_0_24px_rgba(200,255,34,.07)]" : "border-white/[.07] bg-black/20 hover:border-lime-300/25 hover:bg-lime-300/[.03]")} key={workflow.id} onClick={() => setSelectedId(workflow.id)} type="button"><div className="flex flex-wrap items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-3"><span className={cn("grid size-10 shrink-0 place-items-center rounded-xl border border-current/20 bg-current/10", toneStyles[statusTone(workflow.status)].icon)}><Icon className="size-[18px]" /></span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="truncate text-sm font-semibold text-slate-100">{workflow.title}</span><span className={cn("rounded-full border px-2 py-1 text-[9px] font-semibold uppercase tracking-[.05em]", toneStyles[statusTone(workflow.status)].badge)}>{statusLabel(workflow.status)}</span></div><p className="mt-1 truncate font-mono text-[10px] text-slate-600">{workflow.id} · v{workflow.version}{job ? " · " + (job.code ?? job.title) : " · Generale"}</p></div></div><span className="font-mono text-sm text-lime-100">{formatAmount(workflow.amountMilli, workflow.currency)}</span></div><div className="mt-4 flex items-center gap-3"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/60"><span className="block h-full rounded-full bg-gradient-to-r from-lime-600 via-lime-300 to-lime-100" style={{ width: workflow.progress + "%" }} /></div><span className="font-mono text-[10px] text-slate-500">{workflow.progress}%</span></div></button>; })}{filtered.length === 0 && <div className="rounded-2xl border border-dashed border-white/10 p-10 text-center"><Icon className="mx-auto size-7 text-slate-700" /><p className="mt-3 text-xs text-slate-500">Nessuna voce corrisponde ai filtri.</p><p className="mt-1 text-[10px] text-slate-700">Il registro non inventa movimenti e aggiorna i sistemi collegati solo dopo conferma.</p></div>}</div></section>
          <aside className="carbon-card-neon rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-lime-300/70">SCHEDA MOVIMENTO</p><h2 className="mt-1 text-base font-semibold text-slate-100">Controllo e autorizzazioni</h2></div><span className="grid size-9 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/10 text-lime-200"><ShieldCheck className="size-[18px]" /></span></div>{selected ? <div className="mt-5 space-y-4"><div><div className="flex flex-wrap items-center gap-2"><p className="break-words text-sm font-semibold text-slate-100">{selected.title}</p><span className={cn("rounded-full border px-2 py-1 text-[9px] font-semibold", toneStyles[statusTone(selected.status)].badge)}>{statusLabel(selected.status)}</span></div><p className="mt-1 font-mono text-[10px] text-slate-600">{selected.id} · versione {selected.version}</p></div><div className="grid grid-cols-2 gap-2"><div className="rounded-xl border border-white/[.07] bg-black/20 p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">VALORE</p><p className="mt-1 font-mono text-sm text-lime-100">{formatAmount(selected.amountMilli, selected.currency)}</p></div><div className="rounded-xl border border-white/[.07] bg-black/20 p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">SISTEMA COLLEGATO</p><p className={cn("mt-1 text-[10px] font-semibold", selected.externalStatus === "EXTERNAL_DEFERRED" ? "text-amber-100" : "text-lime-100")}>{externalStatusLabel(selected.externalStatus)}</p></div></div>{selected.jobId && <div className="rounded-xl border border-white/[.07] bg-black/20 p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">COMMESSA</p>{jobById.get(selected.jobId) ? <Link className="mt-1 block text-xs font-semibold text-lime-100 hover:text-lime-300" href={"/operations/" + encodeURIComponent(selected.jobId)}>{jobById.get(selected.jobId)?.code ?? selected.jobId} · {jobById.get(selected.jobId)?.title}<ArrowRight className="ml-1 inline size-3" /></Link> : <p className="mt-1 text-xs text-amber-200">Commessa non disponibile nel registro</p>}</div>}<div className="rounded-xl border border-white/[.07] bg-black/20 p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">CONTROPARTE</p><p className="mt-1 text-xs text-slate-300">{selected.supplier || "Non valorizzata"}</p><p className="mt-2 text-[10px] text-slate-600">Creato {formatDate(selected.createdAt)} · aggiornato {formatDate(selected.updatedAt)}</p></div>{isProcurement && selected.lines.length > 0 && <div className="rounded-xl border border-cyan-300/15 bg-cyan-300/[.035] p-3"><p className="text-[9px] uppercase tracking-[.14em] text-cyan-200/70">MATERIALE RICHIESTO</p>{selected.lines.map((line, index) => <p className="mt-1 text-xs text-slate-300" key={index}>{line.description || "Materiale"} · {formatLineQuantity(line)}</p>)}</div>}<div className="rounded-xl border border-white/[.07] bg-black/20 p-3"><div className="flex items-center justify-between text-[9px] uppercase tracking-[.14em] text-slate-600"><span>Avanzamento</span><span className="font-mono text-lime-200">{selected.progress}%</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-black/60"><span className="block h-full rounded-full bg-gradient-to-r from-lime-600 via-lime-300 to-lime-100" style={{ width: selected.progress + "%" }} /></div></div><div className="space-y-2"><p className="text-[9px] font-semibold uppercase tracking-[.16em] text-slate-600">Azioni disponibili</p>{selected.nextActions.map((action) => { const external = externalActions.has(action); const allowed = action === "approve" ? canApprove : canWrite; return external ? <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-300/15 bg-amber-300/[.035] px-3 py-2.5 text-[10px] text-amber-100" key={action}><span className="flex items-center gap-2"><ExternalLink className="size-3.5" />{actionLabels[action] ?? action}</span><span className="font-mono text-[9px] text-amber-200/70">ESTERNO</span></div> : <Button className="h-10 w-full justify-between border-lime-300/20 bg-lime-300/[.05] text-xs text-lime-100 hover:bg-lime-300/[.12]" disabled={saving || !allowed} key={action} onClick={() => void transition(action)} variant="outline"><span className="flex items-center gap-2">{action === "approve" ? <ShieldCheck className="size-3.5" /> : <ArrowRight className="size-3.5" />}{actionLabels[action] ?? action}</span><span className="text-[9px] opacity-60">{allowed ? "esegui" : "permesso"}</span></Button>; })}{selected.nextActions.length === 0 && <p className="rounded-xl border border-white/[.08] bg-black/20 p-3 text-xs text-slate-600">Nessuna azione disponibile.</p>}</div></div> : <div className="py-12 text-center"><FileCheck2 className="mx-auto size-8 text-slate-700" /><p className="mt-3 text-xs text-slate-500">Seleziona una voce per consultarne i dettagli.</p></div>}<div className="mt-5 rounded-xl border border-amber-300/20 bg-amber-300/[.05] p-3 text-[10px] leading-5 text-slate-500"><p className="flex items-center gap-2 text-amber-100"><LockKeyhole className="size-3.5" />Operazioni esterne</p><p className="mt-2">ZEROW gestisce proposta, approvazione e verifica. Emissione ordine, ricezione fisica e contabilizzazione attendono conferma del sistema collegato.</p></div></aside>
        </section>
        <section className="mt-4 grid gap-4 lg:grid-cols-3"><article className="carbon-card rounded-2xl p-4 sm:p-5 lg:col-span-2"><div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-2xl border border-lime-300/20 bg-lime-300/10 text-lime-200"><BriefcaseBusiness className="size-[18px]" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-lime-300/70">COLLEGAMENTI OPERATIVI</p><h2 className="mt-1 text-base font-semibold text-slate-100">Il valore resta legato all’operatività</h2></div></div><p className="mt-4 text-xs leading-6 text-slate-500">Una voce può essere generale oppure collegata a una commessa. Il dato economico resta leggibile insieme a documenti, materiali e lavoro reale, ma nessun passaggio esterno viene dato per eseguito.</p><div className="mt-4 grid gap-2 sm:grid-cols-3"><Link className="group rounded-xl border border-white/[.08] bg-black/20 p-3 hover:border-lime-300/25" href="/operations"><BriefcaseBusiness className="size-4 text-lime-200" /><p className="mt-3 text-[11px] font-semibold text-slate-200">Commesse</p><p className="mt-1 text-[10px] leading-4 text-slate-600">Origine e perimetro di spesa.</p><ChevronRight className="mt-3 size-3.5 text-slate-700 group-hover:text-lime-200" /></Link><Link className="group rounded-xl border border-white/[.08] bg-black/20 p-3 hover:border-cyan-300/25" href="/warehouse"><Layers3 className="size-4 text-cyan-200" /><p className="mt-3 text-[11px] font-semibold text-slate-200">Magazzino</p><p className="mt-1 text-[10px] leading-4 text-slate-600">Fabbisogni e materiali collegati.</p><ChevronRight className="mt-3 size-3.5 text-slate-700 group-hover:text-cyan-200" /></Link><Link className="group rounded-xl border border-white/[.08] bg-black/20 p-3 hover:border-lime-300/25" href="/documents"><FileText className="size-4 text-lime-200" /><p className="mt-3 text-[11px] font-semibold text-slate-200">Documenti</p><p className="mt-1 text-[10px] leading-4 text-slate-600">Evidenze e provenienza.</p><ChevronRight className="mt-3 size-3.5 text-slate-700 group-hover:text-lime-200" /></Link></div></article><article className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-2xl border border-amber-300/20 bg-amber-300/10 text-amber-200"><ShieldCheck className="size-[18px]" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-amber-200/70">W10 / APPROVAZIONI</p><h2 className="mt-1 text-base font-semibold text-slate-100">Regole di approvazione</h2></div></div><div className="mt-4 space-y-3 text-[10px] leading-5 text-slate-500"><p className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-lime-200" />{canApprove ? "Il tuo ruolo può approvare le voci in revisione." : "L’approvazione richiede un ruolo autorizzato."}</p><p className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-lime-200" />Ogni modifica è controllata dal server e non viene duplicata se inviata più volte.</p><p className="flex items-start gap-2"><AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-200" />Contabilità, ordini, ricezioni e pagamenti attendono la conferma del sistema collegato.</p></div><div className="mt-5 grid grid-cols-2 gap-2"><span className="rounded-xl border border-lime-300/20 bg-lime-300/[.05] px-3 py-2 text-center font-mono text-[9px] text-lime-200">APPROVAZIONE</span><span className="rounded-xl border border-amber-300/20 bg-amber-300/[.05] px-3 py-2 text-center font-mono text-[9px] text-amber-200">IN ATTESA ESTERNA</span></div></article></section>
        <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/[.08] py-5 text-[10px] text-slate-600"><span>AI-ZEROW · {moduleLabel.toUpperCase()}</span><span className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-lime-300" />Ambiente privato · operazioni esterne non simulate</span></footer>
      </div><CommandMobileNav active="more" allowedNavigation={allowedNavigation} role={context?.role} roles={context?.roles} />
    </section>
  </div>{notice && <button className="fixed bottom-5 right-5 z-50 max-w-[380px] rounded-xl border border-lime-300/25 bg-[#0a100c]/95 px-4 py-3 text-left text-xs text-lime-100 shadow-[0_0_28px_rgba(190,255,60,0.14)]" onClick={() => setNotice("")} type="button"><Check className="mr-2 inline size-4 text-lime-300" />{notice}</button>}
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}><DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto border-lime-300/20 bg-[#080c09] text-slate-100 sm:max-w-[720px]"><form className="space-y-4" onSubmit={createWorkflow}><DialogHeader><DialogTitle>{isProcurement ? "Nuova richiesta di acquisto" : "Nuova voce finanziaria"}</DialogTitle><DialogDescription className="text-slate-500">La proposta entra nel registro ZEROW. Da questa schermata non partono ordini, pagamenti o scritture contabili esterne.</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2"><label className="text-xs text-slate-400 sm:col-span-2">Titolo<Input autoFocus className="mt-2 border-white/10 bg-black/30" onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder={isProcurement ? "Materiale per commessa" : "Costo trasporto / fornitore"} value={form.title} required /></label><label className="text-xs text-slate-400">Importo totale (EUR)<Input className="mt-2 border-white/10 bg-black/30" inputMode="decimal" min="0" onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="0,00" step="0.001" type="number" value={form.amount} required /></label><label className="text-xs text-slate-400">Controparte / fornitore<Input className="mt-2 border-white/10 bg-black/30" onChange={(event) => setForm({ ...form, supplier: event.target.value })} placeholder="Facoltativo" value={form.supplier} /></label><label className="text-xs text-slate-400 sm:col-span-2">Commessa collegata<select aria-label="Commessa collegata" className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-slate-100 outline-none focus:border-lime-300/40" onChange={(event) => setForm({ ...form, jobId: event.target.value })} value={form.jobId}><option value="">Voce generale · nessuna commessa</option>{jobs.map((job) => <option key={job.id} value={job.id}>{job.code ? job.code + " · " : ""}{job.title}{job.location ? " · " + job.location : ""}</option>)}</select><span className="mt-1 block text-[10px] text-slate-600">Il riferimento viene scelto dal readback server, non digitato.</span></label>{isProcurement && <ProcurementLinesEditor lines={form.lines} onChange={(lines) => setForm({ ...form, lines })} />}<label className="text-xs text-slate-400 sm:col-span-2">Dettaglio operativo<Textarea className="mt-2 min-h-24 border-white/10 bg-black/30" onChange={(event) => setForm({ ...form, detail: event.target.value })} placeholder="Contesto, evidenza, righe o nota…" value={form.detail} /></label></div><div className="rounded-xl border border-amber-300/15 bg-amber-300/[.035] p-3 text-[10px] leading-5 text-amber-100/80"><LockKeyhole className="mr-1.5 inline size-3.5" />ZEROW registra proposta, approvazione, versioni ed eventi. Il sistema collegato resta in attesa di conferma.</div><DialogFooter><DialogClose asChild><Button className="border-white/10 bg-transparent text-slate-400" type="button" variant="outline">Annulla</Button></DialogClose><Button className="bg-lime-300 text-[#050705] hover:bg-lime-200" disabled={saving || !canWrite} type="submit">{saving ? <LoaderCircle className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}Crea e rileggi</Button></DialogFooter></form></DialogContent></Dialog>
  </main>;
}
