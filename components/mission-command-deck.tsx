"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Bell,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  CircleGauge,
  ClipboardCheck,
  Clock3,
  FileCheck2,
  FileText,
  Gauge,
  Layers3,
  LoaderCircle,
  MapPin,
  Menu,
  MessageSquareText,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Route,
  Search,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Truck,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { AccountMenu } from "@/components/account-menu";
import { CommandMobileNav } from "@/components/command-mobile-nav";
import { MissionResourceFields } from "@/components/mission-resource-fields";
import { TenantSwitcher } from "@/components/tenant-switcher";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getAllowedCommandNavigation, type CommandNavigationId } from "@/lib/command-dashboard";
import { TRANSPORT_MODE_CATALOG, type TransportMode } from "@/lib/tenant-operating-model";

type Tone = "lime" | "cyan" | "amber" | "red" | "muted";
type MissionStatus = "PLANNED" | "DISPATCHED" | "DELIVERED" | "POD_VERIFIED" | "RECONCILED" | "CLOSED" | string;
type Modal = "create" | "delivery" | "pod" | "reconcile" | null;

type Mission = {
  id: string;
  jobId: string;
  jobCode: string | null;
  jobTitle: string;
  jobModule: string;
  title: string;
  status: MissionStatus;
  version: number;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type MissionJob = {
  id: string;
  code: string | null;
  title: string;
  client: string | null;
  location: string | null;
  status: string;
};

type MissionContext = {
  actorName?: string;
  actorEmail?: string;
  role?: string;
  capabilities?: string[];
  operatingTransportModes?: TransportMode[];
};

type MissionPayload = {
  context?: MissionContext;
  jobs: MissionJob[];
  missions: Mission[];
  summary: {
    total: number;
    planned: number;
    dispatched: number;
    delivered: number;
  };
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
  { id: "documents", label: "DOCUMENTI", path: "/documents", capability: "documents.read", icon: FileText },
  { id: "authority", label: "AUTHORITY", path: "/onboarding", capability: "authority.read", icon: ShieldCheck },
  { id: "events", label: "EVENTI", path: "/events", capability: "events.read", icon: Activity },
  { id: "settings", label: "IMPOSTAZIONI", path: "/settings", capability: "settings.read", icon: SlidersHorizontal },
];

const lifecycle = [
  { value: "PLANNED", label: "Pianificata" },
  { value: "DISPATCHED", label: "In viaggio" },
  { value: "DELIVERED", label: "Consegnata" },
  { value: "POD_VERIFIED", label: "POD verificata" },
  { value: "RECONCILED", label: "Riconciliata" },
  { value: "CLOSED", label: "Chiusa" },
] as const;

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Amministratore",
  manager: "Manager",
  office: "Ufficio",
  technical: "Tecnico",
  field_supervisor: "Caposquadra",
  worker: "Operatore",
  warehouse_manager: "Responsabile magazzino",
  warehouse_operator: "Operatore magazzino",
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
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function formatDate(value: unknown) {
  if (typeof value !== "string" || !value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
}

function localDateTime() {
  const date = new Date();
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

function field(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function roleLabel(role: string) {
  return ROLE_LABELS[role] ?? role;
}

function statusTone(status: string): Tone {
  if (status === "CLOSED" || status === "POD_VERIFIED" || status === "RECONCILED") return "lime";
  if (status === "DISPATCHED") return "cyan";
  if (status === "DELIVERED") return "lime";
  if (status === "BLOCKED" || status === "REFUSED" || status === "CANCELLED") return "red";
  if (status === "DELAYED" || status === "RECONCILE_REQUIRED") return "amber";
  return "muted";
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    PLANNED: "PIANIFICATA",
    DISPATCHED: "IN VIAGGIO",
    DELIVERED: "CONSEGNATA",
    POD_VERIFIED: "POD VERIFICATA",
    RECONCILED: "RICONCILIATA",
    CLOSED: "CHIUSA",
    BLOCKED: "BLOCCATA",
    DELAYED: "IN RITARDO",
  };
  return labels[status] ?? status.replaceAll("_", " ");
}

function modeLabel(mode: unknown) {
  if (typeof mode !== "string") return "Trasporto";
  return TRANSPORT_MODE_CATALOG[mode as TransportMode]?.label ?? mode.replaceAll("_", " ");
}

function snapshotLabel(payload: Record<string, unknown>, key: "driver" | "vehicle" | "cargoAsset") {
  const snapshot = payload.resourceSnapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return "Non disponibile";
  const value = (snapshot as Record<string, unknown>)[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) return key === "cargoAsset" ? "Nessun asset associato" : "Non disponibile";
  const record = value as Record<string, unknown>;
  const code = text(record.code, "");
  const label = text(record.label, "Risorsa");
  return code && code !== label ? code + " · " + label : label;
}

function IconButton({ label, children, onClick, className = "" }: { label: string; children: ReactNode; onClick?: () => void; className?: string }) {
  return <button aria-label={label} className={cn("grid size-9 place-items-center rounded-lg border border-white/10 bg-black/20 text-slate-500 transition hover:border-lime-300/35 hover:bg-lime-300/10 hover:text-lime-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300", className)} onClick={onClick} type="button">{children}</button>;
}

function StatusPill({ label, tone }: { label: string; tone: Tone }) {
  return <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[.06em]", toneStyles[tone].badge)}><span className="size-1.5 rounded-full bg-current shadow-[0_0_8px_currentColor]" />{label}</span>;
}

function KpiCard({ label, value, detail, icon: Icon, tone }: { label: string; value: number | string; detail: string; icon: LucideIcon; tone: Tone }) {
  return <article className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><span className={cn("grid size-10 place-items-center rounded-xl border border-current/20 bg-current/10", toneStyles[tone].icon)}><Icon className="size-[18px]" /></span><span className="font-mono text-[10px] text-slate-600">D1</span></div><p className="mt-5 text-[11px] font-semibold uppercase tracking-[.16em] text-slate-600">{label}</p><p className="mt-2 font-mono text-[32px] font-semibold leading-none tracking-[-.07em] text-slate-50">{value}</p><p className="mt-4 text-[11px] text-slate-600">{detail}</p></article>;
}

function MissionCard({ mission, selected, canWrite, onSelect, onDispatch, onDeliver }: { mission: Mission; selected: boolean; canWrite: boolean; onSelect: () => void; onDispatch: () => void; onDeliver: () => void }) {
  const tone = statusTone(mission.status);
  return <article className={cn("rounded-2xl border p-4 transition", selected ? "border-lime-300/40 bg-lime-300/[.075] shadow-[0_0_28px_rgba(200,255,34,.09)]" : "border-white/[.08] bg-black/20 hover:border-lime-300/25 hover:bg-lime-300/[.03]")}><button className="w-full text-left" onClick={onSelect} type="button"><div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-3"><span className={cn("grid size-10 shrink-0 place-items-center rounded-xl border border-current/20 bg-current/10", toneStyles[tone].icon)}><Truck className="size-[18px]" /></span><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-100">{mission.title}</p><p className="mt-1 truncate font-mono text-[10px] text-slate-600">{mission.jobCode ?? mission.jobId} · v{mission.version}</p></div></div><ChevronRight className={cn("size-4 shrink-0", selected ? "text-lime-200" : "text-slate-700")} /></div><div className="mt-3 flex flex-wrap items-center gap-2"><StatusPill label={statusLabel(mission.status)} tone={tone} /><span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[10px] text-slate-500">{modeLabel(mission.payload.transportMode)}</span></div><div className="mt-4 grid gap-2 sm:grid-cols-2"><div className="rounded-xl border border-white/[.07] bg-black/25 p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">Partenza</p><p className="mt-1 truncate text-[11px] text-slate-300"><MapPin className="mr-1 inline size-3 text-cyan-200" />{text(mission.payload.pickup)}</p></div><div className="rounded-xl border border-white/[.07] bg-black/25 p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">Destinazione</p><p className="mt-1 truncate text-[11px] text-slate-300"><MapPin className="mr-1 inline size-3 text-lime-200" />{text(mission.payload.dropoff)}</p></div></div><div className="mt-4 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-600"><span>{formatDate(mission.payload.plannedAt)}</span><span>{snapshotLabel(mission.payload, "driver")}</span><span>{snapshotLabel(mission.payload, "vehicle")}</span></div></button><div className="mt-4 flex flex-wrap gap-2">{mission.jobModule === "operations" && <Link className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-[10px] text-slate-400 hover:border-lime-300/25 hover:text-lime-100" href={"/operations/" + encodeURIComponent(mission.jobId)} onClick={(event) => event.stopPropagation()}>Commessa <ArrowRight className="size-3" /></Link>}{canWrite && mission.status === "PLANNED" && <Button variant="outline" className="h-9 border-cyan-300/20 bg-cyan-300/[.05] text-[10px] text-cyan-100" onClick={onDispatch}><Send className="size-3.5" />Partenza</Button>}{canWrite && mission.status === "DISPATCHED" && <Button variant="outline" className="h-9 border-lime-300/20 bg-lime-300/[.05] text-[10px] text-lime-100" onClick={onDeliver}><BadgeCheck className="size-3.5" />Consegna / POD</Button>}</div></article>;
}

export default function MissionCommandDeck() {
  const router = useRouter();
  const [payload, setPayload] = useState<MissionPayload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "forbidden" | "error">("loading");
  const [refreshing, setRefreshing] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [plannedAt, setPlannedAt] = useState("");
  const [plannedEndAt, setPlannedEndAt] = useState("");
  const [driverId, setDriverId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [cargoAssetId, setCargoAssetId] = useState("");
  const [transportMode, setTransportMode] = useState<TransportMode | "">("");
  const [deliveredAt, setDeliveredAt] = useState("");

  const notify = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 4600);
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/mission/control", { cache: "no-store" });
      if (response.status === 403) {
        setState("forbidden");
        return;
      }
      const next = await response.json() as MissionPayload & { error?: string };
      if (!response.ok) throw new Error(next.error ?? "mission_control_unavailable");
      setPayload(next);
      setSelectedId((current) => current && next.missions.some((mission) => mission.id === current) ? current : next.missions[0]?.id ?? "");
      setState("ready");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Mission control non disponibile.");
      setState((current) => current === "ready" ? current : "error");
    } finally {
      setRefreshing(false);
    }
  }, [notify]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const context = payload?.context;
  const capabilities = useMemo(() => context?.capabilities ?? ["mission.read"], [context]);
  const allowedNavigation = useMemo(() => getAllowedCommandNavigation(capabilities).map((item) => item.id), [capabilities]);
  const visibleNavItems = useMemo(() => navItems.filter((item) => allowedNavigation.includes(item.id) || capabilities.includes(item.capability)), [allowedNavigation, capabilities]);
  const missions = useMemo(() => payload?.missions ?? [], [payload?.missions]);
  const jobs = useMemo(() => payload?.jobs ?? [], [payload?.jobs]);
  const filteredMissions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return missions.filter((mission) => {
      const haystack = [mission.id, mission.jobId, mission.jobCode, mission.jobTitle, mission.title, mission.status, mission.payload.pickup, mission.payload.dropoff, mission.payload.transportMode, snapshotLabel(mission.payload, "driver"), snapshotLabel(mission.payload, "vehicle")].join(" ").toLowerCase();
      return (!normalized || haystack.includes(normalized)) && (statusFilter === "ALL" || mission.status === statusFilter);
    });
  }, [missions, query, statusFilter]);
  const selected = missions.find((mission) => mission.id === selectedId) ?? filteredMissions[0] ?? null;
  const canWrite = capabilities.includes("mission.write");
  const enabledTransportModes = context?.operatingTransportModes ?? [];
  const actor = { email: context?.actorEmail ?? "operator@zerow.local", name: context?.actorName ?? "Operatore" };
  const counts = useMemo(() => ({
    verified: missions.filter((mission) => mission.status === "POD_VERIFIED").length,
    reconciled: missions.filter((mission) => mission.status === "RECONCILED").length,
    closed: missions.filter((mission) => mission.status === "CLOSED").length,
  }), [missions]);

  function navigate(path: string) {
    setMobileMenu(false);
    router.push(path);
  }

  function goBack() {
    if (window.history.length > 1) router.back();
    else router.push("/command");
  }

  function openCreate() {
    setPlannedAt("");
    setPlannedEndAt("");
    setDriverId("");
    setVehicleId("");
    setCargoAssetId("");
    setTransportMode((enabledTransportModes.includes("ASSET_TRANSFER") ? "ASSET_TRANSFER" : enabledTransportModes[0]) ?? "");
    setModal("create");
  }

  function openDelivery() {
    setDeliveredAt(localDateTime());
    setModal("delivery");
  }

  const mutateJourney = useCallback(async (mission: Mission, action: string, body: Record<string, unknown> = {}) => {
    setBusy(true);
    try {
      const response = await fetch("/api/operations/jobs/" + encodeURIComponent(mission.jobId) + "/journey", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          recordId: mission.id,
          expectedVersion: mission.version,
          idempotencyKey: "mission-" + action + "-" + crypto.randomUUID(),
          ...body,
        }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) {
        if (response.status === 409) await refresh();
        notify(result.error === "version_conflict" ? "La missione è cambiata: readback aggiornato." : "Operazione non eseguita: " + (result.error ?? "errore"));
        return;
      }
      await refresh();
      setModal(null);
      notify("Journey aggiornata e riletta dal ledger.");
    } catch {
      notify("Connessione non disponibile: nessuna modifica confermata.");
    } finally {
      setBusy(false);
    }
  }, [notify, refresh]);

  const createMission = useCallback(async (jobId: string, body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const standalone = jobId === "__standalone__";
      const url = standalone
        ? "/api/mission/control"
        : "/api/operations/jobs/" + encodeURIComponent(jobId) + "/journey";
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "mission_create",
          idempotencyKey: "mission-create-" + crypto.randomUUID(),
          ...body,
        }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) {
        if (response.status === 409) await refresh();
        notify("Missione non creata: " + (result.error ?? "errore"));
        return;
      }
      await refresh();
      setModal(null);
      notify("Missione creata e readback verificato.");
    } catch {
      notify("Connessione non disponibile: nessuna missione modificata.");
    } finally {
      setBusy(false);
    }
  }, [notify, refresh]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (modal === "create") {
      const jobId = field(form, "jobId");
      const mode = field(form, "transportMode") as TransportMode;
      const selectedCargo = field(form, "cargoAssetId");
      if (!jobId || !field(form, "driverId") || !field(form, "vehicleId")) {
        notify("Seleziona il collegamento, un autista e un mezzo dal registro disponibile.");
        return;
      }
      if (mode === "ASSET_TRANSFER" && !selectedCargo) {
        notify("Per un trasferimento asset devi selezionare l’asset reale da consegnare.");
        return;
      }
      if (mode === "WAREHOUSE_TO_JOB" && jobId === "__standalone__") {
        notify("Il trasporto magazzino → commessa richiede una commessa reale.");
        return;
      }
      await createMission(jobId, {
        title: field(form, "title"),
        pickup: field(form, "pickup"),
        dropoff: field(form, "dropoff"),
        plannedAt: field(form, "plannedAt"),
        plannedEndAt: field(form, "plannedEndAt"),
        driverId: field(form, "driverId"),
        vehicleId: field(form, "vehicleId"),
        cargoAssetId: selectedCargo,
        transportMode: mode,
        notes: field(form, "notes"),
      });
      return;
    }
    if (!selected) return;
    if (modal === "delivery") {
      await mutateJourney(selected, "mission_deliver", {
        recipient: field(form, "recipient"),
        deliveredAt: deliveredAt || field(form, "deliveredAt"),
        documentId: field(form, "documentId"),
        note: field(form, "note"),
      });
    }
    if (modal === "pod") {
      await mutateJourney(selected, "mission_verify_pod", { documentId: field(form, "documentId") });
    }
    if (modal === "reconcile") {
      await mutateJourney(selected, "mission_reconcile", { note: field(form, "note") });
    }
  }

  if (state === "loading" && !payload) return <main className="grid min-h-screen place-items-center bg-[#030504] text-sm text-slate-500"><span className="flex items-center gap-3"><LoaderCircle className="size-4 animate-spin text-lime-300" />Caricamento mission control…</span></main>;
  if (state === "forbidden") return <main className="grid min-h-screen place-items-center bg-[#030504] px-5 text-slate-100"><section className="carbon-card max-w-lg rounded-3xl p-7 text-center"><ShieldCheck className="mx-auto size-8 text-amber-200" /><h1 className="mt-4 text-lg font-semibold">Missioni non visibili</h1><p className="mt-2 text-sm text-slate-500">Il ruolo corrente non dispone della capability mission.read.</p><Button className="mt-5 bg-lime-300 text-[#050705] hover:bg-lime-200" onClick={() => router.push("/command")}>Torna al Command</Button></section></main>;
  if (state === "error" && !payload) return <main className="grid min-h-screen place-items-center bg-[#030504] text-slate-100"><section className="carbon-card rounded-2xl p-7 text-center"><CircleAlert className="mx-auto size-7 text-amber-200" /><p className="mt-3 text-sm text-slate-300">Readback missioni non disponibile</p><Button className="mt-4 bg-lime-300 text-[#050705] hover:bg-lime-200" onClick={() => void refresh()}><RefreshCw className="size-4" />Riprova</Button></section></main>;

  return <main className="zw-app-shell zw-mission-module min-h-screen overflow-x-hidden text-slate-100 selection:bg-lime-300 selection:text-[#060806]"><div className="zw-command-ambient" aria-hidden="true" /><div className="relative flex min-h-screen">
    <aside className={cn("zw-command-sidebar fixed inset-y-0 left-0 z-40 flex flex-col px-3 py-4 transition-[width,transform] lg:static lg:translate-x-0", sidebarCollapsed ? "is-collapsed lg:w-[76px]" : "lg:w-[248px]", mobileMenu ? "translate-x-0" : "-translate-x-full")}>
      <div className="flex items-center justify-between px-2"><button aria-label="Apri Command" className="flex min-w-0 items-center gap-3 text-left" onClick={() => navigate("/command")} type="button"><span className="neon-pulse relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black shadow-[0_0_22px_rgba(200,255,34,.12)]"><Image src="/ai-zerow-icon.jpeg" alt="AI-ZEROW" width={40} height={40} className="size-full object-cover" /></span><span className="zw-command-sidebar__brand-copy min-w-0"><span className="block text-sm font-bold tracking-[.18em] text-slate-50">AI-ZEROW</span><span className="block text-[10px] uppercase tracking-[.22em] text-lime-300/75">command</span></span></button><div className="flex items-center gap-1"><IconButton label={sidebarCollapsed ? "Espandi sidebar" : "Riduci sidebar"} className="hidden lg:grid" onClick={() => setSidebarCollapsed((value) => !value)}>{sidebarCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}</IconButton><IconButton label="Chiudi menu" className="lg:hidden" onClick={() => setMobileMenu(false)}><X className="size-4" /></IconButton></div></div>
      <div className="zw-command-tenant mt-7 flex items-center gap-3 rounded-2xl p-3"><span className="grid size-9 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/10 text-lime-200"><Truck className="size-4" /></span><span className="zw-command-sidebar__tenant-copy min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-slate-200">ZEROW workspace</span><span className="mt-0.5 block truncate text-[10px] uppercase tracking-[.1em] text-slate-600">{roleLabel(context?.role ?? "operator")} · tenant scoped</span></span></div>
      <nav className="mt-6 min-h-0 flex-1 overflow-y-auto" aria-label="Navigazione principale"><p className="zw-command-sidebar__nav-caption px-3 text-[10px] font-semibold uppercase tracking-[.22em] text-slate-700">Authorized workspace</p><div className="mt-2 space-y-1">{visibleNavItems.map((item) => { const Icon = item.icon; const active = item.id === "mission"; return <button aria-current={active ? "page" : undefined} aria-label={sidebarCollapsed ? item.label : undefined} className={cn("zw-command-nav-item", active && "is-active")} key={item.id} onClick={() => navigate(item.path)} title={sidebarCollapsed ? item.label : undefined} type="button"><Icon className={cn("size-4", active ? "text-lime-200" : "text-slate-600")} /><span className="zw-command-sidebar__nav-label">{item.label}</span>{item.id === "command" && <span className="zw-command-sidebar__nav-badge ml-auto rounded border border-lime-300/20 px-1.5 py-0.5 font-mono text-[9px] tracking-[.08em] text-lime-200">AI</span>}</button>; })}</div></nav>
      <div className="zw-command-sidebar__footer mt-4 border-t border-white/[.07] pt-4"><div className="flex items-center justify-between px-2 text-[10px] uppercase tracking-[.14em] text-slate-600"><span>System core</span><span className="flex items-center gap-1.5 text-lime-200"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_8px_rgba(200,255,34,.8)]" />D1 ONLINE</span></div><div className="carbon-inset mt-3 rounded-xl p-3"><div className="flex items-center gap-2 text-[11px] text-slate-400"><Route className="size-3.5 text-lime-300" />Mission ledger</div><p className="mt-2 font-mono text-[10px] text-slate-600">{missions.length} missioni · {counts.verified} POD</p><p className="mt-3 font-mono text-[10px] text-slate-600">Sites · D1 readback</p></div></div>
    </aside>

    <section className="min-w-0 flex-1"><header className="zw-command-topbar sticky top-0 z-20 flex h-[72px] items-center gap-3 px-4 sm:gap-5 sm:px-7"><IconButton className="lg:hidden" label="Apri menu" onClick={() => setMobileMenu(true)}><Menu className="size-4" /></IconButton><button aria-label="Apri Missioni" className="zw-command-topbar__brand flex shrink-0 items-center gap-2 text-left" onClick={() => navigate("/mission")} type="button"><span className="relative grid size-9 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black shadow-[0_0_18px_rgba(200,255,34,.12)]"><Image src="/ai-zerow-icon.jpeg" alt="ZEROW" width={36} height={36} className="size-full object-cover" /></span><span className="hidden sm:block"><span className="block text-[11px] font-bold tracking-[.18em] text-slate-50">ZEROW</span><span className="block text-[10px] uppercase tracking-[.2em] text-lime-300/75">mission control</span></span></button><IconButton className="hidden lg:grid" label={sidebarCollapsed ? "Espandi sidebar" : "Riduci sidebar"} onClick={() => setSidebarCollapsed((value) => !value)}>{sidebarCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}</IconButton><div className="relative hidden min-w-0 flex-1 justify-center md:flex"><div className="relative w-full max-w-[520px]"><Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-600" /><Input aria-label="Cerca missioni" className="h-10 w-full border-lime-300/10 bg-black/35 pl-10 text-sm text-slate-100 placeholder:text-slate-600" onChange={(event) => setQuery(event.target.value)} placeholder="Cerca missione, commessa, tratta, autista…" value={query} /></div></div><div className="flex min-w-0 flex-1 items-center gap-2 md:hidden"><span className="truncate text-xs font-semibold tracking-[.14em] text-slate-200">MISSION CONTROL</span><span className="size-1 rounded-full bg-lime-300" /></div><div className="ml-auto flex min-w-0 items-center gap-2"><TenantSwitcher /><span className="hidden items-center gap-2 rounded-full border border-lime-300/20 bg-lime-300/5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[.12em] text-lime-200 sm:flex"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_9px_rgba(200,255,34,.9)]" />{refreshing ? "READING" : "D1 VERIFIED"}</span><IconButton label="Torna indietro" onClick={goBack}><ArrowLeft className="size-4" /></IconButton><IconButton label="Aggiorna missioni" onClick={() => void refresh()}><RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} /></IconButton>{capabilities.includes("communication.read") && <IconButton label="Apri comunicazioni" onClick={() => navigate("/communications")}><Bell className="size-4" /></IconButton>}<AccountMenu actor={actor} /></div></header>

      <div className="mx-auto w-full max-w-[1600px] px-4 pb-24 pt-5 sm:px-7 sm:pb-8 sm:pt-7">
        <section className="zw-module-hero relative overflow-hidden rounded-[26px] p-5 sm:p-7"><div className="relative z-[1] max-w-4xl"><p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.22em] text-lime-300/80"><Truck className="size-3.5" />CONTROL DECK / MODULE 08 · MISSION + DELIVERY</p><h1 className="mt-3 max-w-4xl text-3xl font-semibold tracking-[-.06em] text-slate-50 sm:text-[46px]">Move with intent.<br /><span className="text-lime-300">Prove every delivery.</span></h1><p className="mt-4 max-w-3xl text-sm leading-6 text-slate-400">Trasporto, asset e consegna restano nella stessa journey tenant-scoped. La piattaforma assegna soltanto risorse reali e disponibili, poi accompagna il record fino a POD, riconciliazione e chiusura.</p><div className="mt-5 flex flex-wrap gap-2"><Button className="bg-lime-300 text-[11px] font-semibold text-[#050705] hover:bg-lime-200" disabled={!canWrite || enabledTransportModes.length === 0} onClick={openCreate}><Truck className="size-3.5" />Nuova missione</Button><Link className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-lime-300/25 bg-lime-300/[.05] px-3 py-2 text-[11px] font-semibold text-lime-100 hover:bg-lime-300/10" href="/planning"><CalendarClock className="size-3.5" />Apri pianificazione</Link><Link className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[11px] text-slate-400 hover:border-lime-300/25 hover:text-lime-100" href="/warehouse"><Layers3 className="size-3.5" />Collega magazzino</Link></div></div><div className="absolute -right-16 -top-20 size-[24rem] rounded-full bg-lime-300/[.07] blur-3xl" /><div className="absolute bottom-0 right-8 hidden w-[300px] lg:block"><div className="relative h-28 overflow-hidden rounded-t-[26px] border border-lime-300/20 bg-black/25 p-4"><div className="absolute inset-x-0 top-1/2 border-t border-dashed border-lime-300/25" /><div className="absolute left-[18%] top-[42%] size-3 rounded-full bg-cyan-200 shadow-[0_0_18px_rgba(89,217,255,.75)]" /><div className="absolute right-[18%] top-[42%] size-3 rounded-full bg-lime-300 shadow-[0_0_18px_rgba(200,255,34,.8)]" /><Route className="absolute left-1/2 top-[28%] size-8 -translate-x-1/2 text-lime-300/70" /><p className="absolute bottom-3 left-4 text-[9px] uppercase tracking-[.16em] text-slate-600">ROUTE SURFACE · SCHEMATIC</p><p className="absolute bottom-3 right-4 font-mono text-[9px] text-amber-200/70">GPS UNKNOWN</p></div></div><div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-lime-300/55 to-transparent" /></section>

        <section className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6"><KpiCard label="Totali" value={payload?.summary.total ?? 0} detail="Missioni nel tenant" icon={Truck} tone="cyan" /><KpiCard label="Pianificate" value={payload?.summary.planned ?? 0} detail="In attesa di partenza" icon={CircleGauge} tone="amber" /><KpiCard label="In viaggio" value={payload?.summary.dispatched ?? 0} detail="Partenza registrata" icon={Route} tone="cyan" /><KpiCard label="POD" value={counts.verified} detail="Prova verificata" icon={FileCheck2} tone="lime" /><KpiCard label="Riconciliate" value={counts.reconciled} detail="Quantità e documento verificati" icon={ClipboardCheck} tone="lime" /><KpiCard label="Chiuse" value={counts.closed} detail="Journey conclusa" icon={CheckCircle2} tone="lime" /></section>

        <section className="carbon-card mt-4 rounded-2xl p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-lime-300/70">MISSION REGISTER</p><h2 className="mt-1 text-lg font-semibold text-slate-100">Flotta, tratta e stato</h2><p className="mt-1 text-xs text-slate-500">La ricerca legge questa superficie; il server resta l’autorità su disponibilità, capability e transizioni.</p></div><span className="flex items-center gap-2 font-mono text-[10px] text-slate-600"><span className="size-1.5 rounded-full bg-lime-300" />{filteredMissions.length} / {missions.length} RECORD</span></div><div className="mt-4 flex flex-wrap gap-2"><label className="relative min-w-[240px] flex-1 md:hidden"><Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-600" /><Input aria-label="Filtra missioni" className="h-10 border-white/10 bg-black/25 pl-9 text-xs" onChange={(event) => setQuery(event.target.value)} placeholder="Filtra questa superficie…" value={query} /></label><select aria-label="Filtra stato missione" className="h-10 rounded-xl border border-white/10 bg-black/25 px-3 text-xs text-slate-300 outline-none focus:border-lime-300/40" onChange={(event) => setStatusFilter(event.target.value)} value={statusFilter}><option className="bg-[#080c09]" value="ALL">Tutti gli stati</option>{lifecycle.map((item) => <option className="bg-[#080c09]" key={item.value} value={item.value}>{item.label}</option>)}</select><Button className="h-10 border-white/10 bg-black/20 text-xs text-slate-300 hover:border-lime-300/30 hover:bg-lime-300/10 hover:text-lime-100" onClick={() => { setQuery(""); setStatusFilter("ALL"); }} variant="outline"><RefreshCw className="size-3.5" />Reset filtri</Button></div></section>

        <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.08fr)_minmax(360px,.92fr)]"><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-cyan-200/70">JOURNEY QUEUE</p><h2 className="mt-1 text-base font-semibold text-slate-100">Missioni operative</h2></div><IconButton label="Aggiorna registro missioni" onClick={() => void refresh()}><RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} /></IconButton></div><div className="mt-4 space-y-3">{filteredMissions.map((mission) => <MissionCard canWrite={canWrite} key={mission.id} mission={mission} onDeliver={() => { setSelectedId(mission.id); openDelivery(); }} onDispatch={() => void mutateJourney(mission, "mission_dispatch")} onSelect={() => setSelectedId(mission.id)} selected={mission.id === selected?.id} />)}{filteredMissions.length === 0 && <div className="rounded-2xl border border-dashed border-lime-300/15 bg-black/15 p-12 text-center"><Truck className="mx-auto size-9 text-slate-700" /><p className="mt-3 text-sm font-medium text-slate-300">Nessuna missione nel perimetro</p><p className="mt-1 text-xs text-slate-600">Crea una missione oppure rimuovi i filtri.</p><Button className="mt-5 bg-lime-300 text-[11px] font-semibold text-[#050705] hover:bg-lime-200" disabled={!canWrite || enabledTransportModes.length === 0} onClick={openCreate}><Truck className="size-3.5" />Nuova missione</Button></div>}</div></section>

          <aside className="space-y-4"><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">MISSION INSPECTOR</p><h2 className="mt-1 text-lg font-semibold text-slate-100">{selected?.title ?? "Nessuna missione selezionata"}</h2><p className="mt-1 font-mono text-[10px] text-slate-600">{selected ? (selected.jobCode ?? selected.jobId) + " · v" + selected.version : "Seleziona una missione dal registro"}</p></div>{selected && <StatusPill label={statusLabel(selected.status)} tone={statusTone(selected.status)} />}</div>{selected ? <><div className="mt-4 grid gap-2 sm:grid-cols-2"><div className="carbon-inset rounded-xl p-3"><p className="text-[10px] uppercase tracking-[.14em] text-slate-600">Tratta</p><p className="mt-2 truncate text-sm text-slate-200">{text(selected.payload.pickup)}</p><p className="mt-1 truncate text-[10px] text-lime-200">→ {text(selected.payload.dropoff)}</p></div><div className="carbon-inset rounded-xl p-3"><p className="text-[10px] uppercase tracking-[.14em] text-slate-600">Finestra</p><p className="mt-2 text-sm text-slate-200">{formatDate(selected.payload.plannedAt)}</p><p className="mt-1 text-[10px] text-slate-600">fino a {formatDate(selected.payload.plannedEndAt)}</p></div><div className="carbon-inset rounded-xl p-3"><p className="text-[10px] uppercase tracking-[.14em] text-slate-600">Autista canonico</p><p className="mt-2 truncate text-sm text-slate-200">{snapshotLabel(selected.payload, "driver")}</p><p className="mt-1 font-mono text-[10px] text-slate-600">{text(selected.payload.driverId)}</p></div><div className="carbon-inset rounded-xl p-3"><p className="text-[10px] uppercase tracking-[.14em] text-slate-600">Mezzo canonico</p><p className="mt-2 truncate text-sm text-slate-200">{snapshotLabel(selected.payload, "vehicle")}</p><p className="mt-1 font-mono text-[10px] text-slate-600">{text(selected.payload.vehicleId)}</p></div><div className="carbon-inset rounded-xl p-3 sm:col-span-2"><p className="text-[10px] uppercase tracking-[.14em] text-slate-600">Asset / materiale associato</p><p className="mt-2 truncate text-sm text-slate-200">{snapshotLabel(selected.payload, "cargoAsset")}</p><p className="mt-1 text-[10px] text-slate-600">{modeLabel(selected.payload.transportMode)} · selezione salvata come snapshot storico</p></div></div><div className="mt-5"><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-slate-600">JOURNEY STATE</p><div className="mt-3 grid gap-2 sm:grid-cols-3 xl:grid-cols-2">{lifecycle.map((step, index) => { const currentIndex = lifecycle.findIndex((item) => item.value === selected.status); const active = index <= currentIndex; return <div className={cn("flex items-center gap-2 rounded-xl border px-3 py-2", active ? "border-lime-300/20 bg-lime-300/[.06]" : "border-white/[.07] bg-black/15")} key={step.value}><span className={cn("grid size-6 place-items-center rounded-lg border text-[10px]", active ? "border-lime-300/35 bg-lime-300/10 text-lime-200" : "border-white/10 text-slate-700")}>{active ? <CheckCircle2 className="size-3.5" /> : index + 1}</span><span className={cn("text-[10px]", active ? "text-lime-100" : "text-slate-600")}>{step.label}</span></div>; })}</div></div><div className="mt-5 flex flex-wrap gap-2">{canWrite && selected.status === "PLANNED" && <Button className="bg-cyan-300 text-[#041012] hover:bg-cyan-200" onClick={() => void mutateJourney(selected, "mission_dispatch")}><Send className="size-3.5" />Registra partenza</Button>}{canWrite && selected.status === "DISPATCHED" && <Button className="bg-lime-300 text-[#050705] hover:bg-lime-200" onClick={openDelivery}><BadgeCheck className="size-3.5" />Registra consegna</Button>}{canWrite && selected.status === "DELIVERED" && <Button className="bg-lime-300 text-[#050705] hover:bg-lime-200" onClick={() => setModal("pod")}><FileCheck2 className="size-3.5" />Verifica POD</Button>}{canWrite && selected.status === "POD_VERIFIED" && <Button className="bg-amber-300 text-[#130b02] hover:bg-amber-200" onClick={() => setModal("reconcile")}><ClipboardCheck className="size-3.5" />Riconcilia</Button>}{canWrite && selected.status === "RECONCILED" && <Button className="bg-lime-300 text-[#050705] hover:bg-lime-200" onClick={() => void mutateJourney(selected, "mission_close")}><CheckCircle2 className="size-3.5" />Chiudi journey</Button>}{selected.jobModule === "operations" && <Link className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-lime-300/25 bg-lime-300/[.05] px-3 py-2 text-[11px] font-semibold text-lime-100 hover:bg-lime-300/10" href={"/operations/" + encodeURIComponent(selected.jobId)}>Apri commessa <ArrowRight className="size-3.5" /></Link>}</div></> : <div className="mt-5 rounded-xl border border-dashed border-white/10 p-8 text-center text-xs text-slate-600">Seleziona una missione per vedere journey, risorse e controlli.</div>}</section>

            <section className="carbon-card-neon rounded-2xl p-4 sm:p-5"><div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-2xl border border-cyan-300/25 bg-cyan-300/10 text-cyan-200"><Gauge className="size-5" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-cyan-200/70">ROUTE OBSERVATION</p><h2 className="mt-1 text-base font-semibold text-slate-100">Osservazione senza finzioni</h2></div></div><div className="mt-4 rounded-xl border border-white/[.08] bg-black/25 p-4"><div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[.15em]"><span className="text-cyan-200/70">Origine</span><span className="text-lime-200/70">Destinazione</span></div><div className="relative my-6 h-2 rounded-full bg-white/[.06]"><div className="absolute left-0 top-1/2 size-3 -translate-y-1/2 rounded-full bg-cyan-200 shadow-[0_0_14px_rgba(89,217,255,.75)]" /><div className="absolute right-0 top-1/2 size-3 -translate-y-1/2 rounded-full bg-lime-300 shadow-[0_0_14px_rgba(200,255,34,.75)]" /><div className="absolute inset-x-3 top-1/2 border-t border-dashed border-lime-300/35" /></div><div className="grid gap-2 sm:grid-cols-2"><div className="truncate text-xs text-slate-300">{selected ? text(selected.payload.pickup) : "—"}</div><div className="truncate text-right text-xs text-slate-300">{selected ? text(selected.payload.dropoff) : "—"}</div></div></div><p className="mt-3 text-[10px] leading-5 text-slate-500">La superficie è pronta per il provider cartografico e telematico, ma il GPS reale non è ancora collegato. Nessuna posizione viene inventata o mostrata come live.</p><Link className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-lime-200 hover:text-lime-100" href="/command#operational-map">Apri Command map surface <ArrowRight className="size-3.5" /></Link></section></aside>
        </section>

        <section className="mt-4 grid gap-4 lg:grid-cols-3"><section className="carbon-card rounded-2xl p-4 sm:p-5 lg:col-span-2"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">CROSS-MODULE HANDOFF</p><h2 className="mt-1 text-base font-semibold text-slate-100">La journey non duplica i registri</h2><p className="mt-1 text-xs text-slate-500">Ogni dominio resta proprietario del proprio dato; Mission coordina solo il trasporto e la prova di consegna.</p></div><Sparkles className="size-5 text-lime-200/70" /></div><div className="mt-4 grid gap-2 md:grid-cols-4"><Link className="group rounded-xl border border-white/[.08] bg-black/20 p-3 hover:border-lime-300/25" href="/operations"><BriefcaseBusiness className="size-4 text-lime-200" /><p className="mt-3 text-[11px] font-semibold text-slate-200">Commessa</p><p className="mt-1 text-[10px] leading-4 text-slate-600">Origine della richiesta e destinazione operativa.</p><ChevronRight className="mt-3 size-3.5 text-slate-700 transition group-hover:translate-x-1 group-hover:text-lime-200" /></Link><Link className="group rounded-xl border border-white/[.08] bg-black/20 p-3 hover:border-lime-300/25" href="/warehouse"><Layers3 className="size-4 text-cyan-200" /><p className="mt-3 text-[11px] font-semibold text-slate-200">Magazzino</p><p className="mt-1 text-[10px] leading-4 text-slate-600">Scorte, prenotazioni, picking e carico missione.</p><ChevronRight className="mt-3 size-3.5 text-slate-700 transition group-hover:translate-x-1 group-hover:text-lime-200" /></Link><Link className="group rounded-xl border border-white/[.08] bg-black/20 p-3 hover:border-lime-300/25" href="/planning"><CalendarClock className="size-4 text-amber-200" /><p className="mt-3 text-[11px] font-semibold text-slate-200">Planning</p><p className="mt-1 text-[10px] leading-4 text-slate-600">Finestra, capacità, squadre e conflitti.</p><ChevronRight className="mt-3 size-3.5 text-slate-700 transition group-hover:translate-x-1 group-hover:text-lime-200" /></Link><Link className="group rounded-xl border border-white/[.08] bg-black/20 p-3 hover:border-lime-300/25" href="/documents"><FileText className="size-4 text-lime-200" /><p className="mt-3 text-[11px] font-semibold text-slate-200">Documenti</p><p className="mt-1 text-[10px] leading-4 text-slate-600">POD, allegati e provenance del viaggio.</p><ChevronRight className="mt-3 size-3.5 text-slate-700 transition group-hover:translate-x-1 group-hover:text-lime-200" /></Link></div></section><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-2xl border border-amber-300/25 bg-amber-300/10 text-amber-200"><CircleGauge className="size-5" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-amber-200/70">CONTROL RULES</p><h2 className="mt-1 text-base font-semibold text-slate-100">Guard attivi</h2></div></div><div className="mt-4 space-y-2 text-[10px] text-slate-500"><div className="flex items-start gap-2 rounded-xl border border-white/[.08] bg-black/20 p-3"><ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-lime-200" /><span>Autista, mezzo e asset sono ID tenant-scoped, non testo libero.</span></div><div className="flex items-start gap-2 rounded-xl border border-white/[.08] bg-black/20 p-3"><Clock3 className="mt-0.5 size-3.5 shrink-0 text-cyan-200" /><span>La disponibilità viene ricalcolata sulla finestra temporale.</span></div><div className="flex items-start gap-2 rounded-xl border border-white/[.08] bg-black/20 p-3"><ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-lime-200" /><span>Ogni passaggio richiede versione attesa, idempotenza e readback.</span></div></div></section></section>

        <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/[.07] py-5 text-[10px] text-slate-700"><span>AI-ZEROW COMMAND · MODULE 08 · mission control</span><span className="flex items-center gap-2"><span>ultra carbon core</span><span className="size-1 rounded-full bg-lime-300" /><span>capability filtered</span><span className="size-1 rounded-full bg-cyan-300" /><span>GPS provider deferred</span></span></footer>
      </div>
    </section>
  </div><CommandMobileNav active="mission" allowedNavigation={allowedNavigation} role={context?.role} />

    <Dialog open={modal !== null} onOpenChange={(open) => { if (!open) setModal(null); }}><DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto border-lime-300/20 bg-[#080c09] text-slate-100 sm:max-w-[720px]"><form className="space-y-4" onSubmit={submit}><DialogHeader><DialogTitle>{modal === "create" ? "Nuova missione" : modal === "delivery" ? "Consegna e POD" : modal === "pod" ? "Verifica prova di consegna" : "Riconcilia e chiudi la missione"}</DialogTitle><DialogDescription className="text-slate-500">{modal === "create" ? "Il percorso può collegarsi a una commessa reale o, per un tenant trasporti, nascere autonomo. Autista, mezzo e asset arrivano esclusivamente dal registro disponibile." : modal === "delivery" ? "Registra il ricevente e il momento di consegna. Il record resterà DELIVERED finché la POD non sarà verificata." : modal === "pod" ? "Verifica il readback della prova di consegna prima di passare alla riconciliazione." : "La riconciliazione richiede una nota operativa e chiude il passaggio tra consegnato, documento e quantità."}</DialogDescription></DialogHeader>{modal === "create" ? <div className="grid gap-4 sm:grid-cols-2"><label className="text-xs text-slate-400 sm:col-span-2">Commessa o trasporto autonomo<select aria-label="Commessa o trasporto autonomo" className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-slate-100 outline-none focus:border-lime-300/40 focus:ring-2 focus:ring-lime-300/10" name="jobId" required><option value="">Seleziona collegamento</option>{<option value="__standalone__">Missione autonoma · nessuna commessa</option>}{jobs.map((job) => <option key={job.id} value={job.id}>{job.code ? job.code + " · " : ""}{job.title}{job.location ? " · " + job.location : ""}</option>)}</select></label><label className="text-xs text-slate-400 sm:col-span-2">Titolo missione<Input autoFocus className="mt-2 border-white/10 bg-black/30" defaultValue="Missione di trasporto" name="title" required /></label><label className="text-xs text-slate-400">Modalità trasporto<select aria-label="Modalità trasporto" className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-slate-100 outline-none focus:border-lime-300/40 focus:ring-2 focus:ring-lime-300/10" name="transportMode" onChange={(event) => setTransportMode(event.target.value as TransportMode)} required value={transportMode}>{enabledTransportModes.map((mode) => <option key={mode} value={mode}>{TRANSPORT_MODE_CATALOG[mode]?.label ?? mode}</option>)}</select></label><label className="text-xs text-slate-400">Partenza<Input className="mt-2 border-white/10 bg-black/30" name="pickup" placeholder="Sede, magazzino o indirizzo" required /></label><label className="text-xs text-slate-400">Destinazione<Input className="mt-2 border-white/10 bg-black/30" name="dropoff" placeholder="Cantiere o destinatario" required /></label><label className="text-xs text-slate-400">Inizio pianificato<Input className="mt-2 border-white/10 bg-black/30" name="plannedAt" onChange={(event) => setPlannedAt(event.target.value)} required type="datetime-local" value={plannedAt} /></label><label className="text-xs text-slate-400">Fine pianificata <span className="text-slate-600">(opzionale)</span><Input className="mt-2 border-white/10 bg-black/30" name="plannedEndAt" onChange={(event) => setPlannedEndAt(event.target.value)} type="datetime-local" value={plannedEndAt} /></label><MissionResourceFields cargoAssetId={cargoAssetId} driverId={driverId} onCargoAssetChange={setCargoAssetId} onDriverChange={setDriverId} onVehicleChange={setVehicleId} plannedAt={plannedAt} plannedEndAt={plannedEndAt} vehicleId={vehicleId} /><label className="text-xs text-slate-400 sm:col-span-2">Nota operativa<Textarea className="mt-2 border-white/10 bg-black/30" name="notes" placeholder="Vincoli, riferimento o consegna particolare…" /></label></div> : modal === "delivery" ? <div className="grid gap-4 sm:grid-cols-2"><div className="sm:col-span-2 rounded-xl border border-lime-300/15 bg-lime-300/[.04] p-3"><p className="text-[10px] uppercase tracking-[.15em] text-slate-600">MISSIONE SELEZIONATA</p><p className="mt-1 text-sm font-semibold text-slate-100">{selected?.title}</p><p className="mt-1 text-[10px] text-slate-600">{selected ? text(selected.payload.pickup) + " → " + text(selected.payload.dropoff) : "—"}</p></div><label className="text-xs text-slate-400 sm:col-span-2">Ricevente / referente<Input autoFocus className="mt-2 border-white/10 bg-black/30" name="recipient" placeholder="Nome o organizzazione" required /></label><label className="text-xs text-slate-400">Data e ora consegna<Input className="mt-2 border-white/10 bg-black/30" name="deliveredAt" onChange={(event) => setDeliveredAt(event.target.value)} required type="datetime-local" value={deliveredAt} /></label><label className="text-xs text-slate-400">Documento POD <span className="text-slate-600">(ID opzionale)</span><Input className="mt-2 border-white/10 bg-black/30 font-mono" name="documentId" placeholder="Collega dopo upload verificato" /></label><label className="text-xs text-slate-400 sm:col-span-2">Nota consegna<Textarea className="mt-2 border-white/10 bg-black/30" name="note" placeholder="Quantità, riserva o anomalia…" /></label></div> : modal === "pod" ? <div className="grid gap-4"><div className="rounded-xl border border-lime-300/15 bg-lime-300/[.04] p-4"><p className="text-[10px] uppercase tracking-[.15em] text-lime-300/70">READBACK POD</p><p className="mt-2 text-sm text-slate-200">Ricevente: {text((selected?.payload.proofOfDelivery as Record<string, unknown> | undefined)?.recipient)}</p><p className="mt-1 text-[10px] text-slate-500">Consegna: {formatDate((selected?.payload.proofOfDelivery as Record<string, unknown> | undefined)?.deliveredAt)}</p></div><label className="text-xs text-slate-400">Documento evidenza <span className="text-slate-600">(ID opzionale)</span><Input className="mt-2 border-white/10 bg-black/30 font-mono" name="documentId" placeholder="ID documento già verificato" /></label></div> : <div className="grid gap-4"><div className="rounded-xl border border-amber-300/15 bg-amber-300/[.04] p-4"><p className="text-[10px] uppercase tracking-[.15em] text-amber-200/70">RICONCILIAZIONE</p><p className="mt-2 text-sm text-slate-200">La chiusura richiede una nota tracciabile.</p><p className="mt-1 text-[10px] text-slate-500">Dopo questo passaggio la journey potrà essere chiusa con un secondo readback.</p></div><label className="text-xs text-slate-400">Nota di riconciliazione<Textarea autoFocus className="mt-2 min-h-28 border-white/10 bg-black/30" name="note" placeholder="Confronto quantità, POD e riferimenti di commessa…" required /></label></div>}<DialogFooter><DialogClose asChild><Button className="border-white/10 bg-transparent text-slate-400" type="button" variant="outline">Annulla</Button></DialogClose><Button className="bg-lime-300 text-[#050705] hover:bg-lime-200" disabled={busy || !canWrite} type="submit">{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}{modal === "create" ? "Crea e rileggi" : modal === "delivery" ? "Registra consegna" : modal === "pod" ? "Verifica POD" : "Riconcilia"}</Button></DialogFooter></form></DialogContent></Dialog>
    {notice && <button aria-label="Chiudi messaggio" className="fixed bottom-5 left-1/2 z-[100] flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-2 rounded-xl border border-lime-300/25 bg-[#080d09]/96 px-4 py-3 text-left text-xs text-lime-100 shadow-[0_0_34px_rgba(200,255,34,.16)] backdrop-blur-xl" onClick={() => setNotice("")} type="button"><CheckCircle2 className="size-4 shrink-0 text-lime-300" />{notice}</button>}
  </main>;
}
