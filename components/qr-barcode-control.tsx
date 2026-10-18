"use client";

/* eslint-disable @next/next/no-img-element -- QR previews are runtime-generated data URLs and must be rendered verbatim. */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import QRCode from "qrcode";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowUpRight,
  Bell,
  BriefcaseBusiness,
  Camera,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  ClipboardList,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Layers3,
  LockKeyhole,
  Menu,
  Package,
  QrCode,
  RefreshCw,
  ScanLine,
  Search,
  ShieldCheck,
  Sparkles,
  Truck,
  Users,
  Warehouse,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Tab = "scan" | "generate";
type EntityType = "asset" | "warehouse" | "commessa";
type ScanStatus = "idle" | "starting" | "scanning" | "success" | "error";
type Tone = "lime" | "cyan" | "amber" | "red";

type QrRecord = {
  id: string;
  format: "QR" | "BARCODE";
  entityType: EntityType;
  entityId: string;
  label: string;
  payload: string;
  createdAt: string;
  updatedAt: string;
  lastScannedAt: string | null;
};

type QrResolved = {
  entityType: EntityType;
  entityId: string;
  title: string;
  detail: string;
  module: "assets" | "warehouse" | "operations";
  canonicalPayload: string;
  source: string;
};

type QrListResponse = { records?: QrRecord[] };
type QrResolveResponse = { resolved?: QrResolved; record?: QrRecord | null; error?: string };
type QrCreateResponse = { created?: QrRecord; error?: string };

const navItems = [
  { label: "CONTROL", id: "command", icon: ClipboardList, href: "/command" },
  { label: "COMMESSE", id: "operations", icon: BriefcaseBusiness, href: "/operations" },
  { label: "FIELD", id: "field", icon: Truck, href: "" },
  { label: "PERSONE", id: "workforce", icon: Users, href: "/workforce" },
  { label: "FINANZA", id: "finance", icon: Layers3, href: "/finance" },
  { label: "ASSETS", id: "assets", icon: Package, href: "/assets" },
  { label: "WAREHOUSE", id: "warehouse", icon: Warehouse, href: "/warehouse" },
  { label: "MISSIONI", id: "mission", icon: Truck, href: "/mission" },
  { label: "DOCUMENTS", id: "documents", icon: FileText, href: "/documents" },
  { label: "QR / BARCODE", id: "qr", icon: QrCode, href: "/qr" },
  { label: "EVENTS / AUTHORITY", id: "events_authority", icon: ShieldCheck, href: "/events" },
  { label: "PWA / DIAGNOSTICS", id: "pwa", icon: CircleDot, href: "/pwa/diagnostics" },
];

const starterTargets: Record<EntityType, { id: string; label: string }> = {
  asset: { id: "", label: "" },
  warehouse: { id: "", label: "" },
  commessa: { id: "", label: "" },
};

const entityLabels: Record<EntityType, string> = {
  asset: "Asset",
  warehouse: "Magazzino",
  commessa: "Commessa",
};

const entityModules: Record<EntityType, { label: string; href: string }> = {
  asset: { label: "Apri Assets", href: "/assets" },
  warehouse: { label: "Apri Magazzino", href: "/warehouse" },
  commessa: { label: "Apri Commesse", href: "/operations" },
};

const toneStyles: Record<Tone, { icon: string; badge: string; line: string }> = {
  lime: { icon: "text-lime-200", badge: "border-lime-300/25 bg-lime-300/10 text-lime-200", line: "bg-lime-300" },
  cyan: { icon: "text-cyan-200", badge: "border-cyan-300/25 bg-cyan-300/10 text-cyan-200", line: "bg-cyan-300" },
  amber: { icon: "text-amber-200", badge: "border-amber-300/25 bg-amber-300/10 text-amber-200", line: "bg-amber-300" },
  red: { icon: "text-rose-200", badge: "border-rose-300/25 bg-rose-300/10 text-rose-200", line: "bg-rose-300" },
};

function IconButton({ label, children, onClick, className = "" }: { label: string; children: ReactNode; onClick?: () => void; className?: string }) {
  return <button aria-label={label} className={`grid size-9 place-items-center rounded-lg border border-white/10 bg-black/20 text-slate-500 transition hover:border-lime-300/35 hover:bg-lime-300/10 hover:text-lime-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300 ${className}`} onClick={onClick} type="button">{children}</button>;
}

function StatusBadge({ children, tone = "lime" }: { children: ReactNode; tone?: Tone }) {
  const style = toneStyles[tone];
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-semibold tracking-[0.05em] ${style.badge}`}><span className="size-1.5 rounded-full bg-current shadow-[0_0_9px_currentColor]" />{children}</span>;
}

function MetricCard({ label, value, detail, icon: Icon, tone }: { label: string; value: string; detail: string; icon: typeof QrCode; tone: Tone }) {
  const style = toneStyles[tone];
  return <article className="carbon-card rounded-2xl p-4"><div className="flex items-start justify-between gap-3"><span className={`grid size-9 place-items-center rounded-xl border border-current/20 bg-current/10 ${style.icon}`}><Icon className="size-[18px]" /></span><StatusBadge tone={tone}>{detail}</StatusBadge></div><p className="mt-4 text-xs text-slate-500">{label}</p><p className="mt-1 font-mono text-[29px] font-semibold leading-none tracking-[-0.06em] text-slate-50">{value}</p><p className="mt-4 text-[10px] text-slate-600">Trend disponibile solo con readback D1.</p></article>;
}

function formatDate(value: string) {
  try {
    return new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  } catch {
    return "—";
  }
}

export default function QrBarcodeControl() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [tab, setTab] = useState<Tab>("scan");
  const [entityType, setEntityType] = useState<EntityType>("asset");
  const [entityId, setEntityId] = useState(starterTargets.asset.id);
  const [label, setLabel] = useState(starterTargets.asset.label);
  const [scannerInput, setScannerInput] = useState("");
  const [scanStatus, setScanStatus] = useState<ScanStatus>("idle");
  const [scanMessage, setScanMessage] = useState("Pronto per QR, Data Matrix, Code 128 e barcode lineari");
  const [resolved, setResolved] = useState<QrResolved | null>(null);
  const [resolvedRecord, setResolvedRecord] = useState<QrRecord | null>(null);
  const [generatedDataUrl, setGeneratedDataUrl] = useState("");
  const [generatedPayload, setGeneratedPayload] = useState("");
  const [generatedRecord, setGeneratedRecord] = useState<QrRecord | null>(null);
  const [records, setRecords] = useState<QrRecord[]>([]);
  const [registryStatus, setRegistryStatus] = useState<"loading" | "online" | "empty" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const notify = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3600);
  };

  const stopScanner = () => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    readerRef.current = null;
    const stream = videoRef.current?.srcObject;
    if (stream instanceof MediaStream) stream.getTracks().forEach((track) => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    setScanStatus("idle");
  };

  const resolveCode = async (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    stopScanner();
    setScanStatus("starting");
    setScanMessage("Readback Sites in corso…");
    try {
      const response = await fetch(`/api/qr?code=${encodeURIComponent(trimmed)}`, { cache: "no-store" });
      const payload = (await response.json()) as QrResolveResponse;
      if (!response.ok || !payload.resolved) throw new Error(payload.error ?? "code_not_resolved");
      setResolved(payload.resolved);
      setResolvedRecord(payload.record ?? null);
      setScannerInput(trimmed);
      setScanStatus("success");
      setScanMessage(`Readback verificato · ${payload.resolved.title}`);
      notify(`Readback OK · ${payload.resolved.entityId}`);
    } catch {
      setResolved(null);
      setResolvedRecord(null);
      setScanStatus("error");
      setScanMessage("Codice non riconosciuto nel tenant Sites");
      notify("Nessun elemento collegato a questo codice");
    }
  };

  const startScanner = async () => {
    if (!videoRef.current) return;
    stopScanner();
    setResolved(null);
    setResolvedRecord(null);
    setScanStatus("starting");
    setScanMessage("Richiesta fotocamera e avvio scanner locale…");
    try {
      const reader = new BrowserMultiFormatReader();
      readerRef.current = reader;
      const controls = await reader.decodeFromVideoDevice(undefined, videoRef.current, (result) => {
        if (result) void resolveCode(result.getText());
      });
      controlsRef.current = controls;
      setScanStatus("scanning");
      setScanMessage("Scanner attivo · inquadra un QR o un barcode");
    } catch {
      setScanStatus("error");
      setScanMessage("Fotocamera non disponibile · usa il campo di readback manuale");
      notify("Scanner locale non avviato: puoi comunque usare il readback manuale");
    }
  };

  const loadRegistry = async () => {
    try {
      const response = await fetch("/api/qr", { cache: "no-store" });
      if (!response.ok) throw new Error("qr_registry_unavailable");
      const payload = (await response.json()) as QrListResponse;
      const nextRecords = Array.isArray(payload.records) ? payload.records : [];
      setRecords(nextRecords);
      setRegistryStatus(nextRecords.length ? "online" : "empty");
    } catch {
      setRecords([]);
      setRegistryStatus("error");
    }
  };

  useEffect(() => {
    const videoElement = videoRef.current;
    queueMicrotask(() => void loadRegistry());
    return () => {
      controlsRef.current?.stop();
      readerRef.current = null;
      const stream = videoElement?.srcObject;
      if (stream instanceof MediaStream) stream.getTracks().forEach((track) => track.stop());
    };
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect -- form defaults follow the selected QR domain. */
  useEffect(() => {
    const target = starterTargets[entityType];
    setEntityId(target.id);
    setLabel(target.label);
  }, [entityType]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    return () => {
      readerRef.current = null;
      controlsRef.current?.stop();
    };
  }, []);

  const generateQr = async () => {
    const normalizedId = entityId.trim().toUpperCase();
    if (!normalizedId) {
      notify("Inserisci un identificativo prima di generare il QR");
      return;
    }
    setBusy(true);
    setTab("generate");
    try {
      const response = await fetch("/api/qr", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entityType, entityId: normalizedId, label: label.trim() }),
      });
      const payload = (await response.json()) as QrCreateResponse;
      if (!response.ok || !payload.created) throw new Error(payload.error ?? "qr_create_failed");
      const dataUrl = await QRCode.toDataURL(payload.created.payload, {
        width: 300,
        margin: 2,
        errorCorrectionLevel: "M",
        color: { dark: "#050607", light: "#efffb9" },
      });
      setGeneratedDataUrl(dataUrl);
      setGeneratedPayload(payload.created.payload);
      setGeneratedRecord(payload.created);
      setRecords((current) => [payload.created!, ...current.filter((record) => record.id !== payload.created!.id)]);
      notify("QR generato e registrato nel readback Sites");
    } catch {
      notify("Impossibile registrare il QR: verifica il readback Sites");
    } finally {
      setBusy(false);
    }
  };

  const copyValue = async (value: string, message: string) => {
    try {
      await navigator.clipboard.writeText(value);
      notify(message);
    } catch {
      notify("Copia non disponibile in questo browser");
    }
  };

  const downloadQr = () => {
    if (!generatedDataUrl || !generatedRecord) return;
    const anchor = document.createElement("a");
    anchor.href = generatedDataUrl;
    anchor.download = `ai-zerow-${generatedRecord.entityId.toLowerCase()}.png`;
    anchor.click();
  };

  const navigate = (item: (typeof navItems)[number]) => {
    setMobileMenu(false);
    if (item.href) router.push(item.href);
    else notify(`${item.label}: sezione prevista nel prossimo adapter`);
  };

  const registryCount = records.length;
  const linkedDomains = new Set(records.map((record) => record.entityType)).size;
  const scanTone: Tone = scanStatus === "success" ? "lime" : scanStatus === "error" ? "red" : scanStatus === "scanning" ? "cyan" : "amber";

  return <main className="min-h-screen overflow-x-hidden bg-[#050607] text-slate-100 selection:bg-lime-300 selection:text-[#060806]"><div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_74%_0%,rgba(190,255,60,0.08),transparent_25%),radial-gradient(circle_at_18%_78%,rgba(70,110,120,0.08),transparent_27%)]" /><div className="relative flex min-h-screen">
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-[232px] flex-col border-r border-lime-300/10 bg-[#050607]/96 px-3 py-4 backdrop-blur-xl transition-transform lg:static lg:translate-x-0 ${mobileMenu ? "translate-x-0" : "-translate-x-full"}`}>
      <div className="flex items-center justify-between px-2"><button className="flex items-center gap-3 text-left" onClick={() => { setMobileMenu(false); router.push("/command"); }} type="button"><span className="neon-pulse relative grid size-10 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black"><Image src="/ai-zerow-icon.jpeg" alt="AI-ZEROW" className="size-full object-cover" height={40} width={40} /></span><span><span className="block text-sm font-bold tracking-[0.18em] text-slate-50">AI-ZEROW</span><span className="block text-[10px] uppercase tracking-[0.22em] text-lime-300/75">command</span></span></button><button className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-white/5 hover:text-white lg:hidden" onClick={() => setMobileMenu(false)} type="button" aria-label="Chiudi menu"><X className="size-4" /></button></div>
      <button className="carbon-card mt-8 flex w-full items-center gap-3 rounded-xl p-3 text-left transition hover:border-lime-300/25" type="button" onClick={() => notify("Workspace ZEROW · tenant corrente")}><span className="grid size-8 place-items-center rounded-lg border border-lime-300/20 bg-lime-300/10 text-lime-200"><LockKeyhole className="size-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-slate-200">ZEROW workspace</span><span className="mt-0.5 block truncate text-[10px] text-slate-600">perimetro tenant autorizzato</span></span><ArrowUpRight className="size-3.5 text-slate-600" /></button>
      <nav className="mt-7 flex-1" aria-label="Navigazione principale"><p className="px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-600">Workspace</p><div className="mt-2 space-y-1">{navItems.map((item) => { const Icon = item.icon; const active = item.id === "qr"; return <button aria-current={active ? "page" : undefined} className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${active ? "border border-lime-300/20 bg-lime-300/10 text-lime-200 shadow-[inset_0_0_20px_rgba(190,255,60,0.04)]" : "text-slate-500 hover:bg-white/[0.045] hover:text-slate-100"}`} key={item.id} onClick={() => navigate(item)} type="button"><Icon className={`size-4 ${active ? "text-lime-200" : "text-slate-600 group-hover:text-slate-300"}`} /><span>{item.label}</span>{item.id === "command" && <span className="ml-auto rounded border border-white/10 px-1.5 py-0.5 font-mono text-[8px] tracking-[0.08em] text-slate-600">AI</span>}</button>; })}</div></nav>
      <div className="mt-5 border-t border-white/[0.08] pt-4"><div className="flex items-center justify-between px-2 text-[10px] uppercase tracking-[0.14em] text-slate-600"><span>Stato sistema</span><span className="flex items-center gap-1.5 text-lime-200"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_8px_rgba(190,255,60,0.8)]" />online</span></div><div className="carbon-inset mt-3 rounded-xl p-3"><div className="flex items-center gap-2 text-[10px] text-slate-400"><ScanLine className="size-3.5 text-lime-300" />Local scanner</div><p className="mt-2 font-mono text-[9px] text-slate-600">SITES · no external provider</p><p className="mt-3 font-mono text-[9px] text-slate-600">SITES · NO EXTERNAL PROVIDER</p></div></div>
    </aside>
    {mobileMenu && <button className="fixed inset-0 z-30 bg-black/75 lg:hidden" onClick={() => setMobileMenu(false)} aria-label="Chiudi menu" type="button" />}
    <section className="min-w-0 flex-1"><header className="zw-command-topbar sticky top-0 z-20 flex h-[72px] items-center gap-3 border-b border-white/[0.08] bg-[#050607]/88 px-4 backdrop-blur-xl sm:gap-5 sm:px-7"><IconButton label="Apri menu" onClick={() => setMobileMenu(true)} className="lg:hidden"><Menu className="size-4" /></IconButton><div className="relative hidden min-w-0 flex-1 md:block"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-600" /><Input aria-label="Cerca QR e barcode" className="h-10 max-w-[440px] border-white/10 bg-black/30 pl-10 text-xs text-slate-100 placeholder:text-slate-600 focus-visible:border-lime-300/40" placeholder="Cerca codice, asset, commessa…" onChange={(event) => setScannerInput(event.target.value)} value={scannerInput} /></div><div className="flex min-w-0 flex-1 items-center gap-2 md:hidden"><span className="truncate text-xs font-semibold tracking-[0.14em] text-slate-200">QR / BARCODE</span><span className="size-1 rounded-full bg-lime-300" /></div><div className="ml-auto flex items-center gap-2"><span className="hidden items-center gap-2 rounded-full border border-lime-300/20 bg-lime-300/5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-lime-200 sm:flex"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_9px_rgba(190,255,60,0.9)]" />Modalità privata</span><IconButton label="Aggiorna registro" onClick={() => void loadRegistry()}><RefreshCw className="size-4" /></IconButton><IconButton label="Notifiche" onClick={() => notify("QR / Barcode: nessuna notifica runtime collegata")}><Bell className="size-4" /></IconButton><span className="hidden size-8 place-items-center rounded-full border border-white/15 bg-gradient-to-br from-slate-200 to-slate-500 text-xs font-bold text-[#080a0b] sm:grid">AB</span><div className="hidden text-right lg:block"><p className="text-xs font-medium text-slate-200">Titolare</p><p className="text-[10px] text-slate-600">Tenant corrente</p></div><ChevronDown className="hidden size-3.5 text-slate-500 lg:block" /></div></header>
      <div className="mx-auto max-w-[1680px] px-4 py-5 sm:px-7 sm:py-7"><div className="mb-5 flex flex-wrap items-end justify-between gap-4"><div><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/70"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_9px_rgba(190,255,60,0.9)]" />AI-ZEROW / OPERATIONS / QR & BARCODE</div><h1 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-50 sm:text-[28px]">QR & Barcode control</h1><p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">Scansiona sul campo e gestisci i codici operativi. Per i materiali, la registrazione e il QR server-side partono da Warehouse.</p></div><div className="flex items-center gap-2"><StatusBadge tone="lime">SITES ONLY</StatusBadge><StatusBadge tone="cyan">NO EXTERNAL SERVICE</StatusBadge></div></div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="Codici registrati" value={String(registryCount)} detail={registryStatus === "online" ? "D1 VERIFIED" : registryStatus === "empty" ? "PRONTO" : "READBACK"} icon={QrCode} tone="lime" /><MetricCard label="Domini collegati" value={String(linkedDomains)} detail="ASSET · STOCK · JOB" icon={Package} tone="cyan" /><MetricCard label="Scanner locale" value="LIVE" detail="QR + BARCODE" icon={ScanLine} tone="lime" /><MetricCard label="Provider esterni" value="0" detail="BOUNDARY CLOSED" icon={ShieldCheck} tone="amber" /></div>
        <div className="mt-4 grid gap-4 2xl:grid-cols-[minmax(0,1.24fr)_minmax(380px,0.76fr)]"><section className="carbon-card-neon rounded-2xl p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/70">OPERATING DECK / LOCAL I/O</p><h2 className="mt-1 text-[17px] font-semibold text-slate-100">Scanner e generatore</h2><p className="mt-1 text-[11px] text-slate-500">La camera e il rendering del QR restano nel browser; il solo readback passa dall’API privata Sites.</p></div><span className="flex items-center gap-2 rounded-full border border-lime-300/20 bg-lime-300/5 px-2.5 py-1.5 text-[10px] text-lime-200"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_8px_rgba(190,255,60,0.9)]" />LOCAL PIPELINE</span></div><div className="mt-5 flex items-center gap-1 rounded-xl border border-white/10 bg-black/35 p-1"><button className={`flex-1 rounded-lg px-3 py-2.5 text-xs font-semibold transition ${tab === "scan" ? "bg-lime-300 text-[#071006] shadow-[0_0_18px_rgba(190,255,60,0.14)]" : "text-slate-500 hover:text-slate-200"}`} onClick={() => setTab("scan")} type="button"><ScanLine className="mr-2 inline size-3.5" />Scansiona</button><button className={`flex-1 rounded-lg px-3 py-2.5 text-xs font-semibold transition ${tab === "generate" ? "bg-lime-300 text-[#071006] shadow-[0_0_18px_rgba(190,255,60,0.14)]" : "text-slate-500 hover:text-slate-200"}`} onClick={() => setTab("generate")} type="button"><QrCode className="mr-2 inline size-3.5" />Genera QR</button></div>
          {tab === "scan" ? <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(300px,0.9fr)]"><div><div className="relative min-h-[270px] overflow-hidden rounded-2xl border border-lime-300/20 bg-[#020303] shadow-[inset_0_0_60px_rgba(190,255,60,0.06)]"><video ref={videoRef} className="h-full min-h-[270px] w-full object-cover opacity-80" autoPlay muted playsInline /><div className="pointer-events-none absolute inset-8 rounded-xl border border-lime-300/20"><span className="absolute -left-px -top-px size-8 border-l-2 border-t-2 border-lime-300" /><span className="absolute -right-px -top-px size-8 border-r-2 border-t-2 border-lime-300" /><span className="absolute -bottom-px -left-px size-8 border-b-2 border-l-2 border-lime-300" /><span className="absolute -bottom-px -right-px size-8 border-b-2 border-r-2 border-lime-300" /><span className="absolute inset-x-5 top-1/2 h-px bg-lime-300/70 shadow-[0_0_12px_rgba(190,255,60,0.9)]" /></div>{scanStatus !== "scanning" && <div className="absolute inset-0 grid place-items-center bg-black/60"><div className="text-center"><span className="mx-auto grid size-14 place-items-center rounded-2xl border border-lime-300/25 bg-lime-300/10 text-lime-200"><Camera className="size-6" /></span><p className="mt-3 text-xs font-semibold text-slate-200">Scanner pronto</p><p className="mt-1 text-[11px] text-slate-600">Avvia la fotocamera per leggere il codice</p></div></div>}</div><div className="mt-3 flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><StatusBadge tone={scanTone}>{scanStatus === "scanning" ? "SCANNING" : scanStatus === "success" ? "READBACK OK" : scanStatus === "error" ? "MANUAL FALLBACK" : "READY"}</StatusBadge><span className="text-[10px] text-slate-600">{scanMessage}</span></div>{scanStatus === "scanning" ? <Button variant="outline" className="h-9 border-rose-300/20 bg-rose-300/5 text-xs text-rose-200 hover:bg-rose-300/10" onClick={stopScanner}><X className="size-3.5" />Ferma camera</Button> : <Button className="h-9 bg-lime-300 px-3 text-xs font-semibold text-[#060806] shadow-[0_0_18px_rgba(190,255,60,0.16)] hover:bg-lime-200" onClick={() => void startScanner()}><Camera className="size-3.5" />Avvia scanner</Button>}</div></div><div className="carbon-inset rounded-2xl p-4"><div className="flex items-start gap-3"><span className="grid size-9 place-items-center rounded-xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-200"><Search className="size-[18px]" /></span><div><p className="text-xs font-semibold text-slate-200">Readback manuale</p><p className="mt-1 text-[11px] leading-5 text-slate-600">Incolla un payload AI-ZEROW oppure un identificativo reale del tenant.</p></div></div><div className="mt-4 flex gap-2"><Input aria-label="Codice QR o barcode" className="h-10 border-white/10 bg-black/35 font-mono text-xs text-slate-100 placeholder:text-slate-700" placeholder="AZ1|ASSET|<ID>" value={scannerInput} onChange={(event) => setScannerInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void resolveCode(scannerInput); }} /><Button className="h-10 bg-lime-300 px-3 text-xs font-semibold text-[#060806] hover:bg-lime-200" onClick={() => void resolveCode(scannerInput)}><ArrowUpRight className="size-3.5" />Leggi</Button></div>{resolved && <div className="mt-4 rounded-xl border border-lime-300/25 bg-lime-300/[0.055] p-3"><div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-lg border border-lime-300/25 bg-lime-300/10 text-lime-200"><CheckCircle2 className="size-4" /></span><div className="min-w-0"><p className="truncate text-xs font-semibold text-slate-100">{resolved.title}</p><p className="mt-1 truncate text-[10px] text-slate-500">{resolved.entityId} · {resolved.detail}</p></div></div><StatusBadge tone="lime">VERIFIED</StatusBadge></div><div className="mt-3 flex flex-wrap items-center justify-between gap-2"><span className="font-mono text-[10px] text-cyan-200/80">{resolved.canonicalPayload}</span><div className="flex items-center gap-2"><button className="text-[10px] text-slate-500 hover:text-lime-200" onClick={() => void copyValue(resolved.canonicalPayload, "Payload copiato")} type="button"><Copy className="mr-1 inline size-3" />Copia</button><button className="flex items-center gap-1 text-[10px] text-lime-300 hover:text-lime-100" onClick={() => router.push(entityModules[resolved.entityType].href)} type="button">{entityModules[resolved.entityType].label}<ExternalLink className="size-3" /></button></div></div>{resolvedRecord && <p className="mt-2 text-[10px] text-slate-600">Registro: {resolvedRecord.id} · {resolvedRecord.lastScannedAt ? `ultimo scan ${formatDate(resolvedRecord.lastScannedAt)}` : "codice registrato"}</p>}</div>}</div></div> : <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,0.82fr)_minmax(260px,0.58fr)]"><div className="carbon-inset rounded-2xl p-4"><div className="grid gap-3 sm:grid-cols-2"><label className="text-[11px] text-slate-500"><span className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">Dominio</span><select aria-label="Dominio QR" className="h-10 w-full rounded-lg border border-white/10 bg-black/40 px-3 text-xs text-slate-100 outline-none focus:border-lime-300/40" value={entityType} onChange={(event) => setEntityType(event.target.value as EntityType)}><option value="asset">Asset</option><option value="warehouse">Magazzino</option><option value="commessa">Commessa</option></select></label><label className="text-[11px] text-slate-500"><span className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">Identificativo</span><Input aria-label="Identificativo elemento" className="h-10 border-white/10 bg-black/40 font-mono text-xs text-slate-100" value={entityId} onChange={(event) => setEntityId(event.target.value)} placeholder="ID elemento" /></label></div><label className="mt-3 block text-[11px] text-slate-500"><span className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">Etichetta leggibile</span><Input aria-label="Etichetta QR" className="h-10 border-white/10 bg-black/40 text-xs text-slate-100" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Nome elemento" /></label><div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="max-w-md text-[10px] leading-5 text-slate-600">Il payload resta corto e stabile: il codice non contiene dati sensibili, solo il riferimento operativo canonico.</p><Button className="h-10 bg-lime-300 px-4 text-xs font-semibold text-[#060806] shadow-[0_0_18px_rgba(190,255,60,0.16)] hover:bg-lime-200" onClick={() => void generateQr()} disabled={busy}><Sparkles className="size-3.5" />{busy ? "Generazione…" : "Genera e registra"}</Button></div></div><div className="carbon-inset relative min-h-[300px] rounded-2xl p-4"><div className="flex items-center justify-between gap-2"><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-lime-300/70">OUTPUT / QR</p><p className="mt-1 text-[11px] text-slate-500">Anteprima scanner-ready</p></div>{generatedRecord && <StatusBadge tone="lime">{generatedRecord.format}</StatusBadge>}</div>{generatedDataUrl ? <div className="mt-4 flex flex-col items-center"><div className="rounded-2xl border border-lime-300/25 bg-[#efffb9] p-3 shadow-[0_0_32px_rgba(190,255,60,0.11)]"><img src={generatedDataUrl} alt={`QR ${generatedRecord?.entityId ?? "generato"}`} className="size-[218px] sm:size-[240px]" /></div><div className="mt-3 flex w-full items-center gap-2"><Button variant="outline" className="h-9 flex-1 border-white/10 bg-black/25 text-xs text-slate-300 hover:border-lime-300/30 hover:text-lime-100" onClick={() => void copyValue(generatedPayload, "Payload QR copiato")}><Copy className="size-3.5" />Copia payload</Button><Button className="h-9 flex-1 bg-lime-300 text-xs font-semibold text-[#060806] hover:bg-lime-200" onClick={downloadQr}><Download className="size-3.5" />Scarica PNG</Button></div><p className="mt-3 max-w-full truncate font-mono text-[10px] text-slate-600">{generatedPayload}</p></div> : <div className="grid min-h-[245px] place-items-center text-center"><div><span className="mx-auto grid size-14 place-items-center rounded-2xl border border-white/10 bg-black/25 text-slate-600"><QrCode className="size-7" /></span><p className="mt-3 text-xs text-slate-400">Nessun QR generato</p><p className="mt-1 text-[10px] text-slate-600">Configura il dominio e genera il primo codice</p></div></div>}</div></div>}
        </section><aside className="space-y-4"><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/70">REGISTRY / READBACK</p><h2 className="mt-1 text-[15px] font-semibold">Codici recenti</h2><p className="mt-1 text-[11px] text-slate-500">Indice D1 tenant-scoped · ultimo aggiornamento in alto.</p></div><IconButton label="Aggiorna codici" onClick={() => void loadRegistry()}><RefreshCw className="size-4" /></IconButton></div><div className="mt-4 space-y-2">{records.slice(0, 6).map((record) => <button className="flex w-full items-center gap-3 rounded-xl border border-white/[0.08] bg-black/20 p-3 text-left transition hover:border-lime-300/25 hover:bg-lime-300/[0.04]" key={record.id} onClick={() => { setEntityType(record.entityType); setEntityId(record.entityId); setLabel(record.label); setTab("generate"); }} type="button"><span className="grid size-9 shrink-0 place-items-center rounded-lg border border-lime-300/15 bg-lime-300/5 text-lime-200"><QrCode className="size-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-slate-200">{record.entityId} · {record.label}</span><span className="mt-1 block truncate text-[10px] text-slate-600">{entityLabels[record.entityType]} · {formatDate(record.updatedAt)}</span></span><ArrowUpRight className="size-3.5 text-slate-600" /></button>)}{registryStatus === "loading" && <p className="py-6 text-center text-xs text-slate-600">Readback in corso…</p>}{registryStatus === "empty" && <p className="py-6 text-center text-xs text-slate-600">Nessun codice registrato. Genera il primo QR.</p>}{registryStatus === "error" && <div className="rounded-xl border border-amber-300/20 bg-amber-300/[0.06] p-3 text-[11px] leading-5 text-amber-100"><AlertTriangle className="mr-2 inline size-3.5" />Registro temporaneamente non disponibile.</div>}</div><div className="mt-4 flex items-center justify-between border-t border-white/[0.08] pt-3 text-[10px] text-slate-600"><span className="flex items-center gap-2"><span className={`size-1.5 rounded-full ${registryStatus === "online" ? "bg-lime-300" : "bg-amber-300"}`} />{registryStatus === "online" ? "D1 readback verificato" : "Readback da eseguire"}</span><span>{registryCount} record</span></div></section><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start gap-3"><span className="grid size-9 place-items-center rounded-xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-200"><ScanLine className="size-[18px]" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-200/70">CODE CONTRACT</p><h2 className="mt-1 text-[15px] font-semibold">Un codice, tre superfici</h2></div></div><div className="mt-4 space-y-2"><div className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 p-3"><Package className="size-4 text-lime-200" /><div><p className="text-xs text-slate-200">Asset</p><p className="mt-0.5 text-[10px] text-slate-600">Matricole e mezzi operativi</p></div></div><div className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 p-3"><Warehouse className="size-4 text-cyan-200" /><div><p className="text-xs text-slate-200">Magazzino</p><p className="mt-0.5 text-[10px] text-slate-600">Materiali, richieste e batch</p></div></div><div className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 p-3"><BriefcaseBusiness className="size-4 text-amber-200" /><div><p className="text-xs text-slate-200">Commesse</p><p className="mt-0.5 text-[10px] text-slate-600">Lavori, attività ed evidenze</p></div></div></div></section><section className="carbon-card-neon rounded-2xl p-4 sm:p-5"><div className="flex items-start gap-3"><span className="grid size-9 place-items-center rounded-xl border border-lime-300/25 bg-lime-300/10 text-lime-200"><ShieldCheck className="size-[18px]" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/70">BOUNDARY</p><h2 className="mt-1 text-[15px] font-semibold">Operativo senza provider</h2></div></div><p className="mt-3 text-[11px] leading-5 text-slate-500">Generatori e scanner sono bundled nel Site. D1 conserva solo il registro necessario per rilettura, titolarità e verifica dei collegamenti.</p><div className="mt-4 grid grid-cols-2 gap-2"><div className="carbon-inset rounded-xl p-3"><p className="text-[10px] text-slate-600">Camera</p><p className="mt-1 text-xs text-lime-200">LOCAL</p></div><div className="carbon-inset rounded-xl p-3"><p className="text-[10px] text-slate-600">Persistenza</p><p className="mt-1 text-xs text-cyan-200">D1 SITES</p></div></div></section></aside></div>
        <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] py-5 text-[10px] text-slate-600"><span>AI-ZEROW COMMAND · QR & BARCODE · OPERATIONAL MODULE</span><span className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_8px_rgba(190,255,60,0.8)]" />Sites privato · riservato al titolare · nessun provider esterno</span></footer>
      </div>
    </section>
  </div>{notice && <button className="fixed bottom-5 right-5 z-50 max-w-[360px] rounded-xl border border-lime-300/25 bg-[#0a100c]/95 px-4 py-3 text-left text-xs text-lime-100 shadow-[0_0_28px_rgba(190,255,60,0.14)]" onClick={() => setNotice("")} type="button">{notice}</button>}</main>;
}
