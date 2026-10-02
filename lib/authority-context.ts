import { and, asc, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { getChatGPTUser, type ChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { tenantMemberships, tenants } from "@/db/schema";
import {
  ROLE_CAPABILITIES,
  isAuthorityRole,
  type AuthorityRole,
} from "@/lib/authority-catalog";
import { getNeonAuthIdentity } from "@/lib/neon-auth/tenant-context";
import {
  DEFAULT_OPERATING_DOMAINS,
  DEFAULT_OPERATING_PROFILE,
  filterCapabilitiesForDomains,
  isOperatingProfileId,
  parseOperatingDomains,
  parseTransportModes,
  transportModesForProfile,
  type TransportMode,
  type OperatingDomain,
  type OperatingProfileId,
} from "@/lib/tenant-operating-model";

/**
 * The selected tenant is only a preference. Every request still verifies the
 * cookie against an active D1 membership before constructing authority.
 */
export const TENANT_SELECTION_COOKIE = "zerow_tenant_id";

/**
 * In the Sites-only phase, the private Site itself is the bootstrap boundary.
 * Once a membership exists, D1 is the source of tenant, role and capability
 * authority for both Sites and Neon identities.
 */
export const SITES_TENANT_ID = "sites:appgprj_6abaaf2bb58081919b265a8a6ad76dbb";

export type IdentityProvider = "sites" | "neon";

export type AuthenticatedIdentity = {
  identityProvider: IdentityProvider;
  actorId: string;
  actorEmail: string;
  actorName: string;
  sessionId: string | null;
};

export type AuthorityContext = {
  actorId: string;
  actorEmail: string;
  actorName: string;
  identityProvider: IdentityProvider;
  membershipId: string;
  tenantId: string;
  environment: "sites-local-preview" | "sites-production";
  role: AuthorityRole;
  capabilities: string[];
  operatingProfile: OperatingProfileId;
  operatingDomains: OperatingDomain[];
  operatingTransportModes: TransportMode[];
  resourceScope: "tenant";
  fieldScope: "tenant";
  fileScope: "site" | "tenant";
  contextSource: "sites-workspace-auth" | "neon-auth";
  sessionId: string | null;
  expiresAt: null;
  approvalContext: AuthorityRole;
};

export type AuthorityMembershipRow = {
  membershipId: string;
  identityProvider: string;
  actorId: string;
  actorEmail: string;
  displayName: string;
  membershipRole: string;
  membershipStatus: string;
  tenantId: string;
  slug: string;
  name: string;
  tenantStatus: string;
  operatingProfile: string;
  operatingDomainsJson: string;
  operatingTransportModesJson: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type AccessibleTenantDirectory = {
  identity: AuthenticatedIdentity;
  rows: AuthorityMembershipRow[];
  storeAvailable: boolean;
};

export async function getAuthenticatedIdentity(): Promise<AuthenticatedIdentity | null> {
  const neonIdentity = await getNeonAuthIdentity();
  if (neonIdentity.status === "authenticated") {
    return {
      identityProvider: "neon",
      actorId: neonIdentity.actor.id,
      actorEmail: neonIdentity.actor.email,
      actorName: neonIdentity.actor.name || neonIdentity.actor.email,
      sessionId: neonIdentity.sessionId,
    };
  }

  // The protected application uses Neon Auth, so an authenticated Neon
  // session must also be the identity used for D1 authority. Sites identity
  // remains the explicit bootstrap/fallback boundary and is resolved by the
  // dedicated getSitesAuthorityContext when both identities are required.
  const sitesUser = await getChatGPTUser();
  return sitesUser ? sitesIdentity(sitesUser) : null;
}

function sitesIdentity(user: ChatGPTUser): AuthenticatedIdentity {
  return {
    identityProvider: "sites",
    actorId: user.userId,
    actorEmail: user.email,
    actorName: user.displayName,
    sessionId: null,
  };
}

async function queryMemberships(
  identity: AuthenticatedIdentity,
): Promise<AuthorityMembershipRow[]> {
  const db = getDb();
  return db
    .select({
      membershipId: tenantMemberships.id,
      identityProvider: tenantMemberships.identityProvider,
      actorId: tenantMemberships.actorId,
      actorEmail: tenantMemberships.actorEmail,
      displayName: tenantMemberships.displayName,
      membershipRole: tenantMemberships.role,
      membershipStatus: tenantMemberships.status,
      tenantId: tenants.id,
      slug: tenants.slug,
      name: tenants.name,
      tenantStatus: tenants.status,
      operatingProfile: tenants.operatingProfile,
      operatingDomainsJson: tenants.operatingDomainsJson,
      operatingTransportModesJson: tenants.operatingTransportModesJson,
      createdBy: tenants.createdBy,
      createdAt: tenants.createdAt,
      updatedAt: tenants.updatedAt,
    })
    .from(tenantMemberships)
    .innerJoin(tenants, eq(tenantMemberships.tenantId, tenants.id))
    .where(
      and(
        eq(tenantMemberships.identityProvider, identity.identityProvider),
        eq(tenantMemberships.actorId, identity.actorId),
        eq(tenantMemberships.status, "active"),
        eq(tenants.status, "active"),
      ),
    )
    .orderBy(asc(tenants.createdAt));
}

/**
 * Reads the canonical D1 memberships for one server-derived identity.
 * Callers must construct the identity from an authenticated provider; values
 * submitted by the browser are never accepted here.
 */
export async function getMembershipsForIdentity(
  identity: AuthenticatedIdentity,
): Promise<AuthorityMembershipRow[]> {
  return queryMemberships(identity);
}

export async function getAccessibleTenantDirectory(): Promise<AccessibleTenantDirectory | null> {
  const identity = await getAuthenticatedIdentity();
  if (!identity) return null;

  try {
    return {
      identity,
      rows: await queryMemberships(identity),
      storeAvailable: true,
    };
  } catch {
    // Never fall back to a role when the canonical authorization store is down.
    return { identity, rows: [], storeAvailable: false };
  }
}

export async function getSelectedTenantId(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(TENANT_SELECTION_COOKIE)?.value?.trim() || null;
}

function contextFromRow(
  identity: AuthenticatedIdentity,
  row: AuthorityMembershipRow,
): AuthorityContext | null {
  if (!isAuthorityRole(row.membershipRole)) return null;

  const operatingProfile = isOperatingProfileId(row.operatingProfile)
    ? row.operatingProfile
    : DEFAULT_OPERATING_PROFILE;
  const operatingDomains = parseOperatingDomains(row.operatingDomainsJson);
  const operatingTransportModes = parseTransportModes(row.operatingTransportModesJson, operatingProfile);

  const environment =
    process.env.NODE_ENV === "production"
      ? "sites-production"
      : "sites-local-preview";

  return {
    actorId: identity.actorId,
    actorEmail: identity.actorEmail,
    actorName: identity.actorName,
    identityProvider: identity.identityProvider,
    membershipId: row.membershipId,
    tenantId: row.tenantId,
    environment,
    role: row.membershipRole,
    capabilities: filterCapabilitiesForDomains(ROLE_CAPABILITIES[row.membershipRole], operatingDomains),
    operatingProfile,
    operatingDomains,
    operatingTransportModes,
    resourceScope: "tenant",
    fieldScope: "tenant",
    fileScope: identity.identityProvider === "sites" ? "site" : "tenant",
    contextSource:
      identity.identityProvider === "sites"
        ? "sites-workspace-auth"
        : "neon-auth",
    sessionId: identity.sessionId,
    expiresAt: null,
    approvalContext: row.membershipRole,
  };
}

function sitesBootstrapContext(identity: AuthenticatedIdentity): AuthorityContext {
  const environment =
    process.env.NODE_ENV === "production"
      ? "sites-production"
      : "sites-local-preview";

  return {
    actorId: identity.actorId,
    actorEmail: identity.actorEmail,
    actorName: identity.actorName,
    identityProvider: "sites",
    membershipId: `site-owner:${SITES_TENANT_ID}:${identity.actorId}`,
    tenantId: SITES_TENANT_ID,
    environment,
    role: "owner",
    capabilities: [...ROLE_CAPABILITIES.owner],
    operatingProfile: DEFAULT_OPERATING_PROFILE,
    operatingDomains: [...DEFAULT_OPERATING_DOMAINS],
    operatingTransportModes: transportModesForProfile(DEFAULT_OPERATING_PROFILE),
    resourceScope: "tenant",
    fieldScope: "tenant",
    fileScope: "site",
    contextSource: "sites-workspace-auth",
    sessionId: null,
    expiresAt: null,
    approvalContext: "owner",
  };
}

/**
 * Bootstrap is a one-time transition for the private Site. As soon as the
 * canonical tenant exists, every identity—including a Sites identity—must
 * have an explicit active membership. This prevents an unlisted Site viewer
 * from inheriting owner authority after provisioning.
 */
async function canBootstrapSitesOwner() {
  const db = getDb();
  const [canonicalTenant] = await db.select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.id, SITES_TENANT_ID))
    .limit(1);
  return !canonicalTenant;
}

/**
 * Resolves only the Sites owner boundary. This is intentionally separate from
 * getAuthorityContext so an owner can link a currently authenticated Neon
 * identity without allowing the Neon identity to self-bootstrap in D1.
 */
export async function getSitesAuthorityContext(): Promise<AuthorityContext | null> {
  const sitesUser = await getChatGPTUser();
  if (!sitesUser) return null;

  const identity = sitesIdentity(sitesUser);
  try {
    const rows = await queryMemberships(identity);
    if (rows.length > 0) return contextFromRow(identity, rows[0]);
    return await canBootstrapSitesOwner() ? sitesBootstrapContext(identity) : null;
  } catch {
    return null;
  }
}

export async function getAuthorityContext(): Promise<AuthorityContext | null> {
  const directory = await getAccessibleTenantDirectory();
  if (!directory || !directory.storeAvailable) return null;

  if (directory.rows.length === 0) {
    // Only a Sites identity may create the first canonical row. Once that row
    // exists, all identities are fail-closed until explicitly provisioned.
    if (directory.identity.identityProvider !== "sites") return null;
    return await canBootstrapSitesOwner()
      ? sitesBootstrapContext(directory.identity)
      : null;
  }

  const selectedTenantId = await getSelectedTenantId();
  const selectedRow = selectedTenantId
    ? directory.rows.find((row) => row.tenantId === selectedTenantId)
    : undefined;

  // A stale or tampered cookie cannot grant access to another tenant. If it is
  // not a current membership, use the first permitted tenant instead.
  return contextFromRow(directory.identity, selectedRow ?? directory.rows[0]);
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
    identityProvider: context.identityProvider,
    membershipId: context.membershipId,
    tenantId: context.tenantId,
    environment: context.environment,
    role: context.role,
    capabilities: context.capabilities,
    operatingProfile: context.operatingProfile,
    operatingDomains: context.operatingDomains,
    operatingTransportModes: context.operatingTransportModes,
    resourceScope: context.resourceScope,
    fieldScope: context.fieldScope,
    fileScope: context.fileScope,
    contextSource: context.contextSource,
    // Session identifiers stay server-only; the public readback only reports
    // the context source and authorization result.
    sessionId: null,
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
