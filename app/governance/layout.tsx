import type { ReactNode } from "react";
import { requirePageCapability } from "@/lib/page-access";

export default async function GovernanceLayout({ children }: { children: ReactNode }) {
  await requirePageCapability("governance.read");
  return children;
}
