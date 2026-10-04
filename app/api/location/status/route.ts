import { getAuthorityContext, hasCapability, publicAuthorityContext } from "@/lib/authority-context";
import { getLocationPostgisReadback, LocationPostgisReadbackError } from "@/lib/location-intelligence/postgis-readback";
import { getLocationProviderStatus } from "@/lib/location-intelligence/providers";

export const dynamic = "force-dynamic";

export async function GET() {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "location.manage.providers") && !hasCapability(context, "external_adapters.read")) {
    return Response.json({ error: "forbidden", capability: "location.manage.providers" }, { status: 403 });
  }
  const providers = getLocationProviderStatus();
  let postgisReadback: Awaited<ReturnType<typeof getLocationPostgisReadback>> | null = null;
  let postgisError: string | null = null;
  if (providers.storage.postgis === "CONFIGURED_UNVERIFIED") {
    try {
      postgisReadback = await getLocationPostgisReadback(context.tenantId);
      if (postgisReadback.status === "CONNECTED_READBACK_VERIFIED") {
        providers.storage.postgis = "CONNECTED_READBACK_VERIFIED";
      } else if (postgisReadback.status === "DEGRADED") {
        providers.storage.postgis = "DEGRADED";
      }
    } catch (error) {
      postgisError = error instanceof LocationPostgisReadbackError
        ? error.code
        : "location_postgis_readback_failed";
      providers.storage.postgis = "DEGRADED";
    }
  }

  return Response.json({
    context: publicAuthorityContext(context),
    command: "ZEROW_LOCATION_INTELLIGENCE_ENGINE",
    version: "1.0.0",
    status: "IMPLEMENTATION_SPEC",
    providers,
    postgisReadback: postgisReadback ?? (postgisError ? { status: "DEGRADED", error: postgisError } : null),
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
      postgis: providers.storage.postgis === "CONNECTED_READBACK_VERIFIED"
        ? "CONNECTED_READBACK_VERIFIED"
        : "RUNTIME_READBACK_PENDING",
      browserDeviceCertification: "NOT_RUN",
      privacyLegalReview: "REQUIRED",
    },
    readback: { status: "verified", scope: "tenant", checkedAt: new Date().toISOString() },
  }, { headers: { "cache-control": "private, no-store" } });
}
