export const OPERATING_DOMAINS = ["operations", "warehouse", "transport"] as const;

export type OperatingDomain = (typeof OPERATING_DOMAINS)[number];

export const TRANSPORT_MODES = [
  "ASSET_TRANSFER",
  "WAREHOUSE_TO_RECIPIENT",
  "WAREHOUSE_TO_JOB",
  "RETURN_TO_WAREHOUSE",
  "WAREHOUSE_TRANSFER",
] as const;

export type TransportMode = (typeof TRANSPORT_MODES)[number];

export const TRANSPORT_MODE_CATALOG: Record<TransportMode, {
  label: string;
  description: string;
}> = {
  ASSET_TRANSFER: {
    label: "Asset e attrezzature",
    description: "Trasferimento di mezzi, asset o attrezzature verso una sede o un destinatario.",
  },
  WAREHOUSE_TO_RECIPIENT: {
    label: "Magazzino → destinatario",
    description: "Spedizione di materiali dal magazzino a un destinatario esterno.",
  },
  WAREHOUSE_TO_JOB: {
    label: "Magazzino → commessa",
    description: "Materiali preparati dal magazzino e consegnati a una commessa.",
  },
  RETURN_TO_WAREHOUSE: {
    label: "Rientro a magazzino",
    description: "Rientro di asset, materiali, resi o attrezzature in deposito.",
  },
  WAREHOUSE_TRANSFER: {
    label: "Trasferimento tra sedi",
    description: "Movimentazione tra magazzini o sedi operative dello stesso tenant.",
  },
};

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
  transportModes: TransportMode[];
}> = {
  OPERATIONS: {
    label: "Commesse e operazioni",
    description: "Commesse, pianificazione, field, documenti e controllo operativo.",
    domains: ["operations"],
    transportModes: [],
  },
  WAREHOUSE: {
    label: "Solo magazzino",
    description: "Scorte, materiali, richieste e movimentazioni di deposito.",
    domains: ["warehouse"],
    // A warehouse-only tenant can prepare an outbound request for a recipient;
    // assigning and executing the actual transport remains a separate domain.
    transportModes: ["WAREHOUSE_TO_RECIPIENT"],
  },
  TRANSPORT: {
    label: "Solo trasporti",
    description: "Missioni, autisti, mezzi e consegne con prova di consegna.",
    domains: ["transport"],
    transportModes: ["ASSET_TRANSFER"],
  },
  WAREHOUSE_TRANSPORT: {
    label: "Magazzino + trasporti",
    description: "Magazzino con flotta, autisti e consegne collegate.",
    domains: ["warehouse", "transport"],
    transportModes: ["ASSET_TRANSFER", "WAREHOUSE_TO_RECIPIENT", "WAREHOUSE_TO_JOB", "RETURN_TO_WAREHOUSE", "WAREHOUSE_TRANSFER"],
  },
  FULL_OPERATIONS: {
    label: "Azienda completa",
    description: "Commesse, magazzino, trasporti, asset e workforce nello stesso tenant.",
    domains: ["operations", "warehouse", "transport"],
    transportModes: [...TRANSPORT_MODES],
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

export function isTransportMode(value: unknown): value is TransportMode {
  return typeof value === "string" && (TRANSPORT_MODES as readonly string[]).includes(value);
}

export function normalizeOperatingDomains(value: unknown): OperatingDomain[] {
  const values = Array.isArray(value) ? value.filter(isOperatingDomain) : [];
  return [...new Set(values)];
}

export function domainsForProfile(value: unknown): OperatingDomain[] {
  if (isOperatingProfileId(value)) return [...OPERATING_PROFILE_CATALOG[value].domains];
  return [...DEFAULT_OPERATING_DOMAINS];
}

export function transportModesForProfile(value: unknown): TransportMode[] {
  if (isOperatingProfileId(value)) return [...OPERATING_PROFILE_CATALOG[value].transportModes];
  return [...OPERATING_PROFILE_CATALOG[DEFAULT_OPERATING_PROFILE].transportModes];
}

export function normalizeTransportModes(value: unknown): TransportMode[] {
  const values = Array.isArray(value) ? value.filter(isTransportMode) : [];
  return [...new Set(values)];
}

/**
 * The operating profile is the server-owned source of truth. Browsers can
 * keep a previous profile's mode list in a PWA cache, so incompatible values
 * are reconciled instead of blocking onboarding or profile changes.
 */
export function resolveTransportModesForProfile(value: unknown, profile: unknown): TransportMode[] {
  const allowed = transportModesForProfile(profile);
  const requested = normalizeTransportModes(value);
  if (!requested.length) return allowed;
  const compatible = requested.filter((mode) => allowed.includes(mode));
  return compatible.length || !allowed.length ? compatible : allowed;
}

export function parseTransportModes(value: unknown, profile: unknown = DEFAULT_OPERATING_PROFILE): TransportMode[] {
  if (typeof value !== "string") return transportModesForProfile(profile);
  try {
    const parsed = JSON.parse(value) as unknown;
    return resolveTransportModesForProfile(parsed, profile);
  } catch {
    return transportModesForProfile(profile);
  }
}

export function transportModeAllowedForProfile(mode: TransportMode, profile: unknown): boolean {
  return transportModesForProfile(profile).includes(mode);
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

const CAPABILITY_DOMAIN_PREFIXES: Array<[string, OperatingDomain[]]> = [
  ["warehouse.", ["warehouse"]],
  ["mission.", ["transport"]],
  ["asset.", ["transport"]],
  ["operations.", ["operations"]],
  ["field.", ["operations"]],
  // Transport tenants must be able to read DDT/POD and other delivery
  // evidence even when they do not run a construction-operations profile.
  ["documents.", ["operations", "transport"]],
  ["finance.", ["operations"]],
  ["procurement.", ["operations"]],
];

/**
 * Workforce and planning are cross-domain control-plane capabilities. A
 * transport-only tenant still needs workforce records and planning; a
 * warehouse operator may also need attendance without being granted mission
 * access. Their visibility is therefore decided by the role capability set,
 * not by the operating profile's business domain filter.
 */
const CROSS_DOMAIN_CAPABILITY_PREFIXES = ["workforce.", "planning."] as const;

export function domainForCapability(capability: string): OperatingDomain[] | null {
  if (CROSS_DOMAIN_CAPABILITY_PREFIXES.some((prefix) => capability.startsWith(prefix))) return null;
  return CAPABILITY_DOMAIN_PREFIXES.find(([prefix]) => capability.startsWith(prefix))?.[1] ?? null;
}

export function filterCapabilitiesForDomains(
  capabilities: readonly string[],
  domains: readonly OperatingDomain[],
) {
  const enabled = new Set(domains);
  return capabilities.filter((capability) => {
    const domain = domainForCapability(capability);
    return !domain || domain.some((item) => enabled.has(item));
  });
}
