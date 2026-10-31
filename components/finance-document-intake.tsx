"use client";

import Link from "@/components/app-link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AlertTriangle, Archive, ArrowRight, Camera, CheckCircle2, ChevronDown, CloudUpload, Download, FileText, LoaderCircle, LockKeyhole, Plus, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FINANCE_DOCUMENT_CATEGORIES, MAX_FINANCE_DOCUMENT_BYTES } from "@/lib/finance-document-contract";
import { FINANCE_EXTRACTED_DOCUMENT_TYPES } from "@/lib/finance-document-extraction-contract";
import { allowedTreatmentsForClassification, FINANCE_COST_CATEGORIES, FINANCE_VALUATION_BASES } from "@/lib/finance-ledger-contract";

type JobOption = { id: string; code: string | null; title: string; client: string | null; location: string | null; status: string };
type FinanceDocument = {
  id: string;
  domain: "finance";
  jobId: string | null;
  job: JobOption | null;
  jobs: JobOption[];
  category: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  scanStatus: string;
  status: string;
  version: number;
  downloadable: boolean;
  createdAt: string;
  downloadUrl: string;
  latestExtraction: null | {
    id: string;
    status: string;
    proposal: FinanceProposal | null;
    providers: { nutrient?: { pagesProcessed?: number | null; creditsUsed?: number | null; mode?: string }; companyAi?: { model?: string } };
    failureCode: string | null;
    version: number;
    createdAt: string;
  };
  latestReview: null | {
    id: string;
    extractionId: string;
    classification: string;
    fields: Record<string, unknown>;
    economicTreatment: string;
    status: string;
    reviewNote: string;
    version: number;
    reviewedBy: string;
    createdAt: string;
  };
  economicEntry: null | {
    id: string;
    entryType: string;
    documentRole: string | null;
    amountMinor: number;
    currency: string;
    status: string;
    version: number;
    preparedBy: string;
    confirmedBy: string | null;
    confirmedAt: string | null;
  };
};
type EvidenceSource = { id: string; pageNumber: number | null; confidence: number | null; text: string };
type EvidenceField = { value: string; evidence: EvidenceSource[] };
type FinanceProposal = {
  status: string;
  documentType: EvidenceField;
  counterpartyName: EvidenceField;
  counterpartyTaxId: EvidenceField;
  documentNumber: EvidenceField;
  documentDate: EvidenceField;
  dueDate: EvidenceField;
  currencyCode: EvidenceField;
  netAmount: EvidenceField;
  vatAmount: EvidenceField;
  grossAmount: EvidenceField;
  lineItems: Array<{ description: EvidenceField; quantity: EvidenceField; unit: EvidenceField; unitNetAmount: EvidenceField; vatRate: EvidenceField; netAmount: EvidenceField; grossAmount: EvidenceField }>;
  possibleJobIds: string[];
  checks: { flags: string[]; totalsReconcile: boolean | null; sourceWasTruncated: boolean };
};
type Payload = {
  context?: { capabilities?: string[] };
  jobs: JobOption[];
  documents: FinanceDocument[];
  summary: { total: number; quarantined: number; unscanned: number; clean: number };
  contract?: { aiExtraction?: { status: string; providers: { nutrient: boolean; companyAiOpenAi: boolean }; explicitUserConsentRequired: boolean; createsFinanceEntries: boolean; doesNotChangeMalwareScanStatus: boolean } };
  readback: { status: string; checkedAt: string };
};

const DIRECT_DOCUMENT_ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt";

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
}

function sizeLabel(bytes: number) {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function statusLabel(document: FinanceDocument) {
  if (document.downloadable) return "FILE VERIFICATO";
  if (document.scanStatus === "INFECTED_PROVIDER") return "FILE BLOCCATO";
  if (document.scanStatus === "PENDING_PROVIDER") return "VERIFICA FILE IN CORSO";
  return "DOWNLOAD IN ATTESA DI VERIFICA";
}

function errorLabel(code: string) {
  const labels: Record<string, string> = {
    finance_document_catalog_unavailable: "Archivio Finance non disponibile.",
    finance_document_upload_unavailable: "Caricamento non riuscito. Il registro non conferma il salvataggio.",
    finance_document_conflict: "Il file risulta già registrato o la richiesta è in conflitto.",
    finance_job_not_found: "La commessa selezionata non appartiene all’azienda attiva.",
    file_too_large: "Il file supera il limite di 20 MB.",
    unsupported_or_mismatched_file_type: "Formato non supportato o estensione non coerente.",
    file_signature_mismatch: "La firma reale del file non corrisponde al formato dichiarato.",
    object_storage_not_configured: "Archivio file non configurato sul server.",
    forbidden: "Il tuo ruolo non può eseguire questa operazione Finance.",
    external_processing_consent_required: "Conferma l’invio ai provider prima di avviare l’analisi.",
    nutrient_not_configured: "Il provider Nutrient non è configurato sul server.",
    openai_not_configured: "Company AI non è configurata sul server.",
    nutrient_quota_exhausted: "La quota Nutrient non è sufficiente per questa analisi.",
    nutrient_rate_limited: "Nutrient sta ricevendo troppe richieste. Riprova tra poco.",
    openai_rate_limited: "Company AI sta ricevendo troppe richieste. Riprova tra poco.",
    finance_document_object_unavailable: "Il file originale non è disponibile nell’archivio.",
    finance_document_hash_mismatch: "L’integrità del file non corrisponde al registro. Analisi bloccata.",
    finance_document_ai_extraction_readback_unavailable: "Proposta non riletta dal registro. Aggiorna prima di riprovare.",
    finance_review_unavailable: "Revisione non registrata: controlla i campi obbligatori e riprova.",
    finance_economic_amount_required: "Indica l’importo economico coerente con la base scelta.",
    finance_allocation_total_mismatch: "La ripartizione tra commesse deve coincidere esattamente con l’importo.",
    finance_maker_checker_violation: "Chi prepara la registrazione non può anche approvarla: serve un secondo utente autorizzato.",
    finance_entry_blocking_issue: "La registrazione ha un controllo bloccante da risolvere prima dell’approvazione.",
    finance_entry_version_conflict: "La registrazione è cambiata: aggiorna il registro prima di procedere.",
  };
  return labels[code] ?? "Operazione non completata. Riprova e controlla i dati.";
}

function amountLabel(field: EvidenceField, currency: string) {
  if (!field?.value) return "—";
  const value = Number(field.value);
  if (!Number.isFinite(value)) return field.value;
  if (/^[A-Z]{3}$/.test(currency)) {
    try { return new Intl.NumberFormat("it-IT", { style: "currency", currency }).format(value); } catch { /* show decimal below */ }
  }
  return `${new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 }).format(value)}${currency ? ` ${currency}` : ""}`;
}

function flagLabel(flag: string) {
  const labels: Record<string, string> = {
    DOCUMENT_TYPE_DIFFERS_FROM_SELECTED_CATEGORY: "Il tipo rilevato non coincide con la categoria selezionata",
    SOURCE_TEXT_TRUNCATED_REVIEW_ALL_PAGES: "Testo estratto parziale: controllare tutte le pagine",
    COUNTERPARTY_MISSING: "Controparte non rilevata con evidenza",
    DOCUMENT_NUMBER_MISSING: "Numero documento non rilevato con evidenza",
    DOCUMENT_DATE_MISSING: "Data documento non rilevata con evidenza",
    CURRENCY_MISSING: "Valuta non rilevata con evidenza",
    GROSS_AMOUNT_MISSING: "Totale documento non rilevato con evidenza",
    NET_VAT_GROSS_TOTAL_MISMATCH: "Imponibile + IVA non quadrano con il totale",
    DOCUMENT_TYPE_UNGROUNDED: "Tipo documento privo di evidenza sulla pagina",
  };
  return labels[flag] ?? flag.replaceAll("_", " ").toLowerCase();
}

function ProposalField({ label, field, currency, money = false }: { label: string; field: EvidenceField; currency: string; money?: boolean }) {
  if (!field?.value) return null;
  const source = field.evidence?.[0];
  return <div className="rounded-lg border border-white/[.06] bg-black/20 p-2.5">
    <p className="text-[8px] font-semibold uppercase tracking-[.12em] text-slate-600">{label}</p>
    <p className="mt-1 break-words text-[11px] font-medium text-slate-200">{money ? amountLabel(field, currency) : field.value}</p>
    {source && <p className="mt-1 text-[8px] leading-4 text-cyan-100/60">{source.pageNumber ? `Pag. ${source.pageNumber} · ` : "Fonte · "}{source.confidence !== null ? `confidenza ${(source.confidence * 100).toFixed(0)}% · ` : ""}“{source.text.slice(0, 180)}{source.text.length > 180 ? "…" : ""}”</p>}
  </div>;
}

const CLASSIFICATION_LABELS: Record<string, string> = Object.fromEntries(FINANCE_DOCUMENT_CATEGORIES.map((item) => [item.value, item.label]));
const TREATMENT_LABELS: Record<string, string> = {
  DOCUMENT_ONLY: "Solo documento · nessun effetto economico",
  EXPENSE: "Prepara costo",
  REVENUE: "Prepara ricavo",
  COMMITMENT: "Prepara impegno di spesa",
  PAYMENT: "Prepara pagamento",
  RECEIPT: "Prepara incasso",
};
const CATEGORY_LABELS: Record<string, string> = {
  LABOR: "Manodopera",
  MATERIALS: "Materiali",
  VEHICLES: "Mezzi",
  SUBCONTRACTS: "Subappalti",
  TRANSPORT: "Trasporti",
  RENTALS: "Noleggi",
  GENERAL: "Costi generali",
  OTHER: "Altro",
};

function minorLabel(value: number, currency: string) {
  try { return new Intl.NumberFormat("it-IT", { style: "currency", currency }).format(value / 100); } catch { return `${(value / 100).toFixed(2)} ${currency}`; }
}

function FinanceDocumentReview({
  document,
  extraction,
  proposal,
  jobs,
  canReview,
  canConfirm,
  initialJobId,
  onChanged,
  onNotice,
}: {
  document: FinanceDocument;
  extraction: NonNullable<FinanceDocument["latestExtraction"]>;
  proposal: FinanceProposal;
  jobs: JobOption[];
  canReview: boolean;
  canConfirm: boolean;
  initialJobId?: string;
  onChanged: () => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const proposedType = (FINANCE_EXTRACTED_DOCUMENT_TYPES as readonly string[]).includes(proposal.documentType.value)
    ? proposal.documentType.value
    : (FINANCE_EXTRACTED_DOCUMENT_TYPES as readonly string[]).includes(document.category) ? document.category : "OTHER";
  const proposedJobId = initialJobId || document.jobs[0]?.id || proposal.possibleJobIds[0] || "";
  const [classification, setClassification] = useState(proposedType);
  const [economicTreatment, setEconomicTreatment] = useState("DOCUMENT_ONLY");
  const [valuationBasis, setValuationBasis] = useState(proposal.grossAmount.value ? "GROSS" : "EXPLICIT");
  const [costCategory, setCostCategory] = useState("OTHER");
  const [fields, setFields] = useState({
    counterpartyName: proposal.counterpartyName.value,
    counterpartyTaxId: proposal.counterpartyTaxId.value,
    documentNumber: proposal.documentNumber.value,
    documentDate: proposal.documentDate.value,
    dueDate: proposal.dueDate.value,
    currencyCode: proposal.currencyCode.value || "EUR",
    netAmount: proposal.netAmount.value,
    vatAmount: proposal.vatAmount.value,
    grossAmount: proposal.grossAmount.value,
    economicAmount: proposal.grossAmount.value,
    description: proposal.lineItems.map((line) => line.description.value).filter(Boolean).slice(0, 5).join("; "),
  });
  const [allocations, setAllocations] = useState<Array<{ jobId: string; amount: string }>>(
    proposedJobId ? [{ jobId: proposedJobId, amount: proposal.grossAmount.value }] : [],
  );
  const [linkedJobIds, setLinkedJobIds] = useState<string[]>([...new Set([
    ...(initialJobId ? [initialJobId] : []),
    ...document.jobs.map((job) => job.id),
    ...proposal.possibleJobIds,
  ])]);
  const [reviewNote, setReviewNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const review = document.latestReview;
  const entry = document.economicEntry;
  const treatments = allowedTreatmentsForClassification(classification);

  function updateField(key: keyof typeof fields, value: string) {
    setFields((current) => ({ ...current, [key]: value }));
  }

  async function submitReview(decision: "CONFIRM" | "REJECT") {
    setBusy(true);
    try {
      const response = await fetch(`/api/finance/documents/${encodeURIComponent(document.id)}/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          decision,
          extractionId: extraction.id,
          expectedDocumentVersion: document.version,
          expectedExtractionVersion: extraction.version,
          classification,
          economicTreatment: decision === "REJECT" ? "DOCUMENT_ONLY" : economicTreatment,
          valuationBasis,
          costCategory,
          fields,
          jobIds: decision === "CONFIRM" ? linkedJobIds : [],
          allocations: decision === "CONFIRM" && economicTreatment !== "DOCUMENT_ONLY" ? allocations.filter((row) => row.jobId && row.amount) : [],
          reviewNote,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const result = await response.json() as { error?: string; entry?: { status: string }; duplicateWarning?: unknown };
      if (!response.ok) throw new Error(result.error ?? "finance_review_unavailable");
      onNotice(result.entry
        ? "Revisione registrata. Il fatto economico è preparato e attende un approvatore diverso."
        : decision === "REJECT" ? "Proposta respinta e decisione archiviata." : "Documento verificato senza effetti economici.");
      await onChanged();
    } catch (error) {
      onNotice(errorLabel(error instanceof Error ? error.message : ""));
    } finally { setBusy(false); }
  }

  async function confirmEntry() {
    if (!entry) return;
    setConfirmBusy(true);
    try {
      const response = await fetch("/api/finance/entries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "confirm", entryId: entry.id, expectedVersion: entry.version, idempotencyKey: crypto.randomUUID() }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "finance_entry_confirm_unavailable");
      onNotice("Registrazione economica approvata e riletta nel bilancio della commessa.");
      await onChanged();
    } catch (error) { onNotice(errorLabel(error instanceof Error ? error.message : "")); }
    finally { setConfirmBusy(false); }
  }

  if (review && review.status !== "REJECTED") return <div className="mt-3 rounded-xl border border-lime-300/15 bg-lime-300/[.035] p-3">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[9px] font-semibold uppercase tracking-[.15em] text-lime-100/70">REVISIONE UMANA · {review.status}</p><p className="mt-1 text-[10px] text-slate-400">{CLASSIFICATION_LABELS[review.classification] ?? review.classification} · {TREATMENT_LABELS[review.economicTreatment] ?? review.economicTreatment}</p></div><CheckCircle2 className="size-4 text-lime-200" /></div>
    {entry ? <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/[.07] bg-black/20 p-3"><div><p className="text-[9px] uppercase tracking-[.12em] text-slate-600">REGISTRAZIONE ECONOMICA</p><p className="mt-1 text-[11px] font-medium text-slate-200">{entry.entryType} · {minorLabel(entry.amountMinor, entry.currency)}</p><p className="mt-1 font-mono text-[8px] text-slate-600">{entry.status} · v{entry.version}</p></div>{entry.status === "PENDING_APPROVAL" && canConfirm && <Button className="min-h-9 bg-lime-300 text-[9px] font-semibold text-[#050705] hover:bg-lime-200" disabled={confirmBusy} onClick={() => void confirmEntry()} type="button">{confirmBusy ? <LoaderCircle className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}Approva separatamente</Button>}</div> : <p className="mt-2 text-[9px] text-slate-500">Nessun fatto economico creato: l’originale e la revisione restano nel registro Documenti.</p>}
  </div>;

  if (!canReview) return <p className="mt-3 rounded-lg border border-amber-200/15 bg-amber-200/[.035] p-3 text-[9px] leading-4 text-amber-100/75">La proposta richiede un utente con capacità di revisione documentale.</p>;

  return <div className="mt-3 rounded-xl border border-cyan-300/15 bg-cyan-300/[.025] p-3">
    {review?.status === "REJECTED" && <p className="mb-3 rounded-lg border border-amber-300/15 bg-amber-300/[.035] p-2.5 text-[9px] text-amber-100/75">La revisione precedente è stata respinta. Puoi registrare una nuova decisione senza cancellare lo storico.</p>}
    <div><p className="text-[9px] font-semibold uppercase tracking-[.15em] text-cyan-100/75">REVISIONE E DESTINAZIONE ECONOMICA</p><p className="mt-1 text-[9px] leading-4 text-slate-500">Correggi la proposta. La conferma prepara soltanto una registrazione; un secondo utente dovrà approvarla.</p></div>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <label className="text-[9px] text-slate-500">Classificazione verificata<select className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-black/30 px-2.5 text-[10px] text-slate-100" onChange={(event) => { setClassification(event.target.value); setEconomicTreatment("DOCUMENT_ONLY"); }} value={classification}>{FINANCE_EXTRACTED_DOCUMENT_TYPES.map((value) => <option key={value} value={value}>{CLASSIFICATION_LABELS[value] ?? value.replaceAll("_", " ")}</option>)}</select></label>
      <label className="text-[9px] text-slate-500">Trattamento<select className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-black/30 px-2.5 text-[10px] text-slate-100" onChange={(event) => setEconomicTreatment(event.target.value)} value={economicTreatment}>{treatments.map((value) => <option key={value} value={value}>{TREATMENT_LABELS[value]}</option>)}</select></label>
      {(["counterpartyName", "counterpartyTaxId", "documentNumber"] as const).map((key) => <label className="text-[9px] text-slate-500" key={key}>{key === "counterpartyName" ? "Controparte" : key === "counterpartyTaxId" ? "P. IVA / codice fiscale" : "Numero documento"}<input className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-[10px] text-slate-100" onChange={(event) => updateField(key, event.target.value)} value={fields[key]} /></label>)}
      <label className="text-[9px] text-slate-500">Data documento<input className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-[10px] text-slate-100" onChange={(event) => updateField("documentDate", event.target.value)} type="date" value={fields.documentDate} /></label>
      <label className="text-[9px] text-slate-500">Scadenza esplicita<input className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-[10px] text-slate-100" onChange={(event) => updateField("dueDate", event.target.value)} type="date" value={fields.dueDate} /></label>
      <label className="text-[9px] text-slate-500">Valuta<input className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-[10px] uppercase text-slate-100" maxLength={3} onChange={(event) => updateField("currencyCode", event.target.value.toUpperCase())} value={fields.currencyCode} /></label>
      {(["netAmount", "vatAmount", "grossAmount"] as const).map((key) => <label className="text-[9px] text-slate-500" key={key}>{key === "netAmount" ? "Imponibile" : key === "vatAmount" ? "Imposte" : "Totale"}<input className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-[10px] text-slate-100" inputMode="decimal" onChange={(event) => updateField(key, event.target.value)} value={fields[key]} /></label>)}
      <div className="sm:col-span-2"><p className="text-[9px] text-slate-500">Collegamenti documentali alle commesse</p><div className="mt-1.5 flex flex-wrap gap-2">{linkedJobIds.map((jobId) => { const job = jobs.find((candidate) => candidate.id === jobId); return <button className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-cyan-300/15 bg-cyan-300/[.035] px-2 text-[8px] text-cyan-100" key={jobId} onClick={() => setLinkedJobIds((current) => current.filter((value) => value !== jobId))} type="button">{job?.code ?? jobId} · {job?.title ?? "Commessa"}<X className="size-3" /></button>; })}</div><select aria-label="Aggiungi collegamento a una commessa" className="mt-2 h-9 w-full rounded-lg border border-white/10 bg-black/30 px-2 text-[9px] text-slate-100" onChange={(event) => { if (event.target.value) setLinkedJobIds((current) => [...new Set([...current, event.target.value])]); event.currentTarget.value = ""; }} value=""><option value="">Aggiungi una commessa…</option>{jobs.filter((job) => !linkedJobIds.includes(job.id)).map((job) => <option key={job.id} value={job.id}>{job.code ? `${job.code} · ` : ""}{job.title}</option>)}</select><p className="mt-1 text-[8px] text-slate-600">Il collegamento del documento è distinto dalla ripartizione economica.</p></div>
      {economicTreatment !== "DOCUMENT_ONLY" && <>
        <label className="text-[9px] text-slate-500">Base di valorizzazione<select className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-black/30 px-2.5 text-[10px] text-slate-100" onChange={(event) => setValuationBasis(event.target.value)} value={valuationBasis}>{FINANCE_VALUATION_BASES.map((value) => <option key={value} value={value}>{value === "NET" ? "Imponibile" : value === "GROSS" ? "Totale documento" : value === "DOCUMENT_TOTAL" ? "Totale verificato" : "Importo esplicito"}</option>)}</select></label>
        {valuationBasis === "EXPLICIT" && <label className="text-[9px] text-slate-500">Importo economico esplicito<input className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-[10px] text-slate-100" inputMode="decimal" onChange={(event) => updateField("economicAmount", event.target.value)} value={fields.economicAmount} /></label>}
        <label className="text-[9px] text-slate-500">Categoria gestionale<select className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-black/30 px-2.5 text-[10px] text-slate-100" onChange={(event) => setCostCategory(event.target.value)} value={costCategory}>{FINANCE_COST_CATEGORIES.map((value) => <option key={value} value={value}>{CATEGORY_LABELS[value] ?? value}</option>)}</select></label>
        <label className="text-[9px] text-slate-500 sm:col-span-2">Descrizione verificata<input className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-[10px] text-slate-100" onChange={(event) => updateField("description", event.target.value)} value={fields.description} /></label>
        <div className="sm:col-span-2"><div className="flex items-center justify-between gap-2"><p className="text-[9px] text-slate-500">Ripartizione per commessa · somma esatta</p><Button className="h-8 border-white/10 bg-black/20 px-2 text-[8px] text-slate-300" onClick={() => setAllocations((current) => [...current, { jobId: "", amount: "" }])} type="button" variant="outline"><Plus className="size-3" />Quota</Button></div><div className="mt-2 space-y-2">{allocations.map((allocation, index) => <div className="grid grid-cols-[minmax(0,1fr)_110px_32px] gap-2" key={index}><select aria-label={`Commessa quota ${index + 1}`} className="h-9 min-w-0 rounded-lg border border-white/10 bg-black/30 px-2 text-[9px] text-slate-100" onChange={(event) => setAllocations((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, jobId: event.target.value } : row))} value={allocation.jobId}><option value="">Seleziona commessa</option>{jobs.map((job) => <option key={job.id} value={job.id}>{job.code ? `${job.code} · ` : ""}{job.title}</option>)}</select><input aria-label={`Importo quota ${index + 1}`} className="h-9 rounded-lg border border-white/10 bg-black/30 px-2 text-[9px] text-slate-100" inputMode="decimal" onChange={(event) => setAllocations((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, amount: event.target.value } : row))} placeholder="0,00" value={allocation.amount} /><button aria-label={`Rimuovi quota ${index + 1}`} className="grid size-8 place-items-center rounded-lg border border-white/10 text-slate-500" onClick={() => setAllocations((current) => current.filter((_, rowIndex) => rowIndex !== index))} type="button"><X className="size-3" /></button></div>)}</div></div>
      </>}
      <label className="text-[9px] text-slate-500 sm:col-span-2">Nota di revisione<textarea className="mt-1.5 min-h-20 w-full rounded-lg border border-white/10 bg-black/30 p-3 text-[10px] text-slate-100" onChange={(event) => setReviewNote(event.target.value)} value={reviewNote} /></label>
    </div>
    <div className="mt-3 flex flex-wrap justify-end gap-2"><Button className="border-white/10 bg-transparent text-[9px] text-slate-400" disabled={busy} onClick={() => void submitReview("REJECT")} type="button" variant="outline">Respinge proposta</Button><Button className="bg-cyan-100 text-[9px] font-semibold text-[#061012] hover:bg-cyan-50" disabled={busy} onClick={() => void submitReview("CONFIRM")} type="button">{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}Conferma revisione</Button></div>
  </div>;
}

export function FinanceDocumentIntake({
  initialJobId = "",
  surface = "finance",
}: {
  initialJobId?: string;
  surface?: "finance" | "job";
}) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState(initialJobId);
  const [category, setCategory] = useState<string>(FINANCE_DOCUMENT_CATEGORIES[0].value);
  const [files, setFiles] = useState<File[]>([]);
  const [notice, setNotice] = useState("");
  const [consentDocumentId, setConsentDocumentId] = useState<string | null>(null);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [documentQuery, setDocumentQuery] = useState("");
  const [documentCategoryFilter, setDocumentCategoryFilter] = useState("ALL");
  const [documentStatusFilter, setDocumentStatusFilter] = useState("ALL");
  const [documentDateFrom, setDocumentDateFrom] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const endpoint = initialJobId ? `/api/finance/documents?jobId=${encodeURIComponent(initialJobId)}` : "/api/finance/documents";
      const response = await fetch(endpoint, { cache: "no-store" });
      const next = await response.json() as Payload & { error?: string };
      if (!response.ok) throw new Error(next.error ?? "finance_document_catalog_unavailable");
      setPayload(next);
    } catch (error) {
      setNotice(errorLabel(error instanceof Error ? error.message : ""));
    } finally {
      setLoading(false);
    }
  }, [initialJobId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const canWrite = payload?.context?.capabilities?.some((capability) => capability === "finance.documents.intake" || capability === "finance.documents.job.intake") ?? false;
  const canReview = payload?.context?.capabilities?.includes("finance.documents.review") ?? false;
  const canConfirm = payload?.context?.capabilities?.includes("finance.entries.confirm") ?? false;
  const canReadDocuments = payload?.context?.capabilities?.includes("documents.read") ?? false;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!files.length) {
      setNotice("Seleziona uno o più documenti da archiviare.");
      return;
    }
    if (files.some((file) => file.size > MAX_FINANCE_DOCUMENT_BYTES)) {
      setNotice("Almeno un file supera il limite di 20 MB.");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      const outcomes: Array<{ fileName: string; ok: boolean; duplicate: boolean; error?: string }> = [];
      for (const file of files) {
        const body = new FormData();
        body.append("file", file);
        body.append("category", category);
        if (selectedJobId) body.append("jobId", selectedJobId);
        body.append("idempotencyKey", crypto.randomUUID());
        const response = await fetch("/api/finance/documents", { method: "POST", body });
        const result = await response.json() as { error?: string; duplicate?: boolean; document?: FinanceDocument };
        outcomes.push({ fileName: file.name, ok: response.ok, duplicate: Boolean(result.duplicate), error: result.error });
      }
      setFiles([]);
      form.reset();
      setSelectedJobId(initialJobId);
      setCategory(FINANCE_DOCUMENT_CATEGORIES[0].value);
      const completed = outcomes.filter((outcome) => outcome.ok).length;
      const duplicates = outcomes.filter((outcome) => outcome.ok && outcome.duplicate).length;
      const failed = outcomes.filter((outcome) => !outcome.ok);
      setNotice(failed.length
        ? `${completed}/${outcomes.length} acquisizioni completate. Non riusciti: ${failed.map((outcome) => outcome.fileName).join(", ")}.`
        : `${completed} ${completed === 1 ? "documento registrato" : "documenti registrati"} e riletti${duplicates ? ` · ${duplicates} già presenti` : ""}.`);
      await refresh();
    } catch {
      setNotice("Acquisizione interrotta. Gli esiti già confermati restano registrati; aggiorna il registro prima di riprovare.");
    } finally {
      setBusy(false);
    }
  }

  async function analyzeDocument(documentId: string) {
    setAnalyzingId(documentId);
    setNotice("");
    try {
      const response = await fetch(`/api/finance/documents/${encodeURIComponent(documentId)}/analyze`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ externalProcessingConsent: true, idempotencyKey: crypto.randomUUID() }),
      });
      const result = await response.json() as { error?: string; extraction?: { status: string } };
      if (!response.ok) throw new Error(result.error ?? "finance_document_analysis_unavailable");
      setConsentDocumentId(null);
      setNotice(result.extraction?.status === "REVIEW_REQUIRED" ? "Proposta generata con controlli aperti: verifica ogni campo prima di usarlo." : "Proposta Company AI generata. Nessun costo o incasso è stato registrato.");
      await refresh();
    } catch (error) {
      setNotice(errorLabel(error instanceof Error ? error.message : ""));
      await refresh();
    } finally {
      setAnalyzingId(null);
    }
  }

  const allDocuments = payload?.documents ?? [];
  const documents = allDocuments.filter((document) => {
    const query = documentQuery.trim().toLocaleLowerCase("it-IT");
    const counterparty = typeof document.latestReview?.fields.counterpartyName === "string" ? document.latestReview.fields.counterpartyName : "";
    const matchesQuery = !query || [document.fileName, document.category, document.job?.code, document.job?.title, counterparty].filter(Boolean).join(" ").toLocaleLowerCase("it-IT").includes(query);
    const matchesCategory = documentCategoryFilter === "ALL" || document.category === documentCategoryFilter || document.latestReview?.classification === documentCategoryFilter;
    const economicStatus = document.economicEntry?.status ?? (document.latestReview ? "DOCUMENT_ONLY" : "TO_REVIEW");
    const matchesStatus = documentStatusFilter === "ALL" || economicStatus === documentStatusFilter;
    const matchesDate = !documentDateFrom || document.createdAt.slice(0, 10) >= documentDateFrom;
    return matchesQuery && matchesCategory && matchesStatus && matchesDate;
  });
  const scannerQuery = new URLSearchParams({ category, origin: surface });
  if (selectedJobId) scannerQuery.set("jobId", selectedJobId);
  const selectedJob = payload?.jobs.find((job) => job.id === selectedJobId) ?? payload?.jobs[0] ?? null;
  const awaitingAnalysis = allDocuments.filter((document) => !document.latestExtraction || document.latestExtraction.status === "FAILED").length;
  const awaitingReview = allDocuments.filter((document) => document.latestExtraction?.proposal && !document.latestReview).length;
  const activeFilterCount = [documentCategoryFilter !== "ALL", documentStatusFilter !== "ALL", Boolean(documentDateFrom)].filter(Boolean).length;
  const clearFilters = () => {
    setDocumentQuery("");
    setDocumentCategoryFilter("ALL");
    setDocumentStatusFilter("ALL");
    setDocumentDateFrom("");
  };
  return <section className="carbon-card mt-4 overflow-hidden rounded-[24px] border border-lime-300/10 p-3.5 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-[14px] border border-lime-300/20 bg-lime-300/[.06] text-lime-100"><Archive className="size-4.5" /></span>
        <div className="min-w-0">
          <p className="text-[9px] font-semibold uppercase tracking-[.18em] text-lime-300/65">{surface === "job" ? "DOSSIER / DOCUMENTI" : "FINANZA / DOCUMENTI"}</p>
          <h2 className="mt-1 text-[17px] font-semibold leading-tight text-slate-100">{surface === "job" ? "Archivio della commessa" : "Archivio documentale"}</h2>
          <p className="mt-1 max-w-3xl text-[10px] leading-5 text-slate-500">{surface === "job" ? "Scansiona o carica l’originale, poi verifica la proposta Company AI nello stesso registro di Finance." : "Acquisisci gli originali e collegali al contesto corretto. Gli effetti economici restano separati e richiedono conferma."}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="rounded-full border border-lime-300/15 bg-lime-300/[.04] px-2.5 py-1.5 font-mono text-[8px] text-lime-100/80">{loading ? "LETTURA…" : "READBACK OK"}</span>
        <Button aria-label="Aggiorna archivio Finance" className="size-9 border-white/10 bg-black/20 p-0 text-slate-400" disabled={loading} onClick={() => void refresh()} type="button" variant="outline"><RefreshCw className={loading ? "size-3.5 animate-spin" : "size-3.5"} /></Button>
      </div>
    </div>

    <div className="mt-4 grid grid-cols-3 gap-2">
      <div className="min-w-0 rounded-xl border border-white/[.07] bg-black/20 px-2.5 py-2.5"><p className="truncate text-[7px] font-semibold uppercase tracking-[.12em] text-slate-600">In archivio</p><p className="mt-1 font-mono text-base text-slate-100">{payload?.summary.total ?? 0}</p></div>
      <div className="min-w-0 rounded-xl border border-cyan-200/10 bg-cyan-200/[.025] px-2.5 py-2.5"><p className="truncate text-[7px] font-semibold uppercase tracking-[.12em] text-cyan-100/50">Da analizzare</p><p className="mt-1 font-mono text-base text-cyan-100">{awaitingAnalysis}</p></div>
      <div className="min-w-0 rounded-xl border border-amber-200/10 bg-amber-200/[.025] px-2.5 py-2.5"><p className="truncate text-[7px] font-semibold uppercase tracking-[.12em] text-amber-100/50">Da revisionare</p><p className="mt-1 font-mono text-base text-amber-100">{awaitingReview}</p></div>
    </div>

    {canWrite && <form className="mt-4 grid gap-3 rounded-[20px] border border-lime-300/14 bg-[linear-gradient(145deg,rgba(190,255,40,0.035),rgba(0,0,0,0.18))] p-3.5 sm:grid-cols-2 sm:p-4" onSubmit={submit}>
      <div className="flex items-start justify-between gap-3 sm:col-span-2">
        <div><p className="text-[8px] font-semibold uppercase tracking-[.16em] text-lime-300/65">NUOVA ACQUISIZIONE</p><h3 className="mt-1 text-sm font-semibold text-slate-100">Aggiungi un documento</h3></div>
        <span className="rounded-full border border-white/[.08] bg-black/20 px-2.5 py-1 font-mono text-[7px] text-slate-500">PDF · FOTO · FILE</span>
      </div>
      <label className="text-[9px] font-medium text-slate-400">Tipo documento
        <select aria-label="Tipo documento Finance" className="mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-[12px] text-slate-100 outline-none focus:border-lime-300/35 focus:ring-2 focus:ring-lime-300/10" onChange={(event) => setCategory(event.target.value)} value={category}>
          {FINANCE_DOCUMENT_CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </label>
      {surface === "finance" ? <label className="text-[9px] font-medium text-slate-400">Commessa · facoltativa
        <select aria-label="Commessa collegata al documento" className="mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-[12px] text-slate-100 outline-none focus:border-lime-300/35 focus:ring-2 focus:ring-lime-300/10" onChange={(event) => setSelectedJobId(event.target.value)} value={selectedJobId}>
          <option value="">Archivio generale</option>
          {(payload?.jobs ?? []).map((job) => <option key={job.id} value={job.id}>{job.code ? `${job.code} · ` : ""}{job.title}</option>)}
        </select>
      </label> : <div className="rounded-xl border border-cyan-300/12 bg-cyan-300/[.025] px-3 py-2.5"><p className="text-[7px] font-semibold uppercase tracking-[.14em] text-cyan-100/55">COMMESSA DEL DOSSIER · BLOCCATA DAL SERVER</p><p className="mt-1 truncate text-[10px] font-medium text-cyan-50/85">{selectedJob ? `${selectedJob.code ? `${selectedJob.code} · ` : ""}${selectedJob.title}` : initialJobId}</p></div>}
      <div className="grid gap-2 sm:col-span-2">
        <a aria-label="Apri lo scanner documentale Genius" className="inline-flex min-h-14 items-center justify-center gap-3 rounded-xl border border-lime-200/55 bg-[linear-gradient(135deg,#dfff54,#9ee800)] px-4 text-[#050705] shadow-[0_10px_28px_rgba(180,255,30,.14)]" data-navigation-mode="hard" href={`/documents/scan?${scannerQuery.toString()}`}><Camera className="size-4.5 shrink-0" /><span className="text-left"><strong className="block text-[10px] font-semibold">Scansiona documento con Genius</strong><span className="mt-0.5 block text-[8px] font-medium text-black/60">Bordi, prospettiva e PDF multipagina</span></span></a>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-0.5" aria-hidden="true"><span className="h-px bg-white/[.06]" /><span className="font-mono text-[7px] text-slate-600">OPPURE</span><span className="h-px bg-white/[.06]" /></div>
        <label className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/10 bg-black/25 px-3 text-[9px] font-semibold text-slate-300 transition-colors hover:border-lime-300/30 hover:text-lime-100"><FileText className="size-3.5" />Scegli file già acquisito<input accept={DIRECT_DOCUMENT_ACCEPT} aria-label="Scegli un documento già acquisito dal dispositivo" className="sr-only" multiple onChange={(event) => { setFiles(Array.from(event.target.files ?? [])); event.currentTarget.value = ""; }} type="file" /></label>
        <p className="px-1 text-center text-[8px] leading-4 text-slate-600">PDF o file documentale già presente. Le foto grezze passano dallo scanner Genius.</p>
      </div>
      {files.length > 0 && <div className="space-y-1.5 rounded-xl border border-lime-300/12 bg-lime-300/[.025] p-2.5 sm:col-span-2"><div className="flex items-center justify-between gap-2"><p className="text-[8px] font-semibold uppercase tracking-[.12em] text-lime-100/65">{files.length} {files.length === 1 ? "file pronto" : "file pronti"}</p><button className="text-[8px] text-slate-500 hover:text-slate-200" onClick={() => setFiles([])} type="button">Rimuovi tutti</button></div>{files.slice(0, 4).map((file, index) => <div className="flex items-center justify-between gap-2 rounded-lg bg-black/20 px-2.5 py-2" key={`${file.name}-${file.lastModified}-${index}`}><p className="min-w-0 truncate text-[9px] text-slate-300">{file.name}</p><div className="flex shrink-0 items-center gap-2"><span className="font-mono text-[7px] text-slate-600">{sizeLabel(file.size)}</span><button aria-label={`Rimuovi ${file.name}`} className="grid size-6 place-items-center rounded-md border border-white/[.07] text-slate-500 hover:text-slate-200" onClick={() => setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))} type="button"><X className="size-3" /></button></div></div>)}{files.length > 4 && <p className="px-1 text-[8px] text-slate-600">Altri {files.length - 4} file selezionati</p>}</div>}
      <div className="grid gap-3 border-t border-white/[.06] pt-3 sm:col-span-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <p className="flex min-w-0 items-start gap-2 text-[8px] leading-4 text-slate-500"><LockKeyhole className="mt-0.5 size-3.5 shrink-0 text-lime-100/55" />Originale, hash e collegamento vengono riletti dal server. L’analisi AI e gli effetti economici restano passaggi separati.</p>
        <Button className="min-h-11 w-full px-5 text-[10px] font-semibold sm:w-auto" disabled={busy || loading || files.length === 0} type="submit">{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <CloudUpload className="size-3.5" />}{busy ? "Registrazione…" : files.length > 1 ? `Registra ${files.length} documenti` : "Registra documento"}</Button>
      </div>
    </form>}
    {!canWrite && <div className="mt-4 rounded-xl border border-white/[.07] bg-black/20 p-3 text-[10px] text-slate-500">Il tuo ruolo può consultare questo registro ma non acquisire documenti.</div>}

    {notice && <p aria-live="polite" className="mt-3 rounded-lg border border-amber-200/15 bg-amber-200/[.04] px-3 py-2 text-[10px] text-amber-100/80">{notice}</p>}
    <div className="mt-4 rounded-[18px] border border-white/[.07] bg-black/15 p-3">
      <div className="flex items-center justify-between gap-3"><div><p className="text-[8px] font-semibold uppercase tracking-[.14em] text-slate-600">REGISTRO DOCUMENTI</p><p className="mt-1 text-[10px] text-slate-400">{documents.length} {documents.length === 1 ? "risultato" : "risultati"}</p></div>{(documentQuery || activeFilterCount > 0) && <button className="text-[8px] font-medium text-lime-100" onClick={clearFilters} type="button">Azzera filtri</button>}</div>
      <label className="relative mt-3 block"><span className="sr-only">Cerca nel registro documenti</span><Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-600" /><input className="h-11 w-full rounded-xl border border-white/10 bg-black/30 pl-9 pr-3 text-[11px] text-slate-100 outline-none placeholder:text-slate-600 focus:border-lime-300/30 focus:ring-2 focus:ring-lime-300/10" onChange={(event) => setDocumentQuery(event.target.value)} placeholder="Cerca file, controparte o commessa…" value={documentQuery} /></label>
      <details className="group mt-2"><summary className="flex min-h-10 cursor-pointer list-none items-center justify-between rounded-xl border border-white/[.07] bg-black/20 px-3 text-[9px] text-slate-400 [&::-webkit-details-marker]:hidden"><span className="flex items-center gap-2"><SlidersHorizontal className="size-3.5" />Filtri avanzati{activeFilterCount > 0 && <span className="rounded-full bg-lime-300 px-1.5 py-0.5 font-mono text-[7px] text-black">{activeFilterCount}</span>}</span><ChevronDown className="size-3.5 transition-transform group-open:rotate-180" /></summary><div className="mt-2 grid gap-2 border-t border-white/[.06] pt-3 sm:grid-cols-3"><label className="text-[8px] font-semibold uppercase tracking-[.12em] text-slate-600">Tipologia<select className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-black/30 px-2.5 text-[10px] font-normal normal-case tracking-normal text-slate-100" onChange={(event) => setDocumentCategoryFilter(event.target.value)} value={documentCategoryFilter}><option value="ALL">Tutte</option>{FINANCE_DOCUMENT_CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label className="text-[8px] font-semibold uppercase tracking-[.12em] text-slate-600">Stato economico<select className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-black/30 px-2.5 text-[10px] font-normal normal-case tracking-normal text-slate-100" onChange={(event) => setDocumentStatusFilter(event.target.value)} value={documentStatusFilter}><option value="ALL">Tutti</option><option value="TO_REVIEW">Da revisionare</option><option value="DOCUMENT_ONLY">Solo documento</option><option value="PENDING_APPROVAL">Da approvare</option><option value="CONFIRMED">Confermato</option><option value="REVERSED">Stornato</option></select></label><label className="text-[8px] font-semibold uppercase tracking-[.12em] text-slate-600">Dal giorno<input className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-black/30 px-2.5 text-[10px] font-normal normal-case tracking-normal text-slate-100" onChange={(event) => setDocumentDateFrom(event.target.value)} type="date" value={documentDateFrom} /></label></div></details>
    </div>
    <div className="mt-4 space-y-2">
      {documents.slice(0, 8).map((document) => {
        const extraction = document.latestExtraction;
        const proposal = extraction?.proposal;
        const providersReady = payload?.contract?.aiExtraction?.status === "READY";
        return <article className="rounded-xl border border-white/[.07] bg-black/20 p-3.5" key={document.id}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg border border-amber-200/15 bg-amber-200/[.05] text-amber-100"><FileText className="size-4" /></span><div className="min-w-0"><p className="break-all text-[11px] font-medium text-slate-200">{document.fileName}</p><p className="mt-1 text-[9px] text-slate-600">{FINANCE_DOCUMENT_CATEGORIES.find((item) => item.value === document.category)?.label ?? document.category} · {document.job?.code ? `${document.job.code} · ` : ""}{document.job?.title ?? "Archivio generale"} · {sizeLabel(document.sizeBytes)}</p><p className="mt-1 text-[9px] text-slate-600">{formatDate(document.createdAt)} · v{document.version}</p></div></div>
            <div className="flex flex-wrap items-center gap-2"><span className={document.downloadable ? "inline-flex items-center gap-1.5 rounded-full border border-lime-300/20 bg-lime-300/[.05] px-2.5 py-1.5 text-[8px] font-semibold tracking-wide text-lime-100" : "inline-flex items-center gap-1.5 rounded-full border border-amber-200/15 bg-amber-200/[.04] px-2.5 py-1.5 text-[8px] font-semibold tracking-wide text-amber-100/80"}><ShieldCheck className="size-3" />{statusLabel(document)}</span>{document.downloadable && <a className="inline-flex min-h-8 items-center gap-1 rounded-lg bg-lime-300 px-2.5 py-1 text-[9px] font-semibold text-[#050705]" href={document.downloadUrl}><Download className="size-3" />Scarica</a>}</div>
          </div>

          {canWrite && (!extraction || extraction.status === "FAILED") && <div className="mt-3 rounded-xl border border-cyan-200/15 bg-cyan-200/[.025] p-3">
            <div className="flex items-start gap-2"><Sparkles className="mt-0.5 size-3.5 shrink-0 text-cyan-100" /><p className="text-[9px] leading-4 text-slate-400">Company AI invia il file a Nutrient per OCR/lettura strutturata e il testo risultante a OpenAI per preparare una proposta. L’analisi non è una scansione antivirus, non sblocca il download e non registra movimenti Finance.</p></div>
            {!providersReady && <p className="mt-2 text-[9px] text-amber-100/80">Uno o più provider di analisi non sono configurati.</p>}
            {extraction?.failureCode && <p className="mt-2 text-[9px] text-amber-100/80">Ultimo tentativo non riuscito: {errorLabel(extraction.failureCode)}</p>}
            <label className="mt-3 flex cursor-pointer items-start gap-2 text-[9px] leading-4 text-cyan-50/75"><input aria-label={`Autorizza analisi esterna di ${document.fileName}`} checked={consentDocumentId === document.id} className="mt-0.5 accent-lime-300" onChange={(event) => setConsentDocumentId(event.target.checked ? document.id : null)} type="checkbox" />Confermo l’invio del documento a Nutrient e del testo estratto a OpenAI. Crediti e conservazione dei dati dipendono dal piano e dalle impostazioni dei provider.</label>
            <Button className="mt-3 min-h-9 bg-cyan-100 px-3 text-[10px] font-semibold text-[#071010] hover:bg-cyan-50" disabled={!providersReady || consentDocumentId !== document.id || analyzingId !== null} onClick={() => void analyzeDocument(document.id)} type="button">{analyzingId === document.id ? <LoaderCircle className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}{analyzingId === document.id ? "Analisi in corso…" : "Analizza con Company AI"}</Button>
          </div>}

          {extraction?.status === "PROCESSING" && <div className="mt-3 flex items-center gap-2 rounded-lg border border-cyan-200/15 bg-cyan-200/[.04] p-2.5 text-[9px] text-cyan-50/75"><LoaderCircle className="size-3.5 animate-spin" />Analisi server-side in corso. Aggiorna il registro tra poco.</div>}
          {proposal && <div className="mt-3 rounded-xl border border-lime-200/15 bg-lime-200/[.025] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-[9px] font-semibold uppercase tracking-[.16em] text-lime-100/70">PROPOSTA COMPANY AI · DA REVISIONARE</p><p className="mt-1 text-[10px] text-slate-500">{proposal.documentType.value || "Tipo non determinato"} · generata {formatDate(extraction.createdAt)}</p></div><span className="rounded-full border border-amber-200/15 bg-amber-200/[.04] px-2 py-1 font-mono text-[8px] text-amber-100">{proposal.checks.flags.length ? `${proposal.checks.flags.length} CONTROLLI APERTI` : "NESSUN CONTROLLO AUTOMATICO APERTO"}</span></div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              <ProposalField label="Controparte" field={proposal.counterpartyName} currency="" />
              <ProposalField label="Partita IVA / codice fiscale" field={proposal.counterpartyTaxId} currency="" />
              <ProposalField label="Numero documento" field={proposal.documentNumber} currency="" />
              <ProposalField label="Data documento" field={proposal.documentDate} currency="" />
              <ProposalField label="Scadenza" field={proposal.dueDate} currency="" />
              <ProposalField label="Valuta" field={proposal.currencyCode} currency="" />
              <ProposalField label="Imponibile" field={proposal.netAmount} currency={proposal.currencyCode.value} money />
              <ProposalField label="IVA" field={proposal.vatAmount} currency={proposal.currencyCode.value} money />
              <ProposalField label="Totale documento" field={proposal.grossAmount} currency={proposal.currencyCode.value} money />
            </div>
            {proposal.lineItems.length > 0 && <div className="mt-3 space-y-2"><p className="text-[8px] font-semibold uppercase tracking-[.12em] text-slate-600">RIGHE RILEVATE</p>{proposal.lineItems.map((line, index) => <div className="rounded-lg border border-white/[.06] bg-black/20 p-2.5" key={`${extraction.id}-${index}`}><p className="text-[10px] font-medium text-slate-200">{line.description.value}</p><div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[8px] text-slate-500"><span>{line.quantity.value ? `${line.quantity.value} ${line.unit.value}` : "Quantità non rilevata"}</span>{line.netAmount.value && <span>Imponibile {amountLabel(line.netAmount, proposal.currencyCode.value)}</span>}{line.vatRate.value && <span>IVA {line.vatRate.value}%</span>}{line.grossAmount.value && <span>Totale {amountLabel(line.grossAmount, proposal.currencyCode.value)}</span>}</div>{line.description.evidence[0] && <p className="mt-1 text-[8px] leading-4 text-cyan-100/60">Pag. {line.description.evidence[0].pageNumber ?? "—"} · “{line.description.evidence[0].text.slice(0, 180)}{line.description.evidence[0].text.length > 180 ? "…" : ""}”</p>}</div>)}</div>}
            {proposal.possibleJobIds.length > 0 && <p className="mt-3 text-[9px] text-cyan-100/75">Commesse citate nel documento: {proposal.possibleJobIds.map((id) => { const job = payload?.jobs.find((candidate) => candidate.id === id); return job ? `${job.code ?? id} · ${job.title}` : id; }).join("; ")}. Il collegamento non è stato modificato.</p>}
            {proposal.checks.flags.length > 0 && <div className="mt-3 rounded-lg border border-amber-200/15 bg-amber-200/[.035] p-2.5"><p className="flex items-center gap-1.5 text-[9px] font-semibold text-amber-100"><AlertTriangle className="size-3" />Controlli da verificare</p><ul className="mt-1.5 space-y-1">{proposal.checks.flags.map((flag) => <li className="text-[8px] leading-4 text-amber-50/70" key={flag}>• {flagLabel(flag)}</li>)}</ul></div>}
            <div className="mt-3 flex flex-wrap items-start justify-between gap-2 border-t border-white/[.06] pt-2.5 text-[8px] leading-4 text-slate-600"><span>{extraction.providers.nutrient?.pagesProcessed ?? "—"} pagine elaborate da Nutrient · {extraction.providers.nutrient?.creditsUsed ?? "—"} crediti riportati dal provider</span><span>Proposta auditata · nessuna scrittura in Finanza</span></div>
          </div>}
          {proposal && <FinanceDocumentReview canConfirm={canConfirm} canReview={canReview} document={document} extraction={extraction} initialJobId={initialJobId} jobs={payload?.jobs ?? []} onChanged={refresh} onNotice={setNotice} proposal={proposal} />}
        </article>;
      })}
      {!loading && documents.length === 0 && <div className="rounded-xl border border-dashed border-white/[.08] px-4 py-6 text-center"><Archive className="mx-auto size-5 text-slate-700" /><p className="mt-2 text-[10px] text-slate-500">Nessun documento Finance archiviato.</p></div>}
      {surface === "finance" && documents.length > 8 && canReadDocuments && <Link className="inline-flex items-center gap-1.5 px-1 py-2 text-[10px] font-medium text-lime-100 hover:text-lime-300" href="/documents">Apri archivio documenti completo <ArrowRight className="size-3" /></Link>}
    </div>
    <div className="mt-4 flex items-start gap-2 border-t border-white/[.06] pt-3 text-[9px] leading-4 text-slate-600"><LockKeyhole className="mt-0.5 size-3.5 shrink-0" />Hash e catalogo vengono riletti dal server. Le proposte non sono registrazioni contabili: revisione e creazione dei movimenti resteranno azioni separate, con permessi e audit dedicati.</div>
  </section>;
}
