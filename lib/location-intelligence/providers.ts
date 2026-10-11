import { env } from "cloudflare:workers";
import type { GeocodeCandidate } from "@/lib/location-intelligence/provider-types";

const GEOAPIFY_GEOCODING_URL = "https://api.geoapify.com/v1/geocode/search";
// Keep the operational basemap bright so roads, place labels, and worksite pins
// remain legible in both daylight and dark application themes.
const GEOAPIFY_TILE_URL = "https://maps.geoapify.com/v1/tile/osm-bright";
export const ACTIVE_GEOCODING_PROVIDER = "GEOAPIFY" as const;

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
  geocoding: { provider: typeof ACTIVE_GEOCODING_PROVIDER; configured: boolean; status: "READY" | "NOT_CONFIGURED" };
  tracking: { provider: "TRACCAR"; configured: boolean; status: "READY" | "NOT_CONFIGURED" };
  storage: { controlPlane: "D1"; postgis: "NOT_CONNECTED" | "CONFIGURED_UNVERIFIED" | "CONNECTED_READBACK_VERIFIED" | "DEGRADED" };
};

export function getLocationProviderStatus(): LocationProviderStatus {
  const geoapifyConfigured = Boolean(runtimeSecret("GEOAPIFY_API_KEY"));
  const traccarConfigured = Boolean(runtimeSecret("TRACCAR_BASE_URL") && runtimeSecret("TRACCAR_API_TOKEN"));
  const postgisConfigured = Boolean(runtimeSecret("LOCATION_DATABASE_URL"));
  return {
    geocoding: { provider: ACTIVE_GEOCODING_PROVIDER, configured: geoapifyConfigured, status: geoapifyConfigured ? "READY" : "NOT_CONFIGURED" },
    tracking: { provider: "TRACCAR", configured: traccarConfigured, status: traccarConfigured ? "READY" : "NOT_CONFIGURED" },
    storage: { controlPlane: "D1", postgis: postgisConfigured ? "CONFIGURED_UNVERIFIED" : "NOT_CONNECTED" },
  };
}

function providerText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function geoapifyTileUrl(z: number, x: number, y: number) {
  const apiKey = runtimeSecret("GEOAPIFY_API_KEY");
  if (!apiKey) return null;
  const url = new URL(`${GEOAPIFY_TILE_URL}/${z}/${x}/${y}.png`);
  url.searchParams.set("apiKey", apiKey);
  return url.toString();
}

export async function geocodeAddress(address: string): Promise<{
  status: "used" | "not_configured" | "unavailable";
  candidates: GeocodeCandidate[];
}> {
  const apiKey = runtimeSecret("GEOAPIFY_API_KEY");
  if (!apiKey) return { status: "not_configured", candidates: [] };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const url = new URL(GEOAPIFY_GEOCODING_URL);
    url.searchParams.set("text", address);
    url.searchParams.set("format", "json");
    url.searchParams.set("lang", "it");
    url.searchParams.set("limit", "5");
    url.searchParams.set("filter", "countrycode:it");
    url.searchParams.set("apiKey", apiKey);
    const response = await fetch(url, { signal: controller.signal, headers: { accept: "application/json" } });
    if (!response.ok) return { status: "unavailable", candidates: [] };
    const payload = await response.json() as { results?: unknown[] };
    const seen = new Set<string>();
    const candidates = Array.isArray(payload.results) ? payload.results.flatMap((result): GeocodeCandidate[] => {
      if (!result || typeof result !== "object" || Array.isArray(result)) return [];
      const row = result as Record<string, unknown>;
      const longitude = Number(row.lon);
      const latitude = Number(row.lat);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
      const providerPlaceId = providerText(row.place_id, 160);
      if (!providerPlaceId || seen.has(providerPlaceId)) return [];
      seen.add(providerPlaceId);
      const rank = row.rank && typeof row.rank === "object" && !Array.isArray(row.rank)
        ? row.rank as Record<string, unknown>
        : {};
      const confidenceValue = Number(rank.confidence ?? rank.importance ?? 0);
      const confidence = Number.isFinite(confidenceValue) ? Math.min(1, Math.max(0, confidenceValue)) : 0;
      return [{
        provider: ACTIVE_GEOCODING_PROVIDER,
        providerPlaceId,
        formattedAddress: providerText(row.formatted, 240) || address.slice(0, 240),
        latitude,
        longitude,
        street: providerText(row.street ?? row.address_line1, 160),
        streetNumber: providerText(row.housenumber, 24),
        city: providerText(row.city ?? row.town ?? row.village ?? row.municipality, 120),
        province: providerText(row.county ?? row.state, 120),
        postalCode: providerText(row.postcode, 24),
        country: providerText(row.country_code, 8).toUpperCase() || providerText(row.country, 64) || "IT",
        confidence,
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
export async function probeGeocodingRuntime(): Promise<{
  status: "READY" | "NOT_CONFIGURED" | "UNAVAILABLE";
  candidateCount: number;
  checkedAt: string;
}> {
  const result = await geocodeAddress("Roma, Italia");
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
  createDevice(name: string, uniqueId: string): Promise<RemoteTrackingDevice | null>;
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

  async createDevice(name: string, uniqueId: string) {
    const result = await this.request("/api/devices", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.slice(0, 160), uniqueId: uniqueId.slice(0, 160) }),
    });
    return remoteDeviceFromRecord(result);
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
  async createDevice() { return null; }
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
