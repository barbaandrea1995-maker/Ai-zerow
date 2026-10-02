import type { ReactNode } from "react";
import { requirePageCapability } from "@/lib/page-access";

export default async function QrLayout({ children }: { children: ReactNode }) {
  await requirePageCapability("qr.read");
  return children;
}
