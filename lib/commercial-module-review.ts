import moduleRegistry from "@/config/commercial-modules.json";

export type CommercialModule = (typeof moduleRegistry)[number];

export const COMMERCIAL_MODULES = moduleRegistry;

export function commercialModuleForRoute(route: string) {
  return COMMERCIAL_MODULES.find((module) => module.route === route);
}

export function commercialModuleIds() {
  return COMMERCIAL_MODULES.map((module) => module.id);
}
