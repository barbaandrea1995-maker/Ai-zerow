import OperationalAiControl from "@/components/operational-ai-control";
import { commandSurfaceAccess } from "@/lib/command-dashboard";
import { requirePageCapability } from "@/lib/page-access";

export const dynamic = "force-dynamic";

export default async function OperationalAiPage() {
  const authority = await requirePageCapability("company_ai.read");
  return <OperationalAiControl access={commandSurfaceAccess(authority.role, authority.capabilities, authority.roles)} actor={{ email: authority.actorEmail, name: authority.actorName }} role={authority.role} />;
}
