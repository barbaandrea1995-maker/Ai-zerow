"use client";

import { useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
      <span className="flex min-h-4 items-center gap-2 font-medium text-slate-400">
        {label}
        {required && <span className="text-rose-300">*</span>}
        {proposed && (
          <span className="rounded border border-cyan-300/25 bg-cyan-300/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-cyan-200">
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
    <section className="rounded-2xl border border-white/[0.09] bg-[#101617]/85 p-4 shadow-[0_16px_36px_rgba(0,0,0,0.12)] sm:p-5">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/[0.07] text-lime-200">
            <Icon className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-lime-300/65">{eyebrow}</p>
            <h3 className="mt-1 text-sm font-semibold tracking-[-0.01em] text-slate-100">{title}</h3>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">{description}</p>
          </div>
        </div>
        {badge}
      </div>
      {children}
    </section>
  );
}

const inputClass = "h-11 rounded-lg border-white/10 bg-black/30 text-sm text-slate-100 placeholder:text-slate-600 shadow-none transition focus-visible:border-lime-300/45 focus-visible:ring-1 focus-visible:ring-lime-300/20";
const selectClass = "h-11 w-full rounded-lg border border-white/10 bg-[#111718] px-3 text-sm text-slate-100 outline-none transition focus:border-lime-300/45 focus:ring-1 focus:ring-lime-300/20";
const textareaClass = "resize-y rounded-lg border-white/10 bg-black/30 text-sm text-slate-100 placeholder:text-slate-600 shadow-none transition focus-visible:border-lime-300/45 focus-visible:ring-1 focus-visible:ring-lime-300/20";

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
            <Input autoFocus className={inputClass} onChange={(event) => onChange("title", event.target.value)} placeholder="Es. Riqualificazione sede Milano" value={draft.title} />
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

const journeySteps = [
  { label: "Origine", caption: "Scegli il flusso" },
  { label: "Scheda", caption: "Completa i dati" },
  { label: "Conferma", caption: "Crea la bozza" },
];

function StepRail({ mode }: { mode: IntakeMode }) {
  const activeStep = mode === "chooser" ? 0 : 1;
  return (
    <div className="grid grid-cols-3 gap-2 border-t border-white/[0.07] pt-4">
      {journeySteps.map((step, index) => {
        const complete = index < activeStep;
        const active = index === activeStep;
        return (
          <div className={`flex items-center gap-2 ${index < journeySteps.length - 1 ? "after:hidden sm:after:block sm:after:h-px sm:after:flex-1 sm:after:bg-white/[0.08]" : ""}`} key={step.label}>
            <span className={`grid size-7 shrink-0 place-items-center rounded-full border text-[10px] font-semibold ${complete ? "border-lime-300/40 bg-lime-300 text-[#060806]" : active ? "border-lime-300/50 bg-lime-300/[0.12] text-lime-200" : "border-white/10 bg-black/20 text-slate-600"}`}>
              {complete ? <Check className="size-3.5" /> : `0${index + 1}`}
            </span>
            <span className="hidden min-w-0 sm:block">
              <span className={`block text-[10px] font-semibold uppercase tracking-[0.13em] ${active ? "text-slate-100" : complete ? "text-lime-200/80" : "text-slate-600"}`}>{step.label}</span>
              <span className="mt-0.5 block truncate text-[10px] text-slate-600">{step.caption}</span>
            </span>
          </div>
        );
      })}
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
    <section className="mx-4 mt-4 rounded-2xl border border-cyan-300/20 bg-[linear-gradient(135deg,rgba(34,211,238,0.08),rgba(9,13,14,0.76)_48%,rgba(190,255,60,0.045))] p-4 shadow-[0_18px_42px_rgba(0,0,0,0.16)] sm:mx-6 sm:mt-6 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-cyan-300/25 bg-cyan-300/10 text-cyan-200 shadow-[0_0_24px_rgba(34,211,238,0.12)]"><Sparkles className="size-4" /></span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200/80">Company AI · preview governata</p><span className="rounded-full border border-cyan-300/20 bg-cyan-300/[0.08] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-cyan-100/80">preview only</span></div>
            <h2 className="mt-1 text-base font-semibold tracking-[-0.02em] text-slate-100">Dal preventivo alla scheda operativa</h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">Company AI propone i campi leggendo solo il contenuto che mostri. Tu controlli, correggi e confermi prima di creare la commessa.</p>
          </div>
        </div>
        {preview && <span className="rounded-full border border-lime-300/25 bg-lime-300/[0.09] px-3 py-1.5 text-[10px] font-semibold text-lime-200">{preview.suggestions.length} campi proposti</span>}
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_235px]">
        <div>
          <label className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400" htmlFor="commessa-source-text">Testo sorgente del preventivo</label>
          <Textarea className={`${textareaClass} min-h-[126px] border-cyan-300/15`} id="commessa-source-text" onChange={(event) => onSourceTextChange(event.target.value)} placeholder="Incolla qui cliente, oggetto, indirizzo, lavorazioni, riferimenti e note del preventivo…" value={sourceText} />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="inline-flex min-w-0 max-w-full cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-300 transition hover:border-cyan-300/30 hover:text-cyan-100"><Upload className="size-3.5 shrink-0" /><span className="truncate">{sourceFileName || "Carica originale"}</span><input accept=".txt,.md,.csv,.json,application/pdf,image/*" className="sr-only" onChange={onFile} type="file" /></label>
            <Button className="bg-cyan-300 text-[#061012] shadow-[0_0_18px_rgba(34,211,238,0.12)] hover:bg-cyan-200" disabled={busy} onClick={onAnalyze} type="button">{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}Analizza con Company AI</Button>
          </div>
          {notice && <p className="mt-3 text-[11px] leading-5 text-cyan-100/75">{notice}</p>}
        </div>

        <div className="rounded-xl border border-white/[0.08] bg-black/20 p-4">
          <div className="flex items-center justify-between gap-3"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Guardrail attivi</p><LockKeyhole className="size-3.5 text-cyan-200/70" /></div>
          <div className="mt-4 space-y-3"><div className="flex items-start gap-2.5"><CircleCheck className="mt-0.5 size-3.5 shrink-0 text-lime-300" /><span className="text-[11px] leading-4 text-slate-400">Solo proposta, nessuna scrittura diretta</span></div><div className="flex items-start gap-2.5"><CircleCheck className="mt-0.5 size-3.5 shrink-0 text-lime-300" /><span className="text-[11px] leading-4 text-slate-400">Modifica manuale sempre disponibile</span></div><div className="flex items-start gap-2.5"><CircleCheck className="mt-0.5 size-3.5 shrink-0 text-lime-300" /><span className="text-[11px] leading-4 text-slate-400">Conferma umana prima del salvataggio</span></div></div>
        </div>
      </div>

      {preview && (
        <div className="mt-5 border-t border-white/[0.08] pt-5">
          <div className="flex flex-wrap items-end justify-between gap-2"><div><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-200/70">Risultato della preview</p><p className="mt-1 text-xs text-slate-500">Ogni proposta resta visibile e modificabile nella scheda sottostante.</p></div><span className="font-mono text-[10px] text-slate-600">{preview.previewId}</span></div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {preview.suggestions.map((suggestion) => (
              <div className="rounded-xl border border-white/[0.08] bg-black/20 p-3" key={suggestion.key}>
                <div className="flex items-center justify-between gap-3"><span className="truncate text-[10px] font-medium text-slate-500">{suggestion.label}</span><span className="shrink-0 font-mono text-[9px] text-cyan-200">{Math.round(suggestion.confidence * 100)}%</span></div>
                <p className="mt-1 truncate text-xs text-slate-200">{suggestion.value || "Non rilevato"}</p>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.08]"><span className="block h-full rounded-full bg-cyan-300/80" style={{ width: `${Math.round(suggestion.confidence * 100)}%` }} /></div>
                <p className="mt-2 truncate text-[9px] uppercase tracking-[0.1em] text-slate-600">Fonte: {suggestion.source}</p>
              </div>
            ))}
          </div>
          {preview.knowledgePack && (
            <div className="mt-5 rounded-2xl border border-lime-300/15 bg-lime-300/[0.035] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3"><span className="grid size-9 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/[0.08] text-lime-200"><BookOpen className="size-4" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-lime-200/75">Knowledge pack attivo</p><p className="mt-1 text-sm font-semibold text-slate-100">{preview.knowledgePack.name}</p><p className="mt-1 text-[10px] leading-4 text-slate-500">v{preview.knowledgePack.version} · {preview.knowledgePack.entryCount.toLocaleString("it-IT")} voci · riferimento tecnico</p></div></div>
                <span className="rounded-full border border-amber-300/20 bg-amber-300/[0.06] px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-amber-100/80">da confermare</span>
              </div>
              {preview.scopeSuggestion?.selection ? <div className="mt-4 rounded-xl border border-cyan-300/20 bg-cyan-300/[0.045] p-3"><div className="flex items-center justify-between gap-3"><p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-cyan-200/80">Scope proposto · fino al sottogruppo</p><span className="font-mono text-[10px] text-cyan-200">{Math.round(preview.scopeSuggestion.score * 100)}%</span></div><p className="mt-2 text-xs font-semibold text-slate-100">{preview.scopeSuggestion.selection.sectionTitle}</p><p className="mt-1 text-[11px] text-slate-400">{preview.scopeSuggestion.selection.groupTitle} <span className="text-slate-600">/</span> {preview.scopeSuggestion.selection.subgroupTitle}</p></div> : <p className="mt-4 rounded-xl border border-dashed border-white/10 px-3 py-4 text-center text-[11px] text-slate-500">Nessun sottogruppo proposto dal testo. Selezionalo manualmente nella scheda.</p>}
              {preview.knowledgeHints?.length ? <div className="mt-4"><p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.13em] text-slate-600">Contesto tecnico · non parte dello scope</p><div className="grid gap-2 md:grid-cols-2">{preview.knowledgeHints.map((hint) => <div className="rounded-xl border border-white/[0.08] bg-black/20 p-3" key={hint.id}><div className="flex items-center justify-between gap-3"><span className="font-mono text-[10px] text-lime-200">{hint.part} · {hint.code}</span><span className="text-[10px] text-slate-500">{hint.unit || "unità da verificare"}</span></div><p className="mt-2 line-clamp-2 text-[11px] leading-5 text-slate-300">{hint.description}</p><div className="mt-2 flex items-center justify-between gap-3 text-[9px] text-slate-600"><span className="truncate">{hint.partTitle}</span><span className="shrink-0 font-mono text-cyan-200/80">{new Intl.NumberFormat("it-IT", { style: "currency", currency: hint.currency }).format(hint.price)}</span></div></div>)}</div></div> : null}
              <p className="mt-3 flex items-start gap-2 text-[10px] leading-4 text-slate-600"><ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-lime-200/70" />Il pack aiuta Company AI a comprendere la lavorazione; non genera quantità, prezzo di vendita, ordine o chiusura della commessa.</p>
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
      <div className="rounded-2xl border border-white/[0.09] bg-[#101617]/80 p-4 shadow-[0_16px_36px_rgba(0,0,0,0.12)] sm:p-5">
        <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-lime-300/65">Live summary</p><h2 className="mt-1 text-sm font-semibold text-slate-100">Commessa in preparazione</h2></div><span className="grid size-9 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/[0.07] text-lime-200"><ClipboardCheck className="size-4" /></span></div>
        <div className="mt-5 rounded-xl border border-white/[0.08] bg-black/20 p-3"><div className="flex items-center justify-between gap-3"><span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Dati chiave</span><span className="font-mono text-[10px] text-lime-200">{filledCount}/{keyFields.length}</span></div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.08]"><span className="block h-full rounded-full bg-gradient-to-r from-lime-300 to-cyan-300 transition-all" style={{ width: `${progress}%` }} /></div><p className="mt-2 text-[10px] leading-4 text-slate-600">La classificazione si completa selezionando il sottogruppo.</p></div>
        <div className="mt-5 space-y-3">{keyFields.map((field) => <div className="flex items-start justify-between gap-3 border-b border-white/[0.06] pb-3 last:border-0 last:pb-0" key={field.label}><span className="text-[10px] text-slate-600">{field.label}</span><span className={`max-w-[58%] truncate text-right text-[11px] ${field.value ? "text-slate-300" : "text-slate-600"}`}>{field.value || field.fallback}</span></div>)}</div>
        <div className="mt-5 rounded-xl border border-white/[0.08] bg-black/20 p-3.5"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Controlli prima del salvataggio</p><div className="mt-4 space-y-3.5"><CheckRow complete label="Stato iniziale: Bozza" detail="La commessa non viene chiusa automaticamente" /><CheckRow complete={sourceReady} label={`Percorso: ${sourceLabel}`} detail={sourceReady ? "Origine registrata nella scheda" : "Avvia la preview per continuare"} /><CheckRow complete={Boolean(draft.title.trim())} label="Nome commessa" detail={draft.title.trim() ? "Dato pronto per la conferma" : "Campo richiesto"} /><CheckRow complete={Boolean(selectedSubgroup)} label="Scope fino al sottogruppo" detail={selectedSubgroup ? "Classificazione pronta" : "Seleziona sezione, raggruppamento e sottogruppo"} /><CheckRow complete label="Conferma umana" detail="Ultimo controllo prima della scrittura" /></div></div>
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-cyan-300/15 bg-cyan-300/[0.045] p-3 text-[10px] leading-4 text-cyan-100/70"><ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-cyan-200" /><span>Il codice commessa viene assegnato dal sistema al salvataggio.</span></div>
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
      const response = await fetch("/api/operations/intake", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceText, sourceName: sourceFileName }) });
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

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] overflow-hidden border-white/10 bg-[#090d0e] p-0 text-slate-100 shadow-[0_28px_90px_rgba(0,0,0,0.55)] sm:max-w-[1180px]" showCloseButton={false}>
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-lime-300 via-cyan-300 to-transparent" />
        <div className="flex max-h-[calc(100dvh-1rem)] min-h-0 flex-col">
          <DialogHeader className="shrink-0 border-b border-white/[0.08] px-4 pb-4 pt-5 text-left sm:px-7 sm:pb-5 sm:pt-6">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-lime-300/70">Operations / intake 01</p><DialogTitle className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-50 sm:text-[28px]">{heading.title}</DialogTitle><DialogDescription className="mt-2 max-w-2xl text-xs leading-5 text-slate-500">{heading.description}</DialogDescription></div>
              <div className="flex shrink-0 items-center gap-2"><span className="hidden rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-600 sm:inline-flex">AI-ZEROW · WORKSPACE</span><button aria-label="Chiudi nuova commessa" className="grid size-9 place-items-center rounded-lg border border-white/10 bg-black/20 text-slate-500 transition hover:border-lime-300/30 hover:text-slate-100" onClick={() => handleOpenChange(false)} type="button"><X className="size-4" /></button></div>
            </div>
            <StepRail mode={mode} />
          </DialogHeader>

          {mode === "chooser" ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-7">
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1.28fr)_minmax(260px,0.72fr)]">
                <div>
                  <div className="mb-4 flex items-end justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Scegli il percorso</p><p className="mt-1 text-sm text-slate-300">La destinazione dei dati è la stessa. Cambia solo il punto di partenza.</p></div><span className="hidden text-[10px] text-slate-600 sm:block">01 / 03</span></div>
                  <div className="space-y-3">
                    <button className="group w-full rounded-2xl border border-lime-300/30 bg-[linear-gradient(135deg,rgba(190,255,60,0.105),rgba(190,255,60,0.025))] p-5 text-left shadow-[0_18px_46px_rgba(190,255,60,0.05)] transition hover:border-lime-300/60 hover:bg-lime-300/[0.13]" onClick={() => { setMode("company-ai"); setError(""); }} type="button"><div className="flex items-start gap-4"><span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-lime-300 text-[#060806] shadow-[0_0_22px_rgba(190,255,60,0.18)]"><Sparkles className="size-5" /></span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-lime-200/80">Percorso consigliato</span><span className="rounded-full border border-lime-300/25 bg-lime-300/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-lime-100">Company AI</span></span><span className="mt-2 block text-lg font-semibold tracking-[-0.02em] text-slate-50">Crea da preventivo</span><span className="mt-2 block max-w-xl text-xs leading-5 text-slate-400">Carica o incolla l’originale, lascia che Company AI proponga la scheda e mantieni il controllo su ogni campo.</span></span><span className="grid size-8 shrink-0 place-items-center rounded-full border border-lime-300/25 bg-lime-300/10 text-lime-200"><Check className="size-4" /></span></div><span className="mt-5 grid gap-2 border-t border-lime-300/15 pt-4 text-[10px] text-slate-500 sm:grid-cols-3"><span><strong className="block font-semibold text-slate-300">01</strong>Incolla il fascicolo</span><span><strong className="block font-semibold text-slate-300">02</strong>Controlla le proposte</span><span><strong className="block font-semibold text-slate-300">03</strong>Conferma la bozza</span></span></button>
                    <button className="group w-full rounded-2xl border border-white/10 bg-black/20 p-5 text-left transition hover:border-lime-300/35 hover:bg-white/[0.04]" onClick={() => { setMode("manual"); setError(""); }} type="button"><div className="flex items-start gap-4"><span className="grid size-12 shrink-0 place-items-center rounded-2xl border border-white/15 bg-black/25 text-slate-300"><PenLine className="size-5" /></span><span className="min-w-0 flex-1"><span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Inserimento diretto</span><span className="mt-2 block text-lg font-semibold tracking-[-0.02em] text-slate-100">Compila manualmente</span><span className="mt-2 block max-w-xl text-xs leading-5 text-slate-500">Inserisci anagrafica, classificazione e contesto senza allegare un documento.</span></span><span className="grid size-8 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.03] text-slate-600"><PenLine className="size-3.5" /></span></div></button>
                  </div>
                  <div className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-300/20 bg-amber-300/[0.055] p-4 text-[11px] leading-5 text-amber-100/80"><LockKeyhole className="mt-0.5 size-4 shrink-0 text-amber-200" /><span><strong className="font-semibold text-amber-100">Regola di conferma.</strong> La commessa nasce solo dopo la tua conferma finale. Company AI prepara una proposta controllabile, non una scrittura automatica.</span></div>
                </div>

                <section className="carbon-card rounded-2xl p-5"><div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-200"><Sparkles className="size-4" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200/70">Contesto assistito</p><h2 className="mt-1 text-sm font-semibold text-slate-100">Company AI · Commesse</h2></div></div><div className="mt-6 space-y-4"><div className="flex items-start gap-3"><span className="mt-1 size-2 shrink-0 rounded-full border border-slate-600" /><div><p className="text-xs text-slate-300">Anagrafica</p><p className="mt-1 text-[10px] leading-4 text-slate-600">In attesa del fascicolo sorgente</p></div></div><div className="flex items-start gap-3"><span className="mt-1 size-2 shrink-0 rounded-full bg-lime-300 shadow-[0_0_8px_rgba(190,255,60,0.7)]" /><div><p className="text-xs text-slate-300">Scope operativo</p><p className="mt-1 text-[10px] leading-4 text-lime-200/70">Classificazione pronta per la scheda</p></div></div><div className="flex items-start gap-3"><span className="mt-1 size-2 shrink-0 rounded-full bg-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.6)]" /><div><p className="text-xs text-slate-300">Controllo umano</p><p className="mt-1 text-[10px] leading-4 text-slate-600">Richiesto prima della creazione</p></div></div></div><div className="mt-7 flex items-start gap-2 rounded-xl border border-white/10 bg-black/20 p-3 text-[11px] leading-5 text-slate-500"><LockKeyhole className="mt-0.5 size-3.5 shrink-0 text-slate-600" />Company AI legge solo il contenuto mostrato e non genera analisi, preventivi o modifiche implicite.</div></section>
              </div>
            </div>
          ) : (
            <form className="flex min-h-0 flex-1 flex-col" onSubmit={createJob}>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {mode === "company-ai" && <CompanyAiPanel busy={busy} notice={notice} onAnalyze={() => void analyzeWithCompanyAi()} onFile={(event) => void handleFile(event)} onSourceTextChange={(value) => { setSourceText(value); setError(""); }} preview={preview} sourceFileName={sourceFileName} sourceText={sourceText} />}
                <div className="grid gap-5 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_285px]"><div className="min-w-0"><IntakeFields draft={draft} onChange={updateField} proposedKeys={proposedKeys} /></div><SummaryRail draft={draft} mode={mode} preview={preview} /></div>
                {error && <div className="mx-4 mb-4 flex items-start gap-3 rounded-xl border border-rose-300/25 bg-rose-300/[0.06] px-4 py-3 text-xs leading-5 text-rose-100 sm:mx-6"><span className="mt-1 size-1.5 shrink-0 rounded-full bg-rose-300" />{error}</div>}
              </div>
              <div className="flex shrink-0 flex-col gap-4 border-t border-white/[0.08] bg-[#101617] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7"><div className="flex items-center gap-3"><span className="grid size-8 place-items-center rounded-lg border border-lime-300/20 bg-lime-300/[0.07] text-lime-200"><ShieldCheck className="size-3.5" /></span><div><p className="text-[11px] font-semibold text-slate-300">Conferma controllata</p><p className="mt-0.5 text-[10px] text-slate-600">{mode === "company-ai" ? "Proposte verificabili · conferma umana richiesta" : "Inserimento manuale · conferma umana richiesta"}</p></div></div><div className="flex flex-col-reverse gap-2 sm:flex-row"><Button className="border-white/10 bg-transparent text-slate-400 hover:bg-white/10 hover:text-white" onClick={() => handleOpenChange(false)} type="button" variant="outline">Annulla</Button><Button className="bg-lime-300 text-[#060806] shadow-[0_0_22px_rgba(190,255,60,0.12)] hover:bg-lime-200" disabled={busy} type="submit">{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : mode === "company-ai" ? <Check className="size-3.5" /> : <Save className="size-3.5" />}{mode === "company-ai" ? "Conferma dati e crea commessa" : "Salva commessa in bozza"}</Button></div></div>
            </form>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
