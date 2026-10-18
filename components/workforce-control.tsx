"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  Bell,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  Clock3,
  HardHat,
  LoaderCircle,
  Menu,
  RefreshCw,
  Search,
  ShieldCheck,
  Truck,
  UserRound,
  Users,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import { AccountMenu } from "@/components/account-menu";
import { Button } from "@/components/ui/button";
import { CommandMobileNav } from "@/components/command-mobile-nav";
import { Input } from "@/components/ui/input";
import { TenantSwitcher } from "@/components/tenant-switcher";
import { getAllowedCommandNavigation } from "@/lib/command-dashboard";

type Tone = "lime" | "cyan" | "amber" | "red";
type Filter = "ALL" | "PEOPLE" | "DRIVERS" | "TEAMS";

type WorkforceContext = {
  actorName: string;
  actorEmail: string;
  role: string;
  roles?: string[];
  capabilities: string[];
};

type WorkforceMember = {
  id: string;
  name: string;
  email?: string;
  role: string;
  roleLabel: string;
  roles?: string[];
  rolesLabel?: string[];
  status: string;
  updatedAt: string;
};

type WorkforceResource = {
  id: string;
  code: string | null;
  label: string;
  entityType: string;
  status: string;
  available: boolean;
  conflict: { recordId: string; title: string; startsAt: string; endsAt: string } | null;
  qualifications: string[];
  authorityMembershipId: string | null;
  memberMembershipIds?: string[];
  memberNames?: string[];
  updatedAt: string;
};

type WorkforcePayload = {
  context?: WorkforceContext;
  members?: WorkforceMember[];
  resources?: WorkforceResource[];
  summary?: {
    activePeople?: number;
    drivers?: number;
    teams?: number;
    inService?: number;
  };
  readback?: { status?: string; checkedAt?: string };
  error?: string;
};

const ROLE_LABELS: Record<string, string> = {
  owner: "Titolare",
  admin: "Amministratore",
  member: "Collaboratore",
  manager: "Manager",
  office: "Ufficio",
  technical: "Tecnico",
  field_supervisor: "Caposquadra",
  worker: "Operatore",
  warehouse_manager: "Responsabile magazzino",
  warehouse_operator: "Magazziniere",
  driver: "Autista",
  delivery_driver: "Autista di consegna",
  maintenance: "Manutentore",
  auditor: "Auditor",
};

const toneClasses: Record<Tone, string> = {
  lime: "border-lime-300/25 bg-lime-300/[.07] text-lime-100",
  cyan: "border-cyan-300/25 bg-cyan-300/[.06] text-cyan-100",
  amber: "border-amber-300/25 bg-amber-300/[.06] text-amber-100",
  red: "border-rose-300/25 bg-rose-300/[.06] text-rose-100",
};

function roleLabel(role: string) {
  return ROLE_LABELS[role] ?? role.replaceAll("_", " ");
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("it-IT", { dateStyle: "medium" });
}

function memberStatus(status: string) {
  if (status.toLowerCase() === "active") return { label: "Attiva", tone: "lime" as const };
  if (status.toLowerCase() === "suspended") return { label: "Sospesa", tone: "red" as const };
  if (status.toLowerCase() === "pending") return { label: "In attesa", tone: "amber" as const };
  return { label: status.replaceAll("_", " "), tone: "cyan" as const };
}

function IconButton({ label, children, onClick, className = "" }: { label: string; children: ReactNode; onClick?: () => void; className?: string }) {
  return <button aria-label={label} className={`grid size-9 shrink-0 place-items-center rounded-lg border border-white/10 bg-black/20 text-slate-400 transition hover:border-lime-300/35 hover:bg-lime-300/10 hover:text-lime-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300 ${className}`} onClick={onClick} type="button">{children}</button>;
}

function Metric({ label, value, detail, icon: Icon, tone }: { label: string; value: number; detail: string; icon: LucideIcon; tone: Tone }) {
  return <article className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-center justify-between gap-3"><span className={`grid size-10 place-items-center rounded-xl border ${toneClasses[tone]}`}><Icon className="size-[18px]" /></span><span className="text-[10px] text-slate-600">{detail}</span></div><p className="mt-5 text-[10px] font-semibold uppercase tracking-[.16em] text-slate-500">{label}</p><p className="mt-2 font-mono text-[30px] font-semibold leading-none tracking-[-.06em] text-slate-50">{value}</p></article>;
}

function RoleChip({ role }: { role: string }) {
  const isDriver = role === "driver" || role === "delivery_driver";
  const isWarehouse = role === "warehouse_manager" || role === "warehouse_operator";
  const tone = isDriver ? "cyan" : isWarehouse ? "amber" : "lime";
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-medium ${toneClasses[tone]}`}>{roleLabel(role)}</span>;
}

export default function WorkforceControl() {
  const router = useRouter();
  const [payload, setPayload] = useState<WorkforcePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [loadError, setLoadError] = useState(false);
  const [notice, setNotice] = useState("");
  const hasPayload = useRef(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/workforce/overview", { cache: "no-store" });
      const next = await response.json() as WorkforcePayload;
      if (!response.ok) throw new Error(next.error ?? "workforce_overview_unavailable");
      setPayload(next);
      hasPayload.current = true;
      setLoadError(false);
      setNotice("");
    } catch {
      if (hasPayload.current) setNotice("Aggiornamento non riuscito. Sono mostrati gli ultimi dati caricati.");
      else setLoadError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const context = payload?.context;
  const capabilities = useMemo(() => context?.capabilities ?? ["workforce.read"], [context?.capabilities]);
  const allowedNavigation = useMemo(() => getAllowedCommandNavigation(capabilities).map((item) => item.id), [capabilities]);
  const members = useMemo(() => payload?.members ?? [], [payload?.members]);
  const resources = useMemo(() => payload?.resources ?? [], [payload?.resources]);
  const teams = resources.filter((resource) => resource.entityType === "team");
  const driverProfiles = resources.filter((resource) => resource.entityType === "driver");
  const canSeeRegistry = capabilities.some((capability) => ["workforce.read.all", "workforce.registry.read", "workforce.manage", "authority.read"].includes(capability));
  const canManageAuthority = capabilities.includes("authority.manage");
  const canReadAuthority = canManageAuthority || capabilities.includes("authority.read");
  const canReadPlanning = capabilities.includes("planning.read");
  const canReadAttendance = capabilities.includes("workforce.read") || capabilities.includes("attendance.read");
  const canReadMission = capabilities.includes("mission.read");
  const canReadCommunication = capabilities.includes("communication.read");

  const roleSets = useMemo(() => new Map(members.map((member) => [member.id, member.roles ?? [member.role]])), [members]);
  const normalizedQuery = query.trim().toLocaleLowerCase("it-IT");
  const filteredMembers = members.filter((member) => {
    const roles = roleSets.get(member.id) ?? [];
    const isDriver = roles.some((role) => role === "driver" || role === "delivery_driver");
    const searchable = `${member.name} ${member.email ?? ""} ${roles.map(roleLabel).join(" ")}`.toLocaleLowerCase("it-IT");
    const matchesQuery = !normalizedQuery || searchable.includes(normalizedQuery);
    const matchesFilter = filter === "ALL" || filter === "PEOPLE" || (filter === "DRIVERS" && isDriver);
    return matchesQuery && matchesFilter;
  });
  const filteredTeams = teams.filter((team) => {
    const searchable = `${team.label} ${team.memberNames?.join(" ") ?? ""}`.toLocaleLowerCase("it-IT");
    return (filter === "ALL" || filter === "TEAMS") && (!normalizedQuery || searchable.includes(normalizedQuery));
  });
  const deliveryDrivers = members.filter((member) => member.status.toLowerCase() === "active" && (member.roles ?? [member.role]).includes("delivery_driver")).length;
  const actor = { email: context?.actorEmail ?? "", name: context?.actorName ?? "Operatore" };
  const navigate = (path: string) => router.push(path);

  if (loading && !payload) {
    return <main className="grid min-h-screen place-items-center bg-[#030504] text-sm text-slate-400"><LoaderCircle className="mr-2 inline size-4 animate-spin text-lime-300" />Caricamento persone…</main>;
  }

  if (loadError && !payload) {
    return <main className="grid min-h-screen place-items-center bg-[#030504] p-5"><div className="carbon-card w-full max-w-md rounded-2xl p-6 text-center"><CircleAlert className="mx-auto size-8 text-amber-200" /><h1 className="mt-4 text-lg font-semibold text-slate-100">Elenco persone non disponibile</h1><p className="mt-2 text-sm leading-6 text-slate-500">Non è stato possibile leggere i dati autorizzati. Riprova tra qualche istante.</p><Button className="mt-5 bg-lime-300 text-[#050705] hover:bg-lime-200" onClick={() => void refresh()}><RefreshCw className="size-4" />Riprova</Button></div></main>;
  }

  const filters: { id: Filter; label: string; count: number }[] = [
    { id: "ALL", label: "Tutti", count: members.length + teams.length },
    { id: "PEOPLE", label: "Persone", count: members.length },
    { id: "DRIVERS", label: "Autisti", count: members.filter((member) => (member.roles ?? [member.role]).some((role) => role === "driver" || role === "delivery_driver")).length },
    { id: "TEAMS", label: "Squadre", count: teams.length },
  ];

  return <main className="zw-app-shell zw-command-ultra min-h-screen overflow-x-hidden text-slate-100 selection:bg-lime-300 selection:text-[#060806]"><div aria-hidden="true" className="zw-command-ambient" /><section className="relative min-w-0">
    <header className="zw-command-topbar sticky top-0 z-20 flex min-h-[72px] items-center gap-3 px-4 py-3 sm:gap-5 sm:px-7">
      <IconButton className="lg:hidden" label="Apri menu"><Menu className="size-4" /></IconButton>
      <button aria-label="Apri Persone" className="zw-command-topbar__brand flex shrink-0 items-center gap-3 text-left" onClick={() => navigate("/workforce")} type="button"><span className="grid size-10 place-items-center overflow-hidden rounded-xl border border-lime-300/25 bg-black text-lime-200"><Image alt="AI-ZEROW" className="size-full object-cover" height={40} src="/ai-zerow-icon.jpeg" width={40} /></span><span><span className="block text-sm font-semibold text-slate-100">Persone</span><span className="mt-0.5 hidden text-[10px] uppercase tracking-[.16em] text-slate-500 sm:block">Anagrafica e squadre</span></span></button>
      <div className="ml-auto flex min-w-0 items-center gap-2"><TenantSwitcher /><span className="hidden items-center gap-2 rounded-full border border-lime-300/20 bg-lime-300/[.04] px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[.12em] text-lime-200 sm:flex"><span className="size-1.5 rounded-full bg-lime-300" />{refreshing ? "AGGIORNAMENTO" : payload?.readback?.status === "verified" ? "DATI AGGIORNATI" : "DATI OPERATIVI"}</span><IconButton className="zw-command-topbar__back hidden sm:grid" label="Torna indietro" onClick={() => router.back()}><ArrowLeft className="size-4" /></IconButton><IconButton className="zw-command-topbar__refresh" label="Aggiorna persone" onClick={() => void refresh()}><RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} /></IconButton>{canReadCommunication && <IconButton className="zw-command-topbar__notifications" label="Apri comunicazioni" onClick={() => navigate("/communications")}><Bell className="size-4" /></IconButton>}<AccountMenu actor={actor} /></div>
    </header>

    <div className="mx-auto w-full max-w-[1440px] px-4 pb-28 pt-6 sm:px-7 lg:pb-10">
      <section className="carbon-card overflow-hidden rounded-3xl p-5 sm:p-7"><div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between"><div className="max-w-3xl"><p className="text-[10px] font-semibold uppercase tracking-[.22em] text-lime-300/75">PERSONE · ANAGRAFICA OPERATIVA</p><h1 className="mt-2 text-2xl font-semibold tracking-[-.035em] text-slate-50 sm:text-3xl">Persone e squadre</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Ruoli e accessi arrivano da Authority. Qui trovi le persone e i gruppi di lavoro visibili nel tuo perimetro aziendale.</p></div>{canReadAuthority && <Button className="h-10 shrink-0 border-lime-300/25 bg-lime-300/[.07] px-4 text-lime-100 hover:bg-lime-300/[.13]" onClick={() => navigate("/onboarding")} variant="outline"><ShieldCheck className="size-4" />{canManageAuthority ? "Gestisci ruoli in Authority" : "Apri Authority"}<ArrowUpRight className="size-3.5" /></Button>}</div></section>

      <section aria-label="Riepilogo persone" className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric detail="nel tuo perimetro" icon={Users} label={canSeeRegistry ? "Persone attive" : "Il mio profilo"} tone="lime" value={canSeeRegistry ? payload?.summary?.activePeople ?? members.filter((member) => member.status.toLowerCase() === "active").length : members.length} /><Metric detail="mansione abilitata" icon={Truck} label="Autisti di consegna" tone="cyan" value={canSeeRegistry ? deliveryDrivers : members.some((member) => (member.roles ?? []).includes("delivery_driver")) ? 1 : 0} /><Metric detail="gruppi registrati" icon={HardHat} label="Squadre" tone="amber" value={teams.length} /><Metric detail="da Presenze" icon={Clock3} label="In servizio" tone="lime" value={payload?.summary?.inService ?? 0} /></section>

      <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(290px,.75fr)]"><div className="carbon-card min-w-0 rounded-2xl p-4 sm:p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-cyan-200/75">ELENCO AZIENDALE</p><h2 className="mt-1 text-lg font-semibold text-slate-100">{canSeeRegistry ? "Persone" : "Il mio profilo operativo"}</h2><p className="mt-1 text-xs leading-5 text-slate-500">{canSeeRegistry ? "Ogni persona compare una sola volta, con tutte le mansioni abilitate." : "Mostriamo solo le informazioni del tuo profilo autorizzato."}</p></div><div className="relative w-full sm:max-w-[300px]"><Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-600" /><Input aria-label="Cerca persone e squadre" className="h-10 border-white/10 bg-black/25 pl-10 text-sm text-slate-100 placeholder:text-slate-600" onChange={(event) => setQuery(event.target.value)} placeholder="Nome, ruolo o e-mail" value={query} /></div></div>

        <div aria-label="Filtra elenco" className="mt-4 flex flex-wrap gap-2">{filters.map((item) => <button aria-pressed={filter === item.id} className={`rounded-full border px-3 py-2 text-xs transition ${filter === item.id ? "border-lime-300/35 bg-lime-300/[.1] text-lime-100" : "border-white/[.08] bg-black/20 text-slate-400 hover:border-white/20 hover:text-slate-200"}`} key={item.id} onClick={() => setFilter(item.id)} type="button">{item.label}<span className="ml-2 font-mono text-[10px] opacity-70">{item.count}</span></button>)}</div>

        <div className="mt-4 space-y-2">{filter !== "TEAMS" && filteredMembers.map((member) => {
          const roles = roleSets.get(member.id) ?? [member.role];
          const isDriver = roles.some((role) => role === "driver" || role === "delivery_driver");
          const driverProfile = driverProfiles.find((resource) => resource.authorityMembershipId === member.id);
          const status = memberStatus(member.status);
          return <article className="rounded-2xl border border-white/[.08] bg-black/20 p-4 transition hover:border-lime-300/20" key={member.id}><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="flex min-w-0 items-start gap-3"><span className={`grid size-10 shrink-0 place-items-center rounded-xl border ${isDriver ? toneClasses.cyan : toneClasses.lime}`}>{isDriver ? <Truck className="size-[18px]" /> : <UserRound className="size-[18px]" />}</span><div className="min-w-0"><h3 className="truncate text-sm font-semibold text-slate-100">{member.name || "Persona senza nome"}</h3>{member.email && <p className="mt-1 truncate text-xs text-slate-500">{member.email}</p>}<div className="mt-2 flex flex-wrap gap-1.5">{(member.rolesLabel?.length ? member.rolesLabel : roles.map(roleLabel)).map((label, index) => <RoleChip key={`${member.id}-${roles[index] ?? label}`} role={roles[index] ?? label} />)}</div></div></div><span className={`inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] ${toneClasses[status.tone]}`}><span className="size-1.5 rounded-full bg-current" />{status.label}</span></div>
            {isDriver && <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/[.06] pt-3 text-[11px] text-slate-500"><span className="flex items-center gap-1.5"><Truck className="size-3.5 text-cyan-200" />{driverProfile ? "Profilo missioni collegato" : "Profilo missioni da verificare in Authority"}</span>{driverProfile?.qualifications?.length ? <span>Abilitazioni: {driverProfile.qualifications.join(", ")}</span> : null}</div>}
            <p className="mt-2 text-[10px] text-slate-600">Profilo aggiornato {formatDate(member.updatedAt)}</p>
          </article>;
        })}{(filter === "ALL" || filter === "TEAMS") && filteredTeams.map((team) => <article className="rounded-2xl border border-amber-300/15 bg-amber-300/[.025] p-4" key={team.id}><div className="flex items-start gap-3"><span className={`grid size-10 shrink-0 place-items-center rounded-xl border ${toneClasses.amber}`}><Users className="size-[18px]" /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold text-slate-100">{team.label}</h3><span className="rounded-full border border-amber-300/20 px-2.5 py-1 text-[10px] text-amber-100">Squadra · {team.memberNames?.length ?? team.memberMembershipIds?.length ?? 0} persone</span></div><p className="mt-1 text-xs text-slate-500">{team.memberNames?.length ? team.memberNames.join(" · ") : "Nessun componente visibile nel tuo perimetro."}</p></div></div></article>)}
          {filteredMembers.length === 0 && filteredTeams.length === 0 && <div className="rounded-2xl border border-dashed border-white/10 px-4 py-12 text-center"><Users className="mx-auto size-7 text-slate-700" /><p className="mt-3 text-sm font-medium text-slate-300">Nessun risultato</p><p className="mt-1 text-xs text-slate-600">Prova un altro filtro o termine di ricerca.</p></div>}</div>
      </div>

      <aside className="space-y-4"><section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start gap-3"><span className={`grid size-10 shrink-0 place-items-center rounded-xl border ${toneClasses.cyan}`}><BriefcaseBusiness className="size-[18px]" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-cyan-200/75">RESPONSABILITÀ DEI MODULI</p><h2 className="mt-1 text-base font-semibold text-slate-100">Un dato, un modulo titolare</h2></div></div><div className="mt-4 space-y-2"><div className="rounded-xl border border-white/[.07] bg-black/20 p-3"><p className="text-xs font-semibold text-slate-200">Authority</p><p className="mt-1 text-[11px] leading-5 text-slate-500">Identità, mansioni e accessi.</p></div><button className="w-full rounded-xl border border-white/[.07] bg-black/20 p-3 text-left transition hover:border-lime-300/20" disabled={!canReadPlanning} onClick={() => navigate("/planning")} type="button"><span className="flex items-center justify-between text-xs font-semibold text-slate-200">Pianificazione<ArrowUpRight className="size-3.5 text-slate-500" /></span><span className="mt-1 block text-[11px] leading-5 text-slate-500">Assegnazioni e disponibilità verificate per data e attività.</span></button><button className="w-full rounded-xl border border-white/[.07] bg-black/20 p-3 text-left transition hover:border-lime-300/20" disabled={!canReadAttendance} onClick={() => navigate("/presenze")} type="button"><span className="flex items-center justify-between text-xs font-semibold text-slate-200">Presenze<ArrowUpRight className="size-3.5 text-slate-500" /></span><span className="mt-1 block text-[11px] leading-5 text-slate-500">Timbrature e servizio registrati.</span></button><button className="w-full rounded-xl border border-white/[.07] bg-black/20 p-3 text-left transition hover:border-lime-300/20" disabled={!canReadMission} onClick={() => navigate("/mission")} type="button"><span className="flex items-center justify-between text-xs font-semibold text-slate-200">Missioni<ArrowUpRight className="size-3.5 text-slate-500" /></span><span className="mt-1 block text-[11px] leading-5 text-slate-500">Autisti di consegna, viaggi ed eventi di carico/scarico.</span></button></div></section>

        {canSeeRegistry && <section className="carbon-card-neon rounded-2xl p-4 sm:p-5"><div className="flex items-center gap-3"><span className={`grid size-10 place-items-center rounded-xl border ${toneClasses.lime}`}><CheckCircle2 className="size-[18px]" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-lime-200/75">LETTURA OPERATIVA</p><h2 className="mt-1 text-sm font-semibold text-slate-100">Dati con perimetro chiaro</h2></div></div><ul className="mt-4 space-y-3 text-[11px] leading-5 text-slate-500"><li className="flex gap-2"><UserRound className="mt-0.5 size-3.5 shrink-0 text-lime-200" /><span>Una riga per membership, con tutte le mansioni attive.</span></li><li className="flex gap-2"><Warehouse className="mt-0.5 size-3.5 shrink-0 text-cyan-200" /><span>Le assegnazioni ai magazzini restano nei moduli Magazzino e Presenze.</span></li><li className="flex gap-2"><CalendarClock className="mt-0.5 size-3.5 shrink-0 text-amber-200" /><span>La disponibilità effettiva viene ricalcolata da Pianificazione sulla finestra scelta.</span></li></ul></section>}

        {canManageAuthority && <Button className="h-10 w-full border-white/10 bg-black/20 text-slate-300 hover:border-lime-300/25 hover:bg-lime-300/[.05] hover:text-lime-100" onClick={() => navigate("/onboarding")} variant="outline"><ShieldCheck className="size-4" />Apri gestione Authority<ArrowUpRight className="size-3.5" /></Button>}
      </aside></section>

      <footer className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-white/[.07] py-5 text-[10px] text-slate-600"><span>AI-ZEROW · PERSONE</span><span className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-lime-300" />{canSeeRegistry ? "Visibilità aziendale autorizzata" : "Visibilità limitata al profilo e al team"}</span></footer>
    </div>
  </section>
  <CommandMobileNav active="more" allowedNavigation={allowedNavigation} role={context?.role} roles={context?.roles} />
  {notice && <div className="fixed bottom-5 left-1/2 z-[100] flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-2 rounded-xl border border-amber-300/25 bg-[#080d09]/96 px-4 py-3 text-left text-xs text-amber-100 shadow-[0_0_28px_rgba(190,255,60,.14)] backdrop-blur-xl"><CircleAlert className="size-4 shrink-0 text-amber-200" />{notice}<button aria-label="Chiudi avviso" className="ml-2 text-slate-400 hover:text-slate-100" onClick={() => setNotice("")} type="button">×</button></div>}
  </main>;
}
