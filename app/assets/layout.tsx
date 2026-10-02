import type { ReactNode } from "react";
import { requirePageCapability } from "@/lib/page-access";

export default async function AssetsLayout({ children }: { children: ReactNode }) {
  await requirePageCapability("asset.read");
  return children;
}
