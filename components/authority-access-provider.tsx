"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { AuthorityRole } from "@/lib/authority-catalog";

type AuthorityAccess = {
  capabilities: ReadonlySet<string>;
  role: AuthorityRole;
  roles: AuthorityRole[];
  actor: {
    email: string;
    name: string;
  };
};

const AuthorityAccessContext = createContext<AuthorityAccess | null>(null);

export function AuthorityAccessProvider({
  actor,
  capabilities,
  children,
  role,
  roles,
}: {
  actor: {
    email: string;
    name: string;
  };
  capabilities: string[];
  children: ReactNode;
  role: AuthorityRole;
  roles: AuthorityRole[];
}) {
  const value = useMemo(
    () => ({ actor, capabilities: new Set(capabilities), role, roles }),
    [actor, capabilities, role, roles],
  );
  return (
    <AuthorityAccessContext.Provider value={value}>
      {children}
    </AuthorityAccessContext.Provider>
  );
}

export function useAuthorityCapability(capability: string) {
  const access = useContext(AuthorityAccessContext);
  return access?.capabilities.has(capability) ?? false;
}

export function useAuthorityAccess() {
  const access = useContext(AuthorityAccessContext);
  if (!access) {
    throw new Error("authority_access_provider_missing");
  }
  return access;
}
