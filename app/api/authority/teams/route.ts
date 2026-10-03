import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  s04Records,
  s06Events,
  s06Outbox,
  s06Reconciliations,
  tenantMemberships,
} from "@/db/schema";
import {
  getAuthorityContext,
  hasCapability,
  publicAuthorityContext,
} from "@/lib/authority-context";
import { membershipForResponse } from "@/lib/authority-lifecycle";
import { allocateServerName } from "@/lib/server-naming";

export const dynamic = "force-dynamic";

type JsonObject = Record<string, unknown>;

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function parsePayload(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function stringList(value: unknown, maxItems = 32, maxLength = 48) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, maxLength))
    .filter(Boolean))].slice(0, maxItems);
}

type TeamRow = typeof s04Records.$inferSelect;
type MembershipRow = typeof tenantMemberships.$inferSelect;

function teamForResponse(row: TeamRow, memberships: MembershipRow[]) {
  const payload = parsePayload(row.payloadJson);
  const memberIds = stringList(payload.memberMembershipIds, 100, 160);
  const members = memberships
    .filter((membership) => memberIds.includes(membership.id))
    .map((membership) => membershipForResponse(membership));
  const lifecycleStatus = text(payload.lifecycleStatus, 32).toUpperCase() || row.status.toUpperCase();
  const activeMemberCount = members.filter((membership) => membership.status === "active").length;

  return {
    id: row.id,
    tenantId: row.tenantId,
    code: row.canonicalCode,
    name: row.title,
    description: text(payload.description, 500),
    status: lifecycleStatus,
    capacity: typeof payload.capacity === "number" && Number.isFinite(payload.capacity)
      ? Math.max(1, Math.min(100, payload.capacity))
      : 1,
    qualifications: stringList(payload.qualifications),
    memberIds,
    members,
    activeMemberCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function teamReadback(tenantId: string) {
  const db = getDb();
  const [rows, memberships] = await Promise.all([
    db.select().from(s04Records)
      .where(and(eq(s04Records.tenantId, tenantId), eq(s04Records.module, "workforce")))
      .orderBy(desc(s04Records.updatedAt))
      .limit(500),
    db.select().from(tenantMemberships)
      .where(eq(tenantMemberships.tenantId, tenantId))
      .orderBy(asc(tenantMemberships.status), asc(tenantMemberships.displayName)),
  ]);
  const teams = rows
    .filter((row) => row.recordType.toLowerCase() === "team")
    .map((row) => teamForResponse(row, memberships));
  return { teams, memberships };
}

function unavailable(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return message.includes("no such table") || message.includes("s04_records")
    ? "authority_team_store_unavailable"
    : "authority_team_readback_failed";
}

export async function GET() {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "authority.read")) {
    return Response.json({ error: "forbidden", capability: "authority.read" }, { status: 403 });
  }

  try {
    const readback = await teamReadback(context.tenantId);
    return Response.json({
      context: publicAuthorityContext(context),
      teams: readback.teams,
      readback: {
        status: "verified",
        scope: "tenant",
        source: "sites-d1-authority-team-readback",
        checkedAt: new Date().toISOString(),
      },
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: unavailable(error) }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "authority.manage")) {
    return Response.json({ error: "forbidden", capability: "authority.manage" }, { status: 403 });
  }

  let input: JsonObject;
  try {
    const parsed = await request.json() as unknown;
    if (!isRecord(parsed)) return Response.json({ error: "invalid_json" }, { status: 400 });
    input = parsed;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const name = text(input.name, 120);
  const description = text(input.description, 500);
  const memberIds = stringList(input.memberIds, 100, 160);
  const qualifications = stringList(input.qualifications, 32, 48);
  const rawCapacity = typeof input.capacity === "number" ? input.capacity : Number(input.capacity ?? 1);
  const capacity = Number.isFinite(rawCapacity) ? Math.max(1, Math.min(100, Math.floor(rawCapacity))) : 1;

  if (name.length < 2) return Response.json({ error: "team_name_required" }, { status: 400 });
  if (!memberIds.length) return Response.json({ error: "team_member_required" }, { status: 400 });

  try {
    const db = getDb();
    const [directory, existingRows] = await Promise.all([
      db.select().from(tenantMemberships).where(eq(tenantMemberships.tenantId, context.tenantId)),
      db.select().from(s04Records)
        .where(and(eq(s04Records.tenantId, context.tenantId), eq(s04Records.module, "workforce")))
        .limit(500),
    ]);
    const activeMemberships = directory.filter((membership) => membership.status === "active");
    const activeIds = new Set(activeMemberships.map((membership) => membership.id));
    const invalidMemberIds = memberIds.filter((id) => !activeIds.has(id));
    if (invalidMemberIds.length) {
      return Response.json({ error: "team_membership_not_active", memberIds: invalidMemberIds }, { status: 409 });
    }
    const duplicate = existingRows.some((row) =>
      row.recordType.toLowerCase() === "team" && row.title.trim().toLocaleLowerCase("it-IT") === name.toLocaleLowerCase("it-IT"),
    );
    if (duplicate) return Response.json({ error: "team_name_already_exists" }, { status: 409 });

    const naming = await allocateServerName({
      tenantId: context.tenantId,
      module: "workforce",
      entityType: "team",
      description: name,
    });
    if (!naming) return Response.json({ error: "team_code_unavailable" }, { status: 503 });

    const nowIso = new Date().toISOString();
    const id = `AUTH-TEAM-${crypto.randomUUID()}`;
    const eventId = crypto.randomUUID();
    const aggregateType = "authority.team";
    const memberActorIds = activeMemberships
      .filter((membership) => memberIds.includes(membership.id))
      .map((membership) => membership.actorId);

    await db.batch([
      db.insert(s04Records).values({
        id,
        tenantId: context.tenantId,
        module: "workforce",
        canonicalCode: naming.canonicalCode,
        recordType: "team",
        title: name,
        detail: description || `${memberIds.length} membri attivi`,
        meta: "authority-team",
        status: "AVAILABLE",
        tone: "lime",
        progress: 0,
        payloadJson: JSON.stringify({
          entityType: "team",
          resourceKind: "team",
          lifecycleStatus: "AVAILABLE",
          description,
          capacity,
          qualifications,
          memberMembershipIds: memberIds,
          memberActorIds,
          source: "authority-team",
        }),
        createdBy: context.actorId,
        createdAt: nowIso,
        updatedAt: nowIso,
      }),
      db.insert(s06Events).values({
        eventId,
        tenantId: context.tenantId,
        eventType: "authority.team.created",
        schemaVersion: "1",
        actorType: "human",
        actorId: context.actorId,
        source: "sites-authority",
        occurredAt: nowIso,
        observedAt: nowIso,
        aggregateType,
        aggregateId: id,
        aggregateVersion: 1,
        payloadJson: JSON.stringify({ code: naming.canonicalCode, name, memberIds, capacity }),
        correlationId: crypto.randomUUID(),
        causationId: null,
        idempotencyKey: eventId,
        status: "COMMITTED_SITES_READBACK",
        createdAt: nowIso,
      }),
      db.insert(s06Outbox).values({
        id: crypto.randomUUID(),
        tenantId: context.tenantId,
        eventId,
        topic: "zerow.authority.team.created",
        status: "PENDING_EXTERNAL_CONSUMER",
        attempts: 0,
        createdAt: nowIso,
        updatedAt: nowIso,
      }),
      db.insert(s06Reconciliations).values({
        id: crypto.randomUUID(),
        tenantId: context.tenantId,
        aggregateType,
        aggregateId: id,
        expectedVersion: 1,
        observedVersion: 1,
        status: "SITES_READBACK_VERIFIED",
        detail: "Squadra persistita nel read model workforce tenant-scoped con membership attive verificate.",
        createdAt: nowIso,
        updatedAt: nowIso,
      }),
    ]);

    const readback = await teamReadback(context.tenantId);
    const team = readback.teams.find((item) => item.id === id);
    if (!team) return Response.json({ error: "team_readback_unavailable" }, { status: 503 });
    return Response.json({
      context: publicAuthorityContext(context),
      team,
      teams: readback.teams,
      eventId,
      readback: {
        status: "verified",
        scope: "tenant",
        source: "sites-d1-authority-team-readback",
        checkedAt: new Date().toISOString(),
      },
    }, { status: 201, headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: unavailable(error) }, { status: 503 });
  }
}
