import FinanceConsole from "@/components/finance-console";
import { requirePageCapability } from "@/lib/page-access";

export default async function FinancePage() {
  await requirePageCapability("finance.read");
  return <FinanceConsole />;
}
