import MissionControl from "@/components/mission-control";
import { requirePageCapability } from "@/lib/page-access";

export default async function MissionPage() {
  await requirePageCapability("mission.read");
  return <MissionControl />;
}
