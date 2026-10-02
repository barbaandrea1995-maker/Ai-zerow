import type { ReactNode } from "react";
import { requirePageCapability } from "@/lib/page-access";

export default async function WarehouseLayout({ children }: { children: ReactNode }) {
  await requirePageCapability("warehouse.read");
  return children;
}
