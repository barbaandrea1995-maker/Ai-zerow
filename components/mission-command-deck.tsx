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
import type { GeocodeCandidate } from "@/lib/location-intelligence/provider-types";

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

type MissionLocation = {
  id: string;
  entityType: string;
  entityId: string;
  formattedAddress: string;
  geofence: { id: string; radiusMeters: number | null; status: string } | null;
};

type RouteStopDraft = {
  kind: "PICKUP" | "DELIVERY" | "TRANSFER" | "RETURN";
  locationId: string;
  temporaryAddress?: string;
  temporaryLocation?: GeocodeCandidate | null;
};

type MaterialRequest = {
  id: string;
  jobId: string;
  jobCode: string | null;
  jobTitle: string;
  title: string;
  status: string;
  version: number;
  payload: Record<string, unknown>;
  scheduledMissionId: string | null;
  createdAt: string;
  updatedAt: string;
};

type MissionContext = {
  actorName?: string;
  actorEmail?: string;
  role?: string;
  roles?: string[];
  capabilities?: string[];
  operatingDomains?: string[];
  operatingTransportModes?: TransportMode[];
};

type MissionPayload = {
  context?: MissionContext;
  jobs: MissionJob[];
  missions: Mission[];
  materialRequests: MaterialRequest[];
  locations: MissionLocation[];
  summary: {
    total: number;
    planned: number;
    dispatched: number;
    delivered: number;
    toSchedule: number;
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

function requestLinesLabel(payload: Record<string, unknown>) {
  if (!Array.isArray(payload.lines)) return "Materiali da definire";
  const labels = payload.lines.flatMap((line) => {
    if (!line || typeof line !== "object" || Array.isArray(line)) return [];
    const value = line as Record<string, unknown>;
    const description = text(value.description ?? value.name, "Materiale");
    const quantity = typeof value.quantity === "number" || typeof value.quantity === "string" ? String(value.quantity) : "";
    const unit = text(value.unit, "");
    return [`${description} · ${quantity} ${unit}`.trim()];
  });
  return labels.slice(0, 3).join(" · ") || "Materiali da definire";
}

function routeStopLabels(payload: Record<string, unknown>) {
  const readback = payload.routeReadback && typeof payload.routeReadback === "object" && !Array.isArray(payload.routeReadback)
    ? payload.routeReadback as Record<string, unknown>
    : null;
  const route = payload.route && typeof payload.route === "object" && !Array.isArray(payload.route)
    ? payload.route as Record<string, unknown>
    : null;
  const source = readback?.stops ?? route?.stops;
  if (!Array.isArray(source)) return [];
  return source.flatMap((stop, index) => {
    if (!stop || typeof stop !== "object" || Array.isArray(stop)) return [];
    const value = stop as Record<string, unknown>;
    const metadata = value.metadata && typeof value.metadata === "object" && !Array.isArray(value.metadata) ? value.metadata as Record<string, unknown> : {};
    const label = text(value.label ?? metadata.label, `Tappa ${index + 1}`);
    const status = text(value.status, "PLANNED").replaceAll("_", " ");
    return [`${index + 1}. ${label} · ${status}`];
  });
}

function IconButton({ label, children, onClick, className = "" }: { label: string; children: ReactNode; onClick?: () => void; className?: string }) {
  return <button aria-label={label} className={cn("grid size-9 place-items-center rounded-lg border border-white/10 bg-black/20 text-slate-500 transition hover:border-lime-300/35 hover:bg-lime-300/10 hover:text-lime-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300", className)} onClick={onClick} type="button">{children}</button>;
}

function StatusPill({ label, tone }: { label: string; tone: Tone }) {
  return <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[.06em]", toneStyles[tone].badge)}><span className="size-1.5 rounded-full bg-current shadow-[0_0_8px_currentColor]" />{label}</span>;
}

function KpiCard({ label, value, detail, icon: Icon, tone }: { label: string; value: number | string; detail: string; icon: LucideIcon; tone: Tone }) {
  return <article className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><span className={cn("grid size-10 place-items-center rounded-xl border border-current/20 bg-current/10", toneStyles[tone].icon)}><Icon className="size-[18px]" /></span><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_9px_rgba(200,255,34,.8)]" /></div><p className="mt-5 text-[11px] font-semibold uppercase tracking-[.16em] text-slate-600">{label}</p><p className="mt-2 font-mono text-[32px] font-semibold leading-none tracking-[-.07em] text-slate-50">{value}</p><p className="mt-4 text-[11px] text-slate-600">{detail}</p></article>;
}

function MissionCard({ mission, selected, canWrite, onSelect, onDispatch, onDeliver }: { mission: Mission; selected: boolean; canWrite: boolean; onSelect: () => void; onDispatch: () => void; onDeliver: () => void }) {
  const tone = statusTone(mission.status);
  const stops = routeStopLabels(mission.payload);
  return <article className={cn("rounded-2xl border p-4 transition", selected ? "border-lime-300/40 bg-lime-300/[.075] shadow-[0_0_28px_rgba(200,255,34,.09)]" : "border-white/[.08] bg-black/20 hover:border-lime-300/25 hover:bg-lime-300/[.03]")}><button className="w-full text-left" onClick={onSelect} type="button"><div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-3"><span className={cn("grid size-10 shrink-0 place-items-center rounded-xl border border-current/20 bg-current/10", toneStyles[tone].icon)}><Truck className="size-[18px]" /></span><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-100">{mission.title}</p><p className="mt-1 truncate font-mono text-[10px] text-slate-600">{mission.jobCode ?? "Missione autonoma"}</p></div></div><ChevronRight className={cn("size-4 shrink-0", selected ? "text-lime-200" : "text-slate-700")} /></div><div className="mt-3 flex flex-wrap items-center gap-2"><StatusPill label={statusLabel(mission.status)} tone={tone} /><span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[10px] text-slate-500">{modeLabel(mission.payload.transportMode)}</span></div><div className="mt-4 grid gap-2 sm:grid-cols-2"><div className="rounded-xl border border-white/[.07] bg-black/25 p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">Partenza</p><p className="mt-1 truncate text-[11px] text-slate-300"><MapPin className="mr-1 inline size-3 text-cyan-200" />{text(mission.payload.pickup)}</p></div><div className="rounded-xl border border-white/[.07] bg-black/25 p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">Destinazione</p><p className="mt-1 truncate text-[11px] text-slate-300"><MapPin className="mr-1 inline size-3 text-lime-200" />{text(mission.payload.dropoff)}</p></div></div>{stops.length > 0 && <div className="mt-3 rounded-xl border border-cyan-300/15 bg-cyan-300/[.03] px-3 py-2"><p className="text-[9px] uppercase tracking-[.14em] text-cyan-200/70">SEQUENZA TAPPE</p><p className="mt-1 line-clamp-2 text-[10px] text-slate-400">{stops.join("  ›  ")}</p></div>}<div className="mt-4 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-600"><span>{formatDate(mission.payload.plannedAt)}</span><span>{snapshotLabel(mission.payload, "driver")}</span><span>{snapshotLabel(mission.payload, "vehicle")}</span></div></button><div className="mt-4 flex flex-wrap gap-2">{mission.jobModule === "operations" && <Link className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-[10px] text-slate-400 hover:border-lime-300/25 hover:text-lime-100" href={"/operations/" + encodeURIComponent(mission.jobId)} onClick={(event) => event.stopPropagation()}>Commessa <ArrowRight className="size-3" /></Link>}{canWrite && mission.status === "PLANNED" && <Button variant="outline" className="h-9 border-cyan-300/20 bg-cyan-300/[.05] text-[10px] text-cyan-100" onClick={onDispatch}><Send className="size-3.5" />Partenza</Button>}{canWrite && mission.status === "DISPATCHED" && <Button variant="outline" className="h-9 border-lime-300/20 bg-lime-300/[.05] text-[10px] text-lime-100" onClick={onDeliver}><BadgeCheck className="size-3.5" />Consegna / POD</Button>}</div></article>;
}

type RouteStopsEditorProps = {
  locations: MissionLocation[];
  stops: RouteStopDraft[];
  onChange: (next: RouteStopDraft[]) => void;
};

function RouteStopsEditor({
  locations,
  stops,
  onChange,
}: RouteStopsEditorProps) {
  const [temporaryCandidates, setTemporaryCandidates] = useState<Record<number, GeocodeCandidate[]>>({});
  const [temporaryBusyIndex, setTemporaryBusyIndex] = useState<number | null>(null);
  const eligibleLocations = locations.filter((location) => location.geofence?.status === "ACTIVE");
  const labelFor = (locationId: string) => {
    const location = eligibleLocations.find((candidate) => candidate.id === locationId);
    return location ? `${location.entityType} · ${location.formattedAddress}` : "Tappa da selezionare";
  };
  const clearTemporaryCandidates = (index: number) => setTemporaryCandidates((current) => {
    const next = { ...current };
    delete next[index];
    return next;
  });
  const onSourceChange = (index: number, _source: "CANONICAL" | "TEMPORARY") => {
    onChange(stops.map((stop, stopIndex) => stopIndex === index ? {
      ...stop,
      locationId: "",
      temporaryAddress: _source === "TEMPORARY" ? "" : undefined,
      temporaryLocation: null,
    } : stop));
    clearTemporaryCandidates(index);
  };
  const onTemporaryAddressChange = (index: number, value: string) => {
    onChange(stops.map((stop, stopIndex) => stopIndex === index ? { ...stop, locationId: "", temporaryAddress: value, temporaryLocation: null } : stop));
    clearTemporaryCandidates(index);
  };
  const onVerifyTemporary = async (index: number) => {
    const address = stops[index]?.temporaryAddress?.trim() ?? "";
    if (address.length < 5) return;
    setTemporaryBusyIndex(index);
    clearTemporaryCandidates(index);
    try {
      const response = await fetch("/api/location/geocode", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address }) });
      const result = await response.json() as { candidates?: unknown };
      const candidates = response.ok && Array.isArray(result.candidates) ? result.candidates as GeocodeCandidate[] : [];
      setTemporaryCandidates((current) => ({ ...current, [index]: candidates }));
    } catch {
      setTemporaryCandidates((current) => ({ ...current, [index]: [] }));
    } finally {
      setTemporaryBusyIndex(null);
    }
  };
  const onSelectTemporary = (index: number, candidate: GeocodeCandidate) => {
    onChange(stops.map((stop, stopIndex) => stopIndex === index ? { ...stop, locationId: "", temporaryAddress: candidate.formattedAddress, temporaryLocation: candidate } : stop));
    clearTemporaryCandidates(index);
  };
  return <section className="rounded-2xl border border-cyan-300/15 bg-cyan-300/[.03] p-4 sm:col-span-2">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-cyan-200/70">ROTA OPERATIVA</p>
        <h3 className="mt-1 text-sm font-semibold text-slate-100">Tappe e agganci operativi</h3>
        <p className="mt-1 max-w-2xl text-[10px] leading-5 text-slate-500">Ogni tappa può usare una location aziendale oppure un indirizzo temporaneo. Il server verifica l’indirizzo, crea una geofence solo per questa missione e non lo aggiunge alla rubrica canonica.</p>
      </div>
      <button className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-cyan-300/25 bg-cyan-300/[.05] px-3 py-2 text-[10px] font-semibold text-cyan-100 hover:bg-cyan-300/[.1]" onClick={() => onChange([...stops, { kind: "TRANSFER", locationId: "" }])} type="button">+ Aggiungi tappa</button>
    </div>
    <div className="mt-4 space-y-2">
      {stops.map((stop, index) => {
        const source = stop.temporaryLocation || stop.temporaryAddress ? "TEMPORARY" : "CANONICAL";
        const candidates = temporaryCandidates[index] ?? [];
        return <div className="rounded-xl border border-white/[.08] bg-black/25 p-3" key={`${index}-${stop.locationId}-${stop.temporaryAddress ?? ""}`}>
          <div className="grid gap-3 sm:grid-cols-[108px_minmax(0,1fr)_auto]">
            <label className="text-[10px] text-slate-500">Tipo
              <select aria-label={`Tipo tappa ${index + 1}`} className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-black/30 px-2 text-xs text-slate-200 outline-none focus:border-cyan-300/40" onChange={(event) => onChange(stops.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, kind: event.target.value as RouteStopDraft["kind"] } : candidate))} value={stop.kind}>
                <option value="PICKUP">Carico</option><option value="DELIVERY">Consegna</option><option value="TRANSFER">Trasferimento</option><option value="RETURN">Rientro</option>
              </select>
            </label>
            <label className="min-w-0 text-[10px] text-slate-500">Sorgente destinazione
              <select aria-label={`Sorgente tappa ${index + 1}`} className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-black/30 px-2 text-xs text-slate-200 outline-none focus:border-cyan-300/40" onChange={(event) => onSourceChange(index, event.target.value as "CANONICAL" | "TEMPORARY")} value={source}>
                <option value="CANONICAL">Location aziendale</option><option value="TEMPORARY">Indirizzo temporaneo</option>
              </select>
            </label>
            <button aria-label={`Rimuovi tappa ${index + 1}`} className="mt-5 grid size-9 place-items-center rounded-lg border border-white/10 text-slate-600 hover:border-rose-300/25 hover:text-rose-200" disabled={stops.length <= 2} onClick={() => onChange(stops.filter((_, candidateIndex) => candidateIndex !== index))} type="button"><X className="size-3.5" /></button>
          </div>
          {source === "CANONICAL" ? <label className="mt-3 block min-w-0 text-[10px] text-slate-500">Location con geofence server-side
            <select aria-label={`Location canonica tappa ${index + 1}`} className="mt-1 h-10 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-xs text-slate-200 outline-none focus:border-cyan-300/40" onChange={(event) => onChange(stops.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, locationId: event.target.value } : candidate))} value={stop.locationId}>
              <option value="">Seleziona location registrata</option>{eligibleLocations.map((location) => <option key={location.id} value={location.id}>{labelFor(location.id)}</option>)}
            </select>
          </label> : <div className="mt-3 space-y-2">
            <label className="block text-[10px] text-slate-500">Indirizzo temporaneo
              <div className="mt-1 flex gap-2"><input aria-label={`Indirizzo temporaneo tappa ${index + 1}`} className="h-10 min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 text-xs text-slate-100 outline-none placeholder:text-slate-700 focus:border-cyan-300/40" onChange={(event) => onTemporaryAddressChange(index, event.target.value)} placeholder="Via, numero civico, città" value={stop.temporaryAddress ?? ""} /><button className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-cyan-300/25 bg-cyan-300/[.06] px-3 text-[10px] font-semibold text-cyan-100 hover:bg-cyan-300/[.12]" disabled={temporaryBusyIndex === index || (stop.temporaryAddress ?? "").trim().length < 5} onClick={() => onVerifyTemporary(index)} type="button">{temporaryBusyIndex === index ? <LoaderCircle className="size-3.5 animate-spin" /> : <MapPin className="size-3.5" />}Verifica</button></div>
            </label>
            {stop.temporaryLocation ? <div className="flex items-start gap-2 rounded-lg border border-lime-300/20 bg-lime-300/[.05] p-3"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-lime-200" /><div className="min-w-0"><p className="text-[10px] font-semibold text-lime-100">Indirizzo verificato dal server</p><p className="mt-1 text-[11px] text-slate-300">{stop.temporaryLocation.formattedAddress}</p><p className="mt-1 text-[9px] uppercase tracking-[.12em] text-lime-200/60">MAPBOX · GEOFENCE TEMPORANEA · {stop.kind === "DELIVERY" ? "60" : "80"} M</p></div></div> : candidates.length > 0 ? <div className="space-y-1.5 rounded-lg border border-cyan-300/15 bg-cyan-300/[.03] p-2"><p className="px-1 text-[9px] uppercase tracking-[.14em] text-cyan-200/70">Scegli il risultato riconosciuto</p>{candidates.map((candidate) => <button className="flex w-full items-start gap-2 rounded-lg border border-white/[.06] px-2 py-2 text-left hover:border-cyan-300/30 hover:bg-cyan-300/[.06]" key={candidate.providerPlaceId} onClick={() => onSelectTemporary(index, candidate)} type="button"><MapPin className="mt-0.5 size-3.5 shrink-0 text-cyan-200" /><span className="min-w-0"><span className="block truncate text-[10px] text-slate-200">{candidate.formattedAddress}</span><span className="mt-0.5 block text-[9px] text-slate-600">{candidate.city}{candidate.province ? ` · ${candidate.province}` : ""}</span></span></button>)}</div> : <p className="rounded-lg border border-dashed border-cyan-300/15 px-3 py-2 text-[10px] text-slate-600">Verifica l’indirizzo e seleziona il risultato server-side prima di salvare.</p>}
          </div>}
        </div>;
      })}
      {stops.length === 0 && <p className="rounded-xl border border-dashed border-cyan-300/15 p-4 text-center text-[10px] text-slate-600">Aggiungi almeno una tappa di carico e una di consegna.</p>}
    </div>
    {eligibleLocations.length === 0 && <p className="mt-3 rounded-xl border border-amber-300/15 bg-amber-300/[.03] p-3 text-[10px] text-amber-100">Non ci sono location canoniche con geofence disponibili. Puoi comunque usare indirizzi temporanei verificati dal server.</p>}
  </section>;
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
  const [selectedRequestId, setSelectedRequestId] = useState("");
  const [deliveredAt, setDeliveredAt] = useState("");
  const [routeStops, setRouteStops] = useState<RouteStopDraft[]>([]);

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
  const materialRequests = useMemo(() => payload?.materialRequests ?? [], [payload?.materialRequests]);
  const locations = useMemo(() => payload?.locations ?? [], [payload?.locations]);
  const schedulableRequests = useMemo(() => materialRequests.filter((request) => request.status === "APPROVED" && !request.scheduledMissionId), [materialRequests]);
  const selectedRequest = materialRequests.find((request) => request.id === selectedRequestId) ?? null;

  useEffect(() => {
    if (modal !== "create" || !selectedRequest) return;
    const timer = window.setTimeout(() => {
      const setFormValue = (selector: string, value: string) => {
        const element = document.querySelector<HTMLElement>(selector) as HTMLInputElement | HTMLSelectElement | null;
        if (element && value) element.value = value;
      };
      setFormValue('select[name="jobId"]', selectedRequest.jobId);
      setFormValue('input[name="title"]', `Consegna · ${selectedRequest.title}`);
      const warehouse = selectedRequest.payload.warehouse;
      if (warehouse && typeof warehouse === "object" && !Array.isArray(warehouse)) {
        setFormValue('input[name="pickup"]', text((warehouse as Record<string, unknown>).locationLabel, ""));
      }
      setFormValue('input[name="dropoff"]', text(selectedRequest.payload.deliveryPoint, ""));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [modal, selectedRequest]);
  const filteredMissions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return missions.filter((mission) => {
      const haystack = [mission.id, mission.jobId, mission.jobCode, mission.jobTitle, mission.title, mission.status, mission.payload.pickup, mission.payload.dropoff, mission.payload.transportMode, snapshotLabel(mission.payload, "driver"), snapshotLabel(mission.payload, "vehicle")].join(" ").toLowerCase();
      return (!normalized || haystack.includes(normalized)) && (statusFilter === "ALL" || mission.status === statusFilter);
    });
  }, [missions, query, statusFilter]);
  const selected = missions.find((mission) => mission.id === selectedId) ?? filteredMissions[0] ?? null;
  const canWrite = capabilities.includes("mission.manage") || capabilities.includes("mission.execute");
  const enabledTransportModes = context?.operatingTransportModes ?? [];
  const actor = { email: context?.actorEmail ?? "operator@zerow.local", name: context?.actorName ?? "Operatore" };
  const counts = useMemo(() => ({
    verified: missions.filter((mission) => mission.status === "POD_VERIFIED").length,
    reconciled: missions.filter((mission) => mission.status === "RECONCILED").length,
    closed: missions.filter((mission) => mission.status === "CLOSED").length,
    toSchedule: schedulableRequests.length,
  }), [missions, schedulableRequests.length]);

  function navigate(path: string) {
    setMobileMenu(false);
    router.push(path);
  }

  function goBack() {
    if (window.history.length > 1) router.back();
    else router.push("/command");
  }

  function handleJobSelection(jobId: string) {
    setSelectedRequestId("");
    if (!jobId || jobId === "__standalone__") {
      setRouteStops([{ kind: "PICKUP", locationId: "" }, { kind: "DELIVERY", locationId: "" }]);
      if (transportMode === "WAREHOUSE_TO_JOB") setTransportMode(enabledTransportModes.includes("ASSET_TRANSFER") ? "ASSET_TRANSFER" : enabledTransportModes[0] ?? "");
      return;
    }
    const jobLocationId = locations.find((location) => location.entityId === jobId && ["CANTIERE", "COMMESSA"].includes(location.entityType))?.id ?? "";
    setRouteStops([{ kind: "PICKUP", locationId: "" }, { kind: "DELIVERY", locationId: jobLocationId }]);
  }

  function openCreate(request: MaterialRequest | null = null) {
    setPlannedAt("");
    setPlannedEndAt("");
    setDriverId("");
    setVehicleId("");
    setCargoAssetId("");
    setSelectedRequestId(request?.id ?? "");
    setTransportMode((request?.jobId ? "WAREHOUSE_TO_JOB" : enabledTransportModes.includes("ASSET_TRANSFER") ? "ASSET_TRANSFER" : enabledTransportModes[0]) ?? "");
    const requestWarehouse = request?.payload.warehouse;
    const warehouseLocationId = requestWarehouse && typeof requestWarehouse === "object" && !Array.isArray(requestWarehouse)
      ? locations.find((location) => location.entityType === "MAGAZZINO" && location.entityId === String((requestWarehouse as Record<string, unknown>).id ?? ""))?.id ?? ""
      : "";
    const jobLocationId = request?.jobId
      ? locations.find((location) => location.entityId === request.jobId && ["CANTIERE", "COMMESSA"].includes(location.entityType))?.id ?? ""
      : "";
    setRouteStops([{ kind: "PICKUP", locationId: warehouseLocationId }, { kind: "DELIVERY", locationId: jobLocationId }]);
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
      const jobId = selectedRequest?.jobId || field(form, "jobId") || "";
      const mode = field(form, "transportMode") as TransportMode;
      const selectedCargo = field(form, "cargoAssetId");
      const materialRequestId = field(form, "materialRequestId") || selectedRequestId;
      const requestWarehouse = selectedRequest?.payload.warehouse;
      const requestPickup = requestWarehouse && typeof requestWarehouse === "object" && !Array.isArray(requestWarehouse)
        ? text((requestWarehouse as Record<string, unknown>).locationLabel, "")
        : "";
      const routeStopLabel = (stop: RouteStopDraft | undefined) => stop?.temporaryLocation?.formattedAddress ?? locations.find((location) => location.id === stop?.locationId)?.formattedAddress ?? "";
      const pickup = field(form, "pickup") || routeStopLabel(routeStops[0]) || requestPickup;
      const dropoff = field(form, "dropoff") || routeStopLabel(routeStops.at(-1)) || text(selectedRequest?.payload.deliveryPoint, "");
      const selectedRouteStops = routeStops.map((stop) => {
        const location = locations.find((candidate) => candidate.id === stop.locationId);
        const temporary = stop.temporaryLocation;
        return {
          kind: stop.kind,
          locationId: temporary ? "" : stop.locationId,
          label: temporary?.formattedAddress ?? location?.formattedAddress ?? "",
          entityType: temporary ? "CUSTOM_LOCATION" : location?.entityType ?? "",
          entityId: temporary ? "" : location?.entityId ?? "",
          ...(temporary ? { temporaryAddress: stop.temporaryAddress || temporary.formattedAddress, temporaryLocation: temporary } : {}),
          cargoActions: [{ action: stop.kind === "DELIVERY" ? "UNLOAD" : "LOAD", assetId: selectedCargo || null, materialRequestId: materialRequestId || null }],
        };
      });
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
      if (mode === "WAREHOUSE_TO_JOB" && !materialRequestId) {
        notify("Seleziona una richiesta materiali approvata prima di programmare la consegna.");
        return;
      }
      if (selectedRouteStops.length < 2 || selectedRouteStops.some((stop) => !stop.locationId && !stop.temporaryLocation)) {
        notify("Completa tutte le tappe con una location aziendale oppure un indirizzo temporaneo verificato.");
        return;
      }
      await createMission(jobId, {
        title: field(form, "title"),
        pickup,
        dropoff,
        plannedAt: field(form, "plannedAt"),
        plannedEndAt: field(form, "plannedEndAt"),
        driverId: field(form, "driverId"),
        vehicleId: field(form, "vehicleId"),
        cargoAssetId: selectedCargo,
        transportMode: mode,
        materialRequestId,
        routeStops: selectedRouteStops,
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
      <div className="zw-command-sidebar__footer mt-4 border-t border-white/[.07] pt-4"><div className="flex items-center justify-between px-2 text-[10px] uppercase tracking-[.14em] text-slate-600"><span>Stato piattaforma</span><span className="flex items-center gap-1.5 text-lime-200"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_8px_rgba(200,255,34,.8)]" />ONLINE</span></div><div className="carbon-inset mt-3 rounded-xl p-3"><div className="flex items-center gap-2 text-[11px] text-slate-400"><Route className="size-3.5 text-lime-300" />Registro missioni</div><p className="mt-2 font-mono text-[10px] text-slate-600">{missions.length} missioni · {counts.verified} POD verificati</p><p className="mt-3 font-mono text-[10px] text-slate-600">Dati aggiornati automaticamente</p></div></div>
    </aside>

    <section className="min-w-0 flex-1"><header className="zw-command-topbar sticky top-0 z-20 flex h-[72px] items-center gap-3 px-4 sm:gap-5 sm:px-7"><IconButton className="lg:hidden" label="Apri menu" onClick={() => setMobileMenu(true)}><Menu className="size-4" /></IconButton><button aria-label="Apri Missioni" className="zw-command-topbar__brand flex shrink-0 items-center gap-2 text-left" onClick={() => navigate("/mission")} type="button"><span className="relative grid size-9 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black shadow-[0_0_18px_rgba(200,255,34,.12)]"><Image src="/ai-zerow-icon.jpeg" alt="ZEROW" width={36} height={36} className="size-full object-cover" /></span><span className="hidden sm:block"><span className="block text-[11px] font-bold tracking-[.18em] text-slate-50">ZEROW</span><span className="block text-[10px] uppercase tracking-[.2em] text-lime-300/75">missioni</span></span></button><IconButton className="hidden lg:grid" label={sidebarCollapsed ? "Espandi sidebar" : "Riduci sidebar"} onClick={() => setSidebarCollapsed((value) => !value)}>{sidebarCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}</IconButton><div className="relative hidden min-w-0 flex-1 justify-center md:flex"><div className="relative w-full max-w-[520px]"><Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-600" /><Input aria-label="Cerca missioni" className="h-10 w-full border-lime-300/10 bg-black/35 pl-10 text-sm text-slate-100 placeholder:text-slate-600" onChange={(event) => setQuery(event.target.value)} placeholder="Cerca missione, commessa, tratta, autista…" value={query} /></div></div><div className="flex min-w-0 flex-1 items-center gap-2 md:hidden"><span className="truncate text-xs font-semibold tracking-[.14em] text-slate-200">MISSIONI</span><span className="size-1 rounded-full bg-lime-300" /></div><div className="ml-auto flex min-w-0 items-center gap-2"><TenantSwitcher /><span className="hidden items-center gap-2 rounded-full border border-lime-300/20 bg-lime-300/5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[.12em] text-lime-200 sm:flex"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_9px_rgba(200,255,34,.9)]" />{refreshing ? "AGGIORNAMENTO" : "ONLINE"}</span><IconButton label="Torna indietro" onClick={goBack}><ArrowLeft className="size-4" /></IconButton><IconButton label="Aggiorna missioni" onClick={() => void refresh()}><RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} /></IconButton>{capabilities.includes("communication.read") && <IconButton label="Apri comunicazioni" onClick={() => navigate("/communications")}><Bell className="size-4" /></IconButton>}<AccountMenu actor={actor} /></div></header>

      <div className="mx-auto w-full max-w-[1600px] px-4 pb-24 pt-5 sm:px-7 sm:pb-8 sm:pt-7">
        <section className="flex flex-wrap items-end justify-between gap-5 border-b border-white/[.07] pb-5"><div><p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.22em] text-lime-300/80"><Truck className="size-3.5" />MISSIONI · FLOTTA E CONSEGNE</p><h1 className="mt-2 text-3xl font-semibold tracking-[-.06em] text-slate-50 sm:text-[42px]">Missioni sotto controllo.</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Programma consegne, trasferimenti e asset con risorse realmente disponibili. Ogni viaggio resta collegato alla richiesta, alla commessa e alla prova di consegna.</p></div><div className="flex flex-wrap gap-2"><Button className="bg-lime-300 text-[11px] font-semibold text-[#050705] hover:bg-lime-200" disabled={!canWrite || enabledTransportModes.length === 0} onClick={() => openCreate()}><Truck className="size-3.5" />Nuova missione</Button><Link className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-lime-300/25 bg-lime-300/[.05] px-3 py-2 text-[11px] font-semibold text-lime-100 hover:bg-lime-300/10" href="/planning"><CalendarClock className="size-3.5" />Pianificazione</Link></div></section>

        <section className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-7"><KpiCard label="Totali" value={payload?.summary.total ?? 0} detail="Missioni nel tenant" icon={Truck} tone="cyan" /><KpiCard label="Da programmare" value={counts.toSchedule} detail="Richieste approvate" icon={Package} tone="amber" /><KpiCard label="Pianificate" value={payload?.summary.planned ?? 0} detail="In attesa di partenza" icon={CircleGauge} tone="amber" /><KpiCard label="In viaggio" value={payload?.summary.dispatched ?? 0} detail="Partenza registrata" icon={Route} tone="cyan" /><KpiCard label="POD" value={counts.verified} detail="Prova verificata" icon={FileCheck2} tone="lime" /><KpiCard label="Riconciliate" value={counts.reconciled} detail="Quantità e documento verificati" icon={ClipboardCheck} tone="lime" /><KpiCard label="Chiuse" value={counts.closed} detail="Journey conclusa" icon={CheckCircle2} tone="lime" /></section>

        {context?.operatingDomains?.includes("warehouse") && <section className="carbon-card-neon mt-4 rounded-2xl p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-2xl border border-amber-300/25 bg-amber-300/10 text-amber-200"><Package className="size-5" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-amber-200/70">PRONTE DA PROGRAMMARE</p><h2 className="mt-1 text-base font-semibold text-slate-100">Richieste materiali approvate</h2><p className="mt-1 text-xs text-slate-500">Il responsabile ha validato le righe: assegna una finestra, un autista e un mezzo disponibili.</p></div></div><span className="rounded-full border border-amber-300/20 bg-amber-300/[.06] px-3 py-1.5 font-mono text-[10px] text-amber-100">{schedulableRequests.length} DA PROGRAMMARE</span></div><div className="mt-4 grid gap-3 lg:grid-cols-2">{schedulableRequests.map((request) => <article className="rounded-2xl border border-amber-300/15 bg-black/20 p-4" key={request.id}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-100">{request.title}</p><p className="mt-1 truncate text-[10px] text-slate-500">{request.jobCode ?? request.jobTitle} · {text(request.payload.deliveryPoint, "Destinazione da definire")}</p></div><StatusPill label="APPROVATA" tone="lime" /></div><p className="mt-3 line-clamp-2 text-[11px] leading-5 text-slate-400">{requestLinesLabel(request.payload)}</p><div className="mt-4 flex flex-wrap items-center justify-between gap-2"><span className="text-[10px] text-slate-600">{request.payload.warehouse && typeof request.payload.warehouse === "object" && !Array.isArray(request.payload.warehouse) ? text((request.payload.warehouse as Record<string, unknown>).name, "Magazzino assegnato") : "Magazzino da verificare"}</span><Button className="h-9 bg-lime-300 px-3 text-[10px] font-semibold text-[#050705] hover:bg-lime-200" disabled={!canWrite} onClick={() => openCreate(request)}><Route className="size-3.5" />Programma missione</Button></div></article>)}{schedulableRequests.length === 0 && <div className="rounded-xl border border-dashed border-amber-300/15 bg-black/15 p-6 text-center text-xs text-slate-600 lg:col-span-2">Nessuna richiesta approvata in attesa di programmazione.</div>}</div></section>}

        <section className="carbon-card mt-4 rounded-2xl p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-lime-300/70">REGISTRO MISSIONI</p><h2 className="mt-1 text-lg font-semibold text-slate-100">Flotta, tratta e stato</h2><p className="mt-1 text-xs text-slate-500">Cerca e filtra i viaggi del tuo spazio di lavoro.</p></div><span className="flex items-center gap-2 font-mono text-[10px] text-slate-600"><span className="size-1.5 rounded-full bg-lime-300" />{filteredMissions.length} / {missions.length} RECORD</span></div><div className="mt-4 flex flex-wrap gap-2"><label className="relative min-w-[240px] flex-1 md:hidden"><Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-600" /><Input aria-label="Filtra missioni" className="h-10 border-white/10 bg-black/25 pl-9 text-xs" onChange={(event) => setQuery(event.target.value)} placeholder="Filtra questa superficie…" value={query} /></label><select aria-label="Filtra stato missione" className="h-10 rounded-xl border border-white/10 bg-black/25 px-3 text-xs text-slate-300 outline-none focus:border-lime-300/40" onChange={(event) => setStatusFilter(event.target.value)} value={statusFilter}><option className="bg-[#080c09]" value="ALL">Tutti gli stati</option>{lifecycle.map((item) => <option className="bg-[#080c09]" key={item.value} value={item.value}>{item.label}</option>)}</select><Button className="h-10 border-white/10 bg-black/20 text-xs text-slate-300 hover:border-lime-300/30 hover:bg-lime-300/10 hover:text-lime-100" onClick={() => { setQuery(""); setStatusFilter("ALL"); }} variant="outline"><RefreshCw className="size-3.5" />Reset filtri</Button></div></section>

        <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.08fr)_minmax(360px,.92fr)]"><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-cyan-200/70">JOURNEY QUEUE</p><h2 className="mt-1 text-base font-semibold text-slate-100">Missioni operative</h2></div><IconButton label="Aggiorna registro missioni" onClick={() => void refresh()}><RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} /></IconButton></div><div className="mt-4 space-y-3">{filteredMissions.map((mission) => <MissionCard canWrite={canWrite} key={mission.id} mission={mission} onDeliver={() => { setSelectedId(mission.id); openDelivery(); }} onDispatch={() => void mutateJourney(mission, "mission_dispatch")} onSelect={() => setSelectedId(mission.id)} selected={mission.id === selected?.id} />)}{filteredMissions.length === 0 && <div className="rounded-2xl border border-dashed border-lime-300/15 bg-black/15 p-12 text-center"><Truck className="mx-auto size-9 text-slate-700" /><p className="mt-3 text-sm font-medium text-slate-300">Nessuna missione nel perimetro</p><p className="mt-1 text-xs text-slate-600">Crea una missione oppure rimuovi i filtri.</p><Button className="mt-5 bg-lime-300 text-[11px] font-semibold text-[#050705] hover:bg-lime-200" disabled={!canWrite || enabledTransportModes.length === 0} onClick={() => openCreate()}><Truck className="size-3.5" />Nuova missione</Button></div>}</div></section>

          <aside className="space-y-4"><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">MISSION INSPECTOR</p><h2 className="mt-1 text-lg font-semibold text-slate-100">{selected?.title ?? "Nessuna missione selezionata"}</h2><p className="mt-1 font-mono text-[10px] text-slate-600">{selected ? (selected.jobCode ?? selected.jobId) + " · v" + selected.version : "Seleziona una missione dal registro"}</p></div>{selected && <StatusPill label={statusLabel(selected.status)} tone={statusTone(selected.status)} />}</div>{selected ? <><div className="mt-4 grid gap-2 sm:grid-cols-2"><div className="carbon-inset rounded-xl p-3"><p className="text-[10px] uppercase tracking-[.14em] text-slate-600">Tratta</p><p className="mt-2 truncate text-sm text-slate-200">{text(selected.payload.pickup)}</p><p className="mt-1 truncate text-[10px] text-lime-200">→ {text(selected.payload.dropoff)}</p></div><div className="carbon-inset rounded-xl p-3"><p className="text-[10px] uppercase tracking-[.14em] text-slate-600">Finestra</p><p className="mt-2 text-sm text-slate-200">{formatDate(selected.payload.plannedAt)}</p><p className="mt-1 text-[10px] text-slate-600">fino a {formatDate(selected.payload.plannedEndAt)}</p></div><div className="carbon-inset rounded-xl p-3"><p className="text-[10px] uppercase tracking-[.14em] text-slate-600">Autista canonico</p><p className="mt-2 truncate text-sm text-slate-200">{snapshotLabel(selected.payload, "driver")}</p><p className="mt-1 font-mono text-[10px] text-slate-600">{text(selected.payload.driverId)}</p></div><div className="carbon-inset rounded-xl p-3"><p className="text-[10px] uppercase tracking-[.14em] text-slate-600">Mezzo canonico</p><p className="mt-2 truncate text-sm text-slate-200">{snapshotLabel(selected.payload, "vehicle")}</p><p className="mt-1 font-mono text-[10px] text-slate-600">{text(selected.payload.vehicleId)}</p></div><div className="carbon-inset rounded-xl p-3 sm:col-span-2"><p className="text-[10px] uppercase tracking-[.14em] text-slate-600">Asset / materiale associato</p><p className="mt-2 truncate text-sm text-slate-200">{snapshotLabel(selected.payload, "cargoAsset")}</p><p className="mt-1 text-[10px] text-slate-600">{modeLabel(selected.payload.transportMode)} · selezione salvata come snapshot storico</p></div></div><div className="mt-5"><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-slate-600">JOURNEY STATE</p><div className="mt-3 grid gap-2 sm:grid-cols-3 xl:grid-cols-2">{lifecycle.map((step, index) => { const currentIndex = lifecycle.findIndex((item) => item.value === selected.status); const active = index <= currentIndex; return <div className={cn("flex items-center gap-2 rounded-xl border px-3 py-2", active ? "border-lime-300/20 bg-lime-300/[.06]" : "border-white/[.07] bg-black/15")} key={step.value}><span className={cn("grid size-6 place-items-center rounded-lg border text-[10px]", active ? "border-lime-300/35 bg-lime-300/10 text-lime-200" : "border-white/10 text-slate-700")}>{active ? <CheckCircle2 className="size-3.5" /> : index + 1}</span><span className={cn("text-[10px]", active ? "text-lime-100" : "text-slate-600")}>{step.label}</span></div>; })}</div></div><div className="mt-5 flex flex-wrap gap-2">{canWrite && selected.status === "PLANNED" && <Button className="bg-cyan-300 text-[#041012] hover:bg-cyan-200" onClick={() => void mutateJourney(selected, "mission_dispatch")}><Send className="size-3.5" />Registra partenza</Button>}{canWrite && selected.status === "DISPATCHED" && <Button className="bg-lime-300 text-[#050705] hover:bg-lime-200" onClick={openDelivery}><BadgeCheck className="size-3.5" />Registra consegna</Button>}{canWrite && selected.status === "DELIVERED" && <Button className="bg-lime-300 text-[#050705] hover:bg-lime-200" onClick={() => setModal("pod")}><FileCheck2 className="size-3.5" />Verifica POD</Button>}{canWrite && selected.status === "POD_VERIFIED" && <Button className="bg-amber-300 text-[#130b02] hover:bg-amber-200" onClick={() => setModal("reconcile")}><ClipboardCheck className="size-3.5" />Riconcilia</Button>}{canWrite && selected.status === "RECONCILED" && <Button className="bg-lime-300 text-[#050705] hover:bg-lime-200" onClick={() => void mutateJourney(selected, "mission_close")}><CheckCircle2 className="size-3.5" />Chiudi journey</Button>}{selected.jobModule === "operations" && <Link className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-lime-300/25 bg-lime-300/[.05] px-3 py-2 text-[11px] font-semibold text-lime-100 hover:bg-lime-300/10" href={"/operations/" + encodeURIComponent(selected.jobId)}>Apri commessa <ArrowRight className="size-3.5" /></Link>}</div></> : <div className="mt-5 rounded-xl border border-dashed border-white/10 p-8 text-center text-xs text-slate-600">Seleziona una missione per vedere journey, risorse e controlli.</div>}</section>

            <section className="carbon-card-neon rounded-2xl p-4 sm:p-5"><div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-2xl border border-cyan-300/25 bg-cyan-300/10 text-cyan-200"><Gauge className="size-5" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-cyan-200/70">ROUTE OBSERVATION</p><h2 className="mt-1 text-base font-semibold text-slate-100">Osservazione senza finzioni</h2></div></div><div className="mt-4 rounded-xl border border-white/[.08] bg-black/25 p-4"><div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[.15em]"><span className="text-cyan-200/70">Origine</span><span className="text-lime-200/70">Destinazione</span></div><div className="relative my-6 h-2 rounded-full bg-white/[.06]"><div className="absolute left-0 top-1/2 size-3 -translate-y-1/2 rounded-full bg-cyan-200 shadow-[0_0_14px_rgba(89,217,255,.75)]" /><div className="absolute right-0 top-1/2 size-3 -translate-y-1/2 rounded-full bg-lime-300 shadow-[0_0_14px_rgba(200,255,34,.75)]" /><div className="absolute inset-x-3 top-1/2 border-t border-dashed border-lime-300/35" /></div><div className="grid gap-2 sm:grid-cols-2"><div className="truncate text-xs text-slate-300">{selected ? text(selected.payload.pickup) : "—"}</div><div className="truncate text-right text-xs text-slate-300">{selected ? text(selected.payload.dropoff) : "—"}</div></div></div><p className="mt-3 text-[10px] leading-5 text-slate-500">La superficie è pronta per il provider cartografico e telematico, ma il GPS reale non è ancora collegato. Nessuna posizione viene inventata o mostrata come live.</p><Link className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-lime-200 hover:text-lime-100" href="/command#operational-map">Apri Command map surface <ArrowRight className="size-3.5" /></Link></section></aside>
        </section>

        <section className="mt-4 grid gap-4 lg:grid-cols-3"><section className="carbon-card rounded-2xl p-4 sm:p-5 lg:col-span-2"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">CROSS-MODULE HANDOFF</p><h2 className="mt-1 text-base font-semibold text-slate-100">La journey non duplica i registri</h2><p className="mt-1 text-xs text-slate-500">Ogni dominio resta proprietario del proprio dato; Mission coordina solo il trasporto e la prova di consegna.</p></div><Sparkles className="size-5 text-lime-200/70" /></div><div className="mt-4 grid gap-2 md:grid-cols-4"><Link className="group rounded-xl border border-white/[.08] bg-black/20 p-3 hover:border-lime-300/25" href="/operations"><BriefcaseBusiness className="size-4 text-lime-200" /><p className="mt-3 text-[11px] font-semibold text-slate-200">Commessa</p><p className="mt-1 text-[10px] leading-4 text-slate-600">Origine della richiesta e destinazione operativa.</p><ChevronRight className="mt-3 size-3.5 text-slate-700 transition group-hover:translate-x-1 group-hover:text-lime-200" /></Link><Link className="group rounded-xl border border-white/[.08] bg-black/20 p-3 hover:border-lime-300/25" href="/warehouse"><Layers3 className="size-4 text-cyan-200" /><p className="mt-3 text-[11px] font-semibold text-slate-200">Magazzino</p><p className="mt-1 text-[10px] leading-4 text-slate-600">Scorte, prenotazioni, picking e carico missione.</p><ChevronRight className="mt-3 size-3.5 text-slate-700 transition group-hover:translate-x-1 group-hover:text-lime-200" /></Link><Link className="group rounded-xl border border-white/[.08] bg-black/20 p-3 hover:border-lime-300/25" href="/planning"><CalendarClock className="size-4 text-amber-200" /><p className="mt-3 text-[11px] font-semibold text-slate-200">Planning</p><p className="mt-1 text-[10px] leading-4 text-slate-600">Finestra, capacità, squadre e conflitti.</p><ChevronRight className="mt-3 size-3.5 text-slate-700 transition group-hover:translate-x-1 group-hover:text-lime-200" /></Link><Link className="group rounded-xl border border-white/[.08] bg-black/20 p-3 hover:border-lime-300/25" href="/documents"><FileText className="size-4 text-lime-200" /><p className="mt-3 text-[11px] font-semibold text-slate-200">Documenti</p><p className="mt-1 text-[10px] leading-4 text-slate-600">POD, allegati e provenance del viaggio.</p><ChevronRight className="mt-3 size-3.5 text-slate-700 transition group-hover:translate-x-1 group-hover:text-lime-200" /></Link></div></section><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-2xl border border-amber-300/25 bg-amber-300/10 text-amber-200"><CircleGauge className="size-5" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-amber-200/70">CONTROL RULES</p><h2 className="mt-1 text-base font-semibold text-slate-100">Guard attivi</h2></div></div><div className="mt-4 space-y-2 text-[10px] text-slate-500"><div className="flex items-start gap-2 rounded-xl border border-white/[.08] bg-black/20 p-3"><ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-lime-200" /><span>Autista, mezzo e asset sono ID tenant-scoped, non testo libero.</span></div><div className="flex items-start gap-2 rounded-xl border border-white/[.08] bg-black/20 p-3"><Clock3 className="mt-0.5 size-3.5 shrink-0 text-cyan-200" /><span>La disponibilità viene ricalcolata sulla finestra temporale.</span></div><div className="flex items-start gap-2 rounded-xl border border-white/[.08] bg-black/20 p-3"><ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-lime-200" /><span>Ogni passaggio richiede versione attesa, idempotenza e readback.</span></div></div></section></section>

        <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/[.07] py-5 text-[10px] text-slate-700"><span>AI-ZEROW COMMAND · MISSIONI</span><span className="flex items-center gap-2"><span>ultra carbon core</span><span className="size-1 rounded-full bg-lime-300" /><span>accesso personalizzato</span><span className="size-1 rounded-full bg-cyan-300" /><span>posizione live da collegare</span></span></footer>
      </div>
    </section>
  </div><CommandMobileNav active="mission" allowedNavigation={allowedNavigation} role={context?.role} roles={context?.roles} />

    <Dialog open={modal !== null} onOpenChange={(open) => { if (!open) setModal(null); }}><DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto border-lime-300/20 bg-[#080c09] text-slate-100 sm:max-w-[720px]"><form className="space-y-4" onSubmit={submit}><DialogHeader><DialogTitle>{modal === "create" ? "Nuova missione" : modal === "delivery" ? "Consegna e POD" : modal === "pod" ? "Verifica prova di consegna" : "Riconcilia e chiudi la missione"}</DialogTitle><DialogDescription className="text-slate-500">{modal === "create" ? "Il percorso può collegarsi a una commessa reale o nascere autonomo. Ogni tappa usa una location canonica oppure un indirizzo temporaneo verificato dal server; autista, mezzo e asset arrivano esclusivamente dal registro disponibile." : modal === "delivery" ? "Registra il ricevente e il momento di consegna. Il record resterà DELIVERED finché la POD non sarà verificata." : modal === "pod" ? "Verifica il readback della prova di consegna prima di passare alla riconciliazione." : "La riconciliazione richiede una nota operativa e chiude il passaggio tra consegnato, documento e quantità."}</DialogDescription></DialogHeader>{modal === "create" ? <div className="grid gap-4 sm:grid-cols-2"><label className="text-xs text-slate-400 sm:col-span-2">Commessa o trasporto autonomo<select aria-label="Commessa o trasporto autonomo" className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-slate-100 outline-none focus:border-lime-300/40 focus:ring-2 focus:ring-lime-300/10" name="jobId" onChange={(event) => handleJobSelection(event.target.value)} required><option value="">Seleziona collegamento</option>{<option value="__standalone__">Missione autonoma · nessuna commessa</option>}{jobs.map((job) => <option key={job.id} value={job.id}>{job.code ? job.code + " · " : ""}{job.title}{job.location ? " · " + job.location : ""}</option>)}</select></label><label className="text-xs text-slate-400 sm:col-span-2">Titolo missione<Input autoFocus className="mt-2 border-white/10 bg-black/30" defaultValue="Missione di trasporto" name="title" required /></label><label className="text-xs text-slate-400">Modalità trasporto<select aria-label="Modalità trasporto" className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-slate-100 outline-none focus:border-lime-300/40 focus:ring-2 focus:ring-lime-300/10" name="transportMode" onChange={(event) => setTransportMode(event.target.value as TransportMode)} required value={transportMode}>{enabledTransportModes.map((mode) => <option key={mode} value={mode}>{TRANSPORT_MODE_CATALOG[mode]?.label ?? mode}</option>)}</select></label><RouteStopsEditor locations={locations} onChange={setRouteStops} stops={routeStops} /><input name="pickup" type="hidden" value={locations.find((location) => location.id === routeStops[0]?.locationId)?.formattedAddress ?? ""} readOnly /><input name="dropoff" type="hidden" value={locations.find((location) => location.id === routeStops.at(-1)?.locationId)?.formattedAddress ?? ""} readOnly /><label className="text-xs text-slate-400">Inizio pianificato<Input className="mt-2 border-white/10 bg-black/30" name="plannedAt" onChange={(event) => setPlannedAt(event.target.value)} required type="datetime-local" value={plannedAt} /></label><label className="text-xs text-slate-400">Fine pianificata <span className="text-slate-600">(opzionale)</span><Input className="mt-2 border-white/10 bg-black/30" name="plannedEndAt" onChange={(event) => setPlannedEndAt(event.target.value)} type="datetime-local" value={plannedEndAt} /></label><MissionResourceFields cargoAssetId={cargoAssetId} driverId={driverId} onCargoAssetChange={setCargoAssetId} onDriverChange={setDriverId} onVehicleChange={setVehicleId} plannedAt={plannedAt} plannedEndAt={plannedEndAt} vehicleId={vehicleId} /><label className="text-xs text-slate-400 sm:col-span-2">Nota operativa<Textarea className="mt-2 border-white/10 bg-black/30" name="notes" placeholder="Vincoli, riferimento o consegna particolare…" /></label></div> : modal === "delivery" ? <div className="grid gap-4 sm:grid-cols-2"><div className="sm:col-span-2 rounded-xl border border-lime-300/15 bg-lime-300/[.04] p-3"><p className="text-[10px] uppercase tracking-[.15em] text-slate-600">MISSIONE SELEZIONATA</p><p className="mt-1 text-sm font-semibold text-slate-100">{selected?.title}</p><p className="mt-1 text-[10px] text-slate-600">{selected ? text(selected.payload.pickup) + " → " + text(selected.payload.dropoff) : "—"}</p></div><label className="text-xs text-slate-400 sm:col-span-2">Ricevente / referente<Input autoFocus className="mt-2 border-white/10 bg-black/30" name="recipient" placeholder="Nome o organizzazione" required /></label><label className="text-xs text-slate-400">Data e ora consegna<Input className="mt-2 border-white/10 bg-black/30" name="deliveredAt" onChange={(event) => setDeliveredAt(event.target.value)} required type="datetime-local" value={deliveredAt} /></label><label className="text-xs text-slate-400">Documento POD <span className="text-slate-600">(ID opzionale)</span><Input className="mt-2 border-white/10 bg-black/30 font-mono" name="documentId" placeholder="Collega dopo upload verificato" /></label><label className="text-xs text-slate-400 sm:col-span-2">Nota consegna<Textarea className="mt-2 border-white/10 bg-black/30" name="note" placeholder="Quantità, riserva o anomalia…" /></label></div> : modal === "pod" ? <div className="grid gap-4"><div className="rounded-xl border border-lime-300/15 bg-lime-300/[.04] p-4"><p className="text-[10px] uppercase tracking-[.15em] text-lime-300/70">READBACK POD</p><p className="mt-2 text-sm text-slate-200">Ricevente: {text((selected?.payload.proofOfDelivery as Record<string, unknown> | undefined)?.recipient)}</p><p className="mt-1 text-[10px] text-slate-500">Consegna: {formatDate((selected?.payload.proofOfDelivery as Record<string, unknown> | undefined)?.deliveredAt)}</p></div><label className="text-xs text-slate-400">Documento evidenza <span className="text-slate-600">(ID opzionale)</span><Input className="mt-2 border-white/10 bg-black/30 font-mono" name="documentId" placeholder="ID documento già verificato" /></label></div> : <div className="grid gap-4"><div className="rounded-xl border border-amber-300/15 bg-amber-300/[.04] p-4"><p className="text-[10px] uppercase tracking-[.15em] text-amber-200/70">RICONCILIAZIONE</p><p className="mt-2 text-sm text-slate-200">La chiusura richiede una nota tracciabile.</p><p className="mt-1 text-[10px] text-slate-500">Dopo questo passaggio la journey potrà essere chiusa con un secondo readback.</p></div><label className="text-xs text-slate-400">Nota di riconciliazione<Textarea autoFocus className="mt-2 min-h-28 border-white/10 bg-black/30" name="note" placeholder="Confronto quantità, POD e riferimenti di commessa…" required /></label></div>}<DialogFooter><DialogClose asChild><Button className="border-white/10 bg-transparent text-slate-400" type="button" variant="outline">Annulla</Button></DialogClose><Button className="bg-lime-300 text-[#050705] hover:bg-lime-200" disabled={busy || !canWrite} type="submit">{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}{modal === "create" ? "Crea e rileggi" : modal === "delivery" ? "Registra consegna" : modal === "pod" ? "Verifica POD" : "Riconcilia"}</Button></DialogFooter></form></DialogContent></Dialog>
    {notice && <button aria-label="Chiudi messaggio" className="fixed bottom-5 left-1/2 z-[100] flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-2 rounded-xl border border-lime-300/25 bg-[#080d09]/96 px-4 py-3 text-left text-xs text-lime-100 shadow-[0_0_34px_rgba(200,255,34,.16)] backdrop-blur-xl" onClick={() => setNotice("")} type="button"><CheckCircle2 className="size-4 shrink-0 text-lime-300" />{notice}</button>}
  </main>;
}
