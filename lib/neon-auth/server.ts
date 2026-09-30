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

export const neonAuth: NeonAuth | null = neonAuthConfiguration.configured
  ? createNeonAuth({
      baseUrl,
      cookies: {
        secret: cookieSecret,
        sessionDataTtl: 300,
      },
      logLevel: "silent",
    })
  : null;

