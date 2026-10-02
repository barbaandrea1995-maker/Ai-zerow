import type { ReactNode } from "react";
import { requirePageCapability } from "@/lib/page-access";

export default async function OperationsLayout({ children }: { children: ReactNode }) {
  await requirePageCapability("operations.read");
  return children;
}
