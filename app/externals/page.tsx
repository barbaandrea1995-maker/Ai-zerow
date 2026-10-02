import ExternalControlPage from "@/components/external-control-page";
import { requirePageCapability } from "@/lib/page-access";

export default async function ExternalsPage() {
  await requirePageCapability("external_adapters.read");
  return <ExternalControlPage />;
}
