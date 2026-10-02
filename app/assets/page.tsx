import AssetControl from "@/components/asset-control";
import { requirePageCapability } from "@/lib/page-access";

export default async function AssetsPage() {
  await requirePageCapability("asset.read");
  return <AssetControl />;
}
