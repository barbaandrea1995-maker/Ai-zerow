type ReadbackOptions = {
  force?: boolean;
};

type CacheEntry = {
  value: unknown;
  expiresAt: number;
};

const READBACK_TTL_MS = 15_000;
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<unknown>>();

export async function readback<T>(key: string, url: string, options: ReadbackOptions = {}) {
  const now = Date.now();
  const cached = cache.get(key);
  if (!options.force && cached && cached.expiresAt > now) {
    return cached.value as T;
  }

  const pending = inFlight.get(key);
  if (pending) return pending as Promise<T>;

  const request = fetch(url, { cache: "no-store" })
    .then(async (response) => {
      const payload = (await response.json()) as T & { error?: string };
      if (!response.ok) throw new Error(payload.error || "readback_failed");
      cache.set(key, { value: payload, expiresAt: Date.now() + READBACK_TTL_MS });
      return payload;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, request);
  return request;
}

export function invalidateReadback(key: string) {
  cache.delete(key);
}
