import { redirect } from "next/navigation";
import { getAuthenticatedIdentity } from "@/lib/authority-context";

export const dynamic = "force-dynamic";

export default async function TenantsPage() {
  const identity = await getAuthenticatedIdentity();
  redirect(identity ? "/onboarding?mode=setup" : "/login?return_to=/onboarding%3Fmode%3Dsetup");
}
