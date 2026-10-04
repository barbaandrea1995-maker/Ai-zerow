import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { trackingDevices, trackingProviders, trackingSessions } from "@/db/schema";
import { ingestLocationPosition, LocationIngestionError } from "@/lib/location-intelligence/ingest";
import { TraccarAdapter } from "@/lib/location-intelligence/providers";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const adapter = new TraccarAdapter();
  const rawBody = await request.text();
  if (!await adapter.validateWebhookSignature(request, rawBody)) return Response.json({ error: "invalid_provider_signature" }, { status: 401 });
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const position = adapter.receivePosition(payload);
  if (!position) return Response.json({ error: "invalid_provider_position" }, { status: 400 });

  try {
    const db = getDb();
    const devices = await db.select().from(trackingDevices).where(and(eq(trackingDevices.externalDeviceId, position.deviceId), eq(trackingDevices.status, "ACTIVE"))).limit(20);
    if (!devices.length) return Response.json({ accepted: false, reason: "device_not_registered" }, { status: 202 });
    const providers = await db.select().from(trackingProviders).where(and(eq(trackingProviders.providerType, "TRACCAR"), inArray(trackingProviders.id, devices.map((device) => device.providerId)))).limit(20);
    const providerIds = new Set(providers.map((provider) => provider.id));
    const matches = devices.filter((device) => providerIds.has(device.providerId));
    if (matches.length !== 1) return Response.json({ error: "provider_device_tenant_ambiguous" }, { status: 409 });
    const device = matches[0];
    const [session] = await db.select().from(trackingSessions).where(and(eq(trackingSessions.tenantId, device.tenantId), eq(trackingSessions.trackingDeviceId, device.id), eq(trackingSessions.status, "ACTIVE"))).limit(1);
    if (!session) return Response.json({ accepted: false, reason: "no_active_tracking_session" }, { status: 202 });
    const result = await ingestLocationPosition({ tenantId: device.tenantId, trackingSessionId: session.id, source: "TRACCAR", position });
    return Response.json({ accepted: true, idempotent: result.idempotent, derivedEventCount: result.events.length }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof LocationIngestionError) return Response.json({ error: error.code }, { status: 409 });
    return Response.json({ error: "traccar_webhook_ingestion_unavailable" }, { status: 503 });
  }
}
