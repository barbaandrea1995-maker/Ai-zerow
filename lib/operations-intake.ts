import type { JobStatusCode, JobWorkItem } from "@/lib/operations-contract";
import type { JobCommercialModel } from "@/lib/job-commercial-terms";
import type { CompanyAiKnowledgeHint, CompanyAiKnowledgePackSummary } from "@/lib/company-ai-knowledge";
import { COMMESSA_TYPES, type CompanyAiScopeSuggestion, type CommessaType } from "@/lib/company-ai-scope";

export type IntakeMode = "MANUAL" | "COMPANY_AI";

export type IntakeWorkItem = JobWorkItem;

export type IntakeCommercialCatalog = {
  openingTypes: Array<{ value: CommessaType; label: string }>;
  pricingModels: Array<{ value: JobCommercialModel; label: string; description: string }>;
  valueBases: Array<{ value: "ESTIMATE" | "CONTRACTED"; label: string }>;
  currency: "EUR";
  authority: "SERVER_CONTRACT";
};

export type IntakeDraft = {
  title: string;
  statusCode: JobStatusCode;
  openingType: CommessaType;
  scopeSectionId: string;
  scopeGroupId: string;
  scopeSubgroupId: string;
  description: string;
  workItems: IntakeWorkItem[];
  clientName: string;
  clientTaxId: string;
  clientContact: string;
  clientPhone: string;
  clientEmail: string;
  clientReference: string;
  clientAddress: string;
  worksite: string;
  accessNotes: string;
  cig: string;
  cup: string;
  dueDate: string;
  priority: "HIGH" | "STANDARD" | "LOW";
  workItemsText: string;
  commercialModel: JobCommercialModel;
  commercialValueAmount: string;
  commercialValueBasis: "ESTIMATE" | "CONTRACTED";
};

export type IntakeSuggestion = {
  key: keyof IntakeDraft;
  label: string;
  value: string;
  confidence: number;
  source: string;
};

export type IntakePreview = {
  previewId: string;
  mode: IntakeMode;
  directWrite: false;
  runtime: string;
  aiRuntime?: {
    provider: "openai";
    status: "used" | "not_configured" | "unavailable";
    model: string;
    requestId?: string | null;
  };
  draft: Partial<IntakeDraft>;
  suggestions: IntakeSuggestion[];
  sourceName?: string;
  workItems?: IntakeWorkItem[];
  knowledgePack?: CompanyAiKnowledgePackSummary;
  knowledgeHints?: CompanyAiKnowledgeHint[];
  scopeSuggestion?: CompanyAiScopeSuggestion;
};

export type IntakeAdapterRecord = {
  id: string;
  canonicalCode?: string;
  title: string;
  detail: string;
  meta: string;
  status: string;
  progress: number;
  payload?: Record<string, unknown>;
};

export type IntakeCreateResponse = {
  created?: IntakeAdapterRecord;
  records?: IntakeAdapterRecord[];
};

export const DEFAULT_INTAKE_DRAFT: IntakeDraft = {
  title: "",
  statusCode: "DRAFT",
  openingType: "NUOVA_COMMESSA",
  scopeSectionId: "",
  scopeGroupId: "",
  scopeSubgroupId: "",
  description: "",
  workItems: [],
  clientName: "",
  clientTaxId: "",
  clientContact: "",
  clientPhone: "",
  clientEmail: "",
  clientReference: "",
  clientAddress: "",
  worksite: "",
  accessNotes: "",
  cig: "",
  cup: "",
  dueDate: "",
  priority: "STANDARD",
  workItemsText: "",
  commercialModel: "UNDEFINED",
  commercialValueAmount: "",
  commercialValueBasis: "ESTIMATE",
};

export const INTAKE_OPENING_TYPES = COMMESSA_TYPES;

export const INTAKE_FIELD_LABELS: Record<keyof IntakeDraft, string> = {
  title: "Nome commessa",
  statusCode: "Stato",
  openingType: "Tipo commessa",
  scopeSectionId: "Sezione",
  scopeGroupId: "Raggruppamento",
  scopeSubgroupId: "Sottogruppo",
  description: "Descrizione",
  workItems: "Lavorazioni rilevate",
  clientName: "Cliente / ragione sociale",
  clientTaxId: "P. IVA / codice fiscale",
  clientContact: "Referente cliente",
  clientPhone: "Tel. cliente",
  clientEmail: "E-mail cliente",
  clientReference: "Riferimento cliente / preventivo",
  clientAddress: "Sede / indirizzo cliente",
  worksite: "Luogo di intervento",
  accessNotes: "Note accesso / cantiere",
  cig: "CIG",
  cup: "CUP",
  dueDate: "Scadenza operativa",
  priority: "Priorità",
  workItemsText: "Lavorazioni",
  commercialModel: "Modalità economica",
  commercialValueAmount: "Importo commerciale",
  commercialValueBasis: "Base del valore",
};
