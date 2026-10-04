import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { trackingDevices, trackingProviders, trackingSessions, vehicleDeviceBindings } from "@/db/schema";
import { getAuthorityContext, hasCapability, publicAuthorityContext } from "@/lib/authority-context";
import { auditLocationAccess } from "@/lib/location-intelligence/repository";
import { ingestLocationPosition } from "@/lib/location-intelligence/ingest";
import { getLocationProviderStatus, trackingProviderFor } from "@/lib/location-intelligence/providers";

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

export async function GET(request: Request) {
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
    const remoteRequested = new URL(request.url).searchParams.get("remote") === "traccar";
    let remoteDevices: Awaited<ReturnType<ReturnType<typeof trackingProviderFor>["listDevices"]>> = null;
    let remoteError: string | null = null;
    if (remoteRequested) {
      try {
        remoteDevices = await trackingProviderFor("TRACCAR").listDevices();
        if (remoteDevices === null) remoteError = "traccar_devices_unavailable";
        await auditLocationAccess({ context, capability, action: "READ", resourceType: "TRACCAR_REMOTE_DEVICES", purpose: "Sincronizzazione owner-side dei dispositivi GPS dal provider configurato.", metadata: { count: remoteDevices?.length ?? 0, available: remoteDevices !== null } });
      } catch {
        remoteError = "traccar_devices_unavailable";
      }
    }
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
      remote: remoteRequested ? { provider: "TRACCAR", devices: remoteDevices ?? [], error: remoteError } : null,
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
    if (action === "sync") {
      const runtime = getLocationProviderStatus();
      if (!runtime.tracking.configured) return Response.json({ error: "traccar_runtime_not_configured" }, { status: 409 });
      const remoteDevices = await trackingProviderFor("TRACCAR").listDevices();
      if (remoteDevices === null) return Response.json({ error: "traccar_devices_unavailable" }, { status: 502 });
      let [provider] = await db.select().from(trackingProviders).where(and(eq(trackingProviders.tenantId, context.tenantId), eq(trackingProviders.providerType, "TRACCAR"))).limit(1);
      if (!provider) {
        const providerId = `TRACKING-PROVIDER-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
        await db.insert(trackingProviders).values({
          id: providerId,
          tenantId: context.tenantId,
          providerType: "TRACCAR",
          label: "Traccar GPS",
          status: "READY",
          endpointUrl: "",
          tokenReference: "SERVER_RUNTIME_SECRET",
          configJson: JSON.stringify({ source: "zerow_sync", configured: true }),
          createdBy: context.actorId,
          createdAt: now,
          updatedAt: now,
        });
        [provider] = await db.select().from(trackingProviders).where(eq(trackingProviders.id, providerId)).limit(1);
      }
      if (!provider) return Response.json({ error: "tracking_provider_readback_unavailable" }, { status: 503 });
      const imported: Array<{ id: string; externalDeviceId: string; label: string }> = [];
      for (const remote of remoteDevices) {
        const [existing] = await db.select().from(trackingDevices).where(and(eq(trackingDevices.tenantId, context.tenantId), eq(trackingDevices.providerId, provider.id), eq(trackingDevices.externalDeviceId, remote.id))).limit(1);
        if (existing) continue;
        const id = `TRACKING-DEVICE-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
        await db.insert(trackingDevices).values({ id, tenantId: context.tenantId, providerId: provider.id, externalDeviceId: remote.id, label: remote.name, deviceType: "VEHICLE_GPS", status: "ACTIVE", metadataJson: JSON.stringify({ source: "TRACCAR", uniqueId: remote.uniqueId, remoteStatus: remote.status, lastUpdate: remote.lastUpdate }), createdBy: context.actorId, createdAt: now, updatedAt: now });
        imported.push({ id, externalDeviceId: remote.id, label: remote.name });
      }
      await auditLocationAccess({ context, capability: "location.manage.tracking.devices", action: "IMPORT", resourceType: "TRACCAR_REMOTE_DEVICES", purpose: "Importazione dei dispositivi GPS nel registro ZEROW.", metadata: { remote: remoteDevices.length, imported: imported.length } });
      return Response.json({ provider: { id: provider.id, label: provider.label, status: provider.status }, remoteCount: remoteDevices.length, importedCount: imported.length, imported, readback: "verified" }, { headers: responseHeaders() });
    }

    if (action === "poll") {
      const deviceId = bounded(input.deviceId, 160);
      if (!deviceId) return Response.json({ error: "device_id_required" }, { status: 400 });
      const [device] = await db.select().from(trackingDevices).where(and(eq(trackingDevices.tenantId, context.tenantId), eq(trackingDevices.id, deviceId), eq(trackingDevices.status, "ACTIVE"))).limit(1);
      if (!device) return Response.json({ error: "tracking_device_not_found" }, { status: 404 });
      const [provider] = await db.select().from(trackingProviders).where(and(eq(trackingProviders.tenantId, context.tenantId), eq(trackingProviders.id, device.providerId))).limit(1);
      if (!provider) return Response.json({ error: "tracking_provider_not_found" }, { status: 404 });
      const position = await trackingProviderFor(provider.providerType).getVehicleCurrentPosition(device.externalDeviceId);
      if (!position) return Response.json({ error: "tracking_position_unavailable", deviceId, externalDeviceId: device.externalDeviceId }, { status: 502 });
      const [session] = await db.select().from(trackingSessions).where(and(eq(trackingSessions.tenantId, context.tenantId), eq(trackingSessions.trackingDeviceId, device.id), eq(trackingSessions.status, "ACTIVE"))).limit(1);
      const ingestion = session ? await ingestLocationPosition({ tenantId: context.tenantId, trackingSessionId: session.id, source: provider.providerType, position }) : null;
      await auditLocationAccess({ context, capability: "location.manage.tracking.devices", action: "POLL", resourceType: "TRACCAR_POSITION", purpose: "Lettura on-demand della posizione GPS tramite ZEROW.", metadata: { deviceId, externalDeviceId: device.externalDeviceId, ingested: Boolean(ingestion) } });
      return Response.json({ deviceId, externalDeviceId: device.externalDeviceId, position, ingested: Boolean(ingestion), trackingSessionId: session?.id ?? null, ingestion: ingestion ? { idempotent: ingestion.idempotent, events: ingestion.events.length } : null, readback: "verified" }, { headers: responseHeaders() });
    }

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
