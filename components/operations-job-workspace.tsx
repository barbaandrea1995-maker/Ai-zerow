"use client";

import { useEffect, useState } from "react";
import {
  ArrowLeft,
  BriefcaseBusiness,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  HardHat,
  LoaderCircle,
  MapPin,
  Package,
  ShieldCheck,
  Truck,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type WorkspaceRecord = {
  id: string;
  module: string;
  title: string;
  detail: string;
  meta: string;
  status: string;
  progress: number;
};

type WorkspaceSection = {
  status: "readback" | "empty" | "deferred";
  count: number;
  records: WorkspaceRecord[];
};

type WorkspacePayload = {
  job: WorkspaceRecord;
  workspace: {
    sections: {
      activities: WorkspaceSection;
      planning: WorkspaceSection;
      resources: WorkspaceSection;
      materials: WorkspaceSection;
      field: WorkspaceSection;
      rapportino: WorkspaceSection;
      control: WorkspaceSection;
    };
    journey: Array<{ key: string; label: string; status: "readback" | "empty" | "deferred" }>;
  };
};

function sectionLabel(status: WorkspaceSection["status"]) {
  if (status === "readback") return "D1 READBACK";
  if (status === "deferred") return "GATE SUCCESSIVO";
  return "NESSUN DATO";
}

function statusClass(status: WorkspaceSection["status"]) {
  if (status === "readback") return "border-lime-300/25 bg-lime-300/10 text-lime-200";
  if (status === "deferred") return "border-amber-300/25 bg-amber-300/10 text-amber-200";
  return "border-white/10 bg-black/20 text-slate-500";
}

function WorkspaceSectionCard({ title, eyebrow, icon: Icon, section }: { title: string; eyebrow: string; icon: typeof BriefcaseBusiness; section: WorkspaceSection }) {
  return <section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div className="flex items-start gap-3"><span className="grid size-9 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/10 text-lime-200"><Icon className="size-4" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-lime-300/65">{eyebrow}</p><h2 className="mt-1 text-[15px] font-semibold text-slate-100">{title}</h2></div></div><span className={`rounded-full border px-2 py-1 text-[9px] font-semibold tracking-[0.08em] ${statusClass(section.status)}`}>{sectionLabel(section.status)}</span></div><div className="mt-4 space-y-2">{section.records.map((record) => <div className="carbon-inset flex items-center gap-3 rounded-xl p-3" key={record.id}><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-slate-200">{record.title}</p><p className="mt-1 truncate text-[10px] text-slate-500">{record.detail} · {record.meta}</p></div><span className="font-mono text-[10px] text-cyan-200/80">{record.status}</span></div>)}{section.records.length === 0 && <p className="rounded-xl border border-white/[0.08] bg-black/15 px-3 py-4 text-center text-[11px] leading-5 text-slate-500">{section.status === "deferred" ? "Questa parte resta esplicitamente fuori dalla tranche U5." : "Nessun record collegato alla commessa nel readback tenant-scoped."}</p>}</div></section>;
}

export default function OperationsJobWorkspace({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [payload, setPayload] = useState<WorkspacePayload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unauthenticated" | "forbidden" | "missing" | "error">("loading");

  useEffect(() => {
    let active = true;
    fetch(`/api/operations/jobs/${encodeURIComponent(jobId)}`, { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) throw new Error("unauthenticated");
        if (response.status === 403) throw new Error("forbidden");
        if (response.status === 404) throw new Error("missing");
        if (!response.ok) throw new Error("error");
        return await response.json() as WorkspacePayload;
      })
      .then((nextPayload) => {
        if (!active) return;
        setPayload(nextPayload);
        setState("ready");
      })
      .catch((error: unknown) => {
        if (!active) return;
        const code = error instanceof Error ? error.message : "error";
        setState(code === "unauthenticated" || code === "forbidden" || code === "missing" ? code : "error");
      });
    return () => {
      active = false;
    };
  }, [jobId]);

  if (state === "loading") return <main className="grid min-h-screen place-items-center bg-[#050607] text-slate-100"><div className="flex items-center gap-3 text-xs text-slate-500"><LoaderCircle className="size-4 animate-spin text-lime-300" />Caricamento workspace commessa…</div></main>;

  if (state !== "ready" || !payload) {
    const message = state === "unauthenticated" ? "Accedi per leggere il workspace della commessa." : state === "forbidden" ? "Il ruolo corrente non dispone di operations.read." : state === "missing" ? "La commessa non è presente nel readback tenant-scoped." : "Il workspace non è momentaneamente disponibile.";
    return <main className="grid min-h-screen place-items-center bg-[#050607] px-5 text-slate-100"><section className="carbon-card w-full max-w-lg rounded-2xl p-6 text-center"><ShieldCheck className="mx-auto size-8 text-amber-200" /><h1 className="mt-4 text-lg font-semibold">Workspace non disponibile</h1><p className="mt-2 text-xs leading-5 text-slate-500">{message}</p><div className="mt-5 flex justify-center gap-2"><Button variant="outline" className="border-white/10 bg-black/20 text-xs text-slate-300" onClick={() => router.push("/operations")}><ArrowLeft className="size-3.5" />Torna alle commesse</Button>{state === "unauthenticated" && <Button className="bg-lime-300 text-xs font-semibold text-[#060806]" onClick={() => router.push(`/login?next=${encodeURIComponent(`/operations/${jobId}`)}`)}>Accedi</Button>}</div></section></main>;
  }

  const { job, workspace } = payload;
  return <main className="min-h-screen overflow-x-hidden bg-[#050607] text-slate-100"><div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_74%_0%,rgba(190,255,60,0.07),transparent_25%),radial-gradient(circle_at_18%_78%,rgba(70,110,120,0.08),transparent_27%)]" /><div className="relative mx-auto max-w-[1440px] px-4 py-5 sm:px-7 sm:py-8"><header className="flex flex-wrap items-center justify-between gap-4"><div className="flex items-center gap-3"><Button variant="outline" className="h-9 border-white/10 bg-black/20 px-3 text-xs text-slate-300 hover:border-lime-300/30 hover:text-lime-100" onClick={() => router.push("/operations")}><ArrowLeft className="size-3.5" />Commesse</Button><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/70">AI-ZEROW / OPERATIONS / JOB WORKSPACE</p><h1 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-slate-50">{job.id} · {job.title}</h1></div></div><span className="inline-flex items-center gap-2 rounded-full border border-lime-300/20 bg-lime-300/5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-lime-200"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_9px_rgba(190,255,60,0.9)]" />D1 scoped readback</span></header><section className="carbon-card carbon-card-neon mt-5 rounded-2xl p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-5"><div><p className="font-mono text-xs text-lime-200">{job.id}</p><h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-50">{job.title}</h2><p className="mt-2 flex items-center gap-2 text-xs text-slate-500"><MapPin className="size-3.5 text-cyan-200" />{job.detail}</p></div><div className="text-left sm:text-right"><p className="text-[10px] uppercase tracking-[0.16em] text-slate-600">Stato</p><p className="mt-1 text-sm font-semibold text-lime-200">{job.status}</p><p className="mt-1 text-[11px] text-slate-500">{job.meta}</p></div></div><div className="mt-6"><div className="flex items-center justify-between text-[10px] text-slate-500"><span>Avanzamento commessa</span><span className="font-mono text-lime-200">{job.progress}%</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-lime-300 shadow-[0_0_16px_rgba(190,255,60,0.64)]" style={{ width: `${job.progress}%` }} /></div></div></section><section className="carbon-card mt-4 rounded-2xl p-4 sm:p-5"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-200"><HardHat className="size-4" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200/70">U5 / GOLDEN JOURNEY</p><h2 className="mt-1 text-[15px] font-semibold">Job → Activity → Planning → Assignment → Attendance → Work Context → Field → Rapportino → Controllo</h2></div></div><div className="mt-5 flex flex-wrap gap-2">{workspace.journey.map((step) => <span className={`rounded-full border px-2.5 py-1.5 text-[10px] ${statusClass(step.status)}`} key={step.key}>{step.label} · {step.status === "readback" ? "READBACK" : step.status === "deferred" ? "DEFERRED" : "EMPTY"}</span>)}</div></section><div className="mt-4 grid gap-4 lg:grid-cols-2"><WorkspaceSectionCard eyebrow="ACTIVITY" title="Attività collegate" icon={ClipboardCheck} section={workspace.sections.activities} /><WorkspaceSectionCard eyebrow="PLANNING" title="Pianificazione e assegnazioni" icon={Users} section={workspace.sections.planning} /><WorkspaceSectionCard eyebrow="RESOURCES" title="Risorse e mezzi" icon={Truck} section={workspace.sections.resources} /><WorkspaceSectionCard eyebrow="MATERIALS" title="Materiali e magazzino" icon={Package} section={workspace.sections.materials} /><WorkspaceSectionCard eyebrow="FIELD" title="Work context e campo" icon={MapPin} section={workspace.sections.field} /><WorkspaceSectionCard eyebrow="OUTPUT" title="Rapportino e controllo" icon={FileText} section={workspace.sections.rapportino} /></div><footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] py-5 text-[10px] text-slate-600"><span>AI-ZEROW OPERATIONS · U5 JOB WORKSPACE</span><span className="flex items-center gap-2"><CheckCircle2 className="size-3.5 text-lime-300" />Letture tenant-scoped · nessuna scrittura diretta</span></footer></div></main>;
}
