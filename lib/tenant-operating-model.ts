export const OPERATING_DOMAINS = ["operations", "warehouse", "transport"] as const;

export type OperatingDomain = (typeof OPERATING_DOMAINS)[number];

export const OPERATING_PROFILE_IDS = [
  "OPERATIONS",
  "WAREHOUSE",
  "TRANSPORT",
  "WAREHOUSE_TRANSPORT",
  "FULL_OPERATIONS",
] as const;

export type OperatingProfileId = (typeof OPERATING_PROFILE_IDS)[number];

export const OPERATING_PROFILE_CATALOG: Record<OperatingProfileId, {
  label: string;
  description: string;
  domains: OperatingDomain[];
}> = {
  OPERATIONS: {
    label: "Commesse e operazioni",
    description: "Commesse, pianificazione, field, documenti e controllo operativo.",
    domains: ["operations"],
  },
  WAREHOUSE: {
    label: "Solo magazzino",
    description: "Scorte, materiali, richieste e movimentazioni di deposito.",
    domains: ["warehouse"],
  },
  TRANSPORT: {
    label: "Solo trasporti",
    description: "Missioni, autisti, mezzi e consegne con prova di consegna.",
    domains: ["transport"],
  },
  WAREHOUSE_TRANSPORT: {
    label: "Magazzino + trasporti",
    description: "Magazzino con flotta, autisti e consegne collegate.",
    domains: ["warehouse", "transport"],
  },
  FULL_OPERATIONS: {
    label: "Azienda completa",
    description: "Commesse, magazzino, trasporti, asset e workforce nello stesso tenant.",
    domains: ["operations", "warehouse", "transport"],
  },
};

export const DEFAULT_OPERATING_PROFILE: OperatingProfileId = "FULL_OPERATIONS";
export const DEFAULT_OPERATING_DOMAINS: OperatingDomain[] = [...OPERATING_PROFILE_CATALOG[DEFAULT_OPERATING_PROFILE].domains];

export function isOperatingDomain(value: unknown): value is OperatingDomain {
  return typeof value === "string" && (OPERATING_DOMAINS as readonly string[]).includes(value);
}

export function isOperatingProfileId(value: unknown): value is OperatingProfileId {
  return typeof value === "string" && (OPERATING_PROFILE_IDS as readonly string[]).includes(value);
}

export function normalizeOperatingDomains(value: unknown): OperatingDomain[] {
  const values = Array.isArray(value) ? value.filter(isOperatingDomain) : [];
  return [...new Set(values)];
}

export function domainsForProfile(value: unknown): OperatingDomain[] {
  if (isOperatingProfileId(value)) return [...OPERATING_PROFILE_CATALOG[value].domains];
  return [...DEFAULT_OPERATING_DOMAINS];
}

export function profileForDomains(value: unknown): OperatingProfileId {
  const domains = normalizeOperatingDomains(value).sort();
  const match = OPERATING_PROFILE_IDS.find((profile) => {
    const candidate = [...OPERATING_PROFILE_CATALOG[profile].domains].sort();
    return candidate.length === domains.length && candidate.every((domain, index) => domain === domains[index]);
  });
  return match ?? DEFAULT_OPERATING_PROFILE;
}

export function parseOperatingDomains(value: unknown): OperatingDomain[] {
  if (typeof value !== "string") return [...DEFAULT_OPERATING_DOMAINS];
  try {
    const parsed = JSON.parse(value) as unknown;
    const domains = normalizeOperatingDomains(parsed);
    return domains.length ? domains : [...DEFAULT_OPERATING_DOMAINS];
  } catch {
    return [...DEFAULT_OPERATING_DOMAINS];
  }
}

const CAPABILITY_DOMAIN_PREFIXES: Array<[string, OperatingDomain]> = [
  ["warehouse.", "warehouse"],
  ["mission.", "transport"],
  ["asset.", "transport"],
  ["workforce.", "transport"],
  ["operations.", "operations"],
  ["planning.", "operations"],
  ["field.", "operations"],
  ["documents.", "operations"],
  ["finance.", "operations"],
  ["procurement.", "operations"],
];

export function domainForCapability(capability: string): OperatingDomain | null {
  return CAPABILITY_DOMAIN_PREFIXES.find(([prefix]) => capability.startsWith(prefix))?.[1] ?? null;
}

export function filterCapabilitiesForDomains(
  capabilities: readonly string[],
  domains: readonly OperatingDomain[],
) {
  const enabled = new Set(domains);
  return capabilities.filter((capability) => {
    const domain = domainForCapability(capability);
    return !domain || enabled.has(domain);
  });
}
