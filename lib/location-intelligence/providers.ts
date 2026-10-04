import { env } from "cloudflare:workers";
import type { GeocodeCandidate } from "@/lib/location-intelligence/provider-types";

const MAPBOX_GEOCODING_URL = "https://api.mapbox.com/geocoding/v5/mapbox.places";

function runtimeSecret(name: string) {
  const bound = (env as unknown as Record<string, unknown>)[name];
  if (typeof bound === "string" && bound.trim()) return bound.trim();
  const local = process.env[name];
  return typeof local === "string" ? local.trim() : "";
}

function baseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

export type LocationProviderStatus = {
  geocoding: { provider: "MAPBOX"; configured: boolean; status: "READY" | "NOT_CONFIGURED" };
  tracking: { provider: "TRACCAR"; configured: boolean; status: "READY" | "NOT_CONFIGURED" };
  storage: { controlPlane: "D1"; postgis: "NOT_CONNECTED" | "CONFIGURED_UNVERIFIED" | "CONNECTED_READBACK_VERIFIED" | "DEGRADED" };
};

export function getLocationProviderStatus(): LocationProviderStatus {
  const mapboxConfigured = Boolean(runtimeSecret("MAPBOX_ACCESS_TOKEN"));
  const traccarConfigured = Boolean(runtimeSecret("TRACCAR_BASE_URL") && runtimeSecret("TRACCAR_API_TOKEN"));
  const postgisConfigured = Boolean(runtimeSecret("LOCATION_DATABASE_URL"));
  return {
    geocoding: { provider: "MAPBOX", configured: mapboxConfigured, status: mapboxConfigured ? "READY" : "NOT_CONFIGURED" },
    tracking: { provider: "TRACCAR", configured: traccarConfigured, status: traccarConfigured ? "READY" : "NOT_CONFIGURED" },
    storage: { controlPlane: "D1", postgis: postgisConfigured ? "CONFIGURED_UNVERIFIED" : "NOT_CONNECTED" },
  };
}

function mapboxContext(context: unknown[]) {
  const find = (prefixes: string[]) => {
    const item = context.find((candidate) => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
      const id = (candidate as Record<string, unknown>).id;
      return typeof id === "string" && prefixes.some((prefix) => id.startsWith(prefix));
    });
    return item && typeof item === "object" && !Array.isArray(item) ? (item as Record<string, unknown>).text : "";
  };
  return {
    city: String(find(["place.", "locality."]) || "").slice(0, 120),
    province: String(find(["region."]) || "").slice(0, 120),
    postalCode: String(find(["postcode."]) || "").slice(0, 24),
    country: String(find(["country."]) || "IT").slice(0, 64),
  };
}

export async function geocodeWithMapbox(address: string): Promise<{
  status: "used" | "not_configured" | "unavailable";
  candidates: GeocodeCandidate[];
}> {
  const token = runtimeSecret("MAPBOX_ACCESS_TOKEN");
  if (!token) return { status: "not_configured", candidates: [] };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const url = `${MAPBOX_GEOCODING_URL}/${encodeURIComponent(address)}.json?access_token=${encodeURIComponent(token)}&language=it&limit=5&country=it`;
    const response = await fetch(url, { signal: controller.signal, headers: { accept: "application/json" } });
    if (!response.ok) return { status: "unavailable", candidates: [] };
    const payload = await response.json() as { features?: unknown[] };
    const candidates = Array.isArray(payload.features) ? payload.features.flatMap((feature): GeocodeCandidate[] => {
      if (!feature || typeof feature !== "object" || Array.isArray(feature)) return [];
      const row = feature as Record<string, unknown>;
      const center = Array.isArray(row.center) ? row.center : [];
      const longitude = Number(center[0]);
      const latitude = Number(center[1]);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
      const context = Array.isArray(row.context) ? row.context : [];
      const parsedContext = mapboxContext(context);
      return [{
        provider: "MAPBOX",
        providerPlaceId: typeof row.id === "string" ? row.id.slice(0, 160) : "",
        formattedAddress: typeof row.place_name === "string" ? row.place_name.slice(0, 240) : address.slice(0, 240),
        latitude,
        longitude,
        street: typeof row.text === "string" ? row.text.slice(0, 160) : "",
        streetNumber: typeof row.address === "string" ? row.address.slice(0, 24) : "",
        city: parsedContext.city,
        province: parsedContext.province,
        postalCode: parsedContext.postalCode,
        country: parsedContext.country,
        confidence: typeof row.relevance === "number" ? Math.min(1, Math.max(0, row.relevance)) : 0,
      }];
    }) : [];
    return { status: "used", candidates };
  } catch {
    return { status: "unavailable", candidates: [] };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Live provider probe used only by the owner/provider status surface. The
 * probe deliberately uses a neutral public address and returns no coordinates
 * or provider payload to the caller.
 */
export async function probeMapboxRuntime(): Promise<{
  status: "READY" | "NOT_CONFIGURED" | "UNAVAILABLE";
  candidateCount: number;
  checkedAt: string;
}> {
  const result = await geocodeWithMapbox("Roma, Italia");
  return {
    status: result.status === "not_configured"
      ? "NOT_CONFIGURED"
      : result.status === "used" && result.candidates.length > 0
        ? "READY"
        : "UNAVAILABLE",
    candidateCount: result.candidates.length,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Live Traccar probe used by the owner/provider status surface. The health
 * check and webhook signing secret are reported separately because a tracker
 * API being reachable is not enough to accept signed provider events.
 */
export async function probeTraccarRuntime(): Promise<{
  status: "READY" | "NOT_CONFIGURED" | "UNAVAILABLE";
  webhookSignature: "READY" | "NOT_CONFIGURED";
  checkedAt: string;
}> {
  const webhookSignature = runtimeSecret("TRACCAR_WEBHOOK_SECRET")
    ? "READY" as const
    : "NOT_CONFIGURED" as const;
  try {
    const health = await new TraccarAdapter().healthCheck();
    return {
      status: health.status,
      webhookSignature,
      checkedAt: new Date().toISOString(),
    };
  } catch {
    return {
      status: "UNAVAILABLE",
      webhookSignature,
      checkedAt: new Date().toISOString(),
    };
  }
}

export type TrackingPosition = {
  providerEventId?: string;
  deviceId: string;
  recordedAt: string;
  latitude: number;
  longitude: number;
  accuracyM?: number | null;
  speedKmh?: number | null;
  heading?: number | null;
  altitude?: number | null;
  metadata?: Record<string, unknown>;
};

export type RemoteTrackingDevice = {
  id: string;
  name: string;
  uniqueId: string;
  status: string;
  lastUpdate: string | null;
};

export interface TrackingProvider {
  readonly providerType: "TRACCAR" | "NATIVE_DEVICE";
  listDevices(): Promise<RemoteTrackingDevice[] | null>;
  getDevice(deviceId: string): Promise<unknown>;
  getVehicleCurrentPosition(deviceId: string): Promise<TrackingPosition | null>;
  getVehiclePositionHistory(deviceId: string, from: string, to: string): Promise<TrackingPosition[]>;
  receivePosition(payload: unknown): TrackingPosition | null;
  receiveProviderEvent(payload: unknown): unknown;
  registerWebhook(url: string): Promise<{ status: "unsupported" | "configured"; url: string }>;
  validateWebhookSignature(request: Request, rawBody: string): Promise<boolean>;
  healthCheck(): Promise<{ status: "READY" | "UNAVAILABLE" | "NOT_CONFIGURED"; provider: string }>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function positionFromRecord(value: unknown): TrackingPosition | null {
  const row = asRecord(value);
  if (!row) return null;
  const latitude = Number(row.latitude ?? row.lat);
  const longitude = Number(row.longitude ?? row.lon ?? row.lng);
  const recordedAt = typeof row.recordedAt === "string"
    ? row.recordedAt
    : typeof row.deviceTime === "string"
      ? row.deviceTime
      : typeof row.fixTime === "string"
        ? row.fixTime
        : "";
  const deviceId = String(row.deviceId ?? row.device_id ?? row.id ?? "").slice(0, 160);
  if (!deviceId || !recordedAt || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  const numberOrNull = (candidate: unknown) => {
    const parsed = Number(candidate);
    return Number.isFinite(parsed) ? parsed : null;
  };
  return {
    providerEventId: typeof row.providerEventId === "string"
      ? row.providerEventId.slice(0, 160)
      : typeof row.id === "string" || typeof row.id === "number"
        ? String(row.id).slice(0, 160)
        : undefined,
    deviceId,
    recordedAt,
    latitude,
    longitude,
    accuracyM: numberOrNull(row.accuracyM ?? row.accuracy),
    speedKmh: numberOrNull(row.speedKmh ?? row.speed),
    heading: numberOrNull(row.heading ?? row.course),
    altitude: numberOrNull(row.altitude),
    metadata: {},
  };
}

function remoteDeviceFromRecord(value: unknown): RemoteTrackingDevice | null {
  const row = asRecord(value);
  if (!row) return null;
  const id = String(row.id ?? "").trim().slice(0, 160);
  if (!id) return null;
  return {
    id,
    name: String(row.name ?? row.uniqueId ?? `Dispositivo ${id}`).trim().slice(0, 160),
    uniqueId: String(row.uniqueId ?? "").trim().slice(0, 160),
    status: String(row.status ?? "unknown").trim().slice(0, 40),
    lastUpdate: typeof row.lastUpdate === "string" ? row.lastUpdate.slice(0, 40) : null,
  };
}

export class TraccarAdapter implements TrackingProvider {
  readonly providerType = "TRACCAR" as const;
  private readonly base = baseUrl(runtimeSecret("TRACCAR_BASE_URL"));
  private readonly token = runtimeSecret("TRACCAR_API_TOKEN");

  private async request(path: string, init?: RequestInit) {
    if (!this.base || !this.token) return null;
    const response = await fetch(`${this.base}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${this.token}`,
        ...(init?.headers ?? {}),
      },
    });
    if (!response.ok) return null;
    return response.json() as Promise<unknown>;
  }

  async listDevices() {
    const result = await this.request("/api/devices");
    if (!Array.isArray(result)) return null;
    return result.flatMap((item) => {
      const device = remoteDeviceFromRecord(item);
      return device ? [device] : [];
    });
  }

  async getDevice(deviceId: string) {
    return this.request(`/api/devices/${encodeURIComponent(deviceId)}`);
  }

  async getVehicleCurrentPosition(deviceId: string) {
    const result = await this.request(`/api/positions?deviceId=${encodeURIComponent(deviceId)}`);
    return Array.isArray(result) ? positionFromRecord(result[0]) : null;
  }

  async getVehiclePositionHistory(deviceId: string, from: string, to: string) {
    const result = await this.request(`/api/positions?deviceId=${encodeURIComponent(deviceId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    return Array.isArray(result) ? result.flatMap((item) => {
      const position = positionFromRecord(item);
      return position ? [position] : [];
    }) : [];
  }

  receivePosition(payload: unknown) {
    return positionFromRecord(payload);
  }

  receiveProviderEvent(payload: unknown) {
    return asRecord(payload) ?? {};
  }

  async registerWebhook(url: string) {
    return { status: "unsupported" as const, url: url.slice(0, 240) };
  }

  async validateWebhookSignature(request: Request, rawBody = "") {
    const expected = runtimeSecret("TRACCAR_WEBHOOK_SECRET");
    if (!expected) return false;
    const supplied = request.headers.get("x-zerow-provider-signature")
      ?? request.headers.get("x-zerow-provider-token")
      ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
      ?? "";
    if (supplied.length === expected.length && supplied === expected) return true;
    if (!rawBody || !supplied) return false;
    try {
      const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(expected), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
      const hex = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      const base64 = btoa(String.fromCharCode(...digest));
      const normalized = supplied.replace(/^sha256=/i, "").trim();
      return normalized === hex || normalized === base64;
    } catch {
      return false;
    }
  }

  async healthCheck() {
    if (!this.base || !this.token) return { status: "NOT_CONFIGURED" as const, provider: "TRACCAR" };
    try {
      const response = await this.request("/api/server");
      return { status: response ? "READY" as const : "UNAVAILABLE" as const, provider: "TRACCAR" };
    } catch {
      return { status: "UNAVAILABLE" as const, provider: "TRACCAR" };
    }
  }
}

export class NativeDeviceAdapter implements TrackingProvider {
  readonly providerType = "NATIVE_DEVICE" as const;

  async listDevices() { return []; }
  async getDevice(deviceId: string) { return { id: deviceId, source: "NATIVE_DEVICE" }; }
  async getVehicleCurrentPosition() { return null; }
  async getVehiclePositionHistory() { return []; }
  receivePosition(payload: unknown) { return positionFromRecord(payload); }
  receiveProviderEvent(payload: unknown) { return asRecord(payload) ?? {}; }
  async registerWebhook(url: string) { return { status: "unsupported" as const, url: url.slice(0, 240) }; }
  async validateWebhookSignature() { return false; }
  async healthCheck() { return { status: "READY" as const, provider: "NATIVE_DEVICE" }; }
}

export function trackingProviderFor(value: string): TrackingProvider {
  return value === "TRACCAR" ? new TraccarAdapter() : new NativeDeviceAdapter();
}
