import OperationsIndexClient from "@/components/operations-index-client";
import { requirePageCapability } from "@/lib/page-access";

export default async function OperationsIndexPage() {
  await requirePageCapability("operations.index.read");
  return <OperationsIndexClient />;
}
