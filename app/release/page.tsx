import ReleaseCertificationCenter from "@/components/release-certification-center";
import { requirePageCapability } from "@/lib/page-access";

export default async function ReleasePage() {
  await requirePageCapability("authority.read");
  return <ReleaseCertificationCenter />;
}
