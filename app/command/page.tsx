import { redirect } from "next/navigation";
import CommandSurface from "@/components/command-surface";
import { getAuthorityContext, hasCapability } from "@/lib/authority-context";
import { commandSurfaceAccess } from "@/lib/command-dashboard";
import { getNeonAuthIdentity } from "@/lib/neon-auth/tenant-context";

/**
 * Canonical COMMAND route from the reconstruction catalog.
 * Keep the same Neon Auth gate as the PWA root.
 */
export const dynamic = "force-dynamic";

export default async function CommandPage() {
  const identity = await getNeonAuthIdentity();

  if (identity.status !== "authenticated") {
    redirect("/login");
  }

  const authority = await getAuthorityContext();
  if (!authority) redirect("/tenants?reason=membership_required");
  if (!hasCapability(authority, "command.read")) {
    redirect("/access-denied?required=command.read");
  }

  return (
    <CommandSurface
      access={commandSurfaceAccess(authority.role, authority.capabilities)}
      actor={{ email: authority.actorEmail, name: authority.actorName }}
    />
  );
}
