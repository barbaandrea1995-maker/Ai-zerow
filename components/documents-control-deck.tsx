"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  ArrowRight,
  Bell,
  BriefcaseBusiness,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  CloudUpload,
  Download,
  FileArchive,
  FileCheck2,
  FileText,
  FolderOpen,
  Info,
  Layers3,
  LockKeyhole,
  Menu,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react";
import { AccountMenu } from "@/components/account-menu";
import { CommandMobileNav } from "@/components/command-mobile-nav";
import { TenantSwitcher } from "@/components/tenant-switcher";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { getAllowedCommandNavigation, type CommandNavigationId } from "@/lib/command-dashboard";

type Tone = "lime" | "cyan" | "amber" | "red" | "muted";
type SecurityAction = "queue_scan" | "manual_review" | "quarantine";

type DocumentJob = {
  id: string;
  code: string | null;
  title: string;
  client: string | null;
  location: string | null;
  status: string;
};

type DocumentRecord = {
  id: string;
  jobId: string;
  job: DocumentJob | null;
  category: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  storageStatus: string;
  scanStatus: string;
  provenance: string;
  status: string;
  version: number;
  downloadable: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  downloadUrl: string;
};

type DocumentsPayload = {
  context?: {
    actorName?: string;
    actorEmail?: string;
    role?: string;
    capabilities?: string[];
  };
  documents: DocumentRecord[];
  jobs: DocumentJob[];
  summary: { total: number; clean: number; pending: number; blocked: number; unscanned: number; linkedJobs: number };
  contract: { maxBytes: number; maxFileSizeLabel: string; security: string; extraction: string; directWrite: boolean };
  readback: { status: string; checkedAt: string };
};

type NavItem = { id: CommandNavigationId; label: string; path: string; capability: string; icon: LucideIcon };

const navItems: NavItem[] = [
  { id: "command", label: "CONTROL", path: "/command", capability: "command.read", icon: MessageSquareText },
  { id: "operations", label: "OPERATIONS", path: "/operations", capability: "operations.read", icon: BriefcaseBusiness },
  { id: "workforce", label: "WORKFORCE", path: "/workforce", capability: "workforce.read", icon: FileCheck2 },
  { id: "planning", label: "PIANIFICAZIONE", path: "/planning", capability: "planning.read", icon: FolderOpen },
  { id: "attendance", label: "PRESENZE", path: "/presenze", capability: "workforce.read", icon: CheckCircle2 },
  { id: "assets", label: "ASSET", path: "/assets", capability: "asset.read", icon: Archive },
  { id: "warehouse", label: "MAGAZZINO", path: "/warehouse", capability: "warehouse.read", icon: Layers3 },
  { id: "mission", label: "MISSIONI", path: "/mission", capability: "mission.read", icon: CloudUpload },
  { id: "documents", label: "DOCUMENTI", path: "/documents", capability: "documents.read", icon: FileText },
  { id: "authority", label: "AUTHORITY", path: "/onboarding", capability: "authority.read", icon: ShieldCheck },
  { id: "events", label: "EVENTI", path: "/events", capability: "events.read", icon: Info },
  { id: "settings", label: "IMPOSTAZIONI", path: "/settings", capability: "settings.read", icon: SlidersHorizontal },
];

const categoryOptions = ["PREVENTIVO", "CONTRATTO", "TECNICO", "POD", "AUTORIZZAZIONE", "FOTO", "ALTRO"];
const accept = ".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.jpg,.jpeg,.png,.webp,.heic,.heif";

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Amministratore",
  manager: "Manager",
  office: "Ufficio",
  technical: "Tecnico",
  field_supervisor: "Caposquadra",
  worker: "Operatore",
  warehouse_manager: "Responsabile magazzino",
  warehouse_operator: "Magazziniere",
  driver: "Autista",
  maintenance: "Manutentore",
  auditor: "Auditor",
};

const toneStyles: Record<Tone, { icon: string; badge: string }> = {
  lime: { icon: "text-lime-200", badge: "border-lime-300/25 bg-lime-300/10 text-lime-100" },
  cyan: { icon: "text-cyan-200", badge: "border-cyan-300/25 bg-cyan-300/10 text-cyan-100" },
  amber: { icon: "text-amber-200", badge: "border-amber-300/25 bg-amber-300/10 text-amber-100" },
  red: { icon: "text-rose-200", badge: "border-rose-300/25 bg-rose-300/10 text-rose-100" },
  muted: { icon: "text-slate-400", badge: "border-white/10 bg-white/[.03] text-slate-400" },
};

function cn(...values: Array<string | false | null | undefined>) { return values.filter(Boolean).join(" "); }

function formatDate(value: unknown) {
  if (typeof value !== "string" || !value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
}

function sizeLabel(bytes: number) {
  if (!Number.isFinite(bytes)) return "—";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
  return (bytes / 1024 / 1024).toFixed(2) + " MB";
}

function roleLabel(role: string) { return ROLE_LABELS[role] ?? role; }

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    AVAILABLE_CLEAN: "DISPONIBILE / CLEAN",
    AVAILABLE_UNSCANNED: "DISPONIBILE / NON SCANSIONATO",
    QUARANTINED_PENDING_SCAN: "QUARANTENA / IN CODA",
    QUARANTINED_REVIEW: "QUARANTENA / REVISIONE",
    QUARANTINED: "QUARANTENA",
    BLOCKED_MALWARE: "BLOCCATO",
    REGISTERED: "REGISTRATO",
  };
  return labels[status] ?? status.replaceAll("_", " ");
}

function statusTone(document: DocumentRecord): Tone {
  if (document.downloadable || document.status === "AVAILABLE_UNSCANNED") return document.downloadable ? "lime" : "amber";
  if (document.status.includes("BLOCKED")) return "red";
  if (document.status.includes("QUARANTINED") || document.scanStatus === "MANUAL_REVIEW") return "amber";
  return "muted";
}

function IconButton({ label, children, onClick, className = "" }: { label: string; children: ReactNode; onClick?: () => void; className?: string }) {
  return <button aria-label={label} className={cn("grid size-9 place-items-center rounded-lg border border-white/10 bg-black/20 text-slate-500 transition hover:border-lime-300/35 hover:bg-lime-300/10 hover:text-lime-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300", className)} onClick={onClick} type="button">{children}</button>;
}

function StatusPill({ document }: { document: DocumentRecord }) {
  const tone = statusTone(document);
  return <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[9px] font-semibold uppercase tracking-[.05em]", toneStyles[tone].badge)}><span className="size-1.5 rounded-full bg-current shadow-[0_0_8px_currentColor]" />{statusLabel(document.status)}</span>;
}

function KpiCard({ label, value, detail, icon: Icon, tone }: { label: string; value: number | string; detail: string; icon: LucideIcon; tone: Tone }) {
  return <article className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><span className={cn("grid size-10 place-items-center rounded-xl border border-current/20 bg-current/10", toneStyles[tone].icon)}><Icon className="size-[18px]" /></span><span className="font-mono text-[10px] text-slate-600">D1</span></div><p className="mt-5 text-[11px] font-semibold uppercase tracking-[.16em] text-slate-600">{label}</p><p className="mt-2 font-mono text-[32px] font-semibold leading-none tracking-[-.07em] text-slate-50">{value}</p><p className="mt-4 text-[11px] text-slate-600">{detail}</p></article>;
}

export default function DocumentsControlDeck() {
  const router = useRouter();
  const [payload, setPayload] = useState<DocumentsPayload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "forbidden" | "error">("loading");
  const [refreshing, setRefreshing] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [selectedId, setSelectedId] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadJobId, setUploadJobId] = useState("");
  const [uploadCategory, setUploadCategory] = useState("PREVENTIVO");
  const [selectedFileName, setSelectedFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [securityBusy, setSecurityBusy] = useState("");
  const [notice, setNotice] = useState("");

  const notify = useCallback((message: string) => { setNotice(message); window.setTimeout(() => setNotice(""), 4800); }, []);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/documents/catalog", { cache: "no-store" });
      if (response.status === 403) { setState("forbidden"); return; }
      const next = await response.json() as DocumentsPayload & { error?: string };
      if (!response.ok) throw new Error(next.error ?? "document_catalog_unavailable");
      setPayload(next);
      setSelectedId((current) => current && next.documents.some((document) => document.id === current) ? current : next.documents[0]?.id ?? "");
      setState("ready");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Registro documenti non disponibile.");
      setState((current) => current === "ready" ? current : "error");
    } finally { setRefreshing(false); }
  }, [notify]);

  useEffect(() => { const timer = window.setTimeout(() => void refresh(), 0); return () => window.clearTimeout(timer); }, [refresh]);

  const context = payload?.context;
  const capabilities = useMemo(() => context?.capabilities ?? ["documents.read"], [context]);
  const allowedNavigation = useMemo(() => getAllowedCommandNavigation(capabilities).map((item) => item.id), [capabilities]);
  const visibleNavItems = useMemo(() => navItems.filter((item) => allowedNavigation.includes(item.id) || capabilities.includes(item.capability)), [allowedNavigation, capabilities]);
  const canWrite = capabilities.includes("documents.write");
  const actor = { email: context?.actorEmail ?? "operator@zerow.local", name: context?.actorName ?? "Operatore" };
  const documents = useMemo(() => payload?.documents ?? [], [payload?.documents]);
  const filteredDocuments = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return documents.filter((document) => {
      const haystack = [document.fileName, document.category, document.mimeType, document.status, document.scanStatus, document.job?.code, document.job?.title, document.job?.client, document.job?.location].join(" ").toLowerCase();
      const statusMatch = statusFilter === "ALL" || document.status === statusFilter || document.scanStatus === statusFilter;
      return (!normalized || haystack.includes(normalized)) && (categoryFilter === "ALL" || document.category === categoryFilter) && statusMatch;
    });
  }, [categoryFilter, documents, query, statusFilter]);
  const selected = documents.find((document) => document.id === selectedId) ?? filteredDocuments[0] ?? null;

  function navigate(path: string) { setMobileMenu(false); router.push(path); }
  function goBack() { if (window.history.length > 1) router.back(); else router.push("/command"); }
  function openUpload() { setUploadJobId(payload?.jobs[0]?.id ?? ""); setUploadCategory("PREVENTIVO"); setSelectedFileName(""); setUploadOpen(true); }

  const mutateSecurity = useCallback(async (document: DocumentRecord, action: SecurityAction) => {
    setSecurityBusy(document.id + ":" + action);
    try {
      const response = await fetch("/api/documents/" + encodeURIComponent(document.id) + "/security", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, idempotencyKey: "documents-security-" + action + "-" + document.id + "-" + crypto.randomUUID() }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) { notify("Sicurezza non aggiornata: " + (result.error ?? "errore")); return; }
      await refresh();
      notify(action === "queue_scan" ? "Documento isolato e messo in coda provider." : action === "manual_review" ? "Documento inviato alla revisione manuale." : "Documento isolato manualmente.");
    } catch { notify("Connessione non disponibile: nessuna transizione confermata."); }
    finally { setSecurityBusy(""); }
  }, [notify, refresh]);

  async function submitUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!uploadJobId) { notify("Seleziona la commessa di destinazione."); return; }
    const form = new FormData(event.currentTarget);
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) { notify("Seleziona un file."); return; }
    if (file.size > (payload?.contract.maxBytes ?? 20 * 1024 * 1024)) { notify("Il file supera il limite di 20 MB."); return; }
    form.set("category", uploadCategory);
    form.set("idempotencyKey", "document-upload-" + crypto.randomUUID());
    setBusy(true);
    try {
      const response = await fetch("/api/operations/jobs/" + encodeURIComponent(uploadJobId) + "/documents", { method: "POST", body: form });
      const result = await response.json() as { document?: { id?: string }; error?: string };
      if (!response.ok) { notify("Upload non eseguito: " + (result.error ?? "errore")); return; }
      await refresh();
      if (result.document?.id) setSelectedId(result.document.id);
      setUploadOpen(false);
      notify("Documento registrato, hash verificato e disponibilità mantenuta sotto security hold.");
    } catch { notify("Upload non disponibile: nessun documento confermato."); }
    finally { setBusy(false); }
  }

  if (state === "loading" && !payload) return <main className="grid min-h-screen place-items-center bg-[#030504] text-sm text-slate-500"><span className="flex items-center gap-3"><RefreshCw className="size-4 animate-spin text-lime-300" />Allineamento document control…</span></main>;
  if (state === "forbidden") return <main className="grid min-h-screen place-items-center bg-[#030504] px-5 text-slate-100"><section className="carbon-card max-w-lg rounded-3xl p-7 text-center"><ShieldCheck className="mx-auto size-8 text-amber-200" /><h1 className="mt-4 text-lg font-semibold">Documenti non visibili</h1><p className="mt-2 text-sm text-slate-500">Il ruolo corrente non dispone della capability documents.read.</p><Button className="mt-5 bg-lime-300 text-[#050705] hover:bg-lime-200" onClick={() => router.push("/command")}>Torna al Command</Button></section></main>;
  if (state === "error" && !payload) return <main className="grid min-h-screen place-items-center bg-[#030504] text-slate-100"><section className="carbon-card rounded-2xl p-7 text-center"><CircleAlert className="mx-auto size-7 text-amber-200" /><p className="mt-3 text-sm text-slate-300">Catalogo documenti non disponibile</p><Button className="mt-4 bg-lime-300 text-[#050705] hover:bg-lime-200" onClick={() => void refresh()}><RefreshCw className="size-4" />Riprova</Button></section></main>;

  return <main className="zw-app-shell zw-documents-module min-h-screen overflow-x-hidden text-slate-100 selection:bg-lime-300 selection:text-[#060806]"><div className="zw-command-ambient" aria-hidden="true" /><div className="relative flex min-h-screen">
    <aside className={cn("zw-command-sidebar fixed inset-y-0 left-0 z-40 flex flex-col px-3 py-4 transition-[width,transform] lg:static lg:translate-x-0", sidebarCollapsed ? "is-collapsed lg:w-[76px]" : "lg:w-[248px]", mobileMenu ? "translate-x-0" : "-translate-x-full")}>
      <div className="flex items-center justify-between px-2"><button aria-label="Apri Command" className="flex min-w-0 items-center gap-3 text-left" onClick={() => navigate("/command")} type="button"><span className="neon-pulse relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black shadow-[0_0_22px_rgba(200,255,34,.12)]"><Image src="/ai-zerow-icon.jpeg" alt="AI-ZEROW" width={40} height={40} className="size-full object-cover" /></span><span className="zw-command-sidebar__brand-copy min-w-0"><span className="block text-sm font-bold tracking-[.18em] text-slate-50">AI-ZEROW</span><span className="block text-[10px] uppercase tracking-[.22em] text-lime-300/75">command</span></span></button><div className="flex items-center gap-1"><IconButton label={sidebarCollapsed ? "Espandi sidebar" : "Riduci sidebar"} className="hidden lg:grid" onClick={() => setSidebarCollapsed((value) => !value)}>{sidebarCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}</IconButton><IconButton label="Chiudi menu" className="lg:hidden" onClick={() => setMobileMenu(false)}><X className="size-4" /></IconButton></div></div>
      <div className="zw-command-tenant mt-7 flex items-center gap-3 rounded-2xl p-3"><span className="grid size-9 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/10 text-lime-200"><FileArchive className="size-4" /></span><span className="zw-command-sidebar__tenant-copy min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-slate-200">ZEROW workspace</span><span className="mt-0.5 block truncate text-[10px] uppercase tracking-[.1em] text-slate-600">{roleLabel(context?.role ?? "operator")} · tenant scoped</span></span></div>
      <nav className="mt-6 min-h-0 flex-1 overflow-y-auto" aria-label="Navigazione principale"><p className="zw-command-sidebar__nav-caption px-3 text-[9px] font-semibold uppercase tracking-[.22em] text-slate-700">Authorized workspace</p><div className="mt-2 space-y-1">{visibleNavItems.map((item) => { const Icon = item.icon; const active = item.id === "documents"; return <button aria-current={active ? "page" : undefined} aria-label={sidebarCollapsed ? item.label : undefined} className={cn("zw-command-nav-item", active && "is-active")} key={item.id} onClick={() => navigate(item.path)} title={sidebarCollapsed ? item.label : undefined} type="button"><Icon className={cn("size-4", active ? "text-lime-200" : "text-slate-600")} /><span className="zw-command-sidebar__nav-label">{item.label}</span>{item.id === "command" && <span className="zw-command-sidebar__nav-badge ml-auto rounded border border-lime-300/20 px-1.5 py-0.5 font-mono text-[8px] tracking-[.08em] text-lime-200">AI</span>}</button>; })}</div></nav>
      <div className="zw-command-sidebar__footer mt-4 border-t border-white/[.07] pt-4"><div className="flex items-center justify-between px-2 text-[9px] uppercase tracking-[.14em] text-slate-600"><span>System core</span><span className="flex items-center gap-1.5 text-lime-200"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_8px_rgba(200,255,34,.8)]" />D1 ONLINE</span></div><div className="carbon-inset mt-3 rounded-xl p-3"><div className="flex items-center gap-2 text-[11px] text-slate-400"><ShieldCheck className="size-3.5 text-lime-300" />Evidence register</div><p className="mt-2 font-mono text-[10px] text-slate-600">{documents.length} documenti · {payload?.summary.linkedJobs ?? 0} commesse</p><p className="mt-3 font-mono text-[10px] text-slate-600">Sites · D1 + R2</p></div></div>
    </aside>
    <section className="min-w-0 flex-1"><header className="zw-command-topbar sticky top-0 z-20 flex h-[72px] items-center gap-3 px-4 sm:gap-5 sm:px-7"><IconButton className="lg:hidden" label="Apri menu" onClick={() => setMobileMenu(true)}><Menu className="size-4" /></IconButton><button aria-label="Apri Documenti" className="zw-command-topbar__brand flex shrink-0 items-center gap-2 text-left" onClick={() => navigate("/documents")} type="button"><span className="relative grid size-9 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black shadow-[0_0_18px_rgba(200,255,34,.12)]"><Image src="/ai-zerow-icon.jpeg" alt="ZEROW" width={36} height={36} className="size-full object-cover" /></span><span className="hidden sm:block"><span className="block text-[11px] font-bold tracking-[.18em] text-slate-50">ZEROW</span><span className="block text-[10px] uppercase tracking-[.2em] text-lime-300/75">document control</span></span></button><IconButton className="hidden lg:grid" label={sidebarCollapsed ? "Espandi sidebar" : "Riduci sidebar"} onClick={() => setSidebarCollapsed((value) => !value)}>{sidebarCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}</IconButton><div className="relative hidden min-w-0 flex-1 justify-center md:flex"><div className="relative w-full max-w-[520px]"><Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-600" /><Input aria-label="Cerca documenti" className="h-10 w-full border-lime-300/10 bg-black/35 pl-10 text-xs text-slate-100 placeholder:text-slate-600" onChange={(event) => setQuery(event.target.value)} placeholder="Cerca file, commessa, hash, categoria…" value={query} /></div></div><div className="flex min-w-0 flex-1 items-center gap-2 md:hidden"><span className="truncate text-xs font-semibold tracking-[.14em] text-slate-200">DOCUMENT CONTROL</span><span className="size-1 rounded-full bg-lime-300" /></div><div className="ml-auto flex min-w-0 items-center gap-2"><TenantSwitcher /><span className="hidden items-center gap-2 rounded-full border border-lime-300/20 bg-lime-300/5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[.12em] text-lime-200 sm:flex"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_9px_rgba(200,255,34,.9)]" />{refreshing ? "READING" : "D1 VERIFIED"}</span><IconButton label="Torna indietro" onClick={goBack}><ArrowLeft className="size-4" /></IconButton><IconButton label="Aggiorna documenti" onClick={() => void refresh()}><RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} /></IconButton>{capabilities.includes("communication.read") && <IconButton label="Apri comunicazioni" onClick={() => navigate("/communications")}><Bell className="size-4" /></IconButton>}<AccountMenu actor={actor} /></div></header>
      <div className="mx-auto max-w-[1680px] px-4 py-5 pb-24 sm:px-7 sm:py-7 lg:pb-8"><section className="zw-module-hero relative overflow-hidden rounded-[26px] p-5 sm:p-7"><div className="relative z-[1] max-w-4xl"><p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.22em] text-lime-300/80"><FileArchive className="size-3.5" />CONTROL DECK / MODULE 09 · DOCUMENTS + EVIDENCE</p><h1 className="mt-3 max-w-4xl text-3xl font-semibold tracking-[-.06em] text-slate-50 sm:text-[46px]">Every file has a<br /><span className="text-lime-300">chain of custody.</span></h1><p className="mt-4 max-w-3xl text-sm leading-6 text-slate-400">Registro documentale tenant-scoped: commessa obbligatoria, hash server-side, provenance e download governato. Il sistema distingue ciò che è archiviato da ciò che è realmente verificato.</p><div className="mt-5 flex flex-wrap gap-2"><Button className="bg-lime-300 text-[11px] font-semibold text-[#050705] hover:bg-lime-200" disabled={!canWrite || !payload?.jobs.length} onClick={openUpload}><Upload className="size-3.5" />Carica documento</Button><Link className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-lime-300/25 bg-lime-300/[.05] px-3 py-2 text-[11px] font-semibold text-lime-100 hover:bg-lime-300/10" href="/operations"><BriefcaseBusiness className="size-3.5" />Apri Company AI / commesse</Link><Link className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[11px] text-slate-400 hover:border-lime-300/25 hover:text-lime-100" href="#security-boundary"><ShieldCheck className="size-3.5" />Security boundary</Link></div></div><div className="absolute -right-16 -top-20 size-[24rem] rounded-full bg-lime-300/[.07] blur-3xl" /><div className="absolute bottom-0 right-8 hidden w-[300px] lg:block"><div className="relative h-28 overflow-hidden rounded-t-[26px] border border-lime-300/20 bg-black/25 p-4"><div className="absolute inset-x-0 top-1/2 border-t border-dashed border-lime-300/25" /><div className="absolute left-[18%] top-[42%] size-3 rounded-full bg-cyan-200 shadow-[0_0_18px_rgba(89,217,255,.75)]" /><div className="absolute right-[18%] top-[42%] size-3 rounded-full bg-lime-300 shadow-[0_0_18px_rgba(200,255,34,.8)]" /><FileText className="absolute left-1/2 top-[28%] size-8 -translate-x-1/2 text-lime-300/70" /><p className="absolute bottom-3 left-4 text-[9px] uppercase tracking-[.16em] text-slate-600">EVIDENCE GRAPH · SCHEMATIC</p><p className="absolute bottom-3 right-4 font-mono text-[9px] text-amber-200/70">SCAN PROVIDER GATED</p></div></div><div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-lime-300/55 to-transparent" /></section>
        <section className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6"><KpiCard label="Totali" value={payload?.summary.total ?? 0} detail="Documenti nel tenant" icon={FileArchive} tone="lime" /><KpiCard label="Clean" value={payload?.summary.clean ?? 0} detail="Download consentito" icon={CheckCircle2} tone="lime" /><KpiCard label="In revisione" value={payload?.summary.pending ?? 0} detail="Provider o revisione umana" icon={ShieldCheck} tone="amber" /><KpiCard label="Non scansionati" value={payload?.summary.unscanned ?? 0} detail="Disponibili solo con hold" icon={AlertTriangle} tone="amber" /><KpiCard label="Bloccati" value={payload?.summary.blocked ?? 0} detail="Quarantena o malware" icon={LockKeyhole} tone="red" /><KpiCard label="Commesse" value={payload?.summary.linkedJobs ?? 0} detail="Collegamenti verificati" icon={BriefcaseBusiness} tone="cyan" /></section>
        <section className="mt-4 grid gap-4 2xl:grid-cols-[minmax(0,1.25fr)_minmax(330px,.75fr)]"><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-lime-300/70">DOCUMENT REGISTER</p><h2 className="mt-1 text-base font-semibold text-slate-100">Registro documentale operativo</h2><p className="mt-1 text-[11px] text-slate-500">Solo file reali del tenant e collegati a una commessa reale.</p></div><span className="rounded-full border border-lime-300/20 bg-lime-300/[.06] px-2.5 py-1.5 font-mono text-[9px] text-lime-200">{filteredDocuments.length} / {documents.length}</span></div><div className="mt-4 grid gap-2 md:grid-cols-[minmax(0,1fr)_170px_170px]"><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-600" /><Input aria-label="Filtra registro documenti" className="h-10 border-white/10 bg-black/25 pl-9 text-xs text-slate-100 placeholder:text-slate-600" onChange={(event) => setQuery(event.target.value)} placeholder="Nome, commessa o hash…" value={query} /></div><select aria-label="Filtra categoria" className="h-10 rounded-xl border border-white/10 bg-black/25 px-3 text-xs text-slate-200 outline-none focus:border-lime-300/40" onChange={(event) => setCategoryFilter(event.target.value)} value={categoryFilter}><option value="ALL">Tutte le categorie</option>{categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}</select><select aria-label="Filtra stato" className="h-10 rounded-xl border border-white/10 bg-black/25 px-3 text-xs text-slate-200 outline-none focus:border-lime-300/40" onChange={(event) => setStatusFilter(event.target.value)} value={statusFilter}><option value="ALL">Tutti gli stati</option><option value="AVAILABLE_CLEAN">Clean</option><option value="AVAILABLE_UNSCANNED">Non scansionato</option><option value="PENDING_PROVIDER">In coda provider</option><option value="MANUAL_REVIEW">Revisione umana</option><option value="BLOCKED_MALWARE">Bloccato</option></select></div><div className="mt-4 space-y-2">{filteredDocuments.map((document) => { const selectedRow = selected?.id === document.id; return <button className={cn("group flex w-full items-center gap-3 rounded-xl border p-3 text-left transition", selectedRow ? "border-lime-300/35 bg-lime-300/[.065] shadow-[0_0_24px_rgba(200,255,34,.06)]" : "border-white/[.07] bg-black/20 hover:border-lime-300/25 hover:bg-lime-300/[.03]")} key={document.id} onClick={() => setSelectedId(document.id)} type="button"><span className={cn("grid size-10 shrink-0 place-items-center rounded-xl border border-current/20 bg-current/10", toneStyles[statusTone(document)].icon)}><FileText className="size-[18px]" /></span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="truncate text-xs font-semibold text-slate-100">{document.fileName}</span><StatusPill document={document} /></span><span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-600"><span>{document.category}</span><span>{document.job?.code ?? document.jobId}</span><span>{sizeLabel(document.sizeBytes)}</span><span>v{document.version}</span></span></span><ChevronRight className={cn("size-4 shrink-0", selectedRow ? "text-lime-200" : "text-slate-700")} /></button>; })}{filteredDocuments.length === 0 && <div className="rounded-xl border border-dashed border-white/10 p-10 text-center"><FileArchive className="mx-auto size-7 text-slate-700" /><p className="mt-3 text-xs text-slate-500">Nessun documento corrisponde ai filtri.</p><p className="mt-1 text-[10px] text-slate-700">Il registro non crea placeholder e non importa testo libero.</p></div>}</div></section>
          <aside className="carbon-card-neon rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-lime-300/70">DOCUMENT INSPECTOR</p><h2 className="mt-1 text-base font-semibold text-slate-100">Provenance e accesso</h2></div><span className="grid size-9 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/10 text-lime-200"><ShieldCheck className="size-[18px]" /></span></div>{selected ? <div className="mt-5 space-y-4"><div><p className="break-all text-sm font-semibold text-slate-100">{selected.fileName}</p><p className="mt-1 text-[10px] text-slate-600">{selected.mimeType} · {sizeLabel(selected.sizeBytes)} · versione {selected.version}</p><div className="mt-3"><StatusPill document={selected} /></div></div><div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-1"><div className="rounded-xl border border-white/[.07] bg-black/20 p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">COMMESSA</p>{selected.job ? <Link className="mt-1 block text-xs font-semibold text-lime-100 hover:text-lime-300" href={"/operations/" + encodeURIComponent(selected.job.id)}>{selected.job.code ?? selected.job.id} · {selected.job.title}<ArrowRight className="ml-1 inline size-3" /></Link> : <p className="mt-1 text-xs text-amber-200">Collegamento non riletto</p>}<p className="mt-1 text-[10px] text-slate-600">{selected.job?.client ?? "Cliente non valorizzato"} · {selected.job?.location ?? "Sede non valorizzata"}</p></div><div className="rounded-xl border border-white/[.07] bg-black/20 p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">INTEGRITÀ</p><p className="mt-1 break-all font-mono text-[9px] text-cyan-200/80">SHA-256 {selected.sha256}</p><p className="mt-2 text-[10px] text-slate-600">{selected.provenance} · {selected.storageStatus}</p></div></div><div className="grid grid-cols-2 gap-2 text-[10px]"><div className="rounded-xl border border-white/[.07] bg-black/20 p-3"><span className="text-slate-600">Registrato</span><strong className="mt-1 block font-mono text-slate-300">{formatDate(selected.createdAt)}</strong></div><div className="rounded-xl border border-white/[.07] bg-black/20 p-3"><span className="text-slate-600">Aggiornato</span><strong className="mt-1 block font-mono text-slate-300">{formatDate(selected.updatedAt)}</strong></div></div><div className="flex flex-wrap gap-2">{selected.downloadable ? <a className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-lime-300 px-3 py-2 text-[11px] font-semibold text-[#050705] hover:bg-lime-200" href={selected.downloadUrl}><Download className="size-3.5" />Scarica</a> : <span className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-amber-300/20 bg-amber-300/[.06] px-3 py-2 text-[11px] text-amber-100"><LockKeyhole className="size-3.5" />Download in hold</span>}{canWrite && !selected.downloadable && ["NOT_RUN", "MANUAL_REVIEW"].includes(selected.scanStatus) && <Button variant="outline" className="min-h-10 border-cyan-300/20 bg-cyan-300/[.04] text-[11px] text-cyan-100" disabled={Boolean(securityBusy)} onClick={() => void mutateSecurity(selected, "queue_scan")}><ShieldCheck className="size-3.5" />Avvia controllo</Button>}{canWrite && !selected.downloadable && selected.scanStatus === "PENDING_PROVIDER" && <Button variant="outline" className="min-h-10 border-cyan-300/20 bg-cyan-300/[.04] text-[11px] text-cyan-100" disabled={Boolean(securityBusy)} onClick={() => void mutateSecurity(selected, "manual_review")}><ShieldCheck className="size-3.5" />Revisione manuale</Button>}{canWrite && !selected.downloadable && !["INFECTED_PROVIDER", "QUARANTINED"].includes(selected.scanStatus) && <Button variant="outline" className="min-h-10 border-rose-300/20 bg-rose-300/[.04] text-[11px] text-rose-100" disabled={Boolean(securityBusy)} onClick={() => void mutateSecurity(selected, "quarantine")}><LockKeyhole className="size-3.5" />Isola</Button>}</div><div className="rounded-xl border border-white/[.07] bg-black/20 p-3 text-[10px] leading-5 text-slate-500"><p className="flex items-center gap-2 text-slate-300"><Info className="size-3.5 text-lime-200" />Security boundary</p><p className="mt-2">La firma del file e l’hash sono verificati dal server. Il download è consentito solo con esito provider-backed CLEAN; OCR e malware scan non vengono simulati.</p></div></div> : <div className="py-12 text-center"><FileText className="mx-auto size-8 text-slate-700" /><p className="mt-3 text-xs text-slate-500">Seleziona un documento per ispezionarlo.</p></div>}</aside>
        </section>
        <section className="mt-4 grid gap-4 lg:grid-cols-3"><article className="carbon-card rounded-2xl p-4 sm:p-5 lg:col-span-2"><div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-2xl border border-lime-300/20 bg-lime-300/10 text-lime-200"><Sparkles className="size-[18px]" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-lime-300/70">COMPANY AI HANDOFF</p><h2 className="mt-1 text-base font-semibold text-slate-100">Analisi governata, nel posto giusto</h2></div></div><p className="mt-4 text-xs leading-6 text-slate-500">Il registro archivia e protegge il file. La compilazione intelligente di una nuova commessa resta nel flusso Company AI di Operations, dove il documento può essere interpretato, lo scope può essere suggerito e l’operatore può approvare una preview senza scrittura diretta.</p><div className="mt-4 grid gap-2 sm:grid-cols-3"><div className="rounded-xl border border-lime-300/15 bg-lime-300/[.04] p-3"><p className="text-[9px] uppercase tracking-[.14em] text-lime-300/70">LINK</p><p className="mt-1 text-xs text-slate-300">Commessa reale obbligatoria</p></div><div className="rounded-xl border border-cyan-300/15 bg-cyan-300/[.04] p-3"><p className="text-[9px] uppercase tracking-[.14em] text-cyan-200/70">AI</p><p className="mt-1 text-xs text-slate-300">Preview Company AI separata</p></div><div className="rounded-xl border border-amber-300/15 bg-amber-300/[.04] p-3"><p className="text-[9px] uppercase tracking-[.14em] text-amber-200/70">OCR</p><p className="mt-1 text-xs text-slate-300">NOT RUN finché non collegato</p></div></div><Link className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-xl border border-lime-300/25 bg-lime-300/[.05] px-3 py-2 text-[11px] font-semibold text-lime-100 hover:bg-lime-300/10" href="/operations">Apri percorso commessa / Company AI <ArrowRight className="size-3.5" /></Link></article><article className="carbon-card rounded-2xl p-4 sm:p-5" id="security-boundary"><div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-2xl border border-amber-300/20 bg-amber-300/10 text-amber-200"><ShieldCheck className="size-[18px]" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-amber-200/70">SECURITY CONTRACT</p><h2 className="mt-1 text-base font-semibold text-slate-100">Nessuna certificazione inventata</h2></div></div><div className="mt-4 space-y-3 text-[10px] leading-5 text-slate-500"><div className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-lime-200" /><span>Firma e SHA-256 verificati nel confine Sites.</span></div><div className="flex items-start gap-2"><LockKeyhole className="mt-0.5 size-3.5 shrink-0 text-amber-200" /><span>Download solo con CLEAN provider-backed.</span></div><div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-200" /><span>Provider malware e OCR esterni restano gate espliciti.</span></div></div><div className="mt-5 grid grid-cols-2 gap-2"><span className="rounded-xl border border-lime-300/20 bg-lime-300/[.05] px-3 py-2 text-center font-mono text-[9px] text-lime-200">20 MB MAX</span><span className="rounded-xl border border-amber-300/20 bg-amber-300/[.05] px-3 py-2 text-center font-mono text-[9px] text-amber-200">FAIL-CLOSED</span></div></article></section>
        <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/[.08] py-5 text-[10px] text-slate-600"><span>AI-ZEROW COMMAND · W09 / DOCUMENT CONTROL</span><span className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-lime-300" />Sites private · tenant scoped · security provider deferred</span></footer>
      </div><CommandMobileNav active="more" allowedNavigation={allowedNavigation} role={context?.role} />
    </section>
  </div>{notice && <button className="fixed bottom-5 right-5 z-50 max-w-[380px] rounded-xl border border-lime-300/25 bg-[#0a100c]/95 px-4 py-3 text-left text-xs text-lime-100 shadow-[0_0_28px_rgba(190,255,60,0.14)]" onClick={() => setNotice("")} type="button">{notice}</button>}
    <Dialog open={uploadOpen} onOpenChange={setUploadOpen}><DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto border-lime-300/20 bg-[#080c09] text-slate-100 sm:max-w-[660px]"><form className="space-y-4" onSubmit={submitUpload}><DialogHeader><DialogTitle>Registra documento operativo</DialogTitle><DialogDescription className="text-slate-500">Il file viene collegato a una commessa reale, validato per tipo e firma, hashato server-side e salvato con security hold.</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2"><label className="text-xs text-slate-400 sm:col-span-2">Commessa di destinazione<select aria-label="Commessa di destinazione" className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-slate-100 outline-none focus:border-lime-300/40" onChange={(event) => setUploadJobId(event.target.value)} required value={uploadJobId}><option value="">Seleziona una commessa</option>{payload?.jobs.map((job) => <option key={job.id} value={job.id}>{job.code ? job.code + " · " : ""}{job.title}{job.location ? " · " + job.location : ""}</option>)}</select></label><label className="text-xs text-slate-400">Categoria<select aria-label="Categoria documento" className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-slate-100 outline-none focus:border-lime-300/40" onChange={(event) => setUploadCategory(event.target.value)} value={uploadCategory}>{categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}</select></label><div className="rounded-xl border border-white/[.07] bg-black/20 p-3 text-[10px] text-slate-500"><span className="block uppercase tracking-[.14em] text-slate-600">Limite</span><strong className="mt-1 block font-mono text-lime-200">{payload?.contract.maxFileSizeLabel ?? "20 MB"}</strong><span className="mt-1 block">PDF, Office, CSV, testo e immagini supportate.</span></div><label className="text-xs text-slate-400 sm:col-span-2">File<input aria-label="File documento" accept={accept} className="mt-2 block h-12 w-full cursor-pointer rounded-xl border border-dashed border-lime-300/25 bg-black/25 px-3 py-3 text-xs text-slate-400 file:mr-3 file:rounded-lg file:border-0 file:bg-lime-300/10 file:px-3 file:py-1.5 file:text-[10px] file:font-semibold file:text-lime-100" name="file" onChange={(event) => setSelectedFileName(event.target.files?.[0]?.name ?? "")} required type="file" />{selectedFileName && <span className="mt-2 block truncate text-[10px] text-lime-200">{selectedFileName}</span>}</label></div><div className="rounded-xl border border-amber-300/15 bg-amber-300/[.035] p-3 text-[10px] leading-5 text-amber-100/80"><LockKeyhole className="mr-1.5 inline size-3.5" />Il documento non diventa scaricabile finché non esiste evidenza provider-backed CLEAN. L’upload non simula malware scan o OCR.</div><DialogFooter><DialogClose asChild><Button className="border-white/10 bg-transparent text-slate-400" type="button" variant="outline">Annulla</Button></DialogClose><Button className="bg-lime-300 text-[#050705] hover:bg-lime-200" disabled={busy || !canWrite} type="submit">{busy ? <RefreshCw className="size-3.5 animate-spin" /> : <CloudUpload className="size-3.5" />}Registra e rileggi</Button></DialogFooter></form></DialogContent></Dialog>
  </main>;
}
