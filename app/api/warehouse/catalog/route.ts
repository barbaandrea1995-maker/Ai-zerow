import { getAuthorityContext, hasCapability, publicAuthorityContext } from "@/lib/authority-context";
import { INVENTORY_UNIT_CATALOG, warehouseForResponse } from "@/lib/inventory-contract";
import { tenantWarehouseAccess } from "@/lib/warehouse-access";

export const dynamic = "force-dynamic";

export async function GET() {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "warehouse.read")) {
    return Response.json({ error: "forbidden", capability: "warehouse.read" }, { status: 403 });
  }
  try {
    const access = await tenantWarehouseAccess(context);
    return Response.json({
      context: publicAuthorityContext(context),
      warehouses: access.warehouses.map(warehouseForResponse),
      warehouseScope: access.scope,
      units: INVENTORY_UNIT_CATALOG,
      readback: { status: "verified", scope: access.scope.mode.toLowerCase(), checkedAt: new Date().toISOString() },
    }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return Response.json({ error: "warehouse_catalog_unavailable" }, { status: 503 });
  }
}
