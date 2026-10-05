"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, LayoutDashboard, RefreshCw } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { getAllowedCommandNavigation, type CommandNavigationId } from "@/lib/command-dashboard";
import { ZerowWorkspaceSidebar } from "@/components/zerow-workspace-sidebar";

const HIDDEN_PATHS = ["/login", "/auth-ab", "/access-denied", "/invite", "/offline"];

export type GlobalAuthority = {
  role: string;
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

export function GlobalModuleControls({ initialAuthority }: { initialAuthority: GlobalAuthority | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const hidden = isHiddenPath(pathname);
  const canShowSidebar = Boolean(initialAuthority) && !hidden;
  const allowedNavigation = useMemo(
    () => getAllowedCommandNavigation(initialAuthority?.capabilities ?? []).map((item) => item.id),
    [initialAuthority?.capabilities],
  );

  useEffect(() => {
    document.body.classList.toggle("has-zerow-workspace-sidebar", canShowSidebar);
    return () => document.body.classList.remove("has-zerow-workspace-sidebar");
  }, [canShowSidebar]);

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
  }, [canShowSidebar]);

  if (hidden) return null;

  const goBack = () => {
    if (window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/command");
  };

  return (
    <>
      {canShowSidebar && initialAuthority ? (
        <ZerowWorkspaceSidebar
          active={activeNavigation(pathname)}
          allowedNavigation={allowedNavigation}
          capabilities={initialAuthority.capabilities}
          collapsed={collapsed}
          footerDetail={`RUOLO / ${initialAuthority.role.toUpperCase()}`}
          footerMetric="WORKSPACE OPERATIVO"
          global
          mobileOpen={mobileOpen}
          onCloseMobile={() => setMobileOpen(false)}
          onToggleCollapsed={() => setCollapsed((value) => !value)}
          role={initialAuthority.role}
        />
      ) : null}
      <div className="zw-module-action-rail" aria-label="Azioni modulo">
        <button
          aria-label="Torna indietro"
          className="zw-module-action-rail__button"
          onClick={goBack}
          type="button"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          <span>Indietro</span>
        </button>
        <button
          aria-label="Aggiorna modulo"
          className="zw-module-action-rail__button"
          onClick={() => window.location.reload()}
          type="button"
        >
          <RefreshCw aria-hidden="true" className="size-4" />
          <span>Aggiorna</span>
        </button>
        <button
          aria-label="Apri Command"
          className="zw-module-action-rail__button zw-module-action-rail__button--workspace"
          onClick={() => router.push("/command")}
          type="button"
        >
          <LayoutDashboard aria-hidden="true" className="size-4" />
          <span>Command</span>
        </button>
      </div>
    </>
  );
}
