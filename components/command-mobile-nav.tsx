"use client";

import Link from "next/link";
import {
  BriefcaseBusiness,
  ClipboardCheck,
  Grid2X2,
  House,
  Map,
  Package,
  Sparkles,
  Truck,
} from "lucide-react";
import type { CommandNavigationId } from "@/lib/command-dashboard";

type MobileNavItem =
  | "home"
  | "map"
  | "ai"
  | "operations"
  | "mission"
  | "attendance"
  | "warehouse"
  | "more";

const OPERATIONAL_ROLES = new Set([
  "field_supervisor",
  "worker",
  "warehouse_manager",
  "warehouse_operator",
  "driver",
  "maintenance",
]);

export function CommandMobileNav({
  active,
  allowedNavigation,
  role,
  roles,
}: {
  active: MobileNavItem;
  allowedNavigation?: CommandNavigationId[];
  role?: string;
  roles?: string[];
}) {
  const effectiveRoles = new Set([role, ...(roles ?? [])].filter((value): value is string => Boolean(value)));
  const hasOperationalNavigation = allowedNavigation?.some((id) =>
    ["operations", "mission", "attendance", "warehouse"].includes(id),
  ) ?? false;
  if (![...effectiveRoles].some((value) => OPERATIONAL_ROLES.has(value)) && !hasOperationalNavigation) return null;

  const can = (id: CommandNavigationId) =>
    !allowedNavigation || allowedNavigation.includes(id);
  const canOpenCommand = can("command");
  const moreHref = can("authority") ? "/onboarding" : can("settings") ? "/settings" : "/command";
  const items: Array<{ id: MobileNavItem; label: string; href: string; icon: typeof House; primary?: boolean }> = [];

  if (canOpenCommand) {
    items.push(
      { id: "home", label: "Home", href: "/command", icon: House },
      { id: "map", label: "Mappa", href: "/command#operational-map", icon: Map },
      { id: "ai", label: "AI", href: "/command#company-ai", icon: Sparkles, primary: true },
    );
  }
  if (can("operations")) items.push({ id: "operations", label: "Commesse", href: "/operations", icon: BriefcaseBusiness });
  if (can("mission")) items.push({ id: "mission", label: "Missioni", href: "/mission", icon: Truck });
  if (can("attendance")) items.push({ id: "attendance", label: "Presenze", href: "/presenze", icon: ClipboardCheck });
  if (can("warehouse")) items.push({ id: "warehouse", label: "Magazzino", href: "/warehouse", icon: Package });
  items.push({ id: "more", label: "Altro", href: moreHref, icon: Grid2X2 });
  const moreItem = items.find((item) => item.id === "more");
  const baseItems = items.filter((item) => item.id !== "more");
  const firstFour = baseItems.slice(0, 4);
  const activeItem = baseItems.find((item) => item.id === active);
  if (activeItem && !firstFour.some((item) => item.id === activeItem.id)) {
    firstFour.splice(Math.max(0, firstFour.length - 1), 1, activeItem);
  }
  const visibleItems = items.length > 5 && moreItem ? [...firstFour, moreItem] : items;

  return (
    <nav aria-label="Navigazione mobile" className="zw-mobile-nav">
      {visibleItems.map((item) => {
        const Icon = item.icon;
        const selected = item.id === active;
        return (
          <Link
            aria-current={selected ? "page" : undefined}
            aria-label={item.label}
            className={item.primary ? "zw-mobile-nav__item zw-mobile-nav__item--ai" : "zw-mobile-nav__item"}
            href={item.href}
            key={item.id}
          >
            <span className="zw-mobile-nav__icon"><Icon aria-hidden="true" className="size-[18px]" /></span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
