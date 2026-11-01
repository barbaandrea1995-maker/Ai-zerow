"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, LoaderCircle, RefreshCw, ShieldCheck, Warehouse } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AuthorityMembershipView } from "@/components/authority-membership-control";
import { idempotentJsonMutation } from "@/lib/client-request-idempotency";

type WarehouseChoice = {
  id: string;
  code: string;
  name: string;
  locationLabel: string;
  geofenceRadiusMeters?: number | null;
};

type WarehouseAssignment = {
  id: string;
  membershipId: string;
  displayName: string;
  roles: string[];
  warehouseIds: string[];
  status: string;
  version: number;
};

type AssignmentPayload = {
  assignments?: WarehouseAssignment[];
  warehouses?: WarehouseChoice[];
  readback?: { status?: string; checkedAt?: string };
  error?: string;
};

function errorLabel(error?: string) {
  if (error === "warehouse_role_required") return "La persona deve avere la mansione Responsabile magazzino o Magazziniere.";
  if (error === "warehouse_not_active") return "Uno dei magazzini selezionati non è più attivo. Rileggi l’elenco.";
  if (error === "version_conflict") return "L’assegnazione è cambiata in Authority. Rileggi e riprova.";
  if (error === "membership_not_active") return "La membership non è più attiva.";
  return "Perimetro magazzino non aggiornato.";
}

function rolesFor(membership: AuthorityMembershipView) {
  return membership.roles ?? [membership.role];
}

function isWarehouseMember(membership: AuthorityMembershipView) {
  return membership.status === "active" && rolesFor(membership).some((role) => role === "warehouse_manager" || role === "warehouse_operator");
}

export default function WarehouseAssignmentControl({
  canManage,
  memberships,
  onNotify,
}: {
  canManage: boolean;
  memberships: AuthorityMembershipView[];
  onNotify: (message: string) => void;
}) {
  const [payload, setPayload] = useState<AssignmentPayload | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingId, setSavingId] = useState("");

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/authority/warehouse-assignments", { cache: "no-store" });
      const next = await response.json() as AssignmentPayload;
      if (!response.ok) throw new Error(next.error ?? "warehouse_assignment_readback_unavailable");
      setPayload(next);
      setDrafts(Object.fromEntries((next.assignments ?? []).map((assignment) => [assignment.membershipId, assignment.warehouseIds])));
      setLoading(false);
    } catch (error) {
      setLoading(false);
      onNotify(errorLabel(error instanceof Error ? error.message : undefined));
    } finally {
      setRefreshing(false);
    }
  }, [onNotify]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const eligibleMembers = useMemo(() => memberships.filter(isWarehouseMember), [memberships]);
  const warehouses = payload?.warehouses ?? [];
  const assignments = payload?.assignments ?? [];

  function selectedIds(membershipId: string) {
    return drafts[membershipId] ?? assignments.find((assignment) => assignment.membershipId === membershipId)?.warehouseIds ?? [];
  }

  function toggleWarehouse(membershipId: string, warehouseId: string) {
    if (!canManage) return;
    const current = selectedIds(membershipId);
    setDrafts((draft) => ({
      ...draft,
      [membershipId]: current.includes(warehouseId) ? current.filter((id) => id !== warehouseId) : [...current, warehouseId],
    }));
  }

  async function save(membership: AuthorityMembershipView) {
    if (!canManage) return;
    const current = assignments.find((assignment) => assignment.membershipId === membership.id);
    setSavingId(membership.id);
    try {
      const response = await idempotentJsonMutation({
        url: "/api/authority/warehouse-assignments",
        namespace: "warehouse-scope",
        operation: membership.id,
        payload: { membershipId: membership.id, warehouseIds: selectedIds(membership.id), expectedVersion: current?.version ?? null },
      });
      const next = await response.json() as AssignmentPayload & { assignment?: WarehouseAssignment };
      if (!response.ok) {
        onNotify(errorLabel(next.error));
        return;
      }
      onNotify(selectedIds(membership.id).length ? `Perimetro magazzino aggiornato per ${membership.displayName}.` : `Perimetro magazzino rimosso per ${membership.displayName}.`);
      await refresh();
    } catch {
      onNotify("Servizio Authority temporaneamente non disponibile.");
    } finally {
      setSavingId("");
    }
  }

  return <section className="carbon-card rounded-[24px] p-4 sm:p-5" aria-labelledby="warehouse-assignment-title">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        <span className="grid size-10 place-items-center rounded-2xl border border-cyan-300/25 bg-cyan-300/10 text-cyan-200"><Warehouse className="size-4" /></span>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-cyan-200/70">AUTHORITY / PERIMETRI OPERATIVI</p>
          <h2 className="mt-1 text-[16px] font-semibold text-slate-100" id="warehouse-assignment-title">Magazzini assegnati</h2>
          <p className="mt-1 max-w-2xl text-[11px] leading-5 text-slate-500">Associa uno o più luoghi canonici alle persone con mansione di magazzino. Presenze e registro scorte useranno soltanto questo perimetro server-side.</p>
        </div>
      </div>
      <Button aria-label="Rileggi assegnazioni magazzino" className="h-9 border border-white/10 bg-black/25 text-xs text-slate-300 hover:border-cyan-300/30 hover:bg-cyan-300/[.06]" onClick={() => void refresh()} type="button" variant="outline"><RefreshCw className={refreshing ? "size-3.5 animate-spin" : "size-3.5"} />Rileggi</Button>
    </div>

    {loading ? <div className="mt-5 flex items-center gap-2 rounded-xl border border-white/[.08] bg-black/20 p-4 text-xs text-slate-500"><LoaderCircle className="size-4 animate-spin text-cyan-200" />Readback perimetri Authority…</div> : eligibleMembers.length === 0 ? <div className="mt-5 rounded-2xl border border-dashed border-cyan-300/15 bg-cyan-300/[.025] p-6 text-center"><ShieldCheck className="mx-auto size-7 text-slate-600" /><p className="mt-3 text-sm font-semibold text-slate-300">Nessun profilo magazzino attivo</p><p className="mt-1 text-[11px] text-slate-600">Assegna prima la mansione Responsabile magazzino o Magazziniere nella scheda Authority.</p></div> : warehouses.length === 0 ? <div className="mt-5 rounded-2xl border border-dashed border-amber-300/20 bg-amber-300/[.025] p-6 text-center"><Warehouse className="mx-auto size-7 text-amber-200/70" /><p className="mt-3 text-sm font-semibold text-slate-300">Configura almeno un magazzino</p><p className="mt-1 text-[11px] text-slate-600">Il perimetro non può essere assegnato finché non esiste un luogo canonico con geofence.</p></div> : <div className="mt-5 grid gap-3 lg:grid-cols-2">{eligibleMembers.map((membership) => {
      const ids = selectedIds(membership.id);
      const current = assignments.find((assignment) => assignment.membershipId === membership.id);
      const dirty = JSON.stringify(ids) !== JSON.stringify(current?.warehouseIds ?? []);
      return <article className="rounded-2xl border border-white/[.08] bg-black/20 p-4" key={membership.id}>
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-100">{membership.displayName}</p><p className="mt-1 truncate text-[10px] text-slate-500">{membership.actorEmail}</p></div><span className="rounded-full border border-cyan-300/20 bg-cyan-300/[.05] px-2 py-1 text-[9px] uppercase tracking-[.08em] text-cyan-100">{rolesFor(membership).filter((role) => role === "warehouse_manager" || role === "warehouse_operator").map((role) => role === "warehouse_manager" ? "responsabile" : "magazziniere").join(" + ")}</span></div>
        <div className="mt-4 space-y-2">{warehouses.map((warehouse) => {
          const selected = ids.includes(warehouse.id);
          return <button aria-pressed={selected} className={`flex min-h-12 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition ${selected ? "border-lime-300/35 bg-lime-300/[.08]" : "border-white/[.08] bg-black/20 hover:border-cyan-300/25"}`} disabled={!canManage} key={warehouse.id} onClick={() => toggleWarehouse(membership.id, warehouse.id)} type="button"><span className={`grid size-6 shrink-0 place-items-center rounded-lg border ${selected ? "border-lime-300/50 bg-lime-300 text-[#050705]" : "border-white/15 text-transparent"}`}><Check className="size-3.5" /></span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-slate-200">{warehouse.name}</span><span className="mt-0.5 block truncate text-[10px] text-slate-600">{warehouse.code} · {warehouse.locationLabel}</span></span><span className="font-mono text-[9px] text-slate-600">{warehouse.geofenceRadiusMeters ?? "—"} m</span></button>;
        })}</div>
        <div className="mt-4 flex items-center justify-between gap-3"><span className="text-[10px] text-slate-600">{ids.length ? `${ids.length} ${ids.length === 1 ? "luogo autorizzato" : "luoghi autorizzati"}` : "Nessun magazzino assegnato"}</span><Button className="h-9 bg-lime-300 px-3 text-[10px] font-semibold text-[#050705] hover:bg-lime-200 disabled:opacity-40" disabled={!canManage || !dirty || savingId === membership.id} onClick={() => void save(membership)} type="button">{savingId === membership.id ? <LoaderCircle className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}Salva perimetro</Button></div>
      </article>;
    })}</div>}

    <div className="mt-4 flex items-start gap-2 rounded-xl border border-cyan-300/15 bg-cyan-300/[.035] p-3 text-[10px] leading-5 text-cyan-100/70"><ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-cyan-200" />Una persona può mantenere più mansioni: questa scheda aggiunge soltanto il perimetro dei magazzini. Non concede da sola accesso a commesse, missioni o dati di altri tenant.</div>
  </section>;
}
