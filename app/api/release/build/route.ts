import { RELEASE_BUILD_ID, RELEASE_BUILD_LABEL } from "@/lib/release";

export const dynamic = "force-static";

export async function GET() {
  return Response.json({
    buildId: RELEASE_BUILD_ID,
    buildLabel: RELEASE_BUILD_LABEL,
    tranche: "W17",
    source: "Sites",
    manifest: "/manifest.webmanifest",
    serviceWorker: "/sw.js",
    certification: "LOCAL_TECHNICAL_ONLY",
    commercialStatus: "NO_GO",
    promotionAllowed: false,
    browserCertification: "NOT_RUN",
    externalWorker: "DEFERRED",
  }, { headers: { "cache-control": "public, max-age=60" } });
}
