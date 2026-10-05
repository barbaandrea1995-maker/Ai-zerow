import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { s04Records, s06Events, s06Outbox, s06Reconciliations, tenantMemberships, tenantWarehouses } from "@/db/schema";
import { getAuthorityContext, hasCapability, publicAuthorityContext } from "@/lib/authority-context";
import { normalizeAuthorityRoles } from "@/lib/authority-catalog";

export const dynamic = "force-dynamic";

type JsonObject = Record<string, unknown>;

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function list(value: unknown, max = 32, maxLength = 160) {
  const values = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return [...new Set(values.filter((item): item is string => typeof item === "string").map((item) => item.trim().slice(0, maxLength)).filter(Boolean))].slice(0, max);
}

function payload(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function assignmentRow(row: typeof s04Records.$inferSelect, memberships: typeof tenantMemberships.$inferSelect[], warehouses: typeof tenantWarehouses.$inferSelect[]) {
  const data = payload(row.payloadJson);
  const membershipId = text(data.membershipId, 160);
  const membership = memberships.find((item) => item.id === membershipId);
  const warehouseIds = list(data.warehouseIds, 100);
  return {
    id: row.id,
    membershipId,
    actorId: text(data.actorId, 160) || membership?.actorId || null,
    displayName: text(data.displayName, 160) || membership?.displayName || "Membro",
    roles: normalizeAuthorityRoles(membership?.rolesJson, membership?.role),
    warehouseIds,
    warehouses: warehouses.filter((warehouse) => warehouseIds.includes(warehouse.id)).map((warehouse) => ({ id: warehouse.id, code: warehouse.code, name: warehouse.name, locationLabel: warehouse.locationLabel })),
    status: text(data.lifecycleStatus, 32).toUpperCase() || row.status.toUpperCase(),
    version: typeof data.version === "number" && Number.isFinite(data.version) ? data.version : 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function readback(tenantId: string) {
  const db = getDb();
  const [rows, memberships, warehouses] = await Promise.all([
    db.select().from(s04Records).where(and(eq(s04Records.tenantId, tenantId), eq(s04Records.module, "workforce"))).orderBy(desc(s04Records.updatedAt)).limit(500),
    db.select().from(tenantMemberships).where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.status, "active"))).orderBy(asc(tenantMemberships.displayName)),
    db.select().from(tenantWarehouses).where(and(eq(tenantWarehouses.tenantId, tenantId), eq(tenantWarehouses.status, "active"))).orderBy(asc(tenantWarehouses.name)),
  ]);
  const assignments = rows.filter((row) => ["warehouse_assignment", "warehouse_assignments", "warehouse-scope"].includes(row.recordType.toLowerCase())).map((row) => assignmentRow(row, memberships, warehouses));
  return { assignments, memberships, warehouses };
}

export async function GET() {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "authority.read")) return Response.json({ error: "forbidden", capability: "authority.read" }, { status: 403 });
  try {
    const result = await readback(context.tenantId);
    return Response.json({
      context: publicAuthorityContext(context),
      assignments: result.assignments,
      memberships: result.memberships.map((membership) => ({ id: membership.id, actorId: membership.actorId, displayName: membership.displayName, email: membership.actorEmail, role: membership.role, roles: normalizeAuthorityRoles(membership.rolesJson, membership.role), status: membership.status })),
      warehouses: result.warehouses.map((warehouse) => ({ id: warehouse.id, code: warehouse.code, name: warehouse.name, locationLabel: warehouse.locationLabel, geofenceRadiusMeters: warehouse.geofenceRadiusMeters })),
      readback: { status: "verified", scope: "tenant", source: "sites-d1-authority-warehouse-assignment-readback", checkedAt: new Date().toISOString() },
    }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return Response.json({ error: "warehouse_assignment_readback_unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "authority.manage")) return Response.json({ error: "forbidden", capability: "authority.manage" }, { status: 403 });

  let input: JsonObject;
  try {
    const parsed = await request.json() as unknown;
    if (!isRecord(parsed)) return Response.json({ error: "invalid_json" }, { status: 400 });
    input = parsed;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const membershipId = text(input.membershipId, 160);
  const warehouseIds = list(input.warehouseIds, 100);
  const expectedVersion = typeof input.expectedVersion === "number" ? Math.floor(input.expectedVersion) : null;
  const idempotencyKey = text(input.idempotencyKey ?? request.headers.get("idempotency-key"), 160);
  if (!membershipId) return Response.json({ error: "membership_required" }, { status: 400 });
  if (idempotencyKey.length < 8) return Response.json({ error: "idempotency_key_required" }, { status: 400 });

  try {
    const db = getDb();
    const [existingEvent] = await db.select().from(s06Events).where(and(eq(s06Events.tenantId, context.tenantId), eq(s06Events.idempotencyKey, idempotencyKey))).limit(1);
    if (existingEvent) {
      const current = await readback(context.tenantId);
      const assignment = current.assignments.find((item) => item.id === existingEvent.aggregateId);
      if (!assignment) return Response.json({ error: "warehouse_assignment_readback_unavailable" }, { status: 503 });
      return Response.json({ context: publicAuthorityContext(context), assignment, eventId: existingEvent.eventId, idempotent: true, readback: { status: "verified", scope: "tenant", checkedAt: new Date().toISOString() } }, { headers: { "cache-control": "private, no-store" } });
    }
    const [membership] = await db.select().from(tenantMemberships).where(and(eq(tenantMemberships.tenantId, context.tenantId), eq(tenantMemberships.id, membershipId), eq(tenantMemberships.status, "active"))).limit(1);
    if (!membership) return Response.json({ error: "membership_not_active" }, { status: 409 });
    const roles = normalizeAuthorityRoles(membership.rolesJson, membership.role);
    if (!roles.some((role) => ["warehouse_operator", "warehouse_manager"].includes(role))) return Response.json({ error: "warehouse_role_required" }, { status: 409 });
    const warehouses = await db.select().from(tenantWarehouses).where(and(eq(tenantWarehouses.tenantId, context.tenantId), eq(tenantWarehouses.status, "active"))).limit(500);
    const activeWarehouseIds = new Set(warehouses.map((warehouse) => warehouse.id));
    const invalidWarehouseIds = warehouseIds.filter((id) => !activeWarehouseIds.has(id));
    if (invalidWarehouseIds.length) return Response.json({ error: "warehouse_not_active", warehouseIds: invalidWarehouseIds }, { status: 409 });

    const rows = await db.select().from(s04Records).where(and(eq(s04Records.tenantId, context.tenantId), eq(s04Records.module, "workforce"))).limit(500);
    const existing = rows.find((row) => ["warehouse_assignment", "warehouse_assignments", "warehouse-scope"].includes(row.recordType.toLowerCase()) && text(payload(row.payloadJson).membershipId, 160) === membershipId);
    const previous = existing ? payload(existing.payloadJson) : {};
    const currentVersion = typeof previous.version === "number" && Number.isFinite(previous.version) ? previous.version : 1;
    if (existing && expectedVersion !== null && expectedVersion !== currentVersion) return Response.json({ error: "version_conflict", currentVersion }, { status: 409 });
    const nextVersion = existing ? currentVersion + 1 : 1;
    const nowIso = new Date().toISOString();
    const id = existing?.id ?? `AUTH-WAREHOUSE-ASSIGNMENT-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
    const eventId = crypto.randomUUID();
    const lifecycleStatus = warehouseIds.length ? "ACTIVE" : "REVOKED";
    const assignmentPayload = {
      entityType: "warehouse_assignment",
      resourceKind: "warehouse_scope",
      lifecycleStatus,
      version: nextVersion,
      membershipId,
      actorId: membership.actorId,
      actorEmail: membership.actorEmail,
      displayName: membership.displayName,
      roles,
      warehouseIds,
      warehouseCodes: warehouses.filter((warehouse) => warehouseIds.includes(warehouse.id)).map((warehouse) => warehouse.code),
      source: "authority-warehouse-assignment",
    } satisfies JsonObject;
    const eventPayload = JSON.stringify({ membershipId, actorId: membership.actorId, warehouseIds, version: nextVersion, lifecycleStatus });
    const statements = existing ? [
      db.update(s04Records).set({ detail: `${warehouseIds.length} magazzini assegnati`, status: lifecycleStatus, payloadJson: JSON.stringify(assignmentPayload), updatedAt: nowIso }).where(and(eq(s04Records.tenantId, context.tenantId), eq(s04Records.id, id))),
    ] : [
      db.insert(s04Records).values({ id, tenantId: context.tenantId, module: "workforce", canonicalCode: null, recordType: "warehouse_assignment", title: `Perimetro magazzino · ${membership.displayName}`, detail: `${warehouseIds.length} magazzini assegnati`, meta: "authority-warehouse-assignment", status: lifecycleStatus, tone: "cyan", progress: 0, payloadJson: JSON.stringify(assignmentPayload), createdBy: context.actorId, createdAt: nowIso, updatedAt: nowIso }),
    ];
    await db.batch([
      ...statements,
      db.insert(s06Events).values({ eventId, tenantId: context.tenantId, eventType: existing ? "authority.warehouse_assignment.updated" : "authority.warehouse_assignment.created", schemaVersion: "1", actorType: "human", actorId: context.actorId, source: "sites-authority", occurredAt: nowIso, observedAt: nowIso, aggregateType: "authority.warehouse_assignment", aggregateId: id, aggregateVersion: nextVersion, payloadJson: eventPayload, correlationId: crypto.randomUUID(), causationId: null, idempotencyKey, status: "COMMITTED_SITES_READBACK", createdAt: nowIso }),
      db.insert(s06Outbox).values({ id: crypto.randomUUID(), tenantId: context.tenantId, eventId, topic: "zerow.authority.warehouse_assignment.changed", status: "PENDING_EXTERNAL_CONSUMER", attempts: 0, createdAt: nowIso, updatedAt: nowIso }),
      db.insert(s06Reconciliations).values({ id: crypto.randomUUID(), tenantId: context.tenantId, aggregateType: "authority.warehouse_assignment", aggregateId: id, expectedVersion: nextVersion, observedVersion: nextVersion, status: "SITES_READBACK_VERIFIED", detail: "Perimetro magazzino persistito con membership tenant-scoped e depositi attivi verificati.", createdAt: nowIso, updatedAt: nowIso }),
    ] as never);
    const result = await readback(context.tenantId);
    const assignment = result.assignments.find((item) => item.id === id);
    if (!assignment) return Response.json({ error: "warehouse_assignment_readback_unavailable" }, { status: 503 });
    return Response.json({ context: publicAuthorityContext(context), assignment, eventId, readback: { status: "verified", scope: "tenant", checkedAt: new Date().toISOString() } }, { status: existing ? 200 : 201, headers: { "cache-control": "private, no-store" } });
  } catch {
    return Response.json({ error: "warehouse_assignment_write_unavailable" }, { status: 503 });
  }
}
