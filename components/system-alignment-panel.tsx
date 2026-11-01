"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Database,
  MapPinned,
  Package,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Truck,
  UsersRound,
  Warehouse,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AlignmentStatus, SystemAlignmentReport } from "@/lib/system-alignment";

type IntegrityResponse = SystemAlignmentReport & {
  authority?: {
    selectedTenantId?: string;
    identityProvider?: string;
    role?: string;
    tenantScopeVerified?: boolean;
  };
};

const statusStyle: Record<AlignmentStatus, { label: string; badge: string; dot: string }> = {
  READY: { label: "COERENTE", badge: "border-lime-300/25 bg-lime-300/10 text-lime-100", dot: "bg-lime-300" },
  REVIEW: { label: "DA VERIFICARE", badge: "border-amber-300/25 bg-amber-300/10 text-amber-100", dot: "bg-amber-300" },
  BLOCKED: { label: "ANOMALIE", badge: "border-rose-300/25 bg-rose-300/10 text-rose-100", dot: "bg-rose-300" },
};

function StatusBadge({ status }: { status: AlignmentStatus }) {
  const style = statusStyle[status];
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[.1em] ${style.badge}`}><span className={`size-1.5 rounded-full ${style.dot}`} />{style.label}</span>;
}

function Metric({ label, value, detail, icon: Icon }: { label: string; value: string | number; detail: string; icon: typeof Database }) {
  return <article className="carbon-inset rounded-2xl p-4"><div className="flex items-start justify-between gap-3"><p className="text-[9px] font-semibold uppercase tracking-[.16em] text-slate-600">{label}</p><Icon className="size-4 text-lime-200/70" /></div><p className="mt-2 font-mono text-3xl font-semibold tracking-[-.06em] text-lime-100">{value}</p><p className="mt-2 text-[10px] leading-4 text-slate-600">{detail}</p></article>;
}

function gateIcon(id: string) {
  if (id === "canonical-places") return MapPinned;
  if (id === "qr-registry") return QrCode;
  if (id === "identity-membership") return UsersRound;
  if (id === "asset-location") return Package;
  if (id === "mission-route") return Truck;
  if (id === "inventory-integrity") return Warehouse;
  if (id === "event-readback") return Activity;
  return Database;
}

function readableError(error: unknown) {
  const message = error instanceof Error ? error.message : "integrity_readback_failed";
  if (message === "forbidden") return "La membership corrente non possiede tenant.manage.";
  if (message === "unauthenticated") return "La sessione non è più valida.";
  return "Il controllo di integrità non è disponibile nel runtime corrente.";
}

export default function SystemAlignmentPanel() {
  const [report, setReport] = useState<IntegrityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/governance/alignment", { cache: "no-store" });
      const payload = await response.json() as IntegrityResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || `integrity_${response.status}`);
      setReport(payload);
    } catch (nextError) {
      setReport(null);
      setError(readableError(nextError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (loading && !report) {
    return <div className="carbon-card mt-4 flex min-h-[320px] items-center justify-center rounded-2xl"><div className="text-center"><RefreshCw className="mx-auto size-6 animate-spin text-lime-200" /><p className="mt-3 text-xs text-slate-500">Rileggo i registri del tenant…</p></div></div>;
  }

  if (!report) {
    return <div className="carbon-card mt-4 rounded-2xl border-rose-300/15 p-8 text-center"><AlertTriangle className="mx-auto size-8 text-rose-200" /><h2 className="mt-3 text-base font-semibold text-slate-100">Readback non disponibile</h2><p className="mx-auto mt-2 max-w-lg text-xs leading-5 text-slate-500">{error}</p><Button className="mt-5 border-white/10 bg-white/[.04] text-xs text-slate-200 hover:border-lime-300/30" onClick={() => void load()} variant="outline"><RefreshCw className="size-3.5" />Riprova</Button></div>;
  }

  const tenant = report.tenants[0];
  const openControls = report.summary.blockedGates + report.summary.reviewGates;
  const completePlaces = tenant ? `${tenant.canonicalPlaces.covered}/${tenant.canonicalPlaces.expected}` : "—";
  const completeQr = tenant ? `${tenant.qrCoverage.covered}/${tenant.qrCoverage.expected}` : "—";

  return <div className="mt-4 space-y-4">
    <section className="relative overflow-hidden rounded-[24px] border border-lime-300/20 bg-[linear-gradient(120deg,rgba(7,12,8,.98),rgba(11,22,12,.94)_58%,rgba(125,170,0,.2))] p-5 shadow-[0_20px_60px_rgba(0,0,0,.35)] sm:p-6">
      <div className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full bg-lime-300/[.1] blur-[80px]" />
      <div className="relative flex flex-wrap items-start justify-between gap-5">
        <div className="max-w-3xl"><p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.2em] text-lime-300/75"><ShieldCheck className="size-4" />Governance · integrità server-side</p><h2 className="mt-3 text-2xl font-semibold tracking-[-.04em] text-slate-50 sm:text-3xl">Integrità del tenant</h2><p className="mt-3 max-w-2xl text-xs leading-6 text-slate-400">Il server controlla esclusivamente il tenant selezionato dalla sessione: identità, luoghi, geofence, QR, asset, missioni, scorte, eventi e riconciliazioni. Questa sezione non modifica alcun record.</p><div className="mt-4 flex flex-wrap items-center gap-2"><StatusBadge status={report.status} /><span className="rounded-full border border-cyan-300/20 bg-cyan-300/[.05] px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[.1em] text-cyan-100">Tenant verificato</span>{report.summary.truncated ? <span className="rounded-full border border-amber-300/20 bg-amber-300/[.06] px-2.5 py-1 text-[9px] uppercase tracking-[.1em] text-amber-100">Lettura parziale</span> : null}</div></div>
        <div className="min-w-[220px] rounded-2xl border border-white/10 bg-black/25 p-4 backdrop-blur"><div className="flex items-center justify-between gap-3"><span className="text-[9px] uppercase tracking-[.16em] text-slate-600">Perimetro corrente</span>{report.status === "READY" ? <CheckCircle2 className="size-4 text-lime-200" /> : <AlertTriangle className={report.status === "BLOCKED" ? "size-4 text-rose-200" : "size-4 text-amber-200"} />}</div><p className="mt-3 truncate text-sm font-semibold text-slate-100">{tenant?.name ?? "Tenant non disponibile"}</p><p className="mt-2 break-all font-mono text-[9px] text-slate-600">{report.authority?.selectedTenantId ?? tenant?.id ?? "—"}</p><Button aria-label="Rileggi i registri del tenant" className="mt-4 h-9 w-full border-white/10 bg-white/[.03] text-[10px] text-slate-300 hover:border-lime-300/30 hover:text-lime-100" disabled={loading} onClick={() => void load()} variant="outline"><RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />Rileggi registri</Button></div>
      </div>
    </section>

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric detail="Registro commesse del tenant" icon={Database} label="Commesse" value={tenant?.counts.operations ?? 0} /><Metric detail="Depositi aziendali registrati" icon={Warehouse} label="Magazzini" value={tenant?.counts.warehouses ?? 0} /><Metric detail="Mezzi e attrezzature catalogati" icon={Package} label="Asset" value={tenant?.counts.assets ?? 0} /><Metric detail="Blocchi o verifiche da risolvere" icon={AlertTriangle} label="Controlli aperti" value={openControls} /></section>

    <section className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,.75fr)]">
      <div className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">Registro invarianti</p><h3 className="mt-1 text-base font-semibold text-slate-100">Controlli di coerenza</h3><p className="mt-1 text-[11px] leading-5 text-slate-500">Ogni anomalia indica il registro responsabile e l’azione successiva; nessuna correzione avviene automaticamente.</p></div><ShieldCheck className="size-5 text-lime-200" /></div><div className="mt-4 space-y-2">{report.gates.map((gate) => { const Icon = gateIcon(gate.id); return <article className="rounded-xl border border-white/[.08] bg-black/20 p-3" key={gate.id}><div className="flex items-start gap-3"><span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl border border-white/[.08] bg-black/25"><Icon className="size-4 text-cyan-200" /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-xs font-semibold text-slate-200">{gate.label}</h4><StatusBadge status={gate.status} /></div><p className="mt-1 text-[11px] leading-5 text-slate-500">{gate.detail}</p>{gate.nextAction !== "Nessuna" ? <p className="mt-2 rounded-lg border border-amber-300/10 bg-amber-300/[.025] px-2.5 py-2 text-[10px] leading-4 text-amber-100/70"><span className="text-amber-100/50">Azione · </span>{gate.nextAction}</p> : null}</div></div></article>; })}</div></div>

      <div className="space-y-4"><div className="carbon-card rounded-2xl border-lime-300/15 p-4 sm:p-5"><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">Copertura registri</p><h3 className="mt-1 text-base font-semibold text-slate-100">{tenant?.name ?? "Tenant corrente"}</h3><div className="mt-4 grid grid-cols-2 gap-2"><Metric detail="Luoghi canonici" icon={MapPinned} label="Luoghi" value={completePlaces} /><Metric detail="Identità fisiche" icon={QrCode} label="QR" value={completeQr} /><Metric detail="Persone autorizzate" icon={UsersRound} label="Membership" value={tenant?.counts.memberships ?? 0} /><Metric detail="Tratte operative" icon={Truck} label="Missioni" value={tenant?.counts.missions ?? 0} /></div></div><div className="carbon-card rounded-2xl p-4 sm:p-5"><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-cyan-200/70">Audit e readback</p><div className="mt-3 space-y-2 text-[10px] text-slate-500"><p className="flex justify-between gap-3 rounded-xl border border-white/[.07] bg-black/20 px-3 py-2.5"><span>Eventi</span><span className="font-mono text-slate-200">{tenant?.counts.events ?? 0}</span></p><p className="flex justify-between gap-3 rounded-xl border border-white/[.07] bg-black/20 px-3 py-2.5"><span>Outbox</span><span className="font-mono text-slate-200">{tenant?.counts.outbox ?? 0}</span></p><p className="flex justify-between gap-3 rounded-xl border border-white/[.07] bg-black/20 px-3 py-2.5"><span>Riconciliazioni</span><span className="font-mono text-slate-200">{tenant?.counts.reconciliations ?? 0}</span></p><p className="flex justify-between gap-3 rounded-xl border border-white/[.07] bg-black/20 px-3 py-2.5"><span>Documenti</span><span className="font-mono text-slate-200">{tenant?.counts.documents ?? 0}</span></p></div></div></div>
    </section>

    <p className="flex items-center justify-center gap-2 py-2 text-center text-[9px] uppercase tracking-[.14em] text-slate-700"><ShieldCheck className="size-3.5 text-lime-300/50" />Read-only · tenant derivato dal server · cache disabilitata · nessun merge automatico</p>
  </div>;
}
