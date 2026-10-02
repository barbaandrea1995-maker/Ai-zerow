import type { ReactNode } from "react";
import { requirePageCapability } from "@/lib/page-access";

export default async function FinanceLayout({ children }: { children: ReactNode }) {
  await requirePageCapability("finance.read");
  return children;
}
