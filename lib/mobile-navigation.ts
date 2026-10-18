import {
  isAuthorityRole,
  type AuthorityRole,
} from "./authority-catalog.ts";

export const MOBILE_NAVIGATION_CONTRACT_VERSION = 1;

export type MobileNavigationItemId =
  | "home"
  | "map"
  | "ai"
  | "operations"
  | "communications"
  | "attendance"
  | "warehouse"
  | "assets"
  | "settings"
  | "more";

export type MobileNavigationProfile =
  | "control"
  | "field"
  | "driver"
  | "warehouse"
  | "maintenance";

export type MobileNavigationItem = {
  id: MobileNavigationItemId;
  label: string;
  href?: string;
  action?: "open-module-menu";
  primary?: boolean;
  activeNavigation: string[];
};

export type MobileNavigationContract = {
  version: typeof MOBILE_NAVIGATION_CONTRACT_VERSION;
  source: "authority-server";
  profile: MobileNavigationProfile;
  role: AuthorityRole;
  items: MobileNavigationItem[];
};

type NavigationAuthority = {
  role: string;
  roles?: readonly string[];
  capabilities: readonly string[];
};

const CONTROL_ROLES = new Set<AuthorityRole>([
  "owner",
  "admin",
  "manager",
  "office",
  "technical",
  "field_supervisor",
  "auditor",
]);

const capabilityByItem: Partial<Record<MobileNavigationItemId, string>> = {
  map: "command.read",
  ai: "company_ai.read",
  operations: "operations.read",
  communications: "communication.read",
  attendance: "workforce.read",
  warehouse: "warehouse.read",
  assets: "asset.read",
  settings: "settings.read",
};

function isAuthorized(item: MobileNavigationItem, capabilities: ReadonlySet<string>) {
  if (item.id === "home" || item.id === "more") return true;
  if (item.id === "ai" && item.href?.startsWith("/command")) return capabilities.has("command.read");
  const required = capabilityByItem[item.id];
  return !required || capabilities.has(required);
}

function focusedProfile(role: AuthorityRole, roles: ReadonlySet<AuthorityRole>): MobileNavigationProfile | null {
  if (role === "warehouse_operator" || role === "warehouse_manager") return "warehouse";
  if (role === "driver" || role === "delivery_driver") return "driver";
  if (role === "maintenance") return "maintenance";
  if (role === "worker") return "field";
  if (roles.has("warehouse_operator") || roles.has("warehouse_manager")) return "warehouse";
  if (roles.has("driver") || roles.has("delivery_driver")) return "driver";
  if (roles.has("maintenance")) return "maintenance";
  if (roles.has("worker")) return "field";
  return null;
}

function operationalItems(profile: Exclude<MobileNavigationProfile, "control">): MobileNavigationItem[] {
  const homeActive = profile === "warehouse"
    ? ["home"]
    : profile === "maintenance"
      ? ["home"]
      : profile === "driver"
        ? ["home", "mission"]
        : ["home", "operations"];
  const roleItem: MobileNavigationItem = profile === "warehouse"
    ? { id: "warehouse", label: "Magazzino", href: "/warehouse", activeNavigation: ["warehouse"] }
    : profile === "maintenance"
      ? { id: "assets", label: "Asset", href: "/assets", activeNavigation: ["assets"] }
      : { id: "attendance", label: "Presenze", href: "/presenze", activeNavigation: ["attendance"] };

  return [
    { id: "home", label: "Home", href: "/", activeNavigation: homeActive },
    { id: "communications", label: "Comunicazioni", href: "/communications", activeNavigation: ["communications"] },
    { id: "ai", label: "AI", href: "/ai", primary: true, activeNavigation: ["ai", "company-ai"] },
    roleItem,
    { id: "settings", label: "Impostazioni", href: "/settings", activeNavigation: ["settings"] },
  ];
}

function controlItems(): MobileNavigationItem[] {
  return [
    { id: "home", label: "Home", href: "/command", activeNavigation: ["home", "command"] },
    { id: "map", label: "Mappa", href: "/command#operational-map", activeNavigation: ["map"] },
    { id: "ai", label: "AI", href: "/command#company-ai", primary: true, activeNavigation: ["ai", "company-ai"] },
    { id: "operations", label: "Commesse", href: "/operations", activeNavigation: ["operations"] },
    { id: "more", label: "Altro", action: "open-module-menu", activeNavigation: ["more", "settings"] },
  ];
}

/**
 * Produces the only mobile-navigation contract used by the application.
 * Call this from a server component with the D1-derived Authority context;
 * clients receive an already authorized, immutable list of destinations.
 */
export function mobileNavigationForAuthority(authority: NavigationAuthority): MobileNavigationContract | null {
  if (!isAuthorityRole(authority.role)) return null;
  const normalizedRoles = [authority.role, ...(authority.roles ?? [])]
    .filter((value): value is AuthorityRole => isAuthorityRole(value));
  const roles = new Set(normalizedRoles);
  const capabilities = new Set(authority.capabilities);
  const hasControlRole = normalizedRoles.some((role) => CONTROL_ROLES.has(role));
  const profile = hasControlRole ? "control" : focusedProfile(authority.role, roles) ?? "control";
  const candidates = profile === "control" ? controlItems() : operationalItems(profile);
  const items = candidates.filter((item) => isAuthorized(item, capabilities));

  // Every canonical profile has exactly five authorized destinations. A
  // malformed role/capability combination fails closed instead of surfacing a
  // partial rail whose routes would then be rejected by the server.
  if (items.length !== candidates.length) return null;

  return {
    version: MOBILE_NAVIGATION_CONTRACT_VERSION,
    source: "authority-server",
    profile,
    role: authority.role,
    items,
  };
}

export function isFocusedMobileProfile(profile: MobileNavigationProfile) {
  return profile !== "control";
}
