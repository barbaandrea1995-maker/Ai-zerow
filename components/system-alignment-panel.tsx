"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Archive,
  BadgeCheck,
  CheckCircle2,
  Database,
  GitCompareArrows,
  History,
  Link2,
  MapPinned,
  QrCode,
  RefreshCw,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AlignmentStatus, SystemAlignmentReport } from "@/lib/system-alignment";

type AlignmentResponse = SystemAlignmentReport & {
  authority?: {
    selectedTenantId?: string;
    identityProvider?: string;
    role?: string;
    siteRootVerified?: boolean;
  };
};

const statusStyle: Record<AlignmentStatus, { label: string; badge: string; dot: string; icon: typeof CheckCircle2 }> = {
  READY: { label: "COERENTE", badge: "border-lime-300/25 bg-lime-300/10 text-lime-100", dot: "bg-lime-300", icon: CheckCircle2 },
  REVIEW: { label: "DA VERIFICARE", badge: "border-amber-300/25 bg-amber-300/10 text-amber-100", dot: "bg-amber-300", icon: AlertTriangle },
  BLOCKED: { label: "ANOMALIE", badge: "border-rose-300/25 bg-rose-300/10 text-rose-100", dot: "bg-rose-300", icon: AlertTriangle },
};

function StatusBadge({ status }: { status: AlignmentStatus }) {
  const style = statusStyle[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[.1em] ${style.badge}`}>
      <span className={`size-1.5 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  );
}

function Metric({ label, value, detail, tone = "lime" }: { label: string; value: string | number; detail: string; tone?: "lime" | "amber" | "rose" }) {
  const valueTone = tone === "rose" ? "text-rose-100" : tone === "amber" ? "text-amber-100" : "text-lime-100";
  return (
    <article className="carbon-inset rounded-2xl p-4">
      <p className="text-[9px] font-semibold uppercase tracking-[.16em] text-slate-600">{label}</p>
      <p className={`mt-2 font-mono text-3xl font-semibold tracking-[-.06em] ${valueTone}`}>{value}</p>
      <p className="mt-2 text-[10px] leading-4 text-slate-600">{detail}</p>
    </article>
  );
}

function ReadbackRow({ label, value, accent = false }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className={`flex items-start justify-between gap-4 rounded-xl border px-3 py-2.5 ${accent ? "border-lime-300/15 bg-lime-300/[.035]" : "border-white/[.07] bg-black/20"}`}>
      <span className={accent ? "text-lime-100/70" : "text-slate-500"}>{label}</span>
      <span className={`max-w-[60%] break-words text-right font-mono ${accent ? "text-lime-100" : "text-slate-200"}`}>{value}</span>
    </div>
  );
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) return "Non disponibile";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Non disponibile";
  return date.toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
}

function readableError(error: unknown) {
  const message = error instanceof Error ? error.message : "alignment_readback_failed";
  if (message === "site_root_owner_required") return "Questo registro è visibile solo al Titolare della radice Sites.";
  if (message === "forbidden") return "La membership corrente non possiede tenant.manage.";
  return "Il registro di riallineamento non è disponibile nel runtime corrente.";
}

export default function SystemAlignmentPanel() {
  const [report, setReport] = useState<AlignmentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/governance/alignment", { cache: "no-store" });
      const payload = await response.json() as AlignmentResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || `alignment_${response.status}`);
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
    return (
      <div className="carbon-card mt-4 flex min-h-[360px] items-center justify-center rounded-2xl">
        <div className="text-center">
          <RefreshCw className="mx-auto size-6 animate-spin text-lime-200" />
          <p className="mt-3 text-xs text-slate-500">Rileggo registri canonici e ricevuta D1…</p>
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="carbon-card mt-4 rounded-2xl border-rose-300/15 p-8 text-center">
        <AlertTriangle className="mx-auto size-8 text-rose-200" />
        <h2 className="mt-3 text-base font-semibold text-slate-100">Readback non disponibile</h2>
        <p className="mx-auto mt-2 max-w-lg text-xs leading-5 text-slate-500">{error}</p>
        <Button className="mt-5 border-white/10 bg-white/[.04] text-xs text-slate-200 hover:border-lime-300/30" onClick={() => void load()} variant="outline">
          <RefreshCw className="size-3.5" />
          Riprova
        </Button>
      </div>
    );
  }

  const receipt = report.execution;
  const applied = report.contract.mode === "POST_ALIGNMENT_READBACK" && Boolean(receipt);
  const verified = receipt?.verification === "VERIFIED";
  const targetTenantId = receipt?.targetTenantId ?? report.dryRun.targetTenantId;
  const target = report.tenants.find((tenant) => tenant.id === targetTenantId);
  const status = statusStyle[report.status];
  const StatusIcon = status.icon;
  const openControls = report.summary.blockedGates + report.summary.reviewGates;

  return (
    <div className="mt-4 space-y-4">
      <section className="relative overflow-hidden rounded-[24px] border border-lime-300/20 bg-[linear-gradient(120deg,rgba(7,12,8,.98),rgba(11,22,12,.94)_58%,rgba(125,170,0,.2))] p-5 shadow-[0_20px_60px_rgba(0,0,0,.35)] sm:p-6">
        <div className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full bg-lime-300/[.1] blur-[80px]" />
        <div className="relative flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.2em] text-lime-300/75">
              {applied ? <BadgeCheck className="size-4" /> : <GitCompareArrows className="size-4" />}
              {applied ? "Governance · readback server-side" : "Governance · baseline server-side"}
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-.04em] text-slate-50 sm:text-3xl">
              {applied ? verified ? "Riallineamento completato" : "Riallineamento registrato" : "Riallineamento aziendale"}
            </h2>
            <p className="mt-3 max-w-2xl text-xs leading-6 text-slate-400">
              {applied
                ? verified
                  ? "Il tenant operativo è attivo, la radice legacy è archiviata e ogni collegamento mantiene la provenienza. Questa vista rilegge lo stato reale senza modificarlo."
                  : "L’esecuzione risulta completata, ma uno o più invarianti della ricevuta richiedono verifica. Nessun dato viene corretto automaticamente da questa sezione."
                : "Il server confronta tenant, cataloghi e registri operativi e prepara un piano senza spostare, unire o cancellare record."}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {applied ? (
                <>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-lime-300/25 bg-lime-300/10 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[.1em] text-lime-100"><span className="size-1.5 rounded-full bg-lime-300" />Applicato</span>
                  <span className={`rounded-full border px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[.1em] ${verified ? "border-cyan-300/20 bg-cyan-300/[.06] text-cyan-100" : "border-amber-300/25 bg-amber-300/10 text-amber-100"}`}>{verified ? "Readback verificato" : "Readback da verificare"}</span>
                </>
              ) : <StatusBadge status={report.status} />}
              <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[9px] font-mono text-slate-500">{report.contract.version}</span>
              {report.summary.truncated ? <span className="rounded-full border border-amber-300/20 bg-amber-300/[.06] px-2.5 py-1 text-[9px] uppercase tracking-[.1em] text-amber-100">Lettura parziale</span> : null}
            </div>
          </div>

          <div className="min-w-[220px] rounded-2xl border border-white/10 bg-black/25 p-4 backdrop-blur">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[9px] uppercase tracking-[.16em] text-slate-600">Integrità corrente</span>
              <StatusIcon className={report.status === "READY" ? "size-4 text-lime-200" : report.status === "REVIEW" ? "size-4 text-amber-200" : "size-4 text-rose-200"} />
            </div>
            <p className="mt-3 font-mono text-xl font-semibold text-slate-100">{status.label}</p>
            <p className="mt-2 text-[10px] leading-5 text-slate-500">Riletta {formatTimestamp(report.generatedAt)}</p>
            <Button aria-label="Rileggi i registri D1" className="mt-4 h-9 w-full border-white/10 bg-white/[.03] text-[10px] text-slate-300 hover:border-lime-300/30 hover:text-lime-100" disabled={loading} onClick={() => void load()} variant="outline">
              <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
              Rileggi D1
            </Button>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {applied && receipt ? (
          <>
            <Metric detail="Una sola radice aziendale operativa" label="Tenant attivi" tone={report.summary.tenantRoots === 1 ? "lime" : "amber"} value={report.summary.tenantRoots} />
            <Metric detail="Collegamenti sorgente-target conservati" label="Provenienza" tone={receipt.linkCount ? "lime" : "rose"} value={receipt.linkCount} />
            <Metric detail="Posizioni fisiche canoniche nel tenant operativo" label="Custodie asset" tone={(target?.counts.assetCustody ?? 0) > 0 ? "lime" : "amber"} value={target?.counts.assetCustody ?? 0} />
            <Metric detail="Blocchi e revisioni nei registri correnti" label="Controlli aperti" tone={report.summary.blockedGates ? "rose" : report.summary.reviewGates ? "amber" : "lime"} value={openControls} />
          </>
        ) : (
          <>
            <Metric detail="Radici aziendali attive osservate" label="Tenant" tone={report.summary.tenantRoots > 1 ? "amber" : "lime"} value={report.summary.tenantRoots} />
            <Metric detail="Gate che impediscono il riallineamento" label="Blocchi" tone={report.summary.blockedGates ? "rose" : "lime"} value={report.summary.blockedGates} />
            <Metric detail="Decisioni o riconciliazioni umane" label="Revisioni" tone={report.summary.reviewGates ? "amber" : "lime"} value={report.summary.reviewGates} />
            <Metric detail="Collisioni tra sorgenti e target" label="Conflitti dry-run" tone={report.summary.conflicts ? "amber" : "lime"} value={report.summary.conflicts} />
          </>
        )}
      </section>

      <section className="grid gap-4 2xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,.8fr)]">
        <div className="carbon-card rounded-2xl p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">Registro invarianti</p>
              <h2 className="mt-1 text-base font-semibold text-slate-100">{applied ? "Controlli post-riallineamento" : "Controlli prima del riallineamento"}</h2>
              <p className="mt-1 text-[11px] leading-5 text-slate-500">{applied ? "I gate rileggono cataloghi, luoghi, identità, missioni, scorte ed eventi del tenant canonico." : "Ogni gate identifica il record da risolvere prima dell’esecuzione."}</p>
            </div>
            <ShieldCheck className="size-5 text-lime-200" />
          </div>
          <div className="mt-4 space-y-2">
            {report.gates.map((gate) => (
              <article className="rounded-xl border border-white/[.08] bg-black/20 p-3" key={gate.id}>
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl border border-white/[.08] bg-black/25">
                    {gate.id === "canonical-places" ? <MapPinned className="size-4 text-cyan-200" /> : gate.id === "qr-registry" ? <QrCode className="size-4 text-cyan-200" /> : gate.id === "identity-membership" ? <UsersRound className="size-4 text-cyan-200" /> : <Database className="size-4 text-cyan-200" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-xs font-semibold text-slate-200">{gate.label}</h3>
                      <StatusBadge status={gate.status} />
                    </div>
                    <p className="mt-1 text-[11px] leading-5 text-slate-500">{gate.detail}</p>
                    {gate.nextAction !== "Nessuna" ? <p className="mt-2 rounded-lg border border-amber-300/10 bg-amber-300/[.025] px-2.5 py-2 text-[10px] leading-4 text-amber-100/70"><span className="text-amber-100/50">Azione · </span>{gate.nextAction}</p> : null}
                    {gate.entityIds.length > 0 ? (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[9px] uppercase tracking-[.12em] text-slate-600">{gate.entityIds.length} riferimenti osservati</summary>
                        <div className="mt-2 space-y-1">{gate.entityIds.map((id) => <p className="break-all rounded-md bg-black/20 px-2 py-1 font-mono text-[9px] text-slate-600" key={`${gate.id}-${id}`}>{id}</p>)}</div>
                      </details>
                    ) : null}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div className="carbon-card rounded-2xl border-lime-300/15 p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">{applied ? "Tenant operativo" : "Target raccomandato"}</p>
                <h2 className="mt-1 text-base font-semibold text-slate-100">{target?.name ?? "Decisione non deterministica"}</h2>
              </div>
              <Database className="size-5 text-lime-200" />
            </div>
            {target ? (
              <>
                <p className="mt-3 break-all font-mono text-[10px] leading-5 text-lime-100">{target.id}</p>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[.13em] text-slate-600">Readiness</p><p className="mt-1 font-mono text-xl text-lime-100">{target.readinessScore}/100</p></div>
                  <div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[.13em] text-slate-600">Profilo azienda</p><p className="mt-1 font-mono text-xl text-slate-100">{target.companyProfileFields.completed}/{target.companyProfileFields.total}</p></div>
                  <div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[.13em] text-slate-600">Luoghi</p><p className="mt-1 font-mono text-xl text-slate-100">{target.canonicalPlaces.covered}/{target.canonicalPlaces.expected}</p></div>
                  <div className="carbon-inset rounded-xl p-3"><p className="text-[9px] uppercase tracking-[.13em] text-slate-600">QR</p><p className="mt-1 font-mono text-xl text-slate-100">{target.qrCoverage.covered}/{target.qrCoverage.expected}</p></div>
                </div>
                <p className="mt-4 text-[10px] leading-5 text-slate-600">{applied ? "Identificato dalla ricevuta del riallineamento e verificato contro la radice attiva." : "La raccomandazione deriva dalla completezza osservata e non equivale a un’approvazione."}</p>
              </>
            ) : <p className="mt-4 text-xs leading-5 text-amber-100/80">Il target non è risolvibile dai registri correnti.</p>}
          </div>

          {applied && receipt ? (
            <div className={`carbon-card rounded-2xl p-4 sm:p-5 ${verified ? "border-lime-300/15" : "border-amber-300/20"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">Ricevuta esecuzione</p><h2 className="mt-1 break-all text-sm font-semibold text-slate-100">{receipt.runId}</h2></div>
                {verified ? <BadgeCheck className="size-5 text-lime-200" /> : <AlertTriangle className="size-5 text-amber-200" />}
              </div>
              <p className="mt-2 text-[10px] leading-5 text-slate-500">Completata {formatTimestamp(receipt.completedAt)}</p>
              <div className="mt-4 space-y-2 text-[10px]">
                <ReadbackRow label="Radice legacy" value={receipt.sourceTenantStatus ?? "sconosciuta"} />
                <ReadbackRow label="Tenant operativo" value={receipt.targetTenantStatus ?? "sconosciuto"} />
                <ReadbackRow accent label="Link di provenienza" value={receipt.linkCount} />
                <ReadbackRow label="Record clonati / abbinati" value={`${receipt.clonedRecords} / ${receipt.matchedRecords}`} />
                <ReadbackRow label="Righe sorgente eliminate" value={receipt.sourceRowsDeleted === false ? "NO" : receipt.sourceRowsDeleted === true ? "SÌ" : "NON VERIFICATO"} />
              </div>
              <details className="mt-4 rounded-xl border border-white/[.07] bg-black/20 p-3">
                <summary className="cursor-pointer text-[9px] font-semibold uppercase tracking-[.12em] text-slate-500">Dettagli tecnici e rollback</summary>
                <div className="mt-3 space-y-3 text-[9px] leading-4 text-slate-600">
                  <p><span className="text-slate-400">Manifest · </span><span className="break-all font-mono">{receipt.manifestHash}</span></p>
                  <p><span className="text-slate-400">Rollback logico · </span>{receipt.rollback ?? "Non registrato"}</p>
                </div>
              </details>
            </div>
          ) : (
            <div className="carbon-card rounded-2xl p-4 sm:p-5">
              <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">Dry-run</p>
              <h2 className="mt-1 text-sm font-semibold text-slate-100">Piano senza scritture</h2>
              <div className="mt-4 space-y-2 text-[10px]">
                <ReadbackRow label="Tenant sorgente" value={report.dryRun.sourceTenantIds.length} />
                <ReadbackRow label="Record candidati" value={report.dryRun.candidateRecords} />
                <ReadbackRow accent label="Operazioni di scrittura" value={report.dryRun.writeOperations} />
              </div>
              <ol className="mt-4 space-y-2">{report.dryRun.requiredHumanDecisions.map((decision, index) => <li className="flex gap-2 text-[10px] leading-5 text-slate-500" key={decision}><span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border border-white/10 bg-black/20 font-mono text-[9px] text-lime-200">{index + 1}</span>{decision}</li>)}</ol>
            </div>
          )}
        </div>
      </section>

      <section className="carbon-card rounded-2xl p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">Radice aziendale</p><h2 className="mt-1 text-base font-semibold text-slate-100">{applied ? "Tenant canonico osservato" : "Tenant osservati"}</h2></div>
          <span className="rounded-full border border-white/10 px-2.5 py-1 text-[9px] font-mono text-slate-600">perimetro · titolare Sites</span>
        </div>
        <div className="mt-4 grid gap-3 xl:grid-cols-2">
          {report.tenants.map((tenant) => {
            const isTarget = tenant.id === targetTenantId;
            return (
              <article className={`rounded-2xl border p-4 ${isTarget ? "border-lime-300/25 bg-lime-300/[.045]" : "border-white/[.08] bg-black/20"}`} key={tenant.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold text-slate-100">{tenant.name}</h3>{isTarget ? <span className="rounded-full bg-lime-300 px-2 py-1 text-[8px] font-semibold uppercase tracking-[.1em] text-[#050705]">{applied ? "Canonico" : "Target proposto"}</span> : null}</div>
                    <p className="mt-1 break-all font-mono text-[9px] text-slate-600">{tenant.id}</p>
                  </div>
                  <span className="font-mono text-xl text-lime-100">{tenant.readinessScore}</span>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl border border-white/[.06] bg-black/20 p-2"><p className="font-mono text-sm text-slate-100">{tenant.counts.operations}</p><p className="mt-1 text-[8px] uppercase tracking-[.12em] text-slate-600">Commesse</p></div>
                  <div className="rounded-xl border border-white/[.06] bg-black/20 p-2"><p className="font-mono text-sm text-slate-100">{tenant.counts.warehouses}</p><p className="mt-1 text-[8px] uppercase tracking-[.12em] text-slate-600">Magazzini</p></div>
                  <div className="rounded-xl border border-white/[.06] bg-black/20 p-2"><p className="font-mono text-sm text-slate-100">{tenant.counts.assets}</p><p className="mt-1 text-[8px] uppercase tracking-[.12em] text-slate-600">Asset</p></div>
                </div>
                <div className="mt-3 grid gap-2 text-[10px] sm:grid-cols-2">
                  <p className="rounded-lg border border-white/[.06] bg-black/15 px-2.5 py-2 text-slate-500">Luoghi · <span className="text-slate-200">{tenant.canonicalPlaces.covered}/{tenant.canonicalPlaces.expected}</span></p>
                  <p className="rounded-lg border border-white/[.06] bg-black/15 px-2.5 py-2 text-slate-500">QR · <span className="text-slate-200">{tenant.qrCoverage.covered}/{tenant.qrCoverage.expected}</span></p>
                  <p className="rounded-lg border border-white/[.06] bg-black/15 px-2.5 py-2 text-slate-500">Membership · <span className="text-slate-200">{tenant.counts.memberships}</span></p>
                  <p className="rounded-lg border border-white/[.06] bg-black/15 px-2.5 py-2 text-slate-500">Missioni · <span className="text-slate-200">{tenant.counts.missions}</span></p>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {!applied && report.dryRun.conflicts.length > 0 ? (
        <section className="carbon-card rounded-2xl border-amber-300/15 p-4 sm:p-5">
          <div className="flex items-center gap-2 text-amber-100"><AlertTriangle className="size-4" /><h2 className="text-sm font-semibold">Collisioni da decidere</h2></div>
          <div className="mt-4 space-y-2">{report.dryRun.conflicts.map((conflict) => <div className="grid gap-2 rounded-xl border border-white/[.07] bg-black/20 p-3 text-[10px] md:grid-cols-[160px_minmax(0,1fr)]" key={`${conflict.registry}-${conflict.key}`}><span className="font-mono text-amber-100">{conflict.registry}</span><div><p className="break-all text-slate-300">{conflict.key}</p><p className="mt-1 text-slate-600">Target {conflict.targetEntityIds.length} · sorgente {conflict.sourceEntityIds.length}</p></div></div>)}</div>
        </section>
      ) : null}

      <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 py-2 text-center text-[9px] uppercase tracking-[.14em] text-slate-700">
        {applied ? <><Archive className="size-3.5 text-lime-300/50" />Radice legacy archiviata<Link2 className="size-3.5 text-cyan-300/50" />Provenienza conservata<History className="size-3.5 text-amber-200/50" />Rollback logico disponibile</> : <><ShieldCheck className="size-3.5 text-lime-300/50" />Nessun record modificato · tenant e identità risolti dal server · cache disabilitata</>}
      </p>
    </div>
  );
}
