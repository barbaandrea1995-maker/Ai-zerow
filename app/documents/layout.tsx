import type { ReactNode } from "react";
import { requirePageCapability } from "@/lib/page-access";

export default async function DocumentsLayout({ children }: { children: ReactNode }) {
  await requirePageCapability("documents.read");
  return children;
}
