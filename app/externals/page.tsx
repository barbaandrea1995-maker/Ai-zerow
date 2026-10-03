import ExternalIntegrationsControl from "@/components/external-integrations-control";
import { requirePageCapability } from "@/lib/page-access";

export default async function ExternalsPage() {
  await requirePageCapability("external_adapters.read");
  return <ExternalIntegrationsControl />;
}
