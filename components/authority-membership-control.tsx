"use client";

import { useMemo, useState } from "react";
import {
  Check,
  Clipboard,
  KeyRound,
  Link2,
  LoaderCircle,
  LockKeyhole,
  MailPlus,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from "lucide-react";
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
import { AUTHORITY_ROLES, ROLE_METADATA, type AuthorityRole } from "@/lib/authority-catalog";

export type AuthorityMembershipView = {
  id: string;
  tenantId: string;
  identityProvider: string;
  actorId: string;
  actorEmail: string;
  displayName: string;
  role: string;
  roleLabel: string;
  roles?: AuthorityRole[];
  rolesLabel?: string[];
  status: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type AuthorityInvitationView = {
  id: string;
  tenantId: string;
  email: string;
  role: string;
  roleLabel: string;
  roles?: AuthorityRole[];
  rolesLabel?: string[];
  status: string;
  version: number;
  expiresAt: string;
  invitedBy: string;
  acceptedBy: string | null;
  acceptedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type DirectoryPayload = {
  memberships?: AuthorityMembershipView[];
  invitations?: AuthorityInvitationView[];
  invitation?: AuthorityInvitationView;
  inviteUrl?: string | null;
  error?: string;
  message?: string;
};

function lifecycleError(error: string | undefined) {
  if (error === "membership_already_exists") return "Esiste già una membership per questa email.";
  if (error === "pending_invitation_exists") return "Esiste già un invito attivo per questa email.";
  if (error === "only_owner_can_assign_owner") return "Solo un Owner può assegnare il ruolo Owner.";
  if (error === "last_active_owner_required") return "Il tenant deve conservare almeno un Owner attivo.";
  if (error === "self_suspend_not_allowed" || error === "self_remove_not_allowed") return "Non puoi sospendere o rimuovere la sessione con cui sei collegato.";
  if (error === "self_role_change_not_allowed") return "L’Owner resta obbligatorio sul tuo profilo; le altre mansioni vanno assegnate da Authority.";
  if (error === "version_conflict") return "La membership è cambiata: rileggi i dati e riprova.";
  if (error === "invitation_not_pending") return "L’invito non è più attivo.";
  return "Operazione Authority non completata.";
}

function initials(name: string, email: string) {
  const value = name.trim() || email;
  return value.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "U";
}

export default function AuthorityMembershipControl({
  canManage,
  currentActorId,
  currentActorRoles,
  invitations,
  memberships,
  onDirectoryChange,
  onNotify,
  onRefresh,
}: {
  canManage: boolean;
  currentActorId: string | null;
  currentActorRoles?: readonly string[];
  invitations: AuthorityInvitationView[];
  memberships: AuthorityMembershipView[];
  onDirectoryChange: (payload: DirectoryPayload) => void;
  onNotify: (message: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRoles, setInviteRoles] = useState<AuthorityRole[]>(["worker"]);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteUrl, setInviteUrl] = useState("");
  const [busyTarget, setBusyTarget] = useState("");
  const [roleDrafts, setRoleDrafts] = useState<Record<string, AuthorityRole[]>>({});
  const [removeTarget, setRemoveTarget] = useState<AuthorityMembershipView | null>(null);

  const activeMembers = useMemo(() => memberships.filter((membership) => membership.status === "active"), [memberships]);
  const pendingInvitations = useMemo(() => invitations.filter((invitation) => invitation.status === "pending"), [invitations]);
  const currentActorIsOwner = currentActorRoles?.includes("owner") ?? false;

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      onNotify("Link sicuro copiato negli appunti");
    } catch {
      onNotify("Copia automatica non disponibile: seleziona il link manualmente");
    }
  }

  async function createInvite() {
    if (!canManage || inviteEmail.trim().length < 5) return;
    setInviteBusy(true);
    setInviteUrl("");
    try {
      const response = await fetch("/api/authority/memberships", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: inviteEmail,
          role: inviteRoles[0],
          roles: inviteRoles,
          expiresInDays: 7,
          idempotencyKey: `authority-invite-${crypto.randomUUID()}`,
        }),
      });
      const payload = await response.json() as DirectoryPayload;
      if (!response.ok || !payload.invitation) {
        onNotify(lifecycleError(payload.error));
        return;
      }
      if (payload.inviteUrl) {
        setInviteUrl(payload.inviteUrl);
        onDirectoryChange({ invitations: [payload.invitation, ...invitations] });
        onNotify("Invito creato. Il link viene mostrato una sola volta");
      } else {
        onNotify(payload.message ?? "Invito già registrato");
      }
    } catch {
      onNotify("Servizio inviti temporaneamente non disponibile");
    } finally {
      setInviteBusy(false);
    }
  }

  async function mutateTarget({
    targetType = "membership",
    targetId,
    expectedVersion,
    action,
    role,
    roles,
  }: {
    targetType?: "membership" | "invitation";
    targetId: string;
    expectedVersion: number;
    action: string;
    role?: AuthorityRole;
    roles?: AuthorityRole[];
  }) {
    if (!canManage) return;
    setBusyTarget(targetId);
    try {
      const response = await fetch("/api/authority/memberships", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          targetType,
          targetId,
          expectedVersion,
          action,
          role,
          roles,
          idempotencyKey: `authority-${action}-${crypto.randomUUID()}`,
        }),
      });
      const payload = await response.json() as DirectoryPayload;
      if (!response.ok || !payload.memberships || !payload.invitations) {
        onNotify(lifecycleError(payload.error));
        return;
      }
      onDirectoryChange(payload);
      setRoleDrafts((current) => {
        const next = { ...current };
        delete next[targetId];
        return next;
      });
      setRemoveTarget(null);
      await onRefresh().catch(() => undefined);
      onNotify(action === "set_role" || action === "set_roles" ? "Mansioni aggiornate e rilette" : action === "revoke" ? "Invito revocato" : "Stato membership aggiornato");
    } catch {
      onNotify("Aggiornamento Authority non raggiungibile");
    } finally {
      setBusyTarget("");
    }
  }

  return (
    <section className="carbon-card carbon-card-neon mb-5 rounded-[24px] p-4 sm:p-5" aria-labelledby="membership-control-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="grid size-10 place-items-center rounded-2xl border border-lime-300/25 bg-lime-300/10 text-lime-200"><Users className="size-4" /></span>
          <div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/70">ONBOARDING / MEMBERSHIP LIFECYCLE</p><h2 className="mt-1 text-[16px] font-semibold text-slate-100" id="membership-control-title">Persone, inviti e accessi reali</h2><p className="mt-1 text-[11px] leading-5 text-slate-500">Token monouso, email Neon vincolata, optimistic version, sospensione immediata e audit D1. Il ruolo Autista abilita la risorsa missione dopo l’accettazione.</p>{currentActorIsOwner ? <p className="mt-2 text-[10px] text-lime-200/75">Puoi aggiungere Operatore e Autista al tuo profilo: Owner resta sempre attivo.</p> : null}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button className="h-9 border border-white/10 bg-black/25 text-xs text-slate-300 hover:border-lime-300/30 hover:bg-lime-300/[0.06]" onClick={() => void onRefresh()} type="button" variant="outline"><RefreshCw className="size-3.5" />Rileggi</Button>
          <Button className="h-9 bg-lime-300 text-xs font-semibold text-[#060806] hover:bg-lime-200 disabled:opacity-40" disabled={!canManage} onClick={() => { setInviteOpen(true); setInviteUrl(""); }} type="button"><MailPlus className="size-3.5" />Invita persona</Button>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {[
          ["ATTIVI", activeMembers.length, "membership verificate"],
          ["IN SOSPESO", memberships.filter((item) => item.status === "suspended").length, "accesso negato subito"],
          ["INVITI", pendingInvitations.length, "link ancora validi"],
        ].map(([label, value, detail]) => <div className="rounded-2xl border border-white/[0.08] bg-black/20 p-3.5" key={String(label)}><p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-600">{label}</p><p className="mt-2 font-mono text-2xl font-semibold text-lime-100">{value}</p><p className="mt-1 text-[10px] text-slate-600">{detail}</p></div>)}
      </div>

      <div className="mt-5 grid gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
        <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-black/15">
          <div className="grid grid-cols-[minmax(0,1fr)_130px_100px] gap-3 border-b border-white/[0.08] px-4 py-3 text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-600"><span>Identità</span><span>Ruolo</span><span>Stato</span></div>
          <div className="divide-y divide-white/[0.07]">
            {memberships.map((membership) => {
              const roleValue = roleDrafts[membership.id] ?? (membership.roles?.length ? membership.roles : (AUTHORITY_ROLES.includes(membership.role as AuthorityRole) ? [membership.role as AuthorityRole] : ["member"]));
              const isSelf = membership.actorId === currentActorId;
              const isBusy = busyTarget === membership.id;
              return <article className="grid gap-3 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_130px_100px] sm:items-center" key={membership.id}>
                <div className="flex min-w-0 items-center gap-3"><span className={`grid size-9 shrink-0 place-items-center rounded-full border text-[10px] font-bold ${membership.status === "active" ? "border-lime-300/25 bg-lime-300/10 text-lime-100" : membership.status === "suspended" ? "border-amber-300/25 bg-amber-300/10 text-amber-100" : "border-white/10 bg-white/[0.04] text-slate-500"}`}>{initials(membership.displayName, membership.actorEmail)}</span><div className="min-w-0"><p className="truncate text-xs font-semibold text-slate-200">{membership.displayName}{isSelf ? " · tu" : ""}</p><p className="mt-1 truncate text-[10px] text-slate-500">{membership.actorEmail}</p><p className="mt-1 font-mono text-[9px] uppercase text-slate-700">{membership.identityProvider} · v{membership.version}</p></div></div>
                <div className="min-w-0"><div className="grid grid-cols-2 gap-1">{AUTHORITY_ROLES.map((role) => { const selected = roleValue.includes(role); const canEditMembership = canManage && (!isSelf || currentActorIsOwner); const canToggleRole = canEditMembership && !isBusy && !(isSelf && role === "owner" && selected); return <button aria-pressed={selected} aria-label={`${selected ? "Rimuovi" : "Aggiungi"} mansione ${ROLE_METADATA[role].label}`} className={`rounded-md border px-1.5 py-1 text-left text-[9px] transition ${selected ? "border-lime-300/30 bg-lime-300/10 text-lime-100" : "border-white/[.08] text-slate-600 hover:border-lime-300/20 hover:text-slate-300"}`} disabled={!canToggleRole} key={role} onClick={() => setRoleDrafts((current) => ({ ...current, [membership.id]: selected ? roleValue.filter((item) => item !== role) : [...roleValue, role] }))} type="button">{ROLE_METADATA[role].label}</button>; })}</div>{JSON.stringify(roleValue) !== JSON.stringify(membership.roles?.length ? membership.roles : [membership.role]) && <button aria-label="Applica mansioni" className="mt-1 grid h-7 w-full place-items-center rounded-lg border border-lime-300/25 bg-lime-300/10 text-lime-200" disabled={!canManage || (isSelf && !currentActorIsOwner) || isBusy || roleValue.length === 0} onClick={() => void mutateTarget({ targetId: membership.id, expectedVersion: membership.version, action: "set_roles", roles: roleValue })} type="button"><Check className="size-3.5" /></button>}</div>
                <div className="flex items-center justify-between gap-2 sm:justify-end"><span className={`rounded-full border px-2 py-1 text-[9px] font-semibold uppercase ${membership.status === "active" ? "border-lime-300/20 bg-lime-300/[0.06] text-lime-200" : membership.status === "suspended" ? "border-amber-300/20 bg-amber-300/[0.06] text-amber-200" : "border-white/10 text-slate-500"}`}>{membership.status}</span>{canManage && !isSelf && membership.status !== "removed" && <div className="flex items-center gap-1">{membership.status === "active" ? <button aria-label="Sospendi" className="grid size-8 place-items-center rounded-lg border border-amber-300/20 text-amber-200 hover:bg-amber-300/10" disabled={isBusy} onClick={() => void mutateTarget({ targetId: membership.id, expectedVersion: membership.version, action: "suspend" })} type="button"><PauseCircle className="size-3.5" /></button> : <button aria-label="Riattiva" className="grid size-8 place-items-center rounded-lg border border-lime-300/20 text-lime-200 hover:bg-lime-300/10" disabled={isBusy} onClick={() => void mutateTarget({ targetId: membership.id, expectedVersion: membership.version, action: "reactivate" })} type="button"><PlayCircle className="size-3.5" /></button>}<button aria-label="Rimuovi" className="grid size-8 place-items-center rounded-lg border border-rose-300/20 text-rose-200 hover:bg-rose-300/10" disabled={isBusy} onClick={() => setRemoveTarget(membership)} type="button"><Trash2 className="size-3.5" /></button></div>}{isBusy && <LoaderCircle className="size-3.5 animate-spin text-lime-300" />}</div>
              </article>;
            })}
            {memberships.length === 0 && <div className="p-7 text-center text-xs text-slate-500">Nessuna membership nel readback tenant.</div>}
          </div>
        </div>

        <aside className="rounded-2xl border border-white/[0.08] bg-black/20 p-4">
          <div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-200"><KeyRound className="size-4" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-200/70">INVITI PENDENTI</p><p className="mt-1 text-xs text-slate-400">{pendingInvitations.length} link attivi</p></div></div>
          <div className="mt-4 space-y-2">{pendingInvitations.slice(0, 6).map((invitation) => <div className="rounded-xl border border-white/[0.07] bg-black/20 p-3" key={invitation.id}><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-[11px] font-medium text-slate-300">{invitation.email}</p><p className="mt-1 text-[9px] uppercase tracking-[0.1em] text-lime-200/70">{invitation.rolesLabel?.join(" · ") ?? invitation.roleLabel}</p></div>{canManage && <button aria-label="Revoca invito" className="grid size-7 place-items-center rounded-lg border border-white/10 text-slate-500 hover:border-rose-300/25 hover:text-rose-200" disabled={busyTarget === invitation.id} onClick={() => void mutateTarget({ targetType: "invitation", targetId: invitation.id, expectedVersion: invitation.version, action: "revoke" })} type="button"><X className="size-3.5" /></button>}</div><p className="mt-2 text-[9px] text-slate-600">Scade {new Date(invitation.expiresAt).toLocaleDateString("it-IT")}</p></div>)}{pendingInvitations.length === 0 && <div className="rounded-xl border border-dashed border-white/10 px-3 py-6 text-center text-[10px] text-slate-600">Nessun invito attivo.</div>}</div>
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-cyan-300/15 bg-cyan-300/[0.04] p-3 text-[10px] leading-5 text-cyan-100/70"><LockKeyhole className="mt-0.5 size-3.5 shrink-0" />Il token raw non è salvato e viene mostrato soltanto alla creazione.</div>
        </aside>
      </div>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}><DialogContent className="border-lime-300/20 bg-[#090d0a] text-slate-100 sm:max-w-[560px]"><DialogHeader><DialogTitle>Invita una persona</DialogTitle><DialogDescription className="text-slate-500">Il destinatario dovrà accedere con la stessa email tramite Neon Auth. Il link scade dopo 7 giorni.</DialogDescription></DialogHeader><div className="space-y-4"><label className="grid gap-2 text-xs text-slate-400" htmlFor="invite-email">Email<Input id="invite-email" className="border-white/10 bg-black/30 text-slate-100" onChange={(event) => setInviteEmail(event.target.value)} placeholder="persona@azienda.it" type="email" value={inviteEmail} /></label><div><p className="mb-2 text-xs text-slate-400">Mansioni operative · selezione multipla</p><div className="grid max-h-52 grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">{AUTHORITY_ROLES.map((role) => <button className={`rounded-xl border px-3 py-2 text-left text-[10px] transition ${inviteRoles.includes(role) ? "border-lime-300/35 bg-lime-300/10 text-lime-100" : "border-white/10 bg-black/20 text-slate-500 hover:border-lime-300/25"}`} key={role} onClick={() => setInviteRoles((current) => current.includes(role) ? current.filter((item) => item !== role) : [...current, role])} type="button">{ROLE_METADATA[role].label}</button>)}</div></div>{inviteUrl && <div className="rounded-xl border border-lime-300/20 bg-lime-300/[0.045] p-3"><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-lime-200"><Link2 className="size-3.5" />Link monouso generato</div><div className="mt-3 flex gap-2"><Input aria-label="Link di invito" className="min-w-0 border-white/10 bg-black/35 font-mono text-[10px] text-slate-300" readOnly value={inviteUrl} /><Button aria-label="Copia link" className="shrink-0 border-white/10 bg-black/30 text-lime-200" onClick={() => void copy(inviteUrl)} type="button" variant="outline"><Clipboard className="size-4" /></Button></div><p className="mt-2 text-[10px] text-amber-100/70">Copialo ora: per sicurezza non potrà essere recuperato dal database.</p></div>}<div className="flex items-start gap-2 rounded-xl border border-lime-300/15 bg-lime-300/[0.04] p-3 text-[10px] leading-5 text-lime-100/75"><ShieldCheck className="mt-0.5 size-4 shrink-0" />Le mansioni vengono risolte dal catalogo server; il browser non può aggiungere capability.</div></div><DialogFooter><DialogClose asChild><Button className="border-white/10 bg-transparent text-slate-400" type="button" variant="outline">Chiudi</Button></DialogClose><Button className="bg-lime-300 text-[#060806] hover:bg-lime-200" disabled={inviteBusy || inviteEmail.trim().length < 5 || inviteRoles.length === 0 || Boolean(inviteUrl)} onClick={() => void createInvite()} type="button">{inviteBusy ? <LoaderCircle className="size-4 animate-spin" /> : <MailPlus className="size-4" />}{inviteBusy ? "Creazione…" : "Genera invito"}</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={Boolean(removeTarget)} onOpenChange={(open) => !open && setRemoveTarget(null)}><DialogContent className="border-rose-300/20 bg-[#0d0909] text-slate-100 sm:max-w-[480px]"><DialogHeader><DialogTitle>Rimuovere la membership?</DialogTitle><DialogDescription className="text-slate-500">L’accesso verrà negato al prossimo controllo server. Il record resta nello storico come removed.</DialogDescription></DialogHeader>{removeTarget && <div className="rounded-xl border border-rose-300/15 bg-rose-300/[0.04] p-3 text-sm text-rose-100">{removeTarget.displayName}<span className="mt-1 block text-xs text-rose-100/60">{removeTarget.actorEmail}</span></div>}<DialogFooter><DialogClose asChild><Button className="border-white/10 bg-transparent text-slate-400" type="button" variant="outline">Annulla</Button></DialogClose><Button className="bg-rose-500 text-white hover:bg-rose-400" disabled={!removeTarget || busyTarget === removeTarget.id} onClick={() => removeTarget && void mutateTarget({ targetId: removeTarget.id, expectedVersion: removeTarget.version, action: "remove" })} type="button">{removeTarget && busyTarget === removeTarget.id ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}Rimuovi accesso</Button></DialogFooter></DialogContent></Dialog>
    </section>
  );
}
