"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { AlertTriangle, ArrowDownToLine, Boxes, CheckCircle2, CircleGauge, History, LoaderCircle, PackagePlus, RefreshCw, Send, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type InventoryItem = { id: string; sku: string; name: string; unit: string; location: string; onHand: number; reserved: number; available: number; minStock: number; belowMinimum: boolean; status: string; version: number; updatedAt: string };
type InventoryMovement = { id: string; itemId: string; jobId: string | null; missionId: string | null; movementType: string; quantity: number; before: { onHand: number; reserved: number }; after: { onHand: number; reserved: number }; note: string; createdAt: string };
type InventoryPayload = { context: { role: string; capabilities: string[] }; items: InventoryItem[]; movements: InventoryMovement[]; summary: { itemCount: number; lowStockCount: number; movementCount: number } };
type Modal = "register" | "movement" | null;

function value(form: FormData, key: string) {
  const candidate = form.get(key);
  return typeof candidate === "string" ? candidate.trim() : "";
}

export default function WarehouseControl() {
  const [payload, setPayload] = useState<InventoryPayload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "forbidden" | "error">("loading");
  const [modal, setModal] = useState<Modal>(null);
  const [selected, setSelected] = useState<InventoryItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const notify = useCallback((message: string) => { setNotice(message); window.setTimeout(() => setNotice(""), 3400); }, []);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/warehouse/inventory", { cache: "no-store" });
      if (response.status === 403) { setState("forbidden"); return; }
      if (!response.ok) throw new Error("inventory_unavailable");
      setPayload(await response.json() as InventoryPayload);
      setState("ready");
    } catch { setState("error"); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void refresh(), 0); return () => window.clearTimeout(timer); }, [refresh]);

  const canWrite = payload?.context.capabilities.includes("warehouse.write") ?? false;
  const totals = useMemo(() => payload?.items.reduce((result, item) => ({ onHand: result.onHand + item.onHand, reserved: result.reserved + item.reserved, available: result.available + item.available }), { onHand: 0, reserved: 0, available: 0 }) ?? { onHand: 0, reserved: 0, available: 0 }, [payload]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!payload) return;
    const form = new FormData(event.currentTarget);
    const action = modal === "register" ? "register_item" : value(form, "action");
    const body: Record<string, unknown> = modal === "register" ? {
      action,
      name: value(form, "name"),
      sku: value(form, "sku"),
      unit: value(form, "unit"),
      location: value(form, "location"),
      openingQuantity: value(form, "openingQuantity"),
      minStock: value(form, "minStock"),
      note: value(form, "note"),
    } : {
      action,
      itemId: selected?.id,
      expectedVersion: selected?.version,
      quantity: value(form, "quantity"),
      jobId: value(form, "jobId"),
      missionId: value(form, "missionId"),
      note: value(form, "note"),
    };
    body.idempotencyKey = `warehouse-${action}-${crypto.randomUUID()}`;
    setBusy(true);
    try {
      const response = await fetch("/api/warehouse/inventory", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as InventoryPayload & { error?: string };
      if (!response.ok) {
        notify(result.error === "version_conflict" ? "Saldo cambiato: readback aggiornato." : `Movimento non eseguito: ${result.error ?? "errore"}`);
        if (response.status === 409) await refresh();
        return;
      }
      await refresh();
      setModal(null);
      setSelected(null);
      notify("Saldo e ledger riletti correttamente.");
    } catch { notify("Connessione non disponibile: nessun saldo modificato."); }
    finally { setBusy(false); }
  };

  if (state === "loading") return <main className="grid min-h-screen place-items-center bg-[#030504] text-xs text-slate-500"><span className="flex items-center gap-3"><LoaderCircle className="size-4 animate-spin text-lime-300" />Caricamento magazzino…</span></main>;
  if (state === "forbidden") return <main className="grid min-h-screen place-items-center bg-[#030504] px-5 text-slate-100"><section className="carbon-card max-w-lg rounded-3xl p-7 text-center"><ShieldCheck className="mx-auto size-8 text-amber-200" /><h1 className="mt-4 text-lg font-semibold">Magazzino non visibile</h1><p className="mt-2 text-xs text-slate-500">Il ruolo corrente non dispone di warehouse.read.</p></section></main>;
  if (state === "error" || !payload) return <main className="grid min-h-screen place-items-center bg-[#030504] text-slate-100"><Button variant="outline" onClick={() => void refresh()}><RefreshCw className="size-4" />Riprova</Button></main>;

  return <main className="min-h-screen overflow-x-hidden bg-[#030504] px-4 py-5 text-slate-100 sm:px-7 sm:py-7">
    <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_72%_0%,rgba(200,255,34,0.08),transparent_25%),linear-gradient(145deg,#020403,#071008_48%,#030504)]" />
    <div className="relative mx-auto max-w-[1560px]">
      <header className="relative overflow-hidden rounded-[28px] border border-lime-300/20 bg-[linear-gradient(145deg,rgba(18,27,19,0.97),rgba(4,7,5,0.99)_60%,rgba(13,20,14,0.98))] p-6 shadow-[0_30px_90px_rgba(0,0,0,.42)] sm:p-8"><div className="pointer-events-none absolute -right-44 -top-48 size-[34rem] rounded-full bg-lime-300/[0.065] blur-3xl" /><div className="pointer-events-none absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-lime-300/75 to-transparent" /><div className="relative flex flex-wrap items-start justify-between gap-5"><div><p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-lime-300/70">AI-ZEROW / MATERIAL CONTROL</p><h1 className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-lime-50 sm:text-[42px]">Magazzino operativo</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">Anagrafiche, disponibilità, prenotazioni e movimenti in un ledger tenant-scoped.</p></div><div className="flex gap-2">{canWrite && <Button className="bg-lime-300 text-xs font-semibold text-[#050705] hover:bg-lime-200" onClick={() => setModal("register")}><PackagePlus className="size-4" />Registra materiale</Button>}<button aria-label="Rileggi magazzino" className="grid size-10 place-items-center rounded-xl border border-white/10 bg-black/30 text-slate-500 hover:border-lime-300/30 hover:text-lime-200" onClick={() => void refresh()} type="button"><RefreshCw className="size-4" /></button></div></div></header>

      <section className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
        { label: "Anagrafiche", value: payload.summary.itemCount, detail: "materiali censiti", icon: Boxes },
        { label: "Disponibile", value: totals.available.toLocaleString("it-IT"), detail: "unità aggregate", icon: CheckCircle2 },
        { label: "Riservato", value: totals.reserved.toLocaleString("it-IT"), detail: "per commesse", icon: CircleGauge },
        { label: "Sotto scorta", value: payload.summary.lowStockCount, detail: "richiedono attenzione", icon: AlertTriangle },
      ].map((kpi) => <article className="carbon-card rounded-[20px] p-4" key={kpi.label}><div className="flex items-start justify-between"><div><p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-600">{kpi.label}</p><p className="mt-2 font-mono text-2xl font-semibold text-lime-100">{kpi.value}</p><p className="mt-1 text-[10px] text-slate-600">{kpi.detail}</p></div><span className="grid size-9 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/[0.07] text-lime-200"><kpi.icon className="size-4" /></span></div></article>)}</section>

      <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_390px]"><article className="carbon-card rounded-[24px] p-5"><div className="flex items-center justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/65">STOCK REGISTER</p><h2 className="mt-1 text-base font-semibold">Materiali e saldi</h2></div><span className="rounded-full border border-lime-300/20 bg-lime-300/[0.06] px-3 py-1 text-[9px] text-lime-100">D1 READBACK</span></div><div className="mt-5 space-y-2">{payload.items.map((item) => { const denominator = Math.max(item.onHand, item.minStock, 1); const width = Math.max(0, Math.min(100, item.available / denominator * 100)); return <div className="rounded-2xl border border-white/[0.075] bg-black/25 p-4" key={item.id}><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-semibold text-slate-100">{item.name}</p><span className={`rounded-full border px-2 py-1 text-[7px] font-semibold ${item.belowMinimum ? "border-amber-300/25 bg-amber-300/[0.08] text-amber-100" : "border-lime-300/20 bg-lime-300/[0.06] text-lime-100"}`}>{item.status}</span></div><p className="mt-1 font-mono text-[9px] text-slate-600">{item.sku} · {item.location} · v{item.version}</p></div>{canWrite && <Button variant="outline" className="h-8 border-white/10 bg-black/20 text-[9px] text-slate-300 hover:border-lime-300/25" onClick={() => { setSelected(item); setModal("movement"); }}><ArrowDownToLine className="size-3" />Movimento</Button>}</div><div className="mt-4 grid grid-cols-3 gap-2"><div><p className="text-[8px] uppercase tracking-[.12em] text-slate-600">Fisico</p><p className="mt-1 font-mono text-sm text-slate-200">{item.onHand} {item.unit}</p></div><div><p className="text-[8px] uppercase tracking-[.12em] text-slate-600">Riservato</p><p className="mt-1 font-mono text-sm text-cyan-100">{item.reserved} {item.unit}</p></div><div><p className="text-[8px] uppercase tracking-[.12em] text-slate-600">Disponibile</p><p className="mt-1 font-mono text-sm text-lime-100">{item.available} {item.unit}</p></div></div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/60"><div className={`h-full rounded-full ${item.belowMinimum ? "bg-amber-300" : "bg-gradient-to-r from-lime-400 to-lime-200"}`} style={{ width: `${width}%` }} /></div><p className="mt-2 text-[9px] text-slate-600">Scorta minima: {item.minStock} {item.unit}</p></div>; })}{payload.items.length === 0 && <div className="rounded-2xl border border-dashed border-white/[0.1] px-5 py-12 text-center"><Boxes className="mx-auto size-7 text-slate-700" /><p className="mt-3 text-xs text-slate-500">Nessun materiale registrato.</p></div>}</div></article>

        <aside className="carbon-card rounded-[24px] p-5"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl border border-cyan-300/20 bg-cyan-300/[0.07] text-cyan-200"><History className="size-4" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200/65">IMMUTABLE LEDGER</p><h2 className="mt-1 text-sm font-semibold">Ultimi movimenti</h2></div></div><div className="mt-5 space-y-2">{payload.movements.slice(0, 14).map((movement) => { const item = payload.items.find((candidate) => candidate.id === movement.itemId); return <div className="rounded-xl border border-white/[0.07] bg-black/25 p-3" key={movement.id}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-[10px] font-medium text-slate-200">{item?.name ?? movement.itemId}</p><p className="mt-1 font-mono text-[8px] text-slate-600">{new Date(movement.createdAt).toLocaleString("it-IT")}</p></div><span className="rounded-full border border-lime-300/18 bg-lime-300/[0.055] px-2 py-1 text-[7px] font-semibold text-lime-100">{movement.movementType}</span></div><p className="mt-2 font-mono text-[9px] text-cyan-100">{movement.quantity} {item?.unit ?? ""} · {movement.before.onHand} → {movement.after.onHand}</p>{movement.jobId && <p className="mt-1 truncate text-[8px] text-slate-600">COMMESSA {movement.jobId}</p>}</div>; })}{payload.movements.length === 0 && <p className="text-[10px] text-slate-600">Nessun movimento nel ledger.</p>}</div></aside></section>
    </div>

    <Dialog open={modal !== null} onOpenChange={(open) => !open && setModal(null)}><DialogContent className="border-lime-300/20 bg-[#080c09] text-slate-100 sm:max-w-[580px]"><DialogHeader><DialogTitle>{modal === "register" ? "Registra materiale" : `Movimento · ${selected?.name ?? "materiale"}`}</DialogTitle><DialogDescription className="text-slate-500">Quantità in millesimi, controllo versione e ledger append-only.</DialogDescription></DialogHeader><form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>{modal === "register" ? <><label className="text-xs text-slate-400 sm:col-span-2">Descrizione<Input className="mt-2 border-white/10 bg-black/30" name="name" required /></label><label className="text-xs text-slate-400">SKU opzionale<Input className="mt-2 border-white/10 bg-black/30" name="sku" placeholder="Generato dal server" /></label><label className="text-xs text-slate-400">Unità<Input className="mt-2 border-white/10 bg-black/30" name="unit" placeholder="pz, m, kg…" required /></label><label className="text-xs text-slate-400">Ubicazione<Input className="mt-2 border-white/10 bg-black/30" name="location" defaultValue="MAGAZZINO" /></label><label className="text-xs text-slate-400">Giacenza iniziale<Input className="mt-2 border-white/10 bg-black/30" min="0" name="openingQuantity" step="0.001" type="number" defaultValue="0" required /></label><label className="text-xs text-slate-400">Scorta minima<Input className="mt-2 border-white/10 bg-black/30" min="0" name="minStock" step="0.001" type="number" defaultValue="0" required /></label><label className="text-xs text-slate-400 sm:col-span-2">Nota<Textarea className="mt-2 border-white/10 bg-black/30" name="note" /></label></> : <><label className="text-xs text-slate-400 sm:col-span-2">Tipo<select className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm" name="action" defaultValue="receive"><option value="receive">Carico / ricezione</option><option value="reserve">Prenota per commessa</option><option value="release">Rilascia prenotazione</option><option value="pick">Prelievo fisico</option><option value="consume">Consumo su commessa</option><option value="return">Reso da commessa</option><option value="adjust">Rettifica inventariale (+/-)</option></select></label><label className="text-xs text-slate-400">Quantità<Input className="mt-2 border-white/10 bg-black/30" name="quantity" step="0.001" type="number" required /></label><label className="text-xs text-slate-400">Commessa<Input className="mt-2 border-white/10 bg-black/30" name="jobId" placeholder="ID o codice, se richiesto" /></label><label className="text-xs text-slate-400 sm:col-span-2">Nota<Textarea className="mt-2 border-white/10 bg-black/30" name="note" required /></label></>}<DialogFooter className="sm:col-span-2"><DialogClose asChild><Button variant="outline" type="button" className="border-white/10 bg-transparent text-slate-400">Annulla</Button></DialogClose><Button disabled={busy} type="submit" className="bg-lime-300 text-[#050705] hover:bg-lime-200">{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}Salva e rileggi</Button></DialogFooter></form></DialogContent></Dialog>
    {notice && <button className="fixed bottom-5 right-5 z-50 max-w-[370px] rounded-xl border border-lime-300/25 bg-[#080d09]/95 px-4 py-3 text-left text-xs text-lime-100 shadow-[0_0_30px_rgba(190,255,60,0.14)]" onClick={() => setNotice("")} type="button"><CheckCircle2 className="mr-2 inline size-4 text-lime-300" />{notice}</button>}
  </main>;
}
