import LoginClient from "@/app/login/login-client";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  // Keep the public login surface independent from an upstream Neon session
  // read. Protected routes and the account menu still verify the session
  // server-side; this page must always be able to render the sign-in form.
  return (
    <LoginClient
      initialState="ready"
      actor={null}
    />
  );
}
