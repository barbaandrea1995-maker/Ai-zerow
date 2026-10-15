export type AlignmentStatus = "READY" | "REVIEW" | "BLOCKED";

export type AlignmentTenant = {
  id: string;
  slug: string;
  name: string;
  status: string;
  legalForm: string;
  vatNumber: string | null;
  taxCode: string | null;
  registeredAddress: string | null;
  registeredCity: string | null;
  businessEmail: string | null;
  businessPhone: string | null;
  operatingTransportModesJson: string;
};

export type AlignmentMembership = {
  id: string;
  tenantId: string;
  identityProvider: string;
  actorEmail: string;
  displayName: string;
  role: string;
  rolesJson: string;
  status: string;
};

export type AlignmentWarehouse = {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  status: string;
};

export type AlignmentRecord = {
  id: string;
  tenantId: string;
  module: string;
  canonicalCode: string | null;
  recordType: string;
  title: string;
  status: string;
  payloadJson: string;
};

export type AlignmentJourney = {
  id: string;
  tenantId: string;
  jobId: string;
  domain: string;
  recordType: string;
  status: string;
  payloadJson: string;
};

export type AlignmentInventoryItem = {
  id: string;
  tenantId: string;
  warehouseId: string | null;
  sku: string;
  qrCode: string | null;
  onHandMilli: number;
  reservedMilli: number;
  status: string;
};

export type AlignmentQr = {
  id: string;
  tenantId: string;
  entityType: string;
  entityId: string;
  payload: string;
};

export type AlignmentLocation = {
  id: string;
  tenantId: string;
  entityType: string;
  entityId: string;
  status: string;
};

export type AlignmentAssetCustody = {
  id: string;
  tenantId: string;
  assetId: string;
  warehouseId: string | null;
  locationId: string | null;
  status: string;
};

export type AlignmentGeofence = {
  id: string;
  tenantId: string;
  locationId: string;
  entityType: string;
  entityId: string;
  status: string;
};

export type AlignmentRoutePlan = {
  id: string;
  tenantId: string;
  missionId: string | null;
  jobId: string | null;
  driverId: string;
  vehicleId: string;
  status: string;
};

export type AlignmentRouteStop = {
  id: string;
  tenantId: string;
  routePlanId: string;
  locationId: string;
  sequence: number;
};

export type AlignmentEvent = {
  eventId: string;
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
};

export type AlignmentOutbox = {
  id: string;
  tenantId: string;
  eventId: string;
  status: string;
};

export type AlignmentReconciliation = {
  id: string;
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  expectedVersion: number;
  observedVersion: number;
  status: string;
};

export type AlignmentTenantScopedRow = { tenantId: string };

export type AlignmentSnapshot = {
  tenants: AlignmentTenant[];
  memberships: AlignmentMembership[];
  warehouses: AlignmentWarehouse[];
  records: AlignmentRecord[];
  journeys: AlignmentJourney[];
  inventoryItems: AlignmentInventoryItem[];
  inventoryMovements: AlignmentTenantScopedRow[];
  qrs: AlignmentQr[];
  locations: AlignmentLocation[];
  assetCustody: AlignmentAssetCustody[];
  geofences: AlignmentGeofence[];
  routePlans: AlignmentRoutePlan[];
  routeStops: AlignmentRouteStop[];
  events: AlignmentEvent[];
  outbox: AlignmentOutbox[];
  reconciliations: AlignmentReconciliation[];
  aiLedger: AlignmentTenantScopedRow[];
  documents: AlignmentTenantScopedRow[];
  domainRecords: AlignmentTenantScopedRow[];
  workflows: AlignmentTenantScopedRow[];
  trackingSessions: AlignmentTenantScopedRow[];
  companyAiScopes: AlignmentTenantScopedRow[];
  resolverProbe: {
    rawAssetCodeSupported: boolean;
    mixedCaseEntityIdPreserved: boolean;
  };
  truncated: boolean;
};

export type AlignmentGate = {
  id: string;
  label: string;
  status: AlignmentStatus;
  count: number;
  detail: string;
  entityIds: string[];
  nextAction: string;
};

type TenantCounts = {
  memberships: number;
  warehouses: number;
  operations: number;
  workforce: number;
  assets: number;
  planning: number;
  missions: number;
  inventoryItems: number;
  inventoryMovements: number;
  qrs: number;
  locations: number;
  geofences: number;
  routePlans: number;
  routeStops: number;
  events: number;
  outbox: number;
  reconciliations: number;
  aiLedger: number;
  documents: number;
  domainRecords: number;
  workflows: number;
  trackingSessions: number;
  companyAiScopes: number;
  assetCustody: number;
};

export type TenantAlignmentSummary = {
  id: string;
  slug: string;
  name: string;
  status: string;
  readinessScore: number;
  recommended: boolean;
  companyProfileFields: { completed: number; total: number };
  canonicalPlaces: { expected: number; covered: number; geofenced: number };
  qrCoverage: { expected: number; covered: number };
  unresolvedAssetLocations: number;
  counts: TenantCounts;
};

export type AlignmentConflict = {
  registry: "WAREHOUSE_CODE" | "S04_CANONICAL_CODE" | "INVENTORY_SKU" | "QR_PAYLOAD";
  key: string;
  targetEntityIds: string[];
  sourceEntityIds: string[];
};

export type SystemAlignmentReport = {
  contract: {
    version: "ALIGNMENT_BASELINE_V1";
    mode: "READ_ONLY_DRY_RUN";
    directWrite: false;
    writeOperations: 0;
  };
  status: AlignmentStatus;
  generatedAt: string;
  summary: {
    tenantRoots: number;
    recommendedTargetTenantId: string | null;
    recommendedTargetScore: number | null;
    blockedGates: number;
    reviewGates: number;
    conflicts: number;
    truncated: boolean;
  };
  tenants: TenantAlignmentSummary[];
  gates: AlignmentGate[];
  dryRun: {
    targetTenantId: string | null;
    sourceTenantIds: string[];
    candidateRecords: number;
    conflicts: AlignmentConflict[];
    requiredHumanDecisions: string[];
    writeOperations: 0;
  };
};

const upper = (value: string | null | undefined) => (value ?? "").trim().toUpperCase();
const lower = (value: string | null | undefined) => (value ?? "").trim().toLocaleLowerCase("it-IT");

function parseArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function valuesForTenant<T extends AlignmentTenantScopedRow>(rows: T[], tenantId: string) {
  return rows.filter((row) => row.tenantId === tenantId);
}

function canonicalPlaceKey(tenantId: string, entityType: string, entityId: string) {
  return `${tenantId}:${upper(entityType)}:${entityId}`;
}

function qrEntityKey(tenantId: string, entityType: string, entityId: string) {
  return `${tenantId}:${lower(entityType)}:${entityId}`;
}

function cappedIds(values: string[]) {
  return [...new Set(values)].slice(0, 30);
}

function collisionRows(
  targetTenantId: string,
  sourceTenantIds: string[],
  entries: Array<{ tenantId: string; key: string; id: string }>,
  registry: AlignmentConflict["registry"],
) {
  const target = new Map<string, string[]>();
  const source = new Map<string, string[]>();
  for (const entry of entries) {
    if (!entry.key) continue;
    const map = entry.tenantId === targetTenantId ? target : sourceTenantIds.includes(entry.tenantId) ? source : null;
    if (!map) continue;
    map.set(entry.key, [...(map.get(entry.key) ?? []), entry.id]);
  }
  return [...source.entries()].flatMap(([key, sourceEntityIds]) => {
    const targetEntityIds = target.get(key);
    return targetEntityIds ? [{ registry, key, targetEntityIds, sourceEntityIds }] : [];
  });
}

function tenantCounts(snapshot: AlignmentSnapshot, tenantId: string): TenantCounts {
  const records = valuesForTenant(snapshot.records, tenantId);
  const journeys = valuesForTenant(snapshot.journeys, tenantId);
  return {
    memberships: valuesForTenant(snapshot.memberships, tenantId).length,
    warehouses: valuesForTenant(snapshot.warehouses, tenantId).length,
    operations: records.filter((row) => row.module === "operations" && row.recordType !== "adapter-contract").length,
    workforce: records.filter((row) => row.module === "workforce").length,
    assets: records.filter((row) => row.module === "assets").length,
    planning: journeys.filter((row) => row.domain === "planning").length,
    missions: journeys.filter((row) => row.domain === "mission").length,
    inventoryItems: valuesForTenant(snapshot.inventoryItems, tenantId).length,
    inventoryMovements: valuesForTenant(snapshot.inventoryMovements, tenantId).length,
    qrs: valuesForTenant(snapshot.qrs, tenantId).length,
    locations: valuesForTenant(snapshot.locations, tenantId).length,
    geofences: valuesForTenant(snapshot.geofences, tenantId).length,
    routePlans: valuesForTenant(snapshot.routePlans, tenantId).length,
    routeStops: valuesForTenant(snapshot.routeStops, tenantId).length,
    events: valuesForTenant(snapshot.events, tenantId).length,
    outbox: valuesForTenant(snapshot.outbox, tenantId).length,
    reconciliations: valuesForTenant(snapshot.reconciliations, tenantId).length,
    aiLedger: valuesForTenant(snapshot.aiLedger, tenantId).length,
    documents: valuesForTenant(snapshot.documents, tenantId).length,
    domainRecords: valuesForTenant(snapshot.domainRecords, tenantId).length,
    workflows: valuesForTenant(snapshot.workflows, tenantId).length,
    trackingSessions: valuesForTenant(snapshot.trackingSessions, tenantId).length,
    companyAiScopes: valuesForTenant(snapshot.companyAiScopes, tenantId).length,
    assetCustody: valuesForTenant(snapshot.assetCustody, tenantId).length,
  };
}

export function buildSystemAlignmentReport(snapshot: AlignmentSnapshot, now = new Date()): SystemAlignmentReport {
  const activeTenants = snapshot.tenants.filter((tenant) => ["active", "onboarding"].includes(lower(tenant.status)));
  const activeTenantIds = activeTenants.map((tenant) => tenant.id);
  const activeLocations = snapshot.locations.filter((row) => upper(row.status) === "ACTIVE");
  const activeGeofences = snapshot.geofences.filter((row) => upper(row.status) === "ACTIVE");
  const resolvedCustodyKeys = new Set(snapshot.assetCustody
    .filter((row) => upper(row.status) !== "UNKNOWN" && Boolean(row.warehouseId || row.locationId))
    .map((row) => `${row.tenantId}:${row.assetId}`));
  const locationKeys = new Set(activeLocations.map((row) => canonicalPlaceKey(row.tenantId, row.entityType, row.entityId)));
  const geofenceLocationKeys = new Set(activeGeofences.map((row) => `${row.tenantId}:${row.locationId}`));
  const qrKeys = new Set(snapshot.qrs.map((row) => qrEntityKey(row.tenantId, row.entityType, row.entityId)));
  const qrPayloads = new Set(snapshot.qrs.map((row) => `${row.tenantId}:${row.payload}`));

  const tenantSummaries = activeTenants.map<TenantAlignmentSummary>((tenant) => {
    const counts = tenantCounts(snapshot, tenant.id);
    const warehouses = valuesForTenant(snapshot.warehouses, tenant.id).filter((row) => lower(row.status) === "active");
    const operations = valuesForTenant(snapshot.records, tenant.id)
      .filter((row) => row.module === "operations" && row.recordType !== "adapter-contract");
    const assets = valuesForTenant(snapshot.records, tenant.id).filter((row) => row.module === "assets" && Boolean(row.canonicalCode));
    const inventoryItems = valuesForTenant(snapshot.inventoryItems, tenant.id).filter((row) => upper(row.status) === "ACTIVE");
    const expectedPlaces = [
      ...warehouses.map((row) => ({ type: "MAGAZZINO", id: row.id })),
      ...operations.map((row) => ({ type: "CANTIERE", id: row.id })),
    ];
    const coveredPlaces = expectedPlaces.filter((row) => locationKeys.has(canonicalPlaceKey(tenant.id, row.type, row.id)));
    const geofencedPlaces = coveredPlaces.filter((row) => {
      const location = activeLocations.find((item) => canonicalPlaceKey(item.tenantId, item.entityType, item.entityId) === canonicalPlaceKey(tenant.id, row.type, row.id));
      return Boolean(location && geofenceLocationKeys.has(`${tenant.id}:${location.id}`));
    });
    const expectedQr = [
      ...assets.map((row) => ({ type: "asset", id: row.canonicalCode ?? "", payload: "" })),
      ...inventoryItems.filter((row) => Boolean(row.qrCode)).map((row) => ({ type: "material", id: row.sku, payload: row.qrCode ?? "" })),
    ];
    const coveredQr = expectedQr.filter((row) => qrKeys.has(qrEntityKey(tenant.id, row.type, row.id)) || Boolean(row.payload && qrPayloads.has(`${tenant.id}:${row.payload}`)));
    const unresolvedAssetLocations = assets.filter((row) => {
      const direct = locationKeys.has(canonicalPlaceKey(tenant.id, "ASSET", row.id))
        || locationKeys.has(canonicalPlaceKey(tenant.id, "MEZZO", row.id));
      const payload = parseObject(row.payloadJson);
      const locationId = typeof payload.locationId === "string" ? payload.locationId : "";
      return !direct && !locationId && !resolvedCustodyKeys.has(`${tenant.id}:${row.id}`);
    }).length;
    const companyFields = [
      tenant.legalForm && tenant.legalForm !== "OTHER" ? tenant.legalForm : null,
      tenant.vatNumber,
      tenant.taxCode,
      tenant.registeredAddress,
      tenant.registeredCity,
      tenant.businessEmail,
      tenant.businessPhone,
    ];
    const completedCompanyFields = companyFields.filter(Boolean).length;
    const placeRatio = expectedPlaces.length ? coveredPlaces.length / expectedPlaces.length : 0;
    const geofenceRatio = expectedPlaces.length ? geofencedPlaces.length / expectedPlaces.length : 0;
    const qrRatio = expectedQr.length ? coveredQr.length / expectedQr.length : 0;
    const score = Math.round(
      (completedCompanyFields / companyFields.length) * 25
      + placeRatio * 15
      + geofenceRatio * 10
      + qrRatio * 15
      + (parseArray(tenant.operatingTransportModesJson).length ? 10 : 0)
      + (counts.operations ? 8 : 0)
      + (counts.routePlans && counts.routeStops >= 2 ? 7 : 0)
      + (counts.events && counts.reconciliations ? 5 : 0)
      + (counts.memberships ? 5 : 0),
    );
    return {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      status: tenant.status,
      readinessScore: Math.min(100, score),
      recommended: false,
      companyProfileFields: { completed: completedCompanyFields, total: companyFields.length },
      canonicalPlaces: { expected: expectedPlaces.length, covered: coveredPlaces.length, geofenced: geofencedPlaces.length },
      qrCoverage: { expected: expectedQr.length, covered: coveredQr.length },
      unresolvedAssetLocations,
      counts,
    };
  }).sort((left, right) => right.readinessScore - left.readinessScore || left.name.localeCompare(right.name, "it"));

  const recommendation = tenantSummaries.length > 0
    && (tenantSummaries.length === 1 || tenantSummaries[0].readinessScore > tenantSummaries[1].readinessScore)
    ? tenantSummaries[0]
    : null;
  if (recommendation) recommendation.recommended = true;

  const missingPlaceIds: string[] = [];
  const missingGeofenceIds: string[] = [];
  for (const tenantId of activeTenantIds) {
    const warehouses = valuesForTenant(snapshot.warehouses, tenantId).filter((row) => lower(row.status) === "active");
    const operations = valuesForTenant(snapshot.records, tenantId).filter((row) => row.module === "operations" && row.recordType !== "adapter-contract");
    for (const entity of [
      ...warehouses.map((row) => ({ type: "MAGAZZINO", id: row.id })),
      ...operations.map((row) => ({ type: "CANTIERE", id: row.id })),
    ]) {
      const location = activeLocations.find((row) => canonicalPlaceKey(row.tenantId, row.entityType, row.entityId) === canonicalPlaceKey(tenantId, entity.type, entity.id));
      if (!location) missingPlaceIds.push(`${tenantId}:${entity.type}:${entity.id}`);
      else if (!geofenceLocationKeys.has(`${tenantId}:${location.id}`)) missingGeofenceIds.push(`${tenantId}:${entity.type}:${entity.id}`);
    }
  }

  const expectedQrEntities = activeTenantIds.flatMap((tenantId) => {
    const assets = valuesForTenant(snapshot.records, tenantId)
      .filter((row) => row.module === "assets" && Boolean(row.canonicalCode))
      .map((row) => ({ tenantId, type: "asset", id: row.canonicalCode ?? "", payload: "" }));
    const materials = valuesForTenant(snapshot.inventoryItems, tenantId)
      .filter((row) => upper(row.status) === "ACTIVE" && Boolean(row.qrCode))
      .map((row) => ({ tenantId, type: "material", id: row.sku, payload: row.qrCode ?? "" }));
    return [...assets, ...materials];
  });
  const missingQrIds = expectedQrEntities
    .filter((row) => !qrKeys.has(qrEntityKey(row.tenantId, row.type, row.id)) && !qrPayloads.has(`${row.tenantId}:${row.payload}`))
    .map((row) => `${row.tenantId}:${row.type}:${row.id}`);
  const duplicateQrIds = [...snapshot.qrs.reduce((groups, row) => {
    const key = qrEntityKey(row.tenantId, row.entityType, row.entityId);
    groups.set(key, [...(groups.get(key) ?? []), row.id]);
    return groups;
  }, new Map<string, string[]>())].filter(([, ids]) => ids.length > 1).map(([key]) => key);
  const knownAssetKeys = new Set(snapshot.records.filter((row) => row.module === "assets" && row.canonicalCode).map((row) => qrEntityKey(row.tenantId, "asset", row.canonicalCode ?? "")));
  const knownMaterialKeys = new Set(snapshot.inventoryItems.map((row) => qrEntityKey(row.tenantId, "material", row.sku)));
  const knownWarehouseKeys = new Set(snapshot.warehouses.flatMap((row) => [qrEntityKey(row.tenantId, "warehouse", row.id), qrEntityKey(row.tenantId, "warehouse", row.code)]));
  const knownCommessaKeys = new Set(snapshot.records.filter((row) => row.module === "operations").flatMap((row) => [qrEntityKey(row.tenantId, "commessa", row.id), qrEntityKey(row.tenantId, "commessa", row.canonicalCode ?? "")]));
  const orphanQrIds = snapshot.qrs.filter((row) => {
    const key = qrEntityKey(row.tenantId, row.entityType, row.entityId);
    if (lower(row.entityType) === "asset") return !knownAssetKeys.has(key);
    if (lower(row.entityType) === "material") return !knownMaterialKeys.has(key);
    if (lower(row.entityType) === "warehouse") return !knownWarehouseKeys.has(key);
    if (lower(row.entityType) === "commessa") return !knownCommessaKeys.has(key);
    return true;
  }).map((row) => `${row.tenantId}:${row.id}`);

  const duplicateMembershipIds: string[] = [];
  const membershipGroups = new Map<string, AlignmentMembership[]>();
  for (const membership of snapshot.memberships.filter((row) => lower(row.status) === "active")) {
    for (const key of [`email:${membership.tenantId}:${lower(membership.actorEmail)}`, `name:${membership.tenantId}:${lower(membership.displayName)}`]) {
      membershipGroups.set(key, [...(membershipGroups.get(key) ?? []), membership]);
    }
  }
  for (const rows of membershipGroups.values()) {
    if (rows.length > 1) duplicateMembershipIds.push(...rows.map((row) => row.id));
  }

  const unresolvedAssetIds = tenantSummaries.flatMap((tenant) => valuesForTenant(snapshot.records, tenant.id)
    .filter((row) => row.module === "assets")
    .filter((row) => {
      const payload = parseObject(row.payloadJson);
      return !locationKeys.has(canonicalPlaceKey(tenant.id, "ASSET", row.id))
        && !locationKeys.has(canonicalPlaceKey(tenant.id, "MEZZO", row.id))
        && typeof payload.locationId !== "string"
        && !resolvedCustodyKeys.has(`${tenant.id}:${row.id}`);
    }).map((row) => `${tenant.id}:${row.id}`));

  const routePlanKeys = new Set(snapshot.routePlans.map((row) => `${row.tenantId}:${row.id}`));
  const locationIdKeys = new Set(activeLocations.map((row) => `${row.tenantId}:${row.id}`));
  const missionIds = new Set(snapshot.journeys.filter((row) => row.domain === "mission").map((row) => `${row.tenantId}:${row.id}`));
  const brokenRouteIds = [
    ...snapshot.routeStops.filter((row) => !routePlanKeys.has(`${row.tenantId}:${row.routePlanId}`) || !locationIdKeys.has(`${row.tenantId}:${row.locationId}`)).map((row) => row.id),
    ...snapshot.routePlans.filter((row) => row.missionId && !missionIds.has(`${row.tenantId}:${row.missionId}`)).map((row) => row.id),
  ];
  const warehouseIds = new Set(snapshot.warehouses.map((row) => `${row.tenantId}:${row.id}`));
  const invalidStockIds = snapshot.inventoryItems.filter((row) => row.reservedMilli < 0 || row.onHandMilli < 0 || row.reservedMilli > row.onHandMilli || (row.warehouseId && !warehouseIds.has(`${row.tenantId}:${row.warehouseId}`))).map((row) => row.id);

  const eventKeys = new Set(snapshot.events.map((row) => `${row.tenantId}:${row.eventId}`));
  const reconciliationKeys = new Set(snapshot.reconciliations.map((row) => `${row.tenantId}:${row.aggregateType}:${row.aggregateId}:${row.expectedVersion}`));
  const orphanOutboxIds = snapshot.outbox.filter((row) => !eventKeys.has(`${row.tenantId}:${row.eventId}`)).map((row) => row.id);
  const unreconciledEventIds = snapshot.events.filter((row) => !reconciliationKeys.has(`${row.tenantId}:${row.aggregateType}:${row.aggregateId}:${row.aggregateVersion}`)).map((row) => row.eventId);

  const resolverFailures = [
    ...(!snapshot.resolverProbe.rawAssetCodeSupported ? ["raw:ASSET-0001"] : []),
    ...(!snapshot.resolverProbe.mixedCaseEntityIdPreserved ? ["case:AZ1|MATERIAL|CHIUS-GHIS-50x50"] : []),
  ];
  const qrProblemIds = [...missingQrIds, ...duplicateQrIds, ...orphanQrIds, ...resolverFailures];
  const eventProblemIds = [...orphanOutboxIds, ...unreconciledEventIds];

  const gates: AlignmentGate[] = [
    {
      id: "tenant-root",
      label: "Radice tenant aziendale",
      status: activeTenants.length === 1 ? "READY" : "REVIEW",
      count: activeTenants.length,
      detail: activeTenants.length === 1 ? "Una sola radice aziendale attiva." : `${activeTenants.length} radici attive richiedono una scelta esplicita; il report non le fonde automaticamente.`,
      entityIds: cappedIds(activeTenantIds),
      nextAction: activeTenants.length === 1 ? "Nessuna" : "Confermare il tenant target e classificare le altre radici come sorgente, azienda distinta o archivio.",
    },
    {
      id: "canonical-places",
      label: "Luoghi e geofence canonici",
      status: missingPlaceIds.length || missingGeofenceIds.length ? "BLOCKED" : "READY",
      count: missingPlaceIds.length + missingGeofenceIds.length,
      detail: `${missingPlaceIds.length} entità senza luogo canonico · ${missingGeofenceIds.length} luoghi senza geofence attiva.`,
      entityIds: cappedIds([...missingPlaceIds, ...missingGeofenceIds]),
      nextAction: missingPlaceIds.length || missingGeofenceIds.length ? "Eseguire il backfill Geoapify con conferma umana per gli indirizzi legacy." : "Mantenere il resolver unico nei moduli operativi.",
    },
    {
      id: "qr-registry",
      label: "Registro e resolver QR",
      status: qrProblemIds.length ? "BLOCKED" : "READY",
      count: qrProblemIds.length,
      detail: `${missingQrIds.length} QR mancanti · ${duplicateQrIds.length} duplicati · ${orphanQrIds.length} orfani · ${resolverFailures.length} incompatibilità resolver.`,
      entityIds: cappedIds(qrProblemIds),
      nextAction: qrProblemIds.length ? "Correggere il resolver fail-closed e registrare i QR mancanti con vincolo univoco per entità." : "Nessuna",
    },
    {
      id: "identity-membership",
      label: "Persona, identità e membership",
      status: duplicateMembershipIds.length ? "REVIEW" : "READY",
      count: new Set(duplicateMembershipIds).size,
      detail: duplicateMembershipIds.length ? "Sono presenti membership con email o nome coincidenti nello stesso tenant; i ruoli non devono essere uniti automaticamente." : "Nessuna ambiguità esatta rilevata.",
      entityIds: cappedIds(duplicateMembershipIds),
      nextAction: duplicateMembershipIds.length ? "Collegare le identità a una persona canonica mantenendo separati ruoli e provider." : "Nessuna",
    },
    {
      id: "asset-location",
      label: "Posizione fisica degli asset",
      status: unresolvedAssetIds.length ? "REVIEW" : "READY",
      count: unresolvedAssetIds.length,
      detail: unresolvedAssetIds.length ? `${unresolvedAssetIds.length} asset o mezzi hanno solo posizione testuale o nessun riferimento canonico.` : "Tutte le risorse hanno un riferimento di posizione canonico.",
      entityIds: cappedIds(unresolvedAssetIds),
      nextAction: unresolvedAssetIds.length ? "Separare posizione fisica, custodia, autista e utilizzatore operativo." : "Nessuna",
    },
    {
      id: "mission-route",
      label: "Missioni, tratte e tappe",
      status: brokenRouteIds.length ? "BLOCKED" : "READY",
      count: brokenRouteIds.length,
      detail: brokenRouteIds.length ? "Una o più tratte puntano a missioni, piani o luoghi non risolvibili." : `${snapshot.routePlans.length} piani e ${snapshot.routeStops.length} tappe mantengono riferimenti coerenti.`,
      entityIds: cappedIds(brokenRouteIds),
      nextAction: brokenRouteIds.length ? "Riparare i riferimenti prima di avviare tracking o consegna." : "Mantenere il controllo sui nuovi luoghi temporanei.",
    },
    {
      id: "inventory-integrity",
      label: "Scorte e depositi",
      status: invalidStockIds.length ? "BLOCKED" : "READY",
      count: invalidStockIds.length,
      detail: invalidStockIds.length ? "Saldo, prenotazione o collegamento deposito non valido." : "Saldi, prenotazioni e riferimenti deposito risultano coerenti.",
      entityIds: cappedIds(invalidStockIds),
      nextAction: invalidStockIds.length ? "Riconciliare le righe prima di migrare il registro scorte." : "Nessuna",
    },
    {
      id: "event-readback",
      label: "Eventi, outbox e riconciliazione",
      status: orphanOutboxIds.length ? "BLOCKED" : unreconciledEventIds.length ? "REVIEW" : "READY",
      count: eventProblemIds.length,
      detail: `${snapshot.events.length} eventi · ${snapshot.outbox.length} outbox · ${snapshot.reconciliations.length} riconciliazioni · ${eventProblemIds.length} disallineamenti.`,
      entityIds: cappedIds(eventProblemIds),
      nextAction: eventProblemIds.length ? "Conservare la provenienza e chiudere i readback mancanti prima della migrazione." : "Nessuna",
    },
  ];

  const targetTenantId = recommendation?.id ?? null;
  const sourceTenantIds = targetTenantId ? activeTenantIds.filter((id) => id !== targetTenantId) : [];
  const conflicts = targetTenantId ? [
    ...collisionRows(targetTenantId, sourceTenantIds, snapshot.warehouses.map((row) => ({ tenantId: row.tenantId, key: upper(row.code), id: row.id })), "WAREHOUSE_CODE"),
    ...collisionRows(targetTenantId, sourceTenantIds, snapshot.records.filter((row) => row.canonicalCode).map((row) => ({ tenantId: row.tenantId, key: `${row.module}:${upper(row.canonicalCode)}`, id: row.id })), "S04_CANONICAL_CODE"),
    ...collisionRows(targetTenantId, sourceTenantIds, snapshot.inventoryItems.map((row) => ({ tenantId: row.tenantId, key: upper(row.sku), id: row.id })), "INVENTORY_SKU"),
    ...collisionRows(targetTenantId, sourceTenantIds, snapshot.qrs.map((row) => ({ tenantId: row.tenantId, key: row.payload, id: row.id })), "QR_PAYLOAD"),
  ] : [];
  const candidateRecords = sourceTenantIds.reduce((total, tenantId) => {
    const counts = tenantCounts(snapshot, tenantId);
    return total + Object.values(counts).reduce((sum, value) => sum + value, 0);
  }, 0);

  const blockedGates = gates.filter((gate) => gate.status === "BLOCKED").length;
  const reviewGates = gates.filter((gate) => gate.status === "REVIEW").length;
  const status: AlignmentStatus = blockedGates ? "BLOCKED" : reviewGates ? "REVIEW" : "READY";

  return {
    contract: { version: "ALIGNMENT_BASELINE_V1", mode: "READ_ONLY_DRY_RUN", directWrite: false, writeOperations: 0 },
    status,
    generatedAt: now.toISOString(),
    summary: {
      tenantRoots: activeTenants.length,
      recommendedTargetTenantId: targetTenantId,
      recommendedTargetScore: recommendation?.readinessScore ?? null,
      blockedGates,
      reviewGates,
      conflicts: conflicts.length,
      truncated: snapshot.truncated,
    },
    tenants: tenantSummaries,
    gates,
    dryRun: {
      targetTenantId,
      sourceTenantIds,
      candidateRecords,
      conflicts,
      requiredHumanDecisions: [
        "Confermare che il tenant raccomandato rappresenti la stessa azienda delle radici sorgente.",
        "Decidere record per record come risolvere codici canonici già presenti nel tenant target.",
        "Collegare le identità alla persona canonica senza unire automaticamente ruoli o capability.",
        "Confermare gli indirizzi legacy prima di creare luogo e geofence server-side.",
      ],
      writeOperations: 0,
    },
  };
}
