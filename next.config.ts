import type { NextConfig } from "next";

const baseContentSecurityPolicy = "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'self' wss:; worker-src 'self' blob:; manifest-src 'self'";
const geniusScanContentSecurityPolicy = "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'self' data: wss:; worker-src 'self' blob:; manifest-src 'self'";

function securityHeaders(contentSecurityPolicy: string) {
  return [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=(self), payment=()" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
] as const;
}

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/documents/scan", headers: [...securityHeaders(geniusScanContentSecurityPolicy)] },
      // Keep the scanner rule first: Vinext preserves the first value for a
      // duplicated response header, so the route-specific CSP wins while the
      // ordinary catch-all still protects every other surface.
      { source: "/:path*", headers: [...securityHeaders(baseContentSecurityPolicy)] },
    ];
  },
};

export default nextConfig;
