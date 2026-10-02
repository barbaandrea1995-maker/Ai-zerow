import type { ReactNode } from "react";
import { requirePageCapability } from "@/lib/page-access";

export default async function EventsLayout({ children }: { children: ReactNode }) {
  await requirePageCapability("events.read");
  return children;
}
