import QrBarcodeControl from "@/components/qr-barcode-control";
import { getAllowedCommandNavigation } from "@/lib/command-dashboard";
import { requirePageCapability } from "@/lib/page-access";

export const dynamic = "force-dynamic";

export default async function QrPage() {
  const authority = await requirePageCapability("qr.read");
  const allowedNavigation = getAllowedCommandNavigation(authority.capabilities).map((item) => item.id);
  return <QrBarcodeControl allowedNavigation={allowedNavigation} />;
}
