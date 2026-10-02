"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, CircleAlert, CircleDollarSign, ExternalLink, FileCheck2, LoaderCircle, Plus, RefreshCw, ShieldCheck, ShoppingCart, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { W10Module } from "@/lib/w10-contract";

type Workflow = {
  id: string;
  module: W10Module;
  recordType: string;
  title: string;
  detail: string;
  status: string;
  amountMilli: number;
  currency: string;
  jobId: string | null;
  supplier: string;
  version: number;
  progress: number;
  nextActions: string[];
  externalStatus: "SITES_READY" | "EXTERNAL_DEFERRED" | "RECONCILED";
  createdAt: string;
  updatedAt: string;
};

type ApiResponse = {
  context?: { capabilities?: string[] };
  workflows?: Workflow[];
  error?: string;
  detail?: string;
};

const actionLabels: Record<string, string> = {
  request: "Invia richiesta",
  submit_review: "Invia in revisione",
  approve: "Approva",
  prepare_po: "Prepara bozza PO",
  external_issue: "Invio a fornitore",
  receive_partial: "Ricezione parziale",
  receive: "Segna ricevuto",
  reconcile: "Riconcilia",
};

const externalActions = new Set(["external_issue", "receive_partial", "receive"]);

function formatAmount(value: number, currency: string) {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency }).format(value / 1000);
}

function statusTone(status: string) {
  if (["APPROVED", "RECONCILED"].includes(status)) return "border-lime-300/25 bg-lime-300/10 text-lime-100";
  if (["REVIEW", "PO_DRAFT"].includes(status)) return "border-cyan-300/25 bg-cyan-300/10 text-cyan-100";
  if (["PO_ISSUED", "PARTIALLY_RECEIVED"].includes(status)) return "border-amber-300/25 bg-amber-300/10 text-amber-100";
  return "border-white/10 bg-white/[0.04] text-slate-300";
}

export default function W10WorkflowControl({ module }: { module: W10Module }) {
  const router = useRouter();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState({ title: "", detail: "", amount: "", supplier: "", jobId: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/${module}/workflow`, { cache: "no-store" });
      const data = await response.json() as ApiResponse;
      if (!response.ok) throw new Error(data.error ?? "w10_readback_unavailable");
      setWorkflows(data.workflows ?? []);
      setCapabilities(data.context?.capabilities ?? []);
      setSelectedId((current) => current && (data.workflows ?? []).some((item) => item.id === current) ? current : data.workflows?.[0]?.id ?? "");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Readback W10 non disponibile");
    } finally {
      setLoading(false);
    }
  }, [module]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  const selected = useMemo(() => workflows.find((item) => item.id === selectedId) ?? workflows[0], [selectedId, workflows]);
  const canWrite = capabilities.includes(`${module}.write`);
  const canApprove = capabilities.includes("approvals.review");
  const title = module === "procurement" ? "Procurement command" : "Finance command";
  const subtitle = module === "procurement"
    ? "Dalla necessità alla bozza d’ordine, con approval e confine provider esplicito."
    : "Costi e movimenti governati, con approval e riconciliazione prima del ledger esterno.";
  const Icon = module === "procurement" ? ShoppingCart : CircleDollarSign;

  function notify(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 4200);
  }

  async function createWorkflow() {
    if (form.title.trim().length < 2) { notify("Inserisci un titolo descrittivo."); return; }
    const amount = Number(form.amount.replace(",", "."));
    if (!Number.isFinite(amount) || amount < 0) { notify("Importo non valido."); return; }
    setSaving(true);
    try {
      const response = await fetch(`/api/${module}/workflow`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "create",
          title: form.title,
          detail: form.detail,
          amountMilli: Math.round(amount * 1000),
          supplier: form.supplier,
          jobId: form.jobId || undefined,
          idempotencyKey: `w10-create-${module}-${crypto.randomUUID()}`,
        }),
      });
      const data = await response.json() as ApiResponse;
      if (!response.ok) throw new Error(data.error ?? "w10_create_failed");
      setForm({ title: "", detail: "", amount: "", supplier: "", jobId: "" });
      setComposerOpen(false);
      notify("Workflow creato e riletto dal registro Sites.");
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Creazione non disponibile");
    } finally {
      setSaving(false);
    }
  }

  async function transition(action: string) {
    if (!selected) return;
    if (externalActions.has(action)) { notify("Azione mantenuta in attesa: executor esterno non configurato."); return; }
    setSaving(true);
    try {
      const response = await fetch(`/api/${module}/workflow`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, id: selected.id, expectedVersion: selected.version, idempotencyKey: `w10-transition-${selected.id}-${selected.version}-${action}`, evidence: "Sites workflow control" }),
      });
      const data = await response.json() as ApiResponse;
      if (!response.ok) throw new Error(data.detail ?? data.error ?? "w10_transition_failed");
      notify(`Stato aggiornato: ${actionLabels[action] ?? action}.`);
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Transizione non disponibile");
      await load();
    } finally {
      setSaving(false);
    }
  }

  return <main className="min-h-screen overflow-x-hidden bg-[#030504] px-4 py-5 text-slate-100 sm:px-7 sm:py-7">
    <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_75%_0%,rgba(200,255,34,0.09),transparent_26%),linear-gradient(145deg,#020403,#071008_48%,#030504)]" />
    <div className="relative mx-auto max-w-[1580px]">
      <header className="overflow-hidden rounded-[28px] border border-lime-300/20 bg-[linear-gradient(145deg,rgba(18,27,19,0.98),rgba(4,7,5,0.99)_62%,rgba(13,20,14,0.98))] p-6 shadow-[0_30px_90px_rgba(0,0,0,.45)] sm:p-8">
        <div className="pointer-events-none absolute -right-48 -top-52 size-[34rem] rounded-full bg-lime-300/[0.06] blur-3xl" />
        <div className="pointer-events-none absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-lime-300/80 to-transparent" />
        <div className="relative flex flex-wrap items-start justify-between gap-6">
          <div className="flex items-start gap-4"><span className="grid size-12 shrink-0 place-items-center rounded-2xl border border-lime-300/30 bg-lime-300/10 text-lime-200 shadow-[0_0_30px_rgba(200,255,34,.14)]"><Icon className="size-5" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-lime-300/75">AI-ZEROW / W10 / {module.toUpperCase()}</p><h1 className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-lime-50 sm:text-[42px]">{title}</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">{subtitle}</p></div></div>
          <div className="flex flex-wrap gap-2"><Button variant="outline" className="border-white/10 bg-black/25 text-slate-300 hover:border-lime-300/30 hover:text-lime-100" onClick={() => router.push("/command")}><ArrowLeft className="size-3.5" />Command</Button><Button className="bg-lime-300 text-xs font-semibold text-[#050705] hover:bg-lime-200" disabled={!canWrite} onClick={() => setComposerOpen((value) => !value)}><Plus className="size-3.5" />Nuovo workflow</Button><button aria-label="Aggiorna workflow" className="grid size-10 place-items-center rounded-xl border border-white/10 bg-black/25 text-slate-500 hover:border-lime-300/30 hover:text-lime-200" onClick={() => void load()} type="button"><RefreshCw className="size-4" /></button></div>
        </div>
        <div className="relative mt-7 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.14em]"><span className="rounded-full border border-lime-300/20 bg-lime-300/[0.06] px-3 py-1.5 text-lime-100">SITES CONTROL · D1 READBACK</span><span className="rounded-full border border-amber-300/20 bg-amber-300/[0.06] px-3 py-1.5 text-amber-100">EXECUTOR ESTERNO DIFFERITO</span>{canApprove && <span className="rounded-full border border-cyan-300/20 bg-cyan-300/[0.06] px-3 py-1.5 text-cyan-100">APPROVAL AUTHORITY</span>}</div>
      </header>

      <section className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
        { label: "Workflow", value: workflows.length, detail: "tenant-scoped", icon: FileCheck2 },
        { label: "In revisione", value: workflows.filter((item) => item.status === "REVIEW").length, detail: "approval gate", icon: ShieldCheck },
        { label: "Valore aperto", value: formatAmount(workflows.filter((item) => item.status !== "RECONCILED").reduce((sum, item) => sum + item.amountMilli, 0), "EUR"), detail: "stato Sites", icon: CircleDollarSign },
        { label: "Riconciliati", value: workflows.filter((item) => item.status === "RECONCILED").length, detail: "readback verified", icon: Check },
      ].map((kpi) => <article className="rounded-[20px] border border-white/[0.07] bg-[linear-gradient(180deg,rgba(19,28,20,.92),rgba(6,9,7,.98))] p-4 shadow-[0_16px_46px_rgba(0,0,0,.28)]" key={kpi.label}><div className="flex items-start justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">{kpi.label}</p><p className="mt-2 font-mono text-2xl font-semibold tracking-[-0.04em] text-lime-100">{kpi.value}</p><p className="mt-1 text-[10px] text-slate-600">{kpi.detail}</p></div><span className="grid size-9 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/[0.07] text-lime-200"><kpi.icon className="size-4" /></span></div></article>)}
      </section>

      {composerOpen && <section className="mt-4 rounded-2xl border border-lime-300/25 bg-[linear-gradient(180deg,rgba(18,28,19,.96),rgba(5,8,6,.98))] p-5 shadow-[0_0_34px_rgba(200,255,34,.12)]"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-lime-300/75">W10 / GOVERNED INTAKE</p><h2 className="mt-1 text-base font-semibold">{module === "procurement" ? "Nuova richiesta di acquisto" : "Nuova voce finanziaria"}</h2><p className="mt-1 text-xs text-slate-500">La creazione apre uno stato locale; nessun ordine o pagamento viene eseguito automaticamente.</p></div><button aria-label="Chiudi" className="text-slate-500 hover:text-white" onClick={() => setComposerOpen(false)} type="button"><X className="size-4" /></button></div><div className="mt-5 grid gap-3 md:grid-cols-2"><label className="text-xs text-slate-400">Titolo<Input className="mt-2 border-white/10 bg-black/35 text-sm" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder={module === "procurement" ? "Materiale per commessa" : "Costo trasporto / fornitore"} /></label><label className="text-xs text-slate-400">Importo (EUR)<Input className="mt-2 border-white/10 bg-black/35 text-sm" inputMode="decimal" type="number" min="0" step="0.001" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="0,00" /></label><label className="text-xs text-slate-400">Fornitore / controparte<Input className="mt-2 border-white/10 bg-black/35 text-sm" value={form.supplier} onChange={(event) => setForm({ ...form, supplier: event.target.value })} placeholder="Facoltativo" /></label><label className="text-xs text-slate-400">Commessa<Input className="mt-2 border-white/10 bg-black/35 text-sm" value={form.jobId} onChange={(event) => setForm({ ...form, jobId: event.target.value })} placeholder="Codice o ID" /></label></div><label className="mt-3 block text-xs text-slate-400">Dettaglio<Textarea className="mt-2 min-h-24 border-white/10 bg-black/35 text-sm" value={form.detail} onChange={(event) => setForm({ ...form, detail: event.target.value })} placeholder="Contesto operativo, righe, evidenza o nota…" /></label><div className="mt-4 flex flex-wrap items-center justify-between gap-3"><span className="flex items-center gap-2 text-[11px] text-slate-600"><ShieldCheck className="size-3.5 text-lime-300" />Tenant, actor e versione sono assegnati dal server.</span><Button className="bg-lime-300 text-xs font-semibold text-[#050705] hover:bg-lime-200" disabled={saving || !canWrite} onClick={() => void createWorkflow()}>{saving ? <LoaderCircle className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}Crea e rileggi</Button></div></section>}

      <section className="mt-4 grid gap-4 2xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,.9fr)]"><article className="rounded-[24px] border border-white/[0.07] bg-[linear-gradient(180deg,rgba(14,21,15,.94),rgba(5,8,6,.98))] p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/70">{module.toUpperCase()} / REGISTER</p><h2 className="mt-1 text-base font-semibold">Stato workflow</h2><p className="mt-1 text-xs text-slate-500">Ogni passaggio genera evento, outbox e reconciliation nello stesso tenant.</p></div><span className="rounded-full border border-lime-300/20 bg-lime-300/[0.06] px-3 py-1.5 text-[10px] font-semibold text-lime-100">{loading ? "READING" : "VERIFIED"}</span></div><div className="mt-5 space-y-2">{workflows.map((item) => <button className={`w-full rounded-2xl border p-4 text-left transition ${selected?.id === item.id ? "border-lime-300/35 bg-lime-300/[0.07] shadow-[0_0_22px_rgba(200,255,34,.09)]" : "border-white/[0.07] bg-black/20 hover:border-lime-300/20"}`} key={item.id} onClick={() => setSelectedId(item.id)} type="button"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="truncate text-sm font-semibold text-slate-100">{item.title}</span><span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${statusTone(item.status)}`}>{item.status}</span></div><p className="mt-1 truncate text-[11px] text-slate-500">{item.id} · v{item.version}{item.jobId ? ` · ${item.jobId}` : ""}</p></div><span className="font-mono text-sm text-lime-100">{formatAmount(item.amountMilli, item.currency)}</span></div><div className="mt-4 flex items-center gap-3"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/60"><span className="block h-full rounded-full bg-gradient-to-r from-lime-500 via-lime-300 to-lime-100" style={{ width: `${item.progress}%` }} /></div><span className="font-mono text-[10px] text-slate-500">{item.progress}%</span></div></button>)}{!loading && workflows.length === 0 && <div className="rounded-2xl border border-dashed border-white/[0.1] px-5 py-14 text-center"><Icon className="mx-auto size-8 text-slate-700" /><p className="mt-3 text-sm text-slate-500">Nessun workflow nel tenant.</p><p className="mt-1 text-xs text-slate-700">Crea il primo elemento per aprire il ciclo governato.</p></div>}{loading && <div className="flex items-center justify-center gap-3 py-14 text-xs text-slate-500"><LoaderCircle className="size-4 animate-spin text-lime-300" />Lettura workflow…</div>}</div></article>

        <aside className="rounded-[24px] border border-lime-300/20 bg-[linear-gradient(180deg,rgba(18,28,19,.96),rgba(5,8,6,.99))] p-5 shadow-[0_0_30px_rgba(200,255,34,.07)]"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/70">SELECTED / CONTROL</p><h2 className="mt-1 text-base font-semibold">{selected?.title ?? "Seleziona un workflow"}</h2><p className="mt-1 text-xs text-slate-500">{selected?.id ?? "—"}</p></div>{selected && <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${statusTone(selected.status)}`}>{selected.status}</span>}</div>{selected ? <><div className="mt-5 grid grid-cols-2 gap-2"><div className="rounded-xl border border-white/[0.08] bg-black/25 p-3"><p className="text-[10px] uppercase tracking-[0.12em] text-slate-600">Valore</p><p className="mt-2 font-mono text-sm text-lime-100">{formatAmount(selected.amountMilli, selected.currency)}</p></div><div className="rounded-xl border border-white/[0.08] bg-black/25 p-3"><p className="text-[10px] uppercase tracking-[0.12em] text-slate-600">Boundary</p><p className={`mt-2 text-[11px] font-semibold ${selected.externalStatus === "EXTERNAL_DEFERRED" ? "text-amber-100" : "text-lime-100"}`}>{selected.externalStatus}</p></div></div><div className="mt-4 rounded-xl border border-white/[0.08] bg-black/25 p-4"><p className="text-xs leading-5 text-slate-400">{selected.detail || "Nessun dettaglio."}</p><div className="mt-4 h-2 overflow-hidden rounded-full bg-black/60"><span className="block h-full rounded-full bg-gradient-to-r from-lime-500 via-lime-300 to-lime-100" style={{ width: `${selected.progress}%` }} /></div><div className="mt-2 flex justify-between text-[10px] text-slate-600"><span>Versione {selected.version}</span><span>{selected.progress}%</span></div></div><div className="mt-4 space-y-2"><p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-600">Azioni disponibili</p>{selected.nextActions.map((action) => { const external = externalActions.has(action); const allowed = action === "approve" ? canApprove : canWrite; return <Button className={`h-10 w-full justify-between text-xs ${external ? "border-amber-300/20 bg-amber-300/[0.06] text-amber-100 hover:bg-amber-300/[0.1]" : "border-lime-300/20 bg-lime-300/[0.06] text-lime-100 hover:bg-lime-300/[0.12]"}`} disabled={saving || !allowed || external} key={action} onClick={() => void transition(action)} variant="outline"> <span className="flex items-center gap-2">{external ? <ExternalLink className="size-3.5" /> : action === "approve" ? <ShieldCheck className="size-3.5" /> : <ArrowRight className="size-3.5" />}{actionLabels[action] ?? action}</span><span className="text-[10px] opacity-60">{external ? "provider" : action === "approve" && !canApprove ? "authority" : "esegui"}</span></Button>; })}{selected.nextActions.length === 0 && <p className="rounded-xl border border-white/[0.08] bg-black/20 p-3 text-xs text-slate-600">Nessuna transizione locale disponibile.</p>}</div></> : <div className="mt-6 rounded-2xl border border-dashed border-white/[0.1] p-6 text-center"><CircleAlert className="mx-auto size-7 text-slate-700" /><p className="mt-3 text-sm text-slate-500">Il pannello si attiva dopo il primo readback.</p></div>}<div className="mt-5 rounded-xl border border-amber-300/20 bg-amber-300/[0.05] p-3"><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-100"><ExternalLink className="size-3.5" />Confine esterno</div><p className="mt-2 text-xs leading-5 text-slate-500">Invio ordine, ricezione fisica e contabilizzazione esterna restano bloccati fino all’adapter provider-backed.</p></div></aside></section>

      <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] py-5 text-[10px] text-slate-600"><span>AI-ZEROW COMMAND · W10 {module.toUpperCase()}</span><span className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-lime-300" />Sites private · approval governed · no external mutation</span></footer>
    </div>
    {notice && <button className="fixed bottom-5 right-5 z-50 max-w-[380px] rounded-xl border border-lime-300/25 bg-[#080d09]/95 px-4 py-3 text-left text-xs text-lime-100 shadow-[0_0_30px_rgba(190,255,60,.16)] backdrop-blur-xl" onClick={() => setNotice("")} type="button"><Check className="mr-2 inline size-4 text-lime-300" />{notice}</button>}
  </main>;
}
