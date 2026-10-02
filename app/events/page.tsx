import EventsControlPage from "@/components/events-control-page";
import { requirePageCapability } from "@/lib/page-access";

export default async function EventsPage() {
  await requirePageCapability("events.read");
  return <EventsControlPage />;
}
