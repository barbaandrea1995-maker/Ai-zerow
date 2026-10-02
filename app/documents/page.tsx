import S05ModulePage from "@/components/s05-module-page";
import { requirePageCapability } from "@/lib/page-access";

export default async function DocumentsPage() {
  await requirePageCapability("documents.read");
  return <S05ModulePage module="documents" />;
}
