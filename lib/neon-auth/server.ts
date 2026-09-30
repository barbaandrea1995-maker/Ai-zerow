import {
  createNeonAuth,
  type NeonAuth,
} from "@neondatabase/auth/next/server";

const baseUrl = process.env.NEON_AUTH_BASE_URL?.trim() ?? "";
const cookieSecret = process.env.NEON_AUTH_COOKIE_SECRET ?? "";

export const neonAuthConfiguration = {
  configured: Boolean(baseUrl && cookieSecret.length >= 32),
  baseUrlConfigured: Boolean(baseUrl),
  cookieSecretConfigured: cookieSecret.length >= 32,
} as const;

function initializeNeonAuth(): NeonAuth | null {
  if (!neonAuthConfiguration.configured) return null;

  try {
    return createNeonAuth({
      baseUrl,
      cookies: {
        secret: cookieSecret,
        sessionDataTtl: 300,
      },
      logLevel: "silent",
    });
  } catch {
    // Auth bootstrap must fail closed and let the UI render a controlled
    // unavailable state instead of crashing every server-rendered route.
    return null;
  }
}

export const neonAuth = initializeNeonAuth();
