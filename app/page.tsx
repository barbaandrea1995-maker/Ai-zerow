import { redirect } from "next/navigation";
import CommandSurface from "@/app/page-client";
import { getNeonAuthIdentity } from "@/lib/neon-auth/tenant-context";

export const dynamic = "force-dynamic";

/**
 * The PWA root is the Neon Auth entry gate. Unauthenticated visitors must
 * see the login before any operational surface is rendered.
 */
export default async function HomePage() {
  const identity = await getNeonAuthIdentity();

  if (identity.status !== "authenticated") {
    redirect("/login");
  }

  return <CommandSurface actor={identity.actor} />;
}
