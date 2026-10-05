import type { ReactNode } from "react";
import { requirePageCapability } from "@/lib/page-access";

export const dynamic = "force-dynamic";

export default async function OperationalAiLayout({ children }: { children: ReactNode }) {
  await requirePageCapability("company_ai.read");
  return children;
}
