"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Check, CheckCircle2, CircleDollarSign, LoaderCircle, Plus, RefreshCw, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  commercialModelLabel,
  commercialValueLabel,
  type JobCommercialTerms,
  type JobWorkOrderEconomics,
  type JobWorkOrderStatus,
} from "@/lib/job-commercial-terms";
import { idempotentJsonMutation } from "@/lib/client-request-idempotency";

type CommercialPayload = {
  job: { id: string; code: string | null; title: string; status: string };
  terms: JobCommercialTerms;
  workOrderEconomics: JobWorkOrderEconomics;
  can: { write: boolean };
  options: {
    valueBases: Array<{ value: "ESTIMATE" | "CONTRACTED"; label: string }>;
    catalogAuthority: "SERVER_CONTRACT";
  };
  readback: { status: string; checkedAt: string };
  mutation?: { eventId?: string; idempotent?: boolean };
  error?: string;
};

function money(value: number | null, currency = "EUR") {
  if (value === null) return "Non disponibile";
  return new Intl.NumberFormat("it-IT", { style: "currency", currency }).format(value / 100);
}

function statusLabel(status: JobWorkOrderStatus) {
  if (status === "APPROVED") return "APPROVATA";
  if (status === "COMPLETED") return "COMPLETATA";
  if (status === "CANCELLED") return "ANNULLATA";
  return "BOZZA";
}

function statusTone(status: JobWorkOrderStatus) {
  if (status === "COMPLETED") return "border-lime-300/25 bg-lime-300/[.07] text-lime-100";
  if (status === "APPROVED") return "border-cyan-300/25 bg-cyan-300/[.07] text-cyan-100";
  if (status === "CANCELLED") return "border-rose-300/20 bg-rose-300/[.05] text-rose-100";
  return "border-amber-300/20 bg-amber-300/[.05] text-amber-100";
}

function errorLabel(code?: string) {
  if (code === "version_conflict") return "La lavorazione è stata aggiornata da un altro utente. Ho riletto la versione corrente.";
  if (code === "work_order_value_not_allowed_for_commercial_model") return "Questa commessa non usa valori per singola lavorazione.";
  if (code === "work_order_value_invalid") return "Inserisci un importo positivo con al massimo due decimali.";
  if (code === "work_order_title_required") return "Indica il nome della lavorazione o dell’intervento.";
  if (code === "work_order_transition_not_allowed") return "Questo passaggio di stato non è consentito.";
  return "Operazione non completata. Controlla i dati e riprova.";
}

export default function JobCommercialTermsPanel({ jobId }: { jobId: string }) {
  const [payload, setPayload] = useState<CommercialPayload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "forbidden" | "error">("loading");
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const busyRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/operations/jobs/${encodeURIComponent(jobId)}/commercial`, { cache: "no-store" });
      if (response.status === 403) { setState("forbidden"); return; }
      const result = await response.json() as CommercialPayload;
      if (!response.ok || result.readback?.status !== "verified") throw new Error(result.error || "commercial_readback_unavailable");
      setPayload(result);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [jobId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const mutate = useCallback(async (body: Record<string, unknown>) => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setNotice("");
    try {
      const response = await idempotentJsonMutation({
        url: `/api/operations/jobs/${encodeURIComponent(jobId)}/commercial`,
        namespace: "job-commercial",
        operation: `${String(body.action ?? "mutation")}:${jobId}`,
        payload: body,
      });
      const result = await response.json() as CommercialPayload;
      if (!response.ok) {
        setNotice(errorLabel(result.error));
        if (response.status === 409) await refresh();
        return false;
      }
      if (result.readback?.status !== "verified" || !result.mutation?.eventId) {
        setNotice("Il server non ha confermato evento e rilettura della lavorazione.");
        return false;
      }
      setPayload(result);
      setState("ready");
      setNotice(`Registro aggiornato · evento ${result.mutation.eventId.slice(0, 8)}`);
      return true;
    } catch {
      setNotice("Connessione non disponibile: nessuna modifica è stata considerata confermata.");
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [jobId, refresh]);

  const submitWorkOrder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const created = await mutate({
      action: "create_work_order",
      title: String(form.get("title") ?? "").trim(),
      description: String(form.get("description") ?? "").trim(),
      amount: String(form.get("amount") ?? "").trim(),
      basis: String(form.get("basis") ?? "ESTIMATE"),
    });
    if (created) setCreateOpen(false);
  };

  if (state === "loading") return <div className="mt-4 flex items-center gap-2 rounded-xl border border-white/[.07] bg-black/20 px-3 py-3 text-[10px] text-slate-500"><LoaderCircle className="size-3.5 animate-spin text-lime-300" />Lettura delle condizioni economiche…</div>;
  if (state === "forbidden") return null;
  if (state === "error" || !payload) return <div className="mt-4 rounded-xl border border-amber-300/15 bg-amber-300/[.03] p-3"><p className="text-[10px] text-amber-100">Condizioni economiche non disponibili.</p><Button className="mt-2 h-8 border-white/10 bg-black/20 text-[9px]" onClick={() => void refresh()} type="button" variant="outline"><RefreshCw className="size-3" />Riprova</Button></div>;

  const { terms, workOrderEconomics } = payload;
  const supportsWorkOrders = terms.model === "PER_WORK_ORDER" || terms.model === "MIXED";
  const headlineAmount = terms.model === "PER_WORK_ORDER"
    ? workOrderEconomics.approvedMinor
    : terms.model === "TIME_AND_MATERIAL" || terms.model === "UNDEFINED" ? null : terms.baseAmountMinor;

  return <div className="mt-4 overflow-hidden rounded-2xl border border-lime-300/15 bg-[linear-gradient(145deg,rgba(190,255,60,.035),rgba(0,0,0,.2))]">
    <div className="flex flex-wrap items-start justify-between gap-3 p-3.5 sm:p-4">
      <div className="flex min-w-0 items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/[.06] text-lime-200"><CircleDollarSign className="size-4" /></span><div className="min-w-0"><p className="text-[8px] font-semibold uppercase tracking-[.16em] text-lime-100/60">{commercialValueLabel(terms.model)}</p><p className="mt-1 text-lg font-semibold text-lime-100">{headlineAmount === null ? commercialModelLabel(terms.model) : money(headlineAmount, terms.currency)}</p><p className="mt-1 text-[9px] leading-4 text-slate-500">{commercialModelLabel(terms.model)} · catalogo server-side · non è fatturato né incassato</p></div></div>
      <div className="flex items-center gap-2"><span className="rounded-full border border-cyan-300/15 bg-cyan-300/[.035] px-2.5 py-1 text-[8px] font-semibold uppercase tracking-[.08em] text-cyan-100/75">{terms.basis === "CONTRACTED" ? "Accordato" : "Preventivato"}</span><button aria-label="Aggiorna condizioni economiche" className="grid size-8 place-items-center rounded-lg border border-white/[.08] text-slate-500 hover:border-lime-300/25 hover:text-lime-100" onClick={() => void refresh()} type="button"><RefreshCw className="size-3.5" /></button></div>
    </div>

    {terms.model === "UNDEFINED" && <p className="border-t border-white/[.06] px-4 py-3 text-[10px] leading-5 text-slate-500">Nessun totale è stato presunto. La modalità economica dovrà essere formalizzata con un’operazione autorizzata.</p>}
    {terms.model === "TIME_AND_MATERIAL" && <p className="border-t border-white/[.06] px-4 py-3 text-[10px] leading-5 text-slate-500">Il valore nasce dal consuntivo verificato. Costi, ricavi, fatture e incassi restano registri Finance distinti.</p>}

    {supportsWorkOrders && <div className="border-t border-white/[.06] p-3.5 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[9px] font-semibold uppercase tracking-[.14em] text-cyan-100/70">Lavorazioni economiche</p><p className="mt-1 text-[9px] text-slate-600">{workOrderEconomics.counts.approved} approvate · {workOrderEconomics.counts.completed} completate · {workOrderEconomics.counts.draft} bozze</p></div>{payload.can.write && <Button className="h-9 border-lime-300/20 bg-lime-300/[.05] px-3 text-[9px] text-lime-100 hover:bg-lime-300/10" onClick={() => setCreateOpen(true)} type="button" variant="outline"><Plus className="size-3.5" />Nuova lavorazione valorizzata</Button>}</div>
      <div className="mt-3 space-y-2">
        {workOrderEconomics.workOrders.map((item) => <article className="rounded-xl border border-white/[.07] bg-black/20 p-3" key={item.id}><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-[11px] font-medium text-slate-200">{item.title}</p><span className={`rounded-full border px-2 py-0.5 text-[7px] font-semibold ${statusTone(item.status)}`}>{statusLabel(item.status)}</span></div>{item.description && <p className="mt-1 text-[9px] leading-4 text-slate-500">{item.description}</p>}<p className="mt-1 font-mono text-[8px] text-slate-700">v{item.version} · {item.id}</p></div><div className="shrink-0 text-right"><p className="font-mono text-[11px] text-lime-100">{money(item.value?.amountMinor ?? null, item.value?.currency)}</p><p className="mt-1 text-[8px] text-slate-600">{item.value?.basis === "CONTRACTED" ? "accordato" : item.value ? "preventivato" : "valore assente"}</p></div></div>{payload.can.write && item.status === "DRAFT" && <div className="mt-3 flex flex-wrap gap-2 border-t border-white/[.05] pt-3"><Button className="h-8 bg-lime-300 px-3 text-[9px] font-semibold text-[#050705] hover:bg-lime-200" disabled={busy} onClick={() => void mutate({ action: "set_work_order_status", workOrderId: item.id, expectedVersion: item.version, status: "APPROVED" })} type="button"><Check className="size-3" />Approva valore</Button><Button className="h-8 border-rose-300/15 bg-transparent px-3 text-[9px] text-rose-100" disabled={busy} onClick={() => void mutate({ action: "set_work_order_status", workOrderId: item.id, expectedVersion: item.version, status: "CANCELLED" })} type="button" variant="outline"><X className="size-3" />Annulla</Button></div>}{payload.can.write && item.status === "APPROVED" && <div className="mt-3 flex flex-wrap gap-2 border-t border-white/[.05] pt-3"><Button className="h-8 border-cyan-300/20 bg-cyan-300/[.05] px-3 text-[9px] text-cyan-100" disabled={busy} onClick={() => void mutate({ action: "set_work_order_status", workOrderId: item.id, expectedVersion: item.version, status: "COMPLETED" })} type="button" variant="outline"><CheckCircle2 className="size-3" />Segna completata</Button><Button className="h-8 border-rose-300/15 bg-transparent px-3 text-[9px] text-rose-100" disabled={busy} onClick={() => void mutate({ action: "set_work_order_status", workOrderId: item.id, expectedVersion: item.version, status: "CANCELLED" })} type="button" variant="outline"><X className="size-3" />Annulla</Button></div>}</article>)}
        {workOrderEconomics.workOrders.length === 0 && <p className="rounded-xl border border-dashed border-white/[.08] px-3 py-4 text-[10px] leading-5 text-slate-600">Nessuna lavorazione valorizzata. Il totale della manutenzione resta non disponibile finché non registri e approvi i singoli interventi.</p>}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3"><div className="rounded-xl border border-white/[.06] bg-black/20 p-2.5"><p className="text-[8px] uppercase tracking-[.12em] text-slate-600">Proposto</p><p className="mt-1 font-mono text-[11px] text-slate-300">{money(workOrderEconomics.proposedMinor)}</p></div><div className="rounded-xl border border-cyan-300/10 bg-cyan-300/[.02] p-2.5"><p className="text-[8px] uppercase tracking-[.12em] text-cyan-100/60">Approvato</p><p className="mt-1 font-mono text-[11px] text-cyan-100">{money(workOrderEconomics.approvedMinor)}</p></div><div className="rounded-xl border border-lime-300/10 bg-lime-300/[.02] p-2.5"><p className="text-[8px] uppercase tracking-[.12em] text-lime-100/60">Completato</p><p className="mt-1 font-mono text-[11px] text-lime-100">{money(workOrderEconomics.completedMinor)}</p></div></div>
    </div>}

    {notice && <button className="flex w-full items-start gap-2 border-t border-lime-300/10 bg-lime-300/[.025] px-4 py-3 text-left text-[9px] leading-4 text-lime-100/80" onClick={() => setNotice("")} type="button"><ShieldCheck className="mt-0.5 size-3 shrink-0" />{notice}</button>}

    <Dialog onOpenChange={setCreateOpen} open={createOpen}><DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto border-lime-300/20 bg-[#080c09] text-slate-100 sm:max-w-[560px]"><DialogHeader><DialogTitle>Valorizza una lavorazione</DialogTitle><DialogDescription className="text-slate-500">La voce nasce in bozza. L’approvazione è separata e non genera automaticamente fatture, ricavi o incassi.</DialogDescription></DialogHeader><form className="grid gap-4" onSubmit={submitWorkOrder}><label className="text-xs text-slate-400">Lavorazione / intervento<Input autoFocus className="mt-2 border-white/10 bg-black/30" maxLength={160} name="title" placeholder="Es. Riparazione perdita bagno scala B" required /></label><label className="text-xs text-slate-400">Descrizione<Textarea className="mt-2 min-h-24 border-white/10 bg-black/30" maxLength={1_200} name="description" placeholder="Perimetro concordato, esclusioni o riferimento…" /></label><div className="grid gap-4 sm:grid-cols-2"><label className="text-xs text-slate-400">Valore<Input className="mt-2 border-white/10 bg-black/30" inputMode="decimal" name="amount" placeholder="Es. 850,00" required /></label><label className="text-xs text-slate-400">Base<select className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-slate-100" defaultValue="ESTIMATE" name="basis">{payload.options.valueBases.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label></div><DialogFooter><DialogClose asChild><Button className="border-white/10 bg-transparent text-slate-400" type="button" variant="outline">Annulla</Button></DialogClose><Button className="bg-lime-300 text-[#050705] hover:bg-lime-200" disabled={busy} type="submit">{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}Crea in bozza</Button></DialogFooter></form></DialogContent></Dialog>
  </div>;
}
