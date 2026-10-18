"use client";

import Image from "next/image";
import Link from "@/components/app-link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
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
import { MissionResourceFields, type MissionCargoOption } from "@/components/mission-resource-fields";
import { TenantSwitcher } from "@/components/tenant-switcher";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getAllowedCommandNavigation, type CommandNavigationId } from "@/lib/command-dashboard";
import { missionDeliveryLines } from "@/lib/material-fulfillment";
import {
  MISSION_EXCEPTION_LABELS,
  MISSION_EXCEPTION_TYPES,
  missionExceptionLabel,
  storedMissionException,
  type MissionExceptionType,
} from "@/lib/mission-exception-contract";
import type { MissionReportReadback } from "@/lib/mission-contract";
import type { MissionWarehouseReadback } from "@/lib/mission-inventory-contract";
import {
  MISSION_POD_EVIDENCE_LABELS,
  MISSION_POD_EVIDENCE_TYPES,
  missionPodEvidenceLabel,
  missionPodEvidenceRequiresDocument,
  missionPodEvidenceRequiresReference,
  type MissionPodEvidenceType,
} from "@/lib/mission-pod-contract";
import { TRANSPORT_MODE_CATALOG, type TransportMode } from "@/lib/tenant-operating-model";
import type { GeocodeCandidate } from "@/lib/location-intelligence/provider-types";

type Tone = "lime" | "cyan" | "amber" | "red" | "muted";
type MissionStatus = "PLANNED" | "DISPATCHED" | "DELIVERED" | "POD_VERIFIED" | "RECONCILED" | "CLOSED" | "DELAYED" | "BLOCKED" | "VEHICLE_FAULT" | "PARTIAL_DELIVERY" | "REFUSED" | "LOST" | "RECONCILE_REQUIRED" | "CANCELLED" | string;
type Modal = "create" | "delivery" | "pod" | "reconcile" | "report" | "exception" | null;
type MissionAttentionFilter = "ALL" | "REPORT_REVIEW" | "REPORT_CHANGES" | "REPORT_PENDING" | "TRACKING" | "WAREHOUSE" | "EXCEPTION";

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
  viewerCanManage?: boolean;
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
  cargoAssetIds?: string[];
  materialItemIds?: string[];
  materialLines?: MaterialLineDraft[];
  materialQuantities?: Record<string, string>;
  temporaryAddress?: string;
  temporaryLocation?: GeocodeCandidate | null;
};

type MissionCargoManifestEntry = {
  action: string;
  itemId: string | null;
  assetId: string | null;
  materialRequestId: string | null;
  quantity: string | null;
};

type MissionStopView = {
  id: string;
  sequence: number;
  kind: string;
  label: string;
  status: string;
  deliveryStatus: string;
  locationId: string;
  cargoActions: string[];
  cargoManifest: MissionCargoManifestEntry[];
  expectedArrivalAt: string | null;
  expectedDepartureAt: string | null;
  arrivedAt: string | null;
  departedAt: string | null;
  lastLocationEvent: { type: string; occurredAt: string; confidence: number } | null;
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

type MaterialLineDraft = {
  itemId: string;
  description: string;
  quantity: string;
  unit: string;
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

type MissionCreateResponse = {
  error?: string;
  message?: string;
  missionId?: string;
  record?: { id?: string; status?: string; payload?: Record<string, unknown> };
  readback?: { status?: string };
  mutation?: {
    action?: string;
    record?: { id?: string; status?: string; payload?: Record<string, unknown> };
    eventId?: string;
  };
};

type PlanningHandoff = {
  id: string;
  jobId: string;
  title: string;
  status: string;
  version: number;
  startsAt: string | null;
  endsAt: string | null;
  location: string | null;
  payload: Record<string, unknown>;
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
  { id: "operations", label: "COMMESSE", path: "/operations", capability: "operations.read", icon: BriefcaseBusiness },
  { id: "workforce", label: "PERSONE", path: "/workforce", capability: "workforce.read", icon: Users },
  { id: "planning", label: "PIANIFICAZIONE", path: "/planning", capability: "planning.read", icon: CalendarClock },
  { id: "attendance", label: "PRESENZE", path: "/presenze", capability: "workforce.read", icon: Clock3 },
  { id: "assets", label: "ASSET", path: "/assets", capability: "asset.read", icon: Package },
  { id: "warehouse", label: "MAGAZZINO", path: "/warehouse", capability: "warehouse.read", icon: Layers3 },
  { id: "mission", label: "MISSIONI", path: "/mission", capability: "mission.read", icon: Truck },
  { id: "documents", label: "DOCUMENTI", path: "/documents", capability: "documents.read", icon: FileText },
  { id: "authority", label: "AUTORITÀ", path: "/onboarding", capability: "authority.read", icon: ShieldCheck },
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
  owner: "Titolare",
  admin: "Amministratore",
  manager: "Manager",
  office: "Ufficio",
  technical: "Tecnico",
  field_supervisor: "Caposquadra",
  worker: "Operatore",
  warehouse_manager: "Responsabile magazzino",
  warehouse_operator: "Magazziniere",
  driver: "Autista",
  delivery_driver: "Autista di consegna",
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

function materialRequestLineDrafts(request: MaterialRequest | null): MaterialLineDraft[] {
  return (request ? missionDeliveryLines(request.payload) ?? [] : []).flatMap((line) => line.itemId ? [{
    itemId: line.itemId,
    description: text(line.description, "Materiale"),
    quantity: String(line.quantity),
    unit: text(line.unit, "UNIT"),
  }] : []);
}

function cargoOptionLabel(option: MissionCargoOption) {
  const identifiers = [option.model, option.registration ? `targa ${option.registration}` : null, option.serialNumber ? `matr. ${option.serialNumber}` : null].filter(Boolean);
  const readable = [option.label, ...identifiers].join(" · ");
  return option.code && option.code !== option.label ? `${readable} · ${option.code}` : readable;
}

function formatDate(value: unknown) {
  if (typeof value !== "string" || !value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
}

function dateTimeLocalValue(value: unknown) {
  if (typeof value !== "string" || !value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
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
  if (["BLOCKED", "VEHICLE_FAULT", "REFUSED", "LOST", "CANCELLED"].includes(status)) return "red";
  if (["DELAYED", "PARTIAL_DELIVERY", "RECONCILE_REQUIRED"].includes(status)) return "amber";
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
    VEHICLE_FAULT: "GUASTO MEZZO",
    PARTIAL_DELIVERY: "CONSEGNA PARZIALE",
    REFUSED: "RIFIUTATA",
    LOST: "CARICO NON REPERIBILE",
    RECONCILE_REQUIRED: "DA RICONCILIARE",
    CANCELLED: "ANNULLATA",
  };
  return labels[status] ?? status.replaceAll("_", " ");
}

function reportStatusTone(status: string | undefined): Tone {
  if (status === "APPROVED") return "lime";
  if (status === "CHANGES_REQUESTED") return "amber";
  if (status === "SUBMITTED") return "cyan";
  return "muted";
}

function reportStatusLabel(status: string | undefined) {
  return ({
    EMPTY: "DA CREARE",
    DRAFT: "BOZZA",
    SUBMITTED: "INVIATO",
    APPROVED: "APPROVATO",
    CHANGES_REQUESTED: "INTEGRAZIONE RICHIESTA",
  } as Record<string, string>)[status ?? "EMPTY"] ?? "DA CREARE";
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

function snapshotResourceAssignee(payload: Record<string, unknown>, key: "driver" | "vehicle") {
  const snapshot = payload.resourceSnapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return "Non disponibile";
  const resource = (snapshot as Record<string, unknown>)[key];
  if (!resource || typeof resource !== "object" || Array.isArray(resource)) return "Non disponibile";
  const assignee = (resource as Record<string, unknown>).operationalAssignee;
  if (!assignee || typeof assignee !== "object" || Array.isArray(assignee)) return "Nessuna assegnazione registrata";
  return text((assignee as Record<string, unknown>).name, "Nessuna assegnazione registrata");
}

function snapshotCargoAssets(payload: Record<string, unknown>) {
  const snapshot = payload.resourceSnapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return snapshotLabel(payload, "cargoAsset");
  const records = (snapshot as Record<string, unknown>).cargoAssets;
  if (!Array.isArray(records)) return snapshotLabel(payload, "cargoAsset");
  const labels = records.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const record = value as Record<string, unknown>;
    const code = text(record.code, "");
    const label = text(record.label, "Asset");
    return [code && code !== label ? `${code} · ${label}` : label];
  });
  return labels.join(" · ") || "Nessun asset associato";
}

function snapshotCargoAssignees(payload: Record<string, unknown>) {
  const snapshot = payload.resourceSnapshot;
  const records = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
    ? (snapshot as Record<string, unknown>).cargoAssets
    : null;
  if (!Array.isArray(records)) return "Non specificato";
  const labels = records.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const record = value as Record<string, unknown>;
    const assignee = record.operationalAssignee;
    if (!assignee || typeof assignee !== "object" || Array.isArray(assignee)) return [];
    const owner = assignee as Record<string, unknown>;
    return [`${text(record.label, text(record.code, "Asset"))} → ${text(owner.name, "Utilizzatore")}`];
  });
  return labels.join(" · ") || "Nessun assegnatario di lungo periodo";
}

function cargoCustodyReadback(payload: Record<string, unknown>) {
  const custody = payload.cargoCustody;
  if (!custody || typeof custody !== "object" || Array.isArray(custody)) {
    return statusLabel(text(payload.status, "PLANNED"));
  }
  const labels: Record<string, string> = { IN_TRANSIT: "In transito", AWAITING_RECEIPT: "Scaricato · ricezione da confermare", DELIVERED: "Consegnato" };
  const states = [...new Set(Object.values(custody as Record<string, unknown>).flatMap((value) => value && typeof value === "object" && !Array.isArray(value) ? [text((value as Record<string, unknown>).state, "")] : []).filter(Boolean))];
  return states.map((state) => labels[state] ?? state.replaceAll("_", " ")).join(" · ") || statusLabel(text(payload.status, "PLANNED"));
}

function snapshotAssetLabel(payload: Record<string, unknown>, assetId: string) {
  const snapshot = payload.resourceSnapshot;
  const cargoAssets = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
    ? (snapshot as Record<string, unknown>).cargoAssets
    : null;
  const records: unknown[] = Array.isArray(cargoAssets) ? cargoAssets : [];
  const match = records.find((value) => value && typeof value === "object" && !Array.isArray(value) && text((value as Record<string, unknown>).id, "") === assetId);
  if (match && typeof match === "object" && !Array.isArray(match)) {
    const record = match as Record<string, unknown>;
    const code = text(record.code, "");
    const label = text(record.label, "Asset");
    return code && code !== label ? `${code} · ${label}` : label;
  }
  return assetId ? `Asset ${assetId}` : "Asset non identificato";
}

function requestLinesLabel(payload: Record<string, unknown>) {
  const labels = (missionDeliveryLines(payload) ?? []).map((line) => `${text(line.description, "Materiale")} · ${line.quantity} ${text(line.unit, "")}`.trim());
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

function routeStopViews(payload: Record<string, unknown>): MissionStopView[] {
  const route = payload.route && typeof payload.route === "object" && !Array.isArray(payload.route)
    ? payload.route as Record<string, unknown>
    : null;
  const readback = payload.routeReadback && typeof payload.routeReadback === "object" && !Array.isArray(payload.routeReadback)
    ? payload.routeReadback as Record<string, unknown>
    : null;
  const plannedStops = Array.isArray(route?.stops) ? route.stops : [];
  const observedStops = Array.isArray(readback?.stops) ? readback.stops : [];
  const source = observedStops.length > 0 ? observedStops : plannedStops;
  return source.flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
    const value = candidate as Record<string, unknown>;
    const planned = plannedStops.find((item) => item && typeof item === "object" && !Array.isArray(item) && (item as Record<string, unknown>).id === value.id);
    const plannedValue = planned && typeof planned === "object" && !Array.isArray(planned) ? planned as Record<string, unknown> : {};
    const metadata = value.metadata && typeof value.metadata === "object" && !Array.isArray(value.metadata) ? value.metadata as Record<string, unknown> : {};
    const locationEvent = value.lastLocationEvent && typeof value.lastLocationEvent === "object" && !Array.isArray(value.lastLocationEvent) ? value.lastLocationEvent as Record<string, unknown> : null;
    const cargoManifest = (Array.isArray(plannedValue.cargoActions) ? plannedValue.cargoActions : Array.isArray(metadata.cargoActions) ? metadata.cargoActions : []).flatMap((action): MissionCargoManifestEntry[] => {
      if (typeof action === "string") return [{ action: action.toUpperCase(), itemId: null, assetId: null, materialRequestId: null, quantity: null }];
      if (!action || typeof action !== "object" || Array.isArray(action)) return [];
      const actionValue = action as Record<string, unknown>;
      const normalizedAction = text(actionValue.action ?? actionValue.type, "").toUpperCase();
      if (!normalizedAction) return [];
      return [{
        action: normalizedAction,
        itemId: text(actionValue.itemId, "") || null,
        assetId: text(actionValue.assetId, "") || null,
        materialRequestId: text(actionValue.materialRequestId, "") || null,
        quantity: typeof actionValue.quantity === "number" || typeof actionValue.quantity === "string" ? String(actionValue.quantity) : null,
      }];
    });
    const cargoActions = cargoManifest.map((entry) => entry.action);
    return [{
      id: text(value.id ?? plannedValue.id, `STOP-${index + 1}`),
      sequence: typeof value.sequence === "number" ? value.sequence : typeof plannedValue.sequence === "number" ? plannedValue.sequence : index + 1,
      kind: text(plannedValue.kind ?? metadata.kind, "TRANSFER").toUpperCase(),
      label: text(plannedValue.label ?? metadata.label, `Tappa ${index + 1}`),
      status: text(value.status, "PLANNED").toUpperCase(),
      deliveryStatus: text(value.deliveryStatus, "PLANNED").toUpperCase(),
      locationId: text(value.locationId ?? plannedValue.locationId, ""),
      cargoActions,
      cargoManifest,
      expectedArrivalAt: text(value.expectedArrivalAt ?? plannedValue.expectedArrivalAt, "") || null,
      expectedDepartureAt: text(value.expectedDepartureAt ?? plannedValue.expectedDepartureAt, "") || null,
      arrivedAt: text(value.arrivedAt ?? plannedValue.arrivedAt, "") || null,
      departedAt: text(value.departedAt ?? plannedValue.departedAt, "") || null,
      lastLocationEvent: locationEvent ? {
        type: text(locationEvent.type, "EVENTO"),
        occurredAt: text(locationEvent.occurredAt, ""),
        confidence: typeof locationEvent.confidence === "number" ? locationEvent.confidence : 0,
      } : null,
    }];
  });
}

function routeStopPhysicallyClosedView(stop: MissionStopView) {
  return stop.status === "DEPARTED" || Boolean(stop.departedAt);
}

function currentRouteStopView(stops: MissionStopView[]) {
  return stops.find((stop) => !routeStopPhysicallyClosedView(stop)) ?? null;
}

function operationalTimeline(payload: Record<string, unknown>, limit = 8) {
  return Array.isArray(payload.operationalTimeline)
    ? payload.operationalTimeline.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object" && !Array.isArray(entry))).slice(-limit).reverse()
    : [];
}

function missionReport(payload: Record<string, unknown>) {
  const value = payload.missionReport;
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as MissionReportReadback
    : null;
}

function missionWarehouseReadback(payload: Record<string, unknown>) {
  const value = payload.warehouseReadback;
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as MissionWarehouseReadback
    : null;
}

function missionExceptionReadback(payload: Record<string, unknown>) {
  return storedMissionException(payload.missionException);
}

function missionTrackingReadback(payload: Record<string, unknown>) {
  const value = payload.trackingReadback;
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function missionNeedsAttention(mission: Mission, filter: MissionAttentionFilter) {
  if (filter === "ALL") return true;
  const report = missionReport(mission.payload);
  const tracking = missionTrackingReadback(mission.payload);
  const warehouse = missionWarehouseReadback(mission.payload);
  const exception = missionExceptionReadback(mission.payload);
  if (filter === "REPORT_REVIEW") return report?.status === "SUBMITTED";
  if (filter === "REPORT_CHANGES") return report?.status === "CHANGES_REQUESTED";
  if (filter === "REPORT_PENDING") return ["RECONCILED", "RECONCILE_REQUIRED"].includes(mission.status) && !["SUBMITTED", "APPROVED"].includes(report?.status ?? "");
  if (filter === "TRACKING") return ["DISPATCHED", "DELIVERED", "PARTIAL_DELIVERY", "DELAYED", "BLOCKED"].includes(mission.status)
    && ["NOT_ACTIVE", "NO_POSITION", "STALE"].includes(text(tracking?.status, ""));
  if (filter === "WAREHOUSE") return warehouse?.required === true && warehouse.status !== "DELIVERED";
  return exception?.recoveryStatus === "OPEN";
}

function cargoActionLabel(action: string) {
  return ({
    LOAD: "CARICO",
    UNLOAD: "SCARICO",
    TRANSFER: "TRASFERIMENTO",
    RETURN: "RIENTRO",
  } as Record<string, string>)[action] ?? action.replaceAll("_", " ");
}

function cargoManifestProgress(action: string, line: MissionWarehouseReadback["lines"][number] | null, event: Record<string, unknown> | null) {
  if (event) return { label: "REGISTRATO", tone: "lime" as Tone };
  if (!line) return { label: "AZIONE DA CONFERMARE", tone: "amber" as Tone };
  const actual = ["LOAD", "TRANSFER"].includes(action) ? line.loaded : ["UNLOAD", "RETURN"].includes(action) ? line.delivered : 0;
  if (actual > 0) return { label: "READBACK MISSIONE", tone: "amber" as Tone };
  return { label: "IN ATTESA", tone: "cyan" as Tone };
}

function manifestEventForEntry(timeline: Record<string, unknown>[], stop: MissionStopView, entry: MissionCargoManifestEntry) {
  const expectedTypes = entry.action === "LOAD"
    ? ["LOAD_CONFIRMED"]
    : entry.action === "UNLOAD" || entry.action === "RETURN"
      ? ["UNLOAD_CONFIRMED"]
      : ["LOAD_CONFIRMED", "UNLOAD_CONFIRMED"];
  return timeline.find((candidate) => {
    if (text(candidate.stopId, "") !== stop.id || !expectedTypes.includes(text(candidate.type, "").toUpperCase())) return false;
    const materialItemIds = Array.isArray(candidate.materialItemIds)
      ? candidate.materialItemIds.flatMap((value) => typeof value === "string" ? [value] : [])
      : [];
    if (entry.itemId && materialItemIds.length) return materialItemIds.includes(entry.itemId);
    if (entry.assetId) return text(candidate.assetId, "") === entry.assetId;
    return !entry.itemId && !entry.assetId;
  }) ?? null;
}

function trackingStatusTone(status: string): Tone {
  if (status === "LIVE") return "lime";
  if (status === "RECENT") return "cyan";
  if (status === "STALE" || status === "NO_POSITION") return "amber";
  return "muted";
}

function trackingStatusLabel(status: string) {
  return ({
    LIVE: "LIVE",
    RECENT: "RECENTE",
    STALE: "STALE",
    NO_POSITION: "NESSUNA POSIZIONE",
    NOT_ACTIVE: "NON ATTIVO",
    RESTRICTED: "ACCESSO LIMITATO",
  } as Record<string, string>)[status] ?? status.replaceAll("_", " ");
}

function routeTrackingMessage(status: string, hasMission: boolean) {
  if (!hasMission) return "Seleziona una missione per leggere lo stato tracking autorizzato.";
  if (status === "LIVE") return "Telemetria ricevuta durante il turno autorizzato. Questa scheda riassume la tratta; posizione e geofence aggiornate sono in Control.";
  if (status === "RECENT") return "L’ultimo segnale è recente. Per posizione e tappe aggiornate apri la mappa Control.";
  if (status === "STALE" || status === "NO_POSITION") return "Non è disponibile una posizione aggiornata per questa missione. Il riepilogo della tratta non rappresenta la posizione del mezzo.";
  if (status === "NOT_ACTIVE") return "La sessione tracking si attiva con il timbro di ingresso dell’autista; qui vedi il riepilogo della tratta.";
  if (status === "RESTRICTED") return "Il ruolo corrente non può leggere la posizione del mezzo. La tratta resta visibile secondo i permessi Missioni.";
  return "Questa scheda mostra il percorso pianificato; lo stato del mezzo deriva dal readback autorizzato del provider.";
}

function stopStatusTone(status: string): Tone {
  if (status === "ARRIVED" || status === "IN_PROGRESS") return "cyan";
  if (status === "DEPARTED" || status === "COMPLETED") return "lime";
  return "muted";
}

function stopStatusLabel(status: string) {
  return ({
    PLANNED: "PIANIFICATA",
    ARRIVED: "ARRIVATA",
    IN_PROGRESS: "IN CORSO",
    DEPARTED: "PARTITA",
    COMPLETED: "CHIUSA",
  } as Record<string, string>)[status] ?? status.replaceAll("_", " ");
}

function warehouseStatusLabel(status: string) {
  return ({
    NOT_REQUIRED: "NON RICHIESTO",
    PENDING_PICK: "IN ATTESA DI PRELIEVO",
    PICKED: "PRELEVATO",
    LOADED: "CARICATO",
    DELIVERED: "SCARICATO / CONSEGNATO",
    PARTIAL: "PARZIALE",
    RECONCILE: "DA RICONCILIARE",
  } as Record<string, string>)[status] ?? status.replaceAll("_", " ");
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

function AttentionCard({ label, value, detail, icon: Icon, tone, active, onClick }: { label: string; value: number; detail: string; icon: LucideIcon; tone: Tone; active: boolean; onClick: () => void }) {
  return <button aria-pressed={active} className={cn("rounded-2xl border p-3 text-left transition hover:border-lime-300/35 hover:bg-lime-300/[.045]", active ? "border-lime-300/45 bg-lime-300/[.08] shadow-[0_0_24px_rgba(200,255,34,.08)]" : "border-white/[.08] bg-black/20")} onClick={onClick} type="button"><div className="flex items-start justify-between gap-3"><span className={cn("grid size-8 place-items-center rounded-xl border", toneStyles[tone].icon)}><Icon className="size-4" /></span><span className="font-mono text-xl font-semibold tracking-[-.06em] text-slate-100">{value}</span></div><p className="mt-3 text-[10px] font-semibold uppercase tracking-[.14em] text-slate-300">{label}</p><p className="mt-1 text-[10px] leading-4 text-slate-600">{detail}</p></button>;
}

function MissionPodEvidenceFields({ defaultType = "AUTHORIZED_DRIVER_CONFIRMATION" }: { defaultType?: MissionPodEvidenceType }) {
  const [evidenceType, setEvidenceType] = useState<MissionPodEvidenceType>(defaultType);
  const needsReference = missionPodEvidenceRequiresReference(evidenceType);
  const needsDocument = missionPodEvidenceRequiresDocument(evidenceType);
  return <section className="sm:col-span-2 rounded-2xl border border-lime-300/15 bg-lime-300/[.035] p-4">
    <div className="flex items-start gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-lime-300/25 bg-lime-300/10 text-lime-200"><FileCheck2 className="size-4" /></span>
      <div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/75">EVIDENZA POD</p><p className="mt-1 text-xs font-semibold text-slate-100">La consegna viene verificata con una prova nominata</p><p className="mt-1 text-[10px] leading-5 text-slate-500">Il GPS descrive l’arrivo, ma non promuove da solo la consegna. Scegli la prova realmente acquisita.</p></div>
    </div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <label className="text-[10px] text-slate-500">Tipo di evidenza<select aria-label="Tipo di evidenza POD" className="mt-1 h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-slate-200 outline-none focus:border-lime-300/40" name="evidenceType" onChange={(event) => setEvidenceType(event.target.value as MissionPodEvidenceType)} value={evidenceType}>{MISSION_POD_EVIDENCE_TYPES.map((type) => <option key={type} value={type}>{MISSION_POD_EVIDENCE_LABELS[type]}</option>)}</select></label>
      <label className="text-[10px] text-slate-500">Riferimento {needsReference ? <span className="text-amber-200">· obbligatorio</span> : <span className="text-slate-700">· opzionale</span>}<Input className="mt-1 h-10 border-white/10 bg-black/30 text-xs" name="evidenceReference" placeholder={evidenceType === "BARCODE_OR_QR_CONFIRMATION" ? "Valore barcode o QR" : evidenceType === "DDT_SCANNED" ? "Numero DDT" : evidenceType === "ORDER_MARKED_DELIVERED" ? "Numero ordine" : "Nota o riferimento"} /></label>
      <label className="text-[10px] text-slate-500 sm:col-span-2">Documento verificato {needsDocument ? <span className="text-amber-200">· obbligatorio</span> : <span className="text-slate-700">· richiesto solo per foto, firma o DDT</span>}<Input className="mt-1 h-10 border-white/10 bg-black/30 font-mono text-xs" name="documentId" placeholder="ID documento CLEAN dal registro documenti" /></label>
    </div>
  </section>;
}

type MissionAction = "mission_load" | "mission_unload" | "mission_deliver" | "mission_exception" | "mission_resume";

function MissionActionPanel({
  mission,
  stops,
  timeline,
  manifestTimeline,
  selectedStopId,
  note,
  canRecord,
  canManage: canManageProp,
  busy,
  onStopChange,
  onNoteChange,
  onRecord,
}: {
  mission: Mission;
  stops: MissionStopView[];
  timeline: Record<string, unknown>[];
  manifestTimeline: Record<string, unknown>[];
  selectedStopId: string;
  note: string;
  canRecord: boolean;
  canManage?: boolean;
  busy: boolean;
  onStopChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onRecord: (action: MissionAction, stop: MissionStopView | null) => void;
}) {
  const canManage = canManageProp ?? mission.viewerCanManage === true;
  const selectedStop = stops.find((stop) => stop.id === selectedStopId) ?? stops[0] ?? null;
  const tracking = missionTrackingReadback(mission.payload);
  const currentStopId = currentRouteStopView(stops)?.id ?? text(tracking?.currentStopId, "");
  const currentStop = stops.find((stop) => stop.id === currentStopId) ?? null;
  const selectedIsCurrent = Boolean(selectedStop && currentStop && selectedStop.id === currentStop.id);
  const selectedIsAtLocation = Boolean(selectedStop && ["ARRIVED", "IN_PROGRESS", "LOADED", "UNLOADED"].includes(selectedStop.status));
  const selectedStopReady = selectedIsCurrent && selectedIsAtLocation;
  const actions = selectedStop?.cargoActions ?? [];
  const canLoad = canRecord && selectedStopReady && selectedStop?.status !== "LOADED" && ["PLANNED", "DISPATCHED"].includes(mission.status) && (!actions.length || actions.some((action) => ["LOAD", "TRANSFER"].includes(action)));
  const canUnload = canRecord && selectedStopReady && selectedStop?.status !== "UNLOADED" && ["DISPATCHED", "PARTIAL_DELIVERY"].includes(mission.status) && (!actions.length || actions.some((action) => ["UNLOAD", "RETURN", "TRANSFER"].includes(action)));
  const canOpenDelivery = canRecord && selectedStopReady && ["DISPATCHED", "PARTIAL_DELIVERY"].includes(mission.status) && selectedStop?.kind === "DELIVERY" && (selectedStop.status === "UNLOADED" || selectedStop.deliveryStatus === "UNLOADED");
  const warehouseReadback = missionWarehouseReadback(mission.payload);
  const completedStops = stops.filter((stop) => stop.status === "COMPLETED" || stop.deliveryStatus === "CONFIRMED").length;
  return <><section className="mt-5 rounded-2xl border border-cyan-300/15 bg-cyan-300/[.035] p-4">
    <div className="flex items-start gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-cyan-300/25 bg-cyan-300/10 text-cyan-200"><Package className="size-4" /></span>
      <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-cyan-200/75">AZIONI IN CAMPO</p>{stops.length > 1 && <StatusPill label={`${completedStops}/${stops.length} TAPPE CHIUSE`} tone={completedStops === stops.length ? "lime" : "cyan"} />}</div><h3 className="mt-1 text-sm font-semibold text-slate-100">Carico e scarico verificati</h3><p className="mt-1 text-[10px] leading-5 text-slate-500">L’autista conferma l’azione sulla tappa reale. Il server registra timestamp, autore, tappa e asset senza usare l’orologio del dispositivo. La missione resta in viaggio finché tutte le tappe di consegna non sono chiuse.</p></div>
    </div>
    <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
      <label className="text-[10px] text-slate-500">Tappa operativa
        <select aria-label="Tappa operativa per carico o scarico" className="mt-1 h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-slate-200 outline-none focus:border-cyan-300/40" disabled={!stops.length || !currentStopId} onChange={(event) => onStopChange(event.target.value)} value={selectedStop?.id ?? ""}>
          {!stops.length && <option value="">Tappa non dettagliata</option>}
          {stops.length > 0 && !currentStopId && <option value="">In attesa dell’aggancio geofence</option>}
          {stops.map((stop) => <option disabled={Boolean(currentStopId) && stop.id !== currentStopId} key={stop.id} value={stop.id}>{stop.sequence}. {stop.label} · {stop.kind.replaceAll("_", " ")}{stop.id === currentStopId ? " · CORRENTE" : ""}</option>)}
        </select>
      </label>
      <div className="flex flex-wrap items-end gap-2">
        {canLoad && <Button className="h-10 bg-cyan-300 px-3 text-[10px] font-semibold text-[#041012] hover:bg-cyan-200" disabled={busy} onClick={() => onRecord("mission_load", selectedStop)} type="button"><Package className="size-3.5" />Carico effettuato</Button>}
        {canUnload && <Button className="h-10 bg-lime-300 px-3 text-[10px] font-semibold text-[#050705] hover:bg-lime-200" disabled={busy} onClick={() => onRecord("mission_unload", selectedStop)} type="button"><BadgeCheck className="size-3.5" />Scarico effettuato</Button>}
        {canOpenDelivery && <Button className="h-10 border-lime-300/25 bg-lime-300/[.06] px-3 text-[10px] font-semibold text-lime-100 hover:bg-lime-300/10" disabled={busy} onClick={() => onRecord("mission_deliver", selectedStop)} type="button"><BadgeCheck className="size-3.5" />Completa tappa</Button>}
        {canRecord && !["CLOSED", "CANCELLED", "RECONCILE_REQUIRED"].includes(mission.status) && <Button className="h-10 border-rose-300/25 bg-rose-300/[.06] px-3 text-[10px] font-semibold text-rose-100 hover:bg-rose-300/10" disabled={busy} onClick={() => onRecord("mission_exception", selectedStop)} type="button"><CircleAlert className="size-3.5" />Segnala eccezione</Button>}
        {canManage && ["DELAYED", "BLOCKED", "VEHICLE_FAULT", "PARTIAL_DELIVERY", "REFUSED", "LOST"].includes(mission.status) && <Button className="h-10 border-lime-300/25 bg-lime-300/[.06] px-3 text-[10px] font-semibold text-lime-100 hover:bg-lime-300/10" disabled={busy} onClick={() => onRecord("mission_resume", selectedStop)} type="button"><Route className="size-3.5" />Riprendi missione</Button>}
        {!canLoad && !canUnload && stops.length > 0 && <span className="rounded-xl border border-amber-300/15 bg-amber-300/[.035] px-3 py-2 text-[10px] text-amber-100/75">{currentStop ? (selectedIsAtLocation ? "Tappa corrente agganciata · nessuna azione compatibile" : "Attesa conferma arrivo geofence") : "Attesa aggancio server-side della tappa corrente"}</span>}
      </div>
    </div>
    {currentStop && <p className="mt-3 text-[9px] text-cyan-100/65">Tappa corrente server-side: {currentStop.sequence}. {currentStop.label} · stato {currentStop.status.replaceAll("_", " ")}. Le azioni su tappe diverse restano bloccate.</p>}
    <Input aria-label="Nota azione di carico o scarico" className="mt-3 h-10 border-white/10 bg-black/25 text-xs" disabled={!canRecord || busy} onChange={(event) => onNoteChange(event.target.value)} placeholder="Nota opzionale: quantità, riserva, anomalia…" value={note} />
    <div className="mt-4 rounded-xl border border-white/[.08] bg-black/20 p-3">
      <div className="flex items-center justify-between gap-3"><p className="text-[9px] font-semibold uppercase tracking-[.16em] text-slate-600">TIMELINE OPERATIVA</p><span className="font-mono text-[9px] text-cyan-200/70">{timeline.length} EVENTI</span></div>
      {timeline.length ? <div className="mt-2 space-y-2">{timeline.map((entry, index) => <div className="flex items-start gap-2" key={text(entry.id, `event-${index}`)}><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-cyan-200 shadow-[0_0_8px_rgba(89,217,255,.75)]" /><div className="min-w-0"><p className="text-[10px] font-semibold text-slate-300">{text(entry.type, "EVENTO").replaceAll("_", " ")} <span className="font-normal text-slate-600">· {formatDate(entry.recordedAt ?? entry.occurredAt)}</span></p><p className="truncate text-[9px] text-slate-600">{text(entry.note, "Registrato dal flusso missione")}</p></div></div>)}</div> : <p className="mt-2 text-[10px] text-slate-600">Nessun carico o scarico confermato su questa missione.</p>}
    </div>
  </section><MissionStopCargoManifestPanel payload={mission.payload} readback={warehouseReadback} stop={selectedStop} timeline={manifestTimeline} /><MissionWarehousePanel readback={warehouseReadback} /><MissionPodReadbackPanel payload={mission.payload} /><MissionExceptionReadbackPanel payload={mission.payload} /><MissionTrackingPanel payload={mission.payload} /></>;
}

function MissionStopCargoManifestPanel({ payload, readback, stop, timeline }: { payload: Record<string, unknown>; readback: MissionWarehouseReadback | null; stop: MissionStopView | null; timeline: Record<string, unknown>[] }) {
  if (!stop || !stop.cargoManifest.length) return null;
  const cargoAssetId = text(payload.cargoAssetId, "");
  return <section className="mt-4 rounded-2xl border border-lime-300/15 bg-lime-300/[.025] p-4">
    <div className="flex items-start gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-lime-300/25 bg-lime-300/10 text-lime-200"><Package className="size-4" /></span>
      <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/75">MANIFESTO TAPPA CORRENTE</p><StatusPill label={stop.status.replaceAll("_", " ")} tone={stop.status === "COMPLETED" || stop.deliveryStatus === "CONFIRMED" ? "lime" : "cyan"} /></div><h3 className="mt-1 text-sm font-semibold text-slate-100">{stop.sequence}. {stop.label}</h3><p className="mt-1 text-[10px] leading-5 text-slate-500">Questa è la distinta operativa letta dal piano server-side: cosa deve essere caricato, trasferito o scaricato in questa tappa.</p></div>
    </div>
    <div className="mt-4 space-y-2">{stop.cargoManifest.map((entry, index) => {
      const line = entry.itemId && readback ? readback.lines.find((candidate) => candidate.itemId === entry.itemId) ?? null : null;
      const event = manifestEventForEntry(timeline, stop, entry);
      const progress = cargoManifestProgress(entry.action, line, event);
      const isAsset = Boolean(entry.assetId);
      const label = line?.name ?? (isAsset ? snapshotAssetLabel(payload, entry.assetId ?? cargoAssetId) : entry.materialRequestId ? `Richiesta ${entry.materialRequestId}` : "Movimento operativo");
      const reference = line ? `${line.sku} · ${line.itemId ?? line.lineId}` : entry.assetId ?? entry.itemId ?? entry.materialRequestId ?? "Nessun identificativo associato";
      const quantity = entry.quantity ?? (line ? String(line.required) : null);
      return <div className="rounded-xl border border-white/[.08] bg-black/20 p-3" key={`${entry.action}-${entry.itemId ?? entry.assetId ?? entry.materialRequestId ?? index}`}>
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-xs font-semibold text-slate-200">{label}</p><p className="mt-1 truncate font-mono text-[9px] text-slate-600">{reference}</p></div><div className="flex shrink-0 flex-wrap justify-end gap-1.5"><StatusPill label={cargoActionLabel(entry.action)} tone={entry.action === "UNLOAD" || entry.action === "RETURN" ? "lime" : "cyan"} /><StatusPill label={progress.label} tone={progress.tone} /></div></div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]"><div><p className="text-slate-600">Quantità prevista</p><p className="mt-1 font-mono text-slate-200">{quantity ? `${quantity}${line?.unit ? ` ${line.unit}` : ""}` : "da confermare"}</p></div><div><p className="text-slate-600">Readback missione</p><p className="mt-1 font-mono text-slate-300">{line ? `${entry.action === "LOAD" || entry.action === "TRANSFER" ? line.loaded : line.delivered} ${line.unit}` : "nessun saldo materiale"}</p></div></div>
        {event ? <p className="mt-2 text-[9px] text-lime-100/75">Evento effettivo: {text(event.type, "AZIONE").replaceAll("_", " ")} · {formatDate(event.recordedAt ?? event.occurredAt)} · autore {text(event.recordedBy, "server")}{text(event.note, "") ? ` · ${text(event.note, "")}` : ""}</p> : <p className="mt-2 text-[9px] text-amber-100/65">Evento effettivo non ancora registrato su questa tappa.</p>}
      </div>;
    })}</div>
    <p className="mt-3 text-[9px] text-lime-100/60">Il pulsante di carico/scarico resta abilitato solo sulla tappa agganciata dal server e registra l’evento ufficiale con timestamp, autore e distinta associata.</p>
  </section>;
}

function MissionWarehousePanel({ readback }: { readback: MissionWarehouseReadback | null }) {
  if (!readback || !readback.required) return null;
  const tone: Tone = readback.status === "DELIVERED" ? "lime" : readback.status === "RECONCILE" || readback.status === "PENDING_PICK" ? "amber" : "cyan";
  return <section className="mt-4 rounded-2xl border border-amber-300/15 bg-amber-300/[.035] p-4"><div className="flex items-start gap-3"><span className={cn("grid size-9 shrink-0 place-items-center rounded-xl border border-current/25 bg-current/10", toneStyles[tone].icon)}><Layers3 className="size-4" /></span><div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-amber-200/75">RICONCILIAZIONE MAGAZZINO</p><h3 className="mt-1 text-sm font-semibold text-slate-100">{readback.warehouse?.name ?? "Magazzino sorgente"}</h3><p className="mt-1 truncate text-[10px] text-slate-500">{readback.warehouse?.locationLabel ?? "Ubicazione non disponibile"}</p></div><StatusPill label={warehouseStatusLabel(readback.status)} tone={tone} /></div><div className="mt-4 space-y-2">{readback.lines.map((line) => <div className="rounded-xl border border-white/[.08] bg-black/20 p-3" key={line.lineId}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-xs font-semibold text-slate-200">{line.name}</p><p className="mt-1 font-mono text-[10px] text-slate-600">{line.sku} · richiesto {line.required} {line.unit}</p></div><span className={cn("shrink-0 text-[9px] uppercase tracking-[.12em]", line.status === "DELIVERED" ? "text-lime-200" : line.status === "RECONCILE" || line.status === "PENDING_PICK" ? "text-amber-200" : "text-cyan-100")}>{warehouseStatusLabel(line.status)}</span></div><div className="mt-3 grid grid-cols-3 gap-2 text-[10px]"><div><p className="text-slate-600">Prelevato</p><p className="mt-1 font-mono text-slate-200">{line.picked} {line.unit}</p></div><div><p className="text-slate-600">Caricato</p><p className="mt-1 font-mono text-cyan-100">{line.loaded} {line.unit}</p></div><div><p className="text-slate-600">Scaricato</p><p className="mt-1 font-mono text-lime-100">{line.delivered} {line.unit}</p></div></div></div>)}</div>{readback.missing.length > 0 && <div className="mt-3 rounded-xl border border-amber-300/15 bg-amber-300/[.04] p-3"><p className="text-[9px] font-semibold uppercase tracking-[.14em] text-amber-200/75">BLOCCO OPERATIVO</p>{readback.missing.slice(0, 3).map((item) => <p className="mt-1 text-[10px] leading-5 text-amber-100/80" key={item}>{item}</p>)}</div>}<p className="mt-3 text-[9px] text-slate-600">Il saldo resta di proprietà del magazzino sorgente; Missioni conserva solo la catena di custodia e il readback.</p></section>;
}

function MissionPodReadbackPanel({ payload }: { payload: Record<string, unknown> }) {
  const rawEntries = Array.isArray(payload.proofOfDeliveries)
    ? payload.proofOfDeliveries
    : payload.proofOfDelivery && typeof payload.proofOfDelivery === "object" && !Array.isArray(payload.proofOfDelivery)
      ? [payload.proofOfDelivery]
      : [];
  const entries = rawEntries.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object" && !Array.isArray(entry)));
  if (!entries.length) return null;
  return <section className="mt-4 rounded-2xl border border-lime-300/15 bg-lime-300/[.03] p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/75">PROOF OF DELIVERY</p><h3 className="mt-1 text-sm font-semibold text-slate-100">Evidenze registrate per tappa</h3><p className="mt-1 text-[10px] leading-5 text-slate-500">Ogni evidenza conserva tipo, autore e timestamp ufficiale. La posizione resta solo una prova di arrivo.</p></div><StatusPill label={`${entries.length} PROVE`} tone="lime" /></div><div className="mt-3 space-y-2">{entries.map((entry, index) => { const evidence = entry.evidence && typeof entry.evidence === "object" && !Array.isArray(entry.evidence) ? entry.evidence as Record<string, unknown> : {}; return <div className="rounded-xl border border-white/[.08] bg-black/20 p-3" key={text(entry.stopId, `proof-${index}`)}><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-semibold text-slate-200">{text(entry.recipient, "Ricevente non indicato")}</p><StatusPill label={missionPodEvidenceLabel(evidence.type)} tone="cyan" /></div><p className="mt-1 text-[10px] text-slate-600">{text(entry.stopId, "Tappa missione")} · registrata {formatDate(evidence.capturedAt ?? entry.recordedAt)} · da {text(evidence.capturedBy ?? entry.recordedBy, "autore server")}</p>{text(evidence.reference, "") && <p className="mt-2 font-mono text-[10px] text-cyan-100/80">Rif. {text(evidence.reference, "")}</p>}</div>; })}</div></section>;
}

function MissionExceptionReadbackPanel({ payload }: { payload: Record<string, unknown> }) {
  const exception = missionExceptionReadback(payload);
  if (!exception) return null;
  const resolved = exception.recoveryStatus === "RESOLVED";
  return <section className={cn("mt-4 rounded-2xl border p-4", resolved ? "border-lime-300/15 bg-lime-300/[.025]" : "border-rose-300/20 bg-rose-300/[.035]")}><div className="flex items-start gap-3"><span className={cn("grid size-9 shrink-0 place-items-center rounded-xl border", resolved ? "border-lime-300/25 bg-lime-300/10 text-lime-200" : "border-rose-300/25 bg-rose-300/10 text-rose-200")}><CircleAlert className="size-4" /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className={cn("text-[10px] font-semibold uppercase tracking-[.18em]", resolved ? "text-lime-300/75" : "text-rose-200/80")}>ECCEZIONE MISSIONE</p><StatusPill label={resolved ? "RISOLTA" : "APERTA"} tone={resolved ? "lime" : "red"} /></div><h3 className="mt-1 text-sm font-semibold text-slate-100">{missionExceptionLabel(exception.type)}</h3><p className="mt-1 text-[10px] leading-5 text-slate-500">{exception.note}</p><p className="mt-2 text-[9px] text-slate-600">Segnalata {formatDate(exception.reportedAt)} · da {text(exception.reportedBy, "autore server")}{exception.stopId ? ` · tappa ${exception.stopId}` : ""}</p>{resolved && <p className="mt-1 text-[9px] text-lime-200/70">Risolta {formatDate(exception.resolvedAt)} · {text(exception.resolutionNote, "ripresa autorizzata")}</p>}</div></div></section>;
}

function MissionTrackingPanel({ payload }: { payload: Record<string, unknown> }) {
  const tracking = missionTrackingReadback(payload);
  if (!tracking) return null;
  const status = text(tracking.status, "NOT_ACTIVE").toUpperCase();
  const stops = routeStopViews(payload);
  const currentStopId = text(tracking.currentStopId, "");
  const position = tracking.position && typeof tracking.position === "object" && !Array.isArray(tracking.position)
    ? tracking.position as Record<string, unknown>
    : null;
  const event = tracking.lastEvent && typeof tracking.lastEvent === "object" && !Array.isArray(tracking.lastEvent)
    ? tracking.lastEvent as Record<string, unknown>
    : null;
  const restricted = status === "RESTRICTED";
  const tone = trackingStatusTone(status);
  return <section className={cn("mt-4 rounded-2xl border p-4", status === "LIVE" ? "border-lime-300/15 bg-lime-300/[.03]" : "border-cyan-300/15 bg-cyan-300/[.025]")}>
    <div className="flex items-start gap-3">
      <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl border border-current/25 bg-current/10", toneStyles[tone].icon)}><Gauge className="size-4" /></span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-cyan-200/75">TRACKING MISSIONE</p><StatusPill label={trackingStatusLabel(status)} tone={tone} /></div>
        <h3 className="mt-1 text-sm font-semibold text-slate-100">{restricted ? "Posizione non disponibile per questo ruolo" : status === "NOT_ACTIVE" ? "In attesa del check-in autista" : "Sessione autorizzata collegata"}</h3>
        <p className="mt-1 text-[10px] leading-5 text-slate-500">{restricted ? "Il server conserva il confine privacy: serve una capability Location per leggere il dato." : "La posizione compare solo durante il turno autorizzato; il timestamp ufficiale arriva dal server/provider."}</p>
      </div>
      <Link className="hidden shrink-0 rounded-lg border border-cyan-300/20 px-2.5 py-2 text-[10px] text-cyan-100 hover:bg-cyan-300/10 sm:inline-flex" href="/command">Apri Control</Link>
    </div>
    {!restricted && <div className="mt-4 grid gap-2 sm:grid-cols-2">
      <div className="rounded-xl border border-white/[.08] bg-black/20 p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">Ultima posizione</p><p className="mt-2 font-mono text-xs text-slate-200">{position ? `${Number(position.latitude).toFixed(4)}, ${Number(position.longitude).toFixed(4)}` : "Nessuna posizione ricevuta"}</p><p className="mt-1 text-[10px] text-slate-600">{position ? `${formatDate(position.recordedAt)} · ricevuta ${formatDate(position.receivedAt)}` : "Il provider non ha ancora inviato campioni."}</p></div>
      <div className="rounded-xl border border-white/[.08] bg-black/20 p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">Sorgente e qualità</p><p className="mt-2 text-xs text-slate-200">{text(tracking.trackingSource, "—")} · {position?.accuracyM !== null && position?.accuracyM !== undefined ? `${position.accuracyM} m` : "accuratezza n/d"}</p><p className="mt-1 text-[10px] text-slate-600">Avvio {formatDate(tracking.startedAt)}{event ? ` · ultimo evento ${text(event.type, "EVENTO").replaceAll("_", " ")}` : ""}</p></div>
    </div>}
    {stops.length > 0 && <div className="mt-4 rounded-xl border border-white/[.08] bg-black/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-[9px] font-semibold uppercase tracking-[.16em] text-cyan-200/70">REGISTRO TAPPE</p><p className="mt-1 text-[10px] text-slate-500">Stato, arrivo e partenza derivati dal registro server-side.</p></div>{currentStopId && <StatusPill label="TAPPA ATTIVA COLLEGATA" tone="cyan" />}</div>
      <div className="mt-3 space-y-2">{stops.map((stop) => {
        const active = currentStopId === stop.id;
        const stopStatus = text(stop.status, "PLANNED").toUpperCase();
        return <div className={cn("rounded-xl border p-3", active ? "border-cyan-300/30 bg-cyan-300/[.06]" : "border-white/[.07] bg-black/15")} key={stop.id}>
          <div className="flex items-start gap-2"><span className={cn("grid size-7 shrink-0 place-items-center rounded-lg border text-[10px] font-mono", active ? "border-cyan-300/35 bg-cyan-300/10 text-cyan-100" : "border-white/10 text-slate-500")}>{stop.sequence}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-xs font-semibold text-slate-200">{stop.label}</p><StatusPill label={stopStatusLabel(stopStatus)} tone={stopStatusTone(stopStatus)} /></div><p className="mt-1 text-[9px] uppercase tracking-[.12em] text-slate-600">{stop.kind.replaceAll("_", " ")}{active ? " · aggancio corrente" : ""}</p></div></div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]"><div><p className="text-slate-600">{stop.arrivedAt ? "Arrivo registrato" : "Arrivo previsto"}</p><p className="mt-1 font-mono text-slate-300">{formatDate(stop.arrivedAt ?? stop.expectedArrivalAt)}</p></div><div><p className="text-slate-600">{stop.departedAt ? "Partenza registrata" : "Partenza prevista"}</p><p className="mt-1 font-mono text-slate-300">{formatDate(stop.departedAt ?? stop.expectedDepartureAt)}</p></div></div>
          {stop.lastLocationEvent && <p className="mt-2 text-[9px] text-cyan-100/70">Evento geofence: {stop.lastLocationEvent.type.replaceAll("_", " ")} · {formatDate(stop.lastLocationEvent.occurredAt)} · confidenza {Math.round(stop.lastLocationEvent.confidence * 100)}%</p>}
        </div>;
      })}</div>
    </div>}
  </section>;
}

function MissionCard({ mission, selected, canWrite, onSelect, onDispatch }: { mission: Mission; selected: boolean; canWrite: boolean; onSelect: () => void; onDispatch: () => void }) {
  const tone = statusTone(mission.status);
  const stops = routeStopLabels(mission.payload);
  return <article className={cn("rounded-2xl border p-4 transition", selected ? "border-lime-300/40 bg-lime-300/[.075] shadow-[0_0_28px_rgba(200,255,34,.09)]" : "border-white/[.08] bg-black/20 hover:border-lime-300/25 hover:bg-lime-300/[.03]")}>
    <button className="w-full text-left" onClick={onSelect} type="button">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl border border-current/20 bg-current/10", toneStyles[tone].icon)}><Truck className="size-[18px]" /></span>
          <div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-100">{mission.title}</p><p className="mt-1 truncate font-mono text-[10px] text-slate-600">{mission.jobCode ?? "Missione autonoma"}</p></div>
        </div>
        <ChevronRight className={cn("size-4 shrink-0", selected ? "text-lime-200" : "text-slate-700")} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2"><StatusPill label={statusLabel(mission.status)} tone={tone} /><span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[10px] text-slate-500">{modeLabel(mission.payload.transportMode)}</span></div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl border border-white/[.07] bg-black/25 p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">Partenza</p><p className="mt-1 truncate text-[11px] text-slate-300"><MapPin className="mr-1 inline size-3 text-cyan-200" />{text(mission.payload.pickup)}</p></div>
        <div className="rounded-xl border border-white/[.07] bg-black/25 p-3"><p className="text-[9px] uppercase tracking-[.14em] text-slate-600">Destinazione</p><p className="mt-1 truncate text-[11px] text-slate-300"><MapPin className="mr-1 inline size-3 text-lime-200" />{text(mission.payload.dropoff)}</p></div>
      </div>
      {stops.length > 0 && <div className="mt-3 rounded-xl border border-cyan-300/15 bg-cyan-300/[.03] px-3 py-2"><p className="text-[9px] uppercase tracking-[.14em] text-cyan-200/70">SEQUENZA TAPPE</p><p className="mt-1 line-clamp-2 text-[10px] text-slate-400">{stops.join("  ›  ")}</p></div>}
      <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-600"><span>{formatDate(mission.payload.plannedAt)}</span><span>{snapshotLabel(mission.payload, "driver")}</span><span>{snapshotLabel(mission.payload, "vehicle")}</span></div>
    </button>
    <div className="mt-4 flex flex-wrap gap-2">
      {mission.jobModule === "operations" && <Link className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-[10px] text-slate-400 hover:border-lime-300/25 hover:text-lime-100" href={"/operations/" + encodeURIComponent(mission.jobId)} onClick={(event) => event.stopPropagation()}>Commessa <ArrowRight className="size-3" /></Link>}
      {canWrite && mission.status === "PLANNED" && <Button variant="outline" className="h-9 border-cyan-300/20 bg-cyan-300/[.05] text-[10px] text-cyan-100" onClick={onDispatch}><Send className="size-3.5" />Partenza</Button>}
    </div>
  </article>;
}

type RouteStopsEditorProps = {
  locations: MissionLocation[];
  assetOptions: MissionCargoOption[];
  selectedAssetIds: string[];
  stops: RouteStopDraft[];
  onChange: (next: RouteStopDraft[]) => void;
};

function MaterialStopAssignmentList({
  materialLines,
  stops,
  onChange,
}: { materialLines: MaterialLineDraft[]; stops: RouteStopDraft[]; onChange: (next: RouteStopDraft[]) => void }) {
  if (!materialLines.length) return null;
  return <div className="mt-4 rounded-2xl border border-amber-300/15 bg-amber-300/[.035] p-4">
    <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-amber-200/80">RIGHE MATERIALI · ASSEGNAZIONE PER TAPPA</p>
    <p className="mt-1 text-[10px] leading-5 text-slate-500">Ogni riga viene registrata solo nelle tappe selezionate. Per una consegna standard assegna la riga a una tappa di carico e a una di consegna; per più destinatari puoi assegnare quantità e righe alla tappa corretta.</p>
    <div className="mt-3 space-y-2">{stops.map((stop, stopIndex) => <div className="rounded-xl border border-white/[.08] bg-black/20 p-3" key={`${stopIndex}-${stop.locationId}-${stop.temporaryAddress ?? ""}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold text-slate-200">Tappa {stopIndex + 1} · {stop.kind === "PICKUP" ? "Carico" : stop.kind === "DELIVERY" ? "Consegna" : stop.kind === "RETURN" ? "Rientro" : "Trasferimento"}</p>
        <span className="text-[9px] uppercase tracking-[.12em] text-slate-600">{stop.materialItemIds?.length ?? 0} righe</span>
      </div>
      <div className="mt-2 grid gap-1.5 sm:grid-cols-2">{materialLines.map((line) => {
        const checked = stop.materialItemIds?.includes(line.itemId) ?? false;
        return <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/[.07] px-2.5 py-2 text-[10px] text-slate-300 hover:border-amber-300/25" key={`${stopIndex}-${line.itemId}`}>
          <input checked={checked} className="size-3.5 accent-lime-300" onChange={(event) => onChange(stops.map((candidate, candidateIndex) => {
            if (candidateIndex !== stopIndex) return candidate;
            const nextIds = new Set(candidate.materialItemIds ?? []);
            if (event.target.checked) nextIds.add(line.itemId);
            else nextIds.delete(line.itemId);
            return { ...candidate, materialItemIds: [...nextIds] };
          }))} type="checkbox" />
          <span className="min-w-0 flex-1 truncate">{line.description}</span>
          {checked ? <input aria-label={`Quantità ${line.description} tappa ${stopIndex + 1}`} className="h-7 w-20 shrink-0 rounded-md border border-amber-300/20 bg-black/30 px-2 text-right font-mono text-[9px] text-amber-100 outline-none focus:border-amber-300/50" min="0.001" onChange={(event) => onChange(stops.map((candidate, candidateIndex) => candidateIndex === stopIndex ? { ...candidate, materialQuantities: { ...candidate.materialQuantities, [line.itemId]: event.target.value } } : candidate))} step="0.001" type="number" value={stop.materialQuantities?.[line.itemId] ?? (line.quantity === "—" ? "" : line.quantity)} /> : <span className="shrink-0 font-mono text-[9px] text-amber-100/70">{line.quantity} {line.unit}</span>}
          {checked && <span className="shrink-0 text-[9px] text-slate-600">{line.unit}</span>}
        </label>;
      })}</div>
    </div>)}</div>
  </div>;
}

function defaultAssetIdsForStop(stops: RouteStopDraft[], stopIndex: number, selectedAssetIds: string[]) {
  const firstLoadStopIndex = Math.max(0, stops.findIndex((stop) => ["PICKUP", "TRANSFER"].includes(stop.kind)));
  let lastUnloadStopIndex = stops.length - 1;
  for (let index = stops.length - 1; index >= 0; index -= 1) {
    if (["DELIVERY", "RETURN"].includes(stops[index]?.kind ?? "")) {
      lastUnloadStopIndex = index;
      break;
    }
  }
  const isLoadLeg = ["PICKUP", "TRANSFER"].includes(stops[stopIndex]?.kind ?? "");
  const isUnloadLeg = ["DELIVERY", "RETURN"].includes(stops[stopIndex]?.kind ?? "");
  return (isLoadLeg && stopIndex === firstLoadStopIndex) || (isUnloadLeg && stopIndex === lastUnloadStopIndex) ? selectedAssetIds : [];
}

function AssetStopAssignmentList({
  assetOptions,
  selectedAssetIds,
  stops,
  onChange,
}: { assetOptions: MissionCargoOption[]; selectedAssetIds: string[]; stops: RouteStopDraft[]; onChange: (next: RouteStopDraft[]) => void }) {
  if (!selectedAssetIds.length) return null;
  const optionById = new Map(assetOptions.map((option) => [option.id, option]));
  const updateAsset = (stopIndex: number, assetId: string, checked: boolean) => {
    const initialized = stops.map((candidate, candidateIndex) => ({
      ...candidate,
      cargoAssetIds: candidate.cargoAssetIds ?? defaultAssetIdsForStop(stops, candidateIndex, selectedAssetIds),
    }));
    onChange(initialized.map((candidate, candidateIndex) => {
      if (candidateIndex !== stopIndex) return candidate;
      const nextIds = new Set(candidate.cargoAssetIds ?? []);
      if (checked) nextIds.add(assetId);
      else nextIds.delete(assetId);
      return { ...candidate, cargoAssetIds: [...nextIds] };
    }));
  };
  return <div className="mt-4 rounded-2xl border border-cyan-300/15 bg-cyan-300/[.035] p-4">
    <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-cyan-200/80">ASSET · ASSEGNAZIONE PER TAPPA</p>
    <p className="mt-1 text-[10px] leading-5 text-slate-500">Gli asset selezionati vengono proposti automaticamente al primo carico e all’ultima consegna. Puoi correggere la tappa di carico o scarico per ogni asset.</p>
    <div className="mt-3 space-y-2">{stops.map((stop, stopIndex) => {
      const assigned = stop.cargoAssetIds ?? defaultAssetIdsForStop(stops, stopIndex, selectedAssetIds);
      return <div className="rounded-xl border border-white/[.08] bg-black/20 p-3" key={`${stopIndex}-${stop.locationId}-${stop.temporaryAddress ?? ""}`}>
        <div className="flex items-center justify-between gap-2"><p className="text-[10px] font-semibold text-slate-200">Tappa {stopIndex + 1} · {stop.kind === "PICKUP" ? "Carico" : stop.kind === "DELIVERY" ? "Consegna" : stop.kind === "RETURN" ? "Rientro" : "Trasferimento"}</p><span className="text-[9px] uppercase tracking-[.12em] text-slate-600">{assigned.filter((assetId) => selectedAssetIds.includes(assetId)).length} asset</span></div>
        <div className="mt-2 grid gap-1.5 sm:grid-cols-2">{selectedAssetIds.map((assetId) => {
          const option = optionById.get(assetId);
          const checked = assigned.includes(assetId);
          return <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-white/[.07] px-2.5 py-2 text-[10px] text-slate-300 hover:border-cyan-300/25" key={`${stopIndex}-${assetId}`}><input aria-label={`Asset ${option ? cargoOptionLabel(option) : assetId} tappa ${stopIndex + 1}`} checked={checked} className="mt-0.5 size-3.5 accent-lime-300" onChange={(event) => updateAsset(stopIndex, assetId, event.target.checked)} type="checkbox" /><span className="min-w-0 flex-1"><span className="block truncate font-semibold text-slate-200">{option ? cargoOptionLabel(option) : `Asset ${assetId}`}</span><span className="mt-0.5 block font-mono text-[9px] text-slate-600">{assetId}</span></span></label>;
        })}</div>
      </div>;
    })}</div>
  </div>;
}

function RouteStopsEditor({
  locations,
  assetOptions,
  selectedAssetIds,
  stops,
  onChange,
}: RouteStopsEditorProps) {
  const [temporaryCandidates, setTemporaryCandidates] = useState<Record<number, GeocodeCandidate[]>>({});
  const [temporaryBusyIndex, setTemporaryBusyIndex] = useState<number | null>(null);
  const eligibleLocations = locations.filter((location) => location.geofence?.status === "ACTIVE");
  const materialLines = stops.find((stop) => (stop.materialLines?.length ?? 0) > 0)?.materialLines ?? [];
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
  if (materialLines.length) {
    const canonicalLabel = (stop: RouteStopDraft | undefined, fallback: string) => {
      if (!stop) return fallback;
      if (stop.temporaryLocation?.formattedAddress) return stop.temporaryLocation.formattedAddress;
      return locations.find((location) => location.id === stop.locationId)?.formattedAddress ?? fallback;
    };
    return <section className="rounded-2xl border border-lime-300/20 bg-lime-300/[.035] p-4 sm:col-span-2">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-lime-300/25 bg-lime-300/10 text-lime-200"><ShieldCheck className="size-5" /></span>
        <div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-200/75">TRATTA VINCOLATA DAL SERVER</p><h3 className="mt-1 text-sm font-semibold text-slate-100">Deposito → commessa</h3><p className="mt-1 text-[10px] leading-5 text-slate-500">Origine, destinazione e righe derivano dalla richiesta approvata. Non possono essere sostituite nel dispositivo.</p></div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl border border-cyan-300/15 bg-black/25 p-3"><p className="text-[9px] uppercase tracking-[.14em] text-cyan-200/70">1 · CARICO</p><p className="mt-2 text-[11px] leading-5 text-slate-200"><MapPin className="mr-1.5 inline size-3.5 text-cyan-200" />{canonicalLabel(stops[0], "Deposito approvato")}</p></div>
        <div className="rounded-xl border border-lime-300/15 bg-black/25 p-3"><p className="text-[9px] uppercase tracking-[.14em] text-lime-200/70">2 · CONSEGNA</p><p className="mt-2 text-[11px] leading-5 text-slate-200"><MapPin className="mr-1.5 inline size-3.5 text-lime-200" />{canonicalLabel(stops.at(-1), "Cantiere della commessa")}</p></div>
      </div>
      <div className="mt-3 rounded-xl border border-amber-300/15 bg-black/20 p-3"><p className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[.14em] text-amber-200/75"><Package className="size-3.5" />CARICO PRENOTATO</p><div className="mt-2 grid gap-1.5 sm:grid-cols-2">{materialLines.map((line) => <div className="flex items-center justify-between gap-3 rounded-lg border border-white/[.06] px-2.5 py-2" key={line.itemId}><span className="min-w-0 truncate text-[10px] text-slate-300">{line.description}</span><span className="shrink-0 font-mono text-[9px] text-amber-100">{line.quantity} {line.unit}</span></div>)}</div></div>
    </section>;
  }
  return <section className="rounded-2xl border border-cyan-300/15 bg-cyan-300/[.03] p-4 sm:col-span-2">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-cyan-200/70">ROTA OPERATIVA</p>
        <h3 className="mt-1 text-sm font-semibold text-slate-100">Tappe e agganci operativi</h3>
        <p className="mt-1 max-w-2xl text-[10px] leading-5 text-slate-500">Ogni tappa può usare una location aziendale oppure un indirizzo temporaneo. Il server verifica l’indirizzo, crea una geofence solo per questa missione e non lo aggiunge alla rubrica canonica.</p>
      </div>
      <button className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-cyan-300/25 bg-cyan-300/[.05] px-3 py-2 text-[10px] font-semibold text-cyan-100 hover:bg-cyan-300/[.1]" onClick={() => onChange([...stops, { kind: "TRANSFER", locationId: "", materialLines }])} type="button">+ Aggiungi tappa</button>
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
            {stop.temporaryLocation ? <div className="flex items-start gap-2 rounded-lg border border-lime-300/20 bg-lime-300/[.05] p-3"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-lime-200" /><div className="min-w-0"><p className="text-[10px] font-semibold text-lime-100">Indirizzo verificato dal server</p><p className="mt-1 text-[11px] text-slate-300">{stop.temporaryLocation.formattedAddress}</p><p className="mt-1 text-[9px] uppercase tracking-[.12em] text-lime-200/60">GEOAPIFY · GEOFENCE TEMPORANEA · {stop.kind === "DELIVERY" ? "60" : "80"} M</p></div></div> : candidates.length > 0 ? <div className="space-y-1.5 rounded-lg border border-cyan-300/15 bg-cyan-300/[.03] p-2"><p className="px-1 text-[9px] uppercase tracking-[.14em] text-cyan-200/70">Scegli il risultato riconosciuto</p>{candidates.map((candidate) => <button className="flex w-full items-start gap-2 rounded-lg border border-white/[.06] px-2 py-2 text-left hover:border-cyan-300/30 hover:bg-cyan-300/[.06]" key={candidate.providerPlaceId} onClick={() => onSelectTemporary(index, candidate)} type="button"><MapPin className="mt-0.5 size-3.5 shrink-0 text-cyan-200" /><span className="min-w-0"><span className="block truncate text-[10px] text-slate-200">{candidate.formattedAddress}</span><span className="mt-0.5 block text-[9px] text-slate-600">{candidate.city}{candidate.province ? ` · ${candidate.province}` : ""}</span></span></button>)}</div> : <p className="rounded-lg border border-dashed border-cyan-300/15 px-3 py-2 text-[10px] text-slate-600">Verifica l’indirizzo e seleziona il risultato server-side prima di salvare.</p>}
          </div>}
        </div>;
      })}
      <MaterialStopAssignmentList materialLines={materialLines} onChange={onChange} stops={stops} />
      <AssetStopAssignmentList assetOptions={assetOptions} onChange={onChange} selectedAssetIds={selectedAssetIds} stops={stops} />
      {stops.length === 0 && <p className="rounded-xl border border-dashed border-cyan-300/15 p-4 text-center text-[10px] text-slate-600">Aggiungi almeno una tappa di carico e una di consegna.</p>}
    </div>
    {eligibleLocations.length === 0 && <p className="mt-3 rounded-xl border border-amber-300/15 bg-amber-300/[.03] p-3 text-[10px] text-amber-100">Non ci sono location canoniche con geofence disponibili. Puoi comunque usare indirizzi temporanei verificati dal server.</p>}
  </section>;
}

export default function MissionCommandDeck() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const handoffPlanId = searchParams.get("planId") ?? "";
  const handoffJobId = searchParams.get("jobId") ?? "";
  const openMissionId = searchParams.get("missionId") ?? "";
  const requestedMaterialRequestId = searchParams.get("requestId") ?? "";
  const createRequested = searchParams.get("create") === "1";
  const createFromJobHandled = useRef("");
  const createFromRequestHandled = useRef("");
  const [payload, setPayload] = useState<MissionPayload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "forbidden" | "error">("loading");
  const [refreshing, setRefreshing] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [attentionFilter, setAttentionFilter] = useState<MissionAttentionFilter>("ALL");
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [plannedAt, setPlannedAt] = useState("");
  const [plannedEndAt, setPlannedEndAt] = useState("");
  const [driverId, setDriverId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [cargoAssetId, setCargoAssetId] = useState("");
  const [cargoAssetIds, setCargoAssetIds] = useState<string[]>([]);
  const [cargoOptions, setCargoOptions] = useState<MissionCargoOption[]>([]);
  const [transportMode, setTransportMode] = useState<TransportMode | "">("");
  const [selectedRequestId, setSelectedRequestId] = useState("");
  const [deliveryStopId, setDeliveryStopId] = useState("");
  const [missionReportText, setMissionReportText] = useState("");
  const [missionReportQuestions, setMissionReportQuestions] = useState<string[]>([]);
  const [reviewNote, setReviewNote] = useState("");
  const [routeStops, setRouteStops] = useState<RouteStopDraft[]>([]);
  const [actionStopId, setActionStopId] = useState("");
  const [actionNote, setActionNote] = useState("");
  const [exceptionType, setExceptionType] = useState<MissionExceptionType>("DELAYED");
  const [exceptionStopId, setExceptionStopId] = useState("");
  const [exceptionModalOpen, setExceptionModalOpen] = useState(false);
  const [planningHandoff, setPlanningHandoff] = useState<PlanningHandoff | null>(null);
  const [planningHandoffState, setPlanningHandoffState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [createJobId, setCreateJobId] = useState("");
  const [missionTitle, setMissionTitle] = useState("Missione di trasporto");
  const [activePlanningPlanId, setActivePlanningPlanId] = useState("");

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
      setSelectedId((current) => current && next.missions.some((mission) => mission.id === current)
        ? current
        : openMissionId && next.missions.some((mission) => mission.id === openMissionId)
          ? openMissionId
          : next.missions[0]?.id ?? "");
      setState("ready");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Mission control non disponibile.");
      setState((current) => current === "ready" ? current : "error");
    } finally {
      setRefreshing(false);
    }
  }, [notify, openMissionId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!handoffPlanId || !handoffJobId) {
      return;
    }
    if (planningHandoff?.id === handoffPlanId && planningHandoffState === "ready") return;
    let active = true;
    void fetch(`/api/operations/jobs/${encodeURIComponent(handoffJobId)}/planning`, { cache: "no-store" })
      .then(async (response) => {
        const next = await response.json() as { plans?: Array<Record<string, unknown>>; error?: string };
        if (!response.ok) throw new Error(next.error ?? "planning_handoff_unavailable");
        const raw = next.plans?.find((plan) => text(plan.id, "") === handoffPlanId);
        const planPayload = raw?.payload && typeof raw.payload === "object" && !Array.isArray(raw.payload) ? raw.payload as Record<string, unknown> : {};
        if (!raw || text(raw.status, "") !== "PUBLISHED" || text(planPayload.activityType, "").toUpperCase() !== "TRANSPORT") {
          throw new Error("published_transport_plan_required");
        }
        if (!active) return;
        const handoff: PlanningHandoff = {
          id: handoffPlanId,
          jobId: handoffJobId,
          title: text(raw.title, "Piano trasporto"),
          status: text(raw.status, "PUBLISHED"),
          version: typeof raw.version === "number" ? raw.version : 1,
          startsAt: typeof raw.startsAt === "string" ? raw.startsAt : null,
          endsAt: typeof raw.endsAt === "string" ? raw.endsAt : null,
          location: typeof raw.location === "string" ? raw.location : null,
          payload: planPayload,
        };
        setPlanningHandoff(handoff);
        setPlanningHandoffState("ready");
        window.setTimeout(() => {
          if (!active) return;
          openCreate(null, handoff);
          notify("Piano trasporto caricato: risorse e finestra sono precompilate e verranno riletti dal server.");
        }, 0);
      })
      .catch(() => {
        if (!active) return;
        setPlanningHandoff(null);
        setPlanningHandoffState("error");
      });
    return () => { active = false; };
  // The handoff effect intentionally runs only when the URL contract changes; openCreate is the local form hydrator.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoffJobId, handoffPlanId, notify, planningHandoff]);

  const context = payload?.context;
  const capabilities = useMemo(() => context?.capabilities ?? ["mission.read"], [context]);
  const allowedNavigation = useMemo(() => getAllowedCommandNavigation(capabilities).map((item) => item.id), [capabilities]);
  const visibleNavItems = useMemo(() => navItems.filter((item) => allowedNavigation.includes(item.id) || capabilities.includes(item.capability)), [allowedNavigation, capabilities]);
  const missions = useMemo(() => (payload?.missions ?? []).map((mission) => ({ ...mission, viewerCanManage: capabilities.includes("mission.manage") })), [capabilities, payload?.missions]);
  const jobs = useMemo(() => payload?.jobs ?? [], [payload?.jobs]);
  const materialRequests = useMemo(() => payload?.materialRequests ?? [], [payload?.materialRequests]);
  const locations = useMemo(() => payload?.locations ?? [], [payload?.locations]);
  const schedulableRequests = useMemo(() => materialRequests.filter((request) => request.status === "APPROVED" && !request.scheduledMissionId), [materialRequests]);
  const selectedRequest = materialRequests.find((request) => request.id === selectedRequestId) ?? null;

  const filteredMissions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return missions.filter((mission) => {
      const haystack = [mission.id, mission.jobId, mission.jobCode, mission.jobTitle, mission.title, mission.status, mission.payload.pickup, mission.payload.dropoff, mission.payload.transportMode, snapshotLabel(mission.payload, "driver"), snapshotLabel(mission.payload, "vehicle")].join(" ").toLowerCase();
      return (!normalized || haystack.includes(normalized)) && (statusFilter === "ALL" || mission.status === statusFilter) && missionNeedsAttention(mission, attentionFilter);
    });
  }, [attentionFilter, missions, query, statusFilter]);
  const selected = filteredMissions.find((mission) => mission.id === selectedId) ?? filteredMissions[0] ?? null;
  const canManageMission = capabilities.includes("mission.manage");
  const canDispatchMission = canManageMission || (capabilities.includes("mission.execute") && capabilities.includes("mission.delivery.execute"));
  const canRecordDeliveryAction = capabilities.includes("mission.delivery.execute");
  const canWriteMissionReport = canManageMission || capabilities.includes("mission.report.write");
  const canReviewMissionReport = capabilities.includes("mission.report.review");
  const selectedStops = useMemo(() => selected ? routeStopViews(selected.payload) : [], [selected]);
  const selectedTracking = useMemo(() => selected ? missionTrackingReadback(selected.payload) : null, [selected]);
  const selectedTimeline = useMemo(() => selected ? operationalTimeline(selected.payload) : [], [selected]);
  const selectedManifestTimeline = useMemo(() => selected ? operationalTimeline(selected.payload, 50) : [], [selected]);
  const selectedReport = useMemo(() => selected ? missionReport(selected.payload) : null, [selected]);
  const canEditMissionReport = canWriteMissionReport && selectedReport?.status !== "SUBMITTED";
  const routeCurrentStop = useMemo(() => currentRouteStopView(selectedStops), [selectedStops]);
  const serverCurrentStopId = routeCurrentStop?.id ?? text(selectedTracking?.currentStopId, "");
  const activeActionStopId = serverCurrentStopId || (selectedStops.some((stop) => stop.id === actionStopId) ? actionStopId : selectedStops[0]?.id ?? "");
  const enabledTransportModes = context?.operatingTransportModes ?? [];
  const actor = { email: context?.actorEmail ?? "operator@zerow.local", name: context?.actorName ?? "Operatore" };
  const counts = useMemo(() => ({
    verified: missions.filter((mission) => mission.status === "POD_VERIFIED").length,
    reconciled: missions.filter((mission) => mission.status === "RECONCILED").length,
    closed: missions.filter((mission) => mission.status === "CLOSED").length,
    toSchedule: schedulableRequests.length,
  }), [missions, schedulableRequests.length]);
  const attentionCounts = useMemo(() => ({
    reportReview: missions.filter((mission) => missionNeedsAttention(mission, "REPORT_REVIEW")).length,
    reportChanges: missions.filter((mission) => missionNeedsAttention(mission, "REPORT_CHANGES")).length,
    reportPending: missions.filter((mission) => missionNeedsAttention(mission, "REPORT_PENDING")).length,
    tracking: missions.filter((mission) => missionNeedsAttention(mission, "TRACKING")).length,
    warehouse: missions.filter((mission) => missionNeedsAttention(mission, "WAREHOUSE")).length,
    exception: missions.filter((mission) => missionNeedsAttention(mission, "EXCEPTION")).length,
  }), [missions]);

  function navigate(path: string) {
    setMobileMenu(false);
    router.push(path);
  }

  function goBack() {
    if (window.history.length > 1) router.back();
    else router.push("/command");
  }

  function handleJobSelection(jobId: string) {
    if (selectedRequestId) {
      notify("La commessa è vincolata alla richiesta materiali approvata dal server.");
      return;
    }
    setCreateJobId(jobId);
    setSelectedRequestId("");
    if (!jobId || jobId === "__standalone__") {
      setRouteStops([{ kind: "PICKUP", locationId: "" }, { kind: "DELIVERY", locationId: "" }]);
      if (transportMode === "WAREHOUSE_TO_JOB") setTransportMode(enabledTransportModes.includes("ASSET_TRANSFER") ? "ASSET_TRANSFER" : enabledTransportModes[0] ?? "");
      return;
    }
    const jobLocationId = locations.find((location) => location.entityId === jobId && ["CANTIERE", "COMMESSA"].includes(location.entityType))?.id ?? "";
    setRouteStops([{ kind: "PICKUP", locationId: "" }, { kind: "DELIVERY", locationId: jobLocationId }]);
  }

  function openCreate(request: MaterialRequest | null = null, handoff: PlanningHandoff | null = null, jobOverride = "") {
    if (request && !enabledTransportModes.includes("WAREHOUSE_TO_JOB")) {
      notify("La consegna magazzino → commessa non è abilitata nel profilo operativo aziendale.");
      return;
    }
    const planResources = Array.isArray(handoff?.payload.resources)
      ? handoff.payload.resources.flatMap((resource) => resource && typeof resource === "object" && !Array.isArray(resource) ? [resource as Record<string, unknown>] : [])
      : [];
    const plannedDriverId = planResources.find((resource) => text(resource.kind, "").toLowerCase() === "person")?.id;
    const plannedVehicleId = planResources.find((resource) => text(resource.kind, "").toLowerCase() === "vehicle")?.id;
    const plannedCargoAssetIds = planResources
      .filter((resource) => ["asset", "cargo"].includes(text(resource.kind, "").toLowerCase()))
      .map((resource) => text(resource.id, ""))
      .filter(Boolean);
    const planMode = text(handoff?.payload.transportMode, "") as TransportMode;
    const defaultMode = enabledTransportModes.includes(planMode)
      ? planMode
      : request?.jobId
        ? "WAREHOUSE_TO_JOB"
        : plannedCargoAssetIds.length && enabledTransportModes.includes("ASSET_TRANSFER")
          ? "ASSET_TRANSFER"
          : enabledTransportModes[0] ?? "";
    const targetJobId = request?.jobId ?? handoff?.jobId ?? jobOverride;
    setCreateJobId(targetJobId);
    setActivePlanningPlanId(handoff?.id ?? "");
    setMissionTitle(handoff?.title ? `Missione · ${handoff.title}` : request?.title ? `Consegna · ${request.title}` : "Missione di trasporto");
    setPlannedAt(dateTimeLocalValue(handoff?.startsAt));
    setPlannedEndAt(dateTimeLocalValue(handoff?.endsAt));
    setDriverId(plannedDriverId ? text(plannedDriverId, "") : "");
    setVehicleId(plannedVehicleId ? text(plannedVehicleId, "") : "");
    setCargoAssetId(plannedCargoAssetIds.join(","));
    setCargoAssetIds(plannedCargoAssetIds);
    setCargoOptions([]);
    setSelectedRequestId(request?.id ?? "");
    setTransportMode(defaultMode);
    const requestWarehouse = request?.payload.warehouse;
    const warehouseLocationId = requestWarehouse && typeof requestWarehouse === "object" && !Array.isArray(requestWarehouse)
      ? locations.find((location) => location.entityType === "MAGAZZINO" && location.entityId === String((requestWarehouse as Record<string, unknown>).id ?? ""))?.id ?? ""
      : "";
    const jobLocationId = targetJobId
      ? locations.find((location) => location.entityId === targetJobId && ["CANTIERE", "COMMESSA"].includes(location.entityType))?.id ?? ""
      : "";
    const materialLines = materialRequestLineDrafts(request);
    const materialItemIds = materialLines.map((line) => line.itemId);
    setRouteStops([{ kind: "PICKUP", locationId: warehouseLocationId, materialLines, materialItemIds }, { kind: "DELIVERY", locationId: jobLocationId, materialLines, materialItemIds }]);
    setModal("create");
  }

  useEffect(() => {
    if (!createRequested || !handoffJobId || handoffPlanId || state !== "ready") return;
    const requestIdentity = `job:${handoffJobId}`;
    if (createFromJobHandled.current === requestIdentity) return;
    createFromJobHandled.current = requestIdentity;
    if (!jobs.some((job) => job.id === handoffJobId)) {
      const missingTimer = window.setTimeout(() => notify("La commessa non è disponibile nel perimetro Missioni corrente."), 0);
      return () => window.clearTimeout(missingTimer);
    }
    const timer = window.setTimeout(() => {
      openCreate(null, null, handoffJobId);
      notify("Commessa collegata: completa tappe, carichi e risorse usando i cataloghi verificati dal server.");
    }, 0);
    return () => window.clearTimeout(timer);
  // L’apertura guidata dipende dal contratto URL; openCreate idrata il form con i cataloghi già riletti.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createRequested, handoffJobId, handoffPlanId, jobs, notify, state]);

  useEffect(() => {
    if (!requestedMaterialRequestId || state !== "ready") return;
    if (createFromRequestHandled.current === requestedMaterialRequestId) return;
    createFromRequestHandled.current = requestedMaterialRequestId;
    const timer = window.setTimeout(() => {
      const request = materialRequests.find((candidate) => candidate.id === requestedMaterialRequestId);
      if (!request) {
        notify("La richiesta approvata non è disponibile nel perimetro Missioni corrente.");
        router.replace("/mission", { scroll: false });
        return;
      }
      if (request.scheduledMissionId) {
        setQuery("");
        setStatusFilter("ALL");
        setAttentionFilter("ALL");
        setSelectedId(request.scheduledMissionId);
        notify("La richiesta è già collegata a una missione: ho aperto il record esistente.");
        router.replace(`/mission?missionId=${encodeURIComponent(request.scheduledMissionId)}`, { scroll: false });
        return;
      }
      if (request.status !== "APPROVED") {
        notify("La richiesta deve essere approvata e prenotata dal magazzino prima della programmazione.");
        router.replace("/mission", { scroll: false });
        return;
      }
      openCreate(request);
      notify("Richiesta riletta dal server: deposito, commessa e materiali sono già collegati.");
      router.replace("/mission", { scroll: false });
    }, 0);
    return () => window.clearTimeout(timer);
  // L’apertura da magazzino dipende dal contratto URL e dai record riletti dal server.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materialRequests, notify, requestedMaterialRequestId, router, state]);

  function openMissionReport() {
    const readback = selected ? missionReport(selected.payload) : null;
    setMissionReportText(readback?.draft ?? "");
    setMissionReportQuestions(readback?.completeness.questions ?? []);
    setReviewNote(readback?.review.note ?? "");
    setModal("report");
  }

  const mutateJourney = useCallback(async (mission: Mission, action: string, body: Record<string, unknown> = {}) => {
    if (action === "mission_deliver" && typeof body.recipient !== "string") {
      setDeliveryStopId(typeof body.stopId === "string" ? body.stopId : activeActionStopId);
      setModal("delivery");
      return;
    }
    if (action === "mission_exception") {
      setExceptionType("DELAYED");
      setExceptionStopId(typeof body.stopId === "string" ? body.stopId : activeActionStopId);
      setExceptionModalOpen(true);
      return;
    }
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
        const detailed = result as { error?: string; message?: string; questions?: unknown };
        if (Array.isArray(detailed.questions)) setMissionReportQuestions(detailed.questions.filter((question): question is string => typeof question === "string"));
        notify(result.error === "version_conflict" ? "La missione è cambiata: readback aggiornato." : detailed.message ?? "Operazione non eseguita: " + (result.error ?? "errore"));
        return;
      }
      setMissionReportQuestions([]);
      await refresh();
      setModal(null);
      setExceptionModalOpen(false);
      notify("Journey aggiornata e riletta dal ledger.");
    } catch {
      notify("Connessione non disponibile: nessuna modifica confermata.");
    } finally {
      setBusy(false);
    }
  }, [activeActionStopId, notify, refresh]);

  const createMission = useCallback(async (jobId: string, body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const standalone = jobId === "__standalone__";
      const hasMaterialRequest = typeof body.materialRequestId === "string" && body.materialRequestId.trim().length > 0;
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
      const result = await response.json() as MissionCreateResponse;
      if (!response.ok) {
        if (response.status === 409) await refresh();
        const errorLabels: Record<string, string> = {
          planning_plan_already_linked: "questo piano è già collegato a una missione",
          mission_plan_resource_mismatch: "autista, mezzo o asset non corrispondono al piano pubblicato",
          mission_window_outside_planning_plan: "la finestra missione esce da quella pubblicata",
          published_transport_plan_required: "serve un piano trasporto pubblicato",
          material_request_already_scheduled: "la richiesta è già collegata a una missione",
          approved_material_request_required: "la richiesta materiali non risulta approvata",
          material_request_requires_warehouse_to_job: "una richiesta materiali approvata deve viaggiare dal deposito alla commessa collegata",
          mission_resource_conflict: "una delle risorse è già occupata nella finestra scelta",
          vehicle_assigned_to_other_driver: "il mezzo è affidato a un’altra persona; verifica con l’autista custode oppure usa la modalità prova senza prenotare",
          vehicle_transport_capability_missing: "il mezzo non è abilitato a trasportare questo tipo di carico",
          vehicle_capacity_exceeded: "il peso del carico supera la portata utile censita del mezzo",
          cargo_asset_not_transportable: "un elemento selezionato non è configurato come carico trasportabile",
          vehicle_transport_profile_required: "la risorsa non è configurata come mezzo di trasporto: correggi la tipologia nella scheda Asset",
          mission_driver_and_vehicle_required: "seleziona un autista e un mezzo disponibili",
          material_request_link_unavailable: "il collegamento tra richiesta e missione non è stato confermato dal registro",
        };
        notify("Missione non creata: " + (result.message ?? errorLabels[result.error ?? ""] ?? result.error ?? "errore"));
        return;
      }
      const createdMissionId = result.mutation?.record?.id ?? result.record?.id ?? result.missionId ?? "";
      if (!createdMissionId || result.readback?.status !== "verified") {
        notify("La missione è stata ricevuta, ma il readback server non è completo. Aggiorna il registro prima di procedere.");
        await refresh();
        return;
      }
      setQuery("");
      setStatusFilter("ALL");
      setAttentionFilter("ALL");
      setSelectedId(createdMissionId);
      await refresh();
      setSelectedId(createdMissionId);
      setModal(null);
      router.replace(`/mission?missionId=${encodeURIComponent(createdMissionId)}`, { scroll: false });
      notify(hasMaterialRequest
        ? "Missione creata, richiesta collegata e readback verificato. È pronta per il prelievo in magazzino."
        : "Missione creata e riletta dal registro server-side.");
    } catch {
      notify("Connessione non disponibile: nessuna missione modificata.");
    } finally {
      setBusy(false);
    }
  }, [notify, refresh, router]);

  async function submitException(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    await mutateJourney(selected, "mission_exception", {
      exceptionType,
      stopId: exceptionStopId,
      reference: field(form, "exceptionReference"),
      note: field(form, "exceptionNote"),
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (modal === "create" && field(form, "simulationOnly") === "1") {
      notify("Modalità prova attiva: nessuna missione creata. Disattivala solo quando vuoi pianificare davvero.");
      return;
    }
    if (modal === "create") {
      const jobId = selectedRequest?.jobId || createJobId || field(form, "jobId") || "";
      const mode = selectedRequest ? "WAREHOUSE_TO_JOB" : field(form, "transportMode") as TransportMode;
      const selectedCargoAssetIds = [...new Set([
        ...cargoAssetIds,
        ...cargoAssetId.split(",").map((value) => value.trim()).filter(Boolean),
      ])];
      const selectedCargo = selectedCargoAssetIds[0] ?? "";
      const materialRequestId = field(form, "materialRequestId") || selectedRequestId;
      const requestWarehouse = selectedRequest?.payload.warehouse;
      const requestPickup = requestWarehouse && typeof requestWarehouse === "object" && !Array.isArray(requestWarehouse)
        ? text((requestWarehouse as Record<string, unknown>).locationLabel, "")
        : "";
      const routeStopLabel = (stop: RouteStopDraft | undefined) => stop?.temporaryLocation?.formattedAddress ?? locations.find((location) => location.id === stop?.locationId)?.formattedAddress ?? "";
      const pickup = field(form, "pickup") || routeStopLabel(routeStops[0]) || requestPickup;
      const dropoff = field(form, "dropoff") || routeStopLabel(routeStops.at(-1)) || text(selectedRequest?.payload.deliveryPoint, "");
      const requestMaterialLineActions = Array.isArray(selectedRequest?.payload.lines)
        ? selectedRequest.payload.lines.flatMap((line) => {
          if (!line || typeof line !== "object" || Array.isArray(line)) return [];
          const value = line as Record<string, unknown>;
          const itemId = text(value.itemId, "");
          if (!itemId) return [];
          return [{
            itemId,
            quantity: typeof value.quantity === "number" || typeof value.quantity === "string" ? value.quantity : null,
            materialRequestId: materialRequestId || null,
          }];
        })
        : [];
      const firstLoadStopIndex = Math.max(0, routeStops.findIndex((stop) => ["PICKUP", "TRANSFER"].includes(stop.kind)));
      const lastUnloadStopIndex = (() => {
        for (let index = routeStops.length - 1; index >= 0; index -= 1) {
          if (["DELIVERY", "RETURN"].includes(routeStops[index]?.kind ?? "")) return index;
        }
        return Math.max(0, routeStops.length - 1);
      })();
      const hasExplicitMaterialAssignments = routeStops.some((stop) => Array.isArray(stop.materialItemIds));
      const hasExplicitAssetAssignments = routeStops.some((stop) => Array.isArray(stop.cargoAssetIds));
      const cargoActionsForStop = (action: string, stopIndex: number) => {
        const isLoadLeg = action === "LOAD" || action === "TRANSFER";
        const isUnloadLeg = action === "UNLOAD" || action === "RETURN";
        const defaultMaterialLeg = (isLoadLeg && stopIndex === firstLoadStopIndex) || (isUnloadLeg && stopIndex === lastUnloadStopIndex);
        const selectedItemIds = new Set(hasExplicitMaterialAssignments
          ? routeStops[stopIndex]?.materialItemIds ?? []
          : defaultMaterialLeg ? requestMaterialLineActions.map((line) => line.itemId) : []);
        const actions: Array<Record<string, unknown>> = requestMaterialLineActions
          .filter((line) => selectedItemIds.has(line.itemId))
          .map((line) => ({ action, ...line, quantity: routeStops[stopIndex]?.materialQuantities?.[line.itemId] || line.quantity, assetId: null }));
        const defaultAssetLeg = (isLoadLeg && stopIndex === firstLoadStopIndex) || (isUnloadLeg && stopIndex === lastUnloadStopIndex);
        const selectedAssetIdsForStop = hasExplicitAssetAssignments
          ? (routeStops[stopIndex]?.cargoAssetIds ?? []).filter((assetId) => selectedCargoAssetIds.includes(assetId))
          : defaultAssetLeg ? selectedCargoAssetIds : [];
        for (const assetId of selectedAssetIdsForStop) actions.push({ action, materialRequestId: null, assetId });
        if (!actions.length) actions.push({ action, materialRequestId: null, assetId: null });
        return actions;
      };
      const selectedRouteStops = routeStops.map((stop, stopIndex) => {
        const location = locations.find((candidate) => candidate.id === stop.locationId);
        const temporary = stop.temporaryLocation;
        const action = stop.kind === "DELIVERY" || stop.kind === "RETURN" ? "UNLOAD" : stop.kind === "TRANSFER" ? "TRANSFER" : "LOAD";
        return {
          kind: stop.kind,
          locationId: temporary ? "" : stop.locationId,
          label: temporary?.formattedAddress ?? location?.formattedAddress ?? "",
          entityType: temporary ? "CUSTOM_LOCATION" : location?.entityType ?? "",
          entityId: temporary ? "" : location?.entityId ?? "",
          ...(temporary ? { temporaryAddress: stop.temporaryAddress || temporary.formattedAddress, temporaryLocation: temporary } : {}),
          cargoActions: cargoActionsForStop(action, stopIndex),
        };
      });
      if (mode === "WAREHOUSE_TO_JOB" && materialRequestId && selectedRequest && !requestMaterialLineActions.length) {
        notify("La richiesta materiali selezionata non contiene righe riconciliabili con il registro del magazzino.");
        return;
      }
      if (mode === "WAREHOUSE_TO_JOB" && hasExplicitMaterialAssignments && requestMaterialLineActions.length) {
        const itemIdsForActions = (allowedActions: string[]) => new Set(selectedRouteStops.flatMap((stop) => stop.cargoActions.flatMap((entry) => {
          const itemId = text(entry.itemId, "");
          return itemId && allowedActions.includes(text(entry.action, "").toUpperCase()) ? [itemId] : [];
        })));
        const loadedItemIds = itemIdsForActions(["LOAD", "TRANSFER"]);
        const unloadedItemIds = itemIdsForActions(["UNLOAD", "RETURN", "TRANSFER"]);
        const missingLoad = requestMaterialLineActions.filter((line) => !loadedItemIds.has(line.itemId));
        const missingUnload = requestMaterialLineActions.filter((line) => !unloadedItemIds.has(line.itemId));
        if (missingLoad.length || missingUnload.length) {
          notify(`Assegna ogni riga a una tappa di carico e a una di consegna. Mancano: ${[...new Set([...missingLoad, ...missingUnload].map((line) => line.itemId))].join(", ")}`);
          return;
        }
      }
      if (selectedCargoAssetIds.length) {
        const assetIdsForActions = (allowedActions: string[]) => new Set(selectedRouteStops.flatMap((stop) => stop.cargoActions.flatMap((entry) => {
          const assetId = text(entry.assetId, "");
          return assetId && allowedActions.includes(text(entry.action, "").toUpperCase()) ? [assetId] : [];
        })));
        const loadedAssetIds = assetIdsForActions(["LOAD", "TRANSFER"]);
        const unloadedAssetIds = assetIdsForActions(["UNLOAD", "RETURN", "TRANSFER"]);
        const missingLoad = selectedCargoAssetIds.filter((assetId) => !loadedAssetIds.has(assetId));
        const missingUnload = selectedCargoAssetIds.filter((assetId) => !unloadedAssetIds.has(assetId));
        if (missingLoad.length || missingUnload.length) {
          notify(`Assegna ogni asset a una tappa di carico e a una di scarico. Mancano: ${[...new Set([...missingLoad, ...missingUnload])].join(", ")}`);
          return;
        }
      }
      if (!jobId || !field(form, "driverId") || !field(form, "vehicleId")) {
        notify("Seleziona il collegamento, un autista e un mezzo dal registro disponibile.");
        return;
      }
      if (mode === "ASSET_TRANSFER" && !selectedCargoAssetIds.length) {
        notify("Per un trasferimento asset devi selezionare almeno un asset reale da consegnare.");
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
        title: field(form, "title") || missionTitle,
        pickup,
        dropoff,
        plannedAt: field(form, "plannedAt"),
        plannedEndAt: field(form, "plannedEndAt"),
        driverId: field(form, "driverId"),
        vehicleId: field(form, "vehicleId"),
        cargoAssetId: selectedCargo,
        cargoAssetIds: selectedCargoAssetIds,
        transportMode: mode,
        planningPlanId: activePlanningPlanId || undefined,
        materialRequestId,
        routeStops: selectedRouteStops,
        notes: field(form, "notes"),
      });
      return;
    }
    if (!selected) return;
    if (modal === "delivery") {
      const documentId = field(form, "documentId");
      await mutateJourney(selected, "mission_deliver", {
        recipient: field(form, "recipient"),
        stopId: deliveryStopId,
        sequence: selectedStops.find((stop) => stop.id === deliveryStopId)?.sequence ?? null,
        evidenceType: field(form, "evidenceType") || (documentId ? "DELIVERY_PHOTO" : "AUTHORIZED_DRIVER_CONFIRMATION"),
        evidenceReference: field(form, "evidenceReference"),
        documentId,
        assetId: text(selected.payload.cargoAssetId, ""),
        assetIds: Array.isArray(selectedStops.find((stop) => stop.id === deliveryStopId)?.cargoManifest)
          ? selectedStops.find((stop) => stop.id === deliveryStopId)?.cargoManifest.flatMap((entry) => entry.assetId ? [entry.assetId] : [])
          : [],
        note: field(form, "note"),
      });
    }
    if (modal === "pod") {
      const documentId = field(form, "documentId");
      await mutateJourney(selected, "mission_verify_pod", {
        evidenceType: field(form, "evidenceType") || (documentId ? "DELIVERY_PHOTO" : "AUTHORIZED_DRIVER_CONFIRMATION"),
        evidenceReference: field(form, "evidenceReference"),
        documentId,
      });
    }
    if (modal === "reconcile") {
      await mutateJourney(selected, "mission_reconcile", { note: field(form, "note") });
    }
    if (modal === "report") {
      const reviewAction = field(form, "reviewAction");
      if (canReviewMissionReport && selectedReport?.status === "SUBMITTED" && reviewAction) {
        const decision = reviewAction === "request_changes" ? "REQUEST_CHANGES" : "APPROVE";
        await mutateJourney(selected, "mission_report_review", { decision, reviewNote: field(form, "reviewNote") });
      } else {
        const reportAction = field(form, "reportAction") === "save" ? "mission_report_save" : "mission_report_submit";
        await mutateJourney(selected, reportAction, { text: missionReportText });
      }
    }
    if (modal === "exception") {
      await mutateJourney(selected, "mission_exception", {
        exceptionType,
        stopId: exceptionStopId,
        reference: field(form, "exceptionReference"),
        note: field(form, "exceptionNote"),
      });
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
        <section className="zw-module-heading flex flex-wrap items-end justify-between gap-5 border-b border-white/[.07] pb-5"><div><p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.22em] text-lime-300/80"><Truck className="size-3.5" />MISSIONI · FLOTTA E CONSEGNE</p><h1 className="mt-2 text-3xl font-semibold tracking-[-.06em] text-slate-50 sm:text-[42px]">Missioni sotto controllo.</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Programma consegne, trasferimenti e asset con risorse realmente disponibili. Ogni viaggio resta collegato alla richiesta, alla commessa e alla prova di consegna.</p></div><div className="flex flex-wrap gap-2"><Button className="bg-lime-300 text-[11px] font-semibold text-[#050705] hover:bg-lime-200" disabled={!canManageMission || enabledTransportModes.length === 0} onClick={() => openCreate()}><Truck className="size-3.5" />Nuova missione</Button><Link className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-lime-300/25 bg-lime-300/[.05] px-3 py-2 text-[11px] font-semibold text-lime-100 hover:bg-lime-300/10" href="/planning"><CalendarClock className="size-3.5" />Pianificazione</Link></div></section>

        <section className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-7"><KpiCard label="Totali" value={payload?.summary.total ?? 0} detail="Missioni nel tenant" icon={Truck} tone="cyan" /><KpiCard label="Da programmare" value={counts.toSchedule} detail="Richieste approvate" icon={Package} tone="amber" /><KpiCard label="Pianificate" value={payload?.summary.planned ?? 0} detail="In attesa di partenza" icon={CircleGauge} tone="amber" /><KpiCard label="In viaggio" value={payload?.summary.dispatched ?? 0} detail="Partenza registrata" icon={Route} tone="cyan" /><KpiCard label="POD" value={counts.verified} detail="Prova verificata" icon={FileCheck2} tone="lime" /><KpiCard label="Riconciliate" value={counts.reconciled} detail="Quantità e documento verificati" icon={ClipboardCheck} tone="lime" /><KpiCard label="Chiuse" value={counts.closed} detail="Journey conclusa" icon={CheckCircle2} tone="lime" /></section>

        <section className="carbon-card-neon mt-4 rounded-2xl p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-cyan-200/70">CONTROLLO OPERATIVO · PRESENZE · MAGAZZINO · CONTROL</p><h2 className="mt-1 text-base font-semibold text-slate-100">La coda che richiede attenzione</h2><p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">Missioni legge i readback verificati degli altri domini e porta in primo piano solo ciò che blocca o richiede un passaggio umano.</p></div><span className="rounded-full border border-cyan-300/20 bg-cyan-300/[.05] px-3 py-1.5 font-mono text-[10px] text-cyan-100">{(canReviewMissionReport ? attentionCounts.reportReview : 0) + attentionCounts.reportChanges + attentionCounts.reportPending + attentionCounts.tracking + attentionCounts.warehouse + attentionCounts.exception} SEGNALI</span></div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">{canReviewMissionReport && <AttentionCard active={attentionFilter === "REPORT_REVIEW"} detail="Inviati dall’autista, pronti per l’ufficio." icon={ClipboardCheck} label="Da approvare" onClick={() => setAttentionFilter((current) => current === "REPORT_REVIEW" ? "ALL" : "REPORT_REVIEW")} tone="lime" value={attentionCounts.reportReview} />}<AttentionCard active={attentionFilter === "REPORT_CHANGES"} detail="Integrazione richiesta e reinvio aperto." icon={Sparkles} label="Integrazioni" onClick={() => setAttentionFilter((current) => current === "REPORT_CHANGES" ? "ALL" : "REPORT_CHANGES")} tone="amber" value={attentionCounts.reportChanges} /><AttentionCard active={attentionFilter === "REPORT_PENDING"} detail="Missioni riconciliate senza rapportino completo." icon={FileText} label="Rapportino" onClick={() => setAttentionFilter((current) => current === "REPORT_PENDING" ? "ALL" : "REPORT_PENDING")} tone="amber" value={attentionCounts.reportPending} /><AttentionCard active={attentionFilter === "TRACKING"} detail="Viaggi senza posizione recente verificabile." icon={Route} label="Tracking" onClick={() => setAttentionFilter((current) => current === "TRACKING" ? "ALL" : "TRACKING")} tone="cyan" value={attentionCounts.tracking} />{context?.operatingDomains?.includes("warehouse") && <AttentionCard active={attentionFilter === "WAREHOUSE"} detail="Righe non ancora riconciliate dal ledger." icon={Layers3} label="Magazzino" onClick={() => setAttentionFilter((current) => current === "WAREHOUSE" ? "ALL" : "WAREHOUSE")} tone="amber" value={attentionCounts.warehouse} />}<AttentionCard active={attentionFilter === "EXCEPTION"} detail="Eccezioni aperte da risolvere o riconciliare." icon={CircleAlert} label="Eccezioni" onClick={() => setAttentionFilter((current) => current === "EXCEPTION" ? "ALL" : "EXCEPTION")} tone="red" value={attentionCounts.exception} /></div><div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-white/[.07] pt-3 text-[10px] text-slate-600"><span>{attentionFilter === "ALL" ? "Registro completo visualizzato." : "Filtro operativo attivo: seleziona di nuovo la scheda per rimuoverlo."}</span>{attentionFilter !== "ALL" && <button className="text-lime-200 hover:text-lime-100" onClick={() => setAttentionFilter("ALL")} type="button">Mostra tutte le missioni</button>}</div></section>

        {context?.operatingDomains?.includes("warehouse") && <section className="carbon-card-neon mt-4 rounded-2xl p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-2xl border border-amber-300/25 bg-amber-300/10 text-amber-200"><Package className="size-5" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-amber-200/70">PRONTE DA PROGRAMMARE</p><h2 className="mt-1 text-base font-semibold text-slate-100">Richieste materiali approvate</h2><p className="mt-1 text-xs text-slate-500">Il responsabile ha validato le righe: assegna una finestra, un autista e un mezzo disponibili.</p></div></div><span className="rounded-full border border-amber-300/20 bg-amber-300/[.06] px-3 py-1.5 font-mono text-[10px] text-amber-100">{schedulableRequests.length} DA PROGRAMMARE</span></div><div className="mt-4 grid gap-3 lg:grid-cols-2">{schedulableRequests.map((request) => <article className="min-w-0 rounded-2xl border border-amber-300/15 bg-black/20 p-4" key={request.id}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-100">{request.title}</p><p className="mt-1 truncate text-[10px] text-slate-500">{request.jobCode ?? request.jobTitle} · {text(request.payload.deliveryPoint, "Destinazione da definire")}</p></div><StatusPill label="APPROVATA" tone="lime" /></div><p className="mt-3 line-clamp-2 text-[11px] leading-5 text-slate-400">{requestLinesLabel(request.payload)}</p><div className="mt-4 flex flex-col items-stretch gap-3 border-t border-white/[.06] pt-3 sm:flex-row sm:items-center sm:justify-between"><span className="min-w-0 break-words text-[10px] leading-4 text-slate-500">{request.payload.warehouse && typeof request.payload.warehouse === "object" && !Array.isArray(request.payload.warehouse) ? text((request.payload.warehouse as Record<string, unknown>).name, "Magazzino assegnato") : "Magazzino da verificare"}</span><Button className="h-11 w-full shrink-0 justify-center bg-lime-300 px-4 text-[11px] font-semibold text-[#050705] hover:bg-lime-200 sm:w-auto sm:min-w-[190px]" disabled={!canManageMission} onClick={() => openCreate(request)}><Route className="size-4" />Programma missione</Button></div>{!canManageMission && <p className="mt-2 text-[9px] text-amber-100/70">La programmazione richiede il permesso mission.manage.</p>}</article>)}{schedulableRequests.length === 0 && <div className="rounded-xl border border-dashed border-amber-300/15 bg-black/15 p-6 text-center text-xs text-slate-600 lg:col-span-2">Nessuna richiesta approvata in attesa di programmazione.</div>}</div></section>}

        <section className="carbon-card mt-4 rounded-2xl p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-lime-300/70">REGISTRO MISSIONI</p><h2 className="mt-1 text-lg font-semibold text-slate-100">Flotta, tratta e stato</h2><p className="mt-1 text-xs text-slate-500">Cerca e filtra i viaggi del tuo spazio di lavoro.</p></div><span className="flex items-center gap-2 font-mono text-[10px] text-slate-600"><span className="size-1.5 rounded-full bg-lime-300" />{filteredMissions.length} / {missions.length} RECORD</span></div><div className="mt-4 flex flex-wrap gap-2"><label className="relative min-w-[240px] flex-1 md:hidden"><Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-600" /><Input aria-label="Filtra missioni" className="h-10 border-white/10 bg-black/25 pl-9 text-xs" onChange={(event) => setQuery(event.target.value)} placeholder="Filtra questa sezione…" value={query} /></label><select aria-label="Filtra stato missione" className="h-10 rounded-xl border border-white/10 bg-black/25 px-3 text-xs text-slate-300 outline-none focus:border-lime-300/40" onChange={(event) => setStatusFilter(event.target.value)} value={statusFilter}><option className="bg-[#080c09]" value="ALL">Tutti gli stati</option>{lifecycle.map((item) => <option className="bg-[#080c09]" key={item.value} value={item.value}>{item.label}</option>)}</select><Button className="h-10 border-white/10 bg-black/20 text-xs text-slate-300 hover:border-lime-300/30 hover:bg-lime-300/10 hover:text-lime-100" onClick={() => { setQuery(""); setStatusFilter("ALL"); setAttentionFilter("ALL"); }} variant="outline"><RefreshCw className="size-3.5" />Reset filtri</Button></div></section>

        <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.08fr)_minmax(360px,.92fr)]"><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-cyan-200/70">JOURNEY QUEUE</p><h2 className="mt-1 text-base font-semibold text-slate-100">Missioni operative</h2></div><IconButton label="Aggiorna registro missioni" onClick={() => void refresh()}><RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} /></IconButton></div><div className="mt-4 space-y-3">{filteredMissions.map((mission) => <MissionCard canWrite={canDispatchMission} key={mission.id} mission={mission} onDispatch={() => void mutateJourney(mission, "mission_dispatch")} onSelect={() => setSelectedId(mission.id)} selected={mission.id === selected?.id} />)}{filteredMissions.length === 0 && <div className="rounded-2xl border border-dashed border-lime-300/15 bg-black/15 p-12 text-center"><Truck className="mx-auto size-9 text-slate-700" /><p className="mt-3 text-sm font-medium text-slate-300">Nessuna missione nel perimetro</p><p className="mt-1 text-xs text-slate-600">Crea una missione oppure rimuovi i filtri.</p><Button className="mt-5 bg-lime-300 text-[11px] font-semibold text-[#050705] hover:bg-lime-200" disabled={!canManageMission || enabledTransportModes.length === 0} onClick={() => openCreate()}><Truck className="size-3.5" />Nuova missione</Button></div>}</div></section>

          <aside className="space-y-4"><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">MISSION INSPECTOR</p><h2 className="mt-1 text-lg font-semibold text-slate-100">{selected?.title ?? "Nessuna missione selezionata"}</h2><p className="mt-1 font-mono text-[10px] text-slate-600">{selected ? (selected.jobCode ?? selected.jobId) + " · v" + selected.version : "Seleziona una missione dal registro"}</p></div>{selected && <StatusPill label={statusLabel(selected.status)} tone={statusTone(selected.status)} />}</div>{selected ? <><div className="mt-4 grid gap-2 sm:grid-cols-2"><div className="carbon-inset rounded-xl p-3"><p className="text-[10px] uppercase tracking-[.14em] text-slate-600">Tratta</p><p className="mt-2 truncate text-sm text-slate-200">{text(selected.payload.pickup)}</p><p className="mt-1 truncate text-[10px] text-lime-200">→ {text(selected.payload.dropoff)}</p></div><div className="carbon-inset rounded-xl p-3"><p className="text-[10px] uppercase tracking-[.14em] text-slate-600">Finestra</p><p className="mt-2 text-sm text-slate-200">{formatDate(selected.payload.plannedAt)}</p><p className="mt-1 text-[10px] text-slate-600">fino a {formatDate(selected.payload.plannedEndAt)}</p></div><div className="carbon-inset rounded-xl p-3"><p className="text-[10px] uppercase tracking-[.14em] text-slate-600">Autista canonico</p><p className="mt-2 truncate text-sm text-slate-200">{snapshotLabel(selected.payload, "driver")}</p><p className="mt-1 font-mono text-[10px] text-slate-600">{text(selected.payload.driverId)}</p></div><div className="carbon-inset rounded-xl p-3"><p className="text-[10px] uppercase tracking-[.14em] text-slate-600">Mezzo canonico</p><p className="mt-2 truncate text-sm text-slate-200">{snapshotLabel(selected.payload, "vehicle")}</p><p className="mt-1 font-mono text-[10px] text-slate-600">{text(selected.payload.vehicleId)}</p><p className="mt-1 text-[10px] text-slate-500">Affidato a: {snapshotResourceAssignee(selected.payload, "vehicle")}</p></div><div className="carbon-inset rounded-xl p-3 sm:col-span-2"><p className="text-[10px] uppercase tracking-[.14em] text-slate-600">Asset / materiale associato</p><p className="mt-2 truncate text-sm text-slate-200">{snapshotCargoAssets(selected.payload)}</p><p className="mt-1 text-[10px] text-slate-600">Utilizzatore operativo: {snapshotCargoAssignees(selected.payload)}</p><p className="mt-1 text-[10px] text-slate-600">Custodia: {cargoCustodyReadback(selected.payload)} · {modeLabel(selected.payload.transportMode)} · snapshot storico</p></div></div><div className="mt-5"><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-slate-600">JOURNEY STATE</p><div className="mt-3 grid gap-2 sm:grid-cols-3 xl:grid-cols-2">{lifecycle.map((step, index) => { const currentIndex = lifecycle.findIndex((item) => item.value === selected.status); const active = index <= currentIndex; return <div className={cn("flex items-center gap-2 rounded-xl border px-3 py-2", active ? "border-lime-300/20 bg-lime-300/[.06]" : "border-white/[.07] bg-black/15")} key={step.value}><span className={cn("grid size-6 place-items-center rounded-lg border text-[10px]", active ? "border-lime-300/35 bg-lime-300/10 text-lime-200" : "border-white/10 text-slate-700")}>{active ? <CheckCircle2 className="size-3.5" /> : index + 1}</span><span className={cn("text-[10px]", active ? "text-lime-100" : "text-slate-600")}>{step.label}</span></div>; })}</div></div><MissionActionPanel busy={busy} canRecord={canRecordDeliveryAction} manifestTimeline={selectedManifestTimeline} mission={selected} note={actionNote} onNoteChange={setActionNote} onRecord={(action, stop) => { const assetIds = stop?.cargoManifest.flatMap((entry) => entry.assetId ? [entry.assetId] : []) ?? []; return void mutateJourney(selected, action, { stopId: stop?.id ?? "", sequence: stop?.sequence ?? null, note: actionNote, assetId: assetIds[0] ?? (String(selected.payload.cargoAssetId ?? "") || undefined), assetIds }); }} onStopChange={setActionStopId} selectedStopId={activeActionStopId} stops={selectedStops} timeline={selectedTimeline} /><section className="mt-4 rounded-2xl border border-cyan-300/15 bg-cyan-300/[.035] p-4"><div className="flex items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-xl border border-cyan-300/25 bg-cyan-300/10 text-cyan-200"><Sparkles className="size-4" /></span><div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-cyan-200/75">COMPANY AI · RAPPORTINO MISSIONE</p><h3 className="mt-1 text-sm font-semibold text-slate-100">{selectedReport?.status === "APPROVED" ? "Rapportino approvato dall’ufficio" : selectedReport?.status === "CHANGES_REQUESTED" ? "Integrazione richiesta dall’ufficio" : selectedReport?.status === "SUBMITTED" ? "Rapportino inviato in ufficio" : "Consuntivo guidato della missione"}</h3><p className="mt-1 text-[10px] leading-5 text-slate-500">{selectedReport?.status === "APPROVED" ? "Il consuntivo è stato verificato e resta nel registro Missioni." : selectedReport?.status === "CHANGES_REQUESTED" ? "Il rapportino può essere corretto e reinviato dall’autista." : selectedReport?.completeness.ready ? "Tutti i dati importanti sono leggibili dal registro server-side." : `${selectedReport?.completeness.missing.length ?? 0} dati importanti da completare prima dell’invio.`}</p></div><div className="ml-auto shrink-0"><StatusPill label={selectedReport ? reportStatusLabel(selectedReport.status) : "DA CREARE"} tone={selectedReport ? reportStatusTone(selectedReport.status) : "muted"} /></div></div>{selectedReport && !selectedReport.completeness.ready && <div className="mt-3 space-y-1.5">{selectedReport.completeness.questions.slice(0, 3).map((question) => <p className="flex items-start gap-2 text-[10px] text-amber-100/80" key={question}><CircleAlert className="mt-0.5 size-3 shrink-0" />{question}</p>)}</div>}{selectedReport?.review.status === "CHANGES_REQUESTED" && selectedReport.review.note && <div className="mt-3 rounded-xl border border-amber-300/15 bg-amber-300/[.04] p-3"><p className="text-[9px] font-semibold uppercase tracking-[.14em] text-amber-200/75">NOTA DELL’UFFICIO</p><p className="mt-1 text-[10px] leading-5 text-amber-100/80">{selectedReport.review.note}</p></div>}{(canWriteMissionReport || canReviewMissionReport) && selected.status !== "CLOSED" && <Button className="mt-4 border-cyan-300/25 bg-cyan-300/[.06] text-cyan-100 hover:bg-cyan-300/10" onClick={openMissionReport} variant="outline"><Sparkles className="size-3.5" />{selectedReport?.status === "SUBMITTED" ? "Rivedi rapportino" : "Crea rapportino con Company AI"}</Button>}</section><div className="mt-5 flex flex-wrap gap-2">{canDispatchMission && selected.status === "PLANNED" && <Button className="bg-cyan-300 text-[#041012] hover:bg-cyan-200" onClick={() => void mutateJourney(selected, "mission_dispatch")}><Send className="size-3.5" />Registra partenza</Button>}{canManageMission && selected.status === "DELIVERED" && <Button className="bg-lime-300 text-[#050705] hover:bg-lime-200" onClick={() => setModal("pod")}><FileCheck2 className="size-3.5" />Verifica POD</Button>}{canManageMission && selected.status === "POD_VERIFIED" && <Button className="bg-amber-300 text-[#130b02] hover:bg-amber-200" onClick={() => setModal("reconcile")}><ClipboardCheck className="size-3.5" />Riconcilia</Button>}{canManageMission && selected.status === "RECONCILED" && <Button className="bg-lime-300 text-[#050705] hover:bg-lime-200" onClick={() => void mutateJourney(selected, "mission_close")}><CheckCircle2 className="size-3.5" />Chiudi journey</Button>}{selected.jobModule === "operations" && <Link className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-lime-300/25 bg-lime-300/[.05] px-3 py-2 text-[11px] font-semibold text-lime-100 hover:bg-lime-300/10" href={"/operations/" + encodeURIComponent(selected.jobId)}>Apri commessa <ArrowRight className="size-3.5" /></Link>}</div></> : <div className="mt-5 rounded-xl border border-dashed border-white/10 p-8 text-center text-xs text-slate-600">Seleziona una missione per vedere journey, risorse e controlli.</div>}</section>

            <section className="carbon-card-neon rounded-2xl p-4 sm:p-5"><div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-2xl border border-cyan-300/25 bg-cyan-300/10 text-cyan-200"><Gauge className="size-5" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-cyan-200/70">ROUTE OBSERVATION</p><h2 className="mt-1 text-base font-semibold text-slate-100">Osservazione senza finzioni</h2></div></div><div className="mt-4 rounded-xl border border-white/[.08] bg-black/25 p-4"><div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[.15em]"><span className="text-cyan-200/70">Origine</span><span className="text-lime-200/70">Destinazione</span></div><div className="relative my-6 h-2 rounded-full bg-white/[.06]"><div className="absolute left-0 top-1/2 size-3 -translate-y-1/2 rounded-full bg-cyan-200 shadow-[0_0_14px_rgba(89,217,255,.75)]" /><div className="absolute right-0 top-1/2 size-3 -translate-y-1/2 rounded-full bg-lime-300 shadow-[0_0_14px_rgba(200,255,34,.75)]" /><div className="absolute inset-x-3 top-1/2 border-t border-dashed border-lime-300/35" /></div><div className="grid gap-2 sm:grid-cols-2"><div className="truncate text-xs text-slate-300">{selected ? text(selected.payload.pickup) : "—"}</div><div className="truncate text-right text-xs text-slate-300">{selected ? text(selected.payload.dropoff) : "—"}</div></div></div><p className="mt-3 text-[10px] leading-5 text-slate-500">{routeTrackingMessage(text(selectedTracking?.status, "NOT_ACTIVE"), Boolean(selected))}</p><Link className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-lime-200 hover:text-lime-100" href="/command#operational-map">Apri Command map surface <ArrowRight className="size-3.5" /></Link></section></aside>
        </section>

        <section className="mt-4 grid gap-4 lg:grid-cols-3"><section className="carbon-card rounded-2xl p-4 sm:p-5 lg:col-span-2"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">CROSS-MODULE HANDOFF</p><h2 className="mt-1 text-base font-semibold text-slate-100">La journey non duplica i registri</h2><p className="mt-1 text-xs text-slate-500">Ogni dominio resta proprietario del proprio dato; Mission coordina solo il trasporto e la prova di consegna.</p></div><Sparkles className="size-5 text-lime-200/70" /></div><div className="mt-4 grid gap-2 md:grid-cols-4"><Link className="group rounded-xl border border-white/[.08] bg-black/20 p-3 hover:border-lime-300/25" href="/operations"><BriefcaseBusiness className="size-4 text-lime-200" /><p className="mt-3 text-[11px] font-semibold text-slate-200">Commessa</p><p className="mt-1 text-[10px] leading-4 text-slate-600">Origine della richiesta e destinazione operativa.</p><ChevronRight className="mt-3 size-3.5 text-slate-700 transition group-hover:translate-x-1 group-hover:text-lime-200" /></Link><Link className="group rounded-xl border border-white/[.08] bg-black/20 p-3 hover:border-lime-300/25" href="/warehouse"><Layers3 className="size-4 text-cyan-200" /><p className="mt-3 text-[11px] font-semibold text-slate-200">Magazzino</p><p className="mt-1 text-[10px] leading-4 text-slate-600">Scorte, prenotazioni, picking e carico missione.</p><ChevronRight className="mt-3 size-3.5 text-slate-700 transition group-hover:translate-x-1 group-hover:text-lime-200" /></Link><Link className="group rounded-xl border border-white/[.08] bg-black/20 p-3 hover:border-lime-300/25" href="/planning"><CalendarClock className="size-4 text-amber-200" /><p className="mt-3 text-[11px] font-semibold text-slate-200">Planning</p><p className="mt-1 text-[10px] leading-4 text-slate-600">Finestra, capacità, squadre e conflitti.</p><ChevronRight className="mt-3 size-3.5 text-slate-700 transition group-hover:translate-x-1 group-hover:text-lime-200" /></Link><Link className="group rounded-xl border border-white/[.08] bg-black/20 p-3 hover:border-lime-300/25" href="/documents"><FileText className="size-4 text-lime-200" /><p className="mt-3 text-[11px] font-semibold text-slate-200">Documenti</p><p className="mt-1 text-[10px] leading-4 text-slate-600">POD, allegati e provenance del viaggio.</p><ChevronRight className="mt-3 size-3.5 text-slate-700 transition group-hover:translate-x-1 group-hover:text-lime-200" /></Link></div></section><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-2xl border border-amber-300/25 bg-amber-300/10 text-amber-200"><CircleGauge className="size-5" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-amber-200/70">CONTROL RULES</p><h2 className="mt-1 text-base font-semibold text-slate-100">Guard attivi</h2></div></div><div className="mt-4 space-y-2 text-[10px] text-slate-500"><div className="flex items-start gap-2 rounded-xl border border-white/[.08] bg-black/20 p-3"><ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-lime-200" /><span>Autista, mezzo e asset sono ID tenant-scoped, non testo libero.</span></div><div className="flex items-start gap-2 rounded-xl border border-white/[.08] bg-black/20 p-3"><Clock3 className="mt-0.5 size-3.5 shrink-0 text-cyan-200" /><span>La disponibilità viene ricalcolata sulla finestra temporale.</span></div><div className="flex items-start gap-2 rounded-xl border border-white/[.08] bg-black/20 p-3"><ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-lime-200" /><span>Ogni passaggio richiede versione attesa, idempotenza e readback.</span></div></div></section></section>

        <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/[.07] py-5 text-[10px] text-slate-700"><span>AI-ZEROW COMMAND · MISSIONI</span><span className="flex items-center gap-2"><span>ultra carbon core</span><span className="size-1 rounded-full bg-lime-300" /><span>accesso personalizzato</span><span className="size-1 rounded-full bg-cyan-300" /><span>posizione live da collegare</span></span></footer>
      </div>
    </section>
  </div><CommandMobileNav active="mission" allowedNavigation={allowedNavigation} role={context?.role} roles={context?.roles} />

    <Dialog open={modal !== null} onOpenChange={(open) => { if (!open) setModal(null); }}><DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto border-lime-300/20 bg-[#080c09] text-slate-100 sm:max-w-[720px]"><form className="space-y-4" onSubmit={submit}><DialogHeader><DialogTitle>{modal === "create" ? "Nuova missione" : modal === "delivery" ? "Consegna e POD" : modal === "pod" ? "Verifica prova di consegna" : modal === "reconcile" ? "Riconcilia e chiudi la missione" : modal === "report" && canReviewMissionReport && selectedReport?.status === "SUBMITTED" ? "Revisione rapportino missione" : "Rapportino missione con Company AI"}</DialogTitle><DialogDescription className="text-slate-500">{modal === "create" ? "Il percorso può collegarsi a una commessa reale o nascere autonomo. Ogni tappa usa una location canonica oppure un indirizzo temporaneo verificato dal server; autista, mezzo e asset arrivano esclusivamente dal registro disponibile." : modal === "delivery" ? "Registra il ricevente e la tappa. L’orario ufficiale viene scritto dal server al momento della conferma." : modal === "pod" ? "Verifica il readback della prova di consegna prima di passare alla riconciliazione." : modal === "reconcile" ? "La riconciliazione richiede una nota operativa e chiude il passaggio tra consegnato, documento e quantità." : "Company AI prepara il consuntivo dai dati della missione e raccoglie solo le informazioni che mancano."}</DialogDescription></DialogHeader>{modal === "create" ? <div className="grid gap-4 sm:grid-cols-2"><label className="text-xs text-slate-400 sm:col-span-2">Commessa o trasporto autonomo<select aria-label="Commessa o trasporto autonomo" className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-slate-100 outline-none focus:border-lime-300/40 focus:ring-2 focus:ring-lime-300/10" name="jobId" onChange={(event) => handleJobSelection(event.target.value)} required value={createJobId}><option value="">Seleziona collegamento</option>{<option value="__standalone__">Missione autonoma · nessuna commessa</option>}{jobs.map((job) => <option key={job.id} value={job.id}>{job.code ? job.code + " · " : ""}{job.title}{job.location ? " · " + job.location : ""}</option>)}</select></label><label className="text-xs text-slate-400 sm:col-span-2">Titolo missione<Input autoFocus className="mt-2 border-white/10 bg-black/30" name="title" onChange={(event) => setMissionTitle(event.target.value)} required value={missionTitle} /></label><label className="text-xs text-slate-400">Modalità trasporto<select aria-label="Modalità trasporto" className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-slate-100 outline-none focus:border-lime-300/40 focus:ring-2 focus:ring-lime-300/10" name="transportMode" onChange={(event) => setTransportMode(event.target.value as TransportMode)} required value={transportMode}>{enabledTransportModes.map((mode) => <option key={mode} value={mode}>{TRANSPORT_MODE_CATALOG[mode]?.label ?? mode}</option>)}</select></label><RouteStopsEditor assetOptions={cargoOptions} locations={locations} onChange={setRouteStops} selectedAssetIds={cargoAssetIds} stops={routeStops} /><input name="pickup" type="hidden" value={locations.find((location) => location.id === routeStops[0]?.locationId)?.formattedAddress ?? ""} readOnly /><input name="dropoff" type="hidden" value={locations.find((location) => location.id === routeStops.at(-1)?.locationId)?.formattedAddress ?? ""} readOnly /><label className="text-xs text-slate-400">Inizio pianificato<Input className="mt-2 border-white/10 bg-black/30" name="plannedAt" onChange={(event) => setPlannedAt(event.target.value)} required type="datetime-local" value={plannedAt} /></label><label className="text-xs text-slate-400">Fine pianificata <span className="text-slate-600">(opzionale)</span><Input className="mt-2 border-white/10 bg-black/30" name="plannedEndAt" onChange={(event) => setPlannedEndAt(event.target.value)} type="datetime-local" value={plannedEndAt} /></label><MissionResourceFields cargoAssetIds={cargoAssetIds} driverId={driverId} onCargoAssetsChange={(ids) => { setCargoAssetIds(ids); setCargoAssetId(ids.join(",")); }} onCargoOptionsChange={setCargoOptions} onDriverChange={setDriverId} onVehicleChange={setVehicleId} plannedAt={plannedAt} plannedEndAt={plannedEndAt} transportMode={transportMode} vehicleId={vehicleId} /><label className="text-xs text-slate-400 sm:col-span-2">Nota operativa<Textarea className="mt-2 border-white/10 bg-black/30" name="notes" placeholder="Vincoli, riferimento o consegna particolare…" /></label></div> : modal === "delivery" ? <div className="grid gap-4 sm:grid-cols-2"><div className="sm:col-span-2 rounded-xl border border-lime-300/15 bg-lime-300/[.04] p-3"><p className="text-[10px] uppercase tracking-[.15em] text-slate-600">MISSIONE SELEZIONATA</p><p className="mt-1 text-sm font-semibold text-slate-100">{selected?.title}</p><p className="mt-1 text-[10px] text-slate-600">{selected ? text(selected.payload.pickup) + " → " + text(selected.payload.dropoff) : "—"}</p><p className="mt-2 text-[10px] text-cyan-100/80">Utilizzatore operativo del carico: {selected ? snapshotCargoAssignees(selected.payload) : "—"}</p><p className="mt-1 text-[9px] text-slate-600">Il ricevente effettivo e la prova di consegna vengono registrati separatamente; l’assegnazione di lungo periodo resta invariata.</p></div><label className="text-xs text-slate-400 sm:col-span-2">Tappa di consegna<select aria-label="Tappa di consegna" className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-slate-100 outline-none focus:border-lime-300/40" name="stopId" onChange={(event) => setDeliveryStopId(event.target.value)} value={deliveryStopId}><option value="">Seleziona tappa</option>{selectedStops.map((stop) => <option key={stop.id} value={stop.id}>{stop.sequence}. {stop.label} · {stop.kind.replaceAll("_", " ")}</option>)}</select></label><label className="text-xs text-slate-400 sm:col-span-2">Ricevente / referente<Input autoFocus className="mt-2 border-white/10 bg-black/30" name="recipient" placeholder="Nome o organizzazione" required /></label><div className="sm:col-span-2 rounded-xl border border-cyan-300/15 bg-cyan-300/[.04] p-3"><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.14em] text-cyan-100"><Clock3 className="size-3.5" />Timestamp ufficiale server</div><p className="mt-1 text-[10px] leading-5 text-slate-500">L’orario della consegna viene assegnato dal server al momento della conferma. L’orologio del dispositivo non può alterare il dato ufficiale.</p></div><MissionPodEvidenceFields /><label className="text-xs text-slate-400 sm:col-span-2">Nota consegna<Textarea className="mt-2 border-white/10 bg-black/30" name="note" placeholder="Quantità, riserva o anomalia…" /></label></div>: modal === "pod" ? <div className="grid gap-4"><div className="rounded-xl border border-lime-300/15 bg-lime-300/[.04] p-4"><p className="text-[10px] uppercase tracking-[.15em] text-lime-300/70">READBACK POD</p><p className="mt-2 text-sm text-slate-200">Ricevente: {text((selected?.payload.proofOfDelivery as Record<string, unknown> | undefined)?.recipient)}</p><p className="mt-1 text-[10px] text-slate-500">Consegna registrata dal server: {formatDate((selected?.payload.proofOfDelivery as Record<string, unknown> | undefined)?.deliveredAt)}</p></div><MissionPodEvidenceFields /></div>: modal === "reconcile" ? <div className="grid gap-4"><div className="rounded-xl border border-amber-300/15 bg-amber-300/[.04] p-4"><p className="text-[10px] uppercase tracking-[.15em] text-amber-200/70">RICONCILIAZIONE</p><p className="mt-2 text-sm text-slate-200">La chiusura richiede una nota tracciabile.</p><p className="mt-1 text-[10px] text-slate-500">Dopo questo passaggio la journey potrà essere chiusa con un secondo readback.</p></div><label className="text-xs text-slate-400">Nota di riconciliazione<Textarea autoFocus className="mt-2 min-h-28 border-white/10 bg-black/30" name="note" placeholder="Confronto quantità, POD e riferimenti di commessa…" required /></label></div>: <div className="grid gap-4"><div className="rounded-xl border border-cyan-300/15 bg-cyan-300/[.04] p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-cyan-200/75">READBACK GUIDATO</p><p className="mt-2 text-sm font-semibold text-slate-100">Company AI ha già preparato ciò che la missione sa.</p><p className="mt-1 text-[10px] leading-5 text-slate-500">Carichi, scarichi, consegna e timestamp provengono dal registro server-side. Completa solo ciò che manca davvero.</p></div><StatusPill label={selectedReport ? reportStatusLabel(selectedReport.status) : "DA CREARE"} tone={selectedReport ? reportStatusTone(selectedReport.status) : "muted"} /></div></div><div className="grid gap-2 sm:grid-cols-2">{selectedReport?.fields.map((reportField) => <div className="rounded-xl border border-white/[.08] bg-black/20 p-3" key={reportField.key}><div className="flex items-center justify-between gap-2"><p className="text-[9px] font-semibold uppercase tracking-[.14em] text-slate-600">{reportField.label}</p><span className={cn("text-[9px] uppercase tracking-[.12em]", reportField.status === "known" ? "text-lime-200" : reportField.status === "missing" ? "text-amber-200" : "text-slate-600")}>{reportField.status === "known" ? "OK" : reportField.status === "missing" ? "Manca" : "Opzionale"}</span></div><p className="mt-2 line-clamp-3 whitespace-pre-wrap text-[10px] leading-5 text-slate-300">{reportField.value}</p><p className="mt-1 text-[9px] text-slate-700">{reportField.source}</p></div>)}</div>{(missionReportQuestions.length > 0 || (selectedReport?.completeness.questions.length ?? 0) > 0) && <div className="rounded-xl border border-amber-300/15 bg-amber-300/[.04] p-3"><p className="text-[9px] font-semibold uppercase tracking-[.14em] text-amber-200/75">DOMANDE ANCORA APERTE</p><div className="mt-2 space-y-1.5">{(missionReportQuestions.length ? missionReportQuestions : selectedReport?.completeness.questions ?? []).slice(0, 5).map((question) => <p className="flex items-start gap-2 text-[10px] leading-5 text-amber-100/80" key={question}><CircleAlert className="mt-0.5 size-3 shrink-0" />{question}</p>)}</div></div>}{selectedReport?.review.status === "CHANGES_REQUESTED" && selectedReport.review.note && <div className="rounded-xl border border-amber-300/15 bg-amber-300/[.04] p-3"><p className="text-[9px] font-semibold uppercase tracking-[.14em] text-amber-200/75">NOTA DELL’UFFICIO</p><p className="mt-1 text-[10px] leading-5 text-amber-100/80">{selectedReport.review.note}</p></div>}{canReviewMissionReport && selectedReport?.status === "SUBMITTED" && <label className="text-xs text-slate-400">Nota revisione <span className="text-slate-600">(obbligatoria per richiedere integrazioni)</span><Textarea className="mt-2 min-h-24 border-amber-300/20 bg-black/30 text-xs" name="reviewNote" onChange={(event) => setReviewNote(event.target.value)} placeholder="Conferma il rapportino oppure indica cosa deve essere integrato…" value={reviewNote} /></label>}<label className="text-xs text-slate-400">Rapportino operativo<Textarea className="mt-2 min-h-56 border-white/10 bg-black/30 font-mono text-xs leading-5" name="missionReport" onChange={(event) => setMissionReportText(event.target.value)} readOnly={!canEditMissionReport} value={missionReportText} placeholder="Esito, anomalie, rientri, danni, riserve o note per l’ufficio…" required /></label><p className="text-[10px] leading-5 text-slate-600">Per l’invio servono tutte le azioni obbligatorie e una descrizione finale completa. Se manca un dato importante Company AI mantiene la missione in bozza.</p></div>}<DialogFooter><DialogClose asChild><Button className="border-white/10 bg-transparent text-slate-400" type="button" variant="outline">Annulla</Button></DialogClose>{modal === "report" ? <>{canEditMissionReport && selectedReport?.status !== "APPROVED" && <><Button className="border-cyan-300/25 bg-cyan-300/[.06] text-cyan-100 hover:bg-cyan-300/10" disabled={busy} name="reportAction" type="submit" value="save" variant="outline">{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <ClipboardCheck className="size-3.5" />}Salva bozza</Button><Button className="bg-lime-300 text-[#050705] hover:bg-lime-200" disabled={busy} name="reportAction" type="submit" value="submit">{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}Invia in ufficio</Button></>}{canReviewMissionReport && selectedReport?.status === "SUBMITTED" && <><Button className="border-amber-300/25 bg-amber-300/[.06] text-amber-100 hover:bg-amber-300/10" disabled={busy} name="reviewAction" type="submit" value="request_changes"><FileText className="size-3.5" />Richiedi integrazione</Button><Button className="bg-lime-300 text-[#050705] hover:bg-lime-200" disabled={busy} name="reviewAction" type="submit" value="approve"><CheckCircle2 className="size-3.5" />Approva rapportino</Button></>}</> : <Button className="bg-lime-300 text-[#050705] hover:bg-lime-200" disabled={busy || (modal === "delivery" ? !canDispatchMission : !canManageMission)} type="submit">{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}{modal === "create" ? "Crea e rileggi" : modal === "delivery" ? "Registra consegna" : modal === "pod" ? "Verifica POD" : "Riconcilia"}</Button>}</DialogFooter></form></DialogContent></Dialog>
    <Dialog open={exceptionModalOpen} onOpenChange={setExceptionModalOpen}><DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto border-rose-300/20 bg-[#080c09] text-slate-100 sm:max-w-[620px]"><form className="space-y-4" onSubmit={submitException}><DialogHeader><DialogTitle>Segnala eccezione missione</DialogTitle><DialogDescription className="text-slate-500">L’anomalia resta nel registro della missione con timestamp e autore server-side. Una missione bloccata non può essere chiusa senza una ripresa o una riconciliazione autorizzata.</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2"><div className="rounded-2xl border border-rose-300/15 bg-rose-300/[.035] p-4 sm:col-span-2"><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-rose-200/75">CONTROLLO OPERATIVO</p><p className="mt-2 text-sm font-semibold text-slate-100">{selected?.title ?? "Missione selezionata"}</p><p className="mt-1 text-[10px] leading-5 text-slate-500">Il GPS o il ritardo possono spiegare l’evento, ma la causa deve essere dichiarata dall’operatore autorizzato.</p></div><label className="text-xs text-slate-400">Tipo di eccezione<select aria-label="Tipo di eccezione missione" className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-slate-100 outline-none focus:border-rose-300/40" name="exceptionType" onChange={(event) => setExceptionType(event.target.value as MissionExceptionType)} value={exceptionType}>{MISSION_EXCEPTION_TYPES.map((type) => <option key={type} value={type}>{MISSION_EXCEPTION_LABELS[type]}</option>)}</select></label><label className="text-xs text-slate-400">Tappa interessata <select aria-label="Tappa interessata" className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-slate-100 outline-none focus:border-rose-300/40" name="exceptionStopId" onChange={(event) => setExceptionStopId(event.target.value)} value={exceptionStopId}><option value="">Missione intera</option>{selectedStops.map((stop) => <option key={stop.id} value={stop.id}>{stop.sequence}. {stop.label}</option>)}</select></label><label className="text-xs text-slate-400 sm:col-span-2">Riferimento <span className="text-slate-700">· opzionale</span><Input className="mt-2 border-white/10 bg-black/30 text-xs" name="exceptionReference" placeholder="Numero pratica, assistenza, foto o nota esterna" /></label><label className="text-xs text-slate-400 sm:col-span-2">Descrizione obbligatoria<Textarea autoFocus className="mt-2 min-h-28 border-white/10 bg-black/30 text-xs leading-5" name="exceptionNote" placeholder="Cosa è successo? Quale carico o tappa è coinvolto?" required /></label></div><DialogFooter><DialogClose asChild><Button className="border-white/10 bg-transparent text-slate-400" type="button" variant="outline">Annulla</Button></DialogClose><Button className="bg-rose-300 text-[#160507] hover:bg-rose-200" disabled={busy || !canRecordDeliveryAction} type="submit">{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <CircleAlert className="size-3.5" />}Registra eccezione</Button></DialogFooter></form></DialogContent></Dialog>
    {notice && <button aria-label="Chiudi messaggio" className="fixed bottom-5 left-1/2 z-[100] flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-2 rounded-xl border border-lime-300/25 bg-[#080d09]/96 px-4 py-3 text-left text-xs text-lime-100 shadow-[0_0_34px_rgba(200,255,34,.16)] backdrop-blur-xl" onClick={() => setNotice("")} type="button"><CheckCircle2 className="size-4 shrink-0 text-lime-300" />{notice}</button>}
  </main>;
}
