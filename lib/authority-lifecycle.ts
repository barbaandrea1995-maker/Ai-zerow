import type { tenantInvitations, tenantMemberships } from "@/db/schema";
import { ROLE_METADATA, isAuthorityRole, normalizeAuthorityRoles } from "@/lib/authority-catalog";

export const MEMBERSHIP_STATUSES = ["active", "suspended", "removed"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const INVITATION_STATUSES = ["pending", "accepted", "revoked", "expired"] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export function normalizeAuthorityEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLocaleLowerCase("en-US").slice(0, 254) : "";
}

export function isValidAuthorityEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function isMembershipStatus(value: unknown): value is MembershipStatus {
  return typeof value === "string" && MEMBERSHIP_STATUSES.includes(value as MembershipStatus);
}

export function createInvitationToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashInvitationToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function invitationForResponse(row: typeof tenantInvitations.$inferSelect) {
  const roles = normalizeAuthorityRoles(row.rolesJson, row.role);
  return {
    id: row.id,
    tenantId: row.tenantId,
    email: row.email,
    role: row.role,
    roleLabel: isAuthorityRole(row.role) ? ROLE_METADATA[row.role].label : row.role,
    roles,
    rolesLabel: roles.map((role) => ROLE_METADATA[role].label),
    status: row.status,
    version: row.version,
    expiresAt: row.expiresAt,
    invitedBy: row.invitedBy,
    acceptedBy: row.acceptedBy,
    acceptedAt: row.acceptedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function membershipForResponse(row: typeof tenantMemberships.$inferSelect) {
  const roles = normalizeAuthorityRoles(row.rolesJson, row.role);
  return {
    id: row.id,
    tenantId: row.tenantId,
    identityProvider: row.identityProvider,
    actorId: row.actorId,
    actorEmail: row.actorEmail,
    displayName: row.displayName,
    role: row.role,
    roleLabel: isAuthorityRole(row.role) ? ROLE_METADATA[row.role].label : row.role,
    roles,
    rolesLabel: roles.map((role) => ROLE_METADATA[role].label),
    status: row.status,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
