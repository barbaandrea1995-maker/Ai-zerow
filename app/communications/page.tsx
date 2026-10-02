import S05ModulePage from "@/components/s05-module-page";
import { requirePageCapability } from "@/lib/page-access";

export default async function CommunicationsPage() {
  await requirePageCapability("communication.read");
  return <S05ModulePage module="communications" />;
}
