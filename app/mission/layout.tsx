import type { ReactNode } from "react";
import { requirePageCapability } from "@/lib/page-access";

export default async function MissionLayout({ children }: { children: ReactNode }) {
  await requirePageCapability("mission.read");
  return children;
}
