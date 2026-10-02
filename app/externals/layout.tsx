import type { ReactNode } from "react";
import { requirePageCapability } from "@/lib/page-access";

export default async function ExternalsLayout({ children }: { children: ReactNode }) {
  await requirePageCapability("external_adapters.read");
  return children;
}
