import { getAuthorityContext, hasCapability, publicAuthorityContext } from "@/lib/authority-context";
import { getLocationProviderStatus } from "@/lib/location-intelligence/providers";

export const dynamic = "force-dynamic";

export async function GET() {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "location.manage.providers") && !hasCapability(context, "external_adapters.read")) {
    return Response.json({ error: "forbidden", capability: "location.manage.providers" }, { status: 403 });
  }
  return Response.json({
    context: publicAuthorityContext(context),
    command: "ZEROW_LOCATION_INTELLIGENCE_ENGINE",
    version: "1.0.0",
    status: "IMPLEMENTATION_SPEC",
    providers: getLocationProviderStatus(),
    contracts: {
      rawGpsIsNotBusinessTruth: true,
      companyAiRawSamples: "DENY_BY_DEFAULT",
      companyAiWrites: false,
      deliveryGpsArrivalEqualsConfirmation: false,
      tenantIsolation: "SERVER_ENFORCED",
      audit: "LOCATION_READS_APPEND_ONLY",
    },
    runtimeGates: {
      mapProvider: "UNKNOWN_UNTIL_MAPBOX_RUNTIME_CHECK",
      trackingProvider: "UNKNOWN_UNTIL_TRACCAR_RUNTIME_CHECK",
      postgis: "NOT_CONNECTED_TO_SITES_CONTROL_PLANE",
      browserDeviceCertification: "NOT_RUN",
      privacyLegalReview: "REQUIRED",
    },
    readback: { status: "verified", scope: "tenant", checkedAt: new Date().toISOString() },
  }, { headers: { "cache-control": "private, no-store" } });
}
