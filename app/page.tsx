import { redirect } from "next/navigation";
import CommandSurface from "@/components/command-surface";
import { hasCapability } from "@/lib/authority-context";
import {
  commandSurfaceAccess,
  firstAuthorizedPath,
} from "@/lib/command-dashboard";
import { requirePageContext } from "@/lib/page-access";

export const dynamic = "force-dynamic";

/**
 * The PWA root is the Neon Auth entry gate. Unauthenticated visitors must
 * see the login before any operational surface is rendered.
 */
export default async function HomePage() {
  const authority = await requirePageContext();
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
