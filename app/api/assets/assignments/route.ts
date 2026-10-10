import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { jobJourneyRecords, s04Records, s06Events, s06Outbox, s06Reconciliations, tenantMemberships } from "@/db/schema";
import { getAuthorityContext, hasCapability, publicAuthorityContext } from "@/lib/authority-context";
import { ROLE_METADATA, normalizeAuthorityRoles, type AuthorityRole } from "@/lib/authority-catalog";
import { canReadAllAssets, rowMatchesContext } from "@/lib/operational-scope";
import { assetAssignmentCustodyEnd, assetAssignmentStatus } from "@/lib/asset-contract";

export const dynamic = "force-dynamic";

type JsonObject = Record<string, unknown>;
type AssignmentKind = "SHORT_TERM" | "LONG_TERM";
type AssignmentStatus = "SCHEDULED" | "ACTIVE" | "RETURNED" | "CANCELLED";

const TERMINAL_STATUSES = new Set<AssignmentStatus>(["RETURNED", "CANCELLED"]);
const OPERATOR_ROLES: AuthorityRole[] = ["worker", "field_supervisor", "technical", "maintenance", "warehouse_operator"];

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseJson(value: string): JsonObject {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function bounded(value: unknown, max: number, fallback = "") {
  return stringValue(value, fallback).slice(0, max);
}

function boundedList(value: unknown, maxItems = 32, maxLength = 160) {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values
    .map((item) => bounded(item, maxLength))
    .filter(Boolean))].slice(0, maxItems);
}

function upper(value: unknown) {
  return stringValue(value).toUpperCase();
}

function assignmentKind(value: unknown): AssignmentKind | null {
  const normalized = upper(value);
  return normalized === "SHORT_TERM" || normalized === "LONG_TERM" ? normalized : null;
}

function isDriver(roles: readonly AuthorityRole[]) {
  return roles.includes("driver") || roles.includes("delivery_driver");
}

function isOperator(roles: readonly AuthorityRole[]) {
  return roles.some((role) => OPERATOR_ROLES.includes(role));
}

function canReadAssigneeRegistry(context: NonNullable<Awaited<ReturnType<typeof getAuthorityContext>>>) {
  return canReadAllAssets(context)
    || hasCapability(context, "authority.read")
    || hasCapability(context, "workforce.registry.read")
    || hasCapability(context, "workforce.read.all");
}

function assetClass(payload: JsonObject) {
  return upper(payload.entityType) === "VEHICLE" ? "VEHICLE" : "ASSET";
}

function validDate(value: string) {
  return value.length >= 10 && Number.isFinite(Date.parse(value));
}

function dateRange(payload: JsonObject) {
  const startsAt = stringValue(payload.startsAt);
  if (!validDate(startsAt)) return null;
  const endsAt = stringValue(payload.endsAt);
  const start = Date.parse(startsAt);
  const end = endsAt && validDate(endsAt) ? Date.parse(endsAt) : Number.POSITIVE_INFINITY;
  return { startsAt: new Date(start).toISOString(), endsAt: end === Number.POSITIVE_INFINITY ? null : new Date(end).toISOString(), start, end };
}

function overlaps(left: { start: number; end: number }, right: { start: number; end: number }) {
  return left.start < right.end && right.start < left.end;
}

async function readBody(request: Request) {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 48_000) return { error: "payload_too_large" as const };
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? { value: parsed } : { error: "invalid_json" as const };
  } catch {
    return { error: "invalid_json" as const };
  }
}

async function findAsset(tenantId: string, reference: string) {
  const base = and(eq(s04Records.tenantId, tenantId), eq(s04Records.module, "assets"));
  const [byId] = await getDb().select().from(s04Records).where(and(base, eq(s04Records.id, reference))).limit(1);
  if (byId) return byId;
  const [byCode] = await getDb().select().from(s04Records).where(and(base, eq(s04Records.canonicalCode, reference))).limit(1);
  return byCode ?? null;
}

async function assignmentRows(tenantId: string, assetId?: string) {
  const predicates = [
    eq(jobJourneyRecords.tenantId, tenantId),
    eq(jobJourneyRecords.domain, "assets"),
    eq(jobJourneyRecords.recordType, "ASSET_ASSIGNMENT"),
  ];
  if (assetId) predicates.push(eq(jobJourneyRecords.jobId, assetId));
  return getDb().select().from(jobJourneyRecords).where(and(...predicates)).orderBy(desc(jobJourneyRecords.updatedAt)).limit(1000);
}

function assignmentForResponse(row: typeof jobJourneyRecords.$inferSelect) {
  const payload = parseJson(row.payloadJson);
  const roles = Array.isArray(payload.assigneeRoles)
    ? payload.assigneeRoles.filter((role): role is AuthorityRole => typeof role === "string")
    : [];
  const roleLabels = roles.map((role) => ROLE_METADATA[role]?.label ?? role);
  return {
    id: row.id,
    version: row.version,
    assetId: stringValue(payload.assetId, row.jobId),
    assetCode: stringValue(payload.assetCode) || null,
    assetTitle: stringValue(payload.assetTitle, row.title),
    entityType: upper(payload.entityType) || "ASSET",
    assignmentClass: upper(payload.assignmentClass) || "ASSET",
    assignmentGroupId: stringValue(payload.assignmentGroupId) || null,
    assetIds: Array.isArray(payload.assetIds)
      ? payload.assetIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => value.trim())
      : [stringValue(payload.assetId, row.jobId)],
    assignee: {
      membershipId: stringValue(payload.assigneeMembershipId),
      actorId: stringValue(payload.assigneeActorId),
      name: stringValue(payload.assigneeName, "Persona autorizzata"),
      email: stringValue(payload.assigneeEmail) || null,
      roles,
      roleLabels,
    },
    kind: upper(payload.assignmentKind) || "SHORT_TERM",
    status: assetAssignmentStatus(row.status, payload.startsAt) as AssignmentStatus,
    startsAt: stringValue(payload.startsAt),
    endsAt: stringValue(payload.endsAt) || null,
    purpose: stringValue(payload.purpose),
    notes: stringValue(payload.notes),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    returnedAt: stringValue(payload.returnedAt) || null,
  };
}

function assigneeForResponse(row: typeof tenantMemberships.$inferSelect) {
  const roles = normalizeAuthorityRoles(row.rolesJson, row.role);
  return {
    membershipId: row.id,
    actorId: row.actorId,
    name: row.displayName,
    email: row.actorEmail,
    role: row.role,
    roles,
    roleLabels: roles.map((role) => ROLE_METADATA[role]?.label ?? role),
    status: row.status,
    eligibleFor: [
      ...(isDriver(roles) ? ["VEHICLE"] : []),
      ...(isOperator(roles) ? ["ASSET"] : []),
    ],
  };
}

function assignmentWindow(startsAt: string, endsAt: string | null) {
  const start = Date.parse(startsAt);
  const end = endsAt ? Date.parse(endsAt) : Number.POSITIVE_INFINITY;
  return { start, end };
}

function resourceIds(payload: JsonObject) {
  const ids = [payload.driverId, payload.vehicleId, payload.cargoAssetId];
  if (Array.isArray(payload.resourceIds)) ids.push(...payload.resourceIds);
  if (Array.isArray(payload.resources)) {
    ids.push(...payload.resources.map((resource) => isRecord(resource) ? resource.id : null));
  }
  return [...new Set(ids.filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => value.trim()))];
}

function journeyWindow(payload: JsonObject) {
  const slots = Array.isArray(payload.slots) ? payload.slots : [];
  const firstSlot = slots.find((slot) => isRecord(slot));
  const slotPayload = isRecord(firstSlot) ? firstSlot : {};
  const startsAt = stringValue(payload.plannedAt || payload.startsAt || slotPayload.startsAt);
  if (!validDate(startsAt)) return null;
  const endsAt = stringValue(payload.plannedEndAt || payload.endsAt || slotPayload.endsAt);
  const start = Date.parse(startsAt);
  const end = validDate(endsAt) ? Date.parse(endsAt) : start + 2 * 60 * 60 * 1000;
  return end > start ? { startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString(), start, end } : null;
}

async function scheduledJourneyRows(tenantId: string) {
  return getDb().select().from(jobJourneyRecords).where(and(
    eq(jobJourneyRecords.tenantId, tenantId),
    inArray(jobJourneyRecords.domain, ["mission", "planning"]),
    inArray(jobJourneyRecords.status, ["DRAFT", "PUBLISHED", "PLANNED", "DISPATCHED", "IN_PROGRESS"]),
  )).orderBy(desc(jobJourneyRecords.updatedAt)).limit(1000);
}

async function writeEvent(args: {
  tenantId: string;
  actorId: string;
  eventType: string;
  aggregateId: string;
  aggregateVersion: number;
  idempotencyKey: string;
  payload: JsonObject;
  now: string;
}) {
  const eventId = crypto.randomUUID();
  await getDb().batch([
    getDb().insert(s06Events).values({
      eventId,
      tenantId: args.tenantId,
      eventType: args.eventType,
      schemaVersion: "1",
      actorType: "human",
      actorId: args.actorId,
      source: "sites-asset-assignments",
      occurredAt: args.now,
      observedAt: args.now,
      aggregateType: "asset.assignment",
      aggregateId: args.aggregateId,
      aggregateVersion: args.aggregateVersion,
      payloadJson: JSON.stringify(args.payload),
      correlationId: crypto.randomUUID(),
      causationId: null,
      idempotencyKey: args.idempotencyKey,
      status: "COMMITTED_SITES_READBACK",
      createdAt: args.now,
    }),
    getDb().insert(s06Outbox).values({
      id: crypto.randomUUID(),
      tenantId: args.tenantId,
      eventId,
      topic: `zerow.asset.assignment.${args.eventType.split(".").pop() ?? "changed"}`,
      status: "PENDING_EXTERNAL_CONSUMER",
      attempts: 0,
      createdAt: args.now,
      updatedAt: args.now,
    }),
    getDb().insert(s06Reconciliations).values({
      id: crypto.randomUUID(),
      tenantId: args.tenantId,
      aggregateType: "asset.assignment",
      aggregateId: args.aggregateId,
      expectedVersion: args.aggregateVersion,
      observedVersion: args.aggregateVersion,
      status: "SITES_READBACK_VERIFIED",
      detail: "Assegnazione asset persistita con finestra e persona autorizzata.",
      createdAt: args.now,
      updatedAt: args.now,
    }),
  ]);
  return eventId;
}

export async function GET(request: Request) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "asset.read")) return Response.json({ error: "forbidden", capability: "asset.read" }, { status: 403 });

  try {
    const assetId = bounded(new URL(request.url).searchParams.get("assetId"), 160);
    const canReadTenantRegister = canReadAllAssets(context);
    const [members, requestedAsset] = await Promise.all([
      hasCapability(context, "asset.write") || hasCapability(context, "authority.read")
        ? getDb().select().from(tenantMemberships).where(and(eq(tenantMemberships.tenantId, context.tenantId), eq(tenantMemberships.status, "active"))).orderBy(tenantMemberships.displayName)
        : Promise.resolve([] as (typeof tenantMemberships.$inferSelect)[]),
      assetId ? findAsset(context.tenantId, assetId) : Promise.resolve(null),
    ]);
    if (assetId && !requestedAsset) return Response.json({ error: "asset_not_found" }, { status: 404 });
    const allRows = await assignmentRows(context.tenantId, assetId ? requestedAsset!.id : undefined);
    const visibleRows = canReadTenantRegister ? allRows : allRows.filter((row) => rowMatchesContext(row, context));
    if (assetId && !canReadTenantRegister && requestedAsset
      && !rowMatchesContext(requestedAsset, context)
      && visibleRows.length === 0) {
      return Response.json({ error: "asset_scope_forbidden" }, { status: 404 });
    }
    const canReadPeople = canReadAssigneeRegistry(context);
    const assignees = members
      .filter((member) => canReadPeople || member.actorId === context.actorId)
      .map(assigneeForResponse)
      .filter((member) => member.eligibleFor.length > 0);
    return Response.json({
      context: publicAuthorityContext(context),
      assignments: visibleRows.map(assignmentForResponse),
      assignees,
      readback: { status: "verified", scope: "tenant", checkedAt: new Date().toISOString() },
    }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return Response.json({ error: "asset_assignment_readback_unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "asset.write")) return Response.json({ error: "forbidden", capability: "asset.write" }, { status: 403 });
  const parsed = await readBody(request);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: parsed.error === "payload_too_large" ? 413 : 400 });
  const input = parsed.value;
  const assetIds = boundedList(input.assetIds ?? input.assetId);
  const assigneeMembershipId = bounded(input.assigneeMembershipId, 200);
  const kind = assignmentKind(input.assignmentKind);
  const startsAt = bounded(input.startsAt, 64);
  const endsAt = bounded(input.endsAt, 64) || null;
  const purpose = bounded(input.purpose, 240);
  const notes = bounded(input.notes, 2_000);
  const idempotencyKey = bounded(input.idempotencyKey, 160);

  if (!assetIds.length) return Response.json({ error: "asset_id_required" }, { status: 400 });
  if (!assigneeMembershipId) return Response.json({ error: "assignee_membership_required" }, { status: 400 });
  if (!kind) return Response.json({ error: "assignment_kind_invalid" }, { status: 400 });
  if (!validDate(startsAt)) return Response.json({ error: "assignment_start_invalid" }, { status: 400 });
  if (kind === "SHORT_TERM" && !endsAt) return Response.json({ error: "short_term_end_required" }, { status: 400 });
  if (endsAt && !validDate(endsAt)) return Response.json({ error: "assignment_end_invalid" }, { status: 400 });
  if (endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) return Response.json({ error: "assignment_window_invalid" }, { status: 400 });
  if (idempotencyKey.length < 8) return Response.json({ error: "idempotency_key_required" }, { status: 400 });

  try {
    const db = getDb();
    const [existingEvent] = await db.select().from(s06Events).where(and(
      eq(s06Events.tenantId, context.tenantId),
      eq(s06Events.idempotencyKey, idempotencyKey),
    )).limit(1);
    if (existingEvent) {
      const [existing] = await db.select().from(jobJourneyRecords).where(and(
        eq(jobJourneyRecords.tenantId, context.tenantId),
        eq(jobJourneyRecords.id, existingEvent.aggregateId),
      )).limit(1);
      const existingGroupId = existing ? stringValue(parseJson(existing.payloadJson).assignmentGroupId) : "";
      const existingRows = existingGroupId
        ? (await assignmentRows(context.tenantId)).filter((row) => stringValue(parseJson(row.payloadJson).assignmentGroupId) === existingGroupId)
        : existing ? [existing] : [];
      return existing
        ? Response.json({
          assignment: assignmentForResponse(existingRows[0] ?? existing),
          assignments: (existingRows.length ? existingRows : [existing]).map(assignmentForResponse),
          idempotent: true,
          eventId: existingEvent.eventId,
          assignmentGroupId: existingGroupId || null,
        }, { headers: { "cache-control": "private, no-store" } })
        : Response.json({ error: "asset_assignment_idempotency_readback_unavailable" }, { status: 503 });
    }

    const assets = [] as Array<{ asset: NonNullable<Awaited<ReturnType<typeof findAsset>>>; payload: JsonObject; kindClass: string }>;
    for (const requestedAssetId of assetIds) {
      const asset = await findAsset(context.tenantId, requestedAssetId);
      if (!asset) return Response.json({ error: "asset_not_found", assetId: requestedAssetId }, { status: 404 });
      if (assets.some((entry) => entry.asset.id === asset.id)) continue;
      const payload = parseJson(asset.payloadJson);
      const currentLifecycle = upper(payload.lifecycleStatus || asset.status || "AVAILABLE");
      if (currentLifecycle !== "AVAILABLE") return Response.json({ error: "asset_not_assignable", assetId: asset.id, lifecycleStatus: currentLifecycle }, { status: 409 });
      assets.push({ asset, payload, kindClass: assetClass(payload) });
    }

    const [member] = await db.select().from(tenantMemberships).where(and(
      eq(tenantMemberships.tenantId, context.tenantId),
      eq(tenantMemberships.id, assigneeMembershipId),
      eq(tenantMemberships.status, "active"),
    )).limit(1);
    if (!member) return Response.json({ error: "assignee_not_found_or_inactive" }, { status: 404 });
    if (!canReadAssigneeRegistry(context) && member.actorId !== context.actorId) {
      return Response.json({ error: "assignee_scope_forbidden" }, { status: 403 });
    }
    const roles = normalizeAuthorityRoles(member.rolesJson, member.role);
    for (const entry of assets) {
      if (entry.kindClass === "VEHICLE" && !isDriver(roles)) return Response.json({ error: "vehicle_assignee_driver_capability_required" }, { status: 422 });
      if (entry.kindClass !== "VEHICLE" && !isOperator(roles)) return Response.json({ error: "asset_assignee_operator_capability_required" }, { status: 422 });
    }

    const [rows, journeyRows] = await Promise.all([assignmentRows(context.tenantId), scheduledJourneyRows(context.tenantId)]);
    const requestedWindow = assignmentWindow(startsAt, endsAt);
    for (const entry of assets) {
      const conflict = rows.find((row) => {
        const status = upper(row.status) as AssignmentStatus;
        if (TERMINAL_STATUSES.has(status)) return false;
        const payload = parseJson(row.payloadJson);
        const existingWindow = dateRange(payload);
        if (!existingWindow) return false;
        const custodyEnd = assetAssignmentCustodyEnd(status, payload.assignmentKind, payload.startsAt, payload.endsAt);
        const custodyEndAt = custodyEnd && validDate(custodyEnd) ? Date.parse(custodyEnd) : Number.POSITIVE_INFINITY;
        return stringValue(payload.assetId, row.jobId) === entry.asset.id
          && overlaps(requestedWindow, { start: existingWindow.start, end: custodyEndAt });
      });
      if (conflict) {
        const conflictPayload = parseJson(conflict.payloadJson);
        return Response.json({
          error: "asset_assignment_conflict",
          conflict: {
            id: conflict.id,
            assetId: stringValue(conflictPayload.assetId, conflict.jobId),
            assetTitle: stringValue(conflictPayload.assetTitle, conflict.title),
            assigneeName: stringValue(conflictPayload.assigneeName, "Risorsa già assegnata"),
            startsAt: stringValue(conflictPayload.startsAt),
            endsAt: stringValue(conflictPayload.endsAt) || null,
            status: conflict.status,
          },
        }, { status: 409 });
      }
      const journeyConflict = journeyRows.find((row) => {
        const payload = parseJson(row.payloadJson);
        const window = journeyWindow(payload);
        return window && resourceIds(payload).includes(entry.asset.id) && overlaps(requestedWindow, { start: window.start, end: window.end });
      });
      if (journeyConflict) {
        const payload = parseJson(journeyConflict.payloadJson);
        const window = journeyWindow(payload);
        return Response.json({
          error: "asset_assignment_conflict",
          conflictType: "MISSION_OR_PLANNING",
          conflict: {
            id: journeyConflict.id,
            assetId: entry.asset.id,
            assetTitle: entry.asset.title,
            assigneeName: "Risorsa già impegnata",
            startsAt: window?.startsAt ?? "",
            endsAt: window?.endsAt ?? null,
            status: journeyConflict.status,
            title: journeyConflict.title,
          },
        }, { status: 409 });
      }
    }

    const now = new Date().toISOString();
    const normalizedStart = new Date(Date.parse(startsAt)).toISOString();
    const normalizedEnd = endsAt ? new Date(Date.parse(endsAt)).toISOString() : null;
    const status: AssignmentStatus = Date.parse(normalizedStart) > Date.now() ? "SCHEDULED" : "ACTIVE";
    const assignmentGroupId = `ASSET-BATCH-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
    const resolvedAssetIds = assets.map((entry) => entry.asset.id);
    const createdRows: Array<typeof jobJourneyRecords.$inferSelect> = [];
    const eventIds: string[] = [];
    for (const [index, entry] of assets.entries()) {
      const assignmentId = `ASSET-ASSIGN-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
      const assignmentIdempotencyKey = index === 0 ? idempotencyKey : `${idempotencyKey}:${index}`;
      const assignmentPayload: JsonObject = {
        assetId: entry.asset.id,
        assetIds: resolvedAssetIds,
        assignmentGroupId,
        assetCode: entry.asset.canonicalCode,
        assetTitle: bounded(entry.asset.detail, 160)
          || stringValue(entry.payload.description || entry.payload.title)
          || entry.asset.title,
        entityType: upper(entry.payload.entityType) || "ASSET",
        assignmentClass: entry.kindClass,
        assignmentKind: kind,
        assigneeMembershipId: member.id,
        assigneeActorId: member.actorId,
        assigneeEmail: member.actorEmail,
        assigneeName: member.displayName,
        assigneeRole: member.role,
        assigneeRoles: roles,
        startsAt: normalizedStart,
        endsAt: normalizedEnd,
        purpose,
        notes,
        source: "asset-assignment-registry",
        createdAt: now,
      };
      await db.insert(jobJourneyRecords).values({
        id: assignmentId,
        tenantId: context.tenantId,
        jobId: entry.asset.id,
        domain: "assets",
        recordType: "ASSET_ASSIGNMENT",
        title: `${entry.asset.title} · ${member.displayName}`.slice(0, 180),
        status,
        version: 1,
        payloadJson: JSON.stringify(assignmentPayload),
        idempotencyKey: assignmentIdempotencyKey,
        createdBy: context.actorId,
        updatedBy: context.actorId,
        createdAt: now,
        updatedAt: now,
      });
      const eventId = await writeEvent({
        tenantId: context.tenantId,
        actorId: context.actorId,
        eventType: "asset.assignment.created",
        aggregateId: assignmentId,
        aggregateVersion: 1,
        idempotencyKey: assignmentIdempotencyKey,
        payload: { assetId: entry.asset.id, assetIds: resolvedAssetIds, assignmentGroupId, assigneeMembershipId: member.id, assignmentKind: kind, startsAt: normalizedStart, endsAt: normalizedEnd, status },
        now,
      });
      const [created] = await db.select().from(jobJourneyRecords).where(and(
        eq(jobJourneyRecords.tenantId, context.tenantId),
        eq(jobJourneyRecords.id, assignmentId),
      )).limit(1);
      if (!created) return Response.json({ error: "asset_assignment_readback_unavailable" }, { status: 503 });
      createdRows.push(created);
      eventIds.push(eventId);
    }
    const firstCreated = createdRows[0];
    if (!firstCreated) return Response.json({ error: "asset_assignment_readback_unavailable" }, { status: 503 });
    return Response.json({
      assignment: assignmentForResponse(firstCreated),
      assignments: createdRows.map(assignmentForResponse),
      assignmentGroupId,
      assetCount: createdRows.length,
      eventId: eventIds[0],
      eventIds,
      idempotent: false,
      readback: "verified",
    }, { status: 201, headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/unique|constraint/i.test(message)) return Response.json({ error: "asset_assignment_idempotency_or_version_conflict" }, { status: 409 });
    return Response.json({ error: "asset_assignment_write_unavailable" }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "asset.write")) return Response.json({ error: "forbidden", capability: "asset.write" }, { status: 403 });
  const parsed = await readBody(request);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: parsed.error === "payload_too_large" ? 413 : 400 });
  const input = parsed.value;
  const assignmentId = bounded(input.assignmentId, 200);
  const action = upper(input.action);
  const idempotencyKey = bounded(input.idempotencyKey, 160);
  if (!assignmentId) return Response.json({ error: "assignment_id_required" }, { status: 400 });
  if (action !== "RETURN" && action !== "CANCEL") return Response.json({ error: "assignment_action_invalid" }, { status: 400 });
  if (idempotencyKey.length < 8) return Response.json({ error: "idempotency_key_required" }, { status: 400 });

  try {
    const db = getDb();
    const [existingEvent] = await db.select().from(s06Events).where(and(eq(s06Events.tenantId, context.tenantId), eq(s06Events.idempotencyKey, idempotencyKey))).limit(1);
    if (existingEvent) {
      const [existing] = await db.select().from(jobJourneyRecords).where(and(eq(jobJourneyRecords.tenantId, context.tenantId), eq(jobJourneyRecords.id, assignmentId))).limit(1);
      return existing ? Response.json({ assignment: assignmentForResponse(existing), idempotent: true, eventId: existingEvent.eventId }) : Response.json({ error: "asset_assignment_readback_unavailable" }, { status: 503 });
    }
    const [row] = await db.select().from(jobJourneyRecords).where(and(
      eq(jobJourneyRecords.tenantId, context.tenantId),
      eq(jobJourneyRecords.id, assignmentId),
      eq(jobJourneyRecords.domain, "assets"),
      eq(jobJourneyRecords.recordType, "ASSET_ASSIGNMENT"),
    )).limit(1);
    if (!row) return Response.json({ error: "asset_assignment_not_found" }, { status: 404 });
    if (TERMINAL_STATUSES.has(upper(row.status) as AssignmentStatus)) return Response.json({ assignment: assignmentForResponse(row), idempotent: true });

    const now = new Date().toISOString();
    const payload = parseJson(row.payloadJson);
    const nextStatus: AssignmentStatus = action === "RETURN" ? "RETURNED" : "CANCELLED";
    const nextPayload = { ...payload, returnedAt: action === "RETURN" ? now : undefined, cancelledAt: action === "CANCEL" ? now : undefined, closedBy: context.actorId, closeAction: action } satisfies JsonObject;
    const [updated] = await db.update(jobJourneyRecords).set({
      status: nextStatus,
      version: row.version + 1,
      payloadJson: JSON.stringify(nextPayload),
      updatedBy: context.actorId,
      updatedAt: now,
    }).where(and(
      eq(jobJourneyRecords.tenantId, context.tenantId),
      eq(jobJourneyRecords.id, row.id),
      eq(jobJourneyRecords.version, row.version),
    )).returning();
    if (!updated) return Response.json({ error: "asset_assignment_version_conflict" }, { status: 409 });
    const eventId = await writeEvent({
      tenantId: context.tenantId,
      actorId: context.actorId,
      eventType: `asset.assignment.${action.toLowerCase()}`,
      aggregateId: row.id,
      aggregateVersion: updated.version,
      idempotencyKey,
      payload: { action, assetId: stringValue(payload.assetId, row.jobId), assigneeMembershipId: stringValue(payload.assigneeMembershipId), status: nextStatus },
      now,
    });
    return Response.json({ assignment: assignmentForResponse(updated), eventId, idempotent: false, readback: "verified" }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/unique|constraint/i.test(message)) return Response.json({ error: "asset_assignment_idempotency_or_version_conflict" }, { status: 409 });
    return Response.json({ error: "asset_assignment_write_unavailable" }, { status: 503 });
  }
}
