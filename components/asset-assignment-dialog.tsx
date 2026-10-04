"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { CalendarClock, LoaderCircle, Send, ShieldCheck, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type AssignmentKind = "SHORT_TERM" | "LONG_TERM";

type AssetRecord = {
  id: string;
  canonicalCode?: string;
  title: string;
  payload?: Record<string, unknown>;
};

type Assignee = {
  membershipId: string;
  actorId: string;
  name: string;
  email: string;
  roles: string[];
  roleLabels: string[];
  eligibleFor: string[];
};

type AssetAssignmentDialogProps = {
  asset: AssetRecord | null;
  assignees: Assignee[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  onNotice: (message: string) => void;
};

function entityType(asset: AssetRecord | null) {
  const value = typeof asset?.payload?.entityType === "string" ? asset.payload.entityType.toUpperCase() : "ASSET";
  return value === "VEHICLE" ? "VEHICLE" : "ASSET";
}

function localInputValue(date: Date) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

function toIso(value: string) {
  return new Date(value).toISOString();
}

function defaultStart() {
  const value = new Date(Date.now() + 15 * 60_000);
  value.setSeconds(0, 0);
  return localInputValue(value);
}

function defaultEnd() {
  const value = new Date(Date.now() + 4 * 60 * 60_000);
  value.setSeconds(0, 0);
  return localInputValue(value);
}

function friendlyError(error: string) {
  const errors: Record<string, string> = {
    asset_assignment_conflict: "La risorsa o la persona è già impegnata nella finestra indicata.",
    assignee_not_found_or_inactive: "La persona selezionata non è più attiva nel tenant.",
    vehicle_assignee_driver_capability_required: "Per un mezzo devi selezionare una persona con mansione Autista.",
    asset_assignee_operator_capability_required: "Per questo asset devi selezionare una persona con mansione Operatore.",
    asset_not_assignable: "L’asset non è disponibile: controlla manutenzione o blocco operativo.",
    assignment_window_invalid: "La fine deve essere successiva all’inizio.",
    short_term_end_required: "Per un’assegnazione breve indica quando termina.",
  };
  return errors[error] ?? "Assegnazione non completata: verifica i dati e riprova.";
}

export function AssetAssignmentDialog({ asset, assignees, open, onOpenChange, onCreated, onNotice }: AssetAssignmentDialogProps) {
  const [kind, setKind] = useState<AssignmentKind>("SHORT_TERM");
  const [assigneeMembershipId, setAssigneeMembershipId] = useState("");
  const [startsAt, setStartsAt] = useState(defaultStart);
  const [endsAt, setEndsAt] = useState(defaultEnd);
  const [purpose, setPurpose] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const type = entityType(asset);
  const eligibleAssignees = useMemo(() => assignees.filter((assignee) => assignee.eligibleFor.includes(type)), [assignees, type]);

  /* eslint-disable react-hooks/set-state-in-effect -- defaults follow the selected asset and dialog lifecycle. */
  useEffect(() => {
    if (!open) return;
    setKind("SHORT_TERM");
    setAssigneeMembershipId("");
    setStartsAt(defaultStart());
    setEndsAt(defaultEnd());
    setPurpose(type === "VEHICLE" ? "Consegna mezzo" : "Consegna asset operativo");
    setNotes("");
    setError("");
  }, [asset?.id, open, type]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!asset || !assigneeMembershipId) {
      setError("Seleziona la persona che riceverà la risorsa.");
      return;
    }
    if (!startsAt || (kind === "SHORT_TERM" && !endsAt)) {
      setError(kind === "SHORT_TERM" ? "Indica inizio e fine dell’assegnazione." : "Indica l’inizio dell’assegnazione.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/assets/assignments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          assetId: asset.id,
          assigneeMembershipId,
          assignmentKind: kind,
          startsAt: toIso(startsAt),
          endsAt: kind === "SHORT_TERM" ? toIso(endsAt) : undefined,
          purpose: purpose.trim(),
          notes: notes.trim(),
          idempotencyKey: `asset-assignment-${crypto.randomUUID()}`,
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "asset_assignment_write_failed");
      onCreated();
      onOpenChange(false);
      onNotice(kind === "SHORT_TERM" ? "Assegnazione breve registrata." : "Assegnazione continuativa registrata.");
    } catch (caught) {
      setError(friendlyError(caught instanceof Error ? caught.message : "asset_assignment_write_failed"));
    } finally {
      setSaving(false);
    }
  };

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto border-lime-300/20 bg-[#090d0a] text-slate-100 shadow-[0_0_80px_rgba(0,0,0,.65)] sm:max-w-[680px]">
      <form className="space-y-5" onSubmit={handleSubmit}>
        <DialogHeader>
          <div className="flex items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl border border-lime-300/25 bg-lime-300/10 text-lime-200 shadow-[0_0_24px_rgba(200,255,34,.1)]"><UserRound className="size-5" /></span>
            <div>
              <DialogTitle className="text-xl tracking-[-.03em] text-slate-50">Assegna risorsa</DialogTitle>
              <DialogDescription className="mt-1 text-slate-500">Consegna {asset?.canonicalCode ?? asset?.title ?? "la risorsa"} alla persona giusta, per una finestra definita.</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="rounded-2xl border border-lime-300/15 bg-lime-300/[.035] p-4">
          <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-lime-200" /><p className="text-[11px] leading-5 text-slate-500">Il catalogo mostra solo persone attive e abilitate da Authority. Per un mezzo compare soltanto chi ha la mansione Autista; per un asset compare chi può operare sul campo.</p></div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-2"><span className="text-xs text-slate-400">Durata</span><select aria-label="Durata assegnazione" className="h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-slate-100 outline-none focus:border-lime-300/50 focus:ring-2 focus:ring-lime-300/10" value={kind} onChange={(event) => setKind(event.target.value as AssignmentKind)}><option className="bg-[#090d0a]" value="SHORT_TERM">Breve · con rientro</option><option className="bg-[#090d0a]" value="LONG_TERM">Lunga · fino a rientro</option></select></label>
          <label className="block space-y-2"><span className="text-xs text-slate-400">Persona autorizzata</span><select aria-label="Persona autorizzata" className="h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-slate-100 outline-none focus:border-lime-300/50 focus:ring-2 focus:ring-lime-300/10" value={assigneeMembershipId} onChange={(event) => setAssigneeMembershipId(event.target.value)}><option className="bg-[#090d0a]" value="">Seleziona dal catalogo Authority</option>{eligibleAssignees.map((assignee) => <option className="bg-[#090d0a]" key={assignee.membershipId} value={assignee.membershipId}>{assignee.name} · {assignee.roleLabels.join(" · ")}</option>)}</select>{eligibleAssignees.length === 0 && <span className="block text-[10px] text-amber-200/80">Nessuna persona compatibile nel tenant.</span>}</label>
          <label className="block space-y-2"><span className="text-xs text-slate-400">Inizio</span><span className="relative block"><CalendarClock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-600" /><Input aria-label="Inizio assegnazione" className="h-11 border-white/10 bg-black/30 pl-10 text-sm text-slate-100" onChange={(event) => setStartsAt(event.target.value)} type="datetime-local" value={startsAt} /></span></label>
          <label className={`block space-y-2 ${kind === "LONG_TERM" ? "sm:col-span-1" : ""}`}><span className="text-xs text-slate-400">Fine {kind === "LONG_TERM" && <span className="text-slate-600">(fino al rientro)</span>}</span><span className="relative block"><CalendarClock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-600" /><Input aria-label="Fine assegnazione" className="h-11 border-white/10 bg-black/30 pl-10 text-sm text-slate-100 disabled:opacity-45" disabled={kind === "LONG_TERM"} onChange={(event) => setEndsAt(event.target.value)} type="datetime-local" value={kind === "LONG_TERM" ? "" : endsAt} /></span></label>
        </div>
        <label className="block space-y-2"><span className="text-xs text-slate-400">Motivo operativo <span className="text-slate-600">(opzionale)</span></span><Input className="h-11 border-white/10 bg-black/30 text-sm text-slate-100" onChange={(event) => setPurpose(event.target.value)} placeholder={type === "VEHICLE" ? "Es. consegna mezzo alla squadra Nord" : "Es. attrezzatura per intervento"} value={purpose} /></label>
        <label className="block space-y-2"><span className="text-xs text-slate-400">Nota di consegna <span className="text-slate-600">(opzionale)</span></span><Textarea className="min-h-24 border-white/10 bg-black/30 text-sm text-slate-100" onChange={(event) => setNotes(event.target.value)} placeholder="Condizioni, dotazioni o indicazioni per il rientro" value={notes} /></label>
        {error && <p className="rounded-xl border border-rose-300/20 bg-rose-300/[.05] px-3 py-2.5 text-xs text-rose-100">{error}</p>}
        <DialogFooter className="gap-2 sm:justify-between"><DialogClose asChild><Button type="button" variant="outline" className="border-white/10 bg-transparent text-slate-400 hover:border-white/20 hover:bg-white/[.04]"><X className="size-3.5" />Annulla</Button></DialogClose><Button type="submit" disabled={saving || eligibleAssignees.length === 0} className="bg-lime-300 text-[#060806] shadow-[0_0_22px_rgba(200,255,34,.14)] hover:bg-lime-200">{saving ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}{saving ? "Salvataggio…" : "Conferma assegnazione"}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
