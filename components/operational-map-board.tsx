"use client";

import "leaflet/dist/leaflet.css";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  Crosshair,
  ExternalLink,
  LocateFixed,
  Map as MapIcon,
  MapPin,
  Navigation,
  PanelRight,
  RefreshCw,
  Warehouse,
  X,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";
import { missionExceptionLabel } from "@/lib/mission-exception-contract";
import type { LayerGroup, Map as LeafletMap } from "leaflet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type OperationalMapFilter = "TUTTI" | "ASSET" | "TEAM" | "LAVORI" | "GEOFENCE";
type OperationalMapTone = "lime" | "amber" | "cyan" | "red";

export type OperationalMapMarker = {
  id: string;
  label: string;
  detail: string;
  kind: Exclude<OperationalMapFilter, "TUTTI" | "GEOFENCE">;
  x: string;
  y: string;
  icon: LucideIcon;
  tone: OperationalMapTone;
};

export type OperationalMapLocation = {
  id: string;
  entityType: string;
  entityId: string;
  label: string;
  code?: string | null;
  description?: string | null;
  client?: string | null;
  category?: string | null;
  openingType?: string | null;
  jobType?: string | null;
  specialization?: string | null;
  dueDate?: string | null;
  priority?: string | null;
  operationalStatus?: string | null;
  progress?: number | null;
  geofenceRadiusMeters?: number | null;
  locationSource?: string | null;
  address: string;
  coordinates: { latitude: number; longitude: number };
  provider: string;
  verified: boolean;
  status: string;
  updatedAt?: string;
  latestEvent?: { eventType?: string; occurredAt?: string } | null;
};

export type OperationalMapLivePayload = {
  context?: { capabilities?: string[] };
  locations: OperationalMapLocation[];
  geofences: Array<{
    id: string;
    locationId: string;
    entityType: string;
    entityId: string;
    name: string;
    shapeType: string;
    version: number;
    center: { latitude: number; longitude: number } | null;
    radiusMeters: number | null;
    polygon: unknown;
  }>;
  vehicles: Array<{
    id: string;
    label: string;
    coordinates: { latitude: number; longitude: number };
    recordedAt: string;
    state: "LIVE" | "RECENT" | "STALE" | "UNKNOWN";
    accuracyM: number | null;
    speedKmh: number | null;
    heading: number | null;
    trackingSessionId: string | null;
    employeeId: string | null;
    trackingDeviceId: string;
    deviceLabel: string;
    provider: string;
    latestEvent?: { eventType?: string; occurredAt?: string } | null;
  }>;
  activeSessions: Array<{ id: string; employeeId: string; vehicleId: string; trackingDeviceId: string; startedAt: string; source: string }>;
  missionExceptions: Array<{
    missionId: string;
    jobId: string;
    title: string;
    jobTitle: string | null;
    missionStatus: string;
    type: string;
    note: string;
    reference: string | null;
    stopId: string | null;
    recoveryStatus: "OPEN" | "RESOLVED";
    reportedAt: string;
    reportedBy: string;
    resolvedAt: string | null;
    resolvedBy: string | null;
    resolutionNote: string | null;
    updatedAt: string;
  }>;
  derivedEvents: Array<{ id: string; eventType: string; occurredAt: string; vehicleId: string; locationId: string | null }>;
  rawSamples: string;
  readback?: { checkedAt?: string };
};

const toneStyles: Record<OperationalMapTone, string> = {
  lime: "text-lime-300",
  amber: "text-amber-300",
  cyan: "text-cyan-300",
  red: "text-rose-300",
};

type Point = { latitude: number; longitude: number };
type FeatureProperties = Record<string, string | number | boolean | null>;
type MapFeature = {
  type: "Feature";
  id?: string;
  properties: FeatureProperties;
  geometry:
    | { type: "Point"; coordinates: [number, number] }
    | { type: "Polygon"; coordinates: Array<Array<[number, number]>> };
};
type FeatureCollection = { type: "FeatureCollection"; features: MapFeature[] };
type LiveMapStatus = "loading" | "ready" | "fallback" | "unavailable";
type MapConfig = { provider?: string; configured?: boolean; tileUrl?: string | null; attribution?: string };

function IconButton({ label, children, onClick, className = "", disabled = false }: { label: string; children: ReactNode; onClick: () => void; className?: string; disabled?: boolean }) {
  return <button aria-label={label} className={`grid size-9 place-items-center rounded-lg border border-white/10 bg-black/20 text-slate-500 transition hover:border-lime-300/35 hover:bg-lime-300/10 hover:text-lime-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300 disabled:cursor-not-allowed disabled:opacity-50 ${className}`} disabled={disabled} onClick={onClick} type="button">{children}</button>;
}

function circlePolygon(center: Point, radiusMeters: number) {
  const points: Array<[number, number]> = [];
  const latitudeScale = Math.cos((center.latitude * Math.PI) / 180) || 1;
  for (let index = 0; index <= 64; index += 1) {
    const angle = (index / 64) * Math.PI * 2;
    const latitude = center.latitude + (radiusMeters / 111_320) * Math.sin(angle);
    const longitude = center.longitude + (radiusMeters / (111_320 * latitudeScale)) * Math.cos(angle);
    points.push([longitude, latitude]);
  }
  return points;
}

function polygonCoordinates(value: unknown): Array<Array<[number, number]>> {
  if (!Array.isArray(value)) return [];
  const points = value.flatMap((item): [number, number][] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    const latitude = Number(row.latitude ?? row.lat);
    const longitude = Number(row.longitude ?? row.lng ?? row.lon);
    return Number.isFinite(latitude) && Number.isFinite(longitude) ? [[longitude, latitude]] : [];
  });
  return points.length >= 3 ? [[...points, points[0]]] : [];
}

function toLiveFeatures(data: OperationalMapLivePayload, filter: OperationalMapFilter, selectedMarker: string) {
  const showLocations = filter === "TUTTI" || filter === "LAVORI" || filter === "GEOFENCE";
  const showVehicles = filter === "TUTTI" || filter === "ASSET" || filter === "TEAM";
  const locationFeatures: MapFeature[] = showLocations
    ? data.locations
      .filter((location) => filter !== "LAVORI" || ["CANTIERE", "COMMESSA"].includes(location.entityType))
      .map((location) => ({
        type: "Feature",
        id: `location:${location.id}`,
        properties: {
          id: `location:${location.id}`,
          label: location.label,
          code: location.code,
          entityType: location.entityType,
          detail: location.description || location.address || location.latestEvent?.eventType || "Sede operativa",
          address: location.address,
          selected: selectedMarker === `location:${location.id}`,
        },
        geometry: { type: "Point", coordinates: [location.coordinates.longitude, location.coordinates.latitude] },
      }))
    : [];
  const vehicleFeatures: MapFeature[] = showVehicles
    ? data.vehicles
      .filter((vehicle) => filter !== "TEAM" || Boolean(vehicle.employeeId))
      .map((vehicle) => ({
        type: "Feature",
        id: `vehicle:${vehicle.id}`,
        properties: {
          id: `vehicle:${vehicle.id}`,
          label: vehicle.label,
          state: vehicle.state,
          detail: vehicle.state === "LIVE" ? "GPS live" : vehicle.state === "RECENT" ? "GPS recente" : "GPS non aggiornato",
          selected: selectedMarker === `vehicle:${vehicle.id}`,
        },
        geometry: { type: "Point", coordinates: [vehicle.coordinates.longitude, vehicle.coordinates.latitude] },
      }))
    : [];
  const geofenceFeatures: MapFeature[] = (filter === "TUTTI" || filter === "GEOFENCE")
    ? data.geofences.flatMap((geofence) => {
      const coordinates = geofence.shapeType === "POLYGON"
        ? polygonCoordinates(geofence.polygon)
        : geofence.center && geofence.radiusMeters
          ? [circlePolygon(geofence.center, geofence.radiusMeters)]
          : [];
      if (!coordinates.length) return [];
      return [{
        type: "Feature",
        id: `geofence:${geofence.id}`,
        properties: { id: `geofence:${geofence.id}`, label: geofence.name, entityType: geofence.entityType, entityId: geofence.entityId, locationId: geofence.locationId },
        geometry: { type: "Polygon", coordinates },
      } satisfies MapFeature];
    })
    : [];
  return {
    locations: { type: "FeatureCollection", features: locationFeatures } satisfies FeatureCollection,
    vehicles: { type: "FeatureCollection", features: vehicleFeatures } satisfies FeatureCollection,
    geofences: { type: "FeatureCollection", features: geofenceFeatures } satisfies FeatureCollection,
  };
}

function mapCoordinates(data: OperationalMapLivePayload) {
  return [...data.locations.map((location) => location.coordinates), ...data.vehicles.map((vehicle) => vehicle.coordinates)]
    .filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude));
}

function formatTime(value: string | undefined | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatDate(value: string | undefined | null) {
  if (!value || value === "—") return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function locationTypeLabel(entityType: string) {
  if (entityType === "MAGAZZINO") return "Magazzino";
  if (entityType === "CANTIERE" || entityType === "COMMESSA") return "Commessa";
  if (entityType === "CLIENTE") return "Cliente";
  if (entityType === "DESTINATARIO") return "Destinatario";
  return "Sede operativa";
}

function locationStatusLabel(value: string | null | undefined) {
  const normalized = String(value ?? "").toUpperCase();
  if (normalized === "ACTIVE" || normalized === "ATTIVA" || normalized === "IN CORSO") return "Operativa";
  if (normalized === "PLANNED" || normalized === "PIANIFICATA") return "Pianificata";
  if (normalized === "DRAFT" || normalized === "BOZZA") return "Bozza";
  if (normalized === "BLOCKED" || normalized === "BLOCCATA") return "Bloccata";
  return value || "Da verificare";
}

function MissionExceptionSignals({ exceptions }: { exceptions: OperationalMapLivePayload["missionExceptions"] }) {
  if (!exceptions.length) return null;
  const openCount = exceptions.filter((exception) => exception.recoveryStatus === "OPEN").length;
  const visible = [...exceptions]
    .sort((left, right) => Number(right.recoveryStatus === "OPEN") - Number(left.recoveryStatus === "OPEN") || Date.parse(right.reportedAt) - Date.parse(left.reportedAt))
    .slice(0, 4);
  return <section className="mt-3 rounded-xl border border-rose-300/20 bg-rose-300/[.035] p-3 sm:p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><CircleAlert className="size-4 text-rose-200" /><div><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-rose-200/80">MISSIONI / ECCEZIONI</p><p className="mt-1 text-[10px] text-slate-500">Readback operativo server-side, separato dalle coordinate GPS.</p></div></div><span className="rounded-full border border-rose-300/25 bg-rose-300/[.06] px-2 py-1 text-[9px] font-semibold uppercase tracking-[.1em] text-rose-100">{openCount} aperte</span></div><div className="mt-3 grid gap-2 sm:grid-cols-2">{visible.map((exception) => <a className="rounded-lg border border-white/[.08] bg-black/20 p-3 transition hover:border-rose-300/30" href={`/mission?missionId=${encodeURIComponent(exception.missionId)}`} key={exception.missionId}><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-[11px] font-semibold text-slate-100">{exception.title}</p><p className="mt-1 truncate text-[9px] text-slate-600">{exception.jobTitle ?? "Missione autonoma"} · {missionExceptionLabel(exception.type)}</p></div><span className={`shrink-0 rounded-full border px-2 py-1 text-[8px] font-semibold uppercase ${exception.recoveryStatus === "OPEN" ? "border-rose-300/25 bg-rose-300/[.06] text-rose-100" : "border-lime-300/20 bg-lime-300/[.05] text-lime-100"}`}>{exception.recoveryStatus === "OPEN" ? "APERTA" : "RISOLTA"}</span></div><p className="mt-2 line-clamp-2 text-[10px] leading-4 text-slate-400">{exception.note}</p><p className="mt-2 text-[9px] text-slate-600">Segnalata {formatTime(exception.reportedAt)} · tappa {exception.stopId ?? "missione"}</p></a>)}</div>{exceptions.length > visible.length && <p className="mt-3 text-[9px] text-slate-600">+ {exceptions.length - visible.length} eccezioni nel registro Missioni.</p>}</section>;
}

type MapEntitySelection = { entityType: string; entityId: string; label: string };
type LiveMapSurfaceProps = { mapFilter: OperationalMapFilter; selectedMarker: string; onSelectMarker: (id: string) => void; onFilterChange: (value: OperationalMapFilter) => void; onOpenEntity?: (selection: MapEntitySelection) => void };

function GeofenceQuickAction({ entityType, entityId, label, currentRadius, version, onUpdated }: { entityType: string; entityId: string; label: string; currentRadius: number; version: number; onUpdated: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const setOneKilometer = async () => {
    if (!window.confirm(`Impostare il geofence di ${label} a 1 km?`)) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/location/locations", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entityType,
          entityId,
          radiusMeters: 1_000,
          expectedVersion: version,
          idempotencyKey: `command-map-geofence:${entityType}:${entityId}:1000:v${version}`,
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "geofence_update_failed");
      await onUpdated();
      setNotice("Geofence aggiornato a 1 km e riletto dal server.");
    } catch {
      setNotice("Aggiornamento non riuscito: verifica autorizzazione e versione della geofence.");
    } finally {
      setBusy(false);
    }
  };

  return <div className="border-t border-cyan-300/15 bg-cyan-300/[.025] px-4 py-3 sm:px-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[9px] font-semibold uppercase tracking-[.15em] text-cyan-200/75">GESTIONE GEOFENCE</p><p className="mt-1 text-[10px] text-slate-400">Raggio attuale: <span className="font-mono text-cyan-100">{currentRadius} m</span></p></div><button className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-cyan-300/25 bg-cyan-300/[.07] px-3 py-2 text-[10px] font-semibold text-cyan-100 transition hover:bg-cyan-300/[.14] disabled:cursor-wait disabled:opacity-60" disabled={busy || currentRadius === 1_000} onClick={() => void setOneKilometer()} type="button">{busy ? <RefreshCw className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}{currentRadius === 1_000 ? "Geofence a 1 km" : "Imposta 1 km"}</button></div>{notice && <p className="mt-2 text-[10px] text-cyan-100/80">{notice}</p>}</div>;
}

function LeafletMapSurface({ mapFilter, selectedMarker, onSelectMarker, onFilterChange, onOpenEntity }: LiveMapSurfaceProps) {
  const mapSurfaceRef = useRef<HTMLDivElement>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layersRef = useRef<LayerGroup | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const didFitRef = useRef(false);
  const [mapStatus, setMapStatus] = useState<LiveMapStatus>("loading");
  const [mapBaseReady, setMapBaseReady] = useState(false);
  const [tileError, setTileError] = useState(false);
  const [liveData, setLiveData] = useState<OperationalMapLivePayload | null>(null);
  const [lastRead, setLastRead] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [baseProvider, setBaseProvider] = useState<"GEOAPIFY" | "OPEN_STREET_MAP">("GEOAPIFY");

  const loadMapData = async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const response = await fetch("/api/command/map", { cache: "no-store" });
      const payload = await response.json() as OperationalMapLivePayload & { error?: string };
      if (!response.ok) throw new Error(payload.error || "map_readback_unavailable");
      setLiveData(payload);
      setLastRead(payload.readback?.checkedAt ?? new Date().toISOString());
      setMapStatus("ready");
    } catch {
      setMapStatus("unavailable");
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    const initialLoad = window.setTimeout(() => { void loadMapData(); }, 0);
    const interval = window.setInterval(() => { void loadMapData(true); }, 30_000);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    let cancelled = false;
    void Promise.all([
      import("leaflet"),
      fetch("/api/location/map-config", { cache: "no-store" }),
    ]).then(async ([module, configResponse]) => {
      if (cancelled || !mapContainerRef.current) return;
      const config = configResponse.ok ? await configResponse.json() as MapConfig : null;
      const geoapifyReady = config?.provider === "GEOAPIFY" && config.configured === true && Boolean(config.tileUrl);
      const tileUrl = geoapifyReady ? config!.tileUrl! : "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
      const attribution = geoapifyReady
        ? "Powered by <a href=\"https://www.geoapify.com/\" target=\"_blank\" rel=\"noreferrer\">Geoapify</a> · © <a href=\"https://www.openstreetmap.org/copyright\" target=\"_blank\" rel=\"noreferrer\">OpenStreetMap</a>"
        : "© <a href=\"https://www.openstreetmap.org/copyright\" target=\"_blank\" rel=\"noreferrer\">OpenStreetMap</a>";
      const L = module.default;
      leafletRef.current = module;
      const map = L.map(mapContainerRef.current, { zoomControl: false, preferCanvas: true, minZoom: 2, maxZoom: 19 }).setView([41.9028, 12.4964], 5.2);
      const tiles = L.tileLayer(tileUrl, { maxZoom: 19, crossOrigin: true, className: "zerow-map-tiles", attribution }).addTo(map);
      tiles.on("tileerror", () => setTileError(true));
      tiles.on("tileload", () => setTileError(false));
      const layers = L.layerGroup().addTo(map);
      mapRef.current = map;
      layersRef.current = layers;
      setBaseProvider(geoapifyReady ? "GEOAPIFY" : "OPEN_STREET_MAP");
      setMapBaseReady(true);
      window.setTimeout(() => map.invalidateSize(), 80);
    }).catch(() => setMapStatus("unavailable"));
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      layersRef.current = null;
      leafletRef.current = null;
    };
  }, []);

  const featureData = useMemo(() => liveData ? toLiveFeatures(liveData, mapFilter, selectedMarker) : null, [liveData, mapFilter, selectedMarker]);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    const layers = layersRef.current;
    if (!L || !map || !layers || !featureData) return;
    layers.clearLayers();
    const addPoint = (feature: MapFeature, fillColor: string, radius: number) => {
      if (feature.geometry.type !== "Point") return;
      const [longitude, latitude] = feature.geometry.coordinates;
      const id = String(feature.properties.id || "");
      L.circleMarker([latitude, longitude], { radius, color: "#020403", weight: 2, fillColor, fillOpacity: 0.96, className: feature.properties.selected ? "zerow-map-marker zerow-map-marker-selected" : "zerow-map-marker" }).on("click", () => onSelectMarker(id)).addTo(layers);
    };
    for (const feature of featureData.locations.features) {
      const color = feature.properties.entityType === "MAGAZZINO" ? "#59d9ff" : feature.properties.entityType === "CANTIERE" ? "#c8ff22" : "#dfff5c";
      addPoint(feature, color, feature.properties.selected ? 10 : 7);
    }
    for (const feature of featureData.vehicles.features) {
      const color = feature.properties.state === "LIVE" ? "#c8ff22" : feature.properties.state === "RECENT" ? "#59d9ff" : feature.properties.state === "STALE" ? "#ffb52e" : "#ff5538";
      addPoint(feature, color, feature.properties.selected ? 11 : 8);
    }
    for (const feature of featureData.geofences.features) {
      if (feature.geometry.type !== "Polygon") continue;
      const coordinates = feature.geometry.coordinates[0].map(([longitude, latitude]) => [latitude, longitude] as [number, number]);
      if (coordinates.length < 3) continue;
      L.polygon(coordinates, { color: "#c8ff22", weight: 1.5, dashArray: "5 5", fillColor: "#c8ff22", fillOpacity: 0.08, className: "zerow-map-geofence" }).on("click", () => {
        const locationId = String(feature.properties.locationId || "");
        if (locationId) onSelectMarker(`location:${locationId}`);
      }).addTo(layers);
    }
    if (!didFitRef.current) {
      const coordinates = mapCoordinates(liveData!);
      if (coordinates.length === 1) map.setView([coordinates[0].latitude, coordinates[0].longitude], 13, { animate: false });
      if (coordinates.length > 1) map.fitBounds(L.latLngBounds(coordinates.map((point) => [point.latitude, point.longitude] as [number, number])), { padding: [44, 44], maxZoom: 13, animate: false });
      if (coordinates.length > 0) didFitRef.current = true;
    }
  }, [featureData, liveData, onSelectMarker]);

  const focusAll = () => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map || !liveData) return;
    onSelectMarker("");
    const coordinates = mapCoordinates(liveData);
    if (coordinates.length === 1) map.setView([coordinates[0].latitude, coordinates[0].longitude], 13);
    if (coordinates.length > 1) map.fitBounds(L.latLngBounds(coordinates.map((point) => [point.latitude, point.longitude] as [number, number])), { padding: [44, 44], maxZoom: 13 });
    map.invalidateSize();
  };

  const selectedLocation = liveData?.locations.find((location) => `location:${location.id}` === selectedMarker);
  const selectedVehicle = liveData?.vehicles.find((vehicle) => `vehicle:${vehicle.id}` === selectedMarker);
  const selectedFence = selectedLocation ? liveData?.geofences.find((geofence) => geofence.locationId === selectedLocation.id || (geofence.entityType === selectedLocation.entityType && geofence.entityId === selectedLocation.entityId)) : null;
  const canManageGeofences = Boolean(liveData?.context?.capabilities?.includes("location.manage.geofences"));
  const visibleSignals = featureData ? featureData.locations.features.length + featureData.vehicles.features.length + featureData.geofences.features.length : 0;

  return <div className="zerow-map-surface relative overflow-hidden rounded-xl border border-lime-300/20 bg-[#050706] shadow-[inset_0_0_50px_rgba(200,255,34,.04)]" ref={mapSurfaceRef}>
    <div className="zerow-map-frame relative min-h-[360px] pt-[360px] sm:min-h-[430px] sm:pt-[430px]">
    <div className="absolute inset-x-0 top-0 h-[360px] sm:h-[430px]" ref={mapContainerRef} />
    <div className="pointer-events-none absolute inset-x-0 top-0 h-[360px] bg-[linear-gradient(180deg,rgba(1,4,2,.04),rgba(1,3,2,.18))] sm:h-[430px]" />
    <div className="absolute left-3 top-3 flex items-center gap-2 rounded-lg border border-white/10 bg-[#050706]/88 px-2.5 py-2 backdrop-blur"><Navigation className="size-3.5 text-lime-300" /><span className="text-[10px] font-medium text-slate-200">{baseProvider === "GEOAPIFY" ? "GEOAPIFY" : "OPENSTREETMAP"} · SERVER READBACK</span>{lastRead && <span className="hidden font-mono text-[9px] text-slate-500 sm:inline">{formatTime(lastRead)}</span>}</div>
    {((liveData?.activeSessions?.length) ?? 0) > 0 && <div className="absolute left-3 top-14 flex items-center gap-2 rounded-lg border border-lime-300/25 bg-[#050706]/90 px-2.5 py-2 shadow-[0_0_20px_rgba(200,255,34,.12)] backdrop-blur"><span className="size-1.5 animate-pulse rounded-full bg-lime-300 shadow-[0_0_10px_rgba(200,255,34,.9)]" /><span className="text-[9px] font-semibold uppercase tracking-[.12em] text-lime-100">{liveData?.activeSessions?.length ?? 0} tracking attivi</span>{(liveData?.activeSessions?.length ?? 0) > (liveData?.vehicles?.length ?? 0) && <span className="text-[9px] text-slate-500">posizione in attesa</span>}</div>}
    <div className="absolute right-3 top-3 flex flex-col gap-1 rounded-lg border border-white/10 bg-[#050706]/90 p-1 backdrop-blur"><IconButton disabled={refreshing} label="Aggiorna mappa" onClick={() => void loadMapData()} className="size-8 rounded-md border-0 bg-transparent hover:bg-white/10">{refreshing ? <RefreshCw className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}</IconButton><IconButton label="Zoom in" onClick={() => mapRef.current?.zoomIn()} className="size-8 rounded-md border-0 bg-transparent hover:bg-white/10"><ZoomIn className="size-3.5" /></IconButton><IconButton label="Zoom out" onClick={() => mapRef.current?.zoomOut()} className="size-8 rounded-md border-0 bg-transparent hover:bg-white/10"><ZoomOut className="size-3.5" /></IconButton><div className="mx-1 h-px bg-white/10" /><IconButton label="Centra vista" onClick={focusAll} className="size-8 rounded-md border-0 bg-transparent hover:bg-white/10"><LocateFixed className="size-3.5" /></IconButton><IconButton label="Schermo intero" onClick={() => { if (mapSurfaceRef.current?.requestFullscreen) void mapSurfaceRef.current.requestFullscreen(); }} className="size-8 rounded-md border-0 bg-transparent hover:bg-white/10"><PanelRight className="size-3.5" /></IconButton></div>
    {!mapBaseReady && <div className="absolute inset-x-0 top-0 grid h-[360px] place-items-center bg-[#050706]/55 sm:h-[430px]"><div className="rounded-xl border border-lime-300/20 bg-[#070b08]/92 px-4 py-3 text-center text-xs text-lime-100"><RefreshCw className="mx-auto size-4 animate-spin text-lime-300" /><p className="mt-2">Caricamento mappa…</p></div></div>}
    {mapStatus === "unavailable" && <div className="absolute inset-x-4 top-[180px] mx-auto max-w-sm -translate-y-1/2 rounded-2xl border border-rose-300/20 bg-[#070b08]/92 p-4 text-center backdrop-blur sm:top-[215px]"><MapIcon className="mx-auto size-7 text-rose-200" /><p className="mt-3 text-sm font-semibold text-slate-100">Dati operativi non disponibili</p><p className="mt-2 text-[11px] leading-5 text-slate-500">La base cartografica resta disponibile. Usa Aggiorna per rileggere il server.</p></div>}
    {tileError && <span className="absolute bottom-14 right-3 rounded-full border border-amber-300/25 bg-[#070b08]/90 px-2.5 py-1.5 text-[9px] text-amber-100">Base cartografica non raggiungibile</span>}
    {selectedLocation && <div className="absolute bottom-14 left-3 right-3 max-w-[min(520px,calc(100%-24px))] rounded-2xl border border-lime-300/25 bg-[#070b08]/95 p-3 shadow-[0_0_30px_rgba(200,255,34,.14)] backdrop-blur-xl sm:bottom-16 sm:left-4 sm:right-auto sm:p-4"><div className="flex items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-xl border border-lime-300/25 bg-lime-300/10 text-lime-200">{selectedLocation.entityType === "MAGAZZINO" ? <Warehouse className="size-4" /> : selectedLocation.entityType === "CANTIERE" || selectedLocation.entityType === "COMMESSA" ? <BriefcaseBusiness className="size-4" /> : <MapPin className="size-4" />}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-[9px] font-semibold uppercase tracking-[.16em] text-lime-300/75">{locationTypeLabel(selectedLocation.entityType)}</p>{selectedLocation.operationalStatus && <span className="rounded-full border border-lime-300/20 bg-lime-300/10 px-2 py-1 text-[9px] font-semibold text-lime-100">{locationStatusLabel(selectedLocation.operationalStatus)}</span>}</div><p className="mt-1 truncate text-sm font-semibold text-slate-100">{selectedLocation.label}</p><p className="mt-0.5 truncate font-mono text-[9px] text-slate-600">{selectedLocation.code || selectedLocation.entityId}</p></div><button aria-label="Chiudi dettaglio sede" className="grid size-7 place-items-center rounded-lg text-slate-500 hover:bg-white/10 hover:text-white" onClick={() => onSelectMarker("")} type="button"><X className="size-4" /></button></div><p className="mt-3 line-clamp-2 text-[11px] leading-5 text-slate-300">{selectedLocation.description || "Nessuna descrizione disponibile."}</p><div className="mt-3 grid gap-2 text-[10px] text-slate-400 sm:grid-cols-2"><div className="flex min-w-0 items-start gap-2"><MapPin className="mt-0.5 size-3.5 shrink-0 text-lime-300" /><span className="min-w-0 truncate">{selectedLocation.address || "Indirizzo non valorizzato"}</span></div>{selectedLocation.client && <div className="flex min-w-0 items-start gap-2"><BriefcaseBusiness className="mt-0.5 size-3.5 shrink-0 text-cyan-300" /><span className="min-w-0 truncate">{selectedLocation.client}</span></div>}{selectedLocation.dueDate && <div className="flex items-start gap-2"><CalendarClock className="mt-0.5 size-3.5 shrink-0 text-amber-300" /><span>Scadenza {formatDate(selectedLocation.dueDate)}</span></div>}{selectedFence && <div className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-lime-300" /><span>Geofence {selectedFence.shapeType === "CIRCLE" && selectedFence.radiusMeters ? `${selectedFence.radiusMeters} m` : selectedFence.shapeType.toLowerCase()}</span></div>}</div><div className="mt-3 flex flex-wrap items-center justify-between gap-2"><div className="flex flex-wrap gap-1.5">{selectedLocation.category && <span className="rounded-full border border-white/10 bg-white/[.04] px-2 py-1 text-[9px] text-slate-400">{selectedLocation.category}</span>}{selectedLocation.jobType && <span className="rounded-full border border-cyan-300/15 bg-cyan-300/[.05] px-2 py-1 text-[9px] text-cyan-100">{selectedLocation.jobType}</span>}{selectedLocation.specialization && <span className="rounded-full border border-violet-300/15 bg-violet-300/[.05] px-2 py-1 text-[9px] text-violet-100">{selectedLocation.specialization}</span>}{selectedLocation.priority && <span className="rounded-full border border-amber-300/15 bg-amber-300/[.05] px-2 py-1 text-[9px] text-amber-100">Priorità {selectedLocation.priority}</span>}{selectedLocation.progress !== null && selectedLocation.progress !== undefined && <span className="rounded-full border border-lime-300/15 bg-lime-300/[.06] px-2 py-1 font-mono text-[9px] text-lime-200">{selectedLocation.progress}% avanzamento</span>}</div>{onOpenEntity && <button className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-lime-300/25 bg-lime-300/10 px-2.5 text-[10px] font-semibold text-lime-100 transition hover:bg-lime-300/20" onClick={() => onOpenEntity({ entityType: selectedLocation.entityType, entityId: selectedLocation.entityId, label: selectedLocation.label })} type="button">Apri {locationTypeLabel(selectedLocation.entityType).toLowerCase()}<ExternalLink className="size-3" /></button>}</div></div>}
    {selectedVehicle && <div className="absolute bottom-14 left-3 max-w-[min(380px,calc(100%-24px))] rounded-2xl border border-cyan-300/25 bg-[#070b08]/95 p-3 shadow-[0_0_30px_rgba(89,217,255,.12)] backdrop-blur-xl sm:bottom-16 sm:left-4 sm:p-4"><div className="flex items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-xl border border-cyan-300/25 bg-cyan-300/10 text-cyan-200"><MapPin className="size-4" /></span><div className="min-w-0 flex-1"><p className="text-[9px] font-semibold uppercase tracking-[.16em] text-cyan-200/75">MEZZO · {selectedVehicle.state}</p><p className="mt-1 truncate text-sm font-semibold text-slate-100">{selectedVehicle.label}</p><p className="mt-0.5 truncate text-[10px] text-slate-500">{selectedVehicle.deviceLabel} · ultimo segnale {formatTime(selectedVehicle.recordedAt)}</p></div><button aria-label="Chiudi dettaglio mezzo" className="grid size-7 place-items-center rounded-lg text-slate-500 hover:bg-white/10 hover:text-white" onClick={() => onSelectMarker("")} type="button"><X className="size-4" /></button></div><p className="mt-3 text-[10px] text-cyan-100/80">{selectedVehicle.speedKmh !== null ? `${selectedVehicle.speedKmh} km/h` : "Velocità non disponibile"}{selectedVehicle.accuracyM !== null ? ` · precisione ${selectedVehicle.accuracyM} m` : ""}</p>{onOpenEntity && <button className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg border border-cyan-300/25 bg-cyan-300/10 px-2.5 text-[10px] font-semibold text-cyan-100 transition hover:bg-cyan-300/20" onClick={() => onOpenEntity({ entityType: "ASSET", entityId: selectedVehicle.id, label: selectedVehicle.label })} type="button">Apri asset<ExternalLink className="size-3" /></button>}</div>}
    <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2"><Tabs value={mapFilter} onValueChange={(value) => onFilterChange(value as OperationalMapFilter)}><TabsList className="h-9 rounded-lg border border-white/10 bg-[#050706]/92 p-1 backdrop-blur" aria-label="Filtri mappa"><TabsTrigger className="h-7 rounded-md px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]" value="TUTTI">Tutti</TabsTrigger><TabsTrigger className="h-7 rounded-md px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]" value="ASSET">Mezzi</TabsTrigger><TabsTrigger className="h-7 rounded-md px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]" value="TEAM">Team</TabsTrigger><TabsTrigger className="h-7 rounded-md px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]" value="LAVORI">Cantieri</TabsTrigger><TabsTrigger className="h-7 rounded-md px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]" value="GEOFENCE">Geofence</TabsTrigger></TabsList></Tabs><span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-[#050706]/92 px-2.5 py-1.5 text-[9px] uppercase tracking-[0.1em] text-slate-400"><Crosshair className="size-3 text-lime-300" />{visibleSignals} segnali · {liveData?.vehicles.length ?? 0} mezzi</span></div>
    </div>
    {selectedLocation && canManageGeofences && ["CANTIERE", "COMMESSA"].includes(selectedLocation.entityType) && selectedFence?.shapeType === "CIRCLE" && selectedFence.radiusMeters !== null && <GeofenceQuickAction entityType={selectedLocation.entityType} entityId={selectedLocation.entityId} label={selectedLocation.label} currentRadius={selectedFence.radiusMeters} version={selectedFence.version} onUpdated={() => loadMapData()} />}
    <MissionExceptionSignals exceptions={liveData?.missionExceptions ?? []} />
  </div>;
}

function SchematicMapSurface({ mapFilter, onFilterChange, selectedMarker, onSelectMarker, markers }: { mapFilter: OperationalMapFilter; onFilterChange: (value: OperationalMapFilter) => void; selectedMarker: string; onSelectMarker: (id: string) => void; markers: OperationalMapMarker[] }) {
  const [mapZoom, setMapZoom] = useState(1);
  const mapSurfaceRef = useRef<HTMLDivElement>(null);
  const visibleMarkers = markers.filter((marker) => mapFilter === "TUTTI" || mapFilter === "GEOFENCE" || marker.kind === mapFilter);
  const toggleFullscreen = async () => {
    if (!mapSurfaceRef.current) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await mapSurfaceRef.current.requestFullscreen();
    } catch {
      // Fullscreen is an optional browser capability; the map remains usable.
    }
  };
  return <div className="relative min-h-[360px] overflow-hidden rounded-xl border border-white/10 bg-[#050607] sm:min-h-[430px]" ref={mapSurfaceRef}><div className="absolute inset-0 transition-transform duration-200" style={{ transform: `scale(${mapZoom})`, transformOrigin: "center" }}><div className="map-grid absolute inset-0 opacity-80" /><div className="absolute inset-0 bg-[radial-gradient(circle_at_52%_48%,rgba(190,255,60,0.12),transparent_25%),radial-gradient(circle_at_16%_80%,rgba(65,224,255,0.07),transparent_22%)]" /><svg aria-label="Mappa operativa schematica" className="absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 900 500"><path d="M0 84C110 132 128 24 226 76S384 152 480 91 643 44 900 103" fill="none" stroke="rgba(104,123,128,0.25)" strokeWidth="2" /><path d="M0 216C95 190 116 288 250 232S410 186 506 262 708 348 900 270" fill="none" stroke="rgba(113,135,138,0.22)" strokeWidth="2" /><path d="M-20 384C112 323 151 428 292 356S472 330 585 398 748 437 930 347" fill="none" stroke="rgba(113,135,138,0.2)" strokeWidth="2" /><path d="M90 402L195 294L322 343L390 189L524 247L620 130L766 177L849 82" fill="none" stroke="rgba(190,255,60,0.72)" strokeDasharray="5 8" strokeLinecap="round" strokeWidth="2" /><path d="M90 402L195 294L322 343L390 189L524 247L620 130L766 177L849 82" fill="none" opacity="0.24" stroke="rgba(190,255,60,0.85)" strokeLinecap="round" strokeWidth="10" /></svg>{visibleMarkers.map((marker) => { const Icon = marker.icon; const selected = selectedMarker === marker.id; return <button key={marker.id} className="absolute -translate-x-1/2 -translate-y-1/2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300" onClick={() => onSelectMarker(marker.id)} style={{ left: marker.x, top: marker.y }} type="button"><span className={`absolute -inset-2 rounded-full border border-lime-300/35 ${selected ? "animate-pulse bg-lime-300/15" : "opacity-0"}`} /><span className={`relative flex items-center gap-2 rounded-lg border px-2 py-1.5 backdrop-blur-md transition ${selected ? "border-lime-300/55 bg-[#101604]/95 shadow-[0_0_24px_rgba(190,255,60,0.18)]" : "border-white/15 bg-black/75 hover:border-lime-300/40"}`}><span className={`grid size-6 place-items-center rounded-md border border-current/20 bg-current/10 ${toneStyles[marker.tone]}`}><Icon className="size-3.5" /></span><span><span className="block text-[11px] font-semibold text-slate-100">{marker.label}</span><span className="block text-[10px] text-lime-200">{marker.detail}</span></span></span></button>; })}</div><div className="absolute left-3 top-3 flex items-center gap-2 rounded-lg border border-white/10 bg-black/70 px-2.5 py-2 backdrop-blur"><Navigation className="size-3.5 text-amber-300" /><span className="text-[10px] font-medium text-slate-300">VISTA SCHEMATICA · DATI NON DISPONIBILI</span></div><div className="absolute right-3 top-3 flex flex-col gap-1 rounded-lg border border-white/10 bg-black/75 p-1 backdrop-blur"><IconButton label="Zoom in" onClick={() => setMapZoom((current) => Math.min(1.35, Number((current + 0.1).toFixed(2))))} className="size-8 rounded-md border-0 bg-transparent hover:bg-white/10"><ZoomIn className="size-3.5" /></IconButton><IconButton label="Zoom out" onClick={() => setMapZoom((current) => Math.max(0.8, Number((current - 0.1).toFixed(2))))} className="size-8 rounded-md border-0 bg-transparent hover:bg-white/10"><ZoomOut className="size-3.5" /></IconButton><div className="mx-1 h-px bg-white/10" /><IconButton label="Centra vista" onClick={() => { setMapZoom(1); onSelectMarker(""); }} className="size-8 rounded-md border-0 bg-transparent hover:bg-white/10"><LocateFixed className="size-3.5" /></IconButton><IconButton label="Schermo intero" onClick={() => void toggleFullscreen()} className="size-8 rounded-md border-0 bg-transparent hover:bg-white/10"><PanelRight className="size-3.5" /></IconButton></div>{visibleMarkers.length === 0 && <div className="absolute inset-x-0 top-1/2 mx-auto max-w-xs -translate-y-1/2 rounded-xl border border-dashed border-white/15 bg-black/55 px-4 py-3 text-center text-xs leading-5 text-slate-500">Nessun segnale con coordinate nel readback autorizzato.</div>}<div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2"><Tabs value={mapFilter} onValueChange={(value) => onFilterChange(value as OperationalMapFilter)}><TabsList className="h-9 rounded-lg border border-white/10 bg-black/80 p-1 backdrop-blur" aria-label="Filtri mappa"><TabsTrigger className="h-7 rounded-md px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]" value="TUTTI">Tutti</TabsTrigger><TabsTrigger className="h-7 rounded-md px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]" value="ASSET">Asset</TabsTrigger><TabsTrigger className="h-7 rounded-md px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]" value="TEAM">Team</TabsTrigger><TabsTrigger className="h-7 rounded-md px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]" value="LAVORI">Lavori</TabsTrigger><TabsTrigger className="hidden h-7 rounded-md px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006] sm:inline-flex" value="GEOFENCE">Geofence</TabsTrigger></TabsList></Tabs><span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-black/75 px-2.5 py-1.5 text-[9px] uppercase tracking-[0.1em] text-slate-500"><Crosshair className="size-3 text-amber-300" />{visibleMarkers.length} segnali</span></div></div>;
}

export function OperationalMapBoard({ mapFilter, onFilterChange, selectedMarker, onSelectMarker, markers, live = false, onOpenEntity }: { mapFilter: OperationalMapFilter; onFilterChange: (value: OperationalMapFilter) => void; selectedMarker: string; onSelectMarker: (id: string) => void; markers: OperationalMapMarker[]; live?: boolean; onOpenEntity?: (selection: MapEntitySelection) => void }) {
  return <section className="carbon-card rounded-2xl p-3 sm:p-4"><div className="flex flex-wrap items-center justify-between gap-3 px-1 pb-3"><div className="flex items-center gap-3"><span className="grid size-8 place-items-center rounded-lg border border-lime-300/25 bg-lime-300/10 text-lime-200"><MapIcon className="size-4" /></span><div><p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/65">{live ? "CONTROL / LIVE OPERATIONS" : "OPERATIONS / READBACK"}</p><h2 className="text-[15px] font-semibold tracking-[-0.01em] text-slate-100">Mappa operativa</h2><p className="mt-0.5 text-[11px] text-slate-500">{live ? "Cantieri, magazzini, geofence e mezzi autorizzati." : "Vista schematica dal readback autorizzato."}</p></div></div></div>{live ? <LeafletMapSurface mapFilter={mapFilter} onFilterChange={onFilterChange} onOpenEntity={onOpenEntity} onSelectMarker={onSelectMarker} selectedMarker={selectedMarker} /> : <SchematicMapSurface mapFilter={mapFilter} markers={markers} onFilterChange={onFilterChange} onSelectMarker={onSelectMarker} selectedMarker={selectedMarker} />}</section>;
}
