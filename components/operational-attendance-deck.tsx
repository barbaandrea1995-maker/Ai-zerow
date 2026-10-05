"use client";

import { BriefcaseBusiness, Clock3, MapPin, Route, ShieldCheck, Truck, Warehouse } from "lucide-react";
import { AttendanceControl } from "@/components/attendance-control";
import { WarehouseAttendanceControl } from "@/components/warehouse-attendance-control";
import type { AttendanceTarget } from "@/lib/attendance-scope";

type Props = {
  targets: AttendanceTarget[];
  onChanged?: () => void | Promise<void>;
};

function targetCopy(target: AttendanceTarget) {
  if (target.kind === "DRIVER") return {
    eyebrow: "PRESENZA / MISSIONE",
    title: "Ingresso autista e tracking",
    icon: Truck,
    accent: "border-lime-300/20 bg-lime-300/[.035] text-lime-100",
    note: target.stopCount > 1
      ? `Missione multi-tappa · ${target.stopCount} tappe server-side · il tracking parte solo dopo l’ingresso valido.`
      : "Il tracking parte solo dopo l’ingresso valido e termina con l’uscita approvata.",
  };
  return {
    eyebrow: "PRESENZA / COMMESSA",
    title: "Ingresso attività",
    icon: BriefcaseBusiness,
    accent: "border-cyan-300/20 bg-cyan-300/[.025] text-cyan-100",
    note: "Entrata e uscita richiedono la posizione dentro la geofence server-side del cantiere.",
  };
}

export function OperationalAttendanceDeck({ targets, onChanged }: Props) {
  const warehouseTargets = targets.filter((target) => target.kind === "WAREHOUSE");
  const serviceTargets = targets.filter((target) => target.kind !== "WAREHOUSE");

  return <section className="carbon-card-neon mt-4 rounded-2xl p-4 sm:p-5" aria-labelledby="operational-attendance-title">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <span className="grid size-10 place-items-center rounded-2xl border border-lime-300/25 bg-lime-300/10 text-lime-200"><Clock3 className="size-5" /></span>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-lime-300/70">IL TUO SERVIZIO</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-100" id="operational-attendance-title">Timbrature assegnate</h2>
          <p className="mt-1 max-w-3xl text-[11px] leading-5 text-slate-500">Questa è l’unica superficie per iniziare o chiudere il servizio. I perimetri arrivano dal server e non possono essere scelti manualmente.</p>
        </div>
      </div>
      <span className="inline-flex items-center gap-1.5 rounded-full border border-lime-300/20 bg-lime-300/[.06] px-2.5 py-1.5 text-[9px] font-semibold uppercase tracking-[.12em] text-lime-100"><ShieldCheck className="size-3.5" />Server-side</span>
    </div>

    {targets.length === 0 && <div className="mt-4 rounded-2xl border border-dashed border-amber-300/20 bg-amber-300/[.025] p-5 text-center"><MapPin className="mx-auto size-6 text-amber-200/80" /><p className="mt-3 text-sm font-semibold text-slate-200">Nessun perimetro assegnato</p><p className="mx-auto mt-1 max-w-lg text-[11px] leading-5 text-slate-500">Quando Authority o Pianificazione assegneranno un magazzino, un’attività o una missione al tuo profilo, il relativo ingresso apparirà qui.</p></div>}

    {warehouseTargets.length > 0 && <div className="mt-4 rounded-2xl border border-cyan-300/15 bg-cyan-300/[.025] p-3 sm:p-4"><div className="flex items-start gap-3"><span className="grid size-9 place-items-center rounded-xl border border-cyan-300/20 bg-cyan-300/[.06] text-cyan-200"><Warehouse className="size-4" /></span><div><p className="text-[9px] font-semibold uppercase tracking-[.18em] text-cyan-200/70">PERIMETRO MAGAZZINO</p><h3 className="mt-1 text-sm font-semibold text-slate-100">Magazzini assegnati</h3><p className="mt-1 text-[10px] leading-5 text-slate-500">Il responsabile e il magazziniere timbrano solo sul deposito autorizzato. La presenza di magazzino non apre tracking continuo.</p></div></div><WarehouseAttendanceControl warehouses={warehouseTargets.map((target) => ({ id: target.warehouseId ?? target.id, code: target.code ?? "MAG", name: target.title, locationLabel: target.location ?? target.detail }))} onChanged={onChanged} /></div>}

    {serviceTargets.length > 0 && <div className="mt-4 space-y-3">{serviceTargets.map((target) => {
      const copy = targetCopy(target);
      const Icon = copy.icon;
      return <article className={`rounded-2xl border p-3 sm:p-4 ${copy.accent}`} key={target.id}>
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-xl border border-current/20 bg-current/10"><Icon className="size-4" /></span><div className="min-w-0"><p className="text-[9px] font-semibold uppercase tracking-[.18em] opacity-75">{copy.eyebrow}</p><h3 className="mt-1 truncate text-sm font-semibold text-slate-100">{target.code ? `${target.code} · ` : ""}{target.title}</h3><p className="mt-1 truncate text-[10px] text-slate-400">{target.detail}</p></div></div><span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[8px] font-semibold uppercase tracking-[.08em] text-slate-400"><Route className="size-3" />{target.assignmentSource}</span></div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-500"><span className="inline-flex items-center gap-1.5"><MapPin className="size-3 text-lime-200" />{target.location ?? "Luogo server-side"}</span>{target.activityLabel && <span>{target.activityLabel}</span>}{target.startsAt && <span>Inizio {new Date(target.startsAt).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}</span>}</div>
        <p className="mt-3 rounded-xl border border-white/[.08] bg-black/20 px-3 py-2 text-[10px] leading-5 text-slate-400">{copy.note}</p>
        {target.jobId && <AttendanceControl jobId={target.jobId} onChanged={onChanged} />}
      </article>;
    })}</div>}
  </section>;
}

