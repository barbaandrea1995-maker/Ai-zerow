import type { ReactNode } from "react";
import { requirePageCapability } from "@/lib/page-access";

export default async function PresenzeLayout({ children }: { children: ReactNode }) {
  await requirePageCapability("workforce.read");
  return children;
}
