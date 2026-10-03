import CommunicationsControl from "@/components/communications-control";
import { requirePageCapability } from "@/lib/page-access";

export default async function CommunicationsPage() {
  await requirePageCapability("communication.read");
  return <CommunicationsControl />;
}
