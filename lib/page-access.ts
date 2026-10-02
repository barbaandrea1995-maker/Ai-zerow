import { redirect } from "next/navigation";
import { getAuthorityContext, hasCapability } from "@/lib/authority-context";
import { getNeonAuthIdentity } from "@/lib/neon-auth/tenant-context";

export async function requirePageCapability(capability: string) {
  const identity = await getNeonAuthIdentity();
  if (identity.status !== "authenticated") redirect("/login");

  const context = await getAuthorityContext();
  if (!context) redirect("/tenants?reason=membership_required");
  if (!hasCapability(context, capability)) {
    redirect(`/access-denied?required=${encodeURIComponent(capability)}`);
  }

  return context;
}
