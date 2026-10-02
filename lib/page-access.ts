import { redirect } from "next/navigation";
import { getAuthorityContext, hasCapability } from "@/lib/authority-context";
import { getNeonAuthIdentity } from "@/lib/neon-auth/tenant-context";

export async function requirePageContext() {
  const identity = await getNeonAuthIdentity();
  if (
    identity.status !== "authenticated" &&
    identity.status !== "not_configured"
  ) {
    redirect("/login");
  }

  const context = await getAuthorityContext();
  if (
    identity.status === "not_configured" &&
    context?.identityProvider !== "sites"
  ) {
    redirect("/login");
  }
  if (!context) redirect("/tenants?reason=membership_required");

  return context;
}

export async function requirePageCapability(capability: string) {
  const context = await requirePageContext();
  if (!hasCapability(context, capability)) {
    redirect(`/access-denied?required=${encodeURIComponent(capability)}`);
  }

  return context;
}
