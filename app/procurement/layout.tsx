import type { ReactNode } from "react";
import { requirePageCapability } from "@/lib/page-access";

export default async function ProcurementLayout({ children }: { children: ReactNode }) {
  await requirePageCapability("procurement.read");
  return children;
}
