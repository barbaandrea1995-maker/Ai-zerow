"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  Activity,
  BriefcaseBusiness,
  CalendarClock,
  CircleGauge,
  Clock3,
  FileText,
  Gauge,
  HardHat,
  Layers3,
  MessageSquareText,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
  ShieldCheck,
  Truck,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  COMMAND_NAVIGATION,
  getAllowedCommandNavigation,
  type CommandNavigationId,
} from "@/lib/command-dashboard";

type SidebarItem = {
  id: CommandNavigationId;
  label: string;
  path: string;
  requiredCapability: string;
  icon: LucideIcon;
};

const NAV_LABELS: Record<CommandNavigationId, string> = {
  command: "CONTROL",
  operations: "OPERATIONS",
  workforce: "WORKFORCE",
  planning: "PIANIFICAZIONE",
  attendance: "PRESENZE",
  finance: "FINANCE",
  procurement: "PROCUREMENT",
  assets: "ASSET",
  warehouse: "MAGAZZINO",
  mission: "MISSIONI",
  documents: "DOCUMENTI",
  governance: "GOVERNANCE",
  communications: "COMUNICAZIONI",
  externals: "INTEGRAZIONI",
  authority: "AUTHORITY",
  events: "EVENTI",
  pwa: "STATO PWA",
  settings: "IMPOSTAZIONI",
};

const NAV_ICONS: Record<CommandNavigationId, LucideIcon> = {
  command: MessageSquareText,
  operations: BriefcaseBusiness,
  workforce: Users,
  planning: CalendarClock,
  attendance: Clock3,
  finance: Gauge,
  procurement: Package,
  assets: Package,
  warehouse: Layers3,
  mission: Truck,
  documents: FileText,
  governance: ShieldCheck,
  communications: MessageSquareText,
  externals: Layers3,
  authority: ShieldCheck,
  events: Activity,
  pwa: CircleGauge,
  settings: Settings2,
};

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Amministratore",
  manager: "Manager",
  office: "Ufficio",
  technical: "Tecnico",
  field_supervisor: "Caposquadra",
  worker: "Operatore",
  warehouse_manager: "Responsabile magazzino",
  warehouse_operator: "Magazziniere",
  driver: "Autista",
  maintenance: "Manutentore",
  auditor: "Auditor",
};

function roleLabel(role: string) {
  return ROLE_LABELS[role] ?? role;
}

export function ZerowWorkspaceSidebar({
  active,
  capabilities,
  allowedNavigation,
  global = false,
  role = "operator",
  collapsed,
  mobileOpen,
  onToggleCollapsed,
  onCloseMobile,
  footerMetric = "WORKSPACE OPERATIVO",
  footerDetail = "TENANT SCOPED",
}: {
  active: CommandNavigationId;
  capabilities: readonly string[];
  allowedNavigation?: readonly CommandNavigationId[];
  global?: boolean;
  role?: string;
  collapsed: boolean;
  mobileOpen: boolean;
  onToggleCollapsed: () => void;
  onCloseMobile: () => void;
  footerMetric?: string;
  footerDetail?: string;
}) {
  const router = useRouter();
  const allowed = allowedNavigation
    ? COMMAND_NAVIGATION.filter((item) => allowedNavigation.includes(item.id))
    : getAllowedCommandNavigation(capabilities);
  const items: SidebarItem[] = allowed.map((item) => ({
    ...item,
    label: NAV_LABELS[item.id],
    icon: NAV_ICONS[item.id],
  }));

  function navigate(path: string) {
    onCloseMobile();
    router.push(path);
  }

  return (
    <>
      <aside
        aria-label="Navigazione principale"
        className={`zw-command-sidebar zw-workspace-sidebar ${global ? "zw-global-workspace-sidebar" : ""} fixed inset-y-0 left-0 z-40 flex flex-col px-3 py-4 transition-[width,transform] lg:static lg:translate-x-0 ${collapsed ? "is-collapsed lg:w-[76px]" : "lg:w-[248px]"} ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex items-center justify-between px-2">
          <button
            aria-label="Apri Command"
            className="flex min-w-0 items-center gap-3 text-left"
            onClick={() => navigate("/command")}
            type="button"
          >
            <span className="neon-pulse relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black shadow-[0_0_22px_rgba(200,255,34,.12)]">
              <Image src="/ai-zerow-icon.jpeg" alt="AI-ZEROW" width={40} height={40} className="size-full object-cover" />
            </span>
            <span className="zw-command-sidebar__brand-copy min-w-0">
              <span className="block text-sm font-bold tracking-[.18em] text-slate-50">AI-ZEROW</span>
              <span className="block text-[10px] uppercase tracking-[.22em] text-lime-300/75">command</span>
            </span>
          </button>
          <div className="flex items-center gap-1">
            <button
              aria-label={collapsed ? "Espandi sidebar" : "Riduci sidebar"}
              className="zw-command-sidebar__collapse hidden size-8 place-items-center rounded-lg text-slate-500 transition hover:bg-lime-300/10 hover:text-lime-200 lg:grid"
              onClick={onToggleCollapsed}
              type="button"
            >
              {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
            </button>
            <button
              aria-label="Chiudi menu"
              className="grid size-9 place-items-center rounded-xl text-slate-500 transition hover:bg-white/5 hover:text-white lg:hidden"
              onClick={onCloseMobile}
              type="button"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        <button
          aria-label="Workspace corrente"
          className="zw-command-tenant mt-7 flex w-full items-center gap-3 rounded-2xl p-3 text-left transition hover:border-lime-300/25"
          onClick={() => navigate("/command")}
          type="button"
        >
          <span className="grid size-9 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/10 text-lime-200">
            <HardHat className="size-4" />
          </span>
          <span className="zw-command-sidebar__tenant-copy min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold text-slate-200">ZEROW workspace</span>
            <span className="mt-0.5 block truncate text-[10px] uppercase tracking-[.1em] text-slate-600">
              {roleLabel(role)} · tenant scoped
            </span>
          </span>
        </button>

        <nav className="mt-6 min-h-0 flex-1 overflow-y-auto" aria-label="Navigazione principale">
          <p className="zw-command-sidebar__nav-caption px-3 text-[9px] font-semibold uppercase tracking-[.22em] text-slate-700">
            Area autorizzata
          </p>
          <div className="mt-2 space-y-1">
            {items.map((item) => {
              const Icon = item.icon;
              const isActive = item.id === active;
              return (
                <button
                  aria-current={isActive ? "page" : undefined}
                  aria-label={collapsed ? item.label : undefined}
                  className={`zw-command-nav-item ${isActive ? "is-active" : ""}`}
                  key={item.id}
                  onClick={() => navigate(item.path)}
                  title={collapsed ? item.label : undefined}
                  type="button"
                >
                  <Icon className="size-4" />
                  <span className="zw-command-sidebar__nav-label">{item.label}</span>
                  {item.id === "command" && <span className="zw-command-sidebar__nav-badge ml-auto rounded border border-lime-300/20 px-1.5 py-0.5 font-mono text-[8px] tracking-[.08em] text-lime-200">AI</span>}
                </button>
              );
            })}
          </div>
        </nav>

        <div className="zw-command-sidebar__footer mt-4 border-t border-white/[.07] pt-4">
          <div className="flex items-center justify-between px-2 text-[9px] uppercase tracking-[.14em] text-slate-600">
            <span>Sistema</span>
            <span className="flex items-center gap-1.5 text-lime-200">
              <span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_10px_rgba(200,255,34,.9)]" />
              DATI AGGIORNATI
            </span>
          </div>
          <div className="zw-command-core-status mt-3 rounded-xl p-3">
            <p className="font-mono text-[9px] text-slate-500">{footerMetric}</p>
            <p className="mt-2 font-mono text-[9px] text-lime-300/60">{footerDetail}</p>
          </div>
        </div>
      </aside>
      {mobileOpen && <button aria-label="Chiudi menu" className="zw-command-sidebar-backdrop fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm lg:hidden" onClick={onCloseMobile} type="button" />}
    </>
  );
}
