"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import QRCode from "qrcode";
import {
  Activity,
  ArrowLeft,
  ArrowUpRight,
  Bell,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  Download,
  Gauge,
  HardHat,
  Layers3,
  LoaderCircle,
  Menu,
  MessageSquareText,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Printer,
  QrCode,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Truck,
  UserRound,
  Users,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { AccountMenu } from "@/components/account-menu";
import { AssetAssignmentDialog } from "@/components/asset-assignment-dialog";
import { CommandMobileNav } from "@/components/command-mobile-nav";
import { ServerNamingDialog } from "@/components/server-naming-dialog";
import { TenantSwitcher } from "@/components/tenant-switcher";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getAllowedCommandNavigation, type CommandNavigationId } from "@/lib/command-dashboard";

type Tone = "lime" | "cyan" | "amber" | "red" | "muted";
type LifecycleAction = "maintenance_open" | "maintenance_close" | "block" | "release";
type AssetFilter = "ALL" | "ASSET" | "VEHICLE" | "EQUIPMENT";
type LifecycleFilter = "ALL" | "AVAILABLE" | "MAINTENANCE" | "BLOCKED";

type AssetRecord = {
  id: string;
  canonicalCode?: string;
  title: string;
  detail: string;
  meta: string;
  status: string;
  tone: string;
  progress: number;
  updatedAt: string;
  payload?: Record<string, unknown>;
  lifecycle?: { status?: string; maintenance?: Record<string, unknown> | null };
};

type AssetPayload = {
  context?: { actorName: string; actorEmail: string; role: string; roles?: string[]; capabilities: string[] };
  assets?: AssetRecord[];
  readback?: { status?: string; scope?: string; checkedAt?: string };
};

type Assignee = {
  membershipId: string;
  actorId: string;
  name: string;
  email: string;
  roles: string[];
  roleLabels: string[];
  eligibleFor: string[];
};

type Assignment = {
  id: string;
  version: number;
  assetId: string;
  assetCode: string | null;
  assetTitle: string;
  entityType: string;
  assignmentClass: string;
  assignee: { membershipId: string; actorId: string; name: string; email: string | null; roles: string[]; roleLabels: string[] };
  kind: string;
  status: string;
  startsAt: string;
  endsAt: string | null;
  purpose: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  returnedAt: string | null;
};

type AssignmentPayload = { assignments?: Assignment[]; assignees?: Assignee[]; readback?: { status?: string } };
type NavItem = { id: CommandNavigationId; label: string; path: string; capability: string; icon: LucideIcon };

const navItems: NavItem[] = [
  { id: "command", label: "CONTROL", path: "/command", capability: "command.read", icon: MessageSquareText },
  { id: "operations", label: "OPERATIONS", path: "/operations", capability: "operations.read", icon: BriefcaseBusiness },
  { id: "workforce", label: "WORKFORCE", path: "/workforce", capability: "workforce.read", icon: Users },
  { id: "planning", label: "PIANIFICAZIONE", path: "/planning", capability: "planning.read", icon: CalendarClock },
  { id: "attendance", label: "PRESENZE", path: "/presenze", capability: "workforce.read", icon: Clock3 },
  { id: "assets", label: "ASSET", path: "/assets", capability: "asset.read", icon: Package },
  { id: "warehouse", label: "MAGAZZINO", path: "/warehouse", capability: "warehouse.read", icon: Layers3 },
  { id: "mission", label: "MISSIONI", path: "/mission", capability: "mission.read", icon: Truck },
  { id: "documents", label: "DOCUMENTI", path: "/documents", capability: "documents.read", icon: Package },
  { id: "authority", label: "AUTHORITY", path: "/onboarding", capability: "authority.read", icon: ShieldCheck },
  { id: "events", label: "EVENTI", path: "/events", capability: "events.read", icon: Activity },
  { id: "settings", label: "IMPOSTAZIONI", path: "/settings", capability: "settings.read", icon: SlidersHorizontal },
];

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner", admin: "Amministratore", manager: "Manager", office: "Ufficio", technical: "Tecnico",
  field_supervisor: "Caposquadra", worker: "Operatore", warehouse_manager: "Responsabile magazzino",
  warehouse_operator: "Magazziniere", driver: "Autista", maintenance: "Manutentore", auditor: "Auditor",
};

const toneStyles: Record<Tone, { icon: string; badge: string }> = {
  lime: { icon: "text-lime-200", badge: "border-lime-300/25 bg-lime-300/10 text-lime-100" },
  cyan: { icon: "text-cyan-200", badge: "border-cyan-300/25 bg-cyan-300/10 text-cyan-100" },
  amber: { icon: "text-amber-200", badge: "border-amber-300/25 bg-amber-300/10 text-amber-100" },
  red: { icon: "text-rose-200", badge: "border-rose-300/25 bg-rose-300/10 text-rose-100" },
  muted: { icon: "text-slate-400", badge: "border-white/10 bg-white/[.03] text-slate-400" },
};

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function text(value: unknown, fallback = "—") {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function upper(value: unknown) {
  return text(value, "").toUpperCase();
}

function roleLabel(role: string) {
  return ROLE_LABELS[role] ?? role;
}

function formatDate(value: unknown) {
  if (typeof value !== "string" || !value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
}

function payloadValue(asset: AssetRecord, key: string, fallback = "—") {
  return text(asset.payload?.[key], fallback);
}

function assetType(asset: AssetRecord) {
  const value = upper(asset.payload?.entityType);
  return value === "VEHICLE" ? "VEHICLE" : value === "EQUIPMENT" ? "EQUIPMENT" : "ASSET";
}

function assetLabel(asset: AssetRecord) {
  const type = assetType(asset);
  return type === "VEHICLE" ? "MEZZO" : type === "EQUIPMENT" ? "ATTREZZATURA" : "ASSET";
}

function AssetTypeIcon({ asset, className }: { asset: AssetRecord; className?: string }) {
  const type = assetType(asset);
  if (type === "VEHICLE") return <Truck className={className} />;
  if (type === "EQUIPMENT") return <Wrench className={className} />;
  return <Package className={className} />;
}

function lifecycleStatus(asset: AssetRecord) {
  return upper(asset.lifecycle?.status || asset.payload?.lifecycleStatus || asset.status || "AVAILABLE") || "AVAILABLE";
}

function lifecycleLabel(status: string) {
  if (status === "AVAILABLE") return "DISPONIBILE";
  if (status === "MAINTENANCE") return "IN MANUTENZIONE";
  if (status === "BLOCKED") return "BLOCCATO";
  return status.replaceAll("_", " ");
}

function lifecycleTone(status: string): Tone {
  if (status === "AVAILABLE") return "lime";
  if (status === "MAINTENANCE") return "amber";
  if (status === "BLOCKED") return "red";
  return "muted";
}

function assignmentTone(status: string): Tone {
  if (status === "ACTIVE") return "lime";
  if (status === "SCHEDULED") return "cyan";
  if (status === "RETURNED") return "muted";
  return "amber";
}

function assignmentLabel(status: string) {
  if (status === "ACTIVE") return "IN CORSO";
  if (status === "SCHEDULED") return "PROGRAMMATA";
  if (status === "RETURNED") return "RICONSEGNATA";
  if (status === "CANCELLED") return "ANNULLATA";
  return status;
}

function qrPayload(asset: AssetRecord) {
  const qr = asset.payload?.qr;
  if (qr && typeof qr === "object" && !Array.isArray(qr)) {
    const value = (qr as Record<string, unknown>).payload;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return `AZ1|ASSET|${asset.canonicalCode ?? asset.id}`;
}

function hasRegisteredQr(asset: AssetRecord) {
  const qr = asset.payload?.qr;
  return Boolean(qr && typeof qr === "object" && !Array.isArray(qr) && typeof (qr as Record<string, unknown>).payload === "string");
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function IconButton({ label, children, onClick, className = "" }: { label: string; children: ReactNode; onClick?: () => void; className?: string }) {
  return <button aria-label={label} className={cn("grid size-9 place-items-center rounded-lg border border-white/10 bg-black/20 text-slate-500 transition hover:border-lime-300/35 hover:bg-lime-300/10 hover:text-lime-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300", className)} onClick={onClick} type="button">{children}</button>;
}

function StatusPill({ label, tone }: { label: string; tone: Tone }) {
  return <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[.06em]", toneStyles[tone].badge)}><span className="size-1.5 rounded-full bg-current shadow-[0_0_8px_currentColor]" />{label}</span>;
}

function KpiCard({ label, value, detail, icon: Icon, tone }: { label: string; value: number | string; detail: string; icon: LucideIcon; tone: Tone }) {
  return <article className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><span className={cn("grid size-10 place-items-center rounded-xl border border-current/20 bg-current/10", toneStyles[tone].icon)}><Icon className="size-[18px]" /></span><span className="font-mono text-[9px] text-slate-600">D1</span></div><p className="mt-5 text-[10px] font-semibold uppercase tracking-[.16em] text-slate-600">{label}</p><p className="mt-2 font-mono text-[32px] font-semibold leading-none tracking-[-.07em] text-slate-50">{value}</p><p className="mt-4 text-[10px] text-slate-600">{detail}</p></article>;
}

function AssetRow({ asset, selected, assignment, onSelect }: { asset: AssetRecord; selected: boolean; assignment?: Assignment; onSelect: () => void }) {
  const status = lifecycleStatus(asset);
  return <button className={cn("w-full rounded-2xl border p-3.5 text-left transition sm:p-4", selected ? "border-lime-300/45 bg-lime-300/[.075] shadow-[0_0_30px_rgba(200,255,34,.09)]" : "border-white/[.08] bg-black/20 hover:border-lime-300/25 hover:bg-lime-300/[.03]")} onClick={onSelect} type="button"><div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-3"><span className={cn("grid size-10 shrink-0 place-items-center rounded-xl border border-current/20 bg-current/10", toneStyles[lifecycleTone(status)].icon)}><AssetTypeIcon asset={asset} className="size-[18px]" /></span><div className="min-w-0"><p className="truncate text-[13px] font-semibold text-slate-100">{asset.canonicalCode ?? asset.title}</p><p className="mt-1 truncate text-[10px] text-slate-500">{asset.canonicalCode && asset.title !== asset.canonicalCode ? `${asset.title} · ` : ""}{assetLabel(asset)} · {payloadValue(asset, "location", "Ubicazione da definire")}</p></div></div><ChevronRight className={cn("size-4 shrink-0", selected ? "text-lime-200" : "text-slate-700")} /></div><div className="mt-3 flex flex-wrap items-center gap-2"><StatusPill label={lifecycleLabel(status)} tone={lifecycleTone(status)} /><StatusPill label={assetLabel(asset)} tone="cyan" />{assignment && <StatusPill label={assignment.assignee.name} tone={assignmentTone(assignment.status)} />}</div><div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-500"><span>{payloadValue(asset, "brand", "Marca non indicata")} {payloadValue(asset, "model", "")}</span><span>{payloadValue(asset, "registration", payloadValue(asset, "serialNumber", "Identificativo da completare"))}</span></div></button>;
}

function AssetQrCard({ asset, onNotice }: { asset: AssetRecord; onNotice: (message: string) => void }) {
  const [dataUrl, setDataUrl] = useState("");
  const value = qrPayload(asset);
  const code = asset.canonicalCode ?? asset.id;
  const registered = hasRegisteredQr(asset);

  useEffect(() => {
    let active = true;
    void QRCode.toDataURL(value, { width: 280, margin: 2, errorCorrectionLevel: "M", color: { dark: "#071006", light: "#dfff5c" } }).then((next) => { if (active) setDataUrl(next); }).catch(() => { if (active) setDataUrl(""); });
    return () => { active = false; };
  }, [value]);

  const download = () => {
    if (!dataUrl) return;
    const anchor = document.createElement("a");
    anchor.href = dataUrl;
    anchor.download = `ai-zerow-${code.toLowerCase()}.png`;
    anchor.click();
    onNotice("Etichetta QR scaricata.");
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(value); onNotice("Codice QR copiato."); } catch { onNotice("Copia non disponibile su questo dispositivo."); }
  };

  const print = () => {
    if (!dataUrl) return;
    const popup = window.open("", "_blank", "width=480,height=620");
    if (!popup) { onNotice("Il browser ha bloccato la stampa: abilita le finestre popup."); return; }
    popup.document.open();
    popup.document.write(`<!doctype html><html><head><title>${escapeHtml(code)} · AI-ZEROW</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fff;color:#071006;font-family:Arial,sans-serif}.label{width:330px;padding:22px;border:2px solid #071006;border-radius:18px;text-align:center}.label img{width:250px;height:250px;display:block;margin:12px auto}.brand{font-weight:800;letter-spacing:.18em;font-size:14px}.code{font-size:20px;font-weight:700;letter-spacing:.08em}.name{font-size:13px;margin-top:6px;color:#435143}@media print{.label{border:1px solid #071006}}</style></head><body><div class="label"><div class="brand">AI-ZEROW COMMAND</div><img src="${dataUrl}" alt="QR ${escapeHtml(code)}"><div class="code">${escapeHtml(code)}</div><div class="name">${escapeHtml(asset.title)}</div></div><script>window.onload=()=>{window.print();window.onafterprint=()=>window.close()}</script></body></html>`);
    popup.document.close();
  };

  return <section className="carbon-inset rounded-2xl p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">IDENTITÀ FISICA</p><h3 className="mt-1 text-sm font-semibold text-slate-100">QR identificativo</h3><p className="mt-1 text-[10px] leading-4 text-slate-500">Stampa il codice e applicalo sul mezzo o sull’asset. La lettura riporta al registro tenant.</p></div><span className="grid size-9 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/10 text-lime-200"><QrCode className="size-4" /></span></div><div className="mt-4 flex flex-col items-center gap-3 rounded-xl border border-lime-300/15 bg-lime-100 p-4"><div className="grid size-[150px] place-items-center overflow-hidden rounded-lg bg-[#dfff5c]">{dataUrl ? <img alt={`QR identificativo ${code}`} className="size-full" src={dataUrl} /> : <LoaderCircle className="size-6 animate-spin text-[#071006]" />}</div><div className="text-center"><p className="font-mono text-sm font-semibold tracking-[.1em] text-[#071006]">{code}</p><p className="mt-1 text-[10px] text-[#38502b]">{registered ? "Registrato dal server" : "Codice compatibile · da riallineare"}</p></div></div><div className="mt-3 flex flex-wrap gap-2"><Button className="h-9 flex-1 bg-lime-300 text-[10px] font-semibold text-[#050705] hover:bg-lime-200" disabled={!dataUrl} onClick={print}><Printer className="size-3.5" />Stampa etichetta</Button><Button className="h-9 border-white/10 bg-black/20 text-[10px] text-slate-300 hover:border-lime-300/30 hover:bg-lime-300/10" disabled={!dataUrl} onClick={download} variant="outline"><Download className="size-3.5" />PNG</Button><Button aria-label="Copia payload QR" className="h-9 border-white/10 bg-black/20 text-[10px] text-slate-300 hover:border-lime-300/30 hover:bg-lime-300/10" onClick={() => void copy()} variant="outline">Copia</Button></div></section>;
}

export default function AssetControl() {
  const router = useRouter();
  const [payload, setPayload] = useState<AssetPayload | null>(null);
  const [assignmentPayload, setAssignmentPayload] = useState<AssignmentPayload>({});
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [refreshing, setRefreshing] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [assetFilter, setAssetFilter] = useState<AssetFilter>("ALL");
  const [lifecycleFilter, setLifecycleFilter] = useState<LifecycleFilter>("ALL");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<LifecycleAction | "">("");
  const [returningId, setReturningId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const assetResponse = await fetch("/api/assets/lifecycle", { cache: "no-store" });
      const next = await assetResponse.json() as AssetPayload & { error?: string };
      if (!assetResponse.ok) throw new Error(next.error ?? "asset_lifecycle_readback_unavailable");
      setPayload(next);
      setSelectedId((current) => current && next.assets?.some((asset) => asset.id === current) ? current : next.assets?.[0]?.id ?? "");
      try {
        const assignmentResponse = await fetch("/api/assets/assignments", { cache: "no-store" });
        const assignments = await assignmentResponse.json() as AssignmentPayload;
        setAssignmentPayload(assignmentResponse.ok ? assignments : {});
      } catch { setAssignmentPayload({}); }
      setState("ready");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Registro asset non disponibile");
      setState((current) => current === "ready" ? current : "error");
    } finally { setRefreshing(false); }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const context = payload?.context;
  const capabilities = useMemo(() => context?.capabilities ?? ["asset.read"], [context]);
  const allowedNavigation = useMemo(() => getAllowedCommandNavigation(capabilities).map((item) => item.id), [capabilities]);
  const visibleNavItems = useMemo(() => navItems.filter((item) => allowedNavigation.includes(item.id) || capabilities.includes(item.capability)), [allowedNavigation, capabilities]);
  const assets = useMemo(() => payload?.assets ?? [], [payload?.assets]);
  const assignments = useMemo(() => assignmentPayload.assignments ?? [], [assignmentPayload.assignments]);
  const assignees = useMemo(() => assignmentPayload.assignees ?? [], [assignmentPayload.assignees]);
  const filteredAssets = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return assets.filter((asset) => {
      const status = lifecycleStatus(asset);
      const kind = assetType(asset);
      const haystack = [asset.id, asset.canonicalCode, asset.title, asset.detail, asset.meta, kind, payloadValue(asset, "brand"), payloadValue(asset, "model"), payloadValue(asset, "serialNumber"), payloadValue(asset, "registration"), payloadValue(asset, "location")].filter(Boolean).join(" ").toLowerCase();
      return (!normalized || haystack.includes(normalized)) && (assetFilter === "ALL" || kind === assetFilter) && (lifecycleFilter === "ALL" || status === lifecycleFilter);
    });
  }, [assetFilter, assets, lifecycleFilter, query]);
  const selectedAsset = filteredAssets.find((asset) => asset.id === selectedId) ?? filteredAssets[0] ?? null;
  const availableCount = assets.filter((asset) => lifecycleStatus(asset) === "AVAILABLE").length;
  const maintenanceCount = assets.filter((asset) => lifecycleStatus(asset) === "MAINTENANCE").length;
  const blockedCount = assets.filter((asset) => lifecycleStatus(asset) === "BLOCKED").length;
  const vehicleCount = assets.filter((asset) => assetType(asset) === "VEHICLE").length;
  const activeAssignments = assignments.filter((assignment) => ["ACTIVE", "SCHEDULED"].includes(assignment.status));
  const selectedAssignments = selectedAsset ? assignments.filter((assignment) => assignment.assetId === selectedAsset.id) : [];
  const selectedActiveAssignment = selectedAssignments.find((assignment) => ["ACTIVE", "SCHEDULED"].includes(assignment.status));
  const canWrite = capabilities.includes("asset.write");
  const actor = { email: context?.actorEmail ?? "operator@zerow.local", name: context?.actorName ?? "Operatore" };

  function navigate(path: string) { setMobileMenu(false); router.push(path); }
  function goBack() { if (window.history.length > 1) router.back(); else router.push("/command"); }

  async function transition(action: LifecycleAction) {
    if (!selectedAsset) return;
    if ((action === "maintenance_open" || action === "block") && !note.trim()) { setNotice("Inserisci una motivazione prima di cambiare lo stato dell’asset."); return; }
    setBusy(action); setNotice("");
    try {
      const response = await fetch("/api/assets/lifecycle", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, assetId: selectedAsset.id, reason: note.trim(), note: note.trim(), idempotencyKey: `asset-lifecycle-${action}-${selectedAsset.id}-${crypto.randomUUID()}` }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "asset_lifecycle_write_failed");
      setNote(""); await refresh();
      setNotice(action === "maintenance_open" ? "Asset spostato in manutenzione." : action === "maintenance_close" ? "Asset rilasciato e nuovamente disponibile." : action === "block" ? "Asset bloccato: non assegnabile." : "Asset riattivato.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Transizione non completata"); } finally { setBusy(""); }
  }

  async function returnAssignment(assignment: Assignment) {
    if (!window.confirm(`Confermi il rientro di ${assignment.assetTitle} da ${assignment.assignee.name}?`)) return;
    setReturningId(assignment.id);
    try {
      const response = await fetch("/api/assets/assignments", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ assignmentId: assignment.id, action: "RETURN", idempotencyKey: `asset-return-${assignment.id}-${crypto.randomUUID()}` }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "asset_assignment_return_failed");
      await refresh(); setNotice("Rientro registrato: la risorsa è nuovamente disponibile per una nuova assegnazione.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Rientro non completato"); } finally { setReturningId(""); }
  }

  if (state === "loading" && !payload) return <main className="grid min-h-screen place-items-center bg-[#030504] text-xs text-slate-500"><LoaderCircle className="mr-2 inline size-4 animate-spin text-lime-300" />Caricamento asset…</main>;
  if (state === "error" && !payload) return <main className="grid min-h-screen place-items-center bg-[#030504]"><div className="carbon-card rounded-2xl p-6 text-center"><CircleAlert className="mx-auto size-7 text-amber-200" /><p className="mt-3 text-sm text-slate-300">Registro asset non disponibile</p><Button className="mt-4 bg-lime-300 text-[#050705] hover:bg-lime-200" onClick={() => void refresh()}><RefreshCw className="size-4" />Riprova</Button></div></main>;

  return <main className="zw-app-shell zw-asset-module min-h-screen overflow-x-hidden text-slate-100 selection:bg-lime-300 selection:text-[#060806]"><div className="zw-command-ambient" aria-hidden="true" /><div className="relative flex min-h-screen">
    <aside className={cn("zw-command-sidebar fixed inset-y-0 left-0 z-40 flex flex-col px-3 py-4 transition-[width,transform] lg:static lg:translate-x-0", sidebarCollapsed ? "is-collapsed lg:w-[76px]" : "lg:w-[248px]", mobileMenu ? "translate-x-0" : "-translate-x-full")}>
      <div className="flex items-center justify-between px-2"><button aria-label="Apri Command" className="flex min-w-0 items-center gap-3 text-left" onClick={() => navigate("/command")} type="button"><span className="neon-pulse relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black shadow-[0_0_22px_rgba(200,255,34,.12)]"><Image src="/ai-zerow-icon.jpeg" alt="AI-ZEROW" width={40} height={40} className="size-full object-cover" /></span><span className="zw-command-sidebar__brand-copy min-w-0"><span className="block text-sm font-bold tracking-[.18em] text-slate-50">AI-ZEROW</span><span className="block text-[10px] uppercase tracking-[.22em] text-lime-300/75">command</span></span></button><div className="flex items-center gap-1"><IconButton label={sidebarCollapsed ? "Espandi sidebar" : "Riduci sidebar"} className="hidden lg:grid" onClick={() => setSidebarCollapsed((value) => !value)}>{sidebarCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}</IconButton><IconButton label="Chiudi menu" className="lg:hidden" onClick={() => setMobileMenu(false)}><X className="size-4" /></IconButton></div></div>
      <div className="zw-command-tenant mt-7 flex items-center gap-3 rounded-2xl p-3"><span className="grid size-9 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/10 text-lime-200"><HardHat className="size-4" /></span><span className="zw-command-sidebar__tenant-copy min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-slate-200">ZEROW workspace</span><span className="mt-0.5 block truncate text-[10px] uppercase tracking-[.1em] text-slate-600">{roleLabel(context?.role ?? "asset")} · profilo operativo</span></span></div>
      <nav className="mt-6 min-h-0 flex-1 overflow-y-auto" aria-label="Navigazione principale"><p className="zw-command-sidebar__nav-caption px-3 text-[9px] font-semibold uppercase tracking-[.22em] text-slate-700">Area autorizzata</p><div className="mt-2 space-y-1">{visibleNavItems.map((item) => { const Icon = item.icon; const active = item.id === "assets"; return <button aria-current={active ? "page" : undefined} aria-label={sidebarCollapsed ? item.label : undefined} className={cn("zw-command-nav-item", active && "is-active")} key={item.id} onClick={() => navigate(item.path)} title={sidebarCollapsed ? item.label : undefined} type="button"><Icon className="size-4" /><span className="zw-command-sidebar__nav-label">{item.label}</span>{item.id === "command" && <span className="zw-command-sidebar__nav-badge ml-auto rounded border border-lime-300/20 px-1.5 py-0.5 font-mono text-[8px] tracking-[.08em] text-lime-200">AI</span>}</button>; })}</div></nav>
      <div className="zw-command-sidebar__footer mt-4 border-t border-white/[.07] pt-4"><div className="flex items-center justify-between px-2 text-[9px] uppercase tracking-[.14em] text-slate-600"><span>Sistema</span><span className="flex items-center gap-1.5 text-lime-200"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_10px_rgba(200,255,34,.9)]" />{payload?.readback?.status === "verified" ? "DATI AGGIORNATI" : "AGGIORNAMENTO"}</span></div><div className="zw-command-core-status mt-3 rounded-xl p-3"><p className="font-mono text-[9px] text-slate-500">{assets.length} RISORSE · {activeAssignments.length} ASSEGNAZIONI</p><p className="mt-2 font-mono text-[9px] text-lime-300/60">IDENTITÀ / QR / STORICO</p></div></div>
    </aside>
    {mobileMenu && <button aria-label="Chiudi menu" className="zw-command-sidebar-backdrop fixed inset-0 z-30 bg-black/65 lg:hidden" onClick={() => setMobileMenu(false)} type="button" />}
    <section className="min-w-0 flex-1"><header className="zw-command-topbar sticky top-0 z-20 flex h-[72px] items-center gap-3 px-4 sm:gap-5 sm:px-7"><IconButton className="lg:hidden" label="Apri menu" onClick={() => setMobileMenu(true)}><Menu className="size-4" /></IconButton><button aria-label="Apri Asset" className="zw-command-topbar__brand flex shrink-0 items-center gap-2 text-left" onClick={() => navigate("/assets")} type="button"><span className="relative grid size-9 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black shadow-[0_0_18px_rgba(200,255,34,.12)]"><Image src="/ai-zerow-icon.jpeg" alt="ZEROW" width={36} height={36} className="size-full object-cover" /></span><span className="zw-command-topbar__wordmark hidden sm:block"><span className="block text-[11px] font-bold tracking-[.18em] text-slate-50">ZEROW</span><span className="block text-[9px] uppercase tracking-[.2em] text-lime-300/75">asset</span></span></button><IconButton className="hidden lg:grid" label={sidebarCollapsed ? "Espandi sidebar" : "Riduci sidebar"} onClick={() => setSidebarCollapsed((value) => !value)}>{sidebarCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}</IconButton><div className="relative hidden min-w-0 flex-1 justify-center md:flex"><div className="relative w-full max-w-[520px]"><Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-600" /><Input aria-label="Cerca asset" className="h-10 w-full border-lime-300/10 bg-black/35 pl-10 text-xs text-slate-100 placeholder:text-slate-600" onChange={(event) => setQuery(event.target.value)} placeholder="Cerca mezzi, attrezzature, QR…" value={query} /></div></div><div className="flex min-w-0 flex-1 items-center gap-2 md:hidden"><span className="truncate text-xs font-semibold tracking-[.14em] text-slate-200">ASSET</span><span className="size-1 rounded-full bg-lime-300" /></div><div className="ml-auto flex min-w-0 items-center gap-2"><TenantSwitcher /><span className="hidden items-center gap-2 rounded-full border border-lime-300/20 bg-lime-300/5 px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[.12em] text-lime-200 sm:flex"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_9px_rgba(200,255,34,.9)]" />{refreshing ? "AGGIORNAMENTO" : "DATI AGGIORNATI"}</span><IconButton className="zw-command-topbar__back" label="Torna indietro" onClick={goBack}><ArrowLeft className="size-4" /></IconButton><IconButton className="zw-command-topbar__refresh" label="Aggiorna Asset" onClick={() => void refresh()}><RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} /></IconButton>{capabilities.includes("communication.read") ? <IconButton className="zw-command-topbar__notifications" label="Apri comunicazioni" onClick={() => navigate("/communications")}><Bell className="size-4" /></IconButton> : null}<AccountMenu actor={actor} /></div></header>
      <div className="mx-auto w-full max-w-[1920px] px-4 pb-24 pt-5 sm:px-7 sm:pb-8 sm:pt-7"><div className="mb-5 flex flex-wrap items-end justify-between gap-4"><div><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.2em] text-lime-300/70"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_9px_rgba(200,255,34,.9)]" />AI-ZEROW / ASSET</div><h1 className="mt-2 text-2xl font-semibold tracking-[-.04em] text-slate-50 sm:text-[28px]">Asset</h1><p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">Mezzi, attrezzature, identità QR e consegne operative in un unico registro.</p></div><div className="flex flex-wrap items-center gap-2"><Button className="bg-lime-300 text-[10px] font-semibold text-[#050705] shadow-[0_0_24px_rgba(200,255,34,.15)] hover:bg-lime-200" disabled={!canWrite} onClick={() => setCreateOpen(true)}><Package className="size-3.5" />Nuovo asset</Button><Button className="border-lime-300/25 bg-lime-300/[.05] text-[10px] text-lime-100 hover:bg-lime-300/10" onClick={() => navigate("/planning")} variant="outline"><CalendarClock className="size-3.5" />Apri pianificazione</Button></div></div>
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><KpiCard label="Risorse registrate" value={assets.length} detail="Anagrafica del tenant" icon={Package} tone="cyan" /><KpiCard label="Disponibili" value={availableCount} detail="Pronte per l’uso" icon={CheckCircle2} tone="lime" /><KpiCard label="Assegnazioni attive" value={activeAssignments.length} detail="Consegne in corso o programmate" icon={UserRound} tone="amber" /><KpiCard label="Mezzi" value={vehicleCount} detail={`${assets.filter(hasRegisteredQr).length} QR registrati`} icon={Truck} tone="cyan" /></section>
        <section className="carbon-card mt-4 rounded-2xl p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-lime-300/70">REGISTRO RISORSE</p><h2 className="mt-1 text-lg font-semibold text-slate-100">Cerca e filtra</h2></div><span className="flex items-center gap-2 text-[9px] uppercase tracking-[.14em] text-slate-600"><span className="size-1.5 rounded-full bg-lime-300" />{filteredAssets.length} DI {assets.length}</span></div><div className="mt-4 flex flex-wrap gap-2"><label className="relative min-w-[230px] flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-600" /><Input aria-label="Filtra asset" className="h-10 border-white/10 bg-black/25 pl-9 text-[11px]" onChange={(event) => setQuery(event.target.value)} placeholder="Cerca codice, mezzo, seriale, ubicazione…" value={query} /></label><select aria-label="Filtra tipologia asset" className="h-10 rounded-xl border border-white/10 bg-black/25 px-3 text-[11px] text-slate-300 outline-none focus:border-lime-300/40" onChange={(event) => setAssetFilter(event.target.value as AssetFilter)} value={assetFilter}><option className="bg-[#080c09]" value="ALL">Tutte le tipologie</option><option className="bg-[#080c09]" value="ASSET">Asset</option><option className="bg-[#080c09]" value="VEHICLE">Mezzi</option><option className="bg-[#080c09]" value="EQUIPMENT">Attrezzature</option></select><select aria-label="Filtra stato asset" className="h-10 rounded-xl border border-white/10 bg-black/25 px-3 text-[11px] text-slate-300 outline-none focus:border-lime-300/40" onChange={(event) => setLifecycleFilter(event.target.value as LifecycleFilter)} value={lifecycleFilter}><option className="bg-[#080c09]" value="ALL">Tutti gli stati</option><option className="bg-[#080c09]" value="AVAILABLE">Disponibili</option><option className="bg-[#080c09]" value="MAINTENANCE">In manutenzione</option><option className="bg-[#080c09]" value="BLOCKED">Bloccati</option></select><Button className="h-10 border-white/10 bg-black/20 text-[11px] text-slate-300 hover:border-lime-300/30 hover:bg-lime-300/10 hover:text-lime-100" onClick={() => { setQuery(""); setAssetFilter("ALL"); setLifecycleFilter("ALL"); }} variant="outline"><RefreshCw className="size-3.5" />Azzera filtri</Button></div></section>
        <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(390px,.95fr)]"><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-cyan-200/70">CATALOGO ASSET</p><h2 className="mt-1 text-sm font-semibold text-slate-100">Mezzi e attrezzature</h2><p className="mt-1 text-[11px] text-slate-500">Seleziona una risorsa per aprire la scheda completa.</p></div><IconButton label="Aggiorna registro asset" onClick={() => void refresh()}><RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} /></IconButton></div><div className="mt-4 space-y-2.5">{filteredAssets.map((asset) => <AssetRow asset={asset} assignment={assignments.find((assignment) => assignment.assetId === asset.id && ["ACTIVE", "SCHEDULED"].includes(assignment.status))} key={asset.id} onSelect={() => setSelectedId(asset.id)} selected={asset.id === selectedAsset?.id} />)}{filteredAssets.length === 0 && <div className="rounded-2xl border border-dashed border-lime-300/15 bg-black/15 p-10 text-center"><Package className="mx-auto size-8 text-slate-700" /><p className="mt-3 text-sm font-medium text-slate-300">Nessuna risorsa trovata</p><p className="mt-1 text-[11px] text-slate-600">Registra il primo asset o modifica i filtri.</p><Button className="mt-4 bg-lime-300 text-[10px] font-semibold text-[#050705] hover:bg-lime-200" disabled={!canWrite} onClick={() => setCreateOpen(true)}><Package className="size-3.5" />Registra asset</Button></div>}</div></section>
          <aside className="space-y-4"><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">SCHEDA RISORSA</p><h2 className="mt-1 text-lg font-semibold text-slate-100">{selectedAsset ? selectedAsset.canonicalCode ?? selectedAsset.title : "Seleziona un asset"}</h2><p className="mt-1 text-[10px] text-slate-500">{selectedAsset ? `${assetLabel(selectedAsset)} · aggiornato ${formatDate(selectedAsset.updatedAt)}` : "Dettagli, QR e consegne compariranno qui."}</p></div>{selectedAsset && <StatusPill label={lifecycleLabel(lifecycleStatus(selectedAsset))} tone={lifecycleTone(lifecycleStatus(selectedAsset))} />}</div>{selectedAsset ? <><div className="mt-4 grid gap-2 sm:grid-cols-2"><div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">Identità</p><p className="mt-2 text-[11px] text-slate-200">{selectedAsset.title}</p><p className="mt-1 text-[9px] text-slate-600">{payloadValue(selectedAsset, "brand", "Marca non indicata")} {payloadValue(selectedAsset, "model", "")} · {payloadValue(selectedAsset, "serialNumber", "Seriale non indicato")}</p></div><div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">Ubicazione</p><p className="mt-2 text-[11px] text-slate-200">{payloadValue(selectedAsset, "location", "Da definire")}</p><p className="mt-1 text-[9px] text-slate-600">{payloadValue(selectedAsset, "registration", "Nessuna targa o identificativo")}</p></div></div><div className="mt-4 flex flex-wrap gap-2"><Button className="bg-lime-300 text-[10px] font-semibold text-[#050705] hover:bg-lime-200" disabled={!canWrite || lifecycleStatus(selectedAsset) !== "AVAILABLE"} onClick={() => setAssignmentOpen(true)}><UserRound className="size-3.5" />Assegna risorsa</Button><Link className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[10px] text-slate-300 hover:border-lime-300/30 hover:text-lime-100" href="/mission"><Truck className="size-3.5" />Apri missioni</Link><Link className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[10px] text-slate-300 hover:border-lime-300/30 hover:text-lime-100" href="/qr"><QrCode className="size-3.5" />Scanner</Link></div></> : <div className="mt-5 rounded-xl border border-dashed border-white/10 p-8 text-center text-[10px] text-slate-600">Seleziona una risorsa dal catalogo per aprire la scheda.</div>}</section>
            {selectedAsset && <AssetQrCard asset={selectedAsset} onNotice={setNotice} />}
            {selectedAsset && <section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-amber-200/80">CONSEGNE E RIENTRI</p><h2 className="mt-1 text-[15px] font-semibold text-slate-100">Storico assegnazioni</h2></div><span className="font-mono text-[9px] text-slate-600">{selectedAssignments.length} EVENTI</span></div><div className="mt-4 space-y-2.5">{selectedAssignments.slice(0, 6).map((assignment) => <div className="rounded-xl border border-white/[.08] bg-black/20 p-3" key={assignment.id}><div className="flex items-start gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-lg border border-lime-300/20 bg-lime-300/10 text-lime-200"><UserRound className="size-3.5" /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-[11px] font-semibold text-slate-200">{assignment.assignee.name}</p><StatusPill label={assignmentLabel(assignment.status)} tone={assignmentTone(assignment.status)} /></div><p className="mt-1 truncate text-[9px] text-slate-600">{assignment.kind === "LONG_TERM" ? "Lunga · fino al rientro" : "Breve · con rientro"} · {formatDate(assignment.startsAt)}{assignment.endsAt ? ` → ${formatDate(assignment.endsAt)}` : ""}</p><p className="mt-1 truncate text-[10px] text-slate-500">{assignment.purpose || "Consegna operativa"}</p></div>{canWrite && ["ACTIVE", "SCHEDULED"].includes(assignment.status) && <Button aria-label={`Registra rientro ${assignment.assetTitle}`} className="h-8 shrink-0 border-lime-300/20 bg-lime-300/[.05] px-2.5 text-[10px] text-lime-100 hover:bg-lime-300/10" disabled={returningId === assignment.id} onClick={() => void returnAssignment(assignment)} variant="outline">{returningId === assignment.id ? <LoaderCircle className="size-3 animate-spin" /> : <CheckCircle2 className="size-3" />}Rientro</Button>}</div></div>)}{selectedAssignments.length === 0 && <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-[10px] text-slate-600">Nessuna consegna registrata per questa risorsa.</div>}</div></section>}
            {selectedAsset && <section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start gap-3"><span className="grid size-9 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/10 text-lime-200"><ShieldCheck className="size-4" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">STATO OPERATIVO</p><h2 className="mt-1 text-[15px] font-semibold text-slate-100">Disponibilità governata</h2></div></div><div className="mt-4 grid grid-cols-2 gap-2"><div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">Stato</p><p className={cn("mt-2 text-[11px] font-semibold", lifecycleStatus(selectedAsset) === "AVAILABLE" ? "text-lime-200" : "text-amber-100")}>{lifecycleLabel(lifecycleStatus(selectedAsset))}</p></div><div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">Consegna</p><p className={cn("mt-2 text-[11px] font-semibold", selectedActiveAssignment ? "text-amber-100" : "text-lime-200")}>{selectedActiveAssignment ? selectedActiveAssignment.assignee.name : "Libera"}</p></div></div>{canWrite && <><Input aria-label="Motivazione cambio stato asset" className="mt-3 h-10 border-white/10 bg-black/25 text-[11px] text-slate-100 placeholder:text-slate-600" onChange={(event) => setNote(event.target.value)} placeholder="Motivazione manutenzione o blocco…" value={note} /><div className="mt-3 flex flex-wrap gap-2">{lifecycleStatus(selectedAsset) === "AVAILABLE" && <><Button className="h-9 border-amber-300/25 bg-amber-300/[.06] text-[10px] text-amber-100 hover:bg-amber-300/10" disabled={Boolean(busy)} onClick={() => void transition("maintenance_open")} variant="outline">{busy === "maintenance_open" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Wrench className="size-3.5" />}Manutenzione</Button><Button className="h-9 border-rose-300/25 bg-rose-300/[.04] text-[10px] text-rose-100 hover:bg-rose-300/10" disabled={Boolean(busy)} onClick={() => void transition("block")} variant="outline">{busy === "block" ? <LoaderCircle className="size-3.5 animate-spin" /> : <CircleAlert className="size-3.5" />}Blocca</Button></>}{lifecycleStatus(selectedAsset) === "MAINTENANCE" && <><Button className="h-9 bg-lime-300 text-[10px] font-semibold text-[#050705] hover:bg-lime-200" disabled={Boolean(busy)} onClick={() => void transition("maintenance_close")}>{busy === "maintenance_close" ? <LoaderCircle className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}Rendi disponibile</Button><Button className="h-9 border-rose-300/25 bg-rose-300/[.04] text-[10px] text-rose-100 hover:bg-rose-300/10" disabled={Boolean(busy)} onClick={() => void transition("block")} variant="outline"><CircleAlert className="size-3.5" />Blocca</Button></>}{lifecycleStatus(selectedAsset) === "BLOCKED" && <Button className="h-9 bg-lime-300 text-[10px] font-semibold text-[#050705] hover:bg-lime-200" disabled={Boolean(busy)} onClick={() => void transition("release")}>{busy === "release" ? <LoaderCircle className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}Riattiva</Button>}</div></>}</section>}
          </aside></section>
        <section className="mt-4 grid gap-4 lg:grid-cols-3"><article className="carbon-inset rounded-2xl p-4"><div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[.18em] text-amber-200/80"><Wrench className="size-3.5" />DA VERIFICARE</div><p className="mt-3 font-mono text-2xl text-amber-100">{maintenanceCount}</p><p className="mt-1 text-[10px] text-slate-500">risorse in manutenzione</p></article><article className="carbon-inset rounded-2xl p-4"><div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[.18em] text-rose-200/80"><CircleAlert className="size-3.5" />BLOCCATE</div><p className="mt-3 font-mono text-2xl text-rose-100">{blockedCount}</p><p className="mt-1 text-[10px] text-slate-500">richiedono una riattivazione</p></article><article className="carbon-inset rounded-2xl p-4"><div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[.18em] text-cyan-200/80"><Gauge className="size-3.5" />IN CONSEGNA</div><p className="mt-3 font-mono text-2xl text-cyan-100">{activeAssignments.length}</p><p className="mt-1 text-[10px] text-slate-500">assegnazioni aperte nel tenant</p></article></section>
        <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,.9fr)]"><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-amber-200/70">CONTROLLO CONSEGNE</p><h2 className="mt-1 text-[15px] font-semibold text-slate-100">Rientri da presidiare</h2><p className="mt-1 text-[11px] text-slate-500">Una risorsa torna disponibile solo quando il rientro viene registrato.</p></div><span className="font-mono text-[9px] text-slate-600">{activeAssignments.length} APERTE</span></div><div className="mt-4 space-y-2">{activeAssignments.slice(0, 5).map((assignment) => <button className="flex w-full items-center gap-3 rounded-xl border border-white/[.08] bg-black/20 p-3 text-left transition hover:border-lime-300/25" key={assignment.id} onClick={() => { setSelectedId(assignment.assetId); setAssetFilter("ALL"); setLifecycleFilter("ALL"); }} type="button"><span className="grid size-8 shrink-0 place-items-center rounded-lg border border-lime-300/20 bg-lime-300/10 text-lime-200"><UserRound className="size-3.5" /></span><span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-semibold text-slate-200">{assignment.assetCode ?? assignment.assetTitle}</span><span className="mt-1 block truncate text-[9px] text-slate-600">{assignment.assignee.name} · {assignment.kind === "LONG_TERM" ? "lunga" : `rientro ${formatDate(assignment.endsAt)}`}</span></span><StatusPill label={assignmentLabel(assignment.status)} tone={assignmentTone(assignment.status)} /></button>)}{activeAssignments.length === 0 && <div className="rounded-xl border border-dashed border-white/10 p-7 text-center text-[10px] text-slate-600">Nessuna consegna aperta.</div>}</div></section><section className="carbon-card-neon rounded-2xl p-4 sm:p-5"><div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-2xl border border-lime-300/25 bg-lime-300/10 text-lime-200"><Sparkles className="size-5" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-lime-300/70">COMPANY AI / ASSET</p><h2 className="mt-1 text-[15px] font-semibold text-slate-100">Leggi la flotta operativa</h2></div><StatusPill label="ASSISTITA" tone="cyan" /></div><p className="mt-3 text-[11px] leading-5 text-slate-500">Company AI può leggere disponibilità, consegne aperte, manutenzioni e identificativi QR. La conferma resta nel modulo autorizzato.</p><div className="mt-4 space-y-2"><button className="flex w-full items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-left text-[11px] text-slate-400 transition hover:border-lime-300/30 hover:text-lime-100" onClick={() => navigate("/command?prompt=Analizza%20disponibilità%20asset")} type="button"><Sparkles className="size-3.5 text-lime-300" />Analizza disponibilità</button><button className="flex w-full items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-left text-[11px] text-slate-400 transition hover:border-lime-300/30 hover:text-lime-100" onClick={() => navigate("/command?prompt=Trova%20asset%20da%20riconsegnare")} type="button"><Search className="size-3.5 text-lime-300" />Trova rientri aperti</button></div></section></section>
        <section className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-cyan-300/15 bg-cyan-300/[.03] px-4 py-3 text-[10px] text-slate-500"><span className="flex items-center gap-2"><ShieldCheck className="size-3.5 shrink-0 text-cyan-200" />Anagrafica, QR e assegnazioni rispettano il tenant corrente.</span><span className="flex items-center gap-2"><Link className="text-lime-200 hover:text-lime-100" href="/onboarding">Authority <ArrowUpRight className="ml-1 inline size-3" /></Link><span>·</span><Link className="text-lime-200 hover:text-lime-100" href="/mission">Missioni <ArrowUpRight className="ml-1 inline size-3" /></Link></span></section>
        <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/[.07] py-5 text-[10px] text-slate-700"><span>AI-ZEROW COMMAND · Asset</span><span className="flex items-center gap-2"><span>identità verificata</span><span className="size-1 rounded-full bg-lime-300" /><span>capability filtered</span></span></footer>
      </div>
    </section>
  </div><CommandMobileNav active="more" allowedNavigation={allowedNavigation} role={context?.role} roles={context?.roles} /><ServerNamingDialog module="assets" open={createOpen} onOpenChange={setCreateOpen} onCreated={(created) => { if (created?.id) setSelectedId(created.id); void refresh(); }} onNotice={setNotice} /><AssetAssignmentDialog assets={assets} initialAsset={selectedAsset} assignees={assignees} open={assignmentOpen} onOpenChange={setAssignmentOpen} onCreated={() => void refresh()} onNotice={setNotice} />{notice && <button className="fixed bottom-5 left-1/2 z-[100] flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-2 rounded-xl border border-lime-300/25 bg-[#080d09]/96 px-4 py-3 text-left text-xs text-lime-100 shadow-[0_0_34px_rgba(200,255,34,.16)] backdrop-blur-xl" onClick={() => setNotice("")} type="button"><CircleAlert className="size-4 shrink-0 text-amber-200" />{notice}</button>}</main>;
}
