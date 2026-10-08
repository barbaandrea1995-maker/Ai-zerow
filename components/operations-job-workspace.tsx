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
  BadgeCheck,
  BriefcaseBusiness,
  CalendarClock,
  Check,
  CheckCircle2,
  ClipboardCheck,
  CircleGauge,
  FileText,
  Flag,
  FolderKanban,
  HardHat,
  Layers3,
  LoaderCircle,
  MapPin,
  Package,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Truck,
  Users,
  Wrench,
} from "lucide-react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
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
import JobCommercialJourney from "@/components/job-commercial-journey";

type WorkspaceRecord = {
  id: string;
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
  status: "EMPTY" | "DRAFT" | "SUBMITTED";
  draft: string;
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
    rapportino: RapportinoReadback;
  };
  readback?: { version?: number };
  mutation?: { action: string; version?: number; readback?: string };
};

type ActionKind =
  | "details"
  | "activity"
  | "assign"
  | "evidence"
  | "report"
  | "progress"
  | null;

function sectionLabel(status: WorkspaceSection["status"]) {
  if (status === "readback") return "VERIFICATO";
  if (status === "deferred") return "PROSSIMO PASSO";
  return "DA COMPLETARE";
}

function sectionTone(status: WorkspaceSection["status"]) {
  if (status === "readback")
    return "border-lime-300/25 bg-lime-300/10 text-lime-200";
  if (status === "deferred")
    return "border-amber-300/25 bg-amber-300/10 text-amber-200";
  return "border-white/10 bg-black/20 text-slate-500";
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
    ].includes(value)
  )
    return "border-lime-300/25 bg-lime-300/10 text-lime-200";
  if (["BLOCKED", "BLOCCATA"].includes(value))
    return "border-rose-300/25 bg-rose-300/10 text-rose-200";
  if (["DRAFT", "BOZZA", "QUEUED", "PROPOSTA", "DA PREPARARE"].includes(value))
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

function displayJourneyStep(key: string, fallback: string) {
  const labels: Record<string, string> = {
    activity: "Attività",
    assignment: "Assegnazione",
    attendance: "Presenze",
    control: "Verifica finale",
    field: "Esecuzione sul campo",
    job: "Commessa",
    planning: "Pianificazione",
    rapportino: "Rapportino",
    "work-context": "Luogo e lavoro",
  };
  return labels[key] ?? fallback;
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
  assign: "Risorse assegnate",
  set_status: "Stato aggiornato",
  update_details: "Scheda aggiornata",
  update_progress: "Avanzamento aggiornato",
};

function displayAction(value: string) {
  return ACTION_LABELS[value] ?? "Scheda aggiornata";
}

function compactDescription(value: string, maxLength = 260) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  const sentenceEnd = normalized.slice(0, maxLength).lastIndexOf(". ");
  const cutoff = sentenceEnd > 120 ? sentenceEnd + 1 : maxLength;
  return `${normalized.slice(0, cutoff).trim()}…`;
}

function valueOr(value: unknown, fallback = "—") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
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

function looksLikeAddress(value: string, location: string) {
  const normalizedValue = value.trim().toLocaleLowerCase("it-IT");
  const normalizedLocation = location.trim().toLocaleLowerCase("it-IT");
  return (
    normalizedValue === normalizedLocation ||
    /^(via|viale|corso|piazza|largo|strada|contrada|km)\b/i.test(value.trim())
  );
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

function JourneyRail({
  journey,
}: {
  journey: WorkspacePayload["workspace"]["journey"];
}) {
  return (
    <section className="carbon-card rounded-[24px] p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="grid size-10 place-items-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-200">
          <Layers3 className="size-4" />
        </span>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-200/70">
            Percorso della commessa
          </p>
          <h2 className="mt-1 text-[15px] font-semibold text-slate-100">
            Dalla commessa alla chiusura
          </h2>
        </div>
      </div>
      <div className="mt-5">
        {journey.map((step, index) => {
          const complete = step.status === "readback";
          const deferred = step.status === "deferred";
          return (
            <div className="relative flex gap-3 pb-4 last:pb-0" key={step.key}>
              {index < journey.length - 1 && (
                <span className="absolute left-[9px] top-5 h-[calc(100%-9px)] w-px bg-white/[0.09]" />
              )}
              <span
                className={`relative z-10 grid size-[19px] shrink-0 place-items-center rounded-full border ${complete ? "border-lime-300/45 bg-lime-300 text-[#071006]" : deferred ? "border-amber-300/30 bg-amber-300/[0.08] text-amber-200" : "border-white/15 bg-black/30 text-slate-600"}`}
              >
                {complete ? (
                  <Check className="size-2.5" />
                ) : (
                  <span className="size-1.5 rounded-full bg-current" />
                )}
              </span>
              <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
                <span
                  className={`text-[11px] ${complete ? "text-slate-200" : deferred ? "text-amber-100/70" : "text-slate-500"}`}
                >
                  {displayJourneyStep(step.key, step.label)}
                </span>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.12em] ${complete ? "border-lime-300/20 bg-lime-300/[0.06] text-lime-200" : deferred ? "border-amber-300/20 bg-amber-300/[0.05] text-amber-200" : "border-white/10 text-slate-600"}`}
                >
                  {complete
                    ? "completato"
                    : deferred
                      ? "prossimo passo"
                      : "da iniziare"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function WorkspaceSectionCard({
  title,
  eyebrow,
  icon: Icon,
  section,
  onCompleteActivity,
}: {
  title: string;
  eyebrow: string;
  icon: typeof BriefcaseBusiness;
  section: WorkspaceSection;
  onCompleteActivity?: (activityId: string) => void;
}) {
  return (
    <section className="carbon-card group rounded-[22px] p-4 transition hover:border-lime-300/20 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/10 text-lime-200">
            <Icon className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-lime-300/65">
              {eyebrow}
            </p>
            <h2 className="mt-1 truncate text-[14px] font-semibold text-slate-100">
              {title}
            </h2>
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-1 text-[8px] font-semibold uppercase tracking-[0.1em] ${sectionTone(section.status)}`}
        >
          {section.count
            ? `${section.count} · ${sectionLabel(section.status)}`
            : sectionLabel(section.status)}
        </span>
      </div>
      <div className="mt-4 space-y-2">
        {section.records.map((record) => {
          const activityId =
            typeof record.payload?.id === "string" ? record.payload.id : null;
          return (
            <div
              className="carbon-inset flex items-center gap-3 rounded-xl p-3"
              key={record.id}
            >
              <span
                className={`grid size-7 shrink-0 place-items-center rounded-lg border ${statusTone(record.status)}`}
              >
                <CheckCircle2 className="size-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-medium text-slate-200">
                  {record.title}
                </p>
                <p className="mt-1 truncate text-[10px] text-slate-500">
                  {record.detail || displayRecordType(record.recordType)}
                </p>
              </div>
              <span
                className={`hidden rounded-full border px-2 py-1 text-[8px] font-semibold uppercase tracking-[0.08em] sm:inline-flex ${statusTone(record.status)}`}
              >
                {displayStatus(record.status)}
              </span>
              {onCompleteActivity && activityId && record.status !== "DONE" && (
                <button
                  aria-label={`Completa ${record.title}`}
                  className="grid size-7 shrink-0 place-items-center rounded-lg border border-lime-300/20 text-lime-200 transition hover:bg-lime-300/10"
                  onClick={() => onCompleteActivity(activityId)}
                  type="button"
                >
                  <Check className="size-3.5" />
                </button>
              )}
            </div>
          );
        })}
        {section.records.length === 0 && (
          <div className="rounded-xl border border-dashed border-white/[0.1] bg-black/15 px-3 py-5 text-center">
            <p className="text-[11px] text-slate-500">
              {section.status === "deferred"
                ? "Disponibile nel prossimo passaggio."
                : "Nessun record collegato alla commessa."}
            </p>
            <p className="mt-1 text-[10px] text-slate-700">
              I dati compariranno qui quando il passaggio sarà attivo.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

export default function OperationsJobWorkspace({
  canWriteOperations,
  jobId,
}: {
  canWriteOperations: boolean;
  jobId: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const openReportFromQuery = searchParams.get("open") === "rapportino";
  const autoOpenedReportJobRef = useRef("");
  const [payload, setPayload] = useState<WorkspacePayload | null>(null);
  const [state, setState] = useState<
    "loading" | "ready" | "unauthenticated" | "forbidden" | "missing" | "error"
  >("loading");
  const [actionOpen, setActionOpen] = useState<ActionKind>(null);
  const [toast, setToast] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [client, setClient] = useState("");
  const [location, setLocation] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [activityTitle, setActivityTitle] = useState("");
  const [activityDetail, setActivityDetail] = useState("");
  const [activityOwner, setActivityOwner] = useState("");
  const [activityDueDate, setActivityDueDate] = useState("");
  const [responsible, setResponsible] = useState("");
  const [team, setTeam] = useState("");
  const [role, setRole] = useState("Responsabile operativo");
  const [evidenceTitle, setEvidenceTitle] = useState("");
  const [evidenceDetail, setEvidenceDetail] = useState("");
  const [reportText, setReportText] = useState("");
  const [progress, setProgress] = useState(0);

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
    async (action: string, body: Record<string, unknown>) => {
      if (!payload) return;
      try {
        const response = await fetch(
          `/api/operations/jobs/${encodeURIComponent(jobId)}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action,
              expectedVersion: payload.readback?.version ?? 1,
              idempotencyKey: `w03-${jobId}-${action}-${crypto.randomUUID()}`,
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
          } else if (
            nextPayload.error === "rapportino_completeness_unmet" &&
            (nextPayload.questions?.length || nextPayload.completeness?.missing?.length)
          ) {
            notify(
              `Invio bloccato: ${nextPayload.questions?.[0] ?? "completa i dati mancanti"}`,
            );
          } else
            notify(
              nextPayload.error === "version_conflict"
                ? "La commessa è cambiata: aggiorno la scheda."
                : "Operazione non completata. Riprova.",
            );
          if (response.status === 409) await refresh();
          return;
        }
        setPayload(nextPayload);
        setProgress(nextPayload.job.progress);
        setActionOpen(null);
        notify(`Operazione completata · ${displayAction(action)}`);
      } catch {
        notify(
          "Connessione non disponibile: nessuna modifica è stata confermata.",
        );
      }
    },
    [jobId, notify, payload, refresh],
  );

  const nextStatusAction = useMemo(() => {
    const status = payload?.job.status ?? "";
    if (status === "BOZZA")
      return { label: "Invia in proposta", statusCode: "PROPOSED" };
    if (status === "PROPOSTA")
      return { label: "Approva commessa", statusCode: "APPROVED" };
    if (status === "APPROVATA")
      return { label: "Pianifica commessa", statusCode: "PLANNED" };
    if (status === "PIANIFICATA")
      return { label: "Avvia commessa", statusCode: "ACTIVE" };
    if (status === "IN CORSO")
      return { label: "Verifica completamento", statusCode: "COMPLETED" };
    if (status === "BLOCCATA")
      return { label: "Riprendi commessa", statusCode: "ACTIVE" };
    if (status === "COMPLETATA")
      return { label: "Chiudi commessa", statusCode: "CLOSED" };
    return null;
  }, [payload?.job.status]);

  const submitAction = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (actionOpen === "details")
      await mutate("update_job", {
        fields: { title, description, client, location, dueDate },
      });
    if (actionOpen === "activity")
      await mutate("add_activity", {
        title: activityTitle,
        detail: activityDetail,
        owner: activityOwner,
        dueDate: activityDueDate,
      });
    if (actionOpen === "assign")
      await mutate("assign", { responsible, team, role });
    if (actionOpen === "evidence")
      await mutate("add_evidence", {
        title: evidenceTitle,
        detail: evidenceDetail,
        kind: "note",
      });
    if (actionOpen === "report")
      await mutate("save_rapportino", { text: reportText });
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
    setLocation(
      typeof payload.job.payload?.location === "string"
        ? payload.job.payload.location
        : payload.job.detail,
    );
    setDueDate(
      typeof payload.job.payload?.dueDate === "string"
        ? payload.job.payload.dueDate
        : payload.job.meta,
    );
    setActionOpen("details");
  };

  const openReport = () => {
    if (!payload) return;
    setReportText(payload.workspace.rapportino.draft);
    setActionOpen("report");
  };

  useEffect(() => {
    if (!openReportFromQuery || !payload || autoOpenedReportJobRef.current === jobId) return;
    autoOpenedReportJobRef.current = jobId;
    setReportText(payload.workspace.rapportino.draft);
    setActionOpen("report");
  }, [jobId, openReportFromQuery, payload]);

  const submitReport = (intent: "DRAFT" | "SUBMIT") => {
    void mutate(intent === "SUBMIT" ? "submit_rapportino" : "save_rapportino", {
      text: reportText,
    });
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
              onClick={() => router.push("/operations")}
            >
              <ArrowLeft className="size-3.5" />
              Torna alle commesse
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
  const jobDescription = valueOr(
    jobData.description,
    "Descrizione operativa da completare.",
  );
  const jobSummary = compactDescription(jobDescription);
  const hasRealDescription = Boolean(
    typeof jobData.description === "string" && jobData.description.trim(),
  );
  const displayTitle =
    hasRealDescription && looksLikeAddress(job.title, locationLabel)
      ? compactDescription(jobDescription, 100)
      : job.title;
  const heroSummary =
    displayTitle !== job.title
      ? "Lavoro organizzato e monitorato dalla scheda della commessa."
      : jobSummary;
  const openingType =
    payloadText("openingType") === "PRONTO_INTERVENTO"
      ? "Pronto intervento"
      : "Nuova commessa";
  const sourceMode =
    payloadText("sourceMode") === "COMPANY_AI"
      ? "Da preventivo"
      : "Inserimento manuale";
  const priority = payloadText("priority", "STANDARD");
  const rawScope = jobData.scope;
  const jobScope =
    rawScope && typeof rawScope === "object" && !Array.isArray(rawScope)
      ? (rawScope as Record<string, unknown>)
      : null;
  const scopeLabel =
    jobScope &&
    typeof jobScope.sectionTitle === "string" &&
    typeof jobScope.groupTitle === "string" &&
    typeof jobScope.subgroupTitle === "string"
      ? `${jobScope.sectionTitle} / ${jobScope.groupTitle} / ${jobScope.subgroupTitle}`
      : "Categoria da completare";
  const dueDateLabel = formatCommercialDate(jobData.dueDate ?? job.meta);
  const nextStep = workspace.completion.ready
    ? "Verifica finale e chiusura"
    : workspace.sections.activities.count === 0
      ? "Aggiungi la prima attività"
      : workspace.sections.planning.count === 0
        ? "Prepara il programma di lavoro"
        : workspace.sections.evidence.count === 0
          ? "Raccogli la prima evidenza"
          : "Completa i dati della commessa";
  const contactLabel =
    payloadText("clientContact") ||
    payloadText("clientEmail") ||
    payloadText("clientPhone") ||
    "Referente da indicare";
  const sourcePreviewId = payloadText("aiPreviewId");
  const workItems = Array.isArray(jobData.workItems)
    ? jobData.workItems
        .filter((item): item is Record<string, unknown> =>
          Boolean(item && typeof item === "object" && !Array.isArray(item)),
        )
        .slice(0, 24)
    : [];

  return (
    <main className="zw-command-ultra min-h-screen overflow-x-hidden text-slate-100 selection:bg-lime-300 selection:text-[#060806]">
      <div className="zw-command-ambient" aria-hidden="true" />
      <div className="relative mx-auto max-w-[1560px] px-4 py-5 sm:px-7 sm:py-7">
        <header className="zw-command-topbar sticky top-0 z-20 -mx-4 mb-5 flex min-h-[72px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:-mx-7 sm:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <button aria-label="Apri Command" className="relative grid size-9 shrink-0 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black shadow-[0_0_18px_rgba(200,255,34,.12)]" onClick={() => router.push("/command")} type="button"><Image src="/ai-zerow-icon.jpeg" alt="ZEROW" width={36} height={36} className="size-full object-cover" /></button>
            <Button
              variant="outline"
              className="h-10 shrink-0 rounded-xl border-white/10 bg-black/20 px-3 text-xs text-slate-300 hover:border-lime-300/30 hover:text-lime-100"
              onClick={() => router.push("/operations")}
            >
              <ArrowLeft className="size-3.5" />
              Commesse
            </Button>
            <div className="min-w-0">
              <p className="truncate text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/70">
                COMMESSE / SCHEDA
              </p>
              <p className="mt-1 truncate text-[11px] text-slate-500">
                Scheda operativa della commessa
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-2 rounded-full border border-lime-300/20 bg-lime-300/[0.06] px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-lime-200 sm:inline-flex">
              <span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_9px_rgba(190,255,60,0.9)]" />
              Scheda aggiornata
            </span>
            <button
              aria-label="Aggiorna scheda commessa"
              className="grid size-9 place-items-center rounded-xl border border-white/10 bg-black/20 text-slate-500 transition hover:border-lime-300/30 hover:text-lime-200"
              onClick={() => void refresh()}
              type="button"
            >
              <RefreshCw className="size-4" />
            </button>
          </div>
        </header>

        <section className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <article className="relative overflow-hidden rounded-[28px] border border-lime-300/20 bg-[linear-gradient(140deg,rgba(24,38,29,0.96),rgba(7,12,13,0.98)_55%,rgba(13,24,22,0.95))] p-5 shadow-[0_30px_85px_rgba(0,0,0,0.32)] sm:p-7">
            <div className="pointer-events-none absolute -right-40 -top-44 size-[34rem] rounded-full bg-lime-300/[0.055] blur-3xl" />
            <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-lime-300/75 to-transparent" />
            <div className="relative flex flex-wrap items-start justify-between gap-5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-lime-300/25 bg-lime-300/[0.08] px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-lime-200">
                    {openingType}
                  </span>
                  <span className="rounded-full border border-cyan-300/20 bg-cyan-300/[0.06] px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-cyan-100/80">
                    {sourceMode}
                  </span>
                  {priority !== "STANDARD" && (
                    <span className="rounded-full border border-amber-300/20 bg-amber-300/[0.07] px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-amber-200">
                      Priorità {priority === "HIGH" ? "alta" : "bassa"}
                    </span>
                  )}
                </div>
                <h1 className="mt-4 max-w-4xl break-words text-3xl font-semibold tracking-[-0.055em] text-lime-100 sm:text-[42px]">
                  {displayTitle}
                </h1>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <p className="flex items-center gap-2 text-xs text-slate-400">
                    <MapPin className="size-3.5 shrink-0 text-cyan-200" />
                    {locationLabel}
                  </p>
                  {locationVerified && (
                    <span className="rounded-full border border-lime-300/20 bg-lime-300/[0.07] px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-lime-200">
                      Luogo verificato
                    </span>
                  )}
                </div>
                <p className="mt-4 line-clamp-4 max-w-3xl text-sm leading-6 text-slate-300/85">
                  {heroSummary}
                </p>
              </div>
              <div className="shrink-0 text-left sm:text-right">
                <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-600">
                  Stato della commessa
                </p>
                <span
                  className={`mt-2 inline-flex rounded-full border px-3 py-1.5 text-xs font-semibold ${statusTone(job.status)}`}
                >
                  {displayStatus(job.status)}
                </span>
              </div>
            </div>
            <div className="relative mt-7 grid gap-2 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/[0.08] bg-black/20 p-3.5">
                <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-slate-600">
                  Cliente
                </p>
                <p className="mt-2 truncate text-xs font-medium text-slate-200">
                  {clientName}
                </p>
                <p className="mt-1 truncate text-[10px] text-slate-500">
                  {contactLabel}
                </p>
              </div>
              <div className="rounded-2xl border border-white/[0.08] bg-black/20 p-3.5">
                <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-slate-600">
                  Scadenza
                </p>
                <p className="mt-2 truncate text-xs font-medium text-slate-200">
                  {dueDateLabel}
                </p>
                <p className="mt-1 text-[10px] text-slate-500">
                  Termine previsto
                </p>
              </div>
              <div className="rounded-2xl border border-lime-300/15 bg-lime-300/[0.045] p-3.5">
                <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-lime-300/65">
                  Categoria lavori
                </p>
                <p className="mt-2 line-clamp-2 text-xs font-medium text-lime-100/90">
                  {scopeLabel}
                </p>
                <p className="mt-1 text-[10px] text-slate-500">
                  Categoria lavori
                </p>
              </div>
            </div>
            <div className="relative mt-6 border-t border-white/[0.08] pt-5">
              <div className="flex items-center justify-between gap-3 text-[10px] text-slate-500">
                <span className="font-semibold uppercase tracking-[0.15em]">
                  Avanzamento
                </span>
                <span className="font-mono text-lg text-lime-200">
                  {job.progress}%
                </span>
              </div>
              <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-black/60">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-lime-300 via-lime-200 to-cyan-300 shadow-[0_0_20px_rgba(190,255,60,0.58)] transition-all"
                  style={{ width: `${job.progress}%` }}
                />
              </div>
            </div>
            {canWriteOperations && (
              <div className="relative mt-6 flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  className="h-10 border-white/10 bg-black/25 text-xs text-slate-300 hover:border-lime-300/35 hover:bg-lime-300/[0.07]"
                  onClick={openDetails}
                >
                  <BriefcaseBusiness className="size-3.5" />
                  Modifica dati
                </Button>
                {nextStatusAction && (
                  <Button
                    className="h-10 bg-lime-300 px-4 text-xs font-semibold text-[#060806] shadow-[0_0_22px_rgba(190,255,60,0.18)] hover:bg-lime-200"
                    onClick={() =>
                      void mutate("set_status", {
                        statusCode: nextStatusAction.statusCode,
                      })
                    }
                  >
                    <Send className="size-3.5" />
                    {nextStatusAction.label}
                  </Button>
                )}
                <Button
                  variant="outline"
                  className="h-10 border-cyan-300/25 bg-cyan-300/[0.05] text-xs text-cyan-100 hover:bg-cyan-300/[0.1]"
                  onClick={() => setActionOpen("progress")}
                >
                  <CircleGauge className="size-3.5" />
                  Aggiorna avanzamento
                </Button>
              </div>
            )}
          </article>
          <aside className="carbon-card rounded-[28px] p-5 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/70">
                  Quadro commessa
                </p>
                <h2 className="mt-1 text-[17px] font-semibold text-slate-100">
                  Situazione attuale
                </h2>
              </div>
              <span className="grid size-10 place-items-center rounded-2xl border border-lime-300/25 bg-lime-300/10 text-lime-200">
                <BadgeCheck className="size-5" />
              </span>
            </div>
            <div className="mt-6 flex items-center gap-4">
              <div className="relative grid size-24 shrink-0 place-items-center rounded-full border-[7px] border-lime-300/15 bg-black/25">
                <div className="absolute inset-[-7px] rounded-full border-[7px] border-transparent border-lime-300 border-r-transparent rotate-[-45deg]" />
                <span className="font-mono text-xl font-semibold text-lime-100">
                  {job.progress}%
                </span>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-200">
                  {workspace.completion.ready
                    ? "Pronta per la chiusura"
                    : "In lavorazione"}
                </p>
                <p className="mt-1 text-[11px] leading-5 text-slate-500">
                  Una vista chiara per seguire il lavoro e decidere il prossimo passo.
                </p>
              </div>
            </div>
            <div className="mt-6 space-y-3">
              <div className="flex items-center justify-between border-b border-white/[0.07] pb-3 text-[11px]">
                <span className="text-slate-500">Origine</span>
                <span className="text-cyan-100">{sourceMode}</span>
              </div>
              <div className="flex items-center justify-between border-b border-white/[0.07] pb-3 text-[11px]">
                <span className="text-slate-500">Prossimo passo</span>
                <span
                  className={
                    workspace.completion.ready
                      ? "text-lime-200"
                      : "text-amber-200"
                  }
                >
                  {workspace.completion.ready ? "CHIUSURA" : nextStep}
                </span>
              </div>
            </div>
            {sourcePreviewId && (
              <div className="mt-5 rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.045] p-3">
                <div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-cyan-100/75">
                  <Sparkles className="size-3.5" />
                  Preventivo collegato
                </div>
                <p className="mt-2 text-[10px] leading-4 text-slate-500">
                  Le lavorazioni rilevate dal preventivo sono disponibili nella scheda e possono essere completate dal team.
                </p>
              </div>
            )}
          </aside>
        </section>

        {workItems.length > 0 && (
          <section className="mt-4 overflow-hidden rounded-[24px] border border-lime-300/20 bg-[linear-gradient(145deg,rgba(190,255,60,0.07),rgba(7,13,11,0.94)_58%,rgba(34,211,238,0.035))] p-5 shadow-[0_20px_55px_rgba(0,0,0,0.2)] sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/70">
                  Lavorazioni della commessa
                </p>
                <h2 className="mt-1 text-[15px] font-semibold text-lime-100">
                  Attività rilevate dal preventivo
                </h2>
                <p className="mt-1 text-[11px] leading-5 text-slate-500">
                  Le lavorazioni restano organizzate e collegate all’ambito, senza
                  riversare il testo integrale del documento nella scheda.
                </p>
              </div>
              <span className="rounded-full border border-lime-300/25 bg-lime-300/[0.09] px-2.5 py-1 font-mono text-[10px] text-lime-200">
                {workItems.length} voci
              </span>
            </div>
            <div className="mt-4 grid gap-2 md:grid-cols-2">
              {workItems.map((item, index) => (
                <div
                  className="rounded-2xl border border-white/[0.08] bg-black/25 p-3.5"
                  key={typeof item.id === "string" ? item.id : `work-${index}`}
                >
                  <div className="flex items-start gap-3">
                    <span className="grid size-6 shrink-0 place-items-center rounded-lg border border-lime-300/25 bg-lime-300/[0.08] font-mono text-[9px] text-lime-200">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold leading-5 text-lime-100">
                        {valueOr(item.label ?? item.detail, "Lavorazione")}
                      </p>
                      <p className="mt-1 text-[11px] leading-5 text-slate-400">
                        {valueOr(item.detail, "Dettaglio da completare")}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-[9px] uppercase tracking-[0.08em] text-slate-600">
                    <span>
                      {valueOr(item.quantity, "quantità da verificare")}
                      {typeof item.unit === "string" && item.unit
                        ? ` ${item.unit}`
                        : ""}
                    </span>
                    <span className="text-slate-700">·</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <JobCommercialJourney jobId={jobId} />

        <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-4">
            <CompletionGate completion={workspace.completion} />
            <section className="carbon-card rounded-[24px] p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span className="grid size-10 place-items-center rounded-2xl border border-lime-300/20 bg-lime-300/10 text-lime-200">
                    <Wrench className="size-4" />
                  </span>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/65">
                  Gestione commessa
                    </p>
                    <h2 className="mt-1 text-[15px] font-semibold">
                      Cosa vuoi fare?
                    </h2>
                  </div>
                </div>
                <span className="rounded-full border border-lime-300/20 bg-lime-300/[0.05] px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-lime-200">
                  {canWriteOperations
                    ? "Gestione disponibile"
                    : "Solo consultazione"}
                </span>
              </div>
              <div
                className={`mt-5 grid gap-2 sm:grid-cols-2 ${canWriteOperations ? "lg:grid-cols-5" : "lg:grid-cols-1"}`}
              >
                {canWriteOperations && (
                  <>
                    <Button
                      variant="outline"
                      className="h-11 border-white/10 bg-black/20 text-xs text-slate-300 hover:border-lime-300/30"
                      onClick={() => setActionOpen("activity")}
                    >
                      <Plus className="size-3.5" />
                      Nuova attività
                    </Button>
                    <Button
                      variant="outline"
                      className="h-11 border-white/10 bg-black/20 text-xs text-slate-300 hover:border-lime-300/30"
                      onClick={() => setActionOpen("assign")}
                    >
                      <Users className="size-3.5" />
                      Assegna risorse
                    </Button>
                    <Button
                      variant="outline"
                      className="h-11 border-white/10 bg-black/20 text-xs text-slate-300 hover:border-lime-300/30"
                      onClick={() => setActionOpen("evidence")}
                    >
                      <MapPin className="size-3.5" />
                      Aggiungi evidenza
                    </Button>
                    <Button
                      variant="outline"
                      className="h-11 border-white/10 bg-black/20 text-xs text-slate-300 hover:border-lime-300/30"
                      onClick={openReport}
                    >
                      <FileText className="size-3.5" />
                      Crea rapportino con Company AI
                    </Button>
                  </>
                )}
                <Button
                  variant="outline"
                  className="h-11 border-white/10 bg-black/20 text-xs text-slate-300 hover:border-lime-300/30"
                  onClick={() => void refresh()}
                >
                  <RefreshCw className="size-3.5" />
                  Aggiorna dati
                </Button>
              </div>
            </section>
            <div className="grid gap-4 lg:grid-cols-2">
              <WorkspaceSectionCard
                eyebrow="LAVORO"
                title="Attività collegate"
                icon={ClipboardCheck}
                section={workspace.sections.activities}
                onCompleteActivity={
                  canWriteOperations
                    ? (activityId) =>
                        void mutate("complete_activity", { activityId })
                    : undefined
                }
              />
              <WorkspaceSectionCard
                eyebrow="PROGRAMMA"
                title="Programma e assegnazioni"
                icon={Users}
                section={workspace.sections.planning}
              />
              <WorkspaceSectionCard
                eyebrow="RISORSE"
                title="Persone, asset e mezzi"
                icon={Truck}
                section={workspace.sections.resources}
              />
              <WorkspaceSectionCard
                eyebrow="MATERIALI"
                title="Materiali e richieste"
                icon={Package}
                section={workspace.sections.materials}
              />
              <WorkspaceSectionCard
                eyebrow="DOCUMENTAZIONE"
                title="Evidenze del lavoro"
                icon={MapPin}
                section={workspace.sections.evidence}
              />
              <div className="scroll-mt-24" id="rapportino">
                <WorkspaceSectionCard
                  eyebrow="CONSUNTIVO"
                  title="Rapportino e controllo"
                  icon={FileText}
                  section={workspace.sections.rapportino}
                />
              </div>
            </div>
          </div>
          <aside className="min-w-0 space-y-4">
            <section className="carbon-card rounded-[24px] p-5 sm:p-6">
              <div className="flex items-start gap-3">
                <span className="grid size-10 place-items-center rounded-2xl border border-lime-300/20 bg-lime-300/10 text-lime-200">
                  <FolderKanban className="size-4" />
                </span>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/70">
                    In breve
                  </p>
                  <h2 className="mt-1 text-[15px] font-semibold">
                    Dati principali
                  </h2>
                </div>
              </div>
              <div className="mt-4">
                <InfoRow
                  icon={BriefcaseBusiness}
                  label="Cliente / ragione sociale"
                  value={clientName}
                />
                <InfoRow icon={Users} label="Referente" value={contactLabel} />
                <InfoRow
                  icon={MapPin}
                  label="Cantiere / luogo"
                  value={locationLabel}
                />
                <InfoRow
                  icon={CalendarClock}
                  label="Scadenza"
                  value={dueDateLabel}
                />
                <InfoRow
                  icon={Flag}
                  label="Riferimento cliente"
                  value={valueOr(jobData.clientReference, "Non indicato")}
                />
              </div>
            </section>
            <JourneyRail journey={workspace.journey} />
            <section className="relative overflow-hidden rounded-[24px] border border-cyan-300/15 bg-[linear-gradient(145deg,rgba(10,28,31,0.82),rgba(7,13,14,0.95))] p-5 sm:p-6">
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-200">
                  <HardHat className="size-4" />
                </span>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200/70">
                    Dati protetti
                  </p>
                  <h2 className="mt-1 text-[14px] font-semibold">
                    Tutto sotto controllo
                  </h2>
                </div>
              </div>
              <p className="mt-4 text-[11px] leading-5 text-slate-500">
                Le modifiche vengono controllate prima del salvataggio. Il percorso
                della commessa mostra sempre ciò che è già pronto e ciò che manca.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="rounded-full border border-lime-300/20 bg-lime-300/[0.06] px-2.5 py-1 text-[9px] text-lime-200">
                  DATI AGGIORNATI
                </span>
                <span className="rounded-full border border-cyan-300/20 bg-cyan-300/[0.06] px-2.5 py-1 text-[9px] text-cyan-100">
                  STATO TRACCIATO
                </span>
              </div>
            </section>
          </aside>
        </section>

        <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] py-5 text-[10px] text-slate-400">
          <span>ZEROW · SCHEDA COMMESSA</span>
          <span className="flex items-center gap-2">
            <CheckCircle2 className="size-3.5 text-lime-300" />
            Dati aggiornati · attività collegate · stato verificato
          </span>
        </footer>
      </div>

      {canWriteOperations && (
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
                          ? "Rapportino giornaliero"
                          : "Aggiorna avanzamento"}
              </DialogTitle>
              <DialogDescription className="text-slate-500">
                Le modifiche vengono verificate e confermate nella scheda della commessa.
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
                      className="mt-2 min-h-[90px] border-white/10 bg-black/30 text-slate-100"
                      onChange={(event) => setDescription(event.target.value)}
                      value={description}
                    />
                  </label>
                  <label className="space-y-2 text-xs text-slate-400">
                    Cliente
                    <Input
                      className="mt-2 border-white/10 bg-black/30 text-slate-100"
                      onChange={(event) => setClient(event.target.value)}
                      value={client}
                    />
                  </label>
                  <label className="space-y-2 text-xs text-slate-400">
                    Scadenza
                    <Input
                      className="mt-2 border-white/10 bg-black/30 text-slate-100"
                      onChange={(event) => setDueDate(event.target.value)}
                      value={dueDate}
                    />
                  </label>
                  <label className="space-y-2 text-xs text-slate-400 sm:col-span-2">
                    Ubicazione
                    <Input
                      className="mt-2 border-white/10 bg-black/30 text-slate-100"
                      onChange={(event) => setLocation(event.target.value)}
                      value={location}
                    />
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
                    <Input
                      className="mt-2 border-white/10 bg-black/30 text-slate-100"
                      onChange={(event) => setActivityOwner(event.target.value)}
                      placeholder="Persona o squadra"
                      value={activityOwner}
                    />
                  </label>
                  <label className="space-y-2 text-xs text-slate-400">
                    Scadenza
                    <Input
                      className="mt-2 border-white/10 bg-black/30 text-slate-100"
                      onChange={(event) =>
                        setActivityDueDate(event.target.value)
                      }
                      placeholder="YYYY-MM-DD"
                      value={activityDueDate}
                    />
                  </label>
                </div>
              )}
              {actionOpen === "assign" && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="space-y-2 text-xs text-slate-400">
                    Responsabile
                    <Input
                      className="mt-2 border-white/10 bg-black/30 text-slate-100"
                      onChange={(event) => setResponsible(event.target.value)}
                      placeholder="Nome responsabile"
                      value={responsible}
                    />
                  </label>
                  <label className="space-y-2 text-xs text-slate-400">
                    Squadra
                    <Input
                      className="mt-2 border-white/10 bg-black/30 text-slate-100"
                      onChange={(event) => setTeam(event.target.value)}
                      placeholder="Squadra / crew"
                      value={team}
                    />
                  </label>
                  <label className="space-y-2 text-xs text-slate-400 sm:col-span-2">
                    Ruolo
                    <Input
                      className="mt-2 border-white/10 bg-black/30 text-slate-100"
                      onChange={(event) => setRole(event.target.value)}
                      value={role}
                    />
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
                  <section className="rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.045] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex items-start gap-2.5">
                        <span className="grid size-8 shrink-0 place-items-center rounded-xl border border-cyan-300/25 bg-cyan-300/10 text-cyan-100">
                          <Sparkles className="size-3.5" />
                        </span>
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-100/80">
                            Company AI · precompilazione governata
                          </p>
                          <p className="mt-1 text-[11px] leading-5 text-slate-400">
                            Ho raccolto ciò che il sistema già conosce da commessa, presenze, planning, asset e magazzino. Tu confermi solo ciò che manca.
                          </p>
                        </div>
                      </div>
                      <span className={`rounded-full border px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.1em] ${statusTone(payload.workspace.rapportino.status)}`}>
                        {payload.workspace.rapportino.status === "SUBMITTED" ? "INVIATO" : payload.workspace.rapportino.status === "DRAFT" ? "BOZZA" : "NUOVO"}
                      </span>
                    </div>
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      {payload.workspace.rapportino.fields.map((field) => (
                        <div className="rounded-xl border border-white/[0.08] bg-black/20 p-3" key={field.key}>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500">{field.label}</span>
                            <span className={`size-1.5 rounded-full ${field.status === "known" ? "bg-lime-300" : field.status === "missing" ? "bg-amber-300" : "bg-cyan-300"}`} />
                          </div>
                          <p className="mt-1.5 line-clamp-2 text-[11px] leading-4 text-slate-200">{field.value}</p>
                          <p className="mt-1 text-[9px] text-slate-600">{field.source}</p>
                        </div>
                      ))}
                    </div>
                    {payload.workspace.rapportino.completeness.questions.length > 0 && (
                      <div className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/[0.05] p-3">
                        <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-amber-200/80">Dati richiesti prima dell’invio</p>
                        <ul className="mt-2 space-y-1.5 text-[11px] leading-4 text-amber-100/80">
                          {payload.workspace.rapportino.completeness.questions.map((question) => (
                            <li className="flex gap-2" key={question}>
                              <span className="mt-1.5 size-1 shrink-0 rounded-full bg-amber-300" />
                              <span>{question}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </section>
                  <label className="space-y-2 text-xs text-slate-400">
                    Consuntivo del turno
                    <Textarea
                      className="mt-2 min-h-[220px] border-white/10 bg-black/30 text-slate-100"
                      onChange={(event) => setReportText(event.target.value)}
                      placeholder="Company AI precompila qui. Completa criticità, materiali e prossimi passi; poi salva la bozza o invia in ufficio."
                      value={reportText}
                    />
                  </label>
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
                    <Button
                      type="button"
                      variant="outline"
                      className="border-cyan-300/25 bg-cyan-300/[0.05] text-cyan-100 hover:bg-cyan-300/[0.1]"
                      onClick={() => submitReport("DRAFT")}
                    >
                      Salva bozza
                    </Button>
                    <Button
                      type="button"
                      className="bg-lime-300 text-[#060806] hover:bg-lime-200"
                      onClick={() => submitReport("SUBMIT")}
                    >
                      <Send className="size-3.5" />
                      {payload.workspace.rapportino.status === "SUBMITTED" ? "Invia revisione" : "Invia in ufficio"}
                    </Button>
                  </>
                ) : (
                  <Button
                    type="submit"
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
