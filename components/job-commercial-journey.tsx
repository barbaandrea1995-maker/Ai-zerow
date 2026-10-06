"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { CalendarClock, Check, CheckCircle2, FileArchive, GitBranch as GitBranchIcon, HardHat, LoaderCircle, LockKeyhole, PackageCheck, Pencil, Play, RefreshCw, Send, ShieldCheck, Truck, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MissionResourceFields } from "@/components/mission-resource-fields";
import { PlanningResourceFields } from "@/components/planning-resource-fields";
import { TRANSPORT_MODE_CATALOG, type TransportMode } from "@/lib/tenant-operating-model";

type JourneyRecord = { id: string; domain: string; recordType: string; title: string; status: string; version: number; payload: Record<string, unknown>; updatedAt: string };
type JourneySection = { access: "granted" | "restricted"; count: number; records: JourneyRecord[] };
type JourneyPayload = {
  context?: { operatingTransportModes?: string[] };
  job: { id: string; code: string | null; title: string; status: string };
  sections: {
    planning: JourneySection;
    field: JourneySection;
    warehouse: JourneySection & { movements: Array<{ id: string; movementType: string; quantity: number; item: { sku: string; name: string; unit: string } | null; createdAt: string }> };
    mission: JourneySection;
  documents: { access: "granted" | "restricted"; count: number; records: Array<{ id: string; fileName: string; category: string; sizeBytes: number; scanStatus: string; status: string; downloadable: boolean; downloadUrl: string; createdAt: string }> };
  };
  can: Record<string, boolean>;
};
type ModalKind = "planning" | "field" | "material" | "material_review" | "mission" | "delivery" | "document" | null;
type ReviewLine = { id: string; itemId: string | null; description: string; unit: string; quantity: number };
type WarehouseOption = { id: string; code: string; name: string; locationLabel: string; status: string };

const MODULES = [
  { key: "planning", label: "Pianificazione", eyebrow: "AGENDA", icon: CalendarClock, create: "planning" as ModalKind, capability: "planning_create" },
  { key: "field", label: "Campo", eyebrow: "CANTIERE", icon: HardHat, create: "field" as ModalKind, capability: "field_open" },
  { key: "warehouse", label: "Materiali", eyebrow: "MAGAZZINO", icon: PackageCheck, create: "material" as ModalKind, capability: "material_request" },
  { key: "mission", label: "Trasporti", eyebrow: "TRASPORTI", icon: Truck, create: "mission" as ModalKind, capability: "mission_create" },
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

type JourneyDocument = JourneyPayload["sections"]["documents"]["records"][number];

function DocumentSecurityActions({ document, allowed, busy, onAction }: { document: JourneyDocument; allowed: boolean; busy: boolean; onAction: (action: "queue_scan" | "manual_review") => void }) {
  if (!allowed || document.downloadable) return null;
  if (["NOT_RUN", "MANUAL_REVIEW"].includes(document.scanStatus)) return <button className="mt-3 rounded-lg border border-cyan-300/20 px-2.5 py-1.5 text-[9px] font-semibold text-cyan-100 hover:bg-cyan-300/10 disabled:opacity-50" disabled={busy} onClick={() => onAction("queue_scan")} type="button"><ShieldCheck className="mr-1.5 inline size-3" />Avvia scansione</button>;
  if (document.scanStatus === "PENDING_PROVIDER") return <button className="mt-3 rounded-lg border border-amber-300/20 px-2.5 py-1.5 text-[9px] font-semibold text-amber-100 hover:bg-amber-300/10 disabled:opacity-50" disabled={busy} onClick={() => onAction("manual_review")} type="button"><LockKeyhole className="mr-1.5 inline size-3" />Metti in revisione</button>;
  return null;
}

function RecordActions({ record, can, mutate, deliver, review }: { record: JourneyRecord; can: Record<string, boolean>; mutate: (action: string, body: Record<string, unknown>) => Promise<void>; deliver: (record: JourneyRecord) => void; review: (record: JourneyRecord) => void }) {
  if (record.domain === "planning" && record.status === "DRAFT" && can.planning_publish) return <button className="rounded-lg border border-lime-300/20 px-2.5 py-1.5 text-[9px] font-semibold text-lime-100 transition hover:bg-lime-300/10" onClick={() => void mutate("planning_publish", { recordId: record.id, expectedVersion: record.version })} type="button"><Send className="mr-1.5 inline size-3" />Pubblica</button>;
  if (record.domain === "field" && record.status === "OPEN" && can.field_close) return <button className="rounded-lg border border-lime-300/20 px-2.5 py-1.5 text-[9px] font-semibold text-lime-100 transition hover:bg-lime-300/10" onClick={() => void mutate("field_close", { recordId: record.id, expectedVersion: record.version, summary: "Sessione chiusa dal workspace operativo" })} type="button"><Check className="mr-1.5 inline size-3" />Chiudi</button>;
  if (record.domain === "warehouse" && record.status === "REQUESTED" && can.material_review) return <div className="flex gap-1.5"><button className="rounded-lg border border-lime-300/20 px-2.5 py-1.5 text-[9px] font-semibold text-lime-100 hover:bg-lime-300/10" onClick={() => review(record)} type="button"><Pencil className="mr-1.5 inline size-3" />Rivedi</button><button className="rounded-lg border border-rose-300/20 px-2.5 py-1.5 text-[9px] font-semibold text-rose-100 hover:bg-rose-300/10" onClick={() => void mutate("material_review", { recordId: record.id, expectedVersion: record.version, decision: "REJECTED", note: "Richiesta rifiutata dal responsabile" })} type="button">Rifiuta</button></div>;
  if (record.domain === "warehouse" && record.status === "APPROVED" && can.material_fulfill) {
    const missionId = typeof record.payload.missionId === "string" ? record.payload.missionId : "";
    return missionId
      ? <button className="rounded-lg border border-lime-300/20 px-2.5 py-1.5 text-[9px] font-semibold text-lime-100 hover:bg-lime-300/10" onClick={() => void mutate("material_fulfill", { recordId: record.id, expectedVersion: record.version, missionId })} type="button"><Check className="mr-1.5 inline size-3" />Prepara carico</button>
      : <span className="rounded-lg border border-amber-300/15 bg-amber-300/[.03] px-2.5 py-1.5 text-[9px] text-amber-100/70">In attesa missione</span>;
  }
  if (record.domain === "mission" && record.status === "PLANNED" && can.mission_dispatch) return <button className="rounded-lg border border-cyan-300/20 px-2.5 py-1.5 text-[9px] font-semibold text-cyan-100 hover:bg-cyan-300/10" onClick={() => void mutate("mission_dispatch", { recordId: record.id, expectedVersion: record.version })} type="button"><Play className="mr-1.5 inline size-3" />Partenza</button>;
  if (record.domain === "mission" && record.status === "DISPATCHED" && can.mission_deliver) return <button className="rounded-lg border border-lime-300/20 px-2.5 py-1.5 text-[9px] font-semibold text-lime-100 hover:bg-lime-300/10" onClick={() => deliver(record)} type="button"><CheckCircle2 className="mr-1.5 inline size-3" />Consegna</button>;
  if (record.domain === "mission" && record.status === "DELIVERED" && can.mission_verify_pod) return <button className="rounded-lg border border-lime-300/20 px-2.5 py-1.5 text-[9px] font-semibold text-lime-100 hover:bg-lime-300/10" onClick={() => void mutate("mission_verify_pod", { recordId: record.id, expectedVersion: record.version })} type="button"><ShieldCheck className="mr-1.5 inline size-3" />Verifica consegna</button>;
  if (record.domain === "mission" && record.status === "POD_VERIFIED" && can.mission_reconcile) return <button className="rounded-lg border border-cyan-300/20 px-2.5 py-1.5 text-[9px] font-semibold text-cyan-100 hover:bg-cyan-300/10" onClick={() => void mutate("mission_reconcile", { recordId: record.id, expectedVersion: record.version, note: "Quantità e prova di consegna riconciliate dal workspace" })} type="button"><GitBranchIcon className="mr-1.5 inline size-3" />Riconcilia</button>;
  if (record.domain === "mission" && record.status === "RECONCILED" && can.mission_close) return <button className="rounded-lg border border-lime-300/20 px-2.5 py-1.5 text-[9px] font-semibold text-lime-100 hover:bg-lime-300/10" onClick={() => void mutate("mission_close", { recordId: record.id, expectedVersion: record.version })} type="button"><Check className="mr-1.5 inline size-3" />Chiudi</button>;
  return null;
}

export default function JobCommercialJourney({ jobId }: { jobId: string }) {
  const [payload, setPayload] = useState<JourneyPayload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "forbidden" | "error">("loading");
  const [modal, setModal] = useState<ModalKind>(null);
  const [selected, setSelected] = useState<JourneyRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [securityBusy, setSecurityBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [plannedAt, setPlannedAt] = useState("");
  const [plannedEndAt, setPlannedEndAt] = useState("");
  const [planningStartsAt, setPlanningStartsAt] = useState("");
  const [planningEndsAt, setPlanningEndsAt] = useState("");
  const [driverId, setDriverId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [cargoAssetId, setCargoAssetId] = useState("");
  const [planningResourceIds, setPlanningResourceIds] = useState<string[]>([]);
  const [transportMode, setTransportMode] = useState<TransportMode | "">("");
  const [reviewRecord, setReviewRecord] = useState<JourneyRecord | null>(null);
  const [reviewLines, setReviewLines] = useState<ReviewLine[]>([]);
  const [reviewWarehouseId, setReviewWarehouseId] = useState("");
  const [warehouseOptions, setWarehouseOptions] = useState<WarehouseOption[]>([]);
  const [warehouseState, setWarehouseState] = useState<"idle" | "loading" | "ready" | "error">("idle");

  const notify = useCallback((message: string) => { setNotice(message); window.setTimeout(() => setNotice(""), 3400); }, []);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/operations/jobs/${encodeURIComponent(jobId)}/journey`, { cache: "no-store" });
      if (response.status === 403) { setState("forbidden"); return; }
      if (!response.ok) throw new Error("journey_unavailable");
      setPayload(await response.json() as JourneyPayload);
      setState("ready");
    } catch { setState("error"); }
  }, [jobId]);

  useEffect(() => { const timer = window.setTimeout(() => void refresh(), 0); return () => window.clearTimeout(timer); }, [refresh]);

  const mutate = useCallback(async (action: string, body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const response = await fetch(`/api/operations/jobs/${encodeURIComponent(jobId)}/journey`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, idempotencyKey: `journey-${action}-${crypto.randomUUID()}`, ...body }) });
      const result = await response.json() as JourneyPayload & { error?: string };
      if (!response.ok) {
        notify(result.error === "version_conflict" ? "Il record è cambiato: scheda aggiornata." : "Operazione non completata. Riprova.");
        if (response.status === 409) await refresh();
        return;
      }
      setPayload(result);
      setModal(null);
      setSelected(null);
      notify("Operazione registrata nella commessa.");
    } catch { notify("Connessione non disponibile: nessuna operazione confermata."); }
    finally { setBusy(false); }
  }, [jobId, notify, refresh]);

  const openMaterialReview = (record: JourneyRecord) => {
    const rawLines = Array.isArray(record.payload.lines) ? record.payload.lines : [];
    setReviewRecord(record);
    setReviewLines(rawLines.flatMap((line, index) => {
      if (!line || typeof line !== "object" || Array.isArray(line)) return [];
      const value = line as Record<string, unknown>;
      const quantity = Number(value.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) return [];
      return [{
        id: typeof value.id === "string" && value.id ? value.id : `line-${index + 1}`,
        itemId: typeof value.itemId === "string" && value.itemId ? value.itemId : null,
        description: typeof value.description === "string" ? value.description : typeof value.name === "string" ? value.name : "Materiale",
        unit: typeof value.unit === "string" ? value.unit : "PZ",
        quantity,
      }];
    }));
    setReviewWarehouseId(typeof record.payload.warehouseId === "string" ? record.payload.warehouseId : "");
    setWarehouseState("loading");
    setModal("material_review");
    void fetch("/api/warehouse/catalog", { cache: "no-store" })
      .then(async (response) => {
        const next = await response.json() as { warehouses?: WarehouseOption[] };
        if (!response.ok || !next.warehouses) throw new Error("warehouse_catalog_unavailable");
        setWarehouseOptions(next.warehouses.filter((warehouse) => warehouse.status === "active"));
        setWarehouseState("ready");
      })
      .catch(() => {
        setWarehouseOptions([]);
        setWarehouseState("error");
      });
  };

  const mutateDocumentSecurity = useCallback(async (documentId: string, action: "queue_scan" | "manual_review") => {
    setSecurityBusy(`${documentId}:${action}`);
    try {
      const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}/security`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, idempotencyKey: `document-security-${action}-${documentId}-${crypto.randomUUID()}` }),
      });
      if (!response.ok) {
        notify("Verifica documento non completata. Riprova.");
        return;
      }
      await refresh();
      notify(action === "queue_scan" ? "Documento messo in quarantena per la scansione." : "Documento inviato alla revisione manuale.");
    } catch {
      notify("Connessione non disponibile: nessuna transizione documento confermata.");
    } finally {
      setSecurityBusy("");
    }
  }, [notify, refresh]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (modal === "material_review" && reviewRecord) {
      const decision = field(form, "reviewDecision");
      if (!reviewWarehouseId) {
        notify("Seleziona il magazzino che evaderà la richiesta.");
        return;
      }
      if (!reviewLines.length || reviewLines.some((line) => !line.description.trim() || !line.unit.trim() || !Number.isFinite(line.quantity) || line.quantity <= 0)) {
        notify("Controlla le righe materiali prima di confermare.");
        return;
      }
      await mutate("material_review", {
        recordId: reviewRecord.id,
        expectedVersion: reviewRecord.version,
        decision,
        warehouseId: reviewWarehouseId,
        lines: reviewLines,
        note: field(form, "reviewNote"),
      });
      setReviewRecord(null);
      return;
    }
    if (modal === "planning") {
      if (!planningResourceIds.length) {
        notify("Seleziona almeno una risorsa reale per il piano.");
        return;
      }
      setBusy(true);
      try {
        const response = await fetch(`/api/operations/jobs/${encodeURIComponent(jobId)}/planning`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "draft", title: field(form, "title"), startsAt: field(form, "startsAt"), endsAt: field(form, "endsAt"), resourceIds: planningResourceIds, notes: field(form, "notes"), idempotencyKey: `planning-draft-${crypto.randomUUID()}` }),
        });
        if (!response.ok) {
          notify("Piano non creato. Controlla i dati e riprova.");
          return;
        }
        await refresh();
        setModal(null);
        notify("Piano creato in bozza.");
      } catch {
        notify("Connessione non disponibile: nessun piano confermato.");
      } finally {
        setBusy(false);
      }
      return;
    }
    if (modal === "field") await mutate("field_open", { title: field(form, "title"), startedAt: field(form, "startedAt"), team: field(form, "team"), supervisor: field(form, "supervisor"), notes: field(form, "notes") });
    if (modal === "material") await mutate("material_request", { title: field(form, "title"), neededAt: field(form, "neededAt"), deliveryPoint: field(form, "deliveryPoint"), notes: field(form, "notes"), lines: [{ description: field(form, "description"), quantity: field(form, "quantity"), unit: field(form, "unit") }] });
    if (modal === "mission") {
      if (!field(form, "driverId") || !field(form, "vehicleId")) {
        notify("Seleziona autista e mezzo realmente disponibili.");
        return;
      }
      const requestId = field(form, "materialRequestId");
      if (field(form, "transportMode") === "WAREHOUSE_TO_JOB" && !requestId) {
        notify("Per il trasporto verso la commessa seleziona una richiesta materiali approvata.");
        return;
      }
      await mutate("mission_create", { title: field(form, "title"), pickup: field(form, "pickup"), dropoff: field(form, "dropoff"), plannedAt: field(form, "plannedAt"), plannedEndAt: field(form, "plannedEndAt"), driverId: field(form, "driverId"), vehicleId: field(form, "vehicleId"), cargoAssetId: field(form, "cargoAssetId"), transportMode: field(form, "transportMode"), materialRequestId: requestId, notes: field(form, "notes") });
    }
    if (modal === "delivery" && selected) await mutate("mission_deliver", { recordId: selected.id, expectedVersion: selected.version, recipient: field(form, "recipient"), deliveredAt: field(form, "deliveredAt"), evidenceType: field(form, "evidenceType") || "AUTHORIZED_DRIVER_CONFIRMATION", evidenceReference: field(form, "evidenceReference"), documentId: field(form, "documentId"), note: field(form, "note") });
    if (modal === "document") {
      const file = form.get("file");
      if (!(file instanceof File) || !file.size) { notify("Seleziona un file."); return; }
      if (file.size > 20 * 1024 * 1024) { notify("Il file supera il limite di 20 MB."); return; }
      form.set("idempotencyKey", `document-upload-${crypto.randomUUID()}`);
      setBusy(true);
      try {
        const response = await fetch(`/api/operations/jobs/${encodeURIComponent(jobId)}/documents`, { method: "POST", body: form });
        if (!response.ok) { notify("Documento non archiviato. Controlla il file e riprova."); return; }
        await refresh(); setModal(null); notify("Documento archiviato e verificato.");
      } catch { notify("Caricamento non disponibile: nessun documento confermato."); }
      finally { setBusy(false); }
    }
  };

  const totalRecords = useMemo(() => payload ? MODULES.reduce((sum, module) => sum + payload.sections[module.key].count, 0) + payload.sections.documents.count : 0, [payload]);
  if (state === "loading") return <section className="mt-4 carbon-card rounded-[24px] p-6"><div className="flex items-center gap-3 text-xs text-slate-500"><LoaderCircle className="size-4 animate-spin text-lime-300" />Caricamento percorso della commessa…</div></section>;
  if (state === "forbidden") return null;
  if (state === "error" || !payload) return <section className="mt-4 rounded-[24px] border border-amber-300/15 bg-amber-300/[0.035] p-5"><p className="text-xs text-amber-100">Il percorso della commessa non è momentaneamente disponibile.</p><Button variant="outline" className="mt-3 border-white/10 bg-black/20 text-xs" onClick={() => void refresh()}><RefreshCw className="size-3.5" />Riprova</Button></section>;

  return <section className="relative mt-4 overflow-hidden rounded-[28px] border border-lime-300/20 bg-[linear-gradient(150deg,rgba(12,18,14,0.98),rgba(3,6,5,0.99)_54%,rgba(18,28,19,0.96))] p-5 shadow-[0_28px_80px_rgba(0,0,0,0.38)] sm:p-6">
    <div className="pointer-events-none absolute -right-40 -top-48 size-[30rem] rounded-full bg-lime-300/[0.06] blur-3xl" /><div className="pointer-events-none absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-lime-300/70 to-transparent" />
    <div className="relative flex flex-wrap items-start justify-between gap-4"><div className="flex items-start gap-3"><span className="grid size-11 place-items-center rounded-2xl border border-lime-300/25 bg-lime-300/[0.09] text-lime-200 shadow-[0_0_28px_rgba(190,255,60,0.10)]"><ShieldCheck className="size-5" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-lime-300/70">Percorso commessa</p><h2 className="mt-1 text-lg font-semibold tracking-[-0.025em] text-lime-50">Dalla pianificazione alla consegna</h2><p className="mt-1 max-w-2xl text-[11px] leading-5 text-slate-500">Segui ogni passaggio operativo, dalle risorse disponibili alla chiusura della consegna.</p></div></div><div className="flex items-center gap-2"><span className="rounded-full border border-lime-300/20 bg-lime-300/[0.06] px-3 py-1.5 font-mono text-[9px] text-lime-200">{totalRecords} ELEMENTI</span><button aria-label="Aggiorna percorso commessa" className="grid size-9 place-items-center rounded-xl border border-white/10 bg-black/30 text-slate-500 transition hover:border-lime-300/30 hover:text-lime-200" onClick={() => void refresh()} type="button"><RefreshCw className="size-4" /></button></div></div>

    <div className="relative mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {MODULES.map((module) => {
        const section = payload.sections[module.key];
        const Icon = module.icon;
        const enabledTransport = payload.context?.operatingTransportModes ?? [];
        const canCreateTransport = module.create !== "mission" || enabledTransport.length > 0;
        return (
          <article className="rounded-[20px] border border-white/[0.075] bg-[linear-gradient(155deg,rgba(18,25,19,0.82),rgba(4,7,5,0.92))] p-4" key={module.key}>
            <div className="flex items-start justify-between gap-3">
              <span className="grid size-9 place-items-center rounded-xl border border-lime-300/18 bg-lime-300/[0.065] text-lime-200"><Icon className="size-4" /></span>
              <span className="rounded-full border border-white/[0.08] bg-black/25 px-2 py-1 font-mono text-[8px] text-slate-500">{section.access === "restricted" ? "LIMITATO" : `${section.count} ELEMENTI`}</span>
            </div>
            <p className="mt-4 text-[9px] font-semibold uppercase tracking-[0.18em] text-lime-300/55">{module.eyebrow}</p>
            <h3 className="mt-1 text-sm font-semibold text-slate-100">{module.label}</h3>
            {section.access === "restricted" ? (
              <div className="mt-4 flex items-center gap-2 rounded-xl border border-white/[0.07] bg-black/20 px-3 py-3 text-[10px] text-slate-600"><LockKeyhole className="size-3.5" />Non visibile al ruolo corrente</div>
            ) : (
              <>
                <div className="mt-4 space-y-2">
                  {section.records.slice(0, 3).map((record) => (
                    <div className="rounded-xl border border-white/[0.07] bg-black/25 p-3" key={record.id}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-[11px] font-medium text-slate-200">{record.title}</p>
                          <p className="mt-1 truncate text-[9px] text-slate-600">{textValue(record.payload.startsAt ?? record.payload.plannedAt ?? record.payload.startedAt ?? record.payload.neededAt, displayRecordType(record.recordType))}</p>
                        </div>
                        <span className={`shrink-0 rounded-full border px-2 py-1 text-[7px] font-semibold ${statusTone(record.status)}`}>{displayJourneyStatus(record.status)}</span>
                      </div>
                      <div className="mt-2"><RecordActions record={record} can={payload.can} mutate={mutate} review={openMaterialReview} deliver={(next) => { setSelected(next); setModal("delivery"); }} /></div>
                    </div>
                  ))}
                  {section.records.length === 0 && <p className="rounded-xl border border-dashed border-lime-300/[0.09] px-3 py-4 text-center text-[10px] text-slate-600">Nessun elemento collegato</p>}
                </div>
                {payload.can[module.capability] && canCreateTransport && <Button variant="outline" className="mt-3 h-9 w-full border-lime-300/18 bg-lime-300/[0.04] text-[10px] text-lime-100 hover:bg-lime-300/[0.09]" onClick={() => { if (module.create === "mission") { setPlannedAt(""); setPlannedEndAt(""); setDriverId(""); setVehicleId(""); setCargoAssetId(""); const preferred = enabledTransport.includes("WAREHOUSE_TO_JOB") ? "WAREHOUSE_TO_JOB" : enabledTransport[0] ?? ""; setTransportMode(preferred as TransportMode | ""); } if (module.create === "planning") { setPlanningStartsAt(""); setPlanningEndsAt(""); setPlanningResourceIds([]); } setModal(module.create); }}><span className="text-base leading-none">+</span>Nuovo</Button>}
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

    <Dialog open={modal !== null} onOpenChange={(open) => !open && setModal(null)}><DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto border-lime-300/20 bg-[#080c09] text-slate-100 sm:max-w-[600px]"><DialogHeader><DialogTitle>{modal === "planning" ? "Nuovo piano operativo" : modal === "field" ? "Apri sessione di cantiere" : modal === "material" ? "Richiesta materiali" : modal === "material_review" ? "Revisiona richiesta materiali" : modal === "mission" ? "Nuova missione di trasporto" : modal === "delivery" ? "Prova di consegna" : "Carica documento"}</DialogTitle><DialogDescription className="text-slate-500">Le informazioni vengono validate prima di essere confermate nella commessa.</DialogDescription></DialogHeader><form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
      {modal === "planning" && <><label className="text-xs text-slate-400 sm:col-span-2">Attività della giornata<Input className="mt-2 border-white/10 bg-black/30" name="title" defaultValue="Attività operativa" required /></label><label className="text-xs text-slate-400">Inizio<Input className="mt-2 border-white/10 bg-black/30" name="startsAt" onChange={(event) => setPlanningStartsAt(event.target.value)} type="datetime-local" value={planningStartsAt} required /></label><label className="text-xs text-slate-400">Fine<Input className="mt-2 border-white/10 bg-black/30" name="endsAt" onChange={(event) => setPlanningEndsAt(event.target.value)} type="datetime-local" value={planningEndsAt} required /></label><PlanningResourceFields jobId={jobId} startsAt={planningStartsAt} endsAt={planningEndsAt} selectedIds={planningResourceIds} onChange={setPlanningResourceIds} /><label className="text-xs text-slate-400 sm:col-span-2">Note<Textarea className="mt-2 border-white/10 bg-black/30" name="notes" /></label></>}
      {modal === "field" && <><label className="text-xs text-slate-400 sm:col-span-2">Titolo<Input className="mt-2 border-white/10 bg-black/30" name="title" defaultValue="Sessione di cantiere" required /></label><label className="text-xs text-slate-400">Apertura<Input className="mt-2 border-white/10 bg-black/30" name="startedAt" type="datetime-local" required /></label><label className="text-xs text-slate-400">Squadra<Input className="mt-2 border-white/10 bg-black/30" name="team" /></label><label className="text-xs text-slate-400 sm:col-span-2">Supervisore<Input className="mt-2 border-white/10 bg-black/30" name="supervisor" /></label><label className="text-xs text-slate-400 sm:col-span-2">Note<Textarea className="mt-2 border-white/10 bg-black/30" name="notes" /></label></>}
      {modal === "material" && <><label className="text-xs text-slate-400 sm:col-span-2">Titolo<Input className="mt-2 border-white/10 bg-black/30" name="title" defaultValue="Richiesta materiali" required /></label><label className="text-xs text-slate-400 sm:col-span-2">Materiale<Input className="mt-2 border-white/10 bg-black/30" name="description" placeholder="Descrizione materiale" required /></label><label className="text-xs text-slate-400">Quantità<Input className="mt-2 border-white/10 bg-black/30" min="0.001" name="quantity" step="0.001" type="number" required /></label><label className="text-xs text-slate-400">Unità<Input className="mt-2 border-white/10 bg-black/30" name="unit" placeholder="pz, m, kg…" required /></label><label className="text-xs text-slate-400">Necessario entro<Input className="mt-2 border-white/10 bg-black/30" name="neededAt" type="datetime-local" /></label><label className="text-xs text-slate-400">Punto consegna<Input className="mt-2 border-white/10 bg-black/30" name="deliveryPoint" /></label><label className="text-xs text-slate-400 sm:col-span-2">Note<Textarea className="mt-2 border-white/10 bg-black/30" name="notes" /></label></>}
      {modal === "material_review" && reviewRecord && <><div className="rounded-2xl border border-amber-300/15 bg-amber-300/[0.035] p-4 sm:col-span-2"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-200/70">REVISIONE MAGAZZINO</p><p className="mt-2 text-sm font-semibold text-slate-100">{reviewRecord.title}</p><p className="mt-1 text-[10px] leading-4 text-slate-500">Assegna il magazzino di evasione e conferma o correggi le quantità. Le righe richieste restano nello storico.</p></div><label className="text-xs text-slate-400 sm:col-span-2">Magazzino di evasione<select aria-label="Magazzino di evasione" className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-slate-100 outline-none focus:border-lime-300/40" name="warehouseId" onChange={(event) => setReviewWarehouseId(event.target.value)} required value={reviewWarehouseId}><option value="">{warehouseState === "loading" ? "Caricamento magazzini…" : warehouseState === "error" ? "Catalogo non disponibile" : "Seleziona magazzino"}</option>{warehouseOptions.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name} · {warehouse.locationLabel}</option>)}</select></label><label className="text-xs text-slate-400">Esito<select aria-label="Esito revisione" className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-slate-100 outline-none focus:border-lime-300/40" name="reviewDecision" defaultValue="APPROVED"><option value="APPROVED">Approva quantità richieste</option><option value="MODIFIED">Modifica quantità e approva</option></select></label><div className="space-y-2 sm:col-span-2">{reviewLines.map((line, index) => <div className="grid gap-2 rounded-xl border border-white/[0.08] bg-black/20 p-3 sm:grid-cols-[minmax(0,1fr)_100px_100px]" key={line.id}><label className="text-[10px] text-slate-500">Materiale<Input className="mt-1 h-9 border-white/10 bg-black/30 text-xs" onChange={(event) => setReviewLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item))} value={line.description} /></label><label className="text-[10px] text-slate-500">Quantità<Input className="mt-1 h-9 border-white/10 bg-black/30 text-xs" min="0.001" onChange={(event) => setReviewLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: Number(event.target.value) } : item))} step="0.001" type="number" value={line.quantity} /></label><label className="text-[10px] text-slate-500">Unità<Input className="mt-1 h-9 border-white/10 bg-black/30 text-xs" onChange={(event) => setReviewLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, unit: event.target.value } : item))} value={line.unit} /></label></div>)}{!reviewLines.length && <p className="rounded-xl border border-rose-300/15 bg-rose-300/[0.03] p-3 text-[10px] text-rose-100">Nessuna riga valida da revisionare.</p>}</div><label className="text-xs text-slate-400 sm:col-span-2">Nota del responsabile<Textarea className="mt-2 border-white/10 bg-black/30" name="reviewNote" placeholder="Vincoli, sostituzioni o quantità approvate…" /></label></>}
      {modal === "mission" && <><label className="text-xs text-slate-400 sm:col-span-2">Titolo<Input className="mt-2 border-white/10 bg-black/30" name="title" defaultValue="Missione di trasporto" required /></label><label className="text-xs text-slate-400">Modalità trasporto<select aria-label="Modalità trasporto" className="mt-2 h-10 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-xs text-slate-100 outline-none focus:border-lime-300/40 focus:ring-2 focus:ring-lime-300/10" name="transportMode" onChange={(event) => setTransportMode(event.target.value as TransportMode)} required value={transportMode}>{(payload.context?.operatingTransportModes ?? []).map((mode) => <option key={mode} value={mode}>{TRANSPORT_MODE_CATALOG[mode as TransportMode]?.label ?? mode}</option>)}</select></label>{transportMode === "WAREHOUSE_TO_JOB" && <label className="text-xs text-slate-400 sm:col-span-2">Richiesta materiali approvata<select aria-label="Richiesta materiali approvata" className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-slate-100" name="materialRequestId" required><option value="">Seleziona richiesta</option>{payload.sections.warehouse.records.filter((record) => record.recordType === "MATERIAL_REQUEST" && record.status === "APPROVED" && !record.payload.missionId).map((record) => <option key={record.id} value={record.id}>{record.title} · {textValue(record.payload.deliveryPoint, "Punto consegna da definire")}</option>)}</select></label>}{transportMode === "WAREHOUSE_TO_JOB" && !payload.sections.warehouse.records.some((record) => record.recordType === "MATERIAL_REQUEST" && record.status === "APPROVED" && !record.payload.missionId) && <p className="rounded-xl border border-amber-300/15 bg-amber-300/[0.03] p-3 text-[10px] text-amber-100 sm:col-span-2">Prima di programmare il trasporto, il responsabile deve approvare una richiesta materiali.</p>}<label className="text-xs text-slate-400">Partenza<Input className="mt-2 border-white/10 bg-black/30" name="pickup" required /></label><label className="text-xs text-slate-400">Destinazione<Input className="mt-2 border-white/10 bg-black/30" name="dropoff" required /></label><label className="text-xs text-slate-400">Inizio pianificato<Input className="mt-2 border-white/10 bg-black/30" name="plannedAt" type="datetime-local" onChange={(event) => setPlannedAt(event.target.value)} required value={plannedAt} /></label><label className="text-xs text-slate-400">Fine pianificata <span className="text-slate-600">(opzionale)</span><Input className="mt-2 border-white/10 bg-black/30" name="plannedEndAt" type="datetime-local" onChange={(event) => setPlannedEndAt(event.target.value)} value={plannedEndAt} /></label><MissionResourceFields plannedAt={plannedAt} plannedEndAt={plannedEndAt} transportMode={transportMode} driverId={driverId} vehicleId={vehicleId} cargoAssetId={cargoAssetId} onDriverChange={setDriverId} onVehicleChange={setVehicleId} onCargoAssetChange={setCargoAssetId} /><label className="text-xs text-slate-400 sm:col-span-2">Note<Textarea className="mt-2 border-white/10 bg-black/30" name="notes" /></label></>}
      {modal === "delivery" && <><label className="text-xs text-slate-400 sm:col-span-2">Ricevente<Input className="mt-2 border-white/10 bg-black/30" name="recipient" required /></label><label className="text-xs text-slate-400 sm:col-span-2">Data consegna<Input className="mt-2 border-white/10 bg-black/30" name="deliveredAt" type="datetime-local" required /></label><label className="text-xs text-slate-400 sm:col-span-2">Nota POD<Textarea className="mt-2 border-white/10 bg-black/30" name="note" /></label></>}
      {modal === "document" && <><label className="text-xs text-slate-400 sm:col-span-2">Categoria<Input className="mt-2 border-white/10 bg-black/30" name="category" defaultValue="COMMESSA" required /></label><label className="rounded-2xl border border-dashed border-lime-300/20 bg-lime-300/[0.035] p-5 text-xs text-slate-400 sm:col-span-2"><Upload className="mb-3 size-5 text-lime-200" />File · massimo 20 MB<Input accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.jpg,.jpeg,.png,.webp,.heic,.heif" className="mt-3 border-white/10 bg-black/30 file:text-lime-200" name="file" type="file" required /><span className="mt-2 block text-[10px] text-slate-600">DOCX incluso. Il documento viene verificato prima dell’archiviazione.</span></label></>}
      <DialogFooter className="sm:col-span-2"><DialogClose asChild><Button type="button" variant="outline" className="border-white/10 bg-transparent text-slate-400">Annulla</Button></DialogClose><Button disabled={busy || (modal === "material_review" && warehouseState !== "ready")} type="submit" className="bg-lime-300 text-[#050705] hover:bg-lime-200">{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}{modal === "material_review" ? "Conferma revisione" : "Conferma"}</Button></DialogFooter>
    </form></DialogContent></Dialog>
    {notice && <button className="fixed bottom-5 right-5 z-[70] max-w-[370px] rounded-xl border border-lime-300/25 bg-[#080d09]/95 px-4 py-3 text-left text-xs text-lime-100 shadow-[0_0_30px_rgba(190,255,60,0.14)] backdrop-blur-xl" onClick={() => setNotice("")} type="button"><CheckCircle2 className="mr-2 inline size-4 text-lime-300" />{notice}</button>}
  </section>;
}
