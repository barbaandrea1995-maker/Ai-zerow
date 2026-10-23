"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowLeft,
  Boxes,
  BriefcaseBusiness,
  CalendarClock,
  Check,
  CheckCircle2,
  ClipboardCheck,
  CircleGauge,
  CircleDollarSign,
  FileText,
  Flag,
  HardHat,
  Layers3,
  LoaderCircle,
  MapPin,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import Image from "next/image";
import Link from "@/components/app-link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useAuthorityAccess } from "@/components/authority-access-provider";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import JobCommercialJourney from "@/components/job-commercial-journey";
import JobCommercialTermsPanel from "@/components/job-commercial-terms-panel";
import { inventoryUnitForCode } from "@/lib/inventory-contract";
import { composeRapportinoNarrative, normalizeRapportinoAnswers } from "@/lib/operations-contract";
import type { GeocodeCandidate } from "@/lib/location-intelligence/provider-types";

type WorkspaceRecord = {
  id: string;
  canonicalCode?: string;
  createdAt?: string;
  updatedAt?: string;
  module: string;
  recordType: string;
  title: string;
  detail: string;
  meta: string;
  status: string;
  progress: number;
  payload?: Record<string, unknown>;
};

type WorkspaceSection = {
  status: "readback" | "empty" | "deferred";
  count: number;
  records: WorkspaceRecord[];
};

type CompletionRequirement = {
  key: string;
  label: string;
  complete: boolean;
  detail: string;
};

type RapportinoReadback = {
  reportId: string;
  answers: string[];
  status: "EMPTY" | "DRAFT" | "SUBMITTED" | "APPROVED" | "CHANGES_REQUESTED";
  reportDate: string;
  dayAlreadyApproved: boolean;
  draft: string;
  narrative: string;
  fields: Array<{
    key: string;
    label: string;
    value: string;
    status: "known" | "missing" | "optional";
    source: string;
  }>;
  completeness: {
    ready: boolean;
    missing: string[];
    questions: string[];
  };
  review: {
    status: "PENDING" | "APPROVED" | "CHANGES_REQUESTED";
    note: string;
    reviewedAt: string;
    reviewedBy: string;
  };
};

type WorkspacePayload = {
  job: WorkspaceRecord & { payload?: Record<string, unknown> };
  workspace: {
    sections: {
      activities: WorkspaceSection;
      planning: WorkspaceSection;
      resources: WorkspaceSection;
      materials: WorkspaceSection;
      field: WorkspaceSection;
      rapportino: WorkspaceSection;
      control: WorkspaceSection;
      evidence: WorkspaceSection;
    };
    journey: Array<{
      key: string;
      label: string;
      status: "readback" | "empty" | "deferred";
    }>;
    completion: { ready: boolean; requirements: CompletionRequirement[] };
    options?: {
      commercial?: {
        openingTypes: Array<{ value: string; label: string }>;
        priorities: Array<{ value: "HIGH" | "STANDARD" | "LOW"; label: string }>;
        scopeSections: Array<{
          id: string;
          title: string;
          groups: Array<{ id: string; title: string; subgroups: Array<{ id: string; title: string }> }>;
        }>;
      };
      assignment?: {
        people: Array<{ id: string; actorId: string; label: string; role: string; roles: string[]; eligibleRoleCodes: string[] }>;
        teams: Array<{ id: string; label: string; eligibleRoleCodes: string[] }>;
        roles: Array<{ value: string; label: string; target: "person" | "team" }>;
      };
    };
    statusTransitions?: Array<{ statusCode: string; label: string; actionLabel: string }>;
    rapportino: RapportinoReadback;
    rapportinoHistory?: Array<{
      reportId: string;
      status: string;
      reportDate?: string;
      answers?: string[];
      text: string;
      narrative: string;
      note: string;
      at: string;
      submittedBy: string;
      reviewedBy: string;
    }>;
  };
  readback?: { status?: string; version?: number };
  mutation?: { action: string; eventId?: string; version?: number; readback?: string };
  message?: string;
};

type CommercialDetails = {
  clientName: string;
  clientTaxId: string;
  clientContact: string;
  clientPhone: string;
  clientEmail: string;
  clientReference: string;
  clientAddress: string;
  accessNotes: string;
  cig: string;
  cup: string;
  openingType: string;
  priority: "HIGH" | "STANDARD" | "LOW";
  scopeSectionId: string;
  scopeGroupId: string;
  scopeSubgroupId: string;
};

const EMPTY_COMMERCIAL_DETAILS: CommercialDetails = {
  clientName: "",
  clientTaxId: "",
  clientContact: "",
  clientPhone: "",
  clientEmail: "",
  clientReference: "",
  clientAddress: "",
  accessNotes: "",
  cig: "",
  cup: "",
  openingType: "",
  priority: "STANDARD",
  scopeSectionId: "",
  scopeGroupId: "",
  scopeSubgroupId: "",
};

type ActionKind =
  | "details"
  | "activity"
  | "assign"
  | "evidence"
  | "report"
  | "progress"
  | null;

const REPORT_BLOCKER_DETAILS: Record<
  string,
  { title: string; detail: string; destination: "details" | "assignment" | "attendance" }
> = {
  job: {
    title: "Completa l’identità della commessa",
    detail: "Il titolo della commessa non è sufficiente per intestare il rapporto.",
    destination: "details",
  },
  worksite: {
    title: "Verifica il luogo della commessa",
    detail: "Indirizzo, geocodifica e geofence devono riferirsi allo stesso luogo verificato.",
    destination: "details",
  },
  assignment: {
    title: "Indica responsabile o squadra",
    detail: "Serve un’assegnazione operativa per collegare il consuntivo alla squadra corretta.",
    destination: "assignment",
  },
  attendance: {
    title: "Registra la presenza del turno",
    detail: "Non risultano timbrature collegate a questa giornata.",
    destination: "attendance",
  },
  attendance_exit: {
    title: "Registra l’uscita del turno",
    detail: "La presenza è ancora aperta: chiudi il turno da Presenze prima dell’invio.",
    destination: "attendance",
  },
};

const REPORT_CHAT_STEPS = [
  {
    title: "Attività svolte ed esito",
    prompt: "Quali lavori avete completato oggi e qual è stato il risultato?",
    placeholder: "Indica le lavorazioni concluse e l’esito osservato…",
  },
  {
    title: "Criticità e sicurezza",
    prompt: "Ci sono stati problemi, ritardi, rischi o materiali mancanti? Se no, scrivi “Nessuna”.",
    placeholder: "Descrivi l’eventuale criticità e come è stata gestita…",
  },
  {
    title: "Prossimi passi e richieste",
    prompt: "Cosa resta da fare o deve sapere l’ufficio per il prossimo turno? Se nulla, scrivi “Nessuno”.",
    placeholder: "Indica attività residue, materiali o decisioni necessarie…",
  },
] as const;

function reportAnswersFor(narrative: string, savedAnswers?: unknown): [string, string, string] {
  const saved = normalizeRapportinoAnswers(savedAnswers);
  if (saved) return saved;
  const labels = REPORT_CHAT_STEPS.map((step) => `${step.title.toLocaleUpperCase("it-IT")}:`);
  if (labels.every((label) => narrative.toLocaleUpperCase("it-IT").includes(label))) {
    return labels.map((label, index) => {
      const upperNarrative = narrative.toLocaleUpperCase("it-IT");
      const start = upperNarrative.indexOf(label) + label.length;
      const nextLabel = labels[index + 1];
      const end = nextLabel ? upperNarrative.indexOf(nextLabel, start) : narrative.length;
      return narrative.slice(start, end < 0 ? undefined : end).trim();
    }) as [string, string, string];
  }
  return [narrative.trim(), "", ""];
}

function statusTone(status: string) {
  const value = status.toUpperCase();
  if (
    [
      "ACTIVE",
      "IN CORSO",
      "DONE",
      "COMPLETED",
      "COMPLETATA",
      "CLOSED",
      "CHIUSA",
      "VERIFIED_SITES_READBACK",
      "ASSIGNED",
      "SUBMITTED",
      "APPROVED",
    ].includes(value)
  )
    return "border-lime-300/25 bg-lime-300/10 text-lime-200";
  if (["BLOCKED", "BLOCCATA"].includes(value))
    return "border-rose-300/25 bg-rose-300/10 text-rose-200";
  if (["DRAFT", "BOZZA", "QUEUED", "PROPOSTA", "DA PREPARARE", "CHANGES_REQUESTED"].includes(value))
    return "border-amber-300/25 bg-amber-300/10 text-amber-200";
  return "border-cyan-300/25 bg-cyan-300/10 text-cyan-200";
}

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "IN CORSO",
  ANNULLATA: "ANNULLATA",
  ASSIGNED: "ASSEGNATO",
  APPROVED: "APPROVATO",
  APPROVATA: "APPROVATA",
  BLOCKED: "BLOCCATO",
  BOZZA: "BOZZA",
  CLOSED: "CHIUSA",
  COMPLETED: "COMPLETATO",
  COMPLETATA: "COMPLETATA",
  CONFLICTED: "CONFLITTO",
  DRAFT: "BOZZA",
  DONE: "COMPLETATO",
  IN_REVIEW: "IN VERIFICA",
  "IN CORSO": "IN CORSO",
  OPEN: "APERTO",
  PLANNED: "PIANIFICATA",
  PIANIFICATA: "PIANIFICATA",
  PUBLISHED: "PUBBLICATO",
  PROPOSED: "IN PROPOSTA",
  PROPOSTA: "IN PROPOSTA",
  REQUESTED: "RICHIESTO",
  SUBMITTED: "INVIATO",
  VERIFIED_SITES_READBACK: "VERIFICATO",
};

function displayStatus(value: string) {
  const normalized = value.trim().toUpperCase();
  return STATUS_LABELS[normalized] ?? value.replaceAll("_", " ");
}

function displayRecordType(value: string) {
  const labels: Record<string, string> = {
    attendance: "Presenza",
    evidence: "Evidenza",
    material_request: "Richiesta materiale",
    plan: "Piano operativo",
    rapportino: "Rapportino",
    transport: "Trasporto",
  };
  return labels[value] ?? value.replaceAll("_", " ");
}

const ACTION_LABELS: Record<string, string> = {
  add_activity: "Attività aggiunta",
  add_evidence: "Evidenza aggiunta",
  add_report: "Rapportino aggiunto",
  save_rapportino: "Bozza rapportino salvata",
  submit_rapportino: "Rapportino inviato in ufficio",
  resubmit_rapportino: "Rapportino corretto reinviato",
  review_rapportino: "Revisione rapportino registrata",
  assign: "Risorse assegnate",
  set_status: "Stato aggiornato",
  update_details: "Scheda aggiornata",
  update_progress: "Avanzamento aggiornato",
};

function displayAction(value: string) {
  return ACTION_LABELS[value] ?? "Scheda aggiornata";
}

function rapportinoStatusLabel(status: RapportinoReadback["status"]) {
  if (status === "SUBMITTED") return "INVIATO";
  if (status === "APPROVED") return "APPROVATO";
  if (status === "CHANGES_REQUESTED") return "INTEGRAZIONE RICHIESTA";
  if (status === "DRAFT") return "BOZZA";
  return "NUOVO";
}

function compactDescription(value: string, maxLength = 260) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  const sentenceEnd = normalized.slice(0, maxLength).lastIndexOf(". ");
  const cutoff = sentenceEnd > 120 ? sentenceEnd + 1 : maxLength;
  return `${normalized.slice(0, cutoff).trim()}…`;
}

function quoteSummaryFromDescription(value: string) {
  const lines = value.split(/\r?\n/).map((line) => line.trim());
  const objectHeading = lines.findIndex((line) => /^OGGETTO(?: DEL PREVENTIVO)?$/i.test(line));
  if (objectHeading < 0) return null;
  const objectLine = lines.findIndex((line, index) => index > objectHeading && line.length > 0);
  if (objectLine < 0) return null;
  const sectionHeading = lines.findIndex((line, index) => index > objectLine && /^DESCRIZIONE DELLE LAVORAZIONI$/i.test(line));
  const summaryEnd = sectionHeading >= 0 ? sectionHeading : Math.min(lines.length, objectLine + 3);
  const summary = lines.slice(objectLine + 1, summaryEnd).filter(Boolean).join(" ");
  return {
    object: lines[objectLine].slice(0, 240),
    summary: summary.slice(0, 700),
  };
}

function valueOr(value: unknown, fallback = "—") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function workScopeLabel(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const scope = value as Record<string, unknown>;
  const parts = [scope.sectionTitle, scope.groupTitle, scope.subgroupTitle].filter((part): part is string => typeof part === "string" && part.trim().length > 0);
  return parts.length === 3 ? parts.join(" / ") : "";
}

function formatCommercialDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return "Da pianificare";
  const raw = value.trim();
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T12:00:00`)
    : new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return new Intl.DateTimeFormat("it-IT", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(parsed);
}

function InfoRow({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof MapPin;
}) {
  return (
    <div className="flex items-start gap-3 border-b border-white/[0.07] py-3 last:border-0 last:pb-0">
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border border-white/10 bg-black/25 text-slate-500">
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-slate-600">
          {label}
        </p>
        <p className="mt-1 break-words text-xs text-slate-200">{value}</p>
      </div>
    </div>
  );
}

function CompletionGate({
  completion,
}: {
  completion: WorkspacePayload["workspace"]["completion"];
}) {
  const missing = completion.requirements.filter(
    (requirement) => !requirement.complete,
  ).length;
  const requirementLabels: Record<string, string> = {
    classification: "Ambito della commessa",
    description: "Descrizione del lavoro",
    worksite: "Luogo di intervento",
  };
  return (
    <section className="relative overflow-hidden rounded-[24px] border border-amber-300/15 bg-[linear-gradient(145deg,rgba(38,31,18,0.7),rgba(11,14,13,0.94)_62%,rgba(22,29,20,0.78))] p-5 shadow-[0_20px_55px_rgba(0,0,0,0.18)] sm:p-6">
      <div className="pointer-events-none absolute -right-20 -top-24 size-56 rounded-full bg-amber-300/[0.055] blur-3xl" />
      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-2xl border border-amber-300/25 bg-amber-300/[0.08] text-amber-200">
            <ShieldCheck className="size-4" />
          </span>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-200/75">
              Pronta per la chiusura
            </p>
            <h2 className="mt-1 text-[15px] font-semibold text-slate-100">
              Cosa manca per chiudere
            </h2>
            <p className="mt-1 max-w-2xl text-[11px] leading-5 text-slate-500">
              La commessa è pronta per la chiusura quando dati, attività,
              assegnazioni, evidenze e rapportino sono completi.
            </p>
          </div>
        </div>
        <span
          className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${completion.ready ? "border-lime-300/25 bg-lime-300/10 text-lime-200" : "border-amber-300/25 bg-amber-300/10 text-amber-200"}`}
        >
          {completion.ready
            ? "Pronta alla verifica"
            : `${missing} controlli aperti`}
        </span>
      </div>
      <div className="relative mt-5 grid gap-2 sm:grid-cols-2">
        {completion.requirements.map((requirement) => (
          <div
            className={`rounded-2xl border px-3.5 py-3 ${requirement.complete ? "border-lime-300/15 bg-lime-300/[0.035]" : "border-amber-300/15 bg-amber-300/[0.035]"}`}
            key={requirement.key}
          >
            <div className="flex items-center gap-2.5">
              <span
                className={`grid size-5 place-items-center rounded-full border ${requirement.complete ? "border-lime-300/35 bg-lime-300/10 text-lime-200" : "border-amber-300/30 text-amber-200"}`}
              >
                {requirement.complete ? (
                  <Check className="size-3" />
                ) : (
                  <span className="size-1.5 rounded-full bg-current" />
                )}
              </span>
              <span className="text-[11px] font-medium text-slate-200">
                {requirementLabels[requirement.key] ?? requirement.label}
              </span>
            </div>
            <p className="mt-1.5 pl-7 text-[10px] leading-4 text-slate-500">
              {requirement.detail}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

type JobFinanceProjection = {
  status: "NOT_AVAILABLE" | "PARTIAL" | "AVAILABLE";
  currencies: Array<{
    currency: string;
    expenseMinor: number;
    revenueMinor: number;
    marginMinor: number;
    openCommitmentMinor: number | null;
    payableOutstandingMinor: number | null;
    receivableOutstandingMinor: number | null;
    status: "PARTIAL" | "AVAILABLE";
  }>;
  pendingCount: number;
};

type JobStockReadback = {
  register: { id: string; status: string; version: number; openedAt: string; closedAt: string | null };
  balances: Array<{ inventoryItemId: string; sku: string; name: string; unit: string; onHand: number; version: number; updatedAt: string }>;
  movements: Array<{ id: string; movementType: string; quantity: number; sourceType: string; note: string; createdAt: string }>;
  summary: { itemCount: number; positiveItemCount: number; movementCount: number; hasStock: boolean };
  reportDate: string;
  todayReconciliation: StockReconciliation | null;
  reconciliations: StockReconciliation[];
  readback: { status: "verified"; scope: "tenant"; registerVersion: number };
};

type StockReconciliation = {
  id: string;
  status: string;
  version: number;
  reportDate: string;
  confirmedAt: string;
  confirmedBy: string;
  lines: Array<{
    inventoryItemId: string;
    sku: string;
    name: string;
    unit: string;
    before: number;
    consumed: number;
    remaining: number;
  }>;
  createdAt: string;
};

function parseStockQuantityInput(value: string) {
  return Number(value.trim().replace(",", "."));
}

function formatStockQuantity(value: number) {
  return value.toLocaleString("it-IT", { maximumFractionDigits: 3 });
}

function stockQuantityStep(unitCode: string) {
  const decimals = inventoryUnitForCode(unitCode)?.decimals ?? 3;
  return String(10 ** -decimals);
}

function JobStockPanel({ jobId, refreshToken }: { jobId: string; refreshToken: number }) {
  const [stock, setStock] = useState<JobStockReadback | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const load = useCallback(async () => {
    setState("loading");
    try {
      const response = await fetch(`/api/operations/jobs/${encodeURIComponent(jobId)}/stock`, { cache: "no-store" });
      if (!response.ok) throw new Error("job_stock_unavailable");
      setStock(await response.json() as JobStockReadback);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [jobId]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, refreshToken]);

  return <section className="overflow-hidden rounded-[22px] border border-cyan-300/15 bg-[linear-gradient(145deg,rgba(8,24,24,.76),rgba(6,11,10,.97))] p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-xl border border-cyan-300/20 bg-cyan-300/[.07] text-cyan-100"><Boxes className="size-4" /></span><div className="min-w-0"><p className="text-[9px] font-semibold uppercase tracking-[.18em] text-cyan-100/70">MAGAZZINO DI COMMESSA</p><h2 className="mt-1 text-[15px] font-semibold text-slate-100">Materiali presenti sul lavoro</h2><p className="mt-1 max-w-2xl text-[10px] leading-5 text-slate-500">Registro server-side separato dal deposito. Ritiri e consegne accreditano qui le giacenze; consumi e rientri restano movimenti tracciati.</p></div></div>
      <div className="flex items-center gap-2"><span className={`rounded-full border px-2.5 py-1 text-[8px] font-semibold uppercase tracking-[.1em] ${stock?.register.status === "ACTIVE" ? "border-lime-300/20 bg-lime-300/[.05] text-lime-100" : "border-white/10 text-slate-500"}`}>{stock?.register.status === "ACTIVE" ? "ATTIVO" : "REGISTRO"}</span><button aria-label="Aggiorna magazzino di commessa" className="grid size-9 place-items-center rounded-xl border border-white/10 text-slate-400 hover:border-cyan-300/20 hover:text-cyan-100" disabled={state === "loading"} onClick={() => void load()} type="button"><RefreshCw className={`size-3.5 ${state === "loading" ? "animate-spin" : ""}`} /></button></div>
    </div>
    {state === "loading" && <p className="mt-4 flex items-center gap-2 text-[10px] text-slate-500"><LoaderCircle className="size-3.5 animate-spin" />Rilettura delle giacenze…</p>}
    {state === "error" && <p className="mt-4 rounded-xl border border-amber-300/15 bg-amber-300/[.03] p-3 text-[10px] leading-5 text-amber-100/75">Il registro non è leggibile in questo momento. Nessuna giacenza viene ricostruita o sostituita con dati locali.</p>}
    {state === "ready" && stock && <>
      <div className="mt-4 grid grid-cols-3 gap-2"><div className="rounded-xl border border-white/[.06] bg-black/20 p-3"><p className="text-[8px] uppercase tracking-[.12em] text-slate-600">Articoli presenti</p><p className="mt-1 font-mono text-sm text-slate-100">{stock.summary.positiveItemCount}</p></div><div className="rounded-xl border border-white/[.06] bg-black/20 p-3"><p className="text-[8px] uppercase tracking-[.12em] text-slate-600">Movimenti</p><p className="mt-1 font-mono text-sm text-slate-100">{stock.summary.movementCount}</p></div><div className="rounded-xl border border-white/[.06] bg-black/20 p-3"><p className="text-[8px] uppercase tracking-[.12em] text-slate-600">Readback</p><p className="mt-1 font-mono text-[10px] text-lime-100">VERIFICATO</p></div></div>
      {stock.summary.hasStock ? <div className="mt-3 divide-y divide-white/[.06] overflow-hidden rounded-xl border border-white/[.07] bg-black/20">{stock.balances.filter((row) => row.onHand !== 0).slice(0, 8).map((row) => <div className="flex items-center justify-between gap-3 px-3 py-2.5" key={row.inventoryItemId}><div className="min-w-0"><p className="truncate text-[10px] font-medium text-slate-200">{row.name}</p><p className="mt-0.5 truncate font-mono text-[8px] text-slate-600">{row.sku} · v{row.version}</p></div><span className={`shrink-0 font-mono text-[11px] ${row.onHand > 0 ? "text-cyan-100" : "text-amber-100"}`}>{row.onHand.toLocaleString("it-IT", { maximumFractionDigits: 3 })} {row.unit}</span></div>)}</div> : <p className="mt-4 rounded-xl border border-dashed border-white/[.08] p-5 text-center text-[10px] leading-5 text-slate-600">Registro attivo · nessuna giacenza. Il primo ritiro diretto o la prima consegna confermata comparirà qui.</p>}
      {stock.movements.length > 0 && <details className="group mt-3 rounded-xl border border-white/[.06] bg-black/15"><summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 marker:hidden"><span className="text-[9px] font-medium text-slate-400">Ultimi movimenti · {stock.summary.movementCount}</span><span className="text-[8px] text-slate-600 group-open:hidden">Apri</span><span className="hidden text-[8px] text-slate-600 group-open:inline">Chiudi</span></summary><div className="space-y-2 border-t border-white/[.06] p-3">{stock.movements.slice(0, 6).map((movement) => <div className="flex items-start justify-between gap-3 rounded-lg border border-white/[.05] bg-black/20 px-3 py-2" key={movement.id}><div className="min-w-0"><p className="text-[9px] font-medium text-slate-300">{movement.movementType === "TRANSFER_IN" ? "Ingresso in commessa" : movement.movementType}</p><p className="mt-0.5 truncate text-[8px] text-slate-600">{movement.note}</p></div><span className={`shrink-0 font-mono text-[9px] ${movement.quantity >= 0 ? "text-lime-100" : "text-amber-100"}`}>{movement.quantity >= 0 ? "+" : ""}{movement.quantity.toLocaleString("it-IT", { maximumFractionDigits: 3 })}</span></div>)}</div></details>}
    </>}
  </section>;
}

function JobFinancePanel({ jobId }: { jobId: string }) {
  const [projection, setProjection] = useState<JobFinanceProjection | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    let active = true;
    void fetch(`/api/finance/entries?jobId=${encodeURIComponent(jobId)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("finance_unavailable");
        const body = await response.json() as { projection: JobFinanceProjection };
        if (active) { setProjection(body.projection); setState("ready"); }
      })
      .catch(() => { if (active) setState("error"); });
    return () => { active = false; };
  }, [jobId]);
  const format = (value: number | null, currency: string) => {
    if (value === null) return "Non disponibile";
    try { return new Intl.NumberFormat("it-IT", { style: "currency", currency }).format(value / 100); } catch { return `${(value / 100).toFixed(2)} ${currency}`; }
  };
  return <section className="carbon-card rounded-[22px] p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[9px] font-semibold uppercase tracking-[.18em] text-lime-300/65">FINANZA DI COMMESSA</p><h2 className="mt-1 text-[15px] font-semibold text-slate-100">Conto economico gestionale</h2><p className="mt-1 max-w-2xl text-[10px] leading-5 text-slate-500">Proiezione server-side del registro Finance. Documenti, proposte e fatti confermati restano separati.</p></div><Link className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-lime-300/20 bg-lime-300/[.05] px-3 text-[9px] font-semibold text-lime-100" href={`/finance?jobId=${encodeURIComponent(jobId)}`}><CircleDollarSign className="size-3.5" />Apri Finance</Link></div>
    {state === "loading" && <p className="mt-5 flex items-center gap-2 text-[10px] text-slate-500"><LoaderCircle className="size-3.5 animate-spin" />Lettura del ledger…</p>}
    {state === "error" && <p className="mt-4 rounded-xl border border-amber-300/15 bg-amber-300/[.03] p-3 text-[10px] text-amber-100/75">La proiezione Finance non è disponibile. Nessun importo viene sostituito con zero.</p>}
    {state === "ready" && projection?.status === "NOT_AVAILABLE" && <p className="mt-4 rounded-xl border border-dashed border-white/[.08] p-5 text-center text-[10px] text-slate-600">Non risultano fatti economici confermati per questa commessa.</p>}
    {state === "ready" && projection && projection.currencies.map((row) => <div className="mt-4 rounded-xl border border-white/[.07] bg-black/20 p-3.5" key={row.currency}><div className="flex items-center justify-between gap-2"><p className="font-mono text-[10px] text-cyan-100">{row.currency}</p><span className={`rounded-full border px-2 py-1 text-[7px] font-semibold ${row.status === "AVAILABLE" ? "border-lime-300/20 text-lime-100" : "border-amber-300/20 text-amber-100"}`}>{row.status === "AVAILABLE" ? "DISPONIBILE" : "PARZIALE"}</span></div><div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-3">{[
      ["Ricavi", format(row.revenueMinor, row.currency)],
      ["Costi", format(row.expenseMinor, row.currency)],
      ["Margine", format(row.marginMinor, row.currency)],
      ["Impegni aperti", format(row.openCommitmentMinor, row.currency)],
      ["Da incassare", format(row.receivableOutstandingMinor, row.currency)],
      ["Da pagare", format(row.payableOutstandingMinor, row.currency)],
    ].map(([label, value]) => <div className="rounded-lg border border-white/[.06] bg-black/20 p-2.5" key={label}><p className="text-[7px] font-semibold uppercase tracking-[.12em] text-slate-600">{label}</p><p className={`mt-1 font-mono text-[10px] ${value === "Non disponibile" ? "text-slate-600" : "text-slate-200"}`}>{value}</p></div>)}</div></div>)}
    {state === "ready" && projection && projection.pendingCount > 0 && <p className="mt-3 rounded-lg border border-amber-300/15 bg-amber-300/[.03] p-2.5 text-[9px] text-amber-100/75">{projection.pendingCount} registrazioni attendono approvazione e non sono incluse nei totali.</p>}
  </section>;
}

export default function OperationsJobWorkspace({
  canWriteOperations,
  canWriteReport,
  canReviewReport,
  canReadFinance,
  canReadWarehouse,
  jobId,
}: {
  canWriteOperations: boolean;
  canWriteReport: boolean;
  canReviewReport: boolean;
  canReadFinance: boolean;
  canReadWarehouse: boolean;
  jobId: string;
}) {
  const router = useRouter();
  const { capabilities } = useAuthorityAccess();
  const canOpenOperationsIndex = capabilities.has("operations.index.read");
  const searchParams = useSearchParams();
  const openReportFromQuery = searchParams.get("open") === "rapportino";
  const autoOpenedReportJobRef = useRef("");
  const [payload, setPayload] = useState<WorkspacePayload | null>(null);
  const [mutationBusy, setMutationBusy] = useState(false);
  const mutationInFlight = useRef(false);
  const mutationKeys = useRef(new Map<string, string>());
  const [state, setState] = useState<
    "loading" | "ready" | "unauthenticated" | "forbidden" | "missing" | "error"
  >("loading");
  const [actionOpen, setActionOpen] = useState<ActionKind>(null);
  const [toast, setToast] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [client, setClient] = useState("");
  const [commercialDetails, setCommercialDetails] = useState<CommercialDetails>(EMPTY_COMMERCIAL_DETAILS);
  const [location, setLocation] = useState("");
  const [worksiteCandidates, setWorksiteCandidates] = useState<GeocodeCandidate[]>([]);
  const [selectedWorksite, setSelectedWorksite] = useState<GeocodeCandidate | null>(null);
  const [worksiteGeocoding, setWorksiteGeocoding] = useState(false);
  const [dueDate, setDueDate] = useState("");
  const [activityTitle, setActivityTitle] = useState("");
  const [activityDetail, setActivityDetail] = useState("");
  const [activityOwner, setActivityOwner] = useState("");
  const [activityDueDate, setActivityDueDate] = useState("");
  const [assignmentSelection, setAssignmentSelection] = useState("");
  const [assignmentRole, setAssignmentRole] = useState("RESPONSABILE_OPERATIVO");
  const [evidenceTitle, setEvidenceTitle] = useState("");
  const [evidenceDetail, setEvidenceDetail] = useState("");
  const [reportText, setReportText] = useState("");
  const [reportAnswers, setReportAnswers] = useState<[string, string, string]>(["", "", ""]);
  const [reportChatStep, setReportChatStep] = useState(0);
  const [reportSaving, setReportSaving] = useState(false);
  const [reportQuestionOverrides, setReportQuestionOverrides] = useState<Record<number, string>>({});
  const [reportQuestionStatuses, setReportQuestionStatuses] = useState<Record<number, "loading" | "live" | "fallback">>({});
  const [reviewNote, setReviewNote] = useState("");
  const [reportReviewNotes, setReportReviewNotes] = useState<Record<string, string>>({});
  const [reportRevisionAnswers, setReportRevisionAnswers] = useState<Record<string, [string, string, string]>>({});
  const [reportStock, setReportStock] = useState<JobStockReadback | null>(null);
  const [reportStockState, setReportStockState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [reportStockConsumption, setReportStockConsumption] = useState<Record<string, string>>({});
  const [stockReconciling, setStockReconciling] = useState(false);
  const [stockRefreshToken, setStockRefreshToken] = useState(0);
  const stockRequestSequence = useRef(0);
  const stockReconciliationKeys = useRef(new Map<string, string>());
  const [progress, setProgress] = useState(0);
  const [activeSection, setActiveSection] = useState<"overview" | "operations" | "reports" | "finance">(
    searchParams.get("tab") === "finance" && canReadFinance ? "finance" : "overview",
  );

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  }, []);

  const refresh = useCallback(async () => {
    setState("loading");
    try {
      const response = await fetch(
        `/api/operations/jobs/${encodeURIComponent(jobId)}`,
        { cache: "no-store" },
      );
      if (response.status === 401) throw new Error("unauthenticated");
      if (response.status === 403) throw new Error("forbidden");
      if (response.status === 404) throw new Error("missing");
      if (!response.ok) throw new Error("error");
      const nextPayload = (await response.json()) as WorkspacePayload;
      setPayload(nextPayload);
      setProgress(nextPayload.job.progress);
      setTitle(
        typeof nextPayload.job.payload?.title === "string"
          ? nextPayload.job.payload.title
          : nextPayload.job.title,
      );
      setDescription(
        typeof nextPayload.job.payload?.description === "string"
          ? nextPayload.job.payload.description
          : "",
      );
      setClient(
        typeof nextPayload.job.payload?.client === "string"
          ? nextPayload.job.payload.client
          : "",
      );
      const jobData = nextPayload.job.payload ?? {};
      const jobScope = jobData.scope && typeof jobData.scope === "object" && !Array.isArray(jobData.scope)
        ? jobData.scope as Record<string, unknown>
        : {};
      const jobText = (key: string, fallback = "") => typeof jobData[key] === "string" ? String(jobData[key]) : fallback;
      setCommercialDetails({
        clientName: jobText("clientName", jobText("client")),
        clientTaxId: jobText("clientTaxId"),
        clientContact: jobText("clientContact"),
        clientPhone: jobText("clientPhone"),
        clientEmail: jobText("clientEmail"),
        clientReference: jobText("clientReference"),
        clientAddress: jobText("clientAddress"),
        accessNotes: jobText("accessNotes"),
        cig: jobText("cig"),
        cup: jobText("cup"),
        openingType: jobText("openingType", "NUOVA_COMMESSA"),
        priority: jobData.priority === "HIGH" || jobData.priority === "LOW" ? jobData.priority : "STANDARD",
        scopeSectionId: jobText("scopeSectionId", typeof jobScope.sectionId === "string" ? jobScope.sectionId : ""),
        scopeGroupId: jobText("scopeGroupId", typeof jobScope.groupId === "string" ? jobScope.groupId : ""),
        scopeSubgroupId: jobText("scopeSubgroupId", typeof jobScope.subgroupId === "string" ? jobScope.subgroupId : ""),
      });
      setLocation(
        typeof nextPayload.job.payload?.location === "string"
          ? nextPayload.job.payload.location
          : nextPayload.job.detail,
      );
      setDueDate(
        typeof nextPayload.job.payload?.dueDate === "string"
          ? nextPayload.job.payload.dueDate
          : nextPayload.job.meta,
      );
      setState("ready");
    } catch (error: unknown) {
      const code = error instanceof Error ? error.message : "error";
      setState(
        code === "unauthenticated" || code === "forbidden" || code === "missing"
          ? code
          : "error",
      );
    }
  }, [jobId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const mutate = useCallback(
    async (
      action: string,
      body: Record<string, unknown>,
      options: { closeDialog?: boolean; silent?: boolean } = {},
    ): Promise<boolean> => {
      if (!payload) return false;
      if (mutationInFlight.current) return false;
      mutationInFlight.current = true;
      setMutationBusy(true);
      const expectedVersion = payload.readback?.version ?? 1;
      const serializedBody = JSON.stringify(body);
      const mutationIdentity = `${action}:${expectedVersion}:${serializedBody}`;
      const idempotencyKey = mutationKeys.current.get(mutationIdentity)
        ?? `w03-${crypto.randomUUID()}`;
      mutationKeys.current.set(mutationIdentity, idempotencyKey);
      try {
        const response = await fetch(
          `/api/operations/jobs/${encodeURIComponent(jobId)}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action,
              expectedVersion,
              idempotencyKey,
              ...body,
            }),
          },
        );
        const nextPayload = (await response.json()) as WorkspacePayload & {
          error?: string;
          requirements?: CompletionRequirement[];
          completeness?: RapportinoReadback["completeness"];
          questions?: string[];
        };
        if (!response.ok) {
          if (
            nextPayload.error === "completion_requirements_unmet" &&
            nextPayload.requirements
          ) {
            const missing = nextPayload.requirements
              .filter((requirement) => !requirement.complete)
              .map((requirement) => requirement.label)
              .join(", ");
            notify(
              `Completamento bloccato: ${missing || "requisiti mancanti"}`,
            );
          } else if (nextPayload.error === "rapportino_answers_incomplete" && nextPayload.questions?.length) {
            notify(`Rapportino incompleto: ${nextPayload.questions[0]}`);
          } else if (
            nextPayload.error === "rapportino_completeness_unmet" &&
            (nextPayload.questions?.length || nextPayload.completeness?.missing?.length)
          ) {
            notify(
              `Invio bloccato: ${nextPayload.questions?.[0] ?? "completa i dati mancanti"}`,
            );
          } else if (nextPayload.error === "job_stock_reconciliation_required") {
            notify(nextPayload.questions?.[0] ?? "Conferma consumi e giacenze del magazzino di commessa prima dell’invio.");
          } else if (nextPayload.error === "job_stock_register_not_provisioned") {
            notify(nextPayload.questions?.[0] ?? "Il magazzino di commessa non è disponibile.");
          } else if (nextPayload.error === "rapportino_locked") {
            notify(nextPayload.message ?? "Il rapportino è già in revisione in ufficio.");
            await refresh();
          } else if (nextPayload.error === "rapportino_day_already_approved") {
            notify(nextPayload.message ?? "Il rapportino della giornata è già approvato dall’ufficio.");
            await refresh();
          } else if (nextPayload.error === "invalid_status_transition") {
            notify("Il passaggio di stato non è più valido. Ho aggiornato la scheda: riprova con l’azione disponibile.");
          } else
            notify(
              nextPayload.error === "version_conflict"
                ? "La commessa è cambiata: aggiorno la scheda."
                : "Operazione non completata. Riprova.",
            );
          if (response.status === 409) await refresh();
          if (response.status < 500) mutationKeys.current.delete(mutationIdentity);
          return false;
        }
        if (nextPayload.mutation?.action !== action
          || nextPayload.mutation.readback !== "verified"
          || !nextPayload.mutation.eventId
          || nextPayload.readback?.status !== "ok"
          || typeof nextPayload.readback.version !== "number"
          || !nextPayload.job) {
          notify("Il server non ha confermato registro e rilettura. Aggiorno la scheda prima di riprovare.");
          await refresh();
          return false;
        }
        mutationKeys.current.delete(mutationIdentity);
        setPayload(nextPayload);
        setProgress(nextPayload.job.progress);
        if (options.closeDialog !== false) setActionOpen(null);
        if (!options.silent) notify(`Operazione registrata · ${displayAction(action)} · ${nextPayload.mutation.eventId.slice(0, 8)} · v${nextPayload.readback.version}`);
        return true;
      } catch {
        notify(
          "Connessione non disponibile: nessuna modifica è stata confermata.",
        );
        return false;
      } finally {
        mutationInFlight.current = false;
        setMutationBusy(false);
      }
    },
    [jobId, notify, payload, refresh],
  );

  const nextStatusAction = useMemo(() => {
    return payload?.workspace.statusTransitions?.[0] ?? null;
  }, [payload?.workspace.statusTransitions]);

  const submitAction = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (actionOpen === "details") {
      const currentScopeV2 = payload?.job.payload?.scopeV2 && typeof payload.job.payload.scopeV2 === "object" && !Array.isArray(payload.job.payload.scopeV2)
        ? payload.job.payload.scopeV2 as Record<string, unknown>
        : null;
      if (currentScopeV2?.status === "CONFERMATO" && typeof currentScopeV2.descriptionOriginal === "string" && description !== currentScopeV2.descriptionOriginal) {
        notify("Lo scope è confermato: per cambiare la descrizione serve una revisione con confronto e nuova approvazione.");
        return;
      }
      const savedLocation = typeof payload?.job.payload?.location === "string" ? payload.job.payload.location.trim() : payload?.job.detail.trim() ?? "";
      const locationChanged = location.trim() !== savedLocation;
      const selectedScopeParts = [commercialDetails.scopeSectionId, commercialDetails.scopeGroupId, commercialDetails.scopeSubgroupId].filter(Boolean).length;
      if (selectedScopeParts > 0 && selectedScopeParts < 3) {
        notify("Completa settore, categoria e sottocategoria oppure lascia invariato l’ambito.");
        return;
      }
      if (locationChanged && !selectedWorksite) {
        notify("Riconosci il nuovo indirizzo e seleziona il risultato server-side prima di salvare.");
        return;
      }
      await mutate("update_job", {
        fields: {
          title,
          description,
          client,
          clientName: commercialDetails.clientName,
          clientTaxId: commercialDetails.clientTaxId,
          clientContact: commercialDetails.clientContact,
          clientPhone: commercialDetails.clientPhone,
          clientEmail: commercialDetails.clientEmail,
          clientReference: commercialDetails.clientReference,
          clientAddress: commercialDetails.clientAddress,
          location,
          dueDate,
          accessNotes: commercialDetails.accessNotes,
          cig: commercialDetails.cig,
          cup: commercialDetails.cup,
          openingType: commercialDetails.openingType,
          priority: commercialDetails.priority,
          ...(selectedScopeParts === 3 ? {
            scopeSectionId: commercialDetails.scopeSectionId,
            scopeGroupId: commercialDetails.scopeGroupId,
            scopeSubgroupId: commercialDetails.scopeSubgroupId,
          } : {}),
          ...(locationChanged ? { worksiteLocation: selectedWorksite } : {}),
        },
      });
    }
    if (actionOpen === "activity")
      await mutate("add_activity", {
        title: activityTitle,
        detail: activityDetail,
        ...(activityOwner.startsWith("person:") ? { ownerMembershipId: activityOwner.slice(7) } : {}),
        ...(activityOwner.startsWith("team:") ? { ownerTeamId: activityOwner.slice(5) } : {}),
        dueDate: activityDueDate,
      });
    if (actionOpen === "assign")
      await mutate("assign", {
        ...(assignmentSelection.startsWith("person:") ? { responsibleMembershipId: assignmentSelection.slice(7) } : {}),
        ...(assignmentSelection.startsWith("team:") ? { teamId: assignmentSelection.slice(5) } : {}),
        role: assignmentRole,
      });
    if (actionOpen === "evidence")
      await mutate("add_evidence", {
        title: evidenceTitle,
        detail: evidenceDetail,
        kind: "note",
      });
    if (actionOpen === "report")
      await mutate("save_rapportino", { narrative: reportText, answers: reportAnswers });
    if (actionOpen === "progress") await mutate("set_progress", { progress });
  };

  const openDetails = () => {
    if (!payload) return;
    setTitle(
      typeof payload.job.payload?.title === "string"
        ? payload.job.payload.title
        : payload.job.title,
    );
    setDescription(
      typeof payload.job.payload?.description === "string"
        ? payload.job.payload.description
        : "",
    );
    setClient(
      typeof payload.job.payload?.client === "string"
        ? payload.job.payload.client
        : "",
    );
    const currentPayload = payload.job.payload ?? {};
    const currentScope = currentPayload.scope && typeof currentPayload.scope === "object" && !Array.isArray(currentPayload.scope)
      ? currentPayload.scope as Record<string, unknown>
      : {};
    const currentText = (key: string, fallback = "") => typeof currentPayload[key] === "string" ? String(currentPayload[key]) : fallback;
    setCommercialDetails({
      clientName: currentText("clientName", currentText("client")),
      clientTaxId: currentText("clientTaxId"),
      clientContact: currentText("clientContact"),
      clientPhone: currentText("clientPhone"),
      clientEmail: currentText("clientEmail"),
      clientReference: currentText("clientReference"),
      clientAddress: currentText("clientAddress"),
      accessNotes: currentText("accessNotes"),
      cig: currentText("cig"),
      cup: currentText("cup"),
      openingType: currentText("openingType", "NUOVA_COMMESSA"),
      priority: currentPayload.priority === "HIGH" || currentPayload.priority === "LOW" ? currentPayload.priority : "STANDARD",
      scopeSectionId: currentText("scopeSectionId", typeof currentScope.sectionId === "string" ? currentScope.sectionId : ""),
      scopeGroupId: currentText("scopeGroupId", typeof currentScope.groupId === "string" ? currentScope.groupId : ""),
      scopeSubgroupId: currentText("scopeSubgroupId", typeof currentScope.subgroupId === "string" ? currentScope.subgroupId : ""),
    });
    setLocation(
      typeof payload.job.payload?.location === "string"
        ? payload.job.payload.location
        : payload.job.detail,
    );
    setWorksiteCandidates([]);
    setSelectedWorksite(null);
    setDueDate(
      typeof payload.job.payload?.dueDate === "string"
        ? payload.job.payload.dueDate
        : payload.job.meta,
    );
    setActionOpen("details");
  };

  const openAssignment = () => {
    if (!payload) return;
    const assignment = payload.job.payload?.assignment;
    const record = assignment && typeof assignment === "object" && !Array.isArray(assignment)
      ? assignment as Record<string, unknown>
      : {};
    const responsibleMembershipId = typeof record.responsibleMembershipId === "string" ? record.responsibleMembershipId : "";
    const teamId = typeof record.teamId === "string" ? record.teamId : "";
    setAssignmentSelection(responsibleMembershipId ? `person:${responsibleMembershipId}` : teamId ? `team:${teamId}` : "");
    setAssignmentRole(typeof record.roleCode === "string" ? record.roleCode : "RESPONSABILE_OPERATIVO");
    setActionOpen("assign");
  };

  const recognizeWorksite = async () => {
    if (location.trim().length < 5) {
      notify("Inserisci un indirizzo completo prima di riconoscere il cantiere.");
      return;
    }
    setWorksiteGeocoding(true);
    setWorksiteCandidates([]);
    setSelectedWorksite(null);
    try {
      const response = await fetch("/api/location/geocode", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: location.trim() }),
      });
      const result = await response.json() as { candidates?: GeocodeCandidate[]; error?: string };
      if (!response.ok) throw new Error(result.error ?? "geocoder_unavailable");
      const candidates = Array.isArray(result.candidates) ? result.candidates : [];
      setWorksiteCandidates(candidates);
      if (!candidates.length) notify("Il server non ha trovato un luogo: controlla l’indirizzo e riprova.");
    } catch (error) {
      notify(error instanceof Error && error.message === "geocoder_not_configured" ? "Il provider Geoapify non è configurato." : "Non riesco a riconoscere il luogo. Riprova tra poco.");
    } finally {
      setWorksiteGeocoding(false);
    }
  };

  const requestReportQuestion = useCallback(async (step: number, answers: readonly string[]) => {
    const fallbackQuestion = REPORT_CHAT_STEPS[step]?.prompt;
    if (!fallbackQuestion) return;
    setReportQuestionStatuses((current) => ({ ...current, [step]: "loading" }));
    try {
      const response = await fetch(`/api/operations/jobs/${encodeURIComponent(jobId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ action: "rapportino_interview_question", step, answers }),
      });
      const result = await response.json() as {
        question?: string;
        ai?: { status?: string };
      };
      if (!response.ok || typeof result.question !== "string" || result.question.trim().length < 8) {
        throw new Error("question_unavailable");
      }
      setReportQuestionOverrides((current) => ({ ...current, [step]: result.question!.trim().slice(0, 400) }));
      setReportQuestionStatuses((current) => ({ ...current, [step]: result.ai?.status === "used" ? "live" : "fallback" }));
    } catch {
      setReportQuestionOverrides((current) => ({ ...current, [step]: fallbackQuestion }));
      setReportQuestionStatuses((current) => ({ ...current, [step]: "fallback" }));
    }
  }, [jobId]);

  const loadReportStock = useCallback(async () => {
    if (!canReadWarehouse) {
      setReportStock(null);
      setReportStockState("ready");
      return;
    }
    const requestSequence = stockRequestSequence.current + 1;
    stockRequestSequence.current = requestSequence;
    setReportStockState("loading");
    try {
      const response = await fetch(`/api/operations/jobs/${encodeURIComponent(jobId)}/stock`, { cache: "no-store" });
      if (!response.ok) throw new Error("job_stock_unavailable");
      const nextStock = await response.json() as JobStockReadback;
      if (nextStock.readback?.status !== "verified" || typeof nextStock.register?.version !== "number") {
        throw new Error("job_stock_readback_unverified");
      }
      if (stockRequestSequence.current !== requestSequence) return;
      setReportStock(nextStock);
      setReportStockConsumption(Object.fromEntries(
        nextStock.balances.filter((row) => row.onHand > 0).map((row) => [row.inventoryItemId, "0"]),
      ));
      setReportStockState("ready");
    } catch {
      if (stockRequestSequence.current === requestSequence) setReportStockState("error");
    }
  }, [canReadWarehouse, jobId]);

  const openReport = useCallback(() => {
    if (!payload) return;
    setActiveSection("reports");
    const narrative = payload.workspace.rapportino.status === "APPROVED" ? "" : payload.workspace.rapportino.narrative;
    const answers = reportAnswersFor(narrative, payload.workspace.rapportino.answers);
    setReportAnswers(answers);
    setReportText(composeRapportinoNarrative(answers));
    const firstMissing = answers.findIndex((answer) => answer.trim().length < 2);
    const nextStep = firstMissing < 0 ? REPORT_CHAT_STEPS.length : firstMissing;
    setReportChatStep(nextStep);
    setReportQuestionOverrides({});
    setReportQuestionStatuses({});
    setReviewNote(payload.workspace.rapportino.review.note);
    setActionOpen("report");
    void loadReportStock();
    if (nextStep < REPORT_CHAT_STEPS.length) void requestReportQuestion(nextStep, answers);
  }, [loadReportStock, payload, requestReportQuestion]);

  const reconcileReportStock = async () => {
    if (!reportStock || reportStockState !== "ready" || stockReconciling) return;
    const positiveBalances = reportStock.balances.filter((row) => row.onHand > 0);
    const lines = positiveBalances.map((row) => {
      return {
        inventoryItemId: row.inventoryItemId,
        expectedVersion: row.version,
        consumed: parseStockQuantityInput(reportStockConsumption[row.inventoryItemId] ?? "0"),
      };
    });
    const invalidLine = lines.find((line, index) => !Number.isFinite(line.consumed)
      || line.consumed < 0
      || line.consumed > positiveBalances[index].onHand);
    if (invalidLine) {
      notify("Controlla le quantità consumate: devono essere comprese tra zero e la giacenza disponibile.");
      return;
    }
    const snapshot = JSON.stringify({ reportDate: reportStock.reportDate, registerVersion: reportStock.register.version, lines });
    const idempotencyKey = stockReconciliationKeys.current.get(snapshot)
      ?? `job-stock-shift-${crypto.randomUUID()}`;
    stockReconciliationKeys.current.set(snapshot, idempotencyKey);
    setStockReconciling(true);
    try {
      const response = await fetch(`/api/operations/jobs/${encodeURIComponent(jobId)}/stock`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "reconcile_shift",
          reportDate: reportStock.reportDate,
          idempotencyKey,
          lines,
        }),
      });
      const result = await response.json() as {
        error?: string;
        reconciliation?: StockReconciliation;
        readback?: { status?: string };
      };
      if (!response.ok && result.error === "job_stock_shift_already_reconciled") {
        stockReconciliationKeys.current.delete(snapshot);
        await loadReportStock();
        setStockRefreshToken((current) => current + 1);
        notify("Il consuntivo del turno era già stato confermato.");
        return;
      }
      if (!response.ok) {
        if (["job_stock_version_conflict", "job_stock_reconciliation_catalog_changed"].includes(result.error ?? "")) {
          stockReconciliationKeys.current.delete(snapshot);
          await loadReportStock();
          notify("Le giacenze sono cambiate: ho riletto il registro. Controlla e conferma di nuovo.");
        } else if (result.error === "job_stock_quantity_exceeds_balance") {
          stockReconciliationKeys.current.delete(snapshot);
          notify("Una quantità consumata supera la giacenza riletta dal server.");
        } else if (result.error === "job_stock_quantity_precision_invalid") {
          stockReconciliationKeys.current.delete(snapshot);
          notify("La quantità non rispetta i decimali ammessi dall’unità di misura del catalogo.");
        } else if (result.error === "job_stock_reconciliation_line_limit_exceeded") {
          stockReconciliationKeys.current.delete(snapshot);
          notify("Il consuntivo contiene troppi articoli per una singola conferma: serve la revisione dell’ufficio.");
        } else {
          notify("Il consuntivo materiali non è stato confermato. Nessun consumo è stato registrato.");
        }
        return;
      }
      if (!result.reconciliation || result.readback?.status !== "verified") {
        notify("Il server non ha restituito una rilettura verificata del consuntivo materiali.");
        return;
      }
      stockReconciliationKeys.current.delete(snapshot);
      await loadReportStock();
      setStockRefreshToken((current) => current + 1);
      notify("Consumi e giacenze del turno confermati.");
    } catch {
      notify("Connessione non disponibile: il consuntivo materiali resta da verificare.");
    } finally {
      setStockReconciling(false);
    }
  };

  const updateReportAnswer = (index: number, value: string) => {
    const next = [...reportAnswers] as [string, string, string];
    next[index] = value;
    setReportAnswers(next);
    setReportText(composeRapportinoNarrative(next));
  };

  const advanceReportChat = async () => {
    if (reportAnswers[reportChatStep]?.trim().length < 2) {
      notify("Rispondi alla domanda oppure indica che non ci sono elementi da segnalare.");
      return;
    }
    if (!canWriteReport || payload?.workspace.rapportino.status === "SUBMITTED" || payload?.workspace.rapportino.dayAlreadyApproved || reportSaving) return;
    setReportSaving(true);
    const saved = await mutate("save_rapportino", {
      narrative: composeRapportinoNarrative(reportAnswers),
      answers: reportAnswers,
    }, { closeDialog: false, silent: true });
    setReportSaving(false);
    if (!saved) return;
    const nextStep = Math.min(REPORT_CHAT_STEPS.length, reportChatStep + 1);
    setReportChatStep(nextStep);
    if (nextStep < REPORT_CHAT_STEPS.length) void requestReportQuestion(nextStep, reportAnswers);
  };

  const updateHistoricalAnswer = (reportId: string, narrative: string, savedAnswers: string[] | undefined, index: number, value: string) => {
    setReportRevisionAnswers((current) => {
      const next = [...(current[reportId] ?? reportAnswersFor(narrative, savedAnswers))] as [string, string, string];
      next[index] = value;
      return { ...current, [reportId]: next };
    });
  };

  const resolveReportBlocker = async (key: string) => {
    const blocker = REPORT_BLOCKER_DETAILS[key];
    if (!blocker || !payload) return;

    if (blocker.destination !== "attendance" && !canWriteOperations) {
      notify("Per correggere i dati della commessa serve il profilo operativo dell’ufficio.");
      return;
    }

    const reportStatus = payload.workspace.rapportino.status;
    const hasEditedDraft = canWriteReport
      && reportStatus !== "SUBMITTED"
      && reportText.trim().length >= 2
      && (reportStatus === "APPROVED"
        || reportText.trim() !== payload.workspace.rapportino.narrative.trim());
    if (hasEditedDraft) {
      const saved = await mutate("save_rapportino", { narrative: reportText, answers: reportAnswers });
      if (!saved) return;
    }

    if (blocker.destination === "details") {
      openDetails();
    } else if (blocker.destination === "assignment") {
      openAssignment();
    } else {
      setActionOpen(null);
      router.push("/presenze");
    }
  };

  useEffect(() => {
    if (!openReportFromQuery || !payload || autoOpenedReportJobRef.current === jobId) return;
    autoOpenedReportJobRef.current = jobId;
    openReport();
  }, [jobId, openReportFromQuery, openReport, payload]);

  const submitReport = (intent: "DRAFT" | "SUBMIT" | "APPROVE" | "REQUEST_CHANGES") => {
    if (intent === "APPROVE" || intent === "REQUEST_CHANGES") {
      void mutate("review_rapportino", {
        decision: intent === "APPROVE" ? "APPROVE" : "REQUEST_CHANGES",
        reviewNote,
      });
      return;
    }
    if (intent === "SUBMIT" && canReadWarehouse) {
      if (reportStockState !== "ready" || !reportStock) {
        notify("Attendi la rilettura del magazzino di commessa prima di inviare il rapportino.");
        return;
      }
      if (reportStock.balances.some((row) => row.onHand > 0) && !reportStock.todayReconciliation) {
        notify("Conferma prima i consumi e le giacenze rimaste nel magazzino di commessa.");
        return;
      }
    }
    void mutate(intent === "SUBMIT" ? "submit_rapportino" : "save_rapportino", { narrative: reportText, answers: reportAnswers });
  };

  const reviewHistoricalReport = (reportId: string, decision: "APPROVE" | "REQUEST_CHANGES") => {
    const note = reportReviewNotes[reportId]?.trim() ?? "";
    if (decision === "REQUEST_CHANGES" && note.length < 8) {
      notify("Per chiedere un’integrazione scrivi una nota di almeno 8 caratteri.");
      return;
    }
    void mutate("review_rapportino", { reportId, decision, reviewNote: note });
  };

  const resubmitHistoricalReport = (reportId: string, originalNarrative: string, savedAnswers?: string[]) => {
    const answers = reportRevisionAnswers[reportId] ?? reportAnswersFor(originalNarrative, savedAnswers);
    const narrative = composeRapportinoNarrative(answers);
    if (answers.some((answer) => answer.trim().length < 2) || narrative.length < 40) {
      notify("Completa tutte e tre le risposte del rapportino prima di reinviarlo.");
      return;
    }
    void mutate("resubmit_rapportino", { reportId, narrative, answers });
  };

  if (state === "loading")
    return (
      <main className="zw-command-ultra grid min-h-screen place-items-center text-slate-100">
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <LoaderCircle className="size-4 animate-spin text-lime-300" />
          Caricamento scheda commessa…
        </div>
      </main>
    );
  if (state !== "ready" || !payload) {
    const message =
      state === "unauthenticated"
        ? "Accedi per leggere la scheda della commessa."
        : state === "forbidden"
          ? "Il tuo profilo non ha accesso a questa commessa."
          : state === "missing"
            ? "La commessa non è disponibile per il tuo profilo."
            : "La scheda non è momentaneamente disponibile.";
    return (
      <main className="zw-command-ultra grid min-h-screen place-items-center px-5 text-slate-100">
        <section className="carbon-card w-full max-w-lg rounded-2xl p-6 text-center">
          <ShieldCheck className="mx-auto size-8 text-amber-200" />
          <h1 className="mt-4 text-lg font-semibold">
            Scheda non disponibile
          </h1>
          <p className="mt-2 text-xs leading-5 text-slate-500">{message}</p>
          <div className="mt-5 flex justify-center gap-2">
            <Button
              variant="outline"
              className="border-white/10 bg-black/20 text-xs text-slate-300"
              onClick={() => router.push(canOpenOperationsIndex ? "/operations" : "/")}
            >
              <ArrowLeft className="size-3.5" />
              {canOpenOperationsIndex ? "Torna alle commesse" : "Torna alla tua area"}
            </Button>
            {state === "unauthenticated" && (
              <Button
                className="bg-lime-300 text-xs font-semibold text-[#060806]"
                onClick={() =>
                  router.push(
                    `/login?next=${encodeURIComponent(`/operations/${jobId}`)}`,
                  )
                }
              >
                Accedi
              </Button>
            )}
          </div>
        </section>
      </main>
    );
  }

  const { job, workspace } = payload;
  const jobData = job.payload ?? {};
  const commercialCatalog = workspace.options?.commercial;
  const assignmentCatalog = workspace.options?.assignment;
  const assignmentPeople = (assignmentCatalog?.people ?? []).filter((person) => person.eligibleRoleCodes.includes(assignmentRole));
  const assignmentTeams = (assignmentCatalog?.teams ?? []).filter((team) => team.eligibleRoleCodes.includes(assignmentRole));
  const selectedScopeSection = commercialCatalog?.scopeSections.find((section) => section.id === commercialDetails.scopeSectionId);
  const selectedScopeGroup = selectedScopeSection?.groups.find((group) => group.id === commercialDetails.scopeGroupId);
  const payloadText = (key: string, fallback = "") =>
    typeof jobData[key] === "string" ? (jobData[key] as string) : fallback;
  const clientName = valueOr(
    jobData.client ?? jobData.clientName,
    "Cliente da definire",
  );
  const locationLabel = valueOr(
    jobData.worksite ?? jobData.location ?? job.detail,
    "Luogo da definire",
  );
  const worksiteLocation =
    jobData.worksiteLocation &&
    typeof jobData.worksiteLocation === "object" &&
    !Array.isArray(jobData.worksiteLocation)
      ? (jobData.worksiteLocation as Record<string, unknown>)
      : null;
  const locationVerified = worksiteLocation?.status === "SERVER_VERIFIED";
  const worksiteGeofence =
    worksiteLocation?.geofence &&
    typeof worksiteLocation.geofence === "object" &&
    !Array.isArray(worksiteLocation.geofence)
      ? (worksiteLocation.geofence as Record<string, unknown>)
      : null;
  const geofenceLabel = locationVerified
    ? typeof worksiteGeofence?.radiusMeters === "number"
      ? `Attiva · raggio ${worksiteGeofence.radiusMeters} m`
      : "Attiva · verificata dal server"
    : "Da verificare dal server";
  const jobDescription = typeof jobData.description === "string" ? jobData.description.trim() : "";
  const jobSummary = compactDescription(jobDescription);
  const hasRealDescription = Boolean(jobDescription);
  // Keep the registered commessa name in the title. A worksite-looking name
  // is still a valid project identity; descriptive text belongs below it.
  const displayTitle = job.title;
  const openingType =
    payloadText("openingType") === "PRONTO_INTERVENTO"
      ? "Pronto intervento"
      : payloadText("openingType") === "MANUTENZIONE" ? "Manutenzione / accordo continuativo" : "Cantiere / nuova commessa";
  const sourceMode =
    payloadText("sourceMode") === "COMPANY_AI"
      ? "Da preventivo"
      : "Inserimento manuale";
  const quoteSummary = sourceMode === "Da preventivo" ? quoteSummaryFromDescription(jobDescription) : null;
  const priority = payloadText("priority", "STANDARD");
  const macroScopeV2 = jobData.scopeV2 && typeof jobData.scopeV2 === "object" && !Array.isArray(jobData.scopeV2)
    ? jobData.scopeV2 as Record<string, unknown>
    : null;
  const macroScopeConfirmed = macroScopeV2?.status === "CONFERMATO";
  const rawScope = jobData.scope;
  const jobScope =
    rawScope && typeof rawScope === "object" && !Array.isArray(rawScope)
      ? (rawScope as Record<string, unknown>)
      : null;
  const scopeLabel = macroScopeConfirmed
    ? `Company AI Macro Scope V2 · ${payloadText("category", "Ambiti confermati")}`
    : jobScope &&
    typeof jobScope.sectionTitle === "string" &&
    typeof jobScope.groupTitle === "string" &&
    typeof jobScope.subgroupTitle === "string"
      ? `${jobScope.sectionTitle} / ${jobScope.groupTitle} / ${jobScope.subgroupTitle}`
      : Array.isArray(jobData.workItems) && jobData.workItems.some((item) => item && typeof item === "object" && "scope" in item)
        ? "Classificazioni collegate alle singole lavorazioni"
        : "Da classificare con Company AI";
  const dueDateLabel = formatCommercialDate(jobData.dueDate ?? job.meta);
  const jobCode = valueOr(job.canonicalCode, jobId);
  const clientRows = [
    { icon: Users, label: "Referente", value: payloadText("clientContact") },
    { icon: Flag, label: "Riferimento cliente", value: valueOr(jobData.clientReference, "") },
    { icon: BriefcaseBusiness, label: "Codice fiscale / P. IVA", value: valueOr(jobData.clientTaxId, "") },
    { icon: BriefcaseBusiness, label: "Telefono", value: valueOr(jobData.clientPhone, "") },
    { icon: BriefcaseBusiness, label: "E-mail", value: valueOr(jobData.clientEmail, "") },
    { icon: MapPin, label: "Indirizzo cliente / fatturazione", value: valueOr(jobData.clientAddress, "") },
    { icon: Flag, label: "CIG", value: valueOr(jobData.cig, "") },
    { icon: Flag, label: "CUP", value: valueOr(jobData.cup, "") },
  ];
  const populatedClientRows = clientRows.filter((row) => row.value.trim().length > 0);
  const missingClientRows = clientRows.filter((row) => row.value.trim().length === 0);
  const workItems = Array.isArray(jobData.workItems)
    ? jobData.workItems
        .filter((item): item is Record<string, unknown> =>
          Boolean(item && typeof item === "object" && !Array.isArray(item)),
        )
        .slice(0, 24)
    : [];
  const reportAnswersComplete = reportAnswers.every((answer) => answer.trim().length >= 2);
  const reportNarrativeReady = reportAnswersComplete && reportText.trim().length >= 40 && !/\[(?:da completare|da confermare|da indicare|da descrivere)\]/i.test(reportText);
  const reportQuestionStatus = reportQuestionStatuses[reportChatStep] ?? "idle";
  const reportLocked = workspace.rapportino.status === "SUBMITTED" || workspace.rapportino.dayAlreadyApproved;
  const reportSystemBlockers = reportLocked
    ? []
    : workspace.rapportino.completeness.missing.filter((key) => key !== "narrative");
  const reportStockNeedsReconciliation = canReadWarehouse
    && reportStockState === "ready"
    && Boolean(reportStock?.balances.some((row) => row.onHand > 0))
    && !reportStock?.todayReconciliation;
  const reportStockReady = !canReadWarehouse || reportStockState === "ready";
  const reportCanSubmit = reportNarrativeReady
    && reportSystemBlockers.length === 0
    && reportStockReady
    && !reportStockNeedsReconciliation;
  const reportOpenBlockers = reportSystemBlockers
    .map((key) => ({ key, ...REPORT_BLOCKER_DETAILS[key] }))
    .filter((blocker): blocker is { key: string; title: string; detail: string; destination: "details" | "assignment" | "attendance" } => Boolean(blocker.title));
  const reportNarrativeQuestion = reportLocked || reportNarrativeReady || !workspace.rapportino.completeness.missing.includes("narrative")
    ? ""
    : REPORT_CHAT_STEPS.find((_, index) => reportAnswers[index].trim().length < 2)?.prompt
      ?? workspace.rapportino.completeness.questions.find((question) => question.startsWith("Racconta l’esito") || question.startsWith("Quali attività sono state svolte?"))
      ?? "Completa il racconto del turno, le criticità e i prossimi passi.";
  const reportQuestionCount = reportOpenBlockers.length
    + Number(Boolean(reportNarrativeQuestion))
    + Number(canReadWarehouse && (!reportStockReady || reportStockNeedsReconciliation));
  const reportAutoFields = workspace.rapportino.fields.filter((field) =>
    ["activities", "attendance", "resources", "materials", "evidence"].includes(field.key),
  );
  const reportStockBalances = reportStock?.balances.filter((row) => row.onHand > 0) ?? [];

  return (
    <main className="zw-command-ultra min-h-screen overflow-x-hidden text-slate-100 selection:bg-lime-300 selection:text-[#060806]">
      <div className="zw-command-ambient" aria-hidden="true" />
      <div className="relative mx-auto max-w-[1320px] px-4 py-4 sm:px-7 sm:py-6">
        <header className="zw-command-topbar sticky top-0 z-20 -mx-4 mb-4 flex min-h-14 flex-wrap items-center justify-between gap-3 px-4 py-2.5 sm:-mx-7 sm:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <button aria-label="Torna alla tua area" className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-xl border border-lime-300/35 bg-black" onClick={() => router.push("/")} type="button">
              <Image src="/ai-zerow-icon.jpeg" alt="ZEROW" width={36} height={36} className="size-full object-cover" />
            </button>
            <Button className="h-9 rounded-xl border-white/10 bg-black/20 px-3 text-xs text-slate-300 hover:border-lime-300/30 hover:text-lime-100" onClick={() => router.push(canOpenOperationsIndex ? "/operations" : "/")} variant="outline">
              <ArrowLeft className="size-3.5" />{canOpenOperationsIndex ? "Commesse" : "La mia area"}
            </Button>
            <div className="min-w-0">
              <p className="truncate text-[9px] font-semibold uppercase tracking-[.2em] text-lime-300/70">COMMESSE / DETTAGLIO</p>
              <p className="mt-0.5 truncate text-[10px] text-slate-600">Scheda operativa</p>
            </div>
          </div>
          <button aria-label="Aggiorna scheda commessa" className="grid size-9 place-items-center rounded-xl border border-white/10 bg-black/20 text-slate-400 transition hover:border-lime-300/30 hover:text-lime-200" onClick={() => void refresh()} type="button">
            <RefreshCw className="size-4" />
          </button>
        </header>

        <section className="overflow-hidden rounded-[26px] border border-lime-300/20 bg-[linear-gradient(145deg,rgba(22,34,26,.96),rgba(7,11,11,.98)_58%,rgba(12,20,18,.96))] shadow-[0_24px_70px_rgba(0,0,0,.28)]">
          <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-lime-300/20 bg-lime-300/[.05] px-2.5 py-1 font-mono text-[9px] font-semibold text-lime-100">{jobCode}</span>
                <span className={`rounded-full border px-2.5 py-1 text-[9px] font-semibold ${statusTone(job.status)}`}>{displayStatus(job.status)}</span>
                {priority !== "STANDARD" && <span className="rounded-full border border-amber-300/20 bg-amber-300/[.06] px-2.5 py-1 text-[8px] font-semibold uppercase tracking-[.12em] text-amber-100">Priorità {priority === "HIGH" ? "alta" : "bassa"}</span>}
                {sourceMode === "Da preventivo" && <span className="rounded-full border border-cyan-300/20 bg-cyan-300/[.05] px-2.5 py-1 text-[8px] font-semibold uppercase tracking-[.12em] text-cyan-100/80">Da preventivo</span>}
              </div>
              <h1 className="mt-3 max-w-4xl break-words text-[26px] font-semibold leading-tight tracking-[-.04em] text-slate-50 sm:text-[34px]">{displayTitle}</h1>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-slate-400">
                <span className="inline-flex min-w-0 items-center gap-1.5"><MapPin className="size-3.5 shrink-0 text-cyan-200" /><span className="break-words">{locationLabel}</span></span>
                <span className="inline-flex min-w-0 items-center gap-1.5"><Users className="size-3.5 shrink-0 text-lime-200" /><span className="break-words">{clientName}</span></span>
              </div>
              {hasRealDescription && <p className="mt-3 max-w-3xl line-clamp-2 whitespace-pre-wrap text-[11px] leading-5 text-slate-400">{jobSummary}</p>}
              <div className="mt-5 max-w-3xl border-t border-white/[.08] pt-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[9px] font-semibold uppercase tracking-[.16em] text-slate-500">Avanzamento lavori</span>
                  <span className="font-mono text-sm text-lime-100">{progress}%</span>
                </div>
                <div aria-label={`Avanzamento ${progress}%`} aria-valuemax={100} aria-valuemin={0} aria-valuenow={progress} className="mt-2 h-2 overflow-hidden rounded-full bg-black/60" role="progressbar">
                  <div className="h-full rounded-full bg-gradient-to-r from-lime-300 to-cyan-200 transition-all" style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[9px] text-slate-600"><span>{openingType}</span><span>Scadenza prevista · {dueDateLabel}</span></div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 lg:max-w-[260px] lg:justify-end">
              {canReviewReport && workspace.rapportino.status === "SUBMITTED" && <Button className="min-h-10 bg-amber-200 px-4 text-[10px] font-semibold text-[#120d04] hover:bg-amber-100" onClick={openReport} type="button"><ClipboardCheck className="size-3.5" />Esamina rapportino</Button>}
              {canWriteOperations && nextStatusAction && <Button className="min-h-10 border-lime-300/20 bg-lime-300/[.06] px-3 text-[10px] text-lime-100 hover:bg-lime-300/10" disabled={mutationBusy || (["COMPLETED", "CLOSED"].includes(nextStatusAction.statusCode) && !workspace.completion.ready)} onClick={() => void mutate("set_status", { statusCode: nextStatusAction.statusCode })} title={(["COMPLETED", "CLOSED"].includes(nextStatusAction.statusCode) && !workspace.completion.ready) ? "Completa i controlli obbligatori prima di avanzare" : undefined} type="button" variant="outline"><Send className="size-3.5" />{nextStatusAction.actionLabel}</Button>}
              {canWriteOperations && <Button className="min-h-10 border-white/10 bg-black/20 px-3 text-[10px] text-slate-300 hover:border-white/20 hover:text-slate-100" onClick={openDetails} type="button" variant="outline"><BriefcaseBusiness className="size-3.5" />Modifica dati</Button>}
              {canWriteOperations && <Button className="min-h-10 border-white/10 bg-black/20 px-3 text-[10px] text-slate-300 hover:border-white/20 hover:text-slate-100" onClick={() => setActionOpen("progress")} type="button" variant="outline"><CircleGauge className="size-3.5" />Aggiorna avanzamento</Button>}
            </div>
          </div>
        </section>

        <Tabs className="mt-4" onValueChange={(value) => setActiveSection(value as "overview" | "operations" | "reports" | "finance")} value={activeSection}>
          <TabsList className={`grid h-12 w-full ${(canWriteReport || canReviewReport) && canReadFinance ? "grid-cols-4" : (canWriteReport || canReviewReport) || canReadFinance ? "grid-cols-3" : "grid-cols-2"} rounded-2xl border border-white/[.08] bg-black/25 p-1`}>
            <TabsTrigger className="rounded-xl text-[10px] data-[state=active]:border-lime-300/20 data-[state=active]:bg-lime-300/[.08] data-[state=active]:text-lime-100" value="overview"><BriefcaseBusiness className="size-3.5" />Riepilogo</TabsTrigger>
            <TabsTrigger className="rounded-xl text-[10px] data-[state=active]:border-lime-300/20 data-[state=active]:bg-lime-300/[.08] data-[state=active]:text-lime-100" value="operations"><Layers3 className="size-3.5" />Operatività</TabsTrigger>
            {(canWriteReport || canReviewReport) && <TabsTrigger className="rounded-xl text-[10px] data-[state=active]:border-cyan-300/20 data-[state=active]:bg-cyan-300/[.08] data-[state=active]:text-cyan-100" value="reports"><Sparkles className="size-3.5" />Rapportini</TabsTrigger>}
            {canReadFinance && <TabsTrigger className="rounded-xl text-[10px] data-[state=active]:border-lime-300/20 data-[state=active]:bg-lime-300/[.08] data-[state=active]:text-lime-100" value="finance"><CircleDollarSign className="size-3.5" />Finanza</TabsTrigger>}
          </TabsList>

          <TabsContent className="mt-4 space-y-4" value="overview">
            <section className="carbon-card rounded-[22px] p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><p className="text-[9px] font-semibold uppercase tracking-[.18em] text-lime-300/65">PERIMETRO DEL LAVORO</p><h2 className="mt-1 text-[15px] font-semibold text-slate-100">{quoteSummary ? "Lavori dal preventivo" : "Descrizione e lavorazioni"}</h2></div>
                {workItems.length > 0 && <span className="rounded-full border border-lime-300/15 bg-lime-300/[.04] px-2.5 py-1 text-[9px] text-lime-100/80">{workItems.length} lavorazioni</span>}
              </div>
              <JobCommercialTermsPanel jobId={jobId} />
              {quoteSummary ? <div className="mt-4 rounded-xl border border-cyan-300/12 bg-cyan-300/[.025] p-3.5">
                <p className="text-[8px] font-semibold uppercase tracking-[.14em] text-cyan-100/60">Oggetto del preventivo</p>
                <p className="mt-1.5 text-[12px] font-medium leading-5 text-slate-100">{quoteSummary.object}</p>
                {quoteSummary.summary && <p className="mt-2 text-[10px] leading-5 text-slate-400">{quoteSummary.summary}</p>}
              </div> : hasRealDescription ? <p className="mt-3 max-w-4xl whitespace-pre-wrap text-[11px] leading-5 text-slate-400">{jobSummary}</p> : <p className="mt-3 rounded-xl border border-dashed border-white/[.08] px-3 py-3 text-[10px] text-slate-500">La descrizione dei lavori non è stata registrata.</p>}

              {macroScopeConfirmed && <div className="mt-4 rounded-xl border border-lime-300/15 bg-lime-300/[.035] p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[9px] font-semibold uppercase tracking-[.15em] text-lime-100/70">Scope confermato · Macro Scope V2</p><span className="rounded-full border border-lime-300/20 bg-lime-300/[.05] px-2 py-1 text-[8px] font-semibold uppercase text-lime-100/80">Conferma umana registrata</span></div>
                <p className="mt-2 text-[11px] font-medium leading-5 text-lime-100">{payloadText("category", "Ambito da classificare")}</p>
                <p className="mt-1 text-[9px] leading-4 text-slate-500">Versione catalogo {valueOr(macroScopeV2?.catalogVersion, "2.0.0")} · confermato il {formatCommercialDate(macroScopeV2?.confirmedAt)}. Le attività confermate non sono pianificazioni.</p>
                {Array.isArray(macroScopeV2?.reportedProblems) && macroScopeV2.reportedProblems.length > 0 && <div className="mt-3 rounded-lg border border-amber-300/12 bg-amber-300/[.025] p-2.5"><p className="text-[8px] font-semibold uppercase tracking-[.12em] text-amber-100/70">Problemi segnalati · non convertiti in lavorazioni</p>{macroScopeV2.reportedProblems.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item))).map((item, index) => <p className="mt-1 text-[10px] leading-4 text-slate-300" key={`${String(item.source ?? "problem")}-${index}`}>{valueOr(item.text, "Segnalazione")}</p>)}</div>}
                {Array.isArray(macroScopeV2?.completedWork) && macroScopeV2.completedWork.length > 0 && <div className="mt-3 rounded-lg border border-cyan-300/12 bg-cyan-300/[.025] p-2.5"><p className="text-[8px] font-semibold uppercase tracking-[.12em] text-cyan-100/70">Lavori indicati come già eseguiti</p>{macroScopeV2.completedWork.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item))).map((item, index) => <p className="mt-1 text-[10px] leading-4 text-slate-300" key={`${String(item.source ?? "completed")}-${index}`}>{valueOr(item.text, "Lavoro già eseguito")}</p>)}</div>}
                {Array.isArray(macroScopeV2?.activitiesConfirmed) && macroScopeV2.activitiesConfirmed.some((item) => item && typeof item === "object" && !Array.isArray(item) && (item as Record<string, unknown>).status === "ESCLUSA") && <div className="mt-3 rounded-lg border border-white/[.07] bg-black/10 p-2.5"><p className="text-[8px] font-semibold uppercase tracking-[.12em] text-slate-500">Proposte escluse in fase di conferma</p>{macroScopeV2.activitiesConfirmed.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item) && (item as Record<string, unknown>).status === "ESCLUSA")).map((item, index) => <p className="mt-1 text-[10px] leading-4 text-slate-500" key={`${String(item.id ?? "excluded")}-${index}`}>{valueOr(item.text, "Lavorazione esclusa")}</p>)}</div>}
                {macroScopeV2.changes && typeof macroScopeV2.changes === "object" && !Array.isArray(macroScopeV2.changes) ? <p className="mt-3 border-t border-white/[.06] pt-2.5 text-[9px] leading-4 text-slate-600">Modifiche prima della conferma: {Array.isArray((macroScopeV2.changes as Record<string, unknown>).groupsAdded) ? ((macroScopeV2.changes as Record<string, unknown>).groupsAdded as unknown[]).length : 0} ambiti aggiunti, {Array.isArray((macroScopeV2.changes as Record<string, unknown>).groupsRemoved) ? ((macroScopeV2.changes as Record<string, unknown>).groupsRemoved as unknown[]).length : 0} rimossi, {Array.isArray((macroScopeV2.changes as Record<string, unknown>).activitiesEdited) ? ((macroScopeV2.changes as Record<string, unknown>).activitiesEdited as unknown[]).length : 0} lavorazioni modificate.</p> : null}
              </div>}

              {workItems.length > 0 ? <div className="mt-4 divide-y divide-white/[.06] rounded-xl border border-white/[.06] bg-black/15 px-3">
                {workItems.slice(0, 3).map((item, index) => <div className="flex items-start gap-3 py-3" key={typeof item.id === "string" ? item.id : `work-${index}`}>
                  <span className="grid size-6 shrink-0 place-items-center rounded-lg border border-lime-300/20 bg-lime-300/[.05] font-mono text-[8px] text-lime-100">{String(index + 1).padStart(2, "0")}</span>
                  <div className="min-w-0 flex-1"><p className="text-[11px] font-medium leading-4 text-slate-200">{valueOr(item.label ?? item.detail, "Lavorazione")}</p>{typeof item.detail === "string" && item.detail && item.detail !== item.label && <p className="mt-1 text-[10px] leading-4 text-slate-500">{item.detail}</p>}{Array.isArray(item.macroGroupLabels) && item.macroGroupLabels.length > 0 && <p className="mt-1.5 text-[8px] font-medium uppercase tracking-[.08em] text-cyan-100/70">{item.macroGroupLabels.filter((label): label is string => typeof label === "string").join(" · ")}</p>}{workScopeLabel(item.scope) && <p className="mt-1.5 text-[8px] font-medium uppercase tracking-[.08em] text-cyan-100/70">{workScopeLabel(item.scope)}</p>}{typeof item.evidence === "string" && item.evidence && <p className="mt-1 text-[8px] text-slate-600">Fonte: “{item.evidence}”</p>}{sourceMode === "Da preventivo" && typeof item.source === "string" && item.source && <p className="mt-1 text-[8px] text-cyan-100/55">Da {item.source}{typeof item.confidence === "number" ? ` · ${Math.round(item.confidence * 100)}%` : ""}</p>}</div>
                  {(item.quantity !== undefined || (typeof item.unit === "string" && item.unit.length > 0)) && <span className="shrink-0 text-right text-[9px] text-slate-400">{valueOr(item.quantity, "—")}{typeof item.unit === "string" && item.unit ? ` ${item.unit}` : ""}</span>}
                </div>)}
                {workItems.length > 3 && <details className="border-t border-white/[.06] py-3"><summary className="cursor-pointer list-none text-[9px] font-medium text-cyan-100/80">Mostra altre {workItems.length - 3} lavorazioni</summary><div className="mt-3 divide-y divide-white/[.06]">{workItems.slice(3).map((item, index) => <div className="flex items-start justify-between gap-3 py-2.5" key={typeof item.id === "string" ? item.id : `work-more-${index}`}><div><p className="text-[10px] text-slate-200">{valueOr(item.label ?? item.detail, "Lavorazione")}</p>{typeof item.detail === "string" && item.detail && item.detail !== item.label && <p className="mt-1 text-[9px] text-slate-600">{item.detail}</p>}</div><span className="shrink-0 text-[9px] text-slate-500">{valueOr(item.quantity, "—")}{typeof item.unit === "string" && item.unit ? ` ${item.unit}` : ""}</span></div>)}</div></details>}
              </div> : <p className="mt-3 text-[9px] leading-4 text-slate-600">Non ci sono lavorazioni separate. Il testo della commessa resta il riferimento operativo.</p>}
              {jobDescription.length > 260 && <details className="mt-3 rounded-xl border border-white/[.06] bg-black/10 px-3 py-2.5">
                <summary className="cursor-pointer list-none text-[9px] font-medium text-cyan-100/75">Leggi il testo registrato completo</summary>
                <p className="mt-2 whitespace-pre-wrap break-words border-t border-white/[.06] pt-2.5 text-[10px] leading-5 text-slate-400">{jobDescription}</p>
              </details>}
            </section>

            <details className="group overflow-hidden rounded-[22px] border border-white/[.08] bg-black/10">
              <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-4 py-4 marker:hidden sm:px-5">
                <span><span className="block text-[9px] font-semibold uppercase tracking-[.18em] text-cyan-100/65">DATI DI RIFERIMENTO</span><span className="mt-1 block text-[13px] font-semibold text-slate-100">Cliente, cantiere e condizioni</span><span className="mt-1 block text-[10px] text-slate-500">Apri i dettagli amministrativi e logistici della commessa.</span></span>
                <span className="rounded-lg border border-white/10 px-3 py-2 text-[9px] text-slate-400 group-open:hidden">Apri dettagli</span><span className="hidden rounded-lg border border-white/10 px-3 py-2 text-[9px] text-slate-400 group-open:inline-flex">Chiudi dettagli</span>
              </summary>
              <div className="grid gap-4 border-t border-white/[.07] p-4 sm:p-5 lg:grid-cols-3">
                <section className="min-w-0">
                  <p className="text-[8px] font-semibold uppercase tracking-[.16em] text-slate-600">Cliente</p>
                  <h3 className="mt-1 text-[12px] font-semibold text-slate-200">{clientName}</h3>
                  {populatedClientRows.length > 0 ? <div className="mt-2">{populatedClientRows.map((row) => <InfoRow icon={row.icon} key={row.label} label={row.label} value={row.value} />)}</div> : <p className="mt-2 text-[10px] leading-5 text-slate-500">Recapiti amministrativi non registrati.</p>}
                  {missingClientRows.length > 0 && <p className="mt-2 rounded-lg border border-amber-300/10 bg-amber-300/[.025] px-2.5 py-2 text-[9px] leading-4 text-amber-100/70">Da completare: {missingClientRows.map((row) => row.label).join(", ")}.</p>}
                </section>
                <section className="min-w-0">
                  <div className="flex items-center justify-between gap-2"><p className="text-[8px] font-semibold uppercase tracking-[.16em] text-slate-600">Cantiere</p><span className={`rounded-full border px-2 py-1 text-[7px] font-semibold uppercase tracking-[.1em] ${locationVerified ? "border-lime-300/20 bg-lime-300/[.05] text-lime-100" : "border-amber-300/20 bg-amber-300/[.05] text-amber-100"}`}>{locationVerified ? "Luogo verificato" : "Da verificare"}</span></div>
                  <InfoRow icon={MapPin} label="Indirizzo" value={locationLabel} />
                  <InfoRow icon={ShieldCheck} label="Geofence" value={geofenceLabel} />
                  <InfoRow icon={HardHat} label="Accesso e vincoli" value={valueOr(jobData.accessNotes, "Nessuna nota registrata")} />
                </section>
                <section className="min-w-0">
                  <p className="text-[8px] font-semibold uppercase tracking-[.16em] text-slate-600">Inquadramento</p>
                  <InfoRow icon={BriefcaseBusiness} label="Ambito operativo" value={scopeLabel} />
                  <InfoRow icon={Flag} label="Apertura e priorità" value={`${openingType} · ${priority === "HIGH" ? "Alta" : priority === "LOW" ? "Bassa" : "Standard"}`} />
                  <InfoRow icon={CalendarClock} label="Scadenza prevista" value={dueDateLabel} />
                  <p className="mt-3 rounded-xl border border-white/[.06] bg-black/15 px-3 py-2.5 text-[9px] leading-4 text-slate-500">Pianificazione, turni, squadre e risorse si gestiscono nei rispettivi moduli e compaiono in Operatività.</p>
                </section>
              </div>
            </details>
          </TabsContent>

          <TabsContent className="mt-4 space-y-4" value="operations">
            <section className="rounded-[20px] border border-cyan-300/15 bg-cyan-300/[.025] px-4 py-3.5 sm:px-5">
              <p className="text-[9px] font-semibold uppercase tracking-[.18em] text-cyan-100/70">FLUSSI OPERATIVI COLLEGATI</p>
              <p className="mt-1 text-[10px] leading-5 text-slate-400">Questa sezione coordina le azioni collegate alla commessa. Presenze, pianificazione, magazzino, missioni e documenti mantengono ciascuno il proprio registro.</p>
            </section>

            <CompletionGate completion={workspace.completion} />

            <section className="carbon-card rounded-[22px] p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0"><p className="text-[9px] font-semibold uppercase tracking-[.18em] text-lime-300/65">GOVERNANCE OPERATIVA</p><h2 className="mt-1 text-[15px] font-semibold text-slate-100">Responsabilità ed evidenze</h2><p className="mt-1 max-w-2xl text-[10px] leading-5 text-slate-500">Le fasi descrittive appartengono alla scheda commessa. I turni e le risorse pianificate, i materiali e i trasporti hanno registri operativi dedicati nel percorso qui sotto.</p></div>
                {canWriteOperations && <div className="flex flex-wrap gap-2">
                  <Button className="min-h-9 border-lime-300/20 bg-lime-300/[.04] px-3 text-[9px] text-lime-100 hover:bg-lime-300/10" onClick={() => setActionOpen("activity")} type="button" variant="outline"><Plus className="size-3.5" />Aggiungi fase commessa</Button>
                  <Button className="min-h-9 border-white/10 bg-black/20 px-3 text-[9px] text-slate-300 hover:border-white/20" onClick={openAssignment} type="button" variant="outline"><Users className="size-3.5" />Assegna responsabile o squadra</Button>
                  <Button className="min-h-9 border-white/10 bg-black/20 px-3 text-[9px] text-slate-300 hover:border-white/20" onClick={() => setActionOpen("evidence")} type="button" variant="outline"><MapPin className="size-3.5" />Registra evidenza</Button>
                </div>}
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                <div className="rounded-xl border border-white/[.06] bg-black/20 px-3 py-2.5"><p className="text-[8px] font-semibold uppercase tracking-[.14em] text-slate-600">Responsabile della commessa</p><p className="mt-1 truncate text-[10px] font-medium text-slate-200">{workspace.sections.planning.records.find((record) => record.recordType === "assignment")?.title ?? "Da assegnare"}</p><p className="mt-0.5 text-[9px] text-slate-600">Registro assegnazioni server-side</p></div>
                <div className="rounded-xl border border-white/[.06] bg-black/20 px-3 py-2.5"><p className="text-[8px] font-semibold uppercase tracking-[.14em] text-slate-600">Fasi descrittive</p><p className="mt-1 text-[10px] font-medium text-slate-200">{workspace.sections.activities.count} {workspace.sections.activities.count === 1 ? "fase" : "fasi"}</p><p className="mt-0.5 text-[9px] text-slate-600">Obiettivi e attività generali della commessa</p></div>
                <div className="rounded-xl border border-white/[.06] bg-black/20 px-3 py-2.5"><p className="text-[8px] font-semibold uppercase tracking-[.14em] text-slate-600">Evidenze archiviate</p><p className="mt-1 text-[10px] font-medium text-slate-200">{workspace.sections.evidence.count} {workspace.sections.evidence.count === 1 ? "elemento" : "elementi"}</p><p className="mt-0.5 text-[9px] text-slate-600">Archivio della commessa · rilettura server</p></div>
              </div>
              {workspace.sections.activities.records.length > 0 && <details className="group mt-3 rounded-xl border border-white/[.06] bg-black/15">
                <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 marker:hidden"><span className="text-[9px] font-semibold text-slate-400">Attività descrittive della commessa · {workspace.sections.activities.count}</span><span className="text-[8px] text-slate-600 group-open:hidden">Apri</span><span className="hidden text-[8px] text-slate-600 group-open:inline">Chiudi</span></summary>
                <div className="space-y-2 border-t border-white/[.06] p-3">{workspace.sections.activities.records.slice(0, 8).map((record) => {
                  const activityId = typeof record.payload?.id === "string" ? record.payload.id : null;
                  return <div className="flex items-center gap-3 rounded-lg border border-white/[.06] bg-black/20 px-3 py-2" key={record.id}><span className={`grid size-7 shrink-0 place-items-center rounded-lg border ${statusTone(record.status)}`}><CheckCircle2 className="size-3.5" /></span><div className="min-w-0 flex-1"><p className="truncate text-[10px] font-medium text-slate-200">{record.title}</p><p className="mt-0.5 truncate text-[9px] text-slate-500">{record.detail || displayRecordType(record.recordType)}</p></div><span className={`hidden rounded-full border px-2 py-1 text-[8px] font-semibold uppercase sm:inline-flex ${statusTone(record.status)}`}>{displayStatus(record.status)}</span>{canWriteOperations && activityId && record.status !== "DONE" && <button aria-label={`Completa ${record.title}`} className="grid size-9 shrink-0 place-items-center rounded-lg border border-lime-300/20 text-lime-100 hover:bg-lime-300/10" onClick={() => void mutate("complete_activity", { activityId })} type="button"><Check className="size-3.5" /></button>}</div>;
                })}</div>
              </details>}
            </section>

            {canReadWarehouse && <JobStockPanel jobId={jobId} refreshToken={stockRefreshToken} />}

            <JobCommercialJourney jobId={jobId} />
          </TabsContent>

          {(canWriteReport || canReviewReport) && <TabsContent className="mt-4 space-y-4" value="reports">
            <section className="overflow-hidden rounded-[22px] border border-cyan-300/18 bg-[linear-gradient(145deg,rgba(10,27,29,.78),rgba(7,12,13,.97))] p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-xl border border-cyan-300/20 bg-cyan-300/[.07] text-cyan-100"><Sparkles className="size-4" /></span><div><p className="text-[9px] font-semibold uppercase tracking-[.18em] text-cyan-100/70">RAPPORTINO DI COMMESSA</p><h2 className="mt-1 text-[15px] font-semibold text-slate-100">Consuntivo della giornata</h2><p className="mt-1 text-[10px] text-slate-500">{formatCommercialDate(workspace.rapportino.reportDate)} · dati operativi riletti dai registri</p></div></div>
                <span className={`rounded-full border px-2.5 py-1 text-[8px] font-semibold uppercase tracking-[.1em] ${statusTone(workspace.rapportino.status)}`}>{rapportinoStatusLabel(workspace.rapportino.status)}</span>
              </div>
              <p className="mt-3 max-w-3xl text-[10px] leading-5 text-slate-400">Company AI prepara il rapporto con le timbrature, le attività, le risorse e i movimenti registrati. Il responsabile aggiunge l’esito osservato, le criticità e i prossimi passi. Le missioni di consegna hanno il proprio rapportino nel modulo Missioni.</p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {reportAutoFields.map((field) => <div className="min-w-0 rounded-xl border border-white/[.06] bg-black/20 px-3 py-2.5" key={field.key}><div className="flex items-center justify-between gap-2"><p className="truncate text-[8px] font-semibold uppercase tracking-[.12em] text-slate-600">{field.label}</p><span className={`shrink-0 text-[7px] font-semibold uppercase ${field.status === "known" ? "text-lime-200" : field.status === "missing" ? "text-amber-200" : "text-slate-600"}`}>{field.status === "known" ? "RILETTO" : field.status === "missing" ? "DA COMPLETARE" : "OPZIONALE"}</span></div><p className="mt-1 break-words text-[10px] leading-4 text-slate-300">{field.value}</p></div>)}
              </div>
              {reportOpenBlockers.length > 0 && <div className="mt-4 space-y-2"><p className="text-[8px] font-semibold uppercase tracking-[.15em] text-amber-100/70">Dati necessari prima dell’invio</p>{reportOpenBlockers.map((blocker) => <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300/12 bg-amber-300/[.025] px-3 py-2.5" key={blocker.key}><div className="min-w-0"><p className="text-[10px] font-medium text-amber-100/90">{blocker.title}</p><p className="mt-0.5 text-[9px] leading-4 text-slate-500">{blocker.detail}</p></div><Button className="min-h-8 shrink-0 border-amber-300/15 px-2.5 text-[8px] text-amber-100 hover:bg-amber-300/[.06]" disabled={blocker.destination !== "attendance" && !canWriteOperations} onClick={() => void resolveReportBlocker(blocker.key)} type="button" variant="outline">{blocker.destination === "attendance" ? "Apri Presenze" : blocker.destination === "assignment" ? "Apri assegnazione" : "Completa dati"}</Button></div>)}</div>}
              {reportNarrativeQuestion && <p className="mt-3 rounded-xl border border-cyan-300/12 bg-cyan-300/[.025] px-3 py-2.5 text-[9px] leading-5 text-cyan-50/75">Da raccogliere con Company AI: {reportNarrativeQuestion}</p>}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/[.07] pt-4">
                <p className="max-w-2xl text-[9px] leading-4 text-slate-600">L’invio all’ufficio resta bloccato finché mancano dati obbligatori o la timbratura di uscita.</p>
                {canReviewReport && workspace.rapportino.status === "SUBMITTED" ? <Button className="min-h-10 bg-amber-200 px-4 text-[10px] font-semibold text-[#120d04] hover:bg-amber-100" onClick={openReport} type="button"><ClipboardCheck className="size-3.5" />Apri revisione</Button> : canWriteReport && !reportLocked ? <Button className="min-h-10 bg-cyan-200 px-4 text-[10px] font-semibold text-[#061012] hover:bg-cyan-100" onClick={openReport} type="button"><Sparkles className="size-3.5" />{workspace.rapportino.status === "DRAFT" || workspace.rapportino.status === "CHANGES_REQUESTED" ? "Riprendi colloquio" : "Apri Company AI"}</Button> : <span className={`rounded-full border px-3 py-2 text-[8px] font-semibold uppercase tracking-[.1em] ${statusTone(workspace.rapportino.status)}`}>{workspace.rapportino.status === "SUBMITTED" ? "In revisione in ufficio" : workspace.rapportino.status === "APPROVED" ? "Giornata approvata" : rapportinoStatusLabel(workspace.rapportino.status)}</span>}
              </div>
            </section>

            {(workspace.rapportinoHistory?.length ?? 0) > 0 && <details className="group overflow-hidden rounded-[20px] border border-white/[.08] bg-black/10">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 marker:hidden"><span><span className="block text-[8px] font-semibold uppercase tracking-[.16em] text-slate-600">ARCHIVIO</span><span className="mt-1 block text-[11px] font-medium text-slate-200">Rapportini precedenti · {workspace.rapportinoHistory?.length ?? 0}</span></span><span className="rounded-lg border border-white/10 px-2.5 py-1.5 text-[8px] text-slate-500 group-open:hidden">Apri archivio</span><span className="hidden rounded-lg border border-white/10 px-2.5 py-1.5 text-[8px] text-slate-500 group-open:inline-flex">Chiudi</span></summary>
              <div className="space-y-2 border-t border-white/[.07] p-3 sm:p-4">{[...(workspace.rapportinoHistory ?? []).filter((entry) => entry.status === "SUBMITTED"), ...(workspace.rapportinoHistory ?? []).filter((entry) => entry.status !== "SUBMITTED")].slice(0, 12).map((entry) => <details className="rounded-xl border border-white/[.07] bg-black/20 px-3 py-2.5" key={entry.reportId}>
                <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 marker:hidden"><span className="text-[10px] font-medium text-slate-200">{entry.reportDate ? formatCommercialDate(entry.reportDate) : Number.isFinite(Date.parse(entry.at)) ? new Date(entry.at).toLocaleString("it-IT", { timeZone: "Europe/Rome", dateStyle: "short", timeStyle: "short" }) : "Data non disponibile"}</span><span className={`rounded-full border px-2 py-1 text-[7px] font-semibold uppercase ${statusTone(entry.status)}`}>{rapportinoStatusLabel(entry.status.toUpperCase() as RapportinoReadback["status"])}</span></summary>
                <div className="mt-3 border-t border-white/[.06] pt-3"><p className="whitespace-pre-wrap text-[10px] leading-5 text-slate-300">{entry.text || entry.narrative || "Nessun testo archiviato."}</p>{entry.note && <p className="mt-2 rounded-lg border border-amber-300/10 bg-amber-300/[.025] p-2.5 text-[9px] text-amber-100/75">Nota ufficio: {entry.note}</p>}
                  {canReviewReport && entry.reportId !== workspace.rapportino.reportId && entry.status === "SUBMITTED" && <div className="mt-3 space-y-2 border-t border-white/[.06] pt-3"><label className="block space-y-1 text-[9px] text-slate-500"><span>Nota ufficio, necessaria per chiedere modifiche</span><Textarea className="min-h-[68px] border-amber-300/15 bg-black/30 text-[10px] text-slate-100" onChange={(event) => setReportReviewNotes((current) => ({ ...current, [entry.reportId]: event.target.value }))} placeholder="Indica cosa integrare…" value={reportReviewNotes[entry.reportId] ?? ""} /></label><div className="flex flex-wrap gap-2"><Button className="min-h-8 bg-lime-300 px-3 text-[9px] font-semibold text-[#060806] hover:bg-lime-200" onClick={() => reviewHistoricalReport(entry.reportId, "APPROVE")} type="button"><CheckCircle2 className="size-3.5" />Approva</Button><Button className="min-h-8 border-amber-300/20 px-3 text-[9px] text-amber-100 hover:bg-amber-300/10" onClick={() => reviewHistoricalReport(entry.reportId, "REQUEST_CHANGES")} type="button" variant="outline"><FileText className="size-3.5" />Richiedi integrazione</Button></div></div>}
                  {canWriteReport && entry.reportId !== workspace.rapportino.reportId && ["DRAFT", "CHANGES_REQUESTED"].includes(entry.status) && <div className="mt-3 space-y-2 border-t border-white/[.06] pt-3"><p className="text-[9px] font-medium text-cyan-100/75">{entry.status === "CHANGES_REQUESTED" ? "Integra il rapporto e reinvia" : "Completa e invia il rapporto"}</p>{REPORT_CHAT_STEPS.map((step, index) => <label className="block space-y-1 text-[9px] text-slate-500" key={step.title}><span>{step.title}</span><Textarea className="min-h-[68px] border-cyan-300/15 bg-black/30 text-[10px] text-slate-100" onChange={(event) => updateHistoricalAnswer(entry.reportId, entry.narrative, entry.answers, index, event.target.value)} placeholder={step.placeholder} value={reportRevisionAnswers[entry.reportId]?.[index] ?? reportAnswersFor(entry.narrative, entry.answers)[index]} /></label>)}<Button className="min-h-8 bg-cyan-200 px-3 text-[9px] font-semibold text-[#061012] hover:bg-cyan-100" onClick={() => resubmitHistoricalReport(entry.reportId, entry.narrative, entry.answers)} type="button"><FileText className="size-3.5" />Reinvia rapportino</Button></div>}
                </div>
              </details>)}</div>
            </details>}
          </TabsContent>}
          {canReadFinance && <TabsContent className="mt-4 space-y-4" value="finance"><JobFinancePanel jobId={jobId} /></TabsContent>}
        </Tabs>
      </div>

      {(canWriteOperations || canWriteReport || canReviewReport) && (
        <Dialog
          open={actionOpen !== null}
          onOpenChange={(open) => !open && setActionOpen(null)}
        >
          <DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto border-lime-300/20 bg-[#0a0d0e] text-slate-100 sm:max-w-[560px]">
            <DialogHeader>
              <DialogTitle className="text-slate-100">
                {actionOpen === "details"
                  ? "Modifica scheda commessa"
                  : actionOpen === "activity"
                    ? "Aggiungi attività"
                    : actionOpen === "assign"
                      ? "Assegna risorse"
                      : actionOpen === "evidence"
                        ? "Registra evidenza"
                        : actionOpen === "report"
                          ? canReviewReport && payload.workspace.rapportino.status === "SUBMITTED" ? "Revisione rapportino" : "Rapportino con Company AI"
                          : "Aggiorna avanzamento"}
              </DialogTitle>
              <DialogDescription className="text-slate-500">
                {actionOpen === "report" ? "Presenze, attività, risorse e materiali vengono riletti dai moduli. Il responsabile risponde soltanto alle domande ancora aperte." : "Le modifiche vengono verificate e confermate nella scheda della commessa."}
              </DialogDescription>
            </DialogHeader>
            <form className="space-y-4" onSubmit={submitAction}>
              {actionOpen === "details" && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="space-y-2 text-xs text-slate-400 sm:col-span-2">
                    Titolo
                    <Input
                      className="mt-2 border-white/10 bg-black/30 text-slate-100"
                      onChange={(event) => setTitle(event.target.value)}
                      value={title}
                    />
                  </label>
                  <label className="space-y-2 text-xs text-slate-400 sm:col-span-2">
                    Descrizione
                    <Textarea
                      className={`mt-2 min-h-[90px] border-white/10 bg-black/30 text-slate-100 ${macroScopeConfirmed ? "opacity-65" : ""}`}
                      disabled={macroScopeConfirmed}
                      onChange={(event) => setDescription(event.target.value)}
                      value={description}
                    />
                    {macroScopeConfirmed && <span className="block text-[9px] leading-4 text-amber-100/65">Descrizione originale bloccata insieme allo scope. Una revisione dovrà mostrare le differenze e richiedere una nuova conferma.</span>}
                  </label>
                  <label className="space-y-2 text-xs text-slate-400">
                    Cliente
                    <Input
                      className="mt-2 border-white/10 bg-black/30 text-slate-100"
                      maxLength={160}
                      onChange={(event) => {
                        setClient(event.target.value);
                        setCommercialDetails((current) => ({ ...current, clientName: event.target.value }));
                      }}
                      value={commercialDetails.clientName}
                    />
                  </label>
                  <label className="space-y-2 text-xs text-slate-400">
                    Scadenza
                    <Input
                      className="mt-2 border-white/10 bg-black/30 text-slate-100"
                      onChange={(event) => setDueDate(event.target.value)}
                      type="date"
                      value={dueDate.slice(0, 10)}
                    />
                  </label>
                  <label className="space-y-2 text-xs text-slate-400">
                    Codice fiscale / P. IVA
                    <Input className="mt-2 border-white/10 bg-black/30 text-slate-100" maxLength={80} onChange={(event) => setCommercialDetails((current) => ({ ...current, clientTaxId: event.target.value }))} value={commercialDetails.clientTaxId} />
                  </label>
                  <label className="space-y-2 text-xs text-slate-400">
                    Riferimento cliente
                    <Input className="mt-2 border-white/10 bg-black/30 text-slate-100" maxLength={160} onChange={(event) => setCommercialDetails((current) => ({ ...current, clientReference: event.target.value }))} value={commercialDetails.clientReference} />
                  </label>
                  <label className="space-y-2 text-xs text-slate-400">
                    Referente
                    <Input className="mt-2 border-white/10 bg-black/30 text-slate-100" maxLength={120} onChange={(event) => setCommercialDetails((current) => ({ ...current, clientContact: event.target.value }))} value={commercialDetails.clientContact} />
                  </label>
                  <label className="space-y-2 text-xs text-slate-400">
                    Telefono
                    <Input className="mt-2 border-white/10 bg-black/30 text-slate-100" maxLength={80} onChange={(event) => setCommercialDetails((current) => ({ ...current, clientPhone: event.target.value }))} value={commercialDetails.clientPhone} />
                  </label>
                  <label className="space-y-2 text-xs text-slate-400">
                    E-mail
                    <Input className="mt-2 border-white/10 bg-black/30 text-slate-100" maxLength={160} onChange={(event) => setCommercialDetails((current) => ({ ...current, clientEmail: event.target.value }))} type="email" value={commercialDetails.clientEmail} />
                  </label>
                  <label className="space-y-2 text-xs text-slate-400 sm:col-span-2">
                    Indirizzo cliente / fatturazione
                    <Input className="mt-2 border-white/10 bg-black/30 text-slate-100" maxLength={240} onChange={(event) => setCommercialDetails((current) => ({ ...current, clientAddress: event.target.value }))} value={commercialDetails.clientAddress} />
                  </label>
                  <label className="space-y-2 text-xs text-slate-400">
                    Apertura commessa
                    <select className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-slate-100" onChange={(event) => setCommercialDetails((current) => ({ ...current, openingType: event.target.value }))} value={commercialDetails.openingType}>
                      {(commercialCatalog?.openingTypes ?? []).map((option) => <option className="bg-[#080c09]" key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                  <label className="space-y-2 text-xs text-slate-400">
                    Priorità
                    <select className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-slate-100" onChange={(event) => setCommercialDetails((current) => ({ ...current, priority: event.target.value as CommercialDetails["priority"] }))} value={commercialDetails.priority}>
                      {(commercialCatalog?.priorities ?? []).map((option) => <option className="bg-[#080c09]" key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                  <label className="space-y-2 text-xs text-slate-400">
                    CIG
                    <Input className="mt-2 border-white/10 bg-black/30 text-slate-100" maxLength={80} onChange={(event) => setCommercialDetails((current) => ({ ...current, cig: event.target.value }))} value={commercialDetails.cig} />
                  </label>
                  <label className="space-y-2 text-xs text-slate-400">
                    CUP
                    <Input className="mt-2 border-white/10 bg-black/30 text-slate-100" maxLength={80} onChange={(event) => setCommercialDetails((current) => ({ ...current, cup: event.target.value }))} value={commercialDetails.cup} />
                  </label>
                  {macroScopeConfirmed ? <div className="rounded-xl border border-lime-300/15 bg-lime-300/[.035] p-3 sm:col-span-2">
                    <p className="text-[9px] font-semibold uppercase tracking-[.14em] text-lime-100/70">Ambiti confermati · Macro Scope V2</p>
                    <p className="mt-1.5 text-[11px] leading-5 text-slate-200">{payloadText("category", "Ambito da classificare")}</p>
                    <p className="mt-1 text-[9px] leading-4 text-slate-600">Per modificare questo scope servirà una revisione con confronto delle differenze e nuova approvazione.</p>
                  </div> : <>
                    <label className="space-y-2 text-xs text-slate-400">
                      Ambito
                      <select className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-slate-100" onChange={(event) => setCommercialDetails((current) => ({ ...current, scopeSectionId: event.target.value, scopeGroupId: "", scopeSubgroupId: "" }))} value={commercialDetails.scopeSectionId}>
                        <option className="bg-[#080c09]" value="">Seleziona settore</option>
                        {(commercialCatalog?.scopeSections ?? []).map((section) => <option className="bg-[#080c09]" key={section.id} value={section.id}>{section.title}</option>)}
                      </select>
                    </label>
                    <label className="space-y-2 text-xs text-slate-400">
                      Categoria
                      <select className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-slate-100" disabled={!selectedScopeSection} onChange={(event) => setCommercialDetails((current) => ({ ...current, scopeGroupId: event.target.value, scopeSubgroupId: "" }))} value={commercialDetails.scopeGroupId}>
                        <option className="bg-[#080c09]" value="">Seleziona categoria</option>
                        {(selectedScopeSection?.groups ?? []).map((group) => <option className="bg-[#080c09]" key={group.id} value={group.id}>{group.title}</option>)}
                      </select>
                    </label>
                    <label className="space-y-2 text-xs text-slate-400 sm:col-span-2">
                      Sottocategoria operativa
                      <select className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-slate-100" disabled={!selectedScopeGroup} onChange={(event) => setCommercialDetails((current) => ({ ...current, scopeSubgroupId: event.target.value }))} value={commercialDetails.scopeSubgroupId}>
                        <option className="bg-[#080c09]" value="">Seleziona sottocategoria</option>
                        {(selectedScopeGroup?.subgroups ?? []).map((subgroup) => <option className="bg-[#080c09]" key={subgroup.id} value={subgroup.id}>{subgroup.title}</option>)}
                      </select>
                    </label>
                  </>}
                  <label className="space-y-2 text-xs text-slate-400 sm:col-span-2">
                    Note accesso e vincoli
                    <Textarea className="mt-2 min-h-[72px] border-white/10 bg-black/30 text-slate-100" maxLength={2000} onChange={(event) => setCommercialDetails((current) => ({ ...current, accessNotes: event.target.value }))} value={commercialDetails.accessNotes} />
                  </label>
                  <label className="space-y-2 text-xs text-slate-400 sm:col-span-2">
                    Ubicazione
                    <Input
                      className="mt-2 border-white/10 bg-black/30 text-slate-100"
                      onChange={(event) => { setLocation(event.target.value); setSelectedWorksite(null); setWorksiteCandidates([]); }}
                      value={location}
                    />
                    <span className="flex flex-wrap items-center gap-2 pt-1">
                      <Button className="min-h-9 border-cyan-300/20 bg-cyan-300/[.05] px-3 text-[10px] text-cyan-100 hover:bg-cyan-300/10" disabled={worksiteGeocoding} onClick={() => void recognizeWorksite()} type="button" variant="outline">
                        {worksiteGeocoding ? <LoaderCircle className="size-3.5 animate-spin" /> : <MapPin className="size-3.5" />}
                        Riconosci luogo
                      </Button>
                      {selectedWorksite && <span className="text-[9px] text-lime-200">Indirizzo selezionato · {Math.round(selectedWorksite.confidence * 100)}%</span>}
                    </span>
                    {worksiteCandidates.length > 0 && <span className="block space-y-2 rounded-xl border border-cyan-300/15 bg-cyan-300/[.025] p-2.5">
                      <span className="block px-1 text-[9px] font-semibold uppercase tracking-[.14em] text-cyan-200/70">Seleziona il luogo verificato dal server</span>
                      {worksiteCandidates.map((candidate) => <button className={`flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left transition ${selectedWorksite?.providerPlaceId === candidate.providerPlaceId ? "border-lime-300/40 bg-lime-300/[.07]" : "border-white/[.07] bg-black/20 hover:border-cyan-300/25"}`} key={candidate.providerPlaceId} onClick={() => setSelectedWorksite(candidate)} type="button">
                        {selectedWorksite?.providerPlaceId === candidate.providerPlaceId ? <Check className="mt-0.5 size-3.5 shrink-0 text-lime-200" /> : <MapPin className="mt-0.5 size-3.5 shrink-0 text-cyan-200" />}
                        <span className="min-w-0"><span className="block text-[10px] font-medium text-slate-200">{candidate.formattedAddress}</span><span className="mt-1 block text-[9px] text-slate-600">{candidate.city}{candidate.province ? ` · ${candidate.province}` : ""} · coordinate Geoapify · attendibilità {Math.round(candidate.confidence * 100)}%</span></span>
                      </button>)}
                    </span>}
                    <span className="block text-[9px] leading-4 text-slate-600">Se cambi l’indirizzo, il server aggiorna insieme luogo canonico e geofence della commessa.</span>
                  </label>
                </div>
              )}
              {actionOpen === "activity" && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="space-y-2 text-xs text-slate-400 sm:col-span-2">
                    Titolo attività
                    <Input
                      className="mt-2 border-white/10 bg-black/30 text-slate-100"
                      onChange={(event) => setActivityTitle(event.target.value)}
                      placeholder="Es. Sopralluogo tecnico"
                      value={activityTitle}
                    />
                  </label>
                  <label className="space-y-2 text-xs text-slate-400 sm:col-span-2">
                    Dettaglio
                    <Textarea
                      className="mt-2 min-h-[80px] border-white/10 bg-black/30 text-slate-100"
                      onChange={(event) =>
                        setActivityDetail(event.target.value)
                      }
                      placeholder="Cosa deve essere completato?"
                      value={activityDetail}
                    />
                  </label>
                  <label className="space-y-2 text-xs text-slate-400">
                    Responsabile
                    <select className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-slate-100" onChange={(event) => setActivityOwner(event.target.value)} value={activityOwner}>
                      <option className="bg-[#080c09]" value="">Da assegnare</option>
                      <optgroup label="Persone">
                        {(assignmentCatalog?.people ?? []).map((person) => <option className="bg-[#080c09]" key={person.id} value={`person:${person.id}`}>{person.label}</option>)}
                      </optgroup>
                      <optgroup label="Squadre">
                        {(assignmentCatalog?.teams ?? []).map((selectedTeam) => <option className="bg-[#080c09]" key={selectedTeam.id} value={`team:${selectedTeam.id}`}>{selectedTeam.label}</option>)}
                      </optgroup>
                    </select>
                  </label>
                  <label className="space-y-2 text-xs text-slate-400">
                    Scadenza
                    <Input
                      className="mt-2 border-white/10 bg-black/30 text-slate-100"
                      onChange={(event) =>
                        setActivityDueDate(event.target.value)
                      }
                      type="date"
                      value={activityDueDate}
                    />
                  </label>
                </div>
              )}
              {actionOpen === "assign" && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="space-y-2 text-xs text-slate-400 sm:col-span-2">
                    Ruolo nella commessa
                    <select className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-slate-100" onChange={(event) => { setAssignmentRole(event.target.value); setAssignmentSelection(""); }} value={assignmentRole}>
                      {(assignmentCatalog?.roles ?? []).map((option) => <option className="bg-[#080c09]" key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                  <label className="space-y-2 text-xs text-slate-400 sm:col-span-2">
                    Responsabile
                    <select className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-slate-100" onChange={(event) => setAssignmentSelection(event.target.value)} value={assignmentSelection}>
                      <option className="bg-[#080c09]" value="">Seleziona responsabile o squadra</option>
                      <optgroup label="Persone">
                        {assignmentPeople.map((person) => <option className="bg-[#080c09]" key={person.id} value={`person:${person.id}`}>{person.label} · {person.role.replaceAll("_", " ")}</option>)}
                      </optgroup>
                      <optgroup label="Squadre">
                        {assignmentTeams.map((selectedTeam) => <option className="bg-[#080c09]" key={selectedTeam.id} value={`team:${selectedTeam.id}`}>{selectedTeam.label}</option>)}
                      </optgroup>
                    </select>
                  </label>
                </div>
              )}
              {actionOpen === "evidence" && (
                <div className="space-y-4">
                  <label className="space-y-2 text-xs text-slate-400">
                    Titolo evidenza
                    <Input
                      className="mt-2 border-white/10 bg-black/30 text-slate-100"
                      onChange={(event) => setEvidenceTitle(event.target.value)}
                      placeholder="Es. Sopralluogo completato"
                      value={evidenceTitle}
                    />
                  </label>
                  <label className="space-y-2 text-xs text-slate-400">
                    Nota
                    <Textarea
                      className="mt-2 min-h-[110px] border-white/10 bg-black/30 text-slate-100"
                      onChange={(event) =>
                        setEvidenceDetail(event.target.value)
                      }
                      placeholder="Descrivi il fatto osservato"
                      value={evidenceDetail}
                    />
                  </label>
                </div>
              )}
              {actionOpen === "report" && (
                <div className="space-y-4">
                  <section className="rounded-2xl border border-cyan-300/20 bg-[linear-gradient(145deg,rgba(11,28,30,.72),rgba(5,10,11,.88))] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-[9px] font-semibold uppercase tracking-[.18em] text-cyan-100/75">COMPANY AI · RAPPORTINO COMMESSA</p>
                      <span className={`rounded-full border px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[.1em] ${statusTone(payload.workspace.rapportino.status)}`}>{rapportinoStatusLabel(payload.workspace.rapportino.status)}</span>
                    </div>
                    <div className="mt-4 flex gap-3">
                      <span className="grid size-8 shrink-0 place-items-center rounded-xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-100"><Sparkles className="size-3.5" /></span>
                      <div className="rounded-2xl rounded-tl-sm border border-white/[.08] bg-black/25 px-3.5 py-3">
                        <p className="text-[11px] leading-5 text-slate-200">Ho raccolto i dati registrati per questa commessa. Non serve reinserire orari, presenze, persone, mezzi o movimenti già riletti.</p>
                        <p className="mt-2 text-[9px] text-slate-600">Fonti: commessa · Presenze · Pianificazione · Asset · Magazzino</p>
                      </div>
                    </div>
                    <div className="mt-4 space-y-1.5">
                      {reportAutoFields.map((field) => <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border border-white/[.06] bg-black/15 px-3 py-2" key={field.key}><span className="text-[9px] text-slate-500">{field.label}</span><span className={`min-w-0 text-right text-[10px] ${field.status === "known" ? "text-slate-200" : field.status === "missing" ? "text-amber-100" : "text-slate-600"}`}>{field.value}{field.status === "known" ? " · verificato" : field.status === "optional" ? " · facoltativo" : " · da completare"}</span></div>)}
                    </div>
                    {reportQuestionCount > 0 ? (
                      <div className="mt-4 space-y-2">
                        <p className="text-[9px] font-semibold uppercase tracking-[.14em] text-amber-200/75">Prima dell’invio</p>
                        {reportOpenBlockers.map((blocker) => (
                          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300/15 bg-amber-300/[.035] px-3 py-2.5" key={blocker.key}>
                            <div className="flex min-w-0 flex-1 gap-2.5 text-[10px] leading-5 text-amber-100/85">
                              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-300" />
                              <span><span className="block font-medium">{blocker.title}</span><span className="text-amber-100/60">{blocker.detail}</span></span>
                            </div>
                            {blocker.destination === "attendance" ? (
                              <Button className="min-h-9 shrink-0 border-cyan-300/20 bg-cyan-300/[.05] px-3 text-[9px] text-cyan-100 hover:bg-cyan-300/10" onClick={() => void resolveReportBlocker(blocker.key)} type="button" variant="outline">Apri Presenze</Button>
                            ) : canWriteOperations ? (
                              <Button className="min-h-9 shrink-0 border-lime-300/20 bg-lime-300/[.05] px-3 text-[9px] text-lime-100 hover:bg-lime-300/10" onClick={() => void resolveReportBlocker(blocker.key)} type="button" variant="outline">{blocker.destination === "assignment" ? "Apri assegnazione" : "Apri scheda commessa"}</Button>
                            ) : (
                              <span className="shrink-0 text-[9px] text-slate-500">Richiede un profilo ufficio</span>
                            )}
                          </div>
                        ))}
                        {canReadWarehouse && (!reportStockReady || reportStockNeedsReconciliation) && (
                          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300/15 bg-amber-300/[.035] px-3 py-2.5">
                            <div className="flex min-w-0 flex-1 gap-2.5 text-[10px] leading-5 text-amber-100/85">
                              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-300" />
                              <span>
                                <span className="block font-medium">Consuntivo materiali del turno</span>
                                <span className="text-amber-100/60">{reportStockState === "error" ? "Il registro non è leggibile: l’invio resta bloccato." : reportStockNeedsReconciliation ? "Indica i consumi e conferma le giacenze rimaste qui sotto." : "Attendo la rilettura server-side del magazzino di commessa."}</span>
                              </span>
                            </div>
                            {reportStockState === "error" ? <Button className="min-h-9 shrink-0 border-cyan-300/20 bg-cyan-300/[.05] px-3 text-[9px] text-cyan-100 hover:bg-cyan-300/10" onClick={() => void loadReportStock()} type="button" variant="outline">Riprova lettura</Button> : <span className="shrink-0 text-[9px] text-slate-500">Obbligatorio</span>}
                          </div>
                        )}
                        {reportNarrativeQuestion && <div className="flex gap-2.5 rounded-xl border border-amber-300/15 bg-amber-300/[.035] px-3 py-2.5 text-[10px] leading-5 text-amber-100/85"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-300" /><span>{reportNarrativeQuestion} Completa la risposta qui sotto.</span></div>}
                      </div>
                    ) : <p className="mt-4 rounded-xl border border-lime-300/15 bg-lime-300/[.04] px-3 py-2.5 text-[10px] text-lime-100/80">Tutti i controlli automatici sono pronti. Rivedi il racconto prima dell’invio.</p>}
                    {payload.workspace.rapportino.review.note && payload.workspace.rapportino.status !== "APPROVED" && <div className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/[0.05] p-3"><p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-amber-200/80">RICHIESTA DELL’UFFICIO</p><p className="mt-2 text-[11px] leading-5 text-amber-100/85">{payload.workspace.rapportino.review.note}</p></div>}
                  </section>
                  {canReadWarehouse && <section aria-label="Consuntivo materiali del turno" aria-live="polite" className="rounded-2xl border border-lime-300/15 bg-[linear-gradient(145deg,rgba(15,29,12,.68),rgba(5,10,8,.92))] p-4">
                    <div className="flex items-start gap-3">
                      <span className="grid size-8 shrink-0 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/[.07] text-lime-100"><Boxes className="size-3.5" /></span>
                      <div className="min-w-0"><p className="text-[9px] font-semibold uppercase tracking-[.16em] text-lime-200/70">MAGAZZINO DI COMMESSA · FINE TURNO</p><h3 className="mt-1 text-sm font-semibold text-slate-100">Conferma consumi e rimanenze</h3><p className="mt-1 text-[10px] leading-5 text-slate-500">Company AI legge ritiri e consegne già registrati. Tu indichi soltanto quanto è stato realmente consumato; il residuo rimane disponibile in commessa.</p></div>
                    </div>
                    {(reportStockState === "idle" || reportStockState === "loading") && <p className="mt-4 flex items-center gap-2 rounded-xl border border-white/[.06] bg-black/20 p-3 text-[10px] text-slate-500"><LoaderCircle className="size-3.5 animate-spin" />Rilettura delle giacenze server-side…</p>}
                    {reportStockState === "error" && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300/15 bg-amber-300/[.035] p-3"><p className="text-[10px] leading-5 text-amber-100/75">Registro non disponibile. Il rapportino non può essere inviato senza una rilettura verificata.</p><Button className="min-h-9 border-amber-300/20 bg-amber-300/[.05] px-3 text-[9px] text-amber-100" onClick={() => void loadReportStock()} type="button" variant="outline"><RefreshCw className="size-3" />Riprova</Button></div>}
                    {reportStockState === "ready" && reportStock?.todayReconciliation && <div className="mt-4 rounded-xl border border-lime-300/20 bg-lime-300/[.045] p-3.5">
                      <div className="flex flex-wrap items-center justify-between gap-2"><p className="flex items-center gap-2 text-[10px] font-semibold text-lime-100"><CheckCircle2 className="size-3.5" />Consuntivo verificato</p><span className="font-mono text-[8px] text-lime-200/65">{reportStock.todayReconciliation.reportDate}</span></div>
                      {reportStock.todayReconciliation.lines.length > 0 ? <div className="mt-3 space-y-1.5">{reportStock.todayReconciliation.lines.map((line) => <div className="flex items-center justify-between gap-3 rounded-lg border border-white/[.06] bg-black/20 px-3 py-2" key={line.inventoryItemId}><div className="min-w-0"><p className="truncate text-[9px] text-slate-200">{line.name}</p><p className="mt-0.5 text-[8px] text-slate-600">Consumati {formatStockQuantity(line.consumed)} {line.unit}</p></div><span className="shrink-0 font-mono text-[9px] text-lime-100">Residuo {formatStockQuantity(line.remaining)} {line.unit}</span></div>)}</div> : <p className="mt-2 text-[9px] text-slate-500">Nessuna giacenza positiva da consuntivare.</p>}
                    </div>}
                    {reportStockState === "ready" && reportStock && !reportStock.todayReconciliation && reportStockBalances.length === 0 && <p className="mt-4 rounded-xl border border-lime-300/15 bg-lime-300/[.035] p-3 text-[10px] leading-5 text-lime-100/75"><Check className="mr-2 inline size-3.5" />Nessun materiale presente: il registro è verificato e non richiede consumi.</p>}
                    {reportStockState === "ready" && reportStock && !reportStock.todayReconciliation && reportStockBalances.length > 0 && <div className="mt-4 space-y-3">
                      {reportStockBalances.map((row) => {
                        const consumed = parseStockQuantityInput(reportStockConsumption[row.inventoryItemId] ?? "0");
                        const remaining = Number.isFinite(consumed) ? Math.max(0, row.onHand - consumed) : row.onHand;
                        return <label className="block rounded-xl border border-white/[.07] bg-black/20 p-3" key={row.inventoryItemId}>
                          <span className="flex flex-wrap items-start justify-between gap-2"><span className="min-w-0"><span className="block truncate text-[10px] font-medium text-slate-200">{row.name}</span><span className="mt-0.5 block font-mono text-[8px] text-slate-600">{row.sku} · disponibile {formatStockQuantity(row.onHand)} {row.unit}</span></span><span className="text-right font-mono text-[9px] text-cyan-100">Rimane {formatStockQuantity(remaining)} {row.unit}</span></span>
                          <span className="mt-3 block text-[9px] text-slate-500">Quantità consumata nel turno</span>
                          <Input aria-label={`Quantità consumata di ${row.name}`} className="mt-1.5 border-white/10 bg-black/30 text-slate-100" disabled={!canWriteReport || reportLocked || stockReconciling} inputMode="decimal" max={row.onHand} min={0} onChange={(event) => setReportStockConsumption((current) => ({ ...current, [row.inventoryItemId]: event.target.value }))} step={stockQuantityStep(row.unit)} type="number" value={reportStockConsumption[row.inventoryItemId] ?? "0"} />
                        </label>;
                      })}
                      <Button className="w-full bg-lime-300 text-[#060806] hover:bg-lime-200 disabled:cursor-not-allowed disabled:opacity-40" disabled={!canWriteReport || reportLocked || stockReconciling} onClick={() => void reconcileReportStock()} type="button">{stockReconciling ? <LoaderCircle className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}{stockReconciling ? "Conferma in corso…" : "Conferma consumi del turno"}</Button>
                    </div>}
                  </section>}
                  <section aria-live="polite" className="space-y-3 rounded-2xl border border-cyan-300/15 bg-black/20 p-3.5" aria-label="Intervista guidata per il rapportino">
                    <div className="flex gap-2.5">
                      <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-cyan-300/20 bg-cyan-300/10 text-cyan-100"><Sparkles className="size-3" /></span>
                      <p className="rounded-xl rounded-tl-sm border border-white/[.07] bg-black/25 px-3 py-2.5 text-[10px] leading-5 text-slate-300">I registri hanno già fornito orari, persone, mezzi e materiali. Ti chiedo solo quello che non possono sapere: esito del lavoro, criticità e prossimi passi.</p>
                    </div>
                    {REPORT_CHAT_STEPS.slice(0, reportChatStep).map((step, index) => <div className="space-y-2" key={step.title}>
                      <p className="text-[9px] leading-4 text-cyan-100/65">{reportQuestionOverrides[index] ?? step.prompt}</p>
                      <div className="flex items-start justify-between gap-3 rounded-xl border border-lime-300/10 bg-lime-300/[.035] px-3 py-2.5"><p className="whitespace-pre-wrap text-[10px] leading-5 text-slate-200">{reportAnswers[index]}</p>{canWriteReport && !reportLocked && <Button className="min-h-7 shrink-0 px-2 text-[9px] text-cyan-100" onClick={() => setReportChatStep(index)} type="button" variant="outline">Modifica</Button>}</div>
                    </div>)}
                    {reportChatStep < REPORT_CHAT_STEPS.length ? <div className="space-y-2.5">
                      <div className="flex items-center justify-between gap-2"><span className="text-[8px] font-semibold uppercase tracking-[.13em] text-cyan-100/65">Company AI · {reportQuestionStatus === "live" ? "domanda adattata ai dati" : reportQuestionStatus === "loading" ? "sta preparando la domanda" : reportQuestionStatus === "fallback" ? "domanda standard di riserva" : "colloquio guidato"}</span><span className="text-[9px] text-slate-600">{reportChatStep + 1}/{REPORT_CHAT_STEPS.length}</span></div>
                      <p aria-live="polite" className="rounded-xl rounded-tl-sm border border-white/[.07] bg-black/25 px-3 py-2.5 text-[10px] leading-5 text-slate-200">{reportQuestionOverrides[reportChatStep] ?? REPORT_CHAT_STEPS[reportChatStep].prompt}</p>
                      <label className="block space-y-1.5 text-[9px] text-slate-500"><span>{REPORT_CHAT_STEPS[reportChatStep].title} · risposta obbligatoria</span><Textarea aria-label={REPORT_CHAT_STEPS[reportChatStep].title} className="min-h-[96px] border-white/10 bg-black/30 text-[11px] text-slate-100" disabled={!canWriteReport || reportLocked || reportQuestionStatus === "loading"} onChange={(event) => updateReportAnswer(reportChatStep, event.target.value)} placeholder={REPORT_CHAT_STEPS[reportChatStep].placeholder} value={reportAnswers[reportChatStep]} /></label>
                      <div className="flex items-center justify-between gap-3"><span aria-live="polite" className="text-[9px] text-slate-600">{reportSaving ? "Salvataggio della risposta…" : reportQuestionStatus === "loading" ? "Preparazione della domanda personalizzata…" : "Risposta salvata prima di proseguire"}</span><Button className="min-h-9 bg-cyan-200 px-3 text-[10px] font-semibold text-[#061012] hover:bg-cyan-100" disabled={!canWriteReport || reportLocked || reportSaving || reportQuestionStatus === "loading"} onClick={advanceReportChat} type="button">{reportSaving ? "Salvataggio…" : reportQuestionStatus === "loading" ? "Company AI…" : reportChatStep === REPORT_CHAT_STEPS.length - 1 ? "Rivedi il racconto" : "Invia risposta"}<Send className="size-3.5" /></Button></div>
                    </div> : <div className="space-y-2.5">
                      <p className="rounded-xl rounded-tl-sm border border-lime-300/15 bg-lime-300/[.04] px-3 py-2.5 text-[10px] leading-5 text-lime-100/85">Racconto completo. Rileggi le risposte; puoi modificarle prima dell’invio.</p>
                      {REPORT_CHAT_STEPS.map((step, index) => <div className="rounded-xl border border-white/[.07] bg-black/20 px-3 py-2.5" key={step.title}><div className="flex items-center justify-between gap-2"><span className="text-[8px] font-semibold uppercase tracking-[.12em] text-slate-500">{step.title}</span>{canWriteReport && !reportLocked && <Button className="min-h-7 px-2 text-[9px] text-cyan-100" onClick={() => setReportChatStep(index)} type="button" variant="outline">Modifica</Button>}</div><p className="mt-1 whitespace-pre-wrap text-[10px] leading-5 text-slate-200">{reportAnswers[index]}</p></div>)}
                      <p className="text-right text-[9px] text-slate-600">{reportText.trim().length}/40 caratteri minimi</p>
                    </div>}
                  </section>
                  {canReviewReport && payload.workspace.rapportino.status === "SUBMITTED" && <label className="space-y-2 text-xs text-slate-400"><span>Nota revisione <span className="text-slate-600">(obbligatoria per richiedere integrazioni)</span></span><Textarea className="mt-2 min-h-[90px] border-amber-300/20 bg-black/30 text-slate-100" onChange={(event) => setReviewNote(event.target.value)} placeholder="Conferma il rapportino oppure indica cosa deve essere integrato…" value={reviewNote} /></label>}
                </div>
              )}
              {actionOpen === "progress" && (
                <div className="space-y-4">
                  <div className="flex items-end justify-between">
                    <p className="text-xs text-slate-400">
                      Avanzamento verificato
                    </p>
                    <span className="font-mono text-2xl text-lime-200">
                      {progress}%
                    </span>
                  </div>
                  <input
                    aria-label="Avanzamento commessa"
                    className="w-full accent-lime-300"
                    max="100"
                    min="0"
                    onChange={(event) =>
                      setProgress(Number(event.target.value))
                    }
                    type="range"
                    value={progress}
                  />
                </div>
              )}
              <DialogFooter>
                <DialogClose asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="border-white/10 bg-transparent text-slate-400"
                  >
                    Annulla
                  </Button>
                </DialogClose>
                {actionOpen === "report" ? (
                  <>
                    {canWriteReport && !reportLocked && <Button
                      type="button"
                      variant="outline"
                      className="border-cyan-300/25 bg-cyan-300/[0.05] text-cyan-100 hover:bg-cyan-300/[0.1]"
                      disabled={mutationBusy || reportText.trim().length < 2}
                      onClick={() => submitReport("DRAFT")}
                    >
                      Salva bozza
                    </Button>}
                    {canWriteReport && !reportLocked && <Button
                      type="button"
                      className="bg-lime-300 text-[#060806] hover:bg-lime-200 disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={mutationBusy || !reportCanSubmit}
                      onClick={() => submitReport("SUBMIT")}
                    >
                      <Send className="size-3.5" />
                      Invia in ufficio
                    </Button>}
                    {canReviewReport && payload.workspace.rapportino.status === "SUBMITTED" && <><Button type="button" variant="outline" className="border-amber-300/25 bg-amber-300/[0.05] text-amber-100 hover:bg-amber-300/[0.1]" onClick={() => submitReport("REQUEST_CHANGES")}><FileText className="size-3.5" />Richiedi integrazione</Button><Button type="button" className="bg-lime-300 text-[#060806] hover:bg-lime-200" onClick={() => submitReport("APPROVE")}><CheckCircle2 className="size-3.5" />Approva rapportino</Button></>}
                  </>
                ) : (
                  <Button
                    type="submit"
                    disabled={mutationBusy}
                    className="bg-lime-300 text-[#060806] hover:bg-lime-200"
                  >
                    <Send className="size-3.5" />
                    Salva e rileggi
                  </Button>
                )}
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
      {toast && (
        <button
          className="fixed bottom-5 right-5 z-50 max-w-[360px] rounded-xl border border-lime-300/25 bg-[#0a100c]/95 px-4 py-3 text-left text-xs text-lime-100 shadow-[0_0_28px_rgba(190,255,60,0.14)] backdrop-blur-xl"
          onClick={() => setToast("")}
          type="button"
        >
          <CheckCircle2 className="mr-2 inline size-4 text-lime-300" />
          {toast}
        </button>
      )}
    </main>
  );
}
