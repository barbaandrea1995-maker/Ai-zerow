"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  BriefcaseBusiness,
  ClipboardCheck,
  Grid2X2,
  House,
  Map,
  MessageCircle,
  Package,
  Settings2,
  Sparkles,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { CommandNavigationId } from "@/lib/command-dashboard";
import type {
  MobileNavigationContract,
  MobileNavigationItemId,
} from "@/lib/mobile-navigation";

type LegacyActive =
  | MobileNavigationItemId
  | "mission"
  | "company-ai";

type CommandMobileNavProps = {
  /** Server-derived contract. Only the root shell is allowed to render it. */
  contract?: MobileNavigationContract | null;
  global?: boolean;
  /** Retained temporarily so older surfaces compile while the global shell owns rendering. */
  active?: LegacyActive;
  allowedNavigation?: CommandNavigationId[];
  role?: string;
  roles?: string[];
  menuOpen?: boolean;
  onOpenModuleMenu?: () => void;
};

const iconByItem: Record<MobileNavigationItemId, LucideIcon> = {
  home: House,
  map: Map,
  ai: Sparkles,
  operations: BriefcaseBusiness,
  communications: MessageCircle,
  attendance: ClipboardCheck,
  warehouse: Package,
  assets: Wrench,
  settings: Settings2,
  more: Grid2X2,
};

function activeNavigation(pathname: string, hash: string): string {
  if (pathname === "/" || pathname === "/command") {
    if (hash === "#operational-map") return "map";
    if (hash === "#company-ai") return "ai";
    return "home";
  }
  if (pathname.startsWith("/operations")) return "operations";
  if (pathname.startsWith("/communications")) return "communications";
  if (pathname.startsWith("/presenze")) return "attendance";
  if (pathname.startsWith("/warehouse")) return "warehouse";
  if (pathname.startsWith("/assets")) return "assets";
  if (pathname.startsWith("/settings")) return "settings";
  if (pathname.startsWith("/ai")) return "ai";
  if (pathname.startsWith("/mission")) return "mission";
  return "more";
}

/**
 * The application renders one global mobile navigator. Legacy embedded calls
 * intentionally return null so a module can never create a second bar or
 * derive destinations from client-side role guesses.
 */
export function CommandMobileNav({
  active,
  contract,
  global = false,
  menuOpen = false,
  onOpenModuleMenu,
}: CommandMobileNavProps) {
  if (!global || !contract?.items.length) return null;
  return (
    <GlobalMobileNavigation
      active={active}
      contract={contract}
      menuOpen={menuOpen}
      onOpenModuleMenu={onOpenModuleMenu}
    />
  );
}

function GlobalMobileNavigation({
  active,
  contract,
  menuOpen,
  onOpenModuleMenu,
}: {
  active?: LegacyActive;
  contract: MobileNavigationContract;
  menuOpen: boolean;
  onOpenModuleMenu?: () => void;
}) {
  const pathname = usePathname();
  const [hash, setHash] = useState("");

  useEffect(() => {
    const readHash = () => setHash(window.location.hash);
    readHash();
    window.addEventListener("hashchange", readHash);
    return () => window.removeEventListener("hashchange", readHash);
  }, [pathname]);

  const current = active ?? activeNavigation(pathname, hash);

  return (
    <nav
      aria-label="Navigazione operativa mobile"
      className="zw-mobile-nav zw-mobile-nav--global"
      data-navigation-profile={contract.profile}
      data-navigation-role={contract.role}
      data-navigation-source={contract.source}
      data-navigation-version={contract.version}
    >
      {contract.items.map((item) => {
        const Icon = iconByItem[item.id];
        const selected = item.action === "open-module-menu"
          ? menuOpen || item.activeNavigation.includes(current)
          : item.activeNavigation.includes(current);
        const content = (
          <>
            <span className="zw-mobile-nav__icon">
              <Icon aria-hidden="true" className="size-[18px]" />
            </span>
            <span className="zw-mobile-nav__label">{item.label}</span>
          </>
        );

        if (item.action === "open-module-menu") {
          return (
            <button
              aria-current={selected ? "page" : undefined}
              aria-expanded={menuOpen}
              aria-label={item.label}
              className="zw-mobile-nav__item"
              data-navigation-action={item.action}
              key={item.id}
              onClick={onOpenModuleMenu}
              type="button"
            >
              {content}
            </button>
          );
        }

        if (!item.href) return null;
        return (
          <a
            aria-current={selected ? "page" : undefined}
            aria-label={item.label}
            className={item.primary ? "zw-mobile-nav__item zw-mobile-nav__item--ai" : "zw-mobile-nav__item"}
            href={item.href}
            key={item.id}
          >
            {content}
          </a>
        );
      })}
    </nav>
  );
}
