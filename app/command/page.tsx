import { redirect } from "next/navigation";
import CommandSurface from "@/app/page-client";
import { getNeonAuthIdentity } from "@/lib/neon-auth/tenant-context";

/**
 * Canonical COMMAND route from the reconstruction catalog.
 * Keep the same Neon Auth gate as the PWA root.
 */
export const dynamic = "force-dynamic";

export default async function CommandPage() {
  const identity = await getNeonAuthIdentity();

  if (identity.status !== "authenticated") {
    redirect("/login");
  }

  return <CommandSurface actor={identity.actor} />;
}
