"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { AuthorityRole } from "@/lib/authority-catalog";

type AuthorityAccess = {
  capabilities: ReadonlySet<string>;
  role: AuthorityRole;
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
}: {
  actor: {
    email: string;
    name: string;
  };
  capabilities: string[];
  children: ReactNode;
  role: AuthorityRole;
}) {
  const value = useMemo(
    () => ({ actor, capabilities: new Set(capabilities), role }),
    [actor, capabilities, role],
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
