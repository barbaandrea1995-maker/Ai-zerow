import type { ReactNode } from "react";
import { AuthorityAccessProvider } from "@/components/authority-access-provider";
import { requirePageCapability } from "@/lib/page-access";

export default async function OperationsLayout({
  children,
}: {
  children: ReactNode;
}) {
  const authority = await requirePageCapability("operations.read");
  return (
    <AuthorityAccessProvider
      actor={{ email: authority.actorEmail, name: authority.actorName }}
      capabilities={authority.capabilities}
      role={authority.role}
      roles={authority.roles}
    >
      {children}
    </AuthorityAccessProvider>
  );
}
