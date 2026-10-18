import CommandSurface from "@/components/command-surface";
import OperationalHome from "@/components/operational-home";
import { commandSurfaceAccess } from "@/lib/command-dashboard";
import { mobileNavigationForAuthority } from "@/lib/mobile-navigation";
import { requirePageContext } from "@/lib/page-access";

export const dynamic = "force-dynamic";

/**
 * The PWA root is the Neon Auth entry gate. Unauthenticated visitors must
 * see the login before any operational surface is rendered.
 */
export default async function HomePage() {
  const authority = await requirePageContext();
  const mobileNavigation = mobileNavigationForAuthority(authority);

  if (mobileNavigation?.profile === "control" && authority.capabilities.includes("command.read")) return (
    <CommandSurface
      access={commandSurfaceAccess(authority.role, authority.capabilities, authority.roles)}
      actor={{ email: authority.actorEmail, name: authority.actorName }}
    />
  );

  return <OperationalHome authority={authority} navigation={mobileNavigation} />;
}
