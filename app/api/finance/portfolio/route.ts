import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { jobJourneyRecords, s04Records } from "@/db/schema";
import { getAuthorityContext, hasCapability, publicAuthorityContext } from "@/lib/authority-context";

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
    const [jobs, values] = await Promise.all([
      db.select().from(s04Records).where(and(
        eq(s04Records.tenantId, context.tenantId),
        eq(s04Records.module, "operations"),
        eq(s04Records.recordType, "job"),
      )),
      db.select().from(jobJourneyRecords).where(and(
        eq(jobJourneyRecords.tenantId, context.tenantId),
        eq(jobJourneyRecords.domain, "finance"),
        eq(jobJourneyRecords.recordType, "JOB_COMMERCIAL_VALUE"),
        eq(jobJourneyRecords.status, "ACTIVE"),
      )).orderBy(desc(jobJourneyRecords.version), desc(jobJourneyRecords.updatedAt)).limit(2_000),
    ]);
    const jobById = new Map(jobs.map((job) => [job.id, job]));
    const latest = new Map<string, typeof values[number]>();
    for (const value of values) {
      if (!latest.has(value.jobId)) latest.set(value.jobId, value);
    }

    const rows = [...latest.values()].flatMap((value) => {
      const job = jobById.get(value.jobId);
      if (!job) return [];
      const amount = parseObject(value.payloadJson);
      const amountMinor = Number(amount.amountMinor);
      if (!Number.isSafeInteger(amountMinor) || amountMinor < 0 || amountMinor > 100_000_000_000) return [];
      const jobPayload = parseObject(job.payloadJson);
      return [{
        id: value.id,
        jobId: job.id,
        jobCode: job.canonicalCode,
        jobTitle: text(jobPayload.title) || job.title,
        client: text(jobPayload.clientName ?? jobPayload.client),
        status: job.status,
        amountMinor,
        currency: "EUR",
        basis: amount.basis === "CONTRACTED" ? "CONTRACTED" : "ESTIMATE",
        version: value.version,
        updatedAt: value.updatedAt,
      }];
    }).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

    return Response.json({
      context: publicAuthorityContext(context),
      rows,
      totals: {
        estimateMinor: rows.filter((row) => row.basis === "ESTIMATE").reduce((sum, row) => sum + row.amountMinor, 0),
        contractedMinor: rows.filter((row) => row.basis === "CONTRACTED").reduce((sum, row) => sum + row.amountMinor, 0),
        recordedCount: rows.length,
      },
      contract: { source: "job_journey_records", recordType: "JOB_COMMERCIAL_VALUE", meaning: "Valore preventivato o accordato della commessa; non rappresenta fatture emesse, incassi o saldo contabile." },
      readback: { status: "SITES_READBACK_VERIFIED", checkedAt: new Date().toISOString() },
    }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "finance_portfolio_unavailable" }, { status: 503 });
  }
}
