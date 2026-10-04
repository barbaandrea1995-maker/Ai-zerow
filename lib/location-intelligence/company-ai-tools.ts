import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { getDb } from "@/db";
import { locationEvents, routePlans, routeStops, trackingSessions } from "@/db/schema";
import { hasCapability, type AuthorityContext } from "@/lib/authority-context";
import { auditLocationAccess, eventForResponse, sessionForResponse } from "@/lib/location-intelligence/repository";

export const COMPANY_AI_LOCATION_TOOLS = [
  "getFleetStatus",
  "getVehicleCurrentState",
  "getVehicleOperationalTimeline",
  "getDriverShiftTimeline",
  "getSiteArrivals",
  "getWarehouseDepartures",
  "getDeliveryTimeline",
  "getRouteStatus",
  "getRouteExceptions",
  "getVehiclesCurrentlyAtLocation",
] as const;

export type CompanyAiLocationTool = (typeof COMPANY_AI_LOCATION_TOOLS)[number];

const TOOL_CAPABILITIES: Record<CompanyAiLocationTool, string> = {
  getFleetStatus: "location.view.fleet",
  getVehicleCurrentState: "location.read.current",
  getVehicleOperationalTimeline: "location.read.history",
  getDriverShiftTimeline: "location.view.driver.timeline",
  getSiteArrivals: "location.read.history",
  getWarehouseDepartures: "location.read.history",
  getDeliveryTimeline: "location.read.history",
  getRouteStatus: "location.read.current",
  getRouteExceptions: "location.read.history",
  getVehiclesCurrentlyAtLocation: "location.view.fleet",
};

type JsonObject = Record<string, unknown>;

function stringValue(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function numberValue(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function responseEventRows(rows: Array<typeof locationEvents.$inferSelect>) {
  return rows.map(eventForResponse);
}

function latestPerVehicle(rows: Array<typeof locationEvents.$inferSelect>) {
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) if (!latest.has(row.vehicleId)) latest.set(row.vehicleId, row);
  return [...latest.values()].map(eventForResponse);
}

export async function getCompanyAiLocationTool({ context, tool, args = {} }: { context: AuthorityContext; tool: CompanyAiLocationTool; args?: JsonObject }) {
  const capability = TOOL_CAPABILITIES[tool];
  if (!capability || !hasCapability(context, capability)) {
    return { allowed: false, tool, error: "forbidden", capability };
  }
  const db = getDb();
  const vehicleId = stringValue(args.vehicleId, 160);
  const employeeId = stringValue(args.employeeId, 160);
  const locationId = stringValue(args.locationId, 160);
  const routePlanId = stringValue(args.routePlanId, 160);
  const from = stringValue(args.from, 40);
  const to = stringValue(args.to, 40);
  const limit = numberValue(args.limit, 100, 1, 500);
  if (employeeId && employeeId !== context.actorId && !hasCapability(context, "location.view.fleet") && !hasCapability(context, "location.audit.read")) {
    return { allowed: false, tool, error: "location_scope_forbidden" };
  }

  const eventFilters = [eq(locationEvents.tenantId, context.tenantId)];
  if (vehicleId) eventFilters.push(eq(locationEvents.vehicleId, vehicleId));
  if (employeeId) eventFilters.push(eq(locationEvents.employeeId, employeeId));
  if (locationId) eventFilters.push(eq(locationEvents.locationId, locationId));
  if (from) eventFilters.push(gte(locationEvents.occurredAt, from));
  if (to) eventFilters.push(lte(locationEvents.occurredAt, to));

  let result: Record<string, unknown> = {};
  let resourceType = "COMPANY_AI_LOCATION_TOOL";
  switch (tool) {
    case "getFleetStatus": {
      const rows = await db.select().from(locationEvents).where(and(...eventFilters)).orderBy(desc(locationEvents.occurredAt)).limit(500);
      const sessions = await db.select().from(trackingSessions).where(and(eq(trackingSessions.tenantId, context.tenantId), eq(trackingSessions.status, "ACTIVE"))).limit(500);
      result = { vehicles: latestPerVehicle(rows), activeSessions: sessions.map(sessionForResponse), derivedOnly: true };
      resourceType = "FLEET_STATUS";
      break;
    }
    case "getVehicleCurrentState": {
      if (!vehicleId) return { allowed: false, tool, error: "vehicle_id_required" };
      const rows = await db.select().from(locationEvents).where(and(...eventFilters)).orderBy(desc(locationEvents.occurredAt)).limit(40);
      result = { vehicleId, current: rows[0] ? eventForResponse(rows[0]) : null, recent: responseEventRows(rows.slice(0, 10)) };
      resourceType = "VEHICLE_CURRENT_STATE";
      break;
    }
    case "getVehicleOperationalTimeline": {
      if (!vehicleId) return { allowed: false, tool, error: "vehicle_id_required" };
      const rows = await db.select().from(locationEvents).where(and(...eventFilters)).orderBy(desc(locationEvents.occurredAt)).limit(limit);
      result = { vehicleId, timeline: responseEventRows(rows), rawSamples: "DENY_BY_DEFAULT" };
      resourceType = "VEHICLE_OPERATIONAL_TIMELINE";
      break;
    }
    case "getDriverShiftTimeline": {
      const driver = employeeId || context.actorId;
      const rows = await db.select().from(locationEvents).where(and(...eventFilters, eq(locationEvents.employeeId, driver))).orderBy(desc(locationEvents.occurredAt)).limit(limit);
      result = { employeeId: driver, timeline: responseEventRows(rows), rawSamples: "DENY_BY_DEFAULT" };
      resourceType = "DRIVER_SHIFT_TIMELINE";
      break;
    }
    case "getSiteArrivals": {
      const rows = await db.select().from(locationEvents).where(and(...eventFilters, inArray(locationEvents.eventType, ["SITE_ARRIVAL", "CUSTOMER_ARRIVAL"]))).orderBy(desc(locationEvents.occurredAt)).limit(limit);
      result = { arrivals: responseEventRows(rows), confirmedBy: "ZEROW_DETERMINISTIC_LOCATION_ENGINE" };
      resourceType = "SITE_ARRIVALS";
      break;
    }
    case "getWarehouseDepartures": {
      const rows = await db.select().from(locationEvents).where(and(...eventFilters, eq(locationEvents.eventType, "WAREHOUSE_DEPARTURE"))).orderBy(desc(locationEvents.occurredAt)).limit(limit);
      result = { departures: responseEventRows(rows), confirmedBy: "ZEROW_DETERMINISTIC_LOCATION_ENGINE" };
      resourceType = "WAREHOUSE_DEPARTURES";
      break;
    }
    case "getDeliveryTimeline": {
      const rows = await db.select().from(locationEvents).where(and(...eventFilters, inArray(locationEvents.eventType, ["DELIVERY_PROBABLE", "DELIVERY_CONFIRMED", "CUSTOMER_ARRIVAL", "CUSTOMER_DEPARTURE"]))).orderBy(desc(locationEvents.occurredAt)).limit(limit);
      result = { deliveries: responseEventRows(rows), deliveryConfirmationRule: "GPS_ARRIVAL_NEVER_EQUALS_DELIVERY" };
      resourceType = "DELIVERY_TIMELINE";
      break;
    }
    case "getRouteStatus": {
      if (!routePlanId) return { allowed: false, tool, error: "route_plan_id_required" };
      const [plan] = await db.select().from(routePlans).where(and(eq(routePlans.tenantId, context.tenantId), eq(routePlans.id, routePlanId))).limit(1);
      const stops = await db.select().from(routeStops).where(and(eq(routeStops.tenantId, context.tenantId), eq(routeStops.routePlanId, routePlanId))).orderBy(routeStops.sequence).limit(200);
      result = { routePlan: plan ? { id: plan.id, missionId: plan.missionId, jobId: plan.jobId, driverId: plan.driverId, vehicleId: plan.vehicleId, status: plan.status, plannedStartAt: plan.plannedStartAt, startedAt: plan.startedAt, endedAt: plan.endedAt } : null, stops: stops.map((stop) => ({ id: stop.id, sequence: stop.sequence, locationId: stop.locationId, status: stop.status, deliveryStatus: stop.deliveryStatus, expectedArrivalAt: stop.expectedArrivalAt, arrivedAt: stop.arrivedAt, departedAt: stop.departedAt })) };
      resourceType = "ROUTE_STATUS";
      break;
    }
    case "getRouteExceptions": {
      const rows = await db.select().from(locationEvents).where(and(...eventFilters, inArray(locationEvents.eventType, ["UNPLANNED_STOP", "GEOFENCE_ENTER_CANDIDATE", "GEOFENCE_EXIT_CONFIRMED"]))).orderBy(desc(locationEvents.occurredAt)).limit(limit);
      result = { exceptions: responseEventRows(rows) };
      resourceType = "ROUTE_EXCEPTIONS";
      break;
    }
    case "getVehiclesCurrentlyAtLocation": {
      if (!locationId) return { allowed: false, tool, error: "location_id_required" };
      const rows = await db.select().from(locationEvents).where(and(...eventFilters)).orderBy(desc(locationEvents.occurredAt)).limit(500);
      const current = new Map<string, typeof rows[number]>();
      for (const row of rows) {
        if (!current.has(row.vehicleId)) current.set(row.vehicleId, row);
      }
      result = { locationId, vehicles: [...current.values()].filter((row) => row.locationId === locationId && ["GEOFENCE_ENTER_CONFIRMED", "WAREHOUSE_ARRIVAL", "SITE_ARRIVAL", "CUSTOMER_ARRIVAL", "SUPPLIER_ARRIVAL"].includes(row.eventType)).map(eventForResponse) };
      resourceType = "VEHICLES_AT_LOCATION";
      break;
    }
  }

  if (to) result = { ...result, requestedUntil: to };
  await auditLocationAccess({ context, capability, action: "COMPANY_AI_READ", resourceType, purpose: `Company AI tool ${tool} ha letto solo eventi Location Intelligence derivati.`, metadata: { tool, vehicleId: vehicleId || null, employeeId: employeeId || null, locationId: locationId || null, routePlanId: routePlanId || null, limit } });
  return { allowed: true, tool, capability, source: "ZEROW_SERVER_DERIVED_LOCATION_EVENTS", rawLocationSamples: "DENY_BY_DEFAULT", directWrite: false, result };
}

export function isCompanyAiLocationTool(value: unknown): value is CompanyAiLocationTool {
  return typeof value === "string" && (COMPANY_AI_LOCATION_TOOLS as readonly string[]).includes(value);
}

export function companyAiLocationToolCapability(tool: CompanyAiLocationTool) {
  return TOOL_CAPABILITIES[tool];
}

/**
 * Read-only context bridge for the governed Command prompt. It deliberately
 * skips raw samples and exposes a bounded event timeline; the explicit tool
 * endpoint above remains available when a caller needs a named operation.
 */
export async function getLocationContextForCommand(context: AuthorityContext, limit = 80) {
  const canSeeFleet = hasCapability(context, "location.view.fleet") || hasCapability(context, "location.audit.read");
  const capability = hasCapability(context, "location.read.history")
    ? "location.read.history"
    : hasCapability(context, "location.read.current") ? "location.read.current" : null;
  if (!capability) return { status: "NOT_AUTHORIZED" as const, events: [] as unknown[] };
  const filters = [eq(locationEvents.tenantId, context.tenantId)];
  if (!canSeeFleet) filters.push(eq(locationEvents.employeeId, context.actorId));
  const rows = await getDb().select().from(locationEvents).where(and(...filters)).orderBy(desc(locationEvents.occurredAt)).limit(Math.min(120, Math.max(1, limit)));
  await auditLocationAccess({ context, capability, action: "COMPANY_AI_CONTEXT", resourceType: "COMMAND_LOCATION_CONTEXT", purpose: "Company AI riceve eventi derivati per rispondere a domande operative.", metadata: { returned: rows.length, fleetVisible: canSeeFleet } });
  return { status: "VERIFIED" as const, events: responseEventRows(rows) };
}
