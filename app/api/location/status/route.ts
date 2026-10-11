import { getAuthorityContext, hasCapability, publicAuthorityContext } from "@/lib/authority-context";
import { getLocationPostgisReadback, LocationPostgisReadbackError } from "@/lib/location-intelligence/postgis-readback";
import { getLocationProviderStatus, probeGeocodingRuntime, probeTraccarRuntime } from "@/lib/location-intelligence/providers";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "location.manage.providers") && !hasCapability(context, "external_adapters.read")) {
    return Response.json({ error: "forbidden", capability: "location.manage.providers" }, { status: 403 });
  }
  const providers = getLocationProviderStatus();
  const probe = new URL(request.url).searchParams.get("probe");
  const geoapifyProbeRequested = probe === "geoapify";
  const traccarProbeRequested = probe === "traccar";
  const geoapifyProbe = geoapifyProbeRequested && providers.geocoding.configured
    ? await probeGeocodingRuntime()
    : null;
  const traccarProbe = traccarProbeRequested
    ? await probeTraccarRuntime()
    : null;
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
    geoapifyProbe,
    traccarProbe,
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
      mapProvider: geoapifyProbe?.status === "READY"
        ? "LIVE_READY"
        : geoapifyProbeRequested
          ? providers.geocoding.configured ? "LIVE_CHECK_FAILED" : "NOT_CONFIGURED"
          : "UNKNOWN_UNTIL_GEOAPIFY_RUNTIME_CHECK",
      trackingProvider: traccarProbe?.status === "READY" && traccarProbe.webhookSignature === "READY"
        ? "LIVE_READY"
        : traccarProbe?.status === "READY"
          ? "LIVE_API_READY_WEBHOOK_SECRET_MISSING"
          : traccarProbe?.status === "NOT_CONFIGURED"
            ? "NOT_CONFIGURED"
          : traccarProbeRequested
            ? "LIVE_CHECK_FAILED"
            : "UNKNOWN_UNTIL_TRACCAR_RUNTIME_CHECK",
      postgis: providers.storage.postgis === "CONNECTED_READBACK_VERIFIED"
        ? "CONNECTED_READBACK_VERIFIED"
        : "RUNTIME_READBACK_PENDING",
      browserDeviceCertification: "NOT_RUN",
      privacyLegalReview: "REQUIRED",
    },
    readback: { status: "verified", scope: "tenant", checkedAt: new Date().toISOString() },
  }, { headers: { "cache-control": "private, no-store" } });
}
