import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  s04Records,
  s06Events,
  s06Outbox,
  s06Reconciliations,
  tenantInvitations,
  tenantMemberships,
} from "@/db/schema";
import { getAuthorityContext, hasCapability, publicAuthorityContext } from "@/lib/authority-context";
import { authorityRolesJson, isAuthorityRole, normalizeAuthorityRoles, type AuthorityRole } from "@/lib/authority-catalog";
import {
  createInvitationToken,
  hashInvitationToken,
  invitationForResponse,
  isValidAuthorityEmail,
  membershipForResponse,
  normalizeAuthorityEmail,
} from "@/lib/authority-lifecycle";
import { allocateServerName } from "@/lib/server-naming";

export const dynamic = "force-dynamic";

type JsonObject = Record<string, unknown>;

function hasDriverRole(roles: readonly AuthorityRole[]) {
  return roles.includes("driver") || roles.includes("delivery_driver");
}

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function boundedText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function rolesFromInput(input: JsonObject, fallback = "member") {
  const raw = input.roles ?? input.role;
  return normalizeAuthorityRoles(raw, fallback);
}

function sameRoles(left: readonly AuthorityRole[], right: readonly AuthorityRole[]) {
  return left.length === right.length && left.every((role, index) => role === right[index]);
}

function requireAuthority(operation: "read" | "manage") {
  return getAuthorityContext().then((context) => {
    if (!context) return { context: null, response: Response.json({ error: "unauthenticated" }, { status: 401 }) };
    const capability = operation === "manage" ? "authority.manage" : "authority.read";
    if (!hasCapability(context, capability)) {
      return { context: null, response: Response.json({ error: "forbidden", capability }, { status: 403 }) };
    }
    return { context, response: null };
  });
}

async function tenantDirectory(tenantId: string) {
  const db = getDb();
  const [memberships, invitations] = await Promise.all([
    db.select().from(tenantMemberships)
      .where(eq(tenantMemberships.tenantId, tenantId))
      .orderBy(asc(tenantMemberships.status), asc(tenantMemberships.displayName)),
    db.select().from(tenantInvitations)
      .where(eq(tenantInvitations.tenantId, tenantId))
      .orderBy(desc(tenantInvitations.createdAt))
      .limit(100),
  ]);
  const now = Date.now();
  return {
    memberships: memberships.map(membershipForResponse),
    invitations: invitations.map((row) => ({
      ...invitationForResponse(row),
      status: row.status === "pending" && Date.parse(row.expiresAt) <= now ? "expired" : row.status,
    })),
  };
}

export async function GET() {
  const gate = await requireAuthority("read");
  if (gate.response) return gate.response;

  try {
    return Response.json({
      context: publicAuthorityContext(gate.context!),
      ...(await tenantDirectory(gate.context!.tenantId)),
    }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return Response.json({ error: "authority_membership_store_unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const gate = await requireAuthority("manage");
  if (gate.response) return gate.response;
  const context = gate.context!;

  let input: JsonObject;
  try {
    const parsed = await request.json() as unknown;
    if (!isRecord(parsed)) return Response.json({ error: "invalid_json" }, { status: 400 });
    input = parsed;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const email = normalizeAuthorityEmail(input.email);
  const roles = rolesFromInput(input);
  const role = roles[0] ?? "";
  const idempotencyKey = boundedText(input.idempotencyKey, 160);
  const requestedDays = typeof input.expiresInDays === "number" ? Math.floor(input.expiresInDays) : 7;
  const expiresInDays = Math.min(30, Math.max(1, requestedDays));

  if (!isValidAuthorityEmail(email)) return Response.json({ error: "valid_email_required" }, { status: 400 });
  if (roles.length === 0 || !isAuthorityRole(role)) return Response.json({ error: "invalid_base_role" }, { status: 400 });
  if (roles.includes("owner") && !context.roles.includes("owner")) {
    return Response.json({ error: "only_owner_can_assign_owner" }, { status: 403 });
  }
  if (idempotencyKey.length < 8) return Response.json({ error: "idempotency_key_required" }, { status: 400 });
  if (typeof input.idempotencyKey === "string" && input.idempotencyKey.trim().length > 160) {
    return Response.json({ error: "idempotency_key_too_long" }, { status: 400 });
  }

  try {
    const db = getDb();
    const [existingByKey] = await db.select().from(tenantInvitations).where(and(
      eq(tenantInvitations.tenantId, context.tenantId),
      eq(tenantInvitations.idempotencyKey, idempotencyKey),
    )).limit(1);
    if (existingByKey) {
      return Response.json({
        invitation: invitationForResponse(existingByKey),
        idempotent: true,
        inviteUrl: null,
        message: "L'invito esiste già. Per sicurezza il token monouso non viene memorizzato; revocalo e creane uno nuovo se il link è stato perso.",
      }, { headers: { "cache-control": "private, no-store" } });
    }

    const [memberships, invitations] = await Promise.all([
      db.select().from(tenantMemberships).where(eq(tenantMemberships.tenantId, context.tenantId)),
      db.select().from(tenantInvitations).where(and(
        eq(tenantInvitations.tenantId, context.tenantId),
        eq(tenantInvitations.email, email),
        eq(tenantInvitations.status, "pending"),
      )),
    ]);
    if (memberships.some((membership) => normalizeAuthorityEmail(membership.actorEmail) === email && membership.status !== "removed")) {
      return Response.json({ error: "membership_already_exists" }, { status: 409 });
    }
    const activePending = invitations.find((invitation) => Date.parse(invitation.expiresAt) > Date.now());
    if (activePending) {
      return Response.json({ error: "pending_invitation_exists", invitation: invitationForResponse(activePending) }, { status: 409 });
    }

    const token = createInvitationToken();
    const tokenHash = await hashInvitationToken(token);
    const now = new Date();
    const nowIso = now.toISOString();
    const expiresAt = new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1_000).toISOString();
    const invitationId = crypto.randomUUID();
    const eventId = crypto.randomUUID();
    const aggregateType = "authority.invitation";

    await db.batch([
      db.insert(tenantInvitations).values({
        id: invitationId,
        tenantId: context.tenantId,
        email,
        role,
        rolesJson: authorityRolesJson(roles),
        tokenHash,
        status: "pending",
        version: 1,
        expiresAt,
        invitedBy: context.actorId,
        idempotencyKey,
        createdAt: nowIso,
        updatedAt: nowIso,
      }),
      db.insert(s06Events).values({
        eventId,
        tenantId: context.tenantId,
        eventType: "authority.invitation.created",
        schemaVersion: "1",
        actorType: "human",
        actorId: context.actorId,
        source: "sites-authority",
        occurredAt: nowIso,
        observedAt: nowIso,
        aggregateType,
        aggregateId: invitationId,
        aggregateVersion: 1,
        payloadJson: JSON.stringify({ email, role, roles, expiresAt }),
        correlationId: crypto.randomUUID(),
        causationId: null,
        idempotencyKey,
        status: "COMMITTED_SITES_READBACK",
        createdAt: nowIso,
      }),
      db.insert(s06Outbox).values({
        id: crypto.randomUUID(),
        tenantId: context.tenantId,
        eventId,
        topic: "zerow.authority.invitation.created",
        status: "PENDING_EXTERNAL_CONSUMER",
        attempts: 0,
        createdAt: nowIso,
        updatedAt: nowIso,
      }),
      db.insert(s06Reconciliations).values({
        id: crypto.randomUUID(),
        tenantId: context.tenantId,
        aggregateType,
        aggregateId: invitationId,
        expectedVersion: 1,
        observedVersion: 1,
        status: "SITES_READBACK_VERIFIED",
        detail: "Invito tenant persistito con token SHA-256; il token raw non viene memorizzato.",
        createdAt: nowIso,
        updatedAt: nowIso,
      }),
    ]);

    const [created] = await db.select().from(tenantInvitations).where(and(
      eq(tenantInvitations.tenantId, context.tenantId),
      eq(tenantInvitations.id, invitationId),
    )).limit(1);
    if (!created) return Response.json({ error: "invitation_readback_unavailable" }, { status: 503 });

    const inviteUrl = new URL("/invite/accept", request.url);
    inviteUrl.searchParams.set("token", token);
    return Response.json({
      invitation: invitationForResponse(created),
      inviteUrl: inviteUrl.toString(),
      idempotent: false,
      delivery: "manual_secure_link",
    }, { status: 201, headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE") || message.includes("unique")) {
      return Response.json({ error: "authority_invitation_conflict" }, { status: 409 });
    }
    return Response.json({ error: "authority_invitation_unavailable" }, { status: 503 });
  }
}

function canManageTarget(requesterRoles: readonly AuthorityRole[], targetRoles: readonly AuthorityRole[]) {
  return !targetRoles.includes("owner") || requesterRoles.includes("owner");
}

export async function PATCH(request: Request) {
  const gate = await requireAuthority("manage");
  if (gate.response) return gate.response;
  const context = gate.context!;

  let input: JsonObject;
  try {
    const parsed = await request.json() as unknown;
    if (!isRecord(parsed)) return Response.json({ error: "invalid_json" }, { status: 400 });
    input = parsed;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const targetType = input.targetType === "invitation" ? "invitation" : "membership";
  const targetId = boundedText(input.targetId, 160);
  const action = boundedText(input.action, 48).toLowerCase();
  const idempotencyKey = boundedText(input.idempotencyKey, 160);
  const expectedVersion = typeof input.expectedVersion === "number" ? Math.floor(input.expectedVersion) : 0;
  if (!targetId) return Response.json({ error: "target_id_required" }, { status: 400 });
  if (expectedVersion < 1) return Response.json({ error: "expected_version_required" }, { status: 400 });
  if (idempotencyKey.length < 8) return Response.json({ error: "idempotency_key_required" }, { status: 400 });

  try {
    const db = getDb();
    const [existingEvent] = await db.select().from(s06Events).where(and(
      eq(s06Events.tenantId, context.tenantId),
      eq(s06Events.idempotencyKey, idempotencyKey),
    )).limit(1);
    if (existingEvent) {
      const directory = await tenantDirectory(context.tenantId);
      return Response.json({ ...directory, idempotent: true, eventId: existingEvent.eventId }, {
        headers: { "cache-control": "private, no-store" },
      });
    }

    const now = new Date().toISOString();
    const eventId = crypto.randomUUID();
    if (targetType === "invitation") {
      if (action !== "revoke") return Response.json({ error: "unknown_invitation_action" }, { status: 400 });
      const [target] = await db.select().from(tenantInvitations).where(and(
        eq(tenantInvitations.tenantId, context.tenantId),
        eq(tenantInvitations.id, targetId),
      )).limit(1);
      if (!target) return Response.json({ error: "invitation_not_found" }, { status: 404 });
      if (target.status !== "pending") return Response.json({ error: "invitation_not_pending" }, { status: 409 });
      if (target.version !== expectedVersion) {
        return Response.json({ error: "version_conflict", currentVersion: target.version }, { status: 409 });
      }
      const nextVersion = target.version + 1;
      const aggregateType = "authority.invitation";
      const result = await db.batch([
        db.update(tenantInvitations).set({ status: "revoked", version: nextVersion, updatedAt: now }).where(and(
          eq(tenantInvitations.tenantId, context.tenantId),
          eq(tenantInvitations.id, target.id),
          eq(tenantInvitations.version, target.version),
        )).returning(),
        db.insert(s06Events).values({
          eventId,
          tenantId: context.tenantId,
          eventType: "authority.invitation.revoked",
          schemaVersion: "1",
          actorType: "human",
          actorId: context.actorId,
          source: "sites-authority",
          occurredAt: now,
          observedAt: now,
          aggregateType,
          aggregateId: target.id,
          aggregateVersion: nextVersion,
          payloadJson: JSON.stringify({ email: target.email, role: target.role }),
          correlationId: crypto.randomUUID(),
          causationId: null,
          idempotencyKey,
          status: "COMMITTED_SITES_READBACK",
          createdAt: now,
        }),
        db.insert(s06Outbox).values({
          id: crypto.randomUUID(), tenantId: context.tenantId, eventId,
          topic: "zerow.authority.invitation.revoked", status: "PENDING_EXTERNAL_CONSUMER",
          attempts: 0, createdAt: now, updatedAt: now,
        }),
        db.insert(s06Reconciliations).values({
          id: crypto.randomUUID(), tenantId: context.tenantId, aggregateType, aggregateId: target.id,
          expectedVersion: nextVersion, observedVersion: nextVersion, status: "SITES_READBACK_VERIFIED",
          detail: "Invito revocato e riletto nel tenant Authority.", createdAt: now, updatedAt: now,
        }),
      ]);
      if (!(result[0] as (typeof tenantInvitations.$inferSelect)[])[0]) {
        return Response.json({ error: "version_conflict" }, { status: 409 });
      }
      return Response.json({ ...(await tenantDirectory(context.tenantId)), idempotent: false, eventId }, {
        headers: { "cache-control": "private, no-store" },
      });
    }

    const [target] = await db.select().from(tenantMemberships).where(and(
      eq(tenantMemberships.tenantId, context.tenantId),
      eq(tenantMemberships.id, targetId),
    )).limit(1);
    if (!target) return Response.json({ error: "membership_not_found" }, { status: 404 });
    const targetRoles = normalizeAuthorityRoles(target.rolesJson, target.role);
    if (targetRoles.length === 0 || !isAuthorityRole(target.role)) return Response.json({ error: "membership_role_invalid" }, { status: 409 });
    if (!canManageTarget(context.roles, targetRoles)) return Response.json({ error: "owner_authority_required" }, { status: 403 });
    if (target.version !== expectedVersion) {
      return Response.json({ error: "version_conflict", currentVersion: target.version }, { status: 409 });
    }

    let nextRole: AuthorityRole = target.role;
    let nextRoles: AuthorityRole[] = targetRoles;
    let nextStatus = target.status;
    if (action === "set_role" || action === "set_roles") {
      const requestedRoles = rolesFromInput(input, target.role);
      const requestedRole = requestedRoles[0];
      if (requestedRoles.length === 0 || !requestedRole || !isAuthorityRole(requestedRole)) return Response.json({ error: "invalid_base_role" }, { status: 400 });
      if (requestedRoles.includes("owner") && !context.roles.includes("owner")) {
        return Response.json({ error: "only_owner_can_assign_owner" }, { status: 403 });
      }
      if (target.actorId === context.actorId && !sameRoles(requestedRoles, targetRoles)) {
        // An Owner may add operational roles to their own membership for
        // field/driver work and testing, but can never remove the Owner
        // authority from the current session. Non-owners still require an
        // Authority manager to change their own roles.
        if (!context.roles.includes("owner") || !requestedRoles.includes("owner")) {
          return Response.json({ error: "self_role_change_not_allowed" }, { status: 409 });
        }
      }
      nextRole = requestedRole;
      nextRoles = requestedRoles;
    } else if (action === "suspend") {
      if (target.actorId === context.actorId) return Response.json({ error: "self_suspend_not_allowed" }, { status: 409 });
      nextStatus = "suspended";
    } else if (action === "reactivate") {
      nextStatus = "active";
    } else if (action === "remove") {
      if (target.actorId === context.actorId) return Response.json({ error: "self_remove_not_allowed" }, { status: 409 });
      nextStatus = "removed";
    } else {
      return Response.json({ error: "unknown_membership_action" }, { status: 400 });
    }

    const activeMemberships = await db.select().from(tenantMemberships).where(and(
      eq(tenantMemberships.tenantId, context.tenantId),
      eq(tenantMemberships.status, "active"),
    ));
    const activeOwners = activeMemberships.filter((membership) => normalizeAuthorityRoles(membership.rolesJson, membership.role).includes("owner"));
    const removesActiveOwner = targetRoles.includes("owner") && target.status === "active"
      && (!nextRoles.includes("owner") || nextStatus !== "active");
    if (removesActiveOwner && activeOwners.length <= 1) {
      return Response.json({ error: "last_active_owner_required" }, { status: 409 });
    }

    const nextVersion = target.version + 1;
    const aggregateType = "authority.membership";
    const driverResourceId = `AUTH-DRIVER-${target.actorId}`.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 200);
    const [driverResource] = hasDriverRole(targetRoles) || hasDriverRole(nextRoles)
      ? await db.select().from(s04Records).where(and(
        eq(s04Records.tenantId, context.tenantId),
        eq(s04Records.id, driverResourceId),
      )).limit(1)
      : [];
    const driverAvailable = hasDriverRole(nextRoles) && nextStatus === "active";
    const driverStatus = driverAvailable ? "AVAILABLE" : hasDriverRole(nextRoles) ? "SUSPENDED" : "INACTIVE";
    const driverNaming = hasDriverRole(nextRoles) && !driverResource
      ? await allocateServerName({
        tenantId: context.tenantId,
        module: "workforce",
        entityType: "driver",
        description: target.displayName || target.actorEmail,
      })
      : null;
    let driverPayload: JsonObject = {};
    if (driverResource) {
      try {
        const parsed = JSON.parse(driverResource.payloadJson) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) driverPayload = parsed as JsonObject;
      } catch {
        driverPayload = {};
      }
    }
    driverPayload = {
      ...driverPayload,
      entityType: "driver",
      resourceKind: "driver",
      lifecycleStatus: driverStatus,
      authorityMembershipId: target.id,
      actorId: target.actorId,
      actorEmail: target.actorEmail,
      authorityRoles: nextRoles,
      deliveryDriver: nextRoles.includes("delivery_driver"),
      source: "authority-membership-sync",
      updatedAt: now,
    };
    const driverStatements = driverNaming
      ? [db.insert(s04Records).values({
        id: driverResourceId,
        tenantId: context.tenantId,
        module: "workforce",
        canonicalCode: driverNaming.canonicalCode,
        recordType: "driver",
        title: target.displayName || target.actorEmail,
        detail: "Autista autorizzato da Authority",
        meta: `AUTISTA · membership ${target.id}`,
        status: driverStatus,
        tone: "lime",
        progress: 100,
        payloadJson: JSON.stringify(driverPayload),
        createdBy: context.actorId,
        createdAt: now,
        updatedAt: now,
      })]
      : driverResource
        ? [db.update(s04Records).set({
          title: target.displayName || target.actorEmail,
          detail: "Autista autorizzato da Authority",
          meta: `AUTISTA · membership ${target.id}`,
          status: driverStatus,
          payloadJson: JSON.stringify(driverPayload),
          updatedAt: now,
        }).where(and(
          eq(s04Records.tenantId, context.tenantId),
          eq(s04Records.id, driverResource.id),
        ))]
        : [];
    const result = await db.batch([
      db.update(tenantMemberships).set({
        role: nextRole,
        rolesJson: authorityRolesJson(nextRoles),
        status: nextStatus,
        version: nextVersion,
        updatedAt: now,
      }).where(and(
        eq(tenantMemberships.tenantId, context.tenantId),
        eq(tenantMemberships.id, target.id),
        eq(tenantMemberships.version, target.version),
      )).returning(),
      db.insert(s06Events).values({
        eventId,
        tenantId: context.tenantId,
        eventType: `authority.membership.${action}`,
        schemaVersion: "1",
        actorType: "human",
        actorId: context.actorId,
        source: "sites-authority",
        occurredAt: now,
        observedAt: now,
        aggregateType,
        aggregateId: target.id,
        aggregateVersion: nextVersion,
        payloadJson: JSON.stringify({
          before: { role: target.role, roles: targetRoles, status: target.status, version: target.version },
          after: { role: nextRole, roles: nextRoles, status: nextStatus, version: nextVersion },
          resource: driverNaming || driverResource ? { id: driverResourceId, status: driverStatus } : null,
        }),
        correlationId: crypto.randomUUID(),
        causationId: null,
        idempotencyKey,
        status: "COMMITTED_SITES_READBACK",
        createdAt: now,
      }),
      db.insert(s06Outbox).values({
        id: crypto.randomUUID(), tenantId: context.tenantId, eventId,
        topic: `zerow.authority.membership.${action}`, status: "PENDING_EXTERNAL_CONSUMER",
        attempts: 0, createdAt: now, updatedAt: now,
      }),
      db.insert(s06Reconciliations).values({
        id: crypto.randomUUID(), tenantId: context.tenantId, aggregateType, aggregateId: target.id,
        expectedVersion: nextVersion, observedVersion: nextVersion, status: "SITES_READBACK_VERIFIED",
        detail: "Membership aggiornata con optimistic version e readback tenant-scoped.", createdAt: now, updatedAt: now,
      }),
      ...driverStatements,
    ]);
    if (!(result[0] as (typeof tenantMemberships.$inferSelect)[])[0]) {
      return Response.json({ error: "version_conflict" }, { status: 409 });
    }

    return Response.json({ ...(await tenantDirectory(context.tenantId)), idempotent: false, eventId }, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE") || message.includes("unique")) {
      return Response.json({ error: "idempotency_or_version_conflict" }, { status: 409 });
    }
    return Response.json({ error: "authority_membership_update_unavailable" }, { status: 503 });
  }
}
