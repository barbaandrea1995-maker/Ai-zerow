import rawEntries from "@/knowledge/company-ai/tariffa-2023/entries.json";
import rawManifest from "@/knowledge/company-ai/tariffa-2023/manifest.json";
import type { CompanyAiScopeSelection } from "@/lib/company-ai-scope";

export type KnowledgeBreadcrumb = {
  code: string;
  title: string;
};

export type CompanyAiKnowledgeEntry = {
  id: string;
  packId: string;
  edition: number;
  part: string;
  partTitle: string;
  code: string;
  description: string;
  unit: string;
  price: number;
  currency: string;
  breadcrumbs: KnowledgeBreadcrumb[];
  source: { file: string; row: number };
};

export type CompanyAiKnowledgeHint = {
  id: string;
  code: string;
  part: string;
  partTitle: string;
  description: string;
  unit: string;
  price: number;
  currency: string;
  breadcrumbs: KnowledgeBreadcrumb[];
  score: number;
};

export type CompanyAiKnowledgePackSummary = {
  id: string;
  name: string;
  version: string;
  language: string;
  authority: string;
  purpose: string;
  entryCount: number;
  parts: Array<{ part: string; title: string; entryCount: number }>;
  scopeContract: {
    linkKey: string;
    scopeField: string;
    contextEntryField: string;
    requiredHumanConfirmation: boolean;
  };
};

type PackManifest = {
  id: string;
  name: string;
  version: string;
  language: string;
  authority: string;
  purpose: string;
  counts: { entries: number };
  parts: Array<{ part: string; title: string; pricedEntries: number }>;
  scopeContract: {
    linkKey: string;
    scopeField?: string;
    contextEntryField?: string;
    selectedEntryField?: string;
    requiredHumanConfirmation: boolean;
  };
};

const manifest = rawManifest as PackManifest;
const entries = rawEntries as CompanyAiKnowledgeEntry[];

export const COMPANY_AI_KNOWLEDGE_PACK_ID = manifest.id;

const STOP_WORDS = new Set([
  "al", "alla", "allo", "agli", "ai", "a", "ad", "da", "dal", "dalla", "di", "del", "della", "dei", "degli", "de", "e", "ed", "in", "nel", "nella", "nei", "con", "per", "su", "tra", "fra", "il", "lo", "la", "i", "gli", "le", "un", "una", "uno", "che", "come", "sono", "del", "delle", "dell", "ogni", "circa", "anche",
]);

function normalize(value: string) {
  return value
    .toLocaleLowerCase("it-IT")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9.]+/g, " ")
    .trim();
}

function tokens(value: string) {
  return [...new Set(normalize(value).split(/\s+/).filter((token) => token.length > 1 && !STOP_WORDS.has(token)))]
    .sort((left, right) => right.length - left.length)
    .slice(0, 40);
}

export function getCompanyAiKnowledgePackSummary(): CompanyAiKnowledgePackSummary {
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    language: manifest.language,
    authority: manifest.authority,
    purpose: manifest.purpose,
    entryCount: manifest.counts.entries,
    parts: manifest.parts.map((part) => ({ part: part.part, title: part.title, entryCount: part.pricedEntries })),
    scopeContract: {
      linkKey: manifest.scopeContract.linkKey,
      scopeField: manifest.scopeContract.scopeField ?? "scopeSubgroupId",
      contextEntryField: manifest.scopeContract.contextEntryField ?? manifest.scopeContract.selectedEntryField ?? "knowledgeContextEntryIds",
      requiredHumanConfirmation: manifest.scopeContract.requiredHumanConfirmation,
    },
  };
}

function hint(entry: CompanyAiKnowledgeEntry, score: number): CompanyAiKnowledgeHint {
  return {
    id: entry.id,
    code: entry.code,
    part: entry.part,
    partTitle: entry.partTitle,
    description: entry.description,
    unit: entry.unit,
    price: entry.price,
    currency: entry.currency,
    breadcrumbs: entry.breadcrumbs,
    score: Math.round(score * 100) / 100,
  };
}

export function toCompanyAiKnowledgeHint(entry: CompanyAiKnowledgeEntry): CompanyAiKnowledgeHint {
  return hint(entry, 0);
}

export function searchCompanyAiKnowledge(query: string, options: { part?: string; limit?: number } = {}) {
  const requestedLimit = Number.isFinite(options.limit) ? Number(options.limit) : 8;
  const limit = Math.min(24, Math.max(1, Math.round(requestedLimit)));
  const part = options.part?.trim().toUpperCase();
  const queryTokens = tokens(query);
  const candidates = part ? entries.filter((entry) => entry.part === part) : entries;
  if (!queryTokens.length) return candidates.slice(0, limit).map((entry) => hint(entry, 0));

  const normalizedQuery = normalize(query).replace(/\s+/g, "");
  return candidates
    .map((entry) => {
      const code = normalize(entry.code).replace(/\s+/g, "");
      const description = normalize(entry.description);
      const partTitle = normalize(`${entry.part} ${entry.partTitle}`);
      const breadcrumbText = normalize(entry.breadcrumbs.map((item) => `${item.code} ${item.title}`).join(" "));
      const searchable = `${description} ${partTitle} ${breadcrumbText}`;
      let score = 0;
      if (code === normalizedQuery) score += 180;
      if (code.includes(normalizedQuery) && normalizedQuery.length > 2) score += 70;
      for (const token of queryTokens) {
        if (code.includes(token)) score += 32;
        if (description.includes(token)) score += 12;
        if (partTitle.includes(token)) score += 7;
        if (breadcrumbText.includes(token)) score += 5;
      }
      const matchedTokens = queryTokens.filter((token) => searchable.includes(token)).length;
      score += matchedTokens / Math.max(queryTokens.length, 1) * 18;
      return { entry, score };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.entry.id.localeCompare(right.entry.id))
    .slice(0, limit)
    .map((item) => hint(item.entry, item.score));
}

export function searchCompanyAiKnowledgeForScope(selection: CompanyAiScopeSelection, limit = 8) {
  return searchCompanyAiKnowledge(selection.knowledgeQuery, {
    part: selection.knowledgePart,
    limit,
  });
}

export function resolveCompanyAiKnowledgeEntries(ids: string[]) {
  const requested = new Set(ids.map((id) => id.trim()).filter(Boolean));
  return entries.filter((entry) => requested.has(entry.id));
}

export function companyAiKnowledgeEntryCount() {
  return entries.length;
}
