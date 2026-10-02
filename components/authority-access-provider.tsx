"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { AuthorityRole } from "@/lib/authority-catalog";

type AuthorityAccess = {
  capabilities: ReadonlySet<string>;
  role: AuthorityRole;
};

const AuthorityAccessContext = createContext<AuthorityAccess | null>(null);

export function AuthorityAccessProvider({
  capabilities,
  children,
  role,
}: {
  capabilities: string[];
  children: ReactNode;
  role: AuthorityRole;
}) {
  const value = useMemo(
    () => ({ capabilities: new Set(capabilities), role }),
    [capabilities, role],
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
