"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Check, CheckCircle2, FileArchive, HardHat, LoaderCircle, LockKeyhole, PackageCheck, RefreshCw, Send, ShieldCheck, Truck, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type JourneyRecord = { id: string; domain: string; recordType: string; title: string; status: string; version: number; payload: Record<string, unknown>; updatedAt: string };
type JourneySection = { access: "granted" | "restricted"; count: number; records: JourneyRecord[] };
type JourneyPayload = {
  context?: { operatingDomains?: string[]; operatingTransportModes?: string[] };
  job: { id: string; code: string | null; title: string; status: string; location?: string | null };
  sections: {
    planning: JourneySection;
    field: JourneySection;
    warehouse: JourneySection & { movements: Array<{ id: string; movementType: string; quantity: number; item: { sku: string; name: string; unit: string } | null; createdAt: string }> };
    mission: JourneySection;
  documents: { access: "granted" | "restricted"; count: number; records: Array<{ id: string; fileName: string; category: string; sizeBytes: number; scanStatus: string; status: string; downloadable: boolean; downloadUrl: string; createdAt: string }> };
  };
  can: Record<string, boolean>;
  options?: {
    documentCategories?: Array<{ value: string; label: string }>;
    inventoryUnits?: Array<{ code: string; label: string; symbol: string }>;
    materialCatalog?: Array<{ id: string; sku: string; name: string; unit: string; unitLabel: string }>;
    workforce?: {
      people: Array<{ id: string; label: string }>;
      supervisors: Array<{ id: string; label: string }>;
      teams: Array<{ id: string; label: string }>;
    };
    catalogAuthority?: Record<string, string>;
  };
  readback?: { status: string; checkedAt?: string };
  mutation?: { action: string; eventId?: string; record?: JourneyRecord; idempotent?: boolean };
};
type ModalKind = "field" | "fieldClose" | "material" | "document" | null;
type JourneyCreateKind = "planning" | "field" | "material" | "mission";

const MODULES = [
  { key: "planning", label: "Pianificazione", eyebrow: "01 · PROGRAMMAZIONE", description: "Piani, date e risorse confermati nel registro aziendale.", domains: ["operations", "warehouse", "transport"], icon: CalendarClock, create: "planning" as JourneyCreateKind, capability: "planning_create" },
  { key: "field", label: "Cantiere e attività", eyebrow: "02 · ESECUZIONE", description: "Sessioni operative e avanzamento collegati alla commessa.", domains: ["operations"], icon: HardHat, create: "field" as JourneyCreateKind, capability: "field_open" },
  { key: "warehouse", label: "Materiali", eyebrow: "03 · APPROVVIGIONAMENTO", description: "Richieste, approvazioni e movimenti del magazzino.", domains: ["warehouse"], icon: PackageCheck, create: "material" as JourneyCreateKind, capability: "material_request" },
  { key: "mission", label: "Trasporti e consegne", eyebrow: "04 · LOGISTICA", description: "Missioni, tappe, carichi, scarichi ed evidenze gestiti nel registro Missioni.", domains: ["transport"], icon: Truck, create: "mission" as JourneyCreateKind, capability: "mission_create" },
] as const;

function field(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function statusTone(status: string) {
  const value = status.toUpperCase();
  if (["PUBLISHED", "CLOSED", "APPROVED", "FULFILLED", "DELIVERED", "POD_VERIFIED", "RECONCILED", "AVAILABLE_UNSCANNED", "AVAILABLE_CLEAN"].includes(value)) return "border-lime-300/25 bg-lime-300/[0.08] text-lime-100";
  if (["REJECTED", "CANCELLED"].includes(value)) return "border-rose-300/25 bg-rose-300/[0.08] text-rose-100";
  if (["OPEN", "DISPATCHED", "REQUESTED"].includes(value)) return "border-cyan-300/25 bg-cyan-300/[0.08] text-cyan-100";
  return "border-amber-300/25 bg-amber-300/[0.08] text-amber-100";
}

function textValue(value: unknown, fallback = "—") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

const JOURNEY_STATUS_LABELS: Record<string, string> = {
  APPROVED: "APPROVATO",
  AVAILABLE_CLEAN: "DISPONIBILE",
  AVAILABLE_UNSCANNED: "DA VERIFICARE",
  CLOSED: "CHIUSA",
  DELIVERED: "CONSEGNATO",
  DISPATCHED: "IN VIAGGIO",
  DRAFT: "BOZZA",
  FULFILLED: "EVASO",
  OPEN: "APERTO",
  PLANNED: "PIANIFICATO",
  POD_VERIFIED: "CONSEGNA VERIFICATA",
  PUBLISHED: "PUBBLICATO",
  RECONCILED: "RICONCILIATO",
  REJECTED: "RIFIUTATO",
  REQUESTED: "RICHIESTO",
};

function displayJourneyStatus(value: string) {
  const normalized = value.trim().toUpperCase();
  return JOURNEY_STATUS_LABELS[normalized] ?? value.replaceAll("_", " ");
}

function displayRecordType(value: string) {
  const labels: Record<string, string> = {
    attendance: "Presenza",
    field_session: "Sessione di cantiere",
    material_request: "Richiesta materiale",
    plan: "Piano operativo",
    transport: "Trasporto",
  };
  return labels[value] ?? value.replaceAll("_", " ");
}

function displayMovementType(value: string) {
  const labels: Record<string, string> = {
    DELIVERY: "Consegna",
    ISSUE: "Uscita",
    RECEIPT: "Carico",
    RETURN: "Rientro",
    TRANSFER: "Trasferimento",
  };
  return labels[value.trim().toUpperCase()] ?? value.replaceAll("_", " ");
}

function displayJourneyDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return "";
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime())
    ? parsed.toLocaleString("it-IT", { timeZone: "Europe/Rome", dateStyle: "short", timeStyle: "short" })
    : value;
}

function toServerDateTime(value: string) {
  if (!value) return "";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

function journeyErrorMessage(code: string | undefined) {
  if (code === "job_canonical_location_required") return "Registra prima l’indirizzo ufficiale della commessa.";
  if (code === "fulfillment_warehouse_location_required") return "Registra l’indirizzo del deposito selezionato prima di pianificare la missione.";
  if (code === "valid_material_needed_at_required") return "Controlla la data entro cui serve il materiale.";
  if (code === "material_catalog_item_required") return "Seleziona un articolo dal catalogo aziendale e controlla la quantità.";
  if (code === "material_catalog_selection_unavailable") return "L’articolo selezionato non è più disponibile nel catalogo. Aggiorna la commessa e riprova.";
  if (code === "version_conflict") return "Il record è stato aggiornato da un altro utente. Ho riletto i dati più recenti.";
  return "Operazione non completata. Controlla i dati e riprova.";
}

function recordSummary(record: JourneyRecord) {
  const payload = record.payload;
  const values: string[] = [];
  if (record.domain === "planning") {
    const resources = Array.isArray(payload.resources) ? payload.resources.flatMap((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
      const resource = entry as Record<string, unknown>;
      const label = textValue(resource.label ?? resource.name, "");
      return label ? [label] : [];
    }) : [];
    if (resources.length) values.push(resources.slice(0, 3).join(" · "));
  }
  if (record.domain === "field") {
    const team = textValue(payload.team, "");
    const supervisor = textValue(payload.supervisor, "");
    if (team || supervisor) values.push([team, supervisor].filter(Boolean).join(" · "));
  }
  if (record.domain === "warehouse") {
    const lines = Array.isArray(payload.lines) ? payload.lines.flatMap((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
      const line = entry as Record<string, unknown>;
      const description = textValue(line.description ?? line.name, "Materiale");
      const sku = textValue(line.sku, "");
      const quantity = line.quantity === undefined ? "" : `${String(line.quantity)} ${textValue(line.unit, "")}`.trim();
      return [`${description}${sku ? ` · ${sku}` : ""}${quantity ? ` · ${quantity}` : ""}`];
    }) : [];
    if (lines.length) values.push(lines.slice(0, 2).join("; "));
    const deliveryPoint = textValue(payload.deliveryPoint, "");
    if (deliveryPoint) values.push(`Consegna: ${deliveryPoint}`);
    const deliveryInstructions = textValue(payload.deliveryInstructions, "");
    if (deliveryInstructions) values.push(`Istruzioni: ${deliveryInstructions}`);
  }
  if (record.domain === "mission") {
    const routeStops = Array.isArray(payload.routeStops) ? payload.routeStops.flatMap((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
      const stop = entry as Record<string, unknown>;
      const label = textValue(stop.label ?? stop.title ?? stop.locationLabel, "");
      return label ? [label] : [];
    }) : [];
    const pickup = textValue(payload.pickup, "");
    const dropoff = textValue(payload.dropoff, "");
    if (routeStops.length) values.push(`Tappe: ${routeStops.slice(0, 3).join(" → ")}`);
    else if (pickup || dropoff) values.push(`${pickup || "Partenza da definire"} → ${dropoff || "Destinazione da definire"}`);
    const resourceSnapshot = payload.resourceSnapshot && typeof payload.resourceSnapshot === "object" && !Array.isArray(payload.resourceSnapshot)
      ? payload.resourceSnapshot as Record<string, unknown>
      : {};
    const driverSnapshot = resourceSnapshot.driver && typeof resourceSnapshot.driver === "object" && !Array.isArray(resourceSnapshot.driver)
      ? resourceSnapshot.driver as Record<string, unknown>
      : {};
    const vehicleSnapshot = resourceSnapshot.vehicle && typeof resourceSnapshot.vehicle === "object" && !Array.isArray(resourceSnapshot.vehicle)
      ? resourceSnapshot.vehicle as Record<string, unknown>
      : {};
    const driver = textValue(payload.driverName ?? payload.driverLabel ?? driverSnapshot.label, "");
    const vehicle = textValue(payload.vehicleName ?? payload.vehicleLabel ?? vehicleSnapshot.label, "");
    if (driver || vehicle) values.push([driver, vehicle].filter(Boolean).join(" · "));
  }
  const notes = textValue(payload.notes, "");
  if (notes) values.push(notes);
  return values;
}

type JourneyDocument = JourneyPayload["sections"]["documents"]["records"][number];

function DocumentSecurityActions({ document, allowed, busy, onAction }: { document: JourneyDocument; allowed: boolean; busy: boolean; onAction: (action: "queue_scan" | "manual_review") => void }) {
  if (!allowed || document.downloadable) return null;
  if (["NOT_RUN", "MANUAL_REVIEW"].includes(document.scanStatus)) return <button className="mt-3 rounded-lg border border-cyan-300/20 px-2.5 py-1.5 text-[9px] font-semibold text-cyan-100 hover:bg-cyan-300/10 disabled:opacity-50" disabled={busy} onClick={() => onAction("queue_scan")} type="button"><ShieldCheck className="mr-1.5 inline size-3" />Avvia scansione</button>;
  if (document.scanStatus === "PENDING_PROVIDER") return <button className="mt-3 rounded-lg border border-amber-300/20 px-2.5 py-1.5 text-[9px] font-semibold text-amber-100 hover:bg-amber-300/10 disabled:opacity-50" disabled={busy} onClick={() => onAction("manual_review")} type="button"><LockKeyhole className="mr-1.5 inline size-3" />Metti in revisione</button>;
  return null;
}

function RecordActions({ jobId, record, can, closeField }: { jobId: string; record: JourneyRecord; can: Record<string, boolean>; closeField: (record: JourneyRecord) => void }) {
  const router = useRouter();
  if (record.domain === "planning") return <button className="rounded-lg border border-lime-300/20 px-2.5 py-1.5 text-[9px] font-semibold text-lime-100 transition hover:bg-lime-300/10" onClick={() => router.push(`/planning?jobId=${encodeURIComponent(jobId)}`)} type="button"><CalendarClock className="mr-1.5 inline size-3" />Apri in Pianificazione</button>;
  if (record.domain === "field" && record.status === "OPEN" && can.field_close) return <button className="rounded-lg border border-lime-300/20 px-2.5 py-1.5 text-[9px] font-semibold text-lime-100 transition hover:bg-lime-300/10" onClick={() => closeField(record)} type="button"><Check className="mr-1.5 inline size-3" />Chiudi con consuntivo</button>;
  if (record.domain === "warehouse" && record.status === "REQUESTED" && can.material_review) return <button className="rounded-lg border border-lime-300/20 px-2.5 py-1.5 text-[9px] font-semibold text-lime-100 hover:bg-lime-300/10" onClick={() => router.push(`/warehouse?request=${encodeURIComponent(record.id)}`)} type="button"><PackageCheck className="mr-1.5 inline size-3" />Apri Magazzino</button>;
  if (record.domain === "mission") return <button className="rounded-lg border border-cyan-300/20 px-2.5 py-1.5 text-[9px] font-semibold text-cyan-100 hover:bg-cyan-300/10" onClick={() => router.push(`/mission?missionId=${encodeURIComponent(record.id)}`)} type="button"><Truck className="mr-1.5 inline size-3" />Apri Missione</button>;
  return null;
}

export default function JobCommercialJourney({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [payload, setPayload] = useState<JourneyPayload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "forbidden" | "error">("loading");
  const [modal, setModal] = useState<ModalKind>(null);
  const [selected, setSelected] = useState<JourneyRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const idempotencyKeys = useRef(new Map<string, string>());
  const [securityBusy, setSecurityBusy] = useState("");
  const [notice, setNotice] = useState("");

  const notify = useCallback((message: string) => { setNotice(message); window.setTimeout(() => setNotice(""), 3400); }, []);
  const requestKey = useCallback((scope: string, value: unknown) => {
    const identity = `${scope}:${JSON.stringify(value)}`;
    let key = idempotencyKeys.current.get(identity);
    if (!key) {
      key = `${scope}-${crypto.randomUUID()}`;
      idempotencyKeys.current.set(identity, key);
    }
    return { identity, key };
  }, []);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/operations/jobs/${encodeURIComponent(jobId)}/journey`, { cache: "no-store" });
      if (response.status === 403) { setState("forbidden"); return; }
      if (!response.ok) throw new Error("journey_unavailable");
      const nextPayload = await response.json() as JourneyPayload;
      if (nextPayload.readback?.status !== "verified") throw new Error("journey_readback_unverified");
      setPayload(nextPayload);
      setState("ready");
    } catch { setState("error"); }
  }, [jobId]);

  useEffect(() => { const timer = window.setTimeout(() => void refresh(), 0); return () => window.clearTimeout(timer); }, [refresh]);

  const mutate = useCallback(async (action: string, body: Record<string, unknown>): Promise<boolean> => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    const { identity, key } = requestKey(`journey-${action}`, body);
    try {
      const response = await fetch(`/api/operations/jobs/${encodeURIComponent(jobId)}/journey`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, idempotencyKey: key, ...body }) });
      const result = await response.json() as JourneyPayload & { error?: string };
      if (!response.ok) {
        notify(journeyErrorMessage(result.error));
        if (response.status === 409) await refresh();
        if (response.status < 500 && response.status !== 409) idempotencyKeys.current.delete(identity);
        return false;
      }
      if (result.readback?.status !== "verified"
        || result.mutation?.action !== action
        || !result.mutation.eventId
        || !result.mutation.record
        || !result.sections) {
        notify("Il server non ha confermato registro e rilettura. Aggiorno il percorso.");
        await refresh();
        return false;
      }
      idempotencyKeys.current.delete(identity);
      setPayload(result);
      setModal(null);
      setSelected(null);
      notify(`Operazione registrata · ${result.mutation.eventId.slice(0, 8)} · v${result.mutation.record.version}`);
      return true;
    } catch { notify("Connessione non disponibile: nessuna operazione confermata."); return false; }
    finally { busyRef.current = false; setBusy(false); }
  }, [jobId, notify, refresh, requestKey]);

  const mutateDocumentSecurity = useCallback(async (documentId: string, action: "queue_scan" | "manual_review") => {
    if (busyRef.current) return;
    busyRef.current = true;
    setSecurityBusy(`${documentId}:${action}`);
    const identityBody = { documentId, action };
    const { identity, key } = requestKey("document-security", identityBody);
    try {
      const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}/security`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, idempotencyKey: key }),
      });
      const result = await response.json() as { document?: JourneyDocument; eventId?: string; idempotent?: boolean; readback?: { status?: string; version?: number } };
      if (!response.ok) {
        notify("Verifica documento non completata. Riprova.");
        if (response.status < 500 && response.status !== 409) idempotencyKeys.current.delete(identity);
        return;
      }
      if (!result.document || result.readback?.status !== "verified" || (!result.idempotent && !result.eventId)) {
        notify("Il server non ha confermato evento e readback del documento.");
        return;
      }
      idempotencyKeys.current.delete(identity);
      await refresh();
      notify(`${action === "queue_scan" ? "Documento messo in quarantena per la scansione" : "Documento inviato alla revisione manuale"} · ${result.eventId?.slice(0, 8) ?? "riletto"} · v${result.readback.version}`);
    } catch {
      notify("Connessione non disponibile: nessuna transizione documento confermata.");
    } finally {
      busyRef.current = false;
      setSecurityBusy("");
    }
  }, [notify, refresh, requestKey]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (modal === "field") await mutate("field_open", { title: field(form, "title"), teamId: field(form, "teamId"), supervisorMembershipId: field(form, "supervisorMembershipId"), notes: field(form, "notes") });
    if (modal === "fieldClose" && selected) await mutate("field_close", { recordId: selected.id, expectedVersion: selected.version, summary: field(form, "summary") });
    if (modal === "material") {
      if (!payload?.job.location) { notify("Registra prima l’indirizzo ufficiale del cantiere nella scheda commessa."); return; }
      await mutate("material_request", { title: field(form, "title"), neededAt: toServerDateTime(field(form, "neededAt")), deliveryInstructions: field(form, "deliveryInstructions"), notes: field(form, "notes"), lines: [{ itemId: field(form, "itemId"), quantity: field(form, "quantity") }] });
    }
    if (modal === "document") {
      const file = form.get("file");
      if (!(file instanceof File) || !file.size) { notify("Seleziona un file."); return; }
      if (file.size > 20 * 1024 * 1024) { notify("Il file supera il limite di 20 MB."); return; }
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      const uploadIdentity = {
        category: field(form, "category"),
        fileName: file.name,
        size: file.size,
        lastModified: file.lastModified,
      };
      const { identity, key } = requestKey("document-upload", uploadIdentity);
      form.set("idempotencyKey", key);
      try {
        const response = await fetch(`/api/operations/jobs/${encodeURIComponent(jobId)}/documents`, { method: "POST", body: form });
        const result = await response.json() as { document?: JourneyDocument; eventId?: string; idempotent?: boolean; duplicate?: boolean; readback?: { status?: string; version?: number } };
        if (!response.ok) { notify("Documento non archiviato. Controlla il file e riprova."); if (response.status < 500 && response.status !== 409) idempotencyKeys.current.delete(identity); return; }
        if (!result.document || result.readback?.status !== "verified" || (!result.idempotent && !result.eventId)) { notify("Il server non ha confermato il documento nel registro."); return; }
        idempotencyKeys.current.delete(identity);
        await refresh(); setModal(null); notify(`Documento archiviato e riletto · ${result.eventId?.slice(0, 8) ?? "duplicato"} · v${result.readback.version}`);
      } catch { notify("Caricamento non disponibile: nessun documento confermato."); }
      finally { busyRef.current = false; setBusy(false); }
    }
  };

  if (state === "loading") return <section className="mt-4 carbon-card rounded-[24px] p-6"><div className="flex items-center gap-3 text-xs text-slate-500"><LoaderCircle className="size-4 animate-spin text-lime-300" />Caricamento percorso della commessa…</div></section>;
  if (state === "forbidden") return null;
  if (state === "error" || !payload) return <section className="mt-4 rounded-[24px] border border-amber-300/15 bg-amber-300/[0.035] p-5"><p className="text-xs text-amber-100">Il percorso della commessa non è momentaneamente disponibile.</p><Button variant="outline" className="mt-3 border-white/10 bg-black/20 text-xs" onClick={() => void refresh()}><RefreshCw className="size-3.5" />Riprova</Button></section>;

  const configuredDomains = payload.context?.operatingDomains;
  const modules = MODULES.filter((module) => !configuredDomains?.length || module.domains.some((domain) => configuredDomains.includes(domain)));
  const visibleRecordCount = modules.reduce((sum, module) => sum + payload.sections[module.key].count, 0) + payload.sections.documents.count;

  return <section className="relative mt-4 overflow-hidden rounded-[28px] border border-lime-300/20 bg-[linear-gradient(150deg,rgba(12,18,14,0.98),rgba(3,6,5,0.99)_54%,rgba(18,28,19,0.96))] p-5 shadow-[0_28px_80px_rgba(0,0,0,0.38)] sm:p-6">
    <div className="pointer-events-none absolute -right-40 -top-48 size-[30rem] rounded-full bg-lime-300/[0.06] blur-3xl" /><div className="pointer-events-none absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-lime-300/70 to-transparent" />
    <div className="relative flex flex-wrap items-start justify-between gap-4"><div className="flex items-start gap-3"><span className="grid size-11 place-items-center rounded-2xl border border-lime-300/25 bg-lime-300/[0.09] text-lime-200 shadow-[0_0_28px_rgba(190,255,60,0.10)]"><ShieldCheck className="size-5" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-lime-300/70">Percorso operativo</p><h2 className="mt-1 text-lg font-semibold tracking-[-0.025em] text-lime-50">Dalla pianificazione alla consegna</h2><p className="mt-1 max-w-2xl text-[11px] leading-5 text-slate-500">Ogni fase mostra il registro aziendale che la conferma, il suo stato e il passaggio successivo disponibile per il tuo ruolo.</p>{payload.job.location && <p className="mt-2 flex items-start gap-1.5 text-[10px] text-slate-400"><span className="font-semibold text-slate-300">Cantiere:</span><span>{payload.job.location}</span></p>}</div></div><div className="flex items-center gap-2"><span className="rounded-full border border-lime-300/20 bg-lime-300/[0.06] px-3 py-1.5 font-mono text-[9px] text-lime-200">{visibleRecordCount} REGISTRI</span><span className="hidden text-[8px] text-slate-600 sm:inline">Server · {displayJourneyDate(payload.readback?.checkedAt)}</span><button aria-label="Aggiorna percorso commessa" className="grid size-9 place-items-center rounded-xl border border-white/10 bg-black/30 text-slate-500 transition hover:border-lime-300/30 hover:text-lime-200" onClick={() => void refresh()} type="button"><RefreshCw className="size-4" /></button></div></div>

    <div className="relative mt-6 space-y-3">
      <div className="pointer-events-none absolute bottom-8 left-[1.15rem] top-8 w-px bg-gradient-to-b from-lime-300/35 via-cyan-300/20 to-transparent" />
      {modules.map((module, index) => {
        const section = payload.sections[module.key];
        const Icon = module.icon;
        const enabledTransport = payload.context?.operatingTransportModes ?? [];
        const canCreateTransport = module.create !== "mission" || enabledTransport.length > 0;
        return (
          <article className="relative ml-0 rounded-[20px] border border-white/[0.075] bg-[linear-gradient(155deg,rgba(18,25,19,0.82),rgba(4,7,5,0.92))] p-4 pl-14 sm:p-5 sm:pl-[4.25rem]" key={module.key}>
            <span className="absolute left-2 top-4 z-10 grid size-7 place-items-center rounded-full border border-lime-300/25 bg-[#0a100b] font-mono text-[9px] font-semibold text-lime-200 sm:left-3 sm:top-5">{String(index + 1).padStart(2, "0")}</span>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-xl border border-lime-300/18 bg-lime-300/[0.065] text-lime-200"><Icon className="size-4" /></span><div className="min-w-0"><p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-lime-300/55">{module.eyebrow}</p><h3 className="mt-1 text-sm font-semibold text-slate-100">{module.label}</h3><p className="mt-1 text-[10px] leading-4 text-slate-500">{module.description}</p></div></div>
              <span className="rounded-full border border-white/[0.08] bg-black/25 px-2.5 py-1.5 font-mono text-[8px] text-slate-500">{section.access === "restricted" ? "LIMITATO DAL RUOLO" : `${section.count} REGISTRI`}</span>
            </div>
            {section.access === "restricted" ? (
              <div className="mt-4 flex items-center gap-2 rounded-xl border border-white/[0.07] bg-black/20 px-3 py-3 text-[10px] text-slate-600"><LockKeyhole className="size-3.5" />Registro non visibile al ruolo corrente</div>
            ) : (
              <>
                <div className="mt-4 grid gap-2 xl:grid-cols-2">
                  {section.records.slice(0, 3).map((record) => (
                    <div className="rounded-xl border border-white/[0.07] bg-black/25 p-3" key={record.id}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-[11px] font-medium text-slate-200">{record.title}</p>
                          <p className="mt-1 text-[9px] text-slate-600">{displayJourneyDate(record.payload.startsAt ?? record.payload.plannedAt ?? record.payload.startedAt ?? record.payload.neededAt ?? record.payload.deliveredAt) || displayRecordType(record.recordType)}{record.updatedAt ? ` · registro aggiornato ${displayJourneyDate(record.updatedAt)}` : ""}</p>
                        </div>
                        <span className={`shrink-0 rounded-full border px-2 py-1 text-[7px] font-semibold ${statusTone(record.status)}`}>{displayJourneyStatus(record.status)}</span>
                      </div>
                      {recordSummary(record).length > 0 && <div className="mt-2 space-y-1 border-t border-white/[0.05] pt-2">{recordSummary(record).map((line, lineIndex) => <p className="line-clamp-2 text-[9px] leading-4 text-slate-500" key={`${record.id}:${lineIndex}`}>{line}</p>)}</div>}
                      <div className="mt-2"><RecordActions jobId={jobId} record={record} can={payload.can} closeField={(next) => { setSelected(next); setModal("fieldClose"); }} /></div>
                    </div>
                  ))}
                  {section.records.length === 0 && <p className="rounded-xl border border-dashed border-lime-300/[0.09] px-3 py-4 text-[10px] leading-5 text-slate-600 xl:col-span-2">Nessun record registrato in questa fase. Quando previsto, avvia il passaggio da qui: il server verifica ruolo, dati e perimetro della commessa prima di salvarlo.</p>}
                </div>
                {payload.can[module.capability] && canCreateTransport && <Button variant="outline" className="mt-3 h-10 border-lime-300/18 bg-lime-300/[0.04] px-4 text-[10px] text-lime-100 hover:bg-lime-300/[0.09]" onClick={() => { if (module.create === "mission") { router.push(`/mission?jobId=${encodeURIComponent(jobId)}&create=1`); return; } if (module.create === "planning") { router.push(`/planning?jobId=${encodeURIComponent(jobId)}&create=1`); return; } setModal(module.create); }}><span className="text-base leading-none">+</span>{module.create === "planning" ? "Apri Pianificazione" : module.create === "field" ? "Apri attività di cantiere" : module.create === "material" ? "Richiedi materiali" : "Pianifica nel modulo Missioni"}</Button>}
                {module.create === "mission" && !canCreateTransport && <p className="mt-3 rounded-xl border border-amber-300/15 bg-amber-300/[.03] px-3 py-2 text-[9px] text-amber-200/80">Nessuna modalità di trasporto disponibile per questa azienda.</p>}
              </>
            )}
          </article>
        );
      })}
    </div>

    <div className="mt-4 rounded-2xl border border-cyan-300/15 bg-cyan-300/[.025] p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[9px] font-semibold uppercase tracking-[.18em] text-cyan-200/70">PRESENZE CENTRALIZZATE</p><p className="mt-1 text-[11px] text-slate-400">Ingresso, pausa e uscita si gestiscono esclusivamente dal modulo Presenze.</p></div><a className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-cyan-300/25 bg-cyan-300/[.06] px-3 py-2 text-[10px] font-semibold text-cyan-100 hover:bg-cyan-300/[.12]" href="/presenze">Apri Presenze <RefreshCw className="size-3.5" /></a></div></div>

    <div className="relative mt-3 grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,.85fr)]">
      <article className="rounded-[20px] border border-white/[0.075] bg-black/25 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl border border-cyan-300/18 bg-cyan-300/[0.06] text-cyan-200"><FileArchive className="size-4" /></span><div><p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-cyan-200/60">DOCUMENTI</p><h3 className="mt-1 text-sm font-semibold">Documenti di commessa</h3></div></div>
          {payload.sections.documents.access === "granted" && payload.can.document_upload && <Button variant="outline" className="h-9 border-cyan-300/18 bg-cyan-300/[0.04] text-[10px] text-cyan-100 hover:bg-cyan-300/[0.09]" onClick={() => setModal("document")}><Upload className="size-3.5" />Carica</Button>}
        </div>
        {payload.sections.documents.access === "restricted" ? <p className="mt-4 text-[10px] text-slate-600">Documenti non visibili al ruolo corrente.</p> : <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {payload.sections.documents.records.slice(0, 6).map((document) => document.downloadable ? <a className="rounded-xl border border-white/[0.07] bg-black/25 p-3 transition hover:border-cyan-300/20" href={document.downloadUrl} key={document.id}><div className="flex items-start justify-between gap-2"><p className="min-w-0 truncate text-[11px] font-medium text-slate-200">{document.fileName}</p><span className="shrink-0 rounded-full border border-lime-300/20 bg-lime-300/[0.06] px-2 py-1 text-[7px] text-lime-100">VERIFICATO</span></div><p className="mt-1 text-[9px] text-slate-600">{document.category} · {(document.sizeBytes / 1024 / 1024).toFixed(2)} MB</p></a> : <div className="rounded-xl border border-amber-300/15 bg-amber-300/[0.035] p-3" key={document.id}><div className="flex items-start justify-between gap-2"><p className="min-w-0 truncate text-[11px] font-medium text-slate-200">{document.fileName}</p><span className="shrink-0 rounded-full border border-amber-300/20 bg-amber-300/[0.06] px-2 py-1 text-[7px] text-amber-100">IN VERIFICA</span></div><p className="mt-1 text-[9px] text-slate-500">Download disponibile dopo la verifica del documento.</p><DocumentSecurityActions document={document} allowed={Boolean(payload.can.document_security)} busy={securityBusy.startsWith(`${document.id}:`)} onAction={(action) => void mutateDocumentSecurity(document.id, action)} /></div>)}
          {payload.sections.documents.records.length === 0 && <p className="text-[10px] text-slate-600">Nessun documento archiviato.</p>}
        </div>}
      </article>
      <article className="rounded-[20px] border border-white/[0.075] bg-black/25 p-4">
        <div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl border border-lime-300/18 bg-lime-300/[0.06] text-lime-200"><PackageCheck className="size-4" /></span><div><p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-lime-300/60">MAGAZZINO</p><h3 className="mt-1 text-sm font-semibold">Movimenti collegati</h3></div></div>
        <div className="mt-4 space-y-2">{payload.sections.warehouse.movements.slice(0, 5).map((movement) => <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-black/25 px-3 py-2.5" key={movement.id}><div className="min-w-0"><p className="truncate text-[10px] text-slate-200">{movement.item?.name ?? "Materiale"}</p>{movement.item?.sku && <p className="mt-1 font-mono text-[8px] text-slate-600">{movement.item.sku}</p>}</div><span className="shrink-0 text-right font-mono text-[9px] text-lime-200">{displayMovementType(movement.movementType)}<br />{movement.quantity} {movement.item?.unit ?? ""}</span></div>)}{payload.sections.warehouse.access === "restricted" ? <p className="text-[10px] text-slate-600">Movimenti non visibili al ruolo corrente.</p> : payload.sections.warehouse.movements.length === 0 && <p className="text-[10px] text-slate-600">Nessun movimento collegato.</p>}</div>
      </article>
    </div>

    <Dialog open={modal !== null} onOpenChange={(open) => { if (!open) { setModal(null); setSelected(null); } }}><DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto border-lime-300/20 bg-[#080c09] text-slate-100 sm:max-w-[600px]"><DialogHeader><DialogTitle>{modal === "field" ? "Apri sessione di cantiere" : modal === "fieldClose" ? "Chiudi sessione di cantiere" : modal === "material" ? "Richiesta materiali" : "Carica documento"}</DialogTitle><DialogDescription className="text-slate-500">{modal === "fieldClose" ? "Descrivi l’esito reale della sessione. L’orario di chiusura viene assegnato dal server." : "Le informazioni vengono validate prima di essere confermate nella commessa."}</DialogDescription></DialogHeader><form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
      {modal === "field" && <><label className="text-xs text-slate-400 sm:col-span-2">Titolo<Input className="mt-2 border-white/10 bg-black/30" name="title" defaultValue="Sessione di cantiere" required /></label><div className="rounded-xl border border-cyan-300/15 bg-cyan-300/[.035] p-3 sm:col-span-2"><p className="text-[9px] font-semibold uppercase tracking-[.16em] text-cyan-200/70">TIMESTAMP UFFICIALE</p><p className="mt-1 text-[10px] leading-5 text-slate-500">L’apertura viene datata dal server al momento della conferma.</p></div><label className="text-xs text-slate-400">Squadra<select aria-label="Squadra di cantiere" className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-slate-100" name="teamId" defaultValue=""><option value="">Non assegnata</option>{(payload.options?.workforce?.teams ?? []).map((team) => <option key={team.id} value={team.id}>{team.label}</option>)}</select></label><label className="text-xs text-slate-400 sm:col-span-2">Supervisore<select aria-label="Supervisore di cantiere" className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-slate-100" name="supervisorMembershipId" defaultValue=""><option value="">Non assegnato</option>{(payload.options?.workforce?.supervisors ?? []).map((person) => <option key={person.id} value={person.id}>{person.label}</option>)}</select></label><label className="text-xs text-slate-400 sm:col-span-2">Note<Textarea className="mt-2 border-white/10 bg-black/30" name="notes" /></label></>}
      {modal === "fieldClose" && <><div className="rounded-xl border border-cyan-300/15 bg-cyan-300/[.035] p-3 sm:col-span-2"><p className="text-[9px] font-semibold uppercase tracking-[.16em] text-cyan-200/70">SESSIONE APERTA</p><p className="mt-1 text-sm font-semibold text-slate-100">{selected?.title}</p><p className="mt-1 text-[10px] text-slate-500">Il server conserva la versione {selected?.version ?? "—"} e registra il timestamp ufficiale alla conferma.</p></div><label className="text-xs text-slate-400 sm:col-span-2">Consuntivo della sessione<Textarea autoFocus className="mt-2 min-h-32 border-white/10 bg-black/30" minLength={4} name="summary" placeholder="Lavorazioni eseguite, esito, criticità o attività residue…" required /></label></>}
      {modal === "material" && <>
        <label className="text-xs text-slate-400 sm:col-span-2">Titolo<Input className="mt-2 border-white/10 bg-black/30" name="title" defaultValue="Richiesta materiali" required /></label>
        <label className="text-xs text-slate-400 sm:col-span-2">Materiale · catalogo aziendale<select aria-label="Articolo dal catalogo aziendale" className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-slate-100" name="itemId" required defaultValue=""><option disabled value="">Seleziona un articolo registrato</option>{(payload.options?.materialCatalog ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}{item.sku ? ` · ${item.sku}` : ""} · {item.unitLabel} ({item.unit})</option>)}</select><span className="mt-1 block text-[9px] leading-4 text-slate-600">Articolo e unità arrivano dal catalogo server-side. Il magazzino verifica deposito e disponibilità prima di approvare e prenotare.</span>{(payload.options?.materialCatalog ?? []).length === 0 && <span className="mt-1 block text-[9px] leading-4 text-amber-200/80">Il catalogo è vuoto: gli articoli devono essere registrati prima dal modulo Magazzini.</span>}</label>
        <label className="text-xs text-slate-400">Quantità<Input className="mt-2 border-white/10 bg-black/30" min="0.001" name="quantity" step="0.001" type="number" required /></label>
        <label className="text-xs text-slate-400">Necessario entro<Input className="mt-2 border-white/10 bg-black/30" name="neededAt" type="datetime-local" /></label>
        {payload.job.location ? <div className="sm:col-span-2"><span className="block text-xs text-slate-400">Punto di consegna · cantiere ufficiale</span><div className="mt-2 rounded-xl border border-lime-300/15 bg-lime-300/[.035] px-3 py-3 text-[11px] leading-5 text-slate-200">{payload.job.location}</div><p className="mt-1 text-[9px] text-slate-600">Il server collega la richiesta all’indirizzo registrato nella scheda commessa.</p></div> : <p className="rounded-xl border border-amber-300/15 bg-amber-300/[.035] p-3 text-[10px] leading-5 text-amber-100 sm:col-span-2">Registra prima l’indirizzo ufficiale del cantiere nella scheda commessa: la richiesta userà quel punto di consegna.</p>}
        <label className="text-xs text-slate-400 sm:col-span-2">Indicazioni per il deposito<Textarea className="mt-2 border-white/10 bg-black/30" name="deliveryInstructions" placeholder="Ingresso da Via…, scarico nell’area…" /></label>
        <label className="text-xs text-slate-400 sm:col-span-2">Note interne<Textarea className="mt-2 border-white/10 bg-black/30" name="notes" /></label>
      </>}
      {modal === "document" && <><label className="text-xs text-slate-400 sm:col-span-2">Categoria<select aria-label="Categoria documento" className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-slate-100" name="category" defaultValue="COMMESSA" required>{(payload.options?.documentCategories ?? []).map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}</select></label><label className="rounded-2xl border border-dashed border-lime-300/20 bg-lime-300/[0.035] p-5 text-xs text-slate-400 sm:col-span-2"><Upload className="mb-3 size-5 text-lime-200" />File · massimo 20 MB<Input accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.jpg,.jpeg,.png,.webp,.heic,.heif" className="mt-3 border-white/10 bg-black/30 file:text-lime-200" name="file" type="file" required /><span className="mt-2 block text-[10px] text-slate-600">DOCX incluso. Il documento viene verificato prima dell’archiviazione.</span></label></>}
      <DialogFooter className="sm:col-span-2"><DialogClose asChild><Button type="button" variant="outline" className="border-white/10 bg-transparent text-slate-400">Annulla</Button></DialogClose><Button disabled={busy} type="submit" className="bg-lime-300 text-[#050705] hover:bg-lime-200">{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}{modal === "document" ? "Archivia documento" : modal === "fieldClose" ? "Chiudi e registra" : "Conferma"}</Button></DialogFooter>
    </form></DialogContent></Dialog>
    {notice && <button className="fixed bottom-5 right-5 z-[70] max-w-[370px] rounded-xl border border-lime-300/25 bg-[#080d09]/95 px-4 py-3 text-left text-xs text-lime-100 shadow-[0_0_30px_rgba(190,255,60,0.14)] backdrop-blur-xl" onClick={() => setNotice("")} type="button"><CheckCircle2 className="mr-2 inline size-4 text-lime-300" />{notice}</button>}
  </section>;
}
