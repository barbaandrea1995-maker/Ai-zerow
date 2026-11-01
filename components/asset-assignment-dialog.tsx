"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { CalendarClock, Check, LoaderCircle, Package, Send, ShieldCheck, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { assetAssignmentCustodyEnd, assetAssignmentStatus } from "@/lib/asset-contract";
import { idempotentJsonMutation } from "@/lib/client-request-idempotency";

type AssignmentKind = "SHORT_TERM" | "LONG_TERM";

type AssetRecord = {
  id: string;
  canonicalCode?: string;
  title: string;
  detail?: string;
  status?: string;
  payload?: Record<string, unknown>;
  lifecycle?: { status?: string } | null;
};

type ExistingAssignment = {
  id: string;
  assetId: string;
  assetCode?: string | null;
  assetTitle?: string | null;
  kind?: string;
  status?: string;
  startsAt?: string | null;
  endsAt?: string | null;
  assignee?: { name?: string | null };
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
  assets: AssetRecord[];
  initialAsset: AssetRecord | null;
  assignments: ExistingAssignment[];
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

function lifecycleStatus(asset: AssetRecord) {
  const value = asset.lifecycle?.status ?? asset.payload?.lifecycleStatus ?? asset.status;
  return typeof value === "string" && value.trim() ? value.trim().toUpperCase() : "AVAILABLE";
}

function payloadText(asset: AssetRecord, key: string) {
  const value = asset.payload?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function assetIdentity(asset: AssetRecord) {
  const code = asset.canonicalCode?.trim() || asset.id;
  const description = payloadText(asset, "description") || payloadText(asset, "title") || asset.detail?.trim() || (asset.title !== code ? asset.title : "");
  const brand = payloadText(asset, "brand");
  const model = payloadText(asset, "model");
  const registration = payloadText(asset, "registration");
  const serialNumber = payloadText(asset, "serialNumber");
  const location = payloadText(asset, "location");
  const type = entityType(asset) === "VEHICLE" ? "Mezzo" : payloadText(asset, "entityType").toUpperCase() === "EQUIPMENT" ? "Attrezzatura" : "Asset operativo";
  const technical = [brand && model ? `${brand} ${model}` : brand || model, registration && `Targa ${registration}`, serialNumber && `Matricola ${serialNumber}`, location && `Sede ${location}`]
    .filter((value): value is string => Boolean(value))
    .filter((value, index, values) => values.indexOf(value) === index);
  return { code, description: description || "Descrizione non indicata", technical: technical.length ? technical.join(" · ") : type };
}

function assignmentStatus(assignment: ExistingAssignment) {
  return typeof assignment.status === "string" ? assignment.status.toUpperCase() : "";
}

function assignmentConflict(assetId: string, assignments: ExistingAssignment[], startsAt: string, endsAt: string, kind: AssignmentKind) {
  const requestedStart = Date.parse(startsAt);
  const requestedEnd = kind === "LONG_TERM" ? Number.POSITIVE_INFINITY : Date.parse(endsAt);
  if (!Number.isFinite(requestedStart) || (kind === "SHORT_TERM" && !Number.isFinite(requestedEnd))) return null;
  return assignments.find((assignment) => {
    if (assignment.assetId !== assetId || ["RETURNED", "CANCELLED"].includes(assignmentStatus(assignment))) return false;
    const existingStart = Date.parse(assignment.startsAt ?? "");
    if (!Number.isFinite(existingStart)) return ["ACTIVE", "SCHEDULED"].includes(assignmentStatus(assignment));
    const status = assetAssignmentStatus(assignment.status, assignment.startsAt);
    const custodyEnd = assetAssignmentCustodyEnd(status, assignment.kind, assignment.startsAt, assignment.endsAt);
    const parsedExistingEnd = custodyEnd ? Date.parse(custodyEnd) : Number.POSITIVE_INFINITY;
    const existingEnd = Number.isFinite(parsedExistingEnd) ? parsedExistingEnd : Number.POSITIVE_INFINITY;
    return requestedStart < existingEnd && existingStart < requestedEnd;
  }) ?? null;
}

function assignmentReason(assignment: ExistingAssignment | null) {
  if (!assignment) return "";
  const assignee = assignment.assignee?.name?.trim() || "una risorsa del tenant";
  const until = assignmentStatus(assignment) === "ACTIVE" || assignment.kind?.toUpperCase() === "LONG_TERM" || !assignment.endsAt
    ? "fino al rientro"
    : `rientro previsto ${new Date(assignment.endsAt).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}`;
  return `Affidato a ${assignee} · ${until}`;
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
    asset_assignment_conflict: "Uno degli asset è già assegnato o impegnato nella finestra indicata: scegli una risorsa libera.",
    assignee_not_found_or_inactive: "La persona selezionata non è più attiva nel tenant.",
    vehicle_assignee_driver_capability_required: "Per un mezzo devi selezionare una persona con mansione Autista.",
    asset_assignee_operator_capability_required: "Per questo asset devi selezionare una persona con mansione Operatore.",
    asset_not_assignable: "L’asset non è disponibile: controlla manutenzione o blocco operativo.",
    assignment_window_invalid: "La fine deve essere successiva all’inizio.",
    short_term_end_required: "Per un’assegnazione breve indica quando termina.",
  };
  return errors[error] ?? "Assegnazione non completata: verifica i dati e riprova.";
}

export function AssetAssignmentDialog({ assets, initialAsset, assignments, assignees, open, onOpenChange, onCreated, onNotice }: AssetAssignmentDialogProps) {
  const [kind, setKind] = useState<AssignmentKind>("SHORT_TERM");
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [assigneeMembershipId, setAssigneeMembershipId] = useState("");
  const [startsAt, setStartsAt] = useState(defaultStart);
  const [endsAt, setEndsAt] = useState(defaultEnd);
  const [purpose, setPurpose] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const selectableAssets = useMemo(() => [...assets]
    .filter((candidate) => lifecycleStatus(candidate) === "AVAILABLE" && !assignmentConflict(candidate.id, assignments, startsAt, endsAt, kind))
    .sort((left, right) => Number(right.id === initialAsset?.id) - Number(left.id === initialAsset?.id)), [assets, assignments, endsAt, initialAsset?.id, kind, startsAt]);
  const unavailableAssets = useMemo(() => [...assets]
    .filter((candidate) => lifecycleStatus(candidate) !== "AVAILABLE" || Boolean(assignmentConflict(candidate.id, assignments, startsAt, endsAt, kind)))
    .sort((left, right) => Number(right.id === initialAsset?.id) - Number(left.id === initialAsset?.id)), [assets, assignments, endsAt, initialAsset?.id, kind, startsAt]);
  const selectedAssets = useMemo(() => selectableAssets.filter((candidate) => selectedAssetIds.includes(candidate.id)), [selectableAssets, selectedAssetIds]);
  const selectedTypes = useMemo(() => new Set(selectedAssets.map(entityType)), [selectedAssets]);
  const initialAssetId = initialAsset?.id;
  const primaryType = entityType(initialAsset);
  const eligibleAssignees = useMemo(() => assignees.filter((assignee) => [...selectedTypes].every((type) => assignee.eligibleFor.includes(type))), [assignees, selectedTypes]);

  /* eslint-disable react-hooks/set-state-in-effect -- defaults follow the selected asset and dialog lifecycle. */
  useEffect(() => {
    if (!open) return;
    const nextStart = defaultStart();
    const nextEnd = defaultEnd();
    setKind("SHORT_TERM");
    setSelectedAssetIds(initialAssetId && initialAsset && lifecycleStatus(initialAsset) === "AVAILABLE" && !assignmentConflict(initialAssetId, assignments, nextStart, nextEnd, "SHORT_TERM") ? [initialAssetId] : []);
    setAssigneeMembershipId("");
    setStartsAt(nextStart);
    setEndsAt(nextEnd);
    setPurpose(primaryType === "VEHICLE" ? "Consegna mezzo" : "Consegna asset operativo");
    setNotes("");
    setError("");
  }, [assignments, initialAsset, initialAssetId, open, primaryType]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedAssets.length || !assigneeMembershipId) {
      setError(selectedAssets.length ? "Seleziona la persona che riceverà le risorse." : "Seleziona almeno un asset disponibile.");
      return;
    }
    if (!startsAt || (kind === "SHORT_TERM" && !endsAt)) {
      setError(kind === "SHORT_TERM" ? "Indica inizio e fine dell’assegnazione." : "Indica l’inizio dell’assegnazione.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await idempotentJsonMutation({
        url: "/api/assets/assignments",
        namespace: "asset-assignment",
        operation: "create",
        payload: {
          assetId: selectedAssets[0].id,
          assetIds: selectedAssets.map((asset) => asset.id),
          assigneeMembershipId,
          assignmentKind: kind,
          startsAt: toIso(startsAt),
          endsAt: kind === "SHORT_TERM" ? toIso(endsAt) : undefined,
          purpose: purpose.trim(),
          notes: notes.trim(),
        },
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "asset_assignment_write_failed");
      onCreated();
      onOpenChange(false);
      onNotice(selectedAssets.length > 1
        ? `${selectedAssets.length} asset assegnati alla stessa risorsa.`
        : kind === "SHORT_TERM" ? "Assegnazione breve registrata." : "Assegnazione continuativa registrata.");
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
              <DialogTitle className="text-xl tracking-[-.03em] text-slate-50">Assegna risorse</DialogTitle>
              <DialogDescription className="mt-1 text-slate-500">Seleziona uno o più asset disponibili e consegnali alla stessa persona per una finestra definita.</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="rounded-2xl border border-lime-300/15 bg-lime-300/[.035] p-4">
          <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-lime-200" /><p className="text-[11px] leading-5 text-slate-500">Il catalogo mostra solo asset disponibili e persone attive abilitate da Authority. Il server ricontrolla sovrapposizioni, disponibilità e capability per ogni asset prima di registrare la consegna.</p></div>
        </div>

        <div className="rounded-2xl border border-cyan-300/15 bg-cyan-300/[.025] p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-cyan-200/80">ASSET DA CONSEGNARE</p>
            <p className="mt-1 text-[11px] text-slate-500">Puoi associare più mezzi o attrezzature alla stessa risorsa. Gli asset già affidati o impegnati nella finestra scelta restano visibili ma non selezionabili.</p>
            </div>
            <span className="rounded-lg border border-cyan-300/20 bg-cyan-300/[.05] px-2.5 py-1.5 font-mono text-[10px] text-cyan-100">{selectedAssets.length} SELEZIONATI</span>
          </div>
          <div className="mt-3 grid max-h-56 gap-2 overflow-y-auto overscroll-contain pr-1">
            {selectableAssets.map((candidate) => {
              const selected = selectedAssetIds.includes(candidate.id);
              const identity = assetIdentity(candidate);
              return <button aria-pressed={selected} className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${selected ? "border-lime-300/45 bg-lime-300/[.08]" : "border-white/10 bg-black/20 hover:border-cyan-300/30"}`} key={candidate.id} onClick={() => { setSelectedAssetIds((current) => current.includes(candidate.id) ? current.filter((id) => id !== candidate.id) : [...current, candidate.id]); setAssigneeMembershipId(""); setError(""); }} type="button"><span className={`grid size-8 shrink-0 place-items-center rounded-lg border ${selected ? "border-lime-300/35 bg-lime-300/15 text-lime-100" : "border-white/10 bg-white/[.03] text-slate-500"}`}>{selected ? <Check className="size-4" /> : <Package className="size-4" />}</span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-slate-100">{identity.code}</span><span className="mt-1 block truncate text-[11px] text-slate-200">{identity.description}</span><span className="mt-1 block truncate text-[10px] text-slate-500">{identity.technical}</span></span><span className="text-[9px] uppercase tracking-[.12em] text-lime-200/70">Disponibile</span></button>;
            })}
            {unavailableAssets.map((candidate) => {
              const identity = assetIdentity(candidate);
              const conflict = assignmentConflict(candidate.id, assignments, startsAt, endsAt, kind);
              const lifecycle = lifecycleStatus(candidate);
              const reason = lifecycle !== "AVAILABLE" ? `Stato: ${lifecycle.replaceAll("_", " ").toLowerCase()}` : assignmentReason(conflict);
              return <div aria-disabled="true" className="flex w-full items-center gap-3 rounded-xl border border-amber-300/15 bg-amber-300/[.025] p-3 opacity-80" key={candidate.id}><span className="grid size-8 shrink-0 place-items-center rounded-lg border border-amber-300/20 bg-amber-300/[.06] text-amber-100/70"><Package className="size-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-slate-200">{identity.code}</span><span className="mt-1 block truncate text-[11px] text-slate-300">{identity.description}</span><span className="mt-1 block truncate text-[10px] text-slate-500">{identity.technical}</span><span className="mt-1 block truncate text-[10px] text-amber-100/80">{reason || "Non disponibile per questa finestra"}</span></span><span className="shrink-0 text-[9px] uppercase tracking-[.12em] text-amber-100/70">Non disponibile</span></div>;
            })}
            {selectableAssets.length === 0 && unavailableAssets.length === 0 && <p className="rounded-xl border border-dashed border-amber-300/20 p-4 text-center text-[10px] text-amber-100/80">Nessun asset registrato nel catalogo.</p>}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-2"><span className="text-xs text-slate-400">Durata</span><select aria-label="Durata assegnazione" className="h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-slate-100 outline-none focus:border-lime-300/50 focus:ring-2 focus:ring-lime-300/10" value={kind} onChange={(event) => setKind(event.target.value as AssignmentKind)}><option className="bg-[#090d0a]" value="SHORT_TERM">Breve · con rientro</option><option className="bg-[#090d0a]" value="LONG_TERM">Lunga · fino a rientro</option></select></label>
          <label className="block space-y-2"><span className="text-xs text-slate-400">Persona autorizzata per tutti gli asset</span><select aria-label="Persona autorizzata" className="h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-slate-100 outline-none focus:border-lime-300/50 focus:ring-2 focus:ring-lime-300/10" value={assigneeMembershipId} onChange={(event) => setAssigneeMembershipId(event.target.value)}><option className="bg-[#090d0a]" value="">Seleziona dal catalogo Authority</option>{eligibleAssignees.map((assignee) => <option className="bg-[#090d0a]" key={assignee.membershipId} value={assignee.membershipId}>{assignee.name} · {assignee.roleLabels.join(" · ")}</option>)}</select>{selectedAssets.length > 0 && eligibleAssignees.length === 0 && <span className="block text-[10px] text-amber-200/80">Nessuna persona compatibile con tutti gli asset selezionati.</span>}</label>
          <label className="block space-y-2"><span className="text-xs text-slate-400">Inizio</span><span className="relative block"><CalendarClock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-600" /><Input aria-label="Inizio assegnazione" className="h-11 border-white/10 bg-black/30 pl-10 text-sm text-slate-100" onChange={(event) => setStartsAt(event.target.value)} type="datetime-local" value={startsAt} /></span></label>
          <label className={`block space-y-2 ${kind === "LONG_TERM" ? "sm:col-span-1" : ""}`}><span className="text-xs text-slate-400">Fine {kind === "LONG_TERM" && <span className="text-slate-600">(fino al rientro)</span>}</span><span className="relative block"><CalendarClock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-600" /><Input aria-label="Fine assegnazione" className="h-11 border-white/10 bg-black/30 pl-10 text-sm text-slate-100 disabled:opacity-45" disabled={kind === "LONG_TERM"} onChange={(event) => setEndsAt(event.target.value)} type="datetime-local" value={kind === "LONG_TERM" ? "" : endsAt} /></span></label>
        </div>
        <label className="block space-y-2"><span className="text-xs text-slate-400">Motivo operativo <span className="text-slate-600">(opzionale)</span></span><Input className="h-11 border-white/10 bg-black/30 text-sm text-slate-100" onChange={(event) => setPurpose(event.target.value)} placeholder={primaryType === "VEHICLE" ? "Es. consegna mezzo alla squadra Nord" : "Es. attrezzatura per intervento"} value={purpose} /></label>
        <label className="block space-y-2"><span className="text-xs text-slate-400">Nota di consegna <span className="text-slate-600">(opzionale)</span></span><Textarea className="min-h-24 border-white/10 bg-black/30 text-sm text-slate-100" onChange={(event) => setNotes(event.target.value)} placeholder="Condizioni, dotazioni o indicazioni per il rientro" value={notes} /></label>
        {error && <p className="rounded-xl border border-rose-300/20 bg-rose-300/[.05] px-3 py-2.5 text-xs text-rose-100">{error}</p>}
        <DialogFooter className="gap-2 sm:justify-between"><DialogClose asChild><Button type="button" variant="outline" className="border-white/10 bg-transparent text-slate-400 hover:border-white/20 hover:bg-white/[.04]"><X className="size-3.5" />Annulla</Button></DialogClose><Button type="submit" disabled={saving || selectedAssets.length === 0 || eligibleAssignees.length === 0} className="bg-lime-300 text-[#060806] shadow-[0_0_22px_rgba(200,255,34,.14)] hover:bg-lime-200">{saving ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}{saving ? "Salvataggio…" : "Conferma assegnazione"}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
