import PwaMobileControl from "@/components/pwa-mobile-control";
import { commandSurfaceAccess } from "@/lib/command-dashboard";
import { requirePageCapability } from "@/lib/page-access";

export const dynamic = "force-dynamic";

export default async function PwaDiagnosticsPage() {
  const authority = await requirePageCapability("pwa.read");

  return (
    <PwaMobileControl
      access={commandSurfaceAccess(authority.role, authority.capabilities, authority.roles)}
      actor={{ email: authority.actorEmail, name: authority.actorName }}
      role={authority.role}
    />
  );
}
