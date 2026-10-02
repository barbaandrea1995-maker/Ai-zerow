import W10WorkflowControl from "@/components/w10-workflow-control";
import { requirePageCapability } from "@/lib/page-access";

export default async function ProcurementPage() {
  await requirePageCapability("procurement.read");
  return <W10WorkflowControl module="procurement" />;
}
