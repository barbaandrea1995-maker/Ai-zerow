import WarehouseControl from "@/components/warehouse-control";
import { requirePageCapability } from "@/lib/page-access";

export default async function WarehousePage() {
  await requirePageCapability("warehouse.read");
  return <WarehouseControl />;
}
