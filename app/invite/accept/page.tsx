import InviteAcceptClient from "@/app/invite/accept/invite-accept-client";

export const dynamic = "force-dynamic";

export default async function InviteAcceptPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const rawToken = (await searchParams).token;
  const token = typeof rawToken === "string" && /^[a-f0-9]{64}$/.test(rawToken) ? rawToken : "";
  return <InviteAcceptClient token={token} />;
}
