import type { ReactNode } from "react";
import { getAuthorityContext, getAuthenticatedIdentity, hasCapability } from "@/lib/authority-context";
import { redirect } from "next/navigation";

export default async function OnboardingLayout({ children }: { children: ReactNode }) {
  const identity = await getAuthenticatedIdentity();
  if (!identity) redirect("/login?return_to=/onboarding");

  const context = await getAuthorityContext();
  // A newly registered account has no membership yet. It must be allowed to
  // enter the primary onboarding surface so it can create its first tenant.
  if (!context) return children;

  // During primary onboarding the owner is intentionally confined to this
  // route until the tenant is activated.
  if (context.tenantStatus === "onboarding") return children;

  if (!hasCapability(context, "authority.read")) {
    redirect("/");
  }

  return children;
}
