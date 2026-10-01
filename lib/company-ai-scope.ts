import type { CompanyAiKnowledgeHint } from "@/lib/company-ai-knowledge";

export const COMMESSA_TYPES = [
  { value: "NUOVA_COMMESSA", label: "Nuova commessa" },
  { value: "PRONTO_INTERVENTO", label: "Pronto intervento" },
] as const;

export type CommessaType = (typeof COMMESSA_TYPES)[number]["value"];

export type ScopeSubgroup = {
  id: string;
  title: string;
  keywords: string[];
};

export type ScopeGroup = {
  id: string;
  title: string;
  subgroups: ScopeSubgroup[];
};

export type ScopeSection = {
  id: string;
  title: string;
  knowledgePart: string;
  groups: ScopeGroup[];
};

export type CompanyAiScopeSelection = {
  level: "SUBGROUP";
  sectionId: string;
  sectionTitle: string;
  groupId: string;
  groupTitle: string;
  subgroupId: string;
  subgroupTitle: string;
  knowledgePart: string;
  knowledgeQuery: string;
};

export type CompanyAiScopeSuggestion = {
  selection: CompanyAiScopeSelection | null;
  score: number;
  source: "company-ai" | "manual";
  knowledgeHints: CompanyAiKnowledgeHint[];
};

/**
 * Stable navigation taxonomy for a commessa. It deliberately stops at a
 * generic subgroup: tariff rows remain Company AI context, never scope nodes.
 */
export const COMPANY_AI_SCOPE_TAXONOMY: ScopeSection[] = [
  {
    id: "A",
    title: "Opere edili",
    knowledgePart: "A",
    groups: [
      { id: "A-PREPARAZIONE", title: "Preparazioni e opere provvisionali", subgroups: [
        { id: "A-PREPARAZIONE-INDAGINI", title: "Indagini e verifiche", keywords: ["indagini", "prove", "verifiche"] },
        { id: "A-PREPARAZIONE-SCAVI", title: "Scavi, demolizioni e rimozioni", keywords: ["scavi", "demolizioni", "rimozioni"] },
        { id: "A-PREPARAZIONE-TRASPORTI", title: "Movimentazioni e trasporti", keywords: ["trasporti", "movimentazione", "macerie"] },
      ] },
      { id: "A-STRUTTURE", title: "Strutture e involucro", subgroups: [
        { id: "A-STRUTTURE-CALCESTRUZZO", title: "Strutture e conglomerati", keywords: ["calcestruzzo", "cemento", "strutture"] },
        { id: "A-STRUTTURE-MURATURE", title: "Murature e opere complementari", keywords: ["murature", "mattoni", "blocchi"] },
        { id: "A-STRUTTURE-COPERTURE", title: "Coperture e impermeabilizzazioni", keywords: ["tetti", "coperture", "impermeabilizzazioni"] },
      ] },
      { id: "A-FINITURE", title: "Finiture e ripristini", subgroups: [
        { id: "A-FINITURE-SUPERFICI", title: "Intonaci, superfici e rivestimenti", keywords: ["intonaci", "pavimenti", "rivestimenti"] },
        { id: "A-FINITURE-SERRAMENTI", title: "Serramenti e opere accessorie", keywords: ["infissi", "serramenti", "porte", "finestre"] },
        { id: "A-FINITURE-COMPLETAMENTI", title: "Tinteggiature e completamenti", keywords: ["tinteggiature", "verniciature", "finiture"] },
      ] },
    ],
  },
  {
    id: "B",
    title: "Opere stradali e infrastrutture a rete",
    knowledgePart: "B",
    groups: [
      { id: "B-PREPARAZIONE", title: "Preparazioni e movimento", subgroups: [
        { id: "B-PREPARAZIONE-SCAVI", title: "Scavi e reinterri", keywords: ["scavi", "reinterri", "movimento terra"] },
        { id: "B-PREPARAZIONE-TRASPORTI", title: "Trasporti e movimentazioni", keywords: ["trasporti", "carico", "movimentazione"] },
        { id: "B-PREPARAZIONE-SOTTOFONDI", title: "Sottofondi e preparazione", keywords: ["sottofondi", "rilevati", "sottofondazioni"] },
      ] },
      { id: "B-SUPERFICI", title: "Superfici e pavimentazioni", subgroups: [
        { id: "B-SUPERFICI-STRADALI", title: "Pavimentazioni e finiture stradali", keywords: ["pavimentazioni", "stradali", "asfalto"] },
        { id: "B-SUPERFICI-MARCIAPIEDI", title: "Marciapiedi e aree accessorie", keywords: ["marciapiedi", "cordoli", "aree"] },
        { id: "B-SUPERFICI-RIPRISTINI", title: "Ripristini e manutenzioni", keywords: ["ripristini", "manutenzione", "riparazione"] },
      ] },
      { id: "B-RETI", title: "Reti e opere complementari", subgroups: [
        { id: "B-RETI-IDRICHE", title: "Reti idriche e scarichi", keywords: ["acquedotti", "fognature", "reti idriche"] },
        { id: "B-RETI-PROTEZIONE", title: "Drenaggi e protezioni", keywords: ["drenaggi", "protezione", "sostegno"] },
        { id: "B-RETI-ACCESSORI", title: "Opere accessorie e completamenti", keywords: ["accessori", "completamenti", "opere"] },
      ] },
    ],
  },
  {
    id: "C",
    title: "Verde",
    knowledgePart: "C",
    groups: [
      { id: "C-AREE", title: "Sistemazione e preparazione aree", subgroups: [
        { id: "C-AREE-TERRENO", title: "Preparazione del terreno", keywords: ["terreno", "scavi", "preparazione"] },
        { id: "C-AREE-IMPIANTO", title: "Impianto e posa", keywords: ["impianto", "posa", "piantumazione"] },
        { id: "C-AREE-COMPLEMENTARI", title: "Opere complementari", keywords: ["arredi", "opere", "complementari"] },
      ] },
      { id: "C-MANUTENZIONE", title: "Manutenzione del verde", subgroups: [
        { id: "C-MANUTENZIONE-CURA", title: "Cura e potatura", keywords: ["potatura", "cura", "alberi"] },
        { id: "C-MANUTENZIONE-IRRIGAZIONE", title: "Irrigazione e gestione", keywords: ["irrigazione", "gestione", "acqua"] },
        { id: "C-MANUTENZIONE-RIPRISTINO", title: "Ripristino e sostituzioni", keywords: ["ripristino", "sostituzioni", "sostituzione"] },
      ] },
      { id: "C-SUPERFICI", title: "Superfici e aree attrezzate", subgroups: [
        { id: "C-SUPERFICI-PREPARAZIONE", title: "Preparazione delle superfici", keywords: ["superfici", "preparazione", "sottofondo"] },
        { id: "C-SUPERFICI-REALIZZAZIONE", title: "Realizzazione e posa", keywords: ["realizzazione", "posa", "impianti sportivi"] },
        { id: "C-SUPERFICI-MANUTENZIONE", title: "Manutenzione delle superfici", keywords: ["manutenzione", "superfici", "sportivi"] },
      ] },
    ],
  },
  {
    id: "D",
    title: "Impianti elettrici",
    knowledgePart: "D",
    groups: [
      { id: "D-DISTRIBUZIONE", title: "Distribuzione elettrica", subgroups: [
        { id: "D-DISTRIBUZIONE-QUADRI", title: "Quadri e protezioni", keywords: ["quadri", "protezioni", "elettrici"] },
        { id: "D-DISTRIBUZIONE-CAVI", title: "Cavi e canalizzazioni", keywords: ["cavi", "canalizzazioni", "condutture"] },
        { id: "D-DISTRIBUZIONE-CONNESSIONI", title: "Connessioni e apparecchi", keywords: ["prese", "interruttori", "connessioni"] },
      ] },
      { id: "D-ILLUMINAZIONE", title: "Illuminazione e continuità", subgroups: [
        { id: "D-ILLUMINAZIONE-ORDINARIA", title: "Illuminazione ordinaria", keywords: ["illuminazione", "lampade", "corpi illuminanti"] },
        { id: "D-ILLUMINAZIONE-TECNICA", title: "Illuminazione tecnica", keywords: ["illuminazione", "tecnica", "emergenza"] },
        { id: "D-ILLUMINAZIONE-PROTEZIONE", title: "Protezione e continuità", keywords: ["protezione", "continuità", "scariche"] },
      ] },
      { id: "D-CONTROLLO", title: "Comunicazione e controllo", subgroups: [
        { id: "D-CONTROLLO-SEGNALAZIONE", title: "Segnalazione e dati", keywords: ["segnalazione", "dati", "comunicazione"] },
        { id: "D-CONTROLLO-AUTOMAZIONE", title: "Automazione e gestione", keywords: ["automazione", "gestione", "controllo"] },
        { id: "D-CONTROLLO-VERIFICHE", title: "Prove e verifiche", keywords: ["prove", "verifiche", "collaudo"] },
      ] },
    ],
  },
  {
    id: "E",
    title: "Impianti tecnologici",
    knowledgePart: "E",
    groups: [
      { id: "E-CLIMA", title: "Climatizzazione e trattamento aria", subgroups: [
        { id: "E-CLIMA-GENERAZIONE", title: "Generazione e climatizzazione", keywords: ["caldaie", "condizionatori", "climatizzazione"] },
        { id: "E-CLIMA-DISTRIBUZIONE", title: "Distribuzione e canalizzazioni", keywords: ["condotte", "canalizzazioni", "distribuzione"] },
        { id: "E-CLIMA-CONTROLLO", title: "Regolazione e controllo", keywords: ["regolazione", "controllo", "termostati"] },
      ] },
      { id: "E-IDRICO", title: "Idrico-sanitario e gas", subgroups: [
        { id: "E-IDRICO-ADDUZIONE", title: "Adduzione e distribuzione", keywords: ["adduzione", "tubazioni", "distribuzione"] },
        { id: "E-IDRICO-SCARICHI", title: "Scarichi e apparecchi", keywords: ["scarichi", "apparecchi sanitari", "sanitari"] },
        { id: "E-IDRICO-SICUREZZA", title: "Sicurezza e collaudi", keywords: ["gas", "sicurezza", "collaudo"] },
      ] },
      { id: "E-SPECIALI", title: "Antincendio e sistemi speciali", subgroups: [
        { id: "E-SPECIALI-RILEVAZIONE", title: "Rilevazione e allarme", keywords: ["rilevazione", "allarme", "antincendio"] },
        { id: "E-SPECIALI-SPEGNIMENTO", title: "Spegnimento e protezione", keywords: ["spegnimento", "protezione", "antincendio"] },
        { id: "E-SPECIALI-COMPLEMENTARI", title: "Sistemi complementari", keywords: ["speciali", "accessori", "sistemi"] },
      ] },
    ],
  },
  {
    id: "F",
    title: "Opere marittime",
    knowledgePart: "F",
    groups: [
      { id: "F-PREPARAZIONE", title: "Preparazioni e movimentazioni", subgroups: [
        { id: "F-PREPARAZIONE-TAGLI", title: "Taglio, scavi e rimozioni", keywords: ["taglio", "scavi", "rimozioni"] },
        { id: "F-PREPARAZIONE-TRASPORTI", title: "Trasporti e movimentazioni", keywords: ["trasporti", "movimentazioni", "carico"] },
        { id: "F-PREPARAZIONE-DRENAGGI", title: "Drenaggi e riempimenti", keywords: ["drenaggi", "riempimenti", "pietrame"] },
      ] },
      { id: "F-OPERE", title: "Opere di protezione e contenimento", subgroups: [
        { id: "F-OPERE-SCOGLIERE", title: "Scogliere e protezioni", keywords: ["scogliere", "protezioni", "pietrame"] },
        { id: "F-OPERE-MODULARI", title: "Gabbionate e opere modulari", keywords: ["gabbionate", "gabbioni", "opere"] },
        { id: "F-OPERE-CALCESTRUZZO", title: "Conglomerati e finiture", keywords: ["conglomerati", "calcestruzzo", "cemento"] },
      ] },
      { id: "F-MANUTENZIONE", title: "Protezione e manutenzione", subgroups: [
        { id: "F-MANUTENZIONE-PROVVISIONALI", title: "Opere provvisionali", keywords: ["provvisionali", "ponteggi", "opere"] },
        { id: "F-MANUTENZIONE-PULIZIA", title: "Pulizia e lavaggi", keywords: ["pulizia", "lavaggio", "rivestimenti"] },
        { id: "F-MANUTENZIONE-RIPRISTINI", title: "Controlli e ripristini", keywords: ["controlli", "ripristini", "manutenzione"] },
      ] },
    ],
  },
  {
    id: "G",
    title: "Piccola manutenzione",
    knowledgePart: "G",
    groups: [
      { id: "G-RIMOZIONI", title: "Rimozioni e demolizioni", subgroups: [
        { id: "G-RIMOZIONI-DEMOLIZIONI", title: "Demolizioni", keywords: ["demolizioni", "demolizione"] },
        { id: "G-RIMOZIONI-RIMOZIONI", title: "Rimozioni", keywords: ["rimozioni", "rimozione"] },
        { id: "G-RIMOZIONI-SMALTIMENTI", title: "Smaltimenti e movimentazioni", keywords: ["smaltimenti", "macerie", "trasporto"] },
      ] },
      { id: "G-RIPRISTINI", title: "Ripristini e finiture", subgroups: [
        { id: "G-RIPRISTINI-MURATURE", title: "Murature e intonaci", keywords: ["murature", "intonaci", "intonaco"] },
        { id: "G-RIPRISTINI-SUPERFICI", title: "Pavimenti e rivestimenti", keywords: ["pavimenti", "rivestimenti", "piastrelle"] },
        { id: "G-RIPRISTINI-PROTEZIONI", title: "Impermeabilizzazioni e tinteggiature", keywords: ["impermeabilizzazioni", "tinteggiature", "vernici"] },
      ] },
      { id: "G-COMPONENTI", title: "Impianti e componenti", subgroups: [
        { id: "G-COMPONENTI-IDRICO", title: "Impianti idrici e sanitari", keywords: ["idrici", "sanitari", "tubazioni"] },
        { id: "G-COMPONENTI-ELETTRICO", title: "Impianti elettrici e accessori", keywords: ["elettrici", "prese", "accessori"] },
        { id: "G-COMPONENTI-INFISSI", title: "Infissi e completamenti", keywords: ["infissi", "serramenti", "completamenti"] },
      ] },
    ],
  },
  {
    id: "H",
    title: "Restauro",
    knowledgePart: "H",
    groups: [
      { id: "H-PREPARAZIONE", title: "Preparazione e protezione", subgroups: [
        { id: "H-PREPARAZIONE-ALLESTIMENTI", title: "Allestimenti e opere provvisionali", keywords: ["allestimenti", "provvisionali", "ponteggi"] },
        { id: "H-PREPARAZIONE-PULITURA", title: "Pulitura e rimozione", keywords: ["pulitura", "rimozione", "pulizia"] },
        { id: "H-PREPARAZIONE-INDAGINI", title: "Indagini e documentazione", keywords: ["indagini", "documentazione", "rilievo"] },
      ] },
      { id: "H-SUPERFICI", title: "Superfici e materiali", subgroups: [
        { id: "H-SUPERFICI-MURATURE", title: "Murature e intonaci", keywords: ["murature", "intonaci", "malte"] },
        { id: "H-SUPERFICI-PIETRA", title: "Pietra, laterizi e malte", keywords: ["pietra", "laterizi", "malte"] },
        { id: "H-SUPERFICI-LEGNO", title: "Legno e metalli", keywords: ["legno", "metalli", "metalliche"] },
      ] },
      { id: "H-CONSERVAZIONE", title: "Finiture e conservazione", subgroups: [
        { id: "H-CONSERVAZIONE-DECORAZIONI", title: "Decorazioni e superfici", keywords: ["decorazioni", "superfici", "dipinti"] },
        { id: "H-CONSERVAZIONE-CONSOLIDAMENTO", title: "Consolidamenti e protezioni", keywords: ["consolidamento", "consolidamenti", "protezioni"] },
        { id: "H-CONSERVAZIONE-RIPRISTINI", title: "Ripristini e completamenti", keywords: ["ripristini", "completamenti", "finiture"] },
      ] },
    ],
  },
  {
    id: "S",
    title: "Sicurezza",
    knowledgePart: "S",
    groups: [
      { id: "S-APPRESTAMENTI", title: "Apprestamenti di cantiere", subgroups: [
        { id: "S-APPRESTAMENTI-DELIMITAZIONI", title: "Recinzioni e delimitazioni", keywords: ["recinzioni", "delimitazioni", "cantiere"] },
        { id: "S-APPRESTAMENTI-SERVIZI", title: "Servizi e installazioni", keywords: ["servizi", "installazioni", "igienici"] },
        { id: "S-APPRESTAMENTI-PONTEGGI", title: "Ponteggi e opere provvisionali", keywords: ["ponteggi", "trabattelli", "provvisionali"] },
      ] },
      { id: "S-DISPOSITIVI", title: "Misure e dispositivi", subgroups: [
        { id: "S-DISPOSITIVI-MISURE", title: "Misure preventive e protettive", keywords: ["misure", "preventive", "protettive"] },
        { id: "S-DISPOSITIVI-DPI", title: "Dispositivi di protezione", keywords: ["dispositivi", "protezione", "dpi"] },
        { id: "S-DISPOSITIVI-SEGNALETICA", title: "Segnaletica e gestione", keywords: ["segnaletica", "cantiere", "gestione"] },
      ] },
      { id: "S-IMPIANTI", title: "Impianti di sicurezza", subgroups: [
        { id: "S-IMPIANTI-TERRA", title: "Impianti di terra e protezione", keywords: ["terra", "protezione", "impianti"] },
        { id: "S-IMPIANTI-ANTINCENDIO", title: "Antincendio", keywords: ["antincendio", "incendio", "spegnimento"] },
        { id: "S-IMPIANTI-EMERGENZA", title: "Emergenza e gestione", keywords: ["emergenza", "evacuazione", "fumi"] },
      ] },
    ],
  },
];

function normalize(value: string) {
  return value
    .toLocaleLowerCase("it-IT")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenSet(value: string) {
  return new Set(normalize(value).split(/\s+/).filter((token) => token.length > 2));
}

export function getCompanyAiScopeTaxonomy() {
  return COMPANY_AI_SCOPE_TAXONOMY;
}

export function resolveCompanyAiScopeSelection(input: { sectionId?: string; groupId?: string; subgroupId?: string }): CompanyAiScopeSelection | null {
  const section = COMPANY_AI_SCOPE_TAXONOMY.find((item) => item.id === input.sectionId);
  const group = section?.groups.find((item) => item.id === input.groupId);
  const subgroup = group?.subgroups.find((item) => item.id === input.subgroupId);
  if (!section || !group || !subgroup) return null;
  return {
    level: "SUBGROUP",
    sectionId: section.id,
    sectionTitle: section.title,
    groupId: group.id,
    groupTitle: group.title,
    subgroupId: subgroup.id,
    subgroupTitle: subgroup.title,
    knowledgePart: section.knowledgePart,
    knowledgeQuery: [section.title, group.title, subgroup.title, ...subgroup.keywords].join(" "),
  };
}

export function inferCompanyAiScopeSelection(source: string): { selection: CompanyAiScopeSelection; score: number } | null {
  const sourceTokens = tokenSet(source);
  if (!sourceTokens.size) return null;
  const candidates = COMPANY_AI_SCOPE_TAXONOMY.flatMap((section) => section.groups.flatMap((group) => group.subgroups.map((subgroup) => {
    const searchable = tokenSet([section.title, group.title, subgroup.title, ...subgroup.keywords].join(" "));
    const overlap = [...sourceTokens].filter((token) => searchable.has(token));
    const score = overlap.length + (sourceTokens.has(normalize(subgroup.title)) ? 2 : 0);
    return { selection: resolveCompanyAiScopeSelection({ sectionId: section.id, groupId: group.id, subgroupId: subgroup.id })!, score };
  })));
  const best = candidates.sort((left, right) => right.score - left.score || left.selection.subgroupId.localeCompare(right.selection.subgroupId))[0];
  return best && best.score > 0 ? best : null;
}

export function scopeSelectionToFields(selection: CompanyAiScopeSelection | null) {
  return selection ? {
    scopeSectionId: selection.sectionId,
    scopeGroupId: selection.groupId,
    scopeSubgroupId: selection.subgroupId,
  } : {
    scopeSectionId: "",
    scopeGroupId: "",
    scopeSubgroupId: "",
  };
}
