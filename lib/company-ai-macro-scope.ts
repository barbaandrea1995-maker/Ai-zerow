/**
 * Server-owned, tenant-neutral macro scope catalog and validation rules.
 * The active catalog is returned by the authenticated preview endpoint; the
 * browser never decides which identifiers are valid.
 */
export const COMPANY_AI_MACRO_SCOPE_VERSION = "2.0.0";

export const COMPANY_AI_MACRO_SCOPE_GROUPS = [
  {
    id: "EDILIZIA_IMMOBILI",
    label: "Edilizia e immobili",
    about: "Opere su fabbricati, locali e relative componenti edilizie.",
    examples: ["ristrutturazione", "murature", "facciate", "coperture", "finiture"],
  },
  {
    id: "STRADE_PAVIMENTAZIONI",
    label: "Strade e pavimentazioni",
    about: "Opere sulle superfici destinate a transito e utilizzo esterno.",
    examples: ["marciapiedi", "asfalto", "cordoli", "strade", "piazzali"],
  },
  {
    id: "SCAVI_SOTTOSERVIZI",
    label: "Scavi e sottoservizi",
    about: "Interventi sul terreno e su reti e manufatti interrati.",
    examples: ["scavi", "movimento terra", "pozzetti", "fognature", "drenaggi"],
  },
  {
    id: "IMPIANTI",
    label: "Impianti",
    about: "Impianti e servizi tecnici degli immobili e delle strutture.",
    examples: ["idraulica interna", "elettrico", "riscaldamento", "climatizzazione", "impianti tecnologici"],
  },
  {
    id: "VERDE_ESTERNI",
    label: "Verde e sistemazioni esterne",
    about: "Interventi su aree verdi e spazi esterni non classificabili prevalentemente come opere stradali.",
    examples: ["giardini", "aiuole", "sistemazioni esterne", "recinzioni", "verde"],
  },
] as const;

export const COMPANY_AI_MACRO_SCOPE_FALLBACK = {
  id: "ALTRO_DA_CLASSIFICARE",
  label: "Altro / da classificare",
  about: "Non forzare una corrispondenza; conservare la descrizione originale.",
} as const;

export type CompanyAiMacroScopeGroupId = (typeof COMPANY_AI_MACRO_SCOPE_GROUPS)[number]["id"];
export type CompanyAiMacroScopeId = CompanyAiMacroScopeGroupId | typeof COMPANY_AI_MACRO_SCOPE_FALLBACK.id;
export type CompanyAiMacroScopeStatus = "DA_CONFERMARE" | "CONFERMATO";

export type CompanyAiMacroScopeActivity = {
  id: string;
  text: string;
  source: string;
  groupIds: CompanyAiMacroScopeGroupId[];
  status: "PROPOSTA" | "CONFERMATA" | "ESCLUSA";
};

export type CompanyAiMacroScopeProposal = {
  schemaVersion: 2;
  catalogVersion: string;
  descriptionOriginal: string;
  groupsProposed: CompanyAiMacroScopeId[];
  groupEvidence: Array<{ groupId: CompanyAiMacroScopeId; source: string }>;
  activitiesProposed: CompanyAiMacroScopeActivity[];
  reportedProblems: Array<{ text: string; source: string }>;
  completedWork: Array<{ text: string; source: string }>;
  clarifications: string[];
  scopeStatus: "DA_CONFERMARE";
};

export type CompanyAiMacroScopeCatalog = {
  version: string;
  tenantNeutral: true;
  enabledGroups: Array<{ id: CompanyAiMacroScopeGroupId; label: string; about: string; examples: readonly string[] }>;
  fallback: typeof COMPANY_AI_MACRO_SCOPE_FALLBACK;
};

export type CompanyAiMacroScopeConfirmation = {
  schemaVersion: 2;
  catalogVersion: string;
  status: "CONFERMATO";
  descriptionOriginal: string;
  proposal: CompanyAiMacroScopeProposal;
  groupsConfirmed: CompanyAiMacroScopeId[];
  activitiesConfirmed: CompanyAiMacroScopeActivity[];
  reportedProblems: Array<{ text: string; source: string }>;
  completedWork: Array<{ text: string; source: string }>;
  clarifications: string[];
  changes: {
    groupsAdded: CompanyAiMacroScopeId[];
    groupsRemoved: CompanyAiMacroScopeId[];
    activitiesEdited: Array<{ id: string; before: string; after: string }>;
    activitiesExcluded: string[];
  };
  confirmedBy: string;
  confirmedAt: string;
};

export type CompanyAiMacroScopeWorkItem = {
  id: string;
  label: string;
  detail: string;
  quantity: string;
  unit: string;
  confidence: number;
  source: string;
  macroGroupIds: CompanyAiMacroScopeId[];
  macroGroupLabels: string[];
  evidence: string;
  proposalStatus: "CONFERMATA";
};

export type CompanyAiMacroScopeConfirmationResult = {
  confirmation: CompanyAiMacroScopeConfirmation;
  workItems: CompanyAiMacroScopeWorkItem[];
};

export function getCompanyAiMacroScopeCatalog(tenantId?: string): CompanyAiMacroScopeCatalog {
  void tenantId;
  // All five neutral seed groups are enabled for every tenant in V2. The
  // returned list is authoritative for the API request; a tenant-specific
  // registry can replace this resolver without changing the UI contract.
  return {
    version: COMPANY_AI_MACRO_SCOPE_VERSION,
    tenantNeutral: true,
    enabledGroups: [...COMPANY_AI_MACRO_SCOPE_GROUPS],
    fallback: COMPANY_AI_MACRO_SCOPE_FALLBACK,
  };
}

export function isCompanyAiMacroScopeId(value: unknown, catalog = getCompanyAiMacroScopeCatalog()): value is CompanyAiMacroScopeId {
  return typeof value === "string"
    && (value === catalog.fallback.id || catalog.enabledGroups.some((group) => group.id === value));
}

function normalizeForEvidence(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("it-IT").replace(/\s+/g, " ").trim();
}

export function evidenceOccursInDescription(evidence: string, description: string) {
  const needle = normalizeForEvidence(evidence);
  return Boolean(needle) && normalizeForEvidence(description).includes(needle);
}

const GROUP_SIGNALS: Array<{ id: CompanyAiMacroScopeGroupId; pattern: RegExp }> = [
  { id: "EDILIZIA_IMMOBILI", pattern: /\b(?:palazzin\w*|edific\w*|immobil\w*|ristrutturazion\w*|muratur\w*|facciat\w*|copertur\w*|tett\w*|intonac\w*|vetri?|serrament\w*|local\w*)\b/i },
  { id: "STRADE_PAVIMENTAZIONI", pattern: /\b(?:marciapied\w*|asfalt\w*|cordol\w*|strad\w*|piazzal\w*|pavimentazion\w*)\b/i },
  { id: "SCAVI_SOTTOSERVIZI", pattern: /\b(?:scav\w*|pozzett\w*|fognatur\w*|drenagg\w*|sottoserviz\w*|movimento terra)\b/i },
  { id: "IMPIANTI", pattern: /\b(?:impiant\w*|idraulic\w*|elettric\w*|riscaldament\w*|climatizzazion\w*|calda\w*|perdita|lavell\w*|tubazion\w*)\b/i },
  { id: "VERDE_ESTERNI", pattern: /\b(?:giardin\w*|aiuol\w*|verde|recinzion\w*|taglio erba|potatur\w*|sistemazion\w* estern\w*)\b/i },
];

function exactSignal(description: string, pattern: RegExp) {
  return description.match(pattern)?.[0] ?? "";
}

export function inferCompanyAiMacroScopeGroups(description: string, catalog = getCompanyAiMacroScopeCatalog()) {
  const groups: CompanyAiMacroScopeId[] = GROUP_SIGNALS.flatMap(({ id, pattern }) => {
    if (!catalog.enabledGroups.some((item) => item.id === id)) return [];
    return pattern.test(description) ? [id] : [];
  });
  return {
    groups: groups.length ? groups : [catalog.fallback.id],
    evidence: groups.flatMap((id) => {
      const pattern = GROUP_SIGNALS.find((signal) => signal.id === id)?.pattern;
      const source = pattern ? exactSignal(description, pattern) : "";
      return source ? [{ groupId: id, source }] : [];
    }),
  };
}

const ACTION_SIGNAL = /\b(?:allargament\w*|sistemazion\w*|sistemar\w*|taglio|potatur\w*|rifaciment\w*|riparazion\w*|riparar\w*|sostituzion\w*|sostituir\w*|pos\w*|installazion\w*|installar\w*|demolizion\w*|realizzazion\w*|impermeabilizzazion\w*|ripristin\w*|tinteggiatur\w*|scav\w*|costruzion\w*|imbianc\w*)\b/i;
const PROBLEM_SIGNAL = /\b(?:perdita|guasto|rott\w*|infiltrazion\w*|cediment\w*|blocc\w*|problema)\b/i;
const COMPLETED_SIGNAL = /\b(?:eseguit\w*|completat\w*|realizzat\w*|riparat\w*|installat\w*|consegnat\w*)\b/i;

function sentenceFragments(description: string) {
  return description
    .split(/\n+|(?<=[.!?;])\s+/)
    .flatMap((sentence) => sentence.split(/\s+(?:e|ed)\s+/i))
    .map((part) => part.replace(/^\s*[-•·▪◦]+\s*/, "").replace(/[.!?;]+$/, "").trim())
    .filter(Boolean)
    .slice(0, 24);
}

function workGroupIds(fragment: string, groups: CompanyAiMacroScopeId[]) {
  return GROUP_SIGNALS
    .filter(({ id, pattern }) => groups.includes(id) && pattern.test(fragment))
    .map(({ id }) => id);
}

export function deterministicCompanyAiMacroScopeProposal(description: string, catalog = getCompanyAiMacroScopeCatalog()): CompanyAiMacroScopeProposal {
  const inferred = inferCompanyAiMacroScopeGroups(description, catalog);
  const fragments = sentenceFragments(description);
  const completedWork = fragments.filter((part) => COMPLETED_SIGNAL.test(part)).map((text) => ({ text, source: text }));
  const problemFragments = fragments.filter((part) => PROBLEM_SIGNAL.test(part) && !ACTION_SIGNAL.test(part) && !COMPLETED_SIGNAL.test(part));
  const activities = fragments.filter((part) => ACTION_SIGNAL.test(part) && !COMPLETED_SIGNAL.test(part));
  const activitiesProposed = activities.map((source, index) => ({
    id: `macro-work-${index + 1}`,
    text: source.charAt(0).toLocaleUpperCase("it-IT") + source.slice(1),
    source,
    groupIds: workGroupIds(source, inferred.groups),
    status: "PROPOSTA" as const,
  }));
  const reportedProblems = problemFragments.map((text) => ({ text, source: text }));
  return {
    schemaVersion: 2,
    catalogVersion: catalog.version,
    descriptionOriginal: description,
    groupsProposed: inferred.groups,
    groupEvidence: inferred.evidence,
    activitiesProposed,
    reportedProblems,
    completedWork,
    clarifications: inferred.groups.some((id) => id === catalog.fallback.id) ? ["Ambito da precisare: la descrizione non identifica un macrogruppo del catalogo."] : [],
    scopeStatus: "DA_CONFERMARE",
  };
}

export function normalizeCompanyAiMacroScopeProposal(
  description: string,
  raw: unknown,
  catalog = getCompanyAiMacroScopeCatalog(),
): CompanyAiMacroScopeProposal {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return deterministicCompanyAiMacroScopeProposal(description, catalog);
  const candidate = raw as Record<string, unknown>;
  const groupsRaw = Array.isArray(candidate.groups) ? candidate.groups : [];
  const groupEvidence = groupsRaw.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const group = item as Record<string, unknown>;
    const groupId = group.id;
    const source = typeof group.evidence === "string" ? group.evidence.trim().slice(0, 240) : "";
    if (!isCompanyAiMacroScopeId(groupId, catalog)) return [];
    if (groupId === catalog.fallback.id || evidenceOccursInDescription(source, description)) return [{ groupId, source }];
    return [];
  }).slice(0, 6);
  let groupsProposed = [...new Set(groupEvidence.map((item) => item.groupId))];
  if (!groupsProposed.length) {
    const inferred = inferCompanyAiMacroScopeGroups(description, catalog);
    groupsProposed = inferred.groups;
    groupEvidence.push(...inferred.evidence);
  }
  const activityCandidates = Array.isArray(candidate.activities) ? candidate.activities : [];
  const activitiesProposed = activityCandidates.flatMap((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const activity = item as Record<string, unknown>;
    const source = typeof activity.source === "string" ? activity.source.trim().slice(0, 240) : "";
    const label = typeof activity.text === "string" ? activity.text.trim().slice(0, 180) : "";
    if (!source || !label || !evidenceOccursInDescription(source, description)) return [];
    if (!ACTION_SIGNAL.test(source)) return [];
    if (PROBLEM_SIGNAL.test(source) && !ACTION_SIGNAL.test(source)) return [];
    const groupIds = Array.isArray(activity.groupIds)
      ? [...new Set(activity.groupIds.filter((id): id is CompanyAiMacroScopeGroupId =>
        typeof id === "string" && catalog.enabledGroups.some((group) => group.id === id) && groupsProposed.includes(id as CompanyAiMacroScopeId),
      ))]
      : workGroupIds(source, groupsProposed);
    if (COMPLETED_SIGNAL.test(source) && !/\b(?:da eseguire|da completare|previst\w*|programm\w*)\b/i.test(source)) {
      return [];
    }
    return [{ id: `macro-work-${index + 1}`, text: label, source, groupIds, status: "PROPOSTA" as const }];
  }).slice(0, 24);
  const reportedProblems = evidenceList(candidate.reportedProblems, description, 12)
    .filter((item) => PROBLEM_SIGNAL.test(item.source) && !ACTION_SIGNAL.test(item.source));
  const completedWork = evidenceList(candidate.completedWork, description, 12)
    .filter((item) => COMPLETED_SIGNAL.test(item.source));
  const clarifications = stringList(candidate.clarifications, 12, 240);
  if (groupsProposed.includes(catalog.fallback.id) && !clarifications.length) {
    clarifications.push("Ambito da precisare: la descrizione non identifica un macrogruppo del catalogo.");
  }
  return {
    schemaVersion: 2,
    catalogVersion: catalog.version,
    descriptionOriginal: description,
    groupsProposed,
    groupEvidence,
    activitiesProposed,
    reportedProblems,
    completedWork,
    clarifications,
    scopeStatus: "DA_CONFERMARE",
  };
}

export function confirmCompanyAiMacroScopeProposal({
  proposal,
  submitted,
  catalog = getCompanyAiMacroScopeCatalog(),
  actorId,
  confirmedAt,
}: {
  proposal: CompanyAiMacroScopeProposal;
  submitted: unknown;
  catalog?: CompanyAiMacroScopeCatalog;
  actorId: string;
  confirmedAt: string;
}): CompanyAiMacroScopeConfirmationResult | null {
  if (!submitted || typeof submitted !== "object" || Array.isArray(submitted)) return null;
  const input = submitted as Record<string, unknown>;
  if (input.confirmed !== true || input.descriptionOriginal !== proposal.descriptionOriginal) return null;
  const rawGroups = Array.isArray(input.groupsConfirmed) ? input.groupsConfirmed : [];
  const groupsConfirmed = [...new Set(rawGroups.filter((value): value is CompanyAiMacroScopeId => isCompanyAiMacroScopeId(value, catalog)))];
  if (!groupsConfirmed.length || (groupsConfirmed.includes(catalog.fallback.id) && groupsConfirmed.length > 1)) return null;
  if (rawGroups.length !== groupsConfirmed.length || rawGroups.length > catalog.enabledGroups.length + 1) return null;

  const rawActivities = Array.isArray(input.activities) ? input.activities : [];
  if (rawActivities.length > 24) return null;
  const proposalById = new Map(proposal.activitiesProposed.map((activity) => [activity.id, activity]));
  const seenSources = new Set<string>();
  const activitiesConfirmed = rawActivities.flatMap((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const activity = value as Record<string, unknown>;
    const id = typeof activity.id === "string" ? activity.id.trim().slice(0, 80) : `human-${index + 1}`;
    const text = typeof activity.text === "string" ? activity.text.trim().slice(0, 180) : "";
    const source = typeof activity.source === "string" ? activity.source.trim().slice(0, 240) : "";
    const included = activity.included !== false;
    if (!id || text.length < 2 || !source || !evidenceOccursInDescription(source, proposal.descriptionOriginal)) return [];
    if (seenSources.has(normalizeForEvidence(source))) return [];
    seenSources.add(normalizeForEvidence(source));
    const base = proposalById.get(id);
    if (!base) return [];
    const rawGroupIds = Array.isArray(activity.groupIds) ? activity.groupIds : base?.groupIds ?? [];
    const groupIds = [...new Set(rawGroupIds.filter((groupId): groupId is CompanyAiMacroScopeGroupId =>
      typeof groupId === "string"
      && groupsConfirmed.includes(groupId as CompanyAiMacroScopeId)
      && catalog.enabledGroups.some((group) => group.id === groupId),
    ))];
    if (!groupIds.length && groupsConfirmed.length === 1 && groupsConfirmed[0] !== catalog.fallback.id) {
      groupIds.push(groupsConfirmed[0] as CompanyAiMacroScopeGroupId);
    }
    return [{
      id,
      text,
      source,
      groupIds,
      status: included ? "CONFERMATA" as const : "ESCLUSA" as const,
    }];
  });
  if (activitiesConfirmed.length !== rawActivities.length) return null;

  const originalGroups = proposal.groupsProposed;
  const originalActivities = new Map(proposal.activitiesProposed.map((activity) => [activity.id, activity]));
  const changes = {
    groupsAdded: groupsConfirmed.filter((id) => !originalGroups.includes(id)),
    groupsRemoved: originalGroups.filter((id) => !groupsConfirmed.includes(id)),
    activitiesEdited: activitiesConfirmed.flatMap((activity) => {
      const before = originalActivities.get(activity.id);
      return before && before.text !== activity.text ? [{ id: activity.id, before: before.text, after: activity.text }] : [];
    }),
    activitiesExcluded: activitiesConfirmed.filter((activity) => activity.status === "ESCLUSA").map((activity) => activity.id),
  };
  const confirmation: CompanyAiMacroScopeConfirmation = {
    schemaVersion: 2,
    catalogVersion: catalog.version,
    status: "CONFERMATO",
    descriptionOriginal: proposal.descriptionOriginal,
    proposal,
    groupsConfirmed,
    activitiesConfirmed,
    reportedProblems: proposal.reportedProblems,
    completedWork: proposal.completedWork,
    clarifications: proposal.clarifications,
    changes,
    confirmedBy: actorId,
    confirmedAt,
  };
  const workItems = activitiesConfirmed.filter((activity) => activity.status === "CONFERMATA").map((activity, index) => ({
    id: activity.id || `macro-work-${index + 1}`,
    label: activity.text,
    detail: activity.text,
    quantity: "",
    unit: "",
    confidence: 1,
    source: "company-ai-macro-scope-v2-confirmed",
    macroGroupIds: activity.groupIds,
    macroGroupLabels: activity.groupIds.flatMap((id) => catalog.enabledGroups.filter((group) => group.id === id).map((group) => group.label)),
    evidence: activity.source,
    proposalStatus: "CONFERMATA" as const,
  }));
  return { confirmation, workItems };
}

function evidenceList(value: unknown, description: string, limit: number) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    const source = typeof row.source === "string" ? row.source.trim().slice(0, 240) : "";
    const text = typeof row.text === "string" ? row.text.trim().slice(0, 180) : "";
    return source && text && evidenceOccursInDescription(source, description) ? [{ text, source }] : [];
  }).slice(0, limit);
}

function stringList(value: unknown, limit: number, maxLength: number) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim().slice(0, maxLength)).filter(Boolean))].slice(0, limit);
}
