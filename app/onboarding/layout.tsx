import type { ReactNode } from "react";
import { requirePageCapability } from "@/lib/page-access";

export default async function OnboardingLayout({ children }: { children: ReactNode }) {
  await requirePageCapability("authority.read");
  return children;
}
