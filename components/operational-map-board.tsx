"use client";

import { useRef, useState, type ReactNode } from "react";
import {
  Crosshair,
  LocateFixed,
  Map as MapIcon,
  Navigation,
  PanelRight,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";
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

const toneStyles: Record<OperationalMapTone, string> = {
  lime: "text-lime-300",
  amber: "text-amber-300",
  cyan: "text-cyan-300",
  red: "text-rose-300",
};

function IconButton({ label, children, onClick, className = "" }: { label: string; children: ReactNode; onClick: () => void; className?: string }) {
  return <button aria-label={label} className={`grid size-9 place-items-center rounded-lg border border-white/10 bg-black/20 text-slate-500 transition hover:border-lime-300/35 hover:bg-lime-300/10 hover:text-lime-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300 ${className}`} onClick={onClick} type="button">{children}</button>;
}

export function OperationalMapBoard({
  mapFilter,
  onFilterChange,
  selectedMarker,
  onSelectMarker,
  markers,
}: {
  mapFilter: OperationalMapFilter;
  onFilterChange: (value: OperationalMapFilter) => void;
  selectedMarker: string;
  onSelectMarker: (id: string) => void;
  markers: OperationalMapMarker[];
}) {
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

  return (
    <section className="carbon-card rounded-2xl p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 px-1 pb-3">
        <div className="flex items-center gap-3">
          <span className="grid size-8 place-items-center rounded-lg border border-lime-300/25 bg-lime-300/10 text-lime-200"><MapIcon className="size-4" /></span>
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/65">OPERATIONS / READBACK</p>
            <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-slate-100">Mappa operativa</h2>
            <p className="mt-0.5 text-[11px] text-slate-500">Vista schematica dal readback D1 · provider mappa/GPS non collegato</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-1.5 rounded-full border border-amber-300/20 bg-amber-300/5 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-amber-100 sm:flex"><span className="size-1.5 rounded-full bg-amber-300" />SCHEMATICA</span>
          <IconButton label="Schermo intero" onClick={() => void toggleFullscreen()}><PanelRight className="size-4" /></IconButton>
        </div>
      </div>

      <div ref={mapSurfaceRef} className="relative min-h-[360px] overflow-hidden rounded-xl border border-white/10 bg-[#050607] sm:min-h-[430px]">
        <div className="absolute inset-0 transition-transform duration-200" style={{ transform: `scale(${mapZoom})`, transformOrigin: "center" }}>
          <div className="map-grid absolute inset-0 opacity-80" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_52%_48%,rgba(190,255,60,0.12),transparent_25%),radial-gradient(circle_at_16%_80%,rgba(65,224,255,0.07),transparent_22%)]" />
          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 900 500" preserveAspectRatio="none" aria-label="Mappa operativa schematica">
            <path d="M0 84C110 132 128 24 226 76S384 152 480 91 643 44 900 103" fill="none" stroke="rgba(104,123,128,0.25)" strokeWidth="2" />
            <path d="M0 216C95 190 116 288 250 232S410 186 506 262 708 348 900 270" fill="none" stroke="rgba(113,135,138,0.22)" strokeWidth="2" />
            <path d="M-20 384C112 323 151 428 292 356S472 330 585 398 748 437 930 347" fill="none" stroke="rgba(113,135,138,0.2)" strokeWidth="2" />
            <path d="M112 -10C158 86 121 152 196 224S255 350 212 530M333 -10C305 104 358 168 321 274S328 401 380 530M588 -10C554 98 622 184 565 280S580 423 631 530M776 -10C713 111 784 196 735 296S771 431 731 530" fill="none" stroke="rgba(99,116,120,0.16)" strokeWidth="1.5" />
            <path d="M90 402L195 294L322 343L390 189L524 247L620 130L766 177L849 82" fill="none" stroke="rgba(190,255,60,0.72)" strokeDasharray="5 8" strokeLinecap="round" strokeWidth="2" />
            <path d="M90 402L195 294L322 343L390 189L524 247L620 130L766 177L849 82" fill="none" opacity="0.24" stroke="rgba(190,255,60,0.85)" strokeLinecap="round" strokeWidth="10" />
            <circle cx="390" cy="189" r="4" fill="#d6ff4c" />
            <circle cx="620" cy="130" r="4" fill="#d6ff4c" />
            <circle cx="195" cy="294" r="4" fill="#d6ff4c" />
          </svg>
          {visibleMarkers.map((marker) => {
            const Icon = marker.icon;
            const selected = selectedMarker === marker.id;
            return <button key={marker.id} className="absolute -translate-x-1/2 -translate-y-1/2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300" style={{ left: marker.x, top: marker.y }} onClick={() => onSelectMarker(marker.id)} type="button"><span className={`absolute -inset-2 rounded-full border border-lime-300/35 ${selected ? "animate-pulse bg-lime-300/15" : "opacity-0"}`} /><span className={`relative flex items-center gap-2 rounded-lg border px-2 py-1.5 backdrop-blur-md transition ${selected ? "border-lime-300/55 bg-[#101604]/95 shadow-[0_0_24px_rgba(190,255,60,0.18)]" : "border-white/15 bg-black/75 hover:border-lime-300/40"}`}><span className={`grid size-6 place-items-center rounded-md border border-current/20 bg-current/10 ${toneStyles[marker.tone]}`}><Icon className="size-3.5" /></span><span><span className="block text-[11px] font-semibold text-slate-100">{marker.label}</span><span className="block text-[10px] text-lime-200">{marker.detail}</span></span></span></button>;
          })}
        </div>

        <div className="absolute left-3 top-3 flex items-center gap-2 rounded-lg border border-white/10 bg-black/70 px-2.5 py-2 backdrop-blur"><Navigation className="size-3.5 text-amber-300" /><span className="text-[10px] font-medium text-slate-300">VISTA SCHEMATICA · D1 readback</span></div>
        <div className="absolute right-3 top-3 flex flex-col gap-1 rounded-lg border border-white/10 bg-black/75 p-1 backdrop-blur">
          <IconButton label="Zoom in" onClick={() => setMapZoom((current) => Math.min(1.35, Number((current + 0.1).toFixed(2))))} className="size-8 rounded-md border-0 bg-transparent hover:bg-white/10"><ZoomIn className="size-3.5" /></IconButton>
          <IconButton label="Zoom out" onClick={() => setMapZoom((current) => Math.max(0.8, Number((current - 0.1).toFixed(2))))} className="size-8 rounded-md border-0 bg-transparent hover:bg-white/10"><ZoomOut className="size-3.5" /></IconButton>
          <div className="mx-1 h-px bg-white/10" />
          <IconButton label="Centra vista" onClick={() => { setMapZoom(1); onSelectMarker(""); }} className="size-8 rounded-md border-0 bg-transparent hover:bg-white/10"><LocateFixed className="size-3.5" /></IconButton>
        </div>
        {visibleMarkers.length === 0 && <div className="absolute inset-x-0 top-1/2 mx-auto max-w-xs -translate-y-1/2 rounded-xl border border-dashed border-white/15 bg-black/55 px-4 py-3 text-center text-xs leading-5 text-slate-500">Nessun segnale con coordinate nel readback D1. GPS/provider non collegato.</div>}
        <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2">
          <Tabs value={mapFilter} onValueChange={(value) => onFilterChange(value as OperationalMapFilter)}>
            <TabsList className="h-9 rounded-lg border border-white/10 bg-black/80 p-1 backdrop-blur" aria-label="Filtri mappa">
              <TabsTrigger className="h-7 rounded-md px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]" value="TUTTI">Tutti</TabsTrigger>
              <TabsTrigger className="h-7 rounded-md px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]" value="ASSET">Asset</TabsTrigger>
              <TabsTrigger className="h-7 rounded-md px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]" value="TEAM">Team</TabsTrigger>
              <TabsTrigger className="h-7 rounded-md px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006]" value="LAVORI">Lavori</TabsTrigger>
              <TabsTrigger className="hidden h-7 rounded-md px-3 text-[10px] text-slate-500 data-[state=active]:bg-lime-300 data-[state=active]:text-[#071006] sm:inline-flex" value="GEOFENCE">Geofence</TabsTrigger>
            </TabsList>
          </Tabs>
          <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-black/75 px-2.5 py-1.5 text-[9px] uppercase tracking-[0.1em] text-slate-500"><Crosshair className="size-3 text-amber-300" />{visibleMarkers.length} segnali</span>
        </div>
      </div>
    </section>
  );
}
