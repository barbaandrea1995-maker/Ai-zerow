import CompanyAiGovernance from "@/components/company-ai-governance";
import { requirePageCapability } from "@/lib/page-access";

export default async function GovernancePage() {
  await requirePageCapability("governance.read");
  return <CompanyAiGovernance />;
}
