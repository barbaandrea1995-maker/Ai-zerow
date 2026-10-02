import { redirect } from "next/navigation";
import { getAuthorityContext, hasCapability } from "@/lib/authority-context";
import { getNeonAuthIdentity } from "@/lib/neon-auth/tenant-context";

export async function requirePageContext() {
  const identity = await getNeonAuthIdentity();
  if (identity.status === "error") {
    redirect("/login");
  }

  const context = await getAuthorityContext();
  if (!context) {
    redirect(identity.status === "authenticated" ? "/tenants?reason=membership_required" : "/login");
  }

  // Neon is authoritative when a valid Neon session exists. When Neon is
  // configured but the request is coming from the authenticated Sites owner,
  // the D1 membership remains an explicit, server-derived fallback. This is
  // necessary for the owner-only Sites surface and does not bootstrap access
  // after the canonical tenant has been provisioned.
  if (identity.status === "authenticated" && context.identityProvider !== "neon") {
    redirect("/login");
  }
  if (identity.status !== "authenticated" && context.identityProvider !== "sites") {
    redirect("/login");
  }

  return context;
}

export async function requirePageCapability(capability: string) {
  const context = await requirePageContext();
  if (!hasCapability(context, capability)) {
    redirect(`/access-denied?required=${encodeURIComponent(capability)}`);
  }

  return context;
}
