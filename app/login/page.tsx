import LoginClient from "@/app/login/login-client";
import { getNeonAuthIdentity } from "@/lib/neon-auth/tenant-context";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const identity = await getNeonAuthIdentity();

  return (
    <LoginClient
      initialState={
        identity.status === "authenticated"
          ? "authenticated"
          : identity.status === "not_configured"
            ? "not_configured"
            : identity.status === "error"
              ? "error"
              : "ready"
      }
      actor={identity.status === "authenticated" ? identity.actor : null}
    />
  );
}
