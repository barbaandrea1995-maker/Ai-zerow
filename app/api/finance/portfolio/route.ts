import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { jobJourneyRecords, s04Records } from "@/db/schema";
import { getAuthorityContext, hasCapability, publicAuthorityContext } from "@/lib/authority-context";
import { buildJobWorkOrderEconomics, normalizeJobCommercialTerms, type CommercialJourneyRecord } from "@/lib/job-commercial-terms";

export const dynamic = "force-dynamic";

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function parseObject(value: string) {
  try { return objectValue(JSON.parse(value) as unknown); } catch { return {}; }
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET() {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "finance.read")) return Response.json({ error: "forbidden", capability: "finance.read" }, { status: 403 });

  try {
    const db = getDb();
    const [jobs, commercialRecords] = await Promise.all([
      db.select().from(s04Records).where(and(
        eq(s04Records.tenantId, context.tenantId),
        eq(s04Records.module, "operations"),
        eq(s04Records.recordType, "job"),
      )),
      db.select().from(jobJourneyRecords).where(and(
        eq(jobJourneyRecords.tenantId, context.tenantId),
      )).orderBy(desc(jobJourneyRecords.updatedAt)).limit(5_000),
    ]);
    const recordsByJob = new Map<string, typeof commercialRecords>();
    for (const record of commercialRecords) recordsByJob.set(record.jobId, [...(recordsByJob.get(record.jobId) ?? []), record]);

    const rows = jobs.flatMap((job) => {
      const jobRecords = recordsByJob.get(job.id) ?? [];
      const termsRow = jobRecords.filter((row) => row.recordType === "JOB_COMMERCIAL_TERMS" && row.status === "ACTIVE")
        .sort((left, right) => right.version - left.version || right.updatedAt.localeCompare(left.updatedAt))[0];
      const legacyRow = jobRecords.filter((row) => row.recordType === "JOB_COMMERCIAL_VALUE" && row.status === "ACTIVE")
        .sort((left, right) => right.version - left.version || right.updatedAt.localeCompare(left.updatedAt))[0];
      const jobPayload = parseObject(job.payloadJson);
      const terms = normalizeJobCommercialTerms(
        termsRow ? parseObject(termsRow.payloadJson) : jobPayload.commercialTerms,
        legacyRow ? parseObject(legacyRow.payloadJson) : jobPayload.commercialValue,
      );
      const workOrders = buildJobWorkOrderEconomics(jobRecords.filter((row) => row.recordType === "JOB_WORK_ORDER" || row.recordType === "JOB_WORK_ORDER_VALUE") as CommercialJourneyRecord[]);
      const approvedWorkOrders = workOrders.workOrders.filter((row) => (row.status === "APPROVED" || row.status === "COMPLETED") && row.value);
      const approvedEstimateMinor = approvedWorkOrders.filter((row) => row.value?.basis === "ESTIMATE").reduce((sum, row) => sum + (row.value?.amountMinor ?? 0), 0);
      const approvedContractedMinor = approvedWorkOrders.filter((row) => row.value?.basis === "CONTRACTED").reduce((sum, row) => sum + (row.value?.amountMinor ?? 0), 0);
      const baseEstimateMinor = terms.baseAmountMinor !== null && terms.basis === "ESTIMATE" ? terms.baseAmountMinor : 0;
      const baseContractedMinor = terms.baseAmountMinor !== null && terms.basis === "CONTRACTED" ? terms.baseAmountMinor : 0;
      const includesWorkOrders = terms.model === "PER_WORK_ORDER" || terms.model === "MIXED";
      const includesBase = terms.model === "FIXED_TOTAL" || terms.model === "MIXED";
      const estimateAmountMinor = (includesBase ? baseEstimateMinor : 0) + (includesWorkOrders ? approvedEstimateMinor : 0);
      const contractedAmountMinor = (includesBase ? baseContractedMinor : 0) + (includesWorkOrders ? approvedContractedMinor : 0);
      const amountMinor = estimateAmountMinor + contractedAmountMinor || null;
      if (amountMinor === null || !Number.isSafeInteger(amountMinor) || amountMinor < 0 || amountMinor > 100_000_000_000) return [];
      return [{
        id: termsRow?.id ?? legacyRow?.id ?? job.id,
        jobId: job.id,
        jobCode: job.canonicalCode,
        jobTitle: text(jobPayload.title) || job.title,
        client: text(jobPayload.clientName ?? jobPayload.client),
        status: job.status,
        amountMinor,
        currency: "EUR",
        basis: estimateAmountMinor > 0 && contractedAmountMinor > 0 ? "MIXED" : contractedAmountMinor > 0 ? "CONTRACTED" : "ESTIMATE",
        estimateAmountMinor,
        contractedAmountMinor,
        model: terms.model,
        workOrderCount: workOrders.counts.total,
        version: termsRow?.version ?? legacyRow?.version ?? terms.version,
        updatedAt: termsRow?.updatedAt ?? legacyRow?.updatedAt ?? job.updatedAt,
      }];
    }).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

    return Response.json({
      context: publicAuthorityContext(context),
      rows,
      totals: {
        estimateMinor: rows.reduce((sum, row) => sum + row.estimateAmountMinor, 0),
        contractedMinor: rows.reduce((sum, row) => sum + row.contractedAmountMinor, 0),
        recordedCount: rows.length,
      },
      contract: { source: "job_journey_records", recordTypes: ["JOB_COMMERCIAL_TERMS", "JOB_COMMERCIAL_VALUE", "JOB_WORK_ORDER", "JOB_WORK_ORDER_VALUE"], meaning: "Valore fisso o somma delle lavorazioni approvate; non rappresenta fatture emesse, incassi o saldo contabile." },
      readback: { status: "SITES_READBACK_VERIFIED", checkedAt: new Date().toISOString() },
    }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "finance_portfolio_unavailable" }, { status: 503 });
  }
}
