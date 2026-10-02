import type { ReactNode } from "react";
import { requirePageCapability } from "@/lib/page-access";

export default async function PlanningLayout({ children }: { children: ReactNode }) {
  await requirePageCapability("planning.read");
  return children;
}
