"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowLeft,
  Bell,
  Check,
  CheckCircle2,
  Cloud,
  CloudOff,
  Database,
  Download,
  HardDrive,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  ShieldCheck,
  Smartphone,
  Wifi,
  WifiOff,
  X,
  type LucideIcon,
} from "lucide-react";
import { AccountMenu, type AccountActor } from "@/components/account-menu";
import { CommandMobileNav } from "@/components/command-mobile-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CommandNavigationId, CommandSurfaceAccess } from "@/lib/command-dashboard";
import { RELEASE_BUILD_ID, RELEASE_BUILD_LABEL } from "@/lib/release";

type QueueItem = {
  id: string;
  eventType: string;
  createdAt: string;
  attempts: number;
  aggregateVersion?: number;
  payload: Record<string, unknown>;
};

type CheckState =
  | "checking"
  | "ready"
  | "active"
  | "available"
  | "installed"
  | "installing"
  | "waiting"
  | "offline"
  | "not_observed"
  | "unsupported"
  | "unregistered"
  | "error";

type ViewId = "overview" | "queue" | "install";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DB_NAME = "zerow-offline";
const STORE_NAME = "queue";

const NAV_ITEMS: Array<{ id: CommandNavigationId; label: string; path: string; icon: LucideIcon }> = [
  { id: "command", label: "Command", path: "/command", icon: Activity },
  { id: "operations", label: "Commesse", path: "/operations", icon: CheckCircle2 },
  { id: "workforce", label: "Workforce", path: "/workforce", icon: Smartphone },
  { id: "planning", label: "Pianificazione", path: "/planning", icon: Activity },
  { id: "attendance", label: "Presenze", path: "/presenze", icon: Check },
  { id: "finance", label: "Finance", path: "/finance", icon: Database },
  { id: "procurement", label: "Procurement", path: "/procurement", icon: HardDrive },
  { id: "assets", label: "Asset", path: "/assets", icon: HardDrive },
  { id: "warehouse", label: "Magazzino", path: "/warehouse", icon: Database },
  { id: "mission", label: "Missioni", path: "/mission", icon: Cloud },
  { id: "documents", label: "Documenti", path: "/documents", icon: Database },
  { id: "governance", label: "Governance", path: "/governance", icon: ShieldCheck },
  { id: "communications", label: "Comunicazioni", path: "/communications", icon: Bell },
  { id: "externals", label: "Adapter esterni", path: "/externals", icon: Cloud },
  { id: "authority", label: "Authority", path: "/onboarding", icon: ShieldCheck },
  { id: "events", label: "Eventi", path: "/events", icon: Activity },
  { id: "pwa", label: "PWA / Mobile", path: "/pwa/diagnostics", icon: Smartphone },
  { id: "settings", label: "Impostazioni", path: "/settings", icon: HardDrive },
];

function openQueueDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("indexeddb_unavailable"));
      return;
    }

    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexeddb_open_failed"));
  });
}

async function readQueue(): Promise<QueueItem[]> {
  const db = await openQueueDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
    request.onsuccess = () => {
      db.close();
      resolve((request.result as QueueItem[]).sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    };
    request.onerror = () => {
      db.close();
      reject(request.error ?? new Error("indexeddb_read_failed"));
    };
  });
}

async function writeQueue(item: QueueItem) {
  const db = await openQueueDb();
  return new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(item);
    request.onsuccess = () => {
      db.close();
      resolve();
    };
    request.onerror = () => {
      db.close();
      reject(request.error ?? new Error("indexeddb_write_failed"));
    };
  });
}

async function deleteQueueItem(id: string) {
  const db = await openQueueDb();
  return new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).delete(id);
    request.onsuccess = () => {
      db.close();
      resolve();
    };
    request.onerror = () => {
      db.close();
      reject(request.error ?? new Error("indexeddb_delete_failed"));
    };
  });
}

async function nextAggregateVersion() {
  const items = await readQueue();
  const highestQueued = items.reduce((highest, item) => Math.max(highest, item.aggregateVersion ?? 0), 0);
  return Math.max(Date.now(), highestQueued + 1);
}

function stateLabel(state: CheckState) {
  const labels: Record<CheckState, string> = {
    checking: "CHECKING",
    ready: "READY",
    active: "ACTIVE",
    available: "AVAILABLE",
    installed: "INSTALLED",
    installing: "INSTALLING",
    waiting: "WAITING",
    offline: "OFFLINE",
    not_observed: "NOT OBSERVED",
    unsupported: "UNSUPPORTED",
    unregistered: "UNREGISTERED",
    error: "ERROR",
  };
  return labels[state];
}

function StatePill({ state }: { state: CheckState }) {
  const positive = state === "ready" || state === "active" || state === "available" || state === "installed";
  const warning = state === "checking" || state === "waiting" || state === "installing" || state === "not_observed" || state === "unregistered";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] ${positive ? "border-lime-300/25 bg-lime-300/10 text-lime-200" : warning ? "border-amber-300/20 bg-amber-300/5 text-amber-200" : "border-rose-300/20 bg-rose-300/5 text-rose-200"}`}>
      <span className={`size-1.5 rounded-full ${positive ? "bg-lime-300 shadow-[0_0_8px_rgba(200,255,34,.8)]" : warning ? "bg-amber-300" : "bg-rose-300"}`} />
      {stateLabel(state)}
    </span>
  );
}

function IconButton({ label, children, className = "", onClick }: { label: string; children: ReactNode; className?: string; onClick: () => void }) {
  return (
    <button aria-label={label} className={`grid size-10 place-items-center rounded-xl border border-white/10 bg-black/20 text-slate-400 transition hover:border-lime-300/30 hover:bg-lime-300/5 hover:text-lime-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300/60 ${className}`} onClick={onClick} type="button">
      {children}
    </button>
  );
}

function MetricCard({ icon: Icon, label, value, detail, tone = "lime" }: { icon: LucideIcon; label: string; value: string; detail: string; tone?: "lime" | "cyan" | "amber" }) {
  const toneClass = tone === "cyan" ? "text-cyan-200 border-cyan-300/20 bg-cyan-300/5" : tone === "amber" ? "text-amber-200 border-amber-300/20 bg-amber-300/5" : "text-lime-200 border-lime-300/20 bg-lime-300/5";
  return (
    <article className="carbon-card carbon-card-neon rounded-2xl p-4">
      <div className="flex items-center justify-between gap-3">
        <span className={`grid size-9 place-items-center rounded-xl border ${toneClass}`}><Icon className="size-4" /></span>
        <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-600">readback</span>
      </div>
      <p className="mt-4 text-[11px] text-slate-500">{label}</p>
      <p className="mt-1 font-mono text-2xl font-semibold tracking-[-0.06em] text-slate-50">{value}</p>
      <p className="mt-2 text-[10px] text-slate-600">{detail}</p>
    </article>
  );
}

function CheckRow({ icon: Icon, label, detail, state }: { icon: LucideIcon; label: string; detail: string; state: CheckState }) {
  return (
    <div className="flex items-center gap-3 border-b border-white/[0.07] py-3 last:border-0 last:pb-0 first:pt-0">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-white/10 bg-black/25 text-slate-500"><Icon className="size-3.5" /></span>
      <div className="min-w-0 flex-1"><p className="text-xs font-medium text-slate-200">{label}</p><p className="mt-1 truncate text-[10px] text-slate-600">{detail}</p></div>
      <StatePill state={state} />
    </div>
  );
}

export default function PwaMobileControl({ access, actor, role }: { access: Pick<CommandSurfaceAccess, "allowedNavigation">; actor: AccountActor; role: string }) {
  const router = useRouter();
  const [mobileMenu, setMobileMenu] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [search, setSearch] = useState("");
  const [online, setOnline] = useState<boolean | null>(null);
  const [serviceWorker, setServiceWorker] = useState<CheckState>("checking");
  const [manifest, setManifest] = useState<CheckState>("checking");
  const [indexedDb, setIndexedDb] = useState<CheckState>("checking");
  const [shellCache, setShellCache] = useState<CheckState>("checking");
  const [installState, setInstallState] = useState<CheckState>("not_observed");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [cacheCount, setCacheCount] = useState(0);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [message, setMessage] = useState("Control deck pronta. Nessuna scrittura viene simulata.");
  const [activeView, setActiveView] = useState<ViewId>("overview");
  const [busyAction, setBusyAction] = useState<"refresh" | "queue" | "replay" | "install" | null>(null);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  const visibleNavigation = useMemo(
    () => NAV_ITEMS.filter((item) => access.allowedNavigation.includes(item.id)),
    [access.allowedNavigation],
  );

  const refresh = useCallback(async () => {
    setBusyAction("refresh");
    setOnline(typeof navigator !== "undefined" ? navigator.onLine : null);
    setManifest("checking");
    setServiceWorker("checking");
    setIndexedDb("checking");
    setShellCache("checking");

    const manifestCheck = await fetch("/manifest.webmanifest", { cache: "no-store" }).catch(() => null);
    setManifest(manifestCheck?.ok ? "ready" : "error");

    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        setServiceWorker(registration?.active ? "active" : registration?.waiting ? "waiting" : registration?.installing ? "installing" : registration ? "unregistered" : "unregistered");
      } catch {
        setServiceWorker("error");
      }
    } else {
      setServiceWorker("unsupported");
    }

    try {
      const names = typeof caches !== "undefined" ? await caches.keys() : [];
      const shellNames = names.filter((name) => name.startsWith("zerow-shell-"));
      setCacheCount(shellNames.length);
      setShellCache(shellNames.length > 0 ? "ready" : "not_observed");
    } catch {
      setShellCache("error");
    }

    try {
      const nextQueue = await readQueue();
      setQueue(nextQueue);
      setIndexedDb("ready");
    } catch {
      setQueue([]);
      setIndexedDb("error");
    }

    setLastSync(new Date().toISOString());
    setBusyAction(null);
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      setOnline(true);
      void refresh();
    };
    const handleOffline = () => setOnline(false);
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
      setInstallState("available");
      setMessage("Il browser ha esposto il prompt di installazione. La scelta resta dell’operatore.");
    };
    const handleInstalled = () => {
      setInstallPrompt(null);
      setInstallState("installed");
      setMessage("App installata secondo il segnale del browser.");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("beforeinstallprompt", handleInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);
    const refreshTimer = window.setTimeout(() => {
      void refresh();
    }, 0);

    return () => {
      window.clearTimeout(refreshTimer);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, [refresh]);

  const installApp = async () => {
    if (!installPrompt) {
      setMessage("Il browser non ha esposto beforeinstallprompt: installabilità osservata NOT RUN.");
      setInstallState("not_observed");
      return;
    }
    setBusyAction("install");
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    setInstallPrompt(null);
    setInstallState(choice.outcome === "accepted" ? "installed" : "not_observed");
    setMessage(choice.outcome === "accepted" ? "Installazione accettata; attendiamo il segnale appinstalled." : "Installazione rinviata dall’operatore.");
    setBusyAction(null);
  };

  const enqueueSignal = async () => {
    setBusyAction("queue");
    try {
      await writeQueue({
        id: `pwa-${crypto.randomUUID()}`,
        eventType: "pwa.diagnostics.signal",
        createdAt: new Date().toISOString(),
        attempts: 0,
        aggregateVersion: await nextAggregateVersion(),
        payload: { source: "pwa-mobile-control", build: RELEASE_BUILD_ID },
      });
      setMessage("Signal locale accodata. Sarà rimossa solo dopo readback HTTP 2xx.");
      setActiveView("queue");
      await refresh();
    } catch {
      setMessage("IndexedDB non disponibile: nessun dato è stato scritto altrove.");
      setBusyAction(null);
    }
  };

  const replayQueue = async () => {
    if (!queue.length) {
      setMessage("La coda locale è vuota.");
      return;
    }
    if (!navigator.onLine) {
      setMessage("Replay sospeso: il device è offline.");
      return;
    }
    setBusyAction("replay");
    let processed = 0;
    try {
      for (const item of queue) {
        const response = await fetch("/api/events", {
          method: "POST",
          headers: { "content-type": "application/json", "x-idempotency-key": `pwa:${item.id}` },
          body: JSON.stringify({ eventType: item.eventType, aggregateVersion: item.aggregateVersion, payload: item.payload }),
        });
        if (!response.ok) {
          setMessage(`Replay arrestato su ${item.eventType}: il server non ha confermato il readback.`);
          break;
        }
        await deleteQueueItem(item.id);
        processed += 1;
      }
      if (processed > 0) setMessage(`${processed} elemento/i confermato/i dal server e rimosso/i dalla coda.`);
      await refresh();
    } catch {
      setMessage("Replay interrotto: nessun elemento non confermato è stato rimosso.");
      setBusyAction(null);
    }
  };

  const networkState: CheckState = online === null ? "checking" : online ? "ready" : "offline";
  const lastSyncLabel = lastSync ? new Date(lastSync).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }) : "—";

  return (
    <main className="zw-app-shell zw-command-ultra min-h-screen overflow-x-hidden text-slate-100 selection:bg-lime-300 selection:text-[#060806]">
      <div className="zw-command-ambient" aria-hidden="true" />
      <div className="relative flex min-h-screen">
        <aside className={`zw-command-sidebar fixed inset-y-0 left-0 z-40 flex flex-col px-3 py-4 transition-[width,transform] lg:static lg:translate-x-0 ${sidebarCollapsed ? "is-collapsed lg:w-[76px]" : "lg:w-[248px]"} ${mobileMenu ? "translate-x-0" : "-translate-x-full"}`}>
          <div className="flex items-center justify-between px-2">
            <button aria-label="Apri Command" className="flex min-w-0 items-center gap-3 text-left" onClick={() => { setMobileMenu(false); router.push("/command"); }} type="button">
              <span className="neon-pulse relative grid size-10 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black"><Image src="/ai-zerow-icon.jpeg" alt="AI-ZEROW" width={40} height={40} className="size-full object-cover" /></span>
              <span className="zw-command-sidebar__brand-copy min-w-0"><span className="block text-sm font-bold tracking-[0.18em] text-slate-50">AI-ZEROW</span><span className="block text-[10px] uppercase tracking-[0.22em] text-lime-300/75">command</span></span>
            </button>
            <div className="flex items-center gap-1">
              <button aria-label={sidebarCollapsed ? "Espandi sidebar" : "Riduci sidebar"} className="zw-command-sidebar__collapse hidden size-8 place-items-center rounded-lg text-slate-500 hover:bg-lime-300/10 hover:text-lime-200 lg:grid" onClick={() => setSidebarCollapsed((value) => !value)} type="button">{sidebarCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}</button>
              <button aria-label="Chiudi menu" className="grid size-9 place-items-center rounded-xl text-slate-500 hover:bg-white/5 hover:text-white lg:hidden" onClick={() => setMobileMenu(false)} type="button"><X className="size-4" /></button>
            </div>
          </div>

          <div className="zw-command-tenant mt-7 flex items-center gap-3 rounded-2xl p-3">
            <span className="grid size-9 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/10 text-lime-200"><Smartphone className="size-4" /></span>
            <span className="zw-command-sidebar__tenant-copy min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-slate-200">ZEROW workspace</span><span className="mt-0.5 block truncate text-[10px] uppercase tracking-[0.1em] text-slate-600">{role} · tenant scoped</span></span>
          </div>

          <nav className="mt-6 min-h-0 flex-1 overflow-y-auto" aria-label="Navigazione principale">
            <p className="zw-command-sidebar__nav-caption px-3 text-[9px] font-semibold uppercase tracking-[0.22em] text-slate-700">Authorized workspace</p>
            <div className="mt-2 space-y-1">
              {visibleNavigation.map((item) => {
                const Icon = item.icon;
                const active = item.id === "pwa";
                return <button aria-current={active ? "page" : undefined} aria-label={sidebarCollapsed ? item.label : undefined} className={`zw-command-nav-item ${active ? "is-active" : ""}`} key={item.id} onClick={() => { setMobileMenu(false); router.push(item.path); }} type="button"><Icon className="size-4" /><span className="zw-command-sidebar__nav-label">{item.label}</span></button>;
              })}
            </div>
          </nav>

          <div className="zw-command-sidebar__footer mt-4 border-t border-white/[0.07] pt-4">
            <div className="flex items-center justify-between px-2 text-[9px] uppercase tracking-[0.14em] text-slate-600"><span>Device core</span><span className="flex items-center gap-1.5 text-lime-200"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_10px_rgba(200,255,34,.9)]" />{online === false ? "OFFLINE" : "READY"}</span></div>
            <div className="zw-command-core-status mt-3 rounded-xl p-3"><p className="font-mono text-[9px] text-slate-500">{RELEASE_BUILD_LABEL}</p><p className="mt-2 font-mono text-[9px] text-lime-300/60">POLICY / {role.toUpperCase()}</p></div>
          </div>
        </aside>

        {mobileMenu ? <button aria-label="Chiudi menu" className="fixed inset-0 z-30 bg-black/80 backdrop-blur-sm lg:hidden" onClick={() => setMobileMenu(false)} type="button" /> : null}

        <section className="min-w-0 flex-1">
          <header className="zw-command-topbar sticky top-0 z-20 flex h-[72px] items-center gap-3 px-4 sm:gap-5 sm:px-7">
            <IconButton className="lg:hidden" label="Apri menu" onClick={() => setMobileMenu(true)}><Menu className="size-4" /></IconButton>
            <button aria-label="Torna a Command" className="zw-command-topbar__brand flex shrink-0 items-center gap-2 text-left" onClick={() => router.push("/command")} type="button"><span className="relative grid size-9 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black shadow-[0_0_18px_rgba(200,255,34,.12)]"><Image src="/ai-zerow-icon.jpeg" alt="ZEROW" width={36} height={36} className="size-full object-cover" /></span><span className="hidden sm:block"><span className="block text-[11px] font-bold tracking-[0.18em] text-slate-50">ZEROW</span><span className="block text-[9px] uppercase tracking-[0.2em] text-lime-300/75">pwa control</span></span></button>
            <IconButton label={sidebarCollapsed ? "Espandi sidebar" : "Riduci sidebar"} onClick={() => setSidebarCollapsed((value) => !value)}><span className="hidden lg:block">{sidebarCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}</span><ArrowLeft className="size-4 lg:hidden" /></IconButton>
            <div className="relative hidden min-w-0 flex-1 justify-center md:flex"><div className="relative w-full max-w-[520px]"><Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-600" /><Input aria-label="Cerca nel controllo PWA" className="h-10 w-full border-lime-300/10 bg-black/35 pl-10 text-xs text-slate-100 placeholder:text-slate-600" onChange={(event) => setSearch(event.target.value)} placeholder="Cerca stato, cache, coda, installabilità…" value={search} /></div></div>
            <div className="flex min-w-0 flex-1 items-center gap-2 md:hidden"><span className="truncate text-xs font-semibold tracking-[0.14em] text-slate-200">PWA / MOBILE</span><span className="size-1 rounded-full bg-lime-300" /></div>
            <div className="ml-auto flex items-center gap-2"><span className="hidden items-center gap-2 rounded-full border border-lime-300/20 bg-lime-300/5 px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-lime-200 sm:flex"><span className={`size-1.5 rounded-full ${online === false ? "bg-amber-300" : "bg-lime-300 shadow-[0_0_9px_rgba(200,255,34,.9)]"}`} />{online === false ? "Offline guard" : "PWA control"}</span><IconButton label="Aggiorna diagnostica" onClick={() => void refresh()}><RefreshCw className={busyAction === "refresh" ? "size-4 animate-spin" : "size-4"} /></IconButton>{access.allowedNavigation.includes("communications") ? <IconButton label="Apri comunicazioni" onClick={() => router.push("/communications")}><Bell className="size-4" /></IconButton> : null}<AccountMenu actor={actor} /></div>
          </header>

          <div className="mx-auto max-w-[1920px] px-4 py-5 sm:px-7 sm:py-7">
            <div className="zw-module-hero zw-page-enter mb-7 flex flex-wrap items-end justify-between gap-5">
              <div><div className="flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-lime-300/80"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_9px_rgba(190,255,60,0.9)]" />AI-ZEROW / MOBILE OPERATING LAYER</div><h1 className="mt-3 max-w-2xl text-3xl font-semibold tracking-[-0.06em] text-lime-100 sm:text-[42px]">Operate anywhere.<br /><span className="text-slate-50">Stay in control.</span></h1><p className="mt-3 max-w-xl text-sm leading-6 text-slate-400">PWA, coda offline e controllo del device in un’unica superficie. Ogni conferma resta vincolata al readback server-side.</p></div>
              <div className="hidden items-center gap-4 sm:flex"><div className="zw-command-hero__orb relative grid shrink-0 place-items-center"><Image src="/ai-zerow-icon.jpeg" alt="AI-ZEROW device core" width={96} height={96} className="zw-command-hero__brand-core" /><span className="zw-command-hero__core-label absolute font-mono text-[8px] uppercase tracking-[0.2em]">DEVICE CORE</span></div><div className="max-w-[170px]"><p className="font-mono text-[10px] uppercase tracking-[0.18em] text-lime-300/70">W15 / PWA</p><p className="mt-2 text-xs leading-5 text-slate-500">Control deck pronta per operatori, autisti e magazzino.</p></div></div>
            </div>

            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300/15 bg-amber-300/[0.035] px-4 py-3 text-[10px] text-amber-100/80"><div className="flex items-center gap-2"><ShieldCheck className="size-4 text-amber-200" /><span><strong className="font-semibold text-amber-100">DEVICE CERTIFICATION: NOT RUN.</strong> Il runtime reale su browser, iOS e Android richiede ancora evidenza esterna.</span></div><span className="font-mono text-[9px] text-amber-200/70">TECHNICAL PASS · COMMERCIAL NO-GO</span></div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard icon={online === false ? WifiOff : Wifi} label="Network" value={online === null ? "—" : online ? "ONLINE" : "OFFLINE"} detail="Stato osservato dal browser" tone={online === false ? "amber" : "lime"} />
              <MetricCard icon={CloudOff} label="Queue offline" value={String(queue.length)} detail="Elementi locali in attesa" tone={queue.length ? "amber" : "lime"} />
              <MetricCard icon={HardDrive} label="Shell cache" value={String(cacheCount)} detail="Cache zerow-shell osservate" tone="cyan" />
              <MetricCard icon={ShieldCheck} label="Service worker" value={stateLabel(serviceWorker)} detail={`${RELEASE_BUILD_LABEL} · sync ${lastSyncLabel}`} />
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl border border-white/[0.08] bg-black/20 p-2"><button className={`rounded-xl px-3 py-2 text-[11px] font-semibold transition ${activeView === "overview" ? "bg-lime-300 text-[#060806]" : "text-slate-500 hover:bg-lime-300/5 hover:text-lime-200"}`} onClick={() => setActiveView("overview")} type="button">Readiness</button><button className={`rounded-xl px-3 py-2 text-[11px] font-semibold transition ${activeView === "queue" ? "bg-lime-300 text-[#060806]" : "text-slate-500 hover:bg-lime-300/5 hover:text-lime-200"}`} onClick={() => setActiveView("queue")} type="button">Offline queue <span className="ml-1 font-mono text-[9px]">{queue.length}</span></button><button className={`rounded-xl px-3 py-2 text-[11px] font-semibold transition ${activeView === "install" ? "bg-lime-300 text-[#060806]" : "text-slate-500 hover:bg-lime-300/5 hover:text-lime-200"}`} onClick={() => setActiveView("install")} type="button">Installabilità</button><span className="ml-auto hidden font-mono text-[9px] uppercase tracking-[0.16em] text-slate-600 sm:block">{search ? `filter · ${search}` : "W15 / local control plane"}</span></div>

            {activeView === "overview" ? <div className="mt-4 grid gap-4 lg:grid-cols-[1.05fr_.95fr]">
              <section className="carbon-card carbon-card-neon rounded-2xl p-5 sm:p-6"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-lime-300/70">RUNTIME READINESS</p><h2 className="mt-1 text-lg font-semibold text-slate-50">Device control plane</h2><p className="mt-2 max-w-xl text-xs leading-5 text-slate-500">Evidenze osservate localmente, senza trasformare un’API assente in un falso stato operativo.</p></div><StatePill state={networkState} /></div><div className="mt-6"><CheckRow icon={online === false ? WifiOff : Wifi} label="Connettività" detail={online === false ? "Il device può solo operare su dati già presenti localmente." : "Il browser espone una connessione disponibile."} state={networkState} /><CheckRow icon={Database} label="Manifest PWA" detail="manifest.webmanifest dichiarato e raggiungibile." state={manifest} /><CheckRow icon={Activity} label="Service worker" detail="Registrazione e stato del worker osservati nel browser corrente." state={serviceWorker} /><CheckRow icon={Database} label="IndexedDB queue" detail="Store zerow-offline / queue con ordering FIFO." state={indexedDb} /><CheckRow icon={HardDrive} label="Shell cache" detail="Cache versionata; le route API restano fuori dalla cache." state={shellCache} /><CheckRow icon={Download} label="Install prompt" detail="Disponibile solo se il browser espone beforeinstallprompt." state={installState} /></div></section>
              <div className="space-y-4"><section className="carbon-card rounded-2xl p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200/70">OFFLINE CONTRACT</p><h2 className="mt-1 text-sm font-semibold text-slate-50">Queue governata</h2></div><CloudOff className="size-4 text-cyan-200" /></div><p className="mt-3 text-xs leading-5 text-slate-500">FIFO, idempotenza per elemento e rimozione esclusivamente dopo risposta HTTP 2xx. Se un elemento fallisce, il replay si arresta.</p><div className="mt-5 flex flex-wrap gap-2"><Button className="bg-lime-300 text-xs font-semibold text-[#060806] hover:bg-lime-200" disabled={busyAction !== null} onClick={() => void enqueueSignal()}><Database className="size-3.5" />Accoda signal locale</Button><Button variant="outline" className="border-white/10 bg-black/20 text-xs text-slate-300 hover:border-lime-300/30 hover:text-lime-200" disabled={busyAction !== null || queue.length === 0} onClick={() => void replayQueue()}><RefreshCw className={`size-3.5 ${busyAction === "replay" ? "animate-spin" : ""}`} />Replay readback</Button></div><p className="mt-4 text-[11px] text-cyan-200/80" role="status">{message}</p></section><section className="carbon-card rounded-2xl p-5"><div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-lime-300/70">BOUNDARY</p><h2 className="mt-1 text-sm font-semibold text-slate-50">Cosa è dimostrato</h2></div><ShieldCheck className="size-4 text-lime-200" /></div><div className="mt-4 space-y-3 text-xs"><div className="flex items-center justify-between border-b border-white/[0.07] pb-3"><span className="text-slate-500">Runtime Sites</span><span className="text-lime-200">PRESENTATION READY</span></div><div className="flex items-center justify-between border-b border-white/[0.07] pb-3"><span className="text-slate-500">API /api/events</span><span className="text-amber-200">READBACK REQUIRED</span></div><div className="flex items-center justify-between border-b border-white/[0.07] pb-3"><span className="text-slate-500">Native iOS / Android</span><span className="text-amber-200">NOT RUN</span></div><div className="flex items-center justify-between"><span className="text-slate-500">Certification device reale</span><span className="text-amber-200">NOT RUN</span></div></div></section></div>
            </div> : null}

            {activeView === "queue" ? <section className="carbon-card carbon-card-neon mt-4 rounded-2xl p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-lime-300/70">LOCAL EVENT LEDGER</p><h2 className="mt-1 text-lg font-semibold text-slate-50">Offline queue / FIFO replay</h2><p className="mt-2 max-w-2xl text-xs leading-5 text-slate-500">La coda è locale al device. Nessun elemento viene considerato consegnato prima del readback server-side.</p></div><div className="flex gap-2"><Button className="bg-lime-300 text-xs font-semibold text-[#060806] hover:bg-lime-200" disabled={busyAction !== null} onClick={() => void enqueueSignal()}><Database className="size-3.5" />Accoda test</Button><Button variant="outline" className="border-white/10 bg-black/20 text-xs text-slate-300 hover:border-lime-300/30 hover:text-lime-200" disabled={busyAction !== null || queue.length === 0} onClick={() => void replayQueue()}><RefreshCw className="size-3.5" />Replay</Button></div></div><div className="mt-6 divide-y divide-white/[0.07]">{queue.map((item) => <div className="flex flex-wrap items-center gap-3 py-4 first:pt-0 last:pb-0" key={item.id}><span className="size-2 rounded-full bg-amber-300 shadow-[0_0_8px_rgba(251,191,36,.8)]" /><span className="font-mono text-[10px] text-slate-200">{item.eventType}</span><span className="text-[10px] text-slate-600">{item.createdAt}</span><span className="ml-auto text-[10px] text-amber-200">attempts {item.attempts} · v{item.aggregateVersion ?? "legacy"}</span></div>)}{queue.length === 0 ? <div className="zw-widget-empty"><CloudOff className="size-5 text-slate-600" /><div><p className="text-sm font-semibold text-slate-300">Nessun elemento in attesa</p><p className="mt-1 text-xs text-slate-600">Accoda un signal locale per verificare il contratto senza usare dati di produzione.</p></div></div> : null}</div></section> : null}

            {activeView === "install" ? <div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_.9fr]"><section className="carbon-card carbon-card-neon rounded-2xl p-5 sm:p-6"><div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-xl border border-lime-300/25 bg-lime-300/10 text-lime-200"><Download className="size-5" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-lime-300/70">INSTALLABILITY OBSERVER</p><h2 className="mt-1 text-lg font-semibold text-slate-50">Installa il control deck</h2><p className="mt-2 max-w-xl text-xs leading-5 text-slate-500">Il pulsante si abilita solo quando il browser espone il proprio evento di installazione. Non viene dichiarata installabilità per deduzione.</p></div></div><div className="mt-6 flex flex-wrap items-center gap-3"><Button className="bg-lime-300 text-xs font-semibold text-[#060806] hover:bg-lime-200" disabled={busyAction !== null || !installPrompt} onClick={() => void installApp()}><Download className="size-3.5" />{installPrompt ? "Installa app" : "Prompt non osservato"}</Button><StatePill state={installState} /></div><p className="mt-4 text-[11px] text-slate-500" role="status">{message}</p></section><section className="carbon-card rounded-2xl p-5 sm:p-6"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-200/70">CERTIFICATION GATES</p><h2 className="mt-1 text-sm font-semibold text-slate-50">Evidenze ancora aperte</h2><div className="mt-5 space-y-3 text-xs"><div className="flex items-center gap-3"><span className="grid size-7 place-items-center rounded-lg border border-amber-300/20 bg-amber-300/5 text-amber-200"><Smartphone className="size-3.5" /></span><div><p className="text-slate-200">Browser install prompt</p><p className="mt-1 text-[10px] text-slate-600">Dipende dal browser e dal contesto di installazione.</p></div></div><div className="flex items-center gap-3"><span className="grid size-7 place-items-center rounded-lg border border-amber-300/20 bg-amber-300/5 text-amber-200"><WifiOff className="size-3.5" /></span><div><p className="text-slate-200">Offline / online reale</p><p className="mt-1 text-[10px] text-slate-600">Richiede test controllato su device, rete e ritorno connessione.</p></div></div><div className="flex items-center gap-3"><span className="grid size-7 place-items-center rounded-lg border border-amber-300/20 bg-amber-300/5 text-amber-200"><ShieldCheck className="size-3.5" /></span><div><p className="text-slate-200">iOS / Android native boundary</p><p className="mt-1 text-[10px] text-slate-600">La PWA è la superficie corrente; app native non sono state inventate.</p></div></div></div></section></div> : null}

            <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] py-5 text-[10px] text-slate-600"><span>AI-ZEROW COMMAND · W15 / PWA & MOBILE OFFLINE</span><span className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-lime-300" />no API cache · FIFO queue · tenant scoped</span></footer>
          </div>
        </section>
      </div>
      <CommandMobileNav active="more" allowedNavigation={access.allowedNavigation} role={role} />
    </main>
  );
}
