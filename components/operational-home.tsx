import Image from "next/image";
import {
  ArrowUpRight,
  BriefcaseBusiness,
  ClipboardCheck,
  MessageCircle,
  Package,
  ShieldCheck,
  Sparkles,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { AccountMenu } from "@/components/account-menu";
import Link from "@/components/app-link";
import { TenantSwitcher } from "@/components/tenant-switcher";
import {
  ROLE_METADATA,
  authorityRoleLabel,
} from "@/lib/authority-catalog";
import type { AuthorityContext } from "@/lib/authority-context";
import type {
  MobileNavigationContract,
  MobileNavigationItem,
  MobileNavigationProfile,
} from "@/lib/mobile-navigation";

type OperationalHomeAuthority = Pick<
  AuthorityContext,
  "actorEmail" | "actorName" | "capabilities" | "role" | "roles"
>;

type ProfileCopy = {
  eyebrow: string;
  title: string;
  description: string;
  primaryHref: string;
  primaryLabel: string;
  primaryIcon: LucideIcon;
  scopeTitle: string;
  scopeDescription: string;
};

const PROFILE_COPY: Record<Exclude<MobileNavigationProfile, "control">, ProfileCopy> = {
  warehouse: {
    eyebrow: "OPERATIVITÀ / MAGAZZINO",
    title: "Il tuo magazzino, senza rumore.",
    description: "Scorte, richieste, prelievi e movimenti nel solo deposito assegnato. Ogni dato arriva dai registri aziendali autorizzati.",
    primaryHref: "/warehouse",
    primaryLabel: "Apri magazzino",
    primaryIcon: Package,
    scopeTitle: "Deposito e scorte assegnati",
    scopeDescription: "Il server limita catalogo, giacenze e azioni al perimetro del tuo ruolo e del tenant corrente.",
  },
  driver: {
    eyebrow: "OPERATIVITÀ / CONSEGNE",
    title: "Missioni, tracking e consegne.",
    description: "Apri la missione assegnata, registra gli eventi con timestamp e gestisci il turno da un unico punto operativo.",
    primaryHref: "/mission",
    primaryLabel: "Apri missioni",
    primaryIcon: BriefcaseBusiness,
    scopeTitle: "Missioni assegnate",
    scopeDescription: "Autista, mezzo, carico e tratta vengono verificati dal server prima di ogni avanzamento.",
  },
  field: {
    eyebrow: "OPERATIVITÀ / CAMPO",
    title: "Attività, turno e rapportino.",
    description: "Accedi al lavoro assegnato, timbra con geofence e completa con Company AI soltanto ciò che manca al rapportino.",
    primaryHref: "/operations",
    primaryLabel: "Apri attività",
    primaryIcon: BriefcaseBusiness,
    scopeTitle: "Attività e squadra assegnate",
    scopeDescription: "Commesse, risorse e presenze restano filtrate dal server sul tuo perimetro operativo.",
  },
  maintenance: {
    eyebrow: "OPERATIVITÀ / MANUTENZIONE",
    title: "Asset, interventi e disponibilità.",
    description: "Consulta le risorse autorizzate, registra evidenze tecniche e mantieni allineato lo stato operativo.",
    primaryHref: "/assets",
    primaryLabel: "Apri asset",
    primaryIcon: Wrench,
    scopeTitle: "Asset e interventi assegnati",
    scopeDescription: "Il registro server-side governa visibilità, stato, ubicazione ed evidenze della risorsa.",
  },
};

const iconByHref: Array<[string, LucideIcon]> = [
  ["/communications", MessageCircle],
  ["/presenze", ClipboardCheck],
  ["/warehouse", Package],
  ["/assets", Wrench],
  ["/ai", Sparkles],
];

function iconForHref(href: string) {
  return iconByHref.find(([prefix]) => href.startsWith(prefix))?.[1] ?? BriefcaseBusiness;
}

export default function OperationalHome({
  authority,
  navigation,
}: {
  authority: OperationalHomeAuthority;
  navigation: MobileNavigationContract | null;
}) {
  const profile = navigation?.profile && navigation.profile !== "control" ? navigation.profile : "field";
  const copy = PROFILE_COPY[profile];
  const PrimaryIcon = copy.primaryIcon;
  const rolePurpose = ROLE_METADATA[authority.role]?.purpose ?? "Accesso al perimetro operativo autorizzato.";
  const quickDestinations = (navigation?.items ?? []).filter(
    (item): item is MobileNavigationItem & { href: string } => item.id !== "home" && typeof item.href === "string",
  );

  return (
    <main className="zw-app-shell zw-command-ultra zw-operational-home min-h-screen overflow-x-hidden text-slate-100 selection:bg-lime-300 selection:text-[#060806]">
      <div className="zw-command-ambient" aria-hidden="true" />
      <section className="relative min-h-screen">
        <header className="zw-command-topbar sticky top-0 z-20 flex h-[72px] items-center gap-3 px-4 sm:gap-5 sm:px-7">
          <Link aria-label="Apri la Home" className="zw-command-topbar__brand flex min-w-0 items-center gap-2" href="/">
            <span className="relative grid size-9 shrink-0 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black shadow-[0_0_18px_rgba(200,255,34,.12)]">
              <Image alt="ZEROW" className="size-full object-cover" height={36} src="/ai-zerow-icon.jpeg" width={36} />
            </span>
            <span className="zw-command-topbar__wordmark block min-w-0">
              <span className="block truncate text-[11px] font-bold tracking-[.18em] text-slate-50">ZEROW</span>
              <span className="block truncate text-[9px] uppercase tracking-[.2em] text-lime-300/75">workspace operativo</span>
            </span>
          </Link>
          <div className="ml-auto flex min-w-0 items-center gap-2">
            <TenantSwitcher />
            <span className="hidden items-center gap-2 rounded-full border border-lime-300/20 bg-lime-300/[.05] px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[.12em] text-lime-100 sm:flex">
              <span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_9px_rgba(200,255,34,.9)]" />
              profilo dal server
            </span>
            <AccountMenu actor={{ email: authority.actorEmail, name: authority.actorName }} />
          </div>
        </header>

        <div className="mx-auto w-full max-w-[1240px] px-4 pb-28 pt-5 sm:px-7 sm:pb-12 sm:pt-8">
          <section className="zw-operational-home__summary carbon-card carbon-card-neon overflow-hidden rounded-[28px] p-5 sm:p-8 lg:p-10">
            <div className="relative z-10 grid items-end gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
              <div>
                <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.22em] text-lime-300/75">
                  <span className="size-1.5 rounded-full bg-lime-300" />{copy.eyebrow}
                </p>
                <h1 className="mt-4 max-w-3xl text-[clamp(2.15rem,6vw,4.8rem)] font-semibold leading-[.96] tracking-[-.065em] text-slate-50">{copy.title}</h1>
                <p className="mt-5 max-w-2xl text-sm leading-6 text-slate-400 sm:text-base sm:leading-7">{copy.description}</p>
                <div className="mt-7 flex flex-wrap gap-3">
                  <Link className="zw-button-primary inline-flex min-h-12 items-center gap-2 rounded-xl px-5 text-sm font-semibold" href={copy.primaryHref}>
                    <PrimaryIcon className="size-4" />{copy.primaryLabel}<ArrowUpRight className="size-4" />
                  </Link>
                  {authority.capabilities.includes("workforce.read") ? (
                    <Link className="zw-button-secondary inline-flex min-h-12 items-center gap-2 rounded-xl px-5 text-sm font-semibold" href="/presenze">
                      <ClipboardCheck className="size-4" />Gestisci timbratura
                    </Link>
                  ) : null}
                </div>
              </div>
              <aside className="carbon-inset rounded-2xl p-5">
                <div className="flex items-start justify-between gap-3">
                  <span className="grid size-10 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/[.07] text-lime-200"><ShieldCheck className="size-5" /></span>
                  <span className="rounded-full border border-cyan-300/20 bg-cyan-300/[.05] px-3 py-1 text-[9px] font-semibold uppercase tracking-[.12em] text-cyan-100">SERVER-SIDE</span>
                </div>
                <p className="mt-5 text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">{authorityRoleLabel(authority.role)}</p>
                <h2 className="mt-2 text-lg font-semibold tracking-[-.03em] text-slate-50">{copy.scopeTitle}</h2>
                <p className="mt-3 text-xs leading-5 text-slate-400">{copy.scopeDescription}</p>
              </aside>
            </div>
          </section>

          <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            <section className="carbon-card rounded-[24px] p-5 sm:p-6">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-lime-300/70">ACCESSI AUTORIZZATI</p>
                  <h2 className="mt-2 text-xl font-semibold tracking-[-.04em] text-slate-50">Il tuo spazio di lavoro</h2>
                </div>
                <span className="font-mono text-[10px] text-slate-500">{quickDestinations.length + 1} DESTINAZIONI</span>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {quickDestinations.map((item) => {
                  const Icon = iconForHref(item.href);
                  return (
                    <Link className="zw-operational-home__destination group flex min-h-[92px] items-center gap-4 rounded-2xl border border-white/[.08] bg-black/20 p-4 transition hover:border-lime-300/30 hover:bg-lime-300/[.045]" href={item.href} key={item.id}>
                      <span className="grid size-11 shrink-0 place-items-center rounded-xl border border-lime-300/15 bg-lime-300/[.055] text-lime-200"><Icon className="size-5" /></span>
                      <span className="min-w-0"><span className="block text-sm font-semibold text-slate-100">{item.label}</span><span className="mt-1 block text-[10px] leading-4 text-slate-500">Disponibile nel tuo profilo</span></span>
                      <ArrowUpRight className="ml-auto size-4 shrink-0 text-slate-600 transition group-hover:text-lime-200" />
                    </Link>
                  );
                })}
              </div>
            </section>

            <aside className="carbon-card rounded-[24px] p-5 sm:p-6">
              <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-cyan-200/75">IDENTITÀ OPERATIVA</p>
              <h2 className="mt-3 text-lg font-semibold tracking-[-.03em] text-slate-50">{authority.actorName}</h2>
              <p className="mt-1 truncate text-xs text-slate-500">{authority.actorEmail}</p>
              <div className="my-5 h-px bg-white/[.08]" />
              <p className="text-sm leading-6 text-slate-300">{rolePurpose}</p>
              <div className="mt-5 rounded-2xl border border-lime-300/12 bg-lime-300/[.035] p-4">
                <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.16em] text-lime-200"><ShieldCheck className="size-3.5" />Perimetro verificato</p>
                <p className="mt-2 text-[11px] leading-5 text-slate-400">Ruolo, capability e destinazioni sono stati calcolati dalla membership D1. Questa Home non assegna permessi dal browser.</p>
              </div>
            </aside>
          </div>
        </div>
      </section>
    </main>
  );
}
