"use client";

import Link from "next/link";
import { BriefcaseBusiness, Grid2X2, House, Map, Sparkles } from "lucide-react";

type MobileNavItem = "home" | "map" | "ai" | "operations" | "more";

const items: Array<{ id: MobileNavItem; label: string; href: string; icon: typeof House; primary?: boolean }> = [
  { id: "home" as const, label: "Home", href: "/", icon: House },
  { id: "map" as const, label: "Mappa", href: "/#operational-map", icon: Map },
  { id: "ai" as const, label: "AI", href: "/#company-ai", icon: Sparkles, primary: true },
  { id: "operations" as const, label: "Commesse", href: "/operations", icon: BriefcaseBusiness },
  { id: "more" as const, label: "Altro", href: "/onboarding", icon: Grid2X2 },
];

export function CommandMobileNav({ active }: { active: MobileNavItem }) {
  return (
    <nav aria-label="Navigazione mobile" className="zw-mobile-nav">
      {items.map((item) => {
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
