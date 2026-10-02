import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { s04Records } from "@/db/schema";
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
    const rows = await getDb()
      .select()
      .from(s04Records)
      .where(and(eq(s04Records.tenantId, context.tenantId), inArray(s04Records.module, readableModules)))
      .orderBy(desc(s04Records.updatedAt));

    return Response.json({
      modules: readableModules,
      requestedModules: DASHBOARD_MODULES,
      records: rows.map(recordForResponse),
      readback: { status: "ok", count: rows.length, checkedAt: new Date().toISOString() },
    }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "command_dashboard_readback_failed" }, { status: 503 });
  }
}
