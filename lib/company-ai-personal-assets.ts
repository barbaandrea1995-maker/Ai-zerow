type JsonObject = Record<string, unknown>;

export type CompanyAiPersonalAssetAssignment = {
  id: string;
  tenantId: string;
  jobId: string;
  domain: string;
  recordType: string;
  status: string;
  title: string;
  payloadJson: string;
};

export type CompanyAiAssetCatalogRecord = {
  id: string;
  canonicalCode: string | null;
  title: string;
  detail: string;
  status: string;
  payloadJson: string;
};

function objectFromJson(value: string): JsonObject {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as JsonObject
      : {};
  } catch {
    return {};
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function assignmentStatus(statusValue: unknown, startsAtValue: unknown, now: number) {
  const status = stringValue(statusValue).toUpperCase();
  if (status === "RETURNED" || status === "CANCELLED") return status;
  const startsAt = stringValue(startsAtValue);
  const start = startsAt ? Date.parse(startsAt) : Number.NaN;
  return status === "ACTIVE" || (Number.isFinite(start) && start <= now) ? "ACTIVE" : "SCHEDULED";
}

/**
 * Add only the requesting member's active/scheduled custody records to the
 * Company AI context. The catalog remains canonical: an assignment without a
 * same-tenant asset record is deliberately not presented as a real asset.
 */
export function buildCompanyAiPersonalAssetContext({
  tenantId,
  actorId,
  membershipId,
  assignments,
  assets,
  now = Date.now(),
}: {
  tenantId: string;
  actorId: string;
  membershipId: string;
  assignments: readonly CompanyAiPersonalAssetAssignment[];
  assets: readonly CompanyAiAssetCatalogRecord[];
  now?: number;
}) {
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  return assignments.flatMap((row) => {
    if (row.tenantId !== tenantId || row.domain !== "assets" || row.recordType !== "ASSET_ASSIGNMENT") return [];
    const payload = objectFromJson(row.payloadJson);
    const assignedToActor = stringValue(payload.assigneeActorId) === actorId;
    const assignedToMembership = Boolean(membershipId)
      && stringValue(payload.assigneeMembershipId) === membershipId;
    if (!actorId || (!assignedToActor && !assignedToMembership)) return [];

    const status = assignmentStatus(row.status, payload.startsAt, now);
    if (status === "RETURNED" || status === "CANCELLED") return [];

    const assetId = stringValue(payload.assetId) || row.jobId;
    if (!assetId || row.jobId !== assetId) return [];
    const asset = assetById.get(assetId);
    if (!asset) return [];

    const code = asset.canonicalCode || asset.id;
    return [{
      id: code,
      module: "assets",
      recordType: "personal_asset_assignment",
      title: asset.title,
      detail: asset.detail,
      status: asset.status,
      assignment: {
        kind: stringValue(payload.assignmentKind) || "SHORT_TERM",
        status,
        assignee: stringValue(payload.assigneeName) || "utente corrente",
        startsAt: stringValue(payload.startsAt) || null,
        endsAt: stringValue(payload.endsAt) || null,
        purpose: stringValue(payload.purpose) || null,
        entityType: stringValue(payload.entityType) || "ASSET",
      },
      sourceRecordId: row.id,
    }];
  });
}
