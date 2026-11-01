import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { accessProfiles, s06Events, s06Outbox, s06Reconciliations } from "@/db/schema";
import {
  assertTenantScope,
  getAuthorityContext,
  hasCapability,
  profileForResponse,
  publicAuthorityContext,
  type AuthorityContext,
} from "@/lib/authority-context";
import {
  isAuthorityRole,
  ROLE_CAPABILITIES,
} from "@/lib/authority-catalog";
import { filterCapabilitiesForDomains } from "@/lib/tenant-operating-model";

export const dynamic = "force-dynamic";

function jsonError(error: unknown) {
  const message = error instanceof Error ? error.message : "unexpected_error";
  if (message.includes("no such table") || message.includes("access_profiles")) {
    return "authority_store_unavailable";
  }
  return "authority_readback_failed";
}

function requireAuthorityRead(
  context: AuthorityContext | null,
): Response | null {
  if (!context) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!hasCapability(context, "authority.read")) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  return null;
}

function requireAuthorityWrite(
  context: AuthorityContext | null,
): Response | null {
  if (!context) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!hasCapability(context, "authority.manage")) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  return null;
}

export async function GET() {
  const context = await getAuthorityContext();
  const denied = requireAuthorityRead(context);
  if (denied) return denied;

  try {
    const db = getDb();
    const rows = await db
      .select()
      .from(accessProfiles)
      .where(eq(accessProfiles.tenantId, context!.tenantId))
      .orderBy(desc(accessProfiles.createdAt));

    return Response.json({
      context: publicAuthorityContext(context!),
      profiles: rows.map(profileForResponse),
    });
  } catch (error) {
    return Response.json({ error: jsonError(error) }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const context = await getAuthorityContext();
  const denied = requireAuthorityWrite(context);
  if (denied) return denied;

  let payload: { label?: unknown; role?: unknown; idempotencyKey?: unknown };
  try {
    payload = (await request.json()) as { label?: unknown; role?: unknown; idempotencyKey?: unknown };
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const label = typeof payload.label === "string" ? payload.label.trim() : "";
  const role = typeof payload.role === "string" ? payload.role : "";
  const idempotencyKey = typeof payload.idempotencyKey === "string" ? payload.idempotencyKey.trim().slice(0, 160) : "";
  if (label.length < 2 || label.length > 80) {
    return Response.json({ error: "label_must_be_2_to_80_characters" }, { status: 400 });
  }
  if (!isAuthorityRole(role)) {
    return Response.json({ error: "invalid_base_role" }, { status: 400 });
  }
  if (!/^[A-Za-z0-9:_-]{12,160}$/.test(idempotencyKey)) {
    return Response.json({ error: "idempotency_key_required" }, { status: 400 });
  }

  try {
    assertTenantScope(context!, context!.tenantId);
    const db = getDb();
    const [priorEvent] = await db.select({ aggregateId: s06Events.aggregateId })
      .from(s06Events)
      .where(and(eq(s06Events.tenantId, context!.tenantId), eq(s06Events.idempotencyKey, idempotencyKey)))
      .limit(1);
    if (priorEvent) {
      const [priorProfile] = await db.select().from(accessProfiles).where(and(
        eq(accessProfiles.tenantId, context!.tenantId),
        eq(accessProfiles.id, priorEvent.aggregateId),
      )).limit(1);
      if (!priorProfile) return Response.json({ error: "authority_profile_idempotent_readback_unavailable" }, { status: 503 });
      return Response.json({
        context: publicAuthorityContext(context!),
        profile: profileForResponse(priorProfile),
        idempotent: true,
        readback: "verified",
      });
    }

    const currentProfiles = await db.select({ id: accessProfiles.id, label: accessProfiles.label })
      .from(accessProfiles)
      .where(eq(accessProfiles.tenantId, context!.tenantId));
    if (currentProfiles.some((profile) => profile.label.toLocaleLowerCase("it-IT") === label.toLocaleLowerCase("it-IT"))) {
      return Response.json({ error: "authority_profile_label_already_exists" }, { status: 409 });
    }

    const id = crypto.randomUUID();
    const eventId = crypto.randomUUID();
    const now = new Date().toISOString();
    const capabilities = filterCapabilitiesForDomains([...ROLE_CAPABILITIES[role]], context!.operatingDomains);
    await db.batch([
      db.insert(accessProfiles).values({
        id,
        tenantId: context!.tenantId,
        label,
        baseRole: role,
        capabilitiesJson: JSON.stringify(capabilities),
        createdBy: context!.actorId,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(s06Events).values({
        eventId,
        tenantId: context!.tenantId,
        eventType: "authority.access_profile.created",
        schemaVersion: "1",
        actorType: "human",
        actorId: context!.actorId,
        source: "sites-authority",
        occurredAt: now,
        observedAt: now,
        aggregateType: "authority.access_profile",
        aggregateId: id,
        aggregateVersion: 1,
        payloadJson: JSON.stringify({ label, baseRole: role, capabilities }),
        correlationId: crypto.randomUUID(),
        causationId: null,
        idempotencyKey,
        status: "COMMITTED_SITES_READBACK",
        createdAt: now,
      }),
      db.insert(s06Outbox).values({ id: crypto.randomUUID(), tenantId: context!.tenantId, eventId, topic: "zerow.authority.access_profile.created", status: "PENDING_EXTERNAL_CONSUMER", attempts: 0, createdAt: now, updatedAt: now }),
      db.insert(s06Reconciliations).values({ id: crypto.randomUUID(), tenantId: context!.tenantId, aggregateType: "authority.access_profile", aggregateId: id, expectedVersion: 1, observedVersion: 1, status: "SITES_READBACK_VERIFIED", detail: "Profilo accesso e capability canoniche riletti nel tenant autorizzato.", createdAt: now, updatedAt: now }),
    ] as const);

    const [row] = await db.select().from(accessProfiles).where(and(
      eq(accessProfiles.tenantId, context!.tenantId),
      eq(accessProfiles.id, id),
    )).limit(1);
    if (!row) return Response.json({ error: "authority_profile_readback_unavailable" }, { status: 503 });

    return Response.json(
      { context: publicAuthorityContext(context!), profile: profileForResponse(row), idempotent: false, readback: "verified" },
      { status: 201 },
    );
  } catch (error) {
    return Response.json({ error: jsonError(error) }, { status: 503 });
  }
}
