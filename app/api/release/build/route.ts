export const dynamic = "force-static";

export async function GET() {
  return Response.json({
    buildId: "ai-zerow-sites-s08-v17",
    tranche: "S08",
    source: "Sites",
    manifest: "/manifest.webmanifest",
    serviceWorker: "/sw.js",
    browserCertification: "NOT_RUN",
    externalWorker: "DEFERRED",
  }, { headers: { "cache-control": "public, max-age=60" } });
}
