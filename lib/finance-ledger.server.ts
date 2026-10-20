import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  financeEntries,
  financeEntryAllocations,
  financeEntryRelations,
  financeReconciliationIssues,
  s04Records,
} from "@/db/schema";

type EntryRow = typeof financeEntries.$inferSelect;
type AllocationRow = typeof financeEntryAllocations.$inferSelect;
type RelationRow = typeof financeEntryRelations.$inferSelect;

export type FinanceJobOption = {
  id: string;
  code: string | null;
  title: string;
  client: string | null;
  status: string;
};

function objectValue(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function readFinanceJobs(tenantId: string): Promise<FinanceJobOption[]> {
  const rows = await getDb().select().from(s04Records).where(and(
    eq(s04Records.tenantId, tenantId),
    eq(s04Records.module, "operations"),
    eq(s04Records.recordType, "job"),
  )).orderBy(desc(s04Records.updatedAt)).limit(500);
  return rows.map((row) => {
    const payload = objectValue(row.payloadJson);
    return {
      id: row.id,
      code: row.canonicalCode,
      title: textValue(payload.title) || row.title,
      client: textValue(payload.clientName ?? payload.client ?? payload.customer) || null,
      status: row.status,
    };
  });
}

export async function resolveFinanceJobs(tenantId: string, jobIds: readonly string[]) {
  const requested = [...new Set(jobIds.map((value) => value.trim()).filter(Boolean))];
  if (requested.length > 24) throw new Error("finance_job_allocation_limit");
  const jobs = await readFinanceJobs(tenantId);
  const byId = new Map(jobs.map((job) => [job.id, job]));
  const resolved = requested.map((id) => byId.get(id)).filter((job): job is FinanceJobOption => Boolean(job));
  if (resolved.length !== requested.length) throw new Error("finance_job_not_found");
  return resolved;
}

export function financeEntryResponse(row: EntryRow, allocations: AllocationRow[] = [], relations: RelationRow[] = []) {
  return {
    id: row.id,
    entryType: row.entryType,
    documentRole: row.documentRole,
    category: row.category,
    description: row.description,
    amountMinor: row.amountMinor,
    effectSign: row.effectSign,
    netAmountMinor: row.netAmountMinor,
    taxAmountMinor: row.taxAmountMinor,
    grossAmountMinor: row.grossAmountMinor,
    currency: row.currency,
    valuationBasis: row.valuationBasis,
    economicDate: row.economicDate,
    dueDate: row.dueDate,
    counterpartyName: row.counterpartyName || null,
    counterpartyTaxId: row.counterpartyTaxId || null,
    counterpartyVerification: row.counterpartyVerification,
    documentNumber: row.documentNumber || null,
    source: { type: row.sourceType, id: row.sourceId, documentId: row.sourceDocumentId },
    status: row.status,
    version: row.version,
    preparedBy: row.preparedBy,
    confirmedBy: row.confirmedBy,
    confirmedAt: row.confirmedAt,
    reversedBy: row.reversedBy,
    reversedAt: row.reversedAt,
    reversalReason: row.reversalReason || null,
    allocations: allocations.filter((allocation) => allocation.entryId === row.id && allocation.status === "ACTIVE").map((allocation) => ({
      id: allocation.id,
      jobId: allocation.jobId,
      amountMinor: allocation.amountMinor,
      currency: allocation.currency,
      version: allocation.version,
    })),
    relations: relations.filter((relation) => relation.entryId === row.id && relation.status === "CONFIRMED").map((relation) => ({
      id: relation.id,
      relationType: relation.relationType,
      relatedEntityType: relation.relatedEntityType,
      relatedEntityId: relation.relatedEntityId,
      amountMinor: relation.amountMinor,
      currency: relation.currency,
      version: relation.version,
    })),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function readFinanceLedger(tenantId: string, jobId = "") {
  const db = getDb();
  const [entries, allocations, relations, issues] = await Promise.all([
    db.select().from(financeEntries).where(eq(financeEntries.tenantId, tenantId)).orderBy(desc(financeEntries.updatedAt)).limit(1_000),
    db.select().from(financeEntryAllocations).where(eq(financeEntryAllocations.tenantId, tenantId)).orderBy(desc(financeEntryAllocations.updatedAt)).limit(4_000),
    db.select().from(financeEntryRelations).where(eq(financeEntryRelations.tenantId, tenantId)).orderBy(desc(financeEntryRelations.updatedAt)).limit(4_000),
    db.select().from(financeReconciliationIssues).where(eq(financeReconciliationIssues.tenantId, tenantId)).orderBy(desc(financeReconciliationIssues.updatedAt)).limit(1_000),
  ]);
  const visibleEntryIds = jobId
    ? new Set(allocations.filter((allocation) => allocation.status === "ACTIVE" && allocation.jobId === jobId).map((allocation) => allocation.entryId))
    : null;
  const visibleEntries = visibleEntryIds ? entries.filter((entry) => visibleEntryIds.has(entry.id)) : entries;
  const entryIds = new Set(visibleEntries.map((entry) => entry.id));
  return {
    rows: visibleEntries,
    allocations: allocations.filter((allocation) => entryIds.has(allocation.entryId)),
    relations: relations.filter((relation) => entryIds.has(relation.entryId)),
    issues: issues.filter((issue) => {
      if (!jobId) return true;
      if (issue.subjectType === "FINANCE_ENTRY") return entryIds.has(issue.subjectId);
      if (issue.relatedEntityType === "FINANCE_ENTRY") return issue.relatedEntityId ? entryIds.has(issue.relatedEntityId) : false;
      if (issue.subjectType === "JOB") return issue.subjectId === jobId;
      if (issue.relatedEntityType === "JOB") return issue.relatedEntityId === jobId;
      return false;
    }),
  };
}

function safeAdd(left: number, right: number) {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new Error("finance_projection_out_of_range");
  return result;
}

type CurrencyProjection = {
  currency: string;
  confirmedCount: number;
  pendingCount: number;
  expenseMinor: number;
  revenueMinor: number;
  commitmentMinor: number;
  paidMinor: number;
  collectedMinor: number;
  supplierInvoicedMinor: number;
  customerInvoicedMinor: number;
  supplierSettledMinor: number;
  customerSettledMinor: number;
  matchedCommitmentMinor: number;
  settlementComplete: boolean;
  commitmentMatchingComplete: boolean;
  unlinkedCashCount: number;
  categories: Record<string, number>;
};

export function buildFinanceProjection({
  rows,
  allocations,
  relations,
  jobId = "",
}: {
  rows: EntryRow[];
  allocations: AllocationRow[];
  relations: RelationRow[];
  jobId?: string;
}) {
  const byCurrency = new Map<string, CurrencyProjection>();
  const allocationByEntry = new Map<string, AllocationRow[]>();
  for (const allocation of allocations) {
    if (allocation.status !== "ACTIVE") continue;
    const current = allocationByEntry.get(allocation.entryId) ?? [];
    current.push(allocation);
    allocationByEntry.set(allocation.entryId, current);
  }

  const visibleAmount = (row: EntryRow) => {
    const relevantAllocation = jobId
      ? (allocationByEntry.get(row.id) ?? []).find((allocation) => allocation.jobId === jobId)
      : null;
    return jobId ? relevantAllocation?.amountMinor ?? null : row.amountMinor;
  };
  const ensureCurrency = (currency: string) => {
    const current = byCurrency.get(currency) ?? {
      currency,
      confirmedCount: 0,
      pendingCount: 0,
      expenseMinor: 0,
      revenueMinor: 0,
      commitmentMinor: 0,
      paidMinor: 0,
      collectedMinor: 0,
      supplierInvoicedMinor: 0,
      customerInvoicedMinor: 0,
      supplierSettledMinor: 0,
      customerSettledMinor: 0,
      matchedCommitmentMinor: 0,
      settlementComplete: true,
      commitmentMatchingComplete: true,
      unlinkedCashCount: 0,
      categories: {},
    } satisfies CurrencyProjection;
    byCurrency.set(currency, current);
    return current;
  };

  for (const row of rows) {
    const magnitude = visibleAmount(row);
    if (magnitude === null || !Number.isSafeInteger(magnitude) || magnitude < 0) continue;
    const currency = /^[A-Z]{3}$/.test(row.currency) ? row.currency : "N/D";
    const current = ensureCurrency(currency);
    if (row.status !== "CONFIRMED") {
      if (row.status === "PENDING_APPROVAL") current.pendingCount += 1;
      continue;
    }
    const signed = magnitude * (row.effectSign === -1 ? -1 : 1);
    if (!Number.isSafeInteger(signed)) throw new Error("finance_projection_out_of_range");
    current.confirmedCount += 1;
    if (row.entryType === "EXPENSE") {
      current.expenseMinor = safeAdd(current.expenseMinor, signed);
      current.categories[row.category] = safeAdd(current.categories[row.category] ?? 0, signed);
    }
    if (row.entryType === "REVENUE") current.revenueMinor = safeAdd(current.revenueMinor, signed);
    if (row.entryType === "COMMITMENT") current.commitmentMinor = safeAdd(current.commitmentMinor, signed);
    if (row.entryType === "PAYMENT") current.paidMinor = safeAdd(current.paidMinor, signed);
    if (row.entryType === "RECEIPT") current.collectedMinor = safeAdd(current.collectedMinor, signed);
    if (row.documentRole === "SUPPLIER_INVOICE" || (row.documentRole === "CREDIT_NOTE" && row.entryType === "EXPENSE")) current.supplierInvoicedMinor = safeAdd(current.supplierInvoicedMinor, signed);
    if (row.documentRole === "CUSTOMER_INVOICE" || (row.documentRole === "CREDIT_NOTE" && row.entryType === "REVENUE")) current.customerInvoicedMinor = safeAdd(current.customerInvoicedMinor, signed);
  }

  const confirmedRows = rows.filter((row) => row.status === "CONFIRMED");
  const settledRelations = relations.filter((relation) => relation.status === "CONFIRMED" && relation.relationType === "SETTLES");
  const confirmedById = new Map(confirmedRows.map((row) => [row.id, row]));
  const relationIsUnambiguousForJob = (source: EntryRow, target: EntryRow) => {
    if (!jobId) return true;
    const sourceAllocations = allocationByEntry.get(source.id) ?? [];
    const targetAllocations = allocationByEntry.get(target.id) ?? [];
    return sourceAllocations.length === 1
      && targetAllocations.length === 1
      && sourceAllocations[0].jobId === jobId
      && targetAllocations[0].jobId === jobId;
  };
  const settlementAppliedBySource = new Map<string, number>();
  for (const relation of settledRelations) {
    const source = confirmedById.get(relation.entryId);
    const target = relation.relatedEntityType === "FINANCE_ENTRY" ? confirmedById.get(relation.relatedEntityId) : null;
    if (!source || !target || relation.amountMinor === null || relation.amountMinor <= 0 || source.currency !== target.currency) continue;
    const currency = /^[A-Z]{3}$/.test(source.currency) ? source.currency : "N/D";
    const current = ensureCurrency(currency);
    if (!relationIsUnambiguousForJob(source, target)) {
      current.settlementComplete = false;
      continue;
    }
    settlementAppliedBySource.set(source.id, safeAdd(settlementAppliedBySource.get(source.id) ?? 0, relation.amountMinor));
    if (source.entryType === "PAYMENT" && target.documentRole === "SUPPLIER_INVOICE") current.supplierSettledMinor = safeAdd(current.supplierSettledMinor, relation.amountMinor);
    if (source.entryType === "RECEIPT" && target.documentRole === "CUSTOMER_INVOICE") current.customerSettledMinor = safeAdd(current.customerSettledMinor, relation.amountMinor);
  }

  for (const row of confirmedRows) {
    if (!["PAYMENT", "RECEIPT"].includes(row.entryType)) continue;
    const magnitude = visibleAmount(row);
    if (magnitude === null) continue;
    const applied = settlementAppliedBySource.get(row.id) ?? 0;
    if (applied === magnitude) continue;
    const currency = /^[A-Z]{3}$/.test(row.currency) ? row.currency : "N/D";
    const current = ensureCurrency(currency);
    current.unlinkedCashCount += 1;
    current.settlementComplete = false;
  }

  for (const relation of relations.filter((candidate) => candidate.status === "CONFIRMED" && candidate.relationType === "MATCHES_PURCHASE_ORDER")) {
    const source = confirmedById.get(relation.entryId);
    const target = relation.relatedEntityType === "FINANCE_ENTRY" ? confirmedById.get(relation.relatedEntityId) : null;
    if (!source || !target || target.entryType !== "COMMITMENT" || relation.amountMinor === null || relation.amountMinor <= 0 || source.currency !== target.currency) continue;
    const currency = /^[A-Z]{3}$/.test(source.currency) ? source.currency : "N/D";
    const current = ensureCurrency(currency);
    if (!relationIsUnambiguousForJob(source, target)) {
      current.commitmentMatchingComplete = false;
      continue;
    }
    current.matchedCommitmentMinor = safeAdd(current.matchedCommitmentMinor, relation.amountMinor);
  }

  const currencies = [...byCurrency.values()].sort((left, right) => left.currency.localeCompare(right.currency)).map((row) => ({
    ...row,
    marginMinor: safeAdd(row.revenueMinor, -row.expenseMinor),
    openCommitmentMinor: row.commitmentMatchingComplete ? Math.max(0, row.commitmentMinor - row.matchedCommitmentMinor) : null,
    payableOutstandingMinor: row.settlementComplete && row.supplierInvoicedMinor !== 0
      ? Math.max(0, row.supplierInvoicedMinor - row.supplierSettledMinor)
      : null,
    receivableOutstandingMinor: row.settlementComplete && row.customerInvoicedMinor !== 0
      ? Math.max(0, row.customerInvoicedMinor - row.customerSettledMinor)
      : null,
    status: !row.settlementComplete || !row.commitmentMatchingComplete || row.pendingCount > 0 ? "PARTIAL" as const : "AVAILABLE" as const,
  }));
  const isPartial = confirmedRows.length === 0 || currencies.some((row) => row.status === "PARTIAL");
  return {
    status: rows.length === 0 ? "NOT_AVAILABLE" as const : isPartial ? "PARTIAL" as const : "AVAILABLE" as const,
    currencies,
    pendingCount: rows.filter((row) => row.status === "PENDING_APPROVAL").length,
    confirmedCount: confirmedRows.length,
    reversedCount: rows.filter((row) => row.status === "REVERSED").length,
    settlementEvidenceCount: settledRelations.length,
  };
}
