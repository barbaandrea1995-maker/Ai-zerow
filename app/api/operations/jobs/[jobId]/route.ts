import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { s04Records } from "@/db/schema";
import {
  getAuthorityContext,
  hasCapability,
  publicAuthorityContext,
} from "@/lib/authority-context";
import { recordForResponse } from "@/lib/s04-adapter";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ jobId: string }> };

type JsonObject = Record<string, unknown>;

function parsePayload(payloadJson: string): JsonObject {
  try {
    const parsed = JSON.parse(payloadJson) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as JsonObject
      : {};
  } catch {
    return {};
  }
}

function keyVariants(value: unknown): string[] {
  if (typeof value !== "string") return [];
  const normalized = value.trim().toUpperCase();
  if (!normalized) return [];

  const variants = new Set([normalized]);
  if (normalized.startsWith("#")) variants.add(normalized.slice(1));
  if (normalized.startsWith("OP-")) variants.add(normalized.slice(3));
  if (normalized.startsWith("OPERATIONS-")) variants.add(normalized.slice("OPERATIONS-".length));
  return [...variants].filter(Boolean);
}

function referencesJob(row: typeof s04Records.$inferSelect, jobVariants: Set<string>): boolean {
  const payload = parsePayload(row.payloadJson);
  const references = [
    row.id,
    payload.jobId,
    payload.job_id,
    payload.commessaId,
    payload.commessa_id,
    payload.workOrderId,
    payload.work_order_id,
  ];

  return references.some((reference) => keyVariants(reference).some((key) => jobVariants.has(key)));
}

function relatedRecords(
  rows: (typeof s04Records.$inferSelect)[],
  jobVariants: Set<string>,
) {
  return rows
    .filter((row) => row.module !== "operations" && referencesJob(row, jobVariants))
    .map(recordForResponse);
}

function section(status: "readback" | "empty" | "deferred", records: ReturnType<typeof recordForResponse>[]) {
  return { status, count: records.length, records };
}

export async function GET(_request: Request, routeContext: RouteContext) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "operations.read")) {
    return Response.json({ error: "forbidden", capability: "operations.read" }, { status: 403 });
  }

  let requestedJobId = "";
  try {
    requestedJobId = decodeURIComponent((await routeContext.params).jobId).trim();
  } catch {
    return Response.json({ error: "invalid_job_id" }, { status: 400 });
  }

  const jobVariants = new Set(keyVariants(requestedJobId));
  if (!jobVariants.size || requestedJobId.length > 160) {
    return Response.json({ error: "invalid_job_id" }, { status: 400 });
  }

  try {
    const rows = await getDb()
      .select()
      .from(s04Records)
      .where(eq(s04Records.tenantId, context.tenantId));
    const jobRow = rows.find((row) => row.module === "operations" && referencesJob(row, jobVariants));
    if (!jobRow) {
      return Response.json({
        error: "job_not_found",
        requestedJobId,
        readback: { status: "empty", scope: "tenant" },
      }, { status: 404 });
    }

    const job = recordForResponse(jobRow);
    const related = relatedRecords(rows, jobVariants);
    const byModule = (module: string) => related.filter((record) => record.module === module);
    const payload = parsePayload(jobRow.payloadJson);
    const activities = Array.isArray(payload.activities) ? payload.activities : [];

    return Response.json({
      context: publicAuthorityContext(context),
      job,
      workspace: {
        source: "sites-d1-s04-scoped-read",
        authority: "server-context",
        requestedJobId,
        sections: {
          activities: section(activities.length ? "readback" : "empty", []),
          planning: section(byModule("workforce").length || byModule("mission").length ? "readback" : "empty", [
            ...byModule("workforce"),
            ...byModule("mission"),
          ]),
          resources: section(byModule("assets").length ? "readback" : "empty", byModule("assets")),
          materials: section(byModule("warehouse").length ? "readback" : "empty", byModule("warehouse")),
          field: section("deferred", []),
          rapportino: section("deferred", []),
          control: section("deferred", []),
        },
        journey: [
          { key: "job", label: "Job", status: "readback" },
          { key: "activity", label: "Activity", status: activities.length ? "readback" : "empty" },
          { key: "planning", label: "Planning", status: byModule("workforce").length || byModule("mission").length ? "readback" : "empty" },
          { key: "assignment", label: "Assignment", status: byModule("workforce").length ? "readback" : "empty" },
          { key: "attendance", label: "Attendance", status: "deferred" },
          { key: "work-context", label: "Work context", status: "deferred" },
          { key: "field", label: "Field", status: "deferred" },
          { key: "rapportino", label: "Rapportino", status: "deferred" },
          { key: "control", label: "Controllo", status: "deferred" },
        ],
      },
      readback: {
        status: "ok",
        scope: "tenant",
        tenantId: context.tenantId,
        checkedAt: new Date().toISOString(),
      },
    }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "operations_workspace_readback_failed" }, { status: 503 });
  }
}
