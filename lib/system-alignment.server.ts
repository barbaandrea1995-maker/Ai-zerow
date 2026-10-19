import { asc, eq, inArray, or } from "drizzle-orm";
import { getDb } from "@/db";
import { ensureFinanceDocumentSchema } from "@/lib/finance-document-schema.server";
import {
  assetCustodyLocations,
  companyAiJobScopes,
  financeDocuments,
  geoLocations,
  geofences,
  inventoryItems,
  inventoryMovements,
  jobJourneyRecords,
  operationalDocuments,
  qrCodes,
  routePlans,
  routeStops,
  s04Records,
  s05Records,
  s06Events,
  s06Outbox,
  s06Reconciliations,
  s07AiLedger,
  tenantAlignmentLinks,
  tenantAlignmentRuns,
  tenantMemberships,
  tenantWarehouses,
  tenants,
  trackingSessions,
  w10Workflows,
} from "@/db/schema";
import { inferRawCode } from "@/lib/qr-adapter";
import { buildSystemAlignmentReport, type AlignmentSnapshot } from "@/lib/system-alignment";
import {
  TENANT_ALIGNMENT_CONTRACT_VERSION,
  TENANT_ALIGNMENT_RUN_ID,
  TENANT_ALIGNMENT_SOURCE_ID,
  TENANT_ALIGNMENT_TARGET_ID,
  tenantAlignmentManifestHash,
} from "@/lib/tenant-alignment-contract";

const AUDIT_ROW_LIMIT = 5_001;

function parseAlignmentResult(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function arrayLength(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

export async function getSystemAlignmentReport() {
  await ensureFinanceDocumentSchema();
  const db = getDb();
  const [tenantRows, alignmentRunRows, alignmentLinkRows, alignmentTenantRows, expectedManifestHash] = await Promise.all([
    db.select({
      id: tenants.id,
      slug: tenants.slug,
      name: tenants.name,
      status: tenants.status,
      legalForm: tenants.legalForm,
      vatNumber: tenants.vatNumber,
      taxCode: tenants.taxCode,
      registeredAddress: tenants.registeredAddress,
      registeredCity: tenants.registeredCity,
      businessEmail: tenants.businessEmail,
      businessPhone: tenants.businessPhone,
      operatingTransportModesJson: tenants.operatingTransportModesJson,
    }).from(tenants)
      .where(or(eq(tenants.status, "active"), eq(tenants.status, "onboarding")))
      .orderBy(asc(tenants.createdAt)),
    db.select({
      id: tenantAlignmentRuns.id,
      sourceTenantId: tenantAlignmentRuns.sourceTenantId,
      targetTenantId: tenantAlignmentRuns.targetTenantId,
      contractVersion: tenantAlignmentRuns.contractVersion,
      manifestHash: tenantAlignmentRuns.manifestHash,
      status: tenantAlignmentRuns.status,
      resultJson: tenantAlignmentRuns.resultJson,
      completedAt: tenantAlignmentRuns.completedAt,
    }).from(tenantAlignmentRuns).where(eq(tenantAlignmentRuns.id, TENANT_ALIGNMENT_RUN_ID)).limit(1),
    db.select({ id: tenantAlignmentLinks.id })
      .from(tenantAlignmentLinks)
      .where(eq(tenantAlignmentLinks.runId, TENANT_ALIGNMENT_RUN_ID))
      .limit(AUDIT_ROW_LIMIT),
    db.select({ id: tenants.id, status: tenants.status })
      .from(tenants)
      .where(inArray(tenants.id, [TENANT_ALIGNMENT_SOURCE_ID, TENANT_ALIGNMENT_TARGET_ID])),
    tenantAlignmentManifestHash(),
  ]);

  const alignmentRun = alignmentRunRows[0];
  const alignmentResult = alignmentRun ? parseAlignmentResult(alignmentRun.resultJson) : {};
  const tenantStatus = new Map(alignmentTenantRows.map((tenant) => [tenant.id, tenant.status]));
  const execution = alignmentRun ? {
    runId: alignmentRun.id,
    contractVersion: alignmentRun.contractVersion,
    manifestHash: alignmentRun.manifestHash,
    status: alignmentRun.status,
    sourceTenantId: alignmentRun.sourceTenantId,
    targetTenantId: alignmentRun.targetTenantId,
    sourceTenantStatus: tenantStatus.get(alignmentRun.sourceTenantId) ?? null,
    targetTenantStatus: tenantStatus.get(alignmentRun.targetTenantId) ?? null,
    completedAt: alignmentRun.completedAt,
    linkCount: alignmentLinkRows.length,
    clonedRecords: arrayLength(alignmentResult.cloned),
    matchedRecords: arrayLength(alignmentResult.matched),
    sourceArchived: alignmentResult.sourceArchived === true,
    historicalStreamsRetained: alignmentResult.historicalStreamsRetained === true,
    sourceRowsDeleted: typeof alignmentResult.sourceRowsDeleted === "boolean" ? alignmentResult.sourceRowsDeleted : null,
    rollback: typeof alignmentResult.rollback === "string" ? alignmentResult.rollback : null,
    contractVerified: alignmentRun.contractVersion === TENANT_ALIGNMENT_CONTRACT_VERSION
      && alignmentRun.sourceTenantId === TENANT_ALIGNMENT_SOURCE_ID
      && alignmentRun.targetTenantId === TENANT_ALIGNMENT_TARGET_ID,
    manifestVerified: alignmentRun.manifestHash === expectedManifestHash,
  } : null;

  const tenantIds = tenantRows.map((tenant) => tenant.id);
  const resolverProbe = {
    rawAssetCodeSupported: inferRawCode("ASSET-0001")?.entityId === "ASSET-0001",
    mixedCaseEntityIdPreserved: inferRawCode("AZ1|MATERIAL|CHIUS-GHIS-50x50")?.entityId === "CHIUS-GHIS-50x50",
  };
  if (tenantIds.length === 0) {
    return buildSystemAlignmentReport({
      tenants: [], memberships: [], warehouses: [], records: [], journeys: [], inventoryItems: [], inventoryMovements: [],
      qrs: [], locations: [], assetCustody: [], geofences: [], routePlans: [], routeStops: [], events: [], outbox: [], reconciliations: [],
      aiLedger: [], documents: [], domainRecords: [], workflows: [], trackingSessions: [], companyAiScopes: [], resolverProbe, execution, truncated: false,
    });
  }

  const [
    memberships,
    warehouses,
    records,
    journeys,
    inventory,
    movements,
    qrs,
    locations,
    custody,
    fences,
    plans,
    stops,
    events,
    outbox,
    reconciliations,
    aiLedger,
    documents,
    financeDocRows,
    workflows,
    tracking,
    scopes,
    s05,
  ] = await Promise.all([
    db.select({
      id: tenantMemberships.id,
      tenantId: tenantMemberships.tenantId,
      identityProvider: tenantMemberships.identityProvider,
      actorEmail: tenantMemberships.actorEmail,
      displayName: tenantMemberships.displayName,
      role: tenantMemberships.role,
      rolesJson: tenantMemberships.rolesJson,
      status: tenantMemberships.status,
    }).from(tenantMemberships).where(inArray(tenantMemberships.tenantId, tenantIds)).limit(AUDIT_ROW_LIMIT),
    db.select({ id: tenantWarehouses.id, tenantId: tenantWarehouses.tenantId, code: tenantWarehouses.code, name: tenantWarehouses.name, status: tenantWarehouses.status })
      .from(tenantWarehouses).where(inArray(tenantWarehouses.tenantId, tenantIds)).limit(AUDIT_ROW_LIMIT),
    db.select({ id: s04Records.id, tenantId: s04Records.tenantId, module: s04Records.module, canonicalCode: s04Records.canonicalCode, recordType: s04Records.recordType, title: s04Records.title, status: s04Records.status, payloadJson: s04Records.payloadJson })
      .from(s04Records).where(inArray(s04Records.tenantId, tenantIds)).limit(AUDIT_ROW_LIMIT),
    db.select({ id: jobJourneyRecords.id, tenantId: jobJourneyRecords.tenantId, jobId: jobJourneyRecords.jobId, domain: jobJourneyRecords.domain, recordType: jobJourneyRecords.recordType, status: jobJourneyRecords.status, payloadJson: jobJourneyRecords.payloadJson })
      .from(jobJourneyRecords).where(inArray(jobJourneyRecords.tenantId, tenantIds)).limit(AUDIT_ROW_LIMIT),
    db.select({ id: inventoryItems.id, tenantId: inventoryItems.tenantId, warehouseId: inventoryItems.warehouseId, sku: inventoryItems.sku, qrCode: inventoryItems.qrCode, onHandMilli: inventoryItems.onHandMilli, reservedMilli: inventoryItems.reservedMilli, status: inventoryItems.status })
      .from(inventoryItems).where(inArray(inventoryItems.tenantId, tenantIds)).limit(AUDIT_ROW_LIMIT),
    db.select({ tenantId: inventoryMovements.tenantId }).from(inventoryMovements).where(inArray(inventoryMovements.tenantId, tenantIds)).limit(AUDIT_ROW_LIMIT),
    db.select({ id: qrCodes.id, tenantId: qrCodes.tenantId, entityType: qrCodes.entityType, entityId: qrCodes.entityId, payload: qrCodes.payload })
      .from(qrCodes).where(inArray(qrCodes.tenantId, tenantIds)).limit(AUDIT_ROW_LIMIT),
    db.select({ id: geoLocations.id, tenantId: geoLocations.tenantId, entityType: geoLocations.entityType, entityId: geoLocations.entityId, status: geoLocations.status })
      .from(geoLocations).where(inArray(geoLocations.tenantId, tenantIds)).limit(AUDIT_ROW_LIMIT),
    db.select({ id: assetCustodyLocations.id, tenantId: assetCustodyLocations.tenantId, assetId: assetCustodyLocations.assetId, warehouseId: assetCustodyLocations.warehouseId, locationId: assetCustodyLocations.locationId, status: assetCustodyLocations.status })
      .from(assetCustodyLocations).where(inArray(assetCustodyLocations.tenantId, tenantIds)).limit(AUDIT_ROW_LIMIT),
    db.select({ id: geofences.id, tenantId: geofences.tenantId, locationId: geofences.locationId, entityType: geofences.entityType, entityId: geofences.entityId, status: geofences.status })
      .from(geofences).where(inArray(geofences.tenantId, tenantIds)).limit(AUDIT_ROW_LIMIT),
    db.select({ id: routePlans.id, tenantId: routePlans.tenantId, missionId: routePlans.missionId, jobId: routePlans.jobId, driverId: routePlans.driverId, vehicleId: routePlans.vehicleId, status: routePlans.status })
      .from(routePlans).where(inArray(routePlans.tenantId, tenantIds)).limit(AUDIT_ROW_LIMIT),
    db.select({ id: routeStops.id, tenantId: routeStops.tenantId, routePlanId: routeStops.routePlanId, locationId: routeStops.locationId, sequence: routeStops.sequence })
      .from(routeStops).where(inArray(routeStops.tenantId, tenantIds)).limit(AUDIT_ROW_LIMIT),
    db.select({ eventId: s06Events.eventId, tenantId: s06Events.tenantId, aggregateType: s06Events.aggregateType, aggregateId: s06Events.aggregateId, aggregateVersion: s06Events.aggregateVersion })
      .from(s06Events).where(inArray(s06Events.tenantId, tenantIds)).limit(AUDIT_ROW_LIMIT),
    db.select({ id: s06Outbox.id, tenantId: s06Outbox.tenantId, eventId: s06Outbox.eventId, status: s06Outbox.status })
      .from(s06Outbox).where(inArray(s06Outbox.tenantId, tenantIds)).limit(AUDIT_ROW_LIMIT),
    db.select({ id: s06Reconciliations.id, tenantId: s06Reconciliations.tenantId, aggregateType: s06Reconciliations.aggregateType, aggregateId: s06Reconciliations.aggregateId, expectedVersion: s06Reconciliations.expectedVersion, observedVersion: s06Reconciliations.observedVersion, status: s06Reconciliations.status })
      .from(s06Reconciliations).where(inArray(s06Reconciliations.tenantId, tenantIds)).limit(AUDIT_ROW_LIMIT),
    db.select({ tenantId: s07AiLedger.tenantId }).from(s07AiLedger).where(inArray(s07AiLedger.tenantId, tenantIds)).limit(AUDIT_ROW_LIMIT),
    db.select({ tenantId: operationalDocuments.tenantId }).from(operationalDocuments).where(inArray(operationalDocuments.tenantId, tenantIds)).limit(AUDIT_ROW_LIMIT),
    db.select({ tenantId: financeDocuments.tenantId }).from(financeDocuments).where(inArray(financeDocuments.tenantId, tenantIds)).limit(AUDIT_ROW_LIMIT),
    db.select({ tenantId: w10Workflows.tenantId }).from(w10Workflows).where(inArray(w10Workflows.tenantId, tenantIds)).limit(AUDIT_ROW_LIMIT),
    db.select({ tenantId: trackingSessions.tenantId }).from(trackingSessions).where(inArray(trackingSessions.tenantId, tenantIds)).limit(AUDIT_ROW_LIMIT),
    db.select({ tenantId: companyAiJobScopes.tenantId }).from(companyAiJobScopes).where(inArray(companyAiJobScopes.tenantId, tenantIds)).limit(AUDIT_ROW_LIMIT),
    db.select({ tenantId: s05Records.tenantId }).from(s05Records).where(inArray(s05Records.tenantId, tenantIds)).limit(AUDIT_ROW_LIMIT),
  ]);

  const boundedCollections = [memberships, warehouses, records, journeys, inventory, movements, qrs, locations, custody, fences, plans, stops, events, outbox, reconciliations, aiLedger, documents, financeDocRows, workflows, tracking, scopes, s05];
  const snapshot: AlignmentSnapshot = {
    tenants: tenantRows,
    memberships,
    warehouses,
    records,
    journeys,
    inventoryItems: inventory,
    inventoryMovements: movements,
    qrs,
    locations,
    assetCustody: custody,
    geofences: fences,
    routePlans: plans,
    routeStops: stops,
    events,
    outbox,
    reconciliations,
    aiLedger,
    documents: [...documents, ...financeDocRows],
    domainRecords: s05,
    workflows,
    trackingSessions: tracking,
    companyAiScopes: scopes,
    resolverProbe,
    execution,
    truncated: boundedCollections.some((rows) => rows.length >= AUDIT_ROW_LIMIT),
  };
  return buildSystemAlignmentReport(snapshot);
}
