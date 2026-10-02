import type { ReactNode } from "react";
import { requirePageCapability } from "@/lib/page-access";

export default async function PwaLayout({ children }: { children: ReactNode }) {
  await requirePageCapability("command.read");
  return children;
}
