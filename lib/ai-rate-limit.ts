import { and, eq, lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { aiRateLimitWindows } from "@/db/schema";

const WINDOW_SECONDS = 60;
const RETENTION_HOURS = 24;

export type AiRateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
};

function boundedLimit(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(120, Math.max(1, parsed)) : fallback;
}

export function companyAiRateLimit(action: "command" | "intake" | "release-check") {
  const fallback = action === "intake" ? 6 : action === "release-check" ? 2 : 12;
  return boundedLimit(process.env.COMPANY_AI_RATE_LIMIT_PER_MINUTE, fallback);
}

export async function consumeCompanyAiRateLimit({
  tenantId,
  actorId,
  action,
  limit,
}: {
  tenantId: string;
  actorId: string;
  action: "command" | "intake" | "release-check";
  limit: number;
}): Promise<AiRateLimitResult> {
  const now = new Date();
  const windowStart = new Date(Math.floor(now.getTime() / 60_000) * 60_000).toISOString();
  const retentionBoundary = new Date(now.getTime() - RETENTION_HOURS * 60 * 60 * 1_000).toISOString();
  const nowIso = now.toISOString();
  const db = getDb();

  await db.delete(aiRateLimitWindows).where(and(
    eq(aiRateLimitWindows.tenantId, tenantId),
    lt(aiRateLimitWindows.updatedAt, retentionBoundary),
  ));

  // RETURNING makes the increment and the value used for enforcement one
  // atomic D1 statement. A follow-up SELECT can observe stale data in a local
  // or replicated runtime and must never be the security boundary.
  const [window] = await db.insert(aiRateLimitWindows)
    .values({
      id: crypto.randomUUID(),
      tenantId,
      actorId,
      action,
      windowStart,
      requestCount: 1,
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    .onConflictDoUpdate({
      target: [
        aiRateLimitWindows.tenantId,
        aiRateLimitWindows.actorId,
        aiRateLimitWindows.action,
        aiRateLimitWindows.windowStart,
      ],
      set: {
        requestCount: sql`${aiRateLimitWindows.requestCount} + 1`,
        updatedAt: nowIso,
      },
    })
    .returning({ requestCount: aiRateLimitWindows.requestCount });

  const requestCount = window?.requestCount ?? limit + 1;
  const elapsedSeconds = Math.floor((now.getTime() % 60_000) / 1_000);
  return {
    allowed: requestCount <= limit,
    limit,
    remaining: Math.max(0, limit - requestCount),
    retryAfterSeconds: Math.max(1, WINDOW_SECONDS - elapsedSeconds),
  };
}

export function companyAiRateLimitResponse(result: AiRateLimitResult) {
  return Response.json({
    error: "company_ai_rate_limit_exceeded",
    retryAfterSeconds: result.retryAfterSeconds,
  }, {
    status: 429,
    headers: {
      "cache-control": "no-store",
      "retry-after": String(result.retryAfterSeconds),
      "x-ratelimit-limit": String(result.limit),
      "x-ratelimit-remaining": String(result.remaining),
    },
  });
}
