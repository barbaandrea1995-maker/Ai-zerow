import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { tenantWarehouses } from "@/db/schema";
import { getAuthorityContext, hasCapability, publicAuthorityContext } from "@/lib/authority-context";
import { INVENTORY_UNIT_CATALOG, warehouseForResponse } from "@/lib/inventory-contract";

export const dynamic = "force-dynamic";

export async function GET() {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "warehouse.read")) {
    return Response.json({ error: "forbidden", capability: "warehouse.read" }, { status: 403 });
  }
  try {
    const warehouses = await getDb().select().from(tenantWarehouses)
      .where(eq(tenantWarehouses.tenantId, context.tenantId))
      .orderBy(asc(tenantWarehouses.status), asc(tenantWarehouses.name));
    return Response.json({
      context: publicAuthorityContext(context),
      warehouses: warehouses.map(warehouseForResponse),
      units: INVENTORY_UNIT_CATALOG,
      readback: { status: "verified", scope: "tenant", checkedAt: new Date().toISOString() },
    }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return Response.json({ error: "warehouse_catalog_unavailable" }, { status: 503 });
  }
}
