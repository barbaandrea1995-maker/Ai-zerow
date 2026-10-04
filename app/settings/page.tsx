import { hasCapability } from "@/lib/authority-context";
import { requirePageCapability } from "@/lib/page-access";
import SettingsClient from "./settings-client";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const authority = await requirePageCapability("settings.read");

  return (
    <SettingsClient
      actor={{
        email: authority.actorEmail,
        name: authority.actorName,
      }}
      canManageLocation={hasCapability(authority, "location.manage.tracking.devices")}
    />
  );
}
