import { and, desc, eq, gte, lte } from "drizzle-orm";
import { getDb } from "@/db";
import { locationEvents } from "@/db/schema";
import { getAuthorityContext, hasCapability, publicAuthorityContext } from "@/lib/authority-context";
import { auditLocationAccess, eventForResponse } from "@/lib/location-intelligence/repository";

export const dynamic = "force-dynamic";

function bounded(value: string | null, max: number) {
  return (value ?? "").trim().slice(0, max);
}

export async function GET(request: Request) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const url = new URL(request.url);
  const requestedHistory = url.searchParams.get("history") === "true" || Boolean(url.searchParams.get("from"));
  const capability = requestedHistory && hasCapability(context, "location.read.history")
    ? "location.read.history"
    : hasCapability(context, "location.read.current")
      ? "location.read.current"
      : hasCapability(context, "location.read.history") ? "location.read.history" : null;
  if (!capability) return Response.json({ error: "forbidden", capability: requestedHistory ? "location.read.history" : "location.read.current" }, { status: 403 });
  if (requestedHistory && !hasCapability(context, "location.read.history")) return Response.json({ error: "forbidden", capability: "location.read.history" }, { status: 403 });

  const vehicleId = bounded(url.searchParams.get("vehicleId"), 160);
  const employeeId = bounded(url.searchParams.get("employeeId"), 160);
  const sessionId = bounded(url.searchParams.get("trackingSessionId"), 160);
  const eventType = bounded(url.searchParams.get("eventType"), 64);
  const from = bounded(url.searchParams.get("from"), 40);
  const to = bounded(url.searchParams.get("to"), 40);
  const fleetVisible = hasCapability(context, "location.view.fleet") || hasCapability(context, "location.audit.read");
  if (!fleetVisible && employeeId && employeeId !== context.actorId) return Response.json({ error: "location_scope_forbidden" }, { status: 403 });
  try {
    const filters = [eq(locationEvents.tenantId, context.tenantId)];
    if (vehicleId) filters.push(eq(locationEvents.vehicleId, vehicleId));
    if (sessionId) filters.push(eq(locationEvents.trackingSessionId, sessionId));
    if (eventType) filters.push(eq(locationEvents.eventType, eventType));
    if (employeeId) filters.push(eq(locationEvents.employeeId, employeeId));
    if (!fleetVisible && !employeeId) filters.push(eq(locationEvents.employeeId, context.actorId));
    if (from) filters.push(gte(locationEvents.occurredAt, from));
    if (to) filters.push(lte(locationEvents.occurredAt, to));
    const limitValue = Number(url.searchParams.get("limit"));
    const limit = Number.isInteger(limitValue) ? Math.min(500, Math.max(1, limitValue)) : 100;
    const rows = await getDb().select().from(locationEvents).where(and(...filters)).orderBy(desc(locationEvents.occurredAt)).limit(limit);
    await auditLocationAccess({ context, capability, action: "READ", resourceType: "LOCATION_EVENTS", purpose: "Lettura di eventi operativi derivati dal motore Location Intelligence.", metadata: { returned: rows.length, history: requestedHistory, fleetVisible } });
    return Response.json({
      context: publicAuthorityContext(context),
      events: rows.map(eventForResponse),
      rawSamples: "DENY_BY_DEFAULT",
      readback: { status: "verified", scope: "tenant", checkedAt: new Date().toISOString() },
    }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return Response.json({ error: "location_events_readback_unavailable" }, { status: 503 });
  }
}
