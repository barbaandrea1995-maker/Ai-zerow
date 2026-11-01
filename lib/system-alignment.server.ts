import { and, eq, or } from "drizzle-orm";
import { getDb } from "@/db";
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
  tenantMemberships,
  tenantWarehouses,
  tenants,
  trackingSessions,
  w10Workflows,
} from "@/db/schema";
import { ensureFinanceDocumentSchema } from "@/lib/finance-document-schema.server";
import { inferRawCode } from "@/lib/qr-adapter";
import { buildSystemAlignmentReport, type AlignmentSnapshot } from "@/lib/system-alignment";

const AUDIT_ROW_LIMIT = 5_001;

/**
 * Builds a read-only integrity snapshot for exactly one authority-selected
 * tenant. No tenant discovery, merge recommendation or historical alignment
 * executor is reachable from this commercial read model.
 */
export async function getSystemAlignmentReport(tenantId: string) {
  if (!tenantId.trim()) throw new Error("tenant_scope_required");
  await ensureFinanceDocumentSchema();
  const db = getDb();
  const tenantRows = await db.select({
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
  }).from(tenants).where(and(
    eq(tenants.id, tenantId),
    or(eq(tenants.status, "active"), eq(tenants.status, "onboarding")),
  )).limit(1);

  const resolverProbe = {
    rawAssetCodeSupported: inferRawCode("ASSET-0001")?.entityId === "ASSET-0001",
    mixedCaseEntityIdPreserved: inferRawCode("AZ1|MATERIAL|CHIUS-GHIS-50x50")?.entityId === "CHIUS-GHIS-50x50",
  };
  if (tenantRows.length === 0) {
    return buildSystemAlignmentReport({
      tenants: [], memberships: [], warehouses: [], records: [], journeys: [], inventoryItems: [], inventoryMovements: [],
      qrs: [], locations: [], assetCustody: [], geofences: [], routePlans: [], routeStops: [], events: [], outbox: [], reconciliations: [],
      aiLedger: [], documents: [], domainRecords: [], workflows: [], trackingSessions: [], companyAiScopes: [], resolverProbe, execution: null, truncated: false,
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
    domainRecords,
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
    }).from(tenantMemberships).where(eq(tenantMemberships.tenantId, tenantId)).limit(AUDIT_ROW_LIMIT),
    db.select({ id: tenantWarehouses.id, tenantId: tenantWarehouses.tenantId, code: tenantWarehouses.code, name: tenantWarehouses.name, status: tenantWarehouses.status })
      .from(tenantWarehouses).where(eq(tenantWarehouses.tenantId, tenantId)).limit(AUDIT_ROW_LIMIT),
    db.select({ id: s04Records.id, tenantId: s04Records.tenantId, module: s04Records.module, canonicalCode: s04Records.canonicalCode, recordType: s04Records.recordType, title: s04Records.title, status: s04Records.status, payloadJson: s04Records.payloadJson })
      .from(s04Records).where(eq(s04Records.tenantId, tenantId)).limit(AUDIT_ROW_LIMIT),
    db.select({ id: jobJourneyRecords.id, tenantId: jobJourneyRecords.tenantId, jobId: jobJourneyRecords.jobId, domain: jobJourneyRecords.domain, recordType: jobJourneyRecords.recordType, status: jobJourneyRecords.status, payloadJson: jobJourneyRecords.payloadJson })
      .from(jobJourneyRecords).where(eq(jobJourneyRecords.tenantId, tenantId)).limit(AUDIT_ROW_LIMIT),
    db.select({ id: inventoryItems.id, tenantId: inventoryItems.tenantId, warehouseId: inventoryItems.warehouseId, sku: inventoryItems.sku, qrCode: inventoryItems.qrCode, onHandMilli: inventoryItems.onHandMilli, reservedMilli: inventoryItems.reservedMilli, status: inventoryItems.status })
      .from(inventoryItems).where(eq(inventoryItems.tenantId, tenantId)).limit(AUDIT_ROW_LIMIT),
    db.select({ tenantId: inventoryMovements.tenantId }).from(inventoryMovements).where(eq(inventoryMovements.tenantId, tenantId)).limit(AUDIT_ROW_LIMIT),
    db.select({ id: qrCodes.id, tenantId: qrCodes.tenantId, entityType: qrCodes.entityType, entityId: qrCodes.entityId, payload: qrCodes.payload })
      .from(qrCodes).where(eq(qrCodes.tenantId, tenantId)).limit(AUDIT_ROW_LIMIT),
    db.select({ id: geoLocations.id, tenantId: geoLocations.tenantId, entityType: geoLocations.entityType, entityId: geoLocations.entityId, status: geoLocations.status })
      .from(geoLocations).where(eq(geoLocations.tenantId, tenantId)).limit(AUDIT_ROW_LIMIT),
    db.select({ id: assetCustodyLocations.id, tenantId: assetCustodyLocations.tenantId, assetId: assetCustodyLocations.assetId, warehouseId: assetCustodyLocations.warehouseId, locationId: assetCustodyLocations.locationId, status: assetCustodyLocations.status })
      .from(assetCustodyLocations).where(eq(assetCustodyLocations.tenantId, tenantId)).limit(AUDIT_ROW_LIMIT),
    db.select({ id: geofences.id, tenantId: geofences.tenantId, locationId: geofences.locationId, entityType: geofences.entityType, entityId: geofences.entityId, status: geofences.status })
      .from(geofences).where(eq(geofences.tenantId, tenantId)).limit(AUDIT_ROW_LIMIT),
    db.select({ id: routePlans.id, tenantId: routePlans.tenantId, missionId: routePlans.missionId, jobId: routePlans.jobId, driverId: routePlans.driverId, vehicleId: routePlans.vehicleId, status: routePlans.status })
      .from(routePlans).where(eq(routePlans.tenantId, tenantId)).limit(AUDIT_ROW_LIMIT),
    db.select({ id: routeStops.id, tenantId: routeStops.tenantId, routePlanId: routeStops.routePlanId, locationId: routeStops.locationId, sequence: routeStops.sequence })
      .from(routeStops).where(eq(routeStops.tenantId, tenantId)).limit(AUDIT_ROW_LIMIT),
    db.select({ eventId: s06Events.eventId, tenantId: s06Events.tenantId, aggregateType: s06Events.aggregateType, aggregateId: s06Events.aggregateId, aggregateVersion: s06Events.aggregateVersion })
      .from(s06Events).where(eq(s06Events.tenantId, tenantId)).limit(AUDIT_ROW_LIMIT),
    db.select({ id: s06Outbox.id, tenantId: s06Outbox.tenantId, eventId: s06Outbox.eventId, status: s06Outbox.status })
      .from(s06Outbox).where(eq(s06Outbox.tenantId, tenantId)).limit(AUDIT_ROW_LIMIT),
    db.select({ id: s06Reconciliations.id, tenantId: s06Reconciliations.tenantId, aggregateType: s06Reconciliations.aggregateType, aggregateId: s06Reconciliations.aggregateId, expectedVersion: s06Reconciliations.expectedVersion, observedVersion: s06Reconciliations.observedVersion, status: s06Reconciliations.status })
      .from(s06Reconciliations).where(eq(s06Reconciliations.tenantId, tenantId)).limit(AUDIT_ROW_LIMIT),
    db.select({ tenantId: s07AiLedger.tenantId }).from(s07AiLedger).where(eq(s07AiLedger.tenantId, tenantId)).limit(AUDIT_ROW_LIMIT),
    db.select({ tenantId: operationalDocuments.tenantId }).from(operationalDocuments).where(eq(operationalDocuments.tenantId, tenantId)).limit(AUDIT_ROW_LIMIT),
    db.select({ tenantId: financeDocuments.tenantId }).from(financeDocuments).where(eq(financeDocuments.tenantId, tenantId)).limit(AUDIT_ROW_LIMIT),
    db.select({ tenantId: w10Workflows.tenantId }).from(w10Workflows).where(eq(w10Workflows.tenantId, tenantId)).limit(AUDIT_ROW_LIMIT),
    db.select({ tenantId: trackingSessions.tenantId }).from(trackingSessions).where(eq(trackingSessions.tenantId, tenantId)).limit(AUDIT_ROW_LIMIT),
    db.select({ tenantId: companyAiJobScopes.tenantId }).from(companyAiJobScopes).where(eq(companyAiJobScopes.tenantId, tenantId)).limit(AUDIT_ROW_LIMIT),
    db.select({ tenantId: s05Records.tenantId }).from(s05Records).where(eq(s05Records.tenantId, tenantId)).limit(AUDIT_ROW_LIMIT),
  ]);

  const boundedCollections = [memberships, warehouses, records, journeys, inventory, movements, qrs, locations, custody, fences, plans, stops, events, outbox, reconciliations, aiLedger, documents, financeDocRows, workflows, tracking, scopes, domainRecords];
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
    domainRecords,
    workflows,
    trackingSessions: tracking,
    companyAiScopes: scopes,
    resolverProbe,
    execution: null,
    truncated: boundedCollections.some((rows) => rows.length >= AUDIT_ROW_LIMIT),
  };
  return buildSystemAlignmentReport(snapshot);
}
