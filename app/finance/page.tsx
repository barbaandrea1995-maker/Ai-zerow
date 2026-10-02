import W10WorkflowControl from "@/components/w10-workflow-control";
import { requirePageCapability } from "@/lib/page-access";

export default async function FinancePage() {
  await requirePageCapability("finance.read");
  return <W10WorkflowControl module="finance" />;
}
