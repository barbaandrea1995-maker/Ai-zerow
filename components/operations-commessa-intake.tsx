"use client";

import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import {
  Check,
  CircleCheck,
  BookOpen,
  ClipboardCheck,
  Flag,
  FolderKanban,
  LoaderCircle,
  LockKeyhole,
  MapPin,
  PenLine,
  Save,
  ShieldCheck,
  Sparkles,
  Upload,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogHeader } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { unzipSync } from "fflate";
import {
  DEFAULT_INTAKE_DRAFT,
  INTAKE_FIELD_LABELS,
  INTAKE_OPENING_TYPES,
  type IntakeDraft,
  type IntakePreview,
} from "@/lib/operations-intake";
import { COMPANY_AI_SCOPE_TAXONOMY, resolveCompanyAiScopeSelection } from "@/lib/company-ai-scope";

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

const MAX_SOURCE_FILE_BYTES = 20 * 1024 * 1024;
const MAX_SOURCE_TEXT_CHARS = 60_000;

function isDocxFile(file: File) {
  return file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || /\.docx$/i.test(file.name);
}

function limitSourceText(value: string) {
  const normalized = value.replace(/\u0000/g, "").replace(/\r\n?/g, "\n").trim();
  return normalized.slice(0, MAX_SOURCE_TEXT_CHARS);
}

async function extractDocxText(file: File) {
  const archive = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const documentXml = archive["word/document.xml"];
  if (!documentXml) throw new Error("Il documento Word non contiene una scheda leggibile.");

  const xml = new TextDecoder().decode(documentXml);
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.querySelector("parsererror")) throw new Error("Il documento Word non è leggibile.");

  const paragraphs = Array.from(document.getElementsByTagNameNS("*", "p")).map((paragraph) => {
    const parts = Array.from(paragraph.getElementsByTagNameNS("*", "t"), (node) => node.textContent ?? "");
    return parts.join("").trim();
  }).filter(Boolean);

  return limitSourceText(paragraphs.join("\n"));
}

type FieldProps = {
  label: string;
  required?: boolean;
  proposed?: boolean;
  children: ReactNode;
  className?: string;
};

function Field({ label, required, proposed, children, className = "" }: FieldProps) {
  return (
    <label className={`group block space-y-2 text-xs text-slate-400 ${className}`}>
      <span className="flex min-h-4 items-center gap-2 font-medium tracking-[0.01em] text-lime-100/75">
        {label}
        {required && <span className="text-lime-300">*</span>}
        {proposed && (
          <span className="rounded-full border border-cyan-300/25 bg-cyan-300/[0.08] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-cyan-200">
            proposto
          </span>
        )}
      </span>
      {children}
    </label>
  );
}

type SectionProps = {
  eyebrow: string;
  title: string;
  description: string;
  icon: LucideIcon;
  badge?: ReactNode;
  children: ReactNode;
};

function FormSection({ eyebrow, title, description, icon: Icon, badge, children }: SectionProps) {
  return (
    <section className="relative overflow-hidden rounded-[22px] border border-white/[0.09] bg-[linear-gradient(145deg,rgba(20,29,28,0.96),rgba(8,13,14,0.92)_62%,rgba(16,28,20,0.84))] p-4 shadow-[0_22px_54px_rgba(0,0,0,0.22)] backdrop-blur-xl sm:p-5">
      <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-lime-300/70 to-transparent" />
      <div className="pointer-events-none absolute -right-16 -top-20 size-44 rounded-full bg-lime-300/[0.04] blur-3xl" />
      <div className="relative mb-5 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-2xl border border-lime-300/25 bg-[linear-gradient(145deg,rgba(190,255,60,0.16),rgba(190,255,60,0.03))] text-lime-200 shadow-[0_0_24px_rgba(190,255,60,0.08)]">
            <Icon className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/80">{eyebrow}</p>
            <h3 className="mt-1 text-[15px] font-semibold tracking-[-0.015em] text-lime-100">{title}</h3>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">{description}</p>
          </div>
        </div>
        {badge}
      </div>
      {children}
    </section>
  );
}

const inputClass = "h-12 rounded-xl border-white/[0.12] bg-black/25 text-[16px] text-slate-100 placeholder:text-slate-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] transition hover:border-lime-300/25 focus-visible:border-lime-300/60 focus-visible:ring-2 focus-visible:ring-lime-300/15 focus-visible:shadow-[0_0_22px_rgba(190,255,60,0.07)] sm:text-sm";
const selectClass = "h-12 w-full rounded-xl border border-white/[0.12] bg-[linear-gradient(180deg,rgba(18,27,27,0.96),rgba(7,12,13,0.94))] px-3 text-[16px] text-slate-100 outline-none transition hover:border-lime-300/25 focus:border-lime-300/60 focus:ring-2 focus:ring-lime-300/15 disabled:cursor-not-allowed disabled:opacity-45 sm:text-sm";
const textareaClass = "resize-y rounded-xl border-white/[0.12] bg-black/25 text-[16px] text-slate-100 placeholder:text-slate-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] transition hover:border-lime-300/25 focus-visible:border-lime-300/60 focus-visible:ring-2 focus-visible:ring-lime-300/15 focus-visible:shadow-[0_0_22px_rgba(190,255,60,0.07)] sm:text-sm";

function ScopeSelectFields({
  draft,
  onChange,
  proposed,
}: {
  draft: IntakeDraft;
  onChange: (key: keyof IntakeDraft, value: string) => void;
  proposed: (key: keyof IntakeDraft) => boolean;
}) {
  const section = COMPANY_AI_SCOPE_TAXONOMY.find((item) => item.id === draft.scopeSectionId);
  const group = section?.groups.find((item) => item.id === draft.scopeGroupId);
  return <>
    <Field label={INTAKE_FIELD_LABELS.scopeSectionId} required proposed={proposed("scopeSectionId")}>
      <select className={selectClass} onChange={(event) => {
        onChange("scopeSectionId", event.target.value);
        onChange("scopeGroupId", "");
        onChange("scopeSubgroupId", "");
      }} required value={draft.scopeSectionId}>
        <option value="">Seleziona sezione</option>
        {COMPANY_AI_SCOPE_TAXONOMY.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
      </select>
    </Field>
    <Field label={INTAKE_FIELD_LABELS.scopeGroupId} required proposed={proposed("scopeGroupId")}>
      <select className={selectClass} disabled={!section} onChange={(event) => {
        onChange("scopeGroupId", event.target.value);
        onChange("scopeSubgroupId", "");
      }} required value={draft.scopeGroupId}>
        <option value="">Seleziona raggruppamento</option>
        {section?.groups.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
      </select>
    </Field>
    <Field className="md:col-span-3" label={INTAKE_FIELD_LABELS.scopeSubgroupId} required proposed={proposed("scopeSubgroupId")}>
      <select className={selectClass} disabled={!group} onChange={(event) => onChange("scopeSubgroupId", event.target.value)} required value={draft.scopeSubgroupId}>
        <option value="">Seleziona sottogruppo</option>
        {group?.subgroups.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
      </select>
    </Field>
  </>;
}

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

  return (
    <div className="space-y-4">
      <FormSection
        badge={<span className="rounded-full border border-cyan-300/20 bg-cyan-300/[0.07] px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-cyan-200">Bozza iniziale</span>}
        description="Il codice canonico viene assegnato al salvataggio e resta tracciato nella scheda."
        eyebrow="01 / identità"
        icon={FolderKanban}
        title="Dati principali"
      >
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_190px]">
          <Field label={INTAKE_FIELD_LABELS.title} required proposed={proposed("title")}>
            <Input className={inputClass} onChange={(event) => onChange("title", event.target.value)} placeholder="Es. Riqualificazione sede Milano" value={draft.title} />
          </Field>
          <Field label={INTAKE_FIELD_LABELS.statusCode}>
            <select aria-label="Stato commessa" className={`${selectClass} ${statusReadOnly ? "opacity-70" : ""}`} disabled={statusReadOnly} onChange={(event) => onChange("statusCode", event.target.value)} value={draft.statusCode}>
              <option value="DRAFT">Bozza</option>
              <option value="PROPOSED">Proposta</option>
              <option value="APPROVED">Approvata</option>
              <option value="PLANNED">Pianificata</option>
              <option value="ACTIVE">In corso</option>
              <option value="BLOCKED">Bloccata</option>
              <option value="COMPLETED">Completata</option>
              <option value="CLOSED">Chiusa</option>
              <option value="CANCELLED">Annullata</option>
            </select>
          </Field>
        </div>
      </FormSection>

      <FormSection
        description="La classificazione segue una gerarchia unica e si ferma al sottogruppo."
        eyebrow="02 / classificazione"
        icon={Flag}
        title="Profilo operativo"
      >
        <div className="grid gap-4 md:grid-cols-3">
          <Field label={INTAKE_FIELD_LABELS.openingType} required proposed={proposed("openingType")}>
            <select className={selectClass} onChange={(event) => onChange("openingType", event.target.value)} required value={draft.openingType}>
              {INTAKE_OPENING_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </Field>
          <ScopeSelectFields draft={draft} onChange={onChange} proposed={proposed} />
        </div>
        <p className="mt-4 rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2.5 text-[10px] leading-4 text-slate-500">Le voci puntuali della tariffa restano nel contesto Company AI e non diventano categorie della commessa.</p>
      </FormSection>

      <FormSection
        description="Obiettivo, perimetro e informazioni operative essenziali per il primo passaggio."
        eyebrow="03 / contesto"
        icon={ClipboardCheck}
        title="Descrizione della commessa"
      >
        <Field label={INTAKE_FIELD_LABELS.description} proposed={proposed("description")}>
          <Textarea className={`${textareaClass} min-h-[118px]`} onChange={(event) => onChange("description", event.target.value)} placeholder="Obiettivo, perimetro e informazioni operative essenziali" value={draft.description} />
        </Field>
      </FormSection>

      <FormSection
        badge={<span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500">Facoltativi</span>}
        description="Puoi compilarli ora o completarli dopo. Non viene creata automaticamente un’anagrafica cliente."
        eyebrow="04 / anagrafiche"
        icon={UserRound}
        title="Cliente e cantiere"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={INTAKE_FIELD_LABELS.clientName} proposed={proposed("clientName")}>
            <Input className={inputClass} onChange={(event) => onChange("clientName", event.target.value)} placeholder="Es. Rossi Costruzioni S.r.l." value={draft.clientName} />
          </Field>
          <Field label={INTAKE_FIELD_LABELS.clientTaxId} proposed={proposed("clientTaxId")}>
            <Input className={inputClass} onChange={(event) => onChange("clientTaxId", event.target.value)} placeholder="Es. IT01234567890" value={draft.clientTaxId} />
          </Field>
          <Field label={INTAKE_FIELD_LABELS.clientContact} proposed={proposed("clientContact")}>
            <Input className={inputClass} onChange={(event) => onChange("clientContact", event.target.value)} placeholder="Nome e cognome" value={draft.clientContact} />
          </Field>
          <Field label={INTAKE_FIELD_LABELS.clientPhone} proposed={proposed("clientPhone")}>
            <Input className={inputClass} onChange={(event) => onChange("clientPhone", event.target.value)} placeholder="Es. +39 02 1234567" value={draft.clientPhone} />
          </Field>
          <Field label={INTAKE_FIELD_LABELS.clientEmail} proposed={proposed("clientEmail")}>
            <Input className={inputClass} onChange={(event) => onChange("clientEmail", event.target.value)} placeholder="cliente@azienda.it" value={draft.clientEmail} />
          </Field>
          <Field label={INTAKE_FIELD_LABELS.clientReference} proposed={proposed("clientReference")}>
            <Input className={inputClass} onChange={(event) => onChange("clientReference", event.target.value)} placeholder="Es. PREV-2026-014" value={draft.clientReference} />
          </Field>
          <Field className="md:col-span-2" label={INTAKE_FIELD_LABELS.clientAddress} proposed={proposed("clientAddress")}>
            <Input className={inputClass} onChange={(event) => onChange("clientAddress", event.target.value)} placeholder="Indirizzo amministrativo o sede" value={draft.clientAddress} />
          </Field>
          <Field className="md:col-span-2" label={INTAKE_FIELD_LABELS.worksite} proposed={proposed("worksite")}>
            <Input className={inputClass} onChange={(event) => onChange("worksite", event.target.value)} placeholder="Indirizzo del cantiere o del sopralluogo" value={draft.worksite} />
          </Field>
          <Field className="md:col-span-2" label={INTAKE_FIELD_LABELS.accessNotes} proposed={proposed("accessNotes")}>
            <Textarea className={`${textareaClass} min-h-[88px]`} onChange={(event) => onChange("accessNotes", event.target.value)} placeholder="Orari, referente in loco, chiavi, vincoli di accesso…" value={draft.accessNotes} />
          </Field>
          <Field label={INTAKE_FIELD_LABELS.cig} proposed={proposed("cig")}>
            <Input className={inputClass} onChange={(event) => onChange("cig", event.target.value)} placeholder="Se applicabile" value={draft.cig} />
          </Field>
          <Field label={INTAKE_FIELD_LABELS.cup} proposed={proposed("cup")}>
            <Input className={inputClass} onChange={(event) => onChange("cup", event.target.value)} placeholder="Se applicabile" value={draft.cup} />
          </Field>
        </div>
      </FormSection>

      <FormSection
        description="La scadenza è un riferimento operativo: la pianificazione completa resta un passaggio dedicato."
        eyebrow="05 / pianificazione"
        icon={MapPin}
        title="Priorità e scadenza"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={INTAKE_FIELD_LABELS.dueDate} proposed={proposed("dueDate")}>
            <Input className={inputClass} onChange={(event) => onChange("dueDate", event.target.value)} placeholder="YYYY-MM-DD o da pianificare" value={draft.dueDate} />
          </Field>
          <Field label={INTAKE_FIELD_LABELS.priority}>
            <select className={selectClass} onChange={(event) => onChange("priority", event.target.value)} value={draft.priority}>
              <option value="STANDARD">Standard</option>
              <option value="HIGH">Alta</option>
              <option value="LOW">Bassa</option>
            </select>
          </Field>
        </div>
      </FormSection>

      <div className="flex items-start gap-3 rounded-2xl border border-amber-300/20 bg-amber-300/[0.055] p-4 text-[11px] leading-5 text-amber-100/80">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-amber-200" />
        <span><strong className="font-semibold text-amber-100">Controllo di ciclo di vita.</strong> I dati restano modificabili. Il 100% dell’avanzamento non chiude la commessa: la chiusura resta un passaggio separato con controlli, evidenze e rapportino.</span>
      </div>
    </div>
  );
}

type CompanyAiPanelProps = {
  sourceText: string;
  sourceFileName: string;
  preview: IntakePreview | null;
  busy: boolean;
  notice: string;
  onSourceTextChange: (value: string) => void;
  onFile: (event: ChangeEvent<HTMLInputElement>) => void;
  onAnalyze: () => void;
};

function CompanyAiPanel({ sourceText, sourceFileName, preview, busy, notice, onSourceTextChange, onFile, onAnalyze }: CompanyAiPanelProps) {
  return (
    <section className="relative mx-4 mt-4 overflow-hidden rounded-[24px] border border-cyan-300/20 bg-[linear-gradient(135deg,rgba(34,211,238,0.1),rgba(8,15,16,0.88)_48%,rgba(190,255,60,0.06))] p-4 shadow-[0_24px_60px_rgba(0,0,0,0.24)] backdrop-blur-xl sm:mx-8 sm:mt-7 sm:p-6">
      <div className="pointer-events-none absolute -right-20 -top-24 size-64 rounded-full bg-cyan-300/[0.08] blur-3xl" /><div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/70 to-transparent" />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl border border-cyan-300/25 bg-cyan-300/10 text-cyan-200 shadow-[0_0_28px_rgba(34,211,238,0.15)]"><Sparkles className="size-4" /></span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-200/85">Company AI · preview governata</p><span className="rounded-full border border-cyan-300/20 bg-cyan-300/[0.08] px-2.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-cyan-100/80">preview only</span></div>
            <h2 className="mt-1 text-lg font-semibold tracking-[-0.025em] text-lime-100">Dal preventivo alla scheda operativa</h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">Company AI propone i campi leggendo solo il contenuto che mostri. Tu controlli, correggi e confermi prima di creare la commessa.</p>
          </div>
        </div>
        {preview && <span className="rounded-full border border-lime-300/25 bg-lime-300/[0.09] px-3 py-1.5 text-[10px] font-semibold text-lime-200">{preview.suggestions.length} campi proposti</span>}
      </div>

      <div className="relative mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_235px]">
        <div>
          <label className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/80" htmlFor="commessa-source-text">Testo sorgente del preventivo</label>
          <Textarea className={`${textareaClass} min-h-[126px] rounded-[18px] border-cyan-300/20 bg-[linear-gradient(145deg,rgba(5,20,22,0.72),rgba(3,10,11,0.82))] focus-visible:border-cyan-200/70 focus-visible:ring-cyan-300/15 focus-visible:shadow-[0_0_28px_rgba(34,211,238,0.1)]`} id="commessa-source-text" onChange={(event) => onSourceTextChange(event.target.value)} placeholder="Incolla qui cliente, oggetto, indirizzo, lavorazioni, riferimenti e note del preventivo…" value={sourceText} />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="inline-flex min-w-0 max-w-full cursor-pointer items-center gap-2 rounded-xl border border-white/[0.11] bg-black/25 px-3 py-2.5 text-xs text-slate-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition hover:border-cyan-300/40 hover:bg-cyan-300/[0.06] hover:text-cyan-100"><Upload className="size-3.5 shrink-0 text-cyan-200" /><span className="truncate">{sourceFileName || "Carica originale · max 20 MB"}</span><input accept=".docx,.txt,.md,.csv,.json,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf,image/*" className="sr-only" onChange={onFile} type="file" /></label>
            <Button aria-busy={busy} className="h-11 rounded-xl bg-[linear-gradient(135deg,#bfff3c,#8bdc48)] px-4 font-semibold text-[#061012] shadow-[0_0_24px_rgba(190,255,60,0.17)] transition hover:-translate-y-0.5 hover:bg-[linear-gradient(135deg,#d3ff6d,#a4ec57)] hover:shadow-[0_0_30px_rgba(190,255,60,0.28)] disabled:cursor-not-allowed disabled:opacity-50" disabled={busy || sourceText.trim().length < 2} onClick={onAnalyze} type="button">{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}Analizza con Company AI</Button>
          </div>
          <p className="mt-3 text-[10px] leading-4 text-slate-600">Formati supportati: DOCX, TXT, MD, CSV e JSON · dimensione massima 20 MB. PDF e immagini restano allegabili, ma richiedono testo incollato per l’analisi.</p>
          {notice && <p className="mt-3 rounded-xl border border-cyan-300/15 bg-cyan-300/[0.04] px-3 py-2.5 text-[11px] leading-5 text-cyan-100/75">{notice}</p>}
        </div>

        <div className="rounded-[20px] border border-cyan-300/15 bg-[linear-gradient(160deg,rgba(5,25,27,0.72),rgba(4,11,13,0.78))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
          <div className="flex items-center justify-between gap-3"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/75">Guardrail attivi</p><LockKeyhole className="size-3.5 text-cyan-200/80" /></div>
          <div className="mt-4 space-y-3"><div className="flex items-start gap-2.5"><CircleCheck className="mt-0.5 size-3.5 shrink-0 text-lime-300" /><span className="text-[11px] leading-4 text-slate-400">Solo proposta, nessuna scrittura diretta</span></div><div className="flex items-start gap-2.5"><CircleCheck className="mt-0.5 size-3.5 shrink-0 text-lime-300" /><span className="text-[11px] leading-4 text-slate-400">Modifica manuale sempre disponibile</span></div><div className="flex items-start gap-2.5"><CircleCheck className="mt-0.5 size-3.5 shrink-0 text-lime-300" /><span className="text-[11px] leading-4 text-slate-400">Conferma umana prima del salvataggio</span></div></div>
        </div>
      </div>

      {preview && (
        <div className="relative mt-6 border-t border-cyan-300/15 pt-5">
          <div className="flex flex-wrap items-end justify-between gap-2"><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/80">Risultato della preview</p><p className="mt-1 text-xs text-slate-500">Ogni proposta resta visibile e modificabile nella scheda sottostante.</p></div><span className="rounded-full border border-white/[0.08] bg-black/20 px-2.5 py-1 font-mono text-[10px] text-slate-600">{preview.previewId}</span></div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {preview.suggestions.map((suggestion) => (
              <div className="rounded-2xl border border-white/[0.08] bg-[linear-gradient(145deg,rgba(255,255,255,0.045),rgba(0,0,0,0.22))] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]" key={suggestion.key}>
                <div className="flex items-center justify-between gap-3"><span className="truncate text-[10px] font-medium text-slate-500">{suggestion.label}</span><span className="shrink-0 rounded-full border border-cyan-300/20 bg-cyan-300/[0.06] px-2 py-0.5 font-mono text-[9px] text-cyan-200">{Math.round(suggestion.confidence * 100)}%</span></div>
                <p className="mt-2 truncate text-xs text-lime-100/90">{suggestion.value || "Non rilevato"}</p>
                <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/[0.08]"><span className="block h-full rounded-full bg-gradient-to-r from-cyan-300 to-lime-300 shadow-[0_0_10px_rgba(34,211,238,0.35)]" style={{ width: `${Math.round(suggestion.confidence * 100)}%` }} /></div>
                <p className="mt-2 truncate text-[9px] uppercase tracking-[0.1em] text-slate-600">Fonte: {suggestion.source}</p>
              </div>
            ))}
          </div>
          {preview.knowledgePack && (
            <div className="relative mt-5 overflow-hidden rounded-[22px] border border-lime-300/20 bg-[linear-gradient(145deg,rgba(190,255,60,0.08),rgba(6,16,13,0.68)_52%,rgba(34,211,238,0.04))] p-4 shadow-[0_18px_45px_rgba(0,0,0,0.18)]">
              <div className="pointer-events-none absolute -right-12 -top-14 size-40 rounded-full bg-lime-300/[0.08] blur-3xl" />
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="relative flex items-start gap-3"><span className="grid size-9 place-items-center rounded-xl border border-lime-300/25 bg-lime-300/[0.1] text-lime-200"><BookOpen className="size-4" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-lime-200/80">Knowledge pack attivo</p><p className="mt-1 text-sm font-semibold text-lime-100">{preview.knowledgePack.name}</p><p className="mt-1 text-[10px] leading-4 text-slate-500">v{preview.knowledgePack.version} · {preview.knowledgePack.entryCount.toLocaleString("it-IT")} voci · riferimento tecnico</p></div></div>
                <span className="rounded-full border border-amber-300/20 bg-amber-300/[0.06] px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-amber-100/80">da confermare</span>
              </div>
              {preview.scopeSuggestion?.selection ? <div className="relative mt-4 rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.055] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]"><div className="flex items-center justify-between gap-3"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-100/85">Scope proposto · fino al sottogruppo</p><span className="rounded-full border border-cyan-300/20 bg-cyan-300/[0.08] px-2 py-0.5 font-mono text-[10px] text-cyan-100">{Math.round(preview.scopeSuggestion.score * 100)}%</span></div><p className="mt-2 text-xs font-semibold text-lime-100">{preview.scopeSuggestion.selection.sectionTitle}</p><p className="mt-1 text-[11px] text-slate-400">{preview.scopeSuggestion.selection.groupTitle} <span className="text-slate-600">/</span> {preview.scopeSuggestion.selection.subgroupTitle}</p></div> : <p className="mt-4 rounded-2xl border border-dashed border-white/10 px-3 py-4 text-center text-[11px] text-slate-500">Nessun sottogruppo proposto dal testo. Selezionalo manualmente nella scheda.</p>}
              {preview.knowledgeHints?.length ? <div className="relative mt-4"><p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-lime-100/55">Contesto tecnico · non parte dello scope</p><div className="grid gap-2 md:grid-cols-2">{preview.knowledgeHints.map((hint) => <div className="rounded-2xl border border-white/[0.08] bg-black/25 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]" key={hint.id}><div className="flex items-center justify-between gap-3"><span className="font-mono text-[10px] text-lime-200">{hint.part} · {hint.code}</span><span className="text-[10px] text-slate-500">{hint.unit || "unità da verificare"}</span></div><p className="mt-2 line-clamp-2 text-[11px] leading-5 text-slate-300">{hint.description}</p><div className="mt-2 flex items-center justify-between gap-3 text-[9px] text-slate-600"><span className="truncate">{hint.partTitle}</span><span className="shrink-0 font-mono text-cyan-200/80">{new Intl.NumberFormat("it-IT", { style: "currency", currency: hint.currency }).format(hint.price)}</span></div></div>)}</div></div> : null}
              <p className="relative mt-4 flex items-start gap-2 rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2.5 text-[10px] leading-4 text-slate-500"><ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-lime-200/70" />Il pack aiuta Company AI a comprendere la lavorazione; non genera quantità, prezzo di vendita, ordine o chiusura della commessa.</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function CheckRow({ label, detail, complete }: { label: string; detail: string; complete: boolean }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border ${complete ? "border-lime-300/40 bg-lime-300/10 text-lime-200" : "border-white/15 text-slate-600"}`}>{complete ? <Check className="size-2.5" /> : <span className="size-1 rounded-full bg-current" />}</span>
      <div className="min-w-0"><p className={`text-[11px] ${complete ? "text-slate-300" : "text-slate-500"}`}>{label}</p><p className="mt-0.5 text-[10px] leading-4 text-slate-600">{detail}</p></div>
    </div>
  );
}

function SummaryRail({ draft, mode, preview }: { draft: IntakeDraft; mode: IntakeMode; preview: IntakePreview | null }) {
  const selectedSection = COMPANY_AI_SCOPE_TAXONOMY.find((item) => item.id === draft.scopeSectionId);
  const selectedGroup = selectedSection?.groups.find((item) => item.id === draft.scopeGroupId);
  const selectedSubgroup = selectedGroup?.subgroups.find((item) => item.id === draft.scopeSubgroupId);
  const keyFields = [
    { label: "Nome commessa", value: draft.title.trim(), fallback: "Da inserire" },
    { label: "Tipo commessa", value: draft.openingType, fallback: "Da scegliere" },
    { label: "Scope", value: selectedSubgroup ? `${selectedSection?.title} / ${selectedGroup?.title} / ${selectedSubgroup.title}` : "", fallback: "Da definire fino al sottogruppo" },
    { label: "Cliente", value: draft.clientName.trim(), fallback: "Non ancora indicato" },
    { label: "Luogo intervento", value: draft.worksite.trim(), fallback: "Non ancora indicato" },
    { label: "Scadenza", value: draft.dueDate.trim(), fallback: "Da pianificare" },
  ];
  const filledCount = keyFields.filter((field) => Boolean(field.value)).length;
  const progress = Math.round((filledCount / keyFields.length) * 100);
  const sourceLabel = mode === "company-ai" ? "Company AI" : "Manuale";
  const sourceReady = mode === "manual" || Boolean(preview);

  return (
    <aside className="lg:sticky lg:top-0 lg:self-start">
      <div className="relative overflow-hidden rounded-[24px] border border-lime-300/15 bg-[linear-gradient(160deg,rgba(20,31,28,0.96),rgba(7,12,13,0.94)_62%,rgba(12,24,19,0.9))] p-4 shadow-[0_24px_58px_rgba(0,0,0,0.24)] backdrop-blur-xl sm:p-5">
        <div className="pointer-events-none absolute -right-16 -top-16 size-44 rounded-full bg-lime-300/[0.07] blur-3xl" />
        <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-lime-300/60 to-transparent" />
        <div className="relative flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/80">Live summary</p><h2 className="mt-1 text-[15px] font-semibold tracking-[-0.015em] text-lime-100">Commessa in preparazione</h2></div><span className="grid size-10 place-items-center rounded-2xl border border-lime-300/25 bg-[linear-gradient(145deg,rgba(190,255,60,0.16),rgba(190,255,60,0.03))] text-lime-200 shadow-[0_0_22px_rgba(190,255,60,0.08)]"><ClipboardCheck className="size-4" /></span></div>
        <div className="relative mt-5 rounded-2xl border border-lime-300/15 bg-[linear-gradient(145deg,rgba(190,255,60,0.07),rgba(0,0,0,0.2))] p-3.5"><div className="flex items-center justify-between gap-3"><span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-lime-100/65">Dati chiave</span><span className="rounded-full border border-lime-300/20 bg-lime-300/[0.07] px-2 py-0.5 font-mono text-[10px] text-lime-200">{filledCount}/{keyFields.length}</span></div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.08]"><span className="block h-full rounded-full bg-gradient-to-r from-lime-300 to-cyan-300 shadow-[0_0_12px_rgba(190,255,60,0.32)] transition-all" style={{ width: `${progress}%` }} /></div><p className="mt-2 text-[10px] leading-4 text-slate-500">La classificazione si completa selezionando il sottogruppo.</p></div>
        <div className="relative mt-5 space-y-3 rounded-2xl border border-white/[0.07] bg-black/15 p-3.5">{keyFields.map((field) => <div className="flex items-start justify-between gap-3 border-b border-white/[0.06] pb-3 last:border-0 last:pb-0" key={field.label}><span className="text-[10px] text-slate-600">{field.label}</span><span className={`max-w-[58%] truncate text-right text-[11px] ${field.value ? "text-lime-100/85" : "text-slate-600"}`}>{field.value || field.fallback}</span></div>)}</div>
        <div className="relative mt-5 rounded-2xl border border-cyan-300/15 bg-[linear-gradient(145deg,rgba(34,211,238,0.055),rgba(0,0,0,0.2))] p-3.5"><p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-cyan-100/70">Controlli prima del salvataggio</p><div className="mt-4 space-y-3.5"><CheckRow complete label="Stato iniziale: Bozza" detail="La commessa non viene chiusa automaticamente" /><CheckRow complete={sourceReady} label={`Percorso: ${sourceLabel}`} detail={sourceReady ? "Origine registrata nella scheda" : "Avvia la preview per continuare"} /><CheckRow complete={Boolean(draft.title.trim())} label="Nome commessa" detail={draft.title.trim() ? "Dato pronto per la conferma" : "Campo richiesto"} /><CheckRow complete={Boolean(selectedSubgroup)} label="Scope fino al sottogruppo" detail={selectedSubgroup ? "Classificazione pronta" : "Seleziona sezione, raggruppamento e sottogruppo"} /><CheckRow complete label="Conferma umana" detail="Ultimo controllo prima della scrittura" /></div></div>
        <div className="relative mt-4 flex items-start gap-2 rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.045] p-3 text-[10px] leading-4 text-cyan-100/70"><ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-cyan-200" /><span>Il codice commessa viene assegnato dal sistema al salvataggio.</span></div>
      </div>
    </aside>
  );
}

function modeHeading(mode: IntakeMode) {
  if (mode === "company-ai") return { title: "Crea da preventivo", description: "Prepara una scheda controllabile con Company AI e conferma ogni dato prima del salvataggio." };
  if (mode === "manual") return { title: "Compila manualmente", description: "Costruisci la scheda operativa con il controllo completo sui dati inseriti." };
  return { title: "Come vuoi iniziare?", description: "Scegli il punto di partenza. Entrambi i percorsi producono la stessa scheda gerarchica." };
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

  const reset = useCallback(() => {
    setMode("chooser");
    setDraft(DEFAULT_INTAKE_DRAFT);
    setSourceText("");
    setSourceFileName("");
    setPreview(null);
    setBusy(false);
    setError("");
    setNotice("");
  }, []);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  }, [onOpenChange, reset]);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") handleOpenChange(false);
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, handleOpenChange]);

  const updateField = (key: keyof IntakeDraft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value } as IntakeDraft));
    setError("");
  };

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    setPreview(null);
    if (file.size > MAX_SOURCE_FILE_BYTES) {
      setSourceFileName("");
      setSourceText("");
      setNotice("");
      setError(`Il file supera il limite di 20 MB. Scegli un preventivo più leggero.`);
      event.target.value = "";
      return;
    }

    setSourceFileName(file.name);
    setBusy(true);
    setNotice(`Lettura di ${file.name} in corso…`);
    try {
      if (isDocxFile(file)) {
        const extractedText = await extractDocxText(file);
        if (extractedText.length < 2) throw new Error("Nel documento Word non è stato trovato testo analizzabile.");
        setSourceText(extractedText);
        setNotice(extractedText.length === MAX_SOURCE_TEXT_CHARS
          ? "DOCX letto. Il testo molto esteso è stato limitato alla parte utile per la preview: avvia Analizza con Company AI."
          : "DOCX letto correttamente. Avvia Analizza con Company AI per proporre i campi.");
      } else if (file.type.startsWith("text/") || /\.(txt|md|csv|json)$/i.test(file.name)) {
        const extractedText = limitSourceText(await file.text());
        if (extractedText.length < 2) throw new Error("Nel file non è stato trovato testo analizzabile.");
        setSourceText(extractedText);
        setNotice(extractedText.length === MAX_SOURCE_TEXT_CHARS
          ? "Documento letto. Il testo molto esteso è stato limitato alla parte utile per la preview: avvia Analizza con Company AI."
          : "Testo del documento letto. Avvia Analizza con Company AI per proporre i campi.");
      } else {
        setSourceText("");
        setNotice("Allegato acquisito. Per la compilazione automatica immediata incolla anche il testo del preventivo.");
      }
    } catch (caught) {
      setSourceFileName("");
      setSourceText("");
      setNotice("");
      setError(caught instanceof Error ? caught.message : "Il documento non è stato letto.");
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  };

  const analyzeWithCompanyAi = async () => {
    if (sourceText.trim().length < 2) {
      setError("Inserisci o incolla il contenuto del preventivo prima di avviare Company AI.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("Company AI sta leggendo il preventivo e preparando una proposta controllabile…");
    try {
      const response = await fetch("/api/operations/intake", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceText, sourceName: sourceFileName }) });
      const data = await response.json() as IntakePreview & { error?: string };
      if (!response.ok) throw new Error(data.error || "company_ai_preview_failed");
      setPreview(data);
      setDraft((current) => ({ ...current, ...data.draft, statusCode: "DRAFT" } as IntakeDraft));
      setNotice(`Company AI ha proposto ${data.suggestions?.length ?? 0} campi. Verifica e modifica liberamente prima della conferma.`);
    } catch (caught) {
      setNotice("");
      setError(caught instanceof Error && caught.message !== "Failed to fetch" ? caught.message : "Company AI non è raggiungibile in questo momento. Riprova tra poco.");
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
    const scopeSelection = resolveCompanyAiScopeSelection({
      sectionId: draft.scopeSectionId,
      groupId: draft.scopeGroupId,
      subgroupId: draft.scopeSubgroupId,
    });
    if (!scopeSelection) {
      setError("Completa lo scope selezionando sezione, raggruppamento e sottogruppo.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/operations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...draft, statusCode: draft.statusCode === "PROPOSED" ? "PROPOSED" : "DRAFT", client: draft.clientName, location: draft.worksite, category: scopeSelection.sectionTitle, jobType: scopeSelection.groupTitle, specialization: scopeSelection.subgroupTitle, scope: scopeSelection, sourceMode: mode === "company-ai" ? "COMPANY_AI" : "MANUAL", aiPreviewId: preview?.previewId, idempotencyKey: `operations-intake-${crypto.randomUUID()}` }) });
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
  const heading = modeHeading(mode);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] isolate touch-manipulation" data-slot="commessa-intake-overlay">
      <div aria-hidden="true" className="absolute inset-0 bg-black/80 backdrop-blur-md" onMouseDown={() => handleOpenChange(false)} />
      <section aria-describedby="new-commessa-description" aria-labelledby="new-commessa-title" aria-modal="true" className="fixed left-1/2 top-1/2 z-[101] flex max-h-[calc(100dvh-1.25rem)] w-[calc(100%-1rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[28px] border border-lime-300/15 bg-[#070b0c] p-0 text-slate-100 shadow-[0_35px_120px_rgba(0,0,0,0.72),0_0_70px_rgba(190,255,60,0.06)] sm:max-h-[calc(100dvh-2rem)] sm:max-w-[1320px]" role="dialog">
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[28px]"><div className="absolute -right-36 -top-40 size-[31rem] rounded-full bg-lime-300/[0.055] blur-3xl" /><div className="absolute -bottom-48 left-1/3 size-[28rem] rounded-full bg-cyan-300/[0.035] blur-3xl" /><div className="absolute inset-0 bg-[linear-gradient(115deg,rgba(255,255,255,0.025),transparent_22%,transparent_76%,rgba(190,255,60,0.025))]" /><div className="absolute inset-0 opacity-[0.12] [background-image:linear-gradient(rgba(255,255,255,0.07)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.07)_1px,transparent_1px)] [background-size:42px_42px] [mask-image:linear-gradient(to_bottom,black,transparent_78%)]" /></div>
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-[2px] bg-gradient-to-r from-lime-300 via-lime-200 to-cyan-300 shadow-[0_0_22px_rgba(190,255,60,0.55)]" />
        <div className="flex max-h-[calc(100dvh-1.25rem)] min-h-0 flex-col sm:max-h-[calc(100dvh-2rem)]">
          <DialogHeader className="relative z-10 shrink-0 border-b border-white/[0.08] bg-black/10 px-4 pb-4 pt-5 text-left backdrop-blur-xl sm:px-8 sm:pb-5 sm:pt-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-2xl border border-lime-300/30 bg-[linear-gradient(145deg,rgba(190,255,60,0.22),rgba(190,255,60,0.03))] text-lime-200 shadow-[0_0_28px_rgba(190,255,60,0.12)]"><FolderKanban className="size-5" /></span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-lime-300">Operations / intake 01</p><span className="rounded-full border border-lime-300/25 bg-lime-300/[0.08] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-lime-200">workspace</span></div><h2 className="mt-2 text-2xl font-semibold tracking-[-0.045em] text-lime-200 sm:text-[31px]" id="new-commessa-title">{heading.title}</h2><p className="mt-2 max-w-2xl text-xs leading-5 text-slate-400" id="new-commessa-description">{heading.description}</p></div></div>
              <div className="flex shrink-0 items-center gap-2"><span className="hidden rounded-full border border-cyan-300/20 bg-cyan-300/[0.06] px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-cyan-200/80 sm:inline-flex">AI-ZEROW · CONTROLLED</span><button aria-label="Chiudi nuova commessa" className="grid size-10 place-items-center rounded-xl border border-white/10 bg-black/25 text-slate-500 transition hover:border-lime-300/45 hover:bg-lime-300/10 hover:text-lime-100" onClick={() => handleOpenChange(false)} type="button"><X className="size-4" /></button></div>
            </div>
          </DialogHeader>

          {mode === "chooser" ? (
            <div className="relative z-10 min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-8">
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(290px,0.75fr)]">
                <div>
                  <div className="mb-5 flex items-end justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-lime-300/80">Scegli il percorso</p><p className="mt-2 text-sm text-slate-300">La destinazione è la stessa. Scegli come vuoi costruire la scheda.</p></div><span className="hidden rounded-full border border-white/10 bg-black/20 px-3 py-1.5 font-mono text-[10px] text-slate-600 sm:block">01 / 03</span></div>
                  <div className="space-y-3">
                    <button className="group relative w-full overflow-hidden rounded-[24px] border border-lime-300/35 bg-[linear-gradient(135deg,rgba(190,255,60,0.16),rgba(10,24,18,0.82)_48%,rgba(34,211,238,0.055))] p-5 text-left shadow-[0_22px_60px_rgba(190,255,60,0.08)] transition hover:-translate-y-0.5 hover:border-lime-200/75 hover:shadow-[0_24px_70px_rgba(190,255,60,0.14)] sm:p-6" onClick={() => { setMode("company-ai"); setError(""); }} type="button"><div className="pointer-events-none absolute -right-12 -top-16 size-48 rounded-full bg-lime-300/[0.12] blur-3xl transition group-hover:bg-lime-300/[0.2]" /><div className="relative flex items-start gap-4"><span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-lime-300 text-[#060806] shadow-[0_0_28px_rgba(190,255,60,0.26)]"><Sparkles className="size-5" /></span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-200">Percorso consigliato</span><span className="rounded-full border border-lime-300/25 bg-lime-300/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-lime-100">Company AI</span></span><span className="mt-2 block text-xl font-semibold tracking-[-0.03em] text-lime-100">Crea da preventivo</span><span className="mt-2 block max-w-xl text-xs leading-5 text-slate-300">Carica l’originale, lascia che Company AI proponga i dati e mantieni il controllo su ogni campo.</span></span><span className="grid size-8 shrink-0 place-items-center rounded-full border border-lime-300/30 bg-lime-300/10 text-lime-100"><Check className="size-4" /></span></div><span className="relative mt-5 grid gap-2 border-t border-lime-300/15 pt-4 text-[10px] text-slate-400 sm:grid-cols-3"><span><strong className="block font-semibold text-lime-200">01</strong>Incolla il fascicolo</span><span><strong className="block font-semibold text-lime-200">02</strong>Controlla le proposte</span><span><strong className="block font-semibold text-lime-200">03</strong>Conferma la bozza</span></span></button>
                    <button className="group relative w-full overflow-hidden rounded-[24px] border border-white/[0.1] bg-[linear-gradient(135deg,rgba(255,255,255,0.045),rgba(0,0,0,0.18))] p-5 text-left transition hover:-translate-y-0.5 hover:border-lime-300/40 hover:bg-lime-300/[0.045] sm:p-6" onClick={() => { setMode("manual"); setError(""); }} type="button"><div className="relative flex items-start gap-4"><span className="grid size-12 shrink-0 place-items-center rounded-2xl border border-white/15 bg-black/30 text-slate-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"><PenLine className="size-5" /></span><span className="min-w-0 flex-1"><span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">Inserimento diretto</span><span className="mt-2 block text-xl font-semibold tracking-[-0.03em] text-lime-100/90">Compila manualmente</span><span className="mt-2 block max-w-xl text-xs leading-5 text-slate-500">Inserisci anagrafica, classificazione e contesto senza allegare un documento.</span></span><span className="grid size-8 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.03] text-slate-500"><PenLine className="size-3.5" /></span></div></button>
                  </div>
                  <div className="mt-5 flex items-start gap-3 rounded-2xl border border-amber-300/20 bg-[linear-gradient(135deg,rgba(251,191,36,0.08),rgba(251,191,36,0.02))] p-4 text-[11px] leading-5 text-amber-100/80"><LockKeyhole className="mt-0.5 size-4 shrink-0 text-amber-200" /><span><strong className="font-semibold text-amber-100">Regola di conferma.</strong> La commessa nasce solo dopo la tua conferma finale. Company AI prepara una proposta controllabile, non una scrittura automatica.</span></div>
                </div>

                <section className="relative overflow-hidden rounded-[24px] border border-white/[0.1] bg-[linear-gradient(160deg,rgba(19,31,30,0.9),rgba(5,10,11,0.96))] p-5 shadow-[0_24px_60px_rgba(0,0,0,0.28)] sm:p-6"><div className="pointer-events-none absolute -right-12 -top-12 size-40 rounded-full bg-cyan-300/[0.07] blur-3xl" /><div className="relative flex items-start gap-3"><span className="grid size-11 place-items-center rounded-2xl border border-cyan-300/25 bg-cyan-300/10 text-cyan-200"><Sparkles className="size-4" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-200/75">Contesto assistito</p><h2 className="mt-1 text-[15px] font-semibold text-lime-100">Company AI · Commesse</h2></div></div><div className="relative mt-7 space-y-4"><div className="flex items-start gap-3"><span className="mt-1 grid size-5 shrink-0 place-items-center rounded-full border border-white/15 bg-black/30"><span className="size-1.5 rounded-full bg-slate-600" /></span><div><p className="text-xs text-slate-300">Anagrafica</p><p className="mt-1 text-[10px] leading-4 text-slate-600">In attesa del fascicolo sorgente</p></div></div><div className="flex items-start gap-3"><span className="mt-1 grid size-5 shrink-0 place-items-center rounded-full border border-lime-300/35 bg-lime-300/10"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_8px_rgba(190,255,60,0.8)]" /></span><div><p className="text-xs text-lime-100/90">Scope operativo</p><p className="mt-1 text-[10px] leading-4 text-lime-200/70">Classificazione pronta per la scheda</p></div></div><div className="flex items-start gap-3"><span className="mt-1 grid size-5 shrink-0 place-items-center rounded-full border border-cyan-300/35 bg-cyan-300/10"><span className="size-1.5 rounded-full bg-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.7)]" /></span><div><p className="text-xs text-slate-300">Controllo umano</p><p className="mt-1 text-[10px] leading-4 text-slate-600">Richiesto prima della creazione</p></div></div></div><div className="relative mt-8 flex items-start gap-2 rounded-2xl border border-white/[0.08] bg-black/25 p-3 text-[11px] leading-5 text-slate-500"><LockKeyhole className="mt-0.5 size-3.5 shrink-0 text-slate-600" />Company AI legge solo il contenuto mostrato e non genera modifiche implicite.</div></section>
              </div>
            </div>
          ) : (
            <form className="flex min-h-0 flex-1 flex-col" onSubmit={createJob}>
              <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
                {mode === "company-ai" && <CompanyAiPanel busy={busy} notice={notice} onAnalyze={() => void analyzeWithCompanyAi()} onFile={(event) => void handleFile(event)} onSourceTextChange={(value) => { setSourceText(value); setError(""); }} preview={preview} sourceFileName={sourceFileName} sourceText={sourceText} />}
                <div className="relative z-10 grid gap-6 p-4 sm:p-7 lg:grid-cols-[minmax(0,1fr)_310px]"><div className="min-w-0"><IntakeFields draft={draft} onChange={updateField} proposedKeys={proposedKeys} /></div><SummaryRail draft={draft} mode={mode} preview={preview} /></div>
                {error && <div className="relative z-10 mx-4 mb-5 flex items-start gap-3 rounded-2xl border border-rose-300/25 bg-[linear-gradient(135deg,rgba(244,63,94,0.1),rgba(244,63,94,0.035))] px-4 py-3.5 text-xs leading-5 text-rose-100 shadow-[0_14px_30px_rgba(0,0,0,0.16)] sm:mx-7"><span className="mt-1 size-1.5 shrink-0 rounded-full bg-rose-300 shadow-[0_0_8px_rgba(251,113,133,0.8)]" />{error}</div>}
              </div>
              <div className="relative z-10 flex shrink-0 flex-col gap-4 border-t border-lime-300/10 bg-[linear-gradient(180deg,rgba(16,27,24,0.94),rgba(6,11,12,0.98))] px-4 py-4 shadow-[0_-18px_45px_rgba(0,0,0,0.18)] sm:flex-row sm:items-center sm:justify-between sm:px-8"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl border border-lime-300/25 bg-lime-300/[0.08] text-lime-200 shadow-[0_0_18px_rgba(190,255,60,0.07)]"><ShieldCheck className="size-3.5" /></span><div><p className="text-[11px] font-semibold text-lime-100/90">Conferma controllata</p><p className="mt-0.5 text-[10px] text-slate-600">{mode === "company-ai" ? "Proposte verificabili · conferma umana richiesta" : "Inserimento manuale · conferma umana richiesta"}</p></div></div><div className="flex flex-col-reverse gap-2 sm:flex-row"><Button className="h-11 rounded-xl border-white/10 bg-transparent px-4 text-slate-400 hover:border-lime-300/25 hover:bg-lime-300/[0.06] hover:text-lime-100" onClick={() => handleOpenChange(false)} type="button" variant="outline">Annulla</Button><Button className="h-11 rounded-xl bg-[linear-gradient(135deg,#bfff3c,#8bdc48)] px-5 font-semibold text-[#060806] shadow-[0_0_26px_rgba(190,255,60,0.17)] transition hover:-translate-y-0.5 hover:bg-[linear-gradient(135deg,#d3ff6d,#a4ec57)] hover:shadow-[0_0_34px_rgba(190,255,60,0.28)]" disabled={busy} type="submit">{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : mode === "company-ai" ? <Check className="size-3.5" /> : <Save className="size-3.5" />}{mode === "company-ai" ? "Conferma dati e crea commessa" : "Salva commessa in bozza"}</Button></div></div>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
