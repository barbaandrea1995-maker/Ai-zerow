"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, CloudDownload, Crosshair, Radio, RefreshCw, Satellite, Truck } from "lucide-react";

type RemoteDevice = {
  id: string;
  name: string;
  uniqueId: string;
  status: string;
  lastUpdate: string | null;
};

type LocalDevice = {
  id: string;
  externalDeviceId: string;
  label: string;
  status: string;
};

type ProviderResponse = {
  runtime?: { tracking?: { configured?: boolean; status?: string } };
  traccarProbe?: { status?: string; webhookSignature?: string; checkedAt?: string } | null;
  runtimeGates?: { trackingProvider?: string };
};

function statusLabel(status: string) {
  if (status === "READY") return "API collegata";
  if (status === "NOT_CONFIGURED") return "Configurazione incompleta";
  if (status === "UNAVAILABLE") return "Provider non raggiungibile";
  return status.replaceAll("_", " ");
}

export default function GpsProviderControl() {
  const [runtime, setRuntime] = useState<ProviderResponse | null>(null);
  const [remoteDevices, setRemoteDevices] = useState<RemoteDevice[]>([]);
  const [localDevices, setLocalDevices] = useState<LocalDevice[]>([]);
  const [busy, setBusy] = useState<"refresh" | "sync" | string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState(false);

  async function load() {
    setBusy("refresh");
    setMessage(null);
    setError(false);
    try {
      const [statusResponse, registryResponse] = await Promise.all([
        fetch("/api/location/status?probe=traccar", { cache: "no-store" }),
        fetch("/api/location/devices?remote=traccar", { cache: "no-store" }),
      ]);
      const statusPayload = await statusResponse.json() as ProviderResponse;
      const registryPayload = await registryResponse.json() as { devices?: LocalDevice[]; remote?: { devices?: RemoteDevice[]; error?: string | null } };
      if (!statusResponse.ok || !registryResponse.ok) throw new Error("gps_readback_unavailable");
      setRuntime(statusPayload);
      setRemoteDevices(registryPayload.remote?.devices ?? []);
      setLocalDevices(registryPayload.devices ?? []);
      if (registryPayload.remote?.error) setMessage("Il provider risponde, ma il catalogo dispositivi non è leggibile.");
    } catch {
      setError(true);
      setMessage("Impossibile leggere lo stato GPS. Riprova tra poco.");
    } finally {
      setBusy(null);
    }
  }

  async function syncDevices() {
    setBusy("sync");
    setMessage(null);
    setError(false);
    try {
      const response = await fetch("/api/location/devices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      });
      const payload = await response.json() as { importedCount?: number; remoteCount?: number; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "gps_sync_failed");
      setMessage(`${payload.importedCount ?? 0} dispositivi importati nel registro ZEROW su ${payload.remoteCount ?? 0} rilevati.`);
      await load();
    } catch (reason) {
      setError(true);
      setMessage(reason instanceof Error && reason.message === "traccar_runtime_not_configured"
        ? "Configura prima il provider GPS nel runtime sicuro."
        : "Sincronizzazione non disponibile. Verifica il catalogo Traccar.");
      setBusy(null);
    }
  }

  async function pollDevice(deviceId: string) {
    setBusy(deviceId);
    setMessage(null);
    setError(false);
    try {
      const response = await fetch("/api/location/devices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "poll", deviceId }),
      });
      const payload = await response.json() as { position?: { latitude?: number; longitude?: number; recordedAt?: string }; error?: string };
      if (!response.ok || !payload.position) throw new Error(payload.error ?? "position_unavailable");
      setMessage(`Posizione letta da ZEROW: ${payload.position.latitude?.toFixed(5)}, ${payload.position.longitude?.toFixed(5)}.`);
    } catch (reason) {
      setError(true);
      setMessage(reason instanceof Error && reason.message === "tracking_position_unavailable"
        ? "Dispositivo raggiunto, ma non ha ancora una posizione disponibile."
        : "Lettura posizione non disponibile per questo dispositivo.");
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const probeStatus = runtime?.traccarProbe?.status ?? "NOT_RUN";
  const gate = runtime?.runtimeGates?.trackingProvider ?? "UNKNOWN";
  const apiReady = probeStatus === "READY";

  return (
    <section className="carbon-card carbon-card-neon rounded-2xl p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-lime-300/30 bg-lime-300/10 text-lime-200 shadow-[0_0_20px_rgba(200,255,34,.1)]">
            <Satellite className="size-5" />
          </span>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-lime-300/70">ZEROW / GPS CONTROL</p>
            <h2 className="mt-1 text-base font-semibold text-slate-50">Connessione flotta</h2>
            <p className="mt-1 max-w-2xl text-[11px] leading-5 text-slate-500">Provider tecnico nascosto dietro ZEROW: verifica, importa e leggi i dispositivi senza gestire la console esterna.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${apiReady ? "border-lime-300/25 bg-lime-300/10 text-lime-200" : "border-amber-300/25 bg-amber-300/10 text-amber-100"}`}>
            <span className="mr-1.5 inline-block size-1.5 rounded-full bg-current" />{statusLabel(probeStatus)}
          </span>
          <button aria-label="Aggiorna connessione GPS" className="grid size-9 place-items-center rounded-xl border border-white/10 bg-black/20 text-slate-500 transition hover:border-lime-300/30 hover:text-lime-200" disabled={busy !== null} onClick={() => void load()} type="button">
            <RefreshCw className={`size-4 ${busy === "refresh" ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[0.14em] text-slate-600">Server</p><p className="mt-2 truncate text-xs text-slate-200">demo.traccar.org</p></div>
        <div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[0.14em] text-slate-600">Catalogo remoto</p><p className="mt-2 text-xs text-lime-200">{remoteDevices.length} dispositivi</p></div>
        <div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[0.14em] text-slate-600">Registro ZEROW</p><p className="mt-2 text-xs text-lime-200">{localDevices.length} importati</p></div>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-lime-300/15 bg-lime-300/[0.045] p-4">
        <div className="flex items-start gap-3"><Radio className="mt-0.5 size-4 shrink-0 text-lime-200" /><p className="text-[11px] leading-5 text-slate-400">La lettura on-demand usa il polling server-side. Il segreto webhook non è necessario per questa modalità.</p></div>
        <button className="inline-flex items-center gap-2 rounded-lg bg-lime-300 px-3 py-2 text-xs font-semibold text-[#060806] transition hover:bg-lime-200 disabled:cursor-wait disabled:opacity-50" disabled={busy !== null || !apiReady} onClick={() => void syncDevices()} type="button"><CloudDownload className="size-3.5" />{busy === "sync" ? "Sincronizzazione…" : "Importa dispositivi"}</button>
      </div>

      {message ? <p className={`mt-3 rounded-xl border px-3 py-2.5 text-[11px] ${error ? "border-rose-300/20 bg-rose-300/5 text-rose-100" : "border-lime-300/20 bg-lime-300/5 text-lime-100"}`} role={error ? "alert" : "status"}>{message}</p> : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div>
          <div className="mb-2 flex items-center justify-between"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">Dispositivi rilevati</p><span className="text-[10px] text-slate-600">provider</span></div>
          <div className="space-y-2">
            {remoteDevices.length === 0 ? <p className="carbon-inset rounded-xl p-4 text-[11px] text-slate-600">Nessun dispositivo nel catalogo remoto.</p> : remoteDevices.slice(0, 8).map((device) => <div className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-black/20 px-3 py-3" key={device.id}><span className="grid size-8 shrink-0 place-items-center rounded-lg border border-lime-300/20 bg-lime-300/10 text-lime-200"><Truck className="size-4" /></span><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-slate-200">{device.name}</p><p className="mt-1 truncate text-[10px] text-slate-600">ID {device.id} · {device.status}</p></div><span className="text-[9px] uppercase tracking-[0.1em] text-slate-600">{device.lastUpdate ? "sync" : "—"}</span></div>)}
          </div>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">Registro ZEROW</p><span className="text-[10px] text-slate-600">polling</span></div>
          <div className="space-y-2">
            {localDevices.length === 0 ? <p className="carbon-inset rounded-xl p-4 text-[11px] text-slate-600">Importa un dispositivo per abilitarne la lettura da ZEROW.</p> : localDevices.slice(0, 8).map((device) => <div className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-black/20 px-3 py-3" key={device.id}><span className="grid size-8 shrink-0 place-items-center rounded-lg border border-cyan-300/20 bg-cyan-300/10 text-cyan-200"><Crosshair className="size-4" /></span><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-slate-200">{device.label}</p><p className="mt-1 truncate text-[10px] text-slate-600">{device.externalDeviceId} · {device.status}</p></div><button aria-label={`Leggi posizione di ${device.label}`} className="grid size-8 place-items-center rounded-lg border border-white/10 text-slate-500 transition hover:border-lime-300/30 hover:text-lime-200 disabled:opacity-40" disabled={busy !== null} onClick={() => void pollDevice(device.id)} type="button"><CheckCircle2 className="size-3.5" /></button></div>)}
          </div>
        </div>
      </div>

      <p className="mt-5 text-[10px] leading-5 text-slate-600">Gate: <span className="font-mono text-slate-400">{gate}</span>. Le credenziali restano server-side; nessun token viene mostrato in ZEROW.</p>
    </section>
  );
}
