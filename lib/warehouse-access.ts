import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { s04Records, tenantWarehouses } from "@/db/schema";
import type { AuthorityContext } from "@/lib/authority-context";
import { warehouseIsInScope, warehouseScope, type WarehouseScope } from "@/lib/attendance-scope";

export type TenantWarehouseAccess = {
  scope: WarehouseScope;
  warehouses: Array<typeof tenantWarehouses.$inferSelect>;
  allowedWarehouseIds: string[] | null;
};

/** Reuse the server-owned assignment perimeter used by warehouse attendance. */
export async function tenantWarehouseAccess(context: AuthorityContext): Promise<TenantWarehouseAccess> {
  const db = getDb();
  const [warehouses, workforceRows] = await Promise.all([
    db.select().from(tenantWarehouses).where(and(
      eq(tenantWarehouses.tenantId, context.tenantId),
      eq(tenantWarehouses.status, "active"),
    )).limit(500),
    db.select().from(s04Records).where(and(
      eq(s04Records.tenantId, context.tenantId),
      eq(s04Records.module, "workforce"),
    )).limit(500),
  ]);
  const scope = warehouseScope(context, warehouses, workforceRows);
  const visibleWarehouses = scope.mode === "ALL"
    ? warehouses
    : warehouses.filter((warehouse) => warehouseIsInScope(scope, warehouse.id));
  return {
    scope,
    warehouses: visibleWarehouses,
    allowedWarehouseIds: scope.mode === "ALL" ? null : scope.warehouseIds,
  };
}

export function warehouseIdIsAllowed(access: TenantWarehouseAccess, warehouseId: string) {
  return access.scope.mode === "ALL" || warehouseIsInScope(access.scope, warehouseId);
}
