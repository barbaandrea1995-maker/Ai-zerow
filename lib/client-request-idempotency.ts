"use client";

import { useCallback, useMemo, useRef } from "react";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

export function clientRequestFingerprint(value: unknown) {
  return JSON.stringify(canonicalize(value));
}

const browserPendingKeys = new Map<string, string>();

function pendingIntent(namespace: string, operation: string, fingerprint: string) {
  return `${namespace}\u241f${operation}\u241f${fingerprint}`;
}

function browserKeyFor(namespace: string, operation: string, fingerprint: string) {
  const intent = pendingIntent(namespace, operation, fingerprint);
  const existing = browserPendingKeys.get(intent);
  if (existing) return existing;
  const key = `${namespace}:${operation}:${crypto.randomUUID()}`;
  browserPendingKeys.set(intent, key);
  return key;
}

function settleBrowserIntent(namespace: string, operation: string, fingerprint: string) {
  browserPendingKeys.delete(pendingIntent(namespace, operation, fingerprint));
}

export async function idempotentJsonMutation({
  url,
  namespace,
  operation,
  payload,
  method = "POST",
  fingerprint: suppliedFingerprint,
}: {
  url: string;
  namespace: string;
  operation: string;
  payload: Record<string, unknown>;
  method?: "POST" | "PATCH" | "PUT" | "DELETE";
  fingerprint?: string;
}) {
  const fingerprint = suppliedFingerprint ?? clientRequestFingerprint(payload);
  const idempotencyKey = browserKeyFor(namespace, operation, fingerprint);
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...payload, idempotencyKey }),
  });
  if (response.status < 500) settleBrowserIntent(namespace, operation, fingerprint);
  return response;
}

export async function idempotentFormMutation({
  url,
  namespace,
  operation,
  fingerprint,
  formData,
}: {
  url: string;
  namespace: string;
  operation: string;
  fingerprint: string;
  formData: FormData;
}) {
  const idempotencyKey = browserKeyFor(namespace, operation, fingerprint);
  formData.set("idempotencyKey", idempotencyKey);
  const response = await fetch(url, { method: "POST", body: formData });
  if (response.status < 500) settleBrowserIntent(namespace, operation, fingerprint);
  return response;
}

/**
 * Keeps one idempotency key for the same pending intent. A definitive response
 * must call `settle`; a network error or a 5xx intentionally leaves the key in
 * place so the user's retry cannot create a second aggregate.
 */
export function usePendingRequestKeys(namespace: string) {
  const pending = useRef(new Map<string, string>());

  const keyFor = useCallback((operation: string, fingerprint: string) => {
    const intent = `${operation}\u241f${fingerprint}`;
    const existing = pending.current.get(intent);
    if (existing) return existing;
    const key = `${namespace}:${operation}:${crypto.randomUUID()}`;
    pending.current.set(intent, key);
    return key;
  }, [namespace]);

  const settle = useCallback((operation: string, fingerprint: string) => {
    pending.current.delete(`${operation}\u241f${fingerprint}`);
  }, []);

  const clearAll = useCallback(() => {
    pending.current.clear();
  }, []);

  return useMemo(() => ({ keyFor, settle, clearAll } as const), [clearAll, keyFor, settle]);
}
