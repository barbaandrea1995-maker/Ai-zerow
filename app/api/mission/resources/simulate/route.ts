import { getAuthorityContext, hasCapability, publicAuthorityContext } from "@/lib/authority-context";
import { assertMissionResourceSelection, MissionResourceError } from "@/lib/mission-resources";

export const dynamic = "force-dynamic";

type JsonObject = Record<string, unknown>;

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function text(value: unknown, max = 160) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "mission.read") || !hasCapability(context, "mission.resources.read")) {
    return Response.json({ error: "resource_registry_access_required" }, { status: 403 });
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 32_768) return Response.json({ error: "payload_too_large" }, { status: 413 });
  let input: JsonObject;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return Response.json({ error: "invalid_json" }, { status: 400 });
    input = parsed;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const driverId = text(input.driverId);
  const vehicleId = text(input.vehicleId);
  const plannedAt = text(input.plannedAt, 40);
  const plannedEndAt = text(input.plannedEndAt, 40) || undefined;
  const transportMode = text(input.transportMode, 40);
  const cargoAssetIds = Array.isArray(input.cargoAssetIds)
    ? [...new Set(input.cargoAssetIds.filter((id): id is string => typeof id === "string").map((id) => id.trim()).filter(Boolean))].slice(0, 50)
    : [];
  if (!driverId || !vehicleId || !plannedAt) return Response.json({ error: "mission_driver_vehicle_and_date_required" }, { status: 400 });

  try {
    const selection = await assertMissionResourceSelection({
      tenantId: context.tenantId,
      driverId,
      vehicleId,
      cargoAssetIds,
      transportMode,
      plannedAt,
      plannedEndAt,
      simulationOnly: true,
    });
    return Response.json({
      context: publicAuthorityContext(context),
      simulationOnly: true,
      writesPerformed: false,
      reservationsCreated: false,
      custodyOverride: selection.custodyWarnings,
      validation: {
        result: "PASSED",
        driver: { id: selection.driver.id, label: selection.driver.label },
        vehicle: { id: selection.vehicle.id, label: selection.vehicle.label },
        cargo: selection.cargoAssets.map((asset) => ({ id: asset.id, label: asset.label, weightKg: asset.weightKg })),
        window: selection.window,
        capacity: {
          maxPayloadKg: selection.vehicle.maxPayloadKg,
          knownCargoWeightKg: selection.capacity.knownWeightKg,
          unknownCargoCount: selection.capacity.unknownCargoCount,
        },
      },
      contract: "read_only_dry_run_custody_is_not_changed_or_reserved",
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof MissionResourceError) {
      return Response.json({ simulationOnly: true, writesPerformed: false, error: error.code, details: error.details ?? null }, { status: error.code === "mission_resource_conflict" ? 409 : 422 });
    }
    return Response.json({ error: "mission_resource_simulation_unavailable" }, { status: 503 });
  }
}
