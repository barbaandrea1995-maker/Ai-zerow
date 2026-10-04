import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { trackingDevices, trackingProviders, vehicleDeviceBindings } from "@/db/schema";
import { getAuthorityContext, hasCapability, publicAuthorityContext } from "@/lib/authority-context";
import { auditLocationAccess } from "@/lib/location-intelligence/repository";
import { getLocationProviderStatus } from "@/lib/location-intelligence/providers";

export const dynamic = "force-dynamic";

type JsonObject = Record<string, unknown>;

function bounded(value: unknown, max: number, fallback = "") {
  return typeof value === "string" ? value.trim().slice(0, max) : fallback;
}

function objectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function responseHeaders() {
  return { "cache-control": "private, no-store" };
}

export async function GET() {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const capability = hasCapability(context, "location.manage.tracking.devices")
    ? "location.manage.tracking.devices"
    : hasCapability(context, "location.read.current") ? "location.read.current" : null;
  if (!capability) return Response.json({ error: "forbidden", capability: "location.read.current" }, { status: 403 });
  try {
    const db = getDb();
    const [providers, devices, bindings] = await Promise.all([
      db.select().from(trackingProviders).where(eq(trackingProviders.tenantId, context.tenantId)).orderBy(asc(trackingProviders.providerType)),
      db.select().from(trackingDevices).where(eq(trackingDevices.tenantId, context.tenantId)).orderBy(asc(trackingDevices.label)),
      db.select().from(vehicleDeviceBindings).where(eq(vehicleDeviceBindings.tenantId, context.tenantId)).orderBy(asc(vehicleDeviceBindings.vehicleId)),
    ]);
    await auditLocationAccess({ context, capability, action: "READ", resourceType: "TRACKING_REGISTRY", purpose: "Verifica provider, dispositivi e associazioni mezzo-tracker.", metadata: { providers: providers.length, devices: devices.length, bindings: bindings.length } });
    return Response.json({
      context: publicAuthorityContext(context),
      providers: providers.map((provider) => ({
        id: provider.id,
        tenantId: provider.tenantId,
        providerType: provider.providerType,
        label: provider.label,
        status: provider.status,
        tokenReference: provider.tokenReference ? "CONFIGURED_REFERENCE" : null,
        createdAt: provider.createdAt,
        updatedAt: provider.updatedAt,
      })),
      devices,
      bindings,
      runtime: getLocationProviderStatus(),
      readback: { status: "verified", scope: "tenant", checkedAt: new Date().toISOString() },
    }, { headers: responseHeaders() });
  } catch {
    return Response.json({ error: "tracking_registry_readback_unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "location.manage.tracking.devices")) {
    return Response.json({ error: "forbidden", capability: "location.manage.tracking.devices" }, { status: 403 });
  }
  let input: JsonObject;
  try {
    const parsed = await request.json() as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return Response.json({ error: "invalid_json" }, { status: 400 });
    input = parsed as JsonObject;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const action = bounded(input.action, 32).toLowerCase();
  const now = new Date().toISOString();
  const db = getDb();
  try {
    if (action === "provider") {
      const providerType = bounded(input.providerType, 32).toUpperCase();
      if (providerType !== "TRACCAR" && providerType !== "NATIVE_DEVICE") return Response.json({ error: "unsupported_tracking_provider" }, { status: 400 });
      const id = `TRACKING-PROVIDER-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
      const existing = await db.select().from(trackingProviders).where(and(eq(trackingProviders.tenantId, context.tenantId), eq(trackingProviders.providerType, providerType))).limit(1);
      if (existing[0]) return Response.json({ provider: existing[0], idempotent: true }, { headers: responseHeaders() });
      const runtime = getLocationProviderStatus();
      const configured = providerType === "TRACCAR" ? runtime.tracking.configured : true;
      await db.insert(trackingProviders).values({
        id,
        tenantId: context.tenantId,
        providerType,
        label: bounded(input.label, 120) || providerType,
        status: configured ? "READY" : "NOT_CONFIGURED",
        endpointUrl: bounded(input.endpointUrl, 240),
        tokenReference: configured ? "SERVER_RUNTIME_SECRET" : "",
        configJson: JSON.stringify({ source: "server_provider_configuration", configured }),
        createdBy: context.actorId,
        createdAt: now,
        updatedAt: now,
      });
      const [provider] = await db.select().from(trackingProviders).where(eq(trackingProviders.id, id)).limit(1);
      if (!provider) return Response.json({ error: "tracking_provider_readback_unavailable" }, { status: 503 });
      return Response.json({ provider: { id: provider.id, tenantId: provider.tenantId, providerType: provider.providerType, label: provider.label, status: provider.status, tokenReference: provider.tokenReference ? "CONFIGURED_REFERENCE" : null, createdAt: provider.createdAt, updatedAt: provider.updatedAt }, runtime, readback: "verified" }, { status: 201, headers: responseHeaders() });
    }

    if (action === "device") {
      const providerId = bounded(input.providerId, 160);
      const externalDeviceId = bounded(input.externalDeviceId, 160);
      const label = bounded(input.label, 160);
      if (!providerId || !externalDeviceId || !label) return Response.json({ error: "provider_device_id_label_required" }, { status: 400 });
      const [provider] = await db.select().from(trackingProviders).where(and(eq(trackingProviders.tenantId, context.tenantId), eq(trackingProviders.id, providerId))).limit(1);
      if (!provider) return Response.json({ error: "tracking_provider_not_found" }, { status: 404 });
      const [existing] = await db.select().from(trackingDevices).where(and(eq(trackingDevices.tenantId, context.tenantId), eq(trackingDevices.providerId, providerId), eq(trackingDevices.externalDeviceId, externalDeviceId))).limit(1);
      if (existing) return Response.json({ device: existing, idempotent: true }, { headers: responseHeaders() });
      const id = `TRACKING-DEVICE-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
      await db.insert(trackingDevices).values({ id, tenantId: context.tenantId, providerId, externalDeviceId, label, deviceType: bounded(input.deviceType, 40) || "VEHICLE_GPS", status: "ACTIVE", metadataJson: JSON.stringify(objectValue(input.metadata)), createdBy: context.actorId, createdAt: now, updatedAt: now });
      const [device] = await db.select().from(trackingDevices).where(eq(trackingDevices.id, id)).limit(1);
      return device ? Response.json({ device, readback: "verified" }, { status: 201, headers: responseHeaders() }) : Response.json({ error: "tracking_device_readback_unavailable" }, { status: 503 });
    }

    if (action === "bind") {
      const vehicleId = bounded(input.vehicleId, 160);
      const deviceId = bounded(input.deviceId, 160);
      if (!vehicleId || !deviceId) return Response.json({ error: "vehicle_and_device_required" }, { status: 400 });
      const [device] = await db.select().from(trackingDevices).where(and(eq(trackingDevices.tenantId, context.tenantId), eq(trackingDevices.id, deviceId), eq(trackingDevices.status, "ACTIVE"))).limit(1);
      if (!device) return Response.json({ error: "tracking_device_not_found" }, { status: 404 });
      const active = await db.select().from(vehicleDeviceBindings).where(and(eq(vehicleDeviceBindings.tenantId, context.tenantId), eq(vehicleDeviceBindings.status, "ACTIVE"))).limit(500);
      const sameVehicle = active.find((binding) => binding.vehicleId === vehicleId);
      const sameDevice = active.find((binding) => binding.deviceId === deviceId);
      if (sameDevice && sameDevice.vehicleId !== vehicleId) return Response.json({ error: "tracking_device_already_bound", vehicleId: sameDevice.vehicleId }, { status: 409 });
      if (sameVehicle && sameVehicle.deviceId === deviceId) return Response.json({ binding: sameVehicle, idempotent: true }, { headers: responseHeaders() });
      const bindingId = `VEHICLE-TRACKING-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
      const writes = [];
      if (sameVehicle) writes.push(db.update(vehicleDeviceBindings).set({ status: "REPLACED", effectiveTo: now, updatedAt: now }).where(and(eq(vehicleDeviceBindings.tenantId, context.tenantId), eq(vehicleDeviceBindings.id, sameVehicle.id), eq(vehicleDeviceBindings.status, "ACTIVE"))));
      writes.push(db.insert(vehicleDeviceBindings).values({ id: bindingId, tenantId: context.tenantId, vehicleId, deviceId, effectiveFrom: now, effectiveTo: null, status: "ACTIVE", createdBy: context.actorId, createdAt: now, updatedAt: now }));
      await db.batch(writes);
      const [binding] = await db.select().from(vehicleDeviceBindings).where(eq(vehicleDeviceBindings.id, bindingId)).limit(1);
      return binding ? Response.json({ binding, readback: "verified" }, { status: 201, headers: responseHeaders() }) : Response.json({ error: "tracking_binding_readback_unavailable" }, { status: 503 });
    }
    return Response.json({ error: "unsupported_tracking_registry_action", allowed: ["provider", "device", "bind"] }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/unique|constraint/i.test(message)) return Response.json({ error: "tracking_registry_conflict" }, { status: 409 });
    return Response.json({ error: "tracking_registry_write_unavailable" }, { status: 503 });
  }
}
