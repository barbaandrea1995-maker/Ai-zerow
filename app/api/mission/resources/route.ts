import { getAuthorityContext, hasCapability, publicAuthorityContext } from "@/lib/authority-context";
import { getMissionResourceCatalog, MissionResourceError } from "@/lib/mission-resources";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "mission.read")) {
    return Response.json({ error: "forbidden", capability: "mission.read" }, { status: 403 });
  }
  if (!hasCapability(context, "mission.resources.read")) {
    return Response.json({ error: "resource_registry_access_required" }, { status: 403 });
  }

  const url = new URL(request.url);
  const plannedAt = url.searchParams.get("plannedAt")?.trim() || undefined;
  const plannedEndAt = url.searchParams.get("plannedEndAt")?.trim() || undefined;
  const excludeRecordId = url.searchParams.get("excludeMissionId")?.trim() || undefined;
  const transportMode = url.searchParams.get("transportMode")?.trim() || undefined;
  const driverId = url.searchParams.get("driverId")?.trim() || undefined;

  try {
    const catalog = await getMissionResourceCatalog({
      tenantId: context.tenantId,
      plannedAt,
      plannedEndAt,
      excludeRecordId,
      transportMode,
      driverId,
    });
    return Response.json({
      context: publicAuthorityContext(context),
      catalog,
      contract: {
        source: "sites-d1-mission-resource-registry",
        selection: "server_validated_ids_only",
        availability: "tenant_scoped_lifecycle_and_time_window",
      },
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof MissionResourceError) {
      return Response.json({ error: error.code, details: error.details ?? null }, { status: 400 });
    }
    console.error("[mission/resources] catalog read failed", {
      name: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : "unknown_failure",
    });
    return Response.json({ error: "mission_resource_catalog_unavailable" }, { status: 503 });
  }
}
