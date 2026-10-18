"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
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
  if (pathname.startsWith("/externals")) return "externals";
  if (pathname.startsWith("/onboarding") || pathname.startsWith("/tenants")) return "authority";
  if (pathname.startsWith("/events")) return "events";
  if (pathname.startsWith("/pwa")) return "pwa";
  if (pathname.startsWith("/settings")) return "settings";
  return "command";
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
    document.body.dataset.zerowModule = activeNavigation(pathname);
    document.body.dataset.navigationProfile = mobileNavigation?.profile ?? "";
    return () => {
      document.body.classList.remove("has-zerow-workspace-sidebar");
      document.body.classList.remove("zw-mobile-focused-role");
      document.body.classList.remove("zw-commercial-shell");
      document.body.classList.remove("has-zerow-mobile-nav");
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
      {canShowMobileNavigation && !mobileOpen ? <CommandMobileNav contract={mobileNavigation} global /> : null}
    </>
  );
}
