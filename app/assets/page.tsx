import S04ModulePage from "@/components/s04-module-page";
import { requirePageCapability } from "@/lib/page-access";

export default async function AssetsPage() {
  await requirePageCapability("asset.read");
  return <S04ModulePage module="assets" />;
}
