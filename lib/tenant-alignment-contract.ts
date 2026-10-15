/**
 * Owner-approved, immutable reconciliation contract for the two production
 * tenant roots observed on 2026-10-15. The manifest contains decisions only;
 * the executor always rereads D1 and refuses to run when a precondition moved.
 */

export const TENANT_ALIGNMENT_CONTRACT_VERSION = "TENANT_ALIGNMENT_V1" as const;
export const TENANT_ALIGNMENT_RUN_ID = "TENANT-ALIGNMENT-2026-10-15-V1" as const;
export const TENANT_ALIGNMENT_SOURCE_ID = "sites:appgprj_6abaaf2bb58081919b265a8a6ad76dbb" as const;
export const TENANT_ALIGNMENT_TARGET_ID = "tenant:57617250-c415-422c-9ed0-c7c5f417c86b" as const;

export const TENANT_ALIGNMENT_ACTORS = {
  sitesOwner: "vf8Y9BhHr4r6sM0PPCdapIOhORFY9SwwfIMu0lHEl2TruxZNwqmFUS",
  targetOwner: "5fe76977-a786-4c84-8ef3-421f4d3f0190",
  sourceNeonOwner: "6e28dbd2-fc4e-44f0-b2ed-d621a3227ea1",
} as const;

export const TENANT_ALIGNMENT_IDS = {
  targetSitesMembership: `site-owner:${TENANT_ALIGNMENT_TARGET_ID}:vf8Y9BhHr4r6sM0PPCdapIOhORFY9SwwfIMu0lHEl2TruxZNwqmFUS`,
  targetNeonMembership: `tenant-owner:${TENANT_ALIGNMENT_TARGET_ID}:neon:5fe76977-a786-4c84-8ef3-421f4d3f0190`,
  sourceSitesMembership: `site-owner:${TENANT_ALIGNMENT_SOURCE_ID}:vf8Y9BhHr4r6sM0PPCdapIOhORFY9SwwfIMu0lHEl2TruxZNwqmFUS`,
  sourceNeonMembership: `neon:${TENANT_ALIGNMENT_SOURCE_ID}:6e28dbd2-fc4e-44f0-b2ed-d621a3227ea1`,

  sourcePomeziaWarehouse: "7bb8ce28-ca5f-4c7d-bfe2-3d0f51c261eb",
  targetDragonaWarehouse: "2ce32435-4b76-45d8-a7ac-e5c333daaf5b",
  targetPomeziaWarehouse: "642503b0-f053-4f71-aaec-8790c0a52a60",
  targetDragonaLocation: "GEO-WAREHOUSE-2ce32435-4b76-45d8-a7ac-e5c333daaf5b",

  sourceMiniExcavator: "ASSETS-4201D5EC",
  sourceFordTransit: "ASSETS-F4B55136",
  sourceDriver: "AUTH-DRIVER-vf8Y9BhHr4r6sM0PPCdapIOhORFY9SwwfIMu0lHEl2TruxZNwqmFUS",
  sourcePlaceholderJob: "OPERATIONS-47363CDE",
  sourceJob: "OPERATIONS-52D6684C",
  targetFordTransit: "ASSETS-6967ADE1",
  targetMiniExcavator: "ASSETS-FC89DE41",
  targetIvecoDaily: "ASSETS-9E0C3CB6",
  targetDriver: "AUTH-DRIVER-5fe76977-a786-4c84-8ef3-421f4d3f0190",
  targetJob: "OPERATIONS-ALIGN-52D6684C",
  targetJobLocation: "GEO-CANTIERE-ALIGN-52D6684C",
  targetJobGeofence: "GEOFENCE-CANTIERE-ALIGN-52D6684C",

  sourceInventoryItem: "68b6814c-ced1-4633-b83b-bbe5950d5806",
  targetInventoryItem: "INVENTORY-ALIGN-68B6814C",
  sourceInventoryMovement: "7973cb9f-49e7-44b3-b7ec-b94775914395",
  targetInventoryMovement: "INVENTORY-MOVEMENT-ALIGN-7973CB9F",
  targetInventoryQr: "MATERIAL-QR-ALIGN-TUBO-PVC",

  sourceAttendance: "17e3753b-e04c-4118-8ee3-0d040277ddfa",
  targetAttendance: "JOURNEY-ALIGN-17E3753B",
  sourceCompanyAiScope: "COMPANY-AI-SCOPE-D617302D",
  targetCompanyAiScope: "COMPANY-AI-SCOPE-ALIGN-D617302D",
  sourceDashboardPreference: "a570c264-84cb-43f3-a9a3-17e17ea40ac5",
  targetDashboardPreference: "DASHBOARD-PREFERENCE-ALIGN-A570C264",

  sourceWrongQr: "WAREHOUSE-QR-D99B4CC3",
  targetChiusiniQr: "MATERIAL-QR-D6D9E141",
  targetWrongQrAlias: "QR-ALIAS-ALIGN-D99B4CC3",

  sourceTrackingProvider: "TRACKING-PROVIDER-08A61362-C21",
  targetTrackingProvider: "TRACKING-PROVIDER-ALIGN-08A61362",
  sourceMobileDevice: "TRACKING-DEVICE-86D146A2-916",
  targetMobileDevice: "TRACKING-DEVICE-ALIGN-86D146A2",
  sourceVehicleDevice: "TRACKING-DEVICE-FFE38D9A-BF5",
  targetVehicleDevice: "TRACKING-DEVICE-ALIGN-FFE38D9A",

  custodyFordTransit: "ASSET-CUSTODY-ALIGN-ASSETS-6967ADE1",
  custodyMiniExcavator: "ASSET-CUSTODY-ALIGN-ASSETS-FC89DE41",
  custodyIvecoDaily: "ASSET-CUSTODY-ALIGN-ASSETS-9E0C3CB6",

  event: "TENANT-ALIGNMENT-EVENT-2026-10-15-V1",
  outbox: "TENANT-ALIGNMENT-OUTBOX-2026-10-15-V1",
  reconciliation: "TENANT-ALIGNMENT-RECON-2026-10-15-V1",
  aiLedger: "TENANT-ALIGNMENT-AI-LEDGER-2026-10-15-V1",
} as const;

export const TENANT_ALIGNMENT_EXPECTED_UPDATED_AT = {
  sourceWarehouse: "2026-10-03T17:30:46.477Z",
  sourceMiniExcavator: "2026-10-04T05:30:35.256Z",
  sourceFordTransit: "2026-10-01T22:03:38.113Z",
  sourceDriver: "2026-10-03T17:31:42.387Z",
  sourcePlaceholderJob: "2026-09-30T21:09:35.227Z",
  sourceJob: "2026-10-01T21:27:06.011Z",
  sourceInventoryItem: "2026-10-03T17:32:53.501Z",
  sourceAttendance: "2026-10-04T08:01:19.287Z",
  sourceCompanyAiScope: "2026-10-01T19:48:56.017Z",
  sourceDashboardPreference: "2026-10-02T18:02:50.863Z",
  sourceTrackingProvider: "2026-10-04T11:00:00.371Z",
  sourceMobileDevice: "2026-10-04T11:06:52.756Z",
  sourceVehicleDevice: "2026-10-04T11:01:53.312Z",
} as const;

export const TENANT_ALIGNMENT_MANIFEST = {
  contractVersion: TENANT_ALIGNMENT_CONTRACT_VERSION,
  runId: TENANT_ALIGNMENT_RUN_ID,
  sourceTenantId: TENANT_ALIGNMENT_SOURCE_ID,
  targetTenantId: TENANT_ALIGNMENT_TARGET_ID,
  approval: {
    status: "OWNER_APPROVED",
    source: "chatgpt-owner-explicit-2026-10-15",
    rolesAreUnioned: false,
  },
  collisions: [
    { registry: "tenant_warehouses", sourceId: TENANT_ALIGNMENT_IDS.sourcePomeziaWarehouse, targetId: TENANT_ALIGNMENT_IDS.targetPomeziaWarehouse, resolution: "MATCH_PHYSICAL_PLACE_TARGET_VERIFIED_WINS" },
    { registry: "s04_records", sourceId: TENANT_ALIGNMENT_IDS.sourceMiniExcavator, targetId: TENANT_ALIGNMENT_IDS.targetMiniExcavator, resolution: "MATCH_PHYSICAL_ASSET" },
    { registry: "s04_records", sourceId: TENANT_ALIGNMENT_IDS.sourceFordTransit, targetId: TENANT_ALIGNMENT_IDS.targetFordTransit, resolution: "MATCH_PHYSICAL_VEHICLE" },
    { registry: "s04_records", sourceId: TENANT_ALIGNMENT_IDS.sourceDriver, targetId: TENANT_ALIGNMENT_IDS.targetDriver, resolution: "MATCH_PERSON_ROLE_NOT_UNIONED" },
    { registry: "s04_records", sourceId: TENANT_ALIGNMENT_IDS.sourceJob, targetId: TENANT_ALIGNMENT_IDS.targetJob, resolution: "COPY_REKEY_COMM_0002" },
    { registry: "s04_records", sourceId: TENANT_ALIGNMENT_IDS.sourcePlaceholderJob, targetId: null, resolution: "ARCHIVE_PLACEHOLDER" },
    { registry: "qr_codes", sourceId: TENANT_ALIGNMENT_IDS.sourceWrongQr, targetId: TENANT_ALIGNMENT_IDS.targetChiusiniQr, resolution: "ALIAS_TO_CANONICAL_MATERIAL" },
  ],
  copyPolicy: {
    copy: ["legacy-job", "job-attendance", "job-company-ai-scope", "tube-inventory", "tube-ledger", "tracking-provider", "tracking-devices", "dashboard-preference"],
    matchWithoutCopy: ["warehouse-pomezia", "mini-excavator", "ford-transit", "driver"],
    retainUnderSource: ["s06-history", "s07-history", "location-access-audit", "rate-limit-windows"],
    suppress: ["empty-placeholder-job", "misclassified-warehouse-qr"],
  },
  locationPolicy: {
    copiedJob: "DISTINCT_CANTIERE_AT_VERIFIED_DRAGONA_COORDINATES",
    assetCustody: "TARGET_DRAGONA_WAREHOUSE",
    geofenceRadiusMeters: 100,
  },
  archivePolicy: {
    sourceTenantStatus: "archived",
    sourceMembershipStatus: "removed",
    deleteSourceRows: false,
    rollback: "REACTIVATE_SOURCE_AND_DISABLE_CLONES_USING_ALIGNMENT_LINKS",
  },
} as const;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, stableValue(entry)]));
}

export function stableAlignmentManifestJson() {
  return JSON.stringify(stableValue(TENANT_ALIGNMENT_MANIFEST));
}

export async function tenantAlignmentManifestHash() {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stableAlignmentManifestJson()));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function alignmentLinkId(sourceRegistry: string, sourceId: string) {
  const compact = `${sourceRegistry}-${sourceId}`.replace(/[^a-zA-Z0-9-]+/g, "-").replace(/-+/g, "-").slice(0, 110);
  return `ALIGN-LINK-${compact}`;
}

export type TenantAlignmentApproval = {
  contractVersion: typeof TENANT_ALIGNMENT_CONTRACT_VERSION;
  runId: typeof TENANT_ALIGNMENT_RUN_ID;
  sourceTenantId: typeof TENANT_ALIGNMENT_SOURCE_ID;
  targetTenantId: typeof TENANT_ALIGNMENT_TARGET_ID;
  manifestHash: string;
};

export function isExactTenantAlignmentApproval(value: unknown, manifestHash: string): value is TenantAlignmentApproval {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return input.contractVersion === TENANT_ALIGNMENT_CONTRACT_VERSION
    && input.runId === TENANT_ALIGNMENT_RUN_ID
    && input.sourceTenantId === TENANT_ALIGNMENT_SOURCE_ID
    && input.targetTenantId === TENANT_ALIGNMENT_TARGET_ID
    && input.manifestHash === manifestHash;
}
