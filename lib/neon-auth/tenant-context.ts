import { neonAuth } from "@/lib/neon-auth/server";

export type NeonTenantMembership = {
  id: string;
  name: string;
  slug: string;
  role: string;
};

export type NeonTenantContext = {
  actor: {
    id: string;
    email: string;
    name: string;
  };
  sessionId: string;
  tenants: NeonTenantMembership[];
};

export type NeonAuthContextResult =
  | {
      status: "not_configured";
      code: "neon_auth_not_configured";
    }
  | {
      status: "unauthenticated";
      code: "neon_auth_unauthenticated";
    }
  | {
      status: "error";
      code: "neon_auth_context_unavailable";
    }
  | {
      status: "authenticated";
      context: NeonTenantContext;
    };

export async function getNeonAuthContext(): Promise<NeonAuthContextResult> {
  if (!neonAuth) {
    return {
      status: "not_configured",
      code: "neon_auth_not_configured",
    };
  }

  try {
    const sessionResult = await neonAuth.getSession();

    if (sessionResult.error) {
      if (sessionResult.error.status === 401) {
        return {
          status: "unauthenticated",
          code: "neon_auth_unauthenticated",
        };
      }

      return {
        status: "error",
        code: "neon_auth_context_unavailable",
      };
    }

    const sessionData = sessionResult.data;
    if (!sessionData?.user || !sessionData.session) {
      return {
        status: "unauthenticated",
        code: "neon_auth_unauthenticated",
      };
    }

    const organizationsResult = await neonAuth.organization.list();
    if (organizationsResult.error || !organizationsResult.data) {
      return {
        status: "error",
        code: "neon_auth_context_unavailable",
      };
    }

    const tenants: NeonTenantMembership[] = [];
    for (const organization of organizationsResult.data) {
      const membersResult = await neonAuth.organization.listMembers({
        query: {
          organizationId: organization.id,
          limit: 100,
        },
      });

      if (membersResult.error || !membersResult.data) {
        return {
          status: "error",
          code: "neon_auth_context_unavailable",
        };
      }

      const membership = membersResult.data.members.find(
        (member) => member.userId === sessionData.user.id,
      );

      if (membership) {
        tenants.push({
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          role: membership.role,
        });
      }
    }

    return {
      status: "authenticated",
      context: {
        actor: {
          id: sessionData.user.id,
          email: sessionData.user.email,
          name: sessionData.user.name,
        },
        sessionId: sessionData.session.id,
        tenants,
      },
    };
  } catch {
    return {
      status: "error",
      code: "neon_auth_context_unavailable",
    };
  }
}

