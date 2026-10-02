import WorkforceControl from "@/components/workforce-control";
import { requirePageCapability } from "@/lib/page-access";

export default async function WorkforcePage() {
  await requirePageCapability("workforce.read");
  return <WorkforceControl />;
}
