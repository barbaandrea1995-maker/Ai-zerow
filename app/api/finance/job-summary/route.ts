import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { jobJourneyRecords, s04Records, w10Workflows } from "@/db/schema";
import { getAuthorityContext, hasCapability, publicAuthorityContext } from "@/lib/authority-context";

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
  if (!hasCapability(context, "command.read") || !hasCapability(context, "finance.read")) {
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

    const [valueRows, expenseRows] = await Promise.all([
      db.select().from(jobJourneyRecords).where(and(
        eq(jobJourneyRecords.tenantId, context.tenantId),
        eq(jobJourneyRecords.jobId, selectedJob.id),
        eq(jobJourneyRecords.domain, "finance"),
        eq(jobJourneyRecords.recordType, "JOB_COMMERCIAL_VALUE"),
        eq(jobJourneyRecords.status, "ACTIVE"),
      )).orderBy(desc(jobJourneyRecords.version), desc(jobJourneyRecords.updatedAt)).limit(100),
      db.select({ status: w10Workflows.status, amountMilli: w10Workflows.amountMilli, currency: w10Workflows.currency })
        .from(w10Workflows)
        .where(and(
          eq(w10Workflows.tenantId, context.tenantId),
          eq(w10Workflows.module, "finance"),
          eq(w10Workflows.jobId, selectedJob.id),
        )),
    ]);

    const latestValue = valueRows[0];
    const valuePayload = latestValue ? parseObject(latestValue.payloadJson) : null;
    const commercialAmountMinor = valuePayload ? safeAmount(valuePayload.amountMinor, 100_000_000_000) : null;
    const commercialValue = valuePayload && commercialAmountMinor !== null ? {
      amountMinor: commercialAmountMinor,
      currency: "EUR",
      basis: valuePayload.basis === "CONTRACTED" ? "CONTRACTED" : "ESTIMATE",
      version: latestValue!.version,
      updatedAt: latestValue!.updatedAt,
    } : null;

    const financeStatuses: FinanceStatus[] = ["PROPOSED", "REVIEW", "APPROVED", "RECONCILED"];
    const byCurrency = new Map<string, { currency: string; count: number; amountMilli: number; statuses: Record<FinanceStatus, { count: number; amountMilli: number }> }>();
    for (const row of expenseRows) {
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

    return Response.json({
      context: publicAuthorityContext(context),
      jobs: jobOptions,
      selectedJob,
      summary: {
        commercialValue,
        expenses: [...byCurrency.values()].sort((left, right) => left.currency.localeCompare(right.currency)),
        source: { expenses: "w10_workflows", commercialValue: "job_journey_records" },
        unavailableLedgers: ["Fatture", "Incassi e pagamenti", "Saldo contabile"],
      },
      readback: { status: "SITES_READBACK_VERIFIED", checkedAt: new Date().toISOString() },
    }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return Response.json({ error: "finance_job_summary_unavailable" }, { status: 503, headers: { "cache-control": "private, no-store" } });
  }
}
