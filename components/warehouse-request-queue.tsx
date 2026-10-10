"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { CheckCircle2, ClipboardCheck, LoaderCircle, PackageCheck, RefreshCw, ShieldCheck, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type WarehouseOption = { id: string; code: string; name: string; locationLabel: string; status: string };
type ReviewLine = { id: string; itemId: string; description: string; unit: string; quantity: number };
type RequestRecord = {
  id: string;
  jobId: string;
  jobCode: string | null;
  jobTitle: string;
  title: string;
  status: string;
  version: number;
  createdAt: string;
  payload: Record<string, unknown>;
  mission: { id: string; title: string; status: string } | null;
  stockMovements: Array<{ itemId: string; missionId: string | null; movementType: string; quantity: number }>;
};
type StockItem = { id: string; sku: string; name: string; unit: string; warehouseId: string | null; onHand: number; reserved: number; available: number; version: number };
type InventoryReadback = { items: StockItem[]; movements: Array<{ itemId: string; missionId: string | null; movementType: string; quantity: number }>; readback?: { status?: string } };
type RequestPayload = { requests?: RequestRecord[]; error?: string };

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function payloadLines(value: unknown): ReviewLine[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    const line = objectValue(entry);
    const quantity = Number(line.quantity);
    const description = typeof line.description === "string" ? line.description : typeof line.name === "string" ? line.name : "Materiale richiesto";
    const unit = typeof line.unit === "string" ? line.unit : "PZ";
    return Number.isFinite(quantity) && quantity > 0
      ? [{ id: typeof line.id === "string" && line.id ? line.id : `line-${index + 1}`, itemId: typeof line.itemId === "string" ? line.itemId : "", description, unit, quantity }]
      : [];
  });
}

function formatQuantity(value: number, unit: string) {
  return `${value.toLocaleString("it-IT", { maximumFractionDigits: 3 })} ${unit}`;
}

function serverErrorMessage(code: string | undefined) {
  if (code === "insufficient_available_stock") return "Scorta libera insufficiente nel deposito selezionato. Riduci la quantità o scegli un deposito/articolo disponibile.";
  if (code === "version_conflict" || code === "inventory_reservation_conflict") return "La giacenza è cambiata mentre lavoravi. Aggiorna il Magazzino e ripeti la verifica.";
  if (code === "material_modification_reason_required") return "Aggiungi una nota che spieghi le quantità modificate.";
  if (code === "material_change_requires_modified_decision") return "Hai scelto un materiale o una quantità diversa: usa ‘Modifica e approva’ e spiega la sostituzione.";
  if (code === "material_rejection_reason_required") return "Indica il motivo del rifiuto.";
  if (code === "warehouse_assignment_required") return "Il tuo profilo non è assegnato a questo deposito.";
  return code ? `Operazione non completata · ${code}` : "Operazione non completata. Riprova.";
}

export function WarehouseRequestQueue({
  warehouses,
  selectedWarehouseId,
  canReview,
  canFulfill,
  onNotice,
  onRefresh,
}: {
  warehouses: WarehouseOption[];
  selectedWarehouseId: string;
  canReview: boolean;
  canFulfill: boolean;
  onNotice: (message: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const [requests, setRequests] = useState<RequestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeRequest, setActiveRequest] = useState<RequestRecord | null>(null);
  const [reviewLines, setReviewLines] = useState<ReviewLine[]>([]);
  const [reviewWarehouseId, setReviewWarehouseId] = useState("");
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [stockByWarehouse, setStockByWarehouse] = useState<Record<string, StockItem[]>>({});
  const [stockLoading, setStockLoading] = useState(false);
  const [decision, setDecision] = useState<"APPROVED" | "MODIFIED" | "REJECTED">("APPROVED");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [pickBusyId, setPickBusyId] = useState("");
  const openedDeepLink = useRef(false);

  const loadRequests = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      const response = await fetch("/api/warehouse/requests", { cache: "no-store" });
      const result = await response.json() as RequestPayload;
      if (!response.ok) throw new Error(result.error ?? "warehouse_requests_readback_unavailable");
      setRequests(result.requests ?? []);
    } catch {
      if (!quiet) onNotice("La coda richieste non è disponibile. Il registro scorte resta consultabile.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [onNotice]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadRequests(), 0);
    return () => window.clearTimeout(timer);
  }, [loadRequests]);

  const loadStock = useCallback(async (warehouseId: string) => {
    setStockLoading(true);
    setStockItems([]);
    try {
      const response = await fetch(`/api/warehouse/inventory?warehouseId=${encodeURIComponent(warehouseId)}`, { cache: "no-store" });
      const result = await response.json() as InventoryReadback & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "inventory_readback_unavailable");
      setStockItems(result.items ?? []);
      setStockByWarehouse((current) => ({ ...current, [warehouseId]: result.items ?? [] }));
    } catch {
      onNotice("Non riesco a rileggere le scorte di questo deposito.");
    } finally {
      setStockLoading(false);
    }
  }, [onNotice]);

  const openRequest = useCallback((request: RequestRecord) => {
    const defaultWarehouse = typeof request.payload.warehouseId === "string"
      ? request.payload.warehouseId
      : typeof objectValue(request.payload.warehouse).id === "string"
        ? String(objectValue(request.payload.warehouse).id)
        : selectedWarehouseId || warehouses[0]?.id || "";
    setActiveRequest(request);
    setReviewLines(payloadLines(request.payload.requestedLines ?? request.payload.lines));
    setReviewWarehouseId(defaultWarehouse);
    setDecision("APPROVED");
    setNote("");
    if (defaultWarehouse) void loadStock(defaultWarehouse);
  }, [loadStock, selectedWarehouseId, warehouses]);

  useEffect(() => {
    if (openedDeepLink.current || !requests.length || typeof window === "undefined") return;
    openedDeepLink.current = true;
    const requestId = new URLSearchParams(window.location.search).get("request");
    if (!requestId) return;
    const request = requests.find((entry) => entry.id === requestId && entry.status === "REQUESTED");
    const timer = request && canReview ? window.setTimeout(() => openRequest(request), 0) : null;
    const url = new URL(window.location.href);
    url.searchParams.delete("request");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    return () => { if (timer !== null) window.clearTimeout(timer); };
  }, [canReview, openRequest, requests]);

  useEffect(() => {
    const ids = [...new Set(requests.filter((request) => request.status === "APPROVED" && request.mission)
      .map((request) => typeof request.payload.warehouseId === "string" ? request.payload.warehouseId : String(objectValue(request.payload.warehouse).id ?? ""))
      .filter((id) => id && !stockByWarehouse[id]))];
    for (const id of ids) {
      void fetch(`/api/warehouse/inventory?warehouseId=${encodeURIComponent(id)}`, { cache: "no-store" })
        .then(async (response) => {
          const result = await response.json() as InventoryReadback;
          if (response.ok) setStockByWarehouse((current) => ({ ...current, [id]: result.items ?? [] }));
        }).catch(() => undefined);
    }
  }, [requests, stockByWarehouse]);

  const linesByItem = useMemo(() => {
    const grouped = new Map<string, { itemId: string; description: string; unit: string; quantity: number }>();
    for (const request of requests) {
      if (request.status !== "APPROVED" || !request.mission) continue;
      for (const line of payloadLines(request.payload.lines)) {
        if (!line.itemId) continue;
        const existing = grouped.get(`${request.id}:${line.itemId}`);
        grouped.set(`${request.id}:${line.itemId}`, {
          itemId: line.itemId,
          description: line.description,
          unit: line.unit,
          quantity: (existing?.quantity ?? 0) + line.quantity,
        });
      }
    }
    return grouped;
  }, [requests]);

  async function submitReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeRequest || busy) return;
    if (decision === "REJECTED") {
      if (note.trim().length < 4) { onNotice("Indica il motivo del rifiuto."); return; }
    } else {
      if (!reviewWarehouseId || !warehouses.some((warehouse) => warehouse.id === reviewWarehouseId)) {
        onNotice("Seleziona un deposito accessibile.");
        return;
      }
      if (!reviewLines.length || reviewLines.some((line) => !line.itemId || !stockItems.some((item) => item.id === line.itemId) || !Number.isFinite(line.quantity) || line.quantity <= 0)) {
        onNotice("Associa ogni riga a un articolo registrato e controlla le quantità.");
        return;
      }
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/operations/jobs/${encodeURIComponent(activeRequest.jobId)}/journey`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "material_review",
          recordId: activeRequest.id,
          expectedVersion: activeRequest.version,
          decision,
          ...(decision === "REJECTED" ? {} : { warehouseId: reviewWarehouseId, lines: reviewLines }),
          note,
          idempotencyKey: `warehouse-review-${crypto.randomUUID()}`,
        }),
      });
      const result = await response.json() as { error?: string; readback?: { status?: string }; mutation?: { action?: string; eventId?: string; record?: { version?: number } } };
      if (!response.ok) {
        onNotice(serverErrorMessage(result.error));
        if (response.status === 409) await Promise.all([loadRequests(true), loadStock(reviewWarehouseId)]);
        return;
      }
      if (result.readback?.status !== "verified" || result.mutation?.action !== "material_review" || !result.mutation.eventId) {
        onNotice("Il server non ha confermato evento e readback della revisione.");
        return;
      }
      setActiveRequest(null);
      onNotice(decision === "REJECTED" ? "Richiesta respinta con motivazione registrata." : "Quantità riservate nel deposito; richiesta pronta per la programmazione missione.");
      await Promise.all([loadRequests(true), onRefresh()]);
    } catch {
      onNotice("Connessione non disponibile: nessuna revisione confermata.");
    } finally {
      setBusy(false);
    }
  }

  async function pickForMission(request: RequestRecord, itemId: string) {
    if (!request.mission || pickBusyId) return;
    const warehouseValue = objectValue(request.payload.warehouse);
    const warehouseId = typeof request.payload.warehouseId === "string" ? request.payload.warehouseId : String(warehouseValue.id ?? "");
    const line = linesByItem.get(`${request.id}:${itemId}`);
    const item = stockByWarehouse[warehouseId]?.find((candidate) => candidate.id === itemId);
    if (!line || !item || !warehouseId) return;
    const picked = request.stockMovements
      .filter((movement) => movement.itemId === itemId && movement.missionId === request.mission?.id && movement.movementType === "PICK")
      .reduce((total, movement) => total + movement.quantity, 0);
    const remaining = Math.max(0, line.quantity - picked);
    if (remaining <= 0) return;
    setPickBusyId(itemId);
    try {
      const response = await fetch("/api/warehouse/inventory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "pick",
          itemId,
          warehouseId,
          expectedVersion: item.version,
          quantity: remaining,
          jobId: request.jobId,
          missionId: request.mission.id,
          note: `Prelievo richiesta ${request.id} · ${request.mission.title}`,
          idempotencyKey: `warehouse-pick-${request.id}-${itemId}-${crypto.randomUUID()}`,
        }),
      });
      const result = await response.json() as { error?: string; eventId?: string; readback?: { status?: string } };
      if (!response.ok) { onNotice(serverErrorMessage(result.error)); return; }
      if (!result.eventId || result.readback?.status !== "verified") { onNotice("Il server non ha confermato il prelievo nel ledger."); return; }
      onNotice(`Prelievo registrato · ${formatQuantity(remaining, line.unit)} · missione ${request.mission.id}`);
      await Promise.all([loadRequests(true), loadStock(warehouseId), onRefresh()]);
    } catch {
      onNotice("Connessione non disponibile: nessun prelievo confermato.");
    } finally {
      setPickBusyId("");
    }
  }

  const pendingCount = requests.filter((request) => request.status === "REQUESTED").length;
  if (!canReview && !canFulfill) return null;

  return <>
    <section className="carbon-card mt-4 rounded-2xl border border-amber-300/15 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-2xl border border-amber-300/25 bg-amber-300/10 text-amber-200"><ClipboardCheck className="size-5" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-amber-200/70">FLUSSO COMMESSA → DEPOSITO → MISSIONE</p><h2 className="mt-1 text-lg font-semibold text-slate-100">Richieste e preparazione materiali</h2><p className="mt-1 text-xs leading-5 text-slate-500">Approva le richieste prenotando scorte reali; il magazziniere registra il prelievo sulla missione collegata.</p></div></div>
        <div className="flex items-center gap-2"><span className="rounded-full border border-amber-300/20 bg-amber-300/[.05] px-3 py-1.5 font-mono text-[10px] text-amber-100">{pendingCount} DA REVISIONARE</span><Button aria-label="Aggiorna richieste magazzino" className="size-9 border-white/10 bg-black/20 p-0 text-slate-400" disabled={refreshing} onClick={() => void loadRequests(true)} variant="outline"><RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} /></Button></div>
      </div>
      <div className="mt-4 space-y-3">
        {requests.map((request) => {
          const requestedLines = payloadLines(request.payload.lines);
          const warehouse = objectValue(request.payload.warehouse);
          const warehouseId = typeof request.payload.warehouseId === "string" ? request.payload.warehouseId : typeof warehouse.id === "string" ? warehouse.id : "";
          const warehouseStock = stockByWarehouse[warehouseId] ?? [];
          return <article className="rounded-2xl border border-white/[.08] bg-black/20 p-4" key={request.id}>
            <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="font-mono text-[9px] uppercase tracking-[.14em] text-slate-600">{request.jobCode ?? "COMMESSA"} · {request.title}</p><h3 className="mt-1 text-sm font-semibold text-slate-100">{request.jobTitle}</h3><p className="mt-1 text-[10px] text-slate-500">Creata {new Date(request.createdAt).toLocaleString("it-IT")} · consegna {typeof request.payload.deliveryPoint === "string" && request.payload.deliveryPoint ? request.payload.deliveryPoint : "da definire"}</p></div><span className={`rounded-full border px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[.1em] ${request.status === "REQUESTED" ? "border-amber-300/20 bg-amber-300/[.05] text-amber-100" : "border-cyan-300/20 bg-cyan-300/[.05] text-cyan-100"}`}>{request.status === "REQUESTED" ? "DA REVISIONARE" : "MISSIONE PROGRAMMATA"}</span></div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">{requestedLines.map((line) => {
              const item = warehouseStock.find((candidate) => candidate.id === line.itemId);
              return <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[.07] bg-black/20 px-3 py-2" key={line.id}><div className="min-w-0"><p className="truncate text-xs font-medium text-slate-200">{line.description}</p><p className="mt-1 font-mono text-[9px] text-slate-600">{line.quantity.toLocaleString("it-IT")} {line.unit}{item ? ` · ${item.sku}` : ""}</p></div>{item && <span className="shrink-0 text-[9px] text-lime-100">libero {formatQuantity(item.available, item.unit)}</span>}</div>;
            })}</div>
            {request.status === "APPROVED" && request.mission && <div className="mt-3 rounded-xl border border-cyan-300/15 bg-cyan-300/[.035] p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="flex items-center gap-2 text-xs font-semibold text-cyan-100"><Truck className="size-4" />{request.mission.title} · {request.mission.status}</p>{warehouseId && <p className="font-mono text-[9px] text-slate-500">{String(warehouse.code ?? "DEPOSITO")} · {String(warehouse.name ?? "")}</p>}</div><div className="mt-3 space-y-2">{requestedLines.filter((line, index, lines) => line.itemId && lines.findIndex((candidate) => candidate.itemId === line.itemId) === index).map((line) => {
              const grouped = linesByItem.get(`${request.id}:${line.itemId}`);
              const item = warehouseStock.find((candidate) => candidate.id === line.itemId);
              const picked = request.stockMovements.filter((movement) => movement.itemId === line.itemId && movement.missionId === request.mission?.id && movement.movementType === "PICK").reduce((total, movement) => total + movement.quantity, 0);
              const remaining = Math.max(0, (grouped?.quantity ?? line.quantity) - picked);
              return <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/[.06] bg-black/25 px-3 py-2" key={`${line.id}-pick`}><p className="text-[10px] text-slate-300">{line.description} · prelevato {formatQuantity(picked, line.unit)} / {formatQuantity(grouped?.quantity ?? line.quantity, line.unit)}</p><Button className="h-8 border-lime-300/20 bg-lime-300/[.05] px-2.5 text-[9px] text-lime-100 hover:bg-lime-300/10" disabled={!canFulfill || !item || !remaining || request.mission?.status !== "PLANNED" || pickBusyId === line.itemId} onClick={() => void pickForMission(request, line.itemId)} variant="outline">{pickBusyId === line.itemId ? <LoaderCircle className="size-3 animate-spin" /> : <PackageCheck className="size-3" />}{remaining ? `Preleva ${formatQuantity(remaining, line.unit)}` : "Prelievo completo"}</Button></div>;
            })}</div><p className="mt-2 text-[9px] leading-4 text-slate-600">Il prelievo scala saldo e prenotazione in questo deposito. L’autista conferma il carico alla tappa missione con timestamp e geofence.</p></div>}
            {request.status === "REQUESTED" && canReview && <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/[.06] pt-3"><p className="flex items-center gap-2 text-[10px] text-slate-500"><ShieldCheck className="size-3.5 text-amber-200" />Verifica articolo, disponibilità e deposito prima di approvare.</p><Button className="h-9 bg-lime-300 px-3 text-[10px] font-semibold text-[#050705] hover:bg-lime-200" onClick={() => openRequest(request)}><ClipboardCheck className="size-3.5" />Revisiona e assegna</Button></div>}
            {request.status === "APPROVED" && !request.mission && <p className="mt-3 text-[10px] text-amber-100/75">Richiesta approvata · in attesa di programmazione nel modulo Missioni.</p>}
          </article>;
        })}
        {!loading && requests.length === 0 && <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-xs text-slate-500">Nessuna richiesta o missione materiali nel tuo perimetro.</div>}
        {loading && <div className="flex items-center gap-2 rounded-xl border border-white/[.07] p-5 text-xs text-slate-500"><LoaderCircle className="size-4 animate-spin text-lime-200" />Lettura coda server-side…</div>}
      </div>
    </section>

    <Dialog open={Boolean(activeRequest)} onOpenChange={(open) => !open && setActiveRequest(null)}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto border-lime-300/20 bg-[#080c09] text-slate-100 sm:max-w-[720px]">
        <form className="space-y-4" onSubmit={submitReview}>
          <DialogHeader><DialogTitle>Revisiona richiesta materiali</DialogTitle><DialogDescription className="text-slate-500">Associa le righe al catalogo del deposito. L’approvazione riserva la quantità, senza registrare un carico fisico.</DialogDescription></DialogHeader>
          {activeRequest && <div className="rounded-xl border border-amber-300/15 bg-amber-300/[.035] p-3"><p className="text-[9px] font-mono uppercase tracking-[.14em] text-amber-100/70">{activeRequest.jobCode ?? "COMMESSA"} · {activeRequest.jobTitle}</p><p className="mt-1 text-xs font-semibold text-slate-100">{activeRequest.title}</p><p className="mt-1 text-[10px] text-slate-500">{typeof activeRequest.payload.deliveryPoint === "string" ? activeRequest.payload.deliveryPoint : "Punto di consegna da definire"}</p></div>}
          <label className="block text-xs text-slate-400">Deposito di evasione<select className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-slate-100" onChange={(event) => { const id = event.target.value; setReviewWarehouseId(id); setReviewLines((lines) => lines.map((line) => ({ ...line, itemId: "" }))); if (id) void loadStock(id); else setStockItems([]); }} value={reviewWarehouseId}><option value="">Seleziona deposito accessibile</option>{warehouses.filter((warehouse) => warehouse.status === "active").map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name} · {warehouse.locationLabel}</option>)}</select></label>
          <div className="flex flex-wrap items-center gap-3"><label className="flex-1 text-xs text-slate-400">Esito<select className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-slate-100" onChange={(event) => setDecision(event.target.value as typeof decision)} value={decision}><option value="APPROVED">Approva quantità richieste</option><option value="MODIFIED">Modifica e approva</option><option value="REJECTED">Respingi richiesta</option></select></label><span className="text-[10px] text-slate-600">Le unità di misura restano quelle richieste.</span></div>
          {decision !== "REJECTED" && <div className="space-y-2">{reviewLines.map((line, index) => {
            const unitItems = stockItems.filter((item) => item.unit === line.unit);
            const chosen = unitItems.find((item) => item.id === line.itemId);
            return <div className="grid gap-2 rounded-xl border border-white/[.08] bg-black/20 p-3 sm:grid-cols-[minmax(0,1fr)_140px]" key={line.id}><label className="min-w-0 text-[10px] text-slate-500">Articolo del registro · richiesta: {line.description}<select className="mt-1 h-10 w-full rounded-lg border border-white/10 bg-black/30 px-2 text-xs text-slate-100" onChange={(event) => { const itemId = event.target.value; const item = unitItems.find((candidate) => candidate.id === itemId); setReviewLines((lines) => lines.map((current, currentIndex) => currentIndex === index ? { ...current, itemId } : current)); if (item && item.name.trim().toLocaleLowerCase("it-IT") !== line.description.trim().toLocaleLowerCase("it-IT")) setDecision("MODIFIED"); }} value={line.itemId}><option value="">Associa articolo del deposito</option>{unitItems.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.sku} · libero {formatQuantity(item.available, item.unit)}</option>)}</select>{chosen && <span className="mt-1 block text-[9px] text-slate-600">Saldo {formatQuantity(chosen.onHand, chosen.unit)} · già prenotato {formatQuantity(chosen.reserved, chosen.unit)}</span>}</label><label className="text-[10px] text-slate-500">Quantità · {line.unit}<Input className="mt-1 border-white/10 bg-black/30 text-sm text-slate-100" min="0.001" onChange={(event) => { setReviewLines((lines) => lines.map((current, currentIndex) => currentIndex === index ? { ...current, quantity: Number(event.target.value) } : current)); if (Number(event.target.value) !== line.quantity && decision === "APPROVED") setDecision("MODIFIED"); }} step="0.001" type="number" value={line.quantity} /></label>
          </div>; })}{stockLoading && <p className="flex items-center gap-2 text-[10px] text-cyan-100"><LoaderCircle className="size-3 animate-spin" />Lettura catalogo deposito…</p>}{!stockLoading && reviewLines.length > 0 && stockItems.length === 0 && <p className="rounded-lg border border-amber-300/15 bg-amber-300/[.035] p-3 text-[10px] text-amber-100">Il deposito non ha articoli registrati. Non puoi approvare una richiesta senza associarla al catalogo.</p>}</div>}
          <label className="block text-xs text-slate-400">Nota del responsabile {decision === "REJECTED" || decision === "MODIFIED" ? <span className="text-amber-200">· obbligatoria</span> : <span className="text-slate-600">· opzionale</span>}<Textarea className="mt-2 border-white/10 bg-black/30 text-slate-100" onChange={(event) => setNote(event.target.value)} placeholder={decision === "REJECTED" ? "Motivo del rifiuto…" : "Motivo della modifica o nota di evasione…"} value={note} /></label>
          <DialogFooter><DialogClose asChild><Button className="border-white/10 bg-transparent text-slate-400" type="button" variant="outline">Annulla</Button></DialogClose><Button className="bg-lime-300 text-[#050705] hover:bg-lime-200" disabled={busy || (decision !== "REJECTED" && (stockLoading || !reviewWarehouseId || reviewLines.some((line) => !line.itemId || !stockItems.some((item) => item.id === line.itemId))))} type="submit">{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : decision === "REJECTED" ? <ShieldCheck className="size-3.5" /> : <CheckCircle2 className="size-3.5" />}{decision === "REJECTED" ? "Registra rifiuto" : decision === "MODIFIED" ? "Approva quantità modificate" : "Approva e prenota scorte"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}
