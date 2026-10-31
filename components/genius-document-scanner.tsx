"use client";

import Link from "@/components/app-link";
import { useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  FileText,
  Image as ImageIcon,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  FINANCE_DOCUMENT_CATEGORIES,
  MAX_FINANCE_DOCUMENT_BYTES,
} from "@/lib/finance-document-contract";

type ScannerPhase = "idle" | "loading" | "scanning" | "uploading" | "done" | "error";
type RegisteredDocument = {
  id: string;
  fileName: string;
  sizeBytes: number;
  category: string;
  version: number;
};

function scannerError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  const labels: Record<string, string> = {
    genius_license_not_configured: "La licenza Genius Scan non è configurata per questo ambiente.",
    genius_camera_requires_secure_context: "La fotocamera richiede una connessione HTTPS sicura.",
    genius_scan_empty: "La scansione non contiene pagine da registrare.",
    genius_scan_too_large: "Il PDF supera il limite di 20 MB. Riduci le pagine o la qualità e riprova.",
    finance_document_upload_unavailable: "Il registro non ha confermato il salvataggio. Il PDF resta pronto per un nuovo tentativo.",
    finance_job_not_found: "La commessa non è disponibile nel perimetro corrente.",
    forbidden: "Il ruolo corrente non può acquisire documenti in questa commessa.",
  };
  if (labels[code]) return labels[code];
  if (/cancel|abort|closed/i.test(code)) return "Acquisizione annullata. Nessun file è stato registrato.";
  if (/license|licence|expired|app.?id|hostname|domain/i.test(code)) {
    return "La licenza Genius non è valida per questo indirizzo. Verifica nel portale Genius che l’App ID coincida con il dominio della PWA.";
  }
  if (/notallowed|permission|denied/i.test(code)) {
    return "Accesso alla fotocamera non consentito. Abilitalo nelle impostazioni del browser e riprova.";
  }
  if (/camera|video|media|device|notfound/i.test(code)) {
    return "Fotocamera non disponibile. Controlla i permessi del dispositivo oppure importa un’immagine nello scanner Genius.";
  }
  if (/webassembly|wasm|content security|unsafe-eval|worker/i.test(code)) {
    return "Il motore grafico Genius non è riuscito ad avviarsi. Ricarica la pagina e riprova.";
  }
  return "Acquisizione non completata. Il file non viene considerato registrato senza readback del server.";
}

function fileSize(bytes: number) {
  return bytes < 1_048_576
    ? `${Math.ceil(bytes / 1024)} KB`
    : `${(bytes / 1_048_576).toFixed(2)} MB`;
}

function scanFileName() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `scansione-documento-${timestamp}.pdf`;
}

export default function GeniusDocumentScanner({
  initialCategory,
  jobId,
  licenseKey,
  returnHref,
}: {
  initialCategory: string;
  jobId: string;
  licenseKey: string;
  returnHref: string;
}) {
  const [category, setCategory] = useState(initialCategory);
  const [phase, setPhase] = useState<ScannerPhase>("idle");
  const [notice, setNotice] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [registered, setRegistered] = useState<RegisteredDocument | null>(null);
  const initializedLicense = useRef("");
  const idempotencyKey = useRef("");
  const busy = phase === "loading" || phase === "scanning" || phase === "uploading";

  async function upload(file: File) {
    setPhase("uploading");
    setNotice("Registrazione nel documento canonico e rilettura server-side…");
    if (!idempotencyKey.current) idempotencyKey.current = crypto.randomUUID();
    const body = new FormData();
    body.append("file", file);
    body.append("category", category);
    if (jobId) body.append("jobId", jobId);
    body.append("idempotencyKey", idempotencyKey.current);
    const response = await fetch("/api/finance/documents", { method: "POST", body });
    const result = await response.json() as {
      error?: string;
      duplicate?: boolean;
      document?: RegisteredDocument;
      readback?: { status?: string };
    };
    if (!response.ok || !result.document || result.readback?.status !== "verified") {
      throw new Error(result.error ?? "finance_document_upload_unavailable");
    }
    setRegistered(result.document);
    setPendingFile(null);
    setPhase("done");
    setNotice(result.duplicate
      ? "Documento già presente: il server ha restituito il record esistente senza duplicarlo."
      : "Documento registrato e riletto. Ora può essere analizzato con Nutrient e Company AI dal dossier.");
  }

  function fail(error: unknown) {
    setPhase("error");
    setNotice(scannerError(error));
  }

  async function start(source: "camera" | "gallery") {
    setRegistered(null);
    setPendingFile(null);
    idempotencyKey.current = "";
    setNotice("");
    if (!licenseKey) return fail(new Error("genius_license_not_configured"));
    if (source === "camera" && !window.isSecureContext) {
      return fail(new Error("genius_camera_requires_secure_context"));
    }

    let capturedFile: File | null = null;
    try {
      setPhase("loading");
      const sdk = await import("@thegrizzlylabs/web-geniusscan-sdk");
      if (initializedLicense.current !== licenseKey) {
        await sdk.setLicenseKey(licenseKey);
        initializedLicense.current = licenseKey;
      }
      setPhase("scanning");
      const title = jobId ? `Documento commessa ${jobId}` : "Documento aziendale";
      const result = await sdk.scanWithConfiguration({
        source,
        multiPage: source === "camera",
        multiPageFormat: "pdf",
        pdfPageSize: "a4",
        pdfTitle: title,
        language: "it",
        foregroundColor: "#f4f7ef",
        backgroundColor: "#030604",
        highlightColor: "#b8ff18",
        defaultFilter: "automatic",
        availableFilters: ["automatic", "strong_monochrome", "soft_grayscale", "soft_color", "strong_color", "photo", "dark_background", "none"],
        postProcessingActions: ["rotate", "editFilter", "correctDistortion"],
        jpegQuality: 82,
        outputOriginalImage: false,
      });
      if (!result.scans.length) throw new Error("genius_scan_empty");
      const pdf = result.multiPageDocument?.data
        ?? await sdk.generatePDFFromImages(
          result.scans.map((scan) => scan.enhancedImage.data),
          "a4",
          title,
        );
      capturedFile = new File([pdf], scanFileName(), {
        type: "application/pdf",
        lastModified: Date.now(),
      });
      if (capturedFile.size > MAX_FINANCE_DOCUMENT_BYTES) throw new Error("genius_scan_too_large");
      setPendingFile(capturedFile);
      await upload(capturedFile);
    } catch (error) {
      if (capturedFile) setPendingFile(capturedFile);
      fail(error);
    }
  }

  async function retryUpload() {
    if (!pendingFile) return;
    try {
      await upload(pendingFile);
    } catch (error) {
      fail(error);
    }
  }

  return <main className="min-h-screen bg-[#030504] px-3 pb-28 pt-5 text-slate-100 sm:px-6 sm:pt-8">
    <div className="mx-auto max-w-3xl">
      <Link className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/10 bg-black/25 px-3 text-[10px] font-medium text-slate-300" href={returnHref}><ArrowLeft className="size-3.5" />Torna al registro</Link>

      <section className="carbon-card mt-4 overflow-hidden rounded-[26px] border border-lime-300/15 p-4 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl border border-lime-300/20 bg-lime-300/[.08] text-lime-100"><Camera className="size-5" /></span>
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-[.2em] text-lime-300/70">GENIUS SCAN · ACQUISIZIONE GRAFICA</p>
            <h1 className="mt-1 text-xl font-semibold text-slate-100">Scansiona, correggi e registra</h1>
            <p className="mt-2 max-w-2xl text-[11px] leading-5 text-slate-400">Rilevamento bordi, correzione prospettica, filtri e PDF multipagina avvengono sul dispositivo. Genius non esegue OCR: dopo il salvataggio, Nutrient legge il documento e Company AI prepara una proposta verificabile.</p>
          </div>
        </div>

        <label className="mt-5 block text-[10px] text-slate-400">Tipo documento
          <select className="mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-slate-100 outline-none focus:border-lime-300/35" disabled={busy} onChange={(event) => setCategory(event.target.value)} value={category}>
            {FINANCE_DOCUMENT_CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <div className="mt-3 rounded-xl border border-cyan-300/12 bg-cyan-300/[.025] p-3 text-[9px] leading-5 text-cyan-50/70">
          {jobId ? <>Il documento sarà collegato alla commessa server-side <span className="font-mono text-cyan-100">{jobId}</span>. Il server ricontrolla tenant, assegnazione e capability.</> : <>Documento aziendale senza commessa preimpostata. L’associazione potrà essere verificata successivamente nel registro Finance.</>}
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <Button className="min-h-12 bg-lime-300 text-[11px] font-semibold text-[#050705] hover:bg-lime-200" data-genius-action="camera" disabled={busy || !licenseKey} onClick={() => void start("camera")} type="button">{phase === "loading" || phase === "scanning" ? <LoaderCircle className="size-4 animate-spin" /> : <Camera className="size-4" />}Scansiona con fotocamera</Button>
          <Button className="min-h-12 border-cyan-300/18 bg-cyan-300/[.04] text-[11px] font-semibold text-cyan-100 hover:bg-cyan-300/[.08]" data-genius-action="gallery" disabled={busy || !licenseKey} onClick={() => void start("gallery")} type="button" variant="outline"><ImageIcon className="size-4" />Correggi immagine con Genius</Button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-1.5">
          {[
            ["1", "Genius", "Cattura"],
            ["2", "Registro", "Salva"],
            ["3", "AI", "Analizza"],
          ].map(([step, title, detail]) => <div className="min-w-0 rounded-xl border border-white/[.07] bg-black/20 px-2.5 py-2.5" key={step}><p className="font-mono text-[7px] text-lime-200/70">{step}</p><p className="mt-1 truncate text-[9px] font-semibold text-slate-200">{title}</p><p className="mt-0.5 text-[8px] text-slate-600">{detail}</p></div>)}
        </div>

        {busy && <div aria-live="polite" className="mt-4 flex items-start gap-3 rounded-xl border border-lime-300/15 bg-lime-300/[.035] p-3"><LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin text-lime-200" /><div><p className="text-[10px] font-medium text-lime-100">{phase === "uploading" ? "Registrazione server-side" : phase === "scanning" ? "Scanner grafico aperto" : "Avvio motore Genius Scan"}</p><p className="mt-1 text-[9px] leading-4 text-slate-500">{notice || "Completa i controlli mostrati sul dispositivo."}</p></div></div>}

        {phase === "error" && <div aria-live="assertive" className="mt-4 rounded-xl border border-amber-300/18 bg-amber-300/[.035] p-3"><div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-200" /><p className="text-[10px] leading-5 text-amber-100/85">{notice}</p></div>{pendingFile && <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-amber-300/10 pt-3"><p className="text-[9px] text-slate-500"><FileText className="mr-1 inline size-3" />{pendingFile.name} · {fileSize(pendingFile.size)}</p><Button className="min-h-9 border-amber-300/20 bg-black/20 text-[9px] text-amber-100" onClick={() => void retryUpload()} type="button" variant="outline"><RefreshCw className="size-3.5" />Riprova registrazione</Button></div>}</div>}

        {phase === "done" && registered && <div aria-live="polite" className="mt-4 rounded-xl border border-lime-300/20 bg-lime-300/[.045] p-4"><div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 size-5 shrink-0 text-lime-200" /><div className="min-w-0"><p className="text-[11px] font-semibold text-lime-100">Acquisizione confermata</p><p className="mt-1 break-all text-[9px] leading-4 text-slate-400">{registered.fileName} · {fileSize(registered.sizeBytes)} · v{registered.version}</p><p className="mt-2 text-[9px] leading-5 text-slate-500">{notice}</p></div></div><Link className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-xl bg-lime-300 px-4 text-[10px] font-semibold text-[#050705]" href={returnHref}><Sparkles className="size-3.5" />Apri documento e analisi</Link></div>}

        {!licenseKey && <p className="mt-4 rounded-xl border border-amber-300/18 bg-amber-300/[.035] p-3 text-[10px] leading-5 text-amber-100/80">Variabile NEXT_PUBLIC_GENIUS_SCAN_LICENSE_KEY non disponibile in questo ambiente. Il caricamento tradizionale resta utilizzabile dal registro.</p>}
        <div className="mt-5 flex items-start gap-2 border-t border-white/[.07] pt-4 text-[9px] leading-5 text-slate-600"><ShieldCheck className="mt-0.5 size-3.5 shrink-0" />La scansione grafica non approva il documento e non crea costi, ricavi, pagamenti o movimenti di magazzino. Questi effetti richiedono servizi e autorizzazioni separati.</div>
      </section>
    </div>
  </main>;
}
