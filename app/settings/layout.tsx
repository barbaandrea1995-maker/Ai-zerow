import type { ReactNode } from "react";
import { requirePageCapability } from "@/lib/page-access";

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  await requirePageCapability("settings.read");
  return children;
}
