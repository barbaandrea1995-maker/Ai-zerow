"use client";

/* eslint-disable @next/next/no-img-element -- QR previews are runtime-generated data URLs and must be rendered verbatim. */

import Image from "next/image";
import Link from "@/components/app-link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import QRCode from "qrcode";
import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpRight,
  Bell,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  ClipboardList,
  Clock3,
  Copy,
  Download,
  Boxes,
  FileText,
  Gauge,
  Layers3,
  LoaderCircle,
  Menu,
  MessageSquareText,
  Package,
  PackagePlus,
  PanelLeftClose,
  PanelLeftOpen,
  Printer,
  QrCode,
  RefreshCw,
  Search,
  ScanLine,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Truck,
  Users,
  Warehouse,
  X,
  type LucideIcon,
} from "lucide-react";
import { AccountMenu } from "@/components/account-menu";
import { CommandMobileNav } from "@/components/command-mobile-nav";
import { TenantSwitcher } from "@/components/tenant-switcher";
import { WarehouseCodeScanner } from "@/components/warehouse-code-scanner";
import { WarehouseRequestQueue } from "@/components/warehouse-request-queue";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getAllowedCommandNavigation, type CommandNavigationId } from "@/lib/command-dashboard";

type Tone = "lime" | "cyan" | "amber" | "red" | "muted";
type StockFilter = "ALL" | "ACTIVE" | "LOW_STOCK" | "OUT_OF_STOCK";
type Modal = "register" | "movement" | null;
type MovementAction = "receive" | "adjust";
type RegistrationMode = "barcode" | "qr";
type MovementMode = "scan" | "catalog";

type InventoryItem = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  warehouseId: string | null;
  warehouse: { id: string; code: string; name: string; locationLabel: string; status: string } | null;
  location: string;
  shelf: string;
  barcode: string | null;
  qrCode: string | null;
  identification: "BARCODE" | "QR";
  onHand: number;
  reserved: number;
  available: number;
  minStock: number;
  belowMinimum: boolean;
  status: string;
  version: number;
  updatedAt: string;
};

type WarehouseLocation = {
  id: string;
  code: string;
  name: string;
  locationLabel: string;
  coordinates: { latitude: number; longitude: number };
  geofence: { radiusMeters: number; status: string };
  locationStatus: string;
  status: string;
};

type InventoryUnit = { code: string; label: string; symbol: string; decimals: number };

type InventoryMovement = {
  id: string;
  itemId: string;
  jobId: string | null;
  missionId: string | null;
  movementType: string;
  quantity: number;
  before: { onHand: number; reserved: number };
  after: { onHand: number; reserved: number };
  warehouseId: string | null;
  warehouse: { id: string; code: string; name: string; locationLabel: string } | null;
  note: string;
  createdAt: string;
};

type ReplenishmentProposal = {
  itemId: string;
  sku: string;
  name: string;
  unit: string;
  location: string;
  available: number;
  minimum: number;
  suggestedQuantity: number;
  status: "PROPOSAL_ONLY";
  reason: string;
};

type InventoryPayload = {
  context?: { actorName?: string; actorEmail?: string; role: string; roles?: string[]; capabilities: string[] };
  scope?: { type: "WAREHOUSE" | "TENANT_CONSOLIDATED"; warehouseId?: string };
  warehouses?: WarehouseLocation[];
  items: InventoryItem[];
  movements: InventoryMovement[];
  replenishment: ReplenishmentProposal[];
  summary: { itemCount: number; lowStockCount: number; movementCount: number };
  resolvedItem?: InventoryItem | null;
  readback?: { status?: string; scope?: string; warehouseId?: string; checkedAt?: string };
};

type WarehouseCatalogPayload = {
  warehouses: WarehouseLocation[];
  units: InventoryUnit[];
  readback?: { status?: string; scope?: string; checkedAt?: string };
};

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
  { id: "documents", label: "DOCUMENTI", path: "/documents", capability: "documents.read", icon: FileText },
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

const movementLabels: Record<string, string> = {
  REGISTER: "REGISTRAZIONE",
  RECEIVE: "CARICO",
  RESERVE: "PRENOTAZIONE",
  RELEASE: "RILASCIO",
  PICK: "PRELIEVO",
  LOAD: "CARICO MISSIONE",
  DELIVER: "SCARICO / CONSEGNA",
  CONSUME: "CONSUMO",
  RETURN: "RESO",
  ADJUST: "RETTIFICA",
};

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function roleLabel(role: string) {
  return ROLE_LABELS[role] ?? role;
}

function formatDate(value: unknown) {
  if (typeof value !== "string" || !value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
}

function formatQuantity(value: number, unit: string) {
  return value.toLocaleString("it-IT", { maximumFractionDigits: 3 }) + " " + unit;
}

function inventoryErrorLabel(error: string | undefined) {
  if (error === "warehouse_required_for_movement") return "Apri prima il registro di un magazzino.";
  if (error === "warehouse_not_found_or_inactive") return "Il magazzino selezionato non è più attivo: aggiorna il registro.";
  if (error === "inventory_identifier_not_in_selected_warehouse") return "Il codice non appartiene al registro del magazzino selezionato.";
  if (error === "inventory_item_belongs_to_other_warehouse") return "Materiale appartenente a un altro magazzino: operazione bloccata.";
  if (error === "inventory_barcode_already_registered_in_warehouse") return "Questo barcode è già registrato nel magazzino selezionato.";
  if (error === "warehouse_required") return "Seleziona un magazzino server-side per aprire il registro.";
  if (error === "version_conflict") return "Il saldo è cambiato: readback aggiornato.";
  return "Operazione non eseguita: " + (error ?? "errore");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] ?? character);
}

function stockLabel(status: string) {
  if (status === "OUT_OF_STOCK") return "ESAURITO";
  if (status === "LOW_STOCK") return "SOTTO SCORTA";
  return "OPERATIVO";
}

function stockTone(status: string): Tone {
  if (status === "OUT_OF_STOCK") return "red";
  if (status === "LOW_STOCK") return "amber";
  return "lime";
}

function movementLabel(type: string) {
  return movementLabels[type] ?? type.replaceAll("_", " ");
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

function StockCard({ item, selected, canWrite, onSelect, onMovement }: { item: InventoryItem; selected: boolean; canWrite: boolean; onSelect: () => void; onMovement: () => void }) {
  const denominator = Math.max(item.onHand, item.minStock, 1);
  const width = Math.max(0, Math.min(100, item.available / denominator * 100));
  const tone = stockTone(item.status);
  return <article className={cn("rounded-2xl border p-4 transition", selected ? "border-lime-300/40 bg-lime-300/[.075] shadow-[0_0_26px_rgba(200,255,34,.09)]" : "border-white/[.08] bg-black/20 hover:border-lime-300/25 hover:bg-lime-300/[.03]")}><button className="w-full text-left" onClick={onSelect} type="button"><div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-3"><span className={cn("grid size-10 shrink-0 place-items-center rounded-xl border border-current/20 bg-current/10", toneStyles[tone].icon)}><Boxes className="size-[18px]" /></span><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-100">{item.name}</p><p className="mt-1 truncate font-mono text-[10px] text-slate-600">{item.sku} · {item.warehouse?.code ?? item.location}{item.shelf ? " · " + item.shelf : ""}</p><p className="mt-1 truncate text-[10px] text-slate-600">{item.warehouse?.name ?? "Registro non assegnato"}</p></div></div><ChevronRight className={cn("size-4 shrink-0", selected ? "text-lime-200" : "text-slate-700")} /></div><div className="mt-3 flex flex-wrap items-center gap-2"><StatusPill label={stockLabel(item.status)} tone={tone} /><span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-300/20 bg-cyan-300/[.05] px-2 py-1 text-[10px] text-cyan-100">{item.unit}</span><span className={cn("inline-flex max-w-full items-center gap-1.5 truncate rounded-full border px-2 py-1 text-[10px]", item.barcode ? "border-cyan-300/20 bg-cyan-300/[.05] text-cyan-100" : "border-lime-300/20 bg-lime-300/[.05] text-lime-100")}><QrCode className="size-3" />{item.barcode ? "BARCODE · " + item.barcode : "QR SERVER · " + (item.qrCode ?? "—")}</span></div><div className="mt-4 grid grid-cols-3 gap-2"><div><p className="text-[10px] uppercase tracking-[.12em] text-slate-600">Fisico</p><p className="mt-1 font-mono text-sm text-slate-200">{item.onHand.toLocaleString("it-IT")}</p></div><div><p className="text-[10px] uppercase tracking-[.12em] text-slate-600">Riservato</p><p className="mt-1 font-mono text-sm text-cyan-100">{item.reserved.toLocaleString("it-IT")}</p></div><div><p className="text-[10px] uppercase tracking-[.12em] text-slate-600">Libero</p><p className="mt-1 font-mono text-sm text-lime-100">{item.available.toLocaleString("it-IT")}</p></div></div><div className="mt-4 h-1.5 overflow-hidden rounded-full bg-black/70"><div className={cn("h-full rounded-full transition-[width]", item.status === "OUT_OF_STOCK" ? "bg-rose-400" : item.belowMinimum ? "bg-amber-300" : "bg-gradient-to-r from-lime-400 to-lime-200")} style={{ width: width + "%" }} /></div><p className="mt-2 text-[10px] text-slate-600">Minimo {formatQuantity(item.minStock, item.unit)} · v{item.version}</p></button>{canWrite && <Button className="mt-4 h-9 w-full border-white/10 bg-black/20 text-[11px] text-slate-300 hover:border-lime-300/30 hover:bg-lime-300/10 hover:text-lime-100" onClick={onMovement} variant="outline"><ArrowDownToLine className="size-3.5" />Registra movimento</Button>}</article>;
}

function MaterialQrPreview({ code, sku, name = sku, onNotice = () => undefined }: { code: string; sku: string; name?: string; onNotice?: (message: string) => void }) {
  const [dataUrl, setDataUrl] = useState("");

  useEffect(() => {
    let active = true;
    void QRCode.toDataURL(code, {
      width: 240,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#050607", light: "#efffb9" },
    }).then((nextDataUrl) => {
      if (active) setDataUrl(nextDataUrl);
    }).catch(() => {
      if (active) setDataUrl("");
    });
    return () => { active = false; };
  }, [code]);

  const download = () => {
    if (!dataUrl) return;
    const anchor = document.createElement("a");
    anchor.href = dataUrl;
    anchor.download = `ai-zerow-${sku.toLowerCase()}.png`;
    anchor.click();
    onNotice("Etichetta QR scaricata.");
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      onNotice("Payload QR copiato.");
    } catch {
      onNotice("Copia non disponibile su questo dispositivo.");
    }
  };

  const print = () => {
    if (!dataUrl) return;
    const popup = window.open("", "_blank", "width=480,height=620");
    if (!popup) {
      onNotice("Il browser ha bloccato la stampa: abilita le finestre popup.");
      return;
    }
    popup.document.open();
    popup.document.write(`<!doctype html><html><head><title>${escapeHtml(sku)} · AI-ZEROW</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fff;color:#071006;font-family:Arial,sans-serif}.label{width:330px;padding:22px;border:2px solid #071006;border-radius:18px;text-align:center}.label img{width:250px;height:250px;display:block;margin:12px auto}.brand{font-weight:800;letter-spacing:.18em;font-size:14px}.code{font-size:20px;font-weight:700;letter-spacing:.08em}.name{font-size:13px;margin-top:6px;color:#435143}@media print{.label{border:1px solid #071006}}</style></head><body><div class="label"><div class="brand">AI-ZEROW COMMAND</div><img src="${dataUrl}" alt="QR ${escapeHtml(sku)}"><div class="code">${escapeHtml(sku)}</div><div class="name">${escapeHtml(name)}</div></div><script>window.onload=()=>{window.print();window.onafterprint=()=>window.close()}</script></body></html>`);
    popup.document.close();
  };

  return <section className="mt-4 rounded-2xl border border-lime-300/15 bg-lime-300/[.035] p-3"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.14em] text-lime-200/75">IDENTITÀ FISICA</p><p className="mt-1 text-xs font-semibold text-slate-100">QR del materiale</p><p className="mt-1 text-[10px] leading-4 text-slate-600">Stampa il codice e applicalo sul contenitore: ogni scansione torna al registro del deposito corretto.</p></div><QrCode className="size-4 text-lime-200" /></div><div className="mt-3 flex flex-col items-center gap-3 rounded-xl border border-lime-300/15 bg-lime-100 p-3"><div className="grid size-[132px] place-items-center overflow-hidden rounded-lg bg-[#dfff5c]">{dataUrl ? <img alt={`QR ${sku}`} className="size-full" src={dataUrl} /> : <LoaderCircle className="size-5 animate-spin text-[#071006]" />}</div><div className="text-center"><p className="font-mono text-xs font-semibold tracking-[.08em] text-[#071006]">{sku}</p><p className="mt-1 text-[10px] text-[#38502b]">{code}</p></div></div><div className="mt-3 flex flex-wrap gap-2"><Button className="h-9 flex-1 bg-lime-300 text-[10px] font-semibold text-[#050705] hover:bg-lime-200" disabled={!dataUrl} onClick={print}><Printer className="size-3.5" />Stampa etichetta</Button><Button className="h-9 border-white/10 bg-black/20 text-[10px] text-slate-300 hover:border-lime-300/30 hover:bg-lime-300/10" disabled={!dataUrl} onClick={download} variant="outline"><Download className="size-3.5" />PNG</Button><Button aria-label="Copia payload QR" className="h-9 border-white/10 bg-black/20 text-[10px] text-slate-300 hover:border-lime-300/30 hover:bg-lime-300/10" onClick={() => void copy()} variant="outline"><Copy className="size-3.5" />Copia</Button></div></section>;
}

export default function WarehouseControl() {
  const router = useRouter();
  const [payload, setPayload] = useState<InventoryPayload | null>(null);
  const [catalog, setCatalog] = useState<WarehouseCatalogPayload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "forbidden" | "error">("loading");
  const [refreshing, setRefreshing] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState("");
  const selectedWarehouseRef = useRef("");
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [stockFilter, setStockFilter] = useState<StockFilter>("ALL");
  const [shelfFilter, setShelfFilter] = useState("ALL");
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [movementAction, setMovementAction] = useState<MovementAction>("receive");
  const [registrationMode, setRegistrationMode] = useState<RegistrationMode>("qr");
  const [registrationBarcode, setRegistrationBarcode] = useState("");
  const [movementMode, setMovementMode] = useState<MovementMode>("scan");
  const [movementIdentifier, setMovementIdentifier] = useState("");
  const [movementItemId, setMovementItemId] = useState("");
  const [movementResolving, setMovementResolving] = useState(false);

  const notify = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 4200);
  }, []);

  const refresh = useCallback(async (requestedWarehouseId?: string) => {
    setRefreshing(true);
    try {
      const catalogResponse = await fetch("/api/warehouse/catalog", { cache: "no-store" });
      if (catalogResponse.status === 403) {
        setState("forbidden");
        return;
      }
      const nextCatalog = await catalogResponse.json() as WarehouseCatalogPayload & { error?: string };
      if (!catalogResponse.ok) throw new Error(nextCatalog.error ?? "warehouse_catalog_unavailable");
      const activeWarehouses = nextCatalog.warehouses.filter((warehouse) => warehouse.status === "active");
      const preferred = requestedWarehouseId ?? selectedWarehouseRef.current;
      const nextWarehouseId = preferred && activeWarehouses.some((warehouse) => warehouse.id === preferred)
        ? preferred
        : activeWarehouses[0]?.id ?? "";
      selectedWarehouseRef.current = nextWarehouseId;
      setSelectedWarehouseId(nextWarehouseId);
      const inventoryUrl = nextWarehouseId
        ? `/api/warehouse/inventory?warehouseId=${encodeURIComponent(nextWarehouseId)}`
        : "/api/warehouse/inventory";
      const response = await fetch(inventoryUrl, { cache: "no-store" });
      if (response.status === 403) {
        setState("forbidden");
        return;
      }
      const next = await response.json() as InventoryPayload & { error?: string };
      if (!response.ok) throw new Error(next.error ?? "inventory_readback_unavailable");
      setPayload(next);
      setCatalog(nextCatalog);
      setSelectedId((current) => current && next.items.some((item) => item.id === current) ? current : next.items[0]?.id ?? "");
      setState("ready");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Magazzino non disponibile");
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
  const capabilities = useMemo(() => context?.capabilities ?? ["warehouse.read"], [context]);
  const allowedNavigation = useMemo(() => getAllowedCommandNavigation(capabilities).map((item) => item.id), [capabilities]);
  const visibleNavItems = useMemo(() => navItems.filter((item) => allowedNavigation.includes(item.id) || capabilities.includes(item.capability)), [allowedNavigation, capabilities]);
  const items = useMemo(() => {
    const readItems = payload?.items ?? [];
    return selectedWarehouseId ? readItems.filter((item) => item.warehouseId === selectedWarehouseId) : [];
  }, [payload?.items, selectedWarehouseId]);
  const warehouses = useMemo(() => catalog?.warehouses ?? [], [catalog?.warehouses]);
  const units = useMemo(() => catalog?.units ?? [], [catalog?.units]);
  const warehouseById = useMemo(() => new Map(warehouses.map((warehouse) => [warehouse.id, warehouse])), [warehouses]);
  const selectedWarehouse = selectedWarehouseId ? warehouseById.get(selectedWarehouseId) ?? null : null;
  const shelves = useMemo(() => [...new Set(items.map((item) => item.shelf).filter(Boolean))].sort(), [items]);
  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return items.filter((item) => {
      const warehouse = item.warehouseId ? warehouseById.get(item.warehouseId) : null;
      const haystack = [item.id, item.sku, item.name, item.unit, item.location, warehouse?.name, warehouse?.locationLabel, item.status].filter(Boolean).join(" ").toLowerCase();
      return (!normalized || haystack.includes(normalized))
        && (stockFilter === "ALL" || item.status === stockFilter)
        && (shelfFilter === "ALL" || item.shelf === shelfFilter)
        && (!selectedWarehouseId || item.warehouseId === selectedWarehouseId);
    });
  }, [items, query, selectedWarehouseId, shelfFilter, stockFilter, warehouseById]);
  const selected = items.find((item) => item.id === selectedId) ?? filteredItems[0] ?? null;
  const movementItem = items.find((item) => item.id === movementItemId) ?? null;
  const movementCatalogItems = items;
  const canWrite = capabilities.includes("warehouse.write");
  const canRegister = capabilities.includes("warehouse.register");
  const canReview = capabilities.includes("warehouse.review");
  const actor = { email: context?.actorEmail ?? "operator@zerow.local", name: context?.actorName ?? "Operatore" };
  const totals = useMemo(() => items.reduce((result, item) => ({
    onHand: result.onHand + item.onHand,
    reserved: result.reserved + item.reserved,
    available: result.available + item.available,
  }), { onHand: 0, reserved: 0, available: 0 }), [items]);
  const proposalCount = payload?.replenishment.length ?? 0;

  function navigate(path: string) {
    setMobileMenu(false);
    router.push(path);
  }

  function goBack() {
    if (window.history.length > 1) router.back();
    else router.push("/command");
  }

  function openMovement(item: InventoryItem) {
    setSelectedId(item.id);
    setMovementAction("receive");
    setMovementMode("scan");
    setMovementIdentifier("");
    setMovementItemId(item.id);
    setModal("movement");
  }

  function openRegistration() {
    setRegistrationMode("qr");
    setRegistrationBarcode("");
    setModal("register");
  }

  async function resolveMovementIdentifier(identifier: string) {
    const normalized = identifier.trim();
    if (!normalized) {
      notify("Scansiona o inserisci un barcode/QR prima di procedere.");
      return;
    }
    setMovementResolving(true);
    try {
      const scopeQuery = selectedWarehouseId ? `&warehouseId=${encodeURIComponent(selectedWarehouseId)}` : "";
      const response = await fetch(`/api/warehouse/inventory?identifier=${encodeURIComponent(normalized)}${scopeQuery}`, { cache: "no-store" });
      const result = await response.json() as InventoryPayload & { error?: string };
      if (!response.ok || !result.resolvedItem) throw new Error(result.error ?? "inventory_identifier_not_found");
      setMovementIdentifier(normalized);
      setMovementItemId(result.resolvedItem.id);
      setSelectedId(result.resolvedItem.id);
      notify(`Materiale verificato · ${result.resolvedItem.name}`);
    } catch {
      setMovementItemId("");
      notify(selectedWarehouseId ? "Codice non riconosciuto nel registro scorte del magazzino selezionato." : "Codice non riconosciuto nel catalogo materiali del tenant.");
    } finally {
      setMovementResolving(false);
    }
  }

  function selectMovementCatalogItem(item: InventoryItem) {
    setMovementItemId(item.id);
    setSelectedId(item.id);
    setMovementIdentifier("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!payload) return;
    const form = new FormData(event.currentTarget);
    const field = (key: string) => {
      const entry = form.get(key);
      return typeof entry === "string" ? entry.trim() : "";
    };
    const action = modal === "register" ? "register_item" : field("action");
    if (modal === "movement" && movementMode === "scan" && !movementIdentifier) {
      notify("La movimentazione sul posto deve iniziare dalla scansione del barcode o del QR.");
      return;
    }
    if (modal === "movement" && !movementItem) {
      notify(movementMode === "scan" ? "Risolvi prima il codice del materiale." : "Seleziona un materiale disponibile dal catalogo.");
      return;
    }
    const body: Record<string, unknown> = modal === "register"
      ? { action, name: field("name"), barcode: registrationMode === "barcode" ? registrationBarcode : "", unit: field("unit"), warehouseId: field("warehouseId") || selectedWarehouseId, shelf: field("shelf"), openingQuantity: field("openingQuantity"), minStock: field("minStock"), note: field("note") }
      : { action, itemId: movementItem?.id, identifier: movementMode === "scan" ? movementIdentifier : "", warehouseId: selectedWarehouseId, expectedVersion: movementItem?.version, quantity: field("quantity"), note: field("note") };
    body.idempotencyKey = "warehouse-" + action + "-" + crypto.randomUUID();
    setBusy(true);
    try {
      const response = await fetch("/api/warehouse/inventory", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as InventoryPayload & { error?: string };
      if (!response.ok) {
        if (response.status === 409) await refresh();
        notify(inventoryErrorLabel(result.error));
        return;
      }
      await refresh();
      setModal(null);
      notify(modal === "register"
        ? result.items?.[0]?.barcode
          ? `Materiale registrato · barcode ${result.items[0].barcode}`
          : `Materiale registrato · QR server ${result.items?.[0]?.qrCode ?? "generato"}`
        : "Movimento registrato e saldo verificato.");
    } catch {
      notify("Connessione non disponibile: nessun saldo modificato.");
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading" && !payload) return <main className="grid min-h-screen place-items-center bg-[#030504] text-sm text-slate-500"><span className="flex items-center gap-3"><LoaderCircle className="size-4 animate-spin text-lime-300" />Caricamento magazzino…</span></main>;
  if (state === "forbidden") return <main className="grid min-h-screen place-items-center bg-[#030504] px-5 text-slate-100"><section className="carbon-card max-w-lg rounded-3xl p-7 text-center"><ShieldCheck className="mx-auto size-8 text-amber-200" /><h1 className="mt-4 text-lg font-semibold">Magazzino non visibile</h1><p className="mt-2 text-sm text-slate-500">Il ruolo corrente non dispone della capability warehouse.read.</p><Button className="mt-5 bg-lime-300 text-[#050705] hover:bg-lime-200" onClick={() => router.push("/command")}>Torna al Command</Button></section></main>;
  if (state === "error" && !payload) return <main className="grid min-h-screen place-items-center bg-[#030504] text-slate-100"><div className="carbon-card rounded-2xl p-7 text-center"><CircleAlert className="mx-auto size-7 text-amber-200" /><p className="mt-3 text-sm text-slate-300">Readback magazzino non disponibile</p><Button className="mt-4 bg-lime-300 text-[#050705] hover:bg-lime-200" onClick={() => void refresh()}><RefreshCw className="size-4" />Riprova</Button></div></main>;

  return <main className="zw-app-shell zw-warehouse-module min-h-screen overflow-x-hidden text-slate-100 selection:bg-lime-300 selection:text-[#060806]"><div className="zw-command-ambient" aria-hidden="true" /><div className="relative flex min-h-screen">
    <aside className={cn("zw-command-sidebar fixed inset-y-0 left-0 z-40 flex flex-col px-3 py-4 transition-[width,transform] lg:static lg:translate-x-0", sidebarCollapsed ? "is-collapsed lg:w-[76px]" : "lg:w-[248px]", mobileMenu ? "translate-x-0" : "-translate-x-full")}>
      <div className="flex items-center justify-between px-2"><button aria-label="Apri Command" className="flex min-w-0 items-center gap-3 text-left" onClick={() => navigate("/command")} type="button"><span className="neon-pulse relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black shadow-[0_0_22px_rgba(200,255,34,.12)]"><Image src="/ai-zerow-icon.jpeg" alt="AI-ZEROW" width={40} height={40} className="size-full object-cover" /></span><span className="zw-command-sidebar__brand-copy min-w-0"><span className="block text-sm font-bold tracking-[.18em] text-slate-50">AI-ZEROW</span><span className="block text-[10px] uppercase tracking-[.22em] text-lime-300/75">command</span></span></button><div className="flex items-center gap-1"><IconButton label={sidebarCollapsed ? "Espandi sidebar" : "Riduci sidebar"} className="hidden lg:grid" onClick={() => setSidebarCollapsed((value) => !value)}>{sidebarCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}</IconButton><IconButton label="Chiudi menu" className="lg:hidden" onClick={() => setMobileMenu(false)}><X className="size-4" /></IconButton></div></div>
      <div className="zw-command-tenant mt-7 flex items-center gap-3 rounded-2xl p-3"><span className="grid size-9 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/10 text-lime-200"><Warehouse className="size-4" /></span><span className="zw-command-sidebar__tenant-copy min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-slate-200">ZEROW workspace</span><span className="mt-0.5 block truncate text-[10px] uppercase tracking-[.1em] text-slate-600">{roleLabel(context?.role ?? "warehouse")} · tenant scoped</span></span></div>
      <nav className="mt-6 min-h-0 flex-1 overflow-y-auto" aria-label="Navigazione principale"><p className="zw-command-sidebar__nav-caption px-3 text-[10px] font-semibold uppercase tracking-[.22em] text-slate-700">Authorized workspace</p><div className="mt-2 space-y-1">{visibleNavItems.map((item) => { const Icon = item.icon; const active = item.id === "warehouse"; return <button aria-current={active ? "page" : undefined} aria-label={sidebarCollapsed ? item.label : undefined} className={cn("zw-command-nav-item", active && "is-active")} key={item.id} onClick={() => navigate(item.path)} title={sidebarCollapsed ? item.label : undefined} type="button"><Icon className={cn("size-4", active ? "text-lime-200" : "text-slate-600")} /><span className="zw-command-sidebar__nav-label">{item.label}</span>{item.id === "command" && <span className="zw-command-sidebar__nav-badge ml-auto rounded border border-lime-300/20 px-1.5 py-0.5 font-mono text-[9px] tracking-[.08em] text-lime-200">AI</span>}</button>; })}</div></nav>
      <div className="zw-command-sidebar__footer mt-4 border-t border-white/[.07] pt-4"><div className="flex items-center justify-between px-2 text-[10px] uppercase tracking-[.14em] text-slate-600"><span>System core</span><span className="flex items-center gap-1.5 text-lime-200"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_8px_rgba(200,255,34,.8)]" />D1 ONLINE</span></div><div className="carbon-inset mt-3 rounded-xl p-3"><div className="flex items-center gap-2 text-[11px] text-slate-400"><Layers3 className="size-3.5 text-lime-300" />Inventory ledger</div><p className="mt-2 font-mono text-[10px] text-slate-600">{items.length} anagrafiche · {payload?.summary.movementCount ?? 0} movimenti</p><p className="mt-3 font-mono text-[10px] text-slate-600">Sites · D1 readback</p></div></div>
    </aside>

    <section className="min-w-0 flex-1"><header className="zw-command-topbar sticky top-0 z-20 flex h-[72px] items-center gap-3 px-4 sm:gap-5 sm:px-7"><IconButton className="lg:hidden" label="Apri menu" onClick={() => setMobileMenu(true)}><Menu className="size-4" /></IconButton><button aria-label="Apri Magazzino" className="zw-command-topbar__brand flex shrink-0 items-center gap-2 text-left" onClick={() => navigate("/warehouse")} type="button"><span className="relative grid size-9 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black shadow-[0_0_18px_rgba(200,255,34,.12)]"><Image src="/ai-zerow-icon.jpeg" alt="ZEROW" width={36} height={36} className="size-full object-cover" /></span><span className="hidden sm:block"><span className="block text-[11px] font-bold tracking-[.18em] text-slate-50">ZEROW</span><span className="block text-[10px] uppercase tracking-[.2em] text-lime-300/75">warehouse</span></span></button><IconButton className="hidden lg:grid" label={sidebarCollapsed ? "Espandi sidebar" : "Riduci sidebar"} onClick={() => setSidebarCollapsed((value) => !value)}>{sidebarCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}</IconButton><div className="relative hidden min-w-0 flex-1 justify-center md:flex"><div className="relative w-full max-w-[520px]"><Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-600" /><Input aria-label="Cerca materiale" className="h-10 w-full border-lime-300/10 bg-black/35 pl-10 text-sm text-slate-100 placeholder:text-slate-600" onChange={(event) => setQuery(event.target.value)} placeholder="Cerca SKU, materiale, ubicazione…" value={query} /></div></div><div className="flex min-w-0 flex-1 items-center gap-2 md:hidden"><span className="truncate text-xs font-semibold tracking-[.14em] text-slate-200">MAGAZZINO</span><span className="size-1 rounded-full bg-lime-300" /></div><div className="ml-auto flex min-w-0 items-center gap-2"><TenantSwitcher /><span className="hidden items-center gap-2 rounded-full border border-lime-300/20 bg-lime-300/5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[.12em] text-lime-200 sm:flex"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_9px_rgba(200,255,34,.9)]" />{refreshing ? "READING" : "D1 VERIFIED"}</span><IconButton label="Torna indietro" onClick={goBack}><ArrowLeft className="size-4" /></IconButton><IconButton label="Aggiorna magazzino" onClick={() => void refresh()}><RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} /></IconButton>{capabilities.includes("communication.read") && <IconButton label="Apri comunicazioni" onClick={() => navigate("/communications")}><Bell className="size-4" /></IconButton>}<AccountMenu actor={actor} /></div></header>

      <div className="mx-auto w-full max-w-[1600px] px-4 pb-24 pt-5 sm:px-7 sm:pb-8 sm:pt-7">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4"><div><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.2em] text-lime-300/70"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_9px_rgba(200,255,34,.9)]" />AI-ZEROW / WAREHOUSE</div><h1 className="mt-2 text-2xl font-semibold tracking-[-.04em] text-slate-50 sm:text-[28px]">Magazzino</h1><p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">Catalogo materiali, giacenze, movimenti e identità QR nello stesso registro operativo.</p></div><div className="flex flex-wrap items-center gap-2"><Button className="bg-lime-300 text-[10px] font-semibold text-[#050705] shadow-[0_0_24px_rgba(200,255,34,.15)] hover:bg-lime-200" disabled={!canRegister || !selectedWarehouseId} onClick={openRegistration} title={!selectedWarehouseId ? "Apri prima un registro magazzino" : canRegister ? "Registra un nuovo materiale" : "Richiede la capability warehouse.register"}><PackagePlus className="size-3.5" />Registra materiale</Button><Button className="border-lime-300/25 bg-lime-300/[.05] text-[10px] text-lime-100 hover:bg-lime-300/10" disabled={!canWrite || !selectedWarehouseId} onClick={() => { setMovementAction("receive"); setMovementMode("scan"); setMovementIdentifier(""); setMovementItemId(""); setModal("movement"); }} title={!selectedWarehouseId ? "Apri prima un registro magazzino" : "Registra un movimento nel deposito selezionato"} variant="outline"><ScanLine className="size-3.5" />Nuovo movimento</Button></div></div>
        <section className="carbon-card-neon mt-4 rounded-2xl border border-lime-300/20 p-4 sm:p-5" aria-labelledby="warehouse-scope-title">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-2xl border border-lime-300/25 bg-lime-300/10 text-lime-200"><Warehouse className="size-5" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-lime-300/70">REGISTRO SCORTE SERVER-SIDE</p><h2 className="mt-1 text-base font-semibold text-slate-100" id="warehouse-scope-title">Seleziona il deposito operativo</h2><p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">Ogni magazzino ha una propria anagrafica, geofence, giacenza e cronologia movimenti. Il cambio deposito rilegge il registro corretto dal server.</p></div></div>
            <span className="rounded-full border border-lime-300/20 bg-lime-300/[.05] px-3 py-1.5 font-mono text-[10px] text-lime-200">{payload?.scope?.type === "WAREHOUSE" ? "WAREHOUSE SCOPED" : "SELECTING"}</span>
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:items-end">
            <label className="grid gap-2 text-xs text-slate-400" htmlFor="warehouse-register-select">Registro da aprire<select aria-label="Registro scorte del magazzino" className="h-11 rounded-xl border border-lime-300/20 bg-black/30 px-3 text-sm text-slate-100 outline-none focus:border-lime-300/50" id="warehouse-register-select" onChange={(event) => { const nextId = event.target.value; selectedWarehouseRef.current = nextId; setSelectedWarehouseId(nextId); setSelectedId(""); void refresh(nextId); }} value={selectedWarehouseId}><option value="">Nessun deposito attivo</option>{warehouses.filter((warehouse) => warehouse.status === "active").map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}</select></label>
            {selectedWarehouse ? <div className="rounded-xl border border-white/[.08] bg-black/20 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono text-[10px] text-lime-200">{selectedWarehouse.code} · REGISTRO DEDICATO</span><span className="text-[10px] text-cyan-100">geofence {selectedWarehouse.geofence.radiusMeters} m</span></div><p className="mt-2 text-xs font-semibold text-slate-200">{selectedWarehouse.name}</p><p className="mt-1 text-[10px] text-slate-500">{selectedWarehouse.locationLabel}</p><p className="mt-2 text-[9px] uppercase tracking-[.14em] text-slate-600">{selectedWarehouse.locationStatus} · luogo verificato dal server</p></div> : <div className="rounded-xl border border-dashed border-amber-300/20 bg-amber-300/[.03] p-3 text-xs text-amber-100/80">Configura almeno un luogo server-side prima di registrare o movimentare scorte.</div>}
          </div>
        </section>

        <section className="carbon-card-neon mt-4 rounded-2xl border border-cyan-300/15 p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[9px] font-semibold uppercase tracking-[.18em] text-cyan-200/70">PRESENZE CENTRALIZZATE</p><p className="mt-1 text-[11px] text-slate-400">Il magazzino resta il registro operativo; entrata, pausa e uscita si eseguono nel modulo Presenze sul solo deposito assegnato.</p></div><Link className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-cyan-300/25 bg-cyan-300/[.06] px-3 py-2 text-[10px] font-semibold text-cyan-100 hover:bg-cyan-300/[.12]" href="/presenze"><Clock3 className="size-3.5" />Apri Presenze</Link></div></section>

        <WarehouseRequestQueue warehouses={warehouses} selectedWarehouseId={selectedWarehouseId} canReview={canReview} canFulfill={canWrite} onNotice={notify} onRefresh={refresh} />

        <section className="zw-module-hero relative overflow-hidden rounded-[26px] p-5 sm:p-7"><div className="relative z-[1] max-w-3xl"><p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.22em] text-lime-300/80"><Layers3 className="size-3.5" />CONTROL DECK / MATERIALS + WAREHOUSE</p><h1 className="mt-3 max-w-3xl text-3xl font-semibold tracking-[-.06em] text-slate-50 sm:text-[46px]">Material flow<br /><span className="text-lime-300">ogni unità sotto controllo.</span></h1><p className="mt-4 max-w-2xl text-sm leading-6 text-slate-400">Ogni deposito ha il suo registro server-side: anagrafiche, giacenze e movimenti restano separati. La commessa richiede, il magazzino verifica, la missione carica e il consumo resta riconciliato.</p><div className="mt-5 flex flex-wrap gap-2"><Button className="bg-lime-300 text-[11px] font-semibold text-[#050705] hover:bg-lime-200" disabled={!canRegister || !selectedWarehouseId} onClick={openRegistration} title={canRegister ? "Registra una nuova anagrafica nel deposito selezionato" : "Richiede la mansione Responsabile magazzino"}><PackagePlus className="size-3.5" />Nuovo materiale</Button><Button className="border-lime-300/25 bg-lime-300/[.05] text-[11px] text-lime-100 hover:bg-lime-300/10" onClick={() => navigate("/operations")} variant="outline"><BriefcaseBusiness className="size-3.5" />Apri commesse</Button></div>{!canRegister && <p className="mt-3 text-[10px] text-amber-200/70">La creazione anagrafica è riservata al Responsabile magazzino; puoi eseguire i movimenti autorizzati.</p>}</div><div className="absolute -right-12 -top-14 size-64 rounded-full bg-lime-300/[.07] blur-3xl" /><div className="absolute bottom-[-75px] right-[12%] size-56 rounded-full border border-lime-300/10 bg-lime-300/[.03] shadow-[0_0_80px_rgba(200,255,34,.12)]" /><div className="absolute right-6 top-6 hidden rounded-2xl border border-lime-300/20 bg-black/25 p-4 text-right sm:block"><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-slate-600">READBACK</p><p className="mt-2 font-mono text-xl text-lime-200">{payload?.readback?.status === "verified" ? "VERIFIED" : "CHECKING"}</p><p className="mt-1 text-[10px] text-slate-600">{selectedWarehouse?.code ?? "warehouse"} · D1</p></div></section>

        <section className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><KpiCard label="Anagrafiche" value={payload?.summary.itemCount ?? 0} detail={selectedWarehouse ? `Materiali in ${selectedWarehouse.code}` : "Seleziona un deposito"} icon={Boxes} tone="cyan" /><KpiCard label="Disponibile" value={totals.available.toLocaleString("it-IT")} detail="Unità non prenotate nel registro" icon={CheckCircle2} tone="lime" /><KpiCard label="Riservato" value={totals.reserved.toLocaleString("it-IT")} detail="Unità per commesse" icon={ClipboardList} tone="cyan" /><KpiCard label="Sotto scorta" value={payload?.summary.lowStockCount ?? 0} detail="Da valutare in questo deposito" icon={AlertTriangle} tone="amber" /></section>

        <section className="carbon-card mt-4 rounded-2xl p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-lime-300/70">WAREHOUSE CONTROL DECK</p><h2 className="mt-1 text-lg font-semibold text-slate-100">Registro e disponibilità</h2><p className="mt-1 text-xs text-slate-500">Il saldo disponibile è fisico meno prenotato; ogni modifica richiede la versione attesa e il deposito selezionato.</p></div><span className="flex items-center gap-2 font-mono text-[10px] text-slate-600"><span className="size-1.5 rounded-full bg-lime-300" />{filteredItems.length} / {items.length} RECORD · {selectedWarehouse?.code ?? "—"}</span></div><div className="mt-4 flex flex-wrap gap-2"><label className="relative min-w-[240px] flex-1 md:hidden"><Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-600" /><Input aria-label="Filtra materiali" className="h-10 border-white/10 bg-black/25 pl-9 text-xs" onChange={(event) => setQuery(event.target.value)} placeholder="Filtra questa superficie…" value={query} /></label><select aria-label="Filtra stato scorta" className="h-10 rounded-xl border border-white/10 bg-black/25 px-3 text-xs text-slate-300 outline-none focus:border-lime-300/40" onChange={(event) => setStockFilter(event.target.value as StockFilter)} value={stockFilter}><option className="bg-[#080c09]" value="ALL">Tutti gli stati</option><option className="bg-[#080c09]" value="ACTIVE">Operativi</option><option className="bg-[#080c09]" value="LOW_STOCK">Sotto scorta</option><option className="bg-[#080c09]" value="OUT_OF_STOCK">Esauriti</option></select><select aria-label="Filtra scaffale" className="h-10 rounded-xl border border-white/10 bg-black/25 px-3 text-xs text-slate-300 outline-none focus:border-lime-300/40" onChange={(event) => setShelfFilter(event.target.value)} value={shelfFilter}><option className="bg-[#080c09]" value="ALL">Tutti gli scaffali</option>{shelves.map((shelf) => <option className="bg-[#080c09]" key={shelf} value={shelf}>{shelf}</option>)}</select><Button className="h-10 border-white/10 bg-black/20 text-xs text-slate-300 hover:border-lime-300/30 hover:bg-lime-300/10 hover:text-lime-100" onClick={() => { setQuery(""); setStockFilter("ALL"); setShelfFilter("ALL"); }} variant="outline"><RefreshCw className="size-3.5" />Reset filtri</Button></div></section>

        <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.12fr)_minmax(360px,.88fr)]"><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-cyan-200/70">REGISTRO CANONICO</p><h2 className="mt-1 text-base font-semibold text-slate-100">Materiali e saldi</h2></div><IconButton label="Aggiorna registro materiali" onClick={() => void refresh()}><RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} /></IconButton></div><div className="mt-4 space-y-3">{filteredItems.map((item) => <StockCard canWrite={canWrite} item={item} key={item.id} onMovement={() => openMovement(item)} onSelect={() => setSelectedId(item.id)} selected={item.id === selected?.id} />)}{filteredItems.length === 0 && <div className="rounded-2xl border border-dashed border-lime-300/15 bg-black/15 p-12 text-center"><Boxes className="mx-auto size-9 text-slate-700" /><p className="mt-3 text-sm font-medium text-slate-300">Nessun materiale nel perimetro</p><p className="mt-1 text-xs text-slate-600">Apri un deposito o registra un materiale nel registro selezionato.</p><Button className="mt-5 bg-lime-300 text-[11px] font-semibold text-[#050705] hover:bg-lime-200" disabled={!canRegister || !selectedWarehouseId} onClick={openRegistration}><PackagePlus className="size-3.5" />Registra materiale</Button></div>}</div></section>

          <aside className="space-y-4"><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">MATERIAL INSPECTOR</p><h2 className="mt-1 text-lg font-semibold text-slate-100">{selected?.name ?? "Nessun materiale selezionato"}</h2><p className="mt-1 font-mono text-[10px] text-slate-600">{selected ? selected.sku + " · " + selected.id : "Seleziona una riga dal registro"}</p>{selected && <p className="mt-1 text-[10px] text-slate-500">{selected.barcode ? "BARCODE · " + selected.barcode : "QR SERVER · " + (selected.qrCode ?? "—")} {selected.shelf ? "· scaffale " + selected.shelf : ""}</p>}</div>{selected && <StatusPill label={stockLabel(selected.status)} tone={stockTone(selected.status)} />}</div>{selected ? <><div className="mt-4 grid gap-2 sm:grid-cols-2"><div className="carbon-inset rounded-xl p-3"><p className="text-[10px] uppercase tracking-[.14em] text-slate-600">Disponibilità</p><p className="mt-2 font-mono text-xl text-lime-100">{formatQuantity(selected.available, selected.unit)}</p><p className="mt-1 text-[10px] text-slate-600">fisico {selected.onHand.toLocaleString("it-IT")} · riservato {selected.reserved.toLocaleString("it-IT")}</p></div><div className="carbon-inset rounded-xl p-3"><p className="text-[10px] uppercase tracking-[.14em] text-slate-600">Guard stock</p><p className={cn("mt-2 text-sm font-semibold", selected.status === "ACTIVE" ? "text-lime-200" : "text-amber-200")}>{selected.status === "ACTIVE" ? "AVAILABLE" : "ATTENTION"}</p><p className="mt-1 text-[10px] text-slate-600">minimo {formatQuantity(selected.minStock, selected.unit)}</p></div><div className="carbon-inset rounded-xl p-3"><p className="text-[10px] uppercase tracking-[.14em] text-slate-600">Ubicazione</p><p className="mt-2 text-sm text-slate-200">{selected.location}</p><p className="mt-1 text-[10px] text-slate-600">ultimo readback · {formatDate(selected.updatedAt)}</p></div><div className="carbon-inset rounded-xl p-3"><p className="text-[10px] uppercase tracking-[.14em] text-slate-600">Versione</p><p className="mt-2 font-mono text-sm text-cyan-100">v{selected.version}</p><p className="mt-1 text-[10px] text-slate-600">optimistic concurrency</p></div></div>{selected.qrCode && <MaterialQrPreview code={selected.qrCode} sku={selected.sku} />}<div className="mt-4 flex flex-wrap gap-2">{canWrite && <Button className="bg-lime-300 text-[11px] font-semibold text-[#050705] hover:bg-lime-200" onClick={() => openMovement(selected)}><ArrowDownToLine className="size-3.5" />Movimenta</Button>}<Link className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-lime-300/25 bg-lime-300/[.05] px-3 py-2 text-[11px] font-semibold text-lime-100 hover:bg-lime-300/10" href="/operations">Richiesta da commessa <BriefcaseBusiness className="size-3.5" /></Link></div></> : <div className="mt-5 rounded-xl border border-dashed border-white/10 p-7 text-center text-xs text-slate-600">Seleziona un materiale per vedere saldo, versione e collegamenti.</div>}</section>

            <section className="carbon-card-neon rounded-2xl p-4 sm:p-5"><div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-2xl border border-amber-300/25 bg-amber-300/10 text-amber-200"><Gauge className="size-5" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-amber-200/70">REPLENISHMENT</p><h2 className="mt-1 text-base font-semibold text-slate-100">Proposte da valutare</h2></div><StatusPill label="PROPOSAL ONLY" tone="amber" /></div><p className="mt-3 text-xs leading-5 text-slate-500">Il sistema segnala una quantità suggerita, ma non emette ordini automaticamente.</p><div className="mt-4 space-y-2">{payload?.replenishment.slice(0, 5).map((proposal) => <button className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-black/20 p-3 text-left transition hover:border-amber-300/30 hover:bg-amber-300/[.04]" key={proposal.itemId} onClick={() => setSelectedId(proposal.itemId)} type="button"><span className="grid size-8 shrink-0 place-items-center rounded-lg border border-amber-300/20 bg-amber-300/[.08] text-amber-200"><AlertTriangle className="size-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-slate-200">{proposal.name}</span><span className="mt-1 block truncate text-[10px] text-slate-600">libero {formatQuantity(proposal.available, proposal.unit)} · suggerito {formatQuantity(proposal.suggestedQuantity, proposal.unit)}</span></span><ChevronRight className="size-4 text-slate-700" /></button>)}{proposalCount === 0 && <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-xs text-slate-600">Nessuna proposta di reintegro nel readback.</div>}</div>{capabilities.includes("procurement.read") && <Link className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-lime-200 hover:text-lime-100" href="/procurement">Apri Procurement <ArrowUpRight className="size-3.5" /></Link>}</section></aside>
        </section>

        <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,.9fr)]"><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-cyan-200/70">APPEND-ONLY LEDGER</p><h2 className="mt-1 text-base font-semibold text-slate-100">Movimenti recenti</h2><p className="mt-1 text-xs text-slate-500">Prima/dopo, attore e collegamento operativo riletti dal server.</p></div><span className="font-mono text-[10px] text-slate-600">{payload?.summary.movementCount ?? 0} MOV</span></div><div className="mt-4 grid gap-2 md:grid-cols-2">{payload?.movements.slice(0, 12).map((movement) => { const item = items.find((candidate) => candidate.id === movement.itemId); const tone = movement.movementType === "CONSUME" ? "amber" : movement.movementType === "RETURN" ? "cyan" : "lime"; return <article className="rounded-xl border border-white/[.08] bg-black/20 p-3" key={movement.id}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-xs font-semibold text-slate-200">{item?.name ?? movement.itemId}</p><p className="mt-1 text-[10px] text-slate-600">{formatDate(movement.createdAt)}</p></div><StatusPill label={movementLabel(movement.movementType)} tone={tone} /></div><p className="mt-3 font-mono text-xs text-cyan-100">{movement.quantity.toLocaleString("it-IT")} {item?.unit ?? ""} · {movement.before.onHand.toLocaleString("it-IT")} → {movement.after.onHand.toLocaleString("it-IT")}</p><div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-600">{movement.jobId && <span>COMMESSA {movement.jobId}</span>}{movement.missionId && <span>MISSIONE {movement.missionId}</span>}{movement.note && <span className="truncate">{movement.note}</span>}</div></article>; })}{(!payload?.movements.length) && <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-xs text-slate-600">Nessun movimento nel ledger.</div>}</div></section>

          <section className="carbon-card-neon rounded-2xl p-4 sm:p-5"><div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-2xl border border-cyan-300/25 bg-cyan-300/10 text-cyan-200"><Sparkles className="size-5" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-cyan-200/70">MATERIAL FLOW</p><h2 className="mt-1 text-base font-semibold text-slate-100">Collegamenti operativi</h2></div></div><div className="mt-4 space-y-2 text-xs text-slate-500"><Link className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 p-3 transition hover:border-lime-300/30 hover:text-lime-100" href="/operations"><BriefcaseBusiness className="size-4 text-lime-200" /><span><span className="block font-semibold text-slate-200">Commessa / richiesta materiale</span><span className="mt-1 block text-[10px] text-slate-600">Le righe richieste restano collegate al job.</span></span><ArrowUpRight className="ml-auto size-4" /></Link><Link className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 p-3 transition hover:border-lime-300/30 hover:text-lime-100" href="/mission"><Truck className="size-4 text-cyan-200" /><span><span className="block font-semibold text-slate-200">Missione / carico</span><span className="mt-1 block text-[10px] text-slate-600">Il carico richiede missione pianificata e quantità prelevata.</span></span><ArrowUpRight className="ml-auto size-4" /></Link><Link className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 p-3 transition hover:border-lime-300/30 hover:text-lime-100" href="/qr"><QrCode className="size-4 text-lime-200" /><span><span className="block font-semibold text-slate-200">QR / Barcode</span><span className="mt-1 block text-[10px] text-slate-600">Scansione e readback del riferimento operativo.</span></span><ArrowUpRight className="ml-auto size-4" /></Link></div><div className="mt-4 rounded-xl border border-lime-300/15 bg-lime-300/[.04] p-3 text-[10px] leading-5 text-slate-500"><ShieldCheck className="mr-2 inline size-3.5 text-lime-200" />Tenant-scoped · quantità in millesimi · idempotenza · optimistic version · event/outbox/reconciliation.</div></section></section>

        <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/[.07] py-5 text-[10px] text-slate-700"><span>AI-ZEROW COMMAND · MODULE 07 · material control</span><span className="flex items-center gap-2"><span>ultra carbon core</span><span className="size-1 rounded-full bg-lime-300" /><span>capability filtered</span></span></footer>
      </div>
    </section>
  </div><CommandMobileNav active="warehouse" allowedNavigation={allowedNavigation} role={context?.role} roles={context?.roles} />
    <Dialog open={modal !== null} onOpenChange={(open) => { if (!open) setModal(null); }}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto border-lime-300/20 bg-[#080c09] text-slate-100 sm:max-w-[720px]">
        <form className="space-y-5" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{modal === "register" ? "Registra materiale" : "Movimenta materiale"}</DialogTitle>
            <DialogDescription className="text-slate-500">
              {modal === "register"
                ? "L’anagrafica viene creata dal Responsabile magazzino. L’ID viene assegnato dal server; qui colleghi il barcode esistente oppure il QR server-side."
                : "Sul posto parti dalla scansione. Se stai preparando una movimentazione da remoto, usa il catalogo server-side dei materiali disponibili."}
            </DialogDescription>
          </DialogHeader>

          {modal === "register" ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-xs text-slate-400 sm:col-span-2">
                  Descrizione materiale
                  <Input autoFocus className="mt-2 border-white/10 bg-black/30 text-slate-100" name="name" placeholder="Es. Tubo corrugato DN160" required />
                </label>
                <div className="rounded-xl border border-lime-300/15 bg-lime-300/[.04] p-3 sm:col-span-2">
                  <div className="flex items-center gap-3">
                    <span className="grid size-9 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/[.08] text-lime-200"><ShieldCheck className="size-4" /></span>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[.15em] text-lime-200/80">ID MATERIALE SERVER-SIDE</p>
                      <p className="mt-1 text-[11px] text-slate-500">Il codice non è modificabile: viene assegnato dal server al salvataggio e collegato al ledger.</p>
                    </div>
                  </div>
                </div>
                <label className="text-xs text-slate-400">
                  Unità di misura
                  <select aria-label="Unità di misura" className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-slate-100 outline-none focus:border-lime-300/40" defaultValue="" name="unit" required>
                    <option className="bg-[#080c09]" disabled value="">Seleziona dal catalogo server-side</option>
                    {units.map((unit) => <option className="bg-[#080c09]" key={unit.code} value={unit.code}>{unit.label} · {unit.symbol}</option>)}
                  </select>
                </label>
              <label className="text-xs text-slate-400">
                  Magazzino di ubicazione
                  <select aria-label="Magazzino di ubicazione" className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-slate-100 outline-none focus:border-lime-300/40 disabled:cursor-not-allowed disabled:opacity-80" disabled name="warehouseId" required value={selectedWarehouseId}>
                    <option className="bg-[#080c09]" disabled value="">Seleziona un magazzino server-side</option>
                    {warehouses.filter((warehouse) => warehouse.status === "active").map((warehouse) => <option className="bg-[#080c09]" key={warehouse.id} value={warehouse.id}>{warehouse.name} · {warehouse.code} · {warehouse.locationLabel}</option>)}
                  </select>
                  {warehouses.length === 0 && <span className="mt-2 block text-[10px] text-amber-200/75">Nessun magazzino configurato. L’Owner deve crearne almeno uno da Authority / onboarding.</span>}
                </label>
                <label className="text-xs text-slate-400">
                  Scaffale di stoccaggio <span className="text-slate-600">· opzionale</span>
                  <Input className="mt-2 border-white/10 bg-black/30 font-mono text-slate-100" name="shelf" placeholder="Es. A-03-02" />
                </label>
                <label className="text-xs text-slate-400">
                  Giacenza iniziale
                  <Input className="mt-2 border-white/10 bg-black/30 text-slate-100" min="0" name="openingQuantity" step="0.001" type="number" defaultValue="0" required />
                </label>
                <label className="text-xs text-slate-400">
                  Scorta minima
                  <Input className="mt-2 border-white/10 bg-black/30 text-slate-100" min="0" name="minStock" step="0.001" type="number" defaultValue="0" required />
                </label>
              </div>

              <section className="rounded-2xl border border-lime-300/20 bg-black/20 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-lime-200/80">IDENTIFICAZIONE FISICA</p>
                    <p className="mt-1 text-[11px] text-slate-600">Scegli una sola modalità: il barcode rimane quello letto sul prodotto; senza barcode il server genera il QR associato al catalogo.</p>
                  </div>
                  <span className="rounded-full border border-lime-300/20 bg-lime-300/[.06] px-2.5 py-1 font-mono text-[9px] text-lime-200">{registrationMode === "barcode" ? "BARCODE ESISTENTE" : "QR SERVER"}</span>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <button className={cn("rounded-xl border p-3 text-left transition", registrationMode === "barcode" ? "border-cyan-300/35 bg-cyan-300/[.08]" : "border-white/10 bg-black/20 hover:border-cyan-300/20")} onClick={() => setRegistrationMode("barcode")} type="button">
                    <span className="block text-xs font-semibold text-slate-100">Il materiale ha un barcode</span>
                    <span className="mt-1 block text-[10px] text-slate-600">Leggilo con il dispositivo e conservalo nel registro.</span>
                  </button>
                  <button className={cn("rounded-xl border p-3 text-left transition", registrationMode === "qr" ? "border-lime-300/35 bg-lime-300/[.08]" : "border-white/10 bg-black/20 hover:border-lime-300/20")} onClick={() => setRegistrationMode("qr")} type="button">
                    <span className="block text-xs font-semibold text-slate-100">Il materiale non ha barcode</span>
                    <span className="mt-1 block text-[10px] text-slate-600">Il server crea un QR unico collegato al materiale.</span>
                  </button>
                </div>
                {registrationMode === "barcode" ? (
                  <div className="mt-3">
                    <WarehouseCodeScanner compact label="Barcode del materiale" name="barcode" onChange={setRegistrationBarcode} onDetected={setRegistrationBarcode} placeholder="Leggi o inserisci il barcode" value={registrationBarcode} />
                  </div>
                ) : (
                  <div className="mt-3 flex items-start gap-3 rounded-xl border border-lime-300/15 bg-lime-300/[.035] p-3">
                    <QrCode className="mt-0.5 size-5 shrink-0 text-lime-200" />
                    <div>
                      <p className="text-xs font-semibold text-lime-100">QR generato dal server dopo il salvataggio</p>
                      <p className="mt-1 text-[10px] leading-5 text-slate-600">Il payload viene associato all’ID materiale e sarà visibile nel registro per la stampa e la movimentazione.</p>
                    </div>
                  </div>
                )}
              </section>

              <label className="text-xs text-slate-400">
                Nota operativa
                <Textarea className="mt-2 border-white/10 bg-black/30 text-slate-100" name="note" placeholder="Provenienza, vincoli o note di stoccaggio…" />
              </label>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-black/30 p-1">
                <button className={cn("rounded-lg px-3 py-2.5 text-xs font-semibold transition", movementMode === "scan" ? "bg-lime-300 text-[#071006] shadow-[0_0_18px_rgba(190,255,60,.12)]" : "text-slate-500 hover:text-slate-200")} onClick={() => setMovementMode("scan")} type="button"><ScanLine className="mr-2 inline size-3.5" />Scansiona sul posto</button>
                <button className={cn("rounded-lg px-3 py-2.5 text-xs font-semibold transition", movementMode === "catalog" ? "bg-lime-300 text-[#071006] shadow-[0_0_18px_rgba(190,255,60,.12)]" : "text-slate-500 hover:text-slate-200")} onClick={() => setMovementMode("catalog")} type="button"><Boxes className="mr-2 inline size-3.5" />Catalogo da remoto</button>
              </div>

              {movementMode === "scan" ? (
                <div className="space-y-3">
                  <WarehouseCodeScanner compact description="La risoluzione verifica barcode, QR server, SKU e tenant prima di consentire il movimento." label="Scansione identificativo materiale" name="identifier" onChange={setMovementIdentifier} onDetected={(value) => void resolveMovementIdentifier(value)} placeholder="Inquadra oppure inserisci barcode / QR" value={movementIdentifier} />
                  {movementItem && <div className="rounded-xl border border-lime-300/20 bg-lime-300/[.05] p-3"><p className="text-[10px] uppercase tracking-[.14em] text-lime-200/75">READBACK MATERIALE</p><p className="mt-1 text-sm font-semibold text-slate-100">{movementItem.name}</p><p className="mt-1 font-mono text-[10px] text-slate-500">{movementItem.sku} · libero {formatQuantity(movementItem.available, movementItem.unit)} · v{movementItem.version}</p></div>}
                  {movementResolving && <p className="text-[10px] text-cyan-200">Verifica server-side in corso…</p>}
                </div>
              ) : (
                <label className="text-xs text-slate-400">
                  Materiali disponibili al movimento
                  <select aria-label="Materiale dal catalogo server-side" className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-slate-100 outline-none focus:border-lime-300/40" onChange={(event) => { const item = movementCatalogItems.find((candidate) => candidate.id === event.target.value); if (item) selectMovementCatalogItem(item); }} value={movementItem?.id ?? ""}>
                    <option className="bg-[#080c09]" disabled value="">Seleziona dal catalogo server-side</option>
                    {movementCatalogItems.map((item) => <option className="bg-[#080c09]" key={item.id} value={item.id}>{item.name} · {item.sku} · libero {formatQuantity(item.available, item.unit)}</option>)}
                  </select>
                  <span className="mt-2 block text-[10px] text-slate-600">Il server verifica deposito, saldo, versione e riferimento della missione al salvataggio.</span>
                </label>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-xs text-slate-400 sm:col-span-2">
                  Tipo movimento
                  <select aria-label="Tipo movimento" className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-slate-100 outline-none focus:border-lime-300/40" name="action" onChange={(event) => setMovementAction(event.target.value as MovementAction)} value={movementAction}>
                    <option value="receive">Carico / ricezione</option>
                    {canRegister && <option value="adjust">Rettifica inventariale (+/-)</option>}
                  </select>
                </label>
                <label className="text-xs text-slate-400">
                  Quantità
                  <Input autoFocus={movementMode === "catalog"} className="mt-2 border-white/10 bg-black/30 text-slate-100" min={movementAction === "adjust" ? undefined : "0.001"} name="quantity" step="0.001" type="number" required />
                </label>
                <label className="text-xs text-slate-400 sm:col-span-2">
                  Nota di tracciabilità
                  <Textarea className="mt-2 border-white/10 bg-black/30 text-slate-100" name="note" placeholder={movementAction === "receive" ? "Documento di trasporto, fornitore o provenienza…" : "Motivo e riferimento della rettifica…"} required />
                </label>
              </div>
            </div>
          )}

          <DialogFooter>
            <DialogClose asChild><Button className="border-white/10 bg-transparent text-slate-400" type="button" variant="outline">Annulla</Button></DialogClose>
            <Button className="bg-lime-300 text-[#050705] hover:bg-lime-200" disabled={busy || movementResolving || (modal === "register" ? !canRegister : !canWrite)} type="submit">{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : modal === "register" ? <PackagePlus className="size-3.5" /> : <ArrowDownToLine className="size-3.5" />}{modal === "register" ? "Registra materiale" : "Salva movimentazione"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    {notice && <button aria-label="Chiudi messaggio" className="fixed bottom-5 left-1/2 z-[100] flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-2 rounded-xl border border-lime-300/25 bg-[#080d09]/96 px-4 py-3 text-left text-xs text-lime-100 shadow-[0_0_34px_rgba(200,255,34,.16)] backdrop-blur-xl" onClick={() => setNotice("")} type="button"><CheckCircle2 className="size-4 shrink-0 text-lime-300" />{notice}</button>}
  </main>;
}
