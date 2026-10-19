"use client";

import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import {
  ArrowLeft,
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
import {
  type CompanyAiMacroScopeActivity,
  type CompanyAiMacroScopeCatalog,
  type CompanyAiMacroScopeId,
  type CompanyAiMacroScopeProposal,
} from "@/lib/company-ai-macro-scope";
import { resolveCompanyAiScopeSelection } from "@/lib/company-ai-scope";
import type { GeocodeCandidate } from "@/lib/location-intelligence/provider-types";

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

type MacroScopeSession = {
  previewId: string;
  proposal: CompanyAiMacroScopeProposal;
  catalog: CompanyAiMacroScopeCatalog;
  aiRuntime: { status: "used" | "not_configured" | "unavailable"; model: string };
  groupsConfirmed: CompanyAiMacroScopeId[];
  activities: Array<CompanyAiMacroScopeActivity & { included: boolean }>;
  confirmed: boolean;
};

function workItemsForDraft(draft: IntakeDraft) {
  const previous = new Map<string, IntakeDraft["workItems"][number]>();
  for (const item of draft.workItems) {
    previous.set(item.label.trim().toLocaleLowerCase("it-IT"), item);
    previous.set(item.detail.trim().toLocaleLowerCase("it-IT"), item);
  }
  const lines = draft.workItemsText.split(/\r?\n/).map((line) => line.trim().replace(/^[-•·▪◦]+\s*/, "")).filter(Boolean).slice(0, 24);
  if (!lines.length) return draft.workItems.slice(0, 24);
  return lines.map((line, index) => {
    const existing = previous.get(line.toLocaleLowerCase("it-IT"));
    return existing ? { ...existing, id: `work-${index + 1}`, label: line } : {
      id: `work-${index + 1}`,
      label: line.slice(0, 180),
      detail: line.slice(0, 520),
      quantity: "",
      unit: "",
      confidence: 1,
      source: "human-authored",
    };
  });
}

function isDocxFile(file: File) {
  return file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || /\.docx$/i.test(file.name);
}

function isSpreadsheetFile(file: File) {
  return file.type === "application/vnd.ms-excel"
    || file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    || /\.(xls|xlsx)$/i.test(file.name);
}

function displaySuggestionSource(value: string) {
  const normalized = value.toLocaleLowerCase("it-IT");
  if (normalized.includes("openai") || normalized.includes("company ai")) return "Company AI";
  if (normalized.includes("preventivo")) return "Preventivo";
  return "Analisi assistita";
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

  const readWordText = (root: Element) => {
    const parts: string[] = [];
    const walk = (node: Element) => {
      const name = node.localName;
      if (name === "t") parts.push(node.textContent ?? "");
      else if (name === "tab") parts.push("\t");
      else if (name === "br" || name === "cr") parts.push("\n");
      else Array.from(node.children).forEach((child) => walk(child));
    };
    walk(root);
    return parts.join("").replace(/\r\n?/g, "\n").trim();
  };

  const body = document.getElementsByTagNameNS("*", "body")[0];
  const blocks: string[] = [];
  if (body) {
    Array.from(body.children).forEach((block) => {
      if (block.localName === "tbl") {
        Array.from(block.getElementsByTagNameNS("*", "tr")).forEach((row) => {
          const cells = Array.from(row.children)
            .filter((cell) => cell.localName === "tc")
            .map((cell) => readWordText(cell))
            .filter(Boolean);
          if (cells.length) blocks.push(cells.join("\t"));
        });
      } else if (block.localName === "p") {
        const text = readWordText(block);
        if (text) blocks.push(text);
      }
    });
  }

  if (!blocks.length) {
    Array.from(document.getElementsByTagNameNS("*", "p")).forEach((paragraph) => {
      const text = readWordText(paragraph);
      if (text) blocks.push(text);
    });
  }
  return limitSourceText(blocks.join("\n"));
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

function WorksiteLocationField({
  value,
  selected,
  candidates,
  busy,
  notice,
  onChange,
  onVerify,
  onSelect,
}: {
  value: string;
  selected: GeocodeCandidate | null;
  candidates: GeocodeCandidate[];
  busy: boolean;
  notice: string;
  onChange: (value: string) => void;
  onVerify: () => void;
  onSelect: (candidate: GeocodeCandidate) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          aria-label="Indirizzo del cantiere"
          className={`${inputClass} min-w-0 flex-1`}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Via, numero, CAP, comune…"
          value={value}
        />
        <Button
          aria-busy={busy}
          className="h-12 shrink-0 rounded-xl border border-lime-300/25 bg-lime-300/[0.08] px-4 text-lime-100 shadow-[0_0_18px_rgba(190,255,60,0.07)] transition hover:border-lime-200/55 hover:bg-lime-300/[0.14] hover:text-lime-50 disabled:cursor-not-allowed disabled:opacity-45"
          disabled={busy || value.trim().length < 5}
          onClick={onVerify}
          type="button"
        >
          {busy ? <LoaderCircle className="size-4 animate-spin" /> : <MapPin className="size-4" />}
          <span>{busy ? "Verifica…" : "Verifica indirizzo"}</span>
        </Button>
      </div>

      {selected ? (
        <div className="flex items-start gap-3 rounded-2xl border border-lime-300/25 bg-lime-300/[0.07] p-3.5 shadow-[0_0_24px_rgba(190,255,60,0.08)]">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-lime-300/25 bg-lime-300/10 text-lime-200"><CircleCheck className="size-4" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-lime-200">Luogo verificato</p>
            <p className="mt-1 text-xs leading-5 text-lime-50/90">{selected.formattedAddress}</p>
            <p className="mt-1 text-[10px] text-lime-100/55">La posizione e il perimetro operativo verranno associati alla commessa al salvataggio.</p>
          </div>
          <span className="shrink-0 rounded-full border border-lime-300/20 bg-black/20 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-lime-200/80">Confermato</span>
        </div>
      ) : candidates.length ? (
        <div className="rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.045] p-3.5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-100/80">Scegli l’ubicazione corretta</p>
            <span className="font-mono text-[10px] text-cyan-200/70">{candidates.length} risultati</span>
          </div>
          <div className="mt-3 grid gap-2">
            {candidates.map((candidate) => (
              <button
                aria-label={`Seleziona ${candidate.formattedAddress}`}
                className="flex w-full items-start gap-3 rounded-xl border border-white/[0.08] bg-black/20 p-3 text-left transition hover:border-cyan-200/45 hover:bg-cyan-300/[0.06]"
                key={candidate.providerPlaceId}
                onClick={() => onSelect(candidate)}
                type="button"
              >
                <MapPin className="mt-0.5 size-4 shrink-0 text-cyan-200" />
                <span className="min-w-0 flex-1"><span className="block text-xs leading-5 text-slate-200">{candidate.formattedAddress}</span><span className="mt-1 block text-[10px] text-slate-500">Affidabilità della proposta: {Math.round(candidate.confidence * 100)}%</span></span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {notice && <p className="rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2.5 text-[10px] leading-4 text-slate-500">{notice}</p>}
    </div>
  );
}

export function IntakeFields({
  mode,
  draft,
  onChange,
  proposedKeys,
  worksiteLocation,
  worksiteCandidates,
  worksiteGeocodeBusy,
  worksiteGeocodeNotice,
  onVerifyWorksite,
  onSelectWorksite,
  onAnalyzeWork,
  macroScope,
  onMacroGroupToggle,
  onMacroActivityChange,
  onMacroActivityToggle,
  onConfirmMacroScope,
  analyzingWork,
  analysisNotice,
}: {
  mode: IntakeMode;
  draft: IntakeDraft;
  onChange: (key: keyof IntakeDraft, value: string) => void;
  proposedKeys: Set<keyof IntakeDraft>;
  worksiteLocation: GeocodeCandidate | null;
  worksiteCandidates: GeocodeCandidate[];
  worksiteGeocodeBusy: boolean;
  worksiteGeocodeNotice: string;
  onVerifyWorksite: () => void;
  onSelectWorksite: (candidate: GeocodeCandidate) => void;
  onAnalyzeWork: () => void;
  macroScope: MacroScopeSession | null;
  onMacroGroupToggle: (groupId: CompanyAiMacroScopeId, checked: boolean) => void;
  onMacroActivityChange: (activityId: string, value: string) => void;
  onMacroActivityToggle: (activityId: string, included: boolean) => void;
  onConfirmMacroScope: () => void;
  analyzingWork: boolean;
  analysisNotice: string;
}) {
  const proposed = (key: keyof IntakeDraft) => proposedKeys.has(key);

  return (
    <div className="space-y-4">
      <FormSection
        description="Il tipo descrive come viene aperta e gestita la commessa. L’ambito tecnico viene proposto separatamente da Company AI."
        eyebrow="01 / apertura"
        icon={Flag}
        title="Tipo commessa"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={INTAKE_FIELD_LABELS.openingType} required proposed={proposed("openingType")}>
            <select className={selectClass} onChange={(event) => onChange("openingType", event.target.value)} required value={draft.openingType}>
              {INTAKE_OPENING_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </Field>
          <Field label="Priorità">
            <select className={selectClass} onChange={(event) => onChange("priority", event.target.value)} value={draft.priority}>
              <option value="STANDARD">Standard</option><option value="HIGH">Alta</option><option value="LOW">Bassa</option>
            </select>
          </Field>
        </div>
      </FormSection>

      <FormSection
        description="Descrivi il lavoro con parole tue. Company AI usa il catalogo attivo lato server per proporre ambiti e lavorazioni testuali verificabili."
        eyebrow="02 / contesto"
        icon={ClipboardCheck}
        title="Descrizione della commessa"
      >
        <Field label={INTAKE_FIELD_LABELS.description} proposed={proposed("description")}>
          <Textarea className={`${textareaClass} min-h-[118px]`} maxLength={2_000} onChange={(event) => onChange("description", event.target.value)} placeholder="Es. Manutenzione della palazzina; descrivi solo ciò che sai del lavoro" value={draft.description} />
        </Field>
        {mode === "manual" && <div className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.045] p-3.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-cyan-300/20 bg-cyan-300/[0.08] text-cyan-100"><Sparkles className="size-4" /></span>
          <div className="min-w-0 flex-1"><p className="text-[11px] font-semibold text-cyan-50">Company AI · proposta di scope</p><p className="mt-1 text-[10px] leading-4 text-slate-500">La descrizione originale resta invariata. Ambiti e attività sono modificabili e richiedono conferma umana.</p></div>
          <Button className="h-10 rounded-xl border-cyan-300/25 bg-cyan-300/[0.08] px-3 text-xs text-cyan-50 hover:bg-cyan-300/[0.14]" disabled={analyzingWork || draft.description.trim().length < 8} onClick={onAnalyzeWork} type="button" variant="outline">{analyzingWork ? <LoaderCircle className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}{analyzingWork ? "Analisi…" : "Analizza con Company AI"}</Button>
        </div>}
        {mode === "manual" && analysisNotice && <p className="mt-2 rounded-xl border border-cyan-300/10 bg-cyan-300/[0.025] px-3 py-2 text-[10px] leading-4 text-cyan-100/70">{analysisNotice}</p>}
        {mode === "manual" && macroScope && <div className="mt-4 space-y-4 rounded-2xl border border-lime-300/20 bg-[linear-gradient(150deg,rgba(190,255,60,.055),rgba(0,0,0,.18))] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.15em] text-lime-200/80">Proposta Company AI · catalogo {macroScope.catalog.version}</p><p className="mt-1 text-[10px] leading-4 text-slate-500">La proposta non è ancora uno scope confermato. Non crea attività di pianificazione.</p></div><span className={`rounded-full border px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wide ${macroScope.confirmed ? "border-lime-300/25 bg-lime-300/[.08] text-lime-100" : "border-amber-300/20 bg-amber-300/[.05] text-amber-100"}`}>{macroScope.confirmed ? "Confermata da te" : "Da confermare"}</span></div>

          <div><p className="mb-2 text-[10px] font-semibold uppercase tracking-[.12em] text-slate-400">Ambiti proposti</p><div className="grid gap-2 sm:grid-cols-2">
            {[...macroScope.catalog.enabledGroups, macroScope.catalog.fallback].map((group) => <label className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 transition ${macroScope.groupsConfirmed.includes(group.id) ? "border-lime-300/30 bg-lime-300/[.07]" : "border-white/[.08] bg-black/20"}`} key={group.id}>
              <input checked={macroScope.groupsConfirmed.includes(group.id)} className="size-4 accent-lime-300" onChange={(event) => onMacroGroupToggle(group.id, event.target.checked)} type="checkbox" />
              <span className="min-w-0"><span className="block text-[11px] font-medium text-slate-200">{group.label}</span><span className="mt-0.5 block text-[9px] leading-4 text-slate-600">{group.about}</span></span>
            </label>)}
          </div></div>

          {macroScope.activities.length > 0 ? <div><p className="mb-2 text-[10px] font-semibold uppercase tracking-[.12em] text-slate-400">Lavorazioni descritte</p><div className="space-y-2">{macroScope.activities.map((activity, index) => <div className="rounded-xl border border-white/[.08] bg-black/20 p-3" key={activity.id}>
            <label className="flex items-center gap-2 text-[10px] text-slate-300"><input checked={activity.included} className="size-4 accent-lime-300" onChange={(event) => onMacroActivityToggle(activity.id, event.target.checked)} type="checkbox" />Includi nello scope confermato</label>
            <Input aria-label={`Modifica lavorazione ${index + 1}`} className={`${inputClass} mt-2 h-10`} maxLength={180} onChange={(event) => onMacroActivityChange(activity.id, event.target.value)} value={activity.text} />
            <p className="mt-1.5 text-[9px] leading-4 text-slate-600">Nel testo originale: “{activity.source}”</p>
            {activity.groupIds.length > 0 && <p className="mt-1 text-[8px] font-semibold uppercase tracking-[.08em] text-cyan-100/65">{activity.groupIds.map((id) => macroScope.catalog.enabledGroups.find((group) => group.id === id)?.label ?? id).join(" · ")}</p>}
          </div>)}</div></div> : <p className="rounded-xl border border-dashed border-white/[.09] px-3 py-3 text-[10px] leading-4 text-slate-500">Nessuna attività specifica rilevata. La descrizione originale resta il perimetro della commessa.</p>}

          {macroScope.proposal.reportedProblems.length > 0 && <div className="rounded-xl border border-amber-300/15 bg-amber-300/[.035] p-3"><p className="text-[9px] font-semibold uppercase tracking-[.12em] text-amber-100/75">Problemi segnalati · non sono lavorazioni confermate</p>{macroScope.proposal.reportedProblems.map((item, index) => <p className="mt-1.5 text-[10px] leading-4 text-slate-300" key={`${item.source}-${index}`}>{item.text}</p>)}</div>}
          {macroScope.proposal.completedWork.length > 0 && <div className="rounded-xl border border-cyan-300/15 bg-cyan-300/[.035] p-3"><p className="text-[9px] font-semibold uppercase tracking-[.12em] text-cyan-100/75">Lavori indicati come già eseguiti</p>{macroScope.proposal.completedWork.map((item, index) => <p className="mt-1.5 text-[10px] leading-4 text-slate-300" key={`${item.source}-${index}`}>{item.text}</p>)}</div>}
          {macroScope.proposal.clarifications.length > 0 && <ul className="list-disc space-y-1 pl-4 text-[10px] leading-4 text-amber-100/75">{macroScope.proposal.clarifications.map((item) => <li key={item}>{item}</li>)}</ul>}
          <div className="flex flex-col gap-2 border-t border-white/[.07] pt-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-[9px] leading-4 text-slate-600">Provider: {macroScope.aiRuntime.status === "used" ? `OpenAI · ${macroScope.aiRuntime.model}` : "classificazione locale di ripiego"}. Ogni gruppo e attività viene ricontrollato dal server.</p><Button className="h-10 shrink-0 rounded-xl bg-[linear-gradient(135deg,#bfff3c,#8bdc48)] px-4 text-xs font-semibold text-[#060806]" disabled={!macroScope.groupsConfirmed.length} onClick={onConfirmMacroScope} type="button"><Check className="size-3.5" />{macroScope.confirmed ? "Conferma aggiornata" : "Conferma ambiti e lavori"}</Button></div>
        </div>}
      </FormSection>

      <FormSection
        description="Dai un nome riconoscibile alla commessa e, se già noto, indica il valore commerciale. Il valore viene registrato per il successivo controllo economico in Finanza."
        eyebrow="03 / dati commerciali"
        icon={BookOpen}
        title="Identità e valore"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field className="md:col-span-2" label={INTAKE_FIELD_LABELS.title} required proposed={proposed("title")}>
            <Input className={inputClass} maxLength={120} onChange={(event) => onChange("title", event.target.value)} placeholder="Es. Ristrutturazione interna · Via Roma" required value={draft.title} />
          </Field>
          <Field label={INTAKE_FIELD_LABELS.commercialValueAmount} proposed={proposed("commercialValueAmount")}>
            <Input className={inputClass} inputMode="decimal" maxLength={18} onChange={(event) => onChange("commercialValueAmount", event.target.value)} placeholder="Es. 14000,00" type="text" value={draft.commercialValueAmount} />
          </Field>
          <Field label={INTAKE_FIELD_LABELS.commercialValueBasis} proposed={proposed("commercialValueBasis")}>
            <select className={selectClass} onChange={(event) => onChange("commercialValueBasis", event.target.value)} value={draft.commercialValueBasis}>
              <option value="ESTIMATE">Preventivato</option>
              <option value="CONTRACTED">Accordato / contrattualizzato</option>
            </select>
          </Field>
        </div>
      </FormSection>

      <FormSection
        badge={<span className="rounded-full border border-lime-300/20 bg-lime-300/[0.06] px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-lime-200/80">Cantiere richiesto</span>}
        description="Il cliente resta facoltativo. L’ubicazione del cantiere viene verificata e diventa il riferimento per perimetro, presenze e missioni."
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
          <Field className="md:col-span-2" label={INTAKE_FIELD_LABELS.worksite} proposed={proposed("worksite")} required>
            <WorksiteLocationField
              busy={worksiteGeocodeBusy}
              candidates={worksiteCandidates}
              notice={worksiteGeocodeNotice}
              onChange={(value) => onChange("worksite", value)}
              onSelect={onSelectWorksite}
              onVerify={onVerifyWorksite}
              selected={worksiteLocation}
              value={draft.worksite}
            />
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
        description="La scadenza è un riferimento operativo; la pianificazione completa resta un passaggio dedicato."
        eyebrow="05 / pianificazione"
        icon={MapPin}
        title="Scadenza operativa"
      >
        <div className="grid gap-4">
          <Field label={INTAKE_FIELD_LABELS.dueDate} proposed={proposed("dueDate")}>
            <Input className={inputClass} onChange={(event) => onChange("dueDate", event.target.value)} placeholder="YYYY-MM-DD o da pianificare" value={draft.dueDate} />
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
  hasSourceFile: boolean;
  preview: IntakePreview | null;
  busy: boolean;
  notice: string;
  onSourceTextChange: (value: string) => void;
  onFile: (event: ChangeEvent<HTMLInputElement>) => void;
  onAnalyze: () => void;
};

function CompanyAiPanel({ sourceText, sourceFileName, hasSourceFile, preview, busy, notice, onSourceTextChange, onFile, onAnalyze }: CompanyAiPanelProps) {
  return (
    <section className="relative mx-4 mt-4 overflow-hidden rounded-[24px] border border-cyan-300/20 bg-[linear-gradient(135deg,rgba(34,211,238,0.1),rgba(8,15,16,0.88)_48%,rgba(190,255,60,0.06))] p-4 shadow-[0_24px_60px_rgba(0,0,0,0.24)] backdrop-blur-xl sm:mx-8 sm:mt-7 sm:p-6">
      <div className="pointer-events-none absolute -right-20 -top-24 size-64 rounded-full bg-cyan-300/[0.08] blur-3xl" /><div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/70 to-transparent" />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl border border-cyan-300/25 bg-cyan-300/10 text-cyan-200 shadow-[0_0_28px_rgba(34,211,238,0.15)]"><Sparkles className="size-4" /></span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-200/85">Company AI · analisi guidata</p><span className="rounded-full border border-cyan-300/20 bg-cyan-300/[0.08] px-2.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-cyan-100/80">solo proposta</span></div>
            <h2 className="mt-1 text-lg font-semibold tracking-[-0.025em] text-lime-100">Dal preventivo alla scheda operativa</h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">Company AI propone i campi leggendo solo il contenuto che mostri. Tu controlli, correggi e confermi prima di creare la commessa.</p>
          </div>
        </div>
        {preview && <div className="flex flex-wrap items-center justify-end gap-2"><span className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold ${preview.aiRuntime?.status === "used" ? "border-lime-300/30 bg-lime-300/[0.1] text-lime-200" : "border-amber-300/25 bg-amber-300/[0.08] text-amber-100"}`}>{preview.aiRuntime?.status === "used" ? "ANALISI ATTIVA" : "ANALISI GUIDATA"}</span><span className="rounded-full border border-lime-300/25 bg-lime-300/[0.09] px-3 py-1.5 text-[10px] font-semibold text-lime-200">{preview.suggestions.length} campi proposti</span></div>}
      </div>

      <div className="relative mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_235px]">
        <div>
          <label className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/80" htmlFor="commessa-source-text">Testo sorgente del preventivo</label>
          <Textarea className={`${textareaClass} min-h-[126px] rounded-[18px] border-cyan-300/20 bg-[linear-gradient(145deg,rgba(5,20,22,0.72),rgba(3,10,11,0.82))] focus-visible:border-cyan-200/70 focus-visible:ring-cyan-300/15 focus-visible:shadow-[0_0_28px_rgba(34,211,238,0.1)]`} id="commessa-source-text" onChange={(event) => onSourceTextChange(event.target.value)} placeholder="Incolla qui cliente, oggetto, indirizzo, lavorazioni, riferimenti e note del preventivo…" value={sourceText} />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="inline-flex min-w-0 max-w-full cursor-pointer items-center gap-2 rounded-xl border border-white/[0.11] bg-black/25 px-3 py-2.5 text-xs text-slate-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition hover:border-cyan-300/40 hover:bg-cyan-300/[0.06] hover:text-cyan-100"><Upload className="size-3.5 shrink-0 text-cyan-200" /><span className="truncate">{sourceFileName || "Carica originale · max 20 MB"}</span><input accept=".docx,.txt,.md,.csv,.json,.xls,.xlsx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/pdf,image/*" className="sr-only" onChange={onFile} type="file" /></label>
            <Button aria-busy={busy} className="h-11 rounded-xl bg-[linear-gradient(135deg,#bfff3c,#8bdc48)] px-4 font-semibold text-[#061012] shadow-[0_0_24px_rgba(190,255,60,0.17)] transition hover:-translate-y-0.5 hover:bg-[linear-gradient(135deg,#d3ff6d,#a4ec57)] hover:shadow-[0_0_30px_rgba(190,255,60,0.28)] disabled:cursor-not-allowed disabled:opacity-50" disabled={busy || (sourceText.trim().length < 2 && !hasSourceFile)} onClick={onAnalyze} type="button">{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}Analizza con Company AI</Button>
          </div>
          <p className="mt-3 text-[10px] leading-4 text-slate-600">Formati supportati: DOCX, XLS/XLSX, TXT, MD, CSV e JSON · massimo 20 MB. I fogli Excel vengono letti in modo protetto prima dell’analisi Company AI.</p>
          {notice && <p className="mt-3 rounded-xl border border-cyan-300/15 bg-cyan-300/[0.04] px-3 py-2.5 text-[11px] leading-5 text-cyan-100/75">{notice}</p>}
        </div>

        <div className="rounded-[20px] border border-cyan-300/15 bg-[linear-gradient(160deg,rgba(5,25,27,0.72),rgba(4,11,13,0.78))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
          <div className="flex items-center justify-between gap-3"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/75">Guardrail attivi</p><LockKeyhole className="size-3.5 text-cyan-200/80" /></div>
          <div className="mt-4 space-y-3"><div className="flex items-start gap-2.5"><CircleCheck className="mt-0.5 size-3.5 shrink-0 text-lime-300" /><span className="text-[11px] leading-4 text-slate-400">Solo proposta, nessuna scrittura diretta</span></div><div className="flex items-start gap-2.5"><CircleCheck className="mt-0.5 size-3.5 shrink-0 text-lime-300" /><span className="text-[11px] leading-4 text-slate-400">Modifica manuale sempre disponibile</span></div><div className="flex items-start gap-2.5"><CircleCheck className="mt-0.5 size-3.5 shrink-0 text-lime-300" /><span className="text-[11px] leading-4 text-slate-400">Conferma umana prima del salvataggio</span></div></div>
        </div>
      </div>

      {preview && (
        <div className="relative mt-6 border-t border-cyan-300/15 pt-5">
          <div className="flex flex-wrap items-end justify-between gap-2"><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/80">Risultato dell’analisi</p><p className="mt-1 text-xs text-slate-500">Ogni proposta resta visibile e modificabile nella scheda sottostante.</p></div><span className="rounded-full border border-white/[0.08] bg-black/20 px-2.5 py-1 font-mono text-[10px] text-slate-600">Analisi pronta</span></div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {preview.suggestions.map((suggestion) => (
              <div className="rounded-2xl border border-white/[0.08] bg-[linear-gradient(145deg,rgba(255,255,255,0.045),rgba(0,0,0,0.22))] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]" key={suggestion.key}>
                <div className="flex items-center justify-between gap-3"><span className="truncate text-[10px] font-medium text-slate-500">{suggestion.label}</span><span className="shrink-0 rounded-full border border-cyan-300/20 bg-cyan-300/[0.06] px-2 py-0.5 font-mono text-[9px] text-cyan-200">{Math.round(suggestion.confidence * 100)}%</span></div>
                <p className="mt-2 truncate text-xs text-lime-100/90">{suggestion.value || "Non rilevato"}</p>
                <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/[0.08]"><span className="block h-full rounded-full bg-gradient-to-r from-cyan-300 to-lime-300 shadow-[0_0_10px_rgba(34,211,238,0.35)]" style={{ width: `${Math.round(suggestion.confidence * 100)}%` }} /></div>
                <p className="mt-2 truncate text-[9px] uppercase tracking-[0.1em] text-slate-600">Origine: {displaySuggestionSource(suggestion.source)}</p>
              </div>
            ))}
          </div>
          {preview.workItems?.length ? <div className="relative mt-5 overflow-hidden rounded-[22px] border border-lime-300/20 bg-[linear-gradient(145deg,rgba(190,255,60,0.07),rgba(4,12,9,0.72))] p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-lime-200/80">Lavorazioni separate</p><p className="mt-1 text-xs text-slate-500">Le voci diventano elementi distinti e possono appartenere a categorie tecniche diverse.</p></div><span className="rounded-full border border-lime-300/25 bg-lime-300/[0.09] px-2.5 py-1 font-mono text-[10px] text-lime-200">{preview.workItems.length} voci</span></div><div className="mt-3 grid gap-2 md:grid-cols-2">{preview.workItems.map((item, index) => <div className="rounded-2xl border border-white/[0.08] bg-black/25 p-3.5" key={item.id}><div className="flex items-start gap-3"><span className="grid size-6 shrink-0 place-items-center rounded-lg border border-lime-300/25 bg-lime-300/[0.08] font-mono text-[9px] text-lime-200">{String(index + 1).padStart(2, "0")}</span><div className="min-w-0"><p className="text-xs font-semibold leading-5 text-lime-100">{item.label}</p><p className="mt-1 text-[11px] leading-5 text-slate-400">{item.detail}</p>{item.scope && <p className="mt-2 text-[9px] font-medium uppercase tracking-[.08em] text-cyan-100/75">{item.scope.sectionTitle} / {item.scope.groupTitle} / {item.scope.subgroupTitle}</p>}</div></div><div className="mt-3 flex flex-wrap items-center gap-2 text-[9px] uppercase tracking-[0.08em] text-slate-600"><span>{item.quantity ? `${item.quantity} ${item.unit}` : "quantità da verificare"}</span><span className="text-slate-700">·</span><span>Origine: {displaySuggestionSource(item.source)}</span></div></div>)}</div></div> : <div className="relative mt-5 rounded-2xl border border-dashed border-amber-300/20 bg-amber-300/[0.035] px-3.5 py-3 text-[11px] leading-5 text-amber-100/70">Nessuna voce separata rilevata: controlla il testo sorgente oppure inserisci manualmente le lavorazioni nella descrizione.</div>}
          {preview.knowledgePack && (
            <div className="relative mt-5 overflow-hidden rounded-[22px] border border-lime-300/20 bg-[linear-gradient(145deg,rgba(190,255,60,0.08),rgba(6,16,13,0.68)_52%,rgba(34,211,238,0.04))] p-4 shadow-[0_18px_45px_rgba(0,0,0,0.18)]">
              <div className="pointer-events-none absolute -right-12 -top-14 size-40 rounded-full bg-lime-300/[0.08] blur-3xl" />
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="relative flex items-start gap-3"><span className="grid size-9 place-items-center rounded-xl border border-lime-300/25 bg-lime-300/[0.1] text-lime-200"><BookOpen className="size-4" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-lime-200/80">Base conoscitiva attiva</p><p className="mt-1 text-sm font-semibold text-lime-100">{preview.knowledgePack.name}</p><p className="mt-1 text-[10px] leading-4 text-slate-500">{preview.knowledgePack.entryCount.toLocaleString("it-IT")} voci · supporto alla classificazione</p></div></div>
                <span className="rounded-full border border-amber-300/20 bg-amber-300/[0.06] px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-amber-100/80">da confermare</span>
              </div>
              {preview.knowledgeHints?.length ? <div className="relative mt-4"><p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-lime-100/55">Indicazioni operative · fuori dall’anagrafica</p><div className="grid gap-2 md:grid-cols-2">{preview.knowledgeHints.map((hint) => <div className="rounded-2xl border border-white/[0.08] bg-black/25 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]" key={hint.id}><div className="flex items-center justify-between gap-3"><span className="font-mono text-[10px] text-lime-200">{hint.part} · {hint.code}</span><span className="text-[10px] text-slate-500">{hint.unit || "unità da verificare"}</span></div><p className="mt-2 line-clamp-2 text-[11px] leading-5 text-slate-300">{hint.description}</p><div className="mt-2 flex items-center justify-between gap-3 text-[9px] text-slate-600"><span className="truncate">{hint.partTitle}</span><span className="shrink-0 font-mono text-cyan-200/80">{new Intl.NumberFormat("it-IT", { style: "currency", currency: hint.currency }).format(hint.price)}</span></div></div>)}</div></div> : null}
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

function SummaryRail({ draft, mode, preview, macroScope, worksiteLocation }: { draft: IntakeDraft; mode: IntakeMode; preview: IntakePreview | null; macroScope: MacroScopeSession | null; worksiteLocation: GeocodeCandidate | null }) {
  const packageScopes = [...new Set(draft.workItems.flatMap((item) => item.scope ? [`${item.scope.sectionTitle} / ${item.scope.groupTitle} / ${item.scope.subgroupTitle}`] : []))];
  const macroScopeLabels = macroScope ? macroScope.groupsConfirmed.map((id) =>
    macroScope.catalog.enabledGroups.find((group) => group.id === id)?.label
      ?? (id === macroScope.catalog.fallback.id ? macroScope.catalog.fallback.label : id),
  ) : [];
  const scopeSummary = macroScopeLabels.length
    ? `${macroScopeLabels.length} ${macroScope?.confirmed ? "ambiti confermati" : "ambiti proposti"}`
    : packageScopes.length === 1 ? packageScopes[0] : packageScopes.length > 1 ? `${packageScopes.length} ambiti tecnici` : "Da proporre o confermare";
  const keyFields = [
    { label: "Nome commessa", value: draft.title.trim(), fallback: "Da inserire" },
    { label: "Tipo commessa", value: draft.openingType, fallback: "Da scegliere" },
    { label: "Ambito tecnico", value: scopeSummary, fallback: "Da proporre o confermare", optional: true },
    { label: "Lavorazioni", value: macroScope ? `${macroScope.activities.filter((item) => item.included).length} voci confermate` : draft.workItemsText.trim() ? `${draft.workItemsText.split(/\r?\n/).filter((line) => line.trim()).length} voci` : "", fallback: "Da descrivere" },
    { label: "Cliente", value: draft.clientName.trim(), fallback: "Non ancora indicato" },
    { label: "Luogo intervento", value: worksiteLocation?.formattedAddress || draft.worksite.trim(), fallback: "Da riconoscere" },
    { label: "Scadenza", value: draft.dueDate.trim(), fallback: "Da pianificare" },
    { label: "Valore commessa", value: draft.commercialValueAmount.trim() ? `${draft.commercialValueAmount.trim()} € · ${draft.commercialValueBasis === "CONTRACTED" ? "accordato" : "preventivato"}` : "", fallback: "Facoltativo", optional: true },
  ];
  const requiredFields = keyFields.filter((field) => !field.optional);
  const filledCount = requiredFields.filter((field) => Boolean(field.value)).length;
  const progress = Math.round((filledCount / requiredFields.length) * 100);
  const sourceLabel = mode === "company-ai" ? "Company AI" : "Manuale";
  const sourceReady = mode === "manual" || Boolean(preview);

  return (
    <aside className="lg:sticky lg:top-0 lg:self-start">
      <div className="relative overflow-hidden rounded-[24px] border border-lime-300/15 bg-[linear-gradient(160deg,rgba(20,31,28,0.96),rgba(7,12,13,0.94)_62%,rgba(12,24,19,0.9))] p-4 shadow-[0_24px_58px_rgba(0,0,0,0.24)] backdrop-blur-xl sm:p-5">
        <div className="pointer-events-none absolute -right-16 -top-16 size-44 rounded-full bg-lime-300/[0.07] blur-3xl" />
        <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-lime-300/60 to-transparent" />
        <div className="relative flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/80">Riepilogo in tempo reale</p><h2 className="mt-1 text-[15px] font-semibold tracking-[-0.015em] text-lime-100">Commessa in preparazione</h2></div><span className="grid size-10 place-items-center rounded-2xl border border-lime-300/25 bg-[linear-gradient(145deg,rgba(190,255,60,0.16),rgba(190,255,60,0.03))] text-lime-200 shadow-[0_0_22px_rgba(190,255,60,0.08)]"><ClipboardCheck className="size-4" /></span></div>
        <div className="relative mt-5 rounded-2xl border border-lime-300/15 bg-[linear-gradient(145deg,rgba(190,255,60,0.07),rgba(0,0,0,0.2))] p-3.5"><div className="flex items-center justify-between gap-3"><span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-lime-100/65">Dati chiave</span><span className="rounded-full border border-lime-300/20 bg-lime-300/[0.07] px-2 py-0.5 font-mono text-[10px] text-lime-200">{filledCount}/{requiredFields.length}</span></div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.08]"><span className="block h-full rounded-full bg-gradient-to-r from-lime-300 to-cyan-300 shadow-[0_0_12px_rgba(190,255,60,0.32)] transition-all" style={{ width: `${progress}%` }} /></div><p className="mt-2 text-[10px] leading-4 text-slate-500">Il catalogo tecnico è un aiuto per leggere i lavori; non impone un’unica categoria.</p></div>
        <div className="relative mt-5 space-y-3 rounded-2xl border border-white/[0.07] bg-black/15 p-3.5">{keyFields.map((field) => <div className="flex items-start justify-between gap-3 border-b border-white/[0.06] pb-3 last:border-0 last:pb-0" key={field.label}><span className="text-[10px] text-slate-600">{field.label}</span><span className={`max-w-[58%] truncate text-right text-[11px] ${field.value ? "text-lime-100/85" : "text-slate-600"}`}>{field.value || field.fallback}</span></div>)}</div>
        <div className="relative mt-5 rounded-2xl border border-cyan-300/15 bg-[linear-gradient(145deg,rgba(34,211,238,0.055),rgba(0,0,0,0.2))] p-3.5"><p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-cyan-100/70">Controlli prima del salvataggio</p><div className="mt-4 space-y-3.5"><CheckRow complete label="Stato iniziale: Bozza" detail="La commessa non viene chiusa automaticamente" /><CheckRow complete={sourceReady} label={`Percorso: ${sourceLabel}`} detail={sourceReady ? "Origine registrata nella scheda" : "Avvia la preview per continuare"} /><CheckRow complete={Boolean(draft.title.trim())} label="Nome commessa" detail={draft.title.trim() ? "Dato pronto per la conferma" : "Campo richiesto"} /><CheckRow complete={Boolean(draft.openingType && (draft.description.trim() || draft.workItemsText.trim()))} label="Tipo e lavorazioni" detail={draft.description.trim() || draft.workItemsText.trim() ? "Contesto pronto per la conferma" : "Descrivi almeno il lavoro"} /><CheckRow complete={Boolean(worksiteLocation)} label="Luogo verificato" detail={worksiteLocation ? "Posizione e perimetro pronti al salvataggio" : "Verifica e seleziona l’indirizzo del cantiere"} /><CheckRow complete label="Conferma umana" detail="Ultimo controllo prima della scrittura" /></div></div>
        <div className="relative mt-4 flex items-start gap-2 rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.045] p-3 text-[10px] leading-4 text-cyan-100/70"><ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-cyan-200" /><span>Il codice commessa viene assegnato dal sistema al salvataggio.</span></div>
      </div>
    </aside>
  );
}

function modeHeading(mode: IntakeMode) {
  if (mode === "company-ai") return { title: "Crea da preventivo", description: "Prepara una scheda controllabile con Company AI e conferma ogni dato prima del salvataggio." };
  if (mode === "manual") return { title: "Compila manualmente", description: "Costruisci la scheda operativa con il controllo completo sui dati inseriti." };
  return { title: "Come vuoi iniziare?", description: "Scegli il punto di partenza. Ogni percorso produce la stessa scheda operativa con lavorazioni separate." };
}

export default function OperationsCommessaIntake({ open, onOpenChange, onCreated }: Props) {
  const [mode, setMode] = useState<IntakeMode>("chooser");
  const [draft, setDraft] = useState<IntakeDraft>(DEFAULT_INTAKE_DRAFT);
  const [sourceText, setSourceText] = useState("");
  const [sourceFileName, setSourceFileName] = useState("");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<IntakePreview | null>(null);
  const [macroScope, setMacroScope] = useState<MacroScopeSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [worksiteLocation, setWorksiteLocation] = useState<GeocodeCandidate | null>(null);
  const [worksiteCandidates, setWorksiteCandidates] = useState<GeocodeCandidate[]>([]);
  const [worksiteGeocodeBusy, setWorksiteGeocodeBusy] = useState(false);
  const [worksiteGeocodeNotice, setWorksiteGeocodeNotice] = useState("");
  const [visualViewport, setVisualViewport] = useState<{ height: number; offsetTop: number } | null>(null);

  const reset = useCallback(() => {
    setMode("chooser");
    setDraft(DEFAULT_INTAKE_DRAFT);
    setSourceText("");
    setSourceFileName("");
    setSourceFile(null);
    setPreview(null);
    setMacroScope(null);
    setBusy(false);
    setError("");
    setNotice("");
    setWorksiteLocation(null);
    setWorksiteCandidates([]);
    setWorksiteGeocodeBusy(false);
    setWorksiteGeocodeNotice("");
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

  useEffect(() => {
    if (!open || !window.visualViewport) return;
    const viewport = window.visualViewport;
    const syncViewport = () => setVisualViewport({
      height: Math.round(viewport.height),
      offsetTop: Math.round(viewport.offsetTop),
    });
    syncViewport();
    viewport.addEventListener("resize", syncViewport);
    viewport.addEventListener("scroll", syncViewport);
    window.addEventListener("resize", syncViewport);
    return () => {
      viewport.removeEventListener("resize", syncViewport);
      viewport.removeEventListener("scroll", syncViewport);
      window.removeEventListener("resize", syncViewport);
    };
  }, [open]);

  const updateField = (key: keyof IntakeDraft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value } as IntakeDraft));
    if (key === "description") {
      setMacroScope(null);
      setNotice("La descrizione è cambiata. Analizza e conferma di nuovo lo scope.");
    }
    if (key === "worksite") {
      setWorksiteLocation(null);
      setWorksiteCandidates([]);
      setWorksiteGeocodeNotice("");
    }
    setError("");
  };

  const toggleMacroGroup = (groupId: CompanyAiMacroScopeId, checked: boolean) => {
    setMacroScope((current) => {
      if (!current) return current;
      const isFallback = groupId === current.catalog.fallback.id;
      const groupsConfirmed = checked
        ? isFallback ? [groupId] : [...current.groupsConfirmed.filter((id) => id !== current.catalog.fallback.id), groupId]
        : current.groupsConfirmed.filter((id) => id !== groupId);
      return { ...current, groupsConfirmed, confirmed: false };
    });
    setError("");
  };

  const editMacroActivity = (activityId: string, value: string) => {
    setMacroScope((current) => current ? {
      ...current,
      confirmed: false,
      activities: current.activities.map((item) => item.id === activityId ? { ...item, text: value } : item),
    } : current);
    setError("");
  };

  const toggleMacroActivity = (activityId: string, included: boolean) => {
    setMacroScope((current) => current ? {
      ...current,
      confirmed: false,
      activities: current.activities.map((item) => item.id === activityId ? { ...item, included } : item),
    } : current);
    setError("");
  };

  const confirmMacroScope = () => {
    setMacroScope((current) => current ? { ...current, confirmed: true } : current);
    setNotice("Ambiti e lavorazioni confermati. La descrizione originale non è stata modificata.");
    setError("");
  };

  const verifyWorksite = async () => {
    const address = draft.worksite.trim();
    if (address.length < 5) {
      setError("Inserisci l’indirizzo del cantiere prima di avviare la verifica.");
      return;
    }
    setWorksiteGeocodeBusy(true);
    setWorksiteLocation(null);
    setWorksiteCandidates([]);
    setWorksiteGeocodeNotice("Stiamo verificando l’indirizzo…");
    setError("");
    try {
      const response = await fetch("/api/location/geocode", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const data = await response.json() as { candidates?: GeocodeCandidate[]; error?: string };
      if (!response.ok) {
        const message = data.error === "geocoder_not_configured"
          ? "La verifica degli indirizzi non è ancora disponibile."
          : data.error === "geocoder_unavailable"
            ? "Il servizio di riconoscimento indirizzi non risponde. Riprova tra poco."
            : "Non è stato possibile riconoscere l’indirizzo.";
        throw new Error(message);
      }
      const candidates = Array.isArray(data.candidates) ? data.candidates : [];
      setWorksiteCandidates(candidates);
      setWorksiteGeocodeNotice(candidates.length ? "Seleziona il risultato corretto per confermare il cantiere." : "Nessun risultato trovato. Completa l’indirizzo e riprova.");
    } catch (caught) {
      setWorksiteGeocodeNotice("");
      setError(caught instanceof Error && caught.message !== "Failed to fetch" ? caught.message : "Il servizio di riconoscimento indirizzi non è raggiungibile. Riprova tra poco.");
    } finally {
      setWorksiteGeocodeBusy(false);
    }
  };

  const selectWorksite = (candidate: GeocodeCandidate) => {
    setDraft((current) => ({ ...current, worksite: candidate.formattedAddress }));
    setWorksiteLocation(candidate);
    setWorksiteGeocodeNotice("Indirizzo confermato. La posizione verrà verificata anche al salvataggio.");
    setError("");
  };

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    setPreview(null);
    setMacroScope(null);
    setSourceFile(null);
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
      if (isSpreadsheetFile(file)) {
        setSourceFile(file);
        setSourceText("");
        setNotice("Excel acquisito. I fogli e le righe verranno letti quando avvii Analizza con Company AI.");
      } else if (isDocxFile(file)) {
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
      setSourceFile(null);
      setNotice("");
      setError(caught instanceof Error ? caught.message : "Il documento non è stato letto.");
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  };

  const analyzeWithCompanyAi = async () => {
    if (sourceText.trim().length < 2 && !sourceFile) {
      setError("Inserisci o incolla il contenuto del preventivo prima di avviare Company AI.");
      return;
    }
    setBusy(true);
    setError("");
    setMacroScope(null);
    setNotice("Company AI sta leggendo il preventivo e preparando una proposta controllabile…");
    try {
      const idempotencyKey = `company-ai-intake-${crypto.randomUUID()}`;
      const response = sourceFile
        ? await fetch("/api/operations/intake", (() => {
          const formData = new FormData();
          formData.append("file", sourceFile, sourceFile.name);
          formData.append("sourceName", sourceFileName);
          formData.append("idempotencyKey", idempotencyKey);
          return { method: "POST", body: formData };
        })())
        : await fetch("/api/operations/intake", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceText, sourceName: sourceFileName, idempotencyKey }) });
      const data = await response.json() as IntakePreview & { error?: string };
      if (!response.ok) throw new Error(data.error || "company_ai_preview_failed");
      setPreview(data);
      const workItems = data.draft.workItems ?? data.workItems ?? draft.workItems;
      setDraft((current) => ({ ...current, ...data.draft, workItems, workItemsText: workItems.map((item) => item.label).join("\n"), statusCode: "DRAFT" } as IntakeDraft));
      setWorksiteLocation(null);
      setWorksiteCandidates([]);
      setWorksiteGeocodeNotice("");
      setNotice(`Company AI ha proposto ${data.suggestions?.length ?? 0} campi e ${data.workItems?.length ?? data.draft.workItems?.length ?? 0} lavorazioni separate. Verifica e modifica liberamente prima della conferma.`);
    } catch (caught) {
      setNotice("");
      setError(caught instanceof Error && caught.message !== "Failed to fetch" ? caught.message : "Company AI non è raggiungibile in questo momento. Riprova tra poco.");
    } finally {
      setBusy(false);
    }
  };

  const analyzeManualScope = async () => {
    if (draft.description.trim().length < 8) {
      setError("Descrivi il lavoro con almeno 8 caratteri prima di chiedere a Company AI.");
      return;
    }
    const descriptionOriginal = draft.description;
    setBusy(true);
    setError("");
    setMacroScope(null);
    setNotice("Company AI sta analizzando la descrizione rispetto al catalogo lato server…");
    try {
      const response = await fetch("/api/operations/intake/macro-scope", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description: descriptionOriginal, idempotencyKey: `company-ai-macro-scope-${crypto.randomUUID()}` }),
      });
      const data = await response.json() as {
        previewId?: string;
        scopeV2?: CompanyAiMacroScopeProposal;
        catalog?: CompanyAiMacroScopeCatalog;
        aiRuntime?: { status?: "used" | "not_configured" | "unavailable"; model?: string };
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "company_ai_scope_preview_failed");
      if (!data.previewId || !data.scopeV2 || !data.catalog || data.scopeV2.descriptionOriginal !== descriptionOriginal) {
        throw new Error("La preview non corrisponde alla descrizione attuale. Ripeti l’analisi.");
      }
      setMacroScope({
        previewId: data.previewId,
        proposal: data.scopeV2,
        catalog: data.catalog,
        aiRuntime: {
          status: data.aiRuntime?.status ?? "unavailable",
          model: data.aiRuntime?.model ?? "gpt-4.1-mini",
        },
        groupsConfirmed: data.scopeV2.groupsProposed,
        activities: data.scopeV2.activitiesProposed.map((activity) => ({ ...activity, included: true })),
        confirmed: false,
      });
      const groupCount = data.scopeV2.groupsProposed.length;
      const activityCount = data.scopeV2.activitiesProposed.length;
      const providerLabel = data.aiRuntime?.status === "used" ? `OpenAI · ${data.aiRuntime.model ?? ""}` : "classificazione locale di ripiego";
      setNotice(`${providerLabel}: proposta ${groupCount} ambiti e ${activityCount} lavorazioni. Problemi e lavori già eseguiti restano separati. Controlla e conferma prima di salvare.`);
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
    if (draft.worksite.trim().length < 5) {
      setError("Inserisci l’indirizzo del cantiere.");
      return;
    }
    if (!worksiteLocation) {
      setError("Verifica e seleziona l’indirizzo del cantiere prima di salvare la commessa.");
      return;
    }
    if (mode === "manual" && (!macroScope || !macroScope.confirmed || macroScope.proposal.descriptionOriginal !== draft.description)) {
      setError("Analizza la descrizione con Company AI e conferma ambiti e lavorazioni prima di salvare la bozza.");
      return;
    }
    const requestedWorkItemCount = draft.workItemsText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).length;
    if (requestedWorkItemCount > 24) {
      setError("Puoi inserire al massimo 24 lavorazioni per commessa.");
      return;
    }
    const scopeSelection = mode === "company-ai" ? resolveCompanyAiScopeSelection({
      sectionId: draft.scopeSectionId,
      groupId: draft.scopeGroupId,
      subgroupId: draft.scopeSubgroupId,
    }) : null;
    const scopeParts = [draft.scopeSectionId, draft.scopeGroupId, draft.scopeSubgroupId].filter(Boolean).length;
    if (scopeParts > 0 && !scopeSelection) {
      setError("Per la classificazione complessiva completa tutti e tre i livelli, oppure lascia vuoto il campo.");
      return;
    }
    const workItems = mode === "manual" ? [] : workItemsForDraft(draft);
    if (draft.description.trim().length < 8 && workItems.length === 0) {
      setError("Descrivi il lavoro oppure inserisci almeno una lavorazione.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const macroGroupLabels = macroScope?.groupsConfirmed.map((id) => macroScope.catalog.enabledGroups.find((group) => group.id === id)?.label ?? (id === macroScope.catalog.fallback.id ? macroScope.catalog.fallback.label : id)) ?? [];
      const response = await fetch("/api/operations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...draft, workItems, commercialValue: { amount: draft.commercialValueAmount, basis: draft.commercialValueBasis }, statusCode: draft.statusCode === "PROPOSED" ? "PROPOSED" : "DRAFT", client: draft.clientName, location: draft.worksite, worksiteLocation, category: macroGroupLabels.join(" · ") || "Attività da classificare", jobType: "", specialization: "", sourceMode: mode === "company-ai" ? "COMPANY_AI" : "MANUAL", aiPreviewId: macroScope?.previewId ?? preview?.previewId, ...(macroScope ? { scopeV2: { previewId: macroScope.previewId, confirmed: macroScope.confirmed, descriptionOriginal: macroScope.proposal.descriptionOriginal, groupsConfirmed: macroScope.groupsConfirmed, activities: macroScope.activities.map(({ included, ...activity }) => ({ ...activity, included })) } } : {}), idempotencyKey: `operations-intake-${crypto.randomUUID()}` }) });
      const data = await response.json() as IntakeCreateResponse & { error?: string; message?: string };
      if (!response.ok) {
        const message = data.error === "worksite_location_confirmation_required"
          ? "Conferma l’indirizzo del cantiere prima di salvare."
          : data.error === "worksite_location_candidate_mismatch"
            ? "L’indirizzo è cambiato: esegui di nuovo la verifica e seleziona un risultato."
            : data.error === "company_ai_scope_confirmation_required" || data.error === "company_ai_scope_confirmation_invalid" || data.error === "company_ai_scope_preview_unavailable_or_consumed" || data.error === "company_ai_scope_description_mismatch"
              ? data.message ?? "La proposta di scope non è più valida. Analizza di nuovo la descrizione e conferma la proposta attuale."
            : data.error === "work_description_required" || data.error === "work_items_invalid" || data.error === "work_item_scope_invalid"
              ? data.message ?? "Controlla descrizione e classificazione delle lavorazioni."
            : data.error === "worksite_geocoder_unavailable" || data.error === "worksite_geocoder_not_configured"
              ? "Non riusciamo a verificare l’indirizzo in questo momento."
              : "La commessa non è stata salvata.";
        throw new Error(message);
      }
      onCreated(data);
      handleOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "La commessa non è stata salvata. Controlla i dati e riprova.");
    } finally {
      setBusy(false);
    }
  };

  const proposedKeys = new Set((preview?.suggestions ?? []).map((suggestion) => suggestion.key));
  const heading = modeHeading(mode);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] isolate flex items-center justify-center p-2 touch-manipulation sm:p-4" data-slot="commessa-intake-overlay" style={visualViewport ? { top: `${visualViewport.offsetTop}px`, bottom: "auto", height: `${visualViewport.height}px` } : undefined}>
      <div aria-hidden="true" className="absolute inset-0 bg-black/80 backdrop-blur-md" onMouseDown={() => handleOpenChange(false)} />
      <section aria-describedby="new-commessa-description" aria-labelledby="new-commessa-title" aria-modal="true" className="relative z-[101] flex h-[min(94%,980px)] max-h-[calc(100%-1rem)] w-full max-w-[1320px] flex-col overflow-hidden rounded-[28px] border border-lime-300/15 bg-[#070b0c] p-0 text-slate-100 shadow-[0_35px_120px_rgba(0,0,0,0.72),0_0_70px_rgba(190,255,60,0.06)]" role="dialog">
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[28px]"><div className="absolute -right-36 -top-40 size-[31rem] rounded-full bg-lime-300/[0.055] blur-3xl" /><div className="absolute -bottom-48 left-1/3 size-[28rem] rounded-full bg-cyan-300/[0.035] blur-3xl" /><div className="absolute inset-0 bg-[linear-gradient(115deg,rgba(255,255,255,0.025),transparent_22%,transparent_76%,rgba(190,255,60,0.025))]" /><div className="absolute inset-0 opacity-[0.12] [background-image:linear-gradient(rgba(255,255,255,0.07)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.07)_1px,transparent_1px)] [background-size:42px_42px] [mask-image:linear-gradient(to_bottom,black,transparent_78%)]" /></div>
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-[2px] bg-gradient-to-r from-lime-300 via-lime-200 to-cyan-300 shadow-[0_0_22px_rgba(190,255,60,0.55)]" />
        <div className="flex h-full max-h-full min-h-0 flex-col">
          <DialogHeader className="relative z-10 shrink-0 border-b border-white/[0.08] bg-black/10 px-4 pb-4 pt-5 text-left backdrop-blur-xl sm:px-8 sm:pb-5 sm:pt-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-2xl border border-lime-300/30 bg-[linear-gradient(145deg,rgba(190,255,60,0.22),rgba(190,255,60,0.03))] text-lime-200 shadow-[0_0_28px_rgba(190,255,60,0.12)]"><FolderKanban className="size-5" /></span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-lime-300">COMMESSE / NUOVA</p><span className="rounded-full border border-lime-300/25 bg-lime-300/[0.08] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-lime-200">creazione guidata</span></div><h2 className="mt-2 text-2xl font-semibold tracking-[-0.045em] text-lime-200 sm:text-[31px]" id="new-commessa-title">{heading.title}</h2><p className="mt-2 max-w-2xl text-xs leading-5 text-slate-400" id="new-commessa-description">{heading.description}</p></div></div>
              <div className="flex shrink-0 items-center gap-2"><span className="hidden rounded-full border border-cyan-300/20 bg-cyan-300/[0.06] px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-cyan-200/80 sm:inline-flex">PERCORSO ASSISTITO</span>{mode !== "chooser" && <button aria-label="Torna alla scelta del percorso" className="grid size-10 place-items-center rounded-xl border border-white/10 bg-black/25 text-slate-500 transition hover:border-lime-300/45 hover:bg-lime-300/10 hover:text-lime-100" onClick={() => { setMode("chooser"); setError(""); }} type="button"><ArrowLeft className="size-4" /></button>}<button aria-label="Chiudi nuova commessa" className="grid size-10 place-items-center rounded-xl border border-white/10 bg-black/25 text-slate-500 transition hover:border-lime-300/45 hover:bg-lime-300/10 hover:text-lime-100" onClick={() => handleOpenChange(false)} type="button"><X className="size-4" /></button></div>
            </div>
          </DialogHeader>

          {mode === "chooser" ? (
            <div className="relative z-10 min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-8">
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(290px,0.75fr)]">
                <div>
                  <div className="mb-5 flex items-end justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-lime-300/80">Scegli il percorso</p><p className="mt-2 text-sm text-slate-300">La destinazione è la stessa. Scegli come vuoi costruire la scheda.</p></div><span className="hidden rounded-full border border-white/10 bg-black/20 px-3 py-1.5 font-mono text-[10px] text-slate-600 sm:block">01 / 03</span></div>
                  <div className="space-y-3">
                    <button className="group relative w-full overflow-hidden rounded-[24px] border border-lime-300/35 bg-[linear-gradient(135deg,rgba(190,255,60,0.16),rgba(10,24,18,0.82)_48%,rgba(34,211,238,0.055))] p-5 text-left shadow-[0_22px_60px_rgba(190,255,60,0.08)] transition hover:-translate-y-0.5 hover:border-lime-200/75 hover:shadow-[0_24px_70px_rgba(190,255,60,0.14)] sm:p-6" onClick={() => { setMode("company-ai"); setMacroScope(null); setError(""); }} type="button"><div className="pointer-events-none absolute -right-12 -top-16 size-48 rounded-full bg-lime-300/[0.12] blur-3xl transition group-hover:bg-lime-300/[0.2]" /><div className="relative flex items-start gap-4"><span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-lime-300 text-[#060806] shadow-[0_0_28px_rgba(190,255,60,0.26)]"><Sparkles className="size-5" /></span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-200">Percorso consigliato</span><span className="rounded-full border border-lime-300/25 bg-lime-300/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-lime-100">Company AI</span></span><span className="mt-2 block text-xl font-semibold tracking-[-0.03em] text-lime-100">Crea da preventivo</span><span className="mt-2 block max-w-xl text-xs leading-5 text-slate-300">Carica l’originale, lascia che Company AI proponga i dati e mantieni il controllo su ogni campo.</span></span><span className="grid size-8 shrink-0 place-items-center rounded-full border border-lime-300/30 bg-lime-300/10 text-lime-100"><Check className="size-4" /></span></div><span className="relative mt-5 grid gap-2 border-t border-lime-300/15 pt-4 text-[10px] text-slate-400 sm:grid-cols-3"><span><strong className="block font-semibold text-lime-200">01</strong>Incolla il fascicolo</span><span><strong className="block font-semibold text-lime-200">02</strong>Controlla le proposte</span><span><strong className="block font-semibold text-lime-200">03</strong>Conferma la bozza</span></span></button>
                    <button className="group relative w-full overflow-hidden rounded-[24px] border border-white/[0.1] bg-[linear-gradient(135deg,rgba(255,255,255,0.045),rgba(0,0,0,0.18))] p-5 text-left transition hover:-translate-y-0.5 hover:border-lime-300/40 hover:bg-lime-300/[0.045] sm:p-6" onClick={() => { setMode("manual"); setMacroScope(null); setError(""); }} type="button"><div className="relative flex items-start gap-4"><span className="grid size-12 shrink-0 place-items-center rounded-2xl border border-white/15 bg-black/30 text-slate-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"><PenLine className="size-5" /></span><span className="min-w-0 flex-1"><span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">Inserimento diretto</span><span className="mt-2 block text-xl font-semibold tracking-[-0.03em] text-lime-100/90">Compila manualmente</span><span className="mt-2 block max-w-xl text-xs leading-5 text-slate-500">Inserisci i dati e descrivi il lavoro: Company AI propone gli ambiti e le lavorazioni.</span></span><span className="grid size-8 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.03] text-slate-500"><PenLine className="size-3.5" /></span></div></button>
                  </div>
                  <div className="mt-5 flex items-start gap-3 rounded-2xl border border-amber-300/20 bg-[linear-gradient(135deg,rgba(251,191,36,0.08),rgba(251,191,36,0.02))] p-4 text-[11px] leading-5 text-amber-100/80"><LockKeyhole className="mt-0.5 size-4 shrink-0 text-amber-200" /><span><strong className="font-semibold text-amber-100">Regola di conferma.</strong> La commessa nasce solo dopo la tua conferma finale. Company AI prepara una proposta controllabile, non una scrittura automatica.</span></div>
                </div>

                <section className="relative overflow-hidden rounded-[24px] border border-white/[0.1] bg-[linear-gradient(160deg,rgba(19,31,30,0.9),rgba(5,10,11,0.96))] p-5 shadow-[0_24px_60px_rgba(0,0,0,0.28)] sm:p-6"><div className="pointer-events-none absolute -right-12 -top-12 size-40 rounded-full bg-cyan-300/[0.07] blur-3xl" /><div className="relative flex items-start gap-3"><span className="grid size-11 place-items-center rounded-2xl border border-cyan-300/25 bg-cyan-300/10 text-cyan-200"><Sparkles className="size-4" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-200/75">Contesto assistito</p><h2 className="mt-1 text-[15px] font-semibold text-lime-100">Company AI · Commesse</h2></div></div><div className="relative mt-7 space-y-4"><div className="flex items-start gap-3"><span className="mt-1 grid size-5 shrink-0 place-items-center rounded-full border border-white/15 bg-black/30"><span className="size-1.5 rounded-full bg-slate-600" /></span><div><p className="text-xs text-slate-300">Anagrafica</p><p className="mt-1 text-[10px] leading-4 text-slate-600">In attesa del fascicolo sorgente</p></div></div><div className="flex items-start gap-3"><span className="mt-1 grid size-5 shrink-0 place-items-center rounded-full border border-lime-300/35 bg-lime-300/10"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_8px_rgba(190,255,60,0.8)]" /></span><div><p className="text-xs text-lime-100/90">Scope operativo</p><p className="mt-1 text-[10px] leading-4 text-lime-200/70">Classificazione pronta per la scheda</p></div></div><div className="flex items-start gap-3"><span className="mt-1 grid size-5 shrink-0 place-items-center rounded-full border border-cyan-300/35 bg-cyan-300/10"><span className="size-1.5 rounded-full bg-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.7)]" /></span><div><p className="text-xs text-slate-300">Controllo umano</p><p className="mt-1 text-[10px] leading-4 text-slate-600">Richiesto prima della creazione</p></div></div></div><div className="relative mt-8 flex items-start gap-2 rounded-2xl border border-white/[0.08] bg-black/25 p-3 text-[11px] leading-5 text-slate-500"><LockKeyhole className="mt-0.5 size-3.5 shrink-0 text-slate-600" />Company AI legge solo il contenuto mostrato e non genera modifiche implicite.</div></section>
              </div>
            </div>
          ) : (
            <form className="flex min-h-0 flex-1 flex-col" onFocusCapture={(event) => {
              const target = event.target;
              if (target instanceof HTMLElement && target.matches("input, textarea, select")) {
                requestAnimationFrame(() => target.scrollIntoView({ block: "nearest", inline: "nearest" }));
              }
            }} onSubmit={createJob}>
              <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
                {mode === "company-ai" && <CompanyAiPanel busy={busy} hasSourceFile={Boolean(sourceFile)} notice={notice} onAnalyze={() => void analyzeWithCompanyAi()} onFile={(event) => void handleFile(event)} onSourceTextChange={(value) => { setSourceFile(null); setSourceFileName(""); setSourceText(value); setError(""); }} preview={preview} sourceFileName={sourceFileName} sourceText={sourceText} />}
                <div className="relative z-10 grid gap-6 p-4 sm:p-7 lg:grid-cols-[minmax(0,1fr)_310px]"><div className="min-w-0"><IntakeFields analysisNotice={mode === "manual" ? notice : ""} analyzingWork={busy} draft={draft} macroScope={macroScope} mode={mode} onAnalyzeWork={() => void analyzeManualScope()} onChange={updateField} onConfirmMacroScope={confirmMacroScope} onMacroActivityChange={editMacroActivity} onMacroActivityToggle={toggleMacroActivity} onMacroGroupToggle={toggleMacroGroup} onSelectWorksite={selectWorksite} onVerifyWorksite={verifyWorksite} proposedKeys={proposedKeys} worksiteCandidates={worksiteCandidates} worksiteGeocodeBusy={worksiteGeocodeBusy} worksiteGeocodeNotice={worksiteGeocodeNotice} worksiteLocation={worksiteLocation} /></div><SummaryRail draft={draft} macroScope={macroScope} mode={mode} preview={preview} worksiteLocation={worksiteLocation} /></div>
                {error && <div className="relative z-10 mx-4 mb-5 flex items-start gap-3 rounded-2xl border border-rose-300/25 bg-[linear-gradient(135deg,rgba(244,63,94,0.1),rgba(244,63,94,0.035))] px-4 py-3.5 text-xs leading-5 text-rose-100 shadow-[0_14px_30px_rgba(0,0,0,0.16)] sm:mx-7"><span className="mt-1 size-1.5 shrink-0 rounded-full bg-rose-300 shadow-[0_0_8px_rgba(251,113,133,0.8)]" />{error}</div>}
              </div>
              <div className="relative z-10 flex shrink-0 flex-col gap-4 border-t border-lime-300/10 bg-[linear-gradient(180deg,rgba(16,27,24,0.94),rgba(6,11,12,0.98))] px-4 py-4 shadow-[0_-18px_45px_rgba(0,0,0,0.18)] sm:flex-row sm:items-center sm:justify-between sm:px-8"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl border border-lime-300/25 bg-lime-300/[0.08] text-lime-200 shadow-[0_0_18px_rgba(190,255,60,0.07)]"><ShieldCheck className="size-3.5" /></span><div><p className="text-[11px] font-semibold text-lime-100/90">Conferma controllata</p><p className="mt-0.5 text-[10px] text-slate-600">{mode === "company-ai" ? "Proposte verificabili · conferma umana richiesta" : macroScope?.confirmed ? "Scope confermato · salva la commessa in bozza" : "Analizza e conferma gli ambiti prima del salvataggio"}</p></div></div><div className="flex flex-col-reverse gap-2 sm:flex-row"><Button className="h-11 rounded-xl border-white/10 bg-transparent px-4 text-slate-400 hover:border-lime-300/25 hover:bg-lime-300/[0.06] hover:text-lime-100" onClick={() => handleOpenChange(false)} type="button" variant="outline">Annulla</Button><Button className="h-11 rounded-xl bg-[linear-gradient(135deg,#bfff3c,#8bdc48)] px-5 font-semibold text-[#060806] shadow-[0_0_26px_rgba(190,255,60,0.17)] transition hover:-translate-y-0.5 hover:bg-[linear-gradient(135deg,#d3ff6d,#a4ec57)] hover:shadow-[0_0_34px_rgba(190,255,60,0.28)]" disabled={busy || (mode === "manual" && !macroScope?.confirmed)} type="submit">{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : mode === "company-ai" ? <Check className="size-3.5" /> : <Save className="size-3.5" />}{mode === "company-ai" ? "Conferma dati e crea commessa" : "Salva commessa in bozza"}</Button></div></div>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
