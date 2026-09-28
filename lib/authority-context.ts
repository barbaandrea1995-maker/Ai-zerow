import { getChatGPTUser, type ChatGPTUser } from "@/app/chatgpt-auth";
import {
  ROLE_CAPABILITIES,
  type AuthorityRole,
} from "@/lib/authority-catalog";

/**
 * In the Sites-only phase, the private Site itself is the tenant boundary.
 * The project id is public configuration, not a credential.
 */
export const SITES_TENANT_ID = "sites:appgprj_6abaaf2bb58081919b265a8a6ad76dbb";

export type AuthorityContext = {
  actorId: string;
  actorEmail: string;
  actorName: string;
  membershipId: string;
  tenantId: string;
  environment: "sites-local-preview" | "sites-production";
  role: AuthorityRole;
  capabilities: string[];
  resourceScope: "tenant";
  fieldScope: "tenant";
  fileScope: "site";
  contextSource: "sites-workspace-auth";
  sessionId: null;
  expiresAt: null;
  approvalContext: "owner";
};

export async function getAuthorityContext(): Promise<AuthorityContext | null> {
  const user = await getChatGPTUser();
  if (!user) return null;

  const environment =
    process.env.NODE_ENV === "production"
      ? "sites-production"
      : "sites-local-preview";

  return {
    actorId: user.userId,
    actorEmail: user.email,
    actorName: user.displayName,
    membershipId: `site-owner:${SITES_TENANT_ID}:${user.userId}`,
    tenantId: SITES_TENANT_ID,
    environment,
    role: "owner",
    capabilities: [...ROLE_CAPABILITIES.owner],
    resourceScope: "tenant",
    fieldScope: "tenant",
    fileScope: "site",
    contextSource: "sites-workspace-auth",
    sessionId: null,
    expiresAt: null,
    approvalContext: "owner",
  };
}

export function hasCapability(
  context: AuthorityContext,
  capability: string,
): boolean {
  return context.capabilities.includes(capability);
}

export function assertTenantScope(
  context: AuthorityContext,
  resourceTenantId: string,
): void {
  if (context.tenantId !== resourceTenantId) {
    throw new Error("cross_tenant_access_denied");
  }
}

export function publicAuthorityContext(context: AuthorityContext) {
  return {
    actorId: context.actorId,
    actorEmail: context.actorEmail,
    actorName: context.actorName,
    membershipId: context.membershipId,
    tenantId: context.tenantId,
    environment: context.environment,
    role: context.role,
    capabilities: context.capabilities,
    resourceScope: context.resourceScope,
    fieldScope: context.fieldScope,
    fileScope: context.fileScope,
    contextSource: context.contextSource,
    sessionId: context.sessionId,
    expiresAt: context.expiresAt,
    approvalContext: context.approvalContext,
  };
}

export function profileForResponse(row: {
  id: string;
  tenantId: string;
  label: string;
  baseRole: string;
  capabilitiesJson: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}) {
  let capabilities: string[] = [];
  try {
    const parsed = JSON.parse(row.capabilitiesJson);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      capabilities = parsed;
    }
  } catch {
    capabilities = [];
  }

  return {
    id: row.id,
    tenantId: row.tenantId,
    label: row.label,
    baseRole: row.baseRole,
    capabilities,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export type SitesChatGPTUser = ChatGPTUser;
