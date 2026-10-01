"use client";

import { useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  LoaderCircle,
  LockKeyhole,
  PenLine,
  Save,
  ShieldCheck,
  Sparkles,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  DEFAULT_INTAKE_DRAFT,
  INTAKE_FIELD_LABELS,
  INTAKE_JOB_TYPES,
  INTAKE_OPENING_TYPES,
  INTAKE_SPECIALIZATIONS,
  type IntakeDraft,
  type IntakePreview,
} from "@/lib/operations-intake";

export type IntakeAdapterRecord = {
  id: string;
  canonicalCode?: string;
  title: string;
  detail: string;
  meta: string;
  status: string;
  progress: number;
  payload?: Record<string, unknown>;
};

export type IntakeCreateResponse = {
  created?: IntakeAdapterRecord;
  records?: IntakeAdapterRecord[];
};

type IntakeMode = "chooser" | "manual" | "company-ai";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (payload: IntakeCreateResponse) => void;
};

type FieldProps = {
  label: string;
  required?: boolean;
  proposed?: boolean;
  children: ReactNode;
  className?: string;
};

function Field({ label, required, proposed, children, className = "" }: FieldProps) {
  return <label className={`block space-y-2 text-xs text-slate-400 ${className}`}><span className="flex items-center gap-2">{label}{required && <span className="text-rose-300">*</span>}{proposed && <span className="rounded border border-cyan-300/25 bg-cyan-300/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-cyan-200">proposto</span>}</span>{children}</label>;
}

const inputClass = "border-white/10 bg-black/30 text-sm text-slate-100 placeholder:text-slate-600 focus-visible:border-lime-300/40";
const selectClass = "h-10 w-full rounded-md border border-white/10 bg-[#111718] px-3 text-sm text-slate-100 outline-none focus:border-lime-300/40";

export function IntakeFields({
  draft,
  onChange,
  proposedKeys,
  statusReadOnly = false,
}: {
  draft: IntakeDraft;
  onChange: (key: keyof IntakeDraft, value: string) => void;
  proposedKeys: Set<keyof IntakeDraft>;
  statusReadOnly?: boolean;
}) {
  const proposed = (key: keyof IntakeDraft) => proposedKeys.has(key);
  return <div className="space-y-4">
    <section className="rounded-xl border border-lime-300/15 bg-lime-300/[0.035] p-4">
      <div className="mb-4 flex items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-lime-300/70">Identità</p><p className="mt-1 text-xs text-slate-500">La commessa viene assegnata al salvataggio.</p></div><span className="rounded-md border border-cyan-300/20 bg-cyan-300/5 px-2 py-1 text-[10px] text-cyan-200">Bozza iniziale</span></div>
      <div className="grid gap-4 sm:grid-cols-[1fr_180px]"><Field label={INTAKE_FIELD_LABELS.title} required proposed={proposed("title")} className="sm:col-span-1"><Input autoFocus className={inputClass} onChange={(event) => onChange("title", event.target.value)} placeholder="Es. Riqualificazione sede Milano" value={draft.title} /></Field><Field label={INTAKE_FIELD_LABELS.statusCode}><select aria-label="Stato commessa" className={`${selectClass} ${statusReadOnly ? "opacity-70" : ""}`} disabled={statusReadOnly} onChange={(event) => onChange("statusCode", event.target.value)} value={draft.statusCode}><option value="DRAFT">Bozza</option><option value="PROPOSED">Proposta</option><option value="APPROVED">Approvata</option><option value="PLANNED">Pianificata</option><option value="ACTIVE">In corso</option><option value="BLOCKED">Bloccata</option><option value="COMPLETED">Completata</option><option value="CLOSED">Chiusa</option><option value="CANCELLED">Annullata</option></select></Field></div>
    </section>

    <section className="rounded-xl border border-lime-300/15 bg-lime-300/[0.035] p-4">
      <div className="mb-4"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-lime-300/70">Classificazione operativa</p><p className="mt-1 text-xs text-slate-500">Questi dati orientano pianificazione, linguaggio tecnico e controlli.</p></div>
      <div className="grid gap-4 sm:grid-cols-3"><Field label={INTAKE_FIELD_LABELS.openingType} required proposed={proposed("openingType")}><select className={selectClass} onChange={(event) => onChange("openingType", event.target.value)} value={draft.openingType}>{INTAKE_OPENING_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field><Field label={INTAKE_FIELD_LABELS.jobType} required proposed={proposed("jobType")}><select className={selectClass} onChange={(event) => onChange("jobType", event.target.value)} value={draft.jobType}>{INTAKE_JOB_TYPES.map((option) => <option key={option} value={option}>{option}</option>)}</select></Field><Field label={INTAKE_FIELD_LABELS.specialization} required proposed={proposed("specialization")}><select className={selectClass} onChange={(event) => onChange("specialization", event.target.value)} value={draft.specialization}>{INTAKE_SPECIALIZATIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></Field></div>
    </section>

    <section className="rounded-xl border border-lime-300/15 bg-lime-300/[0.035] p-4">
      <div className="mb-4"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-lime-300/70">Contesto</p><p className="mt-1 text-xs text-slate-500">Obiettivo, perimetro e informazioni operative essenziali.</p></div>
      <Field label={INTAKE_FIELD_LABELS.description} proposed={proposed("description")}><Textarea className="min-h-[104px] resize-y border-white/10 bg-black/30 text-sm text-slate-100 placeholder:text-slate-600 focus-visible:border-lime-300/40" onChange={(event) => onChange("description", event.target.value)} placeholder="Obiettivo, perimetro e informazioni operative essenziali" value={draft.description} /></Field>
    </section>

    <section className="rounded-xl border border-lime-300/15 bg-lime-300/[0.035] p-4">
      <div className="mb-4"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-lime-300/70">Dati cliente e cantiere <span className="font-normal normal-case tracking-normal text-slate-600">(facoltativi)</span></p><p className="mt-1 text-xs leading-5 text-slate-500">Puoi compilarli ora o completarli dopo. Restano sempre modificabili e non creano automaticamente un’anagrafica cliente.</p></div>
      <div className="grid gap-4 sm:grid-cols-2"><Field label={INTAKE_FIELD_LABELS.clientName} proposed={proposed("clientName")}><Input className={inputClass} onChange={(event) => onChange("clientName", event.target.value)} placeholder="Es. Rossi Costruzioni S.r.l." value={draft.clientName} /></Field><Field label={INTAKE_FIELD_LABELS.clientTaxId} proposed={proposed("clientTaxId")}><Input className={inputClass} onChange={(event) => onChange("clientTaxId", event.target.value)} placeholder="Es. IT01234567890" value={draft.clientTaxId} /></Field><Field label={INTAKE_FIELD_LABELS.clientContact} proposed={proposed("clientContact")}><Input className={inputClass} onChange={(event) => onChange("clientContact", event.target.value)} placeholder="Nome e cognome" value={draft.clientContact} /></Field><Field label={INTAKE_FIELD_LABELS.clientPhone} proposed={proposed("clientPhone")}><Input className={inputClass} onChange={(event) => onChange("clientPhone", event.target.value)} placeholder="Es. +39 02 1234567" value={draft.clientPhone} /></Field><Field label={INTAKE_FIELD_LABELS.clientEmail} proposed={proposed("clientEmail")}><Input className={inputClass} onChange={(event) => onChange("clientEmail", event.target.value)} placeholder="cliente@azienda.it" value={draft.clientEmail} /></Field><Field label={INTAKE_FIELD_LABELS.clientReference} proposed={proposed("clientReference")}><Input className={inputClass} onChange={(event) => onChange("clientReference", event.target.value)} placeholder="Es. PREV-2026-014" value={draft.clientReference} /></Field><Field label={INTAKE_FIELD_LABELS.clientAddress} proposed={proposed("clientAddress")} className="sm:col-span-2"><Input className={inputClass} onChange={(event) => onChange("clientAddress", event.target.value)} placeholder="Indirizzo amministrativo o sede" value={draft.clientAddress} /></Field><Field label={INTAKE_FIELD_LABELS.worksite} proposed={proposed("worksite")} className="sm:col-span-2"><Input className={inputClass} onChange={(event) => onChange("worksite", event.target.value)} placeholder="Indirizzo del cantiere o del sopralluogo" value={draft.worksite} /></Field><Field label={INTAKE_FIELD_LABELS.accessNotes} proposed={proposed("accessNotes")} className="sm:col-span-2"><Textarea className="min-h-[84px] resize-y border-white/10 bg-black/30 text-sm text-slate-100 placeholder:text-slate-600 focus-visible:border-lime-300/40" onChange={(event) => onChange("accessNotes", event.target.value)} placeholder="Orari, referente in loco, chiavi, vincoli di accesso…" value={draft.accessNotes} /></Field><Field label={INTAKE_FIELD_LABELS.cig} proposed={proposed("cig")}><Input className={inputClass} onChange={(event) => onChange("cig", event.target.value)} placeholder="Se applicabile" value={draft.cig} /></Field><Field label={INTAKE_FIELD_LABELS.cup} proposed={proposed("cup")}><Input className={inputClass} onChange={(event) => onChange("cup", event.target.value)} placeholder="Se applicabile" value={draft.cup} /></Field></div>
    </section>

    <section className="grid gap-4 rounded-xl border border-lime-300/15 bg-lime-300/[0.035] p-4 sm:grid-cols-2"><Field label={INTAKE_FIELD_LABELS.dueDate} proposed={proposed("dueDate")}><Input className={inputClass} onChange={(event) => onChange("dueDate", event.target.value)} placeholder="YYYY-MM-DD o da pianificare" value={draft.dueDate} /></Field><Field label={INTAKE_FIELD_LABELS.priority}><select className={selectClass} onChange={(event) => onChange("priority", event.target.value)} value={draft.priority}><option value="STANDARD">Standard</option><option value="HIGH">Alta</option><option value="LOW">Bassa</option></select></Field></section>

    <div className="flex items-start gap-2 rounded-xl border border-amber-300/20 bg-amber-300/[0.06] p-3 text-[11px] leading-5 text-amber-100/80"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-amber-200" /><span>I dati restano modificabili. Il 100% dell’avanzamento non chiude la commessa: la chiusura resta un passaggio separato con controlli, evidenze e rapportino.</span></div>
  </div>;
}

export default function OperationsCommessaIntake({ open, onOpenChange, onCreated }: Props) {
  const [mode, setMode] = useState<IntakeMode>("chooser");
  const [draft, setDraft] = useState<IntakeDraft>(DEFAULT_INTAKE_DRAFT);
  const [sourceText, setSourceText] = useState("");
  const [sourceFileName, setSourceFileName] = useState("");
  const [preview, setPreview] = useState<IntakePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const reset = () => {
    setMode("chooser");
    setDraft(DEFAULT_INTAKE_DRAFT);
    setSourceText("");
    setSourceFileName("");
    setPreview(null);
    setBusy(false);
    setError("");
    setNotice("");
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  };

  const updateField = (key: keyof IntakeDraft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value } as IntakeDraft));
    setError("");
  };

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setSourceFileName(file.name);
    if (file.type.startsWith("text/") || /\.(txt|md|csv|json)$/i.test(file.name)) {
      setSourceText(await file.text());
      setNotice("Testo del documento letto. Avvia la preview Company AI per proporre i campi.");
    } else {
      setNotice("Allegato acquisito. Per la compilazione automatica immediata incolla anche il testo del preventivo.");
    }
    setError("");
  };

  const analyzeWithCompanyAi = async () => {
    if (sourceText.trim().length < 2) {
      setError("Inserisci o incolla il contenuto del preventivo prima di avviare Company AI.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/operations/intake", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceText, sourceName: sourceFileName }),
      });
      const data = await response.json() as IntakePreview & { error?: string };
      if (!response.ok) throw new Error(data.error || "company_ai_preview_failed");
      setPreview(data);
      setDraft((current) => ({ ...current, ...data.draft, statusCode: "DRAFT" } as IntakeDraft));
      setNotice(`Company AI ha proposto ${data.suggestions.length} campi. Verifica e modifica liberamente prima della conferma.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Preview Company AI non disponibile.");
    } finally {
      setBusy(false);
    }
  };

  const createJob = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (draft.title.trim().length < 2) {
      setError("Inserisci il nome della commessa.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/operations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...draft,
          statusCode: draft.statusCode === "PROPOSED" ? "PROPOSED" : "DRAFT",
          client: draft.clientName,
          location: draft.worksite,
          category: draft.jobType,
          sourceMode: mode === "company-ai" ? "COMPANY_AI" : "MANUAL",
          aiPreviewId: preview?.previewId,
          idempotencyKey: `operations-intake-${crypto.randomUUID()}`,
        }),
      });
      const data = await response.json() as IntakeCreateResponse & { error?: string };
      if (!response.ok) throw new Error(data.error || "operations_adapter_write_failed");
      onCreated(data);
      handleOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "La commessa non è stata salvata.");
    } finally {
      setBusy(false);
    }
  };

  const proposedKeys = new Set((preview?.suggestions ?? []).map((suggestion) => suggestion.key));
  return <Dialog open={open} onOpenChange={handleOpenChange}><DialogContent className="max-h-[94vh] overflow-hidden border-lime-300/20 bg-[#0a0d0e] p-0 text-slate-100 sm:max-w-[940px]"><div className="flex max-h-[94vh] flex-col"><DialogHeader className="shrink-0 border-b border-white/10 px-5 py-5 text-left sm:px-7"><div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/70">Nuova commessa</p><DialogTitle className="mt-2 text-xl tracking-[-0.03em] text-slate-50">{mode === "chooser" ? "Come vuoi iniziare?" : mode === "company-ai" ? "Crea da preventivo con Company AI" : "Compila manualmente"}</DialogTitle><DialogDescription className="mt-1 text-xs leading-5 text-slate-500">{mode === "chooser" ? "Scegli il punto di partenza. Entrambi i percorsi producono la stessa anagrafica canonica." : mode === "company-ai" ? "Carica o incolla il preventivo, controlla i dati proposti e conferma la creazione." : "Inserisci anagrafica e classificazione senza allegare un documento."}</DialogDescription></div>{mode !== "chooser" && <button aria-label="Torna alla scelta del percorso" className="grid size-9 shrink-0 place-items-center rounded-lg border border-white/10 bg-black/20 text-slate-400 transition hover:border-lime-300/30 hover:text-lime-200" onClick={() => { setMode("chooser"); setError(""); }} type="button"><ArrowLeft className="size-4" /></button>}</div></DialogHeader>
      {mode === "chooser" ? <div className="overflow-y-auto p-5 sm:p-7"><div className="grid gap-3 md:grid-cols-2"><button className="group rounded-xl border border-lime-300/30 bg-lime-300/[0.07] p-5 text-left transition hover:border-lime-300/60 hover:bg-lime-300/[0.11]" onClick={() => setMode("company-ai")} type="button"><div className="flex items-start gap-4"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-lime-300 text-[#060806]"><Sparkles className="size-5" /></span><span className="min-w-0"><span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-lime-200/75">Assistita da Company AI</span><span className="mt-2 block text-base font-semibold text-slate-50">Crea da preventivo</span><span className="mt-2 block text-xs leading-5 text-slate-400">Carica o incolla l’originale, controlla i dati proposti e conferma la creazione.</span></span><ChevronRight className="mt-1 size-4 shrink-0 text-lime-200 transition group-hover:translate-x-0.5" /></div></button><button className="group rounded-xl border border-white/10 bg-black/20 p-5 text-left transition hover:border-lime-300/35 hover:bg-white/[0.04]" onClick={() => setMode("manual")} type="button"><div className="flex items-start gap-4"><span className="grid size-11 shrink-0 place-items-center rounded-xl border border-white/15 bg-black/25 text-slate-300"><PenLine className="size-5" /></span><span className="min-w-0"><span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Inserimento diretto</span><span className="mt-2 block text-base font-semibold text-slate-100">Compila manualmente</span><span className="mt-2 block text-xs leading-5 text-slate-500">Inserisci anagrafica e classificazione senza allegare un documento.</span></span><ChevronRight className="mt-1 size-4 shrink-0 text-slate-500 transition group-hover:translate-x-0.5" /></div></button></div><div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-300/20 bg-amber-300/[0.06] p-3 text-[11px] leading-5 text-amber-100/80"><LockKeyhole className="mt-0.5 size-4 shrink-0 text-amber-200" /><span>La commessa nasce solo dopo la tua conferma finale. Il percorso Company AI crea una proposta controllabile, non una scrittura automatica.</span></div><section className="carbon-card mt-5 rounded-xl p-4"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-200"><Sparkles className="size-4" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200/70">Contesto assistito</p><p className="mt-1 text-sm font-semibold text-slate-100">Company AI · Commesse</p></div></div><div className="mt-4 space-y-2 text-xs"><div className="flex items-center gap-3 border-b border-white/[0.08] pb-3"><span className="size-2 rounded-full border border-slate-600" /><span className="text-slate-300">Anagrafica</span><span className="ml-auto text-[10px] text-slate-600">In attesa del fascicolo</span></div><div className="flex items-center gap-3 border-b border-white/[0.08] pb-3"><span className="size-2 rounded-full bg-lime-300 shadow-[0_0_8px_rgba(190,255,60,0.7)]" /><span className="text-slate-300">Scope operativo</span><span className="ml-auto text-[10px] text-lime-200">Classificazione disponibile</span></div><div className="flex items-start gap-3 rounded-lg border border-white/10 bg-black/20 p-3 text-[11px] leading-5 text-slate-500"><LockKeyhole className="mt-0.5 size-3.5 shrink-0 text-slate-600" />Confine operativo: Company AI legge solo il contenuto mostrato e non genera analisi, preventivi o modifiche implicite.</div></div></section></div> : <form className="flex min-h-0 flex-1 flex-col" onSubmit={createJob}><div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-7">{mode === "company-ai" && <section className="mb-4 rounded-xl border border-cyan-300/20 bg-cyan-300/[0.045] p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-xl border border-cyan-300/25 bg-cyan-300/10 text-cyan-200"><Sparkles className="size-4" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200/75">Company AI · preview governata</p><p className="mt-1 text-sm font-semibold text-slate-100">Leggi il preventivo e prepara la scheda</p><p className="mt-1 text-xs leading-5 text-slate-500">Solo proposta: nulla viene creato finché non confermi in fondo.</p></div></div>{preview && <span className="rounded-full border border-lime-300/20 bg-lime-300/10 px-2.5 py-1 text-[10px] font-semibold text-lime-200">{preview.suggestions.length} campi proposti</span>}</div><Textarea className="mt-4 min-h-[120px] border-white/10 bg-black/30 text-sm text-slate-100 placeholder:text-slate-600 focus-visible:border-cyan-300/40" onChange={(event) => setSourceText(event.target.value)} placeholder="Incolla qui il testo del preventivo: cliente, oggetto, indirizzo, lavorazioni, riferimenti…" value={sourceText} /><div className="mt-3 flex flex-wrap items-center gap-2"><label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-300 transition hover:border-cyan-300/30 hover:text-cyan-100"><Upload className="size-3.5" />{sourceFileName || "Carica originale"}<input accept=".txt,.md,.csv,.json,application/pdf,image/*" className="sr-only" onChange={(event) => void handleFile(event)} type="file" /></label><Button className="bg-cyan-300 text-[#061012] hover:bg-cyan-200" disabled={busy} onClick={() => void analyzeWithCompanyAi()} type="button">{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}Analizza con Company AI</Button>{notice && <span className="text-[11px] text-cyan-100/75">{notice}</span>}</div>{preview && <div className="mt-4 grid gap-2 sm:grid-cols-2">{preview.suggestions.map((suggestion) => <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2" key={suggestion.key}><div className="flex items-center justify-between gap-2"><span className="text-[10px] text-slate-500">{suggestion.label}</span><span className="font-mono text-[9px] text-cyan-200">{Math.round(suggestion.confidence * 100)}%</span></div><p className="mt-1 truncate text-xs text-slate-200">{suggestion.value}</p></div>)}</div>}</section>}
          <IntakeFields draft={draft} onChange={updateField} proposedKeys={proposedKeys} />
          {error && <p className="mt-4 rounded-lg border border-rose-300/25 bg-rose-300/[0.06] px-3 py-2 text-xs leading-5 text-rose-100">{error}</p>}
        </div><div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-white/10 bg-[#111716] px-5 py-4 sm:px-7"><div className="flex items-center gap-2 text-[10px] text-slate-500"><ShieldCheck className="size-3.5 text-lime-300" />{mode === "company-ai" ? "Proposta Company AI verificabile · conferma umana richiesta" : "Inserimento manuale · conferma umana richiesta"}</div><div className="flex items-center gap-2"><Button className="border-white/10 bg-transparent text-slate-400 hover:bg-white/10 hover:text-white" onClick={() => handleOpenChange(false)} type="button" variant="outline">Annulla</Button><Button className="bg-lime-300 text-[#060806] hover:bg-lime-200" disabled={busy} type="submit">{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : mode === "company-ai" ? <Check className="size-3.5" /> : <Save className="size-3.5" />}{mode === "company-ai" ? "Conferma dati e crea commessa" : "Salva commessa in bozza"}</Button></div></div></form>}
    </div></DialogContent></Dialog>;
}
