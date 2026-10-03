"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowUpRight,
  Bell,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  Gauge,
  HardHat,
  Layers3,
  LoaderCircle,
  Menu,
  MessageSquareText,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  QrCode,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Truck,
  Users,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { AccountMenu } from "@/components/account-menu";
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
  lifecycle?: {
    status?: string;
    maintenance?: Record<string, unknown> | null;
  };
};

type AssetPayload = {
  context?: {
    actorName: string;
    actorEmail: string;
    role: string;
    capabilities: string[];
  };
  assets?: AssetRecord[];
  readback?: { status?: string; scope?: string; checkedAt?: string };
};

type NavItem = {
  id: CommandNavigationId;
  label: string;
  path: string;
  capability: string;
  icon: LucideIcon;
};

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

function payloadValue(asset: AssetRecord, key: string) {
  return text(asset.payload?.[key]);
}

function entityType(asset: AssetRecord) {
  const value = upper(asset.payload?.entityType);
  if (value === "VEHICLE") return "VEHICLE";
  if (value === "EQUIPMENT") return "EQUIPMENT";
  return "ASSET";
}

function entityLabel(asset: AssetRecord) {
  const kind = entityType(asset);
  if (kind === "VEHICLE") return "MEZZO";
  if (kind === "EQUIPMENT") return "ATTREZZATURA";
  return "ASSET";
}

function entityIcon(asset: AssetRecord) {
  const kind = entityType(asset);
  if (kind === "VEHICLE") return Truck;
  if (kind === "EQUIPMENT") return Wrench;
  return Package;
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

function IconButton({ label, children, onClick, className = "" }: { label: string; children: ReactNode; onClick?: () => void; className?: string }) {
  return <button aria-label={label} className={cn("grid size-9 place-items-center rounded-lg border border-white/10 bg-black/20 text-slate-500 transition hover:border-lime-300/35 hover:bg-lime-300/10 hover:text-lime-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300", className)} onClick={onClick} type="button">{children}</button>;
}

function StatusPill({ label, tone }: { label: string; tone: Tone }) {
  return <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[9px] font-semibold uppercase tracking-[.06em]", toneStyles[tone].badge)}><span className="size-1.5 rounded-full bg-current shadow-[0_0_8px_currentColor]" />{label}</span>;
}

function KpiCard({ label, value, detail, icon: Icon, tone }: { label: string; value: number | string; detail: string; icon: LucideIcon; tone: Tone }) {
  return <article className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><span className={cn("grid size-10 place-items-center rounded-xl border border-current/20 bg-current/10", toneStyles[tone].icon)}><Icon className="size-[18px]" /></span><span className="font-mono text-[9px] text-slate-600">D1</span></div><p className="mt-5 text-[10px] font-semibold uppercase tracking-[.16em] text-slate-600">{label}</p><p className="mt-2 font-mono text-[32px] font-semibold leading-none tracking-[-.07em] text-slate-50">{value}</p><p className="mt-4 text-[10px] text-slate-600">{detail}</p></article>;
}

function AssetCard({ asset, selected, onSelect }: { asset: AssetRecord; selected: boolean; onSelect: () => void }) {
  const Icon = entityIcon(asset);
  const status = lifecycleStatus(asset);
  // eslint-disable-next-line react-hooks/static-components
  return <button className={cn("w-full rounded-2xl border p-3 text-left transition sm:p-4", selected ? "border-lime-300/40 bg-lime-300/[.075] shadow-[0_0_26px_rgba(200,255,34,.09)]" : "border-white/[.08] bg-black/20 hover:border-lime-300/25 hover:bg-lime-300/[.03]")} onClick={onSelect} type="button"><div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-3"><span className={cn("grid size-10 shrink-0 place-items-center rounded-xl border border-current/20 bg-current/10", toneStyles[lifecycleTone(status)].icon)}><Icon className="size-[18px]" /></span><div className="min-w-0"><p className="truncate text-[12px] font-semibold text-slate-100">{asset.canonicalCode ?? asset.title}</p><p className="mt-1 truncate text-[10px] text-slate-500">{asset.canonicalCode && asset.title !== asset.canonicalCode ? asset.title + " · " : ""}{entityLabel(asset)} · {payloadValue(asset, "location")}</p></div></div><ChevronRight className={cn("size-4 shrink-0", selected ? "text-lime-200" : "text-slate-700")} /></div><div className="mt-3 flex flex-wrap items-center gap-2"><StatusPill label={lifecycleLabel(status)} tone={lifecycleTone(status)} /><StatusPill label={entityLabel(asset)} tone="cyan" /></div><div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-500"><span>{payloadValue(asset, "brand")} {payloadValue(asset, "model")}</span><span>{payloadValue(asset, "registration") !== "—" ? payloadValue(asset, "registration") : payloadValue(asset, "serialNumber")}</span></div></button>;
}

export default function AssetControl() {
  const router = useRouter();
  const [payload, setPayload] = useState<AssetPayload | null>(null);
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
  const [createOpen, setCreateOpen] = useState(false);
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/assets/lifecycle", { cache: "no-store" });
      const next = await response.json() as AssetPayload & { error?: string };
      if (!response.ok) throw new Error(next.error ?? "asset_lifecycle_readback_unavailable");
      setPayload(next);
      setSelectedId((current) => current && next.assets?.some((asset) => asset.id === current) ? current : next.assets?.[0]?.id ?? "");
      setState("ready");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Registro asset non disponibile");
      setState((current) => current === "ready" ? current : "error");
    } finally {
      setRefreshing(false);
    }
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
  const filteredAssets = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return assets.filter((asset) => {
      const status = lifecycleStatus(asset);
      const kind = entityType(asset);
      const haystack = [asset.id, asset.canonicalCode, asset.title, asset.detail, asset.meta, asset.status, kind, payloadValue(asset, "brand"), payloadValue(asset, "model"), payloadValue(asset, "serialNumber"), payloadValue(asset, "registration"), payloadValue(asset, "location")].filter(Boolean).join(" ").toLowerCase();
      return (!normalized || haystack.includes(normalized))
        && (assetFilter === "ALL" || kind === assetFilter)
        && (lifecycleFilter === "ALL" || status === lifecycleFilter);
    });
  }, [assetFilter, assets, lifecycleFilter, query]);
  const selectedAsset = filteredAssets.find((asset) => asset.id === selectedId) ?? filteredAssets[0] ?? null;
  const availableCount = assets.filter((asset) => lifecycleStatus(asset) === "AVAILABLE").length;
  const maintenanceCount = assets.filter((asset) => lifecycleStatus(asset) === "MAINTENANCE").length;
  const blockedCount = assets.filter((asset) => lifecycleStatus(asset) === "BLOCKED").length;
  const vehicleCount = assets.filter((asset) => entityType(asset) === "VEHICLE").length;
  const canWrite = capabilities.includes("asset.write");
  const actor = { email: context?.actorEmail ?? "operator@zerow.local", name: context?.actorName ?? "Operatore" };

  function navigate(path: string) {
    setMobileMenu(false);
    router.push(path);
  }

  function goBack() {
    if (window.history.length > 1) router.back();
    else router.push("/command");
  }

  async function transition(action: LifecycleAction) {
    if (!selectedAsset) return;
    if ((action === "maintenance_open" || action === "block") && !note.trim()) {
      setNotice("Inserisci una motivazione prima di cambiare lo stato dell’asset.");
      return;
    }
    setBusy(action);
    setNotice("");
    try {
      const response = await fetch("/api/assets/lifecycle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          assetId: selectedAsset.id,
          reason: note.trim(),
          note: note.trim(),
          idempotencyKey: "asset-lifecycle-" + action + "-" + selectedAsset.id + "-" + crypto.randomUUID(),
        }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "asset_lifecycle_write_failed");
      setNote("");
      await refresh();
      setNotice(action === "maintenance_open" ? "Asset spostato in manutenzione." : action === "maintenance_close" ? "Asset rilasciato e nuovamente assegnabile." : action === "block" ? "Asset bloccato: non assegnabile." : "Asset riattivato.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Transizione non completata");
    } finally {
      setBusy("");
    }
  }

  if (state === "loading" && !payload) return <main className="grid min-h-screen place-items-center bg-[#030504] text-xs text-slate-500"><LoaderCircle className="mr-2 inline size-4 animate-spin text-lime-300" />Caricamento asset…</main>;
  if (state === "error" && !payload) return <main className="grid min-h-screen place-items-center bg-[#030504]"><div className="carbon-card rounded-2xl p-6 text-center"><CircleAlert className="mx-auto size-7 text-amber-200" /><p className="mt-3 text-sm text-slate-300">Registro asset non disponibile</p><Button className="mt-4 bg-lime-300 text-[#050705] hover:bg-lime-200" onClick={() => void refresh()}><RefreshCw className="size-4" />Riprova</Button></div></main>;

  return <main className="zw-app-shell zw-asset-module min-h-screen overflow-x-hidden text-slate-100 selection:bg-lime-300 selection:text-[#060806]"><div className="zw-command-ambient" aria-hidden="true" /><div className="relative flex min-h-screen">
    <aside className={cn("zw-command-sidebar fixed inset-y-0 left-0 z-40 flex flex-col px-3 py-4 transition-[width,transform] lg:static lg:translate-x-0", sidebarCollapsed ? "is-collapsed lg:w-[76px]" : "lg:w-[248px]", mobileMenu ? "translate-x-0" : "-translate-x-full")}>
      <div className="flex items-center justify-between px-2"><button aria-label="Apri Command" className="flex min-w-0 items-center gap-3 text-left" onClick={() => navigate("/command")} type="button"><span className="neon-pulse relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black shadow-[0_0_22px_rgba(200,255,34,.12)]"><Image src="/ai-zerow-icon.jpeg" alt="AI-ZEROW" width={40} height={40} className="size-full object-cover" /></span><span className="zw-command-sidebar__brand-copy min-w-0"><span className="block text-sm font-bold tracking-[.18em] text-slate-50">AI-ZEROW</span><span className="block text-[10px] uppercase tracking-[.22em] text-lime-300/75">command</span></span></button><div className="flex items-center gap-1"><IconButton label={sidebarCollapsed ? "Espandi sidebar" : "Riduci sidebar"} className="hidden lg:grid" onClick={() => setSidebarCollapsed((value) => !value)}>{sidebarCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}</IconButton><IconButton label="Chiudi menu" className="lg:hidden" onClick={() => setMobileMenu(false)}><X className="size-4" /></IconButton></div></div>
      <div className="zw-command-tenant mt-7 flex items-center gap-3 rounded-2xl p-3"><span className="grid size-9 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/10 text-lime-200"><HardHat className="size-4" /></span><span className="zw-command-sidebar__tenant-copy min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-slate-200">ZEROW workspace</span><span className="mt-0.5 block truncate text-[10px] uppercase tracking-[.1em] text-slate-600">{roleLabel(context?.role ?? "asset")} · tenant scoped</span></span></div>
      <nav className="mt-6 min-h-0 flex-1 overflow-y-auto" aria-label="Navigazione principale"><p className="zw-command-sidebar__nav-caption px-3 text-[9px] font-semibold uppercase tracking-[.22em] text-slate-700">Authorized workspace</p><div className="mt-2 space-y-1">{visibleNavItems.map((item) => { const Icon = item.icon; const active = item.id === "assets"; return <button aria-current={active ? "page" : undefined} aria-label={sidebarCollapsed ? item.label : undefined} className={cn("zw-command-nav-item", active && "is-active")} key={item.id} onClick={() => navigate(item.path)} title={sidebarCollapsed ? item.label : undefined} type="button"><Icon className={cn("size-4", active ? "text-lime-200" : "text-slate-600 group-hover:text-slate-300")} /><span className="zw-command-sidebar__nav-label">{item.label}</span>{item.id === "command" && <span className="zw-command-sidebar__nav-badge ml-auto rounded border border-lime-300/20 px-1.5 py-0.5 font-mono text-[8px] tracking-[.08em] text-lime-200">AI</span>}</button>; })}</div></nav>
      <div className="zw-command-sidebar__footer mt-4 border-t border-white/[.07] pt-4"><div className="flex items-center justify-between px-2 text-[9px] uppercase tracking-[.14em] text-slate-600"><span>System core</span><span className="flex items-center gap-1.5 text-lime-200"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_10px_rgba(200,255,34,.9)]" />{payload?.readback?.status === "verified" ? "VERIFIED" : "READING"}</span></div><div className="zw-command-core-status mt-3 rounded-xl p-3"><p className="font-mono text-[9px] text-slate-500">D1 / {assets.length} ASSETS</p><p className="mt-2 font-mono text-[9px] text-lime-300/60">GUARD / LIFECYCLE</p></div></div>
    </aside>
    {mobileMenu && <button aria-label="Chiudi menu" className="fixed inset-0 z-30 bg-black/65 lg:hidden" onClick={() => setMobileMenu(false)} type="button" />}
    <section className="min-w-0 flex-1"><header className="zw-command-topbar sticky top-0 z-20 flex h-[72px] items-center gap-3 px-4 sm:gap-5 sm:px-7"><IconButton className="lg:hidden" label="Apri menu" onClick={() => setMobileMenu(true)}><Menu className="size-4" /></IconButton><button aria-label="Apri Asset" className="zw-command-topbar__brand flex shrink-0 items-center gap-2 text-left" onClick={() => navigate("/assets")} type="button"><span className="relative grid size-9 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black shadow-[0_0_18px_rgba(200,255,34,.12)]"><Image src="/ai-zerow-icon.jpeg" alt="ZEROW" width={36} height={36} className="size-full object-cover" /></span><span className="hidden sm:block"><span className="block text-[11px] font-bold tracking-[.18em] text-slate-50">ZEROW</span><span className="block text-[9px] uppercase tracking-[.2em] text-lime-300/75">assets</span></span></button><IconButton className="hidden lg:grid" label={sidebarCollapsed ? "Espandi sidebar" : "Riduci sidebar"} onClick={() => setSidebarCollapsed((value) => !value)}>{sidebarCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}</IconButton><div className="relative hidden min-w-0 flex-1 justify-center md:flex"><div className="relative w-full max-w-[520px]"><Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-600" /><Input aria-label="Cerca asset" className="h-10 w-full border-lime-300/10 bg-black/35 pl-10 text-xs text-slate-100 placeholder:text-slate-600" onChange={(event) => setQuery(event.target.value)} placeholder="Cerca codice, mezzo, seriale, sede…" value={query} /></div></div><div className="flex min-w-0 flex-1 items-center gap-2 md:hidden"><span className="truncate text-xs font-semibold tracking-[.14em] text-slate-200">ASSET</span><span className="size-1 rounded-full bg-lime-300" /></div><div className="ml-auto flex min-w-0 items-center gap-2"><TenantSwitcher /><span className="hidden items-center gap-2 rounded-full border border-lime-300/20 bg-lime-300/5 px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[.12em] text-lime-200 sm:flex"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_9px_rgba(200,255,34,.9)]" />{refreshing ? "READING" : "D1 VERIFIED"}</span><IconButton label="Torna indietro" onClick={goBack}><ChevronRight className="size-4 rotate-180" /></IconButton><IconButton label="Aggiorna Asset" onClick={() => void refresh()}><RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} /></IconButton>{capabilities.includes("communication.read") && <IconButton label="Apri comunicazioni" onClick={() => navigate("/communications")}><Bell className="size-4" /></IconButton>}<AccountMenu actor={actor} /></div></header>
      <div className="mx-auto w-full max-w-[1560px] px-4 pb-24 pt-5 sm:px-7 sm:pb-8 sm:pt-7">
        <section className="zw-module-hero relative overflow-hidden rounded-[26px] p-5 sm:p-7"><div className="relative z-[1] max-w-3xl"><p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.22em] text-lime-300/80"><Package className="size-3.5" />CONTROL DECK / MODULE 06 · ASSET + FLEET</p><h1 className="mt-3 max-w-3xl text-3xl font-semibold tracking-[-.06em] text-slate-50 sm:text-[46px]">Risorse fisiche<br /><span className="text-lime-300">sempre assegnabili con criterio.</span></h1><p className="mt-4 max-w-2xl text-sm leading-6 text-slate-400">Asset, mezzi e attrezzature hanno un’identità canonica, un lifecycle e una guard di assegnabilità. Planning e Mission ricevono solo riferimenti reali; manutenzione e blocco fermano l’uso operativo.</p><div className="mt-5 flex flex-wrap gap-2"><Button className="bg-lime-300 text-[10px] font-semibold text-[#050705] hover:bg-lime-200" disabled={!canWrite} onClick={() => setCreateOpen(true)}><Package className="size-3.5" />Nuovo asset</Button><Button className="border-lime-300/25 bg-lime-300/[.05] text-[10px] text-lime-100 hover:bg-lime-300/10" onClick={() => navigate("/planning")} variant="outline"><CalendarClock className="size-3.5" />Apri pianificazione</Button></div></div><div className="absolute -right-12 -top-14 size-64 rounded-full bg-lime-300/[.07] blur-3xl" /><div className="absolute bottom-[-75px] right-[12%] size-56 rounded-full border border-lime-300/10 bg-lime-300/[.03] shadow-[0_0_80px_rgba(200,255,34,.12)]" /><div className="absolute right-6 top-6 hidden rounded-2xl border border-lime-300/20 bg-black/25 p-4 text-right sm:block"><p className="text-[9px] font-semibold uppercase tracking-[.18em] text-slate-600">READBACK</p><p className="mt-2 font-mono text-xl text-lime-200">{payload?.readback?.status === "verified" ? "VERIFIED" : "CHECKING"}</p><p className="mt-1 text-[9px] text-slate-600">lifecycle · tenant</p></div></section>
        <section className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><KpiCard label="Asset registrati" value={assets.length} detail="Identità tenant-scoped" icon={Package} tone="cyan" /><KpiCard label="Disponibili" value={availableCount} detail="Assegnabili a Planning/Mission" icon={CheckCircle2} tone="lime" /><KpiCard label="In manutenzione" value={maintenanceCount} detail="Non assegnabili" icon={Wrench} tone="amber" /><KpiCard label="Mezzi" value={vehicleCount} detail={blockedCount + " bloccati"} icon={Truck} tone="cyan" /></section>
        <section className="carbon-card mt-4 rounded-2xl p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-lime-300/70">ASSET CONTROL DECK</p><h2 className="mt-1 text-lg font-semibold text-slate-100">Registro e assegnabilità</h2><p className="mt-1 text-[11px] text-slate-500">Il lifecycle è il confine che decide se una risorsa può entrare in un piano o in una missione.</p></div><span className="flex items-center gap-2 text-[9px] uppercase tracking-[.14em] text-slate-600"><span className="size-1.5 rounded-full bg-lime-300" />{assets.length} RECORD</span></div><div className="mt-4 flex flex-wrap gap-2"><label className="relative min-w-[230px] flex-1 md:hidden"><Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-600" /><Input aria-label="Filtra asset" className="h-9 border-white/10 bg-black/25 pl-9 text-[10px]" onChange={(event) => setQuery(event.target.value)} placeholder="Filtra questa superficie…" value={query} /></label><select aria-label="Filtra tipologia asset" className="h-9 rounded-xl border border-white/10 bg-black/25 px-3 text-[10px] text-slate-300 outline-none focus:border-lime-300/40" onChange={(event) => setAssetFilter(event.target.value as AssetFilter)} value={assetFilter}><option className="bg-[#080c09]" value="ALL">Tutti i tipi</option><option className="bg-[#080c09]" value="ASSET">Asset</option><option className="bg-[#080c09]" value="VEHICLE">Mezzi</option><option className="bg-[#080c09]" value="EQUIPMENT">Attrezzature</option></select><select aria-label="Filtra lifecycle asset" className="h-9 rounded-xl border border-white/10 bg-black/25 px-3 text-[10px] text-slate-300 outline-none focus:border-lime-300/40" onChange={(event) => setLifecycleFilter(event.target.value as LifecycleFilter)} value={lifecycleFilter}><option className="bg-[#080c09]" value="ALL">Tutti i lifecycle</option><option className="bg-[#080c09]" value="AVAILABLE">Disponibili</option><option className="bg-[#080c09]" value="MAINTENANCE">Manutenzione</option><option className="bg-[#080c09]" value="BLOCKED">Bloccati</option></select><Button className="h-9 border-white/10 bg-black/20 text-[10px] text-slate-300 hover:border-lime-300/30 hover:bg-lime-300/10 hover:text-lime-100" onClick={() => { setQuery(""); setAssetFilter("ALL"); setLifecycleFilter("ALL"); }} variant="outline"><RefreshCw className="size-3.5" />Reset filtri</Button><span className="ml-auto self-center font-mono text-[9px] text-slate-600">{filteredAssets.length} / {assets.length} RECORD</span></div></section>
        <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.14fr)_minmax(360px,.86fr)]"><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-cyan-200/70">REGISTRO CANONICO</p><h2 className="mt-1 text-sm font-semibold text-slate-100">Asset, mezzi e attrezzature</h2></div><IconButton label="Aggiorna registro asset" onClick={() => void refresh()}><RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} /></IconButton></div><div className="mt-4 space-y-2">{filteredAssets.map((asset) => <AssetCard asset={asset} key={asset.id} onSelect={() => setSelectedId(asset.id)} selected={asset.id === selectedAsset?.id} />)}{filteredAssets.length === 0 && <div className="rounded-2xl border border-dashed border-lime-300/15 bg-black/15 p-10 text-center"><Package className="mx-auto size-8 text-slate-700" /><p className="mt-3 text-sm font-medium text-slate-300">Nessuna risorsa nel perimetro</p><p className="mt-1 text-[11px] text-slate-600">Registra il primo asset o rimuovi i filtri.</p><Button className="mt-4 bg-lime-300 text-[10px] font-semibold text-[#050705] hover:bg-lime-200" disabled={!canWrite} onClick={() => setCreateOpen(true)}><Package className="size-3.5" />Registra asset</Button></div>}</div></section><aside className="space-y-4"><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">RESOURCE INSPECTOR</p><h2 className="mt-1 text-lg font-semibold text-slate-100">{selectedAsset ? selectedAsset.canonicalCode ?? selectedAsset.title : "Nessun asset selezionato"}</h2><p className="mt-1 text-[10px] text-slate-500">{selectedAsset ? entityLabel(selectedAsset) + " · " + selectedAsset.id : "Seleziona una risorsa dal registro"}</p></div>{selectedAsset && <StatusPill label={lifecycleLabel(lifecycleStatus(selectedAsset))} tone={lifecycleTone(lifecycleStatus(selectedAsset))} />}</div>{selectedAsset ? <><div className="mt-4 grid gap-2 sm:grid-cols-2"><div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">Identità tecnica</p><p className="mt-2 text-[11px] text-slate-200">{payloadValue(selectedAsset, "brand")} {payloadValue(selectedAsset, "model")}</p><p className="mt-1 text-[9px] text-slate-600">{payloadValue(selectedAsset, "serialNumber")} · {payloadValue(selectedAsset, "registration")}</p></div><div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">Assegnabilità</p><p className={cn("mt-2 text-[11px]", lifecycleStatus(selectedAsset) === "AVAILABLE" ? "text-lime-200" : "text-rose-200")}>{lifecycleStatus(selectedAsset) === "AVAILABLE" ? "ASSIGNABLE" : "NOT ASSIGNABLE"}</p><p className="mt-1 text-[9px] text-slate-600">Guard server-side · Planning/Mission</p></div><div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">Ubicazione</p><p className="mt-2 text-[11px] text-slate-200">{payloadValue(selectedAsset, "location")}</p><p className="mt-1 text-[9px] text-slate-600">ultimo readback · {formatDate(selectedAsset.updatedAt)}</p></div><div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">Capacità</p><p className="mt-2 text-[11px] text-slate-200">{payloadValue(selectedAsset, "capacity")}</p><p className="mt-1 text-[9px] text-slate-600">barcode · {payloadValue(selectedAsset, "barcode")}</p></div></div><div className="mt-4 flex flex-wrap gap-2"><Link className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-lime-300 px-3 py-2 text-[10px] font-semibold text-[#050705] hover:bg-lime-200" href="/planning">Apri Planning <CalendarClock className="size-3.5" /></Link><Link className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-lime-300/25 bg-lime-300/[.05] px-3 py-2 text-[10px] font-semibold text-lime-100 hover:bg-lime-300/10" href="/mission">Apri Mission <Truck className="size-3.5" /></Link><Link className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[10px] text-slate-300 hover:border-lime-300/30 hover:text-lime-100" href="/qr">QR / Barcode <QrCode className="size-3.5" /></Link></div><div className="mt-5 border-t border-white/[.08] pt-4"><p className="text-[9px] font-semibold uppercase tracking-[.16em] text-slate-600">LIFECYCLE ACTION</p><Input aria-label="Nota o motivazione transizione" className="mt-3 h-10 border-white/10 bg-black/25 text-[11px] text-slate-100 placeholder:text-slate-600" disabled={!canWrite || Boolean(busy)} onChange={(event) => setNote(event.target.value)} placeholder="Motivazione manutenzione, blocco o rilascio…" value={note} />{canWrite ? <div className="mt-3 flex flex-wrap gap-2">{lifecycleStatus(selectedAsset) === "AVAILABLE" && <><Button className="h-9 border-amber-300/25 bg-amber-300/[.06] text-[10px] text-amber-100 hover:bg-amber-300/10" disabled={Boolean(busy)} onClick={() => void transition("maintenance_open")} variant="outline">{busy === "maintenance_open" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Wrench className="size-3.5" />}Apri manutenzione</Button><Button className="h-9 border-rose-300/25 bg-rose-300/[.04] text-[10px] text-rose-100 hover:bg-rose-300/10" disabled={Boolean(busy)} onClick={() => void transition("block")} variant="outline">{busy === "block" ? <LoaderCircle className="size-3.5 animate-spin" /> : <CircleAlert className="size-3.5" />}Blocca asset</Button></>}{lifecycleStatus(selectedAsset) === "MAINTENANCE" && <><Button className="h-9 bg-lime-300 text-[10px] font-semibold text-[#050705] hover:bg-lime-200" disabled={Boolean(busy)} onClick={() => void transition("maintenance_close")}>{busy === "maintenance_close" ? <LoaderCircle className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}Rilascia</Button><Button className="h-9 border-rose-300/25 bg-rose-300/[.04] text-[10px] text-rose-100 hover:bg-rose-300/10" disabled={Boolean(busy)} onClick={() => void transition("block")} variant="outline">{busy === "block" ? <LoaderCircle className="size-3.5 animate-spin" /> : <CircleAlert className="size-3.5" />}Blocca asset</Button></>}{lifecycleStatus(selectedAsset) === "BLOCKED" && <Button className="h-9 bg-lime-300 text-[10px] font-semibold text-[#050705] hover:bg-lime-200" disabled={Boolean(busy)} onClick={() => void transition("release")}>{busy === "release" ? <LoaderCircle className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}Riattiva e rendi assegnabile</Button>}</div> : <p className="mt-3 text-[10px] text-slate-600">Il tuo ruolo può consultare il registro ma non modificare il lifecycle.</p>}</div></> : <div className="mt-5 rounded-xl border border-dashed border-white/10 p-6 text-center text-[10px] text-slate-600">Seleziona un asset per vedere identità, guard e lifecycle.</div>}</section><section className="carbon-card-neon rounded-2xl p-4 sm:p-5"><div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-2xl border border-cyan-300/25 bg-cyan-300/10 text-cyan-200"><ShieldCheck className="size-5" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-cyan-200/70">ASSIGNMENT GUARD</p><h2 className="mt-1 text-[15px] font-semibold text-slate-100">Una risorsa, un criterio</h2></div></div><div className="mt-4 space-y-2 text-[10px] text-slate-500"><p className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-lime-200" />Planning usa solo asset con lifecycle disponibile.</p><p className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-lime-200" />Mission seleziona mezzo e asset tramite ID reali e finestra libera.</p><p className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-lime-200" />Manutenzione e blocco producono evento e reconciliation D1.</p><p className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-lime-200" />Telemetria continua e certificazioni esterne restano gate separati.</p></div></section></aside></section>
        <section className="mt-4 grid gap-4 lg:grid-cols-3"><article className="carbon-inset rounded-2xl p-4"><div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[.18em] text-amber-200/80"><Wrench className="size-3.5" />MANUTENZIONE</div><p className="mt-3 font-mono text-2xl text-amber-100">{maintenanceCount}</p><p className="mt-1 text-[10px] text-slate-500">asset fuori assegnabilità</p></article><article className="carbon-inset rounded-2xl p-4"><div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[.18em] text-rose-200/80"><CircleAlert className="size-3.5" />BLOCCO OPERATIVO</div><p className="mt-3 font-mono text-2xl text-rose-100">{blockedCount}</p><p className="mt-1 text-[10px] text-slate-500">richiedono rilascio autorizzato</p></article><article className="carbon-inset rounded-2xl p-4"><div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[.18em] text-cyan-200/80"><Gauge className="size-3.5" />CAPACITÀ</div><p className="mt-3 font-mono text-2xl text-cyan-100">{availableCount}</p><p className="mt-1 text-[10px] text-slate-500">risorse oggi assegnabili</p></article></section>
        <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,.9fr)]"><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-amber-200/70">MAINTENANCE BOARD</p><h2 className="mt-1 text-[15px] font-semibold text-slate-100">Asset da verificare</h2><p className="mt-1 text-[11px] text-slate-500">La manutenzione non è una nota: è un gate di assegnabilità.</p></div><span className="font-mono text-[9px] text-slate-600">{maintenanceCount + blockedCount} REC</span></div><div className="mt-4 space-y-2">{assets.filter((asset) => ["MAINTENANCE", "BLOCKED"].includes(lifecycleStatus(asset))).slice(0, 8).map((asset) => <button className="flex w-full items-center gap-3 rounded-xl border border-white/[.08] bg-black/20 p-3 text-left transition hover:border-lime-300/25" key={asset.id} onClick={() => { setSelectedId(asset.id); setLifecycleFilter("ALL"); }} type="button"><span className={cn("grid size-8 shrink-0 place-items-center rounded-lg border border-current/20 bg-current/10", toneStyles[lifecycleTone(lifecycleStatus(asset))].icon)}><Wrench className="size-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-semibold text-slate-200">{asset.canonicalCode ?? asset.title}</span><span className="mt-1 block truncate text-[9px] text-slate-600">{payloadValue(asset, "location")} · aggiornato {formatDate(asset.updatedAt)}</span></span><StatusPill label={lifecycleLabel(lifecycleStatus(asset))} tone={lifecycleTone(lifecycleStatus(asset))} /></button>)}{maintenanceCount + blockedCount === 0 && <div className="rounded-xl border border-dashed border-white/10 p-7 text-center text-[10px] text-slate-600">Nessun asset fermo nel readback.</div>}</div></section><section className="carbon-card-neon rounded-2xl p-4 sm:p-5"><div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-2xl border border-lime-300/25 bg-lime-300/10 text-lime-200"><Sparkles className="size-5" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-lime-300/70">COMPANY AI / ASSET</p><h2 className="mt-1 text-[15px] font-semibold text-slate-100">Analisi governata</h2></div><StatusPill label="READ ONLY" tone="cyan" /></div><p className="mt-3 text-[11px] leading-5 text-slate-500">Company AI può leggere lifecycle, disponibilità e storico eventi autorizzati; non può rilasciare o bloccare direttamente un asset.</p><div className="mt-4 space-y-2"><button className="flex w-full items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-left text-[11px] text-slate-400 transition hover:border-lime-300/30 hover:text-lime-100" onClick={() => navigate("/command?prompt=Analizza%20asset%20in%20manutenzione")} type="button"><Sparkles className="size-3.5 text-lime-300" />Analizza asset in manutenzione <ArrowUpRight className="ml-auto size-3.5" /></button><button className="flex w-full items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-left text-[11px] text-slate-400 transition hover:border-lime-300/30 hover:text-lime-100" onClick={() => navigate("/command?prompt=Trova%20asset%20assegnabili")} type="button"><Search className="size-3.5 text-lime-300" />Trova asset assegnabili <ArrowUpRight className="ml-auto size-3.5" /></button></div></section></section>
        <section className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-cyan-300/15 bg-cyan-300/[.03] px-4 py-3 text-[10px] text-slate-500"><span className="flex items-center gap-2"><ShieldCheck className="size-3.5 shrink-0 text-cyan-200" />Tenant-scoped · lifecycle server-side · event + reconciliation</span><span className="flex items-center gap-2"><Link className="text-lime-200 hover:text-lime-100" href="/mission">Missioni <ArrowUpRight className="ml-1 inline size-3" /></Link><span>·</span><Link className="text-lime-200 hover:text-lime-100" href="/qr">QR / Barcode <ArrowUpRight className="ml-1 inline size-3" /></Link></span></section>
        <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/[.07] py-5 text-[10px] text-slate-700"><span>AI-ZEROW COMMAND · MODULE 06 · asset control</span><span className="flex items-center gap-2"><span>ultra carbon core</span><span className="size-1 rounded-full bg-lime-300" /><span>capability filtered</span></span></footer>
      </div>
    </section>
  </div><CommandMobileNav active="more" allowedNavigation={allowedNavigation} role={context?.role} /><ServerNamingDialog module="assets" open={createOpen} onOpenChange={setCreateOpen} onCreated={() => void refresh()} onNotice={setNotice} />{notice && <button className="fixed bottom-5 left-1/2 z-[100] flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-2 rounded-xl border border-lime-300/25 bg-[#080d09]/96 px-4 py-3 text-left text-xs text-lime-100 shadow-[0_0_34px_rgba(200,255,34,.16)] backdrop-blur-xl" onClick={() => setNotice("")} type="button"><CircleAlert className="size-4 shrink-0 text-amber-200" />{notice}</button>}</main>;
}
