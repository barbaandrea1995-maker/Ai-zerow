import CommandSurface from "@/components/command-surface";
import { commandSurfaceAccess } from "@/lib/command-dashboard";
import { requirePageCapability } from "@/lib/page-access";

/**
 * Canonical COMMAND route from the reconstruction catalog.
 * Keep the same Neon Auth gate as the PWA root.
 */
export const dynamic = "force-dynamic";

export default async function CommandPage() {
  const authority = await requirePageCapability("command.read");

  return (
    <CommandSurface
      access={commandSurfaceAccess(authority.role, authority.capabilities, authority.roles)}
      actor={{ email: authority.actorEmail, name: authority.actorName }}
    />
  );
}
