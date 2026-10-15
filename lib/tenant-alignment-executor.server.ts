import { and, eq, inArray, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { getDb } from "@/db";
import {
  assetCustodyLocations,
  commandDashboardPreferences,
  companyAiJobScopes,
  entityCodeCounters,
  geoLocations,
  geofences,
  inventoryItems,
  inventoryMovements,
  jobJourneyRecords,
  qrCodeAliases,
  qrCodes,
  s04Records,
  s06Events,
  s06Outbox,
  s06Reconciliations,
  s07AiLedger,
  tenantAlignmentLinks,
  tenantAlignmentRuns,
  tenantMemberships,
  tenantWarehouses,
  tenants,
  trackingDevices,
  trackingProviders,
} from "@/db/schema";
import {
  TENANT_ALIGNMENT_ACTORS,
  TENANT_ALIGNMENT_CONTRACT_VERSION,
  TENANT_ALIGNMENT_EXPECTED_UPDATED_AT,
  TENANT_ALIGNMENT_IDS,
  TENANT_ALIGNMENT_MANIFEST,
  TENANT_ALIGNMENT_RUN_ID,
  TENANT_ALIGNMENT_SOURCE_ID,
  TENANT_ALIGNMENT_TARGET_ID,
  alignmentLinkId,
  tenantAlignmentManifestHash,
} from "@/lib/tenant-alignment-contract";

type JsonObject = Record<string, unknown>;
type AlignmentDryRunStatus = "READY" | "BLOCKED" | "APPLIED";

export type TenantAlignmentDryRun = {
  contractVersion: typeof TENANT_ALIGNMENT_CONTRACT_VERSION;
  runId: typeof TENANT_ALIGNMENT_RUN_ID;
  sourceTenantId: typeof TENANT_ALIGNMENT_SOURCE_ID;
  targetTenantId: typeof TENANT_ALIGNMENT_TARGET_ID;
  manifestHash: string;
  status: AlignmentDryRunStatus;
  generatedAt: string;
  writeOperations: number;
  blockers: string[];
  warnings: string[];
  decisions: typeof TENANT_ALIGNMENT_MANIFEST.collisions;
  preservation: {
    sourceRowsDeleted: false;
    historicalEventStreamsCopied: false;
    sourceArchivedAfterReadback: true;
    logicalRollback: string;
  };
  expectedResult: {
    activeTenantRoots: 1;
    clonedRecords: number;
    matchedRecords: number;
    provenanceLinks: number;
    canonicalAssetCustodyRows: number;
  };
};

export type TenantAlignmentExecutionResult = {
  status: "COMPLETED";
  idempotent: boolean;
  runId: string;
  manifestHash: string;
  sourceTenantStatus: string;
  targetTenantStatus: string;
  targetSitesMembershipStatus: string;
  linkCount: number;
  clonedJobCode: "COMM-0002";
  clonedInventorySku: "TUBO-PVC-INNES";
  custodyCount: number;
  completedAt: string;
  rollback: string;
};

type AlignmentState = Awaited<ReturnType<typeof readAlignmentState>>;

const TARGET_JOB_CODE = "COMM-0002" as const;
const TARGET_INVENTORY_SKU = "TUBO-PVC-INNES" as const;
const TARGET_INVENTORY_QR = `AZ1|MATERIAL|${TARGET_INVENTORY_SKU}` as const;
const WRONG_QR_PAYLOAD = "AZ1|WAREHOUSE|CHIUS-GHIS-50X50" as const;
const CANONICAL_CHIUSINI_QR = "AZ1|MATERIAL|CHIUS-GHIS-50x50" as const;
const PLANNED_WRITE_GROUPS = 23;

// Sites deploys the Worker artifact independently from D1. Keep this bounded
// bootstrap next to the immutable alignment executor so a newly published
// version can install its additive registry tables before the first dry-run.
// Every statement is idempotent and no business row is inserted or changed.
const TENANT_ALIGNMENT_SCHEMA_DDL = [
  `CREATE TABLE IF NOT EXISTS tenant_alignment_runs (
    id text PRIMARY KEY NOT NULL,
    source_tenant_id text NOT NULL,
    target_tenant_id text NOT NULL,
    contract_version text NOT NULL,
    manifest_hash text NOT NULL,
    status text DEFAULT 'APPROVED' NOT NULL,
    dry_run_json text DEFAULT '{}' NOT NULL,
    result_json text DEFAULT '{}' NOT NULL,
    approved_by text NOT NULL,
    approval_source text NOT NULL,
    created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
    completed_at text,
    FOREIGN KEY (source_tenant_id) REFERENCES tenants(id) ON UPDATE no action ON DELETE no action,
    FOREIGN KEY (target_tenant_id) REFERENCES tenants(id) ON UPDATE no action ON DELETE no action
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS tenant_alignment_runs_source_target_contract_uq ON tenant_alignment_runs (source_tenant_id, target_tenant_id, contract_version)",
  "CREATE INDEX IF NOT EXISTS tenant_alignment_runs_target_status_idx ON tenant_alignment_runs (target_tenant_id, status, updated_at)",
  `CREATE TABLE IF NOT EXISTS tenant_alignment_links (
    id text PRIMARY KEY NOT NULL,
    run_id text NOT NULL,
    source_tenant_id text NOT NULL,
    source_registry text NOT NULL,
    source_id text NOT NULL,
    target_tenant_id text NOT NULL,
    target_registry text NOT NULL,
    target_id text,
    resolution text NOT NULL,
    metadata_json text DEFAULT '{}' NOT NULL,
    created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (run_id) REFERENCES tenant_alignment_runs(id) ON UPDATE no action ON DELETE no action,
    FOREIGN KEY (source_tenant_id) REFERENCES tenants(id) ON UPDATE no action ON DELETE no action,
    FOREIGN KEY (target_tenant_id) REFERENCES tenants(id) ON UPDATE no action ON DELETE no action
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS tenant_alignment_links_source_uq ON tenant_alignment_links (source_tenant_id, source_registry, source_id)",
  "CREATE INDEX IF NOT EXISTS tenant_alignment_links_run_idx ON tenant_alignment_links (run_id, source_registry)",
  "CREATE INDEX IF NOT EXISTS tenant_alignment_links_target_idx ON tenant_alignment_links (target_tenant_id, target_registry, target_id)",
  `CREATE TABLE IF NOT EXISTS asset_custody_locations (
    id text PRIMARY KEY NOT NULL,
    tenant_id text NOT NULL,
    asset_id text NOT NULL,
    warehouse_id text,
    location_id text,
    status text DEFAULT 'UNKNOWN' NOT NULL,
    source text DEFAULT 'ASSET_PROFILE' NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    effective_at text NOT NULL,
    created_by text NOT NULL,
    created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON UPDATE no action ON DELETE no action,
    FOREIGN KEY (warehouse_id) REFERENCES tenant_warehouses(id) ON UPDATE no action ON DELETE no action
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS asset_custody_locations_tenant_asset_uq ON asset_custody_locations (tenant_id, asset_id)",
  "CREATE INDEX IF NOT EXISTS asset_custody_locations_tenant_warehouse_status_idx ON asset_custody_locations (tenant_id, warehouse_id, status, updated_at)",
  `CREATE TABLE IF NOT EXISTS qr_code_aliases (
    id text PRIMARY KEY NOT NULL,
    tenant_id text NOT NULL,
    alias_payload text NOT NULL,
    canonical_payload text NOT NULL,
    source_tenant_id text,
    reason text NOT NULL,
    status text DEFAULT 'ACTIVE' NOT NULL,
    created_by text NOT NULL,
    created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON UPDATE no action ON DELETE no action
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS qr_code_aliases_tenant_alias_uq ON qr_code_aliases (tenant_id, alias_payload)",
  "CREATE INDEX IF NOT EXISTS qr_code_aliases_tenant_canonical_idx ON qr_code_aliases (tenant_id, canonical_payload, status)",
] as const;

async function ensureTenantAlignmentSchema() {
  const db = getDb();
  await db.$client.batch(TENANT_ALIGNMENT_SCHEMA_DDL.map((statement) => db.$client.prepare(statement)));
}

function parseObject(value: string): JsonObject {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as JsonObject : {};
  } catch {
    return {};
  }
}

function rewritten(value: unknown, replacements: ReadonlyMap<string, string>): unknown {
  if (typeof value === "string") return replacements.get(value) ?? value;
  if (Array.isArray(value)) return value.map((entry) => rewritten(entry, replacements));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as JsonObject).map(([key, entry]) => [key, rewritten(entry, replacements)]));
}

function one<T>(rows: T[], predicate: (row: T) => boolean) {
  return rows.find(predicate) ?? null;
}

async function readAlignmentState() {
  const db = getDb();
  const sourceRecordIds = [
    TENANT_ALIGNMENT_IDS.sourceMiniExcavator,
    TENANT_ALIGNMENT_IDS.sourceFordTransit,
    TENANT_ALIGNMENT_IDS.sourceDriver,
    TENANT_ALIGNMENT_IDS.sourcePlaceholderJob,
    TENANT_ALIGNMENT_IDS.sourceJob,
  ];
  const targetRecordIds = [
    TENANT_ALIGNMENT_IDS.targetFordTransit,
    TENANT_ALIGNMENT_IDS.targetMiniExcavator,
    TENANT_ALIGNMENT_IDS.targetIvecoDaily,
    TENANT_ALIGNMENT_IDS.targetDriver,
    TENANT_ALIGNMENT_IDS.targetJob,
  ];
  const [
    tenantRows,
    sourceMembershipRows,
    targetMembershipRows,
    warehouseRows,
    sourceRecordRows,
    targetRecordRows,
    targetJobCodeRows,
    sourceInventoryRows,
    targetInventoryRows,
    sourceMovementRows,
    sourceJourneyRows,
    sourceScopeRows,
    sourcePreferenceRows,
    targetPreferenceRows,
    qrRows,
    sourceProviderRows,
    targetProviderRows,
    sourceDeviceRows,
    targetDeviceRows,
    targetLocationRows,
    targetCustodyRows,
    runRows,
    linkRows,
  ] = await Promise.all([
    db.select().from(tenants).where(inArray(tenants.id, [TENANT_ALIGNMENT_SOURCE_ID, TENANT_ALIGNMENT_TARGET_ID])),
    db.select().from(tenantMemberships).where(eq(tenantMemberships.tenantId, TENANT_ALIGNMENT_SOURCE_ID)),
    db.select().from(tenantMemberships).where(eq(tenantMemberships.tenantId, TENANT_ALIGNMENT_TARGET_ID)),
    db.select().from(tenantWarehouses).where(inArray(tenantWarehouses.id, [
      TENANT_ALIGNMENT_IDS.sourcePomeziaWarehouse,
      TENANT_ALIGNMENT_IDS.targetDragonaWarehouse,
      TENANT_ALIGNMENT_IDS.targetPomeziaWarehouse,
    ])),
    db.select().from(s04Records).where(and(eq(s04Records.tenantId, TENANT_ALIGNMENT_SOURCE_ID), inArray(s04Records.id, sourceRecordIds))),
    db.select().from(s04Records).where(and(eq(s04Records.tenantId, TENANT_ALIGNMENT_TARGET_ID), inArray(s04Records.id, targetRecordIds))),
    db.select().from(s04Records).where(and(
      eq(s04Records.tenantId, TENANT_ALIGNMENT_TARGET_ID),
      eq(s04Records.module, "operations"),
      eq(s04Records.canonicalCode, TARGET_JOB_CODE),
    )),
    db.select().from(inventoryItems).where(and(eq(inventoryItems.tenantId, TENANT_ALIGNMENT_SOURCE_ID), eq(inventoryItems.id, TENANT_ALIGNMENT_IDS.sourceInventoryItem))),
    db.select().from(inventoryItems).where(and(
      eq(inventoryItems.tenantId, TENANT_ALIGNMENT_TARGET_ID),
      eq(inventoryItems.warehouseId, TENANT_ALIGNMENT_IDS.targetPomeziaWarehouse),
      eq(inventoryItems.sku, TARGET_INVENTORY_SKU),
    )),
    db.select().from(inventoryMovements).where(and(eq(inventoryMovements.tenantId, TENANT_ALIGNMENT_SOURCE_ID), eq(inventoryMovements.id, TENANT_ALIGNMENT_IDS.sourceInventoryMovement))),
    db.select().from(jobJourneyRecords).where(and(eq(jobJourneyRecords.tenantId, TENANT_ALIGNMENT_SOURCE_ID), eq(jobJourneyRecords.id, TENANT_ALIGNMENT_IDS.sourceAttendance))),
    db.select().from(companyAiJobScopes).where(and(eq(companyAiJobScopes.tenantId, TENANT_ALIGNMENT_SOURCE_ID), eq(companyAiJobScopes.id, TENANT_ALIGNMENT_IDS.sourceCompanyAiScope))),
    db.select().from(commandDashboardPreferences).where(and(eq(commandDashboardPreferences.tenantId, TENANT_ALIGNMENT_SOURCE_ID), eq(commandDashboardPreferences.id, TENANT_ALIGNMENT_IDS.sourceDashboardPreference))),
    db.select().from(commandDashboardPreferences).where(and(eq(commandDashboardPreferences.tenantId, TENANT_ALIGNMENT_TARGET_ID), eq(commandDashboardPreferences.actorId, TENANT_ALIGNMENT_ACTORS.targetOwner))),
    db.select().from(qrCodes).where(inArray(qrCodes.id, [TENANT_ALIGNMENT_IDS.sourceWrongQr, TENANT_ALIGNMENT_IDS.targetChiusiniQr, TENANT_ALIGNMENT_IDS.targetInventoryQr])),
    db.select().from(trackingProviders).where(and(eq(trackingProviders.tenantId, TENANT_ALIGNMENT_SOURCE_ID), eq(trackingProviders.id, TENANT_ALIGNMENT_IDS.sourceTrackingProvider))),
    db.select().from(trackingProviders).where(and(eq(trackingProviders.tenantId, TENANT_ALIGNMENT_TARGET_ID), eq(trackingProviders.providerType, "TRACCAR"))),
    db.select().from(trackingDevices).where(and(eq(trackingDevices.tenantId, TENANT_ALIGNMENT_SOURCE_ID), inArray(trackingDevices.id, [TENANT_ALIGNMENT_IDS.sourceMobileDevice, TENANT_ALIGNMENT_IDS.sourceVehicleDevice]))),
    db.select().from(trackingDevices).where(and(eq(trackingDevices.tenantId, TENANT_ALIGNMENT_TARGET_ID), inArray(trackingDevices.id, [TENANT_ALIGNMENT_IDS.targetMobileDevice, TENANT_ALIGNMENT_IDS.targetVehicleDevice]))),
    db.select().from(geoLocations).where(and(eq(geoLocations.tenantId, TENANT_ALIGNMENT_TARGET_ID), inArray(geoLocations.id, [TENANT_ALIGNMENT_IDS.targetDragonaLocation, TENANT_ALIGNMENT_IDS.targetJobLocation]))),
    db.select().from(assetCustodyLocations).where(and(eq(assetCustodyLocations.tenantId, TENANT_ALIGNMENT_TARGET_ID), inArray(assetCustodyLocations.assetId, [TENANT_ALIGNMENT_IDS.targetFordTransit, TENANT_ALIGNMENT_IDS.targetMiniExcavator, TENANT_ALIGNMENT_IDS.targetIvecoDaily]))),
    db.select().from(tenantAlignmentRuns).where(eq(tenantAlignmentRuns.id, TENANT_ALIGNMENT_RUN_ID)),
    db.select().from(tenantAlignmentLinks).where(eq(tenantAlignmentLinks.runId, TENANT_ALIGNMENT_RUN_ID)),
  ]);

  return {
    tenantRows,
    sourceMembershipRows,
    targetMembershipRows,
    warehouseRows,
    sourceRecordRows,
    targetRecordRows,
    targetJobCodeRows,
    sourceInventoryRows,
    targetInventoryRows,
    sourceMovementRows,
    sourceJourneyRows,
    sourceScopeRows,
    sourcePreferenceRows,
    targetPreferenceRows,
    qrRows,
    sourceProviderRows,
    targetProviderRows,
    sourceDeviceRows,
    targetDeviceRows,
    targetLocationRows,
    targetCustodyRows,
    runRows,
    linkRows,
  };
}

function validateState(state: AlignmentState, manifestHash: string) {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const sourceTenant = one(state.tenantRows, (row) => row.id === TENANT_ALIGNMENT_SOURCE_ID);
  const targetTenant = one(state.tenantRows, (row) => row.id === TENANT_ALIGNMENT_TARGET_ID);
  const completedRun = state.runRows[0]?.status === "COMPLETED" ? state.runRows[0] : null;

  if (!sourceTenant) blockers.push("source_tenant_missing");
  if (!targetTenant) blockers.push("target_tenant_missing");
  if (targetTenant && targetTenant.status !== "active") blockers.push("target_tenant_not_active");
  if (sourceTenant && !["active", "archived"].includes(sourceTenant.status)) blockers.push("source_tenant_status_changed");
  if (state.runRows[0] && state.runRows[0].manifestHash !== manifestHash) blockers.push("alignment_run_manifest_mismatch");

  const expectedSourceRecords = [
    [TENANT_ALIGNMENT_IDS.sourceMiniExcavator, TENANT_ALIGNMENT_EXPECTED_UPDATED_AT.sourceMiniExcavator],
    [TENANT_ALIGNMENT_IDS.sourceFordTransit, TENANT_ALIGNMENT_EXPECTED_UPDATED_AT.sourceFordTransit],
    [TENANT_ALIGNMENT_IDS.sourceDriver, TENANT_ALIGNMENT_EXPECTED_UPDATED_AT.sourceDriver],
    [TENANT_ALIGNMENT_IDS.sourcePlaceholderJob, TENANT_ALIGNMENT_EXPECTED_UPDATED_AT.sourcePlaceholderJob],
    [TENANT_ALIGNMENT_IDS.sourceJob, TENANT_ALIGNMENT_EXPECTED_UPDATED_AT.sourceJob],
  ] as const;
  for (const [id, updatedAt] of expectedSourceRecords) {
    const row = one(state.sourceRecordRows, (record) => record.id === id);
    if (!row) blockers.push(`source_record_missing:${id}`);
    else if (row.updatedAt !== updatedAt) blockers.push(`source_record_changed:${id}`);
  }
  const sourceJobForPayload = one(state.sourceRecordRows, (record) => record.id === TENANT_ALIGNMENT_IDS.sourceJob);
  if (sourceJobForPayload && Object.keys(parseObject(sourceJobForPayload.payloadJson)).length === 0) blockers.push("source_job_payload_invalid");

  const sourceWarehouse = one(state.warehouseRows, (row) => row.id === TENANT_ALIGNMENT_IDS.sourcePomeziaWarehouse);
  const targetDragona = one(state.warehouseRows, (row) => row.id === TENANT_ALIGNMENT_IDS.targetDragonaWarehouse);
  const targetPomezia = one(state.warehouseRows, (row) => row.id === TENANT_ALIGNMENT_IDS.targetPomeziaWarehouse);
  if (!sourceWarehouse || sourceWarehouse.updatedAt !== TENANT_ALIGNMENT_EXPECTED_UPDATED_AT.sourceWarehouse) blockers.push("source_pomezia_warehouse_changed_or_missing");
  if (!targetDragona || targetDragona.status !== "active") blockers.push("target_dragona_warehouse_missing");
  if (!targetPomezia || targetPomezia.status !== "active") blockers.push("target_pomezia_warehouse_missing");
  if (!one(state.targetLocationRows, (row) => row.id === TENANT_ALIGNMENT_IDS.targetDragonaLocation && row.status === "ACTIVE")) blockers.push("target_dragona_location_missing");

  const targetMappings = [
    [TENANT_ALIGNMENT_IDS.targetFordTransit, "assets", "ASSET-0001"],
    [TENANT_ALIGNMENT_IDS.targetMiniExcavator, "assets", "ASSET-0002"],
    [TENANT_ALIGNMENT_IDS.targetIvecoDaily, "assets", "ASSET-0003"],
    [TENANT_ALIGNMENT_IDS.targetDriver, "workforce", "DRV-0001"],
  ] as const;
  for (const [id, module, canonicalCode] of targetMappings) {
    const row = one(state.targetRecordRows, (record) => record.id === id);
    if (!row || row.module !== module || row.canonicalCode !== canonicalCode) blockers.push(`target_mapping_missing:${id}`);
  }

  const sourceInventory = state.sourceInventoryRows[0];
  if (!sourceInventory || sourceInventory.updatedAt !== TENANT_ALIGNMENT_EXPECTED_UPDATED_AT.sourceInventoryItem || sourceInventory.sku !== TARGET_INVENTORY_SKU) blockers.push("source_inventory_changed_or_missing");
  if (!state.sourceMovementRows[0]) blockers.push("source_inventory_movement_missing");
  const existingInventory = state.targetInventoryRows[0];
  if (existingInventory && existingInventory.id !== TENANT_ALIGNMENT_IDS.targetInventoryItem) blockers.push("target_inventory_sku_collision");

  const sourceAttendance = state.sourceJourneyRows[0];
  if (!sourceAttendance || sourceAttendance.updatedAt !== TENANT_ALIGNMENT_EXPECTED_UPDATED_AT.sourceAttendance) blockers.push("source_attendance_changed_or_missing");
  else if (Object.keys(parseObject(sourceAttendance.payloadJson)).length === 0) blockers.push("source_attendance_payload_invalid");
  const sourceScope = state.sourceScopeRows[0];
  if (!sourceScope || sourceScope.updatedAt !== TENANT_ALIGNMENT_EXPECTED_UPDATED_AT.sourceCompanyAiScope) blockers.push("source_company_ai_scope_changed_or_missing");
  const sourcePreference = state.sourcePreferenceRows[0];
  if (!sourcePreference || sourcePreference.updatedAt !== TENANT_ALIGNMENT_EXPECTED_UPDATED_AT.sourceDashboardPreference) blockers.push("source_dashboard_preference_changed_or_missing");
  if (state.targetPreferenceRows.length) warnings.push("target_dashboard_preference_already_present_source_layout_will_not_overwrite");

  const sourceWrongQr = one(state.qrRows, (row) => row.id === TENANT_ALIGNMENT_IDS.sourceWrongQr);
  const targetChiusiniQr = one(state.qrRows, (row) => row.id === TENANT_ALIGNMENT_IDS.targetChiusiniQr);
  const targetInventoryQr = one(state.qrRows, (row) => row.id === TENANT_ALIGNMENT_IDS.targetInventoryQr);
  if (!sourceWrongQr || sourceWrongQr.payload !== WRONG_QR_PAYLOAD) blockers.push("legacy_qr_changed_or_missing");
  if (!targetChiusiniQr || targetChiusiniQr.payload !== CANONICAL_CHIUSINI_QR) blockers.push("canonical_chiusini_qr_missing");
  if (targetInventoryQr && (targetInventoryQr.payload !== TARGET_INVENTORY_QR || targetInventoryQr.entityType !== "material")) blockers.push("target_inventory_qr_id_collision");

  const sourceProvider = state.sourceProviderRows[0];
  if (!sourceProvider || sourceProvider.updatedAt !== TENANT_ALIGNMENT_EXPECTED_UPDATED_AT.sourceTrackingProvider) blockers.push("source_tracking_provider_changed_or_missing");
  const sourceDevices = new Map(state.sourceDeviceRows.map((row) => [row.id, row]));
  if (sourceDevices.get(TENANT_ALIGNMENT_IDS.sourceMobileDevice)?.updatedAt !== TENANT_ALIGNMENT_EXPECTED_UPDATED_AT.sourceMobileDevice) blockers.push("source_mobile_tracking_device_changed_or_missing");
  if (sourceDevices.get(TENANT_ALIGNMENT_IDS.sourceVehicleDevice)?.updatedAt !== TENANT_ALIGNMENT_EXPECTED_UPDATED_AT.sourceVehicleDevice) blockers.push("source_vehicle_tracking_device_changed_or_missing");
  if (state.targetProviderRows.length && state.targetProviderRows[0].id !== TENANT_ALIGNMENT_IDS.targetTrackingProvider) blockers.push("target_tracking_provider_collision");
  for (const device of state.targetDeviceRows) {
    const expectedExternalId = device.id === TENANT_ALIGNMENT_IDS.targetMobileDevice
      ? sourceDevices.get(TENANT_ALIGNMENT_IDS.sourceMobileDevice)?.externalDeviceId
      : device.id === TENANT_ALIGNMENT_IDS.targetVehicleDevice
        ? sourceDevices.get(TENANT_ALIGNMENT_IDS.sourceVehicleDevice)?.externalDeviceId
        : null;
    if (!expectedExternalId || device.externalDeviceId !== expectedExternalId || device.providerId !== TENANT_ALIGNMENT_IDS.targetTrackingProvider) blockers.push(`target_tracking_device_id_collision:${device.id}`);
  }

  const sourceMembershipIds = new Set(state.sourceMembershipRows.map((row) => row.id));
  if (!sourceMembershipIds.has(TENANT_ALIGNMENT_IDS.sourceSitesMembership)) blockers.push("source_sites_membership_missing");
  if (!sourceMembershipIds.has(TENANT_ALIGNMENT_IDS.sourceNeonMembership)) blockers.push("source_neon_membership_missing");
  if (!state.targetMembershipRows.some((row) => row.id === TENANT_ALIGNMENT_IDS.targetNeonMembership && row.status === "active")) blockers.push("target_neon_owner_missing");
  const targetSitesMembership = state.targetMembershipRows.find((row) => row.actorId === TENANT_ALIGNMENT_ACTORS.sitesOwner && row.identityProvider === "sites");
  if (targetSitesMembership && targetSitesMembership.id !== TENANT_ALIGNMENT_IDS.targetSitesMembership) blockers.push("target_sites_identity_collision");

  const clonedJob = one(state.targetRecordRows, (row) => row.id === TENANT_ALIGNMENT_IDS.targetJob);
  if (clonedJob && clonedJob.canonicalCode !== TARGET_JOB_CODE) blockers.push("target_cloned_job_id_collision");
  if (state.targetJobCodeRows.some((row) => row.id !== TENANT_ALIGNMENT_IDS.targetJob)) blockers.push("target_comm_0002_collision");

  if (completedRun) {
    if (sourceTenant?.status !== "archived") blockers.push("completed_run_source_not_archived");
    if (!targetSitesMembership || targetSitesMembership.status !== "active") blockers.push("completed_run_target_sites_membership_missing");
  }

  return { blockers: [...new Set(blockers)], warnings, completedRun };
}

export async function getTenantAlignmentDryRun(): Promise<TenantAlignmentDryRun> {
  await ensureTenantAlignmentSchema();
  const [state, manifestHash] = await Promise.all([readAlignmentState(), tenantAlignmentManifestHash()]);
  const { blockers, warnings, completedRun } = validateState(state, manifestHash);
  return {
    contractVersion: TENANT_ALIGNMENT_CONTRACT_VERSION,
    runId: TENANT_ALIGNMENT_RUN_ID,
    sourceTenantId: TENANT_ALIGNMENT_SOURCE_ID,
    targetTenantId: TENANT_ALIGNMENT_TARGET_ID,
    manifestHash,
    status: completedRun && blockers.length === 0 ? "APPLIED" : blockers.length ? "BLOCKED" : "READY",
    generatedAt: new Date().toISOString(),
    writeOperations: completedRun ? 0 : PLANNED_WRITE_GROUPS + (state.targetPreferenceRows.length ? 0 : 1),
    blockers,
    warnings,
    decisions: TENANT_ALIGNMENT_MANIFEST.collisions,
    preservation: {
      sourceRowsDeleted: false,
      historicalEventStreamsCopied: false,
      sourceArchivedAfterReadback: true,
      logicalRollback: TENANT_ALIGNMENT_MANIFEST.archivePolicy.rollback,
    },
    expectedResult: {
      activeTenantRoots: 1,
      clonedRecords: state.targetPreferenceRows.length ? 9 : 10,
      matchedRecords: 4,
      provenanceLinks: 16,
      canonicalAssetCustodyRows: 3,
    },
  };
}

export class TenantAlignmentBlockedError extends Error {
  constructor(readonly dryRun: TenantAlignmentDryRun) {
    super("tenant_alignment_blocked");
  }
}

type LinkInput = {
  sourceRegistry: string;
  sourceId: string;
  targetRegistry: string;
  targetId: string | null;
  resolution: string;
  metadata?: JsonObject;
};

function linkRows(now: string): Array<typeof tenantAlignmentLinks.$inferInsert> {
  const values: LinkInput[] = [
    { sourceRegistry: "tenants", sourceId: TENANT_ALIGNMENT_SOURCE_ID, targetRegistry: "tenants", targetId: TENANT_ALIGNMENT_TARGET_ID, resolution: "CANONICAL_TENANT_SELECTED" },
    { sourceRegistry: "tenant_memberships", sourceId: TENANT_ALIGNMENT_IDS.sourceSitesMembership, targetRegistry: "tenant_memberships", targetId: TENANT_ALIGNMENT_IDS.targetSitesMembership, resolution: "IDENTITY_LINK_OWNER_ONLY" },
    { sourceRegistry: "tenant_memberships", sourceId: TENANT_ALIGNMENT_IDS.sourceNeonMembership, targetRegistry: "tenant_memberships", targetId: TENANT_ALIGNMENT_IDS.targetNeonMembership, resolution: "IDENTITY_LINK_ROLES_NOT_UNIONED" },
    { sourceRegistry: "tenant_warehouses", sourceId: TENANT_ALIGNMENT_IDS.sourcePomeziaWarehouse, targetRegistry: "tenant_warehouses", targetId: TENANT_ALIGNMENT_IDS.targetPomeziaWarehouse, resolution: "MATCH_PHYSICAL_PLACE_TARGET_VERIFIED_WINS" },
    { sourceRegistry: "s04_records", sourceId: TENANT_ALIGNMENT_IDS.sourceMiniExcavator, targetRegistry: "s04_records", targetId: TENANT_ALIGNMENT_IDS.targetMiniExcavator, resolution: "MATCH_PHYSICAL_ASSET" },
    { sourceRegistry: "s04_records", sourceId: TENANT_ALIGNMENT_IDS.sourceFordTransit, targetRegistry: "s04_records", targetId: TENANT_ALIGNMENT_IDS.targetFordTransit, resolution: "MATCH_PHYSICAL_VEHICLE" },
    { sourceRegistry: "s04_records", sourceId: TENANT_ALIGNMENT_IDS.sourceDriver, targetRegistry: "s04_records", targetId: TENANT_ALIGNMENT_IDS.targetDriver, resolution: "MATCH_PERSON_ROLE_NOT_UNIONED" },
    { sourceRegistry: "s04_records", sourceId: TENANT_ALIGNMENT_IDS.sourcePlaceholderJob, targetRegistry: "none", targetId: null, resolution: "ARCHIVED_PLACEHOLDER" },
    { sourceRegistry: "s04_records", sourceId: TENANT_ALIGNMENT_IDS.sourceJob, targetRegistry: "s04_records", targetId: TENANT_ALIGNMENT_IDS.targetJob, resolution: "COPIED_REKEYED_COMM_0002" },
    { sourceRegistry: "inventory_items", sourceId: TENANT_ALIGNMENT_IDS.sourceInventoryItem, targetRegistry: "inventory_items", targetId: TENANT_ALIGNMENT_IDS.targetInventoryItem, resolution: "COPIED_TO_MATCHED_POMEZIA_WAREHOUSE" },
    { sourceRegistry: "inventory_movements", sourceId: TENANT_ALIGNMENT_IDS.sourceInventoryMovement, targetRegistry: "inventory_movements", targetId: TENANT_ALIGNMENT_IDS.targetInventoryMovement, resolution: "COPIED_OPENING_LEDGER" },
    { sourceRegistry: "job_journey_records", sourceId: TENANT_ALIGNMENT_IDS.sourceAttendance, targetRegistry: "job_journey_records", targetId: TENANT_ALIGNMENT_IDS.targetAttendance, resolution: "COPIED_HISTORICAL_ATTENDANCE" },
    { sourceRegistry: "company_ai_job_scopes", sourceId: TENANT_ALIGNMENT_IDS.sourceCompanyAiScope, targetRegistry: "company_ai_job_scopes", targetId: TENANT_ALIGNMENT_IDS.targetCompanyAiScope, resolution: "COPIED_WITH_JOB_REKEY" },
    { sourceRegistry: "qr_codes", sourceId: TENANT_ALIGNMENT_IDS.sourceWrongQr, targetRegistry: "qr_codes", targetId: TENANT_ALIGNMENT_IDS.targetChiusiniQr, resolution: "ALIAS_TO_CANONICAL_MATERIAL", metadata: { aliasPayload: WRONG_QR_PAYLOAD, canonicalPayload: CANONICAL_CHIUSINI_QR } },
    { sourceRegistry: "tracking_providers", sourceId: TENANT_ALIGNMENT_IDS.sourceTrackingProvider, targetRegistry: "tracking_providers", targetId: TENANT_ALIGNMENT_IDS.targetTrackingProvider, resolution: "COPIED_PROVIDER_CONFIGURATION" },
    { sourceRegistry: "command_dashboard_preferences", sourceId: TENANT_ALIGNMENT_IDS.sourceDashboardPreference, targetRegistry: "command_dashboard_preferences", targetId: TENANT_ALIGNMENT_IDS.targetDashboardPreference, resolution: "COPY_IF_TARGET_EMPTY" },
  ];
  return values.map((value) => ({
    id: alignmentLinkId(value.sourceRegistry, value.sourceId),
    runId: TENANT_ALIGNMENT_RUN_ID,
    sourceTenantId: TENANT_ALIGNMENT_SOURCE_ID,
    sourceRegistry: value.sourceRegistry,
    sourceId: value.sourceId,
    targetTenantId: TENANT_ALIGNMENT_TARGET_ID,
    targetRegistry: value.targetRegistry,
    targetId: value.targetId,
    resolution: value.resolution,
    metadataJson: JSON.stringify(value.metadata ?? {}),
    createdAt: now,
  }));
}

function executionReadback(state: AlignmentState, manifestHash: string, idempotent: boolean): TenantAlignmentExecutionResult {
  const sourceTenant = one(state.tenantRows, (row) => row.id === TENANT_ALIGNMENT_SOURCE_ID);
  const targetTenant = one(state.tenantRows, (row) => row.id === TENANT_ALIGNMENT_TARGET_ID);
  const targetSitesMembership = state.targetMembershipRows.find((row) => row.id === TENANT_ALIGNMENT_IDS.targetSitesMembership);
  const run = state.runRows[0];
  return {
    status: "COMPLETED",
    idempotent,
    runId: TENANT_ALIGNMENT_RUN_ID,
    manifestHash,
    sourceTenantStatus: sourceTenant?.status ?? "missing",
    targetTenantStatus: targetTenant?.status ?? "missing",
    targetSitesMembershipStatus: targetSitesMembership?.status ?? "missing",
    linkCount: state.linkRows.length,
    clonedJobCode: TARGET_JOB_CODE,
    clonedInventorySku: TARGET_INVENTORY_SKU,
    custodyCount: state.targetCustodyRows.length,
    completedAt: run?.completedAt ?? run?.updatedAt ?? new Date().toISOString(),
    rollback: TENANT_ALIGNMENT_MANIFEST.archivePolicy.rollback,
  };
}

export async function executeTenantAlignment(approvedBy: string = TENANT_ALIGNMENT_ACTORS.sitesOwner): Promise<TenantAlignmentExecutionResult> {
  await ensureTenantAlignmentSchema();
  const [before, manifestHash] = await Promise.all([readAlignmentState(), tenantAlignmentManifestHash()]);
  const validation = validateState(before, manifestHash);
  if (validation.completedRun && validation.blockers.length === 0) return executionReadback(before, manifestHash, true);
  const dryRun = await getTenantAlignmentDryRun();
  if (dryRun.status !== "READY") throw new TenantAlignmentBlockedError(dryRun);

  const sourceJob = one(before.sourceRecordRows, (row) => row.id === TENANT_ALIGNMENT_IDS.sourceJob)!;
  const sourceInventory = before.sourceInventoryRows[0]!;
  const sourceMovement = before.sourceMovementRows[0]!;
  const sourceAttendance = before.sourceJourneyRows[0]!;
  const sourceScope = before.sourceScopeRows[0]!;
  const sourcePreference = before.sourcePreferenceRows[0]!;
  const sourceProvider = before.sourceProviderRows[0]!;
  const sourceMobileDevice = one(before.sourceDeviceRows, (row) => row.id === TENANT_ALIGNMENT_IDS.sourceMobileDevice)!;
  const sourceVehicleDevice = one(before.sourceDeviceRows, (row) => row.id === TENANT_ALIGNMENT_IDS.sourceVehicleDevice)!;
  const sourceSitesMembership = one(before.sourceMembershipRows, (row) => row.id === TENANT_ALIGNMENT_IDS.sourceSitesMembership)!;
  const dragonaWarehouse = one(before.warehouseRows, (row) => row.id === TENANT_ALIGNMENT_IDS.targetDragonaWarehouse)!;
  const dragonaLocation = one(before.targetLocationRows, (row) => row.id === TENANT_ALIGNMENT_IDS.targetDragonaLocation)!;
  const now = new Date().toISOString();
  const db = getDb();

  const replacements = new Map<string, string>([
    [TENANT_ALIGNMENT_SOURCE_ID, TENANT_ALIGNMENT_TARGET_ID],
    [TENANT_ALIGNMENT_IDS.sourceJob, TENANT_ALIGNMENT_IDS.targetJob],
    [TENANT_ALIGNMENT_IDS.sourcePomeziaWarehouse, TENANT_ALIGNMENT_IDS.targetPomeziaWarehouse],
    [TENANT_ALIGNMENT_IDS.sourceSitesMembership, TENANT_ALIGNMENT_IDS.targetSitesMembership],
    [TENANT_ALIGNMENT_IDS.sourceDriver, TENANT_ALIGNMENT_IDS.targetDriver],
  ]);
  const sourceJobPayload = parseObject(sourceJob.payloadJson);
  const jobPayload = {
    ...(rewritten(sourceJobPayload, replacements) as JsonObject),
    naming: { canonicalCode: TARGET_JOB_CODE, sequence: 2, namespace: "operations", source: "approved-tenant-alignment" },
    idempotencyKey: `tenant-alignment:${TENANT_ALIGNMENT_RUN_ID}:job`,
    worksiteLocation: {
      id: TENANT_ALIGNMENT_IDS.targetJobLocation,
      status: "SERVER_VERIFIED",
      formattedAddress: dragonaLocation.formattedAddress,
      latitude: dragonaLocation.latitudeE6 / 1_000_000,
      longitude: dragonaLocation.longitudeE6 / 1_000_000,
      provider: "APPROVED_ALIGNMENT",
      evidence: "legacy-address-plus-attendance-coordinates",
    },
    alignment: { runId: TENANT_ALIGNMENT_RUN_ID, sourceId: sourceJob.id, copiedAt: now },
    source: "tenant-alignment-v1",
  };
  const attendancePayload = {
    ...(rewritten(parseObject(sourceAttendance.payloadJson), replacements) as JsonObject),
    alignment: { runId: TENANT_ALIGNMENT_RUN_ID, sourceId: sourceAttendance.id, historical: true },
  };
  const targetPreferenceExists = before.targetPreferenceRows.length > 0;
  const links = linkRows(now).map((row) => targetPreferenceExists && row.sourceId === TENANT_ALIGNMENT_IDS.sourceDashboardPreference
    ? { ...row, targetId: before.targetPreferenceRows[0].id, resolution: "TARGET_PREFERENCE_PRESERVED" }
    : row);
  const resultSummary = {
    cloned: [TENANT_ALIGNMENT_IDS.targetJob, TENANT_ALIGNMENT_IDS.targetAttendance, TENANT_ALIGNMENT_IDS.targetCompanyAiScope, TENANT_ALIGNMENT_IDS.targetInventoryItem, TENANT_ALIGNMENT_IDS.targetInventoryMovement, TENANT_ALIGNMENT_IDS.targetInventoryQr, TENANT_ALIGNMENT_IDS.targetTrackingProvider, TENANT_ALIGNMENT_IDS.targetMobileDevice, TENANT_ALIGNMENT_IDS.targetVehicleDevice],
    matched: [TENANT_ALIGNMENT_IDS.targetPomeziaWarehouse, TENANT_ALIGNMENT_IDS.targetFordTransit, TENANT_ALIGNMENT_IDS.targetMiniExcavator, TENANT_ALIGNMENT_IDS.targetDriver],
    sourceArchived: true,
    historicalStreamsRetained: true,
    sourceRowsDeleted: false,
    rollback: TENANT_ALIGNMENT_MANIFEST.archivePolicy.rollback,
  };

  const statements: BatchItem<"sqlite">[] = [
    db.insert(tenantMemberships).values({
      id: TENANT_ALIGNMENT_IDS.targetSitesMembership,
      tenantId: TENANT_ALIGNMENT_TARGET_ID,
      identityProvider: "sites",
      actorId: TENANT_ALIGNMENT_ACTORS.sitesOwner,
      actorEmail: sourceSitesMembership.actorEmail,
      displayName: sourceSitesMembership.displayName,
      role: "owner",
      rolesJson: '["owner"]',
      status: "active",
      version: 1,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing(),
    db.insert(s04Records).values({
      id: TENANT_ALIGNMENT_IDS.targetJob,
      tenantId: TENANT_ALIGNMENT_TARGET_ID,
      module: "operations",
      canonicalCode: TARGET_JOB_CODE,
      recordType: sourceJob.recordType,
      title: TARGET_JOB_CODE,
      detail: sourceJob.detail,
      meta: sourceJob.meta,
      status: sourceJob.status,
      tone: sourceJob.tone,
      progress: sourceJob.progress,
      payloadJson: JSON.stringify(jobPayload),
      createdBy: TENANT_ALIGNMENT_ACTORS.sitesOwner,
      createdAt: sourceJob.createdAt,
      updatedAt: now,
    }).onConflictDoNothing(),
    db.insert(geoLocations).values({
      id: TENANT_ALIGNMENT_IDS.targetJobLocation,
      tenantId: TENANT_ALIGNMENT_TARGET_ID,
      entityType: "CANTIERE",
      entityId: TENANT_ALIGNMENT_IDS.targetJob,
      formattedAddress: dragonaLocation.formattedAddress,
      street: dragonaLocation.street,
      streetNumber: dragonaLocation.streetNumber,
      city: dragonaLocation.city,
      province: dragonaLocation.province,
      postalCode: dragonaLocation.postalCode,
      country: dragonaLocation.country,
      latitudeE6: dragonaLocation.latitudeE6,
      longitudeE6: dragonaLocation.longitudeE6,
      provider: "APPROVED_ALIGNMENT",
      providerPlaceId: dragonaLocation.providerPlaceId,
      geocodeConfidenceMilli: dragonaLocation.geocodeConfidenceMilli,
      verifiedByUser: 1,
      verifiedAt: now,
      status: "ACTIVE",
      version: 1,
      idempotencyKey: `tenant-alignment:${TENANT_ALIGNMENT_RUN_ID}:job-location`,
      createdBy: approvedBy,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing(),
    db.insert(geofences).values({
      id: TENANT_ALIGNMENT_IDS.targetJobGeofence,
      tenantId: TENANT_ALIGNMENT_TARGET_ID,
      locationId: TENANT_ALIGNMENT_IDS.targetJobLocation,
      entityType: "CANTIERE",
      entityId: TENANT_ALIGNMENT_IDS.targetJob,
      name: `${TARGET_JOB_CODE} · Cantiere`,
      shapeType: "CIRCLE",
      centerLatitudeE6: dragonaLocation.latitudeE6,
      centerLongitudeE6: dragonaLocation.longitudeE6,
      radiusMeters: TENANT_ALIGNMENT_MANIFEST.locationPolicy.geofenceRadiusMeters,
      polygonJson: "[]",
      status: "ACTIVE",
      version: 1,
      createdBy: approvedBy,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing(),
    db.insert(jobJourneyRecords).values({
      ...sourceAttendance,
      id: TENANT_ALIGNMENT_IDS.targetAttendance,
      tenantId: TENANT_ALIGNMENT_TARGET_ID,
      jobId: TENANT_ALIGNMENT_IDS.targetJob,
      payloadJson: JSON.stringify(attendancePayload),
      idempotencyKey: `tenant-alignment:${TENANT_ALIGNMENT_RUN_ID}:attendance`,
      createdBy: TENANT_ALIGNMENT_ACTORS.sitesOwner,
      updatedBy: TENANT_ALIGNMENT_ACTORS.sitesOwner,
    }).onConflictDoNothing(),
    db.insert(companyAiJobScopes).values({
      ...sourceScope,
      id: TENANT_ALIGNMENT_IDS.targetCompanyAiScope,
      tenantId: TENANT_ALIGNMENT_TARGET_ID,
      jobId: TENANT_ALIGNMENT_IDS.targetJob,
      jobCode: TARGET_JOB_CODE,
      idempotencyKey: `tenant-alignment:${TENANT_ALIGNMENT_RUN_ID}:company-ai-scope`,
      createdBy: TENANT_ALIGNMENT_ACTORS.sitesOwner,
      updatedAt: now,
    }).onConflictDoNothing(),
    db.insert(inventoryItems).values({
      ...sourceInventory,
      id: TENANT_ALIGNMENT_IDS.targetInventoryItem,
      tenantId: TENANT_ALIGNMENT_TARGET_ID,
      warehouseId: TENANT_ALIGNMENT_IDS.targetPomeziaWarehouse,
      qrCode: TARGET_INVENTORY_QR,
      createdBy: TENANT_ALIGNMENT_ACTORS.targetOwner,
      updatedAt: now,
    }).onConflictDoNothing(),
    db.insert(inventoryMovements).values({
      ...sourceMovement,
      id: TENANT_ALIGNMENT_IDS.targetInventoryMovement,
      tenantId: TENANT_ALIGNMENT_TARGET_ID,
      itemId: TENANT_ALIGNMENT_IDS.targetInventoryItem,
      idempotencyKey: `tenant-alignment:${TENANT_ALIGNMENT_RUN_ID}:inventory-opening`,
      actorId: TENANT_ALIGNMENT_ACTORS.targetOwner,
    }).onConflictDoNothing(),
    db.insert(qrCodes).values({
      id: TENANT_ALIGNMENT_IDS.targetInventoryQr,
      tenantId: TENANT_ALIGNMENT_TARGET_ID,
      format: "QR",
      entityType: "material",
      entityId: TARGET_INVENTORY_SKU,
      label: sourceInventory.name,
      payload: TARGET_INVENTORY_QR,
      createdBy: TENANT_ALIGNMENT_ACTORS.targetOwner,
      createdAt: now,
      updatedAt: now,
      lastScannedAt: null,
    }).onConflictDoNothing(),
    db.insert(qrCodeAliases).values({
      id: TENANT_ALIGNMENT_IDS.targetWrongQrAlias,
      tenantId: TENANT_ALIGNMENT_TARGET_ID,
      aliasPayload: WRONG_QR_PAYLOAD,
      canonicalPayload: CANONICAL_CHIUSINI_QR,
      sourceTenantId: TENANT_ALIGNMENT_SOURCE_ID,
      reason: "Legacy QR classified a material as warehouse; owner-approved alias to canonical material.",
      status: "ACTIVE",
      createdBy: approvedBy,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing(),
    db.insert(trackingProviders).values({
      ...sourceProvider,
      id: TENANT_ALIGNMENT_IDS.targetTrackingProvider,
      tenantId: TENANT_ALIGNMENT_TARGET_ID,
      createdBy: TENANT_ALIGNMENT_ACTORS.targetOwner,
      updatedAt: now,
    }).onConflictDoNothing(),
    db.insert(trackingDevices).values([
      {
        ...sourceMobileDevice,
        id: TENANT_ALIGNMENT_IDS.targetMobileDevice,
        tenantId: TENANT_ALIGNMENT_TARGET_ID,
        providerId: TENANT_ALIGNMENT_IDS.targetTrackingProvider,
        createdBy: TENANT_ALIGNMENT_ACTORS.targetOwner,
        updatedAt: now,
      },
      {
        ...sourceVehicleDevice,
        id: TENANT_ALIGNMENT_IDS.targetVehicleDevice,
        tenantId: TENANT_ALIGNMENT_TARGET_ID,
        providerId: TENANT_ALIGNMENT_IDS.targetTrackingProvider,
        createdBy: TENANT_ALIGNMENT_ACTORS.targetOwner,
        updatedAt: now,
      },
    ]).onConflictDoNothing(),
    db.insert(assetCustodyLocations).values([
      { id: TENANT_ALIGNMENT_IDS.custodyFordTransit, tenantId: TENANT_ALIGNMENT_TARGET_ID, assetId: TENANT_ALIGNMENT_IDS.targetFordTransit, warehouseId: dragonaWarehouse.id, locationId: dragonaLocation.id, status: "AT_WAREHOUSE", source: "TENANT_ALIGNMENT", version: 1, effectiveAt: now, createdBy: approvedBy, createdAt: now, updatedAt: now },
      { id: TENANT_ALIGNMENT_IDS.custodyMiniExcavator, tenantId: TENANT_ALIGNMENT_TARGET_ID, assetId: TENANT_ALIGNMENT_IDS.targetMiniExcavator, warehouseId: dragonaWarehouse.id, locationId: dragonaLocation.id, status: "AT_WAREHOUSE", source: "TENANT_ALIGNMENT", version: 1, effectiveAt: now, createdBy: approvedBy, createdAt: now, updatedAt: now },
      { id: TENANT_ALIGNMENT_IDS.custodyIvecoDaily, tenantId: TENANT_ALIGNMENT_TARGET_ID, assetId: TENANT_ALIGNMENT_IDS.targetIvecoDaily, warehouseId: dragonaWarehouse.id, locationId: dragonaLocation.id, status: "AT_WAREHOUSE", source: "TENANT_ALIGNMENT", version: 1, effectiveAt: now, createdBy: approvedBy, createdAt: now, updatedAt: now },
    ]).onConflictDoNothing(),
    db.insert(entityCodeCounters).values({ tenantId: TENANT_ALIGNMENT_TARGET_ID, namespace: "operations", lastValue: 2, updatedAt: now })
      .onConflictDoUpdate({ target: [entityCodeCounters.tenantId, entityCodeCounters.namespace], set: { lastValue: sql`MAX(${entityCodeCounters.lastValue}, 2)`, updatedAt: now } }),
    db.insert(entityCodeCounters).values({ tenantId: TENANT_ALIGNMENT_TARGET_ID, namespace: `materials:${TARGET_INVENTORY_SKU}`, lastValue: 1, updatedAt: now })
      .onConflictDoUpdate({ target: [entityCodeCounters.tenantId, entityCodeCounters.namespace], set: { lastValue: sql`MAX(${entityCodeCounters.lastValue}, 1)`, updatedAt: now } }),
    db.insert(tenantAlignmentRuns).values({
      id: TENANT_ALIGNMENT_RUN_ID,
      sourceTenantId: TENANT_ALIGNMENT_SOURCE_ID,
      targetTenantId: TENANT_ALIGNMENT_TARGET_ID,
      contractVersion: TENANT_ALIGNMENT_CONTRACT_VERSION,
      manifestHash,
      status: "COMPLETED",
      dryRunJson: JSON.stringify(dryRun),
      resultJson: JSON.stringify(resultSummary),
      approvedBy,
      approvalSource: TENANT_ALIGNMENT_MANIFEST.approval.source,
      createdAt: now,
      updatedAt: now,
      completedAt: now,
    }).onConflictDoNothing(),
    ...links.map((link) => db.insert(tenantAlignmentLinks).values(link).onConflictDoNothing()),
    db.insert(s06Events).values({
      eventId: TENANT_ALIGNMENT_IDS.event,
      tenantId: TENANT_ALIGNMENT_TARGET_ID,
      eventType: "tenant.alignment.completed",
      schemaVersion: "1",
      actorType: "human-approved-system-execution",
      actorId: approvedBy,
      source: "sites-tenant-alignment",
      occurredAt: now,
      observedAt: now,
      aggregateType: "tenant.alignment",
      aggregateId: TENANT_ALIGNMENT_RUN_ID,
      aggregateVersion: 1,
      payloadJson: JSON.stringify({ manifestHash, sourceTenantId: TENANT_ALIGNMENT_SOURCE_ID, targetTenantId: TENANT_ALIGNMENT_TARGET_ID, result: resultSummary }),
      correlationId: TENANT_ALIGNMENT_RUN_ID,
      causationId: null,
      idempotencyKey: `tenant-alignment:${TENANT_ALIGNMENT_RUN_ID}:completed`,
      status: "COMMITTED_SITES_READBACK",
      createdAt: now,
    }).onConflictDoNothing(),
    db.insert(s06Outbox).values({
      id: TENANT_ALIGNMENT_IDS.outbox,
      tenantId: TENANT_ALIGNMENT_TARGET_ID,
      eventId: TENANT_ALIGNMENT_IDS.event,
      topic: "zerow.tenant.alignment.completed",
      status: "PENDING_EXTERNAL_CONSUMER",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing(),
    db.insert(s06Reconciliations).values({
      id: TENANT_ALIGNMENT_IDS.reconciliation,
      tenantId: TENANT_ALIGNMENT_TARGET_ID,
      aggregateType: "tenant.alignment",
      aggregateId: TENANT_ALIGNMENT_RUN_ID,
      expectedVersion: 1,
      observedVersion: 1,
      status: "SITES_READBACK_VERIFIED",
      detail: "Tenant operativo selezionato, record canonici riletti e radice legacy archiviata senza cancellazioni.",
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing(),
    db.insert(s07AiLedger).values({
      id: TENANT_ALIGNMENT_IDS.aiLedger,
      tenantId: TENANT_ALIGNMENT_TARGET_ID,
      entryType: "approved_system_alignment",
      actionType: "tenant.reconcile",
      command: "Riallinea radice Sites legacy al tenant operativo approvato",
      status: "EXECUTED_SERVER_READBACK",
      approvalRequired: 1,
      relatedActionId: TENANT_ALIGNMENT_RUN_ID,
      payloadJson: JSON.stringify({ manifestHash, directWrite: true, boundedContract: TENANT_ALIGNMENT_CONTRACT_VERSION }),
      requestedBy: approvedBy,
      approvedBy,
      readbackJson: JSON.stringify({ status: "SITES_READBACK_VERIFIED", sourceRowsDeleted: false }),
      createdAt: now,
    }).onConflictDoNothing(),
    db.update(tenantMemberships).set({ status: "removed", version: sql`${tenantMemberships.version} + 1`, updatedAt: now }).where(eq(tenantMemberships.tenantId, TENANT_ALIGNMENT_SOURCE_ID)),
    db.update(tenants).set({ status: "archived", updatedAt: now }).where(eq(tenants.id, TENANT_ALIGNMENT_SOURCE_ID)),
  ];
  if (!targetPreferenceExists) {
    statements.splice(9, 0, db.insert(commandDashboardPreferences).values({
      id: TENANT_ALIGNMENT_IDS.targetDashboardPreference,
      tenantId: TENANT_ALIGNMENT_TARGET_ID,
      actorId: TENANT_ALIGNMENT_ACTORS.targetOwner,
      schemaVersion: sourcePreference.schemaVersion,
      layoutJson: sourcePreference.layoutJson,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing());
  }

  await db.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);

  const after = await readAlignmentState();
  const afterValidation = validateState(after, manifestHash);
  const expectedLinkCount = links.length;
  const readbackOk = after.runRows[0]?.status === "COMPLETED"
    && one(after.tenantRows, (row) => row.id === TENANT_ALIGNMENT_SOURCE_ID)?.status === "archived"
    && one(after.tenantRows, (row) => row.id === TENANT_ALIGNMENT_TARGET_ID)?.status === "active"
    && after.targetMembershipRows.some((row) => row.id === TENANT_ALIGNMENT_IDS.targetSitesMembership && row.status === "active" && row.rolesJson === '["owner"]')
    && after.targetRecordRows.some((row) => row.id === TENANT_ALIGNMENT_IDS.targetJob && row.canonicalCode === TARGET_JOB_CODE)
    && after.targetInventoryRows.some((row) => row.id === TENANT_ALIGNMENT_IDS.targetInventoryItem)
    && after.targetCustodyRows.length === 3
    && after.linkRows.length === expectedLinkCount
    && afterValidation.blockers.length === 0;
  if (!readbackOk) throw new Error(`tenant_alignment_readback_failed:${afterValidation.blockers.join(",")}`);
  return executionReadback(after, manifestHash, false);
}
