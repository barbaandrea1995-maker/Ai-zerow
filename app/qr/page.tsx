import QrBarcodeControl from "@/components/qr-barcode-control";
import { requirePageCapability } from "@/lib/page-access";

export const dynamic = "force-dynamic";

export default async function QrPage() {
  await requirePageCapability("qr.read");
  return <QrBarcodeControl />;
}
