import { and, count, eq, gte, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { s06Events } from "@/db/schema";
import { getAuthorityContext, hasCapability } from "@/lib/authority-context";

export const dynamic = "force-dynamic";

const COMMITTED_EVENT_STATUSES = ["COMMITTED", "COMMITTED_SITES_READBACK"] as const;

export async function GET(request: Request) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "command.read") || !hasCapability(context, "analytics.read")) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const requestedDays = new URL(request.url).searchParams.get("days");
  const days = requestedDays === null ? 30 : Number(requestedDays);
  if (days !== 7 && days !== 30) {
    return Response.json({ error: "analytics_period_must_be_7_or_30_days" }, { status: 400 });
  }

  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days + 1));
  const startAt = start.toISOString();
  const dayBucket = sql<string>`substr(${s06Events.occurredAt}, 1, 10)`;

  try {
    const rows = await getDb()
      .select({ day: dayBucket, eventCount: count() })
      .from(s06Events)
      .where(and(
        eq(s06Events.tenantId, context.tenantId),
        gte(s06Events.occurredAt, startAt),
        inArray(s06Events.status, COMMITTED_EVENT_STATUSES),
      ))
      .groupBy(dayBucket)
      .orderBy(dayBucket);

    const countsByDay = new Map(rows.map((row) => [row.day, Number(row.eventCount) || 0]));
    const daily = Array.from({ length: days }, (_, index) => {
      const date = new Date(start.getTime() + index * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10);
      return { date, count: countsByDay.get(date) ?? 0 };
    });
    const total = daily.reduce((sum, day) => sum + day.count, 0);
    const activeDays = daily.filter((day) => day.count > 0).length;
    const peakDailyCount = daily.reduce((peak, day) => Math.max(peak, day.count), 0);

    return Response.json({
      periodDays: days,
      summary: { total, activeDays, peakDailyCount },
      daily,
      contract: {
        source: "s06-event-ledger",
        scope: "tenant-aggregate-only",
        rawPayloadIncluded: false,
        actorDataIncluded: false,
      },
      readback: { status: "ok", scope: "tenant", checkedAt: new Date().toISOString() },
    }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return Response.json({ error: "command_analytics_readback_unavailable" }, { status: 503 });
  }
}
