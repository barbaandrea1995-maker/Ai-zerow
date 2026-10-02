import S04ModulePage from "@/components/s04-module-page";
import { requirePageCapability } from "@/lib/page-access";

export default async function WorkforcePage() {
  await requirePageCapability("workforce.read");
  return <S04ModulePage module="workforce" />;
}
