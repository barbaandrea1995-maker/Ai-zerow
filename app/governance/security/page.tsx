import SecurityPrivacyControl from "@/components/security-privacy-control";
import { commandSurfaceAccess } from "@/lib/command-dashboard";
import { requirePageCapability } from "@/lib/page-access";

export const dynamic = "force-dynamic";

export default async function SecurityGovernancePage() {
  const authority = await requirePageCapability("governance.read");

  return (
    <SecurityPrivacyControl
      access={commandSurfaceAccess(authority.role, authority.capabilities)}
      actor={{ email: authority.actorEmail, name: authority.actorName }}
      role={authority.role}
    />
  );
}
