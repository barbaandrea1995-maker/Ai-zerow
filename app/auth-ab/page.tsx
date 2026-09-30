import AuthAbClient from "@/app/auth-ab/auth-ab-client";
import { getNeonAuthContext } from "@/lib/neon-auth/tenant-context";

export const dynamic = "force-dynamic";

export default async function AuthAbPage() {
  const initialState = await getNeonAuthContext();

  return <AuthAbClient initialState={initialState} />;
}

