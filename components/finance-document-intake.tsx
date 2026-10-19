"use client";

import Link from "@/components/app-link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Archive, ArrowRight, CloudUpload, Download, FileText, LoaderCircle, LockKeyhole, RefreshCw, ShieldCheck } from "lucide-react";
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
};
type Payload = {
  context?: { capabilities?: string[] };
  jobs: JobOption[];
  documents: FinanceDocument[];
  summary: { total: number; quarantined: number; unscanned: number; clean: number };
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
  };
  return labels[code] ?? "Operazione non completata. Riprova e controlla i dati.";
}

export function FinanceDocumentIntake() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [category, setCategory] = useState<string>(FINANCE_DOCUMENT_CATEGORIES[0].value);
  const [file, setFile] = useState<File | null>(null);
  const [notice, setNotice] = useState("");

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
        <p className="flex min-w-0 items-start gap-2 text-[9px] leading-4 text-amber-100/70"><LockKeyhole className="mt-0.5 size-3.5 shrink-0" />File conservato in quarantena: il provider malware non è collegato, quindi Company AI non può analizzarlo e il download resta bloccato.</p>
        <Button className="shrink-0 bg-amber-200 text-[10px] font-semibold text-[#090a07] hover:bg-amber-100" disabled={busy || loading} type="submit">{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <CloudUpload className="size-3.5" />}Registra documento</Button>
      </div>
    </form>}
    {!canWrite && <div className="mt-4 rounded-xl border border-white/[.07] bg-black/20 p-3 text-[10px] text-slate-500">Il tuo ruolo può consultare l’archivio Finance ma non caricare documenti.</div>}

    {notice && <p aria-live="polite" className="mt-3 rounded-lg border border-amber-200/15 bg-amber-200/[.04] px-3 py-2 text-[10px] text-amber-100/80">{notice}</p>}
    <div className="mt-4 space-y-2">
      {documents.slice(0, 8).map((document) => <article className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[.07] bg-black/20 px-3.5 py-3" key={document.id}>
        <div className="flex min-w-0 items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg border border-amber-200/15 bg-amber-200/[.05] text-amber-100"><FileText className="size-4" /></span><div className="min-w-0"><p className="break-all text-[11px] font-medium text-slate-200">{document.fileName}</p><p className="mt-1 text-[9px] text-slate-600">{FINANCE_DOCUMENT_CATEGORIES.find((item) => item.value === document.category)?.label ?? document.category} · {document.job?.code ? `${document.job.code} · ` : ""}{document.job?.title ?? "Archivio generale"} · {sizeLabel(document.sizeBytes)}</p><p className="mt-1 text-[9px] text-slate-600">{formatDate(document.createdAt)} · v{document.version}</p></div></div>
        <div className="flex flex-wrap items-center gap-2"><span className={document.downloadable ? "inline-flex items-center gap-1.5 rounded-full border border-lime-300/20 bg-lime-300/[.05] px-2.5 py-1.5 text-[8px] font-semibold tracking-wide text-lime-100" : "inline-flex items-center gap-1.5 rounded-full border border-amber-200/15 bg-amber-200/[.04] px-2.5 py-1.5 text-[8px] font-semibold tracking-wide text-amber-100/80"}><ShieldCheck className="size-3" />{statusLabel(document)}</span>{document.downloadable && <a className="inline-flex min-h-8 items-center gap-1 rounded-lg bg-lime-300 px-2.5 py-1 text-[9px] font-semibold text-[#050705]" href={document.downloadUrl}><Download className="size-3" />Scarica</a>}</div>
      </article>)}
      {!loading && documents.length === 0 && <div className="rounded-xl border border-dashed border-white/[.08] px-4 py-6 text-center"><Archive className="mx-auto size-5 text-slate-700" /><p className="mt-2 text-[10px] text-slate-500">Nessun documento Finance archiviato.</p></div>}
      {documents.length > 8 && canReadDocuments && <Link className="inline-flex items-center gap-1.5 px-1 py-2 text-[10px] font-medium text-lime-100 hover:text-lime-300" href="/documents">Apri archivio documenti completo <ArrowRight className="size-3" /></Link>}
    </div>
    <div className="mt-4 flex items-start gap-2 border-t border-white/[.06] pt-3 text-[9px] leading-4 text-slate-600"><LockKeyhole className="mt-0.5 size-3.5 shrink-0" />Hash e catalogo vengono riletti dal server. Nessun costo, ricavo o incasso nasce dal solo caricamento; l’estrazione Company AI e la revisione umana arriveranno nel blocco successivo.</div>
  </section>;
}
