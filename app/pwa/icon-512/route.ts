import { staticAssetResponse } from "@/lib/static-asset-response";

export async function GET(request: Request) {
  return staticAssetResponse(request, "/icons/ai-zerow-512.png");
}
