"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu, RefreshCw } from "lucide-react";
import { AccountMenu } from "@/components/account-menu";
import { CommandMobileNav } from "@/components/command-mobile-nav";
import { getAllowedCommandNavigation, type CommandNavigationId } from "@/lib/command-dashboard";
import { authorityRoleLabel } from "@/lib/authority-catalog";
import {
  isFocusedMobileProfile,
  type MobileNavigationContract,
} from "@/lib/mobile-navigation";
import { ZerowWorkspaceSidebar } from "@/components/zerow-workspace-sidebar";

const HIDDEN_PATHS = ["/login", "/auth-ab", "/access-denied", "/invite", "/offline"];

export type GlobalAuthority = {
  role: string;
  roles?: string[];
  capabilities: string[];
  actorName: string;
  actorEmail: string;
};

const MODULE_LABELS: Record<CommandNavigationId, { eyebrow: string; title: string }> = {
  command: { eyebrow: "AI-ZEROW", title: "Centrale" },
  operations: { eyebrow: "OPERATIVITÀ", title: "Commesse" },
  workforce: { eyebrow: "ORGANIZZAZIONE", title: "Persone" },
  planning: { eyebrow: "CONTROL ROOM", title: "Pianificazione" },
  attendance: { eyebrow: "PRESENZE", title: "Turni e timbrature" },
  finance: { eyebrow: "GESTIONE", title: "Finanza" },
  procurement: { eyebrow: "GESTIONE", title: "Acquisti" },
  assets: { eyebrow: "REGISTRO", title: "Asset" },
  warehouse: { eyebrow: "OPERATIVITÀ", title: "Magazzino" },
  mission: { eyebrow: "LOGISTICA", title: "Missioni" },
  documents: { eyebrow: "REGISTRO", title: "Documenti" },
  governance: { eyebrow: "CONTROL PLANE", title: "Governance" },
  communications: { eyebrow: "AZIENDA", title: "Comunicazioni" },
  "company-ai": { eyebrow: "ASSISTENTE", title: "Company AI" },
  externals: { eyebrow: "CONTROL PLANE", title: "Integrazioni" },
  authority: { eyebrow: "ACCESSI", title: "Autorità" },
  events: { eyebrow: "AUDIT", title: "Eventi" },
  pwa: { eyebrow: "DISPOSITIVO", title: "Stato PWA" },
  settings: { eyebrow: "ACCOUNT", title: "Impostazioni" },
};

function isHiddenPath(pathname: string) {
  return HIDDEN_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function activeNavigation(pathname: string): CommandNavigationId {
  if (pathname === "/command" || pathname === "/") return "command";
  if (pathname.startsWith("/operations")) return "operations";
  if (pathname.startsWith("/workforce")) return "workforce";
  if (pathname.startsWith("/planning")) return "planning";
  if (pathname.startsWith("/presenze")) return "attendance";
  if (pathname.startsWith("/finance")) return "finance";
  if (pathname.startsWith("/procurement")) return "procurement";
  if (pathname.startsWith("/assets")) return "assets";
  if (pathname.startsWith("/warehouse")) return "warehouse";
  if (pathname.startsWith("/mission")) return "mission";
  if (pathname.startsWith("/documents")) return "documents";
  if (pathname.startsWith("/governance")) return "governance";
  if (pathname.startsWith("/communications")) return "communications";
  if (pathname.startsWith("/ai")) return "company-ai";
  if (pathname.startsWith("/externals")) return "externals";
  if (pathname.startsWith("/onboarding") || pathname.startsWith("/tenants")) return "authority";
  if (pathname.startsWith("/events")) return "events";
  if (pathname.startsWith("/pwa")) return "pwa";
  if (pathname.startsWith("/settings")) return "settings";
  return "command";
}

function mobileHeaderLabel(pathname: string) {
  if (pathname.startsWith("/governance/security")) return { eyebrow: "GOVERNANCE", title: "Sicurezza" };
  if (pathname.startsWith("/release")) return { eyebrow: "GOVERNANCE", title: "Release" };
  if (pathname.startsWith("/qr")) return { eyebrow: "OPERATIVITÀ", title: "QR e barcode" };
  if (pathname.startsWith("/tenants")) return { eyebrow: "AZIENDA", title: "Perimetri" };
  return MODULE_LABELS[activeNavigation(pathname)];
}

function MobileShellHeader({
  actor,
  focused,
  onOpenMenu,
}: {
  actor: { email: string; name: string };
  focused: boolean;
  onOpenMenu: () => void;
}) {
  const pathname = usePathname();
  const label = mobileHeaderLabel(pathname);
  const homeHref = focused ? "/" : "/command";

  return (
    <header className="zw-mobile-shell-header" data-module-header={activeNavigation(pathname)}>
      {!focused ? (
        <button
          aria-label="Apri menu principale"
          className="zw-mobile-shell-header__control"
          onClick={onOpenMenu}
          type="button"
        >
          <Menu aria-hidden="true" className="size-[18px]" />
        </button>
      ) : null}
      <a aria-label={`Apri ${focused ? "Home" : "Centrale"}`} className="zw-mobile-shell-header__brand" href={homeHref}>
        <span className="zw-mobile-shell-header__mark">
          <Image alt="ZEROW" className="size-full object-cover" height={38} src="/ai-zerow-icon.jpeg" width={38} />
        </span>
        <span className="zw-mobile-shell-header__copy">
          <span>{label.eyebrow}</span>
          <strong>{label.title}</strong>
        </span>
      </a>
      <div className="zw-mobile-shell-header__actions">
        <button
          aria-label="Aggiorna modulo"
          className="zw-mobile-shell-header__control"
          onClick={() => window.location.reload()}
          type="button"
        >
          <RefreshCw aria-hidden="true" className="size-[17px]" />
        </button>
        <AccountMenu actor={actor} />
      </div>
    </header>
  );
}

export function GlobalModuleControls({
  initialAuthority,
  mobileNavigation,
}: {
  initialAuthority: GlobalAuthority | null;
  mobileNavigation: MobileNavigationContract | null;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const hidden = isHiddenPath(pathname);
  const canShowSidebar = Boolean(initialAuthority) && !hidden;
  const mobileFocusedRole = Boolean(mobileNavigation && isFocusedMobileProfile(mobileNavigation.profile));
  const canShowMobileNavigation = canShowSidebar && Boolean(mobileNavigation?.items.length);
  const allowedNavigation = useMemo(
    () => getAllowedCommandNavigation(initialAuthority?.capabilities ?? []).map((item) => item.id),
    [initialAuthority?.capabilities],
  );

  useEffect(() => {
    document.body.classList.toggle("has-zerow-workspace-sidebar", canShowSidebar);
    document.body.classList.toggle("zw-mobile-focused-role", canShowSidebar && mobileFocusedRole);
    document.body.classList.toggle("zw-commercial-shell", canShowSidebar);
    document.body.classList.toggle("has-zerow-mobile-nav", canShowMobileNavigation);
    document.body.classList.toggle("has-zerow-mobile-header", canShowSidebar);
    document.body.dataset.zerowModule = activeNavigation(pathname);
    document.body.dataset.navigationProfile = mobileNavigation?.profile ?? "";
    return () => {
      document.body.classList.remove("has-zerow-workspace-sidebar");
      document.body.classList.remove("zw-mobile-focused-role");
      document.body.classList.remove("zw-commercial-shell");
      document.body.classList.remove("has-zerow-mobile-nav");
      document.body.classList.remove("has-zerow-mobile-header");
      delete document.body.dataset.zerowModule;
      delete document.body.dataset.navigationProfile;
    };
  }, [canShowMobileNavigation, canShowSidebar, mobileFocusedRole, mobileNavigation?.profile, pathname]);

  useEffect(() => {
    if (!canShowSidebar) return;

    const handleShellControl = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest("button");
      if (!button) return;
      const label = button.getAttribute("aria-label") ?? "";

      if (label === "Apri menu" || label === "Apri navigazione") {
        event.preventDefault();
        event.stopPropagation();
        if (mobileFocusedRole) return;
        setMobileOpen(true);
        return;
      }

      if (label === "Riduci sidebar" || label === "Espandi sidebar") {
        event.preventDefault();
        event.stopPropagation();
        setCollapsed((value) => !value);
      }
    };

    document.addEventListener("click", handleShellControl, true);
    return () => document.removeEventListener("click", handleShellControl, true);
  }, [canShowSidebar, mobileFocusedRole]);

  if (hidden) return null;

  return (
    <>
      {canShowSidebar && initialAuthority ? (
        <MobileShellHeader
          actor={{ email: initialAuthority.actorEmail, name: initialAuthority.actorName }}
          focused={mobileFocusedRole}
          onOpenMenu={() => setMobileOpen(true)}
        />
      ) : null}
      {canShowSidebar && initialAuthority ? (
        <ZerowWorkspaceSidebar
          active={activeNavigation(pathname)}
          allowedNavigation={allowedNavigation}
          capabilities={initialAuthority.capabilities}
          collapsed={collapsed}
          footerDetail={`RUOLO / ${authorityRoleLabel(initialAuthority.role).toUpperCase()}`}
          footerMetric="WORKSPACE OPERATIVO"
          global
          mobileOpen={mobileOpen && !mobileFocusedRole}
          onCloseMobile={() => setMobileOpen(false)}
          onToggleCollapsed={() => setCollapsed((value) => !value)}
          role={initialAuthority.role}
        />
      ) : null}
      {canShowMobileNavigation && !mobileOpen ? (
        <CommandMobileNav
          contract={mobileNavigation}
          global
          menuOpen={mobileOpen}
          onOpenModuleMenu={() => setMobileOpen(true)}
        />
      ) : null}
    </>
  );
}
