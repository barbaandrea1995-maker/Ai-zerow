import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { s04Records, w10Workflows } from "@/db/schema";
import { hasCapability } from "@/lib/authority-context";
import { canReadAllOperations, rowMatchesContext, teamScopeTokens } from "@/lib/operational-scope";
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
      /** @deprecated Use openValues; null means no single EUR total is valid. */
      openValueMilli: number | null;
      openValues: Array<{ currency: string; amountMilli: number; count: number }>;
      reconciledCount: number;
      checkedAt: string;
    } | null = null;
    if (hasCapability(context, "finance.read") && hasCapability(context, "procurement.read")) {
      try {
        const workflowRows = await db
          .select({ module: w10Workflows.module, status: w10Workflows.status, amountMilli: w10Workflows.amountMilli, currency: w10Workflows.currency })
          .from(w10Workflows)
          .where(and(eq(w10Workflows.tenantId, context.tenantId), inArray(w10Workflows.module, ["finance", "procurement"])))
          .orderBy(desc(w10Workflows.updatedAt));
        const openByCurrency = new Map<string, { currency: string; amountMilli: number; count: number }>();
        for (const row of workflowRows) {
          if (row.status === "RECONCILED") continue;
          const currency = /^[A-Z]{3}$/.test(row.currency) ? row.currency : "N/D";
          const current = openByCurrency.get(currency) ?? { currency, amountMilli: 0, count: 0 };
          if (!Number.isSafeInteger(current.amountMilli + row.amountMilli)) continue;
          current.amountMilli += row.amountMilli;
          current.count += 1;
          openByCurrency.set(currency, current);
        }
        const openValues = [...openByCurrency.values()].sort((left, right) => left.currency.localeCompare(right.currency));
        const eurOnly = openValues.length === 1 && openValues[0].currency === "EUR" ? openValues[0].amountMilli : null;
        w10 = {
          status: "ok",
          workflowCount: workflowRows.length,
          reviewCount: workflowRows.filter((row) => row.status === "REVIEW").length,
          openValueMilli: eurOnly,
          openValues,
          reconciledCount: workflowRows.filter((row) => row.status === "RECONCILED").length,
          checkedAt: new Date().toISOString(),
        };
      } catch {
        w10 = { status: "not_available", workflowCount: 0, reviewCount: 0, openValueMilli: null, openValues: [], reconciledCount: 0, checkedAt: new Date().toISOString() };
      }
    }

    const scopeTokens = teamScopeTokens(rows, context);
    const visibleRows = canReadAllOperations(context)
      ? rows
      : rows.filter((row) => rowMatchesContext(row, context, scopeTokens));

    return Response.json({
      modules: readableModules,
      requestedModules: DASHBOARD_MODULES,
      records: visibleRows.map(recordForResponse),
      w10,
      readback: { status: "ok", count: visibleRows.length, checkedAt: new Date().toISOString() },
    }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "command_dashboard_readback_failed" }, { status: 503 });
  }
}
