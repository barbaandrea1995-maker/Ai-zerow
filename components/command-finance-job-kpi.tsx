"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BriefcaseBusiness, CircleDollarSign, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

type FinanceStatus = "PROPOSED" | "REVIEW" | "APPROVED" | "RECONCILED";
type FinanceJob = { id: string; code: string | null; title: string; client: string; status: string };
type CurrencyExpense = {
  currency: string;
  count: number;
  amountMilli: number;
  statuses: Record<FinanceStatus, { count: number; amountMilli: number }>;
};
type JobFinanceSummary = {
  commercialValue: null | { amountMinor: number; currency: string; basis: "ESTIMATE" | "CONTRACTED"; version: number; updatedAt: string };
  expenses: CurrencyExpense[];
  unavailableLedgers: string[];
};
type ResponsePayload = {
  jobs?: FinanceJob[];
  selectedJob?: FinanceJob | null;
  summary?: JobFinanceSummary | null;
  readback?: { status?: string; checkedAt?: string };
  error?: string;
};

function money(amount: number, currency = "EUR", divisor = 1) {
  if (!Number.isFinite(amount)) return "—";
  try {
    return new Intl.NumberFormat("it-IT", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount / divisor);
  } catch {
    return `${(amount / divisor).toLocaleString("it-IT", { maximumFractionDigits: 2 })} ${currency}`;
  }
}

function Metric({ label, value, detail, tone = "text-lime-100" }: { label: string; value: string; detail: string; tone?: string }) {
  return <div className="carbon-inset min-w-0 rounded-xl p-3"><p className="truncate text-[9px] font-semibold uppercase tracking-[.13em] text-slate-600">{label}</p><p className={`mt-2 truncate font-mono text-sm font-semibold ${tone}`}>{value}</p><p className="mt-1 truncate text-[9px] text-slate-600">{detail}</p></div>;
}

export function CommandFinanceJobKpi() {
  const router = useRouter();
  const [jobId, setJobId] = useState("");
  const [payload, setPayload] = useState<ResponsePayload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const query = jobId ? `?jobId=${encodeURIComponent(jobId)}` : "";
    void fetch(`/api/finance/job-summary${query}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const next = await response.json() as ResponsePayload;
        if (!response.ok) throw new Error(next.error || "finance_job_summary_unavailable");
        setPayload(next);
        setState("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState("error");
      });
    return () => controller.abort();
  }, [jobId, refreshVersion]);

  const selectedExpense = payload?.summary?.expenses.find((row) => row.currency === "EUR") ?? null;
  const pendingAmount = (selectedExpense?.statuses.PROPOSED.amountMilli ?? 0) + (selectedExpense?.statuses.REVIEW.amountMilli ?? 0);
  const pendingCount = (selectedExpense?.statuses.PROPOSED.count ?? 0) + (selectedExpense?.statuses.REVIEW.count ?? 0);
  const approved = selectedExpense?.statuses.APPROVED;
  const reconciled = selectedExpense?.statuses.RECONCILED;
  const commercialValue = payload?.summary?.commercialValue;
  const valueLabel = commercialValue ? money(commercialValue.amountMinor, commercialValue.currency, 100) : "—";
  const valueDetail = state === "loading" ? "Lettura server-side…" : commercialValue ? commercialValue.basis === "CONTRACTED" ? "Valore accordato" : "Valore preventivato" : "Nessun valore registrato";
  const otherCurrencies = payload?.summary?.expenses.filter((row) => row.currency !== "EUR") ?? [];
  const totalExpenseCount = selectedExpense?.count ?? 0;
  const missingLedgers = payload?.summary?.unavailableLedgers ?? ["Fatture", "Incassi e pagamenti", "Saldo contabile"];

  return <section className="carbon-card flex h-full flex-col rounded-2xl p-4 sm:p-5" aria-label="Riepilogo finanziario commessa">
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/[.07] text-lime-200"><CircleDollarSign className="size-4" /></span><div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">FINANZA / COMMESSA</p><h2 className="mt-1 text-sm font-semibold text-slate-100">Valore e spese registrate</h2><p className="mt-1 text-[10px] text-slate-500">Riepilogo riletto dal registro aziendale.</p></div></div>
      <Button aria-label="Aggiorna riepilogo Finanza" className="size-9 shrink-0 border-white/10 bg-black/20 p-0 text-slate-400 hover:border-lime-300/30 hover:text-lime-100" disabled={state === "loading"} onClick={() => { setState("loading"); setRefreshVersion((value) => value + 1); }} type="button" variant="outline"><RefreshCw className={`size-3.5 ${state === "loading" ? "animate-spin" : ""}`} /></Button>
    </div>

    <label className="mt-4 block text-[9px] font-semibold uppercase tracking-[.13em] text-slate-500">Commessa dal catalogo server-side
        <select aria-label="Seleziona commessa per il riepilogo finanziario" className="mt-2 h-10 w-full rounded-xl border border-lime-300/15 bg-black/30 px-3 text-xs font-normal text-slate-100 outline-none focus:border-lime-300/40 disabled:opacity-60" disabled={state === "loading" && !payload} onChange={(event) => { setState("loading"); setJobId(event.target.value); }} value={jobId}>
        <option value="">Seleziona una commessa</option>
        {(payload?.jobs ?? []).map((job) => <option key={job.id} value={job.id}>{job.code ? `${job.code} · ` : ""}{job.title}{job.client ? ` · ${job.client}` : ""}</option>)}
      </select>
    </label>

    {state === "error" ? <div className="carbon-inset mt-3 rounded-xl border border-amber-300/15 p-3 text-[10px] leading-5 text-amber-100/80">Il server non ha confermato il riepilogo. Riprova per rileggere i dati.</div>
      : !jobId && state === "ready" ? <div className="carbon-inset mt-3 rounded-xl border border-dashed border-white/[.08] p-4 text-center text-[10px] text-slate-600">{payload?.jobs?.length ? "Scegli una commessa per leggere valore e spese." : "Nessuna commessa disponibile nel catalogo Finance."}</div>
      : <>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Metric label="Valore commessa" value={state === "loading" ? "…" : valueLabel} detail={valueDetail} />
          <Metric label="Spese nel registro" value={state === "loading" ? "…" : money(selectedExpense?.amountMilli ?? 0, "EUR", 1000)} detail={state === "loading" ? "Lettura in corso" : `${totalExpenseCount} voci Finance · EUR`} tone="text-cyan-100" />
          <Metric label="Da revisionare" value={state === "loading" ? "…" : money(pendingAmount, "EUR", 1000)} detail={state === "loading" ? "Lettura in corso" : `${pendingCount} voci · proposta o revisione`} tone="text-amber-100" />
          <Metric label="Approvate" value={state === "loading" ? "…" : money(approved?.amountMilli ?? 0, "EUR", 1000)} detail={state === "loading" ? "Lettura in corso" : `${approved?.count ?? 0} voci Finance`} tone="text-cyan-100" />
          <Metric label="Riconciliate" value={state === "loading" ? "…" : money(reconciled?.amountMilli ?? 0, "EUR", 1000)} detail={state === "loading" ? "Lettura in corso" : `${reconciled?.count ?? 0} voci Finance`} />
        </div>
        {state === "ready" && otherCurrencies.length > 0 && <p className="mt-2 text-[9px] leading-4 text-slate-600">Altre valute non convertite: {otherCurrencies.map((row) => `${money(row.amountMilli, row.currency, 1000)} (${row.count})`).join(" · ")}</p>}
        {payload?.selectedJob && payload.selectedJob.id === jobId && state === "ready" && <div className="mt-3 flex flex-wrap gap-2"><Button className="h-8 flex-1 border-white/10 bg-black/20 text-[10px] text-slate-300 hover:border-lime-300/30 hover:text-lime-100" onClick={() => router.push(`/operations/${encodeURIComponent(payload.selectedJob!.id)}`)} type="button" variant="outline"><BriefcaseBusiness className="size-3.5" />Apri commessa</Button><Button className="h-8 flex-1 border-lime-300/20 bg-lime-300/[.05] text-[10px] text-lime-100 hover:bg-lime-300/10" onClick={() => router.push("/finance")} type="button" variant="outline"><CircleDollarSign className="size-3.5" />Apri Finanza</Button></div>}
      </>}

    <div className="mt-auto pt-3"><div className="rounded-xl border border-amber-300/12 bg-amber-300/[.035] p-2.5"><p className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[.12em] text-amber-100/80"><ShieldCheck className="size-3" />Perimetro del dato</p><p className="mt-1 text-[9px] leading-4 text-slate-600">Le spese sono voci Finance registrate in Sites. {missingLedgers.join(", ")} non sono ancora collegati.</p></div></div>
  </section>;
}
