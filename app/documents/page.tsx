import DocumentsControlDeck from "@/components/documents-control-deck";
import { requirePageCapability } from "@/lib/page-access";

export default async function DocumentsPage() {
  await requirePageCapability("documents.read");
  return <DocumentsControlDeck />;
}
