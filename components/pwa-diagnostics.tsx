"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, CheckCircle2, CloudOff, Database, RefreshCw, ShieldCheck, Wifi, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

type QueueItem = { id: string; eventType: string; createdAt: string; attempts: number; payload: Record<string, unknown> };

const DB_NAME = "zerow-offline";
const STORE_NAME = "queue";

function openQueueDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readQueue(): Promise<QueueItem[]> {
  const db = await openQueueDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve((request.result as QueueItem[]).sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    request.onerror = () => reject(request.error);
  });
}

async function writeQueue(item: QueueItem) {
  const db = await openQueueDb();
  return new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(item);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function deleteQueueItem(id: string) {
  const db = await openQueueDb();
  return new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export default function PwaDiagnostics() {
  const [online, setOnline] = useState(true);
  const [serviceWorker, setServiceWorker] = useState("checking");
  const [manifest, setManifest] = useState("checking");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [message, setMessage] = useState("Diagnostica pronta.");

  const refresh = useCallback(async () => {
    setOnline(navigator.onLine);
    setServiceWorker("serviceWorker" in navigator ? (navigator.serviceWorker.controller ? "active" : "registered") : "unsupported");
    try {
      const response = await fetch("/manifest.webmanifest", { cache: "no-store" });
      setManifest(response.ok ? "available" : "missing");
    } catch {
      setManifest("unreachable");
    }
    try {
      setQueue(await readQueue());
    } catch {
      setQueue([]);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh(); }, 0);
    const onlineHandler = () => void refresh();
    const offlineHandler = () => setOnline(false);
    window.addEventListener("online", onlineHandler);
    window.addEventListener("offline", offlineHandler);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("online", onlineHandler);
      window.removeEventListener("offline", offlineHandler);
    };
  }, [refresh]);

  async function enqueueDemo() {
    const item: QueueItem = {
      id: crypto.randomUUID(),
      eventType: "pwa.diagnostics.signal",
      createdAt: new Date().toISOString(),
      attempts: 0,
      payload: { source: "pwa-diagnostics", build: "ai-zerow-sites-s08-v19" },
    };
    await writeQueue(item);
    setMessage("Elemento accodato in IndexedDB; il client non lo considera completato.");
    await refresh();
  }

  async function replay() {
    if (!navigator.onLine) {
      setMessage("Replay bloccato: il dispositivo è offline.");
      return;
    }
    const items = await readQueue();
    for (const item of items) {
      const response = await fetch("/api/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          eventType: item.eventType,
          aggregateType: "pwa",
          aggregateId: "diagnostics",
          aggregateVersion: item.attempts + 1,
          idempotencyKey: `pwa:${item.id}`,
          payload: item.payload,
        }),
      });
      if (!response.ok) {
        await writeQueue({ ...item, attempts: item.attempts + 1 });
        setMessage("Replay fermato sul primo errore: barriera FIFO attiva.");
        await refresh();
        return;
      }
      await deleteQueueItem(item.id);
    }
    setMessage(items.length ? "Replay completato con readback HTTP." : "Queue vuota.");
    await refresh();
  }

  const checks = [
    { label: "Network", value: online ? "ONLINE" : "OFFLINE", ok: online, icon: online ? Wifi : CloudOff },
    { label: "Manifest", value: manifest.toUpperCase(), ok: manifest === "available", icon: manifest === "available" ? CheckCircle2 : XCircle },
    { label: "Service worker", value: serviceWorker.toUpperCase(), ok: serviceWorker === "active" || serviceWorker === "registered", icon: serviceWorker === "active" || serviceWorker === "registered" ? ShieldCheck : XCircle },
    { label: "IndexedDB queue", value: `${queue.length} ITEM${queue.length === 1 ? "" : "S"}`, ok: true, icon: Database },
  ];

 return <main className="min-h-screen bg-[#050607] px-4 py-6 text-slate-100 sm:px-7 sm:py-8"><div className="mx-auto max-w-6xl"><div className="flex flex-wrap items-start justify-between gap-4"><div className="flex items-center gap-3"><span className="neon-pulse grid size-11 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black"><img src="/ai-zerow-icon.jpeg" alt="AI-ZEROW" className="size-full object-cover" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-lime-300/70">AI-ZEROW / S08</p><h1 className="mt-1 text-2xl font-semibold tracking-[-0.04em]">PWA diagnostics</h1><p className="mt-1 text-xs text-slate-500">Manifest, service worker, queue offline e replay con barriera FIFO.</p></div></div><Button variant="outline" className="border-white/10 bg-black/25 text-xs text-slate-300 hover:border-lime-300/30 hover:text-lime-200" onClick={() => void refresh()}><RefreshCw className="size-3.5" />Aggiorna check</Button></div><div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{checks.map((check) => { const Icon = check.icon; return <section className="carbon-card rounded-2xl p-4" key={check.label}><div className="flex items-center justify-between"><span className="text-xs text-slate-500">{check.label}</span><Icon className={`size-4 ${check.ok ? "text-lime-200" : "text-rose-300"}`} /></div><p className={`mt-4 font-mono text-lg ${check.ok ? "text-lime-200" : "text-rose-300"}`}>{check.value}</p></section>; })}</div><div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]"><section className="carbon-card rounded-2xl p-5"><div className="flex items-start gap-3"><span className="grid size-9 place-items-center rounded-xl border border-lime-300/25 bg-lime-300/10 text-lime-200"><Activity className="size-[18px]" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-lime-300/70">OFFLINE CONTRACT</p><h2 className="mt-1 text-sm font-semibold">Queue locale governata</h2></div></div><p className="mt-3 text-xs leading-5 text-slate-500">Gli elementi restano in IndexedDB fino al readback HTTP 2xx. Un errore blocca gli elementi successivi; le route API non vengono messe in cache dal service worker.</p><div className="mt-5 flex flex-wrap gap-2"><Button className="bg-lime-300 text-xs font-semibold text-[#060806] hover:bg-lime-200" onClick={() => void enqueueDemo()}><Database className="size-3.5" />Accoda signal</Button><Button variant="outline" className="border-white/10 bg-black/20 text-xs text-slate-300 hover:border-lime-300/30 hover:text-lime-200" onClick={() => void replay()}><RefreshCw className="size-3.5" />Replay queue</Button></div><p className="mt-4 text-[11px] text-cyan-200/80">{message}</p></section><section className="carbon-card-neon rounded-2xl p-5"><div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-lime-300/70">S08 / RELEASE</p><h2 className="mt-1 text-sm font-semibold">Sites presentation contract</h2></div><span className="rounded-full border border-lime-300/25 bg-lime-300/10 px-2 py-1 text-[10px] text-lime-200">ADAPTER READY</span></div><div className="mt-5 space-y-3 text-xs"><div className="flex items-center justify-between border-b border-white/[0.08] pb-3"><span className="text-slate-500">Build identifier</span><span className="font-mono text-lime-200">S08-V19</span></div><div className="flex items-center justify-between border-b border-white/[0.08] pb-3"><span className="text-slate-500">Standalone</span><span className="text-slate-200">Manifest declared</span></div><div className="flex items-center justify-between border-b border-white/[0.08] pb-3"><span className="text-slate-500">External worker</span><span className="text-amber-200">Deferred</span></div><div className="flex items-center justify-between"><span className="text-slate-500">Browser certification</span><span className="text-amber-200">Not run</span></div></div></section></div><section className="carbon-card mt-4 rounded-2xl p-5"><div className="flex items-center justify-between gap-3"><div><p className="text-[10px] uppercase tracking-[0.18em] text-lime-300/70">QUEUE ITEMS</p><h2 className="mt-1 text-sm font-semibold">Pending local signals</h2></div><span className="font-mono text-xs text-slate-500">{queue.length} pending</span></div><div className="mt-4 divide-y divide-white/[0.07]">{queue.map((item) => <div className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0" key={item.id}><span className="size-2 rounded-full bg-amber-300 shadow-[0_0_8px_rgba(251,191,36,0.8)]" /><span className="font-mono text-[10px] text-slate-300">{item.eventType}</span><span className="text-[10px] text-slate-600">{item.createdAt}</span><span className="ml-auto text-[10px] text-amber-200">attempts {item.attempts}</span></div>)}{queue.length === 0 && <p className="py-6 text-center text-xs text-slate-600">Nessun elemento locale in attesa.</p>}</div></section></div></main>;
}
