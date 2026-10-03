import MissionControl from "@/components/mission-command-deck";
import { requirePageCapability } from "@/lib/page-access";

export default async function MissionPage() {
  await requirePageCapability("mission.read");
  return <MissionControl />;
}
