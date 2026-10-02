import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  s06Events,
  s06Outbox,
  s06Reconciliations,
  tenantInvitations,
  tenantMemberships,
  tenants,
} from "@/db/schema";
import { isAuthorityRole } from "@/lib/authority-catalog";
import {
  hashInvitationToken,
  invitationForResponse,
  membershipForResponse,
  normalizeAuthorityEmail,
} from "@/lib/authority-lifecycle";
import { getNeonAuthIdentity } from "@/lib/neon-auth/tenant-context";

export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export async function POST(request: Request) {
  const identity = await getNeonAuthIdentity();
  if (identity.status === "not_configured") {
    return Response.json({ error: "neon_auth_not_configured" }, { status: 503 });
  }
  if (identity.status === "error") {
    return Response.json({ error: "neon_auth_context_unavailable" }, { status: 503 });
  }
  if (identity.status !== "authenticated") {
    return Response.json({ error: "neon_identity_required" }, { status: 401 });
  }

  let input: Record<string, unknown>;
  try {
    const parsed = await request.json() as unknown;
    if (!isRecord(parsed)) return Response.json({ error: "invalid_json" }, { status: 400 });
    input = parsed;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const token = typeof input.token === "string" ? input.token.trim() : "";
  if (!/^[a-f0-9]{64}$/.test(token)) return Response.json({ error: "invalid_invitation_token" }, { status: 400 });

  try {
    const db = getDb();
    const tokenHash = await hashInvitationToken(token);
    const [invitation] = await db.select().from(tenantInvitations)
      .where(eq(tenantInvitations.tokenHash, tokenHash))
      .limit(1);
    if (!invitation) return Response.json({ error: "invitation_not_found" }, { status: 404 });
    if (!isAuthorityRole(invitation.role)) return Response.json({ error: "invitation_role_invalid" }, { status: 409 });

    const normalizedIdentityEmail = normalizeAuthorityEmail(identity.actor.email);
    if (normalizedIdentityEmail !== normalizeAuthorityEmail(invitation.email)) {
      return Response.json({
        error: "invitation_email_mismatch",
        expectedEmail: invitation.email,
        authenticatedEmail: normalizedIdentityEmail,
      }, { status: 403 });
    }

    const [tenant] = await db.select({ id: tenants.id, status: tenants.status }).from(tenants)
      .where(eq(tenants.id, invitation.tenantId))
      .limit(1);
    if (!tenant || tenant.status !== "active") return Response.json({ error: "tenant_not_active" }, { status: 409 });

    const [existingMembership] = await db.select().from(tenantMemberships).where(and(
      eq(tenantMemberships.tenantId, invitation.tenantId),
      eq(tenantMemberships.identityProvider, "neon"),
      eq(tenantMemberships.actorId, identity.actor.id),
    )).limit(1);

    if (invitation.status === "accepted") {
      if (invitation.acceptedBy !== identity.actor.id || !existingMembership) {
        return Response.json({ error: "invitation_already_used" }, { status: 409 });
      }
      return Response.json({
        invitation: invitationForResponse(invitation),
        membership: membershipForResponse(existingMembership),
        idempotent: true,
      }, { headers: { "cache-control": "private, no-store" } });
    }
    if (invitation.status !== "pending") {
      return Response.json({ error: `invitation_${invitation.status}` }, { status: 409 });
    }
    if (Date.parse(invitation.expiresAt) <= Date.now()) {
      return Response.json({ error: "invitation_expired" }, { status: 410 });
    }

    const now = new Date().toISOString();
    const invitationVersion = invitation.version + 1;
    const membershipVersion = existingMembership ? existingMembership.version + 1 : 1;
    const membershipId = existingMembership?.id ?? `neon:${invitation.tenantId}:${identity.actor.id}`;
    const membershipRole = existingMembership?.role === "owner" ? "owner" : invitation.role;
    const eventId = crypto.randomUUID();
    const idempotencyKey = `authority:invitation:${invitation.id}:accept`;
    const aggregateType = "authority.invitation";

    const result = await db.batch([
      db.update(tenantInvitations).set({
        status: "accepted",
        version: invitationVersion,
        acceptedBy: identity.actor.id,
        acceptedAt: now,
        updatedAt: now,
      }).where(and(
        eq(tenantInvitations.id, invitation.id),
        eq(tenantInvitations.status, "pending"),
        eq(tenantInvitations.version, invitation.version),
      )).returning(),
      db.insert(tenantMemberships).values({
        id: membershipId,
        tenantId: invitation.tenantId,
        identityProvider: "neon",
        actorId: identity.actor.id,
        actorEmail: normalizedIdentityEmail,
        displayName: identity.actor.name || normalizedIdentityEmail,
        role: membershipRole,
        status: "active",
        version: membershipVersion,
        createdAt: existingMembership?.createdAt ?? now,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: [tenantMemberships.tenantId, tenantMemberships.identityProvider, tenantMemberships.actorId],
        set: {
          actorEmail: normalizedIdentityEmail,
          displayName: identity.actor.name || normalizedIdentityEmail,
          role: membershipRole,
          status: "active",
          version: membershipVersion,
          updatedAt: now,
        },
      }),
      db.insert(s06Events).values({
        eventId,
        tenantId: invitation.tenantId,
        eventType: "authority.invitation.accepted",
        schemaVersion: "1",
        actorType: "human",
        actorId: identity.actor.id,
        source: "neon-invitation",
        occurredAt: now,
        observedAt: now,
        aggregateType,
        aggregateId: invitation.id,
        aggregateVersion: invitationVersion,
        payloadJson: JSON.stringify({ membershipId, role: membershipRole, identityProvider: "neon" }),
        correlationId: crypto.randomUUID(),
        causationId: null,
        idempotencyKey,
        status: "COMMITTED_SITES_READBACK",
        createdAt: now,
      }),
      db.insert(s06Outbox).values({
        id: crypto.randomUUID(), tenantId: invitation.tenantId, eventId,
        topic: "zerow.authority.invitation.accepted", status: "PENDING_EXTERNAL_CONSUMER",
        attempts: 0, createdAt: now, updatedAt: now,
      }),
      db.insert(s06Reconciliations).values({
        id: crypto.randomUUID(), tenantId: invitation.tenantId, aggregateType, aggregateId: invitation.id,
        expectedVersion: invitationVersion, observedVersion: invitationVersion, status: "SITES_READBACK_VERIFIED",
        detail: "Invito accettato dalla sessione Neon con email corrispondente; membership D1 riletta.",
        createdAt: now, updatedAt: now,
      }),
    ]);

    if (!(result[0] as (typeof tenantInvitations.$inferSelect)[])[0]) {
      return Response.json({ error: "invitation_version_conflict" }, { status: 409 });
    }

    const [acceptedInvitation] = await db.select().from(tenantInvitations)
      .where(eq(tenantInvitations.id, invitation.id)).limit(1);
    const [membership] = await db.select().from(tenantMemberships).where(and(
      eq(tenantMemberships.tenantId, invitation.tenantId),
      eq(tenantMemberships.id, membershipId),
    )).limit(1);
    if (!acceptedInvitation || !membership) return Response.json({ error: "invitation_readback_unavailable" }, { status: 503 });

    return Response.json({
      invitation: invitationForResponse(acceptedInvitation),
      membership: membershipForResponse(membership),
      idempotent: false,
    }, { status: 201, headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE") || message.includes("unique")) {
      return Response.json({ error: "invitation_acceptance_conflict" }, { status: 409 });
    }
    return Response.json({ error: "invitation_acceptance_unavailable" }, { status: 503 });
  }
}
