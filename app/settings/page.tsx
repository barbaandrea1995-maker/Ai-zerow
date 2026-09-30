import { redirect } from "next/navigation";
import { getNeonAuthIdentity } from "@/lib/neon-auth/tenant-context";
import SettingsClient from "./settings-client";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const identity = await getNeonAuthIdentity();

  if (identity.status !== "authenticated") {
    redirect("/login");
  }

  return <SettingsClient actor={identity.actor} />;
}
