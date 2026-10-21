export const JOB_COMMERCIAL_MODELS = [
  {
    value: "UNDEFINED",
    label: "Da definire",
    description: "La commessa nasce senza attribuire un totale o un criterio economico non ancora concordato.",
  },
  {
    value: "FIXED_TOTAL",
    label: "Totale complessivo",
    description: "Un unico valore preventivato o accordato copre l’intera commessa.",
  },
  {
    value: "PER_WORK_ORDER",
    label: "Per lavorazione / intervento",
    description: "Ogni lavorazione autorizzata ha il proprio valore; non viene inventato un totale generale.",
  },
  {
    value: "TIME_AND_MATERIAL",
    label: "A consuntivo",
    description: "Il valore deriva da ore, materiali, mezzi o altre voci effettivamente confermate.",
  },
  {
    value: "MIXED",
    label: "Misto: base + extra",
    description: "Un canone o importo base può convivere con lavorazioni valorizzate separatamente.",
  },
] as const;

export const JOB_COMMERCIAL_VALUE_BASES = [
  { value: "ESTIMATE", label: "Preventivato" },
  { value: "CONTRACTED", label: "Accordato / contrattualizzato" },
] as const;

export type JobCommercialModel = (typeof JOB_COMMERCIAL_MODELS)[number]["value"];
export type JobCommercialValueBasis = (typeof JOB_COMMERCIAL_VALUE_BASES)[number]["value"];
export type JobWorkOrderStatus = "DRAFT" | "APPROVED" | "COMPLETED" | "CANCELLED";

export type JobCommercialTerms = {
  model: JobCommercialModel;
  currency: "EUR";
  basis: JobCommercialValueBasis;
  baseAmountMinor: number | null;
  version: number;
  effectiveAt: string;
  source: string;
};

export type CommercialJourneyRecord = {
  id: string;
  recordType: string;
  title: string;
  status: string;
  version: number;
  payloadJson: string;
  updatedAt: string;
};

export type JobWorkOrderProjection = {
  id: string;
  title: string;
  description: string;
  status: JobWorkOrderStatus;
  version: number;
  updatedAt: string;
  value: null | {
    amountMinor: number;
    currency: "EUR";
    basis: JobCommercialValueBasis;
    version: number;
    updatedAt: string;
  };
};

export type JobWorkOrderEconomics = {
  status: "NOT_AVAILABLE" | "PARTIAL" | "AVAILABLE";
  currency: "EUR";
  counts: { total: number; draft: number; approved: number; completed: number; cancelled: number };
  proposedMinor: number | null;
  approvedMinor: number | null;
  completedMinor: number | null;
  workOrders: JobWorkOrderProjection[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseRecord(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function safeMinor(value: unknown) {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= 100_000_000_000
    ? value
    : null;
}

export function isJobCommercialModel(value: unknown): value is JobCommercialModel {
  return typeof value === "string" && JOB_COMMERCIAL_MODELS.some((option) => option.value === value);
}

export function isJobCommercialValueBasis(value: unknown): value is JobCommercialValueBasis {
  return value === "ESTIMATE" || value === "CONTRACTED";
}

export function jobCommercialCatalog() {
  return {
    pricingModels: JOB_COMMERCIAL_MODELS.map((option) => ({ ...option })),
    valueBases: JOB_COMMERCIAL_VALUE_BASES.map((option) => ({ ...option })),
    currency: "EUR" as const,
    authority: "SERVER_CONTRACT" as const,
  };
}

export function normalizeJobCommercialTerms(value: unknown, legacyValue?: unknown): JobCommercialTerms {
  const candidate = isRecord(value) ? value : {};
  const legacy = isRecord(legacyValue) ? legacyValue : {};
  const legacyAmount = safeMinor(legacy.amountMinor);
  const model = isJobCommercialModel(candidate.model)
    ? candidate.model
    : legacyAmount !== null ? "FIXED_TOTAL" : "UNDEFINED";
  const amount = safeMinor(candidate.baseAmountMinor);
  const basis = isJobCommercialValueBasis(candidate.basis)
    ? candidate.basis
    : isJobCommercialValueBasis(legacy.basis) ? legacy.basis : "ESTIMATE";
  return {
    model,
    currency: "EUR",
    basis,
    baseAmountMinor: amount ?? (model === "FIXED_TOTAL" || model === "MIXED" ? legacyAmount : null),
    version: typeof candidate.version === "number" && Number.isSafeInteger(candidate.version) && candidate.version > 0 ? candidate.version : 1,
    effectiveAt: text(candidate.effectiveAt, text(legacy.effectiveAt)),
    source: text(candidate.source, text(legacy.source, "server-readback")),
  };
}

export function commercialModelLabel(model: JobCommercialModel) {
  return JOB_COMMERCIAL_MODELS.find((option) => option.value === model)?.label ?? "Da definire";
}

export function commercialValueLabel(model: JobCommercialModel) {
  if (model === "PER_WORK_ORDER") return "Lavorazioni approvate";
  if (model === "TIME_AND_MATERIAL") return "Valore a consuntivo";
  if (model === "MIXED") return "Base / canone";
  if (model === "FIXED_TOTAL") return "Valore complessivo";
  return "Modello economico";
}

function validWorkOrderStatus(value: string): JobWorkOrderStatus {
  if (value === "APPROVED" || value === "COMPLETED" || value === "CANCELLED") return value;
  return "DRAFT";
}

function addMinor(current: number, value: number) {
  const result = current + value;
  return Number.isSafeInteger(result) ? result : current;
}

export function buildJobWorkOrderEconomics(records: CommercialJourneyRecord[]): JobWorkOrderEconomics {
  const workOrderRows = records.filter((row) => row.recordType === "JOB_WORK_ORDER");
  const valueRows = records.filter((row) => row.recordType === "JOB_WORK_ORDER_VALUE" && row.status === "ACTIVE");
  const latestValues = new Map<string, { row: CommercialJourneyRecord; payload: Record<string, unknown> }>();
  for (const row of valueRows) {
    const payload = parseRecord(row.payloadJson);
    const workOrderId = text(payload.workOrderId);
    if (!workOrderId) continue;
    const current = latestValues.get(workOrderId);
    if (!current || row.version > current.row.version || (row.version === current.row.version && row.updatedAt > current.row.updatedAt)) {
      latestValues.set(workOrderId, { row, payload });
    }
  }

  const workOrders = workOrderRows.map((row): JobWorkOrderProjection => {
    const payload = parseRecord(row.payloadJson);
    const valueEntry = latestValues.get(row.id);
    const amountMinor = valueEntry ? safeMinor(valueEntry.payload.amountMinor) : null;
    return {
      id: row.id,
      title: text(payload.title, row.title),
      description: text(payload.description),
      status: validWorkOrderStatus(row.status),
      version: row.version,
      updatedAt: row.updatedAt,
      value: valueEntry && amountMinor !== null ? {
        amountMinor,
        currency: "EUR",
        basis: valueEntry.payload.basis === "CONTRACTED" ? "CONTRACTED" : "ESTIMATE",
        version: valueEntry.row.version,
        updatedAt: valueEntry.row.updatedAt,
      } : null,
    };
  }).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  const counts = {
    total: workOrders.length,
    draft: workOrders.filter((item) => item.status === "DRAFT").length,
    approved: workOrders.filter((item) => item.status === "APPROVED").length,
    completed: workOrders.filter((item) => item.status === "COMPLETED").length,
    cancelled: workOrders.filter((item) => item.status === "CANCELLED").length,
  };
  const active = workOrders.filter((item) => item.status !== "CANCELLED");
  const valued = active.filter((item) => item.value);
  const proposedMinor = valued.length ? valued.reduce((sum, item) => addMinor(sum, item.value!.amountMinor), 0) : null;
  const approved = valued.filter((item) => item.status === "APPROVED" || item.status === "COMPLETED");
  const completed = valued.filter((item) => item.status === "COMPLETED");

  return {
    status: active.length === 0 ? "NOT_AVAILABLE" : valued.length === active.length ? "AVAILABLE" : "PARTIAL",
    currency: "EUR",
    counts,
    proposedMinor,
    approvedMinor: approved.length ? approved.reduce((sum, item) => addMinor(sum, item.value!.amountMinor), 0) : null,
    completedMinor: completed.length ? completed.reduce((sum, item) => addMinor(sum, item.value!.amountMinor), 0) : null,
    workOrders,
  };
}
