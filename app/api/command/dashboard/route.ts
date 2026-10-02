import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { s04Records, w10Workflows } from "@/db/schema";
import { hasCapability } from "@/lib/authority-context";
import {
  getS04Context,
  recordForResponse,
  s04AccessDenied,
  type S04Module,
} from "@/lib/s04-adapter";

export const dynamic = "force-dynamic";

const DASHBOARD_MODULES = ["operations", "assets", "workforce"] as const satisfies readonly S04Module[];

export async function GET() {
  const context = await getS04Context();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "command.read")) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const readableModules = DASHBOARD_MODULES.filter((module) => !s04AccessDenied(context, module, "read"));
  if (readableModules.length === 0) return Response.json({ error: "forbidden" }, { status: 403 });

  try {
    const db = getDb();
    const rows = await db
      .select()
      .from(s04Records)
      .where(and(eq(s04Records.tenantId, context.tenantId), inArray(s04Records.module, readableModules)))
      .orderBy(desc(s04Records.updatedAt));

    let w10: {
      status: "ok" | "not_available";
      workflowCount: number;
      reviewCount: number;
      openValueMilli: number;
      reconciledCount: number;
      checkedAt: string;
    } | null = null;
    if (hasCapability(context, "finance.read") && hasCapability(context, "procurement.read")) {
      try {
        const workflowRows = await db
          .select({ module: w10Workflows.module, status: w10Workflows.status, amountMilli: w10Workflows.amountMilli })
          .from(w10Workflows)
          .where(and(eq(w10Workflows.tenantId, context.tenantId), inArray(w10Workflows.module, ["finance", "procurement"])))
          .orderBy(desc(w10Workflows.updatedAt));
        w10 = {
          status: "ok",
          workflowCount: workflowRows.length,
          reviewCount: workflowRows.filter((row) => row.status === "REVIEW").length,
          openValueMilli: workflowRows.filter((row) => row.status !== "RECONCILED").reduce((total, row) => total + row.amountMilli, 0),
          reconciledCount: workflowRows.filter((row) => row.status === "RECONCILED").length,
          checkedAt: new Date().toISOString(),
        };
      } catch {
        w10 = { status: "not_available", workflowCount: 0, reviewCount: 0, openValueMilli: 0, reconciledCount: 0, checkedAt: new Date().toISOString() };
      }
    }

    return Response.json({
      modules: readableModules,
      requestedModules: DASHBOARD_MODULES,
      records: rows.map(recordForResponse),
      w10,
      readback: { status: "ok", count: rows.length, checkedAt: new Date().toISOString() },
    }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "command_dashboard_readback_failed" }, { status: 503 });
  }
}
