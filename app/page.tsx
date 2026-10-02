import { redirect } from "next/navigation";
import CommandSurface from "@/components/command-surface";
import { getAuthorityContext, hasCapability } from "@/lib/authority-context";
import { commandSurfaceAccess, firstAuthorizedPath } from "@/lib/command-dashboard";
import { getNeonAuthIdentity } from "@/lib/neon-auth/tenant-context";

export const dynamic = "force-dynamic";

/**
 * The PWA root is the Neon Auth entry gate. Unauthenticated visitors must
 * see the login before any operational surface is rendered.
 */
export default async function HomePage() {
  const identity = await getNeonAuthIdentity();

  if (identity.status !== "authenticated") {
    redirect("/login");
  }

  const authority = await getAuthorityContext();
  if (!authority) redirect("/tenants?reason=membership_required");
  if (!hasCapability(authority, "command.read")) {
    redirect(firstAuthorizedPath(authority.capabilities));
  }

  return (
    <CommandSurface
      access={commandSurfaceAccess(authority.role, authority.capabilities)}
      actor={{ email: authority.actorEmail, name: authority.actorName }}
    />
  );
}
