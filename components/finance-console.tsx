"use client";

import Image from "next/image";
import Link from "@/components/app-link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  FileText,
  Landmark,
  LoaderCircle,
  Plus,
  RefreshCw,
  Scale,
  ShieldCheck,
} from "lucide-react";
import { FinanceDocumentIntake } from "@/components/finance-document-intake";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Job = { id: string; code: string | null; title: string; client: string | null; status: string };
type Allocation = { id: string; jobId: string; amountMinor: number; currency: string; version: number };
type Relation = { id: string; relationType: string; relatedEntityType: string; relatedEntityId: string; amountMinor: number | null; currency: string | null; version: number };
type Entry = {
  id: string;
  entryType: "EXPENSE" | "REVENUE" | "COMMITMENT" | "PAYMENT" | "RECEIPT";
  documentRole: string | null;
  category: string;
  description: string;
  amountMinor: number;
  effectSign: number;
  currency: string;
  economicDate: string | null;
  dueDate: string | null;
  counterpartyName: string | null;
  documentNumber: string | null;
  source: { type: string; id: string; documentId: string | null };
  status: "PENDING_APPROVAL" | "CONFIRMED" | "REVERSED";
  version: number;
  preparedBy: string;
  confirmedBy: string | null;
  allocations: Allocation[];
  relations: Relation[];
  createdAt: string;
  updatedAt: string;
};
type CurrencyProjection = {
  currency: string;
  confirmedCount: number;
  pendingCount: number;
  expenseMinor: number;
  revenueMinor: number;
  commitmentMinor: number;
  openCommitmentMinor: number | null;
  paidMinor: number;
  collectedMinor: number;
  supplierInvoicedMinor: number;
  customerInvoicedMinor: number;
  payableOutstandingMinor: number | null;
  receivableOutstandingMinor: number | null;
  marginMinor: number;
  unlinkedCashCount: number;
  status: "AVAILABLE" | "PARTIAL";
  categories: Record<string, number>;
};
type LedgerPayload = {
  context: { capabilities?: string[]; role?: string; roles?: string[] };
  jobs: Job[];
  selectedJob: Job | null;
  entries: Entry[];
  projection: { status: "NOT_AVAILABLE" | "PARTIAL" | "AVAILABLE"; currencies: CurrencyProjection[]; pendingCount: number; confirmedCount: number; reversedCount: number };
  issues: Array<{ id: string; issueCode: string; severity: string; subjectId: string; status: string; detail: Record<string, unknown>; version: number; createdAt: string }>;
  readback: { status: string; checkedAt: string };
};
type JobSummary = {
  summary: null | {
    commercialValue: null | { amountMinor: number; currency: string; basis: string; version: number; updatedAt: string };
    economics: LedgerPayload["projection"];
    workflowProposals: Array<{ currency: string; count: number; amountMilli: number }>;
  };
};

type Tab = "situation" | "documents" | "movements" | "commitments";
const ENTRY_LABELS: Record<string, string> = { EXPENSE: "Costo", REVENUE: "Ricavo", COMMITMENT: "Impegno", PAYMENT: "Pagamento", RECEIPT: "Incasso" };
const STATUS_LABELS: Record<string, string> = { PENDING_APPROVAL: "DA APPROVARE", CONFIRMED: "CONFERMATO", REVERSED: "STORNATO" };
const ISSUE_LABELS: Record<string, string> = {
  POSSIBLE_DUPLICATE_DOCUMENT_NUMBER: "Possibile documento duplicato",
  CREDIT_NOTE_ORIGINAL_REQUIRED: "Nota di credito da collegare all’originale",
  UNLINKED_CASH_MOVEMENT: "Pagamento o incasso da collegare a una fattura",
  ORDER_INVOICE_AMOUNT_DIFFERENCE: "Differenza tra ordine e fattura",
};

function money(value: number | null, currency: string) {
  if (value === null) return "Non disponibile";
  try { return new Intl.NumberFormat("it-IT", { style: "currency", currency }).format(value / 100); } catch { return `${(value / 100).toFixed(2)} ${currency}`; }
}

function dateLabel(value: string | null) {
  if (!value) return "Data non disponibile";
  const parsed = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("it-IT");
}

function errorLabel(code: string) {
  const labels: Record<string, string> = {
    finance_maker_checker_violation: "Serve un secondo utente autorizzato: chi prepara non può approvare.",
    finance_entry_blocking_issue: "Risolvi il controllo bloccante prima dell’approvazione.",
    finance_allocation_total_mismatch: "La quota della commessa deve coincidere con l’importo.",
    finance_settlement_already_applied: "L’importo supera il residuo della fattura o del pagamento.",
    finance_purchase_order_match_already_applied: "L’importo supera il residuo dell’ordine o della fattura.",
    finance_relation_amount_invalid: "Importo di collegamento non valido.",
    finance_issue_requires_relation: "Questo controllo si chiude collegando i due fatti nella sezione Riconciliazione.",
    forbidden: "Il ruolo corrente non dispone della capacità richiesta.",
  };
  return labels[code] ?? `Operazione non completata (${code || "errore sconosciuto"}).`;
}

function StatusBadge({ status }: { status: string }) {
  const confirmed = status === "CONFIRMED";
  const reversed = status === "REVERSED";
  return <span className={`rounded-full border px-2 py-1 text-[8px] font-semibold tracking-[.08em] ${confirmed ? "border-lime-300/20 bg-lime-300/[.06] text-lime-100" : reversed ? "border-rose-300/20 bg-rose-300/[.05] text-rose-100" : "border-amber-300/20 bg-amber-300/[.05] text-amber-100"}`}>{STATUS_LABELS[status] ?? status}</span>;
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="rounded-xl border border-white/[.07] bg-black/20 p-3.5"><p className="text-[8px] font-semibold uppercase tracking-[.14em] text-slate-600">{label}</p><p className={`mt-1.5 font-mono text-base font-semibold ${value === "Non disponibile" ? "text-slate-500" : "text-slate-100"}`}>{value}</p>{note && <p className="mt-1 text-[8px] leading-4 text-slate-600">{note}</p>}</div>;
}

function EntryComposer({ jobs, selectedJobId, capabilities, onSaved }: { jobs: Job[]; selectedJobId: string; capabilities: string[]; onSaved: (message: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ entryType: "EXPENSE", description: "", amount: "", currency: "EUR", economicDate: new Date().toISOString().slice(0, 10), dueDate: "", category: "OTHER", counterpartyName: "", documentNumber: "", jobId: selectedJobId });
  const allowedTypes = [
    ...(capabilities.includes("finance.entries.prepare") ? ["EXPENSE", "REVENUE"] : []),
    ...(capabilities.includes("finance.commitments.manage") ? ["COMMITMENT"] : []),
    ...(capabilities.includes("finance.payments.record") ? ["PAYMENT", "RECEIPT"] : []),
  ];
  if (!allowedTypes.length) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch("/api/finance/entries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "prepare",
          ...form,
          allocations: form.jobId ? [{ jobId: form.jobId, amount: form.amount }] : [],
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "finance_entry_write_unavailable");
      setOpen(false);
      setForm((current) => ({ ...current, description: "", amount: "", dueDate: "", counterpartyName: "", documentNumber: "" }));
      await onSaved("Registrazione preparata. È esclusa dai KPI finché un secondo utente non la approva.");
    } catch (error) { await onSaved(errorLabel(error instanceof Error ? error.message : "")); }
    finally { setBusy(false); }
  }

  return <><Button className="bg-lime-300 text-[10px] font-semibold text-[#050705] hover:bg-lime-200" onClick={() => { setForm((current) => ({ ...current, jobId: selectedJobId, entryType: allowedTypes.includes(current.entryType) ? current.entryType : allowedTypes[0] })); setOpen(true); }} type="button"><Plus className="size-3.5" />Nuova registrazione</Button><Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto border-lime-300/20 bg-[#080c09] text-slate-100 sm:max-w-[680px]"><form className="space-y-4" onSubmit={submit}><DialogHeader><DialogTitle>Prepara una registrazione gestionale</DialogTitle><DialogDescription className="text-slate-500">Il server controlla commessa, importo, capacità e idempotenza. La voce resta da approvare.</DialogDescription></DialogHeader><div className="grid gap-3 sm:grid-cols-2">
    <label className="text-[10px] text-slate-400">Tipo<select className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-xs" onChange={(event) => setForm({ ...form, entryType: event.target.value })} value={form.entryType}>{allowedTypes.map((type) => <option key={type} value={type}>{ENTRY_LABELS[type]}</option>)}</select></label>
    <label className="text-[10px] text-slate-400">Commessa<select className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-xs" onChange={(event) => setForm({ ...form, jobId: event.target.value })} value={form.jobId}><option value="">Registrazione generale</option>{jobs.map((job) => <option key={job.id} value={job.id}>{job.code ? `${job.code} · ` : ""}{job.title}</option>)}</select></label>
    <label className="text-[10px] text-slate-400 sm:col-span-2">Descrizione<Input className="mt-1.5 border-white/10 bg-black/30 text-xs" maxLength={600} onChange={(event) => setForm({ ...form, description: event.target.value })} required value={form.description} /></label>
    <label className="text-[10px] text-slate-400">Importo<Input className="mt-1.5 border-white/10 bg-black/30 text-xs" inputMode="decimal" min="0.01" onChange={(event) => setForm({ ...form, amount: event.target.value })} required step="0.01" type="number" value={form.amount} /></label>
    <label className="text-[10px] text-slate-400">Valuta<Input className="mt-1.5 border-white/10 bg-black/30 text-xs uppercase" maxLength={3} onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })} required value={form.currency} /></label>
    <label className="text-[10px] text-slate-400">Data economica<Input className="mt-1.5 border-white/10 bg-black/30 text-xs" onChange={(event) => setForm({ ...form, economicDate: event.target.value })} required type="date" value={form.economicDate} /></label>
    <label className="text-[10px] text-slate-400">Scadenza documentata<Input className="mt-1.5 border-white/10 bg-black/30 text-xs" onChange={(event) => setForm({ ...form, dueDate: event.target.value })} type="date" value={form.dueDate} /></label>
    <label className="text-[10px] text-slate-400">Categoria<select className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-xs" onChange={(event) => setForm({ ...form, category: event.target.value })} value={form.category}>{["LABOR", "MATERIALS", "VEHICLES", "SUBCONTRACTS", "TRANSPORT", "RENTALS", "GENERAL", "OTHER"].map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
    <label className="text-[10px] text-slate-400">Controparte<Input className="mt-1.5 border-white/10 bg-black/30 text-xs" onChange={(event) => setForm({ ...form, counterpartyName: event.target.value })} value={form.counterpartyName} /></label>
    <label className="text-[10px] text-slate-400 sm:col-span-2">Numero documento / riferimento<Input className="mt-1.5 border-white/10 bg-black/30 text-xs" onChange={(event) => setForm({ ...form, documentNumber: event.target.value })} value={form.documentNumber} /></label>
  </div><DialogFooter><DialogClose asChild><Button className="border-white/10 bg-transparent text-slate-400" type="button" variant="outline">Annulla</Button></DialogClose><Button className="bg-lime-300 text-[#050705] hover:bg-lime-200" disabled={busy} type="submit">{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}Prepara e rileggi</Button></DialogFooter></form></DialogContent></Dialog></>;
}

function ReconciliationPanel({ entries, capabilities, onSaved }: { entries: Entry[]; capabilities: string[]; onSaved: (message: string) => Promise<void> }) {
  const [mode, setMode] = useState<"SETTLES" | "MATCHES_PURCHASE_ORDER" | "ADJUSTS">("SETTLES");
  const [sourceId, setSourceId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  if (!capabilities.includes("finance.reconcile")) return null;
  const confirmed = entries.filter((entry) => entry.status === "CONFIRMED");
  const sources = mode === "SETTLES"
    ? confirmed.filter((entry) => ["PAYMENT", "RECEIPT"].includes(entry.entryType))
    : mode === "ADJUSTS" ? entries.filter((entry) => entry.documentRole === "CREDIT_NOTE" && entry.status !== "REVERSED")
      : confirmed.filter((entry) => entry.entryType === "EXPENSE" && entry.documentRole === "SUPPLIER_INVOICE");
  const source = entries.find((entry) => entry.id === sourceId);
  const targets = mode === "SETTLES"
    ? confirmed.filter((entry) => source?.entryType === "RECEIPT" ? entry.documentRole === "CUSTOMER_INVOICE" : entry.documentRole === "SUPPLIER_INVOICE")
    : mode === "ADJUSTS" ? confirmed.filter((entry) => entry.effectSign === 1 && entry.entryType === source?.entryType && ["SUPPLIER_INVOICE", "CUSTOMER_INVOICE"].includes(entry.documentRole ?? ""))
      : confirmed.filter((entry) => entry.entryType === "COMMITMENT");

  async function relate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch("/api/finance/entries", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "relate", entryId: sourceId, relationType: mode, relatedEntityType: "FINANCE_ENTRY", relatedEntityId: targetId, amount, idempotencyKey: crypto.randomUUID() }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "finance_relation_unavailable");
      setSourceId(""); setTargetId(""); setAmount("");
      await onSaved("Collegamento verificato e riletto. Nessun documento originario è stato modificato.");
    } catch (error) { await onSaved(errorLabel(error instanceof Error ? error.message : "")); }
    finally { setBusy(false); }
  }

  return <section className="carbon-card rounded-2xl p-4 sm:p-5"><div><p className="text-[9px] font-semibold uppercase tracking-[.18em] text-cyan-100/70">RICONCILIAZIONE</p><h3 className="mt-1 text-sm font-semibold text-slate-100">Collega fatti già verificati</h3><p className="mt-1 text-[10px] leading-5 text-slate-500">Pagamenti, ordini e note di credito restano fatti distinti; il collegamento evita somme doppie.</p></div><form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={relate}><label className="text-[9px] text-slate-500">Operazione<select className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-[10px]" onChange={(event) => { setMode(event.target.value as typeof mode); setSourceId(""); setTargetId(""); }} value={mode}><option value="SETTLES">Pagamento / incasso → fattura</option><option value="MATCHES_PURCHASE_ORDER">Fattura → impegno / ordine</option><option value="ADJUSTS">Nota di credito → documento originario</option></select></label><label className="text-[9px] text-slate-500">Origine<select className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-[10px]" onChange={(event) => { setSourceId(event.target.value); setTargetId(""); }} required value={sourceId}><option value="">Seleziona</option>{sources.map((entry) => <option key={entry.id} value={entry.id}>{ENTRY_LABELS[entry.entryType]} · {entry.description} · {money(entry.amountMinor, entry.currency)}</option>)}</select></label><label className="text-[9px] text-slate-500">Destinazione<select className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-[10px]" onChange={(event) => setTargetId(event.target.value)} required value={targetId}><option value="">Seleziona</option>{targets.map((entry) => <option key={entry.id} value={entry.id}>{ENTRY_LABELS[entry.entryType]} · {entry.description} · {money(entry.amountMinor, entry.currency)}</option>)}</select></label><label className="text-[9px] text-slate-500">Importo collegato<Input className="mt-1.5 border-white/10 bg-black/30 text-xs" inputMode="decimal" min="0.01" onChange={(event) => setAmount(event.target.value)} required step="0.01" type="number" value={amount} /></label><div className="sm:col-span-2"><Button className="bg-cyan-100 text-[9px] font-semibold text-[#061012] hover:bg-cyan-50" disabled={busy || !sourceId || !targetId} type="submit">{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Scale className="size-3.5" />}Registra collegamento</Button></div></form></section>;
}

export default function FinanceConsole() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedJobId = searchParams.get("jobId") ?? "";
  const [selectedJobId, setSelectedJobId] = useState(requestedJobId);
  const [payload, setPayload] = useState<LedgerPayload | null>(null);
  const [summary, setSummary] = useState<JobSummary["summary"]>(null);
  const [tab, setTab] = useState<Tab>("situation");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [confirmingId, setConfirmingId] = useState("");
  const [resolutions, setResolutions] = useState<Record<string, string>>({});
  const [reversalReasons, setReversalReasons] = useState<Record<string, string>>({});
  const capabilities = useMemo(() => payload?.context.capabilities ?? [], [payload]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const suffix = selectedJobId ? `?jobId=${encodeURIComponent(selectedJobId)}` : "";
      const [ledgerResponse, summaryResponse] = await Promise.all([
        fetch(`/api/finance/entries${suffix}`, { cache: "no-store" }),
        fetch(`/api/finance/job-summary${suffix}`, { cache: "no-store" }),
      ]);
      const ledger = await ledgerResponse.json() as LedgerPayload & { error?: string };
      const jobSummary = await summaryResponse.json() as JobSummary & { error?: string };
      if (!ledgerResponse.ok) throw new Error(ledger.error ?? "finance_ledger_unavailable");
      if (!summaryResponse.ok) throw new Error(jobSummary.error ?? "finance_job_summary_unavailable");
      setPayload(ledger);
      setSummary(jobSummary.summary);
    } catch (error) { setNotice(errorLabel(error instanceof Error ? error.message : "")); }
    finally { setLoading(false); }
  }, [selectedJobId]);

  useEffect(() => { const timer = window.setTimeout(() => void refresh(), 0); return () => window.clearTimeout(timer); }, [refresh]);

  async function saved(message: string) { setNotice(message); await refresh(); }
  function chooseJob(jobId: string) {
    setSelectedJobId(jobId);
    router.replace(jobId ? `/finance?jobId=${encodeURIComponent(jobId)}` : "/finance");
  }
  async function confirmEntry(entry: Entry) {
    setConfirmingId(entry.id);
    try {
      const response = await fetch("/api/finance/entries", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "confirm", entryId: entry.id, expectedVersion: entry.version, idempotencyKey: crypto.randomUUID() }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "finance_entry_confirm_unavailable");
      await saved("Registrazione approvata e inclusa nelle proiezioni confermate.");
    } catch (error) { setNotice(errorLabel(error instanceof Error ? error.message : "")); }
    finally { setConfirmingId(""); }
  }
  async function reverseEntry(entry: Entry) {
    const reason = reversalReasons[entry.id]?.trim() ?? "";
    if (reason.length < 4) { setNotice("Indica il motivo della rettifica."); return; }
    setConfirmingId(entry.id);
    try {
      const response = await fetch("/api/finance/entries", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "reverse", entryId: entry.id, expectedVersion: entry.version, reason, idempotencyKey: crypto.randomUUID() }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "finance_entry_reverse_unavailable");
      await saved("Registrazione stornata con rettifica esplicita; l’originale resta nello storico.");
    } catch (error) { setNotice(errorLabel(error instanceof Error ? error.message : "")); }
    finally { setConfirmingId(""); }
  }
  async function resolveIssue(issue: LedgerPayload["issues"][number]) {
    const resolution = resolutions[issue.id]?.trim() ?? "";
    if (resolution.length < 4) { setNotice("Indica come è stato verificato il controllo."); return; }
    const response = await fetch("/api/finance/entries", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "resolve_issue", issueId: issue.id, expectedVersion: issue.version, resolution, idempotencyKey: crypto.randomUUID() }) });
    const result = await response.json() as { error?: string };
    if (!response.ok) { setNotice(errorLabel(result.error ?? "finance_issue_unavailable")); return; }
    await saved("Controllo risolto, auditato e riletto.");
  }

  const entries = payload?.entries ?? [];
  const selectedJob = payload?.selectedJob ?? null;
  const pending = entries.filter((entry) => entry.status === "PENDING_APPROVAL");
  const movements = entries.filter((entry) => entry.entryType !== "COMMITMENT");
  const commitments = entries.filter((entry) => entry.entryType === "COMMITMENT");
  const dueEntries = entries.filter((entry) => entry.dueDate && entry.status !== "REVERSED");
  const tabs: Array<{ id: Tab; label: string; icon: typeof CircleDollarSign }> = [
    { id: "situation", label: "Situazione", icon: CircleDollarSign },
    { id: "documents", label: "Documenti", icon: FileText },
    { id: "movements", label: "Movimenti", icon: Landmark },
    { id: "commitments", label: "Impegni", icon: CalendarClock },
  ];

  return <main className="zw-app-shell min-h-screen overflow-x-hidden pb-24 text-slate-100 selection:bg-lime-300 selection:text-[#050705]"><div className="zw-command-ambient" aria-hidden="true" /><div className="relative mx-auto max-w-[1500px] px-4 py-4 sm:px-7 sm:py-7">
    <header className="zw-command-topbar sticky top-0 z-30 -mx-4 flex min-h-16 items-center gap-3 px-4 sm:-mx-7 sm:px-7"><button aria-label="Apri Centrale" className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-xl border border-lime-300/35 bg-black" onClick={() => router.push("/command")} type="button"><Image alt="ZEROW" className="size-full object-cover" height={36} src="/ai-zerow-icon.jpeg" width={36} /></button><div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-[.18em] text-slate-100">FINANZA</p><p className="truncate text-[9px] text-slate-600">Economia gestionale per commessa</p></div><div className="ml-auto flex items-center gap-2"><Button aria-label="Torna indietro" className="size-9 border-white/10 bg-black/20 p-0 text-slate-400" onClick={() => router.back()} type="button" variant="outline"><ArrowLeft className="size-4" /></Button><Button aria-label="Aggiorna Finance" className="size-9 border-white/10 bg-black/20 p-0 text-slate-400" disabled={loading} onClick={() => void refresh()} type="button" variant="outline"><RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} /></Button></div></header>

    <section className="zw-module-heading relative mt-4 overflow-hidden rounded-[26px] p-5 sm:p-7"><div className="relative z-[1] flex flex-wrap items-end justify-between gap-5"><div className="max-w-3xl"><p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.2em] text-lime-300/75"><CircleDollarSign className="size-3.5" />FINANCE / JOB ECONOMICS</p><h1 className="mt-3 text-3xl font-semibold tracking-[-.05em] text-slate-50 sm:text-[44px]">Numeri verificati,<br /><span className="text-lime-300">decisioni leggibili.</span></h1><p className="mt-3 max-w-2xl text-xs leading-6 text-slate-400">Documenti originali, fatti economici, impegni e pagamenti restano distinti e riconciliabili. I dati incompleti non diventano zero.</p></div><EntryComposer capabilities={capabilities} jobs={payload?.jobs ?? []} onSaved={saved} selectedJobId={selectedJobId} /></div></section>

    <section className="carbon-card mt-4 rounded-2xl p-4"><div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"><label className="text-[9px] font-semibold uppercase tracking-[.15em] text-slate-500">Commessa letta dal server<select aria-label="Seleziona commessa Finance" className="mt-2 h-12 w-full rounded-xl border border-lime-300/15 bg-black/30 px-3 text-xs text-slate-100 outline-none focus:border-lime-300/40" onChange={(event) => chooseJob(event.target.value)} value={selectedJobId}><option value="">Portafoglio aziendale · valute separate</option>{(payload?.jobs ?? []).map((job) => <option key={job.id} value={job.id}>{job.code ? `${job.code} · ` : ""}{job.title}{job.client ? ` · ${job.client}` : ""}</option>)}</select></label><div className="flex items-center gap-2 rounded-xl border border-white/[.07] bg-black/20 px-3 py-2.5"><span className={`size-2 rounded-full ${payload?.readback.status ? "bg-lime-300" : "bg-amber-300"}`} /><div><p className="text-[8px] font-semibold uppercase tracking-[.13em] text-slate-500">Readback</p><p className="mt-0.5 font-mono text-[9px] text-slate-300">{loading ? "LETTURA…" : payload?.readback.status ?? "NON DISPONIBILE"}</p></div></div></div>{selectedJob && <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/[.06] pt-3"><p className="text-[10px] text-slate-400"><span className="font-mono text-lime-100">{selectedJob.code ?? selectedJob.id}</span> · {selectedJob.title}</p><Link className="inline-flex items-center gap-1 text-[9px] font-semibold text-lime-100" href={`/operations/${encodeURIComponent(selectedJob.id)}?tab=finance`}><BriefcaseBusiness className="size-3" />Apri dossier commessa</Link></div>}</section>

    <nav aria-label="Aree Finance" className="mt-4 grid grid-cols-2 gap-2 rounded-2xl border border-white/[.08] bg-black/25 p-1 sm:grid-cols-4">{tabs.map((item) => { const Icon = item.icon; return <button aria-current={tab === item.id ? "page" : undefined} className={`flex min-h-11 items-center justify-center gap-2 rounded-xl px-2 text-[9px] font-semibold transition ${tab === item.id ? "border border-lime-300/20 bg-lime-300/[.08] text-lime-100" : "text-slate-500 hover:text-slate-300"}`} key={item.id} onClick={() => setTab(item.id)} type="button"><Icon className="size-3.5" />{item.label}</button>; })}</nav>

    {notice && <button aria-live="polite" className="mt-3 w-full rounded-xl border border-lime-300/15 bg-lime-300/[.04] px-3 py-2.5 text-left text-[10px] text-lime-100/85" onClick={() => setNotice("")} type="button">{notice}</button>}

    {tab === "situation" && <div className="mt-4 space-y-4">
      {!selectedJobId && <div className="rounded-xl border border-cyan-300/15 bg-cyan-300/[.025] p-3 text-[10px] leading-5 text-cyan-50/75">Vista aziendale: ogni valuta resta separata. Seleziona una commessa per confrontare valore commerciale, costi, ricavi e margine.</div>}
      {summary?.commercialValue && <section className="carbon-card rounded-2xl p-4 sm:p-5"><p className="text-[9px] font-semibold uppercase tracking-[.18em] text-lime-300/70">VALORE CONTRATTUALE</p><div className="mt-2 flex flex-wrap items-end justify-between gap-3"><p className="font-mono text-2xl font-semibold text-lime-100">{money(summary.commercialValue.amountMinor, summary.commercialValue.currency)}</p><span className="rounded-full border border-lime-300/20 bg-lime-300/[.05] px-2.5 py-1 text-[8px] font-semibold text-lime-100">{summary.commercialValue.basis === "CONTRACTED" ? "ACCORDATO" : "PREVENTIVATO"}</span></div><p className="mt-2 text-[9px] text-slate-600">Dato commerciale della commessa · non è fatturato né incassato.</p></section>}
      {(payload?.projection.currencies ?? []).map((row) => <section className="carbon-card rounded-2xl p-4 sm:p-5" key={row.currency}><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[9px] font-semibold uppercase tracking-[.18em] text-cyan-100/70">SITUAZIONE ECONOMICA · {row.currency}</p><h2 className="mt-1 text-base font-semibold text-slate-100">Confermato e documentato</h2></div><span className={`rounded-full border px-2.5 py-1 text-[8px] font-semibold ${row.status === "AVAILABLE" ? "border-lime-300/20 bg-lime-300/[.05] text-lime-100" : "border-amber-300/20 bg-amber-300/[.05] text-amber-100"}`}>{row.status === "AVAILABLE" ? "DISPONIBILE" : "PARZIALE"}</span></div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5"><Metric label="Ricavi confermati" value={money(row.revenueMinor, row.currency)} /><Metric label="Costi confermati" value={money(row.expenseMinor, row.currency)} /><Metric label="Margine gestionale" value={money(row.marginMinor, row.currency)} note="Ricavi meno costi; non è liquidità." /><Metric label="Fatturato cliente" value={money(row.customerInvoicedMinor, row.currency)} /><Metric label="Incassato verificato" value={money(row.collectedMinor, row.currency)} /><Metric label="Da incassare documentato" value={money(row.receivableOutstandingMinor, row.currency)} /><Metric label="Fatture fornitori" value={money(row.supplierInvoicedMinor, row.currency)} /><Metric label="Pagato verificato" value={money(row.paidMinor, row.currency)} /><Metric label="Da pagare documentato" value={money(row.payableOutstandingMinor, row.currency)} /><Metric label="Impegni aperti" value={money(row.openCommitmentMinor, row.currency)} /></div>{row.unlinkedCashCount > 0 && <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300/15 bg-amber-300/[.035] p-2.5 text-[9px] leading-4 text-amber-100/75"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{row.unlinkedCashCount} pagamenti o incassi confermati non sono collegati a una fattura: i residui restano non disponibili.</p>}</section>)}
      {!loading && !(payload?.projection.currencies.length) && <section className="carbon-card rounded-2xl p-8 text-center"><CircleDollarSign className="mx-auto size-7 text-slate-700" /><h2 className="mt-3 text-sm font-semibold text-slate-300">Situazione non disponibile</h2><p className="mt-1 text-[10px] text-slate-600">Nessun fatto economico confermato. Le proposte e i documenti non vengono mostrati come zero.</p></section>}
      {(summary?.workflowProposals.length ?? 0) > 0 && <details className="rounded-xl border border-white/[.08] bg-black/15 p-3"><summary className="cursor-pointer text-[9px] font-semibold uppercase tracking-[.14em] text-slate-500">Workflow Finance precedenti · compatibilità W10</summary><p className="mt-2 text-[9px] leading-4 text-slate-600">Sono proposte operative, escluse da costi, ricavi e margine.</p></details>}
    </div>}

    {tab === "documents" && <FinanceDocumentIntake initialJobId={selectedJobId} />}

    {tab === "movements" && <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]"><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[9px] font-semibold uppercase tracking-[.18em] text-lime-300/70">MOVIMENTI ECONOMICI</p><h2 className="mt-1 text-base font-semibold text-slate-100">Registro cronologico</h2><p className="mt-1 text-[10px] text-slate-500">Solo le voci confermate alimentano i KPI. Le proposte restano visibili ma separate.</p></div><span className="font-mono text-[9px] text-slate-500">{movements.length} VOCI</span></div><div className="mt-4 space-y-2">{movements.map((entry) => <article className="rounded-xl border border-white/[.07] bg-black/20 p-3" key={entry.id}><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="text-[11px] font-semibold text-slate-200">{ENTRY_LABELS[entry.entryType]}</p><StatusBadge status={entry.status} /></div><p className="mt-1 break-words text-[10px] text-slate-400">{entry.description}</p><p className="mt-1 text-[8px] text-slate-600">{dateLabel(entry.economicDate)} · {entry.counterpartyName || "Controparte non indicata"}{entry.documentNumber ? ` · doc. ${entry.documentNumber}` : ""}</p></div><p className="shrink-0 font-mono text-sm text-lime-100">{entry.effectSign === -1 ? "−" : ""}{money(entry.amountMinor, entry.currency)}</p></div>{entry.status === "PENDING_APPROVAL" && capabilities.includes("finance.entries.confirm") && <div className="mt-3 border-t border-white/[.06] pt-3"><Button className="min-h-9 bg-lime-300 text-[9px] font-semibold text-[#050705] hover:bg-lime-200" disabled={confirmingId === entry.id} onClick={() => void confirmEntry(entry)} type="button">{confirmingId === entry.id ? <LoaderCircle className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}Approva con secondo controllo</Button></div>}{entry.status === "CONFIRMED" && capabilities.includes("finance.entries.confirm") && <details className="mt-3 border-t border-white/[.06] pt-3"><summary className="cursor-pointer text-[8px] font-semibold uppercase tracking-[.1em] text-slate-600">Rettifica esplicita</summary><div className="mt-2 flex flex-col gap-2 sm:flex-row"><Textarea className="min-h-14 flex-1 border-white/10 bg-black/30 text-[9px]" onChange={(event) => setReversalReasons((current) => ({ ...current, [entry.id]: event.target.value }))} placeholder="Motivo dello storno…" value={reversalReasons[entry.id] ?? ""} /><Button className="self-end border-rose-300/20 bg-rose-300/[.04] text-[9px] text-rose-100 hover:bg-rose-300/[.08]" disabled={confirmingId === entry.id} onClick={() => void reverseEntry(entry)} type="button" variant="outline">Storna con audit</Button></div></details>}</article>)}{movements.length === 0 && <p className="rounded-xl border border-dashed border-white/[.08] p-6 text-center text-[10px] text-slate-600">Nessun movimento nel perimetro selezionato.</p>}</div></section><aside className="space-y-4"><section className="carbon-card rounded-2xl p-4"><p className="text-[9px] font-semibold uppercase tracking-[.16em] text-amber-100/70">DA APPROVARE</p><p className="mt-2 font-mono text-2xl text-amber-100">{pending.length}</p><p className="mt-2 text-[9px] leading-4 text-slate-600">Il preparatore non può essere l’approvatore della stessa registrazione.</p></section><section className="carbon-card rounded-2xl p-4"><p className="text-[9px] font-semibold uppercase tracking-[.16em] text-cyan-100/70">FONTI</p><div className="mt-3 space-y-2 text-[9px] text-slate-500"><p>Documento revisionato</p><p>Registrazione manuale autorizzata</p><p>Workflow Acquisti approvato</p></div></section></aside></div>}

    {tab === "commitments" && <div className="mt-4 space-y-4"><section className="carbon-card rounded-2xl p-4 sm:p-5"><div><p className="text-[9px] font-semibold uppercase tracking-[.18em] text-amber-100/70">IMPEGNI E SCADENZE</p><h2 className="mt-1 text-base font-semibold text-slate-100">Ordini separati da costi e pagamenti</h2></div><div className="mt-4 grid gap-3 lg:grid-cols-2"><div><p className="mb-2 text-[8px] font-semibold uppercase tracking-[.14em] text-slate-600">IMPEGNI</p>{commitments.map((entry) => <article className="mb-2 rounded-xl border border-white/[.07] bg-black/20 p-3" key={entry.id}><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-medium text-slate-200">{entry.description}</p><p className="mt-1 text-[8px] text-slate-600">{entry.source.type} · {dateLabel(entry.economicDate)}</p></div><div className="text-right"><p className="font-mono text-[11px] text-amber-100">{money(entry.amountMinor, entry.currency)}</p><div className="mt-1"><StatusBadge status={entry.status} /></div></div></div></article>)}{commitments.length === 0 && <p className="rounded-xl border border-dashed border-white/[.08] p-4 text-[9px] text-slate-600">Nessun impegno registrato.</p>}</div><div><p className="mb-2 text-[8px] font-semibold uppercase tracking-[.14em] text-slate-600">SCADENZE DOCUMENTATE</p>{dueEntries.map((entry) => <article className="mb-2 flex items-center justify-between gap-3 rounded-xl border border-white/[.07] bg-black/20 p-3" key={entry.id}><div><p className="text-[10px] text-slate-200">{entry.description}</p><p className="mt-1 text-[8px] text-slate-600">{ENTRY_LABELS[entry.entryType]} · {dateLabel(entry.dueDate)}</p></div><p className="font-mono text-[10px] text-slate-300">{money(entry.amountMinor, entry.currency)}</p></article>)}{dueEntries.length === 0 && <p className="rounded-xl border border-dashed border-white/[.08] p-4 text-[9px] text-slate-600">Nessuna scadenza esplicita disponibile.</p>}</div></div></section><ReconciliationPanel capabilities={capabilities} entries={entries} onSaved={saved} />
      {(payload?.issues.filter((issue) => issue.status === "OPEN").length ?? 0) > 0 && <section className="carbon-card rounded-2xl p-4 sm:p-5"><p className="text-[9px] font-semibold uppercase tracking-[.18em] text-amber-100/70">CONTROLLI APERTI</p><div className="mt-3 space-y-2">{payload?.issues.filter((issue) => issue.status === "OPEN").map((issue) => { const relationRequired = ["CREDIT_NOTE_ORIGINAL_REQUIRED", "UNLINKED_CASH_MOVEMENT"].includes(issue.issueCode); return <article className="rounded-xl border border-amber-300/15 bg-amber-300/[.03] p-3" key={issue.id}><div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-200" /><div><p className="text-[10px] font-medium text-amber-100">{ISSUE_LABELS[issue.issueCode] ?? issue.issueCode.replaceAll("_", " ")}</p><p className="mt-1 font-mono text-[8px] text-slate-600">{issue.severity} · {issue.subjectId}</p></div></div>{relationRequired ? <p className="mt-3 rounded-lg border border-cyan-300/12 bg-cyan-300/[.025] p-2.5 text-[9px] leading-4 text-cyan-100/70">Usa “Collega fatti già verificati”: una nota testuale non può sostituire il collegamento.</p> : capabilities.includes("finance.reconcile") && <div className="mt-3 flex flex-col gap-2 sm:flex-row"><Textarea className="min-h-16 flex-1 border-white/10 bg-black/30 text-[9px]" onChange={(event) => setResolutions((current) => ({ ...current, [issue.id]: event.target.value }))} placeholder="Esito della verifica…" value={resolutions[issue.id] ?? ""} /><Button className="self-end bg-amber-200 text-[9px] font-semibold text-[#120d04] hover:bg-amber-100" onClick={() => void resolveIssue(issue)} type="button"><CheckCircle2 className="size-3.5" />Risolvi</Button></div>}</article>; })}</div></section>}
    </div>}
  </div></main>;
}
