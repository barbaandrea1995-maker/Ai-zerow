import { redirect } from "next/navigation";
import { getAuthorityContext, hasCapability } from "@/lib/authority-context";
import { getNeonAuthIdentity } from "@/lib/neon-auth/tenant-context";

type PageAccessOptions = {
  allowOnboarding?: boolean;
};

export async function requirePageContext(options: PageAccessOptions = {}) {
  const identity = await getNeonAuthIdentity();
  if (identity.status === "error") {
    redirect("/login");
  }

  const context = await getAuthorityContext();
  if (!context) {
    redirect(identity.status === "authenticated" ? "/onboarding?mode=setup" : "/login");
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

  if (context.tenantStatus === "onboarding" && !options.allowOnboarding) {
    redirect("/onboarding?mode=setup");
  }

  return context;
}

export async function requirePageCapability(
  capability: string,
  options: PageAccessOptions = {},
) {
  const context = await requirePageContext(options);
  if (!hasCapability(context, capability)) {
    redirect(`/access-denied?required=${encodeURIComponent(capability)}`);
  }

  return context;
}
