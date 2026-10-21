import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { jobJourneyRecords, s04Records, w10Workflows } from "@/db/schema";
import { getAuthorityContext, hasCapability, publicAuthorityContext } from "@/lib/authority-context";
import { buildFinanceProjection, readFinanceLedger } from "@/lib/finance-ledger.server";
import {
  buildJobWorkOrderEconomics,
  normalizeJobCommercialTerms,
  type CommercialJourneyRecord,
} from "@/lib/job-commercial-terms";

export const dynamic = "force-dynamic";

type JsonObject = Record<string, unknown>;
type FinanceStatus = "PROPOSED" | "REVIEW" | "APPROVED" | "RECONCILED";

function objectValue(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as JsonObject;
}

function parseObject(value: string): JsonObject {
  try { return objectValue(JSON.parse(value) as unknown); } catch { return {}; }
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function safeAmount(value: unknown, max: number) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max ? value : null;
}

export async function GET(request: Request) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "finance.read")) {
    return Response.json({ error: "forbidden", capability: "finance.read" }, { status: 403 });
  }

  const requestedJobId = new URL(request.url).searchParams.get("jobId")?.trim() ?? "";
  if (requestedJobId.length > 160) return Response.json({ error: "invalid_job_id" }, { status: 400 });

  try {
    const db = getDb();
    const jobs = await db.select().from(s04Records).where(and(
      eq(s04Records.tenantId, context.tenantId),
      eq(s04Records.module, "operations"),
      eq(s04Records.recordType, "job"),
    )).orderBy(desc(s04Records.updatedAt));
    const jobOptions = jobs.map((job) => {
      const payload = parseObject(job.payloadJson);
      return {
        id: job.id,
        code: job.canonicalCode,
        title: text(payload.title) || job.title,
        client: text(payload.clientName ?? payload.client ?? payload.customer),
        status: job.status,
      };
    });

    if (!requestedJobId) {
      return Response.json({
        context: publicAuthorityContext(context),
        jobs: jobOptions,
        selectedJob: null,
        summary: null,
        readback: { status: "SITES_READBACK_VERIFIED", checkedAt: new Date().toISOString() },
      }, { headers: { "cache-control": "private, no-store" } });
    }

    const selectedJob = jobOptions.find((job) => job.id === requestedJobId);
    if (!selectedJob) return Response.json({ error: "finance_job_not_found" }, { status: 404, headers: { "cache-control": "private, no-store" } });

    const [commercialRows, workflowRows, ledger] = await Promise.all([
      db.select().from(jobJourneyRecords).where(and(
        eq(jobJourneyRecords.tenantId, context.tenantId),
        eq(jobJourneyRecords.jobId, selectedJob.id),
      )).orderBy(desc(jobJourneyRecords.updatedAt)).limit(1_000),
      db.select({ status: w10Workflows.status, amountMilli: w10Workflows.amountMilli, currency: w10Workflows.currency })
        .from(w10Workflows)
        .where(and(
          eq(w10Workflows.tenantId, context.tenantId),
          eq(w10Workflows.module, "finance"),
          eq(w10Workflows.jobId, selectedJob.id),
        )),
      readFinanceLedger(context.tenantId, selectedJob.id),
    ]);

    const latestTerms = commercialRows
      .filter((row) => row.domain === "finance" && row.recordType === "JOB_COMMERCIAL_TERMS" && row.status === "ACTIVE")
      .sort((left, right) => right.version - left.version || right.updatedAt.localeCompare(left.updatedAt))[0];
    const latestValue = commercialRows
      .filter((row) => row.domain === "finance" && row.recordType === "JOB_COMMERCIAL_VALUE" && row.status === "ACTIVE")
      .sort((left, right) => right.version - left.version || right.updatedAt.localeCompare(left.updatedAt))[0];
    const jobRow = jobs.find((job) => job.id === selectedJob.id);
    const jobPayload = jobRow ? parseObject(jobRow.payloadJson) : {};
    const commercialTerms = normalizeJobCommercialTerms(
      latestTerms ? parseObject(latestTerms.payloadJson) : jobPayload.commercialTerms,
      latestValue ? parseObject(latestValue.payloadJson) : jobPayload.commercialValue,
    );
    const commercialAmountMinor = safeAmount(commercialTerms.baseAmountMinor, 100_000_000_000);
    const commercialValue = commercialAmountMinor !== null && (commercialTerms.model === "FIXED_TOTAL" || commercialTerms.model === "MIXED") ? {
      amountMinor: commercialAmountMinor,
      currency: "EUR",
      basis: commercialTerms.basis,
      version: latestTerms?.version ?? latestValue?.version ?? commercialTerms.version,
      updatedAt: latestTerms?.updatedAt ?? latestValue?.updatedAt ?? commercialTerms.effectiveAt,
    } : null;
    const workOrderEconomics = buildJobWorkOrderEconomics(
      commercialRows.filter((row) => row.recordType === "JOB_WORK_ORDER" || row.recordType === "JOB_WORK_ORDER_VALUE") as CommercialJourneyRecord[],
    );

    const financeStatuses: FinanceStatus[] = ["PROPOSED", "REVIEW", "APPROVED", "RECONCILED"];
    const byCurrency = new Map<string, { currency: string; count: number; amountMilli: number; statuses: Record<FinanceStatus, { count: number; amountMilli: number }> }>();
    for (const row of workflowRows) {
      const currency = /^[A-Z]{3}$/.test(row.currency) ? row.currency : "EUR";
      const status = financeStatuses.includes(row.status as FinanceStatus) ? row.status as FinanceStatus : null;
      const amountMilli = safeAmount(row.amountMilli, 9_000_000_000_000);
      if (!status || amountMilli === null) continue;
      const current = byCurrency.get(currency) ?? {
        currency,
        count: 0,
        amountMilli: 0,
        statuses: Object.fromEntries(financeStatuses.map((key) => [key, { count: 0, amountMilli: 0 }])) as Record<FinanceStatus, { count: number; amountMilli: number }>,
      };
      if (!Number.isSafeInteger(current.amountMilli + amountMilli) || !Number.isSafeInteger(current.statuses[status].amountMilli + amountMilli)) {
        return Response.json({ error: "finance_job_total_out_of_range" }, { status: 422, headers: { "cache-control": "private, no-store" } });
      }
      current.count += 1;
      current.amountMilli += amountMilli;
      current.statuses[status].count += 1;
      current.statuses[status].amountMilli += amountMilli;
      byCurrency.set(currency, current);
    }

    const economics = buildFinanceProjection({ rows: ledger.rows, allocations: ledger.allocations, relations: ledger.relations, jobId: selectedJob.id });
    return Response.json({
      context: publicAuthorityContext(context),
      jobs: jobOptions,
      selectedJob,
      summary: {
        commercialValue,
        commercialTerms,
        workOrderEconomics,
        economics,
        workflowProposals: [...byCurrency.values()].sort((left, right) => left.currency.localeCompare(right.currency)),
        /** @deprecated W10 rows are workflow proposals, not confirmed expenses. */
        expenses: [...byCurrency.values()].sort((left, right) => left.currency.localeCompare(right.currency)),
        source: { economics: "finance_entries+finance_entry_allocations+finance_entry_relations", workflowProposals: "w10_workflows", commercialTerms: "job_journey_records", workOrderEconomics: "job_journey_records", commercialValue: "job_journey_records" },
        unavailableLedgers: economics.status === "NOT_AVAILABLE" ? ["Costi e ricavi confermati"] : [],
      },
      readback: { status: "SITES_READBACK_VERIFIED", checkedAt: new Date().toISOString() },
    }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return Response.json({ error: "finance_job_summary_unavailable" }, { status: 503, headers: { "cache-control": "private, no-store" } });
  }
}
