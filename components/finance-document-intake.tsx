"use client";

import Link from "@/components/app-link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AlertTriangle, Archive, ArrowRight, CloudUpload, Download, FileText, LoaderCircle, LockKeyhole, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FINANCE_DOCUMENT_CATEGORIES, MAX_FINANCE_DOCUMENT_BYTES } from "@/lib/finance-document-contract";

type JobOption = { id: string; code: string | null; title: string; client: string | null; location: string | null; status: string };
type FinanceDocument = {
  id: string;
  domain: "finance";
  jobId: string | null;
  job: JobOption | null;
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

const ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.jpg,.jpeg,.png,.webp,.heic,.heif";

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
}

function sizeLabel(bytes: number) {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function statusLabel(document: FinanceDocument) {
  if (document.downloadable) return "VERIFICATO DAL PROVIDER";
  if (document.scanStatus === "INFECTED_PROVIDER") return "BLOCCATO DAL PROVIDER";
  if (document.scanStatus === "PENDING_PROVIDER") return "SCANSIONE IN CORSO";
  return "IN QUARANTENA · SCANSIONE NON ESEGUITA";
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

export function FinanceDocumentIntake() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [category, setCategory] = useState<string>(FINANCE_DOCUMENT_CATEGORIES[0].value);
  const [file, setFile] = useState<File | null>(null);
  const [notice, setNotice] = useState("");
  const [consentDocumentId, setConsentDocumentId] = useState<string | null>(null);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/finance/documents", { cache: "no-store" });
      const next = await response.json() as Payload & { error?: string };
      if (!response.ok) throw new Error(next.error ?? "finance_document_catalog_unavailable");
      setPayload(next);
    } catch (error) {
      setNotice(errorLabel(error instanceof Error ? error.message : ""));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const canWrite = payload?.context?.capabilities?.includes("finance.write") ?? false;
  const canReadDocuments = payload?.context?.capabilities?.includes("documents.read") ?? false;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!file) {
      setNotice("Seleziona un documento da archiviare.");
      return;
    }
    if (file.size > MAX_FINANCE_DOCUMENT_BYTES) {
      setNotice("Il file supera il limite di 20 MB.");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("category", category);
      if (selectedJobId) body.append("jobId", selectedJobId);
      body.append("idempotencyKey", crypto.randomUUID());
      const response = await fetch("/api/finance/documents", { method: "POST", body });
      const result = await response.json() as { error?: string; duplicate?: boolean; document?: FinanceDocument };
      if (!response.ok) throw new Error(result.error ?? "finance_document_upload_unavailable");
      setFile(null);
      form.reset();
      setSelectedJobId("");
      setCategory(FINANCE_DOCUMENT_CATEGORIES[0].value);
      setNotice(result.duplicate ? "Documento già presente: ho riletto il record esistente." : "Documento registrato e riletto; resta in quarantena fino a scansione verificata.");
      await refresh();
    } catch (error) {
      setNotice(errorLabel(error instanceof Error ? error.message : ""));
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

  const documents = payload?.documents ?? [];
  return <section className="carbon-card mt-4 rounded-2xl p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-amber-200/75">FINANZA / ARCHIVIO DOCUMENTI</p>
        <h2 className="mt-1 text-base font-semibold text-slate-100">Carica e collega le evidenze</h2>
        <p className="mt-1 max-w-3xl text-[10px] leading-5 text-slate-500">Fatture, DDT, ricevute, preventivi e contratti restano documenti separati dai registri di costo e incasso. Il collegamento alla commessa è facoltativo.</p>
      </div>
      <div className="flex items-center gap-2">
        <span className="rounded-full border border-amber-200/15 bg-amber-200/[.04] px-2.5 py-1.5 font-mono text-[9px] text-amber-100/80">{loading ? "LETTURA…" : `${payload?.summary.total ?? 0} DOCUMENTI`}</span>
        <Button aria-label="Aggiorna archivio Finance" className="size-9 border-white/10 bg-black/20 p-0 text-slate-400" disabled={loading} onClick={() => void refresh()} type="button" variant="outline"><RefreshCw className={loading ? "size-3.5 animate-spin" : "size-3.5"} /></Button>
      </div>
    </div>

    <div className="mt-4 grid gap-2 sm:grid-cols-3">
      <div className="rounded-xl border border-white/[.07] bg-black/20 p-3"><p className="text-[9px] uppercase tracking-[.12em] text-slate-600">In quarantena</p><p className="mt-1 font-mono text-lg text-amber-100">{payload?.summary.quarantined ?? 0}</p></div>
      <div className="rounded-xl border border-white/[.07] bg-black/20 p-3"><p className="text-[9px] uppercase tracking-[.12em] text-slate-600">Scansione non eseguita</p><p className="mt-1 font-mono text-lg text-slate-300">{payload?.summary.unscanned ?? 0}</p></div>
      <div className="rounded-xl border border-white/[.07] bg-black/20 p-3"><p className="text-[9px] uppercase tracking-[.12em] text-slate-600">Verificati dal provider</p><p className="mt-1 font-mono text-lg text-lime-100">{payload?.summary.clean ?? 0}</p></div>
    </div>

    {canWrite && <form className="mt-4 grid gap-3 rounded-xl border border-amber-200/15 bg-amber-200/[.025] p-3 sm:grid-cols-2" onSubmit={submit}>
      <label className="text-[10px] text-slate-400">Tipo documento
        <select aria-label="Tipo documento Finance" className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-xs text-slate-100 outline-none focus:border-amber-200/35" onChange={(event) => setCategory(event.target.value)} value={category}>
          {FINANCE_DOCUMENT_CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </label>
      <label className="text-[10px] text-slate-400">Commessa · facoltativa
        <select aria-label="Commessa collegata al documento" className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-xs text-slate-100 outline-none focus:border-amber-200/35" onChange={(event) => setSelectedJobId(event.target.value)} value={selectedJobId}>
          <option value="">Documento generale · nessuna commessa</option>
          {(payload?.jobs ?? []).map((job) => <option key={job.id} value={job.id}>{job.code ? `${job.code} · ` : ""}{job.title}</option>)}
        </select>
      </label>
      <label className="text-[10px] text-slate-400 sm:col-span-2">File · massimo 20 MB
        <input accept={ACCEPT} aria-label="File Finance" className="mt-1.5 block min-h-11 w-full cursor-pointer rounded-lg border border-dashed border-amber-200/20 bg-black/25 px-3 py-2.5 text-[10px] text-slate-400 file:mr-3 file:rounded-md file:border-0 file:bg-amber-200/10 file:px-2.5 file:py-1 file:text-[9px] file:font-semibold file:text-amber-100" onChange={(event) => setFile(event.target.files?.[0] ?? null)} required type="file" />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-2">
        <p className="flex min-w-0 items-start gap-2 text-[9px] leading-4 text-amber-100/70"><LockKeyhole className="mt-0.5 size-3.5 shrink-0" />Il file resta in quarantena e non è scaricabile finché non riceve un esito malware provider-backed.</p>
        <Button className="shrink-0 bg-amber-200 text-[10px] font-semibold text-[#090a07] hover:bg-amber-100" disabled={busy || loading} type="submit">{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <CloudUpload className="size-3.5" />}Registra documento</Button>
      </div>
    </form>}
    {!canWrite && <div className="mt-4 rounded-xl border border-white/[.07] bg-black/20 p-3 text-[10px] text-slate-500">Il tuo ruolo può consultare l’archivio Finance ma non caricare documenti.</div>}

    {notice && <p aria-live="polite" className="mt-3 rounded-lg border border-amber-200/15 bg-amber-200/[.04] px-3 py-2 text-[10px] text-amber-100/80">{notice}</p>}
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
        </article>;
      })}
      {!loading && documents.length === 0 && <div className="rounded-xl border border-dashed border-white/[.08] px-4 py-6 text-center"><Archive className="mx-auto size-5 text-slate-700" /><p className="mt-2 text-[10px] text-slate-500">Nessun documento Finance archiviato.</p></div>}
      {documents.length > 8 && canReadDocuments && <Link className="inline-flex items-center gap-1.5 px-1 py-2 text-[10px] font-medium text-lime-100 hover:text-lime-300" href="/documents">Apri archivio documenti completo <ArrowRight className="size-3" /></Link>}
    </div>
    <div className="mt-4 flex items-start gap-2 border-t border-white/[.06] pt-3 text-[9px] leading-4 text-slate-600"><LockKeyhole className="mt-0.5 size-3.5 shrink-0" />Hash e catalogo vengono riletti dal server. Le proposte non sono registrazioni contabili: revisione e creazione dei movimenti resteranno azioni separate, con permessi e audit dedicati.</div>
  </section>;
}
