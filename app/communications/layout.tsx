import type { ReactNode } from "react";
import { requirePageCapability } from "@/lib/page-access";

export default async function CommunicationsLayout({ children }: { children: ReactNode }) {
  await requirePageCapability("communication.read");
  return children;
}
