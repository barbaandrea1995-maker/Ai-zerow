import LoginClient from "@/app/login/login-client";

export const dynamic = "force-dynamic";

type LoginSearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: LoginSearchParams;
}) {
  // Keep the public login surface independent from an upstream Neon session
  // read. Protected routes and the account menu still verify the session
  // server-side; this page must always be able to render the sign-in form.
  const query = await searchParams;
  const requestedMode = firstQueryValue(query.mode);
  const resetToken = firstQueryValue(query.token) ?? null;

  return (
    <LoginClient
      initialState="ready"
      actor={null}
      initialMode={requestedMode === "forgotPassword" ? "forgotPassword" : "signIn"}
      resetToken={resetToken}
    />
  );
}
