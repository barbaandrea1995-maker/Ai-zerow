"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  Bell,
  BriefcaseBusiness,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleGauge,
  CircleHelp,
  CircleX,
  DatabaseZap,
  FileText,
  Gauge,
  HardHat,
  KeyRound,
  Layers3,
  LockKeyhole,
  Map as MapIcon,
  Menu,
  MessageSquareText,
  Package,
  Plus,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Truck,
  UserRoundCog,
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
import { useRouter } from "next/navigation";
import {
  AUTHORITY_ROLES,
  ROLE_CAPABILITIES,
  type AuthorityRole,
} from "@/lib/authority-catalog";

type Tone = "lime" | "cyan" | "amber" | "red";

type AuthorityContextView = {
  actorId: string;
  actorEmail: string;
  actorName: string;
  membershipId: string;
  tenantId: string;
  environment: string;
  role: string;
  capabilities: string[];
  resourceScope: string;
  fieldScope: string;
  fileScope: string;
  contextSource: string;
  sessionId: string | null;
  expiresAt: string | null;
  approvalContext: string;
};

type AccessProfile = {
  id: string;
  tenantId: string;
  label: string;
  baseRole: string;
  capabilities: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

const navItems = [
  { label: "CONTROL", id: "command", icon: MessageSquareText },
  { label: "OPERATIONS", id: "operations", icon: BriefcaseBusiness },
  { label: "FIELD", id: "field", icon: MapIcon },
  { label: "WORKFORCE", id: "workforce", icon: Users },
  { label: "FINANCE", id: "finance", icon: Gauge },
  { label: "ASSETS", id: "assets", icon: Package },
  { label: "WAREHOUSE", id: "warehouse", icon: Layers3 },
  { label: "MISSION", id: "mission", icon: Truck },
  { label: "DOCUMENTS", id: "documents", icon: FileText },
  { label: "EVENTS / AUTHORITY", id: "events_authority", icon: ShieldCheck },
  { label: "PWA / DIAGNOSTICS", id: "pwa", icon: CircleGauge },
];

const fallbackTenantFields = [
  { key: "actorId", value: "readback pending", detail: "Sites auth header", tone: "amber" as Tone },
  { key: "membershipId", value: "readback pending", detail: "server-derived membership", tone: "amber" as Tone },
  { key: "tenantId", value: "Sites project boundary", detail: "owner-private tenant", tone: "cyan" as Tone },
  { key: "environment", value: "Sites production", detail: "owner-only publication", tone: "lime" as Tone },
  { key: "role", value: "readback pending", detail: "server-resolved role", tone: "amber" as Tone },
  { key: "capabilities", value: "13 canonical roles", detail: "immutable catalog", tone: "cyan" as Tone },
  { key: "resourceScope", value: "tenant", detail: "server-owned scope", tone: "lime" as Tone },
  { key: "fieldScope", value: "tenant", detail: "field boundary", tone: "lime" as Tone },
  { key: "fileScope", value: "site", detail: "Sites file boundary", tone: "lime" as Tone },
  { key: "contextSource", value: "Sites workspace auth", detail: "required source", tone: "lime" as Tone },
  { key: "sessionId", value: "dispatch-owned", detail: "not exposed to client", tone: "cyan" as Tone },
  { key: "approvalContext", value: "owner", detail: "owner approval gate", tone: "lime" as Tone },
];

const negativeCases = [
  { title: "Unauthenticated", expected: "API returns 401", status: "SITES GUARD", tone: "lime" as Tone, icon: CircleHelp },
  { title: "Capability missing", expected: "tenant.manage gate returns 403", status: "SITES GUARD", tone: "lime" as Tone, icon: LockKeyhole },
  { title: "Organization missing", expected: "not applicable to owner-private Site", status: "SITES SCOPE", tone: "cyan" as Tone, icon: Building2 },
  { title: "Expired session", expected: "dispatch-owned identity rejected", status: "SITES GUARD", tone: "lime" as Tone, icon: CheckCircle2 },
  { title: "Cross-tenant resource", expected: "assertTenantScope boundary", status: "SITES GUARD", tone: "lime" as Tone, icon: ShieldCheck },
  { title: "Tenant A / B", expected: "external multi-tenant adapter deferred", status: "DEFERRED", tone: "amber" as Tone, icon: CircleX },
];

const toneStyles: Record<Tone, { icon: string; badge: string }> = {
  lime: { icon: "text-lime-200", badge: "border-lime-300/25 bg-lime-300/10 text-lime-200" },
  cyan: { icon: "text-cyan-200", badge: "border-cyan-300/25 bg-cyan-300/10 text-cyan-200" },
  amber: { icon: "text-amber-200", badge: "border-amber-300/25 bg-amber-300/5 text-amber-200" },
  red: { icon: "text-rose-200", badge: "border-rose-300/25 bg-rose-300/10 text-rose-200" },
};

function IconButton({ label, children, onClick, className = "" }: { label: string; children: ReactNode; onClick?: () => void; className?: string }) {
  return (
    <button
      aria-label={label}
      className={`grid size-9 place-items-center rounded-lg border border-white/10 bg-black/20 text-slate-500 transition hover:border-lime-300/35 hover:bg-lime-300/10 hover:text-lime-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300 ${className}`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function StatusBadge({ children, tone = "lime" }: { children: ReactNode; tone?: Tone }) {
  const styles = toneStyles[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-semibold tracking-[0.05em] ${styles.badge}`}>
      <span className="size-1.5 rounded-full bg-current shadow-[0_0_9px_currentColor]" />
      {children}
    </span>
  );
}

function SectionTitle({ eyebrow, title, action, onAction }: { eyebrow?: string; title: string; action?: string; onAction?: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        {eyebrow && <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/65">{eyebrow}</p>}
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-slate-100">{title}</h2>
      </div>
      {action && <button className="text-[11px] font-medium text-lime-300 transition hover:text-lime-100" onClick={onAction} type="button">{action}</button>}
    </div>
  );
}

function MetricCard({ label, value, detail, icon: Icon, tone }: { label: string; value: string; detail: string; icon: typeof ShieldCheck; tone: Tone }) {
  const style = toneStyles[tone];
  return (
    <article className="carbon-card rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        <span className={`grid size-9 place-items-center rounded-xl border border-current/20 bg-current/10 ${style.icon}`}><Icon className="size-[18px]" /></span>
        <StatusBadge tone={tone}>{detail}</StatusBadge>
      </div>
      <p className="mt-4 text-xs text-slate-500">{label}</p>
      <p className="mt-1 font-mono text-[29px] font-semibold leading-none tracking-[-0.06em] text-slate-50">{value}</p>
      <div className="mt-4 flex items-end gap-1.5 opacity-80">
        {[18, 26, 20, 35, 28, 48, 42, 57, 53, 66, 61, 75].map((height, index) => (
          <span className={`flex-1 rounded-t-sm ${tone === "cyan" ? "bg-cyan-300" : tone === "amber" ? "bg-amber-300" : "bg-lime-300"}`} key={index} style={{ height: `${height / 2}px`, opacity: 0.25 + index * 0.05 }} />
        ))}
      </div>
    </article>
  );
}

function CapabilityPill({ capability }: { capability: string }) {
  const action = /\.write$|\.manage$|\.send$|\.review$|\.broadcast\./.test(capability);
  return <span className={`rounded-md border px-2 py-1 font-mono text-[10px] ${action ? "border-lime-300/20 bg-lime-300/5 text-lime-200" : "border-white/10 bg-black/20 text-slate-400"}`}>{capability}</span>;
}

export default function OnboardingPage() {
  const router = useRouter();
  const [mobileMenu, setMobileMenu] = useState(false);
  const [selectedRole, setSelectedRole] = useState<AuthorityRole>("owner");
  const [query, setQuery] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileLabel, setProfileLabel] = useState("");
  const [toast, setToast] = useState("");
  const [authorityContext, setAuthorityContext] = useState<AuthorityContextView | null>(null);
  const [profiles, setProfiles] = useState<AccessProfile[]>([]);
  const [profileSubmitting, setProfileSubmitting] = useState(false);

  const filteredRoles = useMemo(() => AUTHORITY_ROLES.filter((role) => role.toLowerCase().includes(query.trim().toLowerCase())), [query]);
  const selectedCapabilities = ROLE_CAPABILITIES[selectedRole];
  const contextFields = authorityContext ? [
    { key: "actorId", value: authorityContext.actorId, detail: "Sites auth header", tone: "lime" as Tone },
    { key: "membershipId", value: authorityContext.membershipId, detail: "server-derived owner membership", tone: "lime" as Tone },
    { key: "tenantId", value: authorityContext.tenantId, detail: "Sites project boundary", tone: "lime" as Tone },
    { key: "environment", value: authorityContext.environment, detail: "owner-only publication", tone: "lime" as Tone },
    { key: "role", value: authorityContext.role, detail: "server-resolved application role", tone: "lime" as Tone },
    { key: "capabilities", value: `${authorityContext.capabilities.length} canonical`, detail: "server capability resolver", tone: "lime" as Tone },
    { key: "resourceScope", value: authorityContext.resourceScope, detail: "server-owned scope", tone: "lime" as Tone },
    { key: "fieldScope", value: authorityContext.fieldScope, detail: "field boundary", tone: "lime" as Tone },
    { key: "fileScope", value: authorityContext.fileScope, detail: "Sites file boundary", tone: "lime" as Tone },
    { key: "contextSource", value: authorityContext.contextSource, detail: "required source", tone: "lime" as Tone },
    { key: "sessionId", value: "dispatch-owned", detail: "not exposed to client", tone: "cyan" as Tone },
    { key: "approvalContext", value: authorityContext.approvalContext, detail: "owner approval gate", tone: "lime" as Tone },
  ] : fallbackTenantFields;

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  };

  useEffect(() => {
    let active = true;
    void fetch("/api/authority/access-profiles", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as { context?: AuthorityContextView; profiles?: AccessProfile[]; error?: string };
        if (!active) return;
        if (!response.ok) {
          setToast(payload.error === "authority_store_unavailable" ? "Authority store Sites non disponibile" : "Readback Authority non riuscito");
          return;
        }
        setAuthorityContext(payload.context ?? null);
        setProfiles(payload.profiles ?? []);
      })
      .catch(() => {
        if (active) setToast("Readback Authority non raggiungibile");
      });
    return () => {
      active = false;
    };
  }, []);

  const navigate = (id: string, label: string) => {
    setMobileMenu(false);
    if (id === "command") { router.push("/"); return; }
    if (id === "operations") { router.push("/operations"); return; }
    if (id === "events_authority") return;
    notify(`${label}: superficie prevista nel prossimo modulo`);
  };

  const createProfile = async () => {
    const label = profileLabel.trim();
    if (label.length < 2) {
      notify("Inserisci un'etichetta di almeno 2 caratteri");
      return;
    }

    setProfileSubmitting(true);
    try {
      const response = await fetch("/api/authority/access-profiles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label, role: selectedRole }),
      });
      const payload = (await response.json()) as { profile?: AccessProfile; error?: string; context?: AuthorityContextView };
      if (!response.ok || !payload.profile) {
        notify(payload.error === "authority_store_unavailable" ? "Authority store Sites non disponibile" : "Profilo non salvato");
        return;
      }
      setProfiles((current) => [payload.profile!, ...current]);
      setAuthorityContext(payload.context ?? authorityContext);
      setProfileOpen(false);
      setProfileLabel("");
      notify(`Profilo salvato su Sites: ${payload.profile.label}`);
    } catch {
      notify("Profilo non salvato: errore di rete");
    } finally {
      setProfileSubmitting(false);
    }
  };

  return (
    <main className="authority-page min-h-screen overflow-x-hidden bg-[#050607] text-slate-100 selection:bg-lime-300 selection:text-[#060806]">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_74%_0%,rgba(190,255,60,0.07),transparent_25%),radial-gradient(circle_at_18%_78%,rgba(70,110,120,0.08),transparent_27%)]" />
      <div className="relative flex min-h-screen">
        <aside className={`fixed inset-y-0 left-0 z-40 flex w-[232px] flex-col border-r border-lime-300/10 bg-[#050607]/96 px-3 py-4 backdrop-blur-xl transition-transform lg:static lg:translate-x-0 ${mobileMenu ? "translate-x-0" : "-translate-x-full"}`}>
          <div className="flex items-center justify-between px-2">
            <button className="flex items-center gap-3 text-left" onClick={() => { setMobileMenu(false); router.push("/"); }} type="button">
              <span className="brand-mark neon-pulse relative grid size-10 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black"><img src="/ai-zerow-icon.jpeg" alt="AI-ZEROW" className="size-full object-cover" /></span>
              <span><span className="block text-sm font-bold tracking-[0.18em] text-slate-50">AI-ZEROW</span><span className="block text-[10px] uppercase tracking-[0.22em] text-lime-300/75">command</span></span>
            </button>
            <button className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-white/5 hover:text-white lg:hidden" onClick={() => setMobileMenu(false)} type="button" aria-label="Chiudi menu"><X className="size-4" /></button>
          </div>
          <button className="carbon-card mt-8 flex w-full items-center gap-3 rounded-xl p-3 text-left transition hover:border-lime-300/25" type="button" onClick={() => notify("Workspace ZEROW · contesto owner Sites")}>
            <span className="grid size-8 place-items-center rounded-lg border border-lime-300/20 bg-lime-300/10 text-lime-200"><HardHat className="size-4" /></span>
            <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-slate-200">ZEROW workspace</span><span className="mt-0.5 block truncate text-[10px] text-slate-600">owner · Sites tenant context</span></span><ChevronRight className="size-3.5 text-slate-600" />
          </button>
          <nav className="mt-7 flex-1" aria-label="Navigazione principale">
            <p className="px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-600">Workspace</p>
            <div className="mt-2 space-y-1">
              {navItems.map((item) => { const Icon = item.icon; const active = item.id === "events_authority"; return <button aria-current={active ? "page" : undefined} className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${active ? "border border-lime-300/20 bg-lime-300/10 text-lime-200 shadow-[inset_0_0_20px_rgba(190,255,60,0.04)]" : "text-slate-500 hover:bg-white/[0.045] hover:text-slate-100"}`} key={item.id} onClick={() => navigate(item.id, item.label)} type="button"><Icon className={`size-4 ${active ? "text-lime-200" : "text-slate-600 group-hover:text-slate-300"}`} /><span>{item.label}</span>{item.id === "command" && <span className="ml-auto rounded border border-white/10 px-1.5 py-0.5 font-mono text-[8px] tracking-[0.08em] text-slate-600">AI</span>}</button>; })}
            </div>
          </nav>
          <div className="mt-5 border-t border-white/[0.08] pt-4">
            <div className="flex items-center justify-between px-2 text-[10px] uppercase tracking-[0.14em] text-slate-600"><span>System status</span><span className="flex items-center gap-1.5 text-lime-200"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_8px_rgba(190,255,60,0.8)]" />online</span></div>
            <div className="carbon-inset mt-3 rounded-xl p-3"><div className="flex items-center gap-2 text-[10px] text-slate-400"><ShieldCheck className="size-3.5 text-lime-300" />Authority core</div><div className="mt-2 flex items-end gap-0.5">{[18, 26, 23, 36, 31, 46, 40, 56, 50, 64, 59, 73].map((height, index) => <span className="flex-1 rounded-t-sm bg-lime-300/80" key={index} style={{ height: `${height / 2}px` }} />)}</div><p className="mt-3 font-mono text-[9px] text-slate-600">S02 · SITES NATIVE</p></div>
          </div>
        </aside>

        {mobileMenu && <button className="fixed inset-0 z-30 bg-black/75 lg:hidden" onClick={() => setMobileMenu(false)} aria-label="Chiudi menu" type="button" />}

        <section className="min-w-0 flex-1">
          <header className="authority-topbar sticky top-0 z-20 flex h-[72px] items-center gap-3 border-b border-white/[0.08] bg-[#050607]/88 px-4 backdrop-blur-xl sm:gap-5 sm:px-7">
            <IconButton label="Apri menu" onClick={() => setMobileMenu(true)} className="lg:hidden"><Menu className="size-4" /></IconButton>
            <div className="relative hidden min-w-0 flex-1 md:block"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-600" /><Input aria-label="Cerca ruoli e capability" className="h-10 max-w-[440px] border-white/10 bg-black/30 pl-10 text-xs text-slate-100 placeholder:text-slate-600 focus-visible:border-lime-300/40" onChange={(event) => setQuery(event.target.value)} placeholder="Cerca ruolo, capability, tenant…" value={query} /></div>
            <div className="flex min-w-0 flex-1 items-center gap-2 md:hidden"><span className="truncate text-xs font-semibold tracking-[0.14em] text-slate-200">AUTHORITY</span><span className="size-1 rounded-full bg-lime-300" /></div>
            <div className="ml-auto flex items-center gap-2">
              <span className={`hidden items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] sm:flex ${authorityContext ? "border-lime-300/20 bg-lime-300/5 text-lime-200" : "border-amber-300/20 bg-amber-300/5 text-amber-200"}`}><span className={`size-1.5 rounded-full shadow-[0_0_9px_currentColor] ${authorityContext ? "bg-lime-300" : "bg-amber-300"}`} />{authorityContext ? "Sites native / verified" : "Readback pending"}</span>
              <IconButton label="Notifiche"><Bell className="size-4" /></IconButton>
              <span className="hidden size-8 place-items-center rounded-full border border-white/15 bg-gradient-to-br from-slate-200 to-slate-500 text-xs font-bold text-[#080a0b] sm:grid">AB</span>
              <div className="hidden text-right lg:block"><p className="text-xs font-medium text-slate-200">{authorityContext?.actorName ?? "Operatore"}</p><p className="text-[10px] text-slate-600">{authorityContext ? `${authorityContext.role} · Sites owner` : "Site owner · readback pending"}</p></div><ChevronDown className="hidden size-3.5 text-slate-500 lg:block" />
            </div>
          </header>

          <div className="authority-content mx-auto max-w-[1680px] px-4 py-5 sm:px-7 sm:py-7">
            <div className="authority-hero mb-5">
              <div className="authority-hero-grid" aria-hidden="true" />
              <div className="relative flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
                <div className="flex items-center gap-4">
                  <span className="authority-mark"><img src="/ai-zerow-icon.jpeg" alt="AI-ZEROW" className="size-full object-cover" /></span>
                  <div><p className="authority-kicker">COMMAND / AUTHORITY CONTROL PLANE</p><p className="mt-1 text-sm font-medium tracking-wide text-slate-200 sm:text-base">Access matrix <span className="text-slate-600">·</span> tenant boundary <span className="text-slate-600">·</span> governed profiles</p><p className="mt-2 text-xs text-slate-500">S02 is locked for the Sites-native operating scope.</p></div>
                </div>
                <div className="authority-hero-meta grid grid-cols-3 gap-2 sm:min-w-[330px]">
                  <div><span>STATE</span><strong>LOCKED</strong></div><div><span>STORE</span><strong>D1 / SITES</strong></div><div><span>EDGE</span><strong>OWNER PRIVATE</strong></div>
                </div>
              </div>
            </div>
            <div className="authority-title-block mb-5 flex flex-wrap items-end justify-between gap-4"><div><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/70"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_9px_rgba(190,255,60,0.9)]" />AI-ZEROW / EVENTS / AUTHORITY</div><h1 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-50 sm:text-[30px]">Authority & onboarding</h1><p className="mt-1 text-xs text-slate-500">Identità server-owned, tenant context e capability matrix · superficie S02</p></div><div className="flex items-center gap-2"><span className="hidden items-center rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-[10px] text-slate-500 sm:inline-flex"><DatabaseZap className="mr-2 size-3.5 text-cyan-300" />{authorityContext ? "Readback Sites verificato" : "Readback in corso"}</span><Button className="h-10 border border-lime-300/30 bg-lime-300 px-4 text-xs font-semibold text-[#060806] shadow-[0_0_22px_rgba(190,255,60,0.18)] transition hover:-translate-y-0.5 hover:bg-lime-200" onClick={() => setProfileOpen(true)}><Plus className="size-3.5" />Crea profilo accesso</Button></div></div>

            <div className="authority-metrics grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="Ruoli canonici" value="13" detail="SITES CATALOG" icon={UserRoundCog} tone="lime" /><MetricCard label="TenantContext fields" value="12" detail="SERVER-OWNED" icon={KeyRound} tone="cyan" /><MetricCard label="Capability catalog" value="28+" detail="IMMUTABLE ARRAYS" icon={ShieldCheck} tone="lime" /><MetricCard label="Profili salvati" value={String(profiles.length)} detail={authorityContext ? "D1 READBACK" : "READBACK PENDING"} icon={DatabaseZap} tone={authorityContext ? "lime" : "amber"} /></div>

            <div className="mt-4 grid gap-4 2xl:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)]">
              <section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><SectionTitle eyebrow="SITE SESSION / BOUNDARY" title="Contesto corrente" /><p className="mt-1 text-[11px] text-slate-500">Identità, membership e tenant derivano dal server Sites.</p></div><StatusBadge tone={authorityContext ? "lime" : "amber"}>{authorityContext ? "SITES NATIVE" : "READBACK PENDING"}</StatusBadge></div><div className="carbon-card-neon mt-4 rounded-xl border p-4"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl border border-lime-300/30 bg-lime-300/10 text-lime-200"><LockKeyhole className="size-5" /></span><div><p className="text-sm font-semibold text-slate-100">Owner-only Site access</p><p className="mt-1 text-[11px] text-slate-500">Accesso verificato dal perimetro privato Sites</p></div></div><div className="mt-4 grid grid-cols-2 gap-2"><div className="rounded-lg border border-white/10 bg-black/25 p-3"><p className="text-[10px] uppercase tracking-[0.12em] text-slate-600">Account</p><p className="mt-1 truncate text-xs text-lime-200">{authorityContext?.actorEmail ?? "owner"}</p></div><div className="rounded-lg border border-white/10 bg-black/25 p-3"><p className="text-[10px] uppercase tracking-[0.12em] text-slate-600">App role</p><p className="mt-1 text-xs text-lime-200">{authorityContext?.role ?? "readback pending"}</p></div></div></div><div className="mt-4 space-y-2"><div className="flex items-center gap-2 rounded-lg border border-cyan-300/15 bg-cyan-300/5 px-3 py-2.5 text-[11px] text-cyan-100/80"><ShieldCheck className="size-4 shrink-0 text-cyan-200" /><span>Client identity: <strong className="font-medium text-cyan-100">server-owned</strong></span></div><div className="flex items-center gap-2 rounded-lg border border-lime-300/15 bg-lime-300/5 px-3 py-2.5 text-[11px] text-lime-100/80"><LockKeyhole className="size-4 shrink-0 text-lime-200" /><span>Tenant isolation: <strong className="font-medium text-lime-100">assertTenantScope</strong></span></div><div className="flex items-center gap-2 rounded-lg border border-lime-300/15 bg-lime-300/5 px-3 py-2.5 text-[11px] text-lime-100/80"><CheckCircle2 className="size-4 shrink-0 text-lime-200" /><span>Resolver runtime: <strong className="font-medium text-lime-100">Sites auth + D1 active</strong></span></div></div></section>
              <section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><SectionTitle eyebrow="TENANT CONTEXT / SITES CONTRACT" title="Identity context fields" /><p className="mt-1 text-[11px] text-slate-500">Campi derivati server-side dal contesto Sites owner-private.</p></div><IconButton label="Verifica contesto" onClick={() => notify(authorityContext ? "TenantContext Sites verificato" : "TenantContext in attesa del readback")}><Settings2 className="size-4" /></IconButton></div><div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{contextFields.map((field) => <div className="carbon-inset rounded-xl p-3" key={field.key}><div className="flex items-center justify-between gap-2"><span className="font-mono text-[10px] text-slate-500">{field.key}</span><span className={`size-1.5 rounded-full ${field.tone === "lime" ? "bg-lime-300" : field.tone === "cyan" ? "bg-cyan-300" : field.tone === "amber" ? "bg-amber-300" : "bg-rose-300"}`} /></div><p className="mt-2 truncate text-xs font-medium text-slate-200">{field.value}</p><p className="mt-1 truncate text-[10px] text-slate-600">{field.detail}</p></div>)}</div></section>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
              <section className="carbon-card rounded-2xl p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><SectionTitle eyebrow="ROLE CATALOG / 13" title="Ruoli canonici" /><p className="mt-1 text-[11px] text-slate-500">Catalogo server condiviso con il profilo accesso.</p></div><StatusBadge>SITES CATALOG</StatusBadge></div><div className="mt-4 space-y-1.5">{filteredRoles.map((role) => { const active = role === selectedRole; return <button className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${active ? "border-lime-300/35 bg-lime-300/10" : "border-white/[0.07] bg-black/15 hover:border-lime-300/20 hover:bg-white/[0.035]"}`} key={role} onClick={() => setSelectedRole(role)} type="button"><span className={`grid size-8 place-items-center rounded-lg border ${active ? "border-lime-300/25 bg-lime-300/10 text-lime-200" : "border-white/10 bg-black/20 text-slate-600"}`}><UserRoundCog className="size-3.5" /></span><span className="min-w-0 flex-1"><span className={`block text-xs font-medium ${active ? "text-lime-100" : "text-slate-300"}`}>{role}</span><span className="mt-1 block text-[10px] text-slate-600">{ROLE_CAPABILITIES[role].length} capability</span></span>{active && <Check className="size-4 text-lime-200" />}</button>; })}{filteredRoles.length === 0 && <div className="rounded-xl border border-white/10 p-5 text-center text-xs text-slate-500">Nessun ruolo trovato nel catalogo.</div>}</div></section>
              <section className="carbon-card carbon-card-neon rounded-2xl p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><SectionTitle eyebrow="CAPABILITY RESOLVER / READ MODEL" title={selectedRole} /><p className="mt-1 text-[11px] text-slate-500">Array canonico esposto dal resolver condiviso.</p></div><div className="flex items-center gap-2"><StatusBadge>SITES VERIFIED</StatusBadge><button className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-lime-300 hover:text-lime-100" onClick={() => notify(`Capability ${selectedRole}: catalogo Sites verificato`)} type="button">Readback <ArrowUpRight className="size-3.5" /></button></div></div><div className="carbon-inset mt-4 rounded-xl p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-[10px] uppercase tracking-[0.14em] text-slate-600">Capability count</p><p className="mt-1 font-mono text-3xl font-semibold tracking-[-0.07em] text-slate-50">{selectedCapabilities.length}</p></div><div className="text-right"><p className="text-[11px] text-slate-500">Source</p><p className="mt-1 font-mono text-[10px] text-cyan-200">authority-catalog</p></div></div><div className="mt-4 flex flex-wrap gap-2">{selectedCapabilities.map((capability) => <CapabilityPill capability={capability} key={capability} />)}</div></div><div className="mt-4 flex items-start gap-2 rounded-xl border border-lime-300/20 bg-lime-300/5 p-3 text-[11px] leading-5 text-lime-100/80"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-lime-200" />Il client può selezionare solo un ruolo canonico; capability, tenant e creator vengono ricostruiti dal server.</div></section>
            </div>

            <section className="carbon-card mt-4 rounded-2xl p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><SectionTitle eyebrow="ACCESS PROFILES / D1 READBACK" title="Profili accesso salvati" /><p className="mt-1 text-[11px] text-slate-500">Profili persistenti nel database Sites, isolati dal tenant owner-private.</p></div><StatusBadge tone={authorityContext ? "lime" : "amber"}>{authorityContext ? `${profiles.length} READ` : "READBACK PENDING"}</StatusBadge></div><div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{profiles.map((profile) => <article className="carbon-inset rounded-xl p-3" key={profile.id}><div className="flex items-start gap-3"><span className="grid size-9 place-items-center rounded-lg border border-lime-300/20 bg-lime-300/10 text-lime-200"><UserRoundCog className="size-4" /></span><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-slate-100">{profile.label}</p><p className="mt-1 font-mono text-[10px] uppercase tracking-[0.08em] text-lime-200/75">{profile.baseRole}</p></div><CheckCircle2 className="size-4 shrink-0 text-lime-300" /></div><div className="mt-3 flex items-center justify-between text-[10px] text-slate-600"><span>{profile.capabilities.length} capability</span><span>{profile.createdAt.slice(0, 10)}</span></div></article>)}{profiles.length === 0 && <div className="rounded-xl border border-dashed border-white/10 p-5 text-center text-xs text-slate-500 md:col-span-2 xl:col-span-3">Nessun profilo salvato. Crea il primo ruolo operativo dal comando in alto.</div>}</div></section>

            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]"><section className="carbon-card rounded-2xl p-4 sm:p-5"><SectionTitle eyebrow="AUTHORITY / NEGATIVE CASES" title="Casi di sicurezza" action="Apri evidenze" onAction={() => notify("Evidence ledger: guard Sites S02 attive")} /><div className="mt-4 grid gap-2 sm:grid-cols-2">{negativeCases.map((item) => { const Icon = item.icon; return <div className="carbon-inset flex items-center gap-3 rounded-xl p-3" key={item.title}><span className={`grid size-8 place-items-center rounded-lg border ${toneStyles[item.tone].badge}`}><Icon className="size-4" /></span><div className="min-w-0 flex-1"><p className="text-xs font-medium text-slate-200">{item.title}</p><p className="mt-1 truncate text-[10px] text-slate-500">{item.expected}</p></div><span className={`shrink-0 rounded border px-1.5 py-1 font-mono text-[9px] ${item.tone === "lime" ? "border-lime-300/20 text-lime-200" : item.tone === "cyan" ? "border-cyan-300/20 text-cyan-200" : "border-amber-300/20 text-amber-200"}`}>{item.status}</span></div>; })}</div></section><section className="carbon-card rounded-2xl p-4 sm:p-5"><SectionTitle eyebrow="AUTHORITY BOUNDARY" title="Readback implementato" /><div className="mt-4 space-y-3">{[{ icon: DatabaseZap, title: "Sites workspace auth", detail: "actorId e email derivati dagli header server", tone: "lime" as Tone }, { icon: Building2, title: "Sites tenant resolver", detail: "tenantId = confine del progetto owner-private", tone: "lime" as Tone }, { icon: ShieldCheck, title: "Permission resolver", detail: "tenant.manage richiesto per i profili", tone: "lime" as Tone }].map((item) => { const Icon = item.icon; return <div className="flex items-center gap-3" key={item.title}><span className={`grid size-9 place-items-center rounded-xl border ${toneStyles[item.tone].badge}`}><Icon className="size-4" /></span><div className="min-w-0 flex-1"><p className="text-xs font-medium text-slate-200">{item.title}</p><p className="mt-1 text-[11px] text-slate-500">{item.detail}</p></div><span className="font-mono text-[9px] text-lime-200">ACTIVE</span></div>; })}</div><div className="mt-5 flex items-start gap-2 rounded-xl border border-lime-300/15 bg-lime-300/5 p-3 text-[11px] leading-5 text-lime-100/75"><KeyRound className="mt-0.5 size-4 shrink-0 text-lime-200" />S02 usa esclusivamente auth e storage nativi Sites. L’adapter multi-tenant esterno resta fuori da questo perimetro.</div></section></div>

            <section className="carbon-card mt-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl p-4 sm:p-5"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl border border-lime-300/25 bg-lime-300/10 text-lime-200"><ShieldCheck className="size-4" /></span><div><p className="text-sm font-semibold text-slate-100">S02 CLOSED · Sites native</p><p className="mt-1 text-[11px] text-slate-500">Auth, tenant boundary, 13 ruoli canonici, capability gate e profili persistenti sono chiusi nel perimetro Sites.</p></div></div><div className="flex items-center gap-2"><StatusBadge>S02 CLOSED</StatusBadge><button className="grid size-8 place-items-center rounded-lg border border-white/10 text-slate-500 hover:border-lime-300/30 hover:text-lime-200" onClick={() => notify("S02: Sites native, nessuna dipendenza esterna") } type="button" aria-label="Apri evidenze"><ArrowUpRight className="size-3.5" /></button></div></section>
            <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] py-5 text-[10px] text-slate-600"><span>AI-ZEROW AUTHORITY · S02 CLOSED</span><span className="flex items-center gap-2"><span>black carbon core</span><span className="size-1 rounded-full bg-lime-300" /><span>Sites-only authority</span></span></footer>
          </div>
        </section>
      </div>

      <Dialog open={profileOpen} onOpenChange={setProfileOpen}><DialogContent className="border-lime-300/20 bg-[#0a0d0e] text-slate-100 sm:max-w-[520px]"><DialogHeader><DialogTitle className="text-slate-100">Crea profilo accesso</DialogTitle><DialogDescription className="text-slate-500">Il profilo viene salvato nel database Sites con tenant, creator e capability ricostruiti dal server.</DialogDescription></DialogHeader><div className="space-y-4"><div className="space-y-2"><label className="text-xs text-slate-400" htmlFor="profile-label">Etichetta profilo</label><Input id="profile-label" className="border-white/10 bg-black/30 text-slate-100" onChange={(event) => setProfileLabel(event.target.value)} placeholder="Es. Responsabile operativo" value={profileLabel} /></div><div className="space-y-2"><p className="text-xs text-slate-400">Ruolo base</p><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{AUTHORITY_ROLES.slice(0, 6).map((role) => <button className={`rounded-lg border px-3 py-2 text-left text-[11px] transition ${selectedRole === role ? "border-lime-300/35 bg-lime-300/10 text-lime-100" : "border-white/10 bg-black/20 text-slate-400 hover:border-lime-300/25"}`} key={role} onClick={() => setSelectedRole(role)} type="button">{role}</button>)}</div></div><div className="flex items-start gap-2 rounded-xl border border-lime-300/15 bg-lime-300/5 p-3 text-[11px] leading-5 text-lime-100/80"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-lime-200" />Il client invia solo etichetta e ruolo canonico. Il server applica tenant, creator e capability.</div></div><DialogFooter><DialogClose asChild><Button type="button" variant="outline" className="border-white/10 bg-transparent text-slate-400">Annulla</Button></DialogClose><Button type="button" disabled={profileSubmitting} className="bg-lime-300 text-[#060806] hover:bg-lime-200" onClick={() => void createProfile()}><Send className="size-3.5" />{profileSubmitting ? "Salvataggio…" : "Salva profilo"}</Button></DialogFooter></DialogContent></Dialog>
      {toast && <div className="fixed bottom-5 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2 rounded-xl border border-lime-300/25 bg-[#0b1008]/95 px-4 py-3 text-xs text-lime-100 shadow-[0_0_30px_rgba(190,255,60,0.14)] backdrop-blur-xl"><CheckCircle2 className="size-4 text-lime-300" />{toast}</div>}
    </main>
  );
}
